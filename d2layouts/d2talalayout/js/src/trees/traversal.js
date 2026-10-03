/**
 * Tree traversal.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/traversal.go
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

/**
 * Descendants returns tree descendants in the breadth-first order used when
 * restored tree nodes and edges are copied back into an owning graph.
 * A null root returns null (Go nil slice).
 */
export function Descendants(root) {
  if (root == null) {
    return null;
  }
  const descendants = [];
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const child of current.Children) {
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

export const descendants = Descendants;
