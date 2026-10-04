// Pinned evaluation_guard.go: only the work and ancestry kernel used by Inspect.
import { MAX_TOPOLOGY_DEPTH } from '../limits/constants.js';
export const maxEvaluationWorkUnits = 50_000_000;
export function chargeEvaluationWork(guard, amount) {
  if (amount < 0) throw new Error('TALA Evaluate work charge must not be negative');
  guard.add(amount);
}
export function evaluationIsDescendantOf(descendant, ancestor, guard) {
  for (let depth=0;;depth++) {
    guard.step();
    if (ancestor===descendant) return true;
    if (descendant==null) return false;
    if (depth>=MAX_TOPOLOGY_DEPTH) throw new Error(`TALA Evaluate ancestry depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
    descendant=descendant.AncestryParent();
    if (descendant==null) return ancestor==null;
  }
}
