// Slice 44 — replay of internal/layoutgraph/go_transaction_oracle_test.go.
// Every expected value comes from pinned Go; nothing here is derived from JS.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { segmentsCross } from '../../src/placementcost/graph.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { Sequence } from '../../src/graph/sequence.js';
import { LongDistanceNeighborRequirements } from '../../src/graph/neighbor-requirements.js';
import { newGraphStateSnapshot } from '../../src/graph/graph-state.js';
import {
  ErrInvalidCandidate,
  ErrNonImprovingCandidate,
  isCandidateRejection,
  buildTransactionOverlaps,
  buildTransactionOverlapsWithReferenceLimit,
  newTransactionWithOptionsContext,
} from '../../src/graph/transaction.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_WORK_UNITS,
  MAX_TRANSACTION_WORK_UNITS,
} from '../../src/limits/constants.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-transaction-reference.json'), 'utf8'),
);

const bg = backgroundWorkContext();
const CANCELED = new Error('context canceled');

function guardWith(limit) {
  return new WorkGuard(backgroundWorkContext(), 'Slice44TransactionOracle', limit);
}

function used(guard) {
  return Number(guard.Used());
}

function countingContext(cancelAt = 0) {
  return {
    calls: 0,
    cancelAt,
    Err() {
      this.calls++;
      return this.cancelAt > 0 && this.calls >= this.cancelAt ? CANCELED : null;
    },
  };
}

function boxes(...nodes) {
  return nodes.map((node) => ({
    id: Number(node.ID),
    placed: node.TopLeft != null,
    x: node.TopLeft != null ? node.TopLeft.X : 0,
    y: node.TopLeft != null ? node.TopLeft.Y : 0,
    w: node.Width,
    h: node.Height,
  }));
}

function node(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  if (x !== undefined) n.TopLeft = new Point(x, y);
  return n;
}

function containerScenario() {
  const g = new Graph();
  g.CellSize = 10;
  const outer = node(1, 300, 300, 0, 0);
  const a = node(2, 40, 40, 60, 60);
  const b = node(3, 40, 40, 200, 60);
  const far = node(4, 40, 40, 1000, 1000);
  g.addNodeUnchecked(outer);
  g.addNewNodeToContainer(outer, a);
  g.addNewNodeToContainer(outer, b);
  g.addNodeUnchecked(far);
  g.connect(a, b);
  g.connect(b, far);
  outer.wrapChildren();
  const s = { g, outer, a, b, far, opCalls: 0, observed: [] };
  s.nodes = () => [outer, a, b, far];
  s.addOps = (txn) => {
    txn.addOp(() => {
      s.opCalls++;
      a.moveWithChildren(0, 50);
      return null;
    });
    txn.addOp(() => {
      s.opCalls++;
      s.observed.push(outer.TopLeft.X, outer.TopLeft.Y, outer.Width, outer.Height);
      b.moveWithChildren(-20, 0);
      return null;
    });
  };
  return s;
}

function clusterScenario() {
  const g = new Graph();
  g.CellSize = 10;
  const vessel = node(10, 0, 0, 0, 0);
  vessel.isClusterVessel = true;
  const m1 = node(11, 40, 20);
  const m2 = node(12, 60, 20);
  const cluster = new Cluster({
    Vessel: vessel,
    Nodes: [m1, m2],
    Graph: g,
    Arrangement: ClusterArrangement.Column,
    DesiredArrangement: ClusterArrangement.Column,
    Padding: 20,
  });
  m1.Cluster = cluster;
  m2.Cluster = cluster;
  m1.Graph = g;
  m2.Graph = g;
  g.addNodeUnchecked(vessel);
  g.Clusters.set(vessel, cluster);
  const other = node(13, 40, 40, 500, 0);
  g.addNodeUnchecked(other);
  cluster.SyncGeometry();
  const s = { g, vessel, m1, m2, other, observed: [] };
  s.nodes = () => [vessel, m1, m2, other];
  s.addOps = (txn) => {
    txn.addOp(() => {
      vessel.TopLeft.X += 100;
      return null;
    });
    txn.addOp(() => {
      s.observed.push(m1.TopLeft.X, m1.TopLeft.Y, m2.TopLeft.X, m2.TopLeft.Y);
      return null;
    });
  };
  return s;
}

