/**
 * Slice 46 private helpers for the Align/Swap/Equidistance/Dejitter/
 * BalanceSymmetry placement stages.
 *
 * These cover pinned Go behavior that the shared JS ports do not expose
 * correctly (see each helper). They are module-private to the placement
 * stages and are NOT re-exported from placement/index.js or the root index.
 *
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { Point } from '../geometry/point.js';
import { nodesBounds } from '../graph/node-bounds.js';
import { checkScoringCancellation, scoringCancellationError } from '../placementcost/geometry.js';

// layoutgraph/graph.go centerPortMultiplier.
const CENTER_PORT_MULTIPLIER = 0.04287499999999999;

/**
 * nonCenterPortCostValue lazily computes and caches the graph's non-center
 * port penalty.
 *
 * Pinned Go: layoutgraph.Graph.nonCenterPortCostValue (graph.go:552),
 * exposed as Graph.NonCenterPortCost (routing_access.go:34). The shared JS
 * Graph has no port of it (placementcost/graph.js containerAlignmentCost reads
 * the raw, possibly-uncomputed field).
 */
export function nonCenterPortCostValue(graph) {
  if (graph.nonCenterPortCost !== 0) {
    return graph.nonCenterPortCost;
  }
  if (graph.Edges.length === 0) {
    return 0;
  }
  let cost = CENTER_PORT_MULTIPLIER * graph.Edges.length * graph.maxEdgeLength();
  let minSize = Infinity;
  for (const n of graph.Nodes) {
    if (n.isContainer) {
      continue;
    }
    minSize = Math.min(minSize, n.Height);
    minSize = Math.min(minSize, n.Width);
  }
  if (minSize !== Infinity) {
    cost = Math.max(cost, minSize / 3);
  }
  graph.nonCenterPortCost = cost;
  return cost;
}

/**
 * containerAlignmentCost scores misalignment between equally sized peer
 * containers.
 *
 * Pinned Go: placementcost.ContainerAlignmentCost (placementcost/graph.go:358).
 * The shared JS port (placementcost/graph.js) calls `n1.isContainer()` on the
 * boolean Node field (TypeError for any graph with two or more nodes) and reads
 * graph.nonCenterPortCost without Go's lazy computation, so the stages use
 * this exact port instead. Errors throw (Go returns them).
 */
export function containerAlignmentCost(ctx, graph) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  let l = 0.0;
  const nodes = graph.Nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    const err1 = scoringCancellationError(ctx, i);
    if (err1 != null) {
      throw err1;
    }
    const n1 = nodes[i];
    if (!n1.IsContainer()) {
      continue;
    }
    for (let j = i + 1; j < nodes.length; j++) {
      const err2 = scoringCancellationError(ctx, j - i - 1);
      if (err2 != null) {
        throw err2;
      }
      const n2 = nodes[j];
      if (!n2.IsContainer()) {
        continue;
      }
      if (n1.effectiveContainer() !== n2.effectiveContainer()) {
        continue;
      }
      if (n1.Width === n2.Width && n1.Height === n2.Height) {
        if (n1.TopLeft.X !== n2.TopLeft.X && n1.TopLeft.Y !== n2.TopLeft.Y) {
          l += nonCenterPortCostValue(graph);
        }
      }
    }
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return l;
}

/**
 * nodesCenter is Go layoutgraph.Nodes.Center (node.go:485): the center of the
 * rounded bounding box of nodes. A nil TopLeft is a Go nil-pointer panic.
 */
export function nodesCenter(nodes) {
  const [tl, br] = nodesBounds(nodes);
  if (tl == null) {
    throw new TypeError('runtime error: invalid memory address or nil pointer dereference');
  }
  return new Point(tl.X + (br.X - tl.X) / 2, tl.Y + (br.Y - tl.Y) / 2);
}
