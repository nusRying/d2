import { Graph } from "./graph.js";
import { Node } from "./node.js";
import { Edge } from "./edge.js";

export function cloneGraph(graph) {
  const newGraph = new Graph(graph.id);
  newGraph.elkData = structuredClone(graph.elkData);

  function cloneNode(node, parentNode) {
    const newNode = new Node({
      id: node.id,
      width: node.width,
      height: node.height,
      x: node.x,
      y: node.y,
      parent: parentNode
    });
    newNode.elkData = structuredClone(node.elkData);
    newGraph.nodes.set(newNode.id, newNode);

    if (parentNode) {
      parentNode.children.push(newNode);
    } else {
      newGraph.rootNodes.push(newNode);
    }

    for (const child of node.children) {
      cloneNode(child, newNode);
    }
  }

  for (const root of graph.rootNodes) {
    cloneNode(root, null);
  }

  for (const edge of graph.edges.values()) {
    const newEdge = new Edge({
      id: edge.id,
      source: edge.source,
      target: edge.target
    });
    newEdge.elkData = structuredClone(edge.elkData);
    newEdge.route = structuredClone(edge.route);
    newGraph.edges.set(newEdge.id, newEdge);
  }

  // Restore edge linkages
  for (const edge of newGraph.edges.values()) {
    const sourceNode = newGraph.nodes.get(edge.source);
    const targetNode = newGraph.nodes.get(edge.target);
    if (sourceNode) sourceNode.outEdges.push(edge.id);
    if (targetNode) targetNode.inEdges.push(edge.id);
  }

  return newGraph;
}
