/**
 * Tree discovery (Preprocess) and placement (Place).
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/layout.go
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *
 * Conventions: Go (value, error) returns become a returned value or a thrown
 * Error; WorkGuard Step/Check/Finish throw and are called in pinned Go order
 * and count. Transaction.Commit/UpdateState return errors (null on success).
 * Whole-call atomicity: Preprocess and Place capture a topology GraphState
 * snapshot and roll it back on any thrown error (Go: deferred rollback that
 * also runs while panicking).
 *
 * Go map iteration (documented nondeterminism):
 *   - extractTreesInContainer ranges g.Containers / g.Sequences only to mark
 *     terminals (order-insensitive; same guard count).
 *   - extractTrees copies per-container results into a map; JS keeps
 *     insertion order. Keys are unique, so contents never depend on order.
 *   - buildPlacementTrees ranges the per-direction root groups of an isolated
 *     sentinel. Placement trees are later sorted by unique keys, so only the
 *     undirected merge target can depend on Go's random order: when two
 *     non-undirected groups tie on child count and both lack an arrow into
 *     the sentinel, Go picks either. JS picks the group whose first root
 *     appears first in g.Trees[sentinel].
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { goRound } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { Orientation, getOpposite } from '../geometry/orientation.js';
import { MAX_PLACE_TREES_WORK_UNITS, MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { contextWithTransactionWorkGuard } from '../limits/transaction-guard.js';
import { newGraphStateSnapshot } from '../graph/graph-state.js';
import { Validate } from '../graph/topology-preflight.js';
import { Tree } from '../graph/tree.js';
import { isCandidateRejection } from '../graph/transaction.js';
import { arrowheadTo, tracksNode } from '../graph/structural-access.js';
import { Undirected, newWorkGuard, treeEdgeDirection } from './types.js';
import {
  addTreeChild,
  buildNodeToTreeGuarded,
  buildTreeAdjacencyMatrix,
  candidateTreeRoots,
  countTreeDirections,
  disconnectTreeEdge,
  filterTerminalTrees,
  isIsolatedTreeGuarded,
  reconnectTreeGuarded,
  removeNodeFromContainer,
  removeNodeFromGraph,
  reverseTreeChain,
  rootsByTreeDirection,
  treeBranches,
  treeContainerRDFSOrder,
  treeDescendants,
  treeEndOfLine,
  treeFringeNodes,
  treePreprocessBadState,
  treePreprocessLocation,
  treeSize,
} from './preprocess-helpers.js';
import {
  DIRECTION_PENALTY,
  centerAlignChildren,
  flip,
  layoutTree,
  offsetSubtree,
  positionEdgeLabels,
  setOrientation,
  swapDimensions,
  validateBottomOrientation,
} from './geometry.js';

function containerChildren(g, container) {
  return g.Containers.get(container) ?? [];
}

/**
 * extractTreesInContainer returns Map<rootSentinel, Tree[]>, or null when the
 * container holds a table (Go nil map).
 */
