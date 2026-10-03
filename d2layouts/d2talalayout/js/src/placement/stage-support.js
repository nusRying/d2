/**
 * Slice 46 private helper for the BalanceSymmetry placement stage.
 *
 * Not re-exported from placement/index.js or the root index.
 *
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { Point } from '../geometry/point.js';
import { nodesBounds } from '../graph/node-bounds.js';

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
