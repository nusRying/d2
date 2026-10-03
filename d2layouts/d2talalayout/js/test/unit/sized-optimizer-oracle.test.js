// Slice 45 — replay of internal/placement/go_slice45_sized_optimizer_oracle_test.go.
// Every expected value (geometry, RNG state, errors, and exact work) comes
// from pinned Go; scenarios are rebuilt from Go-exported specs.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Edge } from '../../src/graph/edge.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { OptimizationWorkGuard, shuffle } from '../../src/limits/optimization.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_OPTIMIZATION_WORK_UNITS, MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { iterPlacementsAroundPoint, newSizedOptimizer } from '../../src/placement/sized-optimizer.js';
import { normalizeGaps, transposeAll } from '../../src/placement/placement-stages.js';
import {
  bg,
  buildSpec,
  capture,
  chainHas,
  countingContext,
  errorString,
  fixtureState,
  geomOf,
  newOptimizer,
  pointers,
  stateOf,
} from './sized-optimizer-fixtures.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice45-sized-optimizer-reference.json'), 'utf8'),
);

function used(guard) {
  return Number(guard.Used());
}

function expectSamePointers(built, saved) {
  built.tracked.forEach((n, i) => expect(n.TopLeft).toBe(saved[i]));
}

function flat(points) {
  return points.flatMap((p) => [p.X, p.Y]);
}

// ── Component replays (mirror the Go component closures) ─────────────────────

const COMPONENTS = {
  median(o, n, g, c) {
    const temp = c.args[0];
    const children = o.protrudingChildrenGuarded(n, g);
    const p = o.medianPointGuarded(n, temp, children, g);
    return { args: [temp, children.length], result: [p.X, p.Y] };
  },
  closest(o, n, g, c) {
    o.rebuildSpatialIndex(g);
    const checked = c.cached ? new Map() : null;
    const d = o.findClosestUnoccupiedDistanceGuarded(n, new Point(c.args[0], c.args[1]), c.self, checked, g);
    return { args: c.args, result: [d, checked == null ? 0 : checked.size] };
  },
  occupied(o, n, g) {
    o.rebuildSpatialIndex(g);
    const p = new Point(100, 100);
    const result = [];
    for (let x = -150; x <= 150; x += 25) {
      for (let y = -150; y <= 150; y += 25) {
        const occ = o.isPointOccupiedGuarded(x, y, p, n, g);
        const free = o.findUnoccupiedGuarded(x, y, n.Width, n.Height, true, n, p, null, g);
        result.push((occ ? 1 : 0) + (free ? 2 : 0));
      }
    }
    return { result };
  },
  points(o, n, g, c) {
    const scratch = { seen: null, points: null };
    const median = new Point(c.args[0], c.args[1]);
    o.fillPlacementPointsGuarded(n, median, c.args[2], c.self, scratch, g);
    const points = o.fillPlacementPointsGuarded(n, median, c.args[2], c.self, scratch, g);
    const before = flat(points);
    shuffle(points, o.randGenerator, g);
    return { args: c.args, points: before, result: flat(points) };
  },
  move(o, n, g, c) {
    o.rebuildSpatialIndex(g);
    const pts = [];
    for (let i = 0; i + 1 < c.points.length; i += 2) pts.push(new Point(c.points[i], c.points[i + 1]));
    const outcome = c.out;
    outcome.points = c.points;
    outcome.changed = false;
    try {
      outcome.changed = o.moveNodeToBestGuarded(bg, n, pts, c.mustImprove, g);
    } finally {
      outcome.result = [n.TopLeft.X, n.TopLeft.Y];
    }
    return outcome;
  },
  swap(o, n, g, c) {
    if (c.cell) o.g.CellSize = c.cell;
    if (c.moveTo) n.TopLeft = new Point(c.moveTo[0], c.moveTo[1]);
    o.rebuildSpatialIndex(g);
    const candidate = o.bestSwapCandidateGuarded(bg, n, g);
    return { resultId: candidate == null ? 0 : Number(candidate.ID) };
  },
};

