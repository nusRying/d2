// Slice 46 — guarded BinPack helpers.
// Pinned reference: d2layouts/d2talalayout/internal/packing/guard.go
//
// Go returns errors; this port throws them (WorkGuard Step/Finish throw).
// Every guard call keeps Go's order and count.

import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_NODES, MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { Spacing } from '../graph/graph.js';
import { sortNodesByID } from '../graph/node.js';
import { boundingBox, fixedBoundingBox } from '../graphbounds/index.js';
import { syncClusterGeometryWithWork } from './cluster-geometry-support.js';
import { goID, goMax, goMin, goPow2, invariantError } from './go-support.js';

export const SUBGRAPH_PADDING = 20.0;
export const SUBGRAPH_SQUARE_DAMPENER = 0.5;

/** newWorkGuard (guard.go) */
export function newWorkGuard(ctx, limit) {
  const guard = new WorkGuard(ctx, 'BinPack', MAX_ENGINE_WORK_UNITS);
  guard.SetLimit(limit);
  return guard;
}

/** binPackScoreGuarded */
export function binPackScoreGuarded(nodes, root, guard) {
  const [topLeft, bottomRight] = fixedBoundingBox(nodes, guard);
  const width = bottomRight.X - topLeft.X;
  const height = bottomRight.Y - topLeft.Y;
  let desiredAxisPenalty = 0;
  if (root != null) {
    if (root.DesiredWidth != null && root.DesiredHeight == null && width < root.DesiredWidth) {
      desiredAxisPenalty = root.DesiredWidth - width;
    } else if (root.DesiredWidth == null && root.DesiredHeight != null && height < root.DesiredHeight) {
      desiredAxisPenalty = root.DesiredHeight - height;
    }
  }
  const score = width * height + goPow2(width - height) * SUBGRAPH_SQUARE_DAMPENER +
    goPow2(desiredAxisPenalty) * SUBGRAPH_SQUARE_DAMPENER;
  guard.Finish();
  return score;
}

/** binPackContainerTopLeft */
export function binPackContainerTopLeft(g, container, children, guard) {
  const [topLeft, bottomRight] = fixedBoundingBox(children, guard);
  if (container == null) {
    guard.Finish();
    return topLeft;
  }
  const padding = g.containerPadding(container, false);
  const inside = container.insidePlacement(bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y, padding);
  guard.Finish();
  return inside;
}

/** binPackIsDescendantOf */
export function binPackIsDescendantOf(descendant, ancestor, guard) {
  const seen = new Set();
  for (;;) {
    guard.Step();
    if (descendant === ancestor) {
      return true;
    }
    if (descendant == null) {
      return false;
    }
    if (seen.has(descendant)) {
      throw invariantError('BinPack found a cycle in node ancestry');
    }
    seen.add(descendant);
    if (descendant.Container != null) {
      descendant = descendant.Container;
    } else if (descendant.Cluster != null && descendant.Cluster.Vessel != null) {
      descendant = descendant.Cluster.Vessel;
    } else if (descendant.Sequence != null && descendant.Sequence.Vessel != null) {
      descendant = descendant.Sequence.Vessel;
    } else {
      return ancestor == null;
    }
  }
}

/** binPackHasExternalConnection */
export function binPackHasExternalConnection(g, node, container, near, containerIsExternal, guard) {
  if (container == null) {
    return false;
  }
  const descendants = g.allDescendantNodesGuarded(node, true, guard);
  const toVisit = [node];
  for (const descendant of descendants) {
    guard.Step();
    toVisit.push(descendant);
  }
  for (const current of toVisit) {
    guard.Step();
    if (near) {
      const orderedNears = binPackOrderedNears(current, guard);
      for (const adjacent of orderedNears) {
        if (!binPackIsDescendantOf(adjacent, container, guard)) {
          return true;
        }
      }
      continue;
    }
    for (const edge of current.Edges) {
      guard.Step();
      const adjacent = current.adjacent(edge);
      // Once routes exist, moving a descendant connected to this container
      // translates the complete route and pulls the container endpoint off its
      // fixed border. Treat that attachment like a cross-container constraint.
      if (containerIsExternal && adjacent === container) {
        return true;
      }
      if (!binPackIsDescendantOf(adjacent, container, guard)) {
        return true;
      }
    }
  }
  guard.Finish();
  return false;
}

/**
 * binPackOrderedNears. Go ranges a map then sorts by ID; JS iterates the
 * Nears Set in insertion order before the same ID sort, so results agree
 * whenever near IDs are distinct (ties would be Go-nondeterministic).
 */
