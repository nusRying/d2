// Pinned reference: internal/hierarchy/brandes_kopf.go
//
// Brandes–Köpf horizontal coordinate assignment (with the authors' erratum and
// Carstens' pseudo-code), aligning leaves only and wrapping containers after.
//
// Go map iteration notes (JS uses Set/Map insertion order):
// - leafNodesContext rewires container aboves/belows; each rewired edge goes to
//   the child chosen only by ranks, so the resulting sets are identical.
// - medianNeighborsContext collects neighbors from a set and then sorts them by
//   TopLeft.X with sort.Slice; neighbors on one level have distinct X (levels
//   are laid out left to right with positive spacing), so the order is unique.
// - sortAlignmentNodes uses sort.Slice on (level, rank); leaf ranks are unique
//   within a level.
// - alignHierarchy ranges over a map to build position updates; every node is
//   charged the same work and receives an independent update.

import { Orientation } from '../geometry/orientation.js';
import { goRound } from '../geometry/math.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { uniformSpacing } from '../graph/structural-access.js';
import {
  LAYOUTGRAPH_CONTAINER_PADDING,
  SIBLING_DUMMY_SPACING,
  SIBLING_SPACING,
} from './constants.js';

export class AlignmentDirection {
  constructor(vertical, horizontal) {
    this.vertical = vertical;
    this.horizontal = horizontal;
  }
}

function isInf(value) {
  return value === Infinity || value === -Infinity;
}

export function alignHierarchy(ctx, g, byLevel) {
  const guard = new WorkGuard(ctx, 'AlignHierarchy', MAX_ENGINE_WORK_UNITS);
  const TL = new AlignmentDirection(Orientation.Top, Orientation.Left);
  const TR = new AlignmentDirection(Orientation.Top, Orientation.Right);
  const BR = new AlignmentDirection(Orientation.Bottom, Orientation.Right);
  const BL = new AlignmentDirection(Orientation.Bottom, Orientation.Left);

  const alignments = [TL, TR, BL, BR];

  const conflicts = markConflicts(ctx, byLevel);
  const minX = new Map();
  const maxX = new Map();
  let minWidth = Infinity;
  let minWidthAlignment = null;
  const xs = new Map();
  for (const d of alignments) {
    guard.Step();
    minX.set(d, Infinity);
    maxX.set(d, -Infinity);
    const alignmentNodes = createAlignmentNodes(ctx, byLevel, d.vertical, d.horizontal);
    verticalAlignment(ctx, alignmentNodes, conflicts, d.horizontal);
    horizontalCompaction(ctx, alignmentNodes, d.horizontal);
    for (const n of alignmentNodes) {
      guard.Step();
      const x = n.x + (n.root.blockSize / 2.0) - (n.graphNode.Width / 2.0);
      let list = xs.get(n.placementNode);
      if (list == null) {
        list = [];
        xs.set(n.placementNode, list);
      }
      list.push(x);
      minX.set(d, Math.min(minX.get(d), n.x));
      maxX.set(d, Math.max(maxX.get(d), n.x + n.blockSize));
    }
    const width = maxX.get(d) - minX.get(d);
    if (width < minWidth) {
      minWidth = width;
      minWidthAlignment = d;
    }
  }

  // balance
  const shift = new Map();
  for (const d of alignments) {
    guard.Step();
    if (d.horizontal === Orientation.Left) {
      shift.set(d, (minX.get(minWidthAlignment) ?? 0) - minX.get(d));
    } else {
      shift.set(d, (maxX.get(minWidthAlignment) ?? 0) - maxX.get(d));
    }
  }

  // final placement
  const updates = [];
  for (const [pn, x] of xs) {
    guard.Step();
    for (let i = 0; i < x.length; i++) {
      guard.Step();
      x[i] += shift.get(alignments[i]) ?? 0;
    }
    updates.push({ node: pn.graphNode, x: goRound(median(x)) });
  }
  guard.Finish();
  for (const update of updates) {
    update.node.TopLeft.X = update.x;
  }
  syncContainers(g, guard);
}

/** Reposition and resize containers from most to least nested. */
export function syncContainers(g, guard) {
  const containers = [];
  const queue = g.Nodes.slice();
  for (let head = 0; head < queue.length; head++) {
    guard.Step();
    const node = queue[head];
    if (node.IsContainer()) {
      containers.push(node);
      queue.push(...(g.Containers.get(node) ?? []));
    }
  }

  // most nested containers are the last ones added to the list
  for (let i = containers.length - 1; i > -1; i--) {
    guard.Step();
    containers[i].wrapChildren();
  }
  guard.Finish();
}