// name -> [kind, extra parameters not carried by the fixture]
const COMPONENT_KINDS = {
  'median-star': ['median', { args: [0] }],
  'median-temp': ['median', { args: [1.5] }],
  'median-fixed-origin': ['median', { args: [2] }],
  'median-protruding': ['median', { args: [0.5] }],
  'closest-self': ['closest', { self: true, cached: false }],
  'closest-center': ['closest', { self: true, cached: false }],
  'closest-n4': ['closest', { self: true, cached: true }],
  'closest-not-self': ['closest', { self: false, cached: true }],
  'closest-fixed-origin': ['closest', { self: true, cached: true }],
  'occupied-grid': ['occupied', {}],
  'points-star': ['points', { self: true }],
  'points-negative': ['points', { self: true }],
  'points-not-self': ['points', { self: false }],
  'points-long-distance': ['points', { self: true }],
  'points-herd': ['points', { self: true }],
  'points-fixed-origin': ['points', { self: true }],
  'move-stay': ['move', { mustImprove: false }],
  'move-best': ['move', { mustImprove: false }],
  'move-tie-current': ['move', { mustImprove: true }],
  'move-must-improve': ['move', { mustImprove: true }],
  'move-no-placement': ['move', { mustImprove: false }],
  'move-obstacle': ['move', { mustImprove: false }],
  'move-cluster': ['move', { mustImprove: false }],
  'swap-none': ['swap', {}],
  'swap-n3': ['swap', { cell: 100, moveTo: [400, 100] }],
};

function runComponent(c, limit) {
  const [kind, extra] = COMPONENT_KINDS[c.name];
  // Throwing components (e.g. move-no-placement) record into `out` first.
  const out = {};
  const params = { ...extra, args: c.args ?? extra.args, points: c.points, out };
  const built = buildSpec(c.spec);
  const { optim, rand } = newOptimizer(built, c.seed);
  const guard = new OptimizationWorkGuard(bg, 'LocalOptimize', limit);
  let outcome = out;
  const result = capture(() => {
    outcome = COMPONENTS[kind](optim, built.nodes.get(c.node), guard, params) ?? out;
  });
  return { built, rand, guard, err: result.err, outcome };
}

