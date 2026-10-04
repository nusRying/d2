// Port of top-level result.go.
//
// Pinned Go authority: d2layouts/d2talalayout/result.go.
//
// The JS public contract is ELK (ADR-001), so a seed input carries only the
// immutable layout graph ({ graph }); Go's D2 `bindings` have no counterpart.
// The ordering value is the shared quality Score: Score.Compare implements
// exactly Go's layoutScore.compare (finite penalty first, then finite
// non-negative area, exact comparisons without tolerance).
import { EvaluateWithArea } from "../quality/scoring.js";
import { Score } from "../quality/score.js";
import { getContextError } from "../limits/work-context.js";
import {
  isFiniteResultNumber,
  validateCompletedGraph,
  validateLayoutResultMetadata,
  validateLayoutResultTopology,
} from "./result-validation.js";

/** SeedResult is a successfully validated and scored local layout attempt. */
export class SeedResult {
  constructor(graph = null, score = new Score(0, 0), sequenceEdges = new Set()) {
    this.graph = graph;
    this.score = score;
    this.sequenceEdges = sequenceEdges;
  }
}

function wrap(prefix, err) {
  return new Error(`${prefix}: ${err.message}`, { cause: err });
}

/**
 * evaluateSeedResult validates a completed local attempt against its immutable
 * input and computes its ordering score.
 *
 * @param {any} ctx work context
 * @param {{graph: import('../graph/graph.js').Graph}} input seed input
 * @param {import('../graph/graph.js').Graph} graph completed attempt
 * @returns {SeedResult}
 */
export function evaluateSeedResult(ctx, input, graph) {
  if (ctx == null) {
    // Go dereferences ctx.Err() and panics on a nil context.
    throw new TypeError("evaluateSeedResult requires a context");
  }
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw ctxErr;
  }
  if (input == null || input.graph == null) {
    throw new Error("TALA seed input is empty");
  }
  if (graph == null) {
    throw new Error("TALA seed result is empty");
  }
  try {
    validateCompletedGraph(ctx, graph);
  } catch (err) {
    throw wrap("validate TALA seed result", err);
  }
  let sequenceEdges;
  try {
    sequenceEdges = validateLayoutResultTopology(ctx, input.graph, graph);
  } catch (err) {
    throw wrap("validate TALA seed result topology", err);
  }
  try {
    validateLayoutResultMetadata(ctx, input.graph, graph, sequenceEdges);
  } catch (err) {
    throw wrap("validate TALA seed result metadata", err);
  }
  const evaluation = EvaluateWithArea(ctx, graph);
  const penalty = evaluation.penalty;
  const area = evaluation.area;
  if (!isFiniteResultNumber(penalty)) {
    throw new Error("TALA seed result has a non-finite score");
  }
  return new SeedResult(graph, new Score(penalty, area), sequenceEdges);
}
