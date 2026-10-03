// Pinned reference: internal/hierarchy/placement.go
//
// byLevel is a Map<level, placementNode[]> standing in for Go's
// map[int][]*placementNode: reads of a missing level behave like Go's nil
// slice (empty, not inserted), writes insert, and `len(byLevel)` is
// byLevel.size. aboves/belows are Sets standing in for Go map sets; see
// crossing.js and brandes-kopf.js for why their order never changes results.
//
// Go map iteration with an early return: placeNodesInHierarchy ranges over
// Hierarchy.Levels() polling ctx.Err() per node until it finds a fixed node.
// The number of polls before that early return is unspecified in Go; JS uses
// the Levels Map insertion order. Parity scenarios with a fixed member keep it
// as the only member order that matters (outcome is identical either way).

import { Point } from '../geometry/point.js';
import { Orientation } from '../geometry/orientation.js';
import { goRound } from '../geometry/math.js';
import { Node, nodeDebugID } from '../graph/node.js';
import { Validate } from '../graph/topology-preflight.js';
import { newGraphStateSnapshot } from '../graph/graph-state.js';
import { newGraph } from '../graph/graph.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { shuffle } from '../limits/optimization.js';
import {
  SplitOptions,
  NodeGraphOwnershipJournal,
  abductEdges,
  copyEntitiesFrom,
  hierarchyLevel,
  mirrorNode,
  restoreEdgeAbductions,
  setGraphReference,
  splitSubgraphsTracked,
} from '../graph/structural-access.js';
import { alignHierarchy } from './brandes-kopf.js';
import {
  computeLevelRanks,
  countCrossings,
  crossLevelSegments,
  initializeRanks,
  minimizeHierarchyCrossings,
} from './crossing.js';
import { globalSifting } from './sifting.js';
import { isHorizontal } from './orientation.js';
import { countHierarchyStructuralEdges, isSink, isSource } from './structural.js';
import {
  CROSSING_SPACING,
  MIN_PORT_CLEARANCE,
  PARENT_SPACING,
  SIBLING_SPACING,
} from './constants.js';
import {
  NO_WORK_GUARD,
  contextErr,
  nodesBounds,
  nodesCenter,
  transposeNode,
  wrapError,
} from './layoutgraph-support.js';

export { isSource, isSink };

export class PlacementNode {
  constructor(level, node) {
    this.graphNode = node;
    this.level = level;
    // level index left to right as if flattened, no container depth considered
    this.rank = 0;
    this.aboves = new Set();
    this.belows = new Set();
    this.container = null;
    // Go nil slice; every consumer only ranges over it or checks its length.
    this.children = [];
    // only SQL tables disable recursion into their (column) children
    this.optimizeChildrenCrossings = true;
    // intermediate nodes used to break long connections
    this.isChainningConnection = false;
    // Table nodes have children, but aren't containers
    this.isContainer = false;
    this.isDummy = false;
  }

  degree() {
    if (this.isDummy) {
      // dummy nodes have only 2 edges
      return 2;
    }
    return countHierarchyStructuralEdges(this.graphNode);
  }

  findNonDummyNode(above) {
    const firstNeighbor = (n, isAbove) => {
      const nodes = isAbove ? n.aboves : n.belows;
      for (const connected of nodes) {
        return connected;
      }
      return null;
    };
    let n = this;
    while (n.isDummy && n.isChainningConnection) {
      n = firstNeighbor(n, above);
    }
    return n;
  }

  /** (below *placementNode) connect(above). */
  connect(otherAbove) {
    let below = this;
    let above = otherAbove;
    if (above.level === below.level) {
      return;
    }
    if (above.level > below.level) {
      const tmp = below;
      below = above;
      above = tmp;
    }
    below.aboves.add(above);
    above.belows.add(below);
  }

  DebugID() {
    return `${nodeDebugID(this.graphNode)}[${this.level}, ${this.rank}]`;
  }
}

export function newPlacementNode(level, node) {
  return new PlacementNode(level, node);
}

function containerChildren(g, root) {
  return g.Containers.get(root ?? null) ?? [];
}