describe('Slice 45 — sized optimizer Go oracle replay', () => {
  it('replays iterPlacementsAroundPoint order, early stop, and minimizingSelf=false', () => {
    const g = new Graph();
    const node = new Node(1n, 10, 10);
    g.addNodeUnchecked(node);
    g.CellSize = 2;
    const cases = [[5, 5, true, -1], [5, 5, false, -1], [-3, 2, true, 7], [0, -4, true, -1]];
    cases.forEach(([x, y, self, stopAt], i) => {
      const points = [];
      iterPlacementsAroundPoint(node, x, y, self, (px, py) => {
        points.push(px, py);
        return stopAt >= 0 && points.length / 2 === stopAt;
      });
      expect(points).toEqual(fixture.iterPlacements[i] ?? []);
    });
  });

  it('replays setup validation, long-distance requirements, fixed origin, and setup cancellation', () => {
    const builders = {
      'parallel-edges': () => {
        const spec = { cellSize: 100, nodes: [
          { id: 1, w: 50, h: 50, placed: true, x: 0, y: 0 }, { id: 2, w: 50, h: 50, placed: true, x: 100, y: 0 },
        ], edges: [] };
        for (let i = 0; i < 256; i++) spec.edges.push({ from: 1, to: 2, minWidth: 5000, minHeight: 6000 });
        return buildSpec(spec);
      },
      'below-threshold': () => buildSpec({ cellSize: 100, nodes: [
        { id: 1, w: 50, h: 50, placed: true, x: 0, y: 0 }, { id: 2, w: 50, h: 50, placed: true, x: 300, y: 0 },
      ], edges: [{ from: 1, to: 2, minWidth: 100 }, { from: 1, to: 2, minWidth: 100 }, { from: 1, to: 2, minHeight: 100 }, { from: 1, to: 2, minWidth: 2 }] }),
      featured: () => buildSpec(fixture.runs.find((r) => r.name === 'featured-temp0').spec),
      'cluster-abductions': () => buildSpec({ cluster: true }),
      'fixed-root': () => buildSpec({ cellSize: 10, nodes: [
        { id: 1, w: 400, h: 400, placed: true, x: 0, y: 0 },
        { id: 2, w: 40, h: 40, placed: true, x: 100, y: 100, container: 1, fixed: true, fx: 60, fy: 70 },
        { id: 3, w: 40, h: 40, placed: true, x: 200, y: 200, container: 1 },
      ], edges: [{ from: 2, to: 3 }], root: 1 }),
    };
    const simple = () => buildSpec(fixture.runs.find((r) => r.name === 'simple-temp0').spec);
    const mutations = {
      'cell-zero': (b) => { b.g.CellSize = 0; },
      'cell-fraction': (b) => { b.g.CellSize = 10.5; },
      'cell-nan': (b) => { b.g.CellSize = NaN; },
      'cell-inf': (b) => { b.g.CellSize = Infinity; },
      'graphless-node': (b) => { b.g.Nodes[1].Graph = null; },
      'cell-mismatch': (b) => { const other = new Graph(); other.CellSize = 7; b.g.Nodes[1].Graph = other; },
      'nil-abduction': (b) => { b.abductions = [null]; },
      'malformed-edge': (b) => { b.g.Nodes[0].Edges.push(new Edge(b.g.Nodes[1], b.g.Nodes[2])); },
    };
    for (const name of Object.keys(mutations)) {
      builders[name] = () => {
        const b = simple();
        mutations[name](b);
        return b;
      };
    }
    expect(fixture.setup.map((s) => s.name).sort()).toEqual(Object.keys(builders).sort());
    for (const want of fixture.setup) {
      const b = builders[want.name]();
      const result = capture(() => newSizedOptimizer(bg, b.g, b.root, b.abductions, new GoRand(1), b.obstacles));
      expect(errorString(result.err)).toBe(want.error);
      if (result.err != null) continue;
      const requirements = [];
      for (const n of b.g.Nodes) {
        const reqs = n.LongDistanceNeighborRequirements;
        if (reqs == null) continue;
        for (const other of b.g.Nodes) {
          const r = reqs.get(other);
          if (r !== undefined) requirements.push([Number(n.ID), Number(other.ID), r.EdgeCount, r.MaxWidth, r.MaxHeight]);
        }
      }
      expect(requirements).toEqual(want.requirements ?? []);
      const fo = result.value.fixedOrigin;
      expect(fo == null ? undefined : [fo.X, fo.Y]).toEqual(want.fixedOrigin);

      const count = countingContext();
      const b2 = builders[want.name]();
      newSizedOptimizer(count, b2.g, b2.root, b2.abductions, new GoRand(1), b2.obstacles);
      expect(count.calls).toBe(want.setupCalls);
      for (const probe of want.probes ?? []) {
        const b3 = builders[want.name]();
        const ctx = countingContext(probe.cancelAt);
        const r = capture(() => newSizedOptimizer(ctx, b3.g, b3.root, b3.abductions, new GoRand(1), b3.obstacles));
        expect(r.value).toBeUndefined();
        expect(errorString(r.err)).toBe(probe.error);
        expect(chainHas(r.err, ctx.canceled)).toBe(probe.canceled);
      }
    }
  });

  it('replays every component with exact results, RNG state, and W / W-1 work', () => {
    for (const c of fixture.components) {
      const { built, rand, guard, err, outcome } = runComponent(c, MAX_OPTIMIZATION_WORK_UNITS);
      expect(errorString(err)).toBe(c.error);
      expect(used(guard)).toBe(c.used);
      if (c.result !== undefined) expect(outcome.result).toEqual(c.result);
      if (c.points !== undefined && COMPONENT_KINDS[c.name][0] === 'points') expect(outcome.points).toEqual(c.points);
      expect(outcome.resultId ?? 0).toBe(c.resultId ?? 0);
      expect(outcome.changed ?? false).toBe(c.changed ?? false);
      expect(String(rand.Int63())).toBe(c.randNext);
      expect(fixtureState(stateOf(built))).toEqual(c.state);
      if (c.used > 0) {
        const below = runComponent(c, c.used - 1);
        expect(errorString(below.err)).toBe(c.belowErr);
      }
    }
  });

  it('replays full optimizer runs, deterministic repeats, and W / W-1 rollback', () => {
    for (const run of fixture.runs) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const built = buildSpec(run.spec);
        const { optim, rand } = newOptimizer(built, run.seed);
        const changed = [];
        const states = [];
        for (const temp of run.temps) {
          changed.push(optim.optimize(bg, temp));
          states.push(fixtureState(stateOf(built)));
        }
        expect(changed).toEqual(run.changed);
        expect(states).toEqual(run.states);
        expect(String(rand.Int63())).toBe(run.randNext);
      }
      if (run.w > 0) {
        const atW = buildSpec(run.spec);
        expect(newOptimizer(atW, run.seed).optim.optimizeWithLimit(bg, run.temps[0], run.w)).toBe(run.changed[0]);
        expect(fixtureState(stateOf(atW))).toEqual(run.states[0]);

        const below = buildSpec(run.spec);
        const initial = fixtureState(stateOf(below));
        const saved = pointers(below);
        const { optim } = newOptimizer(below, run.seed);
        const result = capture(() => optim.optimizeWithLimit(bg, run.temps[0], run.w - 1));
        expect(errorString(result.err)).toBe(run.belowErr);
        expect(run.restored).toBe(true);
        expect(fixtureState(stateOf(below))).toEqual(initial);
        expectSamePointers(below, saved);
      }
    }
  });

  it('cancels at every (strided) context checkpoint of full runs with exact rollback', () => {
    for (const set of fixture.probes) {
      {
        const built = buildSpec(set.spec);
        const count = countingContext();
        newOptimizer(built, set.seed).optim.optimize(count, set.temp);
        expect(count.calls).toBe(set.calls);
      }
      for (const probe of set.probes) {
        const built = buildSpec(set.spec);
        const initial = fixtureState(stateOf(built));
        const saved = pointers(built);
        const { optim } = newOptimizer(built, set.seed);
        const ctx = countingContext(probe.cancelAt);
        const result = capture(() => optim.optimize(ctx, set.temp));
        expect(errorString(result.err)).toBe(probe.error);
        expect(chainHas(result.err, ctx.canceled)).toBe(probe.canceled);
        expect(probe.restored).toBe(true);
        expect(fixtureState(stateOf(built))).toEqual(initial);
        expectSamePointers(built, saved);
      }
    }
  });

  it('rolls back and rethrows the same value thrown after a trial mutation', () => {
    const cases = [
      [fixture.runs.find((r) => r.name === 'simple-temp0'), 0],
      [fixture.runs.find((r) => r.name === 'featured-temp1'), 1],
    ];
    cases.forEach(([run, temp], i) => {
      const built = buildSpec(run.spec);
      const initial = fixtureState(stateOf(built));
      const saved = built.tracked.map((n) => [n.TopLeft, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height]);
      const sentinel = { name: 'optimizer mutation observer' };
      let observed = false;
      const ctx = {
        Err() {
          for (const [ptr, x, y, w, h] of saved) {
            const n = built.tracked[saved.findIndex((s) => s[0] === ptr)];
            if (n.TopLeft !== ptr || n.TopLeft.X !== x || n.TopLeft.Y !== y || n.Width !== w || n.Height !== h) {
              observed = true;
              throw sentinel;
            }
          }
          return null;
        },
      };
      const { optim } = newOptimizer(built, run.seed);
      const result = capture(() => optim.optimize(ctx, temp));
      expect(result.err).toBe(sentinel);
      expect(observed).toBe(fixture.panicRollback[i].canceled);
      expect(fixture.panicRollback[i].restored).toBe(true);
      expect(fixtureState(stateOf(built))).toEqual(initial);
      saved.forEach(([ptr], j) => expect(built.tracked[j].TopLeft).toBe(ptr));
    });
  });
});

