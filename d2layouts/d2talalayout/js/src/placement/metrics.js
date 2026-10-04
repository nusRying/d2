import { MAX_GRAPH_SIZE } from "../limits/constants.js";

/**
 * occupied reports whether point is the top-left position of a graph node.
 * Returns [node, true] or [null, false].
 *
 * Pinned reference: internal/placement/metrics.go occupied
 */
export function occupied(graph, point) {
  if (graph == null || point == null) {
    return [null, false];
  }
  const px = point.X != null ? point.X : point.x;
  const py = point.Y != null ? point.Y : point.y;
  for (const node of graph.Nodes) {
    if (node.TopLeft != null) {
      const nx = node.TopLeft.X != null ? node.TopLeft.X : node.TopLeft.x;
      const ny = node.TopLeft.Y != null ? node.TopLeft.Y : node.TopLeft.y;
      if (nx === px && ny === py) {
        return [node, true];
      }
    }
  }
  return [null, false];
}

/**
 * withinMaxSize reports whether the graph fits inside the supported placement bounds.
 *
 * Pinned reference: internal/placement/metrics.go withinMaxSize
 */
export function withinMaxSize(graph) {
  const [topLeft, bottomRight] = graph.BoundingBox();
  const width = bottomRight.X - topLeft.X;
  const height = bottomRight.Y - topLeft.Y;
  return width <= MAX_GRAPH_SIZE && height <= MAX_GRAPH_SIZE;
}

/**
 * intersectsOtherNode reports whether the center-to-center segment crosses an
 * unrelated graph node.
 *
 * Pinned reference: internal/placement/metrics.go intersectsOtherNode
 */
export function intersectsOtherNode(graph, first, second) {
  const firstCenter = first.Center();
  const secondCenter = second.Center();
  for (const other of graph.Nodes) {
    if (other === first || other === second) {
      continue;
    }
    if (first.IsDescendantOf(other) || second.IsDescendantOf(other)) {
      continue;
    }
    if (other.IsDescendantOf(first) || other.IsDescendantOf(second)) {
      continue;
    }
    if (other.PassesThrough(firstCenter, secondCenter)) {
      return true;
    }
  }
  return false;
}

/**
 * median computes the coordinate median of node positions.
 *
 * Pinned reference: internal/placement/metrics.go median
 */
export function median(nodes, includeSizes = false) {
  const orderedByX = nodes.slice();
  const orderedByY = nodes.slice();

  orderedByX.sort((left, right) => {
    let leftX = left.TopLeft.X;
    let rightX = right.TopLeft.X;
    if (includeSizes) {
      leftX += left.Width / 2;
      rightX += right.Width / 2;
    }
    if (leftX === rightX) {
      return left.ID < right.ID ? -1 : left.ID > right.ID ? 1 : 0;
    }
    return leftX < rightX ? -1 : 1;
  });

  orderedByY.sort((left, right) => {
    let leftY = left.TopLeft.Y;
    let rightY = right.TopLeft.Y;
    if (includeSizes) {
      leftY += left.Height / 2;
      rightY += right.Height / 2;
    }
    if (leftY === rightY) {
      return left.ID < right.ID ? -1 : left.ID > right.ID ? 1 : 0;
    }
    return leftY < rightY ? -1 : 1;
  });

  const middle = Math.floor(nodes.length / 2);
  if (includeSizes) {
    let medianX = orderedByX[middle].TopLeft.X + orderedByX[middle].Width / 2;
    let medianY = orderedByY[middle].TopLeft.Y + orderedByY[middle].Height / 2;
    if (nodes.length % 2 === 0) {
      medianX =
        (medianX +
          orderedByX[middle - 1].TopLeft.X +
          orderedByX[middle - 1].Width / 2) /
        2;
      medianY =
        (medianY +
          orderedByY[middle - 1].TopLeft.Y +
          orderedByY[middle - 1].Height / 2) /
        2;
    }
    return [
      medianX / nodes[0].Graph.CellSize,
      medianY / nodes[0].Graph.CellSize,
    ];
  }

  let medianX = orderedByX[middle].TopLeft.X + 0.5;
  let medianY = orderedByY[middle].TopLeft.Y + 0.5;
  if (nodes.length % 2 === 0) {
    medianX = (medianX + orderedByX[middle - 1].TopLeft.X) / 2;
    medianY = (medianY + orderedByY[middle - 1].TopLeft.Y) / 2;
  }
  return [medianX, medianY];
}