export function extractTreesInContainer(g, container, guard) {
  // Go keeps this slice header for the whole call; removeNodeFromContainer
  // installs new slices without mutating it.
  const containerNodes = containerChildren(g, container);
  const nodeToTree = new Map();
  for (const node of containerNodes) {
    guard.Step();
    if (node == null) {
      throw treePreprocessBadState('tree container contains a nil node');
    }
    if (node.IsTable()) {
      return null;
    }
    nodeToTree.set(node, new Tree(node));
  }
  const edgeBetween = buildTreeAdjacencyMatrix(g, guard);

  // Terminal node: tree never reaches here, but roots can connect to graph here
  // Sentinel node: the node that a tree root is connected to
  const isTerminal = new Map();
  const sentinelToTreeRoots = new Map();
  const sentinelToArrowheads = new Map();

  // mark all containers as terminal so they aren't in trees
  for (const c of g.Containers.keys()) {
    guard.Step();
    isTerminal.set(c, true);
  }
  for (const vessel of g.Sequences.keys()) {
    guard.Step();
    isTerminal.set(vessel, true);
  }
  // if node has Nears, don't put it in a tree since placement doesn't work with both Nears and Trees
  for (const n of g.Nodes) {
    guard.Step();
    if (n.Nears.size > 0 || n.FixedTopLeft != null) {
      isTerminal.set(n, true);
    }
  }

  for (;;) {
    const fringeNodes = [];
    const candidates = treeFringeNodes(containerNodes, guard);
    for (const fn of candidates) {
      guard.Step();
      if (!isTerminal.has(fn)) {
        fringeNodes.push(fn);
      }
    }
    if (fringeNodes.length === 0) {
      break;
    }

    for (const fn of fringeNodes) {
      guard.Step();
      // Note: fn can be marked terminal if it is the sentinel of another fringe node
      // in this set which has its incoming edge directions not matching the sentinel edge
      if (isTerminal.has(fn)) {
        continue;
      }

      if (fn.Edges.length !== 1 || fn.Edges[0] == null) {
        throw treePreprocessBadState(`fringe node ${fn.ID} has invalid degree`);
      }
      const sentinelNode = fn.adjacent(fn.Edges[0]);
      if (sentinelNode == null) {
        throw treePreprocessBadState(`fringe node ${fn.ID} has no sentinel`);
      }
      // if there are a pair of fringe nodes remaining, mark the first one as terminal and continue
      // otherwise both will have their tree nodes as children of each other
      if (sentinelNode.Edges.length === 1 && sentinelNode.adjacent(sentinelNode.Edges[0]) === fn) {
        if (!isTerminal.has(sentinelNode)) {
          isTerminal.set(fn, true);
          continue;
        }
      }
      const tree = nodeToTree.get(fn);
      if (tree == null) {
        throw treePreprocessBadState(`fringe node ${fn.ID} has no tree record`);
      }
      tree.SentinelEdge = edgeBetween(fn, sentinelNode);
      if (tree.SentinelEdge == null) {
        throw treePreprocessBadState(`fringe node ${fn.ID} has no graph sentinel edge`);
      }

      if (!sentinelToTreeRoots.has(sentinelNode)) {
        sentinelToTreeRoots.set(sentinelNode, []);
        sentinelToArrowheads.set(sentinelNode, new Set());
      }

      const ah = arrowheadTo(tree.SentinelEdge, sentinelNode);

      sentinelToTreeRoots.get(sentinelNode).push(tree);
      sentinelToArrowheads.get(sentinelNode).add(ah);

      if (sentinelToTreeRoots.has(fn)) {
        // Note: treeRoots may contain a terminal node if a root was marked from another direction leading to it
        const treeRoots = filterTerminalTrees(sentinelToTreeRoots.get(fn), isTerminal, guard);
        if (treeRoots.length === 0) {
          continue;
        }
        const directionCounts = countTreeDirections(treeRoots, guard);
        // the fringe node is terminal if it has incoming edges with more than one direction
        // or multiple different arrowheads
        if (directionCounts.size > 1 || sentinelToArrowheads.get(fn).size > 1) {
          isTerminal.set(fn, true);
        } else {
          // merge the roots with the fringe node tree
          for (const t of treeRoots) {
            addTreeChild(tree, t, guard);
          }

          const hasUndirected = directionCounts.has(Undirected);
          const sentinelEdgeDirection = treeEdgeDirection(fn, tree.SentinelEdge);
          const hasSentinelDirection = directionCounts.has(sentinelEdgeDirection);
          // sentinel node is terminal if the fringe node's incoming edges don't match the edge to the sentinel node
          // a directed edge can merge with Undirected edges and an Undirected edge can merge with matching directed edges
          const sentinelIsTerminal = !(hasUndirected || sentinelEdgeDirection === Undirected) && !hasSentinelDirection;

          if (sentinelIsTerminal) {
            isTerminal.set(sentinelNode, true);
          }
        }
      }
    }

    for (const fn of fringeNodes) {
      guard.Step();
      if (!isTerminal.has(fn)) {
        removeNodeFromGraph(fn, g, guard);
        disconnectTreeEdge(g, nodeToTree.get(fn).SentinelEdge, guard);
        // remove node from container to children map
        removeNodeFromContainer(g, container, fn, guard);
      }
    }
  }

  const terminalNodeToTreeRoots = new Map();
  // Go ranges over the g.Nodes header captured here; handleTreeSubgraph
  // installs a new slice.
  const graphNodes = g.Nodes;
  const graphNodeCount = graphNodes.length;
  for (let i = 0; i < graphNodeCount; i++) {
    const node = graphNodes[i];
    guard.Step();
    if (sentinelToTreeRoots.has(node)) {
      const filteredRoots = filterTerminalTrees(sentinelToTreeRoots.get(node), isTerminal, guard);
      if (filteredRoots.length === 0) {
        continue;
      }
      // if the sentinel is a sequence, we must keep it as is since it can't be inside the tree
      if (g.Sequences.has(node)) {
        terminalNodeToTreeRoots.set(node, filteredRoots);
      } else {
        const [rootSentinel, roots] = handleTreeSubgraph(g, node, container, filteredRoots, guard);
        terminalNodeToTreeRoots.set(rootSentinel, roots);
      }
    }
  }

  guard.Check();
  return terminalNodeToTreeRoots;
}

