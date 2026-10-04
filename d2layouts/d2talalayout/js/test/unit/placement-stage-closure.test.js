// Slice 45 — dependency-closed placement stages. Ports
// internal/placement/gap_normalization_atomicity_test.go and the NormalizeGaps
// cases of gapreduction_test.go, plus TransposeAll and Normalize/Pad checks.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { WorkContext } from '../../src/limits/work-context.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { IDEAL_GAP_SIZE } from '../../src/placementcost/geometry.js';
import { normalizeGaps, transposeAll } from '../../src/placement/placement-stages.js';
import { normalize, pad, PLACEMENT_PADDING } from '../../src/placement/stage-geometry.js';
import { bg, capture, chainHas } from './sized-optimizer-fixtures.js';

const CACHE_SENTINEL = 0x6e6f726d67617073n;
const CANCELED = new Error('context canceled');

function placed(g, id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.addNode(n);
  return n;
}

// newNormalizeGapsAtomicityGraph
function atomicityGraph(extra = 0) {
  const g = new Graph();
  const a = placed(g, 1, 10, 10, 0, 0);
  const b = placed(g, 2, 10, 10, 1000, 0);
  g.connect(a, b);
  g.storeEdgeLengthCost(CACHE_SENTINEL, 17);
  for (let i = 0; i < extra; i++) g.storeEdgeLengthCost(CACHE_SENTINEL + BigInt(i) + 1n, i);
  g.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
  return { g, moving: b };
}

// newNormalizeGapsNoScoreBeforeScoreGraph
function noScoreBeforeScoreGraph() {
  const g = new Graph();
  const moving = placed(g, 1, 10, 10, 1000, 0);
  const anchor = placed(g, 2, 10, 10, 0, 0);
  g.connect(anchor, moving);
  g.storeEdgeLengthCost(CACHE_SENTINEL, 17);
  g.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
  return { g, moving };
}

function captureStage(g) {
  const nodes = g.Nodes.map((n) => ({ n, pointer: n.TopLeft, x: n.TopLeft.X, y: n.TopLeft.Y, w: n.Width, h: n.Height }));
  const cacheCount = g.edgeLengthCacheEntries();
  const cache = [];
  for (let i = 0; i < cacheCount; i++) cache.push(g.lookupEdgeLengthCost(CACHE_SENTINEL + BigInt(i)));
  return {
    cellSize: g.CellSize,
    routeCosts: g.routingCosts(),
    assertRestored() {
      for (const want of nodes) {
        expect(want.n.TopLeft).toBe(want.pointer);
        expect([want.n.TopLeft.X, want.n.TopLeft.Y, want.n.Width, want.n.Height]).toEqual([want.x, want.y, want.w, want.h]);
      }
      expect(g.CellSize).toBe(this.cellSize);
      expect(g.routingCosts()).toEqual(this.routeCosts);
      expect(g.edgeLengthCacheEntries()).toBe(cacheCount);
      for (let i = 0; i < cacheCount; i++) expect(g.lookupEdgeLengthCost(CACHE_SENTINEL + BigInt(i))).toEqual(cache[i]);
    },
  };
}

function stack() {
  return new Error().stack;
}

function afterCommitContext(moving, original, onHit) {
  return {
    observed: false,
    Err() {
      if (moving.TopLeft == null || (moving.TopLeft.X === original.X && moving.TopLeft.Y === original.Y)) return null;
      const s = stack();
      if (s.includes('CloneGeometryContext') && !s.includes('reduceGapToNeighbors')) {
        this.observed = true;
        return onHit();
      }
      return null;
    },
  };
}

