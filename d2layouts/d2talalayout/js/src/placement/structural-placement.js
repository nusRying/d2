// Slice 46 — structural placement: placeNodes, placeNodesOrthogonally,
// Place, and Prepare.
//
// Pinned references:
//   d2layouts/d2talalayout/internal/placement/node_placement.go
//   d2layouts/d2talalayout/internal/placement/stages.go (Prepare, Place)

import { Box } from '../geometry/box.js';
import { Point } from '../geometry/point.js';
import { newGraph } from '../graph/graph.js';
import {
  abductEdges,
  applyEdgeAbductions,
  computeNodeSpacing,
  copyEntitiesFrom,
  halveTurnCost,
  restoreEdgeAbductions,
  setGraphReference,
  snapshotNodeGraphOwnership,
  splitSubgraphsTracked,
  SplitOptions,
} from '../graph/structural-access.js';
import { joinDistancedClusters } from '../grouping/join.js';
import { initialize as initializeLabels } from '../labeling/model.js';
import { getContextError } from '../limits/work-context.js';
import { computeOffsets, updateOffsets } from '../loops/index.js';
import { combineSubgraphs } from '../packing/index.js';
import { assignHerds, assignNears, commonUncleSiblings, syncHerdFences } from '../proximity/index.js';
import { GoRand } from '../random/go-math-rand.js';
import { descendants as treeDescendants, place as placeTrees } from '../trees/index.js';
import { LayoutAxis, oppositeAxis } from './axis.js';
import { optimizeCluster } from './cluster-optimization.js';
import { compaction } from './compaction.js';
import { orientationContext, orientSourceInterior } from './container-orientation.js';
import { direct } from './direct.js';
import { initializeNodes } from './initialize.js';
import { placeChildrenOrder } from './node-placement.js';
import { newSizedOptimizer } from './sized-optimizer.js';
import { newSizelessOptimizer } from './sizeless-optimizer.js';
import { initializeByGraphDistance } from './stress-initialize.js';
import { COMPACTION_FACTOR, NODE_PLACEMENT_ITERATIONS } from './tuning.js';
import { roundToPreviousCellSize } from './types.js';
import { validateCellSize, validateGridAlignment, validatePlacedNodes } from './validation.js';

// layoutgraph.ContainerPadding (geometry_policy.go).
const CONTAINER_PADDING = 60;

function placeNodesContextError(ctx) {
  const err = getContextError(ctx);
  if (err != null) {
    return new Error(`PlaceNodes: ${err.message ?? String(err)}`, { cause: err });
  }
  return null;
}

/**
 * placeNodes is phase 1 of the algorithm: places the children of root (and,
 * recursively, nested containers) in g.
 */
