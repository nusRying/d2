/**
 * Atomic AddClusters orchestration — Slice 15 of the D2 TALA JS migration.
 *
 * Pinned Go reference:
 *   d2layouts/d2talalayout/internal/grouping/clusters.go
 */

import { goRound } from "../geometry/math.js";
import { GoRand } from "../random/go-math-rand.js";
import { INT64_MAX } from "../limits/constants.js";
import { ensureTransactionWorkGuard } from "../limits/transaction-guard.js";
import { Cluster, ClusterArrangement, flipArrangement } from "../graph/cluster.js";
import { newGraphStateSnapshot, restoreGraphState } from "../graph/graph-state.js";
import { validateEngineGraph } from "../graph/topology-preflight.js";
import {
  buildClusterDiscoveryIndex,
  clusterIncidentEdges,
  clusterIsDescendantOfGuarded,
} from "./cluster-discovery.js";
import {
  createVessel,
  addCluster,
  abductClusterEdges,
} from "./clusters-mutation.js";

/**
 * Calculates average width and height of all cluster nodes rounded to nearest integers.
 * Natural arithmetic: empty cluster produces [NaN, NaN].
 *
 * @param {Cluster} cluster
 * @returns {[number, number]}
 */
export function averageClusterDimensions(cluster) {
  let width = 0;
  let height = 0;
  const nodes = cluster.Nodes || [];
  for (const node of nodes) {
    width += node.Width;
    height += node.Height;
  }
  const count = nodes.length;
  const w = goRound(width / count);
  const h = goRound(height / count);
  return [w, h];
}

/**
 * Selects the cluster axis from node dimensions. Randomness is consumed
 * only for square clusters (or empty/NaN equality), preserving the engine's seed contract.
 *
 * @param {Cluster} cluster
 * @param {boolean} isConnectedToSequence
 * @param {GoRand} random
 * @returns {string}
 */
export function assignArrangement(cluster, isConnectedToSequence, random) {
  const [averageWidth, averageHeight] = averageClusterDimensions(cluster);
  if (isConnectedToSequence) {
    return ClusterArrangement.Row;
  }
  if (averageWidth > averageHeight) {
    return ClusterArrangement.Column;
  }
  if (averageWidth < averageHeight) {
    return ClusterArrangement.Row;
  }
  if (random.Float64() > 0.5) {
    return ClusterArrangement.Column;
  }
  return ClusterArrangement.Row;
}

export const AssignArrangement = assignArrangement;

/**
 * Calculates the spacing between adjacent cluster members.
 *
 * @param {Cluster} cluster
 * @param {boolean} considerPositions
 * @returns {number}
 */
export function paddingBetween(cluster, considerPositions = false) {
  const [averageWidth, averageHeight] = averageClusterDimensions(cluster);
  let hasIcon = false;
  let maxLabelWidth = 0;
  let maxLabelHeight = 0;
  const nodes = cluster.Nodes || [];
  for (const node of nodes) {
    hasIcon = hasIcon || node.Icon != null;
    if (node.Label != null) {
      maxLabelWidth = Math.max(maxLabelWidth, node.Label.Width ?? 0);
      maxLabelHeight = Math.max(maxLabelHeight, node.Label.Height ?? 0);
    }
  }

  let given;
  if (cluster.Arrangement === ClusterArrangement.Row) {
    given = Math.max(20, Math.ceil(averageWidth) * 0.1);
    if (hasIcon) {
      given = Math.max(given, 2 * 5 + maxLabelWidth);
    }
  } else {
    // For every arrangement other than Row, use the column branch.
    given = Math.max(20, Math.ceil(averageHeight) * 0.1);
    if (hasIcon) {
      given = Math.max(given, 2 * 5 + maxLabelHeight);
    }
  }

  if (considerPositions) {
    let total = 0;
    for (let index = 0; index < nodes.length - 1; index++) {
      total += nodes[index].distanceTo(nodes[index + 1], true);
    }
    const positionedPadding = total / (nodes.length - 1);
    if (positionedPadding > 0) {
      return goRound(Math.min(positionedPadding, given));
    }
  }

  return goRound(given);
}

export const PaddingBetween = paddingBetween;

/**
 * Discovers interchangeable sibling nodes and replaces accepted groups with
 * temporary vessels for node placement.
 *
 * @param {Object} context
 * @param {import('../graph/graph.js').Graph} graph
 * @param {number | bigint} randomSeed
 * @param {GoRand} random
 */
