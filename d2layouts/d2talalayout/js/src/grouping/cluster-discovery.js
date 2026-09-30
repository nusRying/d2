/**
 * Cluster discovery index and classification — Slice 13 of the D2 TALA JS migration.
 *
 * Pinned Go reference: d2layouts/d2talalayout/internal/grouping/cluster_discovery.go
 *
 * SCOPE: This file implements the discovery/classification phase ONLY.
 * Cluster abduction (AddClusters) is deferred to a later slice.
 *
 * Key design decisions:
 * - clusterEdgeSignature uses JS Maps as set proxies (key: arrowhead string value).
 * - arrowTypeCount() ≤ 1 is the acceptance gate for signature.matches().
 * - Node.adjacent() is called exactly as in Go (tolerates malformed adjacency).
 * - All loops are iterative; no uncontrolled recursion.
 * - MAX_ENGINE_NODES enforces the ancestor-chain length limit in
 *   clusterIsDescendantOfGuarded, matching Go's maxEngineNodes constant.
 */

import { MAX_ENGINE_NODES } from "../limits/constants.js";

// ---------------------------------------------------------------------------
// clusterEdgeSignature
// ---------------------------------------------------------------------------

/**
 * clusterEdgeSignature accumulates per-node edge directionality and arrowhead
 * type information so that two nodes can be compared for cluster candidacy.
 *
 * Pinned reference: grouping/cluster_discovery.go type clusterEdgeSignature
 */
export class ClusterEdgeSignature {
  constructor() {
    this.from = 0;
    this.to = 0;
    this.bidirectional = 0;
    this.undirected = 0;
    this.directed = 0;
    /** @type {Set<string>} */
    this.fromArrowheads = new Set();
    /** @type {Set<string>} */
    this.toArrowheads = new Set();
  }

  /**
   * add accumulates one edge's contribution to this node's signature.
   *
   * Pinned reference: grouping/cluster_discovery.go clusterEdgeSignature.add
   *
   * @param {import('../graph/node.js').Node} node
   * @param {import('../graph/edge.js').Edge} edge
   */
  add(node, edge) {
    if (edge.From === node) {
      this.from++;
    }
    if (edge.To === node) {
      this.to++;
    }
    if (edge.isBidirectional()) {
      this.bidirectional++;
    } else if (edge.isUndirected()) {
      this.undirected++;
    } else if (edge.isDirected()) {
      this.directed++;
    }
    if (edge.From === node) {
      this.fromArrowheads.add(String(edge.SourceArrowhead));
      this.toArrowheads.add(String(edge.TargetArrowhead));
    } else {
      this.fromArrowheads.add(String(edge.TargetArrowhead));
      this.toArrowheads.add(String(edge.SourceArrowhead));
    }
  }

  /**
   * arrowTypeCount returns the number of distinct directionality types
   * represented in this signature (directed/bidirectional/undirected).
   *
   * Pinned reference: grouping/cluster_discovery.go clusterEdgeSignature.arrowTypeCount
   *
   * @returns {number}
   */
  arrowTypeCount() {
    let types = 0;
    if (this.directed > 0) types++;
    if (this.bidirectional > 0) types++;
    if (this.undirected > 0) types++;
    return types;
  }

  /**
   * matches returns true when two signatures are compatible for clustering.
   *
   * Pinned reference: grouping/cluster_discovery.go clusterEdgeSignature.matches
   *
   * @param {ClusterEdgeSignature} other
   * @returns {boolean}
   */
  matches(other) {
    if (
      this.from !== other.from ||
      this.to !== other.to ||
      this.bidirectional !== other.bidirectional ||
      this.undirected !== other.undirected
    ) {
      return false;
    }
    if (this.arrowTypeCount() > 1 || other.arrowTypeCount() > 1) {
      return false;
    }
    return (
      arrowheadSetsEqual(this.fromArrowheads, other.fromArrowheads) &&
      arrowheadSetsEqual(this.toArrowheads, other.toArrowheads)
    );
  }
}

/**
 * arrowheadSetsEqual compares two arrowhead sets for equality.
 *
 * Pinned reference: grouping/cluster_discovery.go arrowheadSetsEqual
 *
 * @param {Set<string>} first
 * @param {Set<string>} second
 * @returns {boolean}
 */
