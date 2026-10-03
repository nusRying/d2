import { Point } from '../geometry/point.js';
import { isDiagonal, isHorizontal, isVertical } from '../geometry/orientation.js';

/**
 * AxisScore measures how strongly nodes share one visual axis.
 * Pinned Go: placementcost.AxisScore
 *
 * @param {Array<import('../graph/node.js').Node>} nodes
 * @returns {number}
 */
export function axisScore(nodes) {
  if (!nodes || nodes.length < 2) {
    return 1;
  }
  if (nodes.length === 2) {
    if (isDiagonal(nodes[0].Orientation(nodes[1]))) {
      return 0;
    }
    return 1;
  }

  let largestWidth = -Infinity;
  let largestWidthNode = null;
  let largestHeight = -Infinity;
  let largestHeightNode = null;
  for (const node of nodes) {
    if (node.Width > largestWidth) {
      largestWidth = node.Width;
      largestWidthNode = node;
    }
    if (node.Height > largestHeight) {
      largestHeight = node.Height;
      largestHeightNode = node;
    }
  }

  let verticallyAligned = true;
  for (const node of nodes) {
    if (node === largestHeightNode) {
      continue;
    }
    if (!isHorizontal(node.Orientation(largestHeightNode))) {
      verticallyAligned = false;
      break;
    }
  }
  if (verticallyAligned) {
    const center = largestHeightNode.Center();
    let score = 0.0;
    for (const node of nodes) {
      if (node === largestHeightNode) {
        continue;
      }
      let nodeScore = 0.0;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const y = largestHeightNode.TopLeft.Y + fraction * largestHeightNode.Height;
        if (node.OverlapsLine(new Point(center.X, y), new Point(node.Center().X, y), 0)) {
          nodeScore += 0.33;
        }
      }
      if (node.Height < 0.25 * largestHeightNode.Height) {
        nodeScore *= 3;
      } else if (node.Height < 0.75 * largestHeightNode.Height) {
        nodeScore *= 2;
      }
      if (nodeScore === 0.99) {
        score++;
      } else {
        score += nodeScore;
      }
    }
    return Math.max(0.33, score / (nodes.length - 1));
  }

  let horizontallyAligned = true;
  for (const node of nodes) {
    if (node === largestWidthNode) {
      continue;
    }
    if (!isVertical(node.Orientation(largestWidthNode))) {
      horizontallyAligned = false;
      break;
    }
  }
  if (horizontallyAligned) {
    const center = largestWidthNode.Center();
    let score = 0.0;
    for (const node of nodes) {
      if (node === largestWidthNode) {
        continue;
      }
      let nodeScore = 0.0;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const x = largestWidthNode.TopLeft.X + fraction * largestWidthNode.Width;
        if (node.OverlapsLine(new Point(x, center.Y), new Point(x, node.Center().Y), 0)) {
          nodeScore += 0.33;
        }
      }
      if (node.Width < 0.25 * largestWidthNode.Width) {
        nodeScore *= 3;
      } else if (node.Width < 0.75 * largestWidthNode.Width) {
        nodeScore *= 2;
      }
      if (nodeScore === 0.99) {
        score++;
      } else {
        score += nodeScore;
      }
    }
    return Math.max(0.33, score / (nodes.length - 1));
  }
  return 0;
}

export const AxisScore = axisScore;