export function extractTrees(g, guard) {
  // extract trees in the base graph (null container) and in all containers
  const terminalNodeToTreeRoots = new Map();
  const containerOrder = treeContainerRDFSOrder(g, null, guard);
  containerOrder.push(null);
  for (const container of containerOrder) {
    guard.Step();
    const containerTrees = extractTreesInContainer(g, container, guard);
    if (containerTrees == null) {
      continue;
    }
    for (const [rootSentinel, roots] of containerTrees) {
      guard.Step();
      terminalNodeToTreeRoots.set(rootSentinel, roots);
    }
  }
  return terminalNodeToTreeRoots;
}

/**
 * handleTreeSubgraph merges tree parts that share an internal root sentinel.
 * Returns [rootSentinel, roots].
 */
export function handleTreeSubgraph(g, rootSentinel, container, roots, guard) {
  // if rootSentinel has connections after extract trees it isn't a subgraph,
  //  and if there isn't more than 1 tree root there aren't any parts to merge
  if (!(rootSentinel.Edges.length === 0 && roots.length > 1)) {
    return [rootSentinel, roots];
  }
  if (rootSentinel.IsContainer()) {
    return [rootSentinel, roots];
  }

  let newRootSentinel = null;
  let newTreeRoot = null;
  const candidateRoots = candidateTreeRoots(roots, guard);
  for (const candidateRoot of candidateRoots) {
    guard.Step();
    // if the root tree is a line, then it can be the merged tree root
    const newRoot = treeEndOfLine(candidateRoot, guard);
    if (newRoot != null) {
      // We just need to join the other roots as children of a new Tree for rootSentinel,
      const jointNode = new Tree(rootSentinel);
      for (const otherRoot of roots) {
        guard.Step();
        if (otherRoot !== newRoot) {
          addTreeChild(jointNode, otherRoot, guard);
        }
      }

      // Note: the root's Sentinel Edge is overwritten by reversing the chain, so we have to record it beforehand
      const edgeToRootSentinel = candidateRoot.SentinelEdge;
      //   flip the tree nodes along the root,
      reverseTreeChain(candidateRoot, guard);
      //   and connect the node and the flipped chain together.
      addTreeChild(candidateRoot, jointNode, guard);
      jointNode.SentinelEdge = edgeToRootSentinel;

      newRootSentinel = newRoot.Node;
      newTreeRoot = newRoot.Children[0];
      newTreeRoot.Parent = null;
      break;
    }
  }

  if (newRootSentinel != null && newTreeRoot != null) {
    removeNodeFromGraph(rootSentinel, g, guard);
    g.AddNodeUnchecked(newRootSentinel);
    guard.Step();

    const filtered = [];
    for (const n of containerChildren(g, container)) {
      guard.Step();
      if (n === rootSentinel) {
        continue;
      }
      filtered.push(n);
    }
    filtered.push(newRootSentinel);
    g.Containers.set(container, filtered);

    return [newRootSentinel, [newTreeRoot]];
  }
  return [rootSentinel, roots];
}