export function placeNodes(ctx, g, root, randomSeed, prevEdgeAbductions, ancestorObstacles) {
  if (g.Nodes.length === 0) return;

  if (g.Nodes.length === 1) {
    const node = g.Nodes[0];
    node.TopLeft = node.FixedTopLeft != null ? node.FixedTopLeft.copy() : new Point(0, 0);
    g.SyncNestedGeometry();
    // There may be trees that need to be reconnected to this node.
    placeTrees(ctx, g, root);
    direct(ctx, g, g.Nodes, root, {});
    return;
  }

  const childrenGraph = newGraph();
  copyEntitiesFrom(childrenGraph, g);
  for (const child of g.Containers.get(root) ?? []) {
    childrenGraph.AddNodeUnchecked(child);
  }
  if (childrenGraph.Nodes.length === 0) return;

  const fixedObstacles = [];
  for (const n of g.Containers.get(root) ?? []) {
    if (n.FixedTopLeft == null) continue;
    fixedObstacles.push(new Box(n.FixedTopLeft.copy(), n.Width, n.Height));
  }

  // Translate ancestor obstacles to be relative to this root; undone on exit.
  let obstacleShift = null;
  if (root != null && root.FixedTopLeft != null && (ancestorObstacles?.length ?? 0) > 1) {
    const dx = -root.FixedTopLeft.X - CONTAINER_PADDING;
    const dy = -root.FixedTopLeft.Y - CONTAINER_PADDING;
    if (dx !== 0 || dy !== 0) {
      for (const b of ancestorObstacles) {
        b.TopLeft.X += dx;
        b.TopLeft.Y += dy;
      }
      obstacleShift = [dx, dy];
    }
  }

  let edgeAbductions = null;
  let abductionsRestored = false;
  let splitOwnership = null;
  let splitCommitted = false;
  try {
    edgeAbductions = abductEdges(g, root, childrenGraph);

    const childrenOrder = placeChildrenOrder(ctx, g.Containers.get(root) ?? [], edgeAbductions);
    for (const child of childrenOrder) {
      if (child.Hierarchy != null) continue;
      // Recurse into nested containers first: most nested to least.
      if (child.IsContainer()) {
        placeNodes(ctx, g, child, randomSeed, edgeAbductions, fixedObstacles);
        updateOffsets(child);
        // A descendant may have placed trees, so refresh the containers map.
        childrenGraph.Containers = g.Containers;
      }
      if (child.IsClusterVessel()) {
        for (const n of g.Clusters.get(child).Nodes) {
          if (n.IsContainer()) {
            placeNodes(ctx, g, n, randomSeed, edgeAbductions, fixedObstacles);
            childrenGraph.Containers = g.Containers;
          }
        }
      }
    }

    assignNears(ctx, childrenGraph, root, prevEdgeAbductions);
    assignHerds(ctx, childrenGraph, root, prevEdgeAbductions);
    const [subgraphs, journal] = splitSubgraphsTracked(
      ctx,
      childrenGraph,
      new SplitOptions({ IncludeNears: true, TraverseTrees: true }),
      null,
    );
    splitOwnership = journal;

    for (const subgraph of subgraphs) {
      subgraph.ComputeCellSize();
      // Nested nodes point at the subgraph; several calls use node.Graph.
      setGraphReference(subgraph.Nodes, subgraph);

      if (subgraph.Nodes[0].Hierarchy == null) {
        const rng = new GoRand(randomSeed);
        placeNodesOrthogonally(ctx, root, subgraph, edgeAbductions, rng, ancestorObstacles, randomSeed);
        for (const n of subgraph.Nodes) {
          if (n.IsClusterVessel()) {
            optimizeCluster(ctx, subgraph.Clusters.get(n), true);
          }
        }
      }

      placeTrees(ctx, subgraph, root);
      // Tree nodes and edges were restored within subgraph; add them to g too.
      for (const n of subgraph.Nodes) {
        for (const treeRoot of g.Trees.get(n) ?? []) {
          for (const tree of [...treeDescendants(treeRoot), treeRoot]) {
            g.AddNodeUnchecked(tree.Node);
            g.AddEdge(tree.SentinelEdge);
          }
        }
      }
      // Keep g and every subgraph pointing at the same root children slice.
      const rootChildren = subgraph.Containers.get(root) ?? null;
      g.Containers.set(root, rootChildren);
      for (const otherSubgraph of subgraphs) {
        otherSubgraph.Containers.set(root, rootChildren);
      }

      // Mirroring needs the edges temporarily restored to find reachable contents.
      restoreEdgeAbductions(subgraph, edgeAbductions);
      let directErr = null;
      try {
        direct(ctx, subgraph, subgraph.Nodes, root, {});
      } catch (err) {
        directErr = err;
      }
      applyEdgeAbductions(subgraph, edgeAbductions);
      if (directErr != null) throw directErr;

      validatePlacedNodes(root, subgraph.Nodes);
    }

    const combined = combineSubgraphs(ctx, g, subgraphs, ancestorObstacles);
    orientSourceInterior(ctx, combined, root, ancestorObstacles);

    if (root != null) {
      root.FitToGraph(combined, g.ContainerPadding(root, false));
      // The root may be a cluster node; resize every cluster that holds it.
      for (const c of g.Clusters.values()) {
        if (c.Nodes.includes(root)) c.Resize(c.Vessel);
      }
    }

    restoreEdgeAbductions(g, edgeAbductions);
    setGraphReference(g.Nodes, g);
    abductionsRestored = true;
    splitCommitted = true;
  } finally {
    // Go defers run in reverse registration order: split ownership, then
    // abductions, then the obstacle translation.
    if (splitOwnership != null && !splitCommitted) {
      splitOwnership.Restore();
    }
    if (edgeAbductions != null && !abductionsRestored) {
      restoreEdgeAbductions(g, edgeAbductions);
      setGraphReference(g.Nodes, g);
    }
    if (obstacleShift != null) {
      for (const b of ancestorObstacles) {
        b.TopLeft.X -= obstacleShift[0];
        b.TopLeft.Y -= obstacleShift[1];
      }
    }
  }
}

