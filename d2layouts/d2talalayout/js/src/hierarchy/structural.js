// Pinned reference: internal/hierarchy/discovery.go (isHierarchyStructuralEdge,
// countHierarchyStructuralEdges) and placement.go (isSource, isSink).
//
// Self-loops are routed, but they do not describe a relationship between
// hierarchy levels. Keep hierarchy detection and ordering consistent with the
// DAG ranker, which removes them before assigning levels.

export function isHierarchyStructuralEdge(edge) {
  return !(edge != null && edge.isLoop());
}

export function countHierarchyStructuralEdges(node) {
  let count = 0;
  for (const edge of node.Edges) {
    if (isHierarchyStructuralEdge(edge)) {
      count++;
    }
  }
  return count;
}

export function isSource(n) {
  for (const e of n.Edges) {
    if (!isHierarchyStructuralEdge(e)) {
      continue;
    }
    if (e.hasSourceArrow() === e.hasTargetArrow() || (e.hasSourceArrow() && e.From === n) || (e.hasTargetArrow() && e.To === n)) {
      return false;
    }
  }
  return true;
}

export function isSink(n) {
  for (const e of n.Edges) {
    if (!isHierarchyStructuralEdge(e)) {
      continue;
    }
    if (e.hasSourceArrow() === e.hasTargetArrow() || (e.hasTargetArrow() && e.From === n) || (e.hasSourceArrow() && e.To === n)) {
      return false;
    }
  }
  return true;
}