export function median(numbers) {
  if (numbers.length === 0) {
    return 0;
  } else if (numbers.length === 1) {
    return numbers[0];
  }
  // slices.Sort for float64 orders NaN before every other value.
  const ordered = numbers.slice().sort((a, b) => {
    const aNaN = Number.isNaN(a);
    const bNaN = Number.isNaN(b);
    if (aNaN || bNaN) return aNaN === bNaN ? 0 : (aNaN ? -1 : 1);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (ordered.length % 2 === 1) {
    return ordered[Math.trunc(ordered.length / 2)];
  }
  const middle = ordered.length / 2;
  return ordered[middle - 1] / 2 + ordered[middle] / 2;
}

/** alignmentNode embeds a placementNode (Go struct embedding). */
export class AlignmentNode {
  constructor(pn) {
    this.placementNode = pn;
    this.prevSibling = null;
    this.root = this;
    this.alignedWith = this;
    this.sink = this;
    this.medianNeighbors = null;
    this.shift = 0;
    this.x = 0;
    this.blockSize = pn.graphNode.Width;
    this.rightPad = 0;
    this.leftPad = 0;
  }

  get graphNode() { return this.placementNode.graphNode; }
  get level() { return this.placementNode.level; }
  get rank() { return this.placementNode.rank; }
  get aboves() { return this.placementNode.aboves; }
  get belows() { return this.placementNode.belows; }
  get isDummy() { return this.placementNode.isDummy; }

  containerPadding() {
    return placementContainerPadding(this.placementNode);
  }
}

export function newAlignmentNode(pn) {
  return new AlignmentNode(pn);
}

/** placementNode.containerPadding. */
export function placementContainerPadding(pn) {
  if (pn == null || pn.isDummy) {
    return uniformSpacing(LAYOUTGRAPH_CONTAINER_PADDING);
  }
  let container = null;
  if (pn.container != null) {
    container = pn.container.graphNode;
  }
  return pn.graphNode.Graph.containerPadding(container, true);
}

/** Creates the alignment nodes sorted in the desired direction. */
export function createAlignmentNodes(ctx, byLevel, vertical, horizontal) {
  const guard = new WorkGuard(ctx, 'CreateAlignmentNodes', MAX_ENGINE_WORK_UNITS);
  const placementToAlignment = new Map();
  const nodes = [];
  for (let l = 0; l < byLevel.size; l++) {
    guard.Step();
    const leaves = leafNodesContext(byLevel.get(l) ?? [], guard);
    for (const node of leaves) {
      guard.Step();
      nodes.push(node);
      placementToAlignment.set(node.placementNode, node);
    }
  }

  sortAlignmentNodes(nodes, vertical, horizontal);
  guard.Finish();

  let x = -Infinity;
  let shift = Infinity;
  if (horizontal === Orientation.Right) {
    x = Infinity;
    shift = -Infinity;
  }
  let previous = null;
  for (const node of nodes) {
    guard.Step();
    if (previous != null && node.level !== previous.level) {
      previous = null;
    }
    node.medianNeighbors = medianNeighborsContext(node, vertical, horizontal, placementToAlignment, guard);
    node.prevSibling = previous;
    node.x = x;
    node.shift = shift;
    previous = node;
  }
  guard.Finish();
  return nodes;
}

// Go recurses over container depth; so does the port.
export function leafNodesContext(nodes, guard) {
  const leaves = [];
  for (let i = 0; i < nodes.length; i++) {
    guard.Step();
    const node = nodes[i];
    if (!node.isContainer) {
      leaves.push(newAlignmentNode(node));
      continue;
    }
    // Distribute container edges among children whose rank is closest to the
    // other endpoint's rank.
    const descendants = leafNodesContext(node.children, guard);

    const pickChildForEdge = (edgeEndpoint, possible) => {
      let best = possible[0];
      let minDiff = Math.abs(edgeEndpoint.rank - best.placementNode.rank);
      for (const cand of possible) {
        guard.Step();
        const diff = Math.abs(edgeEndpoint.rank - cand.placementNode.rank);
        if (diff < minDiff) {
          minDiff = diff;
          best = cand;
        }
      }
      return best;
    };

    // rewire "aboves" from container to children
    for (const above of node.aboves) {
      guard.Step();
      above.belows.delete(node);
      const bestChild = pickChildForEdge(above, descendants);
      above.belows.add(bestChild.placementNode);
      bestChild.placementNode.aboves.add(above);
    }

    // rewire "belows" from container to children
    for (const below of node.belows) {
      guard.Step();
      below.aboves.delete(node);
      const bestChild = pickChildForEdge(below, descendants);
      below.aboves.add(bestChild.placementNode);
      bestChild.placementNode.belows.add(below);
    }

    leaves.push(...descendants);
  }
  // The first container child has the left pad and the last one the right pad,
  // applied recursively for nested containers.
  const leftNode = leaves[0];
  const rightNode = leaves[leaves.length - 1];
  leftNode.leftPad += leftNode.containerPadding().Left();
  rightNode.rightPad += rightNode.containerPadding().Right();
  return leaves;
}

function compareInts(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortAlignmentNodes(nodes, vertical, horizontal) {
  if (vertical === Orientation.Top && horizontal === Orientation.Left) {
    nodes.sort((a, b) => (a.level === b.level ? compareInts(a.rank, b.rank) : compareInts(a.level, b.level)));
  } else if (vertical === Orientation.Top && horizontal === Orientation.Right) {
    nodes.sort((a, b) => (a.level === b.level ? compareInts(b.rank, a.rank) : compareInts(a.level, b.level)));
  } else if (vertical === Orientation.Bottom && horizontal === Orientation.Left) {
    nodes.sort((a, b) => (a.level === b.level ? compareInts(a.rank, b.rank) : compareInts(b.level, a.level)));
  } else if (vertical === Orientation.Bottom && horizontal === Orientation.Right) {
    nodes.sort((a, b) => (a.level === b.level ? compareInts(b.rank, a.rank) : compareInts(b.level, a.level)));
  }
}

export function medianNeighborsContext(n, vertical, horizontal, placementToAlignment, guard) {
  const neighbors = [];
  if (vertical === Orientation.Top) {
    for (const above of n.aboves) {
      guard.Step();
      if (above.level === n.level - 1) {
        neighbors.push(placementToAlignment.get(above));
      }
    }
  } else {
    for (const below of n.belows) {
      guard.Step();
      if (below.level === n.level + 1) {
        neighbors.push(placementToAlignment.get(below));
      }
    }
  }

  if (neighbors.length === 0) {
    return neighbors;
  }

  neighbors.sort((a, b) => compareInts(a.graphNode.TopLeft.X, b.graphNode.TopLeft.X));

  const mid = (neighbors.length + 1) / 2.0;
  if (neighbors.length % 2 === 1) {
    // exact median
    const medianIndex = Math.trunc(mid) - 1;
    return [neighbors[medianIndex]];
  }
  // consider left and right median
  let leftMedian = Math.floor(mid) - 1;
  let rightMedian = Math.ceil(mid) - 1;
  if (horizontal === Orientation.Right) {
    const tmp = leftMedian;
    leftMedian = rightMedian;
    rightMedian = tmp;
  }
  return [neighbors[leftMedian], neighbors[rightMedian]];
}

export function allAbove(pn) {
  return [...pn.aboves];
}

export function markConflicts(ctx, byLevel) {
  const guard = new WorkGuard(ctx, 'MarkHierarchyConflicts', MAX_ENGINE_WORK_UNITS);
  const conflicts = new Map();
  const addConflict = (n1, n2) => {
    let set = conflicts.get(n1);
    if (set == null) {
      set = new Set();
      conflicts.set(n1, set);
    }
    set.add(n2);
  };

  // skip the first and last level because there are no dummy nodes in them
  for (let level = 1; level < byLevel.size - 1; level++) {
    guard.Step();
    const nextLevel = level + 1;
    const nextNodes = byLevel.get(nextLevel) ?? [];
    let k0 = 0;
    let l = 0;
    for (let l1 = 0; l1 < nextNodes.length; l1++) {
      const pn = nextNodes[l1];
      guard.Step();
      let k1 = 0;
      if (l1 === nextNodes.length - 1) {
        const current = byLevel.get(level) ?? [];
        const last = current.length - 1;
        k1 = current[last].rank;
      } else if (pn.isDummy) {
        for (const above of allAbove(pn)) {
          guard.Step();
          // dummy nodes have only one edge above and one below
          if (!above.isDummy) {
            continue;
          }
          k1 = above.rank;
        }
      } else {
        continue;
      }
      for (; l <= l1; l++) {
        guard.Step();
        const n = nextNodes[l];
        for (const above of n.aboves) {
          guard.Step();
          if (above.rank < k0 || above.rank > k1) {
            addConflict(n, above);
            addConflict(above, n);
          }
        }
      }
      k0 = k1;
    }
  }

  guard.Finish();
  return conflicts;
}

export function verticalAlignment(ctx, nodes, conflicts, horizontal) {
  const guard = new WorkGuard(ctx, 'VerticalAlignment', MAX_ENGINE_WORK_UNITS);
  const hasConflict = (n1, n2) => {
    const c = conflicts.get(n1.placementNode);
    if (c != null) {
      return c.has(n2.placementNode);
    }
    return false;
  };

  // math.MaxInt / math.MinInt sentinels; ranks are small integers.
  let lastAlignedRank = Infinity;
  for (const n of nodes) {
    guard.Step();
    if (n.prevSibling == null) {
      if (horizontal === Orientation.Left) {
        lastAlignedRank = -Infinity;
      } else {
        lastAlignedRank = Infinity;
      }
    }

    for (const m of n.medianNeighbors) {
      guard.Step();
      if (hasConflict(n, m)) {
        continue;
      } else if (n.alignedWith !== n) {
        // already aligned
        continue;
      } else if (horizontal === Orientation.Left && lastAlignedRank >= m.rank) {
        // this would align crossing edges, skip
        continue;
      } else if (horizontal === Orientation.Right && lastAlignedRank <= m.rank) {
        continue;
      }
      m.alignedWith = n;
      n.root = m.root;
      n.alignedWith = n.root;
      m.root.blockSize = Math.max(m.root.blockSize, n.blockSize);
      m.root.leftPad = Math.max(m.root.leftPad, n.leftPad);
      m.root.rightPad = Math.max(m.root.rightPad, n.rightPad);
      lastAlignedRank = m.rank;
    }
  }
  guard.Finish();
}

export function horizontalCompaction(ctx, nodes, horizontalDirection) {
  const guard = new WorkGuard(ctx, 'HorizontalCompaction', MAX_ENGINE_WORK_UNITS);
  for (const n of nodes) {
    guard.Step();
    if (n.root === n) {
      placeBlock(n, horizontalDirection, guard);
    }
  }
  for (const n of nodes) {
    guard.Step();
    n.x = n.root.x;
    if (n.root === n && !isInf(n.sink.shift)) {
      n.x += n.sink.shift;
    }
  }
  guard.Finish();
}

// Go recurses through previous-sibling roots; so does the port.
export function placeBlock(root, horizontal, guard) {
  guard.Step();
  if (!isInf(root.x)) {
    return;
  }
  root.x = 0;
  let n = root;
  for (;;) {
    guard.Step();
    if (n.prevSibling != null) {
      const prevRoot = n.prevSibling.root;
      placeBlock(prevRoot, horizontal, guard);
      if (root.sink === root) {
        root.sink = prevRoot.sink;
      }
      const delta = distanceFromPreviousRoot(prevRoot, root, horizontal);
      if (root.sink !== prevRoot.sink) {
        if (horizontal === Orientation.Left) {
          prevRoot.sink.shift = Math.min(prevRoot.sink.shift, root.x - prevRoot.x - prevRoot.blockSize - delta);
        } else {
          prevRoot.sink.shift = Math.max(prevRoot.sink.shift, root.x - prevRoot.x + root.blockSize + delta);
        }
      } else if (horizontal === Orientation.Left) {
        root.x = Math.max(root.x, prevRoot.x + prevRoot.blockSize + delta);
      } else {
        root.x = Math.min(root.x, prevRoot.x - root.blockSize - delta);
      }
    }
    n = n.alignedWith;
    if (n === root) {
      break;
    }
  }
}

export function distanceFromPreviousRoot(previous, current, horizontal) {
  let pad = SIBLING_SPACING;
  if (current.isDummy || (current.prevSibling != null && current.prevSibling.isDummy)) {
    pad = SIBLING_DUMMY_SPACING;
  }
  if (horizontal === Orientation.Left) {
    pad += previous.rightPad + current.leftPad;
  } else {
    pad += previous.leftPad + current.rightPad;
  }
  return pad;
}
