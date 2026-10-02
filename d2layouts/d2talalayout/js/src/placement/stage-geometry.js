/**
 * placementPadding defines the standard padding offset in placement.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/tuning.go
 */
export const PLACEMENT_PADDING = 1000.0;
export const placementPadding = PLACEMENT_PADDING;

/**
 * normalize translates graph coordinates to have minimum coordinates at (0, 0),
 * or translates by (-1000, -1000) if any fixed node exists.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/stages.go
 *
 * @param {import("../graph/graph.js").Graph} graph
 */
export function normalize(graph) {
  let minX = Infinity;
  let minY = Infinity;

  const hasFixed =
    typeof graph.hasFixedNode === "function"
      ? graph.hasFixedNode()
      : graph.HasFixedNode();

  if (hasFixed) {
    minX = PLACEMENT_PADDING;
    minY = PLACEMENT_PADDING;
  } else {
    for (const node of graph.Nodes) {
      minX = Math.min(minX, node.TopLeft.X);
      minY = Math.min(minY, node.TopLeft.Y);
    }
    for (const edge of graph.Edges) {
      if (edge.Points) {
        for (const point of edge.Points) {
          minX = Math.min(minX, Math.floor(point.X));
          minY = Math.min(minY, Math.floor(point.Y));
        }
      }
      if (edge.Label != null) {
        const topLeft = edge.LabelTopLeft(
          edge.Label.Position,
          edge.Label.Width,
          edge.Label.Height
        );
        minX = Math.min(minX, Math.floor(topLeft.X));
        minY = Math.min(minY, Math.floor(topLeft.Y));
      }
    }
  }

  for (const node of graph.Nodes) {
    node.TopLeft.X -= minX;
    node.TopLeft.Y -= minY;
  }
  for (const edge of graph.Edges) {
    if (edge.Points) {
      for (const point of edge.Points) {
        point.X -= minX;
        point.Y -= minY;
      }
    }
  }
}

export const Normalize = normalize;

/**
 * pad shifts every graph node TopLeft coordinate by placementPadding (+1000.0).
 * Edge points, labels, and FixedTopLeft are not shifted.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/stages.go
 *
 * @param {import("../graph/graph.js").Graph} graph
 */
export function pad(graph) {
  for (const node of graph.Nodes) {
    node.TopLeft.X += PLACEMENT_PADDING;
    node.TopLeft.Y += PLACEMENT_PADDING;
  }
}

export const Pad = pad;
