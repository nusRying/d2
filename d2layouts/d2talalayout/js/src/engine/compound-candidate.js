// Slice 50 — optional compound-layout candidate.
//
// Pinned reference: d2layouts/d2talalayout/internal/engine/compound_candidate.go

import { Clone } from '../graph/clone.js';
import { isHorizontal } from '../geometry/orientation.js';
import { getContextError } from '../limits/work-context.js';
import { GoRand } from '../random/go-math-rand.js';
import { placeCompound } from '../hierarchy/index.js';
import { normalize } from '../placement/stage-geometry.js';
import { MAX_PIPELINE_GRAPH_SIZE, newPipeline } from './pipeline.js';

function throwIfCanceled(ctx) {
  const err = getContextError(ctx);
  if (err != null) throw err;
}

/**
 * CompoundCandidate returns either the input graph (no candidate) or a new
 * graph whose top-level compound layout was re-placed and rerouted. The input
 * graph is never mutated.
 */
export function CompoundCandidate(ctx, graph) {
  if (ctx == null || graph == null) {
    throw new Error('TALA compound candidate requires a context and graph');
  }
  throwIfCanceled(ctx);
  const rootChildren = graph.Containers.get(null) ?? [];
  if (graph.Nodes.length > 128 || graph.Edges.length > 256 || rootChildren.length < 3 || rootChildren.length > 64) {
    return graph;
  }
  let detailed = false;
  for (const node of rootChildren) {
    detailed = detailed || node.IsContainer();
  }
  if (!detailed || graph.HasFixedNode()) {
    return graph;
  }
  const candidate = Clone(ctx, graph);
  const changed = placeCompound(ctx, candidate, new GoRand(0n));
  if (!changed) {
    return graph;
  }
  const worseAlignment = compoundCrossAxisDetours(candidate) > compoundCrossAxisDetours(graph);
  throwIfCanceled(ctx);
  if (worseAlignment) {
    return graph;
  }
  reroutePlaced(ctx, candidate);
  const [tl, br] = candidate.BoundingBox();
  if (tl != null && br != null && (br.X - tl.X > MAX_PIPELINE_GRAPH_SIZE || br.Y - tl.Y > MAX_PIPELINE_GRAPH_SIZE)) {
    return graph;
  }
  return candidate;
}

/**
 * compoundCrossAxisDetours counts root-crossing edges whose top-level roots
 * do not overlap on the cross axis (touching projections are not disjoint).
 */
export function compoundCrossAxisDetours(g) {
  const rootOf = new Map();
  for (const n of g.Nodes) {
    let root = n;
    while (root.Container != null) root = root.Container;
    rootOf.set(n, root);
  }
  const horizontal = isHorizontal(g.Direction(null));
  let detours = 0;
  for (const edge of g.Edges) {
    // Go map lookup: a missing key yields nil.
    const from = rootOf.get(edge.From) ?? null;
    const to = rootOf.get(edge.To) ?? null;
    if (from === to) continue;
    if (horizontal) {
      if (from.TopLeft.Y + from.Height < to.TopLeft.Y || to.TopLeft.Y + to.Height < from.TopLeft.Y) {
        detours++;
      }
    } else if (from.TopLeft.X + from.Width < to.TopLeft.X || to.TopLeft.X + to.Width < from.TopLeft.X) {
      detours++;
    }
  }
  return detours;
}

/** reroutePlaced reroutes an already-placed graph with the routing mini-pipeline. */
export function reroutePlaced(ctx, g) {
  const p = newPipeline(g, 0n, false);
  p.resetFullLayoutRouteState();
  const stages = [
    (c) => p.edgeRoutingStage(c),
    (c) => p.simplifyEdgeRoutes(c),
    (c) => p.swapEdgePorts(c),
    (c) => p.straightEdgesFallback(c),
    (c) => p.balanceEdgeSegments(c),
    (c) => p.fixClusterEdgeBranching(c),
    (c) => p.traceEdgesToShapeBorder(c),
    (c) => p.reorderDuplicates(c),
    (c) => p.placeLabels(c),
  ];
  for (const stage of stages) {
    throwIfCanceled(ctx);
    stage(ctx);
  }
  if (!g.HasFixedNode()) {
    normalize(g);
  }
  throwIfCanceled(ctx);
}