/** Place lays out every hierarchy below root, atomically. */
export function place(ctx, g, root, randGenerator) {
  Validate(ctx, 'PlaceHierarchies', g);
  if (containerChildren(g, root).length === 0) {
    return;
  }
  const [txCtx, guard] = ensureTransactionWorkGuard(ctx, 'PlaceHierarchiesTransactions');
  const state = newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, guard);
  let complete = false;
  try {
    placeContainer(txCtx, g, root ?? null, randGenerator ?? null);
    const err = contextErr(txCtx);
    if (err != null) {
      throw wrapError('PlaceHierarchies', err);
    }
    complete = true;
  } finally {
    if (!complete) {
      state.rollback(g);
    }
  }
}

export const Place = place;

// Go `place`: recursive over container depth, which Validate bounds.
export function placeContainer(ctx, g, root, randGenerator) {
  const hGraph = newGraph();
  copyEntitiesFrom(hGraph, g);
  for (const child of containerChildren(g, root)) {
    hGraph.AddNodeUnchecked(child);
  }

  let edgeAbductions = abductEdges(g, root, hGraph);
  let edgesRestored = false;
  let splitOwnership = new NodeGraphOwnershipJournal();
  try {
    for (const child of containerChildren(g, root)) {
      if (child.Hierarchy == null && child.IsContainer()) {
        placeContainer(ctx, g, child, randGenerator);
      }
    }

    let subgraphs;
    [subgraphs, splitOwnership] = splitSubgraphsTracked(ctx, hGraph, new SplitOptions({ IncludeNears: true }), null);
    for (const subgraph of subgraphs) {
      if (subgraph.Nodes[0].Hierarchy == null) {
        continue;
      }
      subgraph.ComputeCellSize();
      setGraphReference(g.Nodes, subgraph);
      edgeAbductions = restoreEdgeAbductions(subgraph, edgeAbductions);
      placeNodesInHierarchy(ctx, subgraph, randGenerator);
    }

    restoreEdgeAbductions(g, edgeAbductions);
    edgesRestored = true;
  } finally {
    if (!edgesRestored) {
      restoreEdgeAbductions(g, edgeAbductions);
    }
    // The split follows Nears outside hGraph.Nodes and temporarily redirects
    // their owners too. Restore every exact pre-split owner before retaining
    // the hierarchy stage's existing successful owner state for nodes in g.
    splitOwnership.Restore();
    setGraphReference(g.Nodes, g);
  }
}

