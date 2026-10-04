// Slice 47 — Slingshot fast route heuristics (L and S shapes around anchors).
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/slingshot.go
//
// TERMINOLOGY:
// ============
//   - Vertical Launch:
//     In any diagonal orientation, there are two L shapes.
//     A "vertical launch" is the one that starts vertically.
//   - Anchor:
//     The anchor is the OVG node used to turn/slingshot.

import { Point } from '../geometry/point.js';
import { euclideanDistance } from '../geometry/math.js';
import { Orientation, isDiagonal, getOpposite } from '../geometry/orientation.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { idealTurnAxes } from './turns.js';
import { NewOVGEdge } from './ovg-edge.js';
import { filterEdgeAncestorsGuarded } from './standalone-route-guard.js';
import { routeIntersectsNodeGuarded } from './cluster-route-guard.js';
import { edgeCanOverlapEdgesGuarded } from './standalone-route-guard.js';

const LABEL_PADDING = 5;

function nonNilEquals(p1, p2) {
  if (p1 == null || p2 == null) {
    return false;
  }
  return p1.X === p2.X && p1.Y === p2.Y;
}

/**
 * launch simulates the route blasting off from source, going around the anchor, and landing on target.
 * Returns distance if successful, or 0.0 if it collided with a node.
 */
export function launch(router, source, anchor, target, gEdge) {
  const nodes = router.ovg.NodesInsideBoundingBox;

  gEdge.Points = [source.Point, anchor.Point];
  const intersects1 = routeIntersectsNodeGuarded(nodes, gEdge, router.work);
  if (intersects1) {
    return 0.0;
  }

  gEdge.Points = [target.Point, anchor.Point];
  const intersects2 = routeIntersectsNodeGuarded(nodes, gEdge, router.work);
  if (intersects2) {
    return 0.0;
  }

  const d = euclideanDistance(source.X, source.Y, anchor.X, anchor.Y) +
            euclideanDistance(target.X, target.Y, anchor.X, anchor.Y);
  return d;
}

export function findLaunchings(router, isVerticalLaunch, orientation, gSource) {
  const ovg = router.ovg;
  let direction = Orientation.None;
  switch (orientation) {
    case Orientation.TopLeft:
      direction = isVerticalLaunch ? Orientation.Bottom : Orientation.Right;
      break;
    case Orientation.TopRight:
      direction = isVerticalLaunch ? Orientation.Bottom : Orientation.Left;
      break;
    case Orientation.BottomLeft:
      direction = isVerticalLaunch ? Orientation.Top : Orientation.Right;
      break;
    case Orientation.BottomRight:
      direction = isVerticalLaunch ? Orientation.Top : Orientation.Left;
      break;
  }
  if (direction === Orientation.None) {
    return [];
  }

  const ports = ovg.Ports.get(gSource) ?? [];
  const out = [];
  const seen = new Set();
  for (const port of ports) {
    if (seen.has(port)) {
      continue;
    }
    seen.add(port);
    if (port.hasPortDirection(gSource, direction)) {
      out.push(port);
    }
  }
  return out;
}

export function findLandings(router, isVerticalLaunch, orientation, gTarget) {
  const ovg = router.ovg;
  let direction = Orientation.None;
  switch (orientation) {
    case Orientation.TopLeft:
      direction = isVerticalLaunch ? Orientation.Left : Orientation.Top;
      break;
    case Orientation.TopRight:
      direction = isVerticalLaunch ? Orientation.Right : Orientation.Top;
      break;
    case Orientation.BottomLeft:
      direction = isVerticalLaunch ? Orientation.Left : Orientation.Bottom;
      break;
    case Orientation.BottomRight:
      direction = isVerticalLaunch ? Orientation.Right : Orientation.Bottom;
      break;
  }
  if (direction === Orientation.None) {
    return [];
  }

  const ports = ovg.Ports.get(gTarget) ?? [];
  const out = [];
  const seen = new Set();
  for (const port of ports) {
    if (seen.has(port)) {
      continue;
    }
    seen.add(port);
    if (port.hasPortDirection(gTarget, direction)) {
      out.push(port);
    }
  }
  return out;
}