function pairIDs(overlaps) {
  const pairs = new Set();
  for (const [first, others] of overlaps) {
    for (const second of others) {
      let low = first.ID;
      let high = second.ID;
      if (low > high) [low, high] = [high, low];
      pairs.add(`${low}/${high}`);
    }
  }
  return [...pairs].sort();
}

function sweepGraph(spec) {
  const g = new Graph();
  const byID = new Map();
  for (const n of spec.nodes) {
    const created = node(n.id, n.w, n.h);
    if (n.placed) created.TopLeft = new Point(n.x, n.y);
    created._margin = { top: n.margin[0], right: n.margin[1], bottom: n.margin[2], left: n.margin[3] };
    if (n.loopOffsets) {
      created.LoopOffsets = new Map(
        Object.entries(n.loopOffsets).map(([name, value]) => [Orientation[name], value]),
      );
    }
    if (n.table) created._shapeType = 'Table';
    g.addNodeUnchecked(created);
    byID.set(n.id, created);
  }
  for (const e of spec.edges) {
    const from = byID.get(e.from);
    const to = byID.get(e.to);
    const edge = new Edge(from, to);
    edge.MinWidth = e.minWidth;
    edge.MinHeight = e.minHeight;
    g.Edges.push(edge);
    from.Edges.push(edge);
    if (e.toOwns) to.Edges.push(edge);
  }
  return g;
}

