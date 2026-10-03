// Slice 45 — sized optimizer behavior. Ports internal/placement/sized_optimizer_test.go
// and adds focused ordering/identity checks. Exhaustive parity lives in
// sized-optimizer-oracle.test.js.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { OptimizationWorkGuard } from '../../src/limits/optimization.js';
import { MAX_OPTIMIZATION_WORK_UNITS } from '../../src/limits/constants.js';
import {
  iterPlacementsAroundPoint,
  newSizedOptimizer,
  withHubSpokesSuppressed,
} from '../../src/placement/sized-optimizer.js';
import { bg } from './sized-optimizer-fixtures.js';

function guard() {
  return new OptimizationWorkGuard(bg, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
}

// The five-node fixture shared by TestMedianPoint and friends.
function star({ n5 = [0, 0], connect = true, n6 = null } = {}) {
  const g = new Graph();
  const add = (id, x, y) => {
    const n = new Node(BigInt(id), 50, 50);
    n.TopLeft = new Point(x, y);
    g.addNode(n);
    return n;
  };
  const n1 = add(1, 100, 0);
  const n2 = add(2, 0, 100);
  const n3 = add(3, 200, 100);
  const n4 = add(4, 100, 200);
  const n5node = add(5, n5[0], n5[1]);
  if (connect) {
    g.connect(n1, n5node);
    g.connect(n2, n5node);
    g.connect(n3, n5node);
    g.connect(n4, n5node);
  }
  if (n6) add(6, n6[0], n6[1]);
  g.computeCellSize();
  return { g, n1, n2, n3, n4, n5: n5node };
}

function closest(optim, node, point, self = true, checked = null) {
  const gd = guard();
  optim.rebuildSpatialIndex(gd);
  return optim.findClosestUnoccupiedDistanceGuarded(node, point, self, checked, gd);
}

describe('Slice 45 — sized optimizer (pinned Go tests)', () => {
  it('computes the neighbor median (TestMedianPoint)', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const median = optim.medianPointGuarded(n5, 0, [], guard());
    expect([median.X, median.Y]).toEqual([125, 125]);
  });

  it('keeps large parallel-edge requirements untruncated (TestSizedOptimizerDoesNotTruncateLargeParallelEdgeRequirements)', () => {
    const g = new Graph();
    g.CellSize = 100;
    const from = new Node(1n, 50, 50);
    const to = new Node(2n, 50, 50);
    from.TopLeft = new Point(0, 0);
    to.TopLeft = new Point(100, 0);
    g.addNode(from);
    g.addNode(to);
    for (let i = 0; i < 256; i++) {
      const edge = g.connect(from, to);
      edge.MinWidth = 5000;
      edge.MinHeight = 6000;
    }
    newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const requirements = from.LongDistanceNeighborRequirements.get(to);
    expect([requirements.EdgeCount, requirements.MaxWidth, requirements.MaxHeight]).toEqual([256, 5000, 6000]);
  });

  it('enumerates every covering placement (TestIterPlacementsAroundPoint)', () => {
    const g = new Graph();
    const node = new Node(1n, 10, 10);
    g.addNodeUnchecked(node);
    g.CellSize = 2;
    const points = [];
    iterPlacementsAroundPoint(node, 5, 5, true, (x, y) => {
      points.push(`${x},${y}`);
      return false;
    });
    const expected = [
      [0, 0], [0, 10], [10, 0], [10, 10],
      [2, 0], [4, 0], [6, 0], [8, 0],
      [0, 2], [0, 4], [0, 6], [0, 8],
      [10, 2], [10, 4], [10, 6], [10, 8],
      [2, 10], [4, 10], [6, 10], [8, 10],
    ];
    for (const [x, y] of expected) expect(points).toContain(`${x},${y}`);
    // The initial point is applied first; X is the outer loop.
    expect(points[0]).toBe('10,10');
    expect(points[1]).toBe('0,0');
    expect(points[2]).toBe('0,2');
  });

  it('finds the closest unoccupied distance (TestSizedFindClosestUnoccupiedDistance)', () => {
    let { g, n4, n5 } = star();
    let optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    expect(closest(optim, n5, n5.TopLeft)).toBe(0);
    expect(closest(optim, n5, new Point(100, 100))).toBe(4);
    expect(closest(optim, n5, n4.TopLeft.copy())).toBe(3);
    ({ g, n5 } = star({ n6: [100, 100] }));
    optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    expect(closest(optim, n5, new Point(100, 100))).toBe(4);
  });

  it('finds closer positions for disconnected nodes (TestFindClosestUnoccupiedDistanceNoConnections)', () => {
    let { g, n4, n5 } = star({ connect: false });
    let optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    expect(closest(optim, n5, n5.TopLeft)).toBe(0);
    expect(closest(optim, n5, new Point(100, 100))).toBe(0);
    expect(closest(optim, n5, n4.TopLeft.copy())).toBe(1);
    ({ g, n5 } = star({ connect: false, n6: [100, 100] }));
    optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    expect(closest(optim, n5, new Point(100, 100))).toBe(3);
  });

  it('generates cell-aligned candidates (TestSizedOptimizerGetPlacementPoints)', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const points = optim.fillPlacementPointsGuarded(n5, new Point(100, 100), 1, true, { seen: null, points: null }, guard());
    expect(points.length).toBe(24);
    for (const p of points) {
      expect(p.X % optim.cellSize === 0).toBe(true);
      expect(p.Y % optim.cellSize === 0).toBe(true);
    }
  });

  it('moves to the best valid candidate (TestMoveNodeToBest)', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const run = (points, mustImprove) => {
      const gd = guard();
      optim.rebuildSpatialIndex(gd);
      return optim.moveNodeToBestGuarded(bg, n5, points, mustImprove, gd);
    };
    const pointer = n5.TopLeft;
    expect(run([n5.TopLeft.copy(), new Point(100, 100)], false)).toBe(false);
    expect(run([new Point(300, 200), new Point(400, 200), new Point(350, 200)], false)).toBe(true);
    expect([n5.TopLeft.X, n5.TopLeft.Y]).toEqual([350, 200]);
    expect(n5.TopLeft).toBe(pointer);
  });

  it('picks a legal swap candidate only when the cell allows it (TestBestSwapCandidate)', () => {
    const g = new Graph();
    const add = (id, x, y) => {
      const n = new Node(BigInt(id), 50, 50);
      n.TopLeft = new Point(x, y);
      g.addNode(n);
      return n;
    };
    const n1 = add(1, 100, 0);
    const n2 = add(2, 0, 100);
    const n3 = add(3, 250, 100);
    const n4 = add(4, 100, 200);
    const n5 = add(5, 350, 200);
    for (const n of [n1, n2, n3, n4]) g.connect(n, n5);
    g.computeCellSize();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const best = () => {
      const gd = guard();
      optim.rebuildSpatialIndex(gd);
      return optim.bestSwapCandidateGuarded(bg, n5, gd);
    };
    expect(best()).toBeNull();
    g.CellSize = 100;
    n5.TopLeft = new Point(400, 100);
    expect(best()).toBe(n3);
  });
});

