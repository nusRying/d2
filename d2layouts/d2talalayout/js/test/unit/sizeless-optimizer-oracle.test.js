import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import {
  OptimizationWorkGuard,
  isOptimizationResourceLimitError,
  shuffle,
  shuffleIndex,
} from '../../src/limits/optimization.js';
import {
  MAX_OPTIMIZATION_WORK_UNITS,
} from '../../src/limits/constants.js';
import {
  snapshotPointer,
  PointerSnapshot,
  snapshotNodePositionsContext,
  restoreNodePositions,
} from '../../src/placement/types.js';
import {
  optimizerAdjacents,
  optimizerMedian,
  optimizerDescendants,
  optimizerMoveNodeAbs,
  optimizerSwapPositions,
} from '../../src/placement/optimizer-support.js';
import {
  captureOptimizerCandidateMovement,
} from '../../src/placement/candidate-movement.js';
import {
  SizelessOptimizer,
  newSizelessOptimizer,
} from '../../src/placement/sizeless-optimizer.js';
import {
  initializeNodes,
  nodeCandidatePositions,
} from '../../src/placement/initialize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, '..', 'fixtures', 'go-sizeless-optimizer-reference.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const bg = { Err: () => null, isCancelled: () => false };

class CountingContext {
  constructor(cancelAt = 0) {
    this.cancelAt = cancelAt;
    this.count = 0;
  }

  isCancelled() {
    this.count++;
    return this.cancelAt > 0 && this.count >= this.cancelAt;
  }
}

function addTestEdge(g, from, to) {
  const e = new Edge(from, to);
  from.Edges.push(e);
  to.Edges.push(e);
  g.AddEdge(e);
  return e;
}

