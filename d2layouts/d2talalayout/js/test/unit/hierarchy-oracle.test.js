// Slice 46 — replay of internal/hierarchy/go_slice46_hierarchy_oracle_test.go.
// Every expected value (levels, geometry, membership, errors, exact work, and
// cancellation/rollback behavior) comes from pinned Go; scenarios are rebuilt
// from the Go-exported specs.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_OPTIMIZATION_WORK_UNITS, MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { hierarchyRankWeight } from '../../src/graph/structural-access.js';
import { assign, candidates, place, placeCompound, removeIsolatedMemberships } from '../../src/hierarchy/index.js';
import { rankDAG, rankDAGWithLimit } from '../../src/hierarchy/rank.js';
import { findCycleEdges, isHierarchyStructuralEdge, makeSimpleDAG } from '../../src/hierarchy/discovery.js';
import {
  breakLongConnections,
  connectPlacementNodes,
  createPlacementNodes,
  groupPlacementNodesByLevel,
} from '../../src/hierarchy/placement.js';
import {
  allDescendants,
  countCrossings,
  crossLevelSegments,
  initializeRanks,
  minimizeHierarchyCrossings,
} from '../../src/hierarchy/crossing.js';
import { globalSifting } from '../../src/hierarchy/sifting.js';
import {
  bg,
  buildSpec,
  capture,
  chainHas,
  countingContext,
  errorString,
  fixtureState,
  sameState,
  seededRand,
  stateOf,
} from './hierarchy-fixtures.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice46-hierarchy-reference.json'), 'utf8'),
);

const REQUIRED_GROUPS = [
  'simple DAG', 'multiple valid ranks', 'long edges', 'crossings', 'fixed hierarchy',
  'compound hierarchy', 'disconnected candidates', 'cycle handling', 'resource boundary',
  'cancellation probes', 'panic rollback', 'seeded determinism',
];

// ── Stage runners (mirror runStage / runRank) ────────────────────────────────

function runStage(stage, spec, seed, ctx, limit) {
  const b = buildSpec(spec);
  const g = b.g;
  if (stage === 'place') {
    assign(bg, g, null, candidates(g));
  }
  const pre = stateOf(b);
  const guard = new WorkGuard(bg, 'Slice46Oracle', BigInt(limit));
  const txCtx = contextWithTransactionWorkGuard(ctx, guard);
  let changed = false;
  const { err } = capture(() => {
    switch (stage) {
      case 'assign':
        assign(txCtx, g, null, candidates(g));
        break;
      case 'place':
      case 'placeOnly':
        place(txCtx, g, null, seededRand(seed));
        break;
      case 'compound':
        changed = placeCompound(txCtx, g, seededRand(seed));
        break;
      default:
        throw new Error(`unknown stage ${stage}`);
    }
  });
  return { b, pre, used: Number(guard.Used()), changed, err };
}

function runRank(spec, ctx, limit) {
  const b = buildSpec(spec);
  return capture(() => rankDAGWithLimit(ctx, b.g, BigInt(limit)));
}

// ── Case replays (mirror the Go case runners) ────────────────────────────────

function replayPipeline(c) {
  const b = buildSpec(c.spec);
  const cands = candidates(b.g);
  const ids = [...cands].map((n) => Number(n.ID)).sort((x, y) => x - y);
  expect(ids).toEqual(c.candidates ?? []);
  const errors = [];
  const states = [];
  errors.push(errorString(capture(() => assign(bg, b.g, null, candidates(b.g))).err));
  states.push(stateOf(b));
  errors.push(errorString(capture(() => place(bg, b.g, null, seededRand(c.seed))).err));
  states.push(stateOf(b));
  removeIsolatedMemberships(b.g);
  states.push(stateOf(b));
  expect(errors).toEqual(c.errors);
  expect(states).toEqual(c.states.map(fixtureState));
  return states;
}

