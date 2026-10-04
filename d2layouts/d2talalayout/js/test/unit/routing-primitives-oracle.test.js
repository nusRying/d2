// Slice 47 — replay of internal/routing/go_slice47_primitives_oracle_test.go.
// Every case carries its own inputs; every expected value comes from pinned Go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Cluster } from '../../src/graph/cluster.js';
import { Box } from '../../src/geometry/box.js';
import { Point } from '../../src/geometry/point.js';
import { normalizeLabelPosition, LabelPosition } from '../../src/graph/label-position.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { newRouteWorkGuard, newRouteSearchWorkGuard } from '../../src/routing/route-guards.js';
import { PriorityQueue } from '../../src/routing/priority-queue.js';
import { Route } from '../../src/routing/route.js';
import {
  estimateRouteCost, countNonSharedCrossings, isNonSharedCrossing, equalSigns, nonParallelIntersection,
} from '../../src/routing/cost.js';
import { orientation } from '../../src/routing/geometry.js';
import {
  captureRouteMutations, validateRouteStageGeometry, routeStageGraphBoundingBox, stableSortRouteValues,
  runAtomicRouteStage, runAtomicRouteStageAfterPreflight, runAtomicRouteStageWithGuard,
  runAtomicRouteStageWithValidatedGeometry,
} from '../../src/routing/route-stage.js';
import {
  portEdgesGuarded, edgeHasDuplicateInGuarded, filterEdgeAncestorsGuarded, sourceAndTargetClusterNodesGuarded,
  overlappingEdgesGuarded, edgeCanOverlapEdgesGuarded, positionedArrowheadLabelCostGuarded, edgeIsStraightGuarded,
  edgeHasOverlappingEndGuarded, reorderDuplicatesInEdgesGuarded, reverseEdgeRouteGuarded, traceToShapeBorderGuarded,
} from '../../src/routing/standalone-route-guard.js';
import { estimateRouteCostGuarded, routeIntersectsNodeGuarded } from '../../src/routing/cluster-route-guard.js';
import {
  removeDuplicatePointsGuarded, nodeSegmentsGuarded, edgeSegmentsGuarded, routeSegmentBounds,
  evenlyDistributeGuarded, checkBalanceOrder,
} from '../../src/routing/balance-route-guard.js';
import {
  balanceRegularEdgesGuarded, balanceReversalRemovesCrossings, isSpecialEdgeForBalancing,
} from '../../src/routing/postprocess-balance.js';
import { traceEdgesToShapeBorderWithWorkLimit } from '../../src/routing/trace.js';
import { MaxRoutePoints } from '../../src/routing/layoutgraph-route-support.js';
import { loadFixture, num, enc, countingContext } from './slice46-fixtures.js';

const fixture = loadFixture('go-slice47-primitives-reference.json');
const LOCATION = fixture.location;
const BIG = fixture.bigLimit;

// ─── Graph specs ─────────────────────────────────────────────────────────────

function newLabel(spec) {
  if (spec == null) return null;
  const lbl = new Label(spec.text, num(spec.w), num(spec.h));
  lbl.Position = spec.pos;
  return lbl;
}

