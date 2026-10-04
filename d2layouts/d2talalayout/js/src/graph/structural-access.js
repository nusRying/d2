// Slice 46 — layoutgraph access helpers used by hierarchy, trees, packing,
// loops, and structural placement.
//
// Pinned references (d2layouts/d2talalayout/internal/layoutgraph):
//   hierarchy_access.go, tree_access.go, placement_access.go,
//   packing_access.go, subgraph_access.go, node_graph_ownership.go,
//   layout.go (abductEdges, applyEdgeAbductions, restoreEdgeAbductions,
//   ComputeNodeSpacing), graph.go (splitSubgraphsWithOwnership,
//   CopyEntitiesFrom), node.go (HasLeakyEdge, mirror, orthogonalDistanceTo,
//   spillsOutOf, CanContain, centerWithWorkGuard, boundsWithWorkGuard),
//   edge.go (arrowheadTo, segmentCount, isAxisAligned), tree.go
//   (buildIsTreeEdgeMap, addIsolatedTreeEdgesToMap), segment_crossing.go,
//   hierarchy.go (HierarchyLevel).
//
// These are free functions instead of new class members so the approved
// Slice 1–45 Graph/Node/Edge classes stay unchanged.

import { Point } from '../geometry/point.js';
import { precisionCompare, PRECISION } from '../geometry/math.js';
import { Orientation, orientationToString } from '../geometry/orientation.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_NODES, MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { EdgeAbduction } from './edge-abduction.js';
import { Spacing, newGraph } from './graph.js';
import { LABEL_PADDING, LabelPosition, isOutsideLabelPosition, normalizeLabelPosition } from './label-position.js';
import { sortNodesByID } from './node.js';
import { validateEngineGraph } from './topology-preflight.js';
import { collectRuntimeObjectsContext } from './graph-state.js';

// geo.AxisAlignmentTolerance in layoutgraph (edge.go).
export const AXIS_ALIGNMENT_TOLERANCE = 1;

function invariantError(message) {
  return new Error(`layout invariant violated: ${message}`);
}

// ---------------------------------------------------------------------------
// Edge abductions (layout.go)
// ---------------------------------------------------------------------------

/** applyEdgeAbductions reconnects every abduction to its Current endpoints. */
export function applyEdgeAbductions(graph, edgeAbductions) {
  for (const ea of edgeAbductions ?? []) {
    if (ea.OriginallyFrom != null && ea.CurrentFrom != null && ea.OriginallyFrom !== ea.CurrentFrom) {
      ea.Edge.reconnect(ea.CurrentFrom, false);
    }
    if (ea.OriginallyTo != null && ea.CurrentTo != null && ea.OriginallyTo !== ea.CurrentTo) {
      ea.Edge.reconnect(ea.CurrentTo, true);
    }
  }
}

/**
 * restoreEdgeAbductions reconnects abductions whose original endpoints are
 * still reachable from graph and returns the remaining ones (Go nil → null).
 */
export function restoreEdgeAbductions(graph, edgeAbductions) {
  const nodes = new Set();
  const queue = [...graph.Nodes];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    nodes.add(node);
    if (node.isContainer) {
      const children = graph.Containers.get(node);
      if (children) queue.push(...children);
    }
    const s = graph.Sequences.get(node);
    if (s !== undefined) {
      queue.push(...(s.Nodes ?? []));
    }
    if (node.isClusterVessel) {
      queue.push(...(graph.Clusters.get(node).Nodes ?? []));
    }
  }
  let remaining = null;
  for (const ea of edgeAbductions ?? []) {
    let existsFrom = nodes.has(ea.OriginallyFrom);
    if (ea.OriginallyFrom == null) existsFrom = nodes.has(ea.CurrentFrom);
    let existsTo = nodes.has(ea.OriginallyTo);
    if (ea.OriginallyTo == null) existsTo = nodes.has(ea.CurrentTo);
    if (!existsFrom || !existsTo) {
      if (remaining == null) remaining = [];
      remaining.push(ea);
      continue;
    }
    if (ea.OriginallyFrom != null) {
      if (ea.OriginallyFrom.Cluster != null) ea.OriginallyFrom = ea.OriginallyFrom.Cluster.Vessel;
      if (ea.OriginallyFrom.Sequence != null) ea.OriginallyFrom = ea.OriginallyFrom.Sequence.Vessel;
      if (ea.CurrentFrom !== ea.OriginallyFrom) ea.Edge.reconnect(ea.OriginallyFrom, false);
    }
    if (ea.OriginallyTo != null) {
      if (ea.OriginallyTo.Cluster != null) ea.OriginallyTo = ea.OriginallyTo.Cluster.Vessel;
      if (ea.OriginallyTo.Sequence != null) ea.OriginallyTo = ea.OriginallyTo.Sequence.Vessel;
      if (ea.CurrentTo !== ea.OriginallyTo) ea.Edge.reconnect(ea.OriginallyTo, true);
    }
  }
  return remaining;
}

/**
 * abductEdges reassigns edges incident to descendants of container's children
 * onto those children and adds the child-level edges to toGraph.
 *
 * Pinned Go iterates fromGraph.Clusters and fromGraph.Sequences maps to seed
 * the candidate abductions; JS uses Map insertion order. The candidate order
 * only matters when several unused abductions match the same container
 * abduction, which Go itself resolves nondeterministically.
 */