describe('Slice 44 — transaction Go oracle replay', () => {
  it('replays SegmentsCross and candidate sentinel messages', () => {
    const values = {
      intersecting_diagonals: segmentsCross(new Point(0, 0), new Point(100, 100), new Point(0, 100), new Point(100, 0)),
      parallel_horizontal: segmentsCross(new Point(0, 0), new Point(100, 0), new Point(0, 50), new Point(100, 50)),
    };
    for (const entry of fixture.segmentsCross) {
      expect(values[entry.name]).toBe(entry.expected);
    }
    expect(ErrInvalidCandidate.message).toBe(fixture.candidateErrors.invalid);
    expect(ErrNonImprovingCandidate.message).toBe(fixture.candidateErrors.nonImproving);
  });

  it('commits multi-op containers with per-op reposition, sync, and exact work', () => {
    const want = fixture.containerCommit;
    const s = containerScenario();
    expect(boxes(...s.nodes())).toEqual(want.initial);
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const ctx = countingContext();
    const [txn, err] = s.g.newRequestTransactionWithGuard(ctx, guard, { AffectContainers: true });
    expect(err).toBeNull();
    expect(used(guard)).toBe(want.usedAfterCreate);
    ctx.calls = 0;
    s.addOps(txn);
    expect(txn.commit(ctx)).toBeNull();
    expect(ctx.calls).toBe(want.ctxErrCalls);
    expect(used(guard)).toBe(want.usedAfterCommit);
    // op #2 observed the container geometry produced by op #1's reposition.
    expect(s.observed).toEqual(want.observed);
    expect(boxes(...s.nodes())).toEqual(want.final);
    txn.clear();
    expect(txn.updateState()).toBeNull();
    expect(used(guard)).toBe(want.usedAfterRefresh);
  });

  it('synchronizes clusters after every operation without AffectContainers', () => {
    const want = fixture.clusterSync;
    const s = clusterScenario();
    expect(boxes(...s.nodes())).toEqual(want.initial);
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const [txn, err] = s.g.newRequestTransactionWithGuard(bg, guard, {});
    expect(err).toBeNull();
    expect(used(guard)).toBe(want.usedAfterCreate);
    s.addOps(txn);
    expect(txn.commit(bg)).toBeNull();
    expect(used(guard)).toBe(want.usedAfterCommit);
    expect(s.observed).toEqual(want.observed);
    expect(boxes(...s.nodes())).toEqual(want.final);
  });

  it('cancels at every Commit context checkpoint with exact work and full rollback', () => {
    expect(fixture.containerCancelProbes.length).toBe(fixture.containerCommit.ctxErrCalls);
    for (const probe of fixture.containerCancelProbes) {
      const s = containerScenario();
      const pointers = s.nodes().map((n) => n.TopLeft);
      const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
      const ctx = countingContext();
      const [txn] = s.g.newRequestTransactionWithGuard(ctx, guard, { AffectContainers: true });
      ctx.calls = 0;
      ctx.cancelAt = probe.cancelAt;
      s.addOps(txn);
      const err = txn.commit(ctx);
      expect(err).toBe(CANCELED);
      expect(err.message).toBe(probe.error);
      expect(s.opCalls).toBe(probe.opCalls);
      expect(used(guard)).toBe(probe.used);
      expect(boxes(...s.nodes())).toEqual(probe.boxes);
      s.nodes().forEach((n, i) => expect(n.TopLeft).toBe(pointers[i]));
    }
  });

  it('proves the exact W / W-1 transaction boundary with identity-preserving rollback', () => {
    const want = fixture.workBoundary;
    const measure = (limit) => {
      const s = containerScenario();
      const pointers = s.nodes().map((n) => n.TopLeft);
      const guard = guardWith(limit);
      const ctx = contextWithTransactionWorkGuard(bg, guard);
      let err = null;
      try {
        const [txn, createErr] = s.g.newRequestTransaction(ctx, { AffectContainers: true });
        if (createErr != null) throw createErr;
        s.addOps(txn);
        err = txn.commit(ctx);
      } catch (thrown) {
        err = thrown;
      }
      return { s, guard, err, pointers };
    };
    const full = measure(MAX_TRANSACTION_WORK_UNITS);
    expect(full.err).toBeNull();
    expect(used(full.guard)).toBe(want.w);

    const atW = measure(want.w);
    expect(atW.err).toBeNull();
    expect(used(atW.guard)).toBe(want.w);

    const below = measure(want.w - 1);
    expect(below.err).toBeInstanceOf(Error);
    expect(below.err.message).toBe(want.error);
    expect(used(below.guard)).toBe(want.used);
    // Failure happens after both operations ran (meaningful processing).
    expect(below.s.opCalls).toBe(2);
    expect(boxes(...below.s.nodes())).toEqual(want.boxes);
    below.s.nodes().forEach((n, i) => expect(n.TopLeft).toBe(below.pointers[i]));
  });

  it('rejects an overlapping candidate with exact work and rollback', () => {
    const want = fixture.rejection;
    const s = containerScenario();
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const [txn] = s.g.newRequestTransactionWithGuard(bg, guard, {});
    txn.addOp(() => {
      s.far.moveAbsWithChildren(s.b.TopLeft.X, s.b.TopLeft.Y);
      return null;
    });
    const err = txn.commit(bg);
    expect(err).toBe(ErrInvalidCandidate);
    expect(err.message).toBe(want.error);
    expect(isCandidateRejection(err)).toBe(want.isRejection);
    expect(used(guard)).toBe(want.used);
    expect(boxes(...s.nodes())).toEqual(want.boxes);
  });

  it('charges every transaction, clone, and cost capture to one shared guard', () => {
    const want = fixture.sharedGuard;
    const s = containerScenario();
    s.g.storeEdgeLengthCost(1n, 2);
    s.g.storeEdgeLengthCost(3n, 4);
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const [first] = s.g.newRequestTransaction(ctx, { AffectContainers: true });
    expect(first.guard).toBe(guard);
    expect(used(guard)).toBe(want.afterFirstCreate);
    s.addOps(first);
    expect(first.commit(ctx)).toBeNull();
    expect(used(guard)).toBe(want.afterFirstCommit);
    const [second] = s.g.newRequestTransaction(ctx, {});
    expect(second.guard).toBe(guard);
    expect(used(guard)).toBe(want.afterSecondCreate);
    second.addOp(() => {
      s.far.moveWithChildren(10, 0);
      return null;
    });
    expect(second.commit(ctx)).toBeNull();
    expect(used(guard)).toBe(want.afterSecondCommit);
    const [clone, cloneErr] = second.cloneGeometryContext();
    expect(cloneErr).toBeNull();
    expect(used(guard)).toBe(want.afterClone);
    clone.clear();
    clone.addOp(() => {
      s.far.moveWithChildren(0, 10);
      return null;
    });
    expect(clone.commit(ctx)).toBeNull();
    expect(used(guard)).toBe(want.afterCloneCommit);
    expect(clone.capturePlacementCosts('Slice44TransactionOracle')).toBeNull();
    expect(used(guard)).toBe(want.afterCostCapture);
  });

  it('replays UpdateState advancement and limit rollback', () => {
    const want = fixture.updateState;
    {
      const g = new Graph();
      const n = node(1, 10, 10, 1, 2);
      g.addNewNodeToContainer(null, n);
      const [txn] = newTransactionWithOptionsContext(g, bg, {}, null);
      txn.addOp(() => {
        n.TopLeft.X = 10;
        return null;
      });
      expect(txn.commit(bg)).toBeNull();
      txn.clear();
      expect(txn.updateState()).toBeNull();
      const reject = new Error('reject');
      txn.addOp(() => {
        n.TopLeft.X = 100;
        return reject;
      });
      const err = txn.commit(bg);
      expect(err).toBe(reject);
      expect(err.message).toBe(want.advancedError);
      expect(n.TopLeft.X).toBe(want.advancedX);
    }
    {
      const g = new Graph();
      const n = new Node(1n, 10, 10);
      const originalTopLeft = new Point(1, 2);
      n.TopLeft = originalTopLeft;
      g.addNodeUnchecked(n);
      const [txn] = newTransactionWithOptionsContext(g, bg, {}, null);
      txn.addOp(() => {
        n.TopLeft = new Point(100, 200);
        return null;
      });
      expect(txn.commit(bg)).toBeNull();
      txn.clear();
      const lowLimit = new WorkGuard(bg, 'TransactionUpdateStateTest', 1);
      lowLimit.Step();
      txn._guard = lowLimit;
      const err = txn.updateState();
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(want.limitError);
      expect(used(lowLimit)).toBe(want.limitUsed);
      expect(n.TopLeft.X).toBe(want.restoredX);
      expect(n.TopLeft.Y).toBe(want.restoredY);
      expect(n.TopLeft === originalTopLeft).toBe(want.restoredIdentity);
    }
  });

  it('matches the pinned sweep for every exported legacy all-pairs graph', () => {
    expect(fixture.sweep.length).toBe(40);
    for (const spec of fixture.sweep) {
      const g = sweepGraph(spec);
      const guard = new WorkGuard(bg, 'TransactionSweepOracle', MAX_TRANSACTION_WORK_UNITS);
      const [near, exact, err] = buildTransactionOverlaps(g, guard);
      expect(err).toBeNull();
      expect(pairIDs(near)).toEqual(spec.near);
      expect(pairIDs(exact)).toEqual(spec.exact);
      expect(used(guard)).toBe(spec.used);
    }
  });

  it('skips duplicate top-level identity pairs', () => {
    const g = new Graph();
    const first = node(1, 100, 100, 0, 0);
    const second = node(2, 100, 100, 50, 50);
    const third = node(3, 25, 25, 1000, 1000);
    g.addNodeUnchecked(first);
    g.addNodeUnchecked(second);
    g.addNodeUnchecked(first);
    g.addNodeUnchecked(third);
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const [near, exact, err] = buildTransactionOverlaps(g, guard);
    expect(err).toBeNull();
    expect(pairIDs(near)).toEqual(fixture.duplicateReferenceNear);
    expect(pairIDs(exact)).toEqual(fixture.duplicateReferenceExact);
    expect(used(guard)).toBe(fixture.duplicateReferenceUsed);
    expect(near.get(first).has(first)).toBe(false);
    expect(exact.get(first).has(first)).toBe(false);
  });

  it('enforces the aggregate overlap reference limit', () => {
    const build = () => {
      const g = new Graph();
      for (let i = 0; i < 5; i++) g.addNodeUnchecked(node(i + 1, 10, 10, 0, 0));
      return g;
    };
    const [, , err39] = buildTransactionOverlapsWithReferenceLimit(build(), guardWith(1000), 39);
    expect(err39.message).toBe(fixture.referenceLimit39Error);
    const guard = guardWith(1000);
    const [near, , err40] = buildTransactionOverlapsWithReferenceLimit(build(), guard, 40);
    expect(err40).toBeNull();
    expect(pairIDs(near).length).toBe(fixture.referenceLimit40NearPairs);
    expect(used(guard)).toBe(fixture.referenceLimit40Used);
  });

  it('supports the sparse maximum node count', () => {
    const g = new Graph();
    for (let i = 0; i < MAX_ENGINE_NODES; i++) {
      g.addNodeUnchecked(node(i + 1, 10, 10, i * 1000, (i % 17) * 1000));
    }
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const [txn, err] = newTransactionWithOptionsContext(g, bg, {}, guard);
    expect(err).toBeNull();
    expect(txn.PriorGraphState.existingOverlaps.size).toBe(0);
    expect(txn.PriorGraphState.existingExactOverlaps.size).toBe(0);
    expect(used(guard)).toBe(fixture.sparseMaximumUsed);
  });

  it('deduplicates cluster and sequence membership', () => {
    const g = new Graph();
    for (let i = 0; i < 4000; i++) g.addNodeUnchecked(node(i + 1, 10, 10, i * 1000, 0));
    g.Clusters.set(g.Nodes[0], new Cluster({ Vessel: g.Nodes[0], Nodes: g.Nodes, Graph: g }));
    g.Sequences.set(g.Nodes[1], new Sequence({ Vessel: g.Nodes[1], Nodes: g.Nodes, Graph: g }));
    const guard = guardWith(MAX_TRANSACTION_WORK_UNITS);
    const [txn, err] = newTransactionWithOptionsContext(g, bg, {}, guard);
    expect(err).toBeNull();
    expect(txn.PriorGraphState.nodeGeometry.size).toBe(fixture.dedupMembershipCount);
    expect(used(guard)).toBe(fixture.dedupMembershipUsed);
  });

  it('preserves constructor cancellation identity', () => {
    const ctx = new WorkContext({ isCancelled: () => true });
    let thrown = null;
    try {
      newTransactionWithOptionsContext(new Graph(), ctx, {}, null);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe(fixture.constructorCancelError);
    expect(thrown.cause).toBe(ctx.Err());
    expect(fixture.constructorCanceled).toBe(true);
  });

  it('charges a long-distance neighbor requirement exactly once', () => {
    const graph = new Graph();
    const from = new Node(1n, 10, 10);
    const to = new Node(2n, 10, 10);
    graph.addNodeUnchecked(from);
    graph.addNodeUnchecked(to);
    const measure = (limit) => {
      const guard = new WorkGuard(bg, 'Slice44TransactionOracle', limit);
      const state = newGraphStateSnapshot({ CaptureTopology: true });
      try {
        state.updateWithWorkGuard(graph, guard);
        return [used(guard), null];
      } catch (err) {
        return [used(guard), err];
      }
    };
    const [baseline, baseErr] = measure(MAX_ENGINE_WORK_UNITS);
    expect(baseErr).toBeNull();
    expect(baseline).toBe(fixture.longDistanceBaseline);
    from.LongDistanceNeighborRequirements = new Map([[to, new LongDistanceNeighborRequirements(3, 100, 200)]]);
    const [withNeighbor, neighborErr] = measure(MAX_ENGINE_WORK_UNITS);
    expect(neighborErr).toBeNull();
    expect(withNeighbor).toBe(fixture.longDistanceWithNeighbor);
    const [, limitErr] = measure(withNeighbor - 1);
    expect(limitErr.message).toBe(fixture.longDistanceLimitError);
    const [exactUsed, exactErr] = measure(withNeighbor);
    expect(exactErr).toBeNull();
    expect(exactUsed).toBe(withNeighbor);
  });
});
