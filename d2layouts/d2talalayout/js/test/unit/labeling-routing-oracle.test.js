// Slice 47 — replay of internal/labeling/go_slice47_labeling_oracle_test.go.
// Arrowhead label geometry, shared-segment and edge-sort kernels, and
// labeling.PlaceNewEdges outcomes (state, work limit W/W-1, exhaustive or
// strided cancellation, panics, validation). Every expected value comes from
// pinned Go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Cluster } from '../../src/graph/cluster.js';
import { routeLength } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { PositionArrowheadLabel } from '../../src/labeling/arrowhead.js';
import {
  edgeOverlapCount,
  maxLabelPlacementWorkUnits,
  newLabelPlacementWorkGuard,
  nodeOverlapArea,
  nodeOverlapCount,
  sortLabelPlacementEdges,
} from '../../src/labeling/guard.js';
import { findSharedSegmentsChecked, labelPercentageSearchRange, scoreEdgeLabelOverlaps } from '../../src/labeling/placement.js';
import { loadFixture, num, enc } from './slice46-fixtures.js';
import { execS47, points } from './slice47-labeling-fixtures.js';

const fixture = loadFixture('go-slice47-labeling-reference.json');

function edgeWithRoute(route) {
  const edge = new Edge(null, null);
  edge.Points = points(route);
  return edge;
}

