import { Graph } from "./graph.js";
import { Node, sortNodesByID } from "./node.js";
import { Edge } from "./edge.js";
import { Point } from "../geometry/point.js";
import { Orientation } from "../geometry/orientation.js";
import { Cluster } from "./cluster.js";
import { Sequence } from "./sequence.js";
import { Tree } from "./tree.js";
import { EdgeAbduction } from "./edge-abduction.js";
import { Label } from "./label.js";
import { Icon } from "./icon.js";
import { Hierarchy } from "./hierarchy.js";
import { validateEngineGraph } from "./topology-preflight.js";
import { WorkGuard } from "../limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS } from "../limits/constants.js";

// Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/clone.go

const noopCloneStepper = Object.freeze({
  Step() {},
  step() {},
  Finish() {},
  finish() {},
});

function copyLabelRecord(source) {
  if (source == null) return null;
  const cloned = new Label(source.Text, source.Width, source.Height);
  cloned.Position = copyValue(source.Position);
  // Note: positionFixed is intentionally NOT copied, matching Go copyLabelRecord semantics
  return cloned;
}

function copyIconRecord(source) {
  if (source == null) return null;
  const cloned = new Icon();
  cloned.Position = copyValue(source.Position);
  // Note: positionFixed is intentionally NOT copied, matching Go copyIconRecord semantics
  cloned._positionFixed = false;
  return cloned;
}

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

// canonicalDirection mirrors Go canonicalDirection: only the four axis
// directions survive a clone; every other value becomes geo.NONE.
function canonicalDirection(direction) {
  switch (direction) {
    case Orientation.Top:
    case Orientation.Bottom:
    case Orientation.Left:
    case Orientation.Right:
      return direction;
    default:
      return Orientation.NONE;
  }
}

/**
 * Clone returns the layout graph projection used for an independent layout
 * attempt. It deliberately copies the stable graph state, not transient
 * optimizer state: derived caches, herd assignments, long-distance placement
 * requirements, route diagnostics, and fixed-label bookkeeping are reset.
 *
 * The returned graph is published only after the complete bounded copy has
 * succeeded; any failure throws and nothing is returned. The source is never
 * mutated.
 *
 * Pinned Go: layoutgraph.Clone / cloneInto (clone.go).
 *
 * @param {any} ctx work context (required)
 * @param {Graph} source
 * @returns {Graph}
 */
export function Clone(ctx, source) {
  if (ctx == null) {
    throw new Error("TALA CloneGraph requires a context");
  }
  if (source == null) {
    throw new Error("cannot clone a nil graph");
  }
  validateEngineGraph(ctx, "CloneGraph", source);
  const guard = new WorkGuard(ctx, "CloneGraph", MAX_ENGINE_WORK_UNITS);
  const staged = copyGraph(source, guard, false);
  guard.Finish();
  return staged;
}

export const cloneGraphWithContext = Clone;

/**
 * cloneGraph is the legacy context-free clone used by existing JS callers. It
 * shares Clone's copy with an unbounded, non-polling stepper and skips the
 * engine-topology preflight.
 */
export function cloneGraph(source) {
  if (!source) throw new Error("cannot clone a nil graph");
  return copyGraph(source, noopCloneStepper, true);
}