export function binPackOrderedNears(node, guard) {
  if (node == null) {
    throw invariantError('BinPack cannot order nears for a nil node');
  }
  const nearSet = node.Nears ?? new Set();
  const nearCount = nearSet instanceof Map || nearSet instanceof Set ? nearSet.size : 0;
  if (nearCount > MAX_ENGINE_NODES) {
    throw invariantError('BinPack node near count exceeds node limit');
  }
  const nears = [];
  for (const near of nearSet instanceof Map ? nearSet.keys() : nearSet) {
    guard.Step();
    if (near == null) {
      throw invariantError('BinPack found a nil near');
    }
    nears.push(near);
  }
  // Account for the comparison sort before entering the small, bounded legacy
  // sorter, so every recursive BinPack helper consumes the same stage budget.
  for (let width = nears.length; width > 1; width = Math.trunc((width + 1) / 2)) {
    for (let i = 0; i < nears.length; i++) {
      guard.Step();
    }
  }
  sortNodesByID(nears);
  guard.Finish();
  return nears;
}

/** binPackHierarchyBoxes */
export function binPackHierarchyBoxes(packed, guard) {
  const boxes = [];
  for (const nodes of packed) {
    guard.Step();
    if (nodes == null || nodes.length === 0) {
      throw invariantError('BinPack contains an empty packed subgraph');
    }
    if (nodes[0].Hierarchy == null) {
      continue;
    }
    const [topLeft, bottomRight] = boundingBox(nodes, guard);
    boxes.push({ topLeft, bottomRight });
  }
  guard.Finish();
  return boxes;
}

/** binPackPointInHierarchy */
export function binPackPointInHierarchy(boxes, point, guard) {
  if (point == null) {
    throw invariantError('BinPack hierarchy check received a nil point');
  }
  for (const box of boxes) {
    guard.Step();
    if (box.topLeft.X <= point.X && point.X <= box.bottomRight.X &&
      box.topLeft.Y <= point.Y && point.Y <= box.bottomRight.Y) {
      return true;
    }
  }
  guard.Finish();
  return false;
}

function expandForChildLabels(children, topLeft, bottomRight, guard, checkPlaced) {
  for (const child of children) {
    guard.Step();
    if (checkPlaced && (child == null || child.TopLeft == null)) {
      throw invariantError('BinPack container contains an unplaced child');
    }
    if (child.Label != null && (child.TopLeft.X === topLeft.X || child.TopLeft.X + child.Width === bottomRight.X) &&
      child.Label.Width > child.Width) {
      topLeft.X = goMin(topLeft.X, Math.floor(child.TopLeft.X + (child.Width / 2 - child.Label.Width / 2)));
      bottomRight.X = goMax(bottomRight.X, Math.ceil(child.TopLeft.X + child.Width - (child.Width / 2 - child.Label.Width / 2)));
    }
  }
}

/** binPackWrapChildren */
export function binPackWrapChildren(root, guard) {
  if (!root.isContainer) {
    return;
  }
  const children = root.Graph.Containers.get(root) ?? [];
  const padding = root.Graph.containerPadding(root, false);
  const [topLeft, bottomRight] = fixedBoundingBox(children, guard);
  expandForChildLabels(children, topLeft, bottomRight, guard, false);
  root.fitToBoundingBox(topLeft, bottomRight, padding);
  const inside = root.insidePlacement(bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y, padding);
  root.translate(topLeft.X - inside.X, topLeft.Y - inside.Y);
  guard.Finish();
}

/** binPackMoveNodeWithChildren */
export function binPackMoveNodeWithChildren(node, dx, dy, guard) {
  guard.Step();
  if (dx === 0 && dy === 0) {
    return;
  }
  if (node == null || node.TopLeft == null || node.Graph == null) {
    throw invariantError('BinPack cannot move an unplaced node or a node without a graph');
  }
  node.translate(dx, dy);
  const descendants = node.Graph.allDescendantNodesGuarded(node, true, guard);
  for (const child of descendants) {
    guard.Step();
    if (child == null || child.TopLeft == null) {
      throw invariantError('BinPack cannot move an unplaced descendant');
    }
    child.translate(dx, dy);
  }
  guard.Finish();
}

/** binPackPositionContainerChildren */
export function binPackPositionContainerChildren(node, guard) {
  guard.Step();
  if (node == null || !node.isContainer) {
    return;
  }
  if (node.Graph == null) {
    throw invariantError('BinPack container has no graph');
  }
  const children = node.Graph.Containers.get(node) ?? [];
  const [topLeft, bottomRight] = fixedBoundingBox(children, guard);
  expandForChildLabels(children, topLeft, bottomRight, guard, true);
  const inside = node.insidePlacement(bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y, new Spacing());
  const dx = inside.X - topLeft.X;
  const dy = inside.Y - topLeft.Y;
  for (const child of children) {
    binPackMoveNodeWithChildren(child, dx, dy, guard);
  }
  guard.Finish();
}

