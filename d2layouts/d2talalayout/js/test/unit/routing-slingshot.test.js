// Slice 47 — Slingshot routing unit tests
// Pinned Go authority: internal/routing/slingshot.go

import { describe, it, expect } from 'bun:test';
import { Point } from '../../src/geometry/point.js';
import { Box } from '../../src/geometry/box.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Graph } from '../../src/graph/graph.js';
import {
  RouteChecker,
  newFallibleRouteChecker,
  preferLaunchingVertically,
  isOnFlightPlan,
  fillPathGuarded,
  arrowheadLabelOverlapPenalty,
  slingshot,
} from '../../src/routing/slingshot.js';
import { NewOVGNode } from '../../src/routing/ovg-node.js';
import { NewOVGEdge } from '../../src/routing/ovg-edge.js';
import { OVG, buildOVGFromGraphWithGuard } from '../../src/routing/ovg.js';
import { defaultOVGBuildLimits, newOVGBuildGuard } from '../../src/routing/ovg-resource.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { newOVGEdgeRouterWithWorkLimit, RouteGenerationFlavor } from '../../src/routing/ovg-edge-router.js';
import { RouteSearchWorkGuard, MAX_ROUTE_SEARCH_WORK_UNITS } from '../../src/routing/route-guards.js';
const errContextCanceled = new Error('context canceled');

function buildTestOVG(graph) {
  const bg = backgroundWorkContext();
  const buildGuard = newOVGBuildGuard(bg, defaultOVGBuildLimits());
  return buildOVGFromGraphWithGuard(graph, null, buildGuard);
}

describe('Slingshot Routing', () => {
  describe('RouteChecker cache semantics', () => {
    it('caches successful results and avoids redundant checks', () => {
      let callCount = 0;
      const checker = new RouteChecker((from, to) => {
        callCount++;
        return from.X === to.X;
      });

      const n1 = new NewOVGNode(new Point(10, 20));
      const n2 = new NewOVGNode(new Point(10, 50));
      const n3 = new NewOVGNode(new Point(30, 50));

      expect(checker.check(n1, n2)).toBe(true);
      expect(callCount).toBe(1);

      // Subsequent check with same node pair must hit cache
      expect(checker.check(n1, n2)).toBe(true);
      expect(callCount).toBe(1);

      // Different pair invokes callback
      expect(checker.check(n1, n3)).toBe(false);
      expect(callCount).toBe(2);
      expect(checker.check(n1, n3)).toBe(false);
      expect(callCount).toBe(2);
    });

    it('newFallibleRouteChecker propagates errors without caching thrown errors', () => {
      let callCount = 0;
      let shouldThrow = true;

      const checker = newFallibleRouteChecker((from, to) => {
        callCount++;
        if (shouldThrow) {
          throw new Error('transient failure');
        }
        return true;
      });

      const n1 = new NewOVGNode(new Point(0, 0));
      const n2 = new NewOVGNode(new Point(10, 10));

      expect(() => checker.check(n1, n2)).toThrow('transient failure');
      expect(callCount).toBe(1);

      // When condition clears, retry should not use stale failed state
      shouldThrow = false;
      expect(checker.check(n1, n2)).toBe(true);
      expect(callCount).toBe(2);

      // Now cached
      expect(checker.check(n1, n2)).toBe(true);
      expect(callCount).toBe(2);
    });
  });

  describe('Flight plan & geometry helpers', () => {
    it('isOnFlightPlan correctly bounds intermediate points for TopLeft', () => {
      const prev = new Point(10, 10);
      const nextVertical = new Point(10, 30);
      const nextHorizontal = new Point(30, 10);

      expect(isOnFlightPlan(prev, nextVertical, Orientation.TopLeft, true)).toBe(true);
      expect(isOnFlightPlan(prev, nextHorizontal, Orientation.TopLeft, false)).toBe(true);
      expect(isOnFlightPlan(prev, new Point(10, 5), Orientation.TopLeft, true)).toBe(false);
    });

    it('preferLaunchingVertically correctly identifies vertical preference with launch space neighbors', () => {
      const g = new Graph();
      const src = new Node(1, 40, 40);
      src.TopLeft = new Point(0, 0);
      const tgt = new Node(2, 40, 40);
      tgt.TopLeft = new Point(20, 100);
      const neighbor = new Node(3, 40, 40);
      neighbor.TopLeft = new Point(100, 0); // horizontal neighbor
      g.AddNode(src);
      g.AddNode(tgt);
      g.AddNode(neighbor);

      g.Connect(src, tgt);
      g.Connect(src, neighbor);

      const [verticalPref, strongLaunchPref] = preferLaunchingVertically(src, tgt, Orientation.TopLeft);
      expect(verticalPref).toBe(true);
      expect(strongLaunchPref).toBe(true);
    });

    it('fillPathGuarded validates and constructs path between OVG nodes', () => {
      const ovg = new OVG();
      const n1 = new NewOVGNode(new Point(0, 0));
      const n2 = new NewOVGNode(new Point(0, 50));
      const n3 = new NewOVGNode(new Point(0, 100));
      ovg.AddNode(n1);
      ovg.AddNode(n2);
      ovg.AddNode(n3);
      ovg.Connect(n1, n2);
      ovg.Connect(n2, n3);

      const bg = backgroundWorkContext();
      const guard = new RouteSearchWorkGuard(bg, RouteGenerationFlavor.ShortestToLongest, MAX_ROUTE_SEARCH_WORK_UNITS);
      const fakeRouter = { work: guard, ovg };
      const [path1, ok1] = fillPathGuarded(fakeRouter, n1, n2);
      expect(ok1).toBe(true);
      expect(path1).not.toBeNull();
      expect(path1.length).toBe(1);
      expect(path1[0]).toBe(n1);

      const [path2, ok2] = fillPathGuarded(fakeRouter, n1, n3);
      expect(ok2).toBe(true);
      expect(path2).not.toBeNull();
      expect(path2.length).toBe(2);
      expect(path2[0]).toBe(n1);
      expect(path2[1]).toBe(n2);
    });
  });

  describe('Slingshot route generator integration', () => {
    it('returns empty route for non-diagonal nodes', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(100, 0); // straight horizontal
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

      const [nodes, dist, err] = slingshot(router, bg, edge);
      expect(err).toBeNull();
      expect(nodes).toBeNull(); // slingshot skips non-diagonal
      expect(dist).toBe(0);
    });

    it('finds valid L or S slingshot route for diagonal nodes', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(120, 120); // diagonal
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

      const [nodes, dist, err] = slingshot(router, bg, edge);
      expect(err).toBeNull();
      expect(nodes).not.toBeNull();
      expect(nodes.length).toBeGreaterThanOrEqual(4);
      expect(dist).toBeGreaterThan(0);
    });

    it('respects work budget limits during slingshot search', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(120, 120);
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

      const lowGuard = new RouteSearchWorkGuard(bg, RouteGenerationFlavor.ShortestToLongest, 1);
      router.work = lowGuard;
      expect(() => slingshot(router, bg, edge)).toThrow();
    });

    it('aborts on context cancellation', () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 40);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 40, 40);
      n2.TopLeft = new Point(120, 120);
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

      expect(() => slingshot(router, canceledCtx, edge)).toThrow();
    });
  });
});