function copyGraph(source, guard, legacy) {
  const cloned = new Graph();
  cloned.ID = source.ID;
  cloned.elkData = structuredClone(source.elkData);

  const nodesByID = new Map();
  const nodeRecordsByID = new Map();
  const topLevelNodeIDs = new Set();
  const nodesBySource = new Map();
  const nodeRecords = [];
  const treeNodeRecords = [];

  const edgesByID = new Map();
  const edgesBySource = new Map();
  const clustersBySource = new Map();
  const sequencesBySource = new Map();

  function copyNodeRecord(srcNode) {
    const node = new Node(srcNode.ID, srcNode.Width, srcNode.Height);
    node.D2ID = srcNode.D2ID;
    node.TopLeft = copyValue(srcNode.TopLeft);
    node.FixedTopLeft = copyValue(srcNode.FixedTopLeft);
    node.DesiredWidth = srcNode.DesiredWidth;
    node.DesiredHeight = srcNode.DesiredHeight;
    node.Graph = cloned;
    node.FontSize = srcNode.FontSize;
    node.Label = copyLabelRecord(srcNode.Label);
    node.Icon = copyIconRecord(srcNode.Icon);
    node.HerdAssignment = null;
    node.LoopOffsets = null;
    node.LongDistanceNeighborRequirements = null;
    node.ForceHierarchy = srcNode.ForceHierarchy;
    node.Is3D = srcNode.Is3D;
    node.IsMultiple = srcNode.IsMultiple;
    node.IsInvisible = srcNode.IsInvisible;
    node.setShape(srcNode.shapeType());
    node.setNumColumns(srcNode.numColumns());
    node.elkData = structuredClone(srcNode.elkData);
    return node;
  }

  function addNodeRecord(srcNode) {
    guard.Step();
    if (srcNode == null) throw new Error("cannot clone a nil node");
    if (srcNode.ID === 0n) throw new Error("cannot clone reserved node ID 0");
    if (nodesByID.has(srcNode.ID)) {
      throw new Error(`cannot clone duplicate node ID ${srcNode.ID}`);
    }

    const clonedNode = copyNodeRecord(srcNode);
    nodesByID.set(srcNode.ID, clonedNode);
    nodeRecordsByID.set(srcNode.ID, srcNode);
    topLevelNodeIDs.add(srcNode.ID);
    nodesBySource.set(srcNode, clonedNode);
    nodeRecords.push(srcNode);
    return clonedNode;
  }

  function copyAuxiliaryNodeRecord(srcNode, relation) {
    if (srcNode == null) {
      throw new Error(`cannot clone ${relation}: nil node`);
    }
    if (srcNode.ID === 0n) {
      throw new Error(`cannot clone ${relation}: reserved node ID 0`);
    }
    if (nodeRecordsByID.has(srcNode.ID)) {
      const declared = nodeRecordsByID.get(srcNode.ID);
      if (declared !== srcNode) {
        throw new Error(`cannot clone ${relation}: distinct node record reuses ID ${srcNode.ID}`);
      }
      return [nodesByID.get(srcNode.ID), false];
    }

    const clonedNode = copyNodeRecord(srcNode);
    nodesByID.set(srcNode.ID, clonedNode);
    nodeRecordsByID.set(srcNode.ID, srcNode);
    nodesBySource.set(srcNode, clonedNode);
    return [clonedNode, true];
  }

  function resolveNode(srcNode, relation) {
    if (srcNode == null) return null;
    guard.Step();
    return lookupNode(srcNode, relation);
  }

  // lookupNode resolves without charging work. It is used only for the
  // JS-only ELK index maps, which have no Go counterpart.
  function lookupNode(srcNode, relation) {
    if (srcNode == null) return null;
    const clonedNode = nodesByID.get(srcNode.ID);
    if (!clonedNode) {
      throw new Error(`cannot clone ${relation}: node ${srcNode.ID} is not included in the graph`);
    }
    nodesBySource.set(srcNode, clonedNode);
    return clonedNode;
  }

  function copyEdge(sourceEdge) {
    const from = resolveNode(sourceEdge.From, "edge source");
    const to = resolveNode(sourceEdge.To, "edge target");
    if (!from || !to) {
      throw new Error(`cannot clone edge ${sourceEdge.ID} with a nil endpoint`);
    }

    const clonedEdge = new Edge(from, to);
    clonedEdge.ID = sourceEdge.ID;
    clonedEdge.D2ID = sourceEdge.D2ID;
    clonedEdge.MinWidth = sourceEdge.MinWidth;
    clonedEdge.MinHeight = sourceEdge.MinHeight;
    clonedEdge.SourceArrowhead = sourceEdge.SourceArrowhead;
    clonedEdge.TargetArrowhead = sourceEdge.TargetArrowhead;
    clonedEdge.SourceArrowheadLabel = copyLabelRecord(sourceEdge.SourceArrowheadLabel);
    clonedEdge.TargetArrowheadLabel = copyLabelRecord(sourceEdge.TargetArrowheadLabel);
    clonedEdge.Label = copyLabelRecord(sourceEdge.Label);
    clonedEdge.LabelPercentage = sourceEdge.LabelPercentage;
    clonedEdge.FromTableColumnIndex = sourceEdge.FromTableColumnIndex;
    clonedEdge.ToTableColumnIndex = sourceEdge.ToTableColumnIndex;
    clonedEdge.IsInvisible = sourceEdge.IsInvisible;
    clonedEdge.Style = copyValue(sourceEdge.Style);

    clonedEdge.sourceEndpointId = sourceEdge.sourceEndpointId;
    clonedEdge.targetEndpointId = sourceEdge.targetEndpointId;
    clonedEdge.route = structuredClone(sourceEdge.route);
    clonedEdge.elkData = structuredClone(sourceEdge.elkData);

    for (const pt of sourceEdge.Points) {
      guard.Step();
      clonedEdge.Points.push(pt.copy());
    }
    return clonedEdge;
  }

  // 1. Serialize Nodes, Cluster members, and Sequence members into clone state
  const inSerializedNodes = new Set();
  for (const node of source.Nodes) {
    addNodeRecord(node);
    inSerializedNodes.add(node);
  }
  for (const vessel of source.clusterOrder()) {
    inSerializedNodes.add(vessel);
    const cluster = source.Clusters.get(vessel);
    if (cluster && cluster.Nodes) {
      for (const node of cluster.Nodes) {
        if (inSerializedNodes.has(node)) continue;
        addNodeRecord(node);
        inSerializedNodes.add(node);
      }
    }
  }
  for (const vessel of source.sequenceOrder()) {
    inSerializedNodes.add(vessel);
    const sequence = source.Sequences.get(vessel);
    if (sequence && sequence.Nodes) {
      for (const node of sequence.Nodes) {
        if (inSerializedNodes.has(node)) continue;
        addNodeRecord(node);
        inSerializedNodes.add(node);
      }
    }
  }

  // 2. Copy Edges
  for (const edge of source.Edges) {
    guard.Step();
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

    const clonedEdge = copyEdge(edge);
    edgesBySource.set(edge, clonedEdge);
    if (edge.ID !== 0n) {
      edgesByID.set(edge.ID, clonedEdge);
    }
    clonedEdge.From.addEdge(clonedEdge);
    if (!clonedEdge.isLoop()) {
      clonedEdge.To.addEdge(clonedEdge);
    }
    cloned.Edges.push(clonedEdge);
  }

  // 3. Copy Containers using group-aware containerRDFSOrder
  cloned.Containers = new Map();
  if (source.Containers.size > 0) {
    const rdfsOrder = source.containerRDFSOrderContext(null, guard);
    if (source.Containers.size !== rdfsOrder.length + 1) {
      const suffix = legacy ? " (unreachable containers exist in source)" : "";
      throw new Error(`cannot clone containers: map length ${source.Containers.size} does not match hierarchy length ${rdfsOrder.length + 1}${suffix}`);
    }
    rdfsOrder.push(null);

    for (const srcContainer of rdfsOrder) {
      const container = resolveNode(srcContainer, "container");
      const srcChildren = source.Containers.get(srcContainer) || [];
      const clonedChildren = [];
      for (const sourceChild of srcChildren) {
        if (sourceChild == null || nodeRecordsByID.get(sourceChild.ID) !== sourceChild) {
          throw new Error("cannot clone container child: exact node record is not available");
        }
        const child = resolveNode(sourceChild, "container child");
        if (child == null) {
          throw new Error("cannot clone a nil container child");
        }
        child.Container = container;
        clonedChildren.push(child);
      }
      cloned.Containers.set(container, clonedChildren);
      if (container !== null) {
        container.isContainer = true;
      }
    }
  }

  // 4. Copy Clusters
  cloned.Clusters = new Map();
  for (const sourceVessel of source.clusterOrder()) {
    guard.Step();
    const sourceCluster = source.Clusters.get(sourceVessel);
    if (!sourceCluster) {
      throw new Error(`cannot clone nil cluster for vessel ${sourceVessel.ID}`);
    }
    if (sourceCluster.Vessel !== sourceVessel) {
      throw new Error(`cannot clone cluster under vessel ${sourceVessel.ID} because its record vessel differs`);
    }
    if (sourceCluster.Container && sourceCluster.Container.ID === sourceVessel.ID) {
      throw new Error(`cannot clone cluster ${sourceVessel.ID} because it cannot contain itself`);
    }

    const [vessel, copied] = copyAuxiliaryNodeRecord(sourceVessel, "cluster vessel");
    if (copied) {
      vessel.Graph = null;
    }
    vessel.isClusterVessel = true;

    const container = resolveNode(sourceCluster.Container, "cluster container");
    const members = [];
    for (const sourceMember of (sourceCluster.Nodes || [])) {
      const member = resolveNode(sourceMember, "cluster member");
      members.push(member);
    }

    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: members,
      Arrangement: sourceCluster.Arrangement,
      DesiredArrangement: sourceCluster.DesiredArrangement,
      Graph: cloned,
      Padding: copyValue(sourceCluster.Padding),
      FixedSize: sourceCluster.FixedSize,
      Container: container,
    });

    cloned.Clusters.set(vessel, cluster);
    clustersBySource.set(sourceCluster, cluster);
    for (const member of members) {
      guard.Step();
      if (member) member.Cluster = cluster;
    }
  }

  // 5. Copy Sequences
  cloned.Sequences = new Map();
  for (const sourceVessel of source.sequenceOrder()) {
    guard.Step();
    const sourceSequence = source.Sequences.get(sourceVessel);
    if (!sourceSequence) {
      throw new Error(`cannot clone nil sequence for vessel ${sourceVessel.ID}`);
    }
    if (sourceSequence.Vessel !== sourceVessel) {
      throw new Error(`cannot clone sequence under vessel ${sourceVessel.ID} because its record vessel differs`);
    }
    if (sourceSequence.Container && sourceSequence.Container.ID === sourceVessel.ID) {
      throw new Error(`cannot clone sequence ${sourceVessel.ID} because it cannot contain itself`);
    }
    if (!sourceSequence.Nodes || sourceSequence.Nodes.length < 2) {
      throw new Error(`cannot clone sequence ${sourceVessel.ID} with ${sourceSequence.Nodes ? sourceSequence.Nodes.length : 0} steps; want at least 2`);
    }

    const [vessel, copied] = copyAuxiliaryNodeRecord(sourceVessel, "sequence vessel");
    if (copied) {
      vessel.Graph = null;
    }

    const container = resolveNode(sourceSequence.Container, "sequence container");
    const members = [];
    for (const sourceMember of sourceSequence.Nodes) {
      const member = resolveNode(sourceMember, "sequence member");
      members.push(member);
    }

    const sequence = new Sequence({
      Vessel: vessel,
      Nodes: members,
      Graph: cloned,
      Container: container,
    });

    cloned.Sequences.set(vessel, sequence);
    sequencesBySource.set(sourceSequence, sequence);
    for (const member of members) {
      guard.Step();
      if (member) member.Sequence = sequence;
    }
  }

  // 6. Copy Hubs (Go copyHubs; HubOrder sorts hub keys by node ID)
  cloned.Hubs = new Map();
  if (source.Hubs != null) {
    const hubOrder = sortNodesByID(Array.from(source.Hubs.keys()).filter((hub) => hub != null));
    if (source.Hubs.has(null)) hubOrder.unshift(null);
    for (const sourceHub of hubOrder) {
      const hub = resolveNode(sourceHub, "hub");
      const sourceSpokes = source.Hubs.get(sourceHub) || [];
      const spokes = [];
      for (const sourceSpoke of sourceSpokes) {
        if (sourceSpoke == null || nodeRecordsByID.get(sourceSpoke.ID) !== sourceSpoke) {
          throw new Error("cannot clone hub spoke: exact node record is not included in the graph");
        }
        spokes.push(resolveNode(sourceSpoke, "hub spoke"));
      }
      cloned.Hubs.set(hub, spokes);
    }
  }

  // 7. Copy EdgeAbductions
  function copyAbductionsFor(sourceAbductions) {
    if (!sourceAbductions) return [];
    const clonedList = [];
    for (const sourceAbduction of sourceAbductions) {
      guard.Step();
      let edge = edgesBySource.get(sourceAbduction.Edge);
      if (!edge && sourceAbduction.Edge && sourceAbduction.Edge.ID !== 0n) {
        edge = edgesByID.get(sourceAbduction.Edge.ID);
      }
      if (!edge) {
        throw new Error(`cannot clone edge abduction for edge ${sourceAbduction.Edge ? sourceAbduction.Edge.ID : "?"} before the edge is copied`);
      }
      const originallyFrom = resolveNode(sourceAbduction.OriginallyFrom, "abduction original source");
      const originallyTo = resolveNode(sourceAbduction.OriginallyTo, "abduction original target");
      const currentFrom = resolveNode(sourceAbduction.CurrentFrom, "abduction current source");
      const currentTo = resolveNode(sourceAbduction.CurrentTo, "abduction current target");

      clonedList.push(new EdgeAbduction({
        Edge: edge,
        OriginallyFrom: originallyFrom,
        OriginallyTo: originallyTo,
        CurrentFrom: currentFrom,
        CurrentTo: currentTo,
      }));
    }
    return clonedList;
  }

  for (const sourceVessel of source.clusterOrder()) {
    const sourceCluster = source.Clusters.get(sourceVessel);
    clustersBySource.get(sourceCluster).EdgeAbductions = copyAbductionsFor(sourceCluster.EdgeAbductions);
  }
  for (const sourceVessel of source.sequenceOrder()) {
    const sourceSequence = source.Sequences.get(sourceVessel);
    sequencesBySource.get(sourceSequence).EdgeAbductions = copyAbductionsFor(sourceSequence.EdgeAbductions);
  }

  // 8. Copy Trees
  cloned.Trees = new Map();
  cloned.NodeToTree = new Map();
  const treeOwnersByNodeID = new Set();

  function copyTree(sourceTree, parent = null) {
    guard.Step();
    if (!sourceTree) return null;
    if (sourceTree.SentinelEdge == null) {
      throw new Error("cannot clone a tree with a nil sentinel edge");
    }
    if (sourceTree.Node == null) {
      throw new Error("cannot clone a tree with a nil node");
    }
    if (treeOwnersByNodeID.has(sourceTree.Node.ID)) {
      throw new Error(`cannot clone tree node ${sourceTree.Node.ID} with more than one tree owner`);
    }
    treeOwnersByNodeID.add(sourceTree.Node.ID);

    if (nodeRecordsByID.has(sourceTree.Node.ID) && nodeRecordsByID.get(sourceTree.Node.ID) === sourceTree.Node) {
      if (!topLevelNodeIDs.has(sourceTree.Node.ID)) {
        throw new Error(`cannot clone tree node ${sourceTree.Node.ID} because it repeats a non-top-level node record`);
      }
    }

    const [node, copied] = copyAuxiliaryNodeRecord(sourceTree.Node, "tree node");
    if (copied) {
      treeNodeRecords.push(sourceTree.Node);
    }

    let sentinel = edgesBySource.get(sourceTree.SentinelEdge);
    if (!sentinel && sourceTree.SentinelEdge.ID !== 0n && edgesByID.has(sourceTree.SentinelEdge.ID)) {
      throw new Error(`cannot clone tree sentinel edge: distinct edge record reuses ID ${sourceTree.SentinelEdge.ID}`);
    }
    if (!sentinel) {
      sentinel = copyEdge(sourceTree.SentinelEdge);
      edgesBySource.set(sourceTree.SentinelEdge, sentinel);
      if (sourceTree.SentinelEdge.ID !== 0n) {
        edgesByID.set(sourceTree.SentinelEdge.ID, sentinel);
      }
    }

    const tree = new Tree(node);
    tree.Parent = parent;
    tree.SentinelEdge = sentinel;
    tree.Orientation = sourceTree.Orientation;

    cloned.NodeToTree.set(node, tree);

    for (const sourceChild of sourceTree.Children) {
      const child = copyTree(sourceChild, tree);
      tree.Children.push(child);
    }
    return tree;
  }

  for (const sourceSentinel of source.treeOrder()) {
    const sentinel = resolveNode(sourceSentinel, "tree root sentinel");
    const sourceRoots = source.Trees.get(sourceSentinel) || [];
    const roots = [];
    for (const sourceRoot of sourceRoots) {
      const root = copyTree(sourceRoot, null);
      roots.push(root);
    }
    if (roots.length > 0) {
      cloned.Trees.set(sentinel, roots);
    }
  }

  // 9. Copy Nears
  for (const srcNode of [...nodeRecords, ...treeNodeRecords]) {
    const node = nodesBySource.get(srcNode);
    for (const srcNear of srcNode.orderedNears()) {
      guard.Step();
      const near = resolveNode(srcNear, "near relation");
      if (node) node.addNear(near);
    }
  }

  // 10. Copy Hierarchies
  const seenHierarchies = new Set();
  for (const srcNode of source.Nodes) {
    guard.Step();
    const srcHierarchy = srcNode.Hierarchy;
    if (!srcHierarchy || seenHierarchies.has(srcHierarchy)) continue;
    seenHierarchies.add(srcHierarchy);

    const levels = new Map();
    const clonedHierarchy = new Hierarchy();
    // LevelCount is NOT copied in Go clone, so LevelCount remains 0
    clonedHierarchy.ReplaceLevels(levels);
    if (srcHierarchy.levels) {
      for (const [srcMember, level] of srcHierarchy.levels.entries()) {
        const member = resolveNode(srcMember, "hierarchy member");
        levels.set(member, level);
        member.Hierarchy = clonedHierarchy;
      }
    }
  }

  // 11. Copy Directions (Go copyDirections; the root key is null)
  cloned.Directions = new Map();
  for (const [sourceContainer, sourceDirection] of source.Directions.entries()) {
    const container = resolveNode(sourceContainer, "direction container");
    cloned.Directions.set(container, canonicalDirection(sourceDirection));
  }

  // 12. Filter Graph.Nodes for active cluster and sequence members
  const filtered = [];
  for (const sourceNode of nodeRecords) {
    guard.Step();
    const node = nodesBySource.get(sourceNode);
    if (node.Cluster && node.Cluster.isActive()) {
      continue;
    }
    if (node.Sequence && node.Sequence.isActive()) {
      continue;
    }
    filtered.push(node);
  }
  cloned.Nodes = filtered;
  cloned.CellSize = source.CellSize;
  cloned.IsRootHierarchy = source.IsRootHierarchy;
  cloned.CommonUncleSiblings = null;
  cloned.edgeLengthCache = new Map();

  // Go copies the cached cost fields directly (no lazy recomputation), so the
  // source is never mutated by reading them.
  cloned.crossingCost = source.crossingCost;
  cloned.turnCost = source.turnCost;
  cloned.nonCenterPortCost = source.nonCenterPortCost;

  // 13. JS-only ELK index maps and endpoint metadata (ADR-001). These have no
  // Go counterpart and charge no work units.
  for (const [k, v] of source.nodesByExternalId.entries()) {
    cloned.nodesByExternalId.set(k, lookupNode(v, "nodesByExternalId"));
  }
  for (const [k, v] of source.edgesByExternalId.entries()) {
    cloned.edgesByExternalId.set(k, edgesBySource.get(v));
  }
  for (const [k, v] of source.nodesByEntityId.entries()) {
    cloned.nodesByEntityId.set(k, lookupNode(v, "nodesByEntityId"));
  }
  for (const [k, v] of source.edgesByEntityId.entries()) {
    cloned.edgesByEntityId.set(k, edgesBySource.get(v));
  }

  for (const [k, v] of source.endpoints.entries()) {
    if (v.kind === "node") {
      cloned.endpoints.set(k, {
        kind: "node",
        node: lookupNode(v.node, "endpoint node")
      });
    } else if (v.kind === "port") {
      cloned.endpoints.set(k, {
        kind: "port",
        node: lookupNode(v.node, "endpoint port node"),
        port: structuredClone(v.port)
      });
    }
  }

  return cloned;
}