function buildSpec(spec) {
  const g = new Graph();
  const nodes = new Map();
  const ids = new Map();
  let nextID = 0;
  const pointID = (p) => {
    if (p == null) return -1;
    if (ids.has(p)) return ids.get(p);
    const id = nextID++;
    ids.set(p, id);
    return id;
  };
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), num(ns.w), num(ns.h));
    n.setShape(ns.shape ?? '');
    if (!ns.unplaced) n.TopLeft = new Point(num(ns.x), num(ns.y));
    n.Is3D = Boolean(ns.is3d);
    n.IsMultiple = Boolean(ns.multiple);
    nodes.set(ns.id, n);
    if (ns.notInGraph) {
      n.Graph = g;
      continue;
    }
    g.addNewNodeToContainer(ns.container ? nodes.get(ns.container) : null, n);
  }
  const edges = [];
  for (const es of spec.edges ?? []) {
    const from = nodes.get(es.from);
    const to = nodes.get(es.to);
    const e = es.notInGraph ? new Edge(from, to) : g.connect(from, to);
    if (es.nilPoints) {
      e.Points = null;
    } else {
      e.Points = (es.points ?? []).map((p) => {
        if (p == null) return null;
        const point = new Point(num(p[0]), num(p[1]));
        pointID(point);
        return point;
      });
    }
    e.SourceArrowhead = es.src ?? '';
    e.TargetArrowhead = es.dst ?? '';
    e.Label = newLabel(es.label);
    e.SourceArrowheadLabel = newLabel(es.srcLabel);
    e.TargetArrowheadLabel = newLabel(es.dstLabel);
    if (es.fromCol != null) e.FromTableColumnIndex = es.fromCol;
    if (es.toCol != null) e.ToTableColumnIndex = es.toCol;
    if (es.stroke) e.Style = { Stroke: { Value: es.stroke } };
    if (es.curve) e.IsCurve = true;
    edges.push(e);
  }
  for (const cs of spec.clusters ?? []) {
    const cluster = new Cluster({
      Vessel: nodes.get(cs.vessel),
      Nodes: [],
      Arrangement: cs.arrangement,
      DesiredArrangement: cs.desired,
      Graph: g,
    });
    for (const id of cs.nodes) {
      cluster.Nodes.push(nodes.get(id));
      nodes.get(id).Cluster = cluster;
    }
    g.Clusters.set(cluster.Vessel, cluster);
  }
  for (const id of spec.trees ?? []) g.NodeToTree.set(nodes.get(id), {});
  if (spec.nilNode) g.Nodes.push(null);
  if (spec.nilEdge) g.Edges.push(null);

  const sg = {
    g, nodes, edges, pointID,
    edgeList: (indices) => (indices ?? []).map((i) => (i < 0 ? null : edges[i])),
    nodeList: (list) => (list ?? []).map((id) => nodes.get(id)),
    edgeIndex: (edge) => edges.indexOf(edge),
  };
  sg.route = (points) => (points ?? []).map((p) => (p == null ? null : [pointID(p), enc(p.X), enc(p.Y)]));
  sg.allRoutes = () => edges.map((e) => sg.route(e.Points));
  sg.edgeIndices = (list) => list.map((e) => sg.edgeIndex(e));
  sg.others = (args) => (args.allEdges ? g.Edges : sg.edgeList(args.others));
  sg.state = () => {
    const costs = g.RoutingCosts();
    const ordered = [...nodes.keys()].sort((a, b) => a - b);
    return {
      cell: enc(g.CellSize),
      costs: [enc(costs.Crossing), enc(costs.Turn), enc(costs.NonCenterPort)],
      nodes: ordered.map((id) => {
        const n = nodes.get(id);
        return [id, encPoint(n.TopLeft), n.Graph === g];
      }),
      edges: edges.map((e) => ({
        route: sg.route(e.Points),
        nil: e.Points == null,
        label: e.Label == null ? null : [enc(e.Label.Width), enc(e.Label.Height), normalizeLabelPosition(e.Label.Position)],
        curve: Boolean(e.IsCurve),
      })),
    };
  };
  return sg;
}

function encPoint(p) {
  return p == null ? null : [enc(p.X), enc(p.Y)];
}

function pt(p) {
  return new Point(num(p[0]), num(p[1]));
}

function buildRoutes(sg, specs) {
  return (specs ?? []).map((rs) => new Route({
    GEdge: sg.edges[rs.edge],
    OVGNodes: (rs.points ?? []).map((p) => ({ Point: pt(p) })),
    FromPort: rs.from == null ? null : pt(rs.from),
    ToPort: rs.to == null ? null : pt(rs.to),
  }));
}

