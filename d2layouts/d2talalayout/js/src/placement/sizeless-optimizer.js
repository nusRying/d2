import { Point } from "../geometry/point.js";
import { goRound, precisionCompare, PRECISION } from "../geometry/math.js";
import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_OPTIMIZATION_WORK_UNITS,
} from "../limits/constants.js";
import {
  getContextError,
} from "../limits/work-context.js";
import {
  OptimizationWorkGuard,
  OptimizationResourceLimitError,
  shuffle,
} from "../limits/optimization.js";
import {
  NodeEdgeLengthScorer,
} from "../placementcost/edge-length-scorer.js";
import {
  NodeEdgeLength,
} from "../placementcost/edge-length.js";
import {
  optimizerIsDescendantOf,
  optimizerFixedOrigin,
  optimizerMedianToNeighbors,
  chargeOptimizerScoring,
  optimizerSwapPositions,
  withOptimizerPositionsSwapped,
  OptimizerMutationSnapshot,
  captureOptimizerMutationStateInto,
} from "./optimizer-support.js";
import {
  captureOptimizerCandidateMovement,
} from "./candidate-movement.js";
import {
  numPointsWithinManhattanDistance,
  restoreNodePositions,
} from "./types.js";

const maxOptimizerPlacementCandidates = 1_000_000;

function pointKey(p) {
  const x = p.X != null ? p.X : p.x;
  const y = p.Y != null ? p.Y : p.y;
  return `${x},${y}`;
}

/**
 * canOptimizeNodeGuarded reports whether a node can be optimized.
 * A node must have edges (or usable nears), no fixed position, and not be in a tree.
 *
 * Pinned reference: internal/placement/sizeless_optimizer.go canOptimizeNodeGuarded
 */
export function canOptimizeNodeGuarded(node, g, guard) {
  if (node == null || g == null) {
    throw new Error(`TALA ${guard.Location()} found a nil optimizer node`);
  }
  if (node.Edges.length === 0) {
    let hasUsableNear = false;
    for (const near of node.Nears) {
      guard.Step();
      const usable = optimizerIsDescendantOf(near, node.Container, guard);
      if (usable) {
        hasUsableNear = true;
        break;
      }
    }
    if (!hasUsableNear) {
      return false;
    }
  }
  if (node.FixedTopLeft != null) {
    return false;
  }
  if (g.NodeToTree && g.NodeToTree.has(node)) {
    return false;
  }
  return true;
}

/**
 * SizelessOptimizer holds the state during the first part (sizeless) of the
 * placement optimization routine.
 *
 * Pinned reference: internal/placement/sizeless_optimizer.go sizelessOptimizer
 */
export class SizelessOptimizer {
  constructor(g, randGenerator) {
    this.mutationScratch = new OptimizerMutationSnapshot();
    this.nodes = [];
    this.g = g;
    this.randGenerator = randGenerator;
    this.occupied = new Map();
  }

  resetOccupied() {
    this.occupied.clear();
    for (const n of this.g.Nodes) {
      if (n.TopLeft == null) {
        continue;
      }
      this.occupied.set(pointKey(n.TopLeft), n);
    }
  }

  isOccupied(p) {
    return this.occupied.has(pointKey(p));
  }

  optimize(ctx, temp) {
    return this.optimizeWithLimit(ctx, temp, MAX_OPTIMIZATION_WORK_UNITS);
  }

