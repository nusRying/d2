// Slice 44 — transaction substrate behavior. Ports the pinned Go tests in
// internal/layoutgraph/transaction_test.go and transaction_resource_test.go
// that assert identity and error-classification contracts.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { Sequence } from '../../src/graph/sequence.js';
import { Tree } from '../../src/graph/tree.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { newGraphStateSnapshot, restoreGraphState } from '../../src/graph/graph-state.js';
import {
  Transaction,
  TransactionOptions,
  ErrInvalidCandidate,
  ErrNonImprovingCandidate,
  InvalidCandidateError,
  NonImprovingCandidateError,
  isCandidateRejection,
  newTransactionWithOptionsContext,
} from '../../src/graph/transaction.js';
import { WorkGuard, WorkLimitError, WorkCanceledError } from '../../src/limits/work-guard.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';

const bg = backgroundWorkContext();

function mustNewTransaction(g, options = {}) {
  const [txn, err] = newTransactionWithOptionsContext(g, bg, options, null);
  expect(err).toBeNull();
  return txn;
}

function placed(id, x, y, w = 10, h = 10) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  return n;
}

function cancellableContext() {
  let canceled = false;
  const ctx = new WorkContext({ isCancelled: () => canceled });
  ctx.cancel = () => {
    canceled = true;
  };
  return ctx;
}

describe('Slice 44 — transaction candidate errors', () => {
  it('classifies only candidate rejections (TestIsCandidateRejection)', () => {
    const arbitrary = new Error('arbitrary failure');
    expect(isCandidateRejection(null)).toBe(false);
    expect(isCandidateRejection(ErrInvalidCandidate)).toBe(true);
    expect(isCandidateRejection(new Error('candidate', { cause: ErrInvalidCandidate }))).toBe(true);
    expect(isCandidateRejection(ErrNonImprovingCandidate)).toBe(true);
    expect(isCandidateRejection(new Error('candidate', { cause: ErrNonImprovingCandidate }))).toBe(true);
    expect(isCandidateRejection(bg.Err())).toBe(false);
    const canceled = cancellableContext();
    canceled.cancel();
    expect(isCandidateRejection(canceled.Err())).toBe(false);
    expect(isCandidateRejection(arbitrary)).toBe(false);
    expect(ErrInvalidCandidate).toBeInstanceOf(InvalidCandidateError);
    expect(ErrNonImprovingCandidate).toBeInstanceOf(NonImprovingCandidateError);
  });

  it('never reports cancellation, resource, snapshot, refresh, or thrown failures as rejections', () => {
    // cancellation
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const ctx = cancellableContext();
    const [txn] = newTransactionWithOptionsContext(g, ctx, {}, null);
    txn.addOp(() => {
      n.TopLeft.X = 100;
      ctx.cancel();
      return null;
    });
    const cancelErr = txn.commit(ctx);
    expect(cancelErr).toBe(ctx.Err());
    expect(isCandidateRejection(cancelErr)).toBe(false);

    // resource exhaustion during Commit
    const limited = mustNewTransaction(g);
    limited._guard = new WorkGuard(bg, 'RejectionClassification', 0);
    let resourceErr = null;
    try {
      limited.commit(bg);
    } catch (err) {
      resourceErr = err;
    }
    expect(resourceErr).toBeInstanceOf(WorkLimitError);
    expect(isCandidateRejection(resourceErr)).toBe(false);

    // snapshot failure during construction
    let snapshotErr = null;
    try {
      newTransactionWithOptionsContext(g, bg, {}, new WorkGuard(bg, 'SnapshotFailure', 0));
    } catch (err) {
      snapshotErr = err;
    }
    expect(snapshotErr).toBeInstanceOf(WorkLimitError);
    expect(isCandidateRejection(snapshotErr)).toBe(false);

    // UpdateState failure
    const refreshed = mustNewTransaction(g);
    refreshed._guard = new WorkGuard(bg, 'RefreshFailure', 0);
    const refreshErr = refreshed.updateState();
    expect(refreshErr).toBeInstanceOf(WorkLimitError);
    expect(isCandidateRejection(refreshErr)).toBe(false);

    // arbitrary thrown exception
    const thrower = mustNewTransaction(g);
    const sentinel = { name: 'not an Error' };
    thrower.addOp(() => {
      throw sentinel;
    });
    let thrown = null;
    try {
      thrower.commit(bg);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(sentinel);
    expect(isCandidateRejection(thrown)).toBe(false);
  });

  it('rethrows a thrown candidate sentinel instead of converting it to a rejection', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    txn.addOp(() => {
      n.TopLeft.X = 50;
      throw ErrInvalidCandidate;
    });
    expect(() => txn.commit(bg)).toThrow(ErrInvalidCandidate);
    expect(n.TopLeft.X).toBe(1);
  });

  it('rejects misspelled transaction options instead of ignoring them', () => {
    expect(() => new TransactionOptions({ affectContainers: true })).toThrow(TypeError);
    expect(new TransactionOptions({ AffectContainers: true }).AffectContainers).toBe(true);
  });
});

