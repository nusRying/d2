/**
 * Sized optimizer — local search that moves, swaps, and transposes sized nodes
 * toward the median of their neighbors under one OptimizationWorkGuard and the
 * request's shared transaction WorkGuard.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/sized_optimizer.go
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * Errors throw (JS convention). WorkGuard and OptimizationWorkGuard failures
 * throw from the guards themselves. optimizeWithLimit is the rollback
 * boundary: any failure, including a thrown non-Error value, restores the
 * exact pre-run mutation snapshot before propagating.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import {
  MAX_ENGINE_EDGES,
  MAX_ENGINE_NODES,
  MAX_OPTIMIZATION_WORK_UNITS,
  MAX_TOPOLOGY_REFERENCES,
} from '../limits/constants.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import {
  OptimizationResourceLimitError,
  OptimizationWorkGuard,
  shuffle,
} from '../limits/optimization.js';
import { Point } from '../geometry/point.js';
import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { LongDistanceNeighborRequirements } from '../graph/neighbor-requirements.js';
import { checkScoringCancellation } from '../placementcost/geometry.js';
import { EdgeLengthOptions, nodeEdgeLength } from '../placementcost/edge-length.js';
import { newNodeEdgeLengthScorer } from '../placementcost/edge-length-scorer.js';
import { columnCrossingCost, nodeSymmetryExport } from '../placementcost/symmetry.js';
import { syncHerdFences } from '../proximity/herding.js';
import {
  MAX_OPTIMIZER_PLACEMENT_CANDIDATES,
  OptimizerMutationSnapshot,
  captureOptimizerMutationStateInto,
  chargeOptimizerScoring,
  chargeOptimizerTranspose,
  optimizerDoesOverlap,
  optimizerFixedOrigin,
  optimizerIsDescendantOf,
  optimizerMedian,
  optimizerMedianToNeighbors,
  optimizerSwapPositions,
  withOptimizerPositionsSwapped,
} from './optimizer-support.js';
import { captureOptimizerCandidateMovement } from './candidate-movement.js';
import {
  OptimizerSpatialIndex,
  indexedCanMove,
  indexedDoesOverlap,
  indexedIsOccupied,
} from './optimizer-spatial-index.js';
import { roundToNearestCellSize, restoreNodePositions } from './types.js';
import { transpose } from './transpose.js';

// Pinned Go: layoutgraph.ContainerPadding (geometry_policy.go)
const CONTAINER_PADDING = 60;

function compareIDs(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function scoringOptions(edgeAbductions) {
  return new EdgeLengthOptions({
    EdgeAbductions: edgeAbductions,
    IncludeNodeSizes: true,
    EnforceMinimumGap: false,
    PenalizeDirection: true,
  });
}

/**
 * Go map[geo.Point]struct{} key for the checked-offset cache. Number-to-string
 * is injective for finite doubles except -0/+0, which Go map keys also treat as
 * equal, so this key matches pinned identity exactly.
 */
function offsetKey(x, y) {
  return `${x},${y}`;
}

/**
 * Pinned Go: uint64(uint32(int64(pX/cell)))<<32 | uint64(uint32(int64(pY/cell))).
 * Negative cell coordinates wrap through uint32 exactly as Go's conversion does.
 */
function placementKey(pX, pY, cellSize) {
  const ix = BigInt(Math.trunc(pX / cellSize));
  const iy = BigInt(Math.trunc(pY / cellSize));
  return (BigInt.asUintN(32, ix) << 32n) | BigInt.asUintN(32, iy);
}

function resourceLimitError(message) {
  return new OptimizationResourceLimitError(message);
}

/**
 * iterPlacementsAroundPoint applies the grid point (x, y) — in cells — and, when
 * minimizing the node itself, every other cell-aligned top-left that still
 * covers that point, in pinned X-then-Y order. apply returning true stops.
 *
 * Pinned Go: placement.iterPlacementsAroundPoint
 */
export function iterPlacementsAroundPoint(node, x, y, minimizingSelf, apply) {
  const width = node.Width;
  const height = node.Height;
  x *= node.Graph.CellSize;
  y *= node.Graph.CellSize;
  const increment = node.Graph.CellSize;
  if (apply(x, y) || !minimizingSelf) {
    return;
  }
  for (let currentX = x - width; currentX <= x; currentX += increment) {
    for (let currentY = y - height; currentY <= y; currentY += increment) {
      if (currentX === x && currentY === y) {
        continue;
      }
      if (apply(currentX, currentY)) {
        return;
      }
    }
  }
}

/**
 * withHubSpokesSuppressed temporarily removes a hub's spoke edges while fn
 * evaluates placements. The original Edges array (identity, contents, and
 * order) is restored on success, error, or any thrown value.
 *
 * Pinned Go: placement.withHubSpokesSuppressed
 */
