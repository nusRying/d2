import { MAX_ENGINE_NODES } from '../limits/constants.js';
import { optimizerCanMove, optimizerDoesOverlap, optimizerIsOccupied } from './optimizer-support.js';

export const OPTIMIZER_SPATIAL_INDEX_MIN_NODES = 96;

export function optimizerIndexFinite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function optimizerIndexFiniteBox(node) {
  if (node == null || node.TopLeft == null || node.Width < 0 || node.Height < 0) {
    return false;
  }
  return (
    optimizerIndexFinite(node.TopLeft.X) &&
    optimizerIndexFinite(node.TopLeft.Y) &&
    optimizerIndexFinite(node.Width) &&
    optimizerIndexFinite(node.Height) &&
    optimizerIndexFinite(node.TopLeft.X + node.Width) &&
    optimizerIndexFinite(node.TopLeft.Y + node.Height)
  );
}

/**
 * OptimizerSpatialIndex provides fast 2D spatial candidate queries for the sized optimizer.
 * Pinned Go: placement.optimizerSpatialIndex
 */
export class OptimizerSpatialIndex {
  constructor() {
    this.graph = null;
    this.nodeCount = 0;
    this.occupancyUsable = false;
    this.spatialUsable = false;
    this.entries = [];
    this.maxRight = [];
    this.candidates = [];
    this.occupied = new Map();
    this.occupancyGeneration = 0n;
  }

  rebuild(g, guard) {
    if (g == null) {
      throw new Error(`TALA ${guard.Location()} spatial index requires a graph`);
    }
    if (g.Nodes.length > MAX_ENGINE_NODES) {
      throw new Error(`TALA ${guard.Location()} spatial index node count exceeds limit ${MAX_ENGINE_NODES}`);
    }

    this.graph = g;
    this.nodeCount = g.Nodes.length;
    this.occupancyUsable = true;
    this.spatialUsable = g.Nodes.length >= OPTIMIZER_SPATIAL_INDEX_MIN_NODES;
    this.entries = [];
    this.candidates = [];

    this.occupancyGeneration++;
    const maxRetained = Math.max(64, 4 * g.Nodes.length);
    if (this.occupancyGeneration === 0n || this.occupied.size > maxRetained) {
      this.occupied.clear();
      this.occupancyGeneration = 1n;
    }

    for (let graphIndex = 0; graphIndex < g.Nodes.length; graphIndex++) {
      guard.Step();
      const node = g.Nodes[graphIndex];
      if (node == null) {
        throw new Error(`TALA ${guard.Location()} found a nil graph node`);
      }
      if (node.TopLeft == null) {
        continue;
      }
      if (!optimizerIndexFinite(node.TopLeft.X) || !optimizerIndexFinite(node.TopLeft.Y)) {
        this.occupancyUsable = false;
        this.spatialUsable = false;
        continue;
      }

      const key = `${node.TopLeft.X},${node.TopLeft.Y}`;
      const entry = this.occupied.get(key);
      if (!entry || entry.generation !== this.occupancyGeneration) {
        this.occupied.set(key, {
          graphIndex,
          generation: this.occupancyGeneration,
        });
      }

      if (!this.spatialUsable) {
        continue;
      }
      if (!optimizerIndexFiniteBox(node)) {
        this.spatialUsable = false;
        continue;
      }

      this.entries.push({
        graphIndex,
        left: node.TopLeft.X,
        top: node.TopLeft.Y,
        right: node.TopLeft.X + node.Width,
        bottom: node.TopLeft.Y + node.Height,
      });
    }

    if (!this.spatialUsable || this.entries.length === 0) {
      guard.Finish();
      return;
    }

    guard.AddSort(this.entries.length);
    this.entries.sort((a, b) => {
      if (a.left !== b.left) {
        return a.left < b.left ? -1 : 1;
      }
      return a.graphIndex - b.graphIndex;
    });

    const requiredTreeSize = 4 * this.entries.length;
    this.maxRight = new Array(requiredTreeSize);
    this.buildMaxRight(1, 0, this.entries.length);
    guard.Finish();
  }

