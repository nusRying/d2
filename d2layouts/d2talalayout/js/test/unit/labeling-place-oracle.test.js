// Slice 49 — replay of internal/labeling/go_slice49_labeling_oracle_test.go.
import { describe, it, expect } from 'bun:test';
import { Place, place } from '../../src/labeling/placement.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { loadFixture } from './slice46-fixtures.js';
import { buildSlice49Graph, captureState } from './slice49-fixtures.js';

const fixture = loadFixture('go-slice49-labeling-reference.json');

describe('labeling Place Go oracle (slice 49)', () => {
  for (const sc of fixture.scenarios) {
    it(`scenario ${sc.name}`, () => {
      const ctx = backgroundWorkContext();
      const { g } = buildSlice49Graph(sc.spec);
      Place(ctx, g);
      const after = captureState(g);
      expect(after.nodes).toEqual(sc.nodesAfter);
      expect(after.edges).toEqual(sc.edgesAfter);
    });
  }

  it('exact work W and W-1 rollback parity', () => {
    const ctx = backgroundWorkContext();
    const exact = fixture.exactWork;

    // At exact W
    const { g: gExact } = buildSlice49Graph(exact.spec);
    place(ctx, gExact, exact.w);
    const afterExact = captureState(gExact);
    expect(afterExact.nodes).toEqual(exact.nodesAfter);
    expect(afterExact.edges).toEqual(exact.edgesAfter);

    // At W-1
    const { g: gShort } = buildSlice49Graph(exact.spec);
    expect(() => {
      place(ctx, gShort, exact.w - 1);
    }).toThrow(exact.wMinus1Error);
    const afterShort = captureState(gShort);
    expect(afterShort.nodes).toEqual(exact.nodesAfterRoll);
    expect(afterShort.edges).toEqual(exact.edgesAfterRoll);
  });
});