  optimizeWithLimit(ctx, temp, workLimit) {
    const guard = new OptimizationWorkGuard(
      ctx,
      "sizelessOptimizer.optimize",
      workLimit
    );
    if (this == null || this.g == null) {
      throw new Error(
        "TALA sizelessOptimizer.optimize requires an optimizer with a graph"
      );
    }
    if (this.randGenerator == null) {
      throw new Error(
        "TALA sizelessOptimizer.optimize requires a random generator"
      );
    }

    let snapshot;
    try {
      snapshot = captureOptimizerMutationStateInto(
        this.g,
        guard,
        this.mutationScratch
      );

      const occupiedRef = this.occupied;
      const occupiedSnapshot = new Map();
      if (this.occupied != null) {
        for (const [point, node] of this.occupied) {
          guard.Step();
          occupiedSnapshot.set(point, node);
        }
      }

      const restoreOccupied = () => {
        if (occupiedRef == null) {
          this.occupied = null;
          return;
        }
        occupiedRef.clear();
        for (const [k, v] of occupiedSnapshot) {
          occupiedRef.set(k, v);
        }
        this.occupied = occupiedRef;
      };

      let complete = false;
      try {
        this.optimizeGuarded(ctx, temp, guard);
        guard.Finish();
        complete = true;
      } finally {
        if (!complete) {
          snapshot.restore();
          restoreOccupied();
        }
      }
    } finally {
      this.mutationScratch.release();
    }
  }