/**
 * invertOrientationToBottom prepares a tree for a Bottom-defined operation in
 * the given orientation. Must also be called afterwards to undo its effects.
 */
export function invertOrientationToBottom(t, orientation, guard) {
  switch (orientation) {
    case Orientation.Top:
      flip(t, guard);
      return;
    case Orientation.Right:
      swapDimensions(t, guard);
      return;
    case Orientation.Left:
      swapDimensions(t, guard);
      flip(t, guard);
      return;
    default:
      guard.Check();
  }
}

export function constructToOrientation(placementTree, orientation, guard) {
  setOrientation(placementTree, orientation, guard);
  invertOrientationToBottom(placementTree, orientation, guard);
  layoutTree(placementTree, guard);
  centerAlignChildren(placementTree, guard);
  invertOrientationToBottom(placementTree, orientation, guard);
}

/** Returns the first fixed origin in container, or null. */
export function treePlacementFixedOrigin(g, container, guard) {
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null) {
      throw treePreprocessBadState('tree placement encountered a nil graph node');
    }
    if (node.EffectiveContainer() !== container) {
      continue;
    }
    const point = node.FixedOrigin();
    if (point != null) {
      return point;
    }
  }
  return null;
}

export function placeAtOrientationGuarded(ctx, g, placementTree, orientation, guard) {
  ctx = contextWithTransactionWorkGuard(ctx, guard);
  if (placementTree == null || placementTree.Node == null || placementTree.Node.TopLeft == null) {
    throw treePreprocessBadState('tree placement encountered an incomplete placement tree');
  }
  guard.Finish();
  const positionOf = (n) => {
    switch (orientation) {
      case Orientation.Left:
        return n.TopLeft.X;
      case Orientation.Right:
        return n.TopLeft.X + n.Width;
      case Orientation.Top:
        return n.TopLeft.Y;
      default:
        return n.TopLeft.Y + n.Height;
    }
  };
  const moveTree = (from, to) => {
    let dx = 0.0;
    let dy = 0.0;
    if (orientation === Orientation.Left || orientation === Orientation.Right) {
      dx = goRound(to - from);
    } else if (orientation === Orientation.Top || orientation === Orientation.Bottom) {
      dy = goRound(to - from);
    }
    for (const child of placementTree.Children) {
      guard.Step();
      offsetSubtree(child, dx, dy, guard);
    }
    guard.Finish();
  };
  const isFurtherOut = (a, b) => {
    if (orientation === Orientation.Left || orientation === Orientation.Top) {
      return a < b;
    }
    return a > b;
  };

  // 0. Find the root position and border position
  const rootPosition = positionOf(placementTree.Node);
  let borderPosition = rootPosition;
  const descendants = treeDescendants(placementTree, guard);
  const isNodeOfTree = new Set();
  isNodeOfTree.add(placementTree.Node);
  for (const descendant of descendants) {
    guard.Step();
    isNodeOfTree.add(descendant.Node);
  }
  for (const n of g.Nodes) {
    guard.Step();
    if (n == null || n.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete graph node');
    }
    if (!isNodeOfTree.has(n)) {
      const position = positionOf(n);
      if (isFurtherOut(position, borderPosition)) {
        borderPosition = position;
      }
    }
  }

  // 1. Move the tree to the starting border position
  let currentBestPosition = borderPosition;
  let currentBestDistance = Math.abs(currentBestPosition - rootPosition);

  moveTree(0, borderPosition);
  // if there are fixed nodes in the container, there shouldn't be any negative coordinates in the initial placement
  const fixedOrigin = treePlacementFixedOrigin(g, placementTree.Node.EffectiveContainer(), guard);
  if (fixedOrigin != null) {
    let hasNegative = false;
    const placementNodes = [placementTree, ...descendants];
    for (const tree of placementNodes) {
      guard.Step();
      if (tree.Node.TopLeft.X < fixedOrigin.X || tree.Node.TopLeft.Y < fixedOrigin.Y) {
        hasNegative = true;
        break;
      }
    }
    if (hasNegative) {
      currentBestDistance = Infinity;
    }
  }

  // 2a. find nodes between the root and the border to find placement options closer to the root node
  const obstaclePositions = [];
  for (const n of g.Nodes) {
    guard.Step();
    if (!isNodeOfTree.has(n)) {
      const position = positionOf(n);
      if (isFurtherOut(borderPosition, position) && isFurtherOut(position, rootPosition)) {
        obstaclePositions.push(position);
      }
    }
  }
  // 2b. We add the root position as an option and we start at the border for the edge cases
  obstaclePositions.push(rootPosition);

  const [txn, txnErr] = g.newRequestTransaction(ctx, {});
  if (txnErr != null) {
    throw txnErr;
  }
  for (const obstaclePosition of obstaclePositions) {
    guard.Step();
    // 2c. Try moving the tree next to each obstacle
    txn.AddOp(() => {
      moveTree(currentBestPosition, obstaclePosition);
      return null;
    });
    // 2d. Undo if overlapping or too close to other nodes
    const commitErr = txn.Commit(ctx);
    if (commitErr != null) {
      txn.Clear();
      if (isCandidateRejection(commitErr)) {
        continue;
      }
      throw commitErr;
    }
    try {
      guard.Finish();
    } catch (err) {
      txn.Clear();
      throw err;
    }

    // 2e. Keep this position if it is closer to the root, otherwise undo the movement
    const obstacleDistance = Math.abs(obstaclePosition - rootPosition);
    if (obstacleDistance < currentBestDistance) {
      currentBestPosition = obstaclePosition;
      currentBestDistance = obstacleDistance;
      const updateErr = txn.UpdateState();
      if (updateErr != null) {
        txn.Clear();
        throw updateErr;
      }
    } else {
      txn.Rollback();
    }
    txn.Clear();
  }

  guard.Finish();
  return currentBestDistance;
}

