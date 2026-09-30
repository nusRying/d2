import { Node } from "../graph/node.js";
import { Point } from "../geometry/point.js";
import { ClusterArrangement } from "../graph/cluster.js";
import { EdgeAbduction } from "../graph/edge-abduction.js";

/**
 * createVessel builds the temporary placement node representing a cluster.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/clusters.go
 */
export function createVessel(cluster, vesselID) {
  let minimumX = Infinity;
  let minimumY = Infinity;

  for (const node of cluster.Nodes) {
    if (node.TopLeft != null) {
      minimumX = Math.min(minimumX, node.TopLeft.X);
      minimumY = Math.min(minimumY, node.TopLeft.Y);
    }
  }

  const vessel = new Node(vesselID, 0, 0);
  vessel.setClusterVessel(true);
  cluster.resize(vessel);

  if (cluster.Arrangement === ClusterArrangement.Row) {
    if (Number.isFinite(minimumX) && Number.isFinite(minimumY)) {
      cluster.Nodes.sort((a, b) => {
        if (a.TopLeft.X < b.TopLeft.X) return -1;
        if (a.TopLeft.X > b.TopLeft.X) return 1;
        return 0;
      });
      vessel.TopLeft = new Point(minimumX, minimumY);
    }
  }

  if (cluster.Arrangement === ClusterArrangement.Column) {
    if (Number.isFinite(minimumX) && Number.isFinite(minimumY)) {
      cluster.Nodes.sort((a, b) => {
        if (a.TopLeft.Y < b.TopLeft.Y) return -1;
        if (a.TopLeft.Y > b.TopLeft.Y) return 1;
        return 0;
      });
      vessel.TopLeft = new Point(minimumX, minimumY);
    }
  }

  return vessel;
}

export const CreateVessel = createVessel;

/**
 * addCluster installs a discovered cluster and its temporary vessel into the
 * mutable layout graph.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/clusters.go
 */
export function addCluster(graph, cluster) {
  graph.addNewNodeToContainer(cluster.Container, cluster.Vessel);
  for (const node of cluster.Nodes) {
    node.Cluster = cluster;
  }

  const updatedContainerNodes = [];
  const containerNodes = graph.Containers.get(cluster.Container);
  if (containerNodes) {
    for (const child of containerNodes) {
      if (child.Cluster !== cluster) {
        updatedContainerNodes.push(child);
      }
    }
  }
  graph.Containers.set(cluster.Container, updatedContainerNodes);

  for (const node of cluster.Nodes) {
    graph.removeNode(node);
    node.Container = null;
  }

  graph.Clusters.set(cluster.Vessel, cluster);
}

export const AddCluster = addCluster;

/**
 * abductClusterEdges transfers incident edges from cluster members to the cluster vessel.
 * This helper is mutating and nontransactional; rollback is owned by the caller.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/clusters.go
 */
export function abductClusterEdges(cluster, edges, guard) {
  const abductions = [];
  for (const edge of edges) {
    guard.step();

    if (edge.From.Cluster === cluster) {
      const charge = edge.From.Edges.length + cluster.Vessel.Edges.length;
      for (let i = 0; i < charge; i++) {
        guard.step();
      }
      abductions.push(
        new EdgeAbduction({
          Edge: edge,
          OriginallyFrom: edge.From,
          CurrentFrom: cluster.Vessel,
          CurrentTo: edge.To,
        })
      );
      edge.reconnect(cluster.Vessel, false);
    }

    if (edge.To.Cluster === cluster) {
      const charge = edge.To.Edges.length + cluster.Vessel.Edges.length;
      for (let i = 0; i < charge; i++) {
        guard.step();
      }
      abductions.push(
        new EdgeAbduction({
          Edge: edge,
          OriginallyTo: edge.To,
          CurrentTo: cluster.Vessel,
          CurrentFrom: edge.From,
        })
      );
      edge.reconnect(cluster.Vessel, true);
    }
  }

  cluster.EdgeAbductions = abductions;
  return guard.finish();
}
