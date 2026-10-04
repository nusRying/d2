// Slice 47 — PARTIAL port of the route coordinator.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/coordinator.go
//
// Only the leaf overlap predicates the routing primitives depend on are
// ported here (isVerticalOrHorizontalOverlap, findOverlappingEdges,
// edgeCanOverlapEdges). The coordinator itself — routeLine/routeLineGuarded,
// StraightEdgesFallback, ReorderDuplicates, Crosshatch, route generation — is
// ported in a later phase and belongs in this same file.
// standalone-route-guard.js reaches routeLineGuarded through a namespace
// import so it resolves once that port lands.

import { intersects } from './geometry.js';
import {
  edgeEquivalentStyles,
  edgeMatchingArrowheads,
  edgeOwnArrowheadsMatch,
} from './layoutgraph-route-support.js';

/** isVerticalOrHorizontalOverlap: parallel axis-aligned segments that touch. */
export function isVerticalOrHorizontalOverlap(start, end, otherStart, otherEnd) {
  const bothVertical = start.X === end.X && otherStart.X === otherEnd.X;
  const bothHorizontal = start.Y === end.Y && otherStart.Y === otherEnd.Y;
  if (bothVertical || bothHorizontal) {
    if (intersects(otherStart, otherEnd, start, end)) {
      return true;
    }
  }
  return false;
}

export function findOverlappingEdges(start, end, otherEdges) {
  const overlappingEdges = [];
  for (const e of otherEdges ?? []) {
    const points = e.Points ?? [];
    for (let i = 0; i < points.length - 1; i++) {
      if (isVerticalOrHorizontalOverlap(start, end, points[i], points[i + 1])) {
        overlappingEdges.push(e);
        break;
      }
    }
  }
  return overlappingEdges;
}

/**
 * edgeCanOverlapEdges reports whether `edge` may share route segments with
 * every edge in otherEdges. The cluster-node maps are Sets (or Maps) keyed by
 * node; only membership and size are read.
 */
export function edgeCanOverlapEdges(edge, otherEdges, sourceClusterNodes, targetClusterNodes) {
  const others = otherEdges ?? [];
  if (others.length === 0) {
    return true;
  }
  if (edge.TargetArrowheadLabel != null || edge.SourceArrowheadLabel != null) {
    return false;
  }
  for (const e of others) {
    if (e.TargetArrowheadLabel != null || e.SourceArrowheadLabel != null) {
      return false;
    }
    if (!edgeEquivalentStyles(edge, e)) {
      return false;
    }
  }

  const sourceSize = sourceClusterNodes == null ? 0 : sourceClusterNodes.size;
  const targetSize = targetClusterNodes == null ? 0 : targetClusterNodes.size;
  let isClusterEdge = false;
  if (sourceSize > 0) {
    let hasNonSourceClusterEdge = false;
    for (const otherEdge of others) {
      const isFromSourceCluster = sourceClusterNodes.has(otherEdge.From);
      const isToSourceCluster = sourceClusterNodes.has(otherEdge.To);
      if (!isFromSourceCluster && !isToSourceCluster) {
        hasNonSourceClusterEdge = true;
        break;
      }
    }
    if (!hasNonSourceClusterEdge) {
      isClusterEdge = true;
    }
  }
  if (!isClusterEdge && targetSize > 0) {
    let hasNonTargetClusterEdge = false;
    for (const otherEdge of others) {
      const isFromTargetCluster = targetClusterNodes.has(otherEdge.From);
      const isToTargetCluster = targetClusterNodes.has(otherEdge.To);
      if (!isFromTargetCluster && !isToTargetCluster) {
        hasNonTargetClusterEdge = true;
        break;
      }
    }
    if (!hasNonTargetClusterEdge) {
      isClusterEdge = true;
    }
  }

  // If directed edges share a source or target, they can share an edge.
  let allMatchingDirected = edge.IsDirected();
  if (allMatchingDirected) {
    for (const otherEdge of others) {
      if (!otherEdge.IsDirected()) {
        allMatchingDirected = false;
        break;
      }
      if (!(edge.To === otherEdge.To || edge.From === otherEdge.From)) {
        allMatchingDirected = false;
        break;
      }
      if (edge.TargetArrowhead !== otherEdge.TargetArrowhead || edge.SourceArrowhead !== otherEdge.SourceArrowhead) {
        allMatchingDirected = false;
        break;
      }
    }
  }
  if (allMatchingDirected) {
    return true;
  }

  let allUndirected = false;
  const allBidirectional = edge.IsBidirectional() && edgeOwnArrowheadsMatch(edge);
  if (allBidirectional) {
    for (const otherEdge of others) {
      if (!otherEdge.IsBidirectional() || !edgeMatchingArrowheads(edge, otherEdge)) {
        return false;
      }
    }
  } else {
    allUndirected = edge.IsUndirected();
    if (allUndirected) {
      for (const otherEdge of others) {
        if (!otherEdge.IsUndirected()) {
          return false;
        }
      }
    }
  }
  if (!allBidirectional && !allUndirected) {
    return false;
  }

  if (isClusterEdge) {
    return true;
  }

  // Assuming no self-loops (node appears once per edge).
  const nodeCounts = new Map();
  const bump = (node) => nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
  bump(edge.From);
  bump(edge.To);
  for (const otherEdge of others) {
    bump(otherEdge.From);
    bump(otherEdge.To);
  }
  // Order-independent: any node shared by every edge proves the overlap safe.
  const totalEdgeCount = others.length + 1;
  for (const count of nodeCounts.values()) {
    if (count === totalEdgeCount) {
      return true;
    }
  }
  return false;
}