export function undershot(n, target, orientation, isVerticalLaunch) {
  switch (orientation) {
    case Orientation.TopLeft:
      if (isVerticalLaunch && n.Y < target.TopLeft.Y) {
        return true;
      } else if (!isVerticalLaunch && n.X < target.TopLeft.X) {
        return true;
      }
      break;
    case Orientation.TopRight:
      if (isVerticalLaunch && n.Y < target.TopLeft.Y) {
        return true;
      } else if (!isVerticalLaunch && n.X > target.TopLeft.X + target.Width) {
        return true;
      }
      break;
    case Orientation.BottomLeft:
      if (isVerticalLaunch && n.Y > target.TopLeft.Y + target.Height) {
        return true;
      } else if (!isVerticalLaunch && n.X < target.TopLeft.X) {
        return true;
      }
      break;
    case Orientation.BottomRight:
      if (isVerticalLaunch && n.Y > target.TopLeft.Y + target.Height) {
        return true;
      } else if (!isVerticalLaunch && n.X > target.TopLeft.X + target.Width) {
        return true;
      }
      break;
  }
  return false;
}

export function overshot(n, target, orientation, isVerticalLaunch, forLRoute) {
  switch (orientation) {
    case Orientation.TopLeft:
      if (isVerticalLaunch) {
        if (forLRoute && n.Y > target.TopLeft.Y + target.Height) return true;
        if (!forLRoute && n.Y > target.TopLeft.Y) return true;
      } else {
        if (forLRoute && n.X > target.TopLeft.X + target.Width) return true;
        if (!forLRoute && n.X > target.TopLeft.X) return true;
      }
      break;
    case Orientation.TopRight:
      if (isVerticalLaunch) {
        if (forLRoute && n.Y > target.TopLeft.Y + target.Height) return true;
        if (!forLRoute && n.Y > target.TopLeft.Y) return true;
      } else {
        if (forLRoute && n.X < target.TopLeft.X) return true;
        if (!forLRoute && n.X < target.TopLeft.X + target.Width) return true;
      }
      break;
    case Orientation.BottomLeft:
      if (isVerticalLaunch) {
        if (forLRoute && n.Y < target.TopLeft.Y) return true;
        if (!forLRoute && n.Y < target.TopLeft.Y + target.Height) return true;
      } else {
        if (forLRoute && n.X > target.TopLeft.X + target.Width) return true;
        if (!forLRoute && n.X > target.TopLeft.X) return true;
      }
      break;
    case Orientation.BottomRight:
      if (isVerticalLaunch) {
        if (forLRoute && n.Y < target.TopLeft.Y) return true;
        if (!forLRoute && n.Y < target.TopLeft.Y + target.Height) return true;
      } else {
        if (forLRoute && n.X < target.TopLeft.X) return true;
        if (!forLRoute && n.X < target.TopLeft.X + target.Width) return true;
      }
      break;
  }
  return false;
}

export function isOnFlightPlan(prev, next, orientation, isVerticalLaunch) {
  switch (orientation) {
    case Orientation.TopLeft:
      if (isVerticalLaunch && next.X === prev.X && next.Y > prev.Y) return true;
      if (!isVerticalLaunch && next.Y === prev.Y && next.X > prev.X) return true;
      break;
    case Orientation.TopRight:
      if (isVerticalLaunch && next.X === prev.X && next.Y > prev.Y) return true;
      if (!isVerticalLaunch && next.Y === prev.Y && next.X < prev.X) return true;
      break;
    case Orientation.BottomLeft:
      if (isVerticalLaunch && next.X === prev.X && next.Y < prev.Y) return true;
      if (!isVerticalLaunch && next.Y === prev.Y && next.X > prev.X) return true;
      break;
    case Orientation.BottomRight:
      if (isVerticalLaunch && next.X === prev.X && next.Y < prev.Y) return true;
      if (!isVerticalLaunch && next.Y === prev.Y && next.X < prev.X) return true;
      break;
  }
  return false;
}

