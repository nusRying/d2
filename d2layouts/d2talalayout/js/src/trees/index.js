/**
 * Public API of the trees port (Go package internal/trees).
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/{types,traversal,layout}.go
 *
 * Intentionally not re-exported from js/src/index.js or
 * js/src/placement/index.js; structural placement imports this module directly.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { Preprocess, Place } from './layout.js';
import { Descendants } from './traversal.js';

export {
  TreeEdgeDirection,
  Outwards,
  Inwards,
  Bidirectional,
  Undirected,
} from './types.js';

export { Preprocess, Place, Descendants };

/** trees.Preprocess(ctx, g); throws on error. */
export function preprocess(ctx, g) {
  Preprocess(ctx, g);
}

/** trees.Place(ctx, g, root); root null = root container. Throws on error. */
export function place(ctx, g, root) {
  Place(ctx, g, root);
}

/** trees.Descendants(tree): breadth-first descendants; null for a null tree. */
export function descendants(tree) {
  return Descendants(tree);
}
