// Slice 46 — private port of layoutgraph.ValidateSubgraphCombination.
//
// Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/
//   placement_access.go ValidateSubgraphCombination →
//   topology_preflight.go validateCombineNodeTopology (line ~129 onward).
//
// validateCombineNodeTopology validates node-owned records across all graphs
// as one bounded inventory. Split subgraphs share the large graph-owned entity
// maps, but each subgraph has its own Nodes and Edges and may expose
// additional topology through those nodes. The walk is iterative (queues), and
// throws instead of returning Go errors.
//
// Map iteration: Go ranges node.Nears, LongDistanceNeighborRequirements,
// herd pairings, hierarchy levels and the final `nodes` set in random order;
// JS iterates insertion order. Only reference counts (order-independent) and
// the first error encountered can observe the difference, so oracle scenarios
// keep at most one failure reachable through any map-ordered walk.

import {
  MAX_ENGINE_EDGES,
  MAX_ENGINE_NODES,
  MAX_ENGINE_WORK_UNITS,
  MAX_PREFLIGHT_WORK,
  MAX_ROUTE_POINTS,
  MAX_TOPOLOGY_REFERENCES,
} from '../limits/constants.js';
import { WorkGuard } from '../limits/work-guard.js';
import { ancestryParent, validateNodeParentRelation } from '../graph/topology-preflight.js';

function keysOf(collection) {
  if (collection == null) return [];
  if (collection instanceof Map) return collection.keys();
  return collection;
}

