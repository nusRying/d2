import { SideEdgeSpacing } from '../placementcost/constants.js';

// talaFontSizes returns the adapter-supported layout font scale by value so
// callers cannot mutate shared engine state.
// Pinned Go: [7]int{13, 14, 16, 20, 24, 28, 32}
export function talaFontSizes() {
  return [13, 14, 16, 20, 24, 28, 32];
}

export function prescale(graph) {
  for (const node of graph.Nodes) {
    if (node.AspectRatio1()) {
      const size = Math.max(node.Width, node.Height);
      node.Width = size;
      node.Height = size;
    }
    scaleBasedOnEdges(node);
  }
}

export const Prescale = prescale;

function scaleBasedOnEdges(node) {
  if (
    node.FixedTopLeft != null ||
    node.DesiredWidth != null ||
    node.DesiredHeight != null ||
    node.IsTable() ||
    node.IsClass() ||
    node.Edges.length === 0
  ) {
    return;
  }

  const edgeCounts = new Map();
  for (const edge of node.Edges) {
    const adjacent = node.Adjacent(edge);
    if (adjacent != null && adjacent !== node) {
      edgeCounts.set(adjacent, (edgeCounts.get(adjacent) || 0) + 1);
    }
  }

  let totalEdges = 0;
  let maxEdgesToAdjacent = 0;
  for (const count of edgeCounts.values()) {
    totalEdges += count;
    if (count > maxEdgesToAdjacent) {
      maxEdgesToAdjacent = count;
    }
  }

  let sidesForEdges = 4.0;
  if (edgeCounts.size < 4) {
    sidesForEdges = edgeCounts.size;
  }

  // When all edges on a node are self-loops, edgeCounts is empty and sidesForEdges is 0.
  // In the reference Go implementation, float64(0)/0 is NaN; casting math.Ceil(NaN) to int produces
  // an implementation-dependent negative integer value on amd64, after which max(maxEdgesToAdjacent, convertedCeil)
  // evaluates to 0 (since maxEdgesToAdjacent is 0). To reproduce this observed final semantic result
  // without relying on host-specific NaN integer conversion semantics, JS explicitly sets ceilEdges to 0 when sidesForEdges is 0.
  const ceilEdges = sidesForEdges === 0 ? 0 : Math.ceil(totalEdges / sidesForEdges);
  const edgesPerSide = Math.max(maxEdgesToAdjacent, ceilEdges);

  if (edgesPerSide === 1) {
    return;
  }

  const minLength = (edgesPerSide + 1) * SideEdgeSpacing;
  if (minLength < Math.min(node.Width, node.Height)) {
    return;
  }

  let xRatio = 1.0;
  let yRatio = 1.0;

  if (node.AspectRatio1()) {
    if (node.Width < minLength) {
      xRatio = minLength / node.Width;
      yRatio = minLength / node.Height;
      node.Width = minLength;
      node.Height = minLength;
    }
  } else {
    if (node.Width < minLength) {
      xRatio = minLength / node.Width;
      node.Width = minLength;
    }
    if (node.Height < minLength) {
      yRatio = minLength / node.Height;
      node.Height = minLength;
    }
  }

  if (node.FontSize == null) {
    return;
  }

  const minRatio = Math.min(xRatio, yRatio);
  let bestRatio = 1.0;
  let fontSize = node.FontSize;
  let closestDistance = Infinity;

  for (const size of talaFontSizes()) {
    const fontRatio = size / node.FontSize;
    const distance = Math.abs(fontRatio - minRatio);
    if (distance < closestDistance) {
      fontSize = size;
      closestDistance = distance;
      bestRatio = fontRatio;
    }
  }

  let finalMinLength = minLength;
  if (bestRatio > minRatio) {
    finalMinLength = Math.ceil((minLength * bestRatio) / minRatio);
    if (node.Width < finalMinLength) {
      node.Width = finalMinLength;
    }
    if (node.Height < finalMinLength) {
      node.Height = finalMinLength;
    }
  }

  node.FontSize = fontSize;

  if (node.Label != null) {
    node.Label.Width = Math.ceil(node.Label.Width * bestRatio);
    node.Label.Height = Math.ceil(node.Label.Height * bestRatio);
  }
}
