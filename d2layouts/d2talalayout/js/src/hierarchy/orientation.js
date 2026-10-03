// Pinned reference: internal/hierarchy/orientation.go

import { isHorizontal as orientationIsHorizontal } from '../geometry/orientation.js';

/**
 * IsHorizontal reports the orientation shared by hierarchy placement and
 * hierarchy-aware routing. Entity-relationship diagrams use horizontal
 * hierarchy placement regardless of the container direction.
 */
export function isHorizontal(nodes) {
  if (nodes.length === 0) {
    return false;
  }
  if (orientationIsHorizontal(nodes[0].containerDirection())) {
    return true;
  }
  for (const node of nodes) {
    if (node != null && node.isTable()) {
      return true;
    }
  }
  return false;
}

export const IsHorizontal = isHorizontal;