export function abductEdges(fromGraph, container, toGraph) {
  const edgeAbductions = [];
  for (const cluster of fromGraph.Clusters.values()) {
    edgeAbductions.push(...(cluster.EdgeAbductions ?? []));
  }
  for (const sequence of fromGraph.Sequences.values()) {
    edgeAbductions.push(...(sequence.EdgeAbductions ?? []));
  }
  const used = new Array(edgeAbductions.length).fill(false);
  const containerAbductions = [];
  const children = fromGraph.Containers.get(container) ?? [];

  // Go ranges over the slice header captured at loop start.
  for (const edge of [...fromGraph.Edges]) {
    let fromAChild = false;
    let toAChild = false;
    let fromAChildDescendant = false;
    let toAChildDescendant = false;
    let fromChildAncestor = null;
    let toChildAncestor = null;

    for (const child of children) {
      if (child === edge.From) {
        fromAChild = true;
      } else if (edge.From.isDescendantOf(child)) {
        fromAChildDescendant = true;
        fromChildAncestor = child;
      }
      if (child === edge.To) {
        toAChild = true;
      } else if (edge.To.isDescendantOf(child)) {
        toAChildDescendant = true;
        toChildAncestor = child;
      }
    }

    if ((fromAChild && edge.From === toChildAncestor) || (toAChild && edge.To === fromChildAncestor)) {
      containerAbductions.push(new EdgeAbduction({
        Edge: edge,
        OriginallyTo: edge.To,
        OriginallyFrom: edge.From,
      }));
      edge.From.removeEdge(edge);
      edge.To.removeEdge(edge);
    } else if (fromAChild && toAChild) {
      toGraph.AddEdge(edge);
      for (let i = 0; i < edgeAbductions.length; i++) {
        if (used[i]) continue;
        const ea = edgeAbductions[i];
        if (ea.CurrentFrom === edge.From && ea.CurrentTo === edge.To) {
          const ca = new EdgeAbduction({ Edge: edge, CurrentFrom: edge.From, CurrentTo: edge.To });
          if (ea.OriginallyFrom != null) {
            ca.OriginallyFrom = ea.OriginallyFrom;
          } else {
            ca.OriginallyTo = ea.OriginallyTo;
          }
          used[i] = true;
          containerAbductions.push(ca);
          break;
        }
      }
    } else if (fromAChildDescendant && toAChild) {
      containerAbductions.push(new EdgeAbduction({
        Edge: edge,
        OriginallyFrom: edge.From,
        CurrentFrom: fromChildAncestor,
        CurrentTo: edge.To,
      }));
      edge.reconnect(fromChildAncestor, false);
      toGraph.AddEdge(edge);
    } else if (toAChildDescendant && fromAChild) {
      containerAbductions.push(new EdgeAbduction({
        Edge: edge,
        OriginallyTo: edge.To,
        CurrentTo: toChildAncestor,
        CurrentFrom: edge.From,
      }));
      edge.reconnect(toChildAncestor, true);
      toGraph.AddEdge(edge);
    } else if (fromAChildDescendant && toAChildDescendant && fromChildAncestor !== toChildAncestor) {
      containerAbductions.push(new EdgeAbduction({
        Edge: edge,
        OriginallyTo: edge.To,
        OriginallyFrom: edge.From,
        CurrentTo: toChildAncestor,
        CurrentFrom: fromChildAncestor,
      }));
      edge.reconnect(fromChildAncestor, false);
      edge.reconnect(toChildAncestor, true);
      toGraph.AddEdge(edge);
    }
  }

  for (const ca of containerAbductions) {
    for (let i = 0; i < edgeAbductions.length; i++) {
      if (used[i]) continue;
      const ea = edgeAbductions[i];
      let match = false;
      if (ca.OriginallyFrom == null) {
        if (ca.CurrentFrom === ea.CurrentFrom && ca.OriginallyTo === ea.CurrentTo) match = true;
      } else if (ca.OriginallyTo == null) {
        if (ca.CurrentTo === ea.CurrentTo && ca.OriginallyFrom === ea.CurrentFrom) match = true;
      } else if (ca.OriginallyTo === ea.CurrentTo && ca.OriginallyFrom === ea.CurrentFrom) {
        match = true;
      }
      if (match) {
        used[i] = true;
        if (ea.OriginallyFrom != null) {
          ca.OriginallyFrom = ea.OriginallyFrom;
        } else {
          ca.OriginallyTo = ea.OriginallyTo;
        }
        break;
      }
    }
  }
  return containerAbductions;
}

// ---------------------------------------------------------------------------
// hierarchy_access.go
// ---------------------------------------------------------------------------

/** GraphState.OwnedNodes: graph.Nodes plus every snapshot node owned by graph. */
export function ownedNodes(state, graph, guard) {
  const owned = new Set();
  for (const node of graph.Nodes) {
    guard.Step();
    owned.add(node);
  }
  for (const node of state.nodes.keys()) {
    guard.Step();
    if (node.Graph === graph) owned.add(node);
  }
  return owned;
}

/** Graph.ReplaceEdgesUnchecked. */
export function replaceEdgesUnchecked(graph, edges) {
  for (const edge of graph.Edges) {
    edge.From.Edges = [];
    edge.To.Edges = [];
  }
  graph.Edges = edges;
  for (const edge of edges) {
    edge.From.addEdge(edge);
    edge.To.addEdge(edge);
  }
}

export function uniformSpacing(value) {
  return new Spacing(value, value, value, value);
}

