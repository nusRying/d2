import { Node, sortNodesByID } from './node.js';
import { Edge } from './edge.js';
import { Orientation } from '../geometry/orientation.js';
import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { nodesFixedBounds, nodesUnroundedFixedBounds } from './node-bounds.js';
import { isOutsideLabelPosition } from './label-position.js';

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
