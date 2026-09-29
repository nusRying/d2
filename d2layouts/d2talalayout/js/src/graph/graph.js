import { Node } from './node.js';
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

    if (container !== null) {
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
    this.Edges.push(edge);
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

  disconnect(edge) {
    if (!edge) return;
    
    if (edge.From) edge.From.removeEdge(edge);
    if (edge.To && !edge.isLoop()) edge.To.removeEdge(edge);

    const idx = this.Edges.indexOf(edge);
    if (idx !== -1) {
      this.Edges.splice(idx, 1);
    }
  }

  direction(container) {
    return this.Directions.has(container) ? this.Directions.get(container) : Orientation.NONE;
  }

  computeCellSize() {
    let minWidth = Number.POSITIVE_INFINITY;
    let minHeight = Number.POSITIVE_INFINITY;
    let maxWidth = 0;
    let maxHeight = 0;

    let hasNodes = false;
    for (const n of this.Nodes) {
      hasNodes = true;
      if (n.Width < minWidth) minWidth = n.Width;
      if (n.Height < minHeight) minHeight = n.Height;
      if (n.Width > maxWidth) maxWidth = n.Width;
      if (n.Height > maxHeight) maxHeight = n.Height;
    }

    if (!hasNodes) {
      this.CellSize = 10;
      return;
    }

    const minLength = Math.min(minWidth, minHeight);
    const maxLength = Math.max(maxWidth, maxHeight);

    if (maxLength < 3 * minLength) {
      this.CellSize = Math.ceil(maxLength);
    } else {
      this.CellSize = Math.ceil((3 * minLength) / 2);
    }
    
    if (this.CellSize < 10) {
      this.CellSize = 10;
    }
  }
}

export function newGraph() {
  return new Graph();
}