  optimizeGuarded(ctx, temp, guard) {
    if (this.nodes.length > MAX_ENGINE_NODES) {
      throw new Error(
        `TALA sizelessOptimizer.optimize node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    }

    const nodeIndices = new Array(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      guard.Step();
      nodeIndices[i] = i;
    }
    shuffle(nodeIndices, this.randGenerator, guard);

    for (const nodeIndex of nodeIndices) {
      guard.Step();
      const node = this.nodes[nodeIndex];
      if (node == null || node.TopLeft == null) {
        throw new Error("TALA sizelessOptimizer.optimize found an unpositioned node");
      }

      this.occupied.delete(pointKey(node.TopLeft));
      const medianPoint = this.medianPointGuarded(node, temp, guard);
      let distance;
      try {
        distance = this.findClosestUnoccupiedDistanceGuarded(
          node,
          medianPoint,
          guard
        );
      } catch (err) {
        throw new Error(
          `could not find an unoccupied distance for ${node.DebugID ? node.DebugID() : node.debugID()}: ${err.message}`
        );
      }
      const points = this.placementPointsGuarded(
        node,
        medianPoint,
        distance,
        guard
      );
      shuffle(points, this.randGenerator, guard);

      const moved = this.moveNodeToBestGuarded(ctx, node, points, guard);
      if (!moved) {
        const bestSwapCandidate = this.bestSwapCandidateGuarded(
          ctx,
          node,
          guard
        );
        if (bestSwapCandidate != null) {
          optimizerSwapPositions(node, bestSwapCandidate, guard);
          this.occupied.set(pointKey(bestSwapCandidate.TopLeft), bestSwapCandidate);
        }
      }
      this.occupied.set(pointKey(node.TopLeft), node);
    }
    guard.Finish();
  }

  medianPointGuarded(node, temp, guard) {
    const [rawMedianX, rawMedianY] = optimizerMedianToNeighbors(
      node,
      false,
      null,
      guard
    );
    let medianX = rawMedianX;
    let medianY = rawMedianY;

    const cell = this.g.CellSize;
    const owning = typeof node.OwningContainer === "function" ? node.OwningContainer() : node.owningContainer();
    const fixedOrigin = optimizerFixedOrigin(this.g, owning, guard);
    if (fixedOrigin != null) {
      if (cell <= 0 || !Number.isFinite(cell)) {
        throw new Error(
          `TALA ${guard.Location()} fixed-origin placement requires a finite positive cell size`
        );
      }
      if (medianX < fixedOrigin.X / cell) {
        medianX = fixedOrigin.X / cell;
        medianX += temp;
      }
      if (medianY < fixedOrigin.Y / cell) {
        medianY = fixedOrigin.Y / cell;
        medianY += temp;
      }
    }

    medianX += -temp + this.randGenerator.Float64() * (2.0 * temp);
    medianY += -temp + this.randGenerator.Float64() * (2.0 * temp);

    if (fixedOrigin != null) {
      medianX = Math.max(medianX, fixedOrigin.X / cell);
      medianY = Math.max(medianY, fixedOrigin.Y / cell);
    }

    return new Point(goRound(medianX), goRound(medianY));
  }

  FindClosestUnoccupiedDistance(ctx, node, medianPoint) {
    const guard = new OptimizationWorkGuard(
      ctx,
      "sizelessOptimizer.optimize",
      MAX_OPTIMIZATION_WORK_UNITS
    );
    return this.findClosestUnoccupiedDistanceGuarded(node, medianPoint, guard);
  }

  findClosestUnoccupiedDistance(ctx, node, medianPoint) {
    return this.FindClosestUnoccupiedDistance(ctx, node, medianPoint);
  }

  findClosestUnoccupiedDistanceGuarded(node, medianPoint, guard) {
    if (node == null || node.Graph == null || medianPoint == null) {
      throw new Error(
        `TALA ${guard.Location()} placement search requires a node, graph, and median`
      );
    }
    const owning = typeof node.OwningContainer === "function" ? node.OwningContainer() : node.owningContainer();
    const fixedOrigin = optimizerFixedOrigin(node.Graph, owning, guard);
    let originX = null;
    let originY = null;
    if (fixedOrigin != null) {
      if (node.Graph.CellSize <= 0 || !Number.isFinite(node.Graph.CellSize)) {
        throw new Error(
          `TALA ${guard.Location()} fixed-origin placement requires a finite positive cell size`
        );
      }
      originX = goRound(fixedOrigin.X / node.Graph.CellSize);
      originY = goRound(fixedOrigin.Y / node.Graph.CellSize);
    }
    const pastOrigin = (x, y) => {
      return originX != null && (x < originX || y < originY);
    };

    for (let curr = 0; curr <= 100; curr++) {
      guard.Step();
      for (let x = curr, y = 0; x >= -curr; x--) {
        guard.Step();
        if (y !== 0) {
          const p = new Point(medianPoint.X + x, medianPoint.Y - y);
          if (!pastOrigin(p.X, p.Y) && !this.isOccupied(p)) {
            return curr;
          }
        }
        const p = new Point(medianPoint.X + x, medianPoint.Y + y);
        if (!pastOrigin(p.X, p.Y) && !this.isOccupied(p)) {
          return curr;
        }
        if (x > 0) {
          y++;
        } else {
          y--;
        }
      }
    }
    throw new Error(
      `no unoccupied points within d=100 of p=&{${medianPoint.X} ${medianPoint.Y}}`
    );
  }

  placementPointsGuarded(node, medianPoint, minUnoccupiedDistance, guard) {
    if (node == null || node.Graph == null || medianPoint == null) {
      throw new Error(
        `TALA ${guard.Location()} placement generation requires a node, graph, and median`
      );
    }
    if (
      minUnoccupiedDistance < 0 ||
      minUnoccupiedDistance > 100 ||
      !Number.isFinite(minUnoccupiedDistance)
    ) {
      throw new Error(
        `TALA ${guard.Location()} placement distance must be finite and within [0, 100]`
      );
    }
    const distance = minUnoccupiedDistance + 1;
    const capacity = numPointsWithinManhattanDistance(distance) + 1;
    if (capacity < 0 || capacity > maxOptimizerPlacementCandidates) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: TALA sizelessOptimizer.optimize placement candidates exceed limit ${maxOptimizerPlacementCandidates}`
      );
    }
    const points = [];

    const owning = typeof node.OwningContainer === "function" ? node.OwningContainer() : node.owningContainer();
    const fixedOrigin = optimizerFixedOrigin(node.Graph, owning, guard);
    let originX = null;
    let originY = null;
    if (fixedOrigin != null) {
      if (node.Graph.CellSize <= 0 || !Number.isFinite(node.Graph.CellSize)) {
        throw new Error(
          `TALA ${guard.Location()} fixed-origin placement requires a finite positive cell size`
        );
      }
      originX = goRound(fixedOrigin.X / node.Graph.CellSize);
      originY = goRound(fixedOrigin.Y / node.Graph.CellSize);
    }
    const pastOrigin = (x, y) => {
      return originX != null && (x < originX || y < originY);
    };

    for (let x = distance; x >= -distance; x--) {
      guard.Step();
      for (let y = 0; y <= distance - Math.abs(x); y++) {
        guard.Step();
        if (y !== 0) {
          const point = new Point(medianPoint.X + x, medianPoint.Y - y);
          if (!pastOrigin(point.X, point.Y) && !this.isOccupied(point)) {
            points.push(point);
          }
        }
        const point = new Point(medianPoint.X + x, medianPoint.Y + y);
        if (!pastOrigin(point.X, point.Y) && !this.isOccupied(point)) {
          points.push(point);
        }
      }
    }

    return points;
  }

