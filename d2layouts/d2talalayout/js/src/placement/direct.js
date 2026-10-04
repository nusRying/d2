/**
 * Direct — mirror a placed subgraph toward its dominant edge direction.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/direct.go
 *   directionCounts, edgeDirectionCounts, compareDirectionCounts,
 *   transformsTo, containerEdgeDirections, hasFixedDescendant, mirrorAxes,
 *   directOptions, direct
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { precisionCompare, PRECISION } from '../geometry/math.js';
import { Orientation, getOpposite, isHorizontal, isVertical } from '../geometry/orientation.js';
import { isCandidateRejection } from '../graph/transaction.js';
import { mirrorNode } from '../graph/structural-access.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { WorkGuard } from '../limits/work-guard.js';
import { getContextError } from '../limits/work-context.js';
import { edgeLength } from '../placementcost/graph.js';
import { restoreNodePositions, snapshotNodePositionsContext } from './types.js';

/** Go placement.directionCounts (value type). */
export class DirectionCounts {
  constructor(left = 0, right = 0, top = 0, bottom = 0) {
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
  }

  add(other) {
    this.left += other.left;
    this.right += other.right;
    this.top += other.top;
    this.bottom += other.bottom;
  }

  /**
   * transformsTo picks the mirror transforms that point the dominant edge
   * directions toward direction. Pinned Go: directionCounts.transformsTo
   * @returns {{mirrorX: boolean, mirrorY: boolean}}
   */
  transformsTo(direction) {
    const values = [
      { direction: Orientation.Right, count: this.right },
      { direction: Orientation.Bottom, count: this.bottom },
      { direction: Orientation.Left, count: this.left },
      { direction: Orientation.Top, count: this.top },
    ];
    // Go slices.SortStableFunc; Array.prototype.sort is stable.
    values.sort((a, b) => compareDirectionCounts(a, b, direction));
    const primary = values[0];
    let secondary = values[1];
    if (secondary.direction === getOpposite(primary.direction)) {
      secondary = values[2];
    }
    if (direction === Orientation.NONE) {
      direction = isHorizontal(primary.direction) ? Orientation.Right : Orientation.Bottom;
    }
    let xDirection = Orientation.Right;
    let yDirection = Orientation.Bottom;
    if (isHorizontal(direction)) {
      xDirection = direction;
    } else {
      yDirection = direction;
    }
    const transforms = { mirrorX: false, mirrorY: false };
    if (isHorizontal(primary.direction)) {
      transforms.mirrorX = primary.direction !== xDirection;
    } else {
      transforms.mirrorY = primary.direction !== yDirection;
    }
    if (secondary.count > values[3].count) {
      if (isHorizontal(secondary.direction)) {
        transforms.mirrorX = secondary.direction !== xDirection;
      } else {
        transforms.mirrorY = secondary.direction !== yDirection;
      }
    }
    return transforms;
  }
}

/** Pinned Go: placement.edgeDirectionCounts */
export function edgeDirectionCounts(edge) {
  const counts = new DirectionCounts();
  const [from, to, directed] = edge.directedEndpoints();
  if (!directed) {
    return counts;
  }
  switch (getOpposite(from.orientation(to))) {
    case Orientation.Left:
      counts.left++;
      break;
    case Orientation.TopLeft:
      counts.top++;
      counts.left++;
      break;
    case Orientation.BottomLeft:
      counts.bottom++;
      counts.left++;
      break;
    case Orientation.Right:
      counts.right++;
      break;
    case Orientation.TopRight:
      counts.top++;
      counts.right++;
      break;
    case Orientation.BottomRight:
      counts.bottom++;
      counts.right++;
      break;
    case Orientation.Top:
      counts.top++;
      break;
    case Orientation.Bottom:
      counts.bottom++;
      break;
    default:
      break;
  }
  return counts;
}

/** Pinned Go: placement.compareDirectionCounts */
export function compareDirectionCounts(a, b, preferred) {
  if (b.count !== a.count) {
    return b.count < a.count ? -1 : 1;
  }
  const aPreferred = a.direction === preferred;
  const bPreferred = b.direction === preferred;
  if (aPreferred && !bPreferred) return -1;
  if (!aPreferred && bPreferred) return 1;
  return 0;
}

/** Pinned Go: placement.containerEdgeDirections */
export function containerEdgeDirections(graph, container) {
  const counted = new Set();
  const counts = new DirectionCounts();
  for (const node of graph.Containers.get(container) ?? []) {
    if (node.Graph !== graph) {
      continue;
    }
    for (const edge of node.Edges) {
      if (counted.has(edge)) {
        continue;
      }
      counted.add(edge);
      counts.add(edgeDirectionCounts(edge));
    }
  }
  return counts;
}