/** validateCombineNodeTopology (Go: layoutgraph.ValidateSubgraphCombination). */
export function validateSubgraphCombination(ctx, graphs) {
  const guard = new WorkGuard(ctx, 'CombineSubgraphs', MAX_ENGINE_WORK_UNITS);
  guard.SetLimit(MAX_PREFLIGHT_WORK);

  let referenceCount = 0;
  let routePointCount = 0;
  const addReference = (kind) => {
    if (referenceCount >= MAX_TOPOLOGY_REFERENCES) {
      throw new Error(
        `TALA CombineSubgraphs topology references exceed limit ${MAX_TOPOLOGY_REFERENCES} while visiting ${kind}`,
      );
    }
    referenceCount++;
    guard.Step();
  };
  // JS arrays have no spare capacity: spare is always 0, leaving only Go's
  // cancellation check.
  const accountSpareCapacity = () => {
    guard.Check();
  };
  const structuralNil = (kind) => new Error(`TALA CombineSubgraphs node-owned topology contains nil ${kind}`);

  const nodes = new Set();
  const edges = new Set();
  const clusters = new Set();
  const sequences = new Set();
  const abductions = new Set();
  const herds = new Set();
  const hierarchies = new Set();

  const nodeQueue = [];
  const edgeQueue = [];
  const clusterQueue = [];
  const sequenceQueue = [];
  const abductionQueue = [];
  const herdQueue = [];
  const hierarchyQueue = [];

  const queueNode = (node, required, kind) => {
    if (node == null) {
      if (required) throw structuralNil(kind);
      return;
    }
    addReference(kind);
    if (nodes.has(node)) return;
    if (nodes.size >= MAX_ENGINE_NODES) {
      throw new Error(`TALA CombineSubgraphs unique node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    nodes.add(node);
    nodeQueue.push(node);
  };
  const queueEdge = (edge, required, kind) => {
    if (edge == null) {
      if (required) throw structuralNil(kind);
      return;
    }
    addReference(kind);
    if (edges.has(edge)) return;
    if (edges.size >= MAX_ENGINE_EDGES) {
      throw new Error(`TALA CombineSubgraphs unique edge count exceeds limit ${MAX_ENGINE_EDGES}`);
    }
    edges.add(edge);
    edgeQueue.push(edge);
  };
  const queueRecord = (set, queue) => (record, required, kind) => {
    if (record == null) {
      if (required) throw structuralNil(kind);
      return;
    }
    addReference(kind);
    if (!set.has(record)) {
      set.add(record);
      queue.push(record);
    }
  };
  const queueCluster = queueRecord(clusters, clusterQueue);
  const queueSequence = queueRecord(sequences, sequenceQueue);
  const queueAbduction = queueRecord(abductions, abductionQueue);
  const queueHerd = queueRecord(herds, herdQueue);
  const queueHierarchy = queueRecord(hierarchies, hierarchyQueue);

  for (const graph of graphs) {
    if (graph == null) {
      throw new Error('TALA CombineSubgraphs received a nil graph');
    }
    const graphNodes = graph.Nodes ?? [];
    for (let i = 0; i < graphNodes.length; i++) {
      if (graphNodes[i] == null) {
        throw new Error(`TALA CombineSubgraphs graph node at index ${i} is nil`);
      }
      queueNode(graphNodes[i], true, 'graph node');
    }
    const graphEdges = graph.Edges ?? [];
    for (let i = 0; i < graphEdges.length; i++) {
      if (graphEdges[i] == null) {
        throw new Error(`TALA CombineSubgraphs graph edge at index ${i} is nil`);
      }
      queueEdge(graphEdges[i], true, 'graph edge');
    }
  }

  let nodeIndex = 0;
  let edgeIndex = 0;
  let clusterIndex = 0;
  let sequenceIndex = 0;
  let abductionIndex = 0;
  let herdIndex = 0;
  let hierarchyIndex = 0;
  while (nodeIndex < nodeQueue.length || edgeIndex < edgeQueue.length || clusterIndex < clusterQueue.length ||
    sequenceIndex < sequenceQueue.length || abductionIndex < abductionQueue.length ||
    herdIndex < herdQueue.length || hierarchyIndex < hierarchyQueue.length) {
    if (nodeIndex < nodeQueue.length) {
      const node = nodeQueue[nodeIndex++];
      queueNode(node.Container, false, 'node container');
      accountSpareCapacity('node edges');
      for (const edge of node.Edges ?? []) {
        queueEdge(edge, true, 'node edge');
      }
      for (const near of keysOf(node.Nears)) {
        queueNode(near, true, 'near node');
      }
      for (const neighbor of keysOf(node.LongDistanceNeighborRequirements)) {
        queueNode(neighbor, true, 'long-distance neighbor requirement key');
      }
      queueCluster(node.Cluster, false, 'node cluster');
      queueSequence(node.Sequence, false, 'node sequence');
      queueHerd(node.HerdAssignment, false, 'node herd assignment');
      queueHierarchy(node.Hierarchy, false, 'node hierarchy');
    } else if (edgeIndex < edgeQueue.length) {
      const edge = edgeQueue[edgeIndex++];
      queueNode(edge.From, true, 'edge source');
      queueNode(edge.To, true, 'edge target');
      const points = edge.Points ?? [];
      const pointCapacity = points.length;
      if (pointCapacity > MAX_ROUTE_POINTS - routePointCount) {
        throw new Error(`TALA CombineSubgraphs route point count exceeds limit ${MAX_ROUTE_POINTS}`);
      }
      routePointCount += pointCapacity;
      for (const point of points) {
        if (point == null) {
          throw structuralNil('edge route point');
        }
        guard.Step();
      }
    } else if (clusterIndex < clusterQueue.length) {
      const cluster = clusterQueue[clusterIndex++];
      queueNode(cluster.Vessel, true, 'cluster vessel');
      queueNode(cluster.Container, false, 'cluster container');
      accountSpareCapacity('cluster nodes');
      for (const node of cluster.Nodes ?? []) {
        queueNode(node, true, 'cluster node');
      }
      accountSpareCapacity('cluster edge abductions');
      for (const abduction of cluster.EdgeAbductions ?? []) {
        queueAbduction(abduction, true, 'cluster edge abduction');
      }
    } else if (sequenceIndex < sequenceQueue.length) {
      const sequence = sequenceQueue[sequenceIndex++];
      queueNode(sequence.Vessel, true, 'sequence vessel');
      queueNode(sequence.Container, false, 'sequence container');
      accountSpareCapacity('sequence nodes');
      for (const node of sequence.Nodes ?? []) {
        queueNode(node, true, 'sequence node');
      }
      accountSpareCapacity('sequence edge abductions');
      for (const abduction of sequence.EdgeAbductions ?? []) {
        queueAbduction(abduction, true, 'sequence edge abduction');
      }
    } else if (abductionIndex < abductionQueue.length) {
      const abduction = abductionQueue[abductionIndex++];
      queueEdge(abduction.Edge, true, 'abducted edge');
      queueNode(abduction.OriginallyFrom, false, 'abduction original source');
      queueNode(abduction.OriginallyTo, false, 'abduction original target');
      queueNode(abduction.CurrentFrom, false, 'abduction current source');
      queueNode(abduction.CurrentTo, false, 'abduction current target');
    } else if (herdIndex < herdQueue.length) {
      const herd = herdQueue[herdIndex++];
      for (const node of keysOf(herd.oppositeSidePaired)) {
        queueNode(node, true, 'opposite-side herd node');
      }
      for (const node of keysOf(herd.sameSidePaired)) {
        queueNode(node, true, 'same-side herd node');
      }
    } else {
      const hierarchy = hierarchyQueue[hierarchyIndex++];
      const levels = hierarchy.levels != null ? hierarchy.levels : hierarchy.level;
      for (const node of keysOf(levels)) {
        queueNode(node, true, 'hierarchy level node');
      }
    }
  }

  validateNodeParentRelation(guard, nodes, 'container parent', (node) => node.Container);
  validateNodeParentRelation(guard, nodes, 'effective container parent', (node) => node.container());
  validateNodeParentRelation(guard, nodes, 'ancestry parent', ancestryParent);
  guard.Finish();
}

export const ValidateSubgraphCombination = validateSubgraphCombination;
