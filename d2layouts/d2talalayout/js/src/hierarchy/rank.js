// Pinned reference: internal/hierarchy/rank.go
//
// rankDAG minimizes the weighted sum of edge spans subject to every edge
// spanning at least one level and returns a normalized deterministic optimum.
// The input must be a connected simple DAG. Levels are zero based.

import { OptimizationWorkGuard } from '../limits/optimization.js';
import { MAX_OPTIMIZATION_WORK_UNITS } from '../limits/constants.js';
import { goError, invariantNew, isGoReturnedError, wrapError, checkedAddInt64, checkedMulInt64, checkedSubInt64 } from './layoutgraph-support.js';
import { RANK_MIN_SPAN, longestPathLevels, newRankProblem } from './rank-graph.js';
import { solveRankProblem } from './rank-simplex.js';

export { checkedAddInt64, checkedMulInt64, checkedSubInt64 };

/**
 * rankResult: nodeToLevel is a Map keyed by DAG node in canonical node-ID
 * order (Go returns a map whose iteration order is unspecified).
 */
export class RankResult {
  constructor(nodeToLevel, levelCount) {
    this.nodeToLevel = nodeToLevel;
    this.levelCount = levelCount;
  }
}

export function rankDAG(ctx, g) {
  try {
    return rankDAGWithLimit(ctx, g, MAX_OPTIMIZATION_WORK_UNITS);
  } catch (err) {
    // Go wraps returned errors only; a panic propagates unchanged.
    if (!isGoReturnedError(err)) {
      throw err;
    }
    throw wrapError('TALA RankDAG failed', err);
  }
}

export function rankDAGWithLimit(ctx, g, workLimit) {
  if (ctx == null) {
    throw goError('TALA RankDAG requires a context');
  }
  const guard = new OptimizationWorkGuard(ctx, 'RankDAG', workLimit);
  const problem = newRankProblem(g, guard);
  if (problem.nodes.length === 0) {
    guard.Finish();
    return new RankResult(new Map(), 0);
  }

  const initialLevels = longestPathLevels(problem, guard);
  if (problem.edges.length === 0) {
    guard.Finish();
    return new RankResult(new Map([[problem.nodes[0], 0]]), 1);
  }

  const [levels, dualValue] = solveRankProblem(problem, initialLevels, guard);
  const [result, primalValue] = makeResult(problem, levels, guard);
  if (primalValue !== dualValue) {
    throw invariantNew(`optimality certificate failed: primal cost ${primalValue}, dual value ${dualValue}`);
  }
  guard.Finish();
  return result;
}

export function makeResult(problem, levels, guard) {
  let minLevel = Infinity;
  let maxLevel = -Infinity;
  for (const level of levels) {
    guard.Step();
    minLevel = Math.min(minLevel, level);
    maxLevel = Math.max(maxLevel, level);
  }

  let primalValue = 0;
  for (const edge of problem.edges) {
    guard.Step();
    let [span, ok] = checkedSubInt64(levels[edge.to], levels[edge.from]);
    if (!ok) {
      throw goError('edge span overflow');
    }
    if (span < RANK_MIN_SPAN) {
      throw invariantNew(`infeasible span ${span}`);
    }
    let weightedSpan;
    [weightedSpan, ok] = checkedMulInt64(edge.weight, span);
    if (!ok) {
      throw goError('objective overflow');
    }
    [primalValue, ok] = checkedAddInt64(primalValue, weightedSpan);
    if (!ok) {
      throw goError('objective overflow');
    }
  }

  const [levelRange, ok] = checkedSubInt64(maxLevel, minLevel);
  if (!ok || levelRange > Number.MAX_SAFE_INTEGER - 1) {
    throw goError('level count overflow');
  }
  const nodeToLevel = new Map();
  for (let node = 0; node < levels.length; node++) {
    guard.Step();
    const [normalized, normalizedOK] = checkedSubInt64(levels[node], minLevel);
    if (!normalizedOK) {
      throw goError('normalized level overflow');
    }
    nodeToLevel.set(problem.nodes[node], normalized);
  }
  return [new RankResult(nodeToLevel, levelRange + 1), primalValue];
}