/**
 * putBackNonBranchingTrees reconnects non-branching trees, which gain little
 * from tree placement, to the graph for node placement.
 */
export function putBackNonBranchingTrees(g, guard) {
  const containerOrder = treeContainerRDFSOrder(g, null, guard);
  containerOrder.push(null);
  for (const container of containerOrder) {
    guard.Step();
    // Go ranges over the slice header captured here; reconnection appends to
    // g.Containers[container] (the same JS array) without extending the range.
    const containerNodes = containerChildren(g, container);
    const containerNodeCount = containerNodes.length;
    for (let i = 0; i < containerNodeCount; i++) {
      const node = containerNodes[i];
      guard.Step();
      if (!g.Trees.has(node)) {
        continue;
      }
      const roots = g.Trees.get(node);
      if (roots == null || roots.length === 0) {
        throw treePreprocessBadState(`tree sentinel ${node.ID} has no roots`);
      }
      const isolated = isIsolatedTreeGuarded(g, node, guard);
      let firstBranches = false;
      if (isolated && roots.length === 1) {
        firstBranches = treeBranches(roots[0], guard);
      }
      if (isolated && (roots.length > 1 || firstBranches)) {
        // if it is a branching isolated tree, don't put back its roots
        // for a sequence vessel sentinel: put non-branching roots back since tree placement
        // isn't tailored for sequences so it's only worth keeping branching roots
        if (!g.Sequences.has(node)) {
          continue;
        }
      }
      const branchingRoots = [];
      for (const root of roots) {
        guard.Step();
        const branches = treeBranches(root, guard);
        if (!branches) {
          const reconnectionTree = new Tree(node);
          addTreeChild(reconnectionTree, root, guard);
          reconnectTreeGuarded(g, reconnectionTree, container, guard);
        } else {
          branchingRoots.push(root);
        }
      }
      if (branchingRoots.length > 0) {
        g.Trees.set(node, branchingRoots);
      } else {
        g.Trees.delete(node);
      }
    }
  }
  guard.Check();
}

