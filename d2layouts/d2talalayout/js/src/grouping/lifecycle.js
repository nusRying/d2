/**
 * ResetClusters removes inactive vessel metadata so a later layout rediscovers
 * clusters from ordinary nodes and edges.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/lifecycle.go
 *
 * @param {import("../graph/graph.js").Graph} graph
 */
export function resetClusters(graph) {
  if (graph.Clusters == null || graph.Clusters.size === 0) {
    return;
  }

  const bulkFilter = graph.Clusters.size > 1;
  let singleRetiredVessel = null;
  let retiredVesselCount = 0;

  for (const [vessel, cluster] of graph.Clusters.entries()) {
    if (cluster == null) {
      continue;
    }

    if (cluster.EdgeAbductions) {
      for (const abduction of cluster.EdgeAbductions) {
        if (abduction == null || abduction.Edge == null) {
          continue;
        }
        if (abduction.OriginallyFrom != null) {
          abduction.Edge.reconnect(abduction.OriginallyFrom, false);
        }
        if (abduction.OriginallyTo != null) {
          abduction.Edge.reconnect(abduction.OriginallyTo, true);
        }
      }
    }

    if (cluster.Nodes) {
      for (const node of cluster.Nodes) {
        if (node != null && node.Cluster === cluster) {
          node.Cluster = null;
        }
        if (node != null && node.Nears != null) {
          node.Nears.delete(vessel);
        }
      }
    }

    if (vessel == null) {
      continue;
    }

    if (vessel.Nears != null) {
      for (const near of vessel.Nears) {
        if (near != null && near.Nears != null) {
          near.Nears.delete(vessel);
        }
      }
    }
    vessel.Nears = new Set();

    if (bulkFilter) {
      retiredVesselCount++;
      if (retiredVesselCount === 1) {
        singleRetiredVessel = vessel;
      }
    } else {
      // In-place stable compaction on graph.Nodes
      if (Array.isArray(graph.Nodes)) {
        let writeIdx = 0;
        for (let i = 0; i < graph.Nodes.length; i++) {
          const node = graph.Nodes[i];
          if (node !== vessel) {
            graph.Nodes[writeIdx++] = node;
          }
        }
        graph.Nodes.length = writeIdx;
      }

      // In-place stable compaction on each non-null container child array
      if (graph.Containers) {
        for (const [container, children] of graph.Containers.entries()) {
          if (Array.isArray(children)) {
            let writeIdx = 0;
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              if (child !== vessel) {
                children[writeIdx++] = child;
              }
            }
            children.length = writeIdx;
          }
        }
      }
    }

    vessel.Container = null;
    vessel.Graph = null;
    vessel.unmarkClusterVessel();
  }

  if (!bulkFilter) {
    graph.Clusters.clear();
    return;
  }

  if (retiredVesselCount === 0) {
    graph.Clusters.clear();
    return;
  }

  if (retiredVesselCount === 1) {
    if (Array.isArray(graph.Nodes)) {
      let writeIdx = 0;
      for (let i = 0; i < graph.Nodes.length; i++) {
        const node = graph.Nodes[i];
        if (node !== singleRetiredVessel) {
          graph.Nodes[writeIdx++] = node;
        }
      }
      graph.Nodes.length = writeIdx;
    }

    if (graph.Containers) {
      for (const [container, children] of graph.Containers.entries()) {
        if (Array.isArray(children)) {
          let writeIdx = 0;
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child !== singleRetiredVessel) {
              children[writeIdx++] = child;
            }
          }
          children.length = writeIdx;
        }
      }
    }

    graph.Clusters.clear();
    return;
  }

  // The loop above detaches every removable vessel. Check that cheap marker
  // before consulting Clusters so ordinary survivors avoid a map lookup.
  if (Array.isArray(graph.Nodes)) {
    let writeIdx = 0;
    for (let i = 0; i < graph.Nodes.length; i++) {
      const node = graph.Nodes[i];
      const remove = node != null && node.Graph == null && graph.Clusters.get(node) != null;
      if (!remove) {
        graph.Nodes[writeIdx++] = node;
      }
    }
    graph.Nodes.length = writeIdx;
  }

  if (graph.Containers) {
    for (const [container, children] of graph.Containers.entries()) {
      if (Array.isArray(children)) {
        let writeIdx = 0;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const remove = child != null && child.Graph == null && graph.Clusters.get(child) != null;
          if (!remove) {
            children[writeIdx++] = child;
          }
        }
        children.length = writeIdx;
      }
    }
  }

  graph.Clusters.clear();
}

/**
 * Pinned PascalCase alias.
 */
export const ResetClusters = resetClusters;

/**
 * Cleanup restores cluster and sequence members after node placement and
 * retires the temporary vessels while retaining rediscovery metadata.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/lifecycle.go
 *
 * @param {import("../graph/graph.js").Graph} graph
 */
export function cleanup(graph) {
  for (const key of graph.ClusterOrder()) {
    const cluster = graph.Clusters.get(key);
    cluster.ArrangeClusterNodes();
    for (const node of cluster.Nodes ?? []) {
      graph.AddNewNodeToContainer(cluster.Container, node);
    }
    for (const abduction of cluster.EdgeAbductions ?? []) {
      if (abduction.OriginallyFrom != null) {
        abduction.Edge.Reconnect(abduction.OriginallyFrom, false);
      }
      if (abduction.OriginallyTo != null) {
        abduction.Edge.Reconnect(abduction.OriginallyTo, true);
      }
    }
    if (cluster.Vessel.Nears != null && cluster.Vessel.Nears.size !== 0) {
      for (const near of cluster.Vessel.OrderedNears()) {
        near.Nears.delete(cluster.Vessel);
        for (const node of cluster.Nodes ?? []) {
          near.AddNear(node);
        }
      }
      cluster.Vessel.Nears = new Set();
    }
    graph.removeNode(cluster.Vessel);
    const updated = [];
    for (const child of graph.Containers.get(cluster.Container) ?? []) {
      if (child !== cluster.Vessel) {
        updated.push(child);
      }
    }
    graph.Containers.set(cluster.Container, updated);
    cluster.Vessel.Container = null;
    cluster.Vessel.Graph = null;
  }

  for (const vessel of graph.SequenceOrder()) {
    const sequence = graph.Sequences.get(vessel);
    sequence.ArrangeSteps();
    for (const node of sequence.Nodes ?? []) {
      graph.AddNewNodeToContainer(sequence.Container, node);
    }
    for (const abduction of sequence.EdgeAbductions ?? []) {
      if (abduction.OriginallyFrom != null) {
        abduction.Edge.Reconnect(abduction.OriginallyFrom, false);
      }
      if (abduction.OriginallyTo != null) {
        abduction.Edge.Reconnect(abduction.OriginallyTo, true);
      }
    }
    if (sequence.Vessel.Nears != null && sequence.Vessel.Nears.size !== 0) {
      for (const near of sequence.Vessel.OrderedNears()) {
        near.Nears.delete(sequence.Vessel);
        for (const node of sequence.Nodes ?? []) {
          near.AddNear(node);
        }
      }
      sequence.Vessel.Nears = new Set();
    }
    graph.removeNode(vessel);
    const updated = [];
    for (const child of graph.Containers.get(sequence.Container) ?? []) {
      if (child !== vessel) {
        updated.push(child);
      }
    }
    graph.Containers.set(sequence.Container, updated);
    sequence.Vessel.Container = null;
    sequence.Vessel.Graph = null;
  }

  for (const node of graph.Nodes) {
    node.HerdAssignment = null;
  }
}

/**
 * Pinned PascalCase alias.
 */
export const Cleanup = cleanup;