/** binPackClusterGeometryWork (layoutgraph.ClusterGeometryWork) */
export class BinPackClusterGeometryWork {
  constructor(guard) {
    this.guard = guard;
  }

  Step() {
    return this.guard.Step();
  }

  Finish() {
    return this.guard.Finish();
  }

  MoveNodeWithChildren(node, dx, dy) {
    binPackMoveNodeWithChildren(node, dx, dy, this.guard);
  }

  PositionContainerChildren(node) {
    binPackPositionContainerChildren(node, this.guard);
  }
}

/** binPackReverseDFSWalk — explicit stack, never recursion. */
export function binPackReverseDFSWalk(root, apply, guard) {
  if (root == null) {
    throw invariantError('BinPack reverse traversal contains a nil node');
  }
  const stack = [{ node: root, phase: 0, index: 0 }];
  const active = new Set([root]);
  while (stack.length > 0) {
    guard.Step();
    const frame = stack[stack.length - 1];
    const graph = frame.node.Graph;
    if (graph == null) {
      throw invariantError('BinPack reverse traversal found a node without a graph');
    }
    let children = null;
    if (frame.phase === 0) {
      if (frame.node.isContainer) {
        children = graph.Containers?.get(frame.node) ?? null;
      }
    } else if (frame.phase === 1) {
      if (frame.node.isClusterVessel) {
        const cluster = graph.Clusters?.get(frame.node) ?? null;
        if (cluster == null) {
          throw invariantError('BinPack reverse traversal found a cluster vessel without a cluster');
        }
        children = cluster.Nodes;
      } else {
        const sequence = graph.Sequences?.get(frame.node) ?? null;
        if (sequence != null) {
          children = sequence.Nodes;
        }
      }
    } else {
      apply(frame.node);
      active.delete(frame.node);
      stack.pop();
      continue;
    }
    const length = children == null ? 0 : children.length;
    if (frame.index >= length) {
      frame.phase++;
      frame.index = 0;
      continue;
    }
    const child = children[frame.index];
    frame.index++;
    if (child == null) {
      throw invariantError('BinPack reverse traversal contains a nil child');
    }
    if (active.has(child)) {
      throw invariantError('BinPack reverse traversal found a topology cycle');
    }
    active.add(child);
    stack.push({ node: child, phase: 0, index: 0 });
  }
  guard.Finish();
}

/** binPackSyncClusters */
export function binPackSyncClusters(graph, guard) {
  if (graph == null) {
    throw invariantError('BinPack cannot synchronize a nil graph');
  }
  if (graph.Clusters == null || graph.Clusters.size === 0) {
    guard.Finish();
    return;
  }
  const work = new BinPackClusterGeometryWork(guard);
  for (const root of graph.Nodes) {
    guard.Step();
    binPackReverseDFSWalk(root, (node) => {
      if (!node.isClusterVessel) {
        return;
      }
      syncClusterGeometryWithWork(graph.Clusters.get(node) ?? null, work);
    }, guard);
  }
  guard.Finish();
}

/** binPackSyncSequences */
export function binPackSyncSequences(graph, guard) {
  if (graph == null) {
    throw invariantError('BinPack cannot synchronize a nil graph');
  }
  if (graph.Sequences == null || graph.Sequences.size === 0) {
    guard.Finish();
    return;
  }
  for (const root of graph.Nodes) {
    guard.Step();
    binPackReverseDFSWalk(root, (node) => {
      const sequence = graph.Sequences.get(node) ?? null;
      if (sequence == null) {
        return;
      }
      sequence.syncGeometryWithWork(guard);
    }, guard);
  }
  guard.Finish();
}

/** binPackSmallestDeltas */
export function binPackSmallestDeltas(subgraphs, guard) {
  let x = Infinity;
  let y = Infinity;
  for (const subgraph of subgraphs) {
    guard.Step();
    const [topLeft, bottomRight] = boundingBox(subgraph, guard);
    x = goMin(x, bottomRight.X - topLeft.X);
    y = goMin(y, bottomRight.Y - topLeft.Y);
  }
  guard.Finish();
  return [x, y];
}

function addCount(map, key) {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  return next;
}

/**
 * allEdgesHaveCompleteRoutesGuarded enforces the all-or-none route state that
 * BinPack relies on, and that the graph-owned edge list agrees exactly with
 * every affected node-owned edge list. Returns [edgesPlaced, incidentEdges].
 */