/**
 * adjacents finds placement neighbors using legacy metrics precedence.
 *
 * Pinned reference: internal/placement/metrics.go adjacents
 */
export function adjacents(node, abductions = null) {
  const result = [];
  const used = new Array(abductions ? abductions.length : 0).fill(false);
  for (const edge of node.Edges) {
    const adjacent = node.Adjacent(edge);
    if (adjacent.TopLeft == null) {
      continue;
    }
    let add = adjacent;
    if (abductions) {
      for (let i = 0; i < abductions.length; i++) {
        if (used[i]) {
          continue;
        }
        const abduction = abductions[i];
        if (
          abduction.CurrentFrom === node &&
          abduction.CurrentTo === adjacent &&
          abduction.OriginallyTo != null
        ) {
          used[i] = true;
          add = abduction.OriginallyTo;
          break;
        }
        if (
          abduction.CurrentFrom === adjacent &&
          abduction.CurrentTo === node &&
          abduction.OriginallyFrom != null
        ) {
          used[i] = true;
          add = abduction.OriginallyFrom;
          break;
        }
      }
    }
    result.push(add);
  }
  if (result.length !== 0) {
    return result;
  }

  for (let near of node.OrderedNears()) {
    if (
      near.Cluster &&
      (typeof near.Cluster.IsActive === "function"
        ? near.Cluster.IsActive()
        : near.Cluster.isActive())
    ) {
      near = near.Cluster.Vessel;
    } else if (
      near.Sequence &&
      (typeof near.Sequence.IsActive === "function"
        ? near.Sequence.IsActive()
        : near.Sequence.isActive())
    ) {
      near = near.Sequence.Vessel;
    }
    if (node.Graph && node.Graph.NodeToTree && node.Graph.NodeToTree.has(near)) {
      let tree = node.Graph.NodeToTree.get(near);
      while (tree.Parent != null) {
        tree = tree.Parent;
      }
      near = tree.sentinelNode();
    }
    if (near.TopLeft != null && near.IsDescendantOf(node.Container)) {
      result.push(near);
    }
  }
  if (result.length !== 0) {
    return result;
  }

  let nears = [];
  if (
    node.IsClusterVessel &&
    node.IsClusterVessel() &&
    node.Graph &&
    node.Graph.Clusters
  ) {
    const cluster = node.Graph.Clusters.get(node);
    if (cluster && cluster.Nodes) {
      for (const child of cluster.Nodes) {
        nears = nears.concat(child.OrderedNears());
      }
    }
  }
  if (node.Graph && node.Graph.Sequences && node.Graph.Sequences.has(node)) {
    const sequence = node.Graph.Sequences.get(node);
    if (sequence && sequence.Nodes) {
      for (const child of sequence.Nodes) {
        nears = nears.concat(child.OrderedNears());
      }
    }
  }
  if (node.Graph && node.Graph.Trees && node.Graph.Trees.has(node)) {
    const trees = node.Graph.Trees.get(node) || [];
    for (const tree of trees) {
      const queue = [tree];
      while (queue.length > 0) {
        const current = queue.shift();
        nears = nears.concat(current.Node.OrderedNears());
        if (current.Children) {
          queue.push(...current.Children);
        }
      }
    }
  }
  for (let near of nears) {
    let add = near;
    if (
      near.Cluster &&
      (typeof near.Cluster.IsActive === "function"
        ? near.Cluster.IsActive()
        : near.Cluster.isActive())
    ) {
      add = near.Cluster.Vessel;
    } else if (
      near.Sequence &&
      (typeof near.Sequence.IsActive === "function"
        ? near.Sequence.IsActive()
        : near.Sequence.isActive())
    ) {
      add = near.Sequence.Vessel;
    }
    if (node.Graph && node.Graph.NodeToTree && node.Graph.NodeToTree.has(add)) {
      let tree = node.Graph.NodeToTree.get(add);
      while (tree.Parent != null) {
        tree = tree.Parent;
      }
      add = tree.sentinelNode();
    }
    if (add.TopLeft != null) {
      result.push(add);
    }
  }
  return result;
}

/**
 * medianToNeighbors approximates the two-dimensional geometric median of a
 * node's currently positioned placement neighbors.
 *
 * Pinned reference: internal/placement/metrics.go medianToNeighbors
 */
export function medianToNeighbors(node, includeSizes = false, abductions = null) {
  return median(adjacents(node, abductions), includeSizes);
}
