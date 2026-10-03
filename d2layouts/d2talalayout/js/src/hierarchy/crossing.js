// Pinned reference: internal/hierarchy/crossing.go
//
// Vertex ordering within ranks (Gansner et al., section 3) extended with
// containers and edge length tie-breaking.
//
// aboves/belows are Sets (Go maps). Every consumer here is order independent:
// adjacency averages sum integer ranks, and crossLevelSegments stable-sorts by
// (start rank, end rank). Within one level ranks are unique, so segments with
// equal keys come from the same node (aboves are emitted before belows, as in
// Go) and therefore the sorted sequence is identical regardless of map order.

import { precisionCompare, euclideanDistance } from '../geometry/math.js';
import { CrossingSegment, countSegmentCrossings } from '../graph/structural-access.js';
import { CROSSING_COMPARISON_PRECISION } from './constants.js';

function levelNodes(byLevel, level) {
  return byLevel.get(level) ?? [];
}

export function initializeRanks(byLevel) {
  for (let i = 0; i < byLevel.size; i++) {
    computeLevelRanks(levelNodes(byLevel, i));
  }
}

/** minimizes crossings iteratively. */
export function minimizeHierarchyCrossings(byLevel) {
  let widestLevel = 0;
  for (const nodes of byLevel.values()) {
    widestLevel = Math.max(widestLevel, nodes.length);
  }
  const iterCount = widestLevel;
  for (let n = 0; n < iterCount; n++) {
    for (let level = 0; level < byLevel.size; level++) {
      minimizeCrossings(levelNodes(byLevel, level), byLevel, level > 0);
    }
  }
}

/**
 * minimizeCrossings finds the optimal node order of one level, then recurses
 * into optimizable children (Go recurses; depth is the container depth).
 */
export function minimizeCrossings(nodes, byLevel, isTopDown) {
  sortLevelNodesByAdjacencyPosition(nodes, isTopDown);
  computeLevelRanks(levelNodes(byLevel, nodes[0].level));
  const segments = crossLevelSegments(nodes, true, true);
  let crossings = countCrossings(segments);
  let length = addLengths(segments);
  for (let j = 0; j < nodes.length; j++) {
    const [newCrossings, newLength, swapIndex] = bestIndexBySwappingNeighbors(nodes, j, byLevel);
    if (newCrossings < crossings) {
      crossings = newCrossings;
      length = newLength;
      const tmp = nodes[j];
      nodes[j] = nodes[swapIndex];
      nodes[swapIndex] = tmp;
    } else if (newCrossings === crossings && precisionCompare(newLength, length, CROSSING_COMPARISON_PRECISION) === -1) {
      crossings = newCrossings;
      length = newLength;
      const tmp = nodes[j];
      nodes[j] = nodes[swapIndex];
      nodes[swapIndex] = tmp;
    }
    computeLevelRanks(levelNodes(byLevel, nodes[0].level));
  }
  for (const node of nodes) {
    if (node.children.length > 0 && node.optimizeChildrenCrossings) {
      minimizeCrossings(node.children, byLevel, isTopDown);
    }
  }
}

/**
 * Swaps a node with its 3 right neighbors (circularly) and returns
 * [bestCrossings (BigInt), bestLength, bestIndex]. The level is left as it was.
 */