describe('Slice 44 — transaction commit and rollback (pinned Go tests)', () => {
  it('observes a canceled context before running operations', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const ctx = cancellableContext();
    const txn = mustNewTransaction(g);
    ctx.cancel();
    let called = false;
    txn.addOp(() => {
      called = true;
      n.TopLeft.X = 100;
      return null;
    });
    expect(txn.commit(ctx)).toBe(ctx.Err());
    expect(called).toBe(false);
    expect(n.TopLeft.X).toBe(1);
  });

  it('rolls back when an operation cancels the context', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const ctx = cancellableContext();
    const txn = mustNewTransaction(g);
    let secondCalled = false;
    txn.addOp(() => {
      n.TopLeft.X = 100;
      ctx.cancel();
      return null;
    });
    txn.addOp(() => {
      secondCalled = true;
      return null;
    });
    expect(txn.commit(ctx)).toBe(ctx.Err());
    expect(secondCalled).toBe(false);
    expect(n.TopLeft.X).toBe(1);
  });

  it('restores TopLeft pointer identity (TestTransactionRollbackRestoresTopLeftPointerIdentity)', () => {
    const g = new Graph();
    const withPosition = new Node(1n, 10, 10);
    const originalTopLeft = new Point(1, 2);
    withPosition.TopLeft = originalTopLeft;
    const withoutPosition = new Node(2n, 10, 10);
    g.addNewNodeToContainer(null, withPosition);
    g.addNewNodeToContainer(null, withoutPosition);
    const txn = mustNewTransaction(g);
    const reject = new Error('reject');
    txn.addOp(() => {
      withPosition.TopLeft = new Point(100, 200);
      withoutPosition.TopLeft = new Point(300, 400);
      return reject;
    });
    expect(txn.commit(bg)).toBe(reject);
    expect(withPosition.TopLeft).toBe(originalTopLeft);
    expect(withPosition.TopLeft.X).toBe(1);
    expect(withPosition.TopLeft.Y).toBe(2);
    expect(withoutPosition.TopLeft).toBeNull();
  });

  it('restores Graph.Nodes identity and order after an operation replaces it', () => {
    const g = new Graph();
    const a = placed(1, 0, 0);
    const b = placed(2, 100, 0);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const nodesRef = g.Nodes;
    const txn = mustNewTransaction(g);
    const reject = new Error('reject');
    txn.addOp(() => {
      g.Nodes.reverse();
      g.Nodes = [b];
      return reject;
    });
    expect(txn.commit(bg)).toBe(reject);
    expect(g.Nodes).toBe(nodesRef);
    expect(g.Nodes).toEqual([a, b]);
  });

  it('restores cluster policy (TestTransactionRollbackRestoresClusterPolicy)', () => {
    const g = new Graph();
    const vessel = placed(1, 0, 0);
    g.addNewNodeToContainer(null, vessel);
    const members = [];
    const abductions = [];
    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: members,
      EdgeAbductions: abductions,
      Graph: g,
      Arrangement: ClusterArrangement.Row,
      DesiredArrangement: ClusterArrangement.Column,
      Padding: 12,
    });
    g.Clusters.set(vessel, cluster);
    const txn = mustNewTransaction(g);
    const reject = new Error('reject');
    txn.addOp(() => {
      cluster.Arrangement = ClusterArrangement.Column;
      cluster.DesiredArrangement = ClusterArrangement.Row;
      cluster.Padding = 99;
      return reject;
    });
    expect(txn.commit(bg)).toBe(reject);
    expect(cluster.Arrangement).toBe(ClusterArrangement.Row);
    expect(cluster.DesiredArrangement).toBe(ClusterArrangement.Column);
    expect(cluster.Padding).toBe(12);
    expect(cluster.Nodes).toBe(members);
    expect(cluster.EdgeAbductions).toBe(abductions);
  });

  it('restores edge routes and tree orientation (TestTransactionRollbackRestoresEdgeGeometryAndTreeOrientation)', () => {
    const g = new Graph();
    const a = placed(1, 0, 0);
    const b = placed(2, 20, 0);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = g.connect(a, b);
    edge.Points = [new Point(10, 5), new Point(20, 5)];
    const originalRoute = edge.Points;
    const originalFirstPoint = edge.Points[0];
    const originalSecondPoint = edge.Points[1];
    const tree = new Tree(a);
    tree.Orientation = Orientation.Right;
    g.Trees.set(a, [tree]);
    g.NodeToTree.set(a, tree);

    const txn = mustNewTransaction(g, { AffectEdgeRoutes: true });
    const reject = new Error('reject');
    txn.addOp(() => {
      originalFirstPoint.X = 999;
      edge.Points[0] = new Point(777, 888);
      edge.Points.push(new Point(500, 500));
      edge.Points = [...edge.Points, new Point(1, 1)];
      tree.Orientation = Orientation.Left;
      return reject;
    });
    expect(txn.commit(bg)).toBe(reject);
    expect(edge.Points).toBe(originalRoute);
    expect(edge.Points.length).toBe(2);
    expect(edge.Points[0]).toBe(originalFirstPoint);
    expect(edge.Points[1]).toBe(originalSecondPoint);
    expect(edge.Points[0].X).toBe(10);
    expect(tree.Orientation).toBe(Orientation.Right);
  });

  it('rolls back before rethrowing the original exception (TestTransactionCommitRollsBackBeforeRepanicking)', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    const sentinel = new Error('trial panic');
    let xDuringThrow = null;
    txn.addOp(() => {
      n.TopLeft.X = 100;
      xDuringThrow = n.TopLeft.X;
      throw sentinel;
    });
    let thrown = null;
    try {
      txn.commit(bg);
    } catch (err) {
      thrown = err;
    }
    expect(xDuringThrow).toBe(100);
    expect(thrown).toBe(sentinel);
    expect(n.TopLeft.X).toBe(1);
  });

  it('rolls back and rethrows a resource failure raised inside an operation', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const guard = new WorkGuard(bg, 'NestedOperationLimit', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const [txn] = g.newRequestTransaction(ctx, {});
    txn.addOp(() => {
      n.TopLeft.X = 100;
      guard.SetLimit(guard.Used());
      guard.Step();
      return null;
    });
    expect(() => txn.commit(ctx)).toThrow(WorkLimitError);
    expect(n.TopLeft.X).toBe(1);
  });
});