function replayStage(c) {
  const run = runStage(c.stage, c.spec, c.seed, bg, MAX_TRANSACTION_WORK_UNITS);
  expect(errorString(run.err)).toBe(c.error ?? '');
  expect(run.changed).toBe(c.changed ?? false);
  expect([run.pre, stateOf(run.b)]).toEqual(c.states.map(fixtureState));
  expect(run.used).toBe(c.w ?? 0);
  if (run.used > 0) {
    const below = runStage(c.stage, c.spec, c.seed, bg, run.used - 1);
    expect(errorString(below.err)).toBe(c.belowErr ?? '');
    expect(sameState(below.pre, stateOf(below.b))).toBe(c.belowRestored ?? false);
  }
}

function findRankW(spec) {
  let lo = 0n;
  let hi = MAX_OPTIMIZATION_WORK_UNITS;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (runRank(spec, bg, mid).err == null) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}

function replayRank(c) {
  const b = buildSpec(c.spec);
  const { value: result, err } = capture(() => rankDAG(bg, b.g));
  expect(errorString(err)).toBe(c.error ?? '');
  if (err != null) return;
  const levels = [];
  for (const n of b.nodes) {
    if (result.nodeToLevel.has(n)) levels.push([Number(n.ID), result.nodeToLevel.get(n)]);
  }
  expect(levels).toEqual(c.levels ?? []);
  expect(result.levelCount).toBe(c.levelCount ?? 0);
  const w = findRankW(c.spec);
  expect(Number(w)).toBe(c.w ?? 0);
  if (w > 0n) {
    expect(errorString(runRank(c.spec, bg, w - 1n).err)).toBe(c.belowErr ?? '');
  }
}

function replaySimpleDAG(c) {
  {
    const b = buildSpec(c.spec);
    const { value: dag, err } = capture(() => makeSimpleDAG(bg, b.g));
    expect(errorString(err)).toBe(c.error ?? '');
    expect(dag.Nodes.map((n) => Number(n.ID))).toEqual(c.dagNodes ?? []);
    expect(dag.Edges.map((e) => [Number(e.From.ID), Number(e.To.ID), hierarchyRankWeight(e)])).toEqual(c.dagEdges ?? []);
  }
  {
    const b = buildSpec(c.spec);
    const dag = new Graph();
    const ids = new Map();
    for (const n of b.g.Nodes) {
      ids.set(n.ID, dag.addNodeUnchecked(new Node(n.ID, n.Width, n.Height)));
    }
    const connect = (from, to) => {
      const e = dag.connect(ids.get(from.ID), ids.get(to.ID));
      e.SourceArrowhead = 'none';
      e.TargetArrowhead = 'triangle';
      e.ID = BigInt(dag.Edges.length);
    };
    for (const e of b.g.Edges) {
      if (!isHierarchyStructuralEdge(e)) continue;
      if (e.isDirected()) {
        const [from, to] = e.directedEndpoints();
        connect(from, to);
      } else {
        connect(e.From, e.To);
        connect(e.To, e.From);
      }
    }
    const cycles = findCycleEdges(bg, dag);
    const out = [];
    for (const e of dag.Edges) {
      if (cycles.has(e)) out.push([Number(e.From.ID), Number(e.To.ID)]);
    }
    expect(out).toEqual(c.cycleEdges ?? []);
  }
}

function levelOrders(byLevel) {
  const out = [];
  for (let level = 0; level < byLevel.size; level++) {
    const row = [];
    for (const pn of allDescendants(byLevel.get(level) ?? [], false)) {
      row.push(pn.graphNode == null ? 0 : Number(pn.graphNode.ID), pn.rank);
    }
    out.push(row);
  }
  return out;
}

function levelCrossings(byLevel) {
  const out = [];
  for (let level = 0; level < byLevel.size; level++) {
    out.push(Number(countCrossings(crossLevelSegments(byLevel.get(level) ?? [], false, true))));
  }
  return out;
}

