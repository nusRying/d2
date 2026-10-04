// Port of internal/quality/scoring.go
import { ValidatePositionedGraph } from '../labeling/positioned-validation.js';
import {
  maxEvaluationWorkUnits,
  newEvaluationWorkGuard,
  chargeEvaluationAreaWork,
} from './evaluation-guard.js';
import { countNonSharedCrossings } from './crossings.js';
import { scoreExistingLabelPlacements } from './labels.js';

function makeResult(score, area, used) {
  const arr = [score, area];
  if (used !== undefined) {
    arr.push(used);
  }
  arr.penalty = score;
  arr.Penalty = score;
  arr.score = score;
  arr.Score = score;
  arr.area = area;
  arr.Area = area;
  if (used !== undefined) {
    arr.used = used;
    arr.Used = used;
    arr.workUsed = used;
  }
  return arr;
}

/**
 * EvaluateWithArea returns the human-facing layout score and the graph area
 * separately. Area is a strict tie-breaker: encoding it into the float score
 * made 100 smaller than 99 (0.1 versus 0.99) and could outweigh real layout
 * differences.
 */
export function EvaluateWithArea(ctx, graph) {
  const [score, area] = evaluateWithAreaLimit(ctx, graph, maxEvaluationWorkUnits);
  return makeResult(score, area);
}

export function evaluateWithAreaLimit(ctx, graph, workLimit) {
  if (graph == null) {
    throw new Error('cannot evaluate a nil graph');
  }
  // Keep this preflight at the quality boundary so candidate evaluation and
  // direct internal callers receive the same resource bounds.
  // It runs before label-overlap scratch slices and maps are constructed.
  ValidatePositionedGraph(ctx, 'Evaluate', graph);

  const guard = newEvaluationWorkGuard(ctx, workLimit);

  let score = 0.0;
  for (const e of graph.Edges) {
    guard.Step();
    if (e.From.Cluster != null || e.To.Cluster != null) {
      continue;
    }
    const turns = Math.max(0, e.Points.length - 2);
    score += turns * 0.5;

    for (let i = 0; i < e.Points.length - 1; i++) {
      guard.Step();
      const curr = e.Points[i];
      const next = e.Points[i + 1];
      // Extra penalty for diagonals
      if (curr.X !== next.X && curr.Y !== next.Y) {
        score += 3;
      }
    }
  }

  const crossings = countNonSharedCrossings(graph.Edges, guard);
  score += crossings;

  const labelScore = scoreExistingLabelPlacements(graph, guard);
  score += 1.0 - labelScore;

  chargeEvaluationAreaWork(graph, guard);

  const area = typeof graph.Area === 'function' ? graph.Area() : graph.area();

  guard.Finish();

  return makeResult(score, area, Number(guard.Used()));
}
