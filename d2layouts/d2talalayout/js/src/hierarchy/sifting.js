// Pinned reference: internal/hierarchy/sifting.go
//
// Global sifting (Matuszewski et al., "Using Sifting for k-Layer Straightline
// Crossing Minimization"), extended with containers and edge length.

import { PRECISION, precisionCompare } from '../geometry/math.js';
import { nodeDebugID } from '../graph/node.js';
import { addLengths, allDescendants, computeLevelRanks, countCrossings, crossLevelSegments } from './crossing.js';

function compareInts(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function globalSifting(byLevel) {
  const queue = nodesInDescendingDegreeOrder(byLevel);
  const nodeToSiblings = buildNodeToSiblings(queue, byLevel);
  let improveIfEqualCrossings = false;
  // 10 is just a killswitch (there's no suggested value in the paper)
  for (let iter = 0; iter < 10; iter++) {
    const iterQueue = queue.slice();
    let improvedAny = false;
    for (const node of iterQueue) {
      const oldRank = node.rank;
      sifting(node, nodeToSiblings.get(node), byLevel, improveIfEqualCrossings);
      if (node.rank !== oldRank) {
        improvedAny = true;
      }
    }
    if (!improvedAny) {
      if (improveIfEqualCrossings) {
        // no improvement even considering reordering for the same crossings count
        break;
      }
      improveIfEqualCrossings = true;
    } else {
      improveIfEqualCrossings = false;
    }
  }
}

export function nodesInDescendingDegreeOrder(byLevel) {
  const nodes = [];
  for (let level = 0; level < byLevel.size; level++) {
    nodes.push(...allDescendants(byLevel.get(level) ?? [], true));
  }
  nodes.sort((a, b) => {
    const order = compareInts(b.degree(), a.degree());
    if (order !== 0) return order;
    // If nodes have the same degree, sort by order from top-left.
    const byLevelOrder = compareInts(a.level, b.level);
    if (byLevelOrder !== 0) return byLevelOrder;
    return compareInts(a.rank, b.rank);
  });
  return nodes;
}

export function buildNodeToSiblings(nodes, byLevel) {
  const nodeToSiblings = new Map();
  for (const node of nodes) {
    if (node.container != null) {
      nodeToSiblings.set(node, node.container.children);
    } else {
      nodeToSiblings.set(node, byLevel.get(node.level) ?? []);
    }
  }
  return nodeToSiblings;
}

function swap(values, i, j) {
  const tmp = values[i];
  values[i] = values[j];
  values[j] = tmp;
}

export function sifting(node, siblings, byLevel, improveIfEqualCrossings) {
  const levelOf = () => byLevel.get(node.level) ?? [];
  let segments = crossLevelSegments(siblings, true, true);
  let bestCrossings = countCrossings(segments);
  let bestLength = addLengths(segments);
  let bestI = -1;

  if (bestCrossings === 0n || siblings.length === 1) {
    return;
  } else if (node === siblings[siblings.length - 1]) {
    // handle edge case where the node is already the right most one
    bestI = siblings.length - 1;
  } else {
    // move all the way to the right
    for (let i = 0; i < siblings.length - 1; i++) {
      if (bestI === -1) {
        if (siblings[i] === node) {
          bestI = i;
        } else {
          continue;
        }
      }

      swap(siblings, i + 1, i);
      computeLevelRanks(levelOf());
      segments = crossLevelSegments(siblings, true, true);
      const crossings = countCrossings(segments);
      const length = addLengths(segments);
      if (improved(crossings, bestCrossings, length, bestLength, improveIfEqualCrossings)) {
        bestCrossings = crossings;
        bestI = i + 1;
        bestLength = length;
      }
    }
    if (siblings[siblings.length - 1] !== node) {
      throw new Error(`sifting: expected node ${nodeDebugID(node.graphNode)} to have moved to the right of siblings slice`);
    }
    if (bestI === -1) {
      throw new Error(`sifting: node ${nodeDebugID(node.graphNode)} not found`);
    }
  }

  // move all the way to the left
  for (let i = siblings.length - 1; i > 0; i--) {
    swap(siblings, i - 1, i);
    computeLevelRanks(levelOf());
    segments = crossLevelSegments(siblings, true, true);
    const crossings = countCrossings(segments);
    const length = addLengths(segments);
    if (improved(crossings, bestCrossings, length, bestLength, improveIfEqualCrossings)) {
      bestCrossings = crossings;
      bestI = i - 1;
      bestLength = length;
    }
  }
  if (siblings[0] !== node) {
    throw new Error(`sifting: expected node ${nodeDebugID(node.graphNode)} to have moved to the left of siblings slice`);
  }

  // swap the node to the best rank and update the rank of all siblings
  for (let i = 0; i < siblings.length; i++) {
    if (i === bestI) {
      // at this moment, the node was already swapped to bestLocalRank
      break;
    }
    swap(siblings, i + 1, i);
  }
  computeLevelRanks(levelOf());
}

export function improved(crossings, bestCrossings, length, bestLength, improveIfEqualCrossings) {
  if (!improveIfEqualCrossings) {
    return crossings < bestCrossings || (crossings === bestCrossings && precisionCompare(length, bestLength, PRECISION) === -1);
  }
  return crossings <= bestCrossings || (crossings === bestCrossings && precisionCompare(length, bestLength, PRECISION) < 1);
}
