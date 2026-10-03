import { Point } from "../geometry/point.js";
import { goRound } from "../geometry/math.js";
import { Edge } from "../graph/edge.js";
import { Validate } from "../graph/topology-preflight.js";
import {
  MAX_ENGINE_WORK_UNITS,
  MAX_GRAPH_SIZE,
  MAX_OPTIMIZATION_WORK_UNITS,
} from "../limits/constants.js";
import { WorkGuard } from "../limits/work-guard.js";
import { OptimizationWorkGuard } from "../limits/optimization.js";
import { getContextError } from "../limits/work-context.js";
import { EdgeLengthOptions, nodesEdgeLength } from "../placementcost/edge-length.js";
import { nodesSymmetry } from "../placementcost/symmetry.js";
import {
  snapshotNodePositionsContext,
  restoreNodePositions,
  nonNilEquals,
  roundToPreviousCellSize,
} from "./types.js";
import { LayoutAxis, axisValid, axisIsHorizontal } from "./axis.js";
import { moveNodeToBest } from "./moves.js";

export const MAX_COMPACTION_CANDIDATE_COUNT = MAX_GRAPH_SIZE + 3;

function idCompare(a, b) {
  const ai = BigInt(a.ID);
  const bi = BigInt(b.ID);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

function directContextError(ctx, prefix) {
  const err = getContextError(ctx);
  if (err != null) {
    throw new Error(`${prefix}: ${err.message ?? String(err)}`);
  }
}

export function orderedAlongAxis(g, isHorizontal) {
  const orderedNodes = g.Nodes.slice();
  orderedNodes.sort((a, b) => {
    const av = isHorizontal ? a.TopLeft.X : a.TopLeft.Y;
    const bv = isHorizontal ? b.TopLeft.X : b.TopLeft.Y;
    if (av === bv) return idCompare(a, b);
    return av < bv ? -1 : 1;
  });
  return orderedNodes;
}

export function isVisibilityGraphEdgeBlocked(g, isHorizontal, includeSizes, nodeA, nodeB, guard) {
  for (const node of g.Nodes) {
    guard.Step();
    if (node.ID === nodeA.ID || node.ID === nodeB.ID) continue;
    if (node.IsBlocked(nodeA, nodeB, includeSizes, isHorizontal)) return true;
  }
  return false;
}

export function visibilityEdges(ctx, g, isHorizontal, includeSizes) {
  const guard = new WorkGuard(ctx, "CompactionVisibility", MAX_ENGINE_WORK_UNITS);
  const edges = [];
  for (const node of g.Nodes) {
    guard.Step();
    for (const otherNode of g.Nodes) {
      guard.Step();
      if (node.ID === otherNode.ID) continue;
      const delta = Number(node.DeltaTo(otherNode, node.TopLeft));
      if (!node.VisibilityGraphCandidate(isHorizontal, true, includeSizes, otherNode, delta)) {
        continue;
      }
      if (!isVisibilityGraphEdgeBlocked(g, isHorizontal, includeSizes, node, otherNode, guard)) {
        edges.push(new Edge(node, otherNode));
      }
    }
  }
  guard.Finish();
  return edges;
}

export function nearestFrom(edges, node, isHorizontal, includeSizes) {
  let nearestBehind = null;
  let largestBehindDistance = -Infinity;
  for (const edge of edges) {
    if (edge.To !== node) continue;
    let distance;
    if (isHorizontal) {
      distance = edge.From.TopLeft.X + (includeSizes ? edge.From.Width : 0);
    } else {
      distance = edge.From.TopLeft.Y + (includeSizes ? edge.From.Height : 0);
    }
    if (distance > largestBehindDistance) {
      largestBehindDistance = distance;
      nearestBehind = edge.From;
    }
  }
  return nearestBehind;
}

export function compactionFloor(g, anchor, factor, isHorizontal, includeSizes, padding) {
  let floor;
  if (isHorizontal) {
    floor = includeSizes
      ? Math.ceil((anchor.TopLeft.X + factor * anchor.Width) / g.CellSize)
      : anchor.TopLeft.X + Math.floor(factor);
  } else {
    floor = includeSizes
      ? Math.ceil((anchor.TopLeft.Y + factor * anchor.Height) / g.CellSize)
      : anchor.TopLeft.Y + Math.floor(factor);
  }
  if (includeSizes) {
    const anchorVal = isHorizontal
      ? anchor.TopLeft.X + anchor.Width
      : anchor.TopLeft.Y + anchor.Height;
    while (floor * g.CellSize - anchorVal <= Number(padding)) {
      floor += 1;
    }
  }
  return floor;
}

export function globallyFurthestBehind(g, isHorizontal) {
  let result = g.Nodes[0];
  for (const node of g.Nodes) {
    const value = isHorizontal ? node.TopLeft.X : node.TopLeft.Y;
    const current = isHorizontal ? result.TopLeft.X : result.TopLeft.Y;
    if (value < current) result = node;
  }
  return result;
}

export function candidateMoves(ctx, g, node, factor, isHorizontal, includeSizes, floorDecrease, vEdges) {
  const guard = new WorkGuard(ctx, "CompactionCandidates", MAX_ENGINE_WORK_UNITS);
  let nearestBehind = nearestFrom(vEdges, node, isHorizontal, includeSizes);
  if (nearestBehind == null) {
    nearestBehind = globallyFurthestBehind(g, isHorizontal);
  }

  let floor = compactionFloor(
    g,
    nearestBehind,
    factor,
    isHorizontal,
    includeSizes,
    node.DeltaTo(nearestBehind, node.TopLeft)
  );
  const hasFixed = g.HasFixedNode();

  if (isHorizontal) {
    const nearestBehindAnotherAxis = includeSizes
      ? nearestBehind.TopLeft.Y > node.TopLeft.Y + node.Height ||
        nearestBehind.TopLeft.Y + nearestBehind.Height < node.TopLeft.Y
      : nearestBehind.TopLeft.Y !== node.TopLeft.Y;
    if (nearestBehind.TopLeft.X === node.TopLeft.X || nearestBehindAnotherAxis) {
      if (includeSizes) {
        floor = nearestBehind.TopLeft.X / g.CellSize;
        if (hasFixed) floor = goRound(floor);
      } else {
        floor = nearestBehind.TopLeft.X;
      }
    }
  } else {
    const nearestBehindAnotherAxis = includeSizes
      ? nearestBehind.TopLeft.X > node.TopLeft.X + node.Width ||
        nearestBehind.TopLeft.X + nearestBehind.Width < node.TopLeft.X
      : nearestBehind.TopLeft.X !== node.TopLeft.X;
    if (nearestBehind.TopLeft.Y === node.TopLeft.Y || nearestBehindAnotherAxis) {
      if (includeSizes) {
        floor = nearestBehind.TopLeft.Y / g.CellSize;
        if (hasFixed) floor = goRound(floor);
      } else {
        floor = nearestBehind.TopLeft.Y;
      }
    }
  }

  const ceil = isHorizontal
    ? (includeSizes ? node.TopLeft.X / g.CellSize : node.TopLeft.X)
    : (includeSizes ? node.TopLeft.Y / g.CellSize : node.TopLeft.Y);
  const start = floor - floorDecrease;
  if (!Number.isFinite(start) || !Number.isFinite(ceil)) {
    throw new Error("layout invariant violated: compaction candidate range is not finite");
  }
  if (start <= ceil) {
    const count = Math.floor(ceil - start) + 1;
    if (count > MAX_COMPACTION_CANDIDATE_COUNT) {
      throw new Error(
        `TALA compaction candidate count ${count} exceeds limit ${MAX_COMPACTION_CANDIDATE_COUNT}`
      );
    }
  }

  const positions = [];
  for (let i = start; i <= ceil; i++) {
    guard.Step();
    if (isHorizontal) {
      positions.push(new Point(includeSizes ? i * g.CellSize : i, node.TopLeft.Y));
    } else {
      positions.push(new Point(node.TopLeft.X, includeSizes ? i * g.CellSize : i));
    }
  }
  guard.Finish();
  return positions;
}

export function inflateAlongAxis(g, isHorizontal, includeSizes, factor, vEdges, transition) {
  const orderedNodes = orderedAlongAxis(g, isHorizontal);
  const hasFixedNode = g.HasFixedNode();

  for (const node of orderedNodes) {
    const nearest = nearestFrom(vEdges, node, isHorizontal, includeSizes);
    if (nearest == null) {
      if (hasFixedNode && transition && node.FixedTopLeft == null) {
        if (isHorizontal) {
          node.MoveAbsWithChildren(roundToPreviousCellSize(node.TopLeft.X, g.CellSize), node.TopLeft.Y);
        } else {
          node.MoveAbsWithChildren(node.TopLeft.X, roundToPreviousCellSize(node.TopLeft.Y, g.CellSize));
        }
      }
      continue;
    }
    if (node.FixedTopLeft != null && !transition) continue;

    const delta = transition ? 60 : node.DeltaTo(nearest, node.TopLeft);
    const floor = compactionFloor(g, nearest, factor, isHorizontal, includeSizes, delta);
    if (isHorizontal) {
      const target = includeSizes ? floor * g.CellSize : floor;
      if (target > node.TopLeft.X) node.MoveAbsWithChildren(target, node.TopLeft.Y);
    } else {
      const target = includeSizes ? floor * g.CellSize : floor;
      if (target > node.TopLeft.Y) node.MoveAbsWithChildren(node.TopLeft.X, target);
    }
  }
}

function numAdjacent(nodes) {
  let sum = 0;
  for (const node of nodes) {
    sum += node.Edges.length;
  }
  return sum;
}


export function shiftSubgraphs(ctx, g, isHorizontal, includeSizes, factor, edgeAbductions, vEdges) {
  let changed = false;
  const subgraphSet = new Map();
  let orderedSubgraphRoots = [];
  const orderedNodes = orderedAlongAxis(g, isHorizontal);

  for (const node of orderedNodes) {
    const nearest = nearestFrom(vEdges, node, isHorizontal, includeSizes);
    if (nearest == null) {
      subgraphSet.set(node, [node]);
      orderedSubgraphRoots.push(node);
    } else {
      const list = subgraphSet.get(nearest) ?? [];
      list.push(node);
      subgraphSet.set(nearest, list);
    }
  }

  const filtered = [];
  for (const root of orderedSubgraphRoots) {
    let hasFixed = false;
    for (const node of subgraphSet.get(root) ?? []) {
      if (node.FixedTopLeft != null) {
        hasFixed = true;
        break;
      }
    }
    if (hasFixed) subgraphSet.delete(root);
    else filtered.push(root);
  }
  orderedSubgraphRoots = filtered;
  const fixedNodes = g.FixedNodes();

  orderedSubgraphRoots.sort((a, b) => {
    const av = isHorizontal ? a.TopLeft.X : a.TopLeft.Y;
    const bv = isHorizontal ? b.TopLeft.X : b.TopLeft.Y;
    return av === bv ? idCompare(a, b) : (av < bv ? -1 : 1);
  });

  const furthestGlobal = globallyFurthestBehind(g, isHorizontal);
  for (const furthestBehind of orderedSubgraphRoots) {
    const subgraph = subgraphSet.get(furthestBehind) ?? [];
    const isGlobal = isHorizontal
      ? furthestBehind.TopLeft.X === furthestGlobal.TopLeft.X
      : furthestBehind.TopLeft.Y === furthestGlobal.TopLeft.Y;
    const possibleMoves = candidateMoves(
      ctx, g, furthestBehind, factor, isHorizontal, includeSizes, isGlobal ? 2 : 0, vEdges
    );
    possibleMoves.push(furthestBehind.TopLeft.Copy());

    const nonSubgraphNodes = fixedNodes.slice();
    for (const other of g.Nodes) {
      if (!subgraph.includes(other)) nonSubgraphNodes.push(other);
    }

    let symmetryCost = includeSizes ? g.CellSize : 1;
    symmetryCost *= numAdjacent(subgraph);
    const scoreOptions = new EdgeLengthOptions({
      EdgeAbductions: edgeAbductions,
      IncludeNodeSizes: includeSizes,
      EnforceMinimumGap: false,
      PenalizeDirection: true,
    });
    let bestEdgeDistance = nodesEdgeLength(ctx, subgraph, scoreOptions);
    let bestDelta = 0;
    const originalPositions = snapshotNodePositionsContext(ctx, "Compaction", subgraph);

    for (const move of possibleMoves) {
      const delta = isHorizontal
        ? furthestBehind.TopLeft.X - move.X
        : furthestBehind.TopLeft.Y - move.Y;

      let overlaps = false;
      for (const node of subgraph) {
        const p = node.TopLeft.Copy();
        if (isHorizontal) p.X -= delta;
        else p.Y -= delta;

        if (fixedNodes.length > 0 && node.PointPastFixedOrigin(p.X, p.Y, includeSizes)) {
          overlaps = true;
          break;
        }
        for (const other of nonSubgraphNodes) {
          if (includeSizes ? node.DoesOverlapAt(other, p) : nonNilEquals(other.TopLeft, p)) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) break;
      }
      if (overlaps) continue;

      for (const node of subgraph) {
        if (isHorizontal) node.MoveWithChildren(-delta, 0);
        else node.MoveWithChildren(0, -delta);
      }

      let edgeDistanceAfter;
      try {
        edgeDistanceAfter = nodesEdgeLength(ctx, subgraph, scoreOptions);
        if (includeSizes) {
          edgeDistanceAfter -= nodesSymmetry(ctx, subgraph, edgeAbductions) * symmetryCost;
        }
      } catch (error) {
        restoreNodePositions(originalPositions);
        throw error;
      }
      restoreNodePositions(originalPositions);

      if (edgeDistanceAfter < bestEdgeDistance) {
        bestEdgeDistance = edgeDistanceAfter;
        bestDelta = delta;
      }
    }

    if (bestDelta !== 0) {
      changed = true;
      for (const node of subgraph) {
        if (isHorizontal) node.MoveWithChildren(-bestDelta, 0);
        else node.MoveWithChildren(0, -bestDelta);
      }
    }
  }
  return changed;
}

export function compactAlongAxis(ctx, g, isHorizontal, includeSizes, factor, edgeAbductions, vEdges, guard) {
  let changed = false;
  for (const node of orderedAlongAxis(g, isHorizontal)) {
    if (node.FixedTopLeft != null) continue;
    const possibleMoves = candidateMoves(ctx, g, node, factor, isHorizontal, includeSizes, 0, vEdges);
    possibleMoves.push(node.TopLeft.Copy());
    if (moveNodeToBest(ctx, g, node, possibleMoves, edgeAbductions, includeSizes, guard)) {
      changed = true;
    }
  }
  return changed;
}

export function compaction(ctx, g, options = {}) {
  const axis = options.axis ?? LayoutAxis.Invalid;
  if (!axisValid(axis)) {
    throw new Error("TALA Compaction requires an axis");
  }
  const factor = options.factor ?? 0;
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new Error("TALA Compaction requires a finite positive factor");
  }

  const edgeAbductions = options.edgeAbductions ?? null;
  const isHorizontal = axisIsHorizontal(axis);
  const includeSizes = Boolean(options.includeSizes);
  const transition = Boolean(options.transition);

  Validate(ctx, "Compaction", g);
  const originalCosts = g.RoutingCosts();
  const originalPositions = snapshotNodePositionsContext(ctx, "Compaction", g.Nodes);
  let complete = false;
  try {
    const vEdges = visibilityEdges(ctx, g, isHorizontal, includeSizes);
    inflateAlongAxis(g, isHorizontal, includeSizes, factor, vEdges, transition);
    directContextError(ctx, "Compaction");

    if (transition) {
      complete = true;
      return;
    }

    for (let i = 0; i < 20; i++) {
      if (!shiftSubgraphs(ctx, g, isHorizontal, includeSizes, factor, edgeAbductions, vEdges)) break;
    }

    let moveWorkLimit = options.moveWorkLimit == null ? 0n : BigInt(options.moveWorkLimit);
    if (moveWorkLimit === 0n || moveWorkLimit > MAX_OPTIMIZATION_WORK_UNITS) {
      moveWorkLimit = MAX_OPTIMIZATION_WORK_UNITS;
    }
    const movesGuard = new OptimizationWorkGuard(ctx, "CompactionMoves", moveWorkLimit);

    for (let i = 0; i < 20; i++) {
      if (!compactAlongAxis(ctx, g, isHorizontal, includeSizes, factor, edgeAbductions, vEdges, movesGuard)) {
        break;
      }
    }
    directContextError(ctx, "Compaction");
    complete = true;
  } finally {
    if (!complete) {
      restoreNodePositions(originalPositions);
      g.RestoreRoutingCosts(originalCosts);
    }
  }
}

export const Compaction = compaction;