/** Nodes.setGraphReference. */
export function setGraphReference(nodes, graph) {
  for (const n of nodes) {
    n.Graph = graph;
    for (const child of graph.allDescendantNodes(n, true)) {
      child.Graph = graph;
    }
  }
}

/** Nodes.boundsWithWorkGuard; returns [tl, br] or [null, null]. */
export function nodesBoundsWithWorkGuard(nodes, guard) {
  if (guard == null) {
    throw new Error('TALA BoundingBox requires a work guard');
  }
  return boundsWithWorkGuard(nodes, guard);
}

function boundsWithWorkGuard(nodes, guard) {
  if (nodes.length === 0) {
    guard.Finish();
    return [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    guard.Step();
    if (node.TopLeft == null) {
      return [null, null];
    }
    if (node.Label != null && isOutsideLabelPosition(node.Label.Position)) {
      guard.Add(2 * nodes.length);
    }
    const [tl, br] = node.boundingBoxValues(nodes, true);
    minX = Math.min(minX, tl.X);
    minY = Math.min(minY, tl.Y);
    maxX = Math.max(maxX, br.X);
    maxY = Math.max(maxY, br.Y);
  }
  guard.Finish();
  return [new Point(minX, minY), new Point(maxX, maxY)];
}

/** Nodes.CenterWithWorkGuard. A nil-TopLeft node yields a Go nil-pointer panic. */
export function nodesCenterWithWorkGuard(nodes, guard) {
  if (guard == null) {
    throw new Error('TALA Center requires a work guard');
  }
  const [tl, br] = boundsWithWorkGuard(nodes, guard);
  if (tl == null) {
    throw new TypeError('runtime error: invalid memory address or nil pointer dereference');
  }
  return new Point(tl.X + (br.X - tl.X) / 2, tl.Y + (br.Y - tl.Y) / 2);
}

/** Node.mirror (accounts for loop offsets). */
export function mirrorNode(node, x, y) {
  let topOffset = 0;
  let bottomOffset = 0;
  let leftOffset = 0;
  let rightOffset = 0;
  const offsets = node.LoopOffsets;
  if (offsets != null && loopOffsetsLength(offsets) > 0) {
    topOffset = loopOffset(offsets, Orientation.Top);
    leftOffset = loopOffset(offsets, Orientation.Left);
    rightOffset = loopOffset(offsets, Orientation.Right);
    bottomOffset = loopOffset(offsets, Orientation.Bottom);
  }
  if (x) {
    node.TopLeft.X = -node.TopLeft.X - node.Width + leftOffset - rightOffset;
  }
  if (y) {
    node.TopLeft.Y = -node.TopLeft.Y - node.Height + topOffset - bottomOffset;
  }
}

function loopOffsetsLength(offsets) {
  return offsets instanceof Map ? offsets.size : Object.keys(offsets).length;
}

// Same key resolution as node.js getLoopOffset (orientation, then its name).
function loopOffset(offsets, side) {
  const name = orientationToString(side);
  if (offsets instanceof Map) {
    if (offsets.has(side)) return offsets.get(side);
    if (name && offsets.has(name)) return offsets.get(name);
    return 0;
  }
  if (offsets[side] !== undefined) return offsets[side];
  if (name && offsets[name] !== undefined) return offsets[name];
  if (name && offsets[name.toLowerCase()] !== undefined) return offsets[name.toLowerCase()];
  return 0;
}

/** Edge.HierarchyRankWeight: 1 unless explicitly set. */
export function hierarchyRankWeight(edge) {
  if (edge == null || !edge.hierarchyRankWeightSet) return 1;
  return edge.hierarchyRankWeight;
}

export function setHierarchyRankWeight(edge, weight) {
  edge.hierarchyRankWeight = weight;
  edge.hierarchyRankWeightSet = true;
}

/** Node.HierarchyLevel: Go map lookup returns 0 for a missing node. */
export function hierarchyLevel(node) {
  const levels = node.Hierarchy.levels;
  if (levels == null) return 0;
  return levels.get(node) ?? 0;
}

// ---------------------------------------------------------------------------
// tree_access.go / tree.go
// ---------------------------------------------------------------------------

export function arrowheadTo(edge, node) {
  return node === edge.From ? edge.SourceArrowhead : edge.TargetArrowhead;
}

export function tracksNode(state, node) {
  return state.nodes.has(node);
}

export function addIncidentEdgeUnchecked(node, edge) {
  node.addEdge(edge);
}

function recordInternalTreeEdges(tree, isTreeEdge) {
  const stack = [tree];
  // Iterative preorder; insertion order matches Go's recursive preorder.
  while (stack.length > 0) {
    const t = stack.pop();
    if (t.Parent != null && t.SentinelEdge != null) isTreeEdge.set(t.SentinelEdge, true);
    for (let i = t.Children.length - 1; i >= 0; i--) stack.push(t.Children[i]);
  }
}

/** Graph.TreeEdgeMap (buildIsTreeEdgeMap). */
export function treeEdgeMap(graph) {
  const isTreeEdge = new Map();
  for (const rootSentinel of graph.TreeOrder()) {
    for (const root of graph.Trees.get(rootSentinel) ?? []) {
      recordInternalTreeEdges(root, isTreeEdge);
    }
  }
  return isTreeEdge;
}

function isIsolatedTree(graph, node) {
  if (node.isContainer) return false;
  const roots = graph.Trees.get(node) ?? [];
  for (const edge of node.Edges) {
    let isToTree = false;
    for (const root of roots) {
      if (edge === root.SentinelEdge) {
        isToTree = true;
        break;
      }
    }
    if (!isToTree) return false;
  }
  return true;
}

/** Graph.AddIsolatedTreeEdges. */
export function addIsolatedTreeEdges(graph, isTreeEdge) {
  for (const rootSentinel of graph.TreeOrder()) {
    if (isIsolatedTree(graph, rootSentinel)) {
      for (const root of graph.Trees.get(rootSentinel) ?? []) {
        if (root.SentinelEdge != null) isTreeEdge.set(root.SentinelEdge, true);
      }
    }
  }
}

/**
 * buildNodeToTreeGuarded rebuilds graph.NodeToTree from graph.Trees in
 * sentinel-ID order, charging guard exactly as pinned Go.
 */
export function buildNodeToTreeGuarded(graph, guard) {
  const nodeToTree = new Map();
  const order = [];
  for (const rootSentinel of graph.Trees.keys()) {
    guard.Step();
    order.push(rootSentinel);
  }
  sortNodesByID(order);
  guard.Finish();
  for (const rootSentinel of order) {
    guard.Step();
    for (const root of graph.Trees.get(rootSentinel) ?? []) {
      if (root == null || root.Node == null) {
        throw invariantError('tree sentinel contains an incomplete root');
      }
      const queue = [root];
      const seen = new Set();
      for (let index = 0; index < queue.length; index++) {
        guard.Step();
        const current = queue[index];
        if (current == null || current.Node == null) {
          throw invariantError('tree preprocessing encountered an incomplete tree');
        }
        if (seen.has(current)) {
          throw invariantError('tree preprocessing encountered a repeated tree node');
        }
        seen.add(current);
        nodeToTree.set(current.Node, current);
        for (const child of current.Children) {
          guard.Step();
          queue.push(child);
        }
      }
    }
  }
  graph.NodeToTree = nodeToTree;
  guard.Finish();
}

// ---------------------------------------------------------------------------
// placement_access.go
// ---------------------------------------------------------------------------

export function halveTurnCost(graph) {
  graph.turnCost /= 2;
}

/** Edge.NumSegments (segmentCount). */
export function numSegments(edge) {
  return edge.Points.length - 1;
}

/** Edge.isAxisAligned. */
export function isAxisAligned(e) {
  if (e.From == null || e.To == null) return false;
  if (e.hasTableColumn()) {
    const ports = e.facingTablePorts(null, null);
    if (ports.hasFrom && ports.hasTo) {
      if (precisionCompare(ports.from.Y, ports.to.Y, AXIS_ALIGNMENT_TOLERANCE) === 0) return true;
    } else if (ports.hasFrom) {
      if (precisionCompare(ports.from.Y, e.To.TopLeft.Y + e.To.Height / 2, AXIS_ALIGNMENT_TOLERANCE) === 0) return true;
    } else if (ports.hasTo) {
      if (precisionCompare(ports.to.Y, e.From.TopLeft.Y + e.From.Height / 2, AXIS_ALIGNMENT_TOLERANCE) === 0) return true;
    } else if (precisionCompare(e.From.TopLeft.X, e.To.TopLeft.X, AXIS_ALIGNMENT_TOLERANCE) === 0) {
      return true;
    } else if (precisionCompare(e.From.TopLeft.X + e.From.Width, e.To.TopLeft.X + e.To.Width, AXIS_ALIGNMENT_TOLERANCE) === 0) {
      return true;
    }
    return false;
  }
  if (precisionCompare(e.From.TopLeft.Y + e.From.Height / 2, e.To.TopLeft.Y + e.To.Height / 2, AXIS_ALIGNMENT_TOLERANCE) === 0) {
    return true;
  }
  if (precisionCompare(e.From.TopLeft.X + e.From.Width / 2, e.To.TopLeft.X + e.To.Width / 2, AXIS_ALIGNMENT_TOLERANCE) === 0) {
    return true;
  }
  return false;
}

/** Node.orthogonalDistanceTo → [x, y]. */
export function orthogonalDistanceTo(nodeA, nodeB) {
  const rightA = nodeA.TopLeft.X + nodeA.Width;
  const bottomA = nodeA.TopLeft.Y + nodeA.Height;
  const rightB = nodeB.TopLeft.X + nodeB.Width;
  const bottomB = nodeB.TopLeft.Y + nodeB.Height;
  const x = nodeA.TopLeft.X < nodeB.TopLeft.X
    ? Math.max(0, nodeB.TopLeft.X - rightA)
    : Math.max(0, nodeA.TopLeft.X - rightB);
  const y = nodeA.TopLeft.Y < nodeB.TopLeft.Y
    ? Math.max(0, nodeB.TopLeft.Y - bottomA)
    : Math.max(0, nodeA.TopLeft.Y - bottomB);
  return [x, y];
}

function isPointOnNode(node, point) {
  return node.TopLeft.X <= point.X && node.TopLeft.X + node.Width >= point.X &&
    node.TopLeft.Y <= point.Y && node.TopLeft.Y + node.Height >= point.Y;
}

/** Node.spillsOutOf: some corner inside and some corner outside node2. */
export function spillsOutOf(node1, node2) {
  const corners = [
    node1.TopLeft,
    new Point(node1.TopLeft.X + node1.Width, node1.TopLeft.Y),
    new Point(node1.TopLeft.X + node1.Width, node1.TopLeft.Y + node1.Height),
    new Point(node1.TopLeft.X, node1.TopLeft.Y + node1.Height),
  ];
  let hasInside = false;
  let hasOutside = false;
  for (const corner of corners) {
    if (isPointOnNode(node2, corner)) {
      hasInside = true;
    } else {
      hasOutside = true;
    }
  }
  return hasInside && hasOutside;
}

/** Nodes.NumAdjacent (adjacentCount). */
export function numAdjacent(nodes) {
  let sum = 0;
  for (const n of nodes) sum += n.Edges.length;
  return sum;
}

/**
 * Node.HasLeakyEdge: a container with a descendant whose edge leaves it.
 * Iterative preorder that stops at the first leak, matching Go dfsWalk.
 */
export function hasLeakyEdge(node) {
  if (!node.isContainer) return false;
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n !== node) {
      for (const e of n.Edges) {
        const adj = n.adjacent(e);
        if (!adj.isDescendantOf(node)) return true;
      }
    }
    const next = [];
    if (n.isContainer) next.push(...(n.Graph.Containers.get(n) ?? []));
    if (n.isClusterVessel) {
      next.push(...n.Graph.Clusters.get(n).Nodes);
    } else {
      const s = n.Graph.Sequences.get(n);
      if (s !== undefined) next.push(...s.Nodes);
    }
    for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
  }
  return false;
}