export function preferLaunchingVertically(gSource, gTarget, orientation) {
  let numInVerticalLaunchSpace = 0;
  let numInHorizontalLaunchSpace = 0;

  let verticalSpaceSourceOrientations = [];
  let verticalSpaceTargetOrientations = [];
  let horizontalSpaceSourceOrientations = [];
  let horizontalSpaceTargetOrientations = [];

  switch (orientation) {
    case Orientation.TopLeft:
      verticalSpaceSourceOrientations = [Orientation.BottomLeft, Orientation.Bottom];
      verticalSpaceTargetOrientations = [Orientation.Left, Orientation.BottomLeft];
      horizontalSpaceSourceOrientations = [Orientation.TopRight, Orientation.Right];
      horizontalSpaceTargetOrientations = [Orientation.Top, Orientation.TopRight];
      break;
    case Orientation.TopRight:
      verticalSpaceSourceOrientations = [Orientation.BottomRight, Orientation.Bottom];
      verticalSpaceTargetOrientations = [Orientation.Right, Orientation.BottomRight];
      horizontalSpaceSourceOrientations = [Orientation.TopLeft, Orientation.Left];
      horizontalSpaceTargetOrientations = [Orientation.Top, Orientation.TopLeft];
      break;
    case Orientation.BottomLeft:
      verticalSpaceSourceOrientations = [Orientation.TopLeft, Orientation.Top];
      verticalSpaceTargetOrientations = [Orientation.Left, Orientation.TopLeft];
      horizontalSpaceSourceOrientations = [Orientation.BottomRight, Orientation.Right];
      horizontalSpaceTargetOrientations = [Orientation.Bottom, Orientation.BottomRight];
      break;
    case Orientation.BottomRight:
      verticalSpaceSourceOrientations = [Orientation.TopRight, Orientation.Top];
      verticalSpaceTargetOrientations = [Orientation.Right, Orientation.TopRight];
      horizontalSpaceSourceOrientations = [Orientation.BottomLeft, Orientation.Left];
      horizontalSpaceTargetOrientations = [Orientation.Bottom, Orientation.BottomLeft];
      break;
  }

  for (const e of gSource.Edges ?? []) {
    const adj = gSource.Adjacent(e);
    if (adj === gTarget) continue;
    const o = adj.Orientation(gSource);
    if (o === Orientation.None) continue;
    if (verticalSpaceSourceOrientations.includes(o)) {
      numInVerticalLaunchSpace++;
    }
    if (horizontalSpaceSourceOrientations.includes(o)) {
      numInHorizontalLaunchSpace++;
    }
  }

  for (const e of gTarget.Edges ?? []) {
    const adj = gTarget.Adjacent(e);
    if (adj === gSource) continue;
    const o = adj.Orientation(gTarget);
    if (o === Orientation.None) continue;
    if (verticalSpaceTargetOrientations.includes(o)) {
      numInVerticalLaunchSpace++;
    } else if (horizontalSpaceTargetOrientations.includes(o)) {
      numInHorizontalLaunchSpace++;
    }
  }

  if (numInVerticalLaunchSpace === numInHorizontalLaunchSpace) {
    const sID = BigInt(gSource.ID != null ? gSource.ID : 0);
    const tID = BigInt(gTarget.ID != null ? gTarget.ID : 0);
    return [sID < tID, false];
  }
  return [numInVerticalLaunchSpace < numInHorizontalLaunchSpace, true];
}

