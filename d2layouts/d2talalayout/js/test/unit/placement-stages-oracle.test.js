// Slice 46 — replay of internal/placement/go_slice46_stages_oracle_test.go.
// Every expected value (geometry, routes, tree orientations, returned bools
// including Dejitter's forceReroute, errors, transaction-guard work, W / W-1
// limit boundaries, and cancellation probes) comes from pinned Go.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { isSimple } from '../../src/placement/symmetry.js';
import { chainHas, countingContext, errorString } from './sized-optimizer-fixtures.js';
import { buildStageSpec, limitedStageGuard, runStage, stageState } from './placement-stages-fixtures.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice46-placement-stages-reference.json'), 'utf8'),
);

function runLimited(c, limit) {
  const { guard, ctx } = limitedStageGuard(limit);
  const out = runStage(c.op, c.spec, ctx);
  return { result: out.result, error: errorString(out.error), used: Number(guard.Used()), state: out.state };
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('Slice 46 placement stages — pinned Go oracle', () => {
  it('pins both Dejitter forceReroute outcomes', () => {
    const results = fixture.cases.filter((c) => c.op === 'dejitter' && c.run.error === '').map((c) => c.run.result);
    expect(results).toContain(true);
    expect(results).toContain(false);
  });

  const seen = new Map();
  for (const c of fixture.cases) {
    const key = `${c.name}/${c.op}`;
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    const label = index > 1 ? `${key}#${index}` : key;

    describe(label, () => {
      it('isSimple matches per node', () => {
        const { g } = buildStageSpec(c.spec);
        expect(g.Nodes.map((n) => isSimple(g, n))).toEqual(c.simple);
      });

      it('run: result, error, work, and final state match', () => {
        const run = runLimited(c, MAX_TRANSACTION_WORK_UNITS);
        expect(run).toEqual(c.run);
        // Seeded determinism: a replay is identical.
        expect(runLimited(c, MAX_TRANSACTION_WORK_UNITS)).toEqual(run);
      });

      if (c.boundary) {
        it('W and W-1 limit boundaries match', () => {
          const b = c.boundary;
          expect(runLimited(c, b.w)).toEqual(b.atW);
          const below = runLimited(c, b.w - 1);
          expect(below).toEqual(b.below);
          const initial = stageState(buildStageSpec(c.spec));
          expect(sameJSON(below.state, initial)).toBe(b.restored);
        });
      }

      if (c.probeCalls > 0) {
        it('context-check count and cancellation probes match', () => {
          const count = countingContext();
          const counted = runStage(c.op, c.spec, count);
          expect(errorString(counted.error)).toBe(c.run.error);
          expect(count.calls).toBe(c.probeCalls);

          const initial = stageState(buildStageSpec(c.spec));
          for (const p of c.probes) {
            const ctx = countingContext(p.cancelAt);
            const out = runStage(c.op, c.spec, ctx);
            const restored = sameJSON(out.state, initial);
            const message = errorString(out.error);
            const got = {
              cancelAt: p.cancelAt,
              canceled: chainHas(out.error, ctx.canceled),
              result: out.result,
              restored,
            };
            expect(got).toEqual({ cancelAt: p.cancelAt, canceled: p.canceled, result: p.result, restored: p.restored });
            if (p.errorVaries) {
              // Go's Commit ranges over Graph.Containers (a map); which check
              // observes the cancellation varies only in its error source.
              expect(message === 'context canceled' || message.endsWith('Transactions: context canceled')).toBe(true);
            } else {
              expect(message).toBe(p.error);
            }
            if (!p.restored) {
              expect(out.state).toEqual(p.state);
            }
          }
        });
      }
    });
  }
});