/**
 * placeNodesOrthogonally — based on "Graph Compact Orthogonal Layout
 * Algorithm" (Freivalds and Glagolevs). seed is optional (Go variadic).
 */
export function placeNodesOrthogonally(ctx, root, subgraph, edgeAbductions, randGenerator, obstacles, seed) {
  const fixed = subgraph.FixedNodes() ?? [];
  let initialized = false;
  if (seed !== undefined && seed !== null && BigInt(seed) % 2n === 0n) {
    initialized = initializeByGraphDistance(ctx, subgraph);
  }
  if (!initialized) {
    initializeNodes(ctx, subgraph);
  }
  // Inner cluster nodes and container children follow this nesting level.
  subgraph.SyncNestedGeometry();

  const n = subgraph.Nodes.length;
  const numIterations = Math.trunc(NODE_PLACEMENT_ITERATIONS * Math.sqrt(n));
  let temp = 2 * Math.sqrt(n);
  const coolingFactor = Math.pow(0.2 / temp, 1.0 / numIterations);

  // Compaction every 9 iterations, alternating axes.
  const compactionIteration = 9;
  let compactionAxis = LayoutAxis.Horizontal;

  const sizeless = newSizelessOptimizer(ctx, subgraph, randGenerator);
  const half = Math.trunc(numIterations / 2);
  for (let i = 0; i < half; i++) {
    const ctxErr = placeNodesContextError(ctx);
    if (ctxErr != null) throw ctxErr;
    sizeless.optimize(ctx, temp);
    if (i % compactionIteration === 0) {
      compaction(ctx, subgraph, { axis: compactionAxis, factor: COMPACTION_FACTOR });
      compactionAxis = oppositeAxis(compactionAxis);
      sizeless.resetOccupied();
    }
    temp = temp * coolingFactor;
  }

  compaction(ctx, subgraph, {
    edgeAbductions,
    axis: LayoutAxis.Horizontal,
    includeSizes: true,
    factor: COMPACTION_FACTOR,
    transition: true,
  });
  compaction(ctx, subgraph, {
    edgeAbductions,
    axis: LayoutAxis.Vertical,
    includeSizes: true,
    factor: COMPACTION_FACTOR,
    transition: true,
  });

  // Shift fixed nodes to their fixed top-left positions.
  if (fixed.length > 0) {
    const dx = fixed[0].FixedTopLeft.X - fixed[0].TopLeft.X;
    const dy = fixed[0].FixedTopLeft.Y - fixed[0].TopLeft.Y;
    for (const node of subgraph.Nodes) node.MoveWithChildren(dx, dy);
    for (const node of fixed) {
      // Adjust precisely, ignoring cell-size alignment.
      node.MoveAbsWithChildren(node.FixedTopLeft.X, node.FixedTopLeft.Y);
    }
  }

  validateCellSize(subgraph);
  for (const node of subgraph.Nodes) {
    if (node.FixedTopLeft != null) continue;
    let x = node.TopLeft.X;
    let y = node.TopLeft.Y;
    if (node.TopLeft.X % subgraph.CellSize !== 0) x = roundToPreviousCellSize(node.TopLeft.X, subgraph.CellSize);
    if (node.TopLeft.Y % subgraph.CellSize !== 0) y = roundToPreviousCellSize(node.TopLeft.Y, subgraph.CellSize);
    if (x !== node.TopLeft.X || y !== node.TopLeft.Y) node.MoveAbsWithChildren(x, y);
  }
  validateGridAlignment(subgraph);

  // Cache the turn cost for edge length estimates, then halve it: with a high
  // compaction factor the overall max length is roughly half.
  subgraph.TurnCost();
  halveTurnCost(subgraph);

  const sized = newSizedOptimizer(ctx, subgraph, root, edgeAbductions, randGenerator, obstacles);
  syncHerdFences(subgraph);
  for (let i = half + 1; i < numIterations; i++) {
    const ctxErr = placeNodesContextError(ctx);
    if (ctxErr != null) throw ctxErr;
    sized.optimize(ctx, temp);
    if (i % compactionIteration === 0) {
      const factor = Math.max(1.0, 1.0 + (2.0 * (numIterations - i - 30)) / (0.5 * numIterations));
      compaction(ctx, subgraph, { edgeAbductions, axis: compactionAxis, includeSizes: true, factor });
      compactionAxis = oppositeAxis(compactionAxis);
      joinDistancedClusters(ctx, subgraph);
      syncHerdFences(subgraph);
    }
    temp = temp * coolingFactor;
  }
  joinDistancedClusters(ctx, subgraph);
  syncHerdFences(subgraph);

  for (let i = 0; i < 10; i++) {
    if (!sized.optimize(ctx, 0.0)) break;
  }

  if (fixed.length > 0) {
    const dx = fixed[0].FixedTopLeft.X - fixed[0].TopLeft.X;
    const dy = fixed[0].FixedTopLeft.Y - fixed[0].TopLeft.Y;
    for (const node of subgraph.Nodes) node.MoveWithChildren(dx, dy);
    for (const node of fixed) {
      node.TopLeft = node.FixedTopLeft.copy();
    }
  }
}