// layoutgraph MaxIconSize (geometry_policy.go).
export const MAX_ICON_SIZE = 64;

const P = LabelPosition;
const OUTSIDE_TOP = new Set([P.OutsideTopLeft, P.OutsideTopCenter, P.OutsideTopRight]);
const OUTSIDE_BOTTOM = new Set([P.OutsideBottomLeft, P.OutsideBottomCenter, P.OutsideBottomRight]);
const OUTSIDE_LEFT = new Set([P.OutsideLeftTop, P.OutsideLeftMiddle, P.OutsideLeftBottom]);
const OUTSIDE_RIGHT = new Set([P.OutsideRightTop, P.OutsideRightMiddle, P.OutsideRightBottom]);
const INSIDE_TOP = new Set([P.InsideTopLeft, P.InsideTopCenter, P.InsideTopRight]);
const INSIDE_BOTTOM = new Set([P.InsideBottomLeft, P.InsideBottomCenter, P.InsideBottomRight]);

// Returns [spacingObject, side] for a fixed label/icon position, or null.
function spacingSlot(node, position) {
  const pos = normalizeLabelPosition(position);
  if (OUTSIDE_TOP.has(pos)) return [node._margin, 'top'];
  if (OUTSIDE_BOTTOM.has(pos)) return [node._margin, 'bottom'];
  if (OUTSIDE_LEFT.has(pos)) return [node._margin, 'left'];
  if (OUTSIDE_RIGHT.has(pos)) return [node._margin, 'right'];
  if (INSIDE_TOP.has(pos)) return [node._padding, 'top'];
  if (INSIDE_BOTTOM.has(pos)) return [node._padding, 'bottom'];
  if (pos === P.InsideMiddleLeft) return [node._padding, 'left'];
  if (pos === P.InsideMiddleRight) return [node._padding, 'right'];
  return null;
}