  buildMaxRight(treeIndex, low, high) {
    if (high - low === 1) {
      this.maxRight[treeIndex] = this.entries[low].right;
      return this.maxRight[treeIndex];
    }
    const middle = low + Math.floor((high - low) / 2);
    const leftMax = this.buildMaxRight(treeIndex * 2, low, middle);
    const rightMax = this.buildMaxRight(treeIndex * 2 + 1, middle, high);
    this.maxRight[treeIndex] = Math.max(leftMax, rightMax);
    return this.maxRight[treeIndex];
  }

  query(left, top, right, bottom, guard) {
    this.candidates = [];
    if (!this.spatialUsable || this.entries.length === 0) {
      guard.Finish();
      return this.candidates;
    }
    this.queryTree(1, 0, this.entries.length, left, top, right, bottom, guard);
    guard.AddSort(this.candidates.length);
    this.candidates.sort((a, b) => a - b);
    guard.Finish();
    return this.candidates;
  }

  queryTree(treeIndex, low, high, left, top, right, bottom, guard) {
    guard.Step();
    if (low >= high || this.maxRight[treeIndex] < left || this.entries[low].left > right) {
      return;
    }
    if (high - low === 1) {
      const entry = this.entries[low];
      if (entry.left <= right && entry.right >= left && entry.top <= bottom && entry.bottom >= top) {
        this.candidates.push(entry.graphIndex);
      }
      return;
    }

    const middle = low + Math.floor((high - low) / 2);
    this.queryTree(treeIndex * 2, low, middle, left, top, right, bottom, guard);
    this.queryTree(treeIndex * 2 + 1, middle, high, left, top, right, bottom, guard);
  }

  isOccupied(g, point, guard) {
    if (
      this.graph !== g ||
      this.nodeCount !== g.Nodes.length ||
      !this.occupancyUsable ||
      !optimizerIndexFinite(point.X) ||
      !optimizerIndexFinite(point.Y)
    ) {
      return optimizerIsOccupied(g, point, guard);
    }
    guard.Step();
    const key = `${point.X},${point.Y}`;
    const entry = this.occupied.get(key);
    if (!entry || entry.generation !== this.occupancyGeneration) {
      guard.Finish();
      return [null, false];
    }
    if (entry.graphIndex < 0 || entry.graphIndex >= g.Nodes.length) {
      throw new Error(`TALA ${guard.Location()} spatial occupancy index is stale`);
    }
    guard.Finish();
    return [g.Nodes[entry.graphIndex], true];
  }

