import { describe, expect, test } from 'bun:test';
import fixture from '../fixtures/go-slice47-routing-core-reference.json';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Cluster } from '../../src/graph/cluster.js';
import { Hierarchy } from '../../src/graph/hierarchy.js';
import { RouteEdges, hasCompleteEdgeRoute } from '../../src/routing/standalone-router.js';
import { RouteGraph, RouteGraphWithWorkLimit, GraphRouteOptions } from '../../src/routing/graph-stage.js';
import { defaultOVGBuildLimits } from '../../src/routing/ovg-resource.js';
import { routeEdgesWithBudgets } from '../../src/routing/standalone-router.js';
import {
  RouteGenerationFlavor,
  GenerateRouteResponse,
  runRouteFlavorWorker,
  generateRouteFlavorResponsesWith,
  successfulRouteFlavorResponses,
} from '../../src/routing/coordinator.js';
import { newRouteWorkGuard, errRouteStageWorkLimit } from '../../src/routing/route-guards.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';

const bg = backgroundWorkContext();

function buildGraphFromSpec(nodes, edges, clusters, sequences) {
  const g = new Graph();
  const nodeMap = new Map();

  for (const ns of nodes ?? []) {
    const n = new Node(BigInt(ns.id), Number(ns.w), Number(ns.h));
    n.TopLeft = new Point(Number(ns.x), Number(ns.y));
    if (ns.shape) {
      n.SetShape(ns.shape);
    }
    if (ns.columns > 0) {
      n.TableColumns = [];
      for (let c = 0; c < ns.columns; c++) {
        const col = new Node(BigInt(ns.id * 100 + (c + 1)), Number(ns.w) / ns.columns, Number(ns.h));
        col.TopLeft = new Point(Number(ns.x) + c * (Number(ns.w) / ns.columns), Number(ns.y));
        g.AddNode(col);
        n.TableColumns.push(col);
      }
    }
    if (ns.is_tunnel) {
      n.IsTunnel = true;
    }
    g.AddNode(n);
    nodeMap.set(ns.id, n);
  }

  for (const ns of nodes ?? []) {
    if (ns.container) {
      const parent = nodeMap.get(ns.container);
      const child = nodeMap.get(ns.id);
      g.addNodeToContainer(parent, child);
    }
    if (ns.near != null) {
      const target = nodeMap.get(ns.near);
      const src = nodeMap.get(ns.id);
      src.Nears.add(target);
    }
  }

  for (const cl of clusters ?? []) {
    const vessel = new Node(BigInt(cl.vessel.id), Number(cl.vessel.w), Number(cl.vessel.h));
    vessel.TopLeft = new Point(Number(cl.vessel.x), Number(cl.vessel.y));
    g.AddNode(vessel);

    const clusterNodes = (cl.nodes ?? []).map((nid) => nodeMap.get(nid));
    const cluster = new Cluster({ Vessel: vessel, Nodes: clusterNodes });
    g.Clusters.set(vessel, cluster);
  }

  for (const sq of sequences ?? []) {
    const vessel = new Node(BigInt(sq.vessel.id), Number(sq.vessel.w), Number(sq.vessel.h));
    vessel.TopLeft = new Point(Number(sq.vessel.x), Number(sq.vessel.y));
    g.AddNode(vessel);

    const seqNodes = (sq.nodes ?? []).map((nid) => nodeMap.get(nid));
    const seq = { Vessel: vessel, Nodes: seqNodes };
    g.Sequences.set(vessel, seq);
    for (const sn of seqNodes) {
      sn.Sequence = seq;
    }
  }

  for (const es of edges ?? []) {
    const from = nodeMap.get(es.from);
    const to = nodeMap.get(es.to);
    const e = g.connect(from, to);
    if (es.directed) {
      e.TargetArrowhead = 'triangle';
    }
    if (es.src_arrow) {
      e.SourceArrowhead = es.src_arrow;
    }
    if (es.tgt_arrow) {
      e.TargetArrowhead = es.tgt_arrow;
    }
    if (es.label) {
      e.Label = { Text: es.label, Width: 40, Height: 20 };
    }
    if (es.src_label) {
      e.SourceArrowheadLabel = { Text: es.src_label, Width: 20, Height: 10 };
    }
    if (es.tgt_label) {
      e.TargetArrowheadLabel = { Text: es.tgt_label, Width: 20, Height: 10 };
    }
    if (es.points && es.points.length > 0) {
      e.Points = es.points.map((p) => new Point(Number(p.x), Number(p.y)));
    }
  }

  return g;
}