/** Node.UpdateSpacing (node.go). */
export function updateSpacing(n) {
  if (n.Label != null && n.Label.PositionFixed()) {
    const width = n.Label.Width + 2 * LABEL_PADDING;
    const height = n.Label.Height + 2 * LABEL_PADDING;
    const slot = spacingSlot(n, n.Label.Position);
    if (slot != null) {
      const [spacing, side] = slot;
      spacing[side] = side === 'left' || side === 'right' ? width : height;
    }
  }
  if (n.Icon != null && n.Icon.PositionFixed()) {
    const iconSize = MAX_ICON_SIZE + 2 * LABEL_PADDING;
    const slot = spacingSlot(n, n.Icon.Position);
    if (slot != null) {
      const [spacing, side] = slot;
      spacing[side] = Math.max(spacing[side], iconSize);
    }
  }
  const [dx, dy] = n.modifierElementAdjustments();
  if (dx !== 0 || dy !== 0) {
    n._margin.top += dy;
    n._margin.right += dx;
  }
}

/** Graph.ComputeNodeSpacing. */
export function computeNodeSpacing(graph) {
  for (const node of graph.Nodes) {
    updateSpacing(node);
  }
}

/** Node.CanContain. */
export function canContain(node) {
  const t = node.shapeType();
  return t !== 'Image' && t !== 'Code' && t !== 'Table' && t !== 'Class' && t !== 'Text';
}

// ---------------------------------------------------------------------------
// graph.go: CopyEntitiesFrom and subgraph splitting
// ---------------------------------------------------------------------------

export function copyEntitiesFrom(graph, other) {
  graph.Containers = other.Containers;
  graph.Clusters = other.Clusters;
  graph.Trees = other.Trees;
  graph.NodeToTree = other.NodeToTree;
  graph.Sequences = other.Sequences;
  graph.Hubs = other.Hubs;
  graph.Directions = other.Directions;
  graph.CommonUncleSiblings = other.CommonUncleSiblings;
  graph.IsRootHierarchy = other.IsRootHierarchy;
}

export class SplitOptions {
  constructor({ IncludeContainers = false, IncludeNears = false, TraverseTrees = false } = {}) {
    this.IncludeContainers = IncludeContainers;
    this.IncludeNears = IncludeNears;
    this.TraverseTrees = TraverseTrees;
  }
}

