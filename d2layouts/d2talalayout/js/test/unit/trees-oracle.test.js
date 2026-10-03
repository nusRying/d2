// Slice 46 — replay of internal/trees/go_slice46_trees_oracle_test.go.
// Every expected value (geometry, tree structure, errors, exact work
// boundaries, cancellation checkpoints, panic rollback) comes from pinned Go;
// scenarios are rebuilt from Go-exported specs.
import { describe, it, expect } from 'bun:test';

import {
  chainHas,
  countingContext,
  errorString,
  loadFixture,
  refsMismatch,
  run,
  stateOf,
} from './trees-oracle-support.js';

const fixture = loadFixture();

const REQUIRED_GROUPS = [
  'chain',
  'branching',
  'multiple trees',
  'fixed root',
  'orientation changes',
  'labels',
  'container tree',
  'preprocessing reversal',
  'reconnect',
  'cancellation',
  'seeded determinism',
];

describe('Slice 46 trees oracle fixture', () => {
  it('contains every required group', () => {
    const groups = new Set(fixture.cases.map((c) => c.group));
    for (const group of REQUIRED_GROUPS) expect(groups.has(group)).toBe(true);
    expect(fixture.cases.some((c) => c.w > 0)).toBe(true);
    expect(fixture.cases.some((c) => (c.panics ?? []).length > 0)).toBe(true);
  });
});

for (const group of REQUIRED_GROUPS) {
  describe(`Slice 46 trees oracle: ${group}`, () => {
    for (const c of fixture.cases.filter((x) => x.group === group)) {
      describe(c.name, () => {
        it('matches Go result and state', () => {
          const { b, err } = run(c);
          expect(errorString(err)).toBe(c.error);
          expect(stateOf(b)).toEqual(c.state);
          // Determinism: replay again from scratch.
          const again = run(c);
          expect(errorString(again.err)).toBe(c.error);
          expect(stateOf(again.b)).toEqual(c.state);
        });

        if (c.w) {
          it('succeeds at W and fails atomically at W-1', () => {
            const atW = run(c, undefined, c.w);
            expect(errorString(atW.err)).toBe('');
            expect(stateOf(atW.b)).toEqual(c.state);
            const below = run(c, undefined, c.w - 1);
            expect(errorString(below.err)).toBe(c.belowError);
            expect(c.belowRestored).toBe(true);
            expect(stateOf(below.b)).toEqual(below.initial);
            expect(refsMismatch(below.b, below.refs)).toBeNull();
          });
        }

        if (c.calls) {
          it('observes the same number of context checks', () => {
            const ctx = countingContext();
            const { err } = run(c, ctx);
            expect(errorString(err)).toBe(c.error);
            expect(ctx.calls).toBe(c.calls);
          });

          it('cancels at every probed context check with exact rollback', () => {
            for (const p of c.probes) {
              const ctx = countingContext(p.at);
              const { b, initial, refs, err } = run(c, ctx);
              const label = `${c.name} cancelAt=${p.at}`;
              expect(`${label}: ${errorString(err)}`).toBe(`${label}: ${p.error}`);
              expect(chainHas(err, ctx.canceled)).toBe(p.canceled);
              const after = stateOf(b);
              if (p.restored) {
                expect(after).toEqual(initial);
                expect(`${label}: ${refsMismatch(b, refs)}`).toBe(`${label}: null`);
              } else {
                expect(after).toEqual(p.state);
              }
            }
          });

          it('rolls back when a context check throws (Go panic)', () => {
            for (const p of c.panics ?? []) {
              const ctx = countingContext(0, p.at);
              const { b, initial, refs, err } = run(c, ctx);
              expect(errorString(err)).toBe(p.error);
              const after = stateOf(b);
              if (p.restored) {
                expect(after).toEqual(initial);
                expect(refsMismatch(b, refs)).toBeNull();
              } else {
                expect(after).toEqual(p.state);
              }
            }
          });
        }
      });
    }
  });
}