export function bestIndexBySwappingNeighbors(levelNodes_, nodeIndex, byLevel) {
  let bestCrossing = null;
  let bestLength = Infinity;
  let bestIndex = 0;
  for (let i = nodeIndex + 1; i < nodeIndex + 4; i++) {
    const j = i % levelNodes_.length;
    let tmp = levelNodes_[nodeIndex];
    levelNodes_[nodeIndex] = levelNodes_[j];
    levelNodes_[j] = tmp;
    computeLevelRanks(levelNodes(byLevel, levelNodes_[nodeIndex].level));
    const segments = crossLevelSegments(levelNodes_, true, true);
    const newCrossings = countCrossings(segments);
    const newLength = addLengths(segments);
    if (bestCrossing === null || newCrossings < bestCrossing) {
      bestCrossing = newCrossings;
      bestIndex = j;
      bestLength = newLength;
    } else if (newCrossings === bestCrossing && precisionCompare(newLength, bestLength, CROSSING_COMPARISON_PRECISION) === -1) {
      bestCrossing = newCrossings;
      bestIndex = j;
      bestLength = newLength;
    }
    // swap back, so that node[j] swaps with the next one
    tmp = levelNodes_[j];
    levelNodes_[j] = levelNodes_[nodeIndex];
    levelNodes_[nodeIndex] = tmp;
  }
  return [bestCrossing, bestLength, bestIndex];
}

function segmentOrder(a, b) {
  if (a.Start.X === b.Start.X) {
    if (a.End.X < b.End.X) return -1;
    if (b.End.X < a.End.X) return 1;
    return 0;
  }
  if (a.Start.X < b.Start.X) return -1;
  if (b.Start.X < a.Start.X) return 1;
  return 0;
}

/** crossLevelSegments returns the stable-sorted segments of all descendants. */
export function crossLevelSegments(nodes, aboves, belows) {
  const segments = [];
  iterAllDescendants(nodes, (pn) => {
    if (aboves) {
      for (const connected of pn.aboves) {
        segments.push(new CrossingSegment({ X: pn.rank, Y: pn.level }, { X: connected.rank, Y: connected.level }));
      }
    }
    if (belows) {
      for (const connected of pn.belows) {
        segments.push(new CrossingSegment({ X: pn.rank, Y: pn.level }, { X: connected.rank, Y: connected.level }));
      }
    }
  });
  segments.sort(segmentOrder);
  return segments;
}

// Go recurses over container depth; so does the port.
export function iterAllDescendants(nodes, f) {
  for (const pn of nodes) {
    f(pn);
  }
  for (const pn of nodes) {
    iterAllDescendants(pn.children, f);
  }
}

export function allDescendants(nodes, forOptimization) {
  const allNodes = nodes.slice();
  for (const pn of nodes) {
    if (!forOptimization || pn.optimizeChildrenCrossings) {
      allNodes.push(...allDescendants(pn.children, forOptimization));
    }
  }
  return allNodes;
}

export function addLengths(segments) {
  let length = 0.0;
  for (const s of segments) {
    length += euclideanDistance(s.Start.X, s.Start.Y, s.End.X, s.End.Y);
  }
  return length;
}

/** countCrossings → BigInt (Go int64). */
export function countCrossings(segments) {
  return countSegmentCrossings(segments);
}

export function sortLevelNodesByAdjacencyPosition(nodes, useConnectionsAbove) {
  const adjacentLevelAverage = (pn) => {
    const connectedNodes = useConnectionsAbove ? pn.aboves : pn.belows;
    if (connectedNodes.size === 0) {
      return 0;
    }
    let sum = 0;
    for (const connected of connectedNodes) {
      sum += connected.rank;
    }
    return sum / connectedNodes.size;
  };

  nodes.sort((a, b) => {
    const aAverage = adjacentLevelAverage(a);
    const bAverage = adjacentLevelAverage(b);
    if (aAverage < bAverage) return -1;
    if (bAverage < aAverage) return 1;
    return 0;
  });
}

/**
 * computeLevelRanks assigns left-to-right ranks by an explicit-stack DFS that
 * pushes children right-to-left, exactly as Go.
 */
export function computeLevelRanks(nodes) {
  const stack = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    stack[i] = nodes[nodes.length - i - 1];
  }
  for (let rank = 0; stack.length > 0; rank++) {
    const current = stack.pop();
    current.rank = rank;
    for (let i = current.children.length - 1; i > -1; i--) {
      stack.push(current.children[i]);
    }
  }
}