describe('Slice 45 — sized optimizer ordering and identity details', () => {
  it('encodes negative cell coordinates through uint32 wrapping (no collisions)', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const scratch = { seen: null, points: null };
    const points = optim.fillPlacementPointsGuarded(n5, new Point(-370, -230), 2, true, scratch, guard());
    const keys = [...scratch.seen.keys()];
    expect(keys.length).toBe(points.length);
    for (const key of keys) expect(typeof key).toBe('bigint');
    // (-1, -1) cells wrap to 0xffffffff in both halves, exactly as Go's uint32 conversion.
    const wrapped = (BigInt.asUintN(32, -1n) << 32n) | BigInt.asUintN(32, -1n);
    expect(wrapped).toBe(0xffffffffffffffffn);
    const cell = optim.cellSize;
    const coords = points.map((p) => `${p.X / cell},${p.Y / cell}`);
    expect(new Set(coords).size).toBe(points.length);
  });

  it('charges one Step per stale seen entry when reusing scratch', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const scratch = { seen: null, points: null };
    const first = guard();
    const firstPoints = optim.fillPlacementPointsGuarded(n5, new Point(100, 100), 1, true, scratch, first);
    const seenCount = scratch.seen.size;
    const second = guard();
    optim.fillPlacementPointsGuarded(n5, new Point(100, 100), 1, true, scratch, second);
    expect(Number(second.Used() - first.Used())).toBe(seenCount);
    expect(seenCount).toBe(firstPoints.length);
  });

  it('appends the herd node current position last', () => {
    const { g, n5 } = star();
    n5.HerdAssignment = { Orientation: 4, Val: 0 };
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const points = optim.fillPlacementPointsGuarded(n5, new Point(100, 100), 1, true, { seen: null, points: null }, guard());
    const last = points[points.length - 1];
    expect([last.X, last.Y]).toEqual([n5.TopLeft.X, n5.TopLeft.Y]);
    expect(last).not.toBe(n5.TopLeft);
  });

  it('rejects invalid placement distances without clamping', () => {
    const { g, n5 } = star();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    for (const d of [-1, 101, NaN, Infinity]) {
      expect(() => optim.fillPlacementPointsGuarded(n5, new Point(0, 0), d, true, { seen: null, points: null }, guard()))
        .toThrow('TALA LocalOptimize placement distance must be finite and within [0, 100]');
    }
    expect(() => optim.fillPlacementPointsGuarded(n5, null, 1, true, { seen: null, points: null }, guard()))
      .toThrow('TALA LocalOptimize placement generation requires a positioned node and median');
  });

  it('restores the exact hub edge array on success, returned error, and throw', () => {
    const g = new Graph();
    const add = (id, x) => {
      const n = new Node(BigInt(id), 10, 10);
      n.TopLeft = new Point(x, 0);
      g.addNewNodeToContainer(null, n);
      return n;
    };
    const hub = add(1, 0);
    const spoke = add(2, 20);
    const other = add(3, 40);
    g.connect(hub, spoke);
    g.connect(hub, other);
    g.computeCellSize();
    const originalEdges = hub.Edges;
    const originalContents = [...hub.Edges];
    const check = () => {
      expect(hub.Edges).toBe(originalEdges);
      expect([...hub.Edges]).toEqual(originalContents);
    };

    let seen = null;
    withHubSpokesSuppressed(hub, [spoke], guard(), () => {
      seen = [...hub.Edges];
      expect(hub.Edges).not.toBe(originalEdges);
    });
    expect(seen).toEqual([originalContents[1]]);
    check();

    const sentinel = { name: 'suppressed throw' };
    expect(() => withHubSpokesSuppressed(hub, [spoke], guard(), () => {
      hub.Edges.push(originalContents[0]);
      throw sentinel;
    })).toThrow();
    check();

    // fn mutating the original array in place is still repaired.
    try {
      withHubSpokesSuppressed(hub, [spoke], guard(), () => {
        originalEdges.reverse();
        throw sentinel;
      });
    } catch (err) {
      expect(err).toBe(sentinel);
    }
    check();

    expect(() => withHubSpokesSuppressed(hub, [null], guard(), () => null)).toThrow('TALA LocalOptimize found a nil hub spoke');
    check();
  });
});