describe('Slice 42 — Sizeless Optimizer Oracle Suite', () => {
  it('replays optimizationWorkGuard scenarios', () => {
    for (const sc of fixture.optimizationWorkGuard) {
      const ctx = sc.cancelAt ? new CountingContext(sc.cancelAt) : bg;
      const guard = new OptimizationWorkGuard(ctx, 'testGuard', BigInt(sc.limit));
      if (sc.expectedError) {
        assert.throws(
          () => {
            if (sc.name === 'cancel_at_64_boundary') {
              guard.add(63n);
              guard.step();
            } else if (sc.action === 'add') {
              guard.add(BigInt(sc.amount));
            } else if (sc.action === 'step') {
              guard.used = BigInt(sc.limit);
              guard.step();
            } else if (sc.action === 'addProduct') {
              guard.addProduct(BigInt(sc.a), BigInt(sc.b));
            }
          },
          (err) => {
            if (sc.name === 'cancel_at_64_boundary') {
              assert(err.message.includes('testGuard: context canceled'));
              return true;
            }
            assert(isOptimizationResourceLimitError(err));
            assert(err.message.includes(sc.expectedError.replace('TALA optimization resource limit exceeded: ', '')));
            return true;
          },
          `scenario ${sc.name} should throw expected error`
        );
      } else {
        if (sc.name === 'add_zero_retains_used') {
          guard.add(5n);
          guard.add(0n);
        } else if (sc.action === 'add') {
          guard.add(BigInt(sc.amount || 0));
        } else if (sc.action === 'addSort') {
          guard.addSort(sc.sortLength || 0);
        }
        assert.strictEqual(
          guard.used,
          BigInt(sc.expectedUsed),
          `scenario ${sc.name} used mismatch`
        );
      }
    }
  });

  it('replays optimizationShuffle scenarios', () => {
    for (const sc of fixture.optimizationShuffle) {
      if (sc.isRejected) {
        const guard = new OptimizationWorkGuard(bg, 'shuffle', MAX_OPTIMIZATION_WORK_UNITS);
        const rnd = new GoRand(BigInt(sc.seed));
        const chosen = shuffleIndex(rnd, sc.n, guard);
        assert.strictEqual(chosen, sc.chosen, `${sc.name} chosen index mismatch`);
        assert.strictEqual(guard.used, BigInt(sc.draws), `${sc.name} guard used draws mismatch`);
      } else {
        const arr = [];
        for (let i = 0; i < sc.count; i++) {
          arr.push(i);
        }
        const rnd = new GoRand(BigInt(sc.seed));
        const guard = new OptimizationWorkGuard(bg, 'shuffle', MAX_OPTIMIZATION_WORK_UNITS);
        shuffle(arr, rnd, guard);
        assert.deepStrictEqual(arr, sc.result, `${sc.name} result mismatch`);
        assert.strictEqual(guard.used, BigInt(sc.used), `${sc.name} used mismatch`);
        assert.strictEqual(rnd.Int63(), BigInt(sc.nextInt63), `${sc.name} nextInt63 mismatch`);
      }
    }
  });

  it('replays placementCostSnapshot scenarios', () => {
    for (const sc of fixture.placementCostSnapshot) {
      const g = new Graph();
      if (sc.initialCache) {
        for (const [k, v] of Object.entries(sc.initialCache)) {
          g.StoreEdgeLengthCost(Number(k), v);
        }
      }
      g.crossingCost = sc.crossingCost;
      g.turnCost = sc.turnCost;
      g.nonCenterPortCost = sc.nonCenterPort;

      const snap = g.SnapshotPlacementCosts();
      const originalCacheRef = g.edgeLengthCache;

      if (sc.mutateBefore) {
        g.StoreEdgeLengthCost(9999, 999.0);
        g.crossingCost = 999.0;
        g.turnCost = 999.0;
        g.nonCenterPortCost = 999.0;
      }

      snap.Restore();

      // Verify exact Map reference identity preservation
      assert.strictEqual(g.edgeLengthCache, originalCacheRef);
      assert.strictEqual(g.crossingCost, sc.restoredCrossing);
      assert.strictEqual(g.turnCost, sc.restoredTurn);
      assert.strictEqual(g.nonCenterPortCost, sc.restoredPort);

      if (sc.restoredCache) {
        for (const [k, v] of Object.entries(sc.restoredCache)) {
          const [cost, found] = g.LookupEdgeLengthCost(Number(k));
          assert.strictEqual(found, true);
          assert.strictEqual(cost, v);
        }
      } else {
        assert.strictEqual(g.EdgeLengthCacheEntries(), 0);
      }
    }
  });

  it('replays pointerSnapshots with exact reference identity', () => {
    for (const sc of fixture.pointerSnapshots) {
      let p = sc.initial != null ? new Point(sc.initial.x, sc.initial.y) : null;
      const originalPointRef = p;
      const snap = snapshotPointer(p);

      // Mutate
      if (p != null) {
        p.X = sc.mutatedX;
        p.Y = sc.mutatedY;
      }

      // Restore
      p = snap.restore(p);

      if (sc.restored != null) {
        assert.notStrictEqual(p, null);
        assert.strictEqual(p.X, sc.restored.x);
        assert.strictEqual(p.Y, sc.restored.y);
        // Pointer reference identity must match original
        assert.strictEqual(p, originalPointRef);
      } else {
        assert.strictEqual(p, null);
      }
    }
  });

  it('replays optimizerAdjacents scenarios', () => {
    for (const sc of fixture.optimizerAdjacents) {
      const g = new Graph();
      const n1 = g.AddNode(new Node(1, 10, 10));
      const n2 = g.AddNode(new Node(2, 10, 10));
      const n3 = g.AddNode(new Node(3, 10, 10));
      n1.TopLeft = new Point(0, 0);
      n2.TopLeft = new Point(2, 0);
      n3.TopLeft = new Point(0, 2);
      addTestEdge(g, n1, n2);
      addTestEdge(g, n1, n3);

      const guard = new OptimizationWorkGuard(bg, 'adj', MAX_OPTIMIZATION_WORK_UNITS);
      const adj = optimizerAdjacents(n1, null, guard);
      const ids = adj.map((n) => String(n.ID));
      assert.deepStrictEqual(ids, sc.adjacentIds);
    }
  });

  it('replays optimizerMedian scenarios', () => {
    for (const sc of fixture.optimizerMedian) {
      const g = new Graph();
      g.CellSize = sc.cellSize;
      const nodes = sc.points.map((p, i) => {
        const dim = sc.dimensions && sc.dimensions[i] ? sc.dimensions[i] : { x: 10, y: 10 };
        const n = g.AddNode(new Node(i + 1, dim.x, dim.y));
        n.TopLeft = new Point(p.x, p.y);
        return n;
      });

      const guard = new OptimizationWorkGuard(bg, 'median', MAX_OPTIMIZATION_WORK_UNITS);
      const [medX, medY] = optimizerMedian(nodes, sc.includeSizes, guard);
      assert.strictEqual(medX, sc.medianX);
      assert.strictEqual(medY, sc.medianY);
    }
  });

  it('replays optimizerDescendants scenarios', () => {
    for (const sc of fixture.optimizerDescendants) {
      const g = new Graph();
      const c = g.AddNode(new Node(10, 100, 100));
      const child1 = g.AddNode(new Node(11, 20, 20));
      const child2 = g.AddNode(new Node(12, 20, 20));
      g.AddNodeToContainer(c, child1);
      g.AddNodeToContainer(c, child2);

      const guard = new OptimizationWorkGuard(bg, 'desc', MAX_OPTIMIZATION_WORK_UNITS);
      const desc = optimizerDescendants(c, guard);
      const ids = desc.map((n) => String(n.ID));
      assert.deepStrictEqual(ids, sc.descendantIds);
    }
  });

  it('replays optimizerMove and optimizerSwap scenarios', () => {
    const g = new Graph();
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(5, 5);
    n2.TopLeft = new Point(15, 15);

    for (const sc of fixture.optimizerMove) {
      const guard = new OptimizationWorkGuard(bg, 'move', MAX_OPTIMIZATION_WORK_UNITS);
      optimizerMoveNodeAbs(n1, sc.targetX, sc.targetY, guard);
      assert.strictEqual(n1.TopLeft.X, sc.nodePositions['1'].x);
      assert.strictEqual(n1.TopLeft.Y, sc.nodePositions['1'].y);
    }

    for (const sc of fixture.optimizerSwap) {
      const guard = new OptimizationWorkGuard(bg, 'swap', MAX_OPTIMIZATION_WORK_UNITS);
      optimizerSwapPositions(n1, n2, guard);
      assert.strictEqual(n1.TopLeft.X, sc.nodePositions['1'].x);
      assert.strictEqual(n1.TopLeft.Y, sc.nodePositions['1'].y);
      assert.strictEqual(n2.TopLeft.X, sc.nodePositions['2'].x);
      assert.strictEqual(n2.TopLeft.Y, sc.nodePositions['2'].y);
    }
  });

  it('replays candidateMovement scenarios', () => {
    for (const sc of fixture.candidateMovement) {
      const g = new Graph();
      const c = g.AddNode(new Node(10, 100, 100));
      c.TopLeft = new Point(0, 0);
      const ch = g.AddNode(new Node(11, 20, 20));
      ch.TopLeft = new Point(5, 5);
      g.AddNodeToContainer(c, ch);

      const guard = new OptimizationWorkGuard(bg, 'candMove', MAX_OPTIMIZATION_WORK_UNITS);
      const mov = captureOptimizerCandidateMovement(c, guard);
      assert.strictEqual(mov.descendantWork, BigInt(sc.descendantWork));
      mov.moveAbs(sc.targetX, sc.targetY, guard);
      assert.strictEqual(c.TopLeft.X, sc.nodePositions['10'].x);
      assert.strictEqual(c.TopLeft.Y, sc.nodePositions['10'].y);
      assert.strictEqual(ch.TopLeft.X, sc.nodePositions['11'].x);
      assert.strictEqual(ch.TopLeft.Y, sc.nodePositions['11'].y);
    }
  });

  it('replays sizelessSetup scenarios', () => {
    for (const sc of fixture.sizelessSetup) {
      const g = new Graph();
      g.CellSize = 10;
      const n1 = g.AddNode(new Node(1, 10, 10));
      const n2 = g.AddNode(new Node(2, 10, 10));
      const n3 = g.AddNode(new Node(3, 10, 10));
      n3.FixedTopLeft = new Point(100, 100);
      const n4 = g.AddNode(new Node(4, 10, 10));
      n1.TopLeft = new Point(0, 0);
      n2.TopLeft = new Point(1, 1);
      addTestEdge(g, n1, n2);

      const rnd = new GoRand(1n);
      const opt = newSizelessOptimizer(bg, g, rnd);
      const optIds = opt.nodes.map((n) => String(n.ID));
      assert.deepStrictEqual(optIds, sc.optimizableNodes);
    }
  });

  it('replays medianPoint, closestDistance, and placementPoints scenarios', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(5, 5);
    addTestEdge(g, n1, n2);

    for (const sc of fixture.medianPoint) {
      const rnd = new GoRand(BigInt(sc.seed));
      const opt = newSizelessOptimizer(bg, g, rnd);
      const guard = new OptimizationWorkGuard(bg, 'medPoint', MAX_OPTIMIZATION_WORK_UNITS);
      const mp = opt.medianPointGuarded(n1, sc.temp, guard);
      assert.strictEqual(mp.X, sc.medianPoint.x, `${sc.name} medianPoint.X mismatch`);
      assert.strictEqual(mp.Y, sc.medianPoint.y, `${sc.name} medianPoint.Y mismatch`);
    }

    for (const sc of fixture.closestDistance) {
      const rnd = new GoRand(1n);
      const opt = newSizelessOptimizer(bg, g, rnd);
      const guard = new OptimizationWorkGuard(bg, 'dist', MAX_OPTIMIZATION_WORK_UNITS);
      const mp = new Point(sc.medianPoint.x, sc.medianPoint.y);
      const d = opt.findClosestUnoccupiedDistanceGuarded(n1, mp, guard);
      assert.strictEqual(d, sc.distance, `${sc.name} distance mismatch`);
    }

    for (const sc of fixture.placementPoints) {
      const rnd = new GoRand(1n);
      const opt = newSizelessOptimizer(bg, g, rnd);
      const guard = new OptimizationWorkGuard(bg, 'pts', MAX_OPTIMIZATION_WORK_UNITS);
      const mp = new Point(sc.medianPoint.x, sc.medianPoint.y);
      const pts = opt.placementPointsGuarded(n1, mp, sc.distance, guard);
      const ptsJSON = pts.map((p) => ({ x: p.X, y: p.Y }));
      assert.deepStrictEqual(ptsJSON, sc.points, `${sc.name} points mismatch`);
    }
  });

  it('replays sizelessOptimize end-to-end scenarios', () => {
    for (const sc of fixture.sizelessOptimize) {
      const g = new Graph();
      g.CellSize = 10;
      const n1 = g.AddNode(new Node(1, 10, 10));
      const n2 = g.AddNode(new Node(2, 10, 10));
      const n3 = g.AddNode(new Node(3, 10, 10));
      n1.TopLeft = new Point(0, 0);
      n2.TopLeft = new Point(1, 1);
      n3.TopLeft = new Point(2, 2);
      addTestEdge(g, n1, n2);
      addTestEdge(g, n2, n3);

      const rnd = new GoRand(BigInt(sc.seed));
      const opt = newSizelessOptimizer(bg, g, rnd);
      opt.optimize(bg, sc.temp);

      for (const [idStr, expPos] of Object.entries(sc.finalPositions)) {
        const id = Number(idStr);
        const node = g.Nodes.find((n) => n.ID === id);
        assert.notStrictEqual(node, undefined);
        assert.strictEqual(node.TopLeft.X, expPos.x, `${sc.name} node ${idStr} X mismatch`);
        assert.strictEqual(node.TopLeft.Y, expPos.y, `${sc.name} node ${idStr} Y mismatch`);
      }
    }
  });

  it('replays initializationCandidates scenarios', () => {
    const gTgt = new Graph();
    gTgt.CellSize = 10;
    const tn1 = gTgt.AddNode(new Node(1, 10, 10));
    const tn2 = gTgt.AddNode(new Node(2, 10, 10));
    tn1.TopLeft = new Point(5, 5);
    const e = addTestEdge(gTgt, tn1, tn2);
    e.TargetArrowhead = 'arrow';

    const sizeless = newSizelessOptimizer(bg, gTgt, null);

    // Target node candidate positions
    const scTarget = fixture.initializationCandidates.find((s) => s.isMajorityTarget);
    const candsTarget = nodeCandidatePositions(bg, tn2, gTgt, sizeless);
    const candsTargetJSON = candsTarget.map((p) => ({ x: p.X, y: p.Y }));
    assert.deepStrictEqual(candsTargetJSON, scTarget.positions);

    // Source node candidate positions
    tn2.TopLeft = new Point(8, 8);
    tn1.TopLeft = null;
    const scSource = fixture.initializationCandidates.find((s) => !s.isMajorityTarget);
    const candsSource = nodeCandidatePositions(bg, tn1, gTgt, sizeless);
    const candsSourceJSON = candsSource.map((p) => ({ x: p.X, y: p.Y }));
    assert.deepStrictEqual(candsSourceJSON, scSource.positions);
  });

  it('replays initializeNodes across graph topologies', () => {
    for (const sc of fixture.initializeNodes) {
      if (sc.name === 'init_2_node_edge') {
        const g = new Graph();
        g.CellSize = 10;
        const n1 = g.AddNode(new Node(1, 10, 10));
        const n2 = g.AddNode(new Node(2, 10, 10));
        addTestEdge(g, n1, n2);
        initializeNodes(bg, g);
        assert.strictEqual(n1.TopLeft.X, sc.finalPositions['1'].x);
        assert.strictEqual(n1.TopLeft.Y, sc.finalPositions['1'].y);
        assert.strictEqual(n2.TopLeft.X, sc.finalPositions['2'].x);
        assert.strictEqual(n2.TopLeft.Y, sc.finalPositions['2'].y);
      } else if (sc.name === 'init_3_node_path') {
        const g = new Graph();
        g.CellSize = 10;
        const n1 = g.AddNode(new Node(1, 10, 10));
        const n2 = g.AddNode(new Node(2, 10, 10));
        const n3 = g.AddNode(new Node(3, 10, 10));
        addTestEdge(g, n1, n2);
        addTestEdge(g, n2, n3);
        initializeNodes(bg, g);
        assert.strictEqual(n1.TopLeft.X, sc.finalPositions['1'].x);
        assert.strictEqual(n1.TopLeft.Y, sc.finalPositions['1'].y);
        assert.strictEqual(n2.TopLeft.X, sc.finalPositions['2'].x);
        assert.strictEqual(n2.TopLeft.Y, sc.finalPositions['2'].y);
        assert.strictEqual(n3.TopLeft.X, sc.finalPositions['3'].x);
        assert.strictEqual(n3.TopLeft.Y, sc.finalPositions['3'].y);
      } else if (sc.name === 'init_star_graph') {
        const g = new Graph();
        g.CellSize = 10;
        const scNode = g.AddNode(new Node(1, 10, 10));
        const sl1 = g.AddNode(new Node(2, 10, 10));
        const sl2 = g.AddNode(new Node(3, 10, 10));
        const sl3 = g.AddNode(new Node(4, 10, 10));
        addTestEdge(g, scNode, sl1);
        addTestEdge(g, scNode, sl2);
        addTestEdge(g, scNode, sl3);
        initializeNodes(bg, g);
        for (const [idStr, expPos] of Object.entries(sc.finalPositions)) {
          const id = Number(idStr);
          const node = g.Nodes.find((n) => n.ID === id);
          assert.strictEqual(node.TopLeft.X, expPos.x);
          assert.strictEqual(node.TopLeft.Y, expPos.y);
        }
      } else if (sc.name === 'init_near_cycle') {
        const g = new Graph();
        g.CellSize = 10;
        const n1 = g.AddNode(new Node(1, 10, 10));
        const n2 = g.AddNode(new Node(2, 10, 10));
        const n3 = g.AddNode(new Node(3, 10, 10));
        n1.AddNear(n2);
        n2.AddNear(n3);
        n3.AddNear(n1);
        initializeNodes(bg, g);
        for (const [idStr, expPos] of Object.entries(sc.finalPositions)) {
          const id = Number(idStr);
          const node = g.Nodes.find((n) => n.ID === id);
          assert.strictEqual(node.TopLeft.X, expPos.x);
          assert.strictEqual(node.TopLeft.Y, expPos.y);
        }
      } else if (sc.name === 'init_fixed_pair') {
        const g = new Graph();
        g.CellSize = 10;
        const fn1 = g.AddNode(new Node(1, 10, 10));
        fn1.FixedTopLeft = new Point(30, 60);
        const fn2 = g.AddNode(new Node(2, 10, 10));
        fn2.FixedTopLeft = new Point(90, 120);
        const fn3 = g.AddNode(new Node(3, 10, 10));
        addTestEdge(g, fn1, fn3);
        addTestEdge(g, fn2, fn3);
        initializeNodes(bg, g);
        for (const [idStr, expPos] of Object.entries(sc.finalPositions)) {
          const id = Number(idStr);
          const node = g.Nodes.find((n) => n.ID === id);
          assert.strictEqual(node.TopLeft.X, expPos.x);
          assert.strictEqual(node.TopLeft.Y, expPos.y);
        }
      }
    }
  });

  it('replays atomicity scenarios on cancellation rollback', () => {
    for (const sc of fixture.atomicity) {
      const g = new Graph();
      g.CellSize = 10;
      const n1 = g.AddNode(new Node(1, 10, 10));
      const n2 = g.AddNode(new Node(2, 10, 10));
      n1.TopLeft = new Point(3, 4);
      n2.TopLeft = new Point(8, 9);
      addTestEdge(g, n1, n2);

      const canceledCtx = { Err: () => new Error('canceled'), isCancelled: () => true };
      assert.throws(
        () => initializeNodes(canceledCtx, g),
        (err) => {
          assert(err != null);
          return true;
        }
      );

      // Verify restored node positions
      assert.strictEqual(n1.TopLeft.X, sc.restoredNodes['1'].x);
      assert.strictEqual(n1.TopLeft.Y, sc.restoredNodes['1'].y);
      assert.strictEqual(n2.TopLeft.X, sc.restoredNodes['2'].x);
      assert.strictEqual(n2.TopLeft.Y, sc.restoredNodes['2'].y);
    }
  });
});