export function fillPathGuarded(router, from, to) {
  const out = [from];
  let curr = from;
  while (true) {
    router.work.step();
    const prev = curr;
    for (const edge of curr.Edges ?? []) {
      router.work.step();
      const adjacent = curr.Adjacent(edge);
      let onPath = false;
      if (from.X === to.X && adjacent.X === curr.X) {
        onPath = (from.Y < to.Y && curr.Y < adjacent.Y) || (from.Y > to.Y && curr.Y > adjacent.Y);
      } else if (from.Y === to.Y && adjacent.Y === curr.Y) {
        onPath = (from.X < to.X && curr.X < adjacent.X) || (from.X > to.X && curr.X > adjacent.X);
      }
      if (onPath) {
        curr = adjacent;
        break;
      }
    }
    if (curr === prev) {
      return [null, false];
    }
    if (curr === to) {
      break;
    }
    out.push(curr);
  }
  return [out, true];
}

export class RouteChecker {
  constructor(compute) {
    this.mem = new Map();
    this.compute = compute;
  }

  cacheCheck(from, to) {
    const row = this.mem.get(from);
    if (row && row.has(to)) {
      return [row.get(to), true];
    }
    return [false, false];
  }

  check(from, to) {
    const [cached, hit] = this.cacheCheck(from, to);
    if (hit) {
      return cached;
    }
    let row = this.mem.get(from);
    if (!row) {
      row = new Map();
      this.mem.set(from, row);
    }
    const val = this.compute(from, to);
    row.set(to, val);
    return val;
  }
}

export function newFallibleRouteChecker(compute) {
  return new RouteChecker(compute);
}

export function arrowheadLabelOverlapPenalty(router, gEdge, route) {
  if (gEdge.SourceArrowheadLabel == null && gEdge.TargetArrowheadLabel == null) {
    return 0;
  }

  const routePoints = [];
  for (let i = 1; i < route.length - 1; i++) {
    router.work.step();
    routePoints.push(route[i].Point);
  }

  const nonAncestors = filterEdgeAncestorsGuarded(gEdge, router.graph.Nodes, router.work);

  let penalty = 0;
  if (gEdge.SourceArrowheadLabel != null) {
    const pal = PositionArrowheadLabel(gEdge, false, routePoints);
    const cost = positionedArrowheadLabelCost(
      pal,
      nonAncestors,
      router.positionedLabels,
      router.routes,
      null,
      router.work
    );
    penalty += cost;
  }
  if (gEdge.TargetArrowheadLabel != null) {
    const pal = PositionArrowheadLabel(gEdge, true, routePoints);
    const cost = positionedArrowheadLabelCost(
      pal,
      nonAncestors,
      router.positionedLabels,
      router.routes,
      null,
      router.work
    );
    penalty += cost;
  }
  return penalty;
}

export function positionedArrowheadLabelCost(pal, nodes, labels, routes, edges, guard) {
  for (const other of labels ?? []) {
    if (pal.Edge === other.Edge && pal.IsTarget === other.IsTarget) {
      continue;
    }
    if (pal.Box.Overlaps(other.Box)) {
      if (pal.Text === other.Text) {
        continue;
      }
      return Infinity;
    }
  }

  const graph = pal.Edge.From.Graph;
  const fakeLabelNode = {
    Box: pal.Box,
    Graph: graph,
  };

  let overlapCount = 0;
  for (const node of nodes ?? []) {
    if (guard != null) guard.step();
    const box = node.Box;
    if (box != null && pal.Box.Overlaps(box, LABEL_PADDING)) {
      overlapCount++;
    }
  }
  let penalty = 4 * graph.TurnCost() * overlapCount;

  let overlappingEdgeCount = 0;
  for (const route of routes ?? []) {
    if (route.GEdge === pal.Edge) {
      continue;
    }
    const ovgNodes = route.OVGNodes ?? [];
    for (let i = 1; i < ovgNodes.length; i++) {
      if (guard != null) guard.step();
      const p1 = ovgNodes[i - 1].Point;
      const p2 = ovgNodes[i].Point;
      if (pal.Box.OverlapsLine(p1, p2, 0)) {
        overlappingEdgeCount++;
        break;
      }
    }
  }
  for (const edge of edges ?? []) {
    if (edge === pal.Edge) {
      continue;
    }
    const pts = edge.Points ?? [];
    for (let i = 1; i < pts.length; i++) {
      if (guard != null) guard.step();
      if (pal.Box.OverlapsLine(pts[i - 1], pts[i], 0)) {
        overlappingEdgeCount++;
        break;
      }
    }
  }
  penalty += graph.TurnCost() * overlappingEdgeCount;
  return penalty;
}

