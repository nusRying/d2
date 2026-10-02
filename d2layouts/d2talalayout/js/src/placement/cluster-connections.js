/**
 * clusterExternalConnectedNodes returns the positioned endpoints outside the
 * cluster that remain in the cluster nodes' current placement graph. The
 * edge-abduction order is significant: callers use the stable first-seen order
 * when comparing opposite-side placements.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/cluster_connections.go
 *
 * @param {import("../graph/cluster.js").Cluster} cluster
 * @returns {Array<import("../graph/node.js").Node>}
 */
export function clusterExternalConnectedNodes(cluster) {
  const currentGraph = cluster.Nodes[0].Graph;
  const set = new Set();
  const externalNodes = [];

  const abductions = cluster.EdgeAbductions ?? [];

  for (const edgeAbduction of abductions) {
    if (edgeAbduction.OriginallyFrom == null && edgeAbduction.OriginallyTo != null) {
      const candidate = edgeAbduction.CurrentFrom;
      if (candidate.TopLeft != null && candidate.Graph === currentGraph) {
        if (!set.has(candidate)) {
          externalNodes.push(candidate);
          set.add(candidate);
        }
      }
    } else if (edgeAbduction.OriginallyTo == null && edgeAbduction.OriginallyFrom != null) {
      const candidate = edgeAbduction.CurrentTo;
      if (candidate.TopLeft != null && candidate.Graph === currentGraph) {
        if (!set.has(candidate)) {
          externalNodes.push(candidate);
          set.add(candidate);
        }
      }
    }
  }

  return externalNodes;
}

export const ClusterExternalConnectedNodes = clusterExternalConnectedNodes;
