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
  for (const edge of source.Edges) {
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
    
    for (const pt of edge.Points) {
      clonedEdge.Points.push(pt.copy());
    }

    edgesByID.set(edge.ID, clonedEdge);
    cloned.Edges.push(clonedEdge);

    clonedEdge.From.addEdge(clonedEdge);
    if (!clonedEdge.isLoop()) {
      clonedEdge.To.addEdge(clonedEdge);
    }
  }

  // 3. Copy Containers
  for (const [container, children] of source.Containers.entries()) {
    const clonedContainer = resolveNode(container);
    const clonedChildren = [];
    for (const child of children) {
      const clonedChild = resolveNode(child);
      clonedChild.Container = clonedContainer;
      clonedChildren.push(clonedChild);
    }
    cloned.Containers.set(clonedContainer, clonedChildren);
    if (clonedContainer) {
      clonedContainer.isContainer = true;
    }
  }

  // 4. Copy Nears
  for (const srcNode of source.Nodes) {
    const node = nodesBySource.get(srcNode);
    for (const srcNear of srcNode.orderedNears()) {
      node.addNear(resolveNode(srcNear));
    }
  }

  // Set Top-level Nodes (only nodes that aren't inside clusters/sequences)
  // For Slice 04 we don't have full Cluster/Sequence implementations but we filter them.
  for (const srcNode of source.Nodes) {
    const node = nodesBySource.get(srcNode);
    if (node.Cluster && node.Cluster.isActive && node.Cluster.isActive()) continue;
    if (node.Sequence && node.Sequence.isActive && node.Sequence.isActive()) continue;
    cloned.Nodes.push(node);
  }

  return cloned;
}