/** Prepare: loop offsets, default label placement, node spacing. */
export function prepare(graph) {
  computeOffsets(graph);
  initializeLabels(graph);
  computeNodeSpacing(graph);
}

/**
 * Place runs structural placement for the whole graph.
 *
 * Ownership contract (pinned Go): CommonUncleSiblings is set for the run and
 * cleared on success; on any failure (error or throw) every Node.Graph owner
 * captured before placement and the prior CommonUncleSiblings value are
 * restored. Geometry is not rolled back.
 */
export function place(ctx, graph, seed) {
  if (graph == null) {
    throw new Error('layout invariant violated: Place requires a graph');
  }
  const priorCommonUncleSiblings = graph.CommonUncleSiblings;
  let ownership = null;
  let complete = false;
  try {
    graph.CommonUncleSiblings = commonUncleSiblings(graph);
    ownership = snapshotNodeGraphOwnership(ctx, graph);
    const placementCtx = orientationContext(ctx, graph);
    placeNodes(placementCtx, graph, null, seed, null, null);
    const nodes = [];
    for (const node of graph.Nodes) {
      nodes.push(node);
      nodes.push(...graph.AllDescendantNodes(node, true));
    }
    for (const node of nodes) node.Graph = graph;
    graph.ComputeCellSize();
    graph.ResetTurnCost();
    complete = true;
  } finally {
    if (complete) {
      // Successful placement does not retain transient proximity hints.
      graph.CommonUncleSiblings = null;
    } else {
      if (ownership != null) ownership.Restore();
      graph.CommonUncleSiblings = priorCommonUncleSiblings;
    }
  }
}

export const Place = place;
export const Prepare = prepare;
export const PlaceNodes = placeNodes;
