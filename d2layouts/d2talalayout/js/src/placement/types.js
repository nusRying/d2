import { goPow2 } from '../geometry/go-math.js';
import { MAX_ENGINE_NODES, MAX_ENGINE_WORK_UNITS } from "../limits/constants.js";
import { WorkGuard } from "../limits/work-guard.js";
import { goRound } from "../geometry/math.js";

/**
 * PointerSnapshot captures a point reference and its coordinate values,
 * restoring the original point reference and its coordinates on rollback.
 *
 * Pinned reference: internal/placement/types.go pointerSnapshot
 */
export class PointerSnapshot {
  constructor(point) {
    if (point == null) {
      this.point = null;
      this.x = 0;
      this.y = 0;
    } else {
      this.point = point;
      this.x = point.X != null ? point.X : point.x;
      this.y = point.Y != null ? point.Y : point.y;
    }
  }

  restore() {
    if (this.point == null) {
      return null;
    }
    this.point.X = this.x;
    this.point.Y = this.y;
    if ("x" in this.point) this.point.x = this.x;
    if ("y" in this.point) this.point.y = this.y;
    return this.point;
  }
}

export function snapshotPointer(pointer) {
  return new PointerSnapshot(pointer);
}

export function restoreNodePositions(snapshots) {
  if (!snapshots) return;
  for (const snapshot of snapshots) {
    snapshot.node.TopLeft = snapshot.topLeft.restore();
  }
}

/**
 * snapshotNodePositionsContext captures the current TopLeft pointer identity
 * and coordinate values for all nodes in the given hierarchy.
 *
 * Pinned reference: internal/placement/types.go snapshotNodePositionsContext
 */
export function snapshotNodePositionsContext(ctx, location, nodes) {
  const guard = new WorkGuard(ctx, location, MAX_ENGINE_WORK_UNITS);
  const seen = new Set();
  const snapshots = [];
  const queue = [];

  const enqueue = (node, graph) => {
    if (node == null) {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${location} unique node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    }
    guard.Step();
    seen.add(node);
    snapshots.push({
      node,
      topLeft: snapshotPointer(node.TopLeft),
    });
    queue.push({ node, graph });
  };

  for (const node of nodes) {
    if (node != null) {
      enqueue(node, node.Graph);
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.graph == null) {
      continue;
    }
    const node = current.node;
    const isContainer =
      typeof node.IsContainer === "function"
        ? node.IsContainer()
        : Boolean(node.isContainer);
    if (isContainer) {
      const children =
        current.graph.Containers instanceof Map
          ? current.graph.Containers.get(node) || []
          : current.graph.Containers[node] || [];
      for (const child of children) {
        enqueue(child, current.graph);
      }
    }
    const isClusterVessel =
      typeof node.IsClusterVessel === "function"
        ? node.IsClusterVessel()
        : Boolean(node.isClusterVessel);
    if (isClusterVessel) {
      const cluster =
        current.graph.Clusters instanceof Map
          ? current.graph.Clusters.get(node)
          : current.graph.Clusters[node];
      if (cluster && cluster.Nodes) {
        for (const child of cluster.Nodes) {
          enqueue(child, current.graph);
        }
      }
    }
    const sequence =
      current.graph.Sequences instanceof Map
        ? current.graph.Sequences.get(node)
        : current.graph.Sequences[node];
    if (sequence && sequence.Nodes) {
      for (const child of sequence.Nodes) {
        enqueue(child, current.graph);
      }
    }
  }

  guard.Finish();
  return snapshots;
}

export function nonNilEquals(first, second) {
  if (first == null || second == null) return false;
  const x1 = first.X != null ? first.X : first.x;
  const y1 = first.Y != null ? first.Y : first.y;
  const x2 = second.X != null ? second.X : second.x;
  const y2 = second.Y != null ? second.Y : second.y;
  return x1 === x2 && y1 === y2;
}

export function roundToPreviousCellSize(value, cellSize) {
  return Math.floor(value / cellSize) * cellSize;
}

export function roundToNearestCellSize(value, cellSize) {
  return goRound(value / cellSize) * cellSize;
}

export function numPointsWithinManhattanDistance(distance) {
  return Math.ceil(goPow2(distance) + goPow2(distance + 1));
}