function arrowheadSetsEqual(first, second) {
  if (first.size !== second.size) return false;
  for (const arrowhead of first) {
    if (!second.has(arrowhead)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// clusterDiscoveryInfo
// ---------------------------------------------------------------------------

/**
 * ClusterDiscoveryInfo holds pre-computed per-node information used during
 * the cluster matching loop. Mutated by refreshNeighbors.
 *
 * Pinned reference: grouping/cluster_discovery.go type clusterDiscoveryInfo
 */
export class ClusterDiscoveryInfo {
  constructor() {
    /** @type {Array<import('../graph/node.js').Node>} */
    this.neighbors = [];
    /** @type {Set<import('../graph/node.js').Node>} */
    this.neighborSet = new Set();
    /** @type {Array<import('../graph/edge.js').Edge>} */
    this.edges = [];
    /** @type {ClusterEdgeSignature} */
    this.edgeSignature = new ClusterEdgeSignature();
    this.estimatedWidth = 0;
    this.estimatedHeight = 0;
    this.noClustering = false;
    this.toTableColumn = false;
  }
}

// ---------------------------------------------------------------------------
// clusterDiscoveryIndex
// ---------------------------------------------------------------------------

/**
 * ClusterDiscoveryIndex caches all per-node and per-edge information needed
 * during the cluster discovery phase. Read-only w.r.t. graph topology.
 *
 * Pinned reference: grouping/cluster_discovery.go type clusterDiscoveryIndex
 */
export class ClusterDiscoveryIndex {
  /**
   * @param {Map<import('../graph/node.js').Node, ClusterDiscoveryInfo>} infos
   * @param {Map<import('../graph/edge.js').Edge, number>} edgeOrder
   * @param {Map<import('../graph/edge.js').Edge, Array<import('../graph/node.js').Node>>} edgeNodes
   * @param {Map<import('../graph/sequence.js').Sequence, Map<import('../graph/edge.js').Edge, import('../graph/node.js').Node>>} sequenceEdges
   */
  constructor(infos, edgeOrder, edgeNodes, sequenceEdges) {
    this.infos = infos;
    this.edgeOrder = edgeOrder;
    this.edgeNodes = edgeNodes;
    this.sequenceEdges = sequenceEdges;
  }

  /**
   * sequenceOriginal returns the original (pre-abduction) node for an edge that
   * passes through a sequence vessel. Caches results per sequence.
   *
   * Pinned reference: grouping/cluster_discovery.go clusterDiscoveryIndex.sequenceOriginal
   *
   * @param {import('../graph/sequence.js').Sequence} sequence
   * @param {import('../graph/edge.js').Edge} edge
   * @param {import('../limits/work-guard.js').WorkGuard} guard
   * @returns {import('../graph/node.js').Node | null}
   */
  sequenceOriginal(sequence, edge, guard) {
    let byEdge = this.sequenceEdges.get(sequence);
    if (byEdge === undefined) {
      byEdge = new Map();
      const abductions = sequence.EdgeAbductions || [];
      for (const abduction of abductions) {
        guard.Step();
        if (abduction == null || abduction.Edge == null) {
          continue;
        }
        if (abduction.CurrentFrom === sequence.Vessel) {
          if (!byEdge.has(abduction.Edge)) {
            byEdge.set(abduction.Edge, abduction.OriginallyFrom);
          }
        } else if (abduction.CurrentTo === sequence.Vessel) {
          if (!byEdge.has(abduction.Edge)) {
            byEdge.set(abduction.Edge, abduction.OriginallyTo);
          }
        }
      }
      this.sequenceEdges.set(sequence, byEdge);
    }
    return byEdge.get(edge) ?? null;
  }

  /**
   * refreshNeighbors recomputes the unique neighbor list for one node,
   * resolving sequence vessels back to original nodes.
   *
   * Pinned reference: grouping/cluster_discovery.go clusterDiscoveryIndex.refreshNeighbors
   *
   * @param {import('../graph/graph.js').Graph} g
   * @param {import('../graph/node.js').Node} node
   * @param {import('../limits/work-guard.js').WorkGuard} guard
   */
  refreshNeighbors(g, node, guard) {
    const info = this.infos.get(node);
    if (info == null) {
      throw new Error("TALA AddClusters cannot find node discovery index");
    }
    const neighbors = [];
    const neighborSet = new Set();
    for (const edge of node.Edges) {
      guard.Step();
      let adjacent = node.adjacent(edge);
      const sequence = g.Sequences.get(adjacent);
      if (sequence != null) {
        adjacent = this.sequenceOriginal(sequence, edge, guard);
      }
      if (!neighborSet.has(adjacent)) {
        neighborSet.add(adjacent);
        neighbors.push(adjacent);
      }
    }
    info.neighbors = neighbors;
    info.neighborSet = neighborSet;
    guard.Finish();
  }

  /**
   * refreshAfterClusterAbduction updates the neighbor lists of every node
   * incident to the cluster's edges after abduction has re-routed them.
   *
   * Pinned reference: grouping/cluster_discovery.go
   *   clusterDiscoveryIndex.refreshAfterClusterAbduction
   *
   * @param {import('../graph/graph.js').Graph} g
   * @param {import('../graph/cluster.js').Cluster} cluster
   * @param {Array<import('../graph/edge.js').Edge>} edges
   * @param {import('../limits/work-guard.js').WorkGuard} guard
   */
  refreshAfterClusterAbduction(g, cluster, edges, guard) {
    const affected = [];
    const seen = new Set();

    const addAffected = (node) => {
      guard.Step();
      if (node == null || node === cluster.Vessel || this.infos.get(node) == null) {
        return;
      }
      if (seen.has(node)) return;
      seen.add(node);
      affected.push(node);
    };

    // clusterIncidentEdges returns graph-edge order. Preserve it and the original
    // candidate-node discovery order. Using the reverse adjacency index also
    // preserves legacy behavior for tolerated asymmetric node.Edges inventories.
    for (const edge of edges) {
      const nodes = this.edgeNodes.get(edge) || [];
      for (const node of nodes) {
        addAffected(node);
      }
    }
    for (const node of affected) {
      this.refreshNeighbors(g, node, guard);
    }
    guard.Finish();
  }
}

// ---------------------------------------------------------------------------
// clusterIsDescendantOfGuarded
// ---------------------------------------------------------------------------

/**
 * clusterIsDescendantOfGuarded iteratively checks whether `descendant` is at
 * or below `ancestor` in the cluster/sequence/container hierarchy.
 *
 * Pinned reference: grouping/cluster_discovery.go clusterIsDescendantOfGuarded
 *
 * @param {import('../graph/node.js').Node | null} descendant
 * @param {import('../graph/node.js').Node | null} ancestor
 * @param {import('../limits/work-guard.js').WorkGuard} guard
 * @returns {boolean}
 */
export function clusterIsDescendantOfGuarded(descendant, ancestor, guard) {
  const seen = new Set();
  let current = descendant;
  for (;;) {
    guard.Step();
    if (ancestor === current) return true;
    if (current == null) return false;
    if (seen.has(current)) {
      throw new Error("TALA AddClusters found a cycle in node ancestry");
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error("TALA AddClusters ancestry exceeds node limit");
    }
    seen.add(current);
    if (current.Container != null) {
      current = current.Container;
    } else if (current.Cluster != null && current.Cluster.Vessel != null) {
      current = current.Cluster.Vessel;
    } else if (current.Sequence != null && current.Sequence.Vessel != null) {
      current = current.Sequence.Vessel;
    } else {
      return ancestor == null;
    }
  }
}

// ---------------------------------------------------------------------------
// clusterHasLeakyEdgeGuarded
// ---------------------------------------------------------------------------

/**
 * clusterHasLeakyEdgeGuarded returns true if `node` is a container with at
 * least one descendant edge reaching outside the container boundary.
 *
 * Pinned reference: grouping/cluster_discovery.go clusterHasLeakyEdgeGuarded
 *
 * @param {import('../graph/graph.js').Graph} g
 * @param {import('../graph/node.js').Node} node
 * @param {import('../limits/work-guard.js').WorkGuard} guard
 * @returns {boolean}
 */
export function clusterHasLeakyEdgeGuarded(g, node, guard) {
  if (!node.IsContainer()) {
    return false;
  }
  const descendants = g.allDescendantNodesWithWorkGuard(node, true, guard);
  for (const descendant of descendants) {
    guard.Step();
    for (const edge of descendant.Edges) {
      guard.Step();
      const adjacent = descendant.adjacent(edge);
      const inside = clusterIsDescendantOfGuarded(adjacent, node, guard);
      if (!inside) {
        return true;
      }
    }
  }
  guard.Finish();
  return false;
}

// ---------------------------------------------------------------------------
// buildClusterDiscoveryIndex
// ---------------------------------------------------------------------------

/**
 * buildClusterDiscoveryIndex builds the read-only per-node and per-edge index
 * used during the cluster matching scan. Graph topology is NOT mutated.
 *
 * Pinned reference: grouping/cluster_discovery.go buildClusterDiscoveryIndex
 *
 * @param {import('../graph/graph.js').Graph} g
 * @param {Array<import('../graph/node.js').Node> | null} containerOrder
 * @param {import('../limits/work-guard.js').WorkGuard} guard
 * @returns {ClusterDiscoveryIndex}
 */
export function buildClusterDiscoveryIndex(g, containerOrder, guard) {
  const orderedNodes = [];
  const seenNodes = new Set();

  const addNode = (node) => {
    guard.Step();
    if (node == null) {
      throw new Error("TALA AddClusters contains a nil node");
    }
    if (seenNodes.has(node)) return;
    if (seenNodes.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA AddClusters unique node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    }
    seenNodes.add(node);
    orderedNodes.push(node);
  };

  // Walk containers in the provided order (innermost-first from ContainerRDFSOrder).
  for (const container of containerOrder ?? []) {
    addNode(container);
    const children = g.Containers.get(container) || [];
    for (const child of children) {
      addNode(child);
    }
  }
  // Add root-level nodes (children of the null container).
  const rootChildren = g.Containers.get(null) || [];
  for (const child of rootChildren) {
    addNode(child);
  }

  // Allocate info entries.
  /** @type {Map<import('../graph/node.js').Node, ClusterDiscoveryInfo>} */
  const infos = new Map();
  /** @type {Map<import('../graph/edge.js').Edge, number>} */
  const edgeOrder = new Map();
  /** @type {Map<import('../graph/edge.js').Edge, Array<import('../graph/node.js').Node>>} */
  const edgeNodes = new Map();
  /** @type {Map<import('../graph/sequence.js').Sequence, Map<import('../graph/edge.js').Edge, import('../graph/node.js').Node>>} */
  const sequenceEdges = new Map();

  for (const node of orderedNodes) {
    const info = new ClusterDiscoveryInfo();
    info.estimatedWidth = node.Width;
    info.estimatedHeight = node.Height;
    infos.set(node, info);
  }

  const index = new ClusterDiscoveryIndex(infos, edgeOrder, edgeNodes, sequenceEdges);

  // First pass: per-node edges + neighbor refresh.
  for (const node of orderedNodes) {
    const info = infos.get(node);
    let hasLoop = false;
    for (const edge of node.Edges) {
      guard.Step();
      // Build edge → [nodes] reverse adjacency map.
      let nodeList = edgeNodes.get(edge);
      if (nodeList === undefined) {
        nodeList = [];
        edgeNodes.set(edge, nodeList);
      }
      nodeList.push(node);

      if (edge.isLoop()) {
        hasLoop = true;
      }
      if (edge.FromTableColumnIndex != null || edge.ToTableColumnIndex != null) {
        info.toTableColumn = true;
      }
    }
    index.refreshNeighbors(g, node, guard);

    const leaky = clusterHasLeakyEdgeGuarded(g, node, guard);

    info.noClustering =
      g.IsTreeSentinel(node) ||
      node.isClusterVessel ||
      g.IsSequenceVessel(node) ||
      node.isTable() ||
      node.Hierarchy != null ||
      node.FixedTopLeft != null ||
      leaky ||
      hasLoop;
  }

  // Second pass: assign per-edge order indices and accumulate signatures.
  for (let edgeIndex = 0; edgeIndex < g.Edges.length; edgeIndex++) {
    guard.Step();
    const edge = g.Edges[edgeIndex];
    if (!edgeOrder.has(edge)) {
      edgeOrder.set(edge, edgeIndex);
    }
    const fromInfo = infos.get(edge.From);
    if (fromInfo != null) {
      fromInfo.edges.push(edge);
      fromInfo.edgeSignature.add(edge.From, edge);
    }
    if (edge.To !== edge.From) {
      const toInfo = infos.get(edge.To);
      if (toInfo != null) {
        toInfo.edges.push(edge);
        toInfo.edgeSignature.add(edge.To, edge);
      }
    }
  }

  guard.Finish();
  return index;
}

// ---------------------------------------------------------------------------
// clusterIncidentEdges
// ---------------------------------------------------------------------------

/**
 * clusterIncidentEdges returns the deduplicated, graph-edge-order-sorted list
 * of edges incident to any member of `cluster`.
 *
 * Pinned reference: grouping/cluster_discovery.go clusterIncidentEdges
 *
 * Work charged: one step per cluster node + one step per incident edge, plus
 * merge-sort approximation steps (mirroring Go's charged loop).
 *
 * @param {import('../graph/cluster.js').Cluster} cluster
 * @param {Map<import('../graph/node.js').Node, ClusterDiscoveryInfo>} infos
 * @param {Map<import('../graph/edge.js').Edge, number>} edgeOrderMap
 * @param {import('../limits/work-guard.js').WorkGuard} guard
 * @returns {Array<import('../graph/edge.js').Edge>}
 */
export function clusterIncidentEdges(cluster, infos, edgeOrderMap, guard) {
  const unique = new Set();
  for (const node of cluster.Nodes) {
    guard.Step();
    const info = infos.get(node);
    if (info == null) {
      throw new Error("TALA AddClusters cannot find cluster member index");
    }
    for (const edge of info.edges) {
      guard.Step();
      unique.add(edge);
    }
  }

  const edges = Array.from(unique);

  // Charge the sort work budget exactly as Go does (merge-sort approximation).
  for (let width = 1; width < edges.length; width *= 2) {
    for (let i = 0; i < edges.length; i++) {
      guard.Step();
    }
    if (width > edges.length / 2) break;
  }

  // Sort by graph-edge-order index.
  edges.sort((a, b) => (edgeOrderMap.get(a) ?? 0) - (edgeOrderMap.get(b) ?? 0));

  guard.Finish();
  return edges;
}
