// Slice 46 — replay of internal/packing/go_slice46_packing_oracle_test.go.
// Every expected value (geometry, routes, errors, exact work, context-check
// counts, rollback) comes from pinned Go; scenarios are rebuilt from the
// Go-exported specs.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pack, combineSubgraphs } from '../../src/packing/index.js';
import { packAtomic } from '../../src/packing/binpack.js';
import { newWorkGuard } from '../../src/packing/guard.js';
import { goParseFloat64 } from '../../src/packing/go-support.js';
import {
  RoutedContainerBoxDecision,
  binPackCanUseRoutedContainerBox,
  routedContainerSegmentStaysInsideShrink,
} from '../../src/packing/routed-container.js';
import { Box } from '../../src/geometry/box.js';
import { Point } from '../../src/geometry/point.js';
import { MAX_BIN_PACK_WORK_UNITS } from '../../src/limits/constants.js';
import {
  PANIC_PROBE,
  bg,
  buildSpec,
  chainHas,
  countingContext,
  errorString,
  geomOf,
  ownersOf,
  restoredTo,
  routesOf,
  snap,
} from './packing-fixtures.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice46-packing-reference.json'), 'utf8'),
);

// Exhaustive probe and limit sweeps replay hundreds of full runs.
const HEAVY_TIMEOUT_MS = 60_000;

const GROUPS = [
  'disconnected components',
  'aspect ratio',
  'routed container',
  'nested container',
  'combine subgraphs',
  'W/W-1',
  'cancellation',
  'panic rollback',
];

/** Mirrors s46Pack: packAtomic with a BinPack guard at `limit`. */
function runPack(ctx, b, limit = MAX_BIN_PACK_WORK_UNITS) {
  let guard = null;
  let err = null;
  try {
    guard = newWorkGuard(ctx, limit);
    packAtomic(ctx, b.g, b.root, guard);
  } catch (e) {
    err = e;
  }
  return { err, used: guard == null ? 0 : Number(guard.Used()) };
}

/** Mirrors s46Combine. */
function runCombine(ctx, b, nilMaster = false) {
  try {
    return { err: null, combined: combineSubgraphs(ctx, nilMaster ? null : b.g, b.subs, b.obst) };
  } catch (err) {
    return { err, combined: null };
  }
}

function replayCase(c) {
  const b = buildSpec(c.spec);
  const before = snap(b);
  const ctx = countingContext();
  const out = c.op === 'pack' ? runPack(ctx, b) : runCombine(ctx, b, c.spec.nilMaster);
  expect(errorString(out.err)).toBe(c.error);
  expect(Boolean(out.err) && chainHas(out.err, ctx.canceled)).toBe(Boolean(c.canceled));
  if (c.op === 'pack') expect(out.used).toBe(c.used ?? 0);
  expect(ctx.calls).toBe(c.calls);
  expect(restoredTo(b, before)).toBe(c.restored);
  expect(geomOf(b)).toEqual(c.geom);
  expect(routesOf(b)).toEqual(c.routes);
  if (out.err != null) {
    // Atomicity: every failure leaves the exact prior state, route arrays included.
    expect(restoredTo(b, before, true)).toBe(true);
  }
  if (c.op === 'combine') {
    expect(ownersOf(b, out.combined)).toEqual(c.owners ?? []);
    if (out.combined != null) {
      expect(out.combined.Nodes.map((n) => Number(n.ID))).toEqual(c.combined ?? []);
      expect(out.combined.Edges.map((e) => b.edges.indexOf(e))).toEqual(c.cEdges ?? []);
      expect(out.combined.Containers === b.g.Containers).toBe(Boolean(c.shared));
    }
  }
  return b;
}