function rollbackOnFailure(g, state, body) {
  let complete = false;
  try {
    body();
    complete = true;
  } finally {
    if (!complete) {
      state.rollback(g);
    }
  }
}

export function preprocessTreesWithWorkLimit(ctx, g, workLimit) {
  Validate(ctx, treePreprocessLocation, g);
  const guard = newWorkGuard(ctx, treePreprocessLocation);
  guard.SetLimit(workLimit);

  const state = newGraphStateSnapshot({
    CaptureTopology: true,
    CaptureEdgeRoutes: true,
  });
  state.updateWithWorkGuard(g, guard);

  rollbackOnFailure(g, state, () => {
    const trees = extractTrees(g, guard);
    g.Trees = trees;
    guard.Step();
    guard.Check();
    putBackNonBranchingTrees(g, guard);
    buildNodeToTreeGuarded(g, guard);
    guard.Finish();
  });
}

/** Preprocess discovers trees, detaching them from g into g.Trees/g.NodeToTree. */
export function Preprocess(ctx, g) {
  preprocessTreesWithWorkLimit(ctx, g, MAX_ENGINE_WORK_UNITS);
}

/**
 * normalizedAspectRatio: width/height when width >= height, else height/width.
 */
export function normalizedAspectRatio(g, guard) {
  // BoundingBox has no guard parameter and may inspect every peer node while
  // resolving outside labels. Charge its node-pair and route-point traversal
  // here so cancellation and the aggregate work limit cover the calculation.
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null || node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete graph node');
    }
    for (let i = 0; i < g.Nodes.length; i++) {
      guard.Step();
    }
  }
  for (const edge of g.Edges) {
    guard.Step();
    if (edge == null) {
      throw treePreprocessBadState('tree placement encountered a nil graph edge');
    }
    for (const point of edge.Points ?? []) {
      guard.Step();
      if (point == null) {
        throw treePreprocessBadState('tree placement encountered a nil route point');
      }
    }
  }
  const [tl, br] = g.BoundingBox();
  if (tl == null || br == null) {
    throw treePreprocessBadState('tree placement could not compute a graph bounding box');
  }
  guard.Finish();
  const width = br.X - tl.X;
  const height = br.Y - tl.Y;
  if (width >= height) {
    return width / height;
  }
  return height / width;
}

const DEFAULT_ORDER = [Orientation.Bottom, Orientation.Top, Orientation.Left, Orientation.Right];

/**
 * placeTree reconnects a placement tree with the best placement found and
 * returns the chosen orientation. existingPlacements is a Set of orientations.
 */