/** NodeGraphOwnershipJournal records each Node.Graph changed by a split. */
export class NodeGraphOwnershipJournal {
  constructor(original = null) {
    this.original = original;
  }

  Restore() {
    if (this.original == null) return;
    for (const [node, graph] of this.original) node.Graph = graph;
  }

  restore() {
    this.Restore();
  }

  /** Returns [graph, captured]. */
  OriginalGraph(node) {
    if (this.original == null || !this.original.has(node)) return [null, false];
    return [this.original.get(node), true];
  }
}

/**
 * splitSubgraphsWithOwnership partitions graph into mutually reachable
 * subgraphs. ownership, when supplied, is an object whose `value` receives the
 * original Node.Graph map on success.
 */
export function splitSubgraphsWithOwnership(ctx, graph, options, ownership, sharedGuard) {
  let guard = sharedGuard;
  if (guard == null) {
    validateEngineGraph(ctx, 'SplitSubgraphs', graph);
    guard = new WorkGuard(ctx, 'SplitSubgraphs', MAX_ENGINE_WORK_UNITS);
  } else {
    guard.Finish();
  }
  const originalGraphReferences = new Map();
  for (const node of graph.Nodes) {
    guard.Step();
    if (node != null) originalGraphReferences.set(node, node.Graph);
  }
  let complete = false;
  try {
    const graphs = [];
    if (graph.Nodes.length === 0) {
      complete = true;
      return graphs;
    }
    const added = new Set();
    const nodeToSubgraph = new Map();
    const addReachable = (startingNode, subgraph) => {
      const reachable = startingNode.allReachableNodesGuarded(
        options.IncludeContainers,
        options.IncludeNears,
        options.TraverseTrees,
        null,
        guard,
      );
      for (const node of reachable) {
        guard.Step();
        if (added.has(node)) continue;
        if (!originalGraphReferences.has(node)) {
          if (originalGraphReferences.size >= MAX_ENGINE_NODES) {
            throw new Error(`TALA SplitSubgraphs unique node ownership exceeds limit ${MAX_ENGINE_NODES}`);
          }
          originalGraphReferences.set(node, node.Graph);
        }
        subgraph.AddNodeUnchecked(node);
        added.add(node);
        nodeToSubgraph.set(node, subgraph);
      }
    };

    const fixedNodes = [];
    for (const node of graph.Nodes) {
      guard.Step();
      if (node.FixedTopLeft != null) fixedNodes.push(node);
    }
    if (fixedNodes.length > 0) {
      const subgraph = newGraph();
      copyEntitiesFrom(subgraph, graph);
      for (const startingNode of fixedNodes) addReachable(startingNode, subgraph);
      graphs.push(subgraph);
    }
    for (const startingNode of graph.Nodes) {
      guard.Step();
      if (added.has(startingNode)) continue;
      const subgraph = newGraph();
      copyEntitiesFrom(subgraph, graph);
      addReachable(startingNode, subgraph);
      graphs.push(subgraph);
    }

    const seenEdges = new Map();
    const appendEdge = (g, edge) => {
      let graphEdges = seenEdges.get(g);
      if (graphEdges == null) {
        graphEdges = new Set();
        seenEdges.set(g, graphEdges);
      }
      if (graphEdges.has(edge)) return;
      graphEdges.add(edge);
      g.Edges.push(edge);
    };
    for (const edge of graph.Edges) {
      guard.Step();
      const fromGraph = nodeToSubgraph.get(edge.From) ?? null;
      const toGraph = nodeToSubgraph.get(edge.To) ?? null;
      if (fromGraph != null) appendEdge(fromGraph, edge);
      if (toGraph != null && toGraph !== fromGraph) appendEdge(toGraph, edge);
    }
    guard.Finish();
    if (ownership != null) ownership.value = originalGraphReferences;
    complete = true;
    return graphs;
  } finally {
    if (!complete) {
      for (const [node, g] of originalGraphReferences) node.Graph = g;
    }
  }
}

/** Graph.SplitSubgraphs. */
export function splitSubgraphs(ctx, graph, options) {
  return splitSubgraphsWithOwnership(ctx, graph, options, null, null);
}

/**
 * Graph.SplitSubgraphsTracked → [graphs, journal]. On error the journal is
 * empty and the error propagates (the split has already restored ownership).
 */
export function splitSubgraphsTracked(ctx, graph, options, work) {
  const ownership = { value: null };
  const graphs = splitSubgraphsWithOwnership(ctx, graph, options, ownership, work ?? null);
  return [graphs, new NodeGraphOwnershipJournal(ownership.value)];
}

// ---------------------------------------------------------------------------
// node_graph_ownership.go
// ---------------------------------------------------------------------------

export const NODE_GRAPH_OWNERSHIP_SNAPSHOT_LOCATION = 'NodeGraphOwnershipSnapshot';

export class NodeGraphOwnershipSnapshot {
  constructor(owners = []) {
    this.owners = owners;
  }

  Restore() {
    for (const owner of this.owners) owner.node.Graph = owner.graph;
  }

  restore() {
    this.Restore();
  }
}