export function withHubSpokesSuppressed(node, spokes, guard, fn) {
  if (node == null) {
    throw new Error('TALA LocalOptimize cannot suppress spokes on a nil hub');
  }
  if (spokes.length > MAX_ENGINE_NODES || node.Edges.length > MAX_ENGINE_EDGES) {
    throw new Error('TALA LocalOptimize hub suppression inputs exceed engine limits');
  }
  const originalEdges = node.Edges;
  const originalContents = originalEdges.slice();
  const removed = new Array(originalContents.length).fill(false);
  try {
    for (const spoke of spokes) {
      guard.Step();
      if (spoke == null) {
        throw new Error('TALA LocalOptimize found a nil hub spoke');
      }
      for (let i = 0; i < originalContents.length; i++) {
        guard.Step();
        if (removed[i]) {
          continue;
        }
        const edge = originalContents[i];
        if (edge == null || (edge.From !== node && edge.To !== node)) {
          throw new Error('TALA LocalOptimize found a malformed hub edge');
        }
        if (node.adjacent(edge) === spoke) {
          removed[i] = true;
          break;
        }
      }
    }
    const workingEdges = [];
    for (let i = 0; i < originalContents.length; i++) {
      guard.Step();
      if (!removed[i]) {
        workingEdges.push(originalContents[i]);
      }
    }
    node.Edges = workingEdges;
    return fn();
  } finally {
    // Go restores the original slice header; JS also repairs the array
    // contents in case fn mutated the original array in place.
    originalEdges.length = originalContents.length;
    for (let i = 0; i < originalContents.length; i++) {
      originalEdges[i] = originalContents[i];
    }
    node.Edges = originalEdges;
  }
}

/**
 * SizedOptimizer mirrors pinned Go's sizedOptimizer state.
 */
export class SizedOptimizer {
  constructor(fields) {
    this.mutationScratch = new OptimizerMutationSnapshot();
    this.g = fields.g;
    this.edgeAbductions = fields.edgeAbductions;
    this.randGenerator = fields.randGenerator;
    this.fixedOrigin = fields.fixedOrigin;
    this.symmetryCost = fields.symmetryCost;
    this.cellSize = fields.cellSize;
    this.obstacles = fields.obstacles;
    /** @type {Map<string, true>|null} Go map[geo.Point]struct{} */
    this.checkedPositions = null;
    /** Go placementPointsScratch */
    this.placementScratch = { seen: null, points: null };
    this.spatialIndex = new OptimizerSpatialIndex();
  }

  /** Pinned Go: sizedOptimizer.optimize */
  optimize(ctx, temp) {
    return this.optimizeWithLimit(ctx, temp, MAX_OPTIMIZATION_WORK_UNITS);
  }

  /**
   * optimizeWithLimit is the optimizer's rollback boundary.
   * Pinned Go: sizedOptimizer.optimizeWithLimit
   * @returns {boolean} changed
   */
  optimizeWithLimit(ctx, temp, workLimit) {
    [ctx] = ensureTransactionWorkGuard(ctx, 'LocalOptimizeTransactions');
    const guard = new OptimizationWorkGuard(ctx, 'LocalOptimize', workLimit);
    if (this.g == null) {
      throw new Error('TALA LocalOptimize requires an optimizer with a graph');
    }
    if (this.randGenerator == null) {
      throw new Error('TALA LocalOptimize requires a random generator');
    }
    try {
      const snapshot = captureOptimizerMutationStateInto(this.g, guard, this.mutationScratch);
      let complete = false;
      try {
        const changed = this.optimizeGuarded(ctx, temp, guard);
        guard.Finish();
        complete = true;
        return changed;
      } finally {
        if (!complete) {
          snapshot.restore();
        }
      }
    } finally {
      this.mutationScratch.release();
    }
  }

  /** Pinned Go: sizedOptimizer.rebuildSpatialIndex */
  rebuildSpatialIndex(guard) {
    if (this.g == null) {
      throw new Error(`TALA ${guard.Location()} spatial index requires an optimizer graph`);
    }
    this.spatialIndex.rebuild(this.g, guard);
  }

