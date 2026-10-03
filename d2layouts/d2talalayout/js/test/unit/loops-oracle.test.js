// Slice 46 — replay of internal/loops/go_slice46_loops_oracle_test.go.
// Shape ports, self-edge routes, loop offsets and Go's exact stable edge
// ordering; every expected value comes from pinned Go.
import { describe, it, expect } from 'bun:test';

import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import {
  nodeSnapPointPercentages,
  nodePorts,
  nodePortIndices,
  nodeCenterPortIndices,
  nodeCenterPortIndex,
  nodeMirroredPortIndices,
} from '../../src/shape/ports.js';
import { route, computeOffsets, updateOffsets, edgesInOrder } from '../../src/loops/index.js';
import { loadFixture, buildSpec, num, enc, capture } from './slice46-fixtures.js';

const fixture = loadFixture('go-slice46-loops-reference.json');

const OFFSET_ORDER = [
  Orientation.Left, Orientation.Right, Orientation.Top, Orientation.Bottom,
  Orientation.TopLeft, Orientation.TopRight, Orientation.BottomLeft, Orientation.BottomRight,
];

const pts = (points) => (points ?? []).map((p) => [enc(p.X), enc(p.Y)]);

function nodeOffsets(n) {
  const empty = n.LoopOffsets.size === 0;
  const out = { id: Number(n.ID), offsets: null, empty, placed: n.TopLeft != null, topLeft: [0, 0] };
  if (!empty) {
    expect(n.LoopOffsets.size).toBe(OFFSET_ORDER.length);
    out.offsets = OFFSET_ORDER.map((o) => enc(n.LoopOffsets.get(o)));
  }
  if (n.TopLeft != null) out.topLeft = [enc(n.TopLeft.X), enc(n.TopLeft.Y)];
  return out;
}

function edgesAfter(edges) {
  return edges.map((e) => ({ points: pts(e.Points), labelPos: e.Label != null ? e.Label.Position : -1 }));
}

describe('nodeshape ports Go oracle (slice 46)', () => {
  it('matches every shape, size and table column count', () => {
    expect(fixture.ports.length).toBeGreaterThan(200);
    for (const pc of fixture.ports) {
      const n = new Node(1n, num(pc.w), num(pc.h));
      n.setShape(pc.shape);
      n.setNumColumns(pc.numColumns);
      n.TopLeft = new Point(num(pc.x), num(pc.y));
      const centers = nodeCenterPortIndices(n);
      const mirrored = nodeMirroredPortIndices(n);
      const got = {
        shape: pc.shape,
        numColumns: pc.numColumns,
        w: pc.w,
        h: pc.h,
        x: pc.x,
        y: pc.y,
        snap: nodeSnapPointPercentages(n).map((g) => g.map((p) => [enc(p.XPercentage), enc(p.YPercentage)])),
        ports: pts(nodePorts(n)),
        portIndices: [],
        centers: centers ?? [],
        centerIndex: [],
        mirrored: mirrored == null ? [] : [...mirrored.entries()].sort((a, b) => a[0] - b[0]),
        mirroredNil: mirrored == null,
        centersNil: centers == null,
      };
      for (let o = Orientation.TopLeft; o <= Orientation.NONE; o++) {
        got.portIndices.push(nodePortIndices(n, o));
        got.centerIndex.push(nodeCenterPortIndex(n, o));
      }
      expect(got).toEqual(pc);
    }
  });
});

describe('loops Go oracle (slice 46)', () => {
  for (const c of fixture.loops) {
    describe(c.name, () => {
      it('Route for every node', () => {
        const count = c.spec.nodes.length;
        for (let i = 0; i < count; i++) {
          const { g, edges } = buildSpec(c.spec);
          const node = g.Nodes[i];
          const expected = c.routes[i];
          const { value: routed, err } = capture(() => route(node));
          expect(err != null).toBe(expected.panic);
          if (expected.panic) continue;
          const got = routed.map((e, k) => {
            let sharesFrom = -1;
            let sharesTo = -1;
            for (let j = 0; j < k; j++) {
              const other = routed[j];
              if (sharesFrom < 0 && other.Points[0] === e.Points[0]) sharesFrom = j;
              if (sharesTo < 0 && other.Points[other.Points.length - 1] === e.Points[e.Points.length - 1]) sharesTo = j;
            }
            return {
              edge: edges.indexOf(e),
              points: pts(e.Points),
              labelPos: e.Label != null ? e.Label.Position : -1,
              sharesFrom,
              sharesTo,
            };
          });
          expect({ node: Number(node.ID), routed: got, panic: false }).toEqual(expected);
        }
      });

      it('ComputeOffsets', () => {
        const { g, edges } = buildSpec(c.spec);
        const { err } = capture(() => computeOffsets(g));
        expect(err != null).toBe(c.offsets.panic);
        if (c.offsets.panic) return;
        expect({ nodes: g.Nodes.map(nodeOffsets), edges: edgesAfter(edges), panic: false }).toEqual({ ...c.offsets, edges: c.offsets.edges ?? [] });
      });

      it('UpdateOffsets per node', () => {
        c.spec.nodes.forEach((_, i) => {
          const { g, edges } = buildSpec(c.spec);
          const node = g.Nodes[i];
          const expected = c.updates[i];
          const { err } = capture(() => updateOffsets(node));
          expect(err != null).toBe(expected.panic);
          if (expected.panic) return;
          expect({ nodes: [nodeOffsets(node)], edges: edgesAfter(edges), panic: false }).toEqual({ ...expected, edges: expected.edges ?? [] });
        });
      });
    });
  }
});

describe('edgesInOrder Go oracle (slice 46)', () => {
  it('reproduces Go slices.SortStableFunc permutations', () => {
    expect(fixture.orders.length).toBeGreaterThan(10);
    for (const oc of fixture.orders) {
      const n1 = new Node(1n, 10, 10);
      const n2 = new Node(2n, 10, 10);
      const edges = oc.edges.map((es) => {
        const e = new Edge(n1, es.to === 2 ? n2 : n1);
        e.SourceArrowhead = es.src ?? '';
        e.TargetArrowhead = es.dst ?? '';
        if (es.label != null) e.Label = new Label('', num(es.label.w), num(es.label.h));
        return e;
      });
      const input = edges.slice();
      const order = edgesInOrder(edges).map((e) => edges.indexOf(e));
      expect(order).toEqual(oc.order);
      expect(edges.every((e, i) => e === input[i])).toBe(true);
    }
  });
});