export function slingshot(router, ctx, gEdge) {
  router.bindWork(ctx);
  router.work.step();

  const gSource = gEdge.From;
  const gTarget = gEdge.To;

  if (gSource.Cluster != null || gTarget.Cluster != null) {
    return [null, 0.0, null];
  }

  const orientation = gSource.Orientation(gTarget);
  if (orientation === Orientation.None) {
    return [null, 0.0, null];
  }
  if (typeof gEdge.HasTableColumn === 'function' ? gEdge.HasTableColumn() : (gEdge.FromTableColumnIndex != null || gEdge.ToTableColumnIndex != null)) {
    return [null, 0.0, null];
  }
  if (!isDiagonal(orientation)) {
    return [null, 0.0, null];
  }

  const occupiedRouteChecker = newFallibleRouteChecker((from, to) => {
    const overlappingEdges = [];
    const overlappingRoutes = router.findOverlappingRoutes(from, to);
    for (const route of overlappingRoutes) {
      router.work.reserveProduct(route.OVGNodes.length + 1, 2);
      overlappingEdges.push(route.GEdge);
      if (gEdge.IsDirected() && route.isOpposingColinear(from, to)) {
        return true;
      }
    }
    const canOverlap = edgeCanOverlapEdgesGuarded(gEdge, overlappingEdges, null, null, router.work);
    return overlappingEdges.length > 0 && !canOverlap;
  });

  const crossedRouteChecker = newFallibleRouteChecker((from, to) => {
    return router.edgeSet.intersectsWithGuarded(NewOVGEdge(from, to), router.work);
  });

  let shortestPath = null;
  let shortestFlight = Infinity;

  let order = [false, true];
  router.work.reserveSum(gSource.Edges?.length ?? 0, gTarget.Edges?.length ?? 0);
  const [verticalPref, strongLaunchPref] = preferLaunchingVertically(gSource, gTarget, orientation);
  if (verticalPref) {
    order = [true, false];
  }

  const isBetweenTableColumns = typeof gEdge.IsBetweenTableColumns === 'function'
    ? gEdge.IsBetweenTableColumns()
    : (gEdge.FromTableColumnIndex != null && gEdge.ToTableColumnIndex != null);

  if (!isBetweenTableColumns) {
    const [lPath, lFlight] = findLShapedRoute(
      router,
      ctx,
      router.routes,
      order,
      verticalPref,
      strongLaunchPref,
      gEdge,
      orientation,
      occupiedRouteChecker,
      crossedRouteChecker
    );
    if (lFlight !== Infinity) {
      return [lPath, lFlight + router.turnCost, null];
    }
  }

  const [sPath, sFlight] = findSShapedRoute(
    router,
    ctx,
    order,
    verticalPref,
    strongLaunchPref,
    gEdge,
    orientation,
    occupiedRouteChecker,
    crossedRouteChecker
  );
  return [sPath, sFlight, null];
}