  /** Pinned Go: sizedOptimizer.optimizeGuarded */
  optimizeGuarded(ctx, temp, guard) {
    let changed = false;
    if (this.g.Nodes.length > MAX_ENGINE_NODES) {
      throw new Error(`TALA LocalOptimize node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    const nodeIndices = new Array(this.g.Nodes.length);
    for (let i = 0; i < this.g.Nodes.length; i++) {
      guard.Step();
      nodeIndices[i] = i;
    }
    shuffle(nodeIndices, this.randGenerator, guard);

    for (const nodeIndex of nodeIndices) {
      guard.Step();
      const node = this.g.Nodes[nodeIndex];
      if (node == null || node.TopLeft == null) {
        throw new Error('TALA LocalOptimize found an unpositioned graph node');
      }
      if (node.FixedTopLeft != null) {
        continue;
      }
      if (node.Width > 100 * this.cellSize || node.Height > 100 * this.cellSize) {
        // leave giant node where it is, we won't find an unoccupied point within 100 cellSize
        continue;
      }
      if (node.Edges.length === 0) {
        let hasUsableNear = false;
        for (const near of node.Nears ?? []) {
          guard.Step();
          if (optimizerIsDescendantOf(near, node.Container, guard)) {
            hasUsableNear = true;
            break;
          }
        }
        if (!hasUsableNear) {
          continue;
        }
      }
      if (this.g.NodeToTree.has(node)) {
        continue;
      }

      const protrudingChildren = this.protrudingChildrenGuarded(node, guard);
      const minimizingSelf = protrudingChildren.length === 0;

      const medianPoint = this.medianPointGuarded(node, temp, protrudingChildren, guard);
      // All candidate placements for this node see the same boxes for every
      // other graph node: build the broad-phase index once per node.
      this.rebuildSpatialIndex(guard);

      let checkedPositionsCache = null;
      // Only worth a cache when this node searches through many siblings.
      if (nodeIndices.length > 10) {
        if (this.checkedPositions == null) {
          this.checkedPositions = new Map();
        } else {
          this.checkedPositions.clear();
        }
        checkedPositionsCache = this.checkedPositions;
      }
      const d = this.findClosestUnoccupiedDistanceGuarded(node, medianPoint, minimizingSelf, checkedPositionsCache, guard);
      const points = this.fillPlacementPointsGuarded(node, medianPoint, d, minimizingSelf, this.placementScratch, guard);
      shuffle(points, this.randGenerator, guard);

      // mustImprove is true for the final optimize calls where temp is 0
      const moved = this.moveNodeToBestGuarded(ctx, node, points, temp === 0, guard);

      if (!moved) {
        const bestSwapCandidate = this.bestSwapCandidateGuarded(ctx, node, guard);
        if (bestSwapCandidate != null) {
          changed = true;
          optimizerSwapPositions(node, bestSwapCandidate, guard);
          this.syncHerdFencesGuarded(guard);
        } else {
          chargeOptimizerTranspose(this.g, node, this.edgeAbductions, guard);
          const ok = transpose(ctx, this.g, node, this.edgeAbductions);
          guard.Step();
          if (ok) {
            changed = true;
          } else if (this.g.Hubs.has(node) && temp !== 0) {
            // The spokes don't need to move because in the next iteration they'll move
            const spokes = this.g.Hubs.get(node) ?? [];
            withHubSpokesSuppressed(node, spokes, guard, () => {
              const suppressedMedian = this.medianPointGuarded(node, temp, protrudingChildren, guard);
              const suppressedDistance = this.findClosestUnoccupiedDistanceGuarded(
                node, suppressedMedian, minimizingSelf, checkedPositionsCache, guard,
              );
              const suppressedPoints = this.fillPlacementPointsGuarded(
                node, suppressedMedian, suppressedDistance, minimizingSelf, this.placementScratch, guard,
              );
              shuffle(suppressedPoints, this.randGenerator, guard);
              this.moveNodeToBestGuarded(ctx, node, suppressedPoints, temp === 0, guard);
            });
          }
        }
      } else {
        this.syncHerdFencesGuarded(guard);
        changed = true;
      }
    }
    guard.Finish();
    return changed;
  }

  /**
   * Pinned Go: sizedOptimizer.medianPointGuarded — two RNG draws (X then Y).
   * @returns {Point}
   */
  medianPointGuarded(node, temp, protrudingChildren, guard) {
    const width = node.Width / this.cellSize;
    const height = node.Height / this.cellSize;
    let [medianX, medianY] = optimizerMedianToNeighbors(node, true, this.edgeAbductions, guard);

    const fixedOrigin = optimizerFixedOrigin(this.g, node.owningContainer(), guard);
    if (fixedOrigin != null) {
      // we can't have node positions past the fixedOrigin so set a floor
      if (medianX < fixedOrigin.X / this.cellSize) {
        medianX = fixedOrigin.X / this.cellSize;
        // anything left of the fixed origin is invalid so the window is [0, 2*temp*width]
        medianX += temp * width;
      }
      if (medianY < fixedOrigin.Y / this.cellSize) {
        medianY = fixedOrigin.Y / this.cellSize;
        medianY += temp * height;
      }
    }

    medianX += (-1.0 * temp * width) + this.randGenerator.Float64() * (2.0 * temp * width);
    medianY += (-1.0 * temp * height) + this.randGenerator.Float64() * (2.0 * temp * height);

    if (protrudingChildren.length > 0) {
      const [childrenMedianX, childrenMedianY] = optimizerMedian(protrudingChildren, true, guard);
      medianX -= childrenMedianX - node.TopLeft.X / this.cellSize;
      medianY -= childrenMedianY - node.TopLeft.Y / this.cellSize;
    }

    if (fixedOrigin != null) {
      medianX = Math.max(medianX, fixedOrigin.X / this.cellSize);
      medianY = Math.max(medianY, fixedOrigin.Y / this.cellSize);
    }

    return new Point(goRound(medianX * this.cellSize), goRound(medianY * this.cellSize));
  }

  /** Pinned Go: sizedOptimizer.protrudingChildrenGuarded */
  protrudingChildrenGuarded(node, guard) {
    const protrudingChildren = [];
    for (const ea of this.edgeAbductions ?? []) {
      guard.Step();
      if (ea == null) {
        throw new Error('TALA LocalOptimize found a nil edge abduction');
      }
      if (ea.CurrentFrom === node && ea.OriginallyFrom != null) {
        protrudingChildren.push(ea.OriginallyFrom);
      }
      if (ea.CurrentTo === node && ea.OriginallyTo != null) {
        protrudingChildren.push(ea.OriginallyTo);
      }
    }
    return protrudingChildren;
  }

  /**
   * Rings of increasing distance around p, right-to-left, negative Y before
   * positive Y. Pinned Go: sizedOptimizer.findClosestUnoccupiedDistanceGuarded
   * @returns {number} distance in cells
   */
  findClosestUnoccupiedDistanceGuarded(node, p, minimizingSelf, checked, guard) {
    if (node == null || node.Graph == null || node.TopLeft == null || p == null) {
      throw new Error(`TALA ${guard.Location()} placement search requires a positioned node, graph, and point`);
    }
    if (!(this.cellSize > 0) || !Number.isFinite(this.cellSize)) {
      throw new Error(`TALA ${guard.Location()} placement search requires a finite positive cell size`);
    }
    if (checked != null && checked.size > MAX_OPTIMIZER_PLACEMENT_CANDIDATES) {
      throw resourceLimitError(
        `TALA ${guard.Location()} checked placement count exceeds limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
      );
    }
    const cellSize = this.cellSize;
    const fixedOrigin = this.fixedOrigin;
    for (let curr = 0.0; curr <= 100.0; curr++) {
      guard.Step();
      const currCell = curr * cellSize;
      let x = currCell;
      let y = 0.0;
      while (x >= -currCell) {
        guard.Step();
        if (y !== 0) {
          const candidateX = roundToNearestCellSize(p.X + x, cellSize);
          const candidateY = roundToNearestCellSize(p.Y - y, cellSize);
          if (fixedOrigin == null || (candidateX >= fixedOrigin.X && candidateY >= fixedOrigin.Y)) {
            if (this.findUnoccupiedGuarded(x, -y, node.Width, node.Height, minimizingSelf, node, p, checked, guard)) {
              return curr;
            }
          }
        }
        const candidateX = roundToNearestCellSize(p.X + x, cellSize);
        const candidateY = roundToNearestCellSize(p.Y + y, cellSize);
        if (fixedOrigin == null || (candidateX >= fixedOrigin.X && candidateY >= fixedOrigin.Y)) {
          if (this.findUnoccupiedGuarded(x, y, node.Width, node.Height, minimizingSelf, node, p, checked, guard)) {
            return curr;
          }
        }
        if (x > 0) {
          y += cellSize;
        } else {
          y -= cellSize;
        }
        x -= cellSize;
      }
    }
    throw new Error(`could not find closest unoccupied distance for p=&{${p.X} ${p.Y}}, node=${node.DebugID()}`);
  }

