import { Graph } from "../graph/graph.js";
import { Node } from "../graph/node.js";
import { Edge } from "../graph/edge.js";

export function elkToTalaGraph(elkGraph) {
  if (!elkGraph || typeof elkGraph !== 'object') {
    throw new Error("Invalid ELK graph: must be an object");
  }

  if (!elkGraph.id) {
    throw new Error("Invalid ELK graph: missing id");
  }

  const graph = new Graph(elkGraph.id);
  graph.elkData = structuredClone(elkGraph);

  function visitNode(elkNode, parent) {
    if (!elkNode.id) {
      throw new Error("Invalid ELK node: missing id");
    }

    const node = new Node({
      id: elkNode.id,
      width: elkNode.width ?? 0,
      height: elkNode.height ?? 0,
      x: elkNode.x ?? 0,
      y: elkNode.y ?? 0,
      parent
    });

    node.elkData = structuredClone(elkNode);
    graph.nodes.set(node.id, node);

    if (parent) {
      parent.children.push(node);
    } else {
      graph.rootNodes.push(node);
    }

    for (const child of elkNode.children ?? []) {
      visitNode(child, node);
    }

    return node;
  }

  for (const child of elkGraph.children ?? []) {
    visitNode(child, null);
  }

  function collectEdges(elkNode) {
    for (const edge of elkNode.edges ?? []) {
      if (!edge.id) throw new Error("Invalid ELK edge: missing id");
      if (!edge.sources || edge.sources.length === 0) throw new Error("Invalid ELK edge: missing sources");
      if (!edge.targets || edge.targets.length === 0) throw new Error("Invalid ELK edge: missing targets");

      const newEdge = new Edge({
        id: edge.id,
        source: edge.sources[0],
        target: edge.targets[0]
      });
      newEdge.elkData = structuredClone(edge);
      graph.edges.set(newEdge.id, newEdge);

      const sourceNode = graph.nodes.get(newEdge.source);
      const targetNode = graph.nodes.get(newEdge.target);

      if (sourceNode) sourceNode.outEdges.push(newEdge.id);
      if (targetNode) targetNode.inEdges.push(newEdge.id);
    }
    for (const child of elkNode.children ?? []) {
      collectEdges(child);
    }
  }

  collectEdges(elkGraph);

  return graph;
}

export function talaToElkGraph(graph) {
  const output = structuredClone(graph.elkData);

  function reconstructNode(node, elkRef) {
    elkRef.x = node.x;
    elkRef.y = node.y;
    elkRef.width = node.width;
    elkRef.height = node.height;

    if (elkRef.children) {
      for (const elkChild of elkRef.children) {
        const childNode = graph.nodes.get(elkChild.id);
        if (childNode) {
          reconstructNode(childNode, elkChild);
        }
      }
    }
  }

  if (output.children) {
    for (const elkChild of output.children) {
      const childNode = graph.nodes.get(elkChild.id);
      if (childNode) {
        reconstructNode(childNode, elkChild);
      }
    }
  }

  function updateEdges(elkNode) {
    if (elkNode.edges) {
      for (const elkEdge of elkNode.edges) {
        const edge = graph.edges.get(elkEdge.id);
        if (edge && edge.route && edge.route.length > 0) {
          elkEdge.sections = edge.route;
        }
      }
    }
    if (elkNode.children) {
      for (const elkChild of elkNode.children) {
        updateEdges(elkChild);
      }
    }
  }

  updateEdges(output);

  return output;
}
