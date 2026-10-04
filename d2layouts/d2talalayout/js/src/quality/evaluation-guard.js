// Pinned evaluation_guard.go: evaluation work guard, precharge, and ancestry check.
import { MAX_TOPOLOGY_DEPTH } from '../limits/constants.js';
import { newWorkGuard } from '../limits/work-guard.js';
import { IsOutside } from '../labeling/label-position-ops.js';
import { LabelPosition as P, normalizeLabelPosition } from '../graph/label-position.js';

export const maxEvaluationWorkUnits = 50_000_000;
export const calibratedPublicEvaluationCorpusFloor = 50_000;
export const calibratedPublicEvaluationCorpusCeil = 75_000;

export function newEvaluationWorkGuard(ctx, limit = maxEvaluationWorkUnits) {
  const normLimit = typeof limit === 'bigint' ? limit : BigInt(limit);
  if (normLimit < 0n) {
    throw new Error('TALA Evaluate work limit must not be negative');
  }
  return newWorkGuard(ctx, 'Evaluate', normLimit);
}

export function chargeEvaluationWork(guard, amount) {
  if (amount < 0) {
    throw new Error('TALA Evaluate work charge must not be negative');
  }
  guard.Add(BigInt(amount));
}

export function chargeEvaluationAreaWork(g, guard) {
  chargeEvaluationWork(guard, g.Nodes.length);
  for (const node of g.Nodes) {
    if (node.Label != null && IsOutside(node.Label.Position)) {
      for (let i = 0; i < 4; i++) {
        chargeEvaluationWork(guard, g.Nodes.length);
      }
    }
  }
  for (const edge of g.Edges) {
    let multiplier = 1;
    if (edge.Label != null && edge.Points.length !== 0 && normalizeLabelPosition(edge.Label.Position) !== P.Unset) {
      multiplier++;
    }
    if (edge.SourceArrowheadLabel != null) {
      multiplier++;
    }
    if (edge.TargetArrowheadLabel != null) {
      multiplier++;
    }
    for (let i = 0; i < multiplier; i++) {
      chargeEvaluationWork(guard, edge.Points.length);
    }
  }
}

export function evaluationIsDescendantOf(descendant, ancestor, guard) {
  for (let depth = 0; ; depth++) {
    guard.Step();
    if (ancestor === descendant) return true;
    if (descendant == null) return false;
    if (depth >= MAX_TOPOLOGY_DEPTH) {
      throw new Error(`TALA Evaluate ancestry depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
    }
    descendant = typeof descendant.AncestryParent === 'function' ? descendant.AncestryParent() : descendant.ancestryParent();
    if (descendant == null) return ancestor == null;
  }
}