/** Pinned Go: placement.hasFixedDescendant */
export function hasFixedDescendant(node) {
  if (node.FixedTopLeft != null) {
    return true;
  }
  if (node.IsContainer()) {
    for (const child of node.Graph.Containers.get(node) ?? []) {
      if (hasFixedDescendant(child)) {
        return true;
      }
    }
  }
  if (node.IsClusterVessel()) {
    for (const child of node.Graph.Clusters.get(node).Nodes) {
      if (hasFixedDescendant(child)) {
        return true;
      }
    }
  } else {
    const sequence = node.Graph.Sequences.get(node);
    if (sequence != null) {
      for (const child of sequence.Nodes) {
        if (hasFixedDescendant(child)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * mirrorAxes mirrors every node whose effective container is reachable,
 * flipping affected tree orientations. Atomic: any failure (or throw) after
 * the snapshot restores node positions and tree orientations.
 *
 * Pinned Go: placement.mirrorAxes
 */
export function mirrorAxes(ctx, graph, mirrorX, mirrorY) {
  const guard = new WorkGuard(ctx, 'MirrorAxesReachability', MAX_ENGINE_WORK_UNITS);
  const reachableContainers = new Set();
  const visited = new Set();
  for (const node of graph.Nodes) {
    if (visited.has(node)) {
      continue;
    }
    const reachable = node.allReachableNodesContext(true, true, false, null, guard);
    for (const current of reachable) {
      visited.add(current);
      reachableContainers.add(current.Container ?? null);
    }
  }
  guard.Finish();

  const originalPositions = snapshotNodePositionsContext(ctx, 'MirrorAxes', graph.Nodes);
  const originalTreeOrientations = new Map();
  for (const snapshot of originalPositions) {
    const tree = graph.NodeToTree.get(snapshot.node);
    if (tree != null) {
      originalTreeOrientations.set(tree, tree.Orientation);
    }
  }
  let complete = false;
  try {
    const mirrored = new Set();
    // Go records the first failure in mutationErr and short-circuits every
    // later callback; throwing out of the walk is observably identical.
    const mirrorOne = (node) => {
      guard.Step();
      if (mirrored.has(node)) {
        return;
      }
      if (reachableContainers.has(node.effectiveContainer())) {
        mirrorNode(node, mirrorX, mirrorY);
        mirrored.add(node);
        guard.Finish();
        const tree = graph.NodeToTree.get(node);
        if (tree != null &&
          ((mirrorX && isHorizontal(tree.Orientation)) || (mirrorY && isVertical(tree.Orientation)))) {
          tree.Orientation = getOpposite(tree.Orientation);
          guard.Finish();
        }
      }
      node.positionContainerChildren(true);
      guard.Finish();
    };
    for (const node of graph.Nodes) {
      if (!mirrored.has(node)) {
        node.WalkRDFS(mirrorOne);
      }
    }
    guard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      restoreNodePositions(originalPositions);
      for (const [tree, orientation] of originalTreeOrientations) {
        tree.Orientation = orientation;
      }
    }
  }
}

/**
 * direct mirrors a placed subgraph toward its dominant edge direction when
 * doing so preserves or improves the placement cost.
 *
 * Pinned Go: placement.direct
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} graph
 * @param {Array} nodes
 * @param {import('../graph/node.js').Node|null} container
 * @param {{checkEdgeLength?: boolean}} options Go directOptions
 * Errors throw.
 */
export function direct(ctx, graph, nodes, container, options) {
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw ctxErr;
  }
  if (nodes == null || nodes.length === 0 || nodes[0].Hierarchy != null) {
    return;
  }
  for (const node of nodes) {
    if (hasFixedDescendant(node)) {
      return;
    }
    const sequence = graph.Sequences.get(node);
    if (sequence != null && sequence.EdgeAbductions != null && sequence.EdgeAbductions.length > 0) {
      return;
    }
    if (node.Sequence != null && node.Sequence.EdgeAbductions != null && node.Sequence.EdgeAbductions.length > 0) {
      return;
    }
  }
  const transforms = containerEdgeDirections(graph, container).transformsTo(graph.Direction(container));
  if (!transforms.mirrorX && !transforms.mirrorY) {
    return;
  }
  // options is a plain object {checkEdgeLength?: boolean} (Go directOptions;
  // the zero value is checkEdgeLength=false).
  if (!(options?.checkEdgeLength === true)) {
    mirrorAxes(ctx, graph, transforms.mirrorX, transforms.mirrorY);
    return;
  }
  const scoring = { EdgeAbductions: null, IncludeNodeSizes: true, EnforceMinimumGap: false, PenalizeDirection: true };
  const currentLength = edgeLength(ctx, graph, scoring);
  const [transaction, txnErr] = graph.NewRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }
  transaction.AddOp(() => {
    // Go returns mirrorAxes' error from the op.
    try {
      mirrorAxes(ctx, graph, transforms.mirrorX, transforms.mirrorY);
    } catch (err) {
      return err;
    }
    return null;
  });
  const commitErr = transaction.Commit(ctx);
  if (commitErr != null) {
    if (isCandidateRejection(commitErr)) {
      return;
    }
    throw commitErr;
  }
  let newLength;
  try {
    newLength = edgeLength(ctx, graph, scoring);
  } catch (err) {
    transaction.Rollback();
    throw err;
  }
  if (precisionCompare(newLength, currentLength, PRECISION) > 0) {
    transaction.Rollback();
  }
}
