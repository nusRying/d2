import { captureOptimizerNodePositions } from "./optimizer-support.js";

/**
 * OptimizerCandidateMovement reuses the candidate search's existing rollback
 * snapshot as its stable movement set.
 *
 * Pinned reference: internal/placement/candidate_movement.go optimizerCandidateMovement
 */
export class OptimizerCandidateMovement {
  constructor(positions, descendantWork) {
    this.positions = positions;
    this.descendantWork = descendantWork;
  }

  moveAbs(x, y, guard) {
    const node = this.positions[0].node;
    if (node.TopLeft == null) {
      throw new Error(`TALA ${guard.Location()} cannot move an unpositioned node`);
    }
    if (node.TopLeft.X === x && node.TopLeft.Y === y) {
      return guard.Step();
    }
    for (let i = 0n; i < this.descendantWork; i++) {
      guard.Step();
    }
    const descendants = this.positions.slice(1);
    for (const position of descendants) {
      guard.Step();
      if (position.node.TopLeft == null) {
        throw new Error(
          `TALA ${guard.Location()} cannot move an unpositioned descendant`
        );
      }
    }
    const dx = x - node.TopLeft.X;
    const dy = y - node.TopLeft.Y;
    node.Translate(dx, dy);
    for (const position of descendants) {
      guard.Step();
      position.node.Translate(dx, dy);
    }
  }
}

/**
 * captureOptimizerCandidateMovement captures stable movement set for a node.
 *
 * Pinned reference: internal/placement/candidate_movement.go captureOptimizerCandidateMovement
 */
export function captureOptimizerCandidateMovement(node, guard) {
  const before = guard.Used();
  const positions = captureOptimizerNodePositions([node], guard);
  return new OptimizerCandidateMovement(
    positions,
    guard.Used() - before - BigInt(positions.length)
  );
}
