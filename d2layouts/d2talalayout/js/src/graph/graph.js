import { Node, sortNodesByID } from './node.js';
import { Edge } from './edge.js';
import { Orientation } from '../geometry/orientation.js';
import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { nodesFixedBounds, nodesUnroundedFixedBounds } from './node-bounds.js';
import { isOutsideLabelPosition } from './label-position.js';
import { MAX_ENGINE_NODES } from '../limits/constants.js';
import {
  newRequestTransaction as _newRequestTransaction,
  newRequestTransactionWithGuard as _newRequestTransactionWithGuard,
} from './transaction.js';

const noopWorkStepper = {
  Step() {},
  step() {},
  Finish() {},
  finish() {},
};

export class Graph {
  constructor() {
    this.ID = "";
    this.Nodes = [];
    this.Edges = [];

    this.Containers = new Map();
    this.Directions = new Map();
    this.CellSize = 0;
    this.IsRootHierarchy = false;

    this.Trees = new Map();
    this.NodeToTree = new Map();
    this.Clusters = new Map();
    this.Sequences = new Map();
    this.Hubs = new Map();
    this.CommonUncleSiblings = null;

    this.crossingCost = 0;
    this.turnCost = 0;
    this.nonCenterPortCost = 0;
    this.edgeLengthCache = new Map();

    this.endpoints = new Map();
    this.nodesByExternalId = new Map();
    this.edgesByExternalId = new Map();
    this.nodesByEntityId = new Map();
    this.edgesByEntityId = new Map();
  }

  addNode(node) {
    this.addNodeUnchecked(node);
    return node;
  }

  AddNode(node) {
    return this.addNode(node);
  }

  addNodeUnchecked(node) {
    this.Nodes.push(node);
    node.Graph = this;
    return node;
  }

  AddNodeUnchecked(node) {
    return this.addNodeUnchecked(node);
  }

  addNodeToContainer(container, node) {
    node.Container = container;
    
    let children = this.Containers.get(container);
    if (!children) {
      children = [];
      this.Containers.set(container, children);
    }
    children.push(node);

    if (container !== null && container !== undefined) {
      container.isContainer = true;
    }
  }

  AddNodeToContainer(container, node) {
    this.addNodeToContainer(container, node);
  }

  addNewNodeToContainer(container, node) {
    this.addNodeUnchecked(node);
    this.addNodeToContainer(container, node);
  }

  AddNewNodeToContainer(container, node) {
    this.addNewNodeToContainer(container, node);
  }

  removeNode(node) {
    this.Nodes = this.Nodes.filter((n) => n !== node);
  }

  fixedNodes() {
    const fixed = [];
    for (const n of this.Nodes) {
      if (n.FixedTopLeft != null) {
        fixed.push(n);
      }
    }
    return fixed;
  }

  FixedNodes() {
    return this.fixedNodes();
  }

  containerFixedOrigin(container) {
    for (const node of this.Nodes) {
      if (node.container() !== container) continue;
      const point = node.fixedOrigin();
      if (point != null) return point;
    }
    return null;
  }

  ContainerFixedOrigin(container) {
    return this.containerFixedOrigin(container);
  }

  hasFixedNode() {
    for (const n of this.Nodes) {
      if (n.FixedTopLeft != null) {
        return true;
      }
    }
    return false;
  }

  HasFixedNode() {
    return this.hasFixedNode();
  }

  AddEdge(edge) {
    if (this.Edges.includes(edge)) {
      return;
    }
    this.Edges.push(edge);
  }

  addEdge(edge) {
    this.AddEdge(edge);
  }

  connect(from, to) {
    const edge = new Edge(from, to);
    this.AddEdge(edge);
    from.addEdge(edge);
    if (from !== to) {
      to.addEdge(edge);
    }
    return edge;
  }

  Connect(from, to) {
    return this.connect(from, to);
  }

  disconnect(edge) {
    if (!edge) return;
    
    if (edge.From) edge.From.removeEdge(edge);
    if (edge.To) edge.To.removeEdge(edge);

    const idx = this.Edges.indexOf(edge);
    if (idx !== -1) {
      this.Edges.splice(idx, 1);
    }
  }

  Disconnect(edge) {
    this.disconnect(edge);
  }

  direction(container) {
    return this.Directions.has(container) ? this.Directions.get(container) : Orientation.NONE;
  }

  Direction(container) {
    return this.direction(container);
  }