function replayOrder(c) {
  const b = buildSpec(c.spec);
  const pns = createPlacementNodes(b.g, b.g.Nodes, seededRand(c.seed));
  connectPlacementNodes(b.g, pns);
  const byLevel = groupPlacementNodesByLevel(pns);
  initializeRanks(byLevel);
  breakLongConnections(pns, byLevel);
  const orders = [levelOrders(byLevel)];
  const crossings = [...levelCrossings(byLevel)];
  minimizeHierarchyCrossings(byLevel);
  orders.push(levelOrders(byLevel));
  crossings.push(...levelCrossings(byLevel));
  const { err } = capture(() => globalSifting(byLevel));
  orders.push(levelOrders(byLevel));
  crossings.push(...levelCrossings(byLevel));
  expect(errorString(err)).toBe(c.error ?? '');
  expect(orders).toEqual(c.orders);
  expect(crossings).toEqual(c.crossings);
}

function replayProbes(c) {
  const count = countingContext();
  if (c.stage === 'rank') {
    expect(runRank(c.spec, count, MAX_OPTIMIZATION_WORK_UNITS).err).toBeNull();
  } else {
    expect(runStage(c.stage, c.spec, c.seed, count, MAX_TRANSACTION_WORK_UNITS).err).toBeNull();
  }
  expect(count.calls).toBe(c.calls);
  const probes = [];
  for (let cancelAt = 1; cancelAt <= c.calls + 1; cancelAt += c.stride) {
    const ctx = countingContext(cancelAt);
    if (c.stage === 'rank') {
      const { err } = runRank(c.spec, ctx, MAX_OPTIMIZATION_WORK_UNITS);
      probes.push({ cancelAt, error: errorString(err), canceled: chainHas(err, ctx.canceled), restored: true });
      continue;
    }
    const run = runStage(c.stage, c.spec, c.seed, ctx, MAX_TRANSACTION_WORK_UNITS);
    probes.push({
      cancelAt,
      error: errorString(run.err),
      canceled: chainHas(run.err, ctx.canceled),
      restored: sameState(run.pre, stateOf(run.b)),
    });
  }
  expect(probes).toEqual(c.probes);
}

function replayPanic(c) {
  const ctx = countingContext(0, c.panicAt);
  const b = buildSpec(c.spec);
  const g = b.g;
  if (c.stage === 'place') {
    assign(bg, g, null, candidates(g));
  }
  const pre = stateOf(b);
  const { err } = capture(() => {
    switch (c.stage) {
      case 'assign':
        assign(ctx, g, null, candidates(g));
        break;
      case 'place':
        place(ctx, g, null, seededRand(c.seed));
        break;
      case 'compound':
        placeCompound(ctx, g, seededRand(c.seed));
        break;
      default:
        throw new Error(`unknown stage ${c.stage}`);
    }
  });
  expect(errorString(err)).toBe(c.panic);
  expect(sameState(pre, stateOf(b))).toBe(c.restored ?? false);
}

const REPLAY = {
  pipeline: replayPipeline,
  stage: replayStage,
  rank: replayRank,
  simpleDAG: replaySimpleDAG,
  order: replayOrder,
  probes: replayProbes,
  panic: replayPanic,
};

describe('Slice 46 hierarchy Go oracle', () => {
  it('contains every required group', () => {
    for (const name of REQUIRED_GROUPS) {
      expect(fixture.groups[name]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  for (const [group, cases] of Object.entries(fixture.groups)) {
    describe(group, () => {
      for (const c of cases) {
        it(`${c.op} ${c.name}`, () => {
          const replay = REPLAY[c.op];
          expect(replay).toBeDefined();
          replay(c);
        });
      }
    });
  }

  it('seeded runs are deterministic in JS (run twice)', () => {
    for (const c of fixture.groups['seeded determinism']) {
      if (c.op === 'pipeline') {
        const first = replayPipeline(c);
        const second = replayPipeline(c);
        expect(second).toEqual(first);
      } else {
        replayOrder(c);
        replayOrder(c);
      }
    }
  });
});