export function findLShapedRoute(
  router,
  ctx,
  routes,
  order,
  verticalPref,
  strongLaunchPref,
  gEdge,
  orientation,
  occupiedRouteChecker,
  crossedRouteChecker
) {
  router.bindWork(ctx);
  router.work.step();

  const gSource = gEdge.From;
  const gTarget = gEdge.To;

  const source = router.ovg.Centers.get(gSource);
  const target = router.ovg.Centers.get(gTarget);

  let shortestPath = null;
  let shortestFlight = Infinity;

  // Temporary edge for collision queries
  const gEdgeCopy = {
    From: gSource,
    To: gTarget,
    Points: [],
  };

  for (const isVerticalLaunch of order) {
    router.work.step();
    if (isVerticalLaunch && gEdge.FromTableColumnIndex != null) {
      continue;
    }
    let sourcePorts = [];
    let targetPorts = [];
    if (gEdge.FromTableColumnIndex == null) {
      router.work.add((router.ovg.Ports.get(gSource) ?? []).length);
      sourcePorts = findLaunchings(router, isVerticalLaunch, orientation, gSource);
    }
    if (gEdge.ToTableColumnIndex == null) {
      router.work.add((router.ovg.Ports.get(gTarget) ?? []).length);
      targetPorts = findLandings(router, isVerticalLaunch, orientation, gTarget);
    }
    const hasTableColumn = typeof gEdge.HasTableColumn === 'function' ? gEdge.HasTableColumn() : (gEdge.FromTableColumnIndex != null || gEdge.ToTableColumnIndex != null);
    if (hasTableColumn && router.tablePorts) {
      const [sPorts, tPorts] = router.tablePorts(gEdge, gSource, gTarget, true);
      for (const [port] of (sPorts instanceof Map ? sPorts : Object.entries(sPorts))) {
        sourcePorts.push(port);
      }
      for (const [port] of (tPorts instanceof Map ? tPorts : Object.entries(tPorts))) {
        targetPorts.push(port);
      }
    }

    for (const sPort of sourcePorts) {
      router.work.step();
      let curr = sPort;
      while (true) {
        router.work.step();
        let next = null;
        for (const e of curr.Edges ?? []) {
          router.work.step();
          const adj = curr.Adjacent(e);
          if (isOnFlightPlan(curr, adj, orientation, isVerticalLaunch)) {
            next = adj;
            break;
          }
        }
        if (next == null || overshot(next, gTarget, orientation, isVerticalLaunch, true)) {
          break;
        }
        const occupied = occupiedRouteChecker.check(curr, next);
        if (occupied) {
          break;
        }
        curr = next;
        if (undershot(next, gTarget, orientation, isVerticalLaunch)) {
          continue;
        }

        for (const tPort of targetPorts) {
          router.work.step();
          if (isVerticalLaunch && next.Y !== tPort.Y) {
            continue;
          }
          if (!isVerticalLaunch && next.X !== tPort.X) {
            continue;
          }

          let d = launch(router, sPort, next, tPort, gEdgeCopy);
          if (d === 0.0) {
            continue;
          }

          let crossed = crossedRouteChecker.check(sPort, next);
          if (crossed) {
            d += router.crossingCost;
          }
          crossed = crossedRouteChecker.check(next, tPort);
          if (crossed) {
            d += router.crossingCost;
          }

          if (strongLaunchPref) {
            if (verticalPref && !isVerticalLaunch) {
              d += router.crossingCost / 2.0;
            }
            if (!verticalPref && isVerticalLaunch) {
              d += router.crossingCost / 2.0;
            }
          }

          if (d < shortestFlight) {
            const path = [source];
            const [p1, ok1] = fillPathGuarded(router, sPort, next);
            if (!ok1) continue;
            for (const n of p1) path.push(n);

            const [p2, ok2] = fillPathGuarded(router, next, tPort);
            if (!ok2) continue;
            p2.push(tPort);

            let badShare = false;
            for (let i = 0; i < p2.length - 2; i++) {
              router.work.step();
              const c = p2[i];
              const nxt = p2[i + 1];
              const occ = occupiedRouteChecker.check(c, nxt);
              if (occ) {
                badShare = true;
                break;
              }
            }
            if (badShare) continue;

            for (const n of p2) path.push(n);
            path.push(target);

            // Duplicate route check
            let duplicateRoute = false;
            for (const r of routes ?? []) {
              router.work.step();
              if (nonNilEquals(r.FromPort, sPort.Point) && nonNilEquals(r.ToPort, tPort.Point) && (r.OVGNodes?.length ?? 0) === path.length) {
                let isDuplicate = true;
                for (let i = 2; i < path.length - 2; i++) {
                  router.work.step();
                  if (!nonNilEquals(r.OVGNodes[i].Point, path[i].Point)) {
                    isDuplicate = false;
                    break;
                  }
                }
                if (isDuplicate) {
                  duplicateRoute = true;
                  break;
                }
              }
            }
            if (duplicateRoute) continue;

            const labelPenalty = arrowheadLabelOverlapPenalty(router, gEdge, path);
            d += labelPenalty;
            if (d < shortestFlight) {
              shortestFlight = d;
              shortestPath = path;
            }
          }
        }
      }
    }
  }

  return [shortestPath, shortestFlight];
}