export function addClusters(context, graph, randomSeed, random) {
  if (graph == null) {
    throw new Error("TALA AddClusters requires a graph");
  }
  if (random == null) {
    throw new Error("TALA AddClusters requires a random generator");
  }

  validateEngineGraph(context, "AddClusters", graph);

  const [, guard] = ensureTransactionWorkGuard(context, "AddClustersTransactions");

  const containerOrder = graph.ContainerRDFSOrder(null, guard);

  const stageState = newGraphStateSnapshot({
    CaptureTopology: true,
    CaptureEdgeRoutes: true,
  });
  stageState.updateWithWorkGuard(graph, guard);

  let complete = false;
  try {
    if (graph.Clusters == null) {
      graph.Clusters = new Map();
    } else {
      graph.Clusters.clear();
    }

    const discoveryIndex = buildClusterDiscoveryIndex(graph, containerOrder, guard);
    const infos = discoveryIndex.infos;
    const edgeOrder = discoveryIndex.edgeOrder;

    const reservedIDs = new Set();
    for (const node of graph.Nodes) {
      guard.Step();
      reservedIDs.add(BigInt(node.ID));
    }

    for (const vessel of graph.sequenceOrder()) {
      guard.Step();
      reservedIDs.add(BigInt(vessel.ID));
      const seq = graph.Sequences.get(vessel);
      if (seq && seq.Nodes) {
        for (const node of seq.Nodes) {
          guard.Step();
          reservedIDs.add(BigInt(node.ID));
        }
      }
    }

    const seenTrees = new Set();
    for (const sentinel of graph.treeOrder()) {
      guard.Step();
      if (sentinel != null) {
        reservedIDs.add(BigInt(sentinel.ID));
      }
      const treeList = graph.Trees.get(sentinel) || [];
      const stack = treeList.slice();
      while (stack.length > 0) {
        guard.Step();
        const tree = stack.pop();
        if (tree == null) {
          continue;
        }
        if (seenTrees.has(tree)) {
          continue;
        }
        seenTrees.add(tree);
        if (tree.Node != null) {
          reservedIDs.add(BigInt(tree.Node.ID));
        }
        if (tree.Children) {
          for (const child of tree.Children) {
            stack.push(child);
          }
        }
      }
    }

    const nextVesselID = (candidate) => {
      let curr = BigInt(candidate);
      for (;;) {
        guard.Step();
        if (!reservedIDs.has(curr)) {
          return curr;
        }
        if (curr === INT64_MAX) {
          curr = 0n;
        } else {
          curr += 1n;
        }
      }
    };

    const chargeClusterKernel = (cluster) => {
      const nodes = cluster.Nodes || [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = 0; j < nodes.length; j++) {
          guard.Step();
        }
      }
      for (let width = 1; width < nodes.length; width *= 2) {
        for (let i = 0; i < nodes.length; i++) {
          guard.Step();
        }
        if (width > Math.floor(nodes.length / 2)) {
          break;
        }
      }
      guard.Finish();
    };

    const maybeCreateCluster = (cluster, arrangement) => {
      for (const node of cluster.Nodes) {
        guard.Step();
        for (const edge of node.Edges) {
          guard.Step();
          const adjacent = node.adjacent(edge);
          const isDescendant = clusterIsDescendantOfGuarded(node, adjacent, guard);
          if (isDescendant) {
            return false;
          }
        }
      }

      const candidate = random.Int63();
      const vesselID = nextVesselID(candidate);

      const clusterEdges = clusterIncidentEdges(cluster, infos, edgeOrder, guard);

      chargeClusterKernel(cluster);

      cluster.Arrangement = arrangement;
      cluster.DesiredArrangement = arrangement;
      cluster.Padding = paddingBetween(cluster, false);

      const vessel = createVessel(cluster, vesselID);
      cluster.Vessel = vessel;

      addCluster(graph, cluster);

      guard.Step();

      abductClusterEdges(cluster, clusterEdges, guard);

      discoveryIndex.refreshAfterClusterAbduction(graph, cluster, clusterEdges, guard);

      reservedIDs.add(BigInt(vesselID));
      for (const node of cluster.Nodes) {
        guard.Step();
        reservedIDs.add(BigInt(node.ID));
      }

      return true;
    };

    const maxSizeDiff = 4.0;
    const refreshContainerEstimate = (container) => {
      if (container == null || !container.isContainer) {
        return;
      }
      const info = infos.get(container);
      if (info == null) {
        throw new Error("TALA AddClusters cannot find container discovery index");
      }
      const padding = graph.containerPadding(container, true);
      let childrenWidth = 0;
      let childrenHeight = 0;
      const children = graph.Containers.get(container) || [];
      for (const child of children) {
        guard.Step();
        let childWidth = child.Width;
        let childHeight = child.Height;
        const childInfo = infos.get(child);
        if (childInfo != null) {
          childWidth = childInfo.estimatedWidth;
          childHeight = childInfo.estimatedHeight;
        }
        childrenWidth += childWidth;
        childrenHeight += childHeight;
      }
      info.estimatedWidth = Math.max(
        container.Width,
        childrenWidth + padding.Left() + padding.Right()
      );
      info.estimatedHeight = Math.max(
        container.Height,
        childrenHeight + padding.Top() + padding.Bottom()
      );
      guard.Finish();
    };

    const containers = (containerOrder || []).slice();
    containers.push(null);

    for (const container of containers) {
      guard.Step();
      const rng = new GoRand(randomSeed);
      const children = (graph.Containers.get(container) || []).slice();

      for (const node of children) {
        guard.Step();
        const info = infos.get(node);
        if (info == null) {
          throw new Error("TALA AddClusters cannot find node discovery index");
        }
        if (info.noClustering || node.Cluster != null) {
          continue;
        }
        let connectedToCluster = false;
        for (const edge of node.Edges) {
          guard.Step();
          const adjacent = node.adjacent(edge);
          if (adjacent != null && adjacent.isClusterVessel) {
            connectedToCluster = true;
            break;
          }
        }
        if (connectedToCluster || info.toTableColumn) {
          continue;
        }

        const clusterNodes = [node];
        let isConnectedToSequence = false;

        for (const otherNode of children) {
          guard.Step();
          if (otherNode === node || !otherNode.sameShape(node)) {
            continue;
          }
          const otherInfo = infos.get(otherNode);
          if (otherInfo == null) {
            throw new Error(
              "TALA AddClusters cannot find comparison-node discovery index"
            );
          }
          if (
            otherInfo.noClustering ||
            otherNode.Cluster != null ||
            otherInfo.toTableColumn
          ) {
            continue;
          }

          if (
            maxSizeDiff * otherInfo.estimatedWidth < info.estimatedWidth ||
            maxSizeDiff * info.estimatedWidth < otherInfo.estimatedWidth ||
            maxSizeDiff * otherInfo.estimatedHeight < info.estimatedHeight ||
            maxSizeDiff * info.estimatedHeight < otherInfo.estimatedHeight
          ) {
            continue;
          }

          let sameAdjacentNodes =
            info.neighbors.length > 0 &&
            info.neighbors.length === otherInfo.neighbors.length;
          if (sameAdjacentNodes) {
            for (const adjacentNode of info.neighbors) {
              guard.Step();
              isConnectedToSequence =
                isConnectedToSequence ||
                (adjacentNode != null && adjacentNode.Sequence != null);
              if (!otherInfo.neighborSet.has(adjacentNode)) {
                sameAdjacentNodes = false;
                break;
              }
            }
          }

          if (
            sameAdjacentNodes &&
            info.edgeSignature.matches(otherInfo.edgeSignature)
          ) {
            clusterNodes.push(otherNode);
          }
        }

        if (clusterNodes.length <= 1) {
          continue;
        }

        const cluster = new Cluster({
          Nodes: clusterNodes,
          Container: container,
          Graph: graph,
        });

        for (const clusterNode of clusterNodes) {
          guard.Step();
          if (clusterNode.aspectRatio1()) {
            cluster.FixedSize = true;
            break;
          }
        }

        chargeClusterKernel(cluster);

        const initialArrangement = assignArrangement(
          cluster,
          isConnectedToSequence,
          rng
        );
        const success = maybeCreateCluster(cluster, initialArrangement);
        if (!success) {
          maybeCreateCluster(cluster, flipArrangement(initialArrangement));
        }
      }

      refreshContainerEstimate(container);
    }

    guard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      restoreGraphState(graph, stageState);
    }
  }
}

export const AddClusters = addClusters;
