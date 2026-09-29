import { Graph } from "./graph.js";
import { Node } from "./node.js";
import { Edge } from "./edge.js";
import { Point } from "../geometry/point.js";
import { Cluster } from "./cluster.js";
import { Sequence } from "./sequence.js";
import { Tree } from "./tree.js";
import { EdgeAbduction } from "./edge-abduction.js";

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
    node.Graph = srcNode.Graph === null ? null : cloned;
    node.FontSize = srcNode.FontSize;
    node.Label = copyValue(srcNode.Label);
    node.Icon = copyValue(srcNode.Icon);
    node.ForceHierarchy = srcNode.ForceHierarchy;
    node.Is3D = srcNode.Is3D;
    node.IsMultiple = srcNode.IsMultiple;
    node.IsInvisible = srcNode.IsInvisible;
    node.isClusterVessel = srcNode.isClusterVessel;
    node.setShape(srcNode.shapeType());
    node.setNumColumns(srcNode.numColumns());
    node.elkData = structuredClone(srcNode.elkData);

    nodesByID.set(srcNode.ID, node);
    nodesBySource.set(srcNode, node);
    return node;
  }

  // copyAuxiliaryNodeRecord copies a node record embedded in another graph record,
  // such as a grouping vessel or tree node.
  function copyAuxiliaryNodeRecord(srcNode, relation) {
    if (!srcNode) {
      throw new Error(`cannot clone ${relation}: nil node`);
    }
    if (srcNode.ID === 0n) {
      throw new Error(`cannot clone ${relation}: reserved node ID 0`);
    }
    if (nodesByID.has(srcNode.ID)) {
      return nodesByID.get(srcNode.ID);
    }

    const clonedNode = addNodeRecord(srcNode);
    if (srcNode.Graph === null) {
      clonedNode.Graph = null;
    }
    return clonedNode;
  }

  function resolveNode(srcNode, relation = "node") {
    if (!srcNode) return null;
    if (nodesByID.has(srcNode.ID)) {
      return nodesByID.get(srcNode.ID);
    }
    return copyAuxiliaryNodeRecord(srcNode, relation);
  }

  // 1. Copy Nodes in source.Nodes
  for (const node of source.Nodes) {
    const clonedNode = addNodeRecord(node);
    cloned.Nodes.push(clonedNode);
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

    const from = resolveNode(edge.From, "edge source");
    const to = resolveNode(edge.To, "edge target");
    
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

  // 3. Copy Containers using RDFS from null
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
      const container = srcContainer ? resolveNode(srcContainer, "container") : null;
      const srcChildren = source.Containers.get(srcContainer) || [];
      const clonedChildren = [];
      for (const child of srcChildren) {
        const clonedChild = resolveNode(child, "container child");
        clonedChild.Container = container;
        clonedChildren.push(clonedChild);
      }
      cloned.Containers.set(container, clonedChildren);
      if (container !== null) {
        container.isContainer = true;
      }
    }
  }

  // Helper to copy EdgeAbductions
  function copyEdgeAbduction(sourceAbduction) {
    if (!sourceAbduction) return null;
    let edge = null;
    if (sourceAbduction.Edge != null) {
      edge = edgesBySource.get(sourceAbduction.Edge);
      if (!edge) {
        throw new Error(`cannot resolve edge abduction edge ${sourceAbduction.Edge.ID}`);
      }
    }
    const originallyFrom = resolveNode(sourceAbduction.OriginallyFrom, "abduction original source");
    const originallyTo = resolveNode(sourceAbduction.OriginallyTo, "abduction original target");
    const currentFrom = resolveNode(sourceAbduction.CurrentFrom, "abduction current source");
    const currentTo = resolveNode(sourceAbduction.CurrentTo, "abduction current target");

    return new EdgeAbduction({
      Edge: edge,
      OriginallyFrom: originallyFrom,
      OriginallyTo: originallyTo,
      CurrentFrom: currentFrom,
      CurrentTo: currentTo,
    });
  }

  // 4. Copy Clusters
  for (const sourceVessel of source.clusterOrder()) {
    const sourceCluster = source.Clusters.get(sourceVessel);
    if (!sourceCluster) continue;

    const vessel = copyAuxiliaryNodeRecord(sourceVessel, "cluster vessel");
    if (sourceVessel.Graph === null) {
      vessel.Graph = null;
    }
    vessel.isClusterVessel = sourceVessel.isClusterVessel;

    const container = resolveNode(sourceCluster.Container, "cluster container");
    const members = (sourceCluster.Nodes || []).map(m => resolveNode(m, "cluster member"));
    const abductions = (sourceCluster.EdgeAbductions || []).map(copyEdgeAbduction);

    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: members,
      Arrangement: sourceCluster.Arrangement,
      DesiredArrangement: sourceCluster.DesiredArrangement,
      Graph: sourceCluster.Graph ? cloned : null,
      EdgeAbductions: abductions,
      Padding: copyValue(sourceCluster.Padding),
      FixedSize: sourceCluster.FixedSize,
      Container: container,
    });

    cloned.Clusters.set(vessel, cluster);
    for (const member of members) {
      if (member) member.Cluster = cluster;
    }
  }

  // 5. Copy Sequences
  for (const sourceVessel of source.sequenceOrder()) {
    const sourceSequence = source.Sequences.get(sourceVessel);
    if (!sourceSequence) continue;

    const vessel = copyAuxiliaryNodeRecord(sourceVessel, "sequence vessel");
    if (sourceVessel.Graph === null) {
      vessel.Graph = null;
    }

    const container = resolveNode(sourceSequence.Container, "sequence container");
    const members = (sourceSequence.Nodes || []).map(m => resolveNode(m, "sequence member"));
    const abductions = (sourceSequence.EdgeAbductions || []).map(copyEdgeAbduction);

    const sequence = new Sequence({
      Vessel: vessel,
      Nodes: members,
      Graph: sourceSequence.Graph ? cloned : null,
      EdgeAbductions: abductions,
      Container: container,
    });

    cloned.Sequences.set(vessel, sequence);
    for (const member of members) {
      if (member) member.Sequence = sequence;
    }
  }

  // 6. Copy Trees
  function copyTree(sourceTree, parent = null) {
    if (!sourceTree) return null;
    const node = copyAuxiliaryNodeRecord(sourceTree.Node, "tree node");
    let sentinelEdge = null;
    if (sourceTree.SentinelEdge != null) {
      sentinelEdge = edgesBySource.get(sourceTree.SentinelEdge);
      if (!sentinelEdge) {
        throw new Error(`cannot resolve tree sentinel edge ${sourceTree.SentinelEdge.ID}`);
      }
    }

    const tree = new Tree(node);
    tree.Parent = parent;
    tree.SentinelEdge = sentinelEdge;
    tree.Orientation = sourceTree.Orientation;

    cloned.NodeToTree.set(node, tree);

    for (const sourceChild of sourceTree.Children) {
      const child = copyTree(sourceChild, tree);
      tree.Children.push(child);
    }
    return tree;
  }

  for (const sourceSentinel of source.treeOrder()) {
    const sourceRoots = source.Trees.get(sourceSentinel);
    if (!sourceRoots) continue;
    const sentinel = resolveNode(sourceSentinel, "tree root sentinel");
    const roots = [];
    for (const sourceRoot of sourceRoots) {
      const root = copyTree(sourceRoot, null);
      roots.push(root);
    }
    cloned.Trees.set(sentinel, roots);
  }

  // 7. Copy Nears
  for (const srcNode of source.Nodes) {
    const node = nodesBySource.get(srcNode);
    if (node) {
      for (const srcNear of srcNode.orderedNears()) {
        node.addNear(resolveNode(srcNear, "near relation"));
      }
    }
  }

  // 8. Copy Indexes and Directions
  for (const [k, v] of source.Directions.entries()) {
    if (k === null) {
      cloned.Directions.set(null, v);
    } else {
      cloned.Directions.set(resolveNode(k, "direction container"), v);
    }
  }

  for (const [k, v] of source.nodesByExternalId.entries()) {
    cloned.nodesByExternalId.set(k, resolveNode(v, "nodesByExternalId"));
  }
  for (const [k, v] of source.edgesByExternalId.entries()) {
    cloned.edgesByExternalId.set(k, edgesBySource.get(v));
  }
  for (const [k, v] of source.nodesByEntityId.entries()) {
    cloned.nodesByEntityId.set(k, resolveNode(v, "nodesByEntityId"));
  }
  for (const [k, v] of source.edgesByEntityId.entries()) {
    cloned.edgesByEntityId.set(k, edgesBySource.get(v));
  }

  for (const [k, v] of source.endpoints.entries()) {
    if (v.kind === "node") {
      cloned.endpoints.set(k, {
        kind: "node",
        node: resolveNode(v.node, "endpoint node")
      });
    } else if (v.kind === "port") {
      cloned.endpoints.set(k, {
        kind: "port",
        node: resolveNode(v.node, "endpoint port node"),
        port: structuredClone(v.port)
      });
    }
  }

  return cloned;
}
