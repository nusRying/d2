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

  for (const [id, endpoint] of graph.endpoints.entries()) {
    if (endpoint.kind === "node") {
      newGraph.endpoints.set(id, { kind: "node", node: newGraph.nodes.get(endpoint.node.id) });
    } else {
      newGraph.endpoints.set(id, { kind: "port", node: newGraph.nodes.get(endpoint.node.id), port: structuredClone(endpoint.port) });
    }
  }

  for (const edge of graph.edges.values()) {
    const fromNode = newGraph.nodes.get(edge.from.id);
    const toNode = newGraph.nodes.get(edge.to.id);

    const newEdge = new Edge({
      id: edge.id,
      from: fromNode,
      to: toNode,
      sourceEndpointId: edge.sourceEndpointId,
      targetEndpointId: edge.targetEndpointId
    });
    newEdge.elkData = structuredClone(edge.elkData);
    newEdge.route = structuredClone(edge.route);
    newGraph.edges.set(newEdge.id, newEdge);

    fromNode.edges.push(newEdge);
    if (fromNode !== toNode) {
      toNode.edges.push(newEdge);
    }
  }

  return newGraph;
}