describe('Slice 45 — NormalizeGaps stage atomicity (pinned Go tests)', () => {
  it('restores the stage on cancellation after a commit (TestNormalizeGapsCancellationAfterCommitRestoresStage)', () => {
    const { g, moving } = atomicityGraph();
    const snapshot = captureStage(g);
    const ctx = afterCommitContext(moving, { X: 1000, Y: 0 }, () => CANCELED);
    const result = capture(() => normalizeGaps(ctx, g));
    expect(result.value).toBeUndefined();
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(ctx.observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores the stage after a no-score commit (TestNormalizeGapsCancellationAfterNoScoreCommitRestoresStage)', () => {
    const { g, moving } = noScoreBeforeScoreGraph();
    const snapshot = captureStage(g);
    const ctx = afterCommitContext(moving, { X: 1000, Y: 0 }, () => CANCELED);
    const result = capture(() => normalizeGaps(ctx, g));
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(ctx.observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores the stage before rethrowing a throw (TestNormalizeGapsPanicAfterCommitRestoresStage)', () => {
    const { g, moving } = atomicityGraph();
    const snapshot = captureStage(g);
    const sentinel = { name: 'NormalizeGaps panic' };
    const ctx = afterCommitContext(moving, { X: 1000, Y: 0 }, () => {
      throw sentinel;
    });
    const result = capture(() => normalizeGaps(ctx, g));
    expect(result.err).toBe(sentinel);
    expect(ctx.observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores no-score state at the final poll (TestNormalizeGapsFinalPollRestoresNoScoreState)', () => {
    const g = new Graph();
    g.storeEdgeLengthCost(CACHE_SENTINEL, 17);
    g.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
    const snapshot = captureStage(g);
    let observed = false;
    const ctx = {
      Err() {
        if (g.routingCosts().Turn !== 5 && stack().includes('normalizeGaps')) {
          observed = true;
          return CANCELED;
        }
        return null;
      },
    };
    const result = capture(() => normalizeGaps(ctx, g));
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('commits a successful stage (TestNormalizeGapsSuccessCommitsStage)', () => {
    const { g, moving } = atomicityGraph();
    const pointer = moving.TopLeft;
    expect(normalizeGaps(bg, g)).toBe(true);
    expect(moving.TopLeft).toBe(pointer);
    expect(moving.TopLeft.X).toBe(0 + 10 + IDEAL_GAP_SIZE);
    expect(g.CellSize).toBe(10);
  });

  it('charges the placement-cost snapshot once (TestNormalizeGapsChargesPlacementCostSnapshotOnce)', () => {
    const noScore = (extra) => {
      const g = new Graph();
      for (let i = 0; i < extra; i++) g.storeEdgeLengthCost(CACHE_SENTINEL + BigInt(i), i);
      const guard = new WorkGuard(bg, 'NormalizeGapsNoScoreCacheCharge', MAX_TRANSACTION_WORK_UNITS);
      expect(normalizeGaps(contextWithTransactionWorkGuard(bg, guard), g)).toBe(false);
      return Number(guard.Used());
    };
    expect(noScore(8)).toBe(noScore(0));
    const scored = (extra) => {
      const { g } = atomicityGraph(extra);
      const guard = new WorkGuard(bg, 'NormalizeGapsCacheCharge', MAX_TRANSACTION_WORK_UNITS);
      expect(normalizeGaps(contextWithTransactionWorkGuard(bg, guard), g)).toBe(true);
      return Number(guard.Used());
    };
    const withoutExtra = scored(0);
    const withExtra = scored(8);
    expect(withExtra - withoutExtra).toBe(8);

    const { g } = atomicityGraph(8);
    const snapshot = captureStage(g);
    const guard = new WorkGuard(bg, 'NormalizeGapsCacheCharge', MAX_TRANSACTION_WORK_UNITS);
    guard.SetLimit(withExtra - 1);
    const result = capture(() => normalizeGaps(contextWithTransactionWorkGuard(bg, guard), g));
    expect(result.value).toBeUndefined();
    expect(result.err).toBeInstanceOf(Error);
    expect(Number(guard.Used())).toBe(withExtra);
    snapshot.assertRestored();
  });

  it('preserves context and graph preflight order (TestNormalizeGapsPreservesContextAndGraphPreflightOrder)', () => {
    expect(normalizeGaps(bg, new Graph())).toBe(false);
    expect(() => normalizeGaps(null, null)).toThrow('requires a context');
    const canceled = new WorkContext({ isCancelled: () => true });
    const result = capture(() => normalizeGaps(canceled, null));
    expect(chainHas(result.err, canceled.Err())).toBe(true);
    expect(() => normalizeGaps(bg, null)).toThrow('transaction graph is nil');
  });
});

describe('Slice 45 — NormalizeGaps with containers (pinned Go tests)', () => {
  it('keeps children inside the container (TestGapNormalizationWithContainer)', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 100, 100, 100);
    const b = placed(g, 2, 10, 10, 1000, 100);
    const c = placed(g, 3, 2000, 3000, 0, 0);
    g.connect(a, b);
    g.Containers = new Map([[null, [c]], [c, [a, b]]]);
    normalizeGaps(bg, g);
    expect([a.TopLeft.X, a.TopLeft.Y]).toEqual([100, 100]);
    expect(b.TopLeft.X).toBe(a.TopLeft.X + a.Width + IDEAL_GAP_SIZE);
    expect([c.TopLeft.X, c.TopLeft.Y, c.Width, c.Height]).toEqual([0, 0, 2000, 3000]);
    expect(c.covers(a)).toBe(true);
    expect(c.covers(b)).toBe(true);
  });

  it('does not push a sibling into an expanded container (TestGapContainerExpansionPushing)', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 100, 100);
    const b = placed(g, 2, 30, 30, 90, 90);
    const c = placed(g, 3, 10, 10, 130, 90);
    g.Containers = new Map([[null, [b, c]], [b, [a]]]);
    normalizeGaps(bg, g);
    const overlaps = c.TopLeft.X >= b.TopLeft.X && c.TopLeft.X <= b.TopLeft.X + b.Width;
    expect(overlaps).toBe(false);
  });
});

describe('Slice 45 — TransposeAll', () => {
  function chainGraph() {
    const g = new Graph();
    const add = (id, x, y) => {
      const n = new Node(BigInt(id), 40, 40);
      n.TopLeft = new Point(x, y);
      g.addNewNodeToContainer(null, n);
      return n;
    };
    const hub = add(1, 200, 200);
    const right = add(2, 400, 200);
    const down = add(3, 200, 400);
    const left = add(4, 0, 200);
    const tailHead = add(5, 400, 350);
    const tail = add(6, 400, 500);
    g.connect(hub, right);
    g.connect(hub, down);
    g.connect(hub, left);
    g.connect(right, tailHead);
    g.connect(tailHead, tail);
    return g;
  }

  it('computes CellSize and charges every transpose to the shared guard', () => {
    const g = chainGraph();
    g.CellSize = 0;
    const guard = new WorkGuard(bg, 'TransposeAllShared', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const guards = new Set();
    const original = g.newRequestTransaction.bind(g);
    g.newRequestTransaction = (txCtx, options) => {
      const created = original(txCtx, options);
      guards.add(created[0].guard);
      return created;
    };
    transposeAll(ctx, g);
    expect(g.CellSize).toBeGreaterThan(0);
    expect([...guards]).toEqual([guard]);
    // Exact source-order geometry and work are pinned by the Go oracle
    // (sized-optimizer-oracle.test.js, transpose-all stages).
  });

  it('propagates the first real error', () => {
    const g = chainGraph();
    const ctx = new WorkContext({ isCancelled: () => true });
    const result = capture(() => transposeAll(ctx, g));
    expect(result.err.message).toBe('TransposeStageTransactions: context canceled');
  });
});

describe('Slice 45 — Normalize and Pad (existing Slice 40 ports)', () => {
  it('normalizes by node, route point, and label minima, then pads', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 50, 70);
    const b = placed(g, 2, 10, 10, 200, 90);
    const e = g.connect(a, b);
    e.Points = [new Point(40.5, 80), new Point(210, 65.2)];
    normalize(g);
    expect([a.TopLeft.X, a.TopLeft.Y]).toEqual([10, 5]);
    expect([e.Points[0].X, e.Points[1].Y]).toEqual([0.5, 0.20000000000000284]);
    pad(g);
    expect([a.TopLeft.X, a.TopLeft.Y]).toEqual([10 + PLACEMENT_PADDING, 5 + PLACEMENT_PADDING]);
  });
});