  moveNodeToBestGuarded(ctx, node, points, guard) {
    const scorer = new NodeEdgeLengthScorer(node, {
      EdgeAbductions: null,
      IncludeNodeSizes: false,
      EnforceMinimumGap: false,
      PenalizeDirection: true,
    });
    let leastDistance = Infinity;
    let leastDistancePoint = node.TopLeft.copy();
    const currentNodeX = node.TopLeft.X;
    const currentNodeY = node.TopLeft.Y;
    const movement = captureOptimizerCandidateMovement(node, guard);
    const originalPositions = movement.positions;
    let complete = false;
    try {
      for (const point of points) {
        guard.Step();
        if (point == null) {
          throw new Error("TALA sizelessOptimizer.optimize found a nil placement point");
        }
        const x = point.X;
        const y = point.Y;
        movement.moveAbs(x, y, guard);
        chargeOptimizerScoring(node, null, false, guard);
        const edgeLength = scorer.Score(ctx);
        const cmp = precisionCompare(edgeLength, leastDistance, PRECISION);
        if (cmp < 0) {
          leastDistance = edgeLength;
          leastDistancePoint = point;
        } else if (cmp === 0) {
          if (point.X === currentNodeX && point.Y === currentNodeY) {
            leastDistance = edgeLength;
            leastDistancePoint = point;
          }
        }
      }

      const err = getContextError(ctx);
      if (err != null) {
        const msg = err.message ?? String(err);
        throw new Error(`EdgeLength: ${msg}`);
      }
      if (!Number.isFinite(leastDistance)) {
        throw new Error("sizelessOptimizer.moveNodeToBest: could not find any placement");
      }

      movement.moveAbs(leastDistancePoint.X, leastDistancePoint.Y, guard);
      complete = true;
      return (
        node.TopLeft.X !== currentNodeX || node.TopLeft.Y !== currentNodeY
      );
    } finally {
      scorer.close();
      if (!complete) {
        restoreNodePositions(originalPositions);
      }
    }
  }