function clusterMap(sg, ids) {
  if (ids == null) return null;
  const map = new Map();
  for (const id of ids) map.set(sg.nodes.get(id), true);
  return map;
}

function sortedIDs(map) {
  return [...map.keys()].map((n) => Number(n.ID)).sort((a, b) => a - b);
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mutateEverything(sg) {
  const { g } = sg;
  g.CellSize = 4321;
  g.RestoreRoutingCosts({ Crossing: 7, Turn: 8, NonCenterPort: 9 });
  for (const e of sg.edges) {
    const points = e.Points ?? [];
    for (const p of points) {
      if (p != null) {
        p.X += 1000;
        p.Y -= 1000;
      }
    }
    for (let i = 0, j = points.length - 1; i < j; i++, j--) {
      [points[i], points[j]] = [points[j], points[i]];
    }
    if (e.Label != null) {
      e.Label.Width = 999;
      e.Label.Position = LabelPosition.UnlockedBottom;
    }
    e.Points = [new Point(-1, -1), new Point(-2, -2)];
    e.IsCurve = !e.IsCurve;
  }
  for (const id of [...sg.nodes.keys()].sort((a, b) => a - b)) {
    const n = sg.nodes.get(id);
    if (n.TopLeft != null) n.TopLeft.X += 5;
    n.TopLeft = new Point(id * -3, 77);
    n.Graph = null;
  }
}

// ─── Guard runs ──────────────────────────────────────────────────────────────

function guardRun(ctx, limit, op) {
  let guard;
  try {
    guard = newRouteWorkGuard(ctx, LOCATION, limit);
  } catch (err) {
    return { value: null, used: 0, err: err.message };
  }
  try {
    const value = op(guard);
    return { value: value === undefined ? null : value, used: guard.used, err: '' };
  } catch (err) {
    return { value: null, used: guard.used, err: err.message };
  }
}

function sweepRun(build) {
  const sweep = { full: guardRun(backgroundWorkContext(), BIG, build()), cancel: [] };
  if (sweep.full.err === '' && sweep.full.used > 0) {
    const under = guardRun(backgroundWorkContext(), sweep.full.used - 1, build());
    under.value = null;
    sweep.under = under;
  }
  for (let at = 1; at <= 3; at++) {
    const run = guardRun(countingContext(at), BIG, build());
    sweep.cancel.push({ at, used: run.used, err: run.err });
  }
  return sweep;
}

function guardedOp(c) {
  return () => {
    const sg = buildSpec(c.spec ?? {});
    const a = c.args;
    switch (c.op) {
      case 'portEdges':
        return (guard) => {
          const map = portEdgesGuarded(sg.g.Edges, sg.nodes.get(a.node), guard);
          const list = [...map.entries()];
          list.sort((l, r) => (l[0].X !== r[0].X ? (l[0].X < r[0].X ? -1 : 1) : (l[0].Y < r[0].Y ? -1 : l[0].Y > r[0].Y ? 1 : 0)));
          return list.map(([p, edges]) => [enc(p.X), enc(p.Y), sg.edgeIndices(edges)]);
        };
      case 'edgeHasDuplicateIn':
        return (guard) => edgeHasDuplicateInGuarded(sg.edges[a.edge], sg.edgeList(a.others), guard);
      case 'filterEdgeAncestors':
        return (guard) => filterEdgeAncestorsGuarded(sg.edges[a.edge], sg.g.Nodes, guard).map((n) => Number(n.ID));
      case 'clusterNodes':
        return (guard) => {
          const [src, dst] = sourceAndTargetClusterNodesGuarded(sg.g, sg.nodes.get(a.source), sg.nodes.get(a.target), guard);
          return { src: sortedIDs(src), dst: sortedIDs(dst) };
        };
      case 'overlappingEdges':
        return (guard) => sg.edgeIndices(overlappingEdgesGuarded(pt(a.start), pt(a.end), sg.others(a), guard));
      case 'edgeCanOverlap':
        return (guard) => edgeCanOverlapEdgesGuarded(sg.edges[a.edge], sg.others(a), clusterMap(sg, a.srcCluster), clusterMap(sg, a.dstCluster), guard);
      case 'arrowheadCost':
        return (guard) => {
          const toLabel = (b) => ({
            Box: new Box(new Point(num(b.x), num(b.y)), num(b.w), num(b.h)),
            Edge: sg.edges[b.edge],
            IsTarget: b.target,
            Text: b.text,
          });
          const labels = (a.labels ?? []).map(toLabel);
          return enc(positionedArrowheadLabelCostGuarded(toLabel(a.positioned), sg.nodeList(a.nodes), labels, buildRoutes(sg, a.routes), sg.edgeList(a.others), guard));
        };
      case 'edgeIsStraight':
        return (guard) => edgeIsStraightGuarded(sg.edges[a.edge], guard);
      case 'overlappingEnd':
        return (guard) => edgeHasOverlappingEndGuarded(sg.edges[a.edge], guard);
      case 'reorderDuplicates':
        return (guard) => {
          reorderDuplicatesInEdgesGuarded(a.edges != null ? sg.edgeList(a.edges) : sg.g.Edges, guard);
          return sg.allRoutes();
        };
      case 'reverse':
        return (guard) => {
          reverseEdgeRouteGuarded(sg.edges[a.edge], guard);
          return sg.allRoutes();
        };
      case 'trace':
        return (guard) => {
          const edge = sg.edges[a.edge];
          traceToShapeBorderGuarded(edge, guard);
          return { routes: sg.allRoutes(), from: encPoint(edge.From.TopLeft), to: encPoint(edge.To.TopLeft) };
        };
      case 'intersectsNode':
        return (guard) => routeIntersectsNodeGuarded(sg.nodeList(a.nodes), sg.edges[a.edge], guard);
      case 'routeCostGuarded':
        return (guard) => enc(estimateRouteCostGuarded(sg.others(a), sg.edges[a.edge], guard));
      case 'removeDuplicates':
        return (guard) => {
          let points = null;
          if (a.points != null) {
            points = a.points.map((p) => {
              const point = pt(p);
              sg.pointID(point);
              return point;
            });
          }
          const out = removeDuplicatePointsGuarded(points, guard);
          return { nil: out == null, route: sg.route(out) };
        };
      case 'nodeSegments':
        return (guard) => {
          const nodes = sg.nodeList(a.nodes);
          return nodeSegmentsGuarded(nodes, a.isH, guard).map((s, i) => [
            enc(s.Start.X), enc(s.Start.Y), enc(s.End.X), enc(s.End.Y), s.Start === nodes[Math.floor(i / 2)].TopLeft,
          ]);
        };
      case 'edgeSegments':
        return (guard) => edgeSegmentsGuarded(sg.edgeList(a.edges), a.isH, guard)
          .map((s) => [sg.pointID(s.Start), sg.pointID(s.End), sg.edgeIndex(s.edge)]);
      case 'segmentBounds':
        return (guard) => {
          const segments = [];
          const points = a.points ?? [];
          for (let i = 0; i + 1 < points.length; i += 2) segments.push({ Start: pt(points[i]), End: pt(points[i + 1]) });
          const [floor, ceil] = routeSegmentBounds({ Start: pt(a.start), End: pt(a.end) }, segments, num(a.buffer), guard);
          return [enc(floor), enc(ceil)];
        };
      case 'distribute':
        return (guard) => evenlyDistributeGuarded(num(a.floor), num(a.ceil), a.count, guard).map(enc);
      case 'balanceOrder':
      case 'reversal':
        return (guard) => {
          const all = edgeSegmentsGuarded(sg.edgeList(a.edges), !a.isH, newRouteWorkGuard(backgroundWorkContext(), LOCATION, BIG));
          const batch = (a.batch ?? []).map((i) => all[i]);
          const batchSet = new Set(batch);
          const proposed = (a.proposed ?? []).map(num);
          if (c.op === 'reversal') return balanceReversalRemovesCrossings(sg.g, batch, proposed, a.isH, guard);
          return checkBalanceOrder(batch, batchSet, all, proposed, a.isH, guard);
        };
      case 'balanceRegular':
        return (guard) => {
          balanceRegularEdgesGuarded(sg.g, sg.edgeList(a.special), sg.edgeList(a.regular), guard);
          return sg.allRoutes();
        };
      case 'reserveSort':
        return (guard) => {
          guard.reserveSort(a.count);
          return null;
        };
      case 'canSwap':
        return (guard) => {
          const routes = buildRoutes(sg, a.routes);
          return routes[a.batch[0]].canSwapEdgesGuarded(routes[a.batch[1]], routes, guard);
        };
      case 'capture':
        return (guard) => {
          const before = sg.state();
          const snapshot = captureRouteMutations(sg.g, sg.edgeList(a.extras), guard);
          mutateEverything(sg);
          const mutated = sg.state();
          snapshot.restore();
          const after = sg.state();
          return {
            nodes: snapshot.nodes.size,
            edges: snapshot.edges.size,
            changed: !sameJSON(before, mutated),
            restored: sameJSON(before, after),
          };
        };
      case 'validate':
        return (guard) => {
          let extras = sg.edgeList(a.extras);
          if (a.extraCount > 0) extras = new Array(a.extraCount).fill(null);
          if (a.hugeRoute) {
            const huge = new Edge(sg.edges[0].From, sg.edges[0].To);
            huge.Points = new Array(MaxRoutePoints + 1).fill(null);
            extras.push(huge);
          }
          validateRouteStageGeometry(sg.g, extras, guard);
          return null;
        };
      case 'bbox':
        return (guard) => {
          const [tl, br] = routeStageGraphBoundingBox(sg.g, guard);
          return [enc(tl.X), enc(tl.Y), enc(br.X), enc(br.Y)];
        };
      case 'sort':
        return (guard) => {
          const values = (a.values ?? []).map((v) => ({ k: num(v.k), id: v.id }));
          stableSortRouteValues(values, (x, y) => x.k < y.k, guard);
          return values.map((v) => v.id);
        };
      default:
        throw new Error(`unknown guarded op ${c.op}`);
    }
  };
}

// ─── Atomic scripts ──────────────────────────────────────────────────────────

function runScript(sg, script, guard) {
  for (const op of script ?? []) {
    switch (op.op) {
      case 'point': {
        const p = sg.edges[op.e].Points[op.i];
        p.X = num(op.x);
        p.Y = num(op.y);
        break;
      }
      case 'replace':
        sg.edges[op.e].Points = op.pts.map(pt);
        break;
      case 'swap': {
        const e = sg.edges[op.e];
        const f = sg.edges[op.f];
        [e.Points, f.Points] = [f.Points, e.Points];
        break;
      }
      case 'reverse': {
        const points = sg.edges[op.e].Points;
        for (let i = 0, j = points.length - 1; i < j; i++, j--) [points[i], points[j]] = [points[j], points[i]];
        break;
      }
      case 'label':
        sg.edges[op.e].Label.Width = num(op.v);
        break;
      case 'cell':
        sg.g.CellSize = num(op.v);
        break;
      case 'costs': {
        const v = num(op.v);
        sg.g.RestoreRoutingCosts({ Crossing: v, Turn: v + 1, NonCenterPort: v + 2 });
        break;
      }
      case 'move':
        sg.nodes.get(op.n).TopLeft = new Point(num(op.x), num(op.y));
        break;
      case 'nudge':
        sg.nodes.get(op.n).TopLeft.X += num(op.x);
        break;
      case 'graph':
        sg.nodes.get(op.n).Graph = null;
        break;
      case 'curve':
        sg.edges[op.e].IsCurve = true;
        break;
      case 'step':
        guard.step();
        break;
      case 'add':
        guard.add(num(op.v));
        break;
      case 'fail':
        throw new Error('slice47 callback failure');
      case 'panic':
        // A Go panic value: rethrown unchanged after rollback.
        throw 'slice47 callback panic'; // eslint-disable-line no-throw-literal
      default:
        throw new Error(`unknown script op ${op.op}`);
    }
  }
}

function runAtomic(c) {
  const sg = buildSpec(c.spec);
  const a = c.args;
  const ctx = a.cancelAt > 0 ? countingContext(a.cancelAt) : backgroundWorkContext();
  const limit = a.limit === 0 ? BIG : a.limit;
  const extras = sg.edgeList(a.extras);
  const before = sg.state();
  const out = { err: '', panic: '', used: 0, ran: false, changed: false };
  let seen = null;
  const fn = (guard) => {
    seen = guard;
    out.ran = true;
    runScript(sg, a.script, guard);
  };
  try {
    switch (a.entry) {
      case 'stage':
        runAtomicRouteStage(ctx, LOCATION, sg.g, extras, limit, fn);
        break;
      case 'afterPreflight':
        runAtomicRouteStageAfterPreflight(ctx, LOCATION, sg.g, extras, limit, fn);
        break;
      case 'withGuard':
      case 'validated': {
        const guard = newRouteWorkGuard(ctx, LOCATION, limit);
        seen = guard;
        if (a.entry === 'withGuard') runAtomicRouteStageWithGuard(sg.g, extras, guard, fn);
        else runAtomicRouteStageWithValidatedGeometry(sg.g, extras, guard, fn);
        break;
      }
      case 'trace':
        traceEdgesToShapeBorderWithWorkLimit(ctx, sg.g, limit);
        break;
      default:
        throw new Error(`unknown entry ${a.entry}`);
    }
  } catch (thrown) {
    if (thrown instanceof Error) out.err = thrown.message;
    else out.panic = String(thrown);
  }
  if (seen != null) out.used = seen.used;
  out.state = sg.state();
  out.changed = !sameJSON(before, out.state);
  return out;
}

// ─── Non-guarded evaluations ─────────────────────────────────────────────────

function evaluate(c) {
  const a = c.args;
  switch (c.op) {
    case 'routeCost': {
      const sg = buildSpec(c.spec);
      return enc(estimateRouteCost(sg.others(a), sg.edges[a.edge]));
    }
    case 'crossingMatrix': {
      const sg = buildSpec(c.spec);
      const matrix = sg.edges.map((e) => sg.edges.map((o) => countNonSharedCrossings(e, o)));
      const pairs = [];
      sg.edges.forEach((e, i) => sg.edges.forEach((o, j) => {
        for (let p = 0; p < e.Points.length - 1; p++) {
          for (let q = 0; q < o.Points.length - 1; q++) {
            if (isNonSharedCrossing(e, o, p, q)) pairs.push([i, j, p, q]);
          }
        }
      }));
      return { matrix, pairs };
    }
    case 'signs': {
      const out = [];
      const pts = a.points;
      for (let i = 0; i + 3 < pts.length; i += 4) {
        const [p0, p1, p2, p3] = [pt(pts[i]), pt(pts[i + 1]), pt(pts[i + 2]), pt(pts[i + 3])];
        const o1 = orientation(p0, p1, p2);
        const o2 = orientation(p0, p1, p3);
        out.push([nonParallelIntersection(p0, p1, p2, p3), equalSigns(o1, o2), enc(o1), enc(o2)]);
      }
      return out;
    }
    case 'segmentEndpoints': {
      const sg = buildSpec(c.spec);
      return buildRoutes(sg, a.routes)[0].createSegmentEndpoints().map(encPoint);
    }
    case 'colinear': {
      const sg = buildSpec(c.spec);
      const route = buildRoutes(sg, a.routes)[0];
      const out = [];
      for (let i = 0; i + 1 < a.points.length; i += 2) {
        const from = { Point: pt(a.points[i]) };
        const to = { Point: pt(a.points[i + 1]) };
        out.push([route.isEntireColinear(from, to), route.isOpposingColinear(from, to)]);
      }
      return out;
    }
    case 'special': {
      const sg = buildSpec(c.spec);
      return sg.edges.map((e) => isSpecialEdgeForBalancing(sg.g, e));
    }
    case 'atomic':
      return runAtomic(c);
    case 'edgeCanOverlapSearch': {
      const sg = buildSpec(c.spec);
      const run = (ctx, limit) => {
        let guard;
        try {
          guard = newRouteSearchWorkGuard(ctx, 'TopDownLeftRight', limit);
        } catch (err) {
          return { value: null, used: 0, err: err.message };
        }
        try {
          const value = edgeCanOverlapEdgesGuarded(sg.edges[a.edge], sg.edgeList(a.others), null, null, guard);
          return { value, used: guard.used, err: '' };
        } catch (err) {
          return { value: null, used: guard.used, err: err.message };
        }
      };
      return {
        background: run(backgroundWorkContext(), BIG),
        done: run(new WorkContext({ isCancelled: () => false, doneAvailable: true }), BIG),
        under: run(backgroundWorkContext(), 5),
        canceled: run(new WorkContext({ isCancelled: () => true, doneAvailable: true }), BIG),
      };
    }
    default:
      return sweepRun(guardedOp(c));
  }
}

// ─── Priority queue replay ───────────────────────────────────────────────────

const errBudget = new Error('slice47 budget exhausted');

function runPQ(c) {
  const queue = new PriorityQueue();
  let budget = null;
  if (c.limit > 0) {
    budget = {
      used: 0,
      limit: c.limit,
      step() { this.add(1); },
      add(units) {
        if (units > this.limit - this.used) throw errBudget;
        this.used += units;
      },
      check() {},
    };
  }
  const registry = new Map();
  const entries = [];
  const idOf = (entry) => {
    if (entry == null) return -1;
    if (registry.has(entry)) return registry.get(entry);
    registry.set(entry, entries.length);
    entries.push(entry);
    return entries.length - 1;
  };
  const out = [];
  for (const op of c.ops) {
    const res = { entry: -1, priority: 0, h: false, order: 0, err: '', used: 0, items: null, indices: null, empty: false };
    let entry = null;
    try {
      switch (op.op) {
        case 'push':
          entry = queue.push(num(op.p), null, op.h, budget);
          break;
        case 'pop':
          entry = queue.pop(budget);
          break;
        case 'decrease':
          queue.decrease(op.ref >= 0 ? entries[op.ref] : null, num(op.p), budget);
          break;
        case 'reset':
          queue.reset();
          break;
        default:
          throw new Error(`unknown pq op ${op.op}`);
      }
    } catch (err) {
      res.err = err.message;
    }
    if (entry != null) {
      res.entry = idOf(entry);
      res.priority = enc(entry.priority);
      res.h = entry.isHorizontal;
      res.order = entry.order;
    }
    if (budget != null) res.used = budget.used;
    if (!c.compact) {
      res.items = queue.items.map(idOf);
      res.indices = queue.items.map((item) => item.index);
    }
    res.empty = queue.empty();
    out.push(res);
  }
  return out;
}

describe('routing primitives Go oracle (slice 47)', () => {
  it('has a non-trivial fixture', () => {
    expect(fixture.pq.length).toBeGreaterThan(10);
    expect(fixture.cases.length).toBeGreaterThan(200);
  });

  describe('priority queue', () => {
    for (const c of fixture.pq) {
      it(c.name, () => {
        expect(runPQ(c)).toEqual(c.out);
      });
    }
  });

  for (const group of [...new Set(fixture.cases.map((c) => c.group))]) {
    describe(group, () => {
      for (const c of fixture.cases.filter((x) => x.group === group)) {
        it(c.name, () => {
          expect(evaluate(c)).toEqual(c.out);
        });
      }
    });
  }
});
