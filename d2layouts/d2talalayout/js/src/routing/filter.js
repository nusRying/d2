// Slice 47 — routing node filters.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/filter.go

/**
 * filterEdgeAncestors drops ancestors of either endpoint (but never the
 * endpoints themselves). Returns null for an empty result, as Go's nil slice.
 */
export function filterEdgeAncestors(edge, nodes) {
  let nonAncestors = null;
  for (const node of nodes ?? []) {
    if (node !== edge.From && node !== edge.To &&
      (edge.From.IsDescendantOf(node) || edge.To.IsDescendantOf(node))) {
      continue;
    }
    if (nonAncestors == null) nonAncestors = [];
    nonAncestors.push(node);
  }
  return nonAncestors;
}
