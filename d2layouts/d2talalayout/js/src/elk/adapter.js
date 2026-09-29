import { Graph } from "../graph/graph.js";
import { Node } from "../graph/node.js";
import { Edge } from "../graph/edge.js";
import { Point } from "../geometry/point.js";
import { allocateD2EntityIDs } from "../graph/entity-id.js";

/**
 * elkToTalaGraph converts an ELK JSON payload into a TALA structural Graph model.
 * It allocates stable EntityIDs and maps ELK's relative coordinates into absolute coordinates.
 */
export function elkToTalaGraph(elkGraph) {
  if (!elkGraph || typeof elkGraph !== 'object') {
    throw new Error("Invalid ELK graph: must be an object");
  }

  if (typeof elkGraph.id !== 'string') {
    throw new Error("Invalid ELK graph: missing id");
  }

  const graph = new Graph();
  graph.ID = elkGraph.id;
  graph.elkData = structuredClone(elkGraph);

  const seenEdgeIds = new Set();
  const seenNodeIds = new Set();
  const endpoints = graph.endpoints;

  const nodeIdentities = [];
  const edgeIdentities = [];
  const elkNodes = [];
  const elkEdges = [];

  function validateArray(arr, name, context) {
    if (arr !== undefined && !Array.isArray(arr)) {
      throw new Error(`Invalid ELK graph: ${name} must be an array on ${context}`);
    }
    return arr || [];
  }

  // Pass 1: Collect nodes and edges to allocate IDs
  function collectNodesAndEdges(elkNode) {
    if (typeof elkNode.id !== 'string' || elkNode.id === '') {
      throw new Error("Invalid ELK node: missing id");
    }

    if (seenNodeIds.has(elkNode.id)) {
      throw new Error(`Invalid ELK graph: duplicate node id "${elkNode.id}"`);
    }
    seenNodeIds.add(elkNode.id);

    // D2/TALA usually uses absolute ID matching, but here ELK id is absID
    nodeIdentities.push({ entity: elkNode, absID: elkNode.id });
    elkNodes.push(elkNode);

    const edges = validateArray(elkNode.edges, "edges", `node "${elkNode.id}"`);
    for (const edge of edges) {
      if (typeof edge.id !== 'string' || edge.id === '') throw new Error("Invalid ELK edge: missing id");
      if (seenEdgeIds.has(edge.id)) throw new Error(`Invalid ELK graph: duplicate edge id "${edge.id}"`);
      seenEdgeIds.add(edge.id);

      edgeIdentities.push({ entity: edge, absID: edge.id });
      elkEdges.push(edge);
    }

    const children = validateArray(elkNode.children, "children", `node "${elkNode.id}"`);
    for (const child of children) {
      collectNodesAndEdges(child);
    }
  }

  const rootChildren = validateArray(elkGraph.children, "children", "root graph");
  for (const child of rootChildren) {
    collectNodesAndEdges(child);
  }
  
  // Also collect root edges
  const rootEdges = validateArray(elkGraph.edges, "edges", "root graph");
  for (const edge of rootEdges) {
    if (typeof edge.id !== 'string' || edge.id === '') throw new Error("Invalid ELK edge: missing id");
    if (seenEdgeIds.has(edge.id)) throw new Error(`Invalid ELK graph: duplicate edge id "${edge.id}"`);
    seenEdgeIds.add(edge.id);

    edgeIdentities.push({ entity: edge, absID: edge.id });
    elkEdges.push(edge);
  }

  const nodeIDs = allocateD2EntityIDs(nodeIdentities);
  const edgeIDs = allocateD2EntityIDs(edgeIdentities);

  // Pass 2: Build hierarchy and compute absolute coordinates
  const elkToNode = new Map();

  function registerEndpoint(id, entity) {
    if (endpoints.has(id)) {
      throw new Error(`Invalid ELK graph: duplicate endpoint id "${id}"`);
    }
    endpoints.set(id, entity);
  }

  function visitNode(elkNode, containerNode, absX, absY) {
    const node = new Node(nodeIDs.get(elkNode), elkNode.width ?? 0, elkNode.height ?? 0);
    node.D2ID = elkNode.id;
    node.elkData = structuredClone(elkNode);
    
    // Convert relative ELK coordinates to absolute TopLeft
    const x = absX + (elkNode.x ?? 0);
    const y = absY + (elkNode.y ?? 0);
    node.TopLeft = new Point(x, y);

    elkToNode.set(elkNode.id, node);
    graph.addNewNodeToContainer(containerNode, node);
    graph.nodesByExternalId.set(node.D2ID, node);
    graph.nodesByEntityId.set(node.ID, node);

    registerEndpoint(node.D2ID, { kind: "node", node });
    
    const ports = validateArray(elkNode.ports, "ports", `node "${node.D2ID}"`);
    for (const port of ports) {
      if (typeof port.id !== 'string' || port.id === '') {
        throw new Error(`Invalid ELK port: missing id on node "${node.D2ID}"`);
      }
      registerEndpoint(port.id, { kind: "port", node, port: structuredClone(port) });
    }

    const children = validateArray(elkNode.children, "children", `node "${node.D2ID}"`);
    for (const child of children) {
      visitNode(child, node, x, y);
    }
  }

  for (const child of rootChildren) {
    visitNode(child, null, 0, 0);
  }

  // Pass 3: Build edges
  for (const elkEdge of elkEdges) {
    const sources = validateArray(elkEdge.sources, "sources", `edge "${elkEdge.id}"`);
    const targets = validateArray(elkEdge.targets, "targets", `edge "${elkEdge.id}"`);
    
    if (sources.length !== 1) throw new Error(`ELK hyperedges are not supported yet: edge "${elkEdge.id}" has ${sources.length} sources`);
    if (targets.length !== 1) throw new Error(`ELK hyperedges are not supported yet: edge "${elkEdge.id}" has ${targets.length} targets`);

    const sourceEndpointId = sources[0];
    const targetEndpointId = targets[0];

    if (typeof sourceEndpointId !== 'string') {
      throw new Error(`Invalid ELK edge "${elkEdge.id}": source endpoint must be a string`);
    }
    if (typeof targetEndpointId !== 'string') {
      throw new Error(`Invalid ELK edge "${elkEdge.id}": target endpoint must be a string`);
    }

    const sourceEndpoint = endpoints.get(sourceEndpointId);
    if (!sourceEndpoint) throw new Error(`Invalid ELK edge "${elkEdge.id}": source endpoint "${sourceEndpointId}" does not exist`);

    const targetEndpoint = endpoints.get(targetEndpointId);
    if (!targetEndpoint) throw new Error(`Invalid ELK edge "${elkEdge.id}": target endpoint "${targetEndpointId}" does not exist`);

    const edge = graph.connect(sourceEndpoint.node, targetEndpoint.node);
    edge.ID = edgeIDs.get(elkEdge);
    edge.D2ID = elkEdge.id;
    edge.sourceEndpointId = sourceEndpointId;
    edge.targetEndpointId = targetEndpointId;
    edge.elkData = structuredClone(elkEdge);
    edge.route = structuredClone(elkEdge.sections ?? []);
    
    graph.edgesByExternalId.set(edge.D2ID, edge);
    graph.edgesByEntityId.set(edge.ID, edge);
  }

  return graph;
}

export function talaToElkGraph(graph) {
  const output = structuredClone(graph.elkData);
  
  // We need a fast lookup by D2ID, use graph indexes

  function reconstructNode(elkRef, absX, absY) {
    const node = graph.nodesByExternalId.get(elkRef.id);
    if (node) {
      elkRef.width = node.Width;
      elkRef.height = node.Height;
      // Revert absolute to relative
      elkRef.x = node.TopLeft ? node.TopLeft.X - absX : 0;
      elkRef.y = node.TopLeft ? node.TopLeft.Y - absY : 0;
      
      const nextAbsX = absX + elkRef.x;
      const nextAbsY = absY + elkRef.y;
      
      if (elkRef.children) {
        for (const elkChild of elkRef.children) {
          reconstructNode(elkChild, nextAbsX, nextAbsY);
        }
      }
    }
  }

  if (output.children) {
    for (const elkChild of output.children) {
      reconstructNode(elkChild, 0, 0);
    }
  }

  function updateEdges(elkNode) {
    if (elkNode.edges) {
      for (const elkEdge of elkNode.edges) {
        const edge = graph.edgesByExternalId.get(elkEdge.id);
        if (edge && edge.route && edge.route.length > 0) {
          elkEdge.sections = structuredClone(edge.route);
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
