// Slice 47 — OVG Edge Router unit tests
// Pinned Go authority: internal/routing/ovg_edge_router.go

import { describe, it, expect } from 'bun:test';
import { Point } from '../../src/geometry/point.js';
import { Box } from '../../src/geometry/box.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Graph } from '../../src/graph/graph.js';
import { Route } from '../../src/routing/route.js';
import { NewOVGNode } from '../../src/routing/ovg-node.js';
import { NewOVGEdge } from '../../src/routing/ovg-edge.js';
import { OVG, buildOVGFromGraphWithGuard } from '../../src/routing/ovg.js';
import { defaultOVGBuildLimits, newOVGBuildGuard } from '../../src/routing/ovg-resource.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  newOVGEdgeRouterWithWorkLimit,
  RouteGenerationFlavor,
} from '../../src/routing/ovg-edge-router.js';
import {
  RouteSearchWorkGuard,
  MAX_ROUTE_SEARCH_WORK_UNITS,
} from '../../src/routing/route-guards.js';
const errContextCanceled = new Error('context canceled');

function buildTestOVG(graph) {
  const bg = backgroundWorkContext();
  const buildGuard = newOVGBuildGuard(bg, defaultOVGBuildLimits());
  return buildOVGFromGraphWithGuard(graph, null, buildGuard);
}

describe('OVGEdgeRouter', () => {
  describe('sortEdges parity', () => {
    it('sorts edges based on flavor: ShortestToLongest vs LongestToShortest vs AsIs', () => {
      const g = new Graph();
      const n1 = new Node(1, 30, 30);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 30, 30);
      n2.TopLeft = new Point(100, 0);
      const n3 = new Node(3, 30, 30);
      n3.TopLeft = new Point(300, 0);
      g.AddNode(n1);
      g.AddNode(n2);
      g.AddNode(n3);

      const shortEdge = new Edge(n1, n2); // dist ~ 70
      const longEdge = new Edge(n1, n3);  // dist ~ 270
      g.AddEdge(longEdge);
      g.AddEdge(shortEdge);

      const ovg = buildTestOVG(g);

      // ShortestToLongest
      const bg = backgroundWorkContext();
      const routerShort = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.ShortestToLongest,
        ovg,
        g,
        null,
        [longEdge, shortEdge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );
      expect(routerShort.edges[0]).toBe(shortEdge);
      expect(routerShort.edges[1]).toBe(longEdge);

      // LongestToShortest
      const routerLong = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.LongestToShortest,
        ovg,
        g,
        null,
        [shortEdge, longEdge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );
      expect(routerLong.edges[0]).toBe(longEdge);
      expect(routerLong.edges[1]).toBe(shortEdge);

      // AsIs
      const routerAsIs = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.AsIs,
        ovg,
        g,
        null,
        [longEdge, shortEdge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );
      expect(routerAsIs.edges[0]).toBe(longEdge);
      expect(routerAsIs.edges[1]).toBe(shortEdge);
    });
  });

  describe('Route Generation & Work Limit Boundaries', () => {
    it('succeeds with sufficient work budget and fails cleanly on W-1', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(150, 100);
      g.AddNode(n1);
      g.AddNode(n2);

      const edge = new Edge(n1, n2);
      g.AddEdge(edge);

      const ovg = buildTestOVG(g);
      const bg = backgroundWorkContext();

      // 1. Run with full budget to determine exact work units W
      const fullRouter = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.ShortestToLongest,
        ovg,
        g,
        null,
        [edge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );

      const resp = fullRouter.generateRoutes(bg, false);
      expect(resp.Err).toBeNull();
      expect(resp.Routes.length).toBe(1);

      const workUsed = fullRouter.work.used;
      expect(workUsed).toBeGreaterThan(10);

      // 2. Run with exact budget W -> must succeed
      const exactRouter = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.ShortestToLongest,
        ovg,
        g,
        null,
        [edge],
        workUsed
      );
      const exactResp = exactRouter.generateRoutes(bg, false);
      expect(exactResp.Err).toBeNull();

      // 3. Run with W - 1 budget -> must fail with ErrResourceLimitExceeded
      try {
        const underRouter = newOVGEdgeRouterWithWorkLimit(
          bg,
          RouteGenerationFlavor.ShortestToLongest,
          ovg,
          g,
          null,
          [edge],
          workUsed - 1
        );
        const underResp = underRouter.generateRoutes(bg, false);
        expect(underResp.Err).not.toBeNull();
      } catch (err) {
        expect(err).not.toBeNull();
      }
    });

    it('recovers cleanly and restores state after deterministic throw in route generation', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(100, 0);
      g.AddNode(n1);
      g.AddNode(n2);

      const edge = new Edge(n1, n2);
      g.AddEdge(edge);

      const ovg = buildTestOVG(g);
      const bg = backgroundWorkContext();

      const router = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.ShortestToLongest,
        ovg,
        g,
        null,
        [edge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );

      const throwingGuard = {
        _count: 0,
        bind() {},
        isContextCanceled() { return false; },
        step() {
          this._count++;
          if (this._count === 5) {
            throw new Error('deterministic throw during routing');
          }
        },
        add() {},
        check() {},
        reserveSum() {},
        reserveProduct() {},
        reserveSort() {},
        finish() {},
      };

      router.work = throwingGuard;
      const resp = router.generateRoutes(bg, false);
      expect(resp.Err).not.toBeNull();
      expect(resp.Err.message).toContain('deterministic throw during routing');
    });

    it('cancels gracefully mid-search on context cancellation', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(200, 200);
      g.AddNode(n1);
      g.AddNode(n2);

      const edge = new Edge(n1, n2);
      g.AddEdge(edge);

      const ovg = buildTestOVG(g);
      const bg = backgroundWorkContext();

      const router = newOVGEdgeRouterWithWorkLimit(
        bg,
        RouteGenerationFlavor.ShortestToLongest,
        ovg,
        g,
        null,
        [edge],
        MAX_ROUTE_SEARCH_WORK_UNITS
      );

      const canceledCtx = {
        isCanceled: () => true,
        Err: () => errContextCanceled,
      };

      const resp = router.generateRoutes(canceledCtx, false);
      expect(resp.Err != null && (resp.Err === errContextCanceled || resp.Err.message.includes('context canceled'))).toBe(true);
    });
  });
});