  computeCellSize() {
    let minHeight = Infinity;
    let minWidth = Infinity;
    let maxHeight = -Infinity;
    let maxWidth = -Infinity;

    for (const node of this.Nodes) {
      minWidth = Math.min(minWidth, node.Width);
      minHeight = Math.min(minHeight, node.Height);
      maxWidth = Math.max(maxWidth, node.Width);
      maxHeight = Math.max(maxHeight, node.Height);
    }

    const minLength = Math.min(minWidth, minHeight);
    const maxLength = Math.max(maxWidth, maxHeight);

    if (maxLength < 3 * minLength) {
      this.CellSize = Math.ceil(maxLength);
    } else {
      this.CellSize = Math.ceil((3 * minLength) / 2);
    }
    
    this.CellSize = Math.max(this.CellSize, 10);
  }

  ComputeCellSize() {
    this.computeCellSize();
  }

  // maxEdgeLength returns the maximum edge distance (with sizes) across all
  // node pairs in the graph. Falls back to ConnectedNodeGap (60) if no
  // positioned pair exists.
  // Pinned Go: layoutgraph.Graph.maxEdgeLength (graph.go:627)
  maxEdgeLength() {
    const CONNECTED_NODE_GAP = 60.0;
    let hasLength = false;
    let maxLength = CONNECTED_NODE_GAP;
    for (const n of this.Nodes) {
      if (n.TopLeft == null) continue;
      for (const e of (n.Edges || [])) {
        const adj = n.adjacent(e);
        if (adj.TopLeft == null) continue;
        hasLength = true;
        const distance = n.distanceTo(adj, true);
        if (distance > maxLength) maxLength = distance;
      }
    }
    if (!hasLength) return 0.0;
    return maxLength;
  }

  // turnCostValue returns the lazily-computed turn penalty.
  // Pinned Go: layoutgraph.Graph.turnCostValue (graph.go:532)
  turnCostValue() {
    const TURN_PENALTY_MULTIPLIER = 0.125;
    if (this.turnCost !== 0) return this.turnCost;
    const cost = TURN_PENALTY_MULTIPLIER * this.Edges.length * this.maxEdgeLength();
    this.turnCost = cost;
    return cost;
  }

  TurnCost() {
    return this.turnCostValue();
  }

  // crossingCostValue returns the lazily-computed crossing penalty and caches
  // it in the graph-owned routing cost (observable through routingCosts()).
  // Pinned Go: layoutgraph.Graph.crossingCostValue (graph.go:599)
  crossingCostValue() {
    const CROSSING_COST_WEIGHT = 0.48 * 0.48 * 0.48;
    if (this.crossingCost !== 0) return this.crossingCost;
    const cost = CROSSING_COST_WEIGHT * this.Edges.length * this.maxEdgeLength();
    this.crossingCost = cost;
    return cost;
  }

  CrossingCost() {
    return this.crossingCostValue();
  }

  // resetTurnCost resets the lazily-cached turn cost so it is recomputed on
  // next access.
  // Pinned Go: layoutgraph.Graph.resetTurnCost (graph.go:621)
  resetTurnCost() {
    this.turnCost = 0;
  }

  ResetTurnCost() {
    this.resetTurnCost();
  }

  isSequenceVessel(node) {
    return this.Sequences.has(node);
  }

  IsSequenceVessel(node) {
    return this.isSequenceVessel(node);
  }

  isTreeSentinel(node) {
    return this.Trees.has(node);
  }

  IsTreeSentinel(node) {
    return this.isTreeSentinel(node);
  }

  clusterOrder() {
    const nodes = Array.from(this.Clusters.keys());
    return sortNodesByID(nodes);
  }

  ClusterOrder() {
    return this.clusterOrder();
  }

  treeOrder() {
    const nodes = Array.from(this.Trees.keys());
    return sortNodesByID(nodes);
  }

  TreeOrder() {
    return this.treeOrder();
  }

  sequenceOrder() {
    const nodes = Array.from(this.Sequences.keys());
    return sortNodesByID(nodes);
  }

  SequenceOrder() {
    return this.sequenceOrder();
  }