describe('Slice 44 — UpdateState rollback point', () => {
  it('advances the rollback point (TestTransactionUpdateStateAdvancesRollbackPoint)', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    txn.addOp(() => {
      n.TopLeft.X = 10;
      return null;
    });
    expect(txn.commit(bg)).toBeNull();
    txn.clear();
    expect(txn.updateState()).toBeNull();
    txn.addOp(() => {
      n.TopLeft.X = 100;
      return new Error('reject');
    });
    expect(txn.commit(bg)).toBeInstanceOf(Error);
    expect(n.TopLeft.X).toBe(10);
  });

  it('rolls back the accepted mutation when the refresh exhausts work (TestTransactionUpdateStateLimitRollsBackAcceptedMutation)', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    const originalTopLeft = new Point(1, 2);
    n.TopLeft = originalTopLeft;
    g.addNodeUnchecked(n);
    const txn = mustNewTransaction(g);
    const prior = txn.PriorGraphState;
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
    expect(err).toBeInstanceOf(WorkLimitError);
    expect(err.message).toBe('TALA TransactionUpdateStateTest work exceeds limit 1');
    expect(n.TopLeft).toBe(originalTopLeft);
    expect(n.TopLeft.X).toBe(1);
    expect(n.TopLeft.Y).toBe(2);
    // The previous rollback point stays valid and in place.
    expect(txn.PriorGraphState).toBe(prior);
  });

  it('rolls back on refresh cancellation with the guard cancellation identity', () => {
    const g = new Graph();
    const n = placed(1, 1, 2);
    const original = n.TopLeft;
    g.addNodeUnchecked(n);
    const ctx = cancellableContext();
    const [txn] = newTransactionWithOptionsContext(g, ctx, {}, null);
    txn.addOp(() => {
      n.TopLeft = new Point(5, 5);
      return null;
    });
    expect(txn.commit(ctx)).toBeNull();
    ctx.cancel();
    const err = txn.updateState();
    expect(err).toBeInstanceOf(WorkCanceledError);
    expect(err.cause).toBe(ctx.Err());
    expect(n.TopLeft).toBe(original);
  });

  it('keeps existing-overlap exceptions anchored to construction', () => {
    const g = new Graph();
    const a = placed(1, 0, 0, 20, 20);
    const b = placed(2, 5, 5, 20, 20);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const txn = mustNewTransaction(g);
    const overlaps = txn.PriorGraphState.existingOverlaps;
    const exact = txn.PriorGraphState.existingExactOverlaps;
    expect(overlaps.get(a).has(b)).toBe(true);
    txn.addOp(() => {
      a.TopLeft.X = -500;
      return null;
    });
    expect(txn.commit(bg)).toBeNull();
    txn.clear();
    expect(txn.updateState()).toBeNull();
    expect(txn.PriorGraphState.existingOverlaps).toBe(overlaps);
    expect(txn.PriorGraphState.existingExactOverlaps).toBe(exact);
  });

  it('recycles the spare GraphState and detaches a shared rollback point', () => {
    const g = new Graph();
    const n = placed(1, 0, 0);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    const first = txn.PriorGraphState;
    expect(txn.updateState()).toBeNull();
    const second = txn.PriorGraphState;
    expect(second).not.toBe(first);
    expect(txn.updateState()).toBeNull();
    // Unshared: the previous state is recycled as scratch.
    expect(txn.PriorGraphState).toBe(first);

    const [clone, cloneErr] = txn.cloneGeometryContext();
    expect(cloneErr).toBeNull();
    expect(clone.PriorGraphState).toBe(first);
    expect(clone.updateState()).toBeNull();
    // Shared: the clone allocates fresh state instead of recycling the shared one.
    expect(clone.PriorGraphState).not.toBe(first);
    expect(clone.PriorGraphState).not.toBe(second);
    expect(clone._spareGraphState).toBeNull();
    expect(txn.updateState()).toBeNull();
    expect(txn.PriorGraphState).not.toBe(first);
    expect(txn._spareGraphState).toBeNull();
  });

  it('PreservePriorGraphState pins the rollback point against recycling', () => {
    const g = new Graph();
    g.addNewNodeToContainer(null, placed(1, 0, 0));
    const txn = mustNewTransaction(g);
    const pinned = txn.PreservePriorGraphState();
    expect(txn.updateState()).toBeNull();
    expect(txn.updateState()).toBeNull();
    expect(txn.PriorGraphState).not.toBe(pinned);
  });

  it('reports zero original dimensions for untracked nodes', () => {
    const g = new Graph();
    const n = placed(1, 0, 0, 30, 40);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    expect(txn.originalDimensions(n)).toEqual([30, 40]);
    expect(txn.originalDimensions(placed(9, 0, 0, 7, 7))).toEqual([0, 0]);
  });
});

