import { precisionCompare, PRECISION, goRound } from "../geometry/math.js";
import { checkScoringCancellation } from "../placementcost/geometry.js";
import { nodeEdgeLength, EdgeLengthOptions } from "../placementcost/edge-length.js";
import { columnCrossingCost, nodeSymmetryExport } from "../placementcost/symmetry.js";
import {
  optimizerFixedOrigin,
  optimizerCanMove,
  optimizerMoveNodeAbs,
  chargeOptimizerScoring,
} from "./optimizer-support.js";

/**
 * Generic sized/sizeless candidate movement used by compaction.
 * Pinned Go: internal/placement/moves.go moveNodeToBest
 */
export function moveNodeToBest(ctx, graph, node, points, edgeAbductions, includeSizes, guard) {
  if (guard == null) {
    throw new Error("TALA moveNodeToBest requires a work guard");
  }
  guard.Finish();

  const symmetryCost = graph.CellSize * node.Edges.length;
  let leastDistance = Infinity;
  let leastDistancePoint = node.TopLeft.copy ? node.TopLeft.copy() : { X: node.TopLeft.X, Y: node.TopLeft.Y };
  const currentX = node.TopLeft.X;
  const currentY = node.TopLeft.Y;

  const fixedOrigin = optimizerFixedOrigin(graph, node.EffectiveContainer(), guard);
  if (fixedOrigin != null && !includeSizes) {
    fixedOrigin.X = goRound(fixedOrigin.X / graph.CellSize);
    fixedOrigin.Y = goRound(fixedOrigin.Y / graph.CellSize);
  }

  const options = new EdgeLengthOptions({
    EdgeAbductions: edgeAbductions,
    IncludeNodeSizes: includeSizes,
    EnforceMinimumGap: false,
    PenalizeDirection: true,
  });

  for (const point of points) {
    guard.Step();
    if (point == null) {
      throw new Error(`TALA ${guard.Location()} found a nil placement point`);
    }
    const x = point.X;
    const y = point.Y;
    if (fixedOrigin != null && (x < fixedOrigin.X || y < fixedOrigin.Y)) {
      continue;
    }

    let canMove = x === currentX && y === currentY;
    if (!canMove) {
      canMove = optimizerCanMove(node, point, includeSizes, guard);
    }
    if (!canMove) continue;

    optimizerMoveNodeAbs(node, x, y, guard);
    chargeOptimizerScoring(node, edgeAbductions, includeSizes, guard);
    let edgeLength = nodeEdgeLength(ctx, node, options);

    if (includeSizes) {
      if (
        Number.isFinite(leastDistance) &&
        precisionCompare(edgeLength - symmetryCost, leastDistance, PRECISION) === 1
      ) {
        continue;
      }
      edgeLength += columnCrossingCost(ctx, node, edgeAbductions);
      edgeLength -= nodeSymmetryExport(ctx, node, edgeAbductions) * symmetryCost;
    }

    const cmp = precisionCompare(edgeLength, leastDistance, PRECISION);
    if (cmp === -1) {
      leastDistance = edgeLength;
      leastDistancePoint = point;
    } else if (cmp === 0 && point.X === currentX && point.Y === currentY) {
      leastDistance = edgeLength;
      leastDistancePoint = point;
    }
  }

  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  if (leastDistance === Infinity) {
    throw new Error("sizedOptimizer.moveNodeToBest: could not find any placement");
  }

  optimizerMoveNodeAbs(node, leastDistancePoint.X, leastDistancePoint.Y, guard);
  guard.Finish();
  return node.TopLeft.X !== currentX || node.TopLeft.Y !== currentY;
}

export const MoveNodeToBest = moveNodeToBest;
