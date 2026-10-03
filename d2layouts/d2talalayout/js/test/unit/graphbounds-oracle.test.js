// Slice 46 — replay of internal/graphbounds/go_slice46_graphbounds_oracle_test.go.
// Every expected box, work count, and error comes from pinned Go.
import { describe, it, expect } from 'bun:test';

import { WorkGuard } from '../../src/limits/work-guard.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { nodeBoundingBox, boundingBox, fixedBoundingBox } from '../../src/graphbounds/index.js';
import { loadFixture, buildSpec, encAll, countingContext } from './slice46-fixtures.js';

const fixture = loadFixture('go-slice46-graphbounds-reference.json');
const LOCATION = fixture.location;
const BIG_LIMIT = 1_000_000_000;

function run(ctx, limit, op) {
  let guard;
  try {
    guard = new WorkGuard(ctx, LOCATION, limit);
  } catch (err) {
    return { box: null, used: 0, err: err.message, canceled: err.cause != null };
  }
  try {
    const [tl, br] = op(guard);
    return { box: encAll([tl.X, tl.Y, br.X, br.Y]), used: Number(guard.Used()), err: '' };
  } catch (err) {
    return { box: null, used: Number(guard.Used()), err: err.message, canceled: err.cause != null };
  }
}

function result(op) {
  const { box, used, err } = run(backgroundWorkContext(), BIG_LIMIT, op);
  return { box, used, err };
}

describe('graphbounds Go oracle (slice 46)', () => {
  it('has a non-trivial fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(50);
  });

  for (const c of fixture.cases) {
    describe(c.name, () => {
      it('NodeBoundingBox with all nodes and with nil', () => {
        const { g } = buildSpec(c.spec);
        const got = g.Nodes.map((node) => ({
          id: Number(node.ID),
          withAll: result((guard) => nodeBoundingBox(node, g.Nodes, guard)),
          withNil: result((guard) => nodeBoundingBox(node, null, guard)),
        }));
        expect(got).toEqual(c.nodes ?? []);
      });

      it('BoundingBox and FixedBoundingBox for every node set', () => {
        const { g, nodes } = buildSpec(c.spec);
        const got = c.sets.map((set) => {
          const members = set.ids.map((id) => nodes.get(id));
          return {
            name: set.name,
            ids: set.ids,
            bound: result((guard) => boundingBox(members, guard)),
            fixed: result((guard) => fixedBoundingBox(members, guard)),
          };
        });
        expect(got).toEqual(c.sets);
        // Set membership itself is rebuilt from the JS graph maps.
        const names = ['all'];
        if (g.Containers.has(null)) names.push('root');
        for (const node of g.Nodes) {
          if (g.Containers.has(node)) names.push(`container:${node.ID}`);
        }
        expect(names).toEqual(c.sets.map((s) => s.name));
      });

      if (c.limits) {
        it('FixedBoundingBox work-limit sweep', () => {
          const { g } = buildSpec(c.spec);
          const got = c.limits.map((probe) => {
            const r = run(backgroundWorkContext(), probe.limit, (guard) => fixedBoundingBox(g.Nodes, guard));
            return { limit: probe.limit, box: r.box, used: r.used, err: r.err };
          });
          expect(got).toEqual(c.limits);
        });
      }

      if (c.cancels) {
        it('FixedBoundingBox cancellation at every context poll', () => {
          const { g } = buildSpec(c.spec);
          const counter = countingContext();
          run(counter, BIG_LIMIT, (guard) => fixedBoundingBox(g.Nodes, guard));
          expect(counter.calls).toBe(c.cancels.length);
          const got = c.cancels.map((probe) => {
            const r = run(countingContext(probe.cancelAt), BIG_LIMIT, (guard) => fixedBoundingBox(g.Nodes, guard));
            return {
              cancelAt: probe.cancelAt,
              box: r.box,
              used: r.used,
              err: r.err,
              canceled: Boolean(r.canceled),
            };
          });
          expect(got).toEqual(c.cancels);
        });
      }
    });
  }
});
