import { Node, sortNodesByID } from './node.js';
import { Edge } from './edge.js';
import { Orientation } from '../geometry/orientation.js';

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

  addNodeUnchecked(node) {
    this.Nodes.push(node);
    node.Graph = this;
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

  removeNode(node) {
    const idx = this.Nodes.indexOf(node);
    if (idx !== -1) {
      this.Nodes.splice(idx, 1);
    }
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
        order.push(...this.containerRDFSOrder(child));
        order.push(child);
        continue;
      }

      if (child.isClusterVessel) {
        const cluster = this.Clusters.get(child);
        if (cluster && cluster.Nodes) {
          for (let j = cluster.Nodes.length - 1; j >= 0; j--) {
            const cNode = cluster.Nodes[j];
            if (cNode.isContainer) {
              order.push(...this.containerRDFSOrder(cNode));
              order.push(cNode);
            }
          }
        }
        continue;
      }
    }

    return order;
  }

  ContainerRDFSOrder(root = null) {
    return this.containerRDFSOrder(root);
  }

  clusterRDFSOrder() {
    const order = [];
    const dfsContainerOrder = [...this.containerRDFSOrder(null), null];
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
}

export function newGraph() {
  return new Graph();
}