  doesOverlap(node, point, exceptions, guard) {
    if (node == null || node.Graph == null || point == null) {
      throw new Error(`TALA ${guard.Location()} overlap check requires a node, graph, and point`);
    }
    if (node.Graph.Nodes.length > MAX_ENGINE_NODES || (exceptions && exceptions.length > MAX_ENGINE_NODES)) {
      throw new Error(`TALA ${guard.Location()} overlap inputs exceed node limit ${MAX_ENGINE_NODES}`);
    }
    if (
      this.graph !== node.Graph ||
      this.nodeCount !== node.Graph.Nodes.length ||
      !this.spatialUsable ||
      !optimizerIndexFinite(point.X) ||
      !optimizerIndexFinite(point.Y) ||
      !optimizerIndexFinite(node.Width) ||
      !optimizerIndexFinite(node.Height) ||
      node.Width < 0 ||
      node.Height < 0 ||
      !optimizerIndexFinite(point.X + node.Width) ||
      !optimizerIndexFinite(point.Y + node.Height)
    ) {
      return optimizerDoesOverlap(node, point, exceptions, guard);
    }

    const maxSafeDelta = 500.0;
    const candidates = this.query(
      point.X - maxSafeDelta,
      point.Y - maxSafeDelta,
      point.X + node.Width + maxSafeDelta,
      point.Y + node.Height + maxSafeDelta,
      guard
    );

    const right = point.X + node.Width;
    const bottom = point.Y + node.Height;

    for (let ci = 0; ci < candidates.length; ci++) {
      guard.Step();
      const graphIndex = candidates[ci];
      const otherNode = node.Graph.Nodes[graphIndex];
      if (otherNode === node) {
        continue;
      }
      let excluded = false;
      if (exceptions) {
        for (let i = 0; i < exceptions.length; i++) {
          guard.Step();
          if (exceptions[i] === otherNode) {
            excluded = true;
            break;
          }
        }
      }
      if (excluded || otherNode.TopLeft == null) {
        continue;
      }

      guard.Add(BigInt(node.Edges ? node.Edges.length : 0));
      const delta = node.deltaTo(otherNode, point);
      if (
        point.X < otherNode.TopLeft.X + otherNode.Width + delta &&
        right + delta > otherNode.TopLeft.X &&
        point.Y < otherNode.TopLeft.Y + otherNode.Height + delta &&
        bottom + delta > otherNode.TopLeft.Y
      ) {
        return true;
      }
    }
    guard.Finish();
    return false;
  }
}

/**
 * Reports whether a node may move its descendants during trial moves.
 *
 * @param {object} optim
 * @param {import('../graph/node.js').Node} node
 * @returns {boolean}
 */
export function nodeMayMoveDescendants(optim, node) {
  if (node == null) return false;
  const isCont = typeof node.isContainer === 'function' ? node.isContainer() : Boolean(node.isContainer);
  const isVess = typeof node.isClusterVessel === 'function' ? node.isClusterVessel() : Boolean(node.isClusterVessel);
  const inSeq = optim.g?.Sequences instanceof Map ? optim.g.Sequences.get(node) != null : optim.g?.Sequences?.[node] != null;
  return isCont || isVess || inSeq;
}

/**
 * indexedIsOccupied performs spatial-index accelerated occupancy test.
 *
 * @param {object} optim
 * @param {import('../geometry/point.js').Point} point
 * @param {object} guard
 * @returns {[import('../graph/node.js').Node|null, boolean]}
 */
export function indexedIsOccupied(optim, point, guard) {
  return optim.spatialIndex.isOccupied(optim.g, point, guard);
}

/**
 * indexedDoesOverlap performs spatial-index accelerated overlap test.
 *
 * @param {object} optim
 * @param {import('../graph/node.js').Node} node
 * @param {import('../geometry/point.js').Point} point
 * @param {import('../graph/node.js').Node[]} exceptions
 * @param {object} guard
 * @returns {boolean}
 */
export function indexedDoesOverlap(optim, node, point, exceptions, guard) {
  return optim.spatialIndex.doesOverlap(node, point, exceptions, guard);
}

/**
 * indexedCanMove checks whether a node can move to point using the spatial index.
 *
 * @param {object} optim
 * @param {import('../graph/node.js').Node} node
 * @param {import('../geometry/point.js').Point} point
 * @param {object} guard
 * @returns {boolean}
 */
export function indexedCanMove(optim, node, point, guard) {
  if (node == null || node.Graph == null || point == null) {
    throw new Error(`TALA ${guard.Location()} movement check requires a node, graph, and point`);
  }
  if (node.TopLeft != null && node.TopLeft.X === point.X && node.TopLeft.Y === point.Y) {
    return true;
  }
  if (nodeMayMoveDescendants(optim, node)) {
    return optimizerCanMove(node, point, true, guard);
  }
  const [, occupied] = optim.spatialIndex.isOccupied(optim.g, point, guard);
  if (occupied) {
    return false;
  }
  const overlaps = optim.spatialIndex.doesOverlap(node, point, null, guard);
  return !overlaps;
}
