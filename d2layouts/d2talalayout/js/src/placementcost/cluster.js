/**
 * clusterExactlyTwoExternalConnectedNodes finds if a cluster has exactly two
 * external connected nodes within its current graph.
 * Pinned Go: placementcost.clusterExactlyTwoExternalConnectedNodes
 *
 * @param {import('../graph/cluster.js').Cluster} cluster
 * @returns {[import('../graph/node.js').Node|null, import('../graph/node.js').Node|null, boolean]}
 */
export function clusterExactlyTwoExternalConnectedNodes(cluster) {
  if (cluster == null || !cluster.Nodes || cluster.Nodes.length === 0) {
    return [null, null, false];
  }
  const currentGraph = cluster.Nodes[0].Graph;
  let first = null;
  let second = null;
  let moreThanTwo = false;
  const edgeAbductions = cluster.EdgeAbductions || [];
  for (const edgeAbduction of edgeAbductions) {
    let externalNode = null;
    if (edgeAbduction.OriginallyFrom == null && edgeAbduction.OriginallyTo != null) {
      // edge coming into cluster
      if (edgeAbduction.CurrentFrom != null && edgeAbduction.CurrentFrom.TopLeft != null && edgeAbduction.CurrentFrom.Graph === currentGraph) {
        externalNode = edgeAbduction.CurrentFrom;
      }
    } else if (edgeAbduction.OriginallyTo == null && edgeAbduction.OriginallyFrom != null) {
      // edge exiting from cluster
      if (edgeAbduction.CurrentTo != null && edgeAbduction.CurrentTo.TopLeft != null && edgeAbduction.CurrentTo.Graph === currentGraph) {
        externalNode = edgeAbduction.CurrentTo;
      }
    }
    if (externalNode == null || externalNode === first || externalNode === second) {
      continue;
    }
    if (first == null) {
      first = externalNode;
      continue;
    }
    if (second == null) {
      second = externalNode;
      continue;
    }
    moreThanTwo = true;
  }
  return [first, second, !moreThanTwo && first != null && second != null];
}