describe('Slice 45 — placement stage closure Go oracle replay', () => {
  const stages = {
    'normalize-gaps': (ctx, g) => normalizeGaps(ctx, g),
    'transpose-all': (ctx, g) => {
      transposeAll(ctx, g);
      return false;
    },
  };
  const stageFn = (name) => stages[name.startsWith('transpose-all') ? 'transpose-all' : 'normalize-gaps'];
  const runStage = (st, ctx, limit) => {
    const built = buildSpec(st.spec);
    const guard = new WorkGuard(bg, 'Slice45StageOracle', limit);
    const result = capture(() => stageFn(st.name)(contextWithTransactionWorkGuard(ctx, guard), built.g));
    return { built, guard, ...result };
  };

  it('replays NormalizeGaps and TransposeAll outcomes, work, sweeps, and probes', () => {
    for (const st of fixture.stages) {
      const full = runStage(st, bg, MAX_TRANSACTION_WORK_UNITS);
      expect(errorString(full.err)).toBe(st.error);
      expect(full.value ?? false).toBe(st.changed);
      expect(used(full.guard)).toBe(st.used);
      expect(fixtureState(stateOf(full.built))).toEqual(st.state);

      for (const point of st.sweep ?? []) {
        const r = runStage(st, bg, point.limit);
        const initial = fixtureState(stateOf(buildSpec(st.spec)));
        expect(errorString(r.err)).toBe(point.error);
        expect(used(r.guard)).toBe(point.used);
        expect(JSON.stringify(fixtureState(stateOf(r.built))) === JSON.stringify(initial)).toBe(point.restored);
        if (!point.restored) expect(geomOf(r.built)).toEqual(point.geom);
      }
      if (st.probes && st.probes.length > 0) {
        const count = countingContext();
        runStage(st, count, MAX_TRANSACTION_WORK_UNITS);
        expect(count.calls).toBe(st.calls);
      }
      for (const probe of st.probes ?? []) {
        const ctx = countingContext(probe.limit);
        const r = runStage(st, ctx, MAX_TRANSACTION_WORK_UNITS);
        const initial = fixtureState(stateOf(buildSpec(st.spec)));
        expect(errorString(r.err)).toBe(probe.error);
        expect(chainHas(r.err, ctx.canceled)).toBe(probe.canceled ?? false);
        expect(JSON.stringify(fixtureState(stateOf(r.built))) === JSON.stringify(initial)).toBe(probe.restored);
        if (!probe.restored) expect(geomOf(r.built)).toEqual(probe.geom);
      }
    }
  });
});
