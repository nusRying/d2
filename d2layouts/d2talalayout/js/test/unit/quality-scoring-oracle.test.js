// Slice 49 — replay of internal/quality/go_slice49_quality_oracle_test.go.
import { describe, it, expect } from 'bun:test';
import { EvaluateWithArea, evaluateWithAreaLimit } from '../../src/quality/scoring.js';
import { Score } from '../../src/quality/score.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { loadFixture, num } from './slice46-fixtures.js';
import { buildSlice49Graph } from './slice49-fixtures.js';

const fixture = loadFixture('go-slice49-quality-reference.json');

describe('quality Evaluate Go oracle (slice 49)', () => {
  for (const sc of fixture.scenarios) {
    it(`scenario ${sc.name}`, () => {
      const ctx = backgroundWorkContext();
      const { g } = buildSlice49Graph(sc.spec);
      const res = EvaluateWithArea(ctx, g);
      expect(res.penalty).toBeCloseTo(num(sc.penalty), 9);
      expect(res.area).toBeCloseTo(num(sc.area), 9);
    });
  }

  it('Score.Compare matrix', () => {
    for (const probe of fixture.compare) {
      const a = new Score(num(probe.a[0]), num(probe.a[1]));
      const b = new Score(num(probe.b[0]), num(probe.b[1]));
      const outcome = a.Compare(b);
      expect(outcome).toBe(probe.outcome);
    }
  });

  it('exact work W and W-1 evaluation parity', () => {
    const ctx = backgroundWorkContext();
    const exact = fixture.exactWork;

    // At exact W
    const { g: gExact } = buildSlice49Graph(exact.spec);
    const [score, area, used] = evaluateWithAreaLimit(ctx, gExact, exact.w);
    expect(score).toBeCloseTo(num(exact.penalty), 9);
    expect(area).toBeCloseTo(num(exact.area), 9);
    expect(used).toBe(exact.w);

    // At W-1
    const { g: gShort } = buildSlice49Graph(exact.spec);
    expect(() => {
      evaluateWithAreaLimit(ctx, gShort, exact.w - 1);
    }).toThrow(exact.wMinus1Error);
  });
});