export function placeTree(ctx, g, placementTree, container, existingPlacements, guard) {
  // 0. initialize TopLeft to non-null for placement
  const descendants = treeDescendants(placementTree, guard);
  for (const t of descendants) {
    guard.Step();
    t.Node.TopLeft = new Point(0, 0);
    guard.Finish();
  }

  // 1. restore the tree to the graph
  reconnectTreeGuarded(g, placementTree, container, guard);

  // 2. find the best orientation to place the tree close to the root node
  // Go zero value geo.Orientation is TopLeft.
  let bestOrientation = Orientation.TopLeft;
  let bestDistance = Infinity;
  let bestRatio = Infinity;

  let order = [];

  const isIsolatedTree = isIsolatedTreeGuarded(g, placementTree.Node, guard);
  if (existingPlacements.size === 1) {
    for (const o of DEFAULT_ORDER) {
      if (existingPlacements.has(o)) {
        bestOrientation = getOpposite(o);
        break;
      }
    }
  } else {
    // for isolated trees, don't place on the same side as an already placed tree
    if (isIsolatedTree) {
      for (const o of DEFAULT_ORDER) {
        if (existingPlacements.has(o)) {
          continue;
        }
        order.push(o);
      }
      if (order.length === 0) {
        // we ran out of unused sides
        order = DEFAULT_ORDER;
      }
    } else {
      order = DEFAULT_ORDER;
    }

    const direction = g.Direction(container);
    for (const orientation of order) {
      guard.Step();
      constructToOrientation(placementTree, orientation, guard);
      let distance = placeAtOrientationGuarded(ctx, g, placementTree, orientation, guard);
      const ratio = normalizedAspectRatio(g, guard);

      // slightly favor the container direction
      if (orientation !== direction) {
        distance += DIRECTION_PENALTY;
      }

      if (distance < bestDistance) {
        bestOrientation = orientation;
        bestDistance = distance;
        bestRatio = ratio;
      } else if (distance === bestDistance && ratio < bestRatio) {
        // break ties with width & height ratio closest to 1 (most square)
        bestOrientation = orientation;
        bestRatio = ratio;
      }
    }
  }

  // 3. place using the best orientation
  guard.Step();
  constructToOrientation(placementTree, bestOrientation, guard);
  placeAtOrientationGuarded(ctx, g, placementTree, bestOrientation, guard);

  positionTreeEdgeLabels(placementTree, isIsolatedTree, guard);
  return bestOrientation;
}

export function positionTreeEdgeLabels(placementTree, isIsolatedTree, guard) {
  const orientation = placementTree.Orientation;
  invertOrientationToBottom(placementTree, orientation, guard);
  let primary = null;
  let failed = false;
  try {
    const labelTrees = [];
    for (const root of placementTree.Children) {
      guard.Step();
      // if it is an isolated tree, we also position the root's sentinel edge label (because we route it in an s-shape)
      if (isIsolatedTree) {
        labelTrees.push(root);
      } else {
        for (const child of root.Children) {
          guard.Step();
          labelTrees.push(child);
        }
      }
    }
    for (const tree of labelTrees) {
      guard.Step();
      validateBottomOrientation(tree, guard);
    }
    for (const tree of labelTrees) {
      guard.Step();
      positionEdgeLabels(tree, guard);
    }
    guard.Finish();
  } catch (err) {
    primary = err;
    failed = true;
  }
  // Go defer: always restore; a restore error only surfaces when the body succeeded.
  try {
    invertOrientationToBottom(placementTree, orientation, guard);
  } catch (restoreErr) {
    if (!failed) {
      throw restoreErr;
    }
  }
  if (failed) {
    throw primary;
  }
}

export function placeTrees(ctx, g, container, guard) {
  const placementTrees = buildPlacementTrees(g, guard);
  const treeSizes = new Map();
  for (const placementTree of placementTrees) {
    treeSizes.set(placementTree, treeSize(placementTree, guard));
  }
  // Sorting cannot return an error from its comparator. Charge a stable
  // n*ceil(log2(n)) upper bound first, one step at a time, so sorting remains
  // covered by the same overflow-safe aggregate budget.
  const count = placementTrees.length;
  for (let width = 1; width < count;) {
    for (let i = 0; i < count; i++) {
      guard.Step();
    }
    if (width > Math.floor(count / 2)) {
      break;
    }
    width *= 2;
  }
  // Note: we sort placementTrees so larger trees are placed first and to have a deterministic order.
  // Keys are unique (size, then first child's ID), so Go's unstable sort is total.
  placementTrees.sort((a, b) => {
    const sizeOrder = compare(treeSizes.get(b), treeSizes.get(a));
    if (sizeOrder !== 0) {
      return sizeOrder;
    }
    return compare(a.Children[0].Node.ID, b.Children[0].Node.ID);
  });
  // record placement sides to prevent repeats in isolated trees
  const rootSentinelPlacements = new Map();
  for (const placementTree of placementTrees) {
    guard.Step();
    if (!rootSentinelPlacements.has(placementTree.Node)) {
      rootSentinelPlacements.set(placementTree.Node, new Set());
    }
    const placedOrientation = placeTree(
      ctx,
      g,
      placementTree,
      container,
      rootSentinelPlacements.get(placementTree.Node),
      guard,
    );
    rootSentinelPlacements.get(placementTree.Node).add(placedOrientation);
    guard.Finish();
  }
  // disconnect from placement tree
  for (const rootSentinel of g.Nodes) {
    guard.Step();
    for (const root of g.Trees.get(rootSentinel) ?? []) {
      guard.Step();
      root.Parent = null;
      guard.Finish();
    }
  }
  guard.Check();
}

