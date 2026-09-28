import { Graph } from "../graph/graph.js";
import { Node } from "../graph/node.js";
import { Edge } from "../graph/edge.js";

export function elkToTalaGraph(elkGraph) {
  if (!elkGraph || typeof elkGraph !== 'object') {
    throw new Error("Invalid ELK graph: must be an object");
  }

  if (typeof elkGraph.id !== 'string') {
    throw new Error("Invalid ELK graph: missing id");
  }

  const graph = new Graph(elkGraph.id);
  graph.elkData = structuredClone(elkGraph);

  const endpoints = new Map();
  const seenEdgeIds = new Set();
  const seenNodeIds = new Set();

  function registerEndpoint(id, entity) {
    if (endpoints.has(id)) {
      throw new Error(`Invalid ELK graph: duplicate endpoint id "${id}"`);
    }
    endpoints.set(id, entity);
  }

  function validateArray(arr, name, context) {
    if (arr !== undefined && !Array.isArray(arr)) {
      throw new Error(`Invalid ELK graph: ${name} must be an array on ${context}`);
    }
    return arr || [];
  }

  function visitNode(elkNode, parent) {
    if (typeof elkNode.id !== 'string' || elkNode.id === '') {
      throw new Error("Invalid ELK node: missing id");
    }

    if (seenNodeIds.has(elkNode.id)) {
      throw new Error(`Invalid ELK graph: duplicate node id "${elkNode.id}"`);
    }
    seenNodeIds.add(elkNode.id);

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

    registerEndpoint(node.id, { kind: "node", node });

    const ports = validateArray(elkNode.ports, "ports", `node "${node.id}"`);
    for (const port of ports) {
      if (typeof port.id !== 'string' || port.id === '') {
        throw new Error(`Invalid ELK port: missing id on node "${node.id}"`);
      }
      registerEndpoint(port.id, { kind: "port", node, port });
    }

    if (parent) {
      parent.children.push(node);
    } else {
      graph.rootNodes.push(node);
    }

    const children = validateArray(elkNode.children, "children", `node "${node.id}"`);
    for (const child of children) {
      visitNode(child, node);
    }

    return node;
  }

  const children = validateArray(elkGraph.children, "children", "root graph");
  for (const child of children) {
    visitNode(child, null);
  }

  function collectEdges(elkNode) {
    const edges = validateArray(elkNode.edges, "edges", elkNode.id ? `node "${elkNode.id}"` : "root graph");
    for (const edge of edges) {
      if (typeof edge.id !== 'string' || edge.id === '') throw new Error("Invalid ELK edge: missing id");
      if (seenEdgeIds.has(edge.id)) throw new Error(`Invalid ELK graph: duplicate edge id "${edge.id}"`);
      seenEdgeIds.add(edge.id);

      const sources = validateArray(edge.sources, "sources", `edge "${edge.id}"`);
      const targets = validateArray(edge.targets, "targets", `edge "${edge.id}"`);
      
      if (sources.length !== 1) {
        throw new Error(`ELK hyperedges are not supported yet: edge "${edge.id}" has ${sources.length} sources`);
      }
      if (targets.length !== 1) {
        throw new Error(`ELK hyperedges are not supported yet: edge "${edge.id}" has ${targets.length} targets`);
      }

      const sourceEndpointId = sources[0];
      const targetEndpointId = targets[0];

      const sourceEndpoint = endpoints.get(sourceEndpointId);
      if (!sourceEndpoint) {
        throw new Error(`Invalid ELK edge "${edge.id}": source endpoint "${sourceEndpointId}" does not exist`);
      }

      const targetEndpoint = endpoints.get(targetEndpointId);
      if (!targetEndpoint) {
        throw new Error(`Invalid ELK edge "${edge.id}": target endpoint "${targetEndpointId}" does not exist`);
      }

      const fromNode = sourceEndpoint.node;
      const toNode = targetEndpoint.node;

      const newEdge = new Edge({
        id: edge.id,
        from: fromNode,
        to: toNode,
        sourceEndpointId,
        targetEndpointId
      });
      newEdge.elkData = structuredClone(edge);
      graph.edges.set(newEdge.id, newEdge);

      fromNode.edges.push(newEdge);
      if (fromNode !== toNode) {
        toNode.edges.push(newEdge);
      }
    }
    const children = validateArray(elkNode.children, "children", elkNode.id ? `node "${elkNode.id}"` : "root graph");
    for (const child of children) {
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