describe('labeling Go oracle (slice 47)', () => {
  it('label-placement work limit', () => {
    expect(maxLabelPlacementWorkUnits).toBe(fixture.maxWork);
  });

  it('PositionArrowheadLabel across arrowheads, routes, sizes and ends', () => {
    expect(fixture.arrows.length).toBeGreaterThan(400);
    const got = fixture.arrows.map((probe) => {
      const edge = edgeWithRoute(probe.route);
      edge.SourceArrowhead = probe.src;
      edge.TargetArrowhead = probe.dst;
      if (probe.hasLabel) {
        const value = new Label(probe.text, num(probe.w), num(probe.h));
        if (probe.isTarget) edge.TargetArrowheadLabel = value;
        else edge.SourceArrowheadLabel = value;
      }
      const out = { ...probe };
      delete out.nil;
      delete out.box;
      delete out.panic;
      try {
        const positioned = PositionArrowheadLabel(edge, probe.isTarget, edge.Points);
        if (positioned == null) {
          out.nil = true;
        } else {
          expect(positioned.Edge).toBe(edge);
          expect(positioned.IsTarget).toBe(probe.isTarget);
          expect(positioned.Text).toBe(probe.text);
          out.box = [enc(positioned.TopLeft.X), enc(positioned.TopLeft.Y), enc(positioned.Width), enc(positioned.Height)];
        }
      } catch (err) {
        out.panic = err.message;
      }
      return out;
    });
    expect(got).toEqual(fixture.arrows);
  });

  it('findSharedSegmentsChecked segments and work steps', () => {
    const got = fixture.shared.map((probe) => {
      const edges = (probe.routes ?? []).map(edgeWithRoute);
      let steps = 0;
      const segments = findSharedSegmentsChecked(edges, () => { steps++; });
      const keys = segments
        .map((s) => JSON.stringify([enc(s.Start.X), enc(s.Start.Y), enc(s.End.X), enc(s.End.Y)]))
        .sort();
      return { routes: probe.routes, steps, segments: keys };
    });
    expect(got).toEqual(fixture.shared);
  });

  it('sortLabelPlacementEdges order and work', () => {
    const got = fixture.sorts.map((probe) => {
      const edges = (probe.routes ?? []).map(edgeWithRoute);
      const guard = newLabelPlacementWorkGuard(backgroundWorkContext(), 'sort', maxLabelPlacementWorkUnits);
      const sorted = sortLabelPlacementEdges(edges, guard);
      return { routes: probe.routes, order: sorted.map((e) => edges.indexOf(e)), used: guard.used };
    });
    expect(got).toEqual(fixture.sorts);
  });

  it('overlap kernels and edge-label score', () => {
    expect(fixture.kernels.length).toBe(40);
    const got = fixture.kernels.map((probe) => {
      const g = new Graph();
      const nodes = (probe.nodes ?? []).map((spec, j) => {
        const n = new Node(BigInt(j + 1), num(spec[2]), num(spec[3]));
        n.TopLeft = new Point(num(spec[0]), num(spec[1]));
        g.addNewNodeToContainer(null, n);
        if (num(spec[4]) === 1) {
          const child = new Node(BigInt(100 + j), 1, 1);
          child.TopLeft = new Point(num(spec[0]), num(spec[1]));
          g.addNewNodeToContainer(n, child);
        }
        return n;
      });
      const edges = (probe.routes ?? []).map(edgeWithRoute);
      const box = new Node(0n, num(probe.box[2]), num(probe.box[3]));
      box.TopLeft = new Point(num(probe.box[0]), num(probe.box[1]));
      box.setShape('Square');
      const results = [0, 4, 5].map((delta) => {
        const guard = newLabelPlacementWorkGuard(backgroundWorkContext(), 'kernel', maxLabelPlacementWorkUnits);
        const count = nodeOverlapCount(box, nodes, delta, guard);
        const [area, areaCount] = nodeOverlapArea(box, nodes, delta, false, guard);
        const [pArea, pAreaCount] = nodeOverlapArea(box, nodes, delta, true, guard);
        const edgeCount = edgeOverlapCount(box, edges, delta, guard);
        const score = scoreEdgeLabelOverlaps(box.area(), area + pArea, areaCount + pAreaCount, edgeCount,
          probe.extra[0], probe.extra[1], probe.extra[2]);
        return {
          delta, count, area: enc(area), areaCount, pArea: enc(pArea), pAreaCount, edges: edgeCount,
          score: enc(score), used: guard.used,
        };
      });
      return { ...probe, results };
    });
    expect(got).toEqual(fixture.kernels);
  });

  it('labelPercentageSearchRange', () => {
    const got = fixture.ranges.map((probe) => {
      const from = new Node(1n, 10, 10);
      const to = new Node(2n, 10, 10);
      if (probe.fromCluster) from.Cluster = new Cluster();
      if (probe.toCluster) to.Cluster = new Cluster();
      const edge = new Edge(from, to);
      edge.Points = points(probe.route);
      edge.Label = new Label('', num(probe.w), num(probe.h));
      const r = labelPercentageSearchRange(edge, routeLength(edge.Points));
      return { ...probe, range: [enc(r.start), enc(r.end)] };
    });
    expect(got).toEqual(fixture.ranges);
  });

  for (const sc of fixture.scenarios) {
    describe(`PlaceNewEdges ${sc.name}`, () => {
      it('main run state, context polls and outcome', () => {
        expect(execS47(sc.spec, sc.mutation, 0, 0, maxLabelPlacementWorkUnits, true)).toEqual(sc.main);
      });

      if (sc.atW != null) {
        it(`work limit W=${sc.w} succeeds and W-1 fails with exact rollback`, () => {
          expect(execS47(sc.spec, sc.mutation, 0, 0, sc.w, false)).toEqual(sc.atW);
          expect(execS47(sc.spec, sc.mutation, 0, 0, sc.w - 1, false)).toEqual(sc.atWMinus1);
        });
      }

      it(`cancellation probes (${sc.cancels.length}) restore exactly`, () => {
        const got = sc.cancels.map((probe) => ({ at: probe.at, ...execS47(sc.spec, sc.mutation, probe.at, 0, maxLabelPlacementWorkUnits, false) }));
        expect(got).toEqual(sc.cancels);
      });

      it('panic probes restore exactly', () => {
        const got = sc.panics.map((probe) => ({ at: probe.at, ...execS47(sc.spec, sc.mutation, 0, probe.at, maxLabelPlacementWorkUnits, false) }));
        expect(got).toEqual(sc.panics);
      });
    });
  }
});