  containerRDFSOrder(root = null) {
    const order = [];

    if (root !== null && (!root || !root.isContainer)) {
      return order;
    }

    const children = this.Containers.get(root) || [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];

      if (child.isContainer) {
        const descendants = this.containerRDFSOrder(child);
        for (const descendant of descendants) {
          order.push(descendant);
        }
        order.push(child);
        continue;
      }

      if (child.isClusterVessel) {
        const cluster = this.Clusters.get(child);
        if (cluster && cluster.Nodes) {
          for (let j = cluster.Nodes.length - 1; j >= 0; j--) {
            const cNode = cluster.Nodes[j];
            if (cNode.isContainer) {
              const descendants = this.containerRDFSOrder(cNode);
              for (const descendant of descendants) {
                order.push(descendant);
              }
              order.push(cNode);
            }
          }
        }
        continue;
      }
    }

    return order;
  }

  containerRDFSOrderContext(root = null, guard) {
    const order = [];

    if (root !== null && (!root || !root.isContainer)) {
      return order;
    }

    const children = this.Containers.get(root) || [];
    for (let i = children.length - 1; i >= 0; i--) {
      guard.Step();
      const child = children[i];

      if (child.isContainer) {
        const descendants = this.containerRDFSOrderContext(child, guard);
        for (const d of descendants) {
          order.push(d);
        }
        order.push(child);
        continue;
      }

      if (child.isClusterVessel) {
        const cluster = this.Clusters.get(child);
        if (cluster && cluster.Nodes) {
          for (let j = cluster.Nodes.length - 1; j >= 0; j--) {
            guard.Step();
            const cNode = cluster.Nodes[j];
            if (cNode.isContainer) {
              const descendants = this.containerRDFSOrderContext(cNode, guard);
              for (const d of descendants) {
                order.push(d);
              }
              order.push(cNode);
            }
          }
        }
        continue;
      }
    }

    return order;
  }

  ContainerRDFSOrder(root = null, guard) {
    return this.containerRDFSOrderContext(root, guard);
  }

  ContainerRDFSOrderUnbounded(root = null) {
    return this.containerRDFSOrder(root);
  }

  clusterRDFSOrder() {
    const order = [];
    const dfsContainerOrder = this.containerRDFSOrder(null);
    dfsContainerOrder.push(null);
    for (const container of dfsContainerOrder) {
      const children = this.Containers.get(container);
      if (children) {
        for (const child of children) {
          if (child.isClusterVessel) {
            order.push(child);
          }
        }
      }
    }
    return order;
  }

  ClusterRDFSOrder() {
    return this.clusterRDFSOrder();
  }

  /**
   * SyncSequences synchronizes every active sequence in nested graph order.
   * Traverses graph.Nodes through rdfsWalk without sorting.
   */
  syncSequences() {
    if (!this.Sequences || this.Sequences.size === 0) {
      return;
    }

    const sync = (n) => {
      const sequence = this.Sequences.get(n);
      if (sequence) {
        sequence.SyncGeometry();
      }
    };

    for (const n of this.Nodes) {
      n.rdfsWalk(sync);
    }
  }

  SyncSequences() {
    this.syncSequences();
  }

  /**
   * SyncClusters synchronizes every active cluster in nested graph order.
   * Traverses graph.Nodes through rdfsWalk without sorting.
   *
   * Pinned reference: layoutgraph/cluster.go SyncClusters
   */
  syncClusters() {
    if (!this.Clusters || this.Clusters.size === 0) {
      return;
    }

    const sync = (node) => {
      if (node.isClusterVessel) {
        this.Clusters.get(node).SyncGeometry();
      }
    };

    for (const node of this.Nodes) {
      node.rdfsWalk(sync);
    }
  }

  SyncClusters() {
    this.syncClusters();
  }

  syncNestedGeometry() {
    for (const node of this.Nodes) {
      if (node.isContainer) {
        node.positionContainerChildren(true);
      }
      if (node.isClusterVessel) {
        const c = this.Clusters.get(node);
        c.SyncGeometry();
        for (const cn of c.Nodes ?? []) {
          if (cn.isContainer) {
            const padding = this.containerPadding(cn, true);
            const children = this.Containers.get(cn) ?? [];
            for (const child of children) {
              child.moveNodeWithChildren(padding.left, padding.top);
            }
          }
        }
      }
      if (this.Sequences.has(node)) {
        const seq = this.Sequences.get(node);
        seq.SyncGeometry();
      }
    }
  }

  SyncNestedGeometry() {
    this.syncNestedGeometry();
  }

  /**
   * allDescendantNodesGuarded collects every descendant node under `node`,
   * optionally including cluster member nodes. Iterative, never recursive.
   *
   * Pinned reference: layoutgraph/graph.go allDescendantNodesGuarded
   *
   * Traversal order: container children > cluster members > sequence members,
   * each pushed in reverse so the pop-from-end restores the original order.
   *
   * @param {import('./node.js').Node | null} node
   * @param {boolean} includeClusterNodes
   * @param {import('../limits/work-guard.js').WorkGuard | { Step: Function, Finish: Function }} guard
   * @returns {Array<import('./node.js').Node>}
   */
  allDescendantNodesGuarded(node, includeClusterNodes, guard) {
    const seen = new Set();
    if (node !== null && node !== undefined) {
      seen.add(node);
    }

    // Each stack entry: { node, emit }
    const stack = [];

    const pushChildren = (parent) => {
      // 1. Sequence members: push in reverse order
      if (this.Sequences) {
        const sequence = this.Sequences.get(parent);
        if (sequence != null && sequence.Nodes != null) {
          for (let i = sequence.Nodes.length - 1; i >= 0; i--) {
            guard.Step();
            stack.push({ node: sequence.Nodes[i], emit: includeClusterNodes });
          }
        }
      }

      // 2. Cluster members: push in reverse order
      if (parent != null && parent.isClusterVessel) {
        if (this.Clusters) {
          const cluster = this.Clusters.get(parent);
          if (cluster != null && cluster.Nodes != null) {
            for (let i = cluster.Nodes.length - 1; i >= 0; i--) {
              guard.Step();
              stack.push({ node: cluster.Nodes[i], emit: includeClusterNodes });
            }
          }
        }
      }

      // 3. Container children: push in reverse order
      if (parent === null || parent === undefined || parent.isContainer) {
        if (this.Containers) {
          const children = this.Containers.get(parent);
          if (children != null) {
            for (let i = children.length - 1; i >= 0; i--) {
              guard.Step();
              stack.push({ node: children[i], emit: true });
            }
          }
        }
      }
    };

    pushChildren(node);

    const descendants = [];
    while (stack.length > 0) {
      guard.Step();
      const current = stack.pop();
      if (current.node == null) continue;
      if (seen.has(current.node)) continue;
      seen.add(current.node);
      if (current.emit) {
        descendants.push(current.node);
      }
      pushChildren(current.node);
    }

    guard.Finish();
    return descendants;
  }

  allDescendantNodes(node, includeClusterNodes) {
    return this.allDescendantNodesGuarded(node, includeClusterNodes, noopWorkStepper);
  }

  AllDescendantNodes(node, includeClusterNodes) {
    return this.allDescendantNodes(node, includeClusterNodes);
  }

  allDescendantNodesWithWorkGuard(node, includeClusterNodes, guard) {
    return this.allDescendantNodesGuarded(node, includeClusterNodes, guard);
  }

  AllDescendantNodesWithWorkGuard(node, includeClusterNodes, guard) {
    return this.allDescendantNodesWithWorkGuard(node, includeClusterNodes, guard);
  }

  containerPadding(container, considerChildren = false) {
    let padding = 60;
    const spacing = new Spacing(padding, padding, padding, padding);
    if (container === null || container === undefined) {
      return spacing;
    }

    if (container._shapeType === "Circle") {
      padding /= 4;
    }

    if (container.Icon != null && container._shapeType !== "Image") {
      padding = 64 + 2 * 5; // 74
    }

    if (container.Label != null && !isOutsideLabelPosition(container.Label.Position)) {
      const labelWidth = (container.Label.Width ?? 0) + 10;
      const labelHeight = (container.Label.Height ?? 0) + 10;

      const insidePos = classifyInsidePosition(container.Label.Position);
      if (insidePos === "top") {
        spacing.top = Math.max(spacing.top, labelHeight);
      } else if (insidePos === "bottom") {
        spacing.bottom = Math.max(spacing.bottom, labelHeight);
      } else if (insidePos === "left") {
        spacing.left = Math.max(spacing.left, labelWidth);
      } else if (insidePos === "right") {
        spacing.right = Math.max(spacing.right, labelWidth);
      }

      const minContainerWidth = labelWidth + spacing.left + spacing.right;
      if ((container.Width ?? 0) < minContainerWidth) {
        const extraPadding = Math.ceil((minContainerWidth - (container.Width ?? 0)) / 2);
        spacing.left = Math.max(spacing.left, extraPadding);
        spacing.right = Math.max(spacing.right, extraPadding);
      }

      const minContainerHeight = labelHeight + spacing.top + spacing.bottom;
      if ((container.Height ?? 0) < minContainerHeight) {
        const extraPadding = Math.ceil((minContainerHeight - (container.Height ?? 0)) / 2);
        spacing.top = Math.max(spacing.top, extraPadding);
        spacing.bottom = Math.max(spacing.bottom, extraPadding);
      }
    }

    const containerPad = container.padding ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const padTop = typeof containerPad.Top === "function" ? containerPad.Top() : (containerPad.top ?? 0);
    const padBottom = typeof containerPad.Bottom === "function" ? containerPad.Bottom() : (containerPad.bottom ?? 0);
    const padLeft = typeof containerPad.Left === "function" ? containerPad.Left() : (containerPad.left ?? 0);
    const padRight = typeof containerPad.Right === "function" ? containerPad.Right() : (containerPad.right ?? 0);

    if (considerChildren) {
      let hasChildWithIcon = false;
      const childrenMargin = { left: 0, right: 0, top: 0, bottom: 0 };
      const children = this.Containers.get(container) || [];
      for (const child of children) {
        const childIsFixed = child.Icon?.PositionFixed ? child.Icon.PositionFixed() : false;
        if (!hasChildWithIcon && child.Icon != null && child._shapeType !== "Image" && !childIsFixed) {
          hasChildWithIcon = true;
        }
        const childMarg = child.margin ?? { left: 0, right: 0, top: 0, bottom: 0 };
        const cmLeft = typeof childMarg.Left === "function" ? childMarg.Left() : (childMarg.left ?? 0);
        const cmRight = typeof childMarg.Right === "function" ? childMarg.Right() : (childMarg.right ?? 0);
        const cmTop = typeof childMarg.Top === "function" ? childMarg.Top() : (childMarg.top ?? 0);
        const cmBottom = typeof childMarg.Bottom === "function" ? childMarg.Bottom() : (childMarg.bottom ?? 0);

        childrenMargin.left = Math.max(childrenMargin.left, cmLeft);
        childrenMargin.right = Math.max(childrenMargin.right, cmRight);
        childrenMargin.top = Math.max(childrenMargin.top, cmTop);
        childrenMargin.bottom = Math.max(childrenMargin.bottom, cmBottom);
      }

      spacing.left = Math.max(spacing.left, padLeft + childrenMargin.left);
      spacing.right = Math.max(spacing.right, padRight + childrenMargin.right);
      spacing.top = Math.max(spacing.top, padTop + childrenMargin.top);
      spacing.bottom = Math.max(spacing.bottom, padBottom + childrenMargin.bottom);

      if (hasChildWithIcon) {
        padding = 64 + 2 * 5; // 74
      }
    }

    if (container._shapeType === "Circle") {
      spacing.top /= 4;
      spacing.left /= 4;
      spacing.bottom /= 4;
      spacing.right /= 4;
    }

    spacing.left = Math.max(spacing.left, Math.max(padLeft, padding));
    spacing.right = Math.max(spacing.right, Math.max(padRight, padding));
    spacing.top = Math.max(spacing.top, Math.max(padTop, padding));
    spacing.bottom = Math.max(spacing.bottom, Math.max(padBottom, padding));

    return spacing;
  }

  ContainerPadding(container, considerChildren = false) {
    return this.containerPadding(container, considerChildren);
  }

  boundingBox(roundNodeDimensions = true) {
    const [tl, br] = roundNodeDimensions
      ? nodesFixedBounds(this.Nodes)
      : nodesUnroundedFixedBounds(this.Nodes);

    if (tl == null || br == null) {
      return [null, null];
    }

    let minX = tl.X;
    let minY = tl.Y;
    let maxX = br.X;
    let maxY = br.Y;

    for (const edge of this.Edges) {
      const [edgeTL, edgeBR] = edge.boundingBoxValues();
      if (edgeTL.X !== Infinity && edgeTL.X !== -Infinity) {
        minX = Math.min(minX, edgeTL.X);
        minY = Math.min(minY, edgeTL.Y);
        maxX = Math.max(maxX, edgeBR.X);
        maxY = Math.max(maxY, edgeBR.Y);
      }
    }

    return [new Point(minX, minY), new Point(maxX, maxY)];
  }

  bounds() {
    const [tl, br] = this.boundingBox(true);
    if (tl == null || br == null) {
      return [null, null];
    }
    return [
      new Point(goRound(tl.X), goRound(tl.Y)),
      new Point(goRound(br.X), goRound(br.Y))
    ];
  }

  BoundingBox() {
    return this.bounds();
  }

  lookupEdgeLengthCost(state) {
    if (this.edgeLengthCache == null) {
      return [0, false];
    }
    const val = this.edgeLengthCache.get(state);
    if (val !== undefined) {
      return [val, true];
    }
    return [0, false];
  }

  LookupEdgeLengthCost(state) {
    return this.lookupEdgeLengthCost(state);
  }

  storeEdgeLengthCost(state, cost) {
    if (this.edgeLengthCache != null) {
      this.edgeLengthCache.set(state, cost);
    }
  }

  StoreEdgeLengthCost(state, cost) {
    this.storeEdgeLengthCost(state, cost);
  }

  edgeLengthCacheEntries() {
    if (this.edgeLengthCache == null) {
      return 0;
    }
    return this.edgeLengthCache.size;
  }

  EdgeLengthCacheEntries() {
    return this.edgeLengthCacheEntries();
  }

  routingCosts() {
    return {
      Crossing: this.crossingCost,
      Turn: this.turnCost,
      NonCenterPort: this.nonCenterPortCost,
    };
  }

  RoutingCosts() {
    return this.routingCosts();
  }

  restoreRoutingCosts(state) {
    this.crossingCost = state.Crossing;
    this.turnCost = state.Turn;
    this.nonCenterPortCost = state.NonCenterPort;
  }

  RestoreRoutingCosts(state) {
    this.restoreRoutingCosts(state);
  }

  resetPlacementCosts() {
    if (this.edgeLengthCache != null) {
      this.edgeLengthCache.clear();
    }
    this.crossingCost = 0;
    this.turnCost = 0;
    this.nonCenterPortCost = 0;
  }

  ResetPlacementCosts() {
    this.resetPlacementCosts();
  }

  snapshotPlacementCosts() {
    let cacheClone = null;
    if (this.edgeLengthCache != null) {
      cacheClone = new Map(this.edgeLengthCache);
    }
    return new PlacementCostSnapshot(
      this,
      this.edgeLengthCache,
      cacheClone,
      this.crossingCost,
      this.turnCost,
      this.nonCenterPortCost
    );
  }

  SnapshotPlacementCosts() {
    return this.snapshotPlacementCosts();
  }

  // ── Transaction factory ────────────────────────────────────────────────────

  /**
   * newRequestTransaction creates a geometry transaction charged to the
   * context's shared transaction work guard.
   * Mirrors: Go Graph.NewRequestTransaction
   * @returns {[Transaction, null]|[null, Error]}
   */
  newRequestTransaction(ctx, options) {
    return _newRequestTransaction(this, ctx, options);
  }

  NewRequestTransaction(ctx, options) {
    return this.newRequestTransaction(ctx, options);
  }

  /**
   * newRequestTransactionWithGuard creates a transaction with a shared work guard.
   * Mirrors: Go Graph.newRequestTransactionWithGuard
   * @returns {[Transaction, null]|[null, Error]}
   */
  newRequestTransactionWithGuard(ctx, guard, options) {
    return _newRequestTransactionWithGuard(this, ctx, guard, options);
  }

  NewRequestTransactionWithWorkGuard(ctx, guard, options) {
    return this.newRequestTransactionWithGuard(ctx, guard, options);
  }

  // ── Transaction validation helpers (Go graph.go) ───────────────────────────
  // Returned errors mirror Go's returned invariant errors; WorkGuard failures
  // throw.

  /**
   * Mirrors: Go Graph.isBadStateContext
   * @returns {[boolean, Error|null]}
   */
  isBadStateContext(node, graphState, ignoreContainerEscape, guard) {
    const [bad, skipOverlapCheck, err] = this.isStructurallyBadStateContext(node, graphState, ignoreContainerEscape, guard);
    if (err != null || bad) return [bad, err];
    if (skipOverlapCheck) {
      guard.Finish();
      return [false, null];
    }
    return this.hasBadOverlapStateContext(node, graphState, guard);
  }

  /** Mirrors: Go Graph.isStructurallyBadStateContext */
  isStructurallyBadStateContext(node, graphState, ignoreContainerEscape, guard) {
    return this.isStructurallyBadStateWithFixedOriginContext(node, graphState, ignoreContainerEscape, null, false, guard);
  }

  /**
   * Mirrors: Go Graph.isStructurallyBadStateWithFixedOriginContext
   * @returns {[boolean, boolean, Error|null]} [bad, skipOverlapCheck, err]
   */
  isStructurallyBadStateWithFixedOriginContext(node, graphState, ignoreContainerEscape, fixedOrigin, fixedOriginCached, guard) {
    if (node == null || node.TopLeft == null) {
      return [true, false, new Error('layout invariant violated: transaction bad-state check received an incomplete node')];
    }
    guard.Step();
    // The vessel covers cluster nodes.
    if (node.Cluster != null) return [false, true, null];
    if (!ignoreContainerEscape) {
      const c = node.container();
      if (c != null && c.TopLeft != null && node.TopLeft != null && !c.surrounds(node, 0)) {
        return [true, false, null];
      }
      if (node.isContainer) {
        for (const child of this.Containers.get(node) ?? []) {
          guard.Step();
          if (child == null || child.TopLeft == null) {
            return [false, false, new Error('layout invariant violated: transaction container has an incomplete child')];
          }
          if (!node.surrounds(child, 0)) return [true, false, null];
        }
      }
    }

    let pastFixedOrigin;
    if (fixedOriginCached) {
      pastFixedOrigin = fixedOrigin != null &&
        (node.TopLeft.X < fixedOrigin.X || node.TopLeft.Y < fixedOrigin.Y);
    } else {
      pastFixedOrigin = node.isPointPastFixedOrigin(node.TopLeft.X, node.TopLeft.Y, true);
    }
    if (pastFixedOrigin) return [true, false, null];

    if (node.FixedTopLeft != null && graphState != null) {
      let originalX = 0;
      let originalY = 0;
      const original = graphState.nodeGeometry.get(node);
      if (original !== undefined && original.topLeft != null) {
        originalX = original.topLeft.x;
        originalY = original.topLeft.y;
      }
      if (node.TopLeft.X !== originalX || node.TopLeft.Y !== originalY) {
        return [true, false, null];
      }
    }
    return [false, false, null];
  }

  /**
   * Mirrors: Go Graph.hasBadOverlapStateContext
   * @returns {[boolean, Error|null]}
   */
  hasBadOverlapStateContext(node, graphState, guard) {
    if (node == null || node.TopLeft == null) {
      return [true, new Error('layout invariant violated: transaction overlap check received an incomplete node')];
    }
    if (node.Cluster != null) return [false, null];
    const pairwiseExceptions = graphState != null ? graphState.existingOverlaps : null;
    let exceptions = [];
    if (node.isContainer || node.isClusterVessel || this.Sequences.get(node) != null) {
      exceptions = this.allDescendantNodesGuarded(node, true, guard);
    }
    if (node.Container != null || node.Cluster != null || node.Sequence != null) {
      const [ancestors, err] = this.ancestorsOfGuarded(node, guard);
      if (err != null) return [false, err];
      exceptions = exceptions.concat(ancestors);
    }
    return this.doesOverlapWithDimensionsContext(node, node.TopLeft, node.Width, node.Height, exceptions, pairwiseExceptions, guard);
  }

  /**
   * Mirrors: Go Graph.doesOverlapWithDimensionsContext
   * @returns {[boolean, Error|null]}
   */
  doesOverlapWithDimensionsContext(node, p, newWidth, newHeight, exceptions, pairwiseExceptions, guard) {
    if (node == null || p == null) {
      return [true, new Error('layout invariant violated: overlap check received an incomplete node')];
    }
    const right = p.X + newWidth;
    const bottom = p.Y + newHeight;
    let exceptionSet = null;
    if (exceptions != null && exceptions.length > 0) {
      exceptionSet = new Set();
      for (const exception of exceptions) {
        guard.Step();
        exceptionSet.add(exception);
      }
    }
    const pairwiseNodeExceptions = pairwiseExceptions != null ? pairwiseExceptions.get(node) : undefined;
    for (const otherNode of this.Nodes) {
      guard.Step();
      if (otherNode == null) {
        return [false, new Error('layout invariant violated: overlap check encountered a nil graph node')];
      }
      if (otherNode === node) continue;
      if (otherNode.TopLeft != null) {
        const maxSafeDelta = 500.0;
        if (
          p.X > otherNode.TopLeft.X + otherNode.Width + maxSafeDelta ||
          p.X + newWidth + maxSafeDelta < otherNode.TopLeft.X ||
          p.Y > otherNode.TopLeft.Y + otherNode.Height + maxSafeDelta ||
          p.Y + newHeight + maxSafeDelta < otherNode.TopLeft.Y
        ) {
          continue;
        }
        if (pairwiseNodeExceptions !== undefined && pairwiseNodeExceptions.has(otherNode)) continue;
        if (exceptionSet != null && exceptionSet.has(otherNode)) continue;
        const delta = node.deltaToGuarded(otherNode, p, guard);
        if (
          p.X < otherNode.TopLeft.X + otherNode.Width + delta &&
          right + delta > otherNode.TopLeft.X &&
          p.Y < otherNode.TopLeft.Y + otherNode.Height + delta &&
          bottom + delta > otherNode.TopLeft.Y
        ) {
          return [true, null];
        }
      }
    }
    guard.Finish();
    return [false, null];
  }

  /**
   * Mirrors: Go Graph.ancestorsOfGuarded (excludes node itself).
   * @returns {[Array<Node>|null, Error|null]}
   */
  ancestorsOfGuarded(node, guard) {
    const seen = new Set();
    const nodes = [];
    for (let current = node; current != null;) {
      guard.Step();
      if (seen.has(current)) {
        return [null, new Error('layout invariant violated: cycle in transaction ancestry')];
      }
      seen.add(current);
      if (seen.size > MAX_ENGINE_NODES) {
        return [null, new Error('layout invariant violated: transaction ancestry exceeds node limit')];
      }
      if (current !== node) {
        nodes.push(current);
      }
      if (current.Container != null) {
        current = current.Container;
      } else if (current.Cluster != null) {
        current = current.Cluster.Vessel;
      } else if (current.Sequence != null) {
        current = current.Sequence.Vessel;
      } else {
        break;
      }
    }
    guard.Finish();
    return [nodes, null];
  }
}