/** SnapshotNodeGraphOwnership captures every runtime-reachable node's owner. */
export function snapshotNodeGraphOwnership(ctx, graph) {
  if (graph == null) {
    throw invariantError('node graph ownership snapshot requires a graph');
  }
  const guard = new WorkGuard(ctx, NODE_GRAPH_OWNERSHIP_SNAPSHOT_LOCATION, MAX_ENGINE_WORK_UNITS);
  const objects = collectRuntimeObjectsContext(graph, guard, 'ownership runtime');
  if (objects.error != null) throw objects.error;
  const owners = [];
  for (const node of objects.nodes) {
    guard.Step();
    owners.push({ node, graph: node.Graph });
  }
  guard.Finish();
  return new NodeGraphOwnershipSnapshot(owners);
}

// ---------------------------------------------------------------------------
// packing_access.go
// ---------------------------------------------------------------------------

/** EdgeSegment (layoutgraph) — a geo.Segment tagged with its edge. */
export class EdgeSegment {
  constructor(start, end, edge) {
    this.Start = start;
    this.End = end;
    this.edge = edge;
  }
}

export function newEdgeSegment(start, end, edge) {
  return new EdgeSegment(start, end, edge);
}

/** Graph.IsBadStateWithWorkGuard; returns [bad, err] like the JS isBadStateContext. */
export function isBadStateWithWorkGuard(graph, node, graphState, ignoreContainerEscape, guard) {
  return graph.isBadStateContext(node, graphState, ignoreContainerEscape, guard);
}

// ---------------------------------------------------------------------------
// segment_crossing.go
// ---------------------------------------------------------------------------

export const SCORING_CANCELLATION_CHECK_INTERVAL = 64;

/** CrossingSegment {Start, End} with value-copied points. */
export class CrossingSegment {
  constructor(start, end) {
    this.Start = start;
    this.End = end;
  }
}

/** SegmentsCross: parallel and overlapping segments do not cross. */
export function segmentsCross(u0, u1, v0, v1) {
  const denom = (u1.Y - u0.Y) * (v1.X - v0.X) - (u1.X - u0.X) * (v1.Y - v0.Y);
  if (denom === 0) return false;
  const s = ((v1.X - v0.X) * (v0.Y - u0.Y) - (v1.Y - v0.Y) * (v0.X - u0.X)) / denom;
  if (s < 0 || s > 1) return false;
  const t = ((u1.X - u0.X) * (v0.Y - u0.Y) - (u1.Y - u0.Y) * (v0.X - u0.X)) / denom;
  return t >= 0 && t <= 1;
}

function pointsEqual(a, b) {
  return a.X === b.X && a.Y === b.Y;
}

function countSegmentCrossingsWithCheck(segments, checkCanceled) {
  let crossings = 0n;
  for (let i = 0; i < segments.length - 1; i++) {
    if (checkCanceled != null) checkCanceled(i);
    const iStart = segments[i].Start;
    const iEnd = segments[i].End;
    let minX = iStart.X;
    let maxX = iEnd.X;
    if (maxX < minX) [minX, maxX] = [maxX, minX];
    let minY = iStart.Y;
    let maxY = iEnd.Y;
    if (maxY < minY) [minY, maxY] = [maxY, minY];
    for (let j = i + 1; j < segments.length; j++) {
      if (checkCanceled != null) checkCanceled(j - i - 1);
      const jStart = segments[j].Start;
      const jEnd = segments[j].End;
      if (jStart.X < jEnd.X) {
        if (jEnd.X < minX || maxX < jStart.X) continue;
      } else if (jStart.X < minX || maxX < jEnd.X) {
        continue;
      }
      if (jStart.Y < jEnd.Y) {
        if (jEnd.Y < minY || maxY < jStart.Y) continue;
      } else if (jStart.Y < minY || maxY < jEnd.Y) {
        continue;
      }
      if (pointsEqual(iStart, jStart) || pointsEqual(iEnd, jEnd)) continue;
      if (segmentsCross(iStart, iEnd, jStart, jEnd)) crossings++;
    }
  }
  return crossings;
}

/** CountSegmentCrossings → BigInt (Go int64). */
export function countSegmentCrossings(segments) {
  return countSegmentCrossingsWithCheck(segments, null);
}

function contextErr(ctx) {
  if (ctx == null) return null;
  return ctx.Err();
}

function edgeLengthError(err) {
  return new Error(`EdgeLength: ${err.message ?? String(err)}`, { cause: err });
}

/** CountSegmentCrossingsContext → BigInt; throws "EdgeLength: …" on cancel. */
export function countSegmentCrossingsContext(ctx, segments) {
  let err = contextErr(ctx);
  if (err != null) throw edgeLengthError(err);
  const crossings = countSegmentCrossingsWithCheck(segments, (iteration) => {
    if (iteration % SCORING_CANCELLATION_CHECK_INTERVAL !== 0) return;
    const e = contextErr(ctx);
    if (e != null) throw edgeLengthError(e);
  });
  err = contextErr(ctx);
  if (err != null) throw edgeLengthError(err);
  return crossings;
}

// ---------------------------------------------------------------------------
// structure_api.go / graph.go guarded helpers used by grouping.JoinDistancedClusters
// ---------------------------------------------------------------------------

/** Node.distanceBetweenCenters. */
export function distanceBetweenCenters(nodeA, nodeB, includeSizes) {
  const c = 1.0 / 20.0;
  let xCenter = Math.abs(nodeA.TopLeft.X - nodeB.TopLeft.X);
  let yCenter = Math.abs(nodeA.TopLeft.Y - nodeB.TopLeft.Y);
  if (includeSizes) {
    xCenter = Math.abs((nodeA.TopLeft.X + nodeA.Width / 2) - (nodeB.TopLeft.X + nodeB.Width / 2)) / (nodeA.Width + nodeB.Width);
    yCenter = Math.abs((nodeA.TopLeft.Y + nodeA.Height / 2) - (nodeB.TopLeft.Y + nodeB.Height / 2)) / (nodeA.Height + nodeB.Height);
  }
  return c * Math.min(xCenter, yCenter);
}

