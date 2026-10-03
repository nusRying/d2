// Slice 46 — private port of layoutgraph Cluster.SyncGeometryWithWork.
//
// Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/cluster.go
//   (SyncGeometryWithWork, resizeWithWork, maximumsWithWork,
//   arrangeNodesWithWork) and group_geometry.go (ClusterGeometryWork).
//
// The approved JS Cluster class only exposes the unmetered SyncGeometry, so
// BinPack's metered cluster synchronization is ported here instead of adding
// a member to the shared class. `work` provides Step/Finish (throwing) plus
// MoveNodeWithChildren and PositionContainerChildren.

import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { goMax, invariantError } from './go-support.js';

function maximumsWithWork(cluster, work) {
  let maxWidth = 0.0;
  let maxHeight = 0.0;
  const nodes = cluster.Nodes ?? [];
  for (const node of nodes) {
    work.Step();
    if (node == null) {
      throw invariantError('cluster contains a nil node');
    }
    maxWidth = goMax(maxWidth, node.Width);
  }
  for (const node of nodes) {
    work.Step();
    maxHeight = goMax(maxHeight, node.Height);
  }
  work.Finish();
  return [maxWidth, maxHeight];
}

function resizeWithWork(cluster, vessel, work) {
  if (cluster == null || vessel == null) {
    throw invariantError('cluster is missing its vessel');
  }
  const nodes = cluster.Nodes ?? [];
  if (!cluster.FixedSize) {
    const [nodeWidth, nodeHeight] = maximumsWithWork(cluster, work);
    for (const node of nodes) {
      work.Step();
      node.Width = nodeWidth;
      node.Height = nodeHeight;
    }
  }
  const [nodeWidth, nodeHeight] = maximumsWithWork(cluster, work);
  const padding = cluster.Padding ?? 0;
  if (cluster.Arrangement === ClusterArrangement.Row) {
    vessel.Width = nodeWidth * nodes.length + padding * (nodes.length - 1);
    vessel.Height = nodeHeight;
  }
  if (cluster.Arrangement === ClusterArrangement.Column) {
    vessel.Width = nodeWidth;
    vessel.Height = nodeHeight * nodes.length + padding * (nodes.length - 1);
  }
}

function arrangeNodesWithWork(cluster, work) {
  const vessel = cluster.Vessel;
  if (vessel.TopLeft == null) {
    work.Finish();
    return;
  }
  const nodes = cluster.Nodes ?? [];
  const padding = cluster.Padding ?? 0;
  if (cluster.Arrangement === ClusterArrangement.Row) {
    let position = vessel.TopLeft.X;
    const vesselCenter = vessel.TopLeft.Y + vessel.Height / 2;
    for (const node of nodes) {
      work.Step();
      if (node.TopLeft != null) {
        const dx = position - node.TopLeft.X;
        const dy = goRound(vesselCenter - (node.TopLeft.Y + node.Height / 2));
        work.MoveNodeWithChildren(node, dx, dy);
      } else {
        node.TopLeft = new Point(position, goRound(vesselCenter - node.Height / 2));
        work.PositionContainerChildren(node);
      }
      position += node.Width + padding;
    }
  }
  if (cluster.Arrangement === ClusterArrangement.Column) {
    let position = vessel.TopLeft.Y;
    const vesselCenter = vessel.TopLeft.X + vessel.Width / 2;
    for (const node of nodes) {
      work.Step();
      if (node.TopLeft != null) {
        const dx = goRound(vesselCenter - (node.TopLeft.X + node.Width / 2));
        const dy = position - node.TopLeft.Y;
        work.MoveNodeWithChildren(node, dx, dy);
      } else {
        node.TopLeft = new Point(goRound(vesselCenter - node.Width / 2), position);
        work.PositionContainerChildren(node);
      }
      position += node.Height + padding;
    }
  }
  work.Finish();
}

/** Cluster.SyncGeometryWithWork */
export function syncClusterGeometryWithWork(cluster, work) {
  if (work == null) {
    throw invariantError('cluster geometry requires work accounting');
  }
  work.Step();
  if (cluster == null || cluster.Vessel == null) {
    throw invariantError('cluster is missing its vessel');
  }
  resizeWithWork(cluster, cluster.Vessel, work);
  arrangeNodesWithWork(cluster, work);
}