export function placeNodesInHierarchy(ctx, g, rand) {
  // Never let derived state override an absolute constraint on a member.
  const hierarchy = g.Nodes[0].Hierarchy;
  if (hierarchy != null) {
    for (const node of hierarchy.Levels().keys()) {
      const err = contextErr(ctx);
      if (err != null) {
        throw wrapError('PlaceHierarchies', err);
      }
      if (node.FixedTopLeft != null) {
        return;
      }
    }
  }
  const [, guard] = ensureTransactionWorkGuard(ctx, 'PlaceHierarchiesTransactions');
  const state = newGraphStateSnapshot({ CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, guard);
  let complete = false;
  try {
    const placementNodes = createPlacementNodes(g, g.Nodes, rand);
    connectPlacementNodes(g, placementNodes);
    const byLevel = groupPlacementNodesByLevel(placementNodes);
    initializeRanks(byLevel);
    breakLongConnections(placementNodes, byLevel);
    minimizeHierarchyCrossings(byLevel);
    globalSifting(byLevel);
    const horizontal = isHorizontal(g.Nodes);
    if (horizontal) {
      transpose(g);
    }
    placeNodesByLevel(g, byLevel, horizontal);
    for (let level = 0; level < byLevel.size; level++) {
      byLevel.set(level, removeTableColumnNodes(byLevel.get(level) ?? []));
      computeLevelRanks(byLevel.get(level));
    }
    alignHierarchy(ctx, g, byLevel);
    if (horizontal) {
      transpose(g);
    }
    switch (g.Nodes[0].containerDirection()) {
      case Orientation.Left:
        mirrorX(g);
        break;
      case Orientation.Top:
        mirrorY(g);
        break;
      default:
        break;
    }
    complete = true;
  } finally {
    if (!complete) {
      state.rollback(g);
    }
  }
}

/** create placement nodes recursively and set the container when required. */
export function createPlacementNodes(g, nodes, rand) {
  const placementNodes = [];
  for (const node of nodes) {
    const pn = newPlacementNode(hierarchyLevel(node), node);
    placementNodes.push(pn);
    if (node.isTable()) {
      const columns = node.numColumns();
      pn.children = new Array(columns);
      pn.optimizeChildrenCrossings = false;
      pn.isContainer = false;
      for (let i = 0; i < columns; i++) {
        pn.children[i] = newPlacementNode(pn.level, null);
        pn.children[i].container = pn;
        pn.children[i].isDummy = true;
      }
    } else {
      pn.optimizeChildrenCrossings = true;
      pn.children = [];
      for (const child of createPlacementNodes(g, containerChildren(g, node), rand)) {
        if (child.container == null) {
          child.container = pn;
          pn.children.push(child);
        }
      }
      pn.isContainer = pn.children.length > 0;
    }
  }
  if (rand != null) {
    // math/rand.Shuffle: identical Fisher-Yates draws, no work charge.
    shuffle(placementNodes, rand, NO_WORK_GUARD);
  }
  return placementNodes;
}

export function connectPlacementNodes(g, nodes) {
  const nodeToPlacementNode = new Map();
  const queue = nodes.slice();
  for (let head = 0; head < queue.length; head++) {
    const pn = queue[head];
    nodeToPlacementNode.set(pn.graphNode, pn);
    queue.push(...pn.children);
  }

  for (const edge of g.Edges) {
    let from = nodeToPlacementNode.get(edge.From);
    let to = nodeToPlacementNode.get(edge.To);
    to.connect(from);

    if (edge.isBetweenTableColumns()) {
      // connect the rows
      from = from.children[edge.FromTableColumnIndex];
      to = to.children[edge.ToTableColumnIndex];
      to.connect(from);
    }
  }
}

function compareInts(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * breakLongConnections creates chains of dummy nodes when two connected nodes
 * are more than one level apart. Dummy IDs restart at -1 in every recursive
 * call, exactly as Go's per-call `dummies` slice.
 */
export function breakLongConnections(nodes, byLevel) {
  const dummies = [];
  for (const pn of nodes) {
    const belows = [];
    for (const below of pn.belows) {
      if (below.level - pn.level > 1) {
        belows.push(below);
      }
    }
    belows.sort((a, b) => {
      const order = compareInts(a.rank, b.rank);
      if (order !== 0) return order;
      return compareInts(a.level, b.level);
    });
    for (const below of belows) {
      pn.belows.delete(below);
      below.aboves.delete(pn);

      let above = pn;
      for (let level = pn.level + 1; level < below.level; level++) {
        const dummyID = BigInt(-(dummies.length + 1));
        const dummy = newPlacementNode(level, new Node(dummyID, 1, 1));
        dummy.isChainningConnection = true;
        dummy.isDummy = true;
        let levelNodes = byLevel.get(level);
        dummy.rank = levelNodes == null ? 0 : levelNodes.length;
        dummy.connect(above);
        dummies.push(dummy);
        if (levelNodes == null) {
          levelNodes = [];
          byLevel.set(level, levelNodes);
        }
        levelNodes.push(dummy);
        above = dummy;
      }
      below.connect(above);
    }
    dummies.push(...breakLongConnections(pn.children, byLevel));
  }
  return dummies;
}

export function groupPlacementNodesByLevel(nodes) {
  const byLevel = new Map();
  for (const pn of nodes) {
    let list = byLevel.get(pn.level);
    if (list == null) {
      list = [];
      byLevel.set(pn.level, list);
    }
    list.push(pn);
  }
  return byLevel;
}

/** removeTableColumnNodes removes column dummies and their chains. */
export function removeTableColumnNodes(nodes) {
  const newNodes = [];
  for (const node of nodes) {
    if (node.isDummy) {
      if (node.graphNode == null) {
        // table column
        continue;
      } else if (node.isChainningConnection) {
        const above = node.findNonDummyNode(true);
        const below = node.findNonDummyNode(false);
        if (above.graphNode == null || below.graphNode == null) {
          // dummy node chaining a long connection between two table columns
          continue;
        }
      }
    }
    newNodes.push(node);
    node.children = removeTableColumnNodes(node.children);
  }
  return newNodes;
}

export function placeNodesByLevel(g, byLevel, horizontal) {
  let yOffset = 0.0;
  for (let i = 0; i < byLevel.size; i++) {
    const nodes = [];
    let levelHeight = 0.0;
    let xOffset = 0.0;
    const levelNodes = byLevel.get(i) ?? [];
    for (const pn of levelNodes) {
      nodes.push(pn.graphNode);
      pn.graphNode.TopLeft = new Point(xOffset, yOffset);
      if (!pn.isDummy) {
        let container = null;
        if (pn.container != null) {
          container = pn.container.graphNode;
        }
        const padding = g.containerPadding(container, true);
        placeDescendants(g, pn, pn.graphNode.insidePlacement(1, 1, padding));
        levelHeight = Math.max(levelHeight, pn.graphNode.Height);
        xOffset += Math.ceil(pn.graphNode.Width) + SIBLING_SPACING;
      } else {
        xOffset += SIBLING_SPACING;
      }
    }
    const distanceToNextLevel = minimumDistanceToNextLevel(levelNodes, horizontal);
    yOffset += Math.ceil(levelHeight + distanceToNextLevel + 2 * MIN_PORT_CLEARANCE);

    // move to center
    const center = nodesCenter(nodes);
    center.Y = Math.ceil(center.Y);
    for (const node of nodes) {
      const yDiff = Math.ceil(center.Y - node.center().Y);
      node.translate(0, yDiff);
    }
  }
}

// recursively place all descendants of a given container (Go recursion).
export function placeDescendants(g, root, tl) {
  if (!root.isContainer) {
    return;
  }
  const padding = g.containerPadding(root.graphNode, true);
  let x = tl.X;
  for (const child of root.children) {
    child.graphNode.TopLeft = new Point(x, tl.Y);
    placeDescendants(g, child, child.graphNode.insidePlacement(1, 1, padding));
    x += Math.ceil(child.graphNode.Width) + SIBLING_SPACING;
  }
  const [childrenTL, childrenBR] = nodesBounds(containerChildren(g, root.graphNode));
  root.graphNode.fitToBoundingBox(childrenTL, childrenBR, padding);
}

/**
 * minimumDistanceToNextLevel computes the distance between two levels,
 * accounting for crossings between them and label sizes.
 */
export function minimumDistanceToNextLevel(levelNodes, horizontal) {
  const segments = crossLevelSegments(levelNodes, false, true);
  const crossings = countCrossings(segments);
  const crossingsDistance = Number(crossings) * CROSSING_SPACING;

  let maxLabelSize = 0;
  for (const node of levelNodes) {
    if (node.isDummy) {
      continue;
    }
    for (const e of node.graphNode.Edges) {
      const adj = node.graphNode.adjacent(e);
      let from = node.graphNode;
      let to = adj;
      if (hierarchyLevel(to) < hierarchyLevel(from)) {
        const tmp = from;
        from = to;
        to = tmp;
      }
      if (hierarchyLevel(to) - hierarchyLevel(from) !== 1) {
        continue;
      }
      if (e.Label != null) {
        if (horizontal) {
          maxLabelSize = Math.max(e.Label.Width, maxLabelSize);
        } else {
          maxLabelSize = Math.max(e.Label.Height, maxLabelSize);
        }
      }
    }
  }
  let distance = Math.max(crossingsDistance, maxLabelSize + CROSSING_SPACING);
  // ensure there'll be some space if there are no crossings
  distance = Math.max(CROSSING_SPACING, distance);
  // clip to avoid large gaps between levels
  distance = Math.min(distance, PARENT_SPACING);
  return goRound(distance);
}

export function iterContainersBFS(g, apply) {
  const queue = g.Nodes.slice();
  for (let head = 0; head < queue.length; head++) {
    const curr = queue[head];
    if (curr.IsContainer()) {
      queue.push(...(g.Containers.get(curr) ?? []));
    }
    apply(curr);
  }
}

export function transpose(g) {
  iterContainersBFS(g, (n) => transposeNode(n));
}

export function mirrorX(g) {
  iterContainersBFS(g, (n) => mirrorNode(n, true, false));
}

export function mirrorY(g) {
  iterContainersBFS(g, (n) => mirrorNode(n, false, true));
}
