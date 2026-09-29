import { Graph } from "./graph.js";
import { Node } from "./node.js";
import { Edge } from "./edge.js";
import { Point } from "../geometry/point.js";

// copyValue clones an embedded value if present, specifically geo primitives
function copyValue(val) {
  if (val === null || val === undefined) return val;
  if (val instanceof Point) return val.copy();
  if (typeof val === 'object' && val.copy) return val.copy();
  if (Array.isArray(val)) {
    return val.map(copyValue);
  }
  return structuredClone(val);
}

export function cloneGraph(source) {
  if (!source) throw new Error("cannot clone a nil graph");

  const cloned = new Graph();
  cloned.ID = source.ID;
  cloned.CellSize = source.CellSize;
  cloned.IsRootHierarchy = source.IsRootHierarchy;
  cloned.elkData = structuredClone(source.elkData);


  const nodesByID = new Map();
  const nodesBySource = new Map();

  // Helper to copy a Node record
  function addNodeRecord(srcNode) {
    if (srcNode.ID === 0n) throw new Error("cannot clone reserved node ID 0");
    if (nodesByID.has(srcNode.ID)) throw new Error(`cannot clone duplicate node ID ${srcNode.ID}`);
    
    const node = new Node(srcNode.ID, srcNode.Width, srcNode.Height);
    node.D2ID = srcNode.D2ID;
    node.TopLeft = copyValue(srcNode.TopLeft);
    node.FixedTopLeft = copyValue(srcNode.FixedTopLeft);
    node.DesiredWidth = srcNode.DesiredWidth;
    node.DesiredHeight = srcNode.DesiredHeight;
    node.Graph = cloned;
    node.FontSize = srcNode.FontSize;
    node.Label = copyValue(srcNode.Label);
    node.Icon = copyValue(srcNode.Icon);
    node.ForceHierarchy = srcNode.ForceHierarchy;
    node.Is3D = srcNode.Is3D;
    node.IsMultiple = srcNode.IsMultiple;
    node.IsInvisible = srcNode.IsInvisible;
    node.setShape(srcNode.shapeType());
    node.setNumColumns(srcNode.numColumns());
    node.elkData = structuredClone(srcNode.elkData);

    nodesByID.set(srcNode.ID, node);
    nodesBySource.set(srcNode, node);
    return node;
  }

  // 1. Copy Nodes
  for (const node of source.Nodes) {
    addNodeRecord(node);
  }

  function resolveNode(srcNode) {
    if (!srcNode) return null;
    const resolved = nodesByID.get(srcNode.ID);
    if (!resolved) throw new Error(`node ${srcNode.ID} is not included in the graph`);
    return resolved;
  }

  // 2. Copy Edges
  const edgesByID = new Map();
  const edgesBySource = new Map();
  for (const edge of source.Edges) {
    if (edge === null || edge === undefined) {
      throw new Error("cannot clone a nil edge");
    }
    if (edgesBySource.has(edge)) {
      throw new Error(`cannot clone duplicate edge record ${edge.ID}`);
    }
    if (edge.ID !== 0n) {
      if (edgesByID.has(edge.ID)) {
        throw new Error(`cannot clone duplicate edge ID ${edge.ID}`);
      }
    }

    const from = resolveNode(edge.From);
    const to = resolveNode(edge.To);
    
    const clonedEdge = new Edge(from, to);
    clonedEdge.ID = edge.ID;
    clonedEdge.D2ID = edge.D2ID;
    clonedEdge.MinWidth = edge.MinWidth;
    clonedEdge.MinHeight = edge.MinHeight;
    clonedEdge.SourceArrowhead = edge.SourceArrowhead;
    clonedEdge.TargetArrowhead = edge.TargetArrowhead;
    clonedEdge.SourceArrowheadLabel = copyValue(edge.SourceArrowheadLabel);
    clonedEdge.TargetArrowheadLabel = copyValue(edge.TargetArrowheadLabel);
    clonedEdge.Label = copyValue(edge.Label);
    clonedEdge.LabelPercentage = edge.LabelPercentage;
    clonedEdge.FromTableColumnIndex = edge.FromTableColumnIndex;
    clonedEdge.ToTableColumnIndex = edge.ToTableColumnIndex;
    clonedEdge.IsInvisible = edge.IsInvisible;
    clonedEdge.Style = copyValue(edge.Style);
    
    clonedEdge.sourceEndpointId = edge.sourceEndpointId;
    clonedEdge.targetEndpointId = edge.targetEndpointId;
    clonedEdge.route = structuredClone(edge.route);
    clonedEdge.elkData = structuredClone(edge.elkData);
    
    for (const pt of edge.Points) {
      clonedEdge.Points.push(pt.copy());
    }

    edgesBySource.set(edge, clonedEdge);
    if (edge.ID !== 0n) {
      edgesByID.set(edge.ID, clonedEdge);
    }
    cloned.Edges.push(clonedEdge);

    clonedEdge.From.addEdge(clonedEdge);
    if (!clonedEdge.isLoop()) {
      clonedEdge.To.addEdge(clonedEdge);
    }
  }

  // 3. Copy Containers using RDFS from null (matches Go's copyContainers traversal).
  // Containers not reachable from Containers[null] are intentionally not propagated,
  // preserving parity with Go's containerRDFSOrderContext behavior.
  if (source.Containers.size > 0) {
    function containerRDFSOrder(root) {
      const order = [];
      const rootChildren = [...(source.Containers.get(root) || [])].reverse();
      for (const child of rootChildren) {
        if (child.isContainer) {
          order.push(...containerRDFSOrder(child));
          order.push(child);
        }
      }
      return order;
    }

    const rdfsOrder = containerRDFSOrder(null);
    if (source.Containers.size !== rdfsOrder.length + 1) {
      throw new Error("unreachable containers exist in source");
    }
    rdfsOrder.push(null); // null appended last, like Go appends nil

    cloned.Containers = new Map();
    for (const srcContainer of rdfsOrder) {
      const container = srcContainer ? resolveNode(srcContainer) : null;
      const srcChildren = source.Containers.get(srcContainer) || [];
      const clonedChildren = [];
      for (const child of srcChildren) {
        const clonedChild = resolveNode(child);
        clonedChild.Container = container;
        clonedChildren.push(clonedChild);
      }
      cloned.Containers.set(container, clonedChildren);
      if (container !== null) {
        container.isContainer = true;
      }
    }
  }

  // 4. Copy Nears
  for (const srcNode of source.Nodes) {
    const node = nodesBySource.get(srcNode);
    for (const srcNear of srcNode.orderedNears()) {
      node.addNear(resolveNode(srcNear));
    }
  }

  // Set Top-level Nodes
  for (const srcNode of source.Nodes) {
    const node = nodesBySource.get(srcNode);
    if (node.Cluster && node.Cluster.isActive && node.Cluster.isActive()) continue;
    if (node.Sequence && node.Sequence.isActive && node.Sequence.isActive()) continue;
    cloned.Nodes.push(node);
  }

  // 5. Copy Indexes and Directions
  for (const [k, v] of source.Directions.entries()) {
    if (k === null) {
      cloned.Directions.set(null, v);
    } else {
      cloned.Directions.set(resolveNode(k), v);
    }
  }

  for (const [k, v] of source.nodesByExternalId.entries()) {
    cloned.nodesByExternalId.set(k, resolveNode(v));
  }
  for (const [k, v] of source.edgesByExternalId.entries()) {
    cloned.edgesByExternalId.set(k, edgesBySource.get(v));
  }
  for (const [k, v] of source.nodesByEntityId.entries()) {
    cloned.nodesByEntityId.set(k, resolveNode(v));
  }
  for (const [k, v] of source.edgesByEntityId.entries()) {
    cloned.edgesByEntityId.set(k, edgesBySource.get(v));
  }

  for (const [k, v] of source.endpoints.entries()) {
    if (v.kind === "node") {
      cloned.endpoints.set(k, {
        kind: "node",
        node: resolveNode(v.node)
      });
    } else if (v.kind === "port") {
      cloned.endpoints.set(k, {
        kind: "port",
        node: resolveNode(v.node),
        port: structuredClone(v.port)
      });
    }
  }

  return cloned;
}