export function allEdgesHaveCompleteRoutesGuarded(graph, root, guard) {
  if (graph == null) {
    throw invariantError('BinPack received a nil graph');
  }
  let descendants;
  if (root == null) {
    descendants = graph.Nodes;
  } else {
    descendants = graph.allDescendantNodesGuarded(root, true, guard);
  }
  const affectedNodes = [];
  if (root != null) {
    affectedNodes.push(root);
  }
  for (const node of descendants) affectedNodes.push(node);
  const affectedNodeSet = new Set();
  for (const node of affectedNodes) {
    guard.Step();
    if (node == null || node.Graph !== graph) {
      throw invariantError('BinPack affected-node inventory is malformed');
    }
    if (affectedNodeSet.has(node)) {
      throw invariantError(`BinPack affected-node inventory repeats node ${goID(node.ID)}`);
    }
    affectedNodeSet.add(node);
  }

  const expectedNodeEdges = new Map();
  const expectedNodeEdgeTotals = new Map();
  for (const node of affectedNodes) {
    expectedNodeEdges.set(node, new Map());
  }
  const affectedGraphEdges = new Set();
  let routedEdges = 0;
  const incidentEdges = [];
  for (let edgeIndex = 0; edgeIndex < graph.Edges.length; edgeIndex++) {
    const edge = graph.Edges[edgeIndex];
    guard.Step();
    if (edge == null) {
      throw invariantError(`BinPack found a nil edge at index ${edgeIndex}`);
    }
    if (edge.From == null || edge.To == null) {
      throw invariantError(`BinPack edge ${goID(edge.ID)} has a nil endpoint`);
    }
    if (edge.From.Graph !== graph || edge.To.Graph !== graph) {
      throw invariantError(`BinPack edge ${goID(edge.ID)} has an endpoint owned by another graph`);
    }
    let edgeAffectsRoot = false;
    if (affectedNodeSet.has(edge.From)) {
      edgeAffectsRoot = true;
      addCount(expectedNodeEdges.get(edge.From), edge);
      expectedNodeEdgeTotals.set(edge.From, (expectedNodeEdgeTotals.get(edge.From) ?? 0) + 1);
    }
    if (edge.To !== edge.From) {
      if (affectedNodeSet.has(edge.To)) {
        edgeAffectsRoot = true;
        addCount(expectedNodeEdges.get(edge.To), edge);
        expectedNodeEdgeTotals.set(edge.To, (expectedNodeEdgeTotals.get(edge.To) ?? 0) + 1);
      }
    }
    if (edgeAffectsRoot) {
      if (affectedGraphEdges.has(edge)) {
        throw invariantError(`BinPack graph edge inventory repeats affected edge ${goID(edge.ID)}`);
      }
      affectedGraphEdges.add(edge);
    }
    const points = edge.Points ?? [];
    if (points.length === 0) {
      continue;
    }
    if (points.length < 2) {
      throw invariantError(`BinPack edge ${goID(edge.ID)} has an incomplete route with ${points.length} point(s)`);
    }
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      guard.Step();
      if (points[pointIndex] == null) {
        throw invariantError(`BinPack edge ${goID(edge.ID)} has a nil route point at index ${pointIndex}`);
      }
    }
    routedEdges++;
    if (root != null && (edge.From === root || edge.To === root)) {
      incidentEdges.push(edge);
    }
  }
  if (routedEdges !== 0 && routedEdges !== graph.Edges.length) {
    throw invariantError(`BinPack graph is partially routed: ${routedEdges} of ${graph.Edges.length} edges have routes`);
  }

  for (const node of affectedNodes) {
    const actualNodeEdges = new Map();
    const nodeEdges = node.Edges ?? [];
    for (let edgeIndex = 0; edgeIndex < nodeEdges.length; edgeIndex++) {
      const edge = nodeEdges[edgeIndex];
      guard.Step();
      if (edge == null) {
        throw invariantError(`BinPack node ${goID(node.ID)} edge inventory contains a nil edge at index ${edgeIndex}`);
      }
      if (edge.From !== node && edge.To !== node) {
        throw invariantError(`BinPack node ${goID(node.ID)} edge inventory contains non-incident edge ${goID(edge.ID)}`);
      }
      const actual = addCount(actualNodeEdges, edge);
      const expectedOccurrences = expectedNodeEdges.get(node).get(edge) ?? 0;
      if (actual > expectedOccurrences) {
        throw invariantError(
          `BinPack node ${goID(node.ID)} edge inventory has ${actual} occurrence(s) of edge ${goID(edge.ID)}; graph requires ${expectedOccurrences}`,
        );
      }
    }
    const expectedTotal = expectedNodeEdgeTotals.get(node) ?? 0;
    if (nodeEdges.length !== expectedTotal) {
      throw invariantError(
        `BinPack node ${goID(node.ID)} edge inventory has ${nodeEdges.length} occurrence(s); graph requires ${expectedTotal}`,
      );
    }
  }
  if (routedEdges === 0) {
    guard.Finish();
    return [false, null];
  }
  guard.Finish();
  return [true, incidentEdges];
}