describe('Slice 46 packing oracle', () => {
  it('fixture contains every required group', () => {
    for (const group of GROUPS) {
      expect(Array.isArray(fixture[group])).toBe(true);
      expect(fixture[group].length).toBeGreaterThan(0);
    }
  });

  for (const group of ['disconnected components', 'aspect ratio', 'routed container', 'nested container', 'combine subgraphs']) {
    describe(group, () => {
      for (const c of fixture[group]) {
        it(c.name, () => {
          const first = replayCase(c);
          // Seeded determinism: an identical second run agrees exactly.
          const again = buildSpec(c.spec);
          if (c.op === 'pack') runPack(bg, again);
          else runCombine(bg, again, c.spec.nilMaster);
          expect(geomOf(again)).toEqual(geomOf(first));
          expect(routesOf(again)).toEqual(routesOf(first));
        });
      }
    });
  }

  describe('W/W-1', () => {
    for (const bd of fixture['W/W-1']) {
      it(bd.name, () => {
        const full = buildSpec(bd.spec);
        const initial = geomOf(full);
        const out = runPack(bg, full);
        expect(out.err).toBe(null);
        expect(out.used).toBe(bd.w);
        expect(geomOf(full)).toEqual(bd.geom);
        expect(routesOf(full)).toEqual(bd.routes);
        expect(JSON.stringify(initial) !== JSON.stringify(bd.geom)).toBe(bd.changed);
        const at = (limit) => {
          const b = buildSpec(bd.spec);
          const before = snap(b);
          const o = runPack(bg, b, limit);
          return { limit, error: errorString(o.err), used: o.used, restored: restoredTo(b, before) };
        };
        expect(at(bd.atW.limit)).toEqual(bd.atW);
        expect(at(bd.belowW.limit)).toEqual(bd.belowW);
        for (const entry of bd.sweep) {
          expect(at(entry.limit)).toEqual(entry);
        }
      }, HEAVY_TIMEOUT_MS);
    }
  });

  for (const [group, panicMode] of [['cancellation', false], ['panic rollback', true]]) {
    describe(group, () => {
      for (const set of fixture[group]) {
        it(`${set.op} ${set.name}`, () => {
          const count = countingContext();
          if (set.op === 'pack') runPack(count, buildSpec(set.spec));
          else runCombine(count, buildSpec(set.spec));
          expect(count.calls).toBe(set.calls);
          for (const probe of set.probes) {
            const b = buildSpec(set.spec);
            const before = snap(b);
            const ctx = countingContext(panicMode ? { panicAt: probe.at } : { cancelAt: probe.at });
            const out = set.op === 'pack' ? runPack(ctx, b) : runCombine(ctx, b);
            const panicked = out.err === PANIC_PROBE;
            const got = {
              at: probe.at,
              error: panicked ? 's46 panic probe' : errorString(out.err),
              canceled: !panicked && out.err != null && chainHas(out.err, ctx.canceled),
              restored: restoredTo(b, before),
            };
            if (panicked) got.panicked = true;
            expect(got).toEqual(probe);
            if (out.err != null) expect(restoredTo(b, before, true)).toBe(true);
          }
        }, HEAVY_TIMEOUT_MS);
      }
    });
  }

  describe('routed decisions', () => {
    for (const d of fixture['routed decisions']) {
      it(d.name, () => {
        const b = buildSpec(d.spec);
        b.root.TopLeft.X = d.proposed.x;
        b.root.TopLeft.Y = d.proposed.y;
        b.root.Width = d.proposed.w;
        b.root.Height = d.proposed.h;
        const incident = b.g.Edges.filter((e) => e != null && (e.From === b.root || e.To === b.root));
        const guard = newWorkGuard(bg, 1_000_000);
        const original = new Box(new Point(d.original.x, d.original.y), d.original.w, d.original.h);
        let decision = RoutedContainerBoxDecision.DeferToSideConstraints;
        let err = null;
        const routesBefore = routesOf(b);
        try {
          decision = binPackCanUseRoutedContainerBox(b.g, b.root, original, incident, guard);
        } catch (e) {
          err = e;
        }
        expect({ decision, error: errorString(err), used: Number(guard.Used()) })
          .toEqual({ decision: d.decision, error: d.error, used: d.used });
        // The proof never rewrites or clears routes.
        expect(routesOf(b)).toEqual(routesBefore);
      });
    }
  });

  it('segment checks', () => {
    for (const c of fixture['segment checks']) {
      const guard = newWorkGuard(bg, 1_000_000);
      const original = new Box(new Point(c.original.x, c.original.y), c.original.w, c.original.h);
      const proposed = new Box(new Point(c.proposed.x, c.proposed.y), c.proposed.w, c.proposed.h);
      const result = routedContainerSegmentStaysInsideShrink(
        original, proposed, new Point(c.points[0], c.points[1]), new Point(c.points[2], c.points[3]), guard,
      );
      expect([c.points, result, Number(guard.Used())]).toEqual([c.points, c.result, c.used]);
    }
  });

  it('strconv.ParseFloat parity for border radii', () => {
    for (const c of fixture.parseFloat) {
      const got = goParseFloat64(c.text);
      expect([c.text, got.ok]).toEqual([c.text, c.ok]);
      if (got.ok && Number.isFinite(got.value)) {
        expect([c.text, got.value]).toEqual([c.text, c.value]);
      }
    }
  });

  it('public pack and combineSubgraphs entry points match the oracle', () => {
    const c = fixture['disconnected components'].find((x) => x.name === 'many-rectangles');
    const b = buildSpec(c.spec);
    pack(bg, b.g, b.root);
    expect(geomOf(b)).toEqual(c.geom);
    const cc = fixture['combine subgraphs'].find((x) => x.name === 'routed-subgraphs');
    const cb = buildSpec(cc.spec);
    const combined = combineSubgraphs(bg, cb.g, cb.subs, cb.obst);
    expect(combined.Nodes.map((n) => Number(n.ID))).toEqual(cc.combined);
    expect(geomOf(cb)).toEqual(cc.geom);
    expect(routesOf(cb)).toEqual(cc.routes);
  });
});
