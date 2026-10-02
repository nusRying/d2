import { Point } from '../geometry/point.js';

export function nodesLeftmost(nodes, node) {
  if (!nodes) return true;
  for (const n of nodes) {
    if (n === node) continue;
    if (n.TopLeft == null) continue;
    if (n.TopLeft.X < node.TopLeft.X) {
      return false;
    }
  }
  return true;
}

export function nodesTopmost(nodes, node) {
  if (!nodes) return true;
  for (const n of nodes) {
    if (n === node) continue;
    if (n.TopLeft == null) continue;
    if (n.TopLeft.Y < node.TopLeft.Y) {
      return false;
    }
  }
  return true;
}

export function nodesRightmost(nodes, node) {
  if (!nodes) return true;
  for (const n of nodes) {
    if (n === node) continue;
    if (n.TopLeft == null) continue;
    if (n.TopLeft.X + n.Width > node.TopLeft.X + node.Width) {
      return false;
    }
  }
  return true;
}

export function nodesBottommost(nodes, node) {
  if (!nodes) return true;
  for (const n of nodes) {
    if (n === node) continue;
    if (n.TopLeft == null) continue;
    if (n.TopLeft.Y + n.Height > node.TopLeft.Y + node.Height) {
      return false;
    }
  }
  return true;
}

export function nodesBoundingBox(nodes, roundDimensions) {
  if (!nodes || nodes.length === 0) {
    return [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    if (node.TopLeft == null) {
      return [null, null];
    }
    const [tl, br] = node.boundingBoxValues(nodes, roundDimensions);
    minX = Math.min(minX, tl.X);
    minY = Math.min(minY, tl.Y);
    maxX = Math.max(maxX, br.X);
    maxY = Math.max(maxY, br.Y);
  }

  return [new Point(minX, minY), new Point(maxX, maxY)];
}

export function nodesBounds(nodes) {
  return nodesBoundingBox(nodes, true);
}

export function nodesSubgraphContainer(nodes) {
  if (!nodes || nodes.length === 0) return null;
  let root = null;
  let minLevel = Infinity;

  for (const n of nodes) {
    const c = n.owningContainer();
    if (c == null) {
      return null;
    }
    const level = c.containerLevel();
    if (level < minLevel) {
      minLevel = level;
      root = c;
    }
  }

  return root;
}

export function nodesFixedOrigin(nodes) {
  if (!nodes || nodes.length === 0) return null;
  const container = nodesSubgraphContainer(nodes);
  for (const child of nodes) {
    if (child.owningContainer() !== container) {
      continue;
    }
    const p = child.fixedOrigin();
    if (p != null) {
      return p;
    }
  }
  return null;
}

export function nodesUnroundedBounds(nodes) {
  return nodesBoundingBox(nodes, false);
}

export function nodesFixedBounds(nodes) {
  let [tl, br] = nodesBounds(nodes);
  const fixedOrigin = nodesFixedOrigin(nodes);
  if (fixedOrigin != null) {
    tl = fixedOrigin;
  }
  return [tl, br];
}

export function nodesUnroundedFixedBounds(nodes) {
  let [tl, br] = nodesUnroundedBounds(nodes);
  const fixedOrigin = nodesFixedOrigin(nodes);
  if (fixedOrigin != null) {
    tl = fixedOrigin;
  }
  return [tl, br];
}

export function FixedBoundingBox(nodes) {
  return nodesFixedBounds(nodes);
}