/** Node.distance = distanceTo + distanceBetweenCenters. */
export function nodeDistance(nodeA, nodeB, includeSizes) {
  return nodeA.distanceTo(nodeB, includeSizes) + distanceBetweenCenters(nodeA, nodeB, includeSizes);
}

/**
 * Nodes.DistanceClustersWithWorkGuard (clustersWithWorkGuard). Returns null
 * (Go nil) when fewer than two seed nodes exist. Go's recursive perimeter
 * merge is replayed with an explicit frame stack in the same visit order.
 */
export function distanceClustersWithWorkGuard(nodes, distanceThreshold, guard) {
  if (guard == null) {
    throw new Error('TALA DistanceClusters requires a work guard');
  }
  const charge = (units) => guard.Add(units);
  const chargeSort = (length) => {
    for (let width = 1; width < length; width *= 2) {
      charge(length);
      if (width > Math.trunc(length / 2)) break;
    }
  };
  const nodeToCluster = new Map();
  let nextGeneratedClusterID = 0;
  const createCluster = (node) => {
    if (!nodeToCluster.has(node)) nodeToCluster.set(node, nextGeneratedClusterID++);
  };
  const seedNodes = [];
  const maybeAddSeedNodes = (n, adj) => {
    const d = nodeDistance(n, adj, true);
    if (precisionCompare(d, distanceThreshold, PRECISION) > 0) seedNodes.push(n, adj);
  };
  for (const n of nodes) {
    charge(1 + n.Edges.length + n.Nears.size);
    for (const e of n.Edges) maybeAddSeedNodes(n, n.adjacent(e));
    chargeSort(n.Nears.size);
    for (let near of n.orderedNears()) {
      if (near.Cluster != null) {
        near = near.Cluster.Vessel;
      } else if (near.Sequence != null) {
        near = near.Sequence.Vessel;
      } else if (n.Graph.NodeToTree.has(near)) {
        let tree = n.Graph.NodeToTree.get(near);
        while (tree.Parent != null) {
          guard.Step();
          tree = tree.Parent;
        }
        near = tree.sentinelNode();
      }
      if (near.Container !== n.Container) continue;
      maybeAddSeedNodes(n, near);
    }
  }
  if (seedNodes.length < 2) {
    guard.Finish();
    return null;
  }

  const mergeNodesInPerimeter = (start) => {
    // Each frame is [node, nextIndex, clusterID captured on entry]; entering a
    // frame charges like Go's recursive call.
    charge(nodes.length);
    const stack = [[start, 0, nodeToCluster.get(start)]];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const n = frame[0];
      let descended = false;
      while (frame[1] < nodes.length) {
        const otherN = nodes[frame[1]++];
        if (otherN === n || otherN.FixedTopLeft != null) continue;
        const d = nodeDistance(n, otherN, true);
        if (precisionCompare(d, distanceThreshold, PRECISION) > 0) continue;
        const clusterID = frame[2];
        const inMap = nodeToCluster.has(otherN);
        if (inMap && nodeToCluster.get(otherN) === clusterID) continue;
        nodeToCluster.set(otherN, nodeToCluster.get(n));
        if (!inMap) {
          charge(nodes.length);
          stack.push([otherN, 0, nodeToCluster.get(otherN)]);
          descended = true;
          break;
        }
      }
      if (!descended) stack.pop();
    }
  };

  charge(seedNodes.length);
  for (const node of seedNodes) {
    if (node.FixedTopLeft != null) continue;
    createCluster(node);
    mergeNodesInPerimeter(node);
  }
  charge(nodes.length);
  if (!nodes.some((n) => n.FixedTopLeft != null) && nodeToCluster.size !== nodes.length) {
    throw new Error(`Clustered nodes: ${nodeToCluster.size}. Total: ${nodes.length}`);
  }
  const clusterMapping = new Map();
  charge(nodeToCluster.size);
  for (const [node, clusterID] of nodeToCluster) {
    if (!clusterMapping.has(clusterID)) clusterMapping.set(clusterID, []);
    clusterMapping.get(clusterID).push(node);
  }
  for (const cluster of clusterMapping.values()) {
    chargeSort(cluster.length);
    sortNodesByID(cluster);
  }
  charge(clusterMapping.size);
  const clusterIDs = [...clusterMapping.keys()];
  chargeSort(clusterIDs.length);
  clusterIDs.sort((a, b) => a - b);
  const clusters = [];
  charge(clusterIDs.length);
  for (const id of clusterIDs) clusters.push(clusterMapping.get(id));
  guard.Finish();
  return clusters;
}

/** Graph.WouldOverlapWithWorkGuard; throws instead of returning an error. */
export function wouldOverlapWithWorkGuard(graph, node, point, exceptions, pairwiseExceptions, guard) {
  if (guard == null) {
    throw new Error('TALA overlap check requires a work guard');
  }
  const width = node == null ? 0 : node.Width;
  const height = node == null ? 0 : node.Height;
  const [overlaps, err] = graph.doesOverlapWithDimensionsContext(node, point, width, height, exceptions, pairwiseExceptions, guard);
  if (err != null) throw err;
  return overlaps;
}