  /** Pinned Go: sizedOptimizer.findUnoccupiedGuarded */
  findUnoccupiedGuarded(x, y, width, height, minimizingSelf, node, p, checked, guard) {
    guard.Step();
    let skip = false;
    if (checked != null) {
      const key = offsetKey(x, y);
      if (checked.has(key)) {
        skip = true;
      } else {
        if (checked.size >= MAX_OPTIMIZER_PLACEMENT_CANDIDATES) {
          throw resourceLimitError(
            `TALA ${guard.Location()} checked placement count exceeds limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
          );
        }
        checked.set(key, true);
      }
    }

    if (!skip && !this.isPointOccupiedGuarded(x, y, p, node, guard)) {
      return true;
    }
    if (!minimizingSelf) {
      return false;
    }

    for (let i = x - width; i <= x; i += this.cellSize) {
      for (let j = y - height; j <= y; j += this.cellSize) {
        guard.Step();
        // Already attempted above
        if (i === x && j === y) {
          continue;
        }
        if (checked != null) {
          const key = offsetKey(i, j);
          if (checked.has(key)) {
            continue;
          }
          if (checked.size >= MAX_OPTIMIZER_PLACEMENT_CANDIDATES) {
            throw resourceLimitError(
              `TALA ${guard.Location()} checked placement count exceeds limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
            );
          }
          checked.set(key, true);
        }
        if (!this.isPointOccupiedGuarded(i, j, p, node, guard)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Pinned Go: sizedOptimizer.isPointOccupiedGuarded */
  isPointOccupiedGuarded(x, y, p, node, guard) {
    const point = new Point(p.X + x, p.Y + y);
    point.X = roundToNearestCellSize(point.X, this.cellSize);
    point.Y = roundToNearestCellSize(point.Y, this.cellSize);
    if (this.fixedOrigin != null && (point.X < this.fixedOrigin.X || point.Y < this.fixedOrigin.Y)) {
      return true;
    }
    const [, occupied] = indexedIsOccupied(this, point, guard);
    if (!occupied && !indexedDoesOverlap(this, node, point, [node], guard)) {
      return false;
    }
    return true;
  }

  /**
   * Fills caller-owned scratch ({seen: Map<bigint>, points: Point[]}) with
   * deduplicated cell-aligned candidates in pinned order.
   * Pinned Go: sizedOptimizer.fillPlacementPointsGuarded
   * @returns {Point[]} the scratch points array
   */
  fillPlacementPointsGuarded(node, median, minUnocc, minimizingSelf, scratch, guard) {
    if (node == null || node.TopLeft == null || median == null) {
      throw new Error(`TALA ${guard.Location()} placement generation requires a positioned node and median`);
    }
    if (minUnocc < 0 || minUnocc > 100 || Number.isNaN(minUnocc) || !Number.isFinite(minUnocc)) {
      throw new Error(`TALA ${guard.Location()} placement distance must be finite and within [0, 100]`);
    }
    if (!(this.cellSize > 0) || !Number.isFinite(this.cellSize)) {
      throw new Error(`TALA ${guard.Location()} placement generation requires a finite positive cell size`);
    }
    if (scratch.seen == null) {
      scratch.seen = new Map();
    }
    if (scratch.points == null) {
      scratch.points = [];
    }
    // Clear for reuse; pinned Go charges one Step per deleted entry.
    for (const key of [...scratch.seen.keys()]) {
      guard.Step();
      scratch.seen.delete(key);
    }
    scratch.points.length = 0;

    const dist = minUnocc + 1;
    const fixedOrigin = this.fixedOrigin;
    let addErr = null;
    const add = (offX, offY) => {
      if (addErr != null) {
        return true;
      }
      try {
        guard.Step();
      } catch (err) {
        addErr = err;
        return true;
      }
      const pX = roundToNearestCellSize(median.X + offX, this.cellSize);
      const pY = roundToNearestCellSize(median.Y + offY, this.cellSize);
      // Early rejection based on fixed origin
      if (fixedOrigin != null && (pX < fixedOrigin.X || pY < fixedOrigin.Y)) {
        return false;
      }
      const key = placementKey(pX, pY, this.cellSize);
      if (scratch.seen.has(key)) {
        return false;
      }
      if (scratch.points.length >= MAX_OPTIMIZER_PLACEMENT_CANDIDATES) {
        addErr = resourceLimitError(
          `TALA LocalOptimize placement candidates exceed limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
        );
        return true;
      }
      scratch.seen.set(key, true);
      scratch.points.push(new Point(pX, pY));
      return false;
    };

    // Diamond pattern: x from +dist down to -dist; negative Y before positive Y.
    for (let x = dist; x >= -dist; x--) {
      guard.Step();
      const maxY = dist - Math.abs(x);
      for (let y = 0.0; y <= maxY; y++) {
        guard.Step();
        if (y !== 0) {
          iterPlacementsAroundPoint(node, x, -y, minimizingSelf, add);
        }
        iterPlacementsAroundPoint(node, x, y, minimizingSelf, add);
        if (addErr != null) {
          throw addErr;
        }
      }
    }

    // Long-distance neighbor requirements.
    const data = node.LongDistanceNeighborRequirements;
    if (data != null) {
      if (data.size > MAX_TOPOLOGY_REFERENCES) {
        throw new Error(
          `TALA ${guard.Location()} long-distance neighbor references exceed limit ${MAX_TOPOLOGY_REFERENCES}`,
        );
      }
      const cell = Math.trunc(this.cellSize);
      const neighbors = [];
      for (const adjacent of data.keys()) {
        guard.Step();
        neighbors.push(adjacent);
      }
      guard.AddSort(neighbors.length);
      neighbors.sort((a, b) => compareIDs(a.ID, b.ID));

      for (const adj of neighbors) {
        guard.Step();
        const requirements = data.get(adj);
        if (adj == null || adj.TopLeft == null) {
          throw new Error(`TALA ${guard.Location()} found an unpositioned long-distance neighbor`);
        }
        const maxW = requirements.MaxWidth;
        const maxH = requirements.MaxHeight;
        const ax = adj.TopLeft.X - median.X;
        const ay = adj.TopLeft.Y - median.Y;
        if (maxW > cell) {
          add(Math.floor((ax - node.Width - maxW) / cell) * cell, ay);
          add(Math.ceil((ax + adj.Width + maxW) / cell) * cell, ay);
        }
        if (maxH > cell) {
          add(ax, Math.floor((ay - node.Height - maxH) / cell) * cell);
          add(ax, Math.ceil((ay + adj.Height + maxH) / cell) * cell);
        }
        if (addErr != null) {
          throw addErr;
        }
      }
    }

    // Current position for herd assignments
    if (node.HerdAssignment != null) {
      if (scratch.points.length >= MAX_OPTIMIZER_PLACEMENT_CANDIDATES) {
        throw resourceLimitError(
          `TALA LocalOptimize placement candidates exceed limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
        );
      }
      scratch.points.push(new Point(node.TopLeft.X, node.TopLeft.Y));
    }

    // Pinned work charge for the produced candidates.
    guard.Add(scratch.points.length);
    return scratch.points;
  }

  /**
   * Sized scorer with current-position tie preference and obstacle penalty.
   * Pinned Go: sizedOptimizer.moveNodeToBestGuarded
   * @returns {boolean} moved
   */
  moveNodeToBestGuarded(ctx, node, points, mustImprove, guard) {
    const scorer = newNodeEdgeLengthScorer(node, scoringOptions(this.edgeAbductions));
    try {
      const symmetryCost = this.cellSize * node.Edges.length;
      let leastDistance = Infinity;
      if (mustImprove) {
        chargeOptimizerScoring(node, this.edgeAbductions, true, guard);
        leastDistance = scorer.Score(ctx);
        const columnCrossing = columnCrossingCost(ctx, node, this.edgeAbductions);
        const symmetry = nodeSymmetryExport(ctx, node, this.edgeAbductions);
        leastDistance += columnCrossing;
        leastDistance -= symmetry * symmetryCost;
      }
      let leastDistancePoint = node.TopLeft.copy();
      const currentNodeX = node.TopLeft.X;
      const currentNodeY = node.TopLeft.Y;
      const movement = captureOptimizerCandidateMovement(node, guard);
      const originalPositions = movement.positions;
      let complete = false;
      try {
        for (const point of points) {
          guard.Step();
          const x = point.X;
          const y = point.Y;
          if (this.fixedOrigin != null && (x < this.fixedOrigin.X || y < this.fixedOrigin.Y)) {
            continue;
          }
          // The original position can always be revisited.
          let canMove = x === currentNodeX && y === currentNodeY;
          if (!canMove) {
            canMove = indexedCanMove(this, node, point, guard);
          }
          if (!canMove) {
            continue;
          }
          movement.moveAbs(x, y, guard);
          chargeOptimizerScoring(node, this.edgeAbductions, true, guard);
          let edgeLength = scorer.Score(ctx);
          if (Number.isFinite(leastDistance) && precisionCompare(edgeLength - symmetryCost, leastDistance, PRECISION) === 1) {
            // no need to continue, this is clearly worse
            continue;
          }
          const columnCrossing = columnCrossingCost(ctx, node, this.edgeAbductions);
          const symmetry = nodeSymmetryExport(ctx, node, this.edgeAbductions);
          edgeLength += columnCrossing;
          edgeLength -= symmetry * symmetryCost;

          for (const o of this.obstacles ?? []) {
            guard.Step();
            if (o.TopLeft.X === -CONTAINER_PADDING && o.TopLeft.Y === -CONTAINER_PADDING) {
              continue;
            }
            if (node.Box.overlaps(o)) {
              edgeLength += 3 * this.g.TurnCost();
            }
          }

          const cmp = precisionCompare(edgeLength, leastDistance, PRECISION);
          if (cmp === -1) {
            leastDistance = edgeLength;
            leastDistancePoint = point;
          } else if (cmp === 0 && point.X === currentNodeX && point.Y === currentNodeY) {
            leastDistance = edgeLength;
            leastDistancePoint = point;
          }
        }

        const cancelErr = checkScoringCancellation(ctx);
        if (cancelErr != null) {
          throw cancelErr;
        }
        if (leastDistance === Infinity) {
          throw new Error('sizedOptimizer: could not find any placement');
        }
        movement.moveAbs(leastDistancePoint.X, leastDistancePoint.Y, guard);
        complete = true;
        return node.TopLeft.X !== currentNodeX || node.TopLeft.Y !== currentNodeY;
      } finally {
        if (!complete) {
          restoreNodePositions(originalPositions);
        }
      }
    } finally {
      scorer.Close();
    }
  }

  /**
   * Pinned Go: sizedOptimizer.bestSwapCandidateGuarded
   * @returns {Node|null}
   */
  bestSwapCandidateGuarded(ctx, node, guard) {
    const options = scoringOptions(this.edgeAbductions);
    let minSwapL = Infinity;

    chargeOptimizerScoring(node, this.edgeAbductions, true, guard);
    let currentL1 = nodeEdgeLength(ctx, node, options);
    let columnCrossing = columnCrossingCost(ctx, node, this.edgeAbductions);
    let symmetry = nodeSymmetryExport(ctx, node, this.edgeAbductions);
    currentL1 += columnCrossing;
    currentL1 -= symmetry * this.symmetryCost * node.Edges.length;
    let bestSwapCandidate = null;

    const swapCandidateIndices = new Array(this.g.Nodes.length);
    for (let i = 0; i < this.g.Nodes.length; i++) {
      guard.Step();
      swapCandidateIndices[i] = i;
    }
    shuffle(swapCandidateIndices, this.randGenerator, guard);

    for (const swapCandidateIndex of swapCandidateIndices) {
      guard.Step();
      const swapCandidate = this.g.Nodes[swapCandidateIndex];
      if (swapCandidate === node) {
        continue;
      }
      if (swapCandidate.FixedTopLeft != null) {
        continue;
      }
      if (!swapCandidate.isAdjacentTo(node, true)) {
        continue;
      }
      if (this.g.NodeToTree.has(swapCandidate)) {
        continue;
      }
      const firstOverlap = indexedDoesOverlap(this, swapCandidate, node.TopLeft, [node], guard);
      const secondOverlap = indexedDoesOverlap(this, node, swapCandidate.TopLeft, [swapCandidate], guard);
      if (firstOverlap || secondOverlap) {
        continue;
      }

      chargeOptimizerScoring(swapCandidate, this.edgeAbductions, true, guard);
      let currentL2 = nodeEdgeLength(ctx, swapCandidate, options);
      columnCrossing = columnCrossingCost(ctx, swapCandidate, this.edgeAbductions);
      symmetry = nodeSymmetryExport(ctx, swapCandidate, this.edgeAbductions);
      currentL2 += columnCrossing;
      currentL2 -= symmetry * this.symmetryCost * swapCandidate.Edges.length;

      let swappedL1 = 0;
      let swappedL2 = 0;
      let validSwap = false;
      withOptimizerPositionsSwapped(node, swapCandidate, guard, () => {
        // Swapping differently sized nodes may now intersect: re-check
        // without exceptions.
        const swappedFirstOverlap = optimizerDoesOverlap(swapCandidate, swapCandidate.TopLeft, null, guard);
        const swappedSecondOverlap = optimizerDoesOverlap(node, node.TopLeft, null, guard);
        if (swappedFirstOverlap || swappedSecondOverlap) {
          return;
        }
        validSwap = true;

        chargeOptimizerScoring(node, this.edgeAbductions, true, guard);
        swappedL1 = nodeEdgeLength(ctx, node, options);
        columnCrossing = columnCrossingCost(ctx, node, this.edgeAbductions);
        symmetry = nodeSymmetryExport(ctx, node, this.edgeAbductions);
        swappedL1 += columnCrossing;
        swappedL1 -= symmetry * this.symmetryCost * node.Edges.length;

        // No need to compute it if we already know it won't be a good swap.
        if (precisionCompare(swappedL1, currentL1, PRECISION) < 0) {
          chargeOptimizerScoring(swapCandidate, this.edgeAbductions, true, guard);
          swappedL2 = nodeEdgeLength(ctx, swapCandidate, options);
          columnCrossing = columnCrossingCost(ctx, swapCandidate, this.edgeAbductions);
          symmetry = nodeSymmetryExport(ctx, swapCandidate, this.edgeAbductions);
          swappedL2 += columnCrossing;
          swappedL2 -= symmetry * this.symmetryCost * swapCandidate.Edges.length;
        }
      });
      if (!validSwap) {
        continue;
      }

      if (
        precisionCompare(swappedL1, currentL1, PRECISION) < 0 &&
        precisionCompare(swappedL1 + swappedL2, currentL1 + currentL2, PRECISION) < 0 &&
        precisionCompare(swappedL1 + swappedL2, minSwapL, PRECISION) < 0
      ) {
        minSwapL = swappedL1 + swappedL2;
        bestSwapCandidate = swapCandidate;
      }
    }

    const cancelErr = checkScoringCancellation(ctx);
    if (cancelErr != null) {
      throw cancelErr;
    }
    return bestSwapCandidate;
  }

  /**
   * Precharges the bounded quadratic bounding-box scan, then syncs fences.
   * Pinned Go: sizedOptimizer.syncHerdFencesGuarded
   */
  syncHerdFencesGuarded(guard) {
    const nodes = BigInt(this.g.Nodes.length);
    guard.AddProduct(nodes, nodes + 1n);
    guard.Add(BigInt(this.g.Edges.length));
    syncHerdFences(this.g);
    guard.Finish();
  }
}

/**
 * newSizedOptimizer validates the graph and preprocesses long-distance
 * neighbor requirements from incident edges and edge abductions.
 *
 * Pinned Go: placement.newSizedOptimizer
 * @returns {SizedOptimizer}
 */
export function newSizedOptimizer(ctx, g, root, abductions, randGenerator, obstacles) {
  if (g == null) {
    throw new Error('TALA LocalOptimize requires a graph');
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA LocalOptimize node count exceeds limit ${MAX_ENGINE_NODES}`);
  }
  if (g.Edges.length > MAX_ENGINE_EDGES) {
    throw new Error(`TALA LocalOptimize edge count exceeds limit ${MAX_ENGINE_EDGES}`);
  }
  if ((abductions?.length ?? 0) > MAX_ENGINE_EDGES) {
    throw new Error(`TALA LocalOptimize edge abduction count exceeds limit ${MAX_ENGINE_EDGES}`);
  }
  if ((obstacles?.length ?? 0) > MAX_TOPOLOGY_REFERENCES) {
    throw new Error(`TALA LocalOptimize obstacle count exceeds limit ${MAX_TOPOLOGY_REFERENCES}`);
  }
  if (!(g.CellSize >= 1) || !Number.isFinite(g.CellSize) || Math.trunc(g.CellSize) !== g.CellSize) {
    throw new Error('TALA LocalOptimize requires a finite positive integer cell size');
  }
  const guard = new OptimizationWorkGuard(ctx, 'LocalOptimizeSetup', MAX_OPTIMIZATION_WORK_UNITS);
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null || node.Graph == null) {
      throw new Error('TALA LocalOptimize found a node without a graph');
    }
    if (node.Edges.length > MAX_ENGINE_EDGES || (node.Nears?.size ?? 0) > MAX_ENGINE_NODES) {
      throw new Error(`TALA LocalOptimize node ${node.DebugID()} adjacency references exceed engine limits`);
    }
    if (node.Graph.CellSize !== g.CellSize) {
      throw new Error(`cell size mismatch for node ${node.DebugID()}`);
    }
  }
  const optim = new SizedOptimizer({
    g,
    edgeAbductions: abductions,
    randGenerator,
    fixedOrigin: g.containerFixedOrigin(root),
    symmetryCost: g.CellSize,
    cellSize: g.CellSize,
    obstacles,
  });
  for (const n of g.Nodes) {
    guard.Step();

    // Pre-process all edge abductions that affect this node
    const abductedEdges = new Set();
    const adjReplacements = new Map();
    for (const ea of optim.edgeAbductions ?? []) {
      guard.Step();
      if (ea == null || ea.Edge == null) {
        throw new Error('TALA LocalOptimize found a nil edge abduction');
      }
      if (ea.CurrentFrom === n || ea.CurrentTo === n) {
        if (ea.OriginallyFrom != null || ea.OriginallyTo != null) {
          abductedEdges.add(ea.Edge);
          continue;
        }
        const adj = n.adjacent(ea.Edge);
        if (ea.CurrentFrom === n && ea.OriginallyTo != null) {
          adjReplacements.set(adj, ea.OriginallyTo);
        } else if (ea.CurrentTo === n && ea.OriginallyFrom != null) {
          adjReplacements.set(adj, ea.OriginallyFrom);
        }
      }
    }

    const cellSizeInt = Math.trunc(optim.cellSize);
    const spaceReqs = new Map();
    for (const edge of n.Edges) {
      guard.Step();
      if (edge == null || (edge.From !== n && edge.To !== n)) {
        throw new Error(`TALA LocalOptimize found a malformed incident edge on ${n.DebugID()}`);
      }
      if (abductedEdges.has(edge)) {
        continue;
      }
      let adj = n.adjacent(edge);
      if (adjReplacements.has(adj)) {
        adj = adjReplacements.get(adj);
      }
      let requirements = spaceReqs.get(adj);
      if (requirements === undefined) {
        requirements = new LongDistanceNeighborRequirements(0, 0, 0);
        spaceReqs.set(adj, requirements);
      }
      requirements.EdgeCount++;
      if (edge.MinWidth > requirements.MaxWidth) {
        requirements.MaxWidth = edge.MinWidth;
      }
      if (edge.MinHeight > requirements.MaxHeight) {
        requirements.MaxHeight = edge.MinHeight;
      }
    }

    for (const requirements of spaceReqs.values()) {
      guard.Step();
      if (requirements.EdgeCount < 3) {
        continue;
      }
      if (requirements.MaxWidth <= cellSizeInt && requirements.MaxHeight <= cellSizeInt) {
        continue;
      }
      n.LongDistanceNeighborRequirements = spaceReqs;
      break;
    }
  }

  guard.Finish();
  return optim;
}

export const NewSizedOptimizer = newSizedOptimizer;
