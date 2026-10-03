/**
 * Tree edge directions and the package work guard.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/types.go
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';

export const Outwards = 'Outwards';
export const Inwards = 'Inwards';
export const Bidirectional = 'Bidirectional';
export const Undirected = 'Undirected';

/** Go TreeEdgeDirection string constants. */
export const TreeEdgeDirection = Object.freeze({
  Outwards,
  Inwards,
  Bidirectional,
  Undirected,
});

/** newWorkGuard → limits.NewWorkGuard(ctx, location, MaxEngineWorkUnits); throws on error. */
export function newWorkGuard(ctx, location) {
  return new WorkGuard(ctx, location, MAX_ENGINE_WORK_UNITS);
}

/**
 * treeEdgeDirection determines whether edge points from node toward its
 * sentinel, toward node, in both directions, or in neither direction.
 */
export function treeEdgeDirection(node, edge) {
  if (edge.isBidirectional()) return Bidirectional;
  if (edge.isUndirected()) return Undirected;
  if (edge.To === node) return Inwards;
  return Outwards;
}