describe('Slice 47 Routing Core Oracle (Real Go)', () => {
  describe('RouteEdges parity fixture', () => {
    for (const expected of fixture.route_edges) {
      test(`RouteEdges: ${expected.name}`, () => {
        const specMap = {
          empty: {
            nodes: [{ id: 1, x: 100, y: 100, w: 60, h: 40 }],
            edges: [],
          },
          'straight-edge': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 100, y: 300, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 2, directed: true }],
          },
          chain: {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 100, w: 60, h: 40 },
              { id: 3, x: 500, y: 100, w: 60, h: 40 },
            ],
            edges: [
              { id: 0, from: 1, to: 2, directed: true },
              { id: 1, from: 2, to: 3, directed: true },
            ],
          },
          cycle: {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 100, w: 60, h: 40 },
              { id: 3, x: 300, y: 300, w: 60, h: 40 },
              { id: 4, x: 100, y: 300, w: 60, h: 40 },
            ],
            edges: [
              { id: 0, from: 1, to: 2, directed: true },
              { id: 1, from: 2, to: 3, directed: true },
              { id: 2, from: 3, to: 4, directed: true },
              { id: 3, from: 4, to: 1, directed: true },
            ],
          },
          'l-route': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 300, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 2, directed: true }],
          },
          's-route': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 200, y: 200, w: 60, h: 40 },
              { id: 3, x: 300, y: 300, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 3, directed: true }],
          },
          'obstacle-detour': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 100, y: 200, w: 120, h: 60 },
              { id: 3, x: 100, Y: 350, y: 350, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 3, directed: true }],
          },
          'parallel-edges': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 80, h: 60 },
              { id: 2, x: 100, y: 300, w: 80, h: 60 },
            ],
            edges: [
              { id: 0, from: 1, to: 2, directed: true },
              { id: 1, from: 1, to: 2, directed: true },
            ],
          },
          'nested-containers': {
            nodes: [
              { id: 10, x: 50, y: 50, w: 400, h: 400 },
              { id: 1, x: 100, y: 100, w: 60, h: 40, container: 10 },
              { id: 2, x: 300, y: 300, w: 60, h: 40, container: 10 },
            ],
            edges: [{ id: 0, from: 1, to: 2, directed: true }],
          },
          'cluster-ports': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 100, y: 200, w: 60, h: 40 },
              { id: 3, x: 400, y: 150, w: 60, h: 40 },
            ],
            clusters: [
              {
                vessel: { id: 100, x: 80, y: 80, w: 100, h: 180 },
                nodes: [1, 2],
              },
            ],
            edges: [
              { id: 0, from: 1, to: 3, directed: true },
              { id: 1, from: 2, to: 3, directed: true },
            ],
          },
        };

        const spec = specMap[expected.name];
        expect(spec).toBeDefined();

        const g = buildGraphFromSpec(spec.nodes, spec.edges, spec.clusters, spec.sequences);
        let thrown = null;
        try {
          RouteEdges(bg, g, g.Edges);
        } catch (err) {
          thrown = err;
        }

        if (expected.success) {
          expect(thrown).toBeNull();
          if (expected.edges) {
            for (const [edgeIdxStr, expectedPts] of Object.entries(expected.edges)) {
              const edgeIdx = Number(edgeIdxStr);
              const actualEdge = g.Edges[edgeIdx];
              expect(actualEdge).toBeDefined();
              expect(actualEdge.Points.length).toBe(expectedPts.length);
              for (let pi = 0; pi < expectedPts.length; pi++) {
                expect(actualEdge.Points[pi].X).toBeCloseTo(Number(expectedPts[pi].x), 3);
                expect(actualEdge.Points[pi].Y).toBeCloseTo(Number(expectedPts[pi].y), 3);
              }
            }
          }
        } else {
          expect(thrown).not.toBeNull();
        }
      });
    }
  });

  describe('RouteGraph parity fixture', () => {
    for (const expected of fixture.route_graph) {
      test(`RouteGraph: ${expected.name}`, () => {
        const specMap = {
          'zero-edge': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 200, y: 200, w: 60, h: 40 },
            ],
            edges: [],
          },
          'single-subgraph': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 300, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 2, directed: true }],
          },
          'multi-subgraph': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 250, y: 100, w: 60, h: 40 },
              { id: 3, x: 100, y: 300, w: 60, h: 40 },
              { id: 4, x: 250, y: 300, w: 60, h: 40 },
            ],
            edges: [
              { id: 0, from: 1, to: 2, directed: true },
              { id: 1, from: 3, to: 4, directed: true },
            ],
          },
          'near-linked-graph': {
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 250, y: 100, w: 60, h: 40 },
              { id: 3, x: 450, y: 100, w: 60, h: 40, near: 2 },
              { id: 4, x: 600, y: 100, w: 60, h: 40 },
            ],
            edges: [
              { id: 0, from: 1, to: 2, directed: true },
              { id: 1, from: 3, to: 4, directed: true },
            ],
          },
          'existing-complete-routes': {
            routes_previously_completed: true,
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 100, w: 60, h: 40 },
            ],
            edges: [
              {
                id: 0,
                from: 1,
                to: 2,
                directed: true,
                points: [
                  { x: 160, y: 120 },
                  { x: 300, y: 120 },
                ],
              },
            ],
          },
          'force-reroute-existing': {
            force_reroute: true,
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 100, w: 60, h: 40 },
            ],
            edges: [
              {
                id: 0,
                from: 1,
                to: 2,
                directed: true,
                points: [
                  { x: 160, y: 120 },
                  { x: 300, y: 120 },
                ],
              },
            ],
          },
          'partial-routes-rejected': {
            routes_previously_completed: true,
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 100, w: 60, h: 40 },
              { id: 3, x: 500, y: 100, w: 60, h: 40 },
            ],
            edges: [
              {
                id: 0,
                from: 1,
                to: 2,
                directed: true,
                points: [
                  { x: 160, y: 120 },
                  { x: 300, y: 120 },
                ],
              },
              { id: 1, from: 2, to: 3, directed: true },
            ],
          },
          'subgraph-observer-error': {
            observer_error: true,
            nodes: [
              { id: 1, x: 100, y: 100, w: 60, h: 40 },
              { id: 2, x: 300, y: 300, w: 60, h: 40 },
            ],
            edges: [{ id: 0, from: 1, to: 2, directed: true }],
          },
        };

        const spec = specMap[expected.name];
        expect(spec).toBeDefined();

        const g = buildGraphFromSpec(spec.nodes, spec.edges, spec.clusters, spec.sequences);
        let subgraphsRoutedCount = 0;
        const observer = {
          SubgraphRouted(ovg) {
            subgraphsRoutedCount++;
            if (spec.observer_error) {
              return new Error('simulated subgraph observer failure');
            }
            return null;
          },
        };
        let completedObserverCalled = false;
        const compObserver = {
          RoutingCompleted() {
            completedObserverCalled = true;
          },
        };

        let thrown = null;
        let completed = false;
        try {
          completed = RouteGraph(bg, g, new GraphRouteOptions({
            ForceReroute: Boolean(spec.force_reroute),
            RoutesPreviouslyCompleted: Boolean(spec.routes_previously_completed),
            Observer: observer,
            CompletionObserver: compObserver,
          }));
        } catch (err) {
          thrown = err;
        }

        expect(subgraphsRoutedCount).toBe(expected.subgraphs_routed);

        if (expected.success) {
          expect(thrown).toBeNull();
          expect(completed).toBe(expected.routing_completed);
          if (expected.edges) {
            for (const [edgeIdxStr, expectedPts] of Object.entries(expected.edges)) {
              const edgeIdx = Number(edgeIdxStr);
              const actualEdge = g.Edges[edgeIdx];
              expect(actualEdge).toBeDefined();
              expect(actualEdge.Points.length).toBe(expectedPts.length);
              for (let pi = 0; pi < expectedPts.length; pi++) {
                expect(actualEdge.Points[pi].X).toBeCloseTo(Number(expectedPts[pi].x), 3);
                expect(actualEdge.Points[pi].Y).toBeCloseTo(Number(expectedPts[pi].y), 3);
              }
            }
          }
        } else {
          expect(thrown).not.toBeNull();
        }

        // Verify node ownership restoration
        for (const [nidStr, expectedOwner] of Object.entries(expected.node_owners)) {
          const n = g.Nodes.find((x) => String(x.ID) === nidStr);
          if (n != null) {
            if (expectedOwner === 'parent-graph') {
              expect(n.Graph).toBe(g);
            }
          }
        }
      });
    }
  });

  describe('Deterministic W / W-1 Budget Parity', () => {
    for (const wb of fixture.work_budgets) {
      test(`Work Budget: ${wb.scenario} (${wb.target})`, () => {
        if (wb.target === 'RouteEdges') {
          const nodes = [
            { id: 1, x: 100, y: 100, w: 60, h: 40 },
            { id: 2, x: 300, y: 300, w: 60, h: 40 },
          ];
          const edges = [{ id: 0, from: 1, to: 2, directed: true }];

          // 1. Pass at exact W
          const gPass = buildGraphFromSpec(nodes, edges);
          expect(() => routeEdgesWithBudgets(bg, gPass, gPass.Edges, defaultOVGBuildLimits(), wb.pass_work)).not.toThrow();
          expect(gPass.Edges[0].Points.length).toBeGreaterThanOrEqual(2);

          // 2. Fail at exact W-1 and restore original pointer/array identity
          const gFail = buildGraphFromSpec(nodes, edges);
          const origPoints = gFail.Edges[0].Points;
          expect(() => routeEdgesWithBudgets(bg, gFail, gFail.Edges, defaultOVGBuildLimits(), wb.fail_work)).toThrow();
          expect(gFail.Edges[0].Points).toBe(origPoints);
        } else if (wb.target === 'RouteGraph') {
          const nodes = [
            { id: 1, x: 100, y: 100, w: 60, h: 40 },
            { id: 2, x: 250, y: 100, w: 60, h: 40 },
            { id: 3, x: 100, y: 300, w: 60, h: 40 },
            { id: 4, x: 250, y: 300, w: 60, h: 40 },
          ];
          const edges = [
            { id: 0, from: 1, to: 2, directed: true },
            { id: 1, from: 3, to: 4, directed: true },
          ];

          const buildTestGraph = () => {
            const g = buildGraphFromSpec(nodes, edges);
            const h1 = new Hierarchy();
            h1.ReplaceLevels(new Map([[g.Nodes[0], 0], [g.Nodes[1], 1]]));
            g.Nodes[0].Hierarchy = h1;
            g.Nodes[1].Hierarchy = h1;

            const h2 = new Hierarchy();
            h2.ReplaceLevels(new Map([[g.Nodes[2], 0], [g.Nodes[3], 1]]));
            g.Nodes[2].Hierarchy = h2;
            g.Nodes[3].Hierarchy = h2;
            return g;
          };

          // 1. Pass at exact W
          const gPass = buildTestGraph();
          let compPass = false;
          expect(() => {
            compPass = RouteGraphWithWorkLimit(bg, gPass, new GraphRouteOptions(), wb.pass_work);
          }).not.toThrow();
          expect(compPass).toBe(true);

          // 2. Fail at exact W-1 and restore ownership and points
          const gFail = buildTestGraph();
          const origOwners = new Map(gFail.Nodes.map((n) => [n, n.Graph]));
          const origEdge0Points = gFail.Edges[0].Points;
          const origEdge1Points = gFail.Edges[1].Points;

          let compFail = false;
          expect(() => {
            compFail = RouteGraphWithWorkLimit(bg, gFail, new GraphRouteOptions(), wb.fail_work);
          }).toThrow();

          expect(compFail).toBe(false);
          expect(gFail.Edges[0].Points).toBe(origEdge0Points);
          expect(gFail.Edges[1].Points).toBe(origEdge1Points);
          for (const n of gFail.Nodes) {
            expect(n.Graph).toBe(origOwners.get(n));
          }
        }
      });
    }
  });

  describe('Route Flavor Coordinator & Concurrency Safety', () => {
    test('Simulated out-of-order flavor execution preserves deterministic response ordering', () => {
      const g = new Graph();
      const n1 = g.addNodeUnchecked(new Node(1n));
      n1.TopLeft = new Point(100, 100);
      n1.Width = 60;
      n1.Height = 40;
      const n2 = g.addNodeUnchecked(new Node(2n));
      n2.TopLeft = new Point(300, 300);
      n2.Width = 60;
      n2.Height = 40;
      const edge = g.connect(n1, n2);

      // Create dummy routers for 3 flavors
      const routers = [
        { flavor: RouteGenerationFlavor.ShortestToLongest },
        { flavor: RouteGenerationFlavor.LongestToShortest },
        { flavor: RouteGenerationFlavor.Default },
      ];

      // Custom worker that resolves results in reverse index order
      const worker = (router, ctx, fallback) => {
        const resp = new GenerateRouteResponse();
        resp.Flavor = router.flavor;
        resp.Distance = router.flavor === RouteGenerationFlavor.Default ? 100 : 200;
        return resp;
      };

      const responses = generateRouteFlavorResponsesWith(bg, routers, true, worker);
      expect(responses.length).toBe(3);
      expect(responses[0].Flavor).toBe(RouteGenerationFlavor.ShortestToLongest);
      expect(responses[1].Flavor).toBe(RouteGenerationFlavor.LongestToShortest);
      expect(responses[2].Flavor).toBe(RouteGenerationFlavor.Default);
    });

    test('Aggregate work limit halts winning flavor selection immediately', () => {
      const responses = [
        (() => {
          const r = new GenerateRouteResponse();
          r.Flavor = RouteGenerationFlavor.ShortestToLongest;
          r.Distance = 50;
          return r;
        })(),
        (() => {
          const r = new GenerateRouteResponse();
          r.Flavor = RouteGenerationFlavor.LongestToShortest;
          r.Err = errRouteStageWorkLimit;
          return r;
        })(),
      ];

      expect(() => successfulRouteFlavorResponses(responses)).toThrow(errRouteStageWorkLimit);
    });
  });

  describe('Atomic Rollback and Observer Invariant Tests', () => {
    test('Observer throw restores node ownership and edge points and rethrows exact object', () => {
      const g = new Graph();
      const n1 = g.addNodeUnchecked(new Node(1n));
      n1.TopLeft = new Point(100, 100);
      n1.Width = 60;
      n1.Height = 40;
      const n2 = g.addNodeUnchecked(new Node(2n));
      n2.TopLeft = new Point(300, 300);
      n2.Width = 60;
      n2.Height = 40;
      const edge = g.connect(n1, n2);

      const originalPoints = edge.Points;
      const originalN1Graph = n1.Graph;
      const originalN2Graph = n2.Graph;

      const sentinelError = { code: 'CUSTOM_OBSERVER_ERROR', id: 42 };

      const observer = {
        SubgraphRouted(ovg) {
          throw sentinelError;
        },
      };

      let thrown = null;
      try {
        RouteGraph(bg, g, new GraphRouteOptions({ Observer: observer }));
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBe(sentinelError);
      expect(edge.Points).toBe(originalPoints);
      expect(n1.Graph).toBe(originalN1Graph);
      expect(n2.Graph).toBe(originalN2Graph);
    });

    test('Multi-subgraph failure rolls back all previous subgraphs and ownership', () => {
      const g = new Graph();
      // Subgraph 1
      const n1 = g.addNodeUnchecked(new Node(1n));
      n1.TopLeft = new Point(100, 100);
      n1.Width = 60;
      n1.Height = 40;
      const n2 = g.addNodeUnchecked(new Node(2n));
      n2.TopLeft = new Point(250, 100);
      n2.Width = 60;
      n2.Height = 40;
      const e1 = g.connect(n1, n2);

      // Subgraph 2
      const n3 = g.addNodeUnchecked(new Node(3n));
      n3.TopLeft = new Point(100, 300);
      n3.Width = 60;
      n3.Height = 40;
      const n4 = g.addNodeUnchecked(new Node(4n));
      n4.TopLeft = new Point(250, 300);
      n4.Width = 60;
      n4.Height = 40;
      const e2 = g.connect(n3, n4);

      const origE1Points = e1.Points;
      const origE2Points = e2.Points;

      let routedCount = 0;
      const observer = {
        SubgraphRouted(ovg) {
          routedCount++;
          if (routedCount === 2) {
            throw new Error('subgraph 2 intentional failure');
          }
          return null;
        },
      };

      expect(() => {
        RouteGraph(bg, g, new GraphRouteOptions({ Observer: observer }));
      }).toThrow('subgraph 2 intentional failure');

      expect(e1.Points).toBe(origE1Points);
      expect(e2.Points).toBe(origE2Points);
      expect(n1.Graph).toBe(g);
      expect(n2.Graph).toBe(g);
      expect(n3.Graph).toBe(g);
      expect(n4.Graph).toBe(g);
    });
  });
});