export function findSShapedRoute(
  router,
  ctx,
  order,
  verticalPref,
  strongLaunchPref,
  gEdge,
  orientation,
  occupiedRouteChecker,
  crossedRouteChecker
) {
  router.bindWork(ctx);
  router.work.step();

  const gSource = gEdge.From;
  const gTarget = gEdge.To;

  const source = router.ovg.Centers.get(gSource);
  const target = router.ovg.Centers.get(gTarget);

  let shortestPath = null;
  let shortestFlight = Infinity;

  const gEdgeCopy = {
    From: gSource,
    To: gTarget,
    Points: [],
  };

  const nodes = router.ovg.NodesInsideBoundingBox;

  for (const isVerticalLaunch of order) {
    router.work.step();
    let sourcePorts = [];
    let targetPorts = [];
    if (isVerticalLaunch && gEdge.FromTableColumnIndex != null) {
      continue;
    }
    if (gEdge.FromTableColumnIndex == null) {
      router.work.add((router.ovg.Ports.get(gSource) ?? []).length);
      sourcePorts = findLaunchings(router, isVerticalLaunch, orientation, gSource);
    }
    if (gEdge.ToTableColumnIndex == null) {
      router.work.add((router.ovg.Ports.get(gTarget) ?? []).length);
      targetPorts = findLandings(router, !isVerticalLaunch, orientation, gTarget);
    }
    const hasTableColumn = typeof gEdge.HasTableColumn === 'function' ? gEdge.HasTableColumn() : (gEdge.FromTableColumnIndex != null || gEdge.ToTableColumnIndex != null);
    if (hasTableColumn && router.tablePorts) {
      const [sPorts, tPorts] = router.tablePorts(gEdge, gSource, gTarget, true);
      for (const [port] of (sPorts instanceof Map ? sPorts : Object.entries(sPorts))) {
        sourcePorts.push(port);
      }
      for (const [port] of (tPorts instanceof Map ? tPorts : Object.entries(tPorts))) {
        targetPorts.push(port);
      }
    }

    const sourceAnchors = new Map();
    const targetAnchors = new Map();
    const sAnchorOrder = [];
    const tAnchorOrder = [];

    for (const sPort of sourcePorts) {
      router.work.step();
      let curr = sPort;
      while (true) {
        router.work.step();
        let next = null;
        for (const e of curr.Edges ?? []) {
          router.work.step();
          const adj = curr.Adjacent(e);
          if (isOnFlightPlan(curr, adj, orientation, isVerticalLaunch)) {
            next = adj;
            break;
          }
        }
        if (next == null) break;
        if (overshot(next, gTarget, orientation, isVerticalLaunch, false)) break;

        const occupied = occupiedRouteChecker.check(curr, next);
        if (occupied) break;

        sourceAnchors.set(next, sPort);
        sAnchorOrder.push(next);
        curr = next;
      }
    }

    for (const tPort of targetPorts) {
      router.work.step();
      let curr = tPort;
      while (true) {
        router.work.step();
        let next = null;
        for (const e of curr.Edges ?? []) {
          router.work.step();
          const adj = curr.Adjacent(e);
          if (isOnFlightPlan(curr, adj, getOpposite(orientation), isVerticalLaunch)) {
            next = adj;
            break;
          }
        }
        if (next == null) break;
        if (overshot(next, gSource, getOpposite(orientation), isVerticalLaunch, false)) break;

        const occupied = occupiedRouteChecker.check(curr, next);
        if (occupied) break;

        targetAnchors.set(next, tPort);
        tAnchorOrder.push(next);
        curr = next;
      }
    }

    const axes = idealTurnAxes(gSource, gTarget);
    router.work.reserveSort(sAnchorOrder.length);
    sAnchorOrder.sort((a, b) => {
      let aDistance = 0;
      let bDistance = 0;
      if (isVerticalLaunch) {
        const idealY = axes[1]?.val ?? (axes[0]?.val ?? 0);
        aDistance = Math.abs(a.Y - idealY);
        bDistance = Math.abs(b.Y - idealY);
      } else {
        const idealX = axes[0]?.val ?? 0;
        aDistance = Math.abs(a.X - idealX);
        bDistance = Math.abs(b.X - idealX);
      }
      if (aDistance < bDistance) return -1;
      if (bDistance < aDistance) return 1;
      return 0;
    });

    for (const sAnchor of sAnchorOrder) {
      router.work.step();
      const sPort = sourceAnchors.get(sAnchor);
      for (const tAnchor of tAnchorOrder) {
        router.work.step();
        const tPort = targetAnchors.get(tAnchor);
        if (isVerticalLaunch && sAnchor.Y !== tAnchor.Y) {
          continue;
        }
        if (!isVerticalLaunch && sAnchor.X !== tAnchor.X) {
          continue;
        }

        let d = 0.0;
        const pairs = [
          [sPort, sAnchor],
          [sAnchor, tAnchor],
          [tAnchor, tPort],
        ];
        let intersects = false;
        for (const pair of pairs) {
          router.work.step();
          gEdgeCopy.Points = [pair[0].Point, pair[1].Point];
          const intersectsNode = routeIntersectsNodeGuarded(nodes, gEdgeCopy, router.work);
          if (intersectsNode) {
            intersects = true;
            break;
          }
          d += euclideanDistance(pair[0].X, pair[0].Y, pair[1].X, pair[1].Y);
          const crossed = crossedRouteChecker.check(pair[0], pair[1]);
          if (crossed) {
            d += router.crossingCost;
          }
        }
        if (intersects) continue;

        if (strongLaunchPref) {
          if (verticalPref && !isVerticalLaunch) {
            d += router.crossingCost / 2.0;
          }
          if (!verticalPref && isVerticalLaunch) {
            d += router.crossingCost / 2.0;
          }
        }

        if (d < shortestFlight) {
          const path = [source];
          const [p1, ok1] = fillPathGuarded(router, sPort, sAnchor);
          if (!ok1) continue;
          for (const n of p1) path.push(n);

          const [p2, ok2] = fillPathGuarded(router, sAnchor, tAnchor);
          if (!ok2) continue;
          p2.push(tAnchor);

          let badShare = false;
          for (let i = 0; i < p2.length - 2; i++) {
            router.work.step();
            const c = p2[i];
            const nxt = p2[i + 1];
            const occ = occupiedRouteChecker.check(c, nxt);
            if (occ) {
              badShare = true;
              break;
            }
          }
          if (badShare) continue;

          for (let i = 0; i < p2.length - 1; i++) {
            path.push(p2[i]);
          }

          const [p3, ok3] = fillPathGuarded(router, tAnchor, tPort);
          if (!ok3) continue;
          for (const n of p3) path.push(n);
          path.push(tPort);
          path.push(target);

          const labelPenalty = arrowheadLabelOverlapPenalty(router, gEdge, path);
          d += labelPenalty;
          if (d < shortestFlight) {
            shortestFlight = d;
            shortestPath = path;
          }
        }
      }
    }
  }

  if (shortestFlight !== Infinity) {
    shortestFlight += router.turnCost * 2;
  }

  return [shortestPath, shortestFlight];
}