function compare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function placeTreesWithWorkLimit(ctx, g, container, workLimit) {
  Validate(ctx, 'PlaceTrees', g);
  const guard = newWorkGuard(ctx, 'PlaceTrees');
  guard.SetLimit(workLimit);

  const state = newGraphStateSnapshot({
    CaptureTopology: true,
    CaptureEdgeRoutes: true,
  });
  state.updateWithWorkGuard(g, guard);
  if (container != null) {
    if (!tracksNode(state, container)) {
      throw treePreprocessBadState('cannot place trees into an unknown container');
    }
  }
  rollbackOnFailure(g, state, () => {
    placeTrees(ctx, g, container, guard);
    guard.Finish();
  });
}

/** Place reconnects and positions every tree of g inside container (null = root). */
export function Place(ctx, g, container) {
  placeTreesWithWorkLimit(ctx, g, container, MAX_PLACE_TREES_WORK_UNITS);
}

export function buildPlacementTrees(g, guard) {
  const placementTrees = [];
  for (const rootSentinel of g.Nodes) {
    guard.Step();
    const firstPlacementTree = placementTrees.length;
    if (!g.Trees.has(rootSentinel)) {
      // not actually a rootSentinel
      continue;
    }
    const roots = g.Trees.get(rootSentinel) ?? [];

    const isIsolated = isIsolatedTreeGuarded(g, rootSentinel, guard);
    if (isIsolated) {
      // for an isolated tree and we should try to place all the matching roots together
      const byDirection = rootsByTreeDirection(roots, guard);
      const undirected = byDirection.get(Undirected) ?? [];
      byDirection.delete(Undirected);
      for (const matchingRoots of byDirection.values()) {
        const arrowheadSentinels = new Map();

        for (const root of matchingRoots) {
          guard.Step();
          if (root == null || root.SentinelEdge == null) {
            throw treePreprocessBadState('tree placement encountered an incomplete root');
          }
          const arrowhead = arrowheadTo(root.SentinelEdge, rootSentinel);
          if (!arrowheadSentinels.has(arrowhead)) {
            arrowheadSentinels.set(arrowhead, new Tree(rootSentinel));
            placementTrees.push(arrowheadSentinels.get(arrowhead));
          }
          addTreeChild(arrowheadSentinels.get(arrowhead), root, guard);
        }
      }
      if (undirected.length > 0) {
        // merges undirected trees to the largest one that has no arrowhead in the sentinel edge
        let mergeWith = null;
        for (let i = firstPlacementTree; i < placementTrees.length; i++) {
          const tree = placementTrees[i];
          guard.Step();
          if (mergeWith != null && tree.Children.length <= mergeWith.Children.length) {
            continue;
          }
          // all children should have compatible edges, so we just need to check the first one
          if (tree.Children.length > 0 && !tree.Children[0].SentinelEdge.HasArrowTo(rootSentinel)) {
            mergeWith = tree;
          }
        }
        if (mergeWith == null) {
          // if it could not fit with any of the existing trees, we need to create a new for undirected trees
          mergeWith = new Tree(rootSentinel);
          placementTrees.push(mergeWith);
        }
        for (const root of undirected) {
          addTreeChild(mergeWith, root, guard);
        }
      }
    } else {
      for (const root of roots) {
        guard.Step();
        // For placement, create a tree node with the rootSentinel connected to the tree root
        const placementTree = new Tree(rootSentinel);
        addTreeChild(placementTree, root, guard);
        placementTrees.push(placementTree);
      }
    }
  }
  guard.Check();
  return placementTrees;
}
