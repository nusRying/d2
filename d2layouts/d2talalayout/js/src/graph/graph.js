import { Node } from './node.js';
import { Edge } from './edge.js';

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
  }

  addNodeUnchecked(node) {
    this.Nodes.push(node);
    node.Graph = this;
  }

  addNewNodeToContainer(container, node) {
    node.Graph = this;
    node.Container = container;
    this.Nodes.push(node);

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

  connect(from, to) {
    const edge = new Edge(from, to);
    this.Edges.push(edge);
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
}

export function newGraph() {
  return new Graph();
}
