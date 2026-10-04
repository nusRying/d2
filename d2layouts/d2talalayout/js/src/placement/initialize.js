import { Point } from "../geometry/point.js";
import { Validate as validate } from "../graph/topology-preflight.js";
import { WorkGuard } from "../limits/work-guard.js";
import { getContextError } from "../limits/work-context.js";
import { MAX_ENGINE_WORK_UNITS } from "../limits/constants.js";
import { NodeEdgeLength } from "../placementcost/edge-length.js";
import { snapshotNodePositionsContext, restoreNodePositions } from "./types.js";
import { occupied, medianToNeighbors } from "./metrics.js";
import { newSizelessOptimizer } from "./sizeless-optimizer.js";
import { COMPACTION_FACTOR } from "./tuning.js";

/**
 * nodeCandidatePositions determines potential placement coordinates for node.
 *
 * Pinned reference: internal/placement/initialize.go nodeCandidatePositions
 */
export function nodeCandidatePositions(ctx, node, g, opt) {
  const [floatMedianX, floatMedianY] = medianToNeighbors(node, false, null);
  const medianX = Math.floor(floatMedianX);
  const medianY = Math.floor(floatMedianY);
  const d = opt.FindClosestUnoccupiedDistance(ctx, node, new Point(medianX, medianY));

  let topLeftX = medianX - d - 2;
  let topLeftY = medianY - d - 2;
  const bottomRightX = medianX + d + 2;
  const bottomRightY = medianY + d + 2;

  const hasFixed = typeof g.HasFixedNode === "function" ? g.HasFixedNode() : g.hasFixedNode();
  if (hasFixed) {
    topLeftX = Math.max(topLeftX, 0);
    topLeftY = Math.max(topLeftY, 0);
  }

  const positions = [];
  const isMajorityTarget =
    typeof node.IsMajorityTarget === "function"
      ? node.IsMajorityTarget()
      : node.isMajorityTarget();

  if (isMajorityTarget) {
    // If it's mainly a target node, give preference to bottom-right
    for (let x = bottomRightX; x >= topLeftX; x--) {
      for (let y = bottomRightY; y >= topLeftY; y--) {
        positions.push(new Point(x, y));
      }
    }
  } else {
    for (let x = topLeftX; x <= bottomRightX; x++) {
      for (let y = topLeftY; y <= bottomRightY; y++) {
        positions.push(new Point(x, y));
      }
    }
  }

  return positions;
}

export const NodeCandidatePositions = nodeCandidatePositions;

/**
 * initializeNodes assigns initial integer grid positions to all unpositioned nodes.
 *
 * Pinned reference: internal/placement/initialize.go initializeNodes
 */
export function initializeNodes(ctx, g) {
  validate(ctx, "InitializeNodes", g);
  if (g.Nodes.length === 0) {
    return;
  }
  const originalPositions = snapshotNodePositionsContext(
    ctx,
    "InitializeNodes",
    g.Nodes
  );
  let complete = false;
  try {
    const reachabilityGuard = new WorkGuard(
      ctx,
      "InitializeNodesReachability",
      MAX_ENGINE_WORK_UNITS
    );
    const sizelessFactor = g.CellSize * COMPACTION_FACTOR;

    const init = (node) => {
      const err = getContextError(ctx);
      if (err != null) {
        const msg = err.message ?? String(err);
        throw new Error(`InitializeNodes: ${msg}`);
      }
      if (node.TopLeft != null) {
        return;
      }

      let leastDistance = Infinity;
      let leastDistancePoint = node.TopLeft;

      const sizeless = newSizelessOptimizer(ctx, g, null);
      const candidates = nodeCandidatePositions(ctx, node, g, sizeless);

      for (const p of candidates) {
        const [, isOccupied] = occupied(g, p);
        if (isOccupied) {
          continue;
        }

        node.TopLeft = p;
        let edgeLength;
        try {
          edgeLength = NodeEdgeLength(ctx, node, {
            EdgeAbductions: null,
            IncludeNodeSizes: false,
            EnforceMinimumGap: false,
            PenalizeDirection: true,
          });
        } catch (err) {
          node.TopLeft = null;
          throw err;
        }

        if (edgeLength < leastDistance) {
          leastDistance = edgeLength;
          leastDistancePoint = p;
        }

        node.TopLeft = null;
      }

      node.TopLeft = leastDistancePoint;
    };

    const hasFixed = typeof g.HasFixedNode === "function" ? g.HasFixedNode() : g.hasFixedNode();
    if (hasFixed) {
      const fixedNodes = typeof g.FixedNodes === "function" ? g.FixedNodes() : g.fixedNodes();
      const nodes = [];

      for (const fn of fixedNodes) {
        const reachable = fn.AllReachableNodesContext(
          false,
          true,
          true,
          null,
          reachabilityGuard
        );
        nodes.push(...reachable);
        for (const n of reachable) {
          n.TopLeft = null;
        }
      }

      for (const fn of fixedNodes) {
        fn.TopLeft = new Point(
          Math.ceil(fn.FixedTopLeft.X / sizelessFactor),
          Math.ceil(fn.FixedTopLeft.Y / sizelessFactor)
        );
      }

      for (const n of nodes) {
        init(n);
      }
    } else {
      const bfsOrder = g.Nodes[0].AllReachableNodesContext(
        false,
        true,
        true,
        null,
        reachabilityGuard
      );

      for (const n of bfsOrder.slice(1)) {
        n.TopLeft = null;
      }
      g.Nodes[0].TopLeft = new Point(g.Nodes.length, g.Nodes.length);

      for (const node of bfsOrder.slice(1)) {
        init(node);
      }
    }

    for (const node of g.Nodes) {
      if (node.TopLeft == null) {
        throw new Error(
          `missed initializing node ${node.DebugID ? node.DebugID() : node.debugID()}`
        );
      }
    }

    reachabilityGuard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      restoreNodePositions(originalPositions);
    }
  }
}

export const InitializeNodes = initializeNodes;