  bestSwapCandidateGuarded(ctx, node, guard) {
    chargeOptimizerScoring(node, null, false, guard);
    let minSwapL1 = NodeEdgeLength(ctx, node, {
      EdgeAbductions: null,
      IncludeNodeSizes: false,
      EnforceMinimumGap: false,
      PenalizeDirection: true,
    });
    let bestSwapCandidate = null;

    const swapCandidates = this.swapCandidatesGuarded(node, guard);
    shuffle(swapCandidates, this.randGenerator, guard);

    for (const swapCandidate of swapCandidates) {
      guard.Step();
      chargeOptimizerScoring(swapCandidate, null, false, guard);
      const currentL2 = NodeEdgeLength(ctx, swapCandidate, {
        EdgeAbductions: null,
        IncludeNodeSizes: false,
        EnforceMinimumGap: false,
        PenalizeDirection: true,
      });

      let swappedL1, swappedL2;
      withOptimizerPositionsSwapped(node, swapCandidate, guard, () => {
        chargeOptimizerScoring(node, null, false, guard);
        swappedL1 = NodeEdgeLength(ctx, node, {
          EdgeAbductions: null,
          IncludeNodeSizes: false,
          EnforceMinimumGap: false,
          PenalizeDirection: true,
        });
        if (precisionCompare(swappedL1, minSwapL1, PRECISION) < 0) {
          chargeOptimizerScoring(swapCandidate, null, false, guard);
          swappedL2 = NodeEdgeLength(ctx, swapCandidate, {
            EdgeAbductions: null,
            IncludeNodeSizes: false,
            EnforceMinimumGap: false,
            PenalizeDirection: true,
          });
        }
      });

      if (
        precisionCompare(swappedL1, minSwapL1, PRECISION) < 0 &&
        precisionCompare(swappedL2, currentL2, PRECISION) <= 0
      ) {
        minSwapL1 = swappedL1;
        bestSwapCandidate = swapCandidate;
      }
    }

    const err = getContextError(ctx);
    if (err != null) {
      const msg = err.message ?? String(err);
      throw new Error(`EdgeLength: ${msg}`);
    }
    return bestSwapCandidate;
  }

  swapCandidatesGuarded(node, guard) {
    const adjacent = [];
    const tl = node.TopLeft;

    const adjacentNode = (xDiff, yDiff) => {
      guard.Step();
      const key = `${tl.X + xDiff},${tl.Y + yDiff}`;
      const occupant = this.occupied.get(key);
      if (occupant != null) {
        const canOptimize = canOptimizeNodeGuarded(occupant, this.g, guard);
        if (canOptimize) {
          return occupant;
        }
      }
      return null;
    };

    const above = adjacentNode(0, -1);
    if (above != null) adjacent.push(above);
    const below = adjacentNode(0, 1);
    if (below != null) adjacent.push(below);
    const left = adjacentNode(-1, 0);
    if (left != null) adjacent.push(left);
    const right = adjacentNode(1, 0);
    if (right != null) adjacent.push(right);

    return adjacent;
  }
}

/**
 * newSizelessOptimizer validates the graph and prepares sizeless optimizer state.
 *
 * Pinned reference: internal/placement/sizeless_optimizer.go newSizelessOptimizer
 */
export function newSizelessOptimizer(ctx, g, randGenerator) {
  if (g == null) {
    throw new Error("TALA sizelessOptimizer requires a graph");
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(
      `TALA sizelessOptimizer node count exceeds limit ${MAX_ENGINE_NODES}`
    );
  }
  if (g.Edges.length > MAX_ENGINE_EDGES) {
    throw new Error(
      `TALA sizelessOptimizer edge count exceeds limit ${MAX_ENGINE_EDGES}`
    );
  }
  const guard = new OptimizationWorkGuard(
    ctx,
    "sizelessOptimizer.setup",
    MAX_OPTIMIZATION_WORK_UNITS
  );
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null || node.Graph == null) {
      throw new Error("TALA sizelessOptimizer found a node without a graph");
    }
    if (
      node.Edges.length > MAX_ENGINE_EDGES ||
      node.Nears.size > MAX_ENGINE_NODES
    ) {
      throw new Error(
        `TALA sizelessOptimizer node ${node.DebugID ? node.DebugID() : node.debugID()} adjacency references exceed engine limits`
      );
    }
    if (node.Graph.CellSize !== g.CellSize) {
      throw new Error(
        `mismatch of cell size, graph=${g.CellSize.toFixed(6)}, node=${node.Graph.CellSize.toFixed(6)}`
      );
    }
  }

  const optim = new SizelessOptimizer(g, randGenerator);
  optim.resetOccupied();

  for (const node of g.Nodes) {
    guard.Step();
    const canOptimize = canOptimizeNodeGuarded(node, g, guard);
    if (canOptimize) {
      optim.nodes.push(node);
    }
  }

  guard.Finish();
  return optim;
}

export const NewSizelessOptimizer = newSizelessOptimizer;