describe('Slice 44 — topology snapshots restore graph-owned identity', () => {
  it('restores Graph.Nodes, cluster/sequence arrays, and graph Maps by identity', () => {
    const g = new Graph();
    const vessel = placed(1, 0, 0);
    const member = placed(2, 0, 0);
    const seqVessel = placed(3, 100, 0);
    const step = placed(4, 100, 0);
    g.addNewNodeToContainer(null, vessel);
    g.addNewNodeToContainer(null, seqVessel);
    const edge = g.connect(vessel, seqVessel);
    const clusterNodes = [member];
    const clusterAbductions = [new EdgeAbduction({ Edge: edge, OriginallyFrom: member, CurrentFrom: vessel, CurrentTo: seqVessel })];
    const cluster = new Cluster({ Vessel: vessel, Nodes: clusterNodes, EdgeAbductions: clusterAbductions, Graph: g });
    const sequenceNodes = [step];
    const sequence = new Sequence({ Vessel: seqVessel, Nodes: sequenceNodes, EdgeAbductions: [], Graph: g });
    g.Clusters.set(vessel, cluster);
    g.Sequences.set(seqVessel, sequence);
    const nodesRef = g.Nodes;
    const clustersRef = g.Clusters;
    const sequencesRef = g.Sequences;
    const containersRef = g.Containers;

    const state = newGraphStateSnapshot({ CaptureTopology: true });
    state.updateWithWorkGuard(g, new WorkGuard(bg, 'TopologyIdentity', MAX_TRANSACTION_WORK_UNITS));

    g.Nodes.push(placed(9, 500, 500));
    g.Nodes = [];
    g.Clusters.delete(vessel);
    g.Clusters = new Map();
    g.Sequences = new Map();
    cluster.Nodes.push(placed(10, 0, 0));
    cluster.Nodes = [];
    cluster.EdgeAbductions = [];
    sequence.Nodes = [];

    restoreGraphState(g, state);
    expect(g.Nodes).toBe(nodesRef);
    expect(g.Nodes).toEqual([vessel, seqVessel]);
    expect(g.Clusters).toBe(clustersRef);
    expect(g.Clusters.get(vessel)).toBe(cluster);
    expect(g.Sequences).toBe(sequencesRef);
    expect(g.Containers).toBe(containersRef);
    expect(cluster.Nodes).toBe(clusterNodes);
    expect(cluster.Nodes).toEqual([member]);
    expect(cluster.EdgeAbductions).toBe(clusterAbductions);
    expect(sequence.Nodes).toBe(sequenceNodes);
  });
});

describe('Slice 44 — CloneGeometryContext', () => {
  it('shares the rollback point and the guard', () => {
    const g = new Graph();
    const n = placed(1, 0, 0);
    g.addNewNodeToContainer(null, n);
    const txn = mustNewTransaction(g);
    txn.addOp(() => null);
    const [clone, err] = txn.cloneGeometryContext();
    expect(err).toBeNull();
    expect(clone).toBeInstanceOf(Transaction);
    expect(clone.PriorGraphState).toBe(txn.PriorGraphState);
    expect(clone.guard).toBe(txn.guard);
    expect(clone.Ops).not.toBe(txn.Ops);
    expect(clone.Ops).toEqual(txn.Ops);
    n.TopLeft.X = 50;
    clone.rollback();
    expect(n.TopLeft.X).toBe(0);
  });

  it('refuses topology rollback points', () => {
    const g = new Graph();
    g.addNewNodeToContainer(null, placed(1, 0, 0));
    const txn = mustNewTransaction(g);
    txn.PriorGraphState.captureTopology = true;
    const [clone, err] = txn.cloneGeometryContext();
    expect(clone).toBeNull();
    expect(err.message).toBe('TALA topology transaction requires an independent clone');
  });
});