export class PlacementCostSnapshot {
  constructor(graph, cacheRef, cache, crossingCost, turnCost, nonCenterPortCost) {
    this.graph = graph;
    this.cacheRef = cacheRef;
    this.cache = cache;
    this.crossingCost = crossingCost;
    this.turnCost = turnCost;
    this.nonCenterPortCost = nonCenterPortCost;
  }

  restore() {
    if (this.graph == null) {
      return;
    }
    if (this.cacheRef == null) {
      this.graph.edgeLengthCache = null;
    } else {
      this.cacheRef.clear();
      if (this.cache != null) {
        for (const [k, v] of this.cache) {
          this.cacheRef.set(k, v);
        }
      }
      this.graph.edgeLengthCache = this.cacheRef;
    }
    this.graph.crossingCost = this.crossingCost;
    this.graph.turnCost = this.turnCost;
    this.graph.nonCenterPortCost = this.nonCenterPortCost;
  }

  Restore() {
    this.restore();
  }
}


export class Spacing {
  constructor(top = 0, bottom = 0, left = 0, right = 0) {
    this.top = top;
    this.bottom = bottom;
    this.left = left;
    this.right = right;
  }

  Top() { return this.top; }
  Bottom() { return this.bottom; }
  Left() { return this.left; }
  Right() { return this.right; }
}

function classifyInsidePosition(pos) {
  if (pos === null || pos === undefined) return null;
  if (typeof pos === "number") {
    if (pos >= 13 && pos <= 15) return "top";
    if (pos === 16) return "left";
    if (pos === 18) return "right";
    if (pos >= 19 && pos <= 21) return "bottom";
    return null;
  }
  if (typeof pos === "string") {
    const s = pos.toUpperCase();
    if (s === "INSIDE_TOP_LEFT" || s === "INSIDE_TOP_CENTER" || s === "INSIDE_TOP_RIGHT") return "top";
    if (s === "INSIDE_BOTTOM_LEFT" || s === "INSIDE_BOTTOM_CENTER" || s === "INSIDE_BOTTOM_RIGHT") return "bottom";
    if (s === "INSIDE_MIDDLE_LEFT") return "left";
    if (s === "INSIDE_MIDDLE_RIGHT") return "right";
  }
  return null;
}

export function newGraph() {
  return new Graph();
}
