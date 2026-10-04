import { Node } from "../graph/node.js";
import { Point } from "../geometry/point.js";
import { ClusterArrangement } from "../graph/cluster.js";
import { EdgeAbduction } from "../graph/edge-abduction.js";

/**
 * Localized Go 1.27 sort.Slice-compatible sorting helper (pdqsort).
 * Pinned reference: Go src/sort/zsortfunc.go & src/sort/slice.go
 * Used only by createVessel to guarantee bit-for-bit identical permutation
 * on equal element tie sets without relying on JavaScript Array.sort stability.
 */
function goSortSlice(data, less) {
  const swap = (i, j) => {
    const tmp = data[i];
    data[i] = data[j];
    data[j] = tmp;
  };
  const length = data.length;
  if (length <= 1) return data;
  const limit = 32 - Math.clz32(length);

  const insertionSort = (a, b) => {
    for (let i = a + 1; i < b; i++) {
      for (let j = i; j > a && less(data[j], data[j - 1]); j--) {
        swap(j, j - 1);
      }
    }
  };

  const siftDown = (lo, hi, first) => {
    let root = lo;
    while (true) {
      let child = 2 * root + 1;
      if (child >= hi) break;
      if (child + 1 < hi && less(data[first + child], data[first + child + 1])) {
        child++;
      }
      if (!less(data[first + root], data[first + child])) return;
      swap(first + root, first + child);
      root = child;
    }
  };

  const heapSort = (a, b) => {
    const first = a;
    const lo = 0;
    const hi = b - a;
    for (let i = Math.floor((hi - 1) / 2); i >= 0; i--) {
      siftDown(i, hi, first);
    }
    for (let i = hi - 1; i >= 0; i--) {
      swap(first, first + i);
      siftDown(lo, i, first);
    }
  };

  const order2 = (a, b, swaps) => {
    if (less(data[b], data[a])) {
      swaps.count++;
      return [b, a];
    }
    return [a, b];
  };

  const median = (a, b, c, swaps) => {
    [a, b] = order2(a, b, swaps);
    [b, c] = order2(b, c, swaps);
    [a, b] = order2(a, b, swaps);
    return b;
  };

  const medianAdjacent = (a, swaps) => {
    return median(a - 1, a, a + 1, swaps);
  };

  const choosePivot = (a, b) => {
    const shortestNinther = 50;
    const maxSwaps = 4 * 3;
    const l = b - a;
    const swaps = { count: 0 };
    let i = a + Math.floor(l / 4) * 1;
    let j = a + Math.floor(l / 4) * 2;
    let k = a + Math.floor(l / 4) * 3;

    if (l >= 8) {
      if (l >= shortestNinther) {
        i = medianAdjacent(i, swaps);
        j = medianAdjacent(j, swaps);
        k = medianAdjacent(k, swaps);
      }
      j = median(i, j, k, swaps);
    }

    let hint = 2; // unknownHint
    if (swaps.count === 0) hint = 0; // increasingHint
    else if (swaps.count === maxSwaps) hint = 1; // decreasingHint
    return { pivot: j, hint };
  };

  const reverseRange = (a, b) => {
    let i = a;
    let j = b - 1;
    while (i < j) {
      swap(i, j);
      i++;
      j--;
    }
  };

  const partialInsertionSort = (a, b) => {
    const maxSteps = 5;
    const shortestShifting = 50;
    let i = a + 1;
    for (let j = 0; j < maxSteps; j++) {
      while (i < b && !less(data[i], data[i - 1])) {
        i++;
      }
      if (i === b) return true;
      if (b - a < shortestShifting) return false;
      swap(i, i - 1);
      if (i - a >= 2) {
        for (let j = i - 1; j >= 1; j--) {
          if (!less(data[j], data[j - 1])) break;
          swap(j, j - 1);
        }
      }
      if (b - i >= 2) {
        for (let j = i + 1; j < b; j++) {
          if (!less(data[j], data[j - 1])) break;
          swap(j, j - 1);
        }
      }
    }
    return false;
  };

  const partition = (a, b, pivot) => {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    while (i <= j && less(data[i], data[a])) i++;
    while (i <= j && !less(data[j], data[a])) j--;
    if (i > j) {
      swap(j, a);
      return { newpivot: j, alreadyPartitioned: true };
    }
    swap(i, j);
    i++;
    j--;
    while (true) {
      while (i <= j && less(data[i], data[a])) i++;
      while (i <= j && !less(data[j], data[a])) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    swap(j, a);
    return { newpivot: j, alreadyPartitioned: false };
  };

  const partitionEqual = (a, b, pivot) => {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    while (true) {
      while (i <= j && !less(data[a], data[i])) i++;
      while (i <= j && less(data[a], data[j])) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    return i;
  };

  const breakPatterns = (a, b) => {
    const length = b - a;
    if (length >= 8) {
      let r = BigInt(length);
      const nextR = () => {
        r ^= (r << 13n) & 0xffffffffffffffffn;
        r ^= (r >> 7n) & 0xffffffffffffffffn;
        r ^= (r << 17n) & 0xffffffffffffffffn;
        return r;
      };
      const shift = 32 - Math.clz32(length);
      const modulus = 1 << shift;
      const mid = a + Math.floor(length / 4) * 2;
      for (let idx = mid - 1; idx <= mid + 1; idx++) {
        let other = Number(nextR() & BigInt(modulus - 1));
        if (other >= length) other -= length;
        swap(idx, a + other);
      }
    }
  };

  const pdqsort = (a, b, limit) => {
    const maxInsertion = 12;
    let wasBalanced = true;
    let wasPartitioned = true;

    while (true) {
      const length = b - a;
      if (length <= maxInsertion) {
        insertionSort(a, b);
        return;
      }
      if (limit === 0) {
        heapSort(a, b);
        return;
      }
      if (!wasBalanced) {
        breakPatterns(a, b);
        limit--;
      }

      let { pivot, hint } = choosePivot(a, b);
      if (hint === 1) { // decreasingHint
        reverseRange(a, b);
        pivot = (b - 1) - (pivot - a);
        hint = 0; // increasingHint
      }

      if (wasBalanced && wasPartitioned && hint === 0) {
        if (partialInsertionSort(a, b)) return;
      }

      if (a > 0 && !less(data[a - 1], data[pivot])) {
        const mid = partitionEqual(a, b, pivot);
        a = mid;
        continue;
      }

      const { newpivot: mid, alreadyPartitioned } = partition(a, b, pivot);
      wasPartitioned = alreadyPartitioned;
      const leftLen = mid - a;
      const rightLen = b - mid;
      const balanceThreshold = Math.floor(length / 8);

      if (leftLen < rightLen) {
        wasBalanced = leftLen >= balanceThreshold;
        pdqsort(a, mid, limit);
        a = mid + 1;
      } else {
        wasBalanced = rightLen >= balanceThreshold;
        pdqsort(mid + 1, b, limit);
        b = mid;
      }
    }
  };

  pdqsort(0, length, limit);
  return data;
}

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
    if (minimumX !== Number.POSITIVE_INFINITY && minimumY !== Number.POSITIVE_INFINITY) {
      goSortSlice(cluster.Nodes, (a, b) => a.TopLeft.X < b.TopLeft.X);
      vessel.TopLeft = new Point(minimumX, minimumY);
    }
  }

  if (cluster.Arrangement === ClusterArrangement.Column) {
    if (minimumX !== Number.POSITIVE_INFINITY && minimumY !== Number.POSITIVE_INFINITY) {
      goSortSlice(cluster.Nodes, (a, b) => a.TopLeft.Y < b.TopLeft.Y);
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
