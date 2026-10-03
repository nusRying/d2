// Pinned reference: internal/hierarchy/eligibility.go

import { isHierarchyStructuralEdge } from './structural.js';

/**
 * Candidates identifies the graph nodes that may participate in hierarchy
 * discovery. Existing hierarchy membership is derived state and deliberately
 * does not disqualify a node. Go returns map[*Node]struct{}; the JS Set keeps
 * graph.Nodes order (Go map iteration order is unspecified and no consumer
 * depends on it).
 */
export function candidates(graph) {
  const result = new Set();
  for (const node of graph.Nodes) {
    if (graph.NodeToTree.has(node)) {
      continue;
    }
    if (graph.isTreeSentinel(node) || node.Sequence != null || node.FixedTopLeft != null) {
      continue;
    }
    if (isSimpleCandidate(graph, node)) {
      result.add(node);
      continue;
    }
    if (node.IsContainer() && shapeCanBeContainer(node.shapeType()) && !node.aspectRatio1() && isEligibleContainer(graph, node)) {
      result.add(node);
    }
  }
  return result;
}

export const Candidates = candidates;

export function isSimpleCandidate(graph, node) {
  return !(node.IsContainer() || graph.isTreeSentinel(node) || node.IsClusterVessel() ||
    graph.isSequenceVessel(node) || node.Cluster != null);
}

// Hierarchy containers grow only horizontally. These shapes can grow in one
// direction without distorting their visual meaning.
export function shapeCanBeContainer(shapeType) {
  switch (shapeType) {
    case '':
    case 'Square':
    case 'Package':
    case 'StoredData':
    case 'Queue':
    case 'Step':
      return true;
    default:
      return false;
  }
}

// A container can participate only when it has no internal edges and none of
// its descendants belongs to another specialized layout structure. Go
// recurses here (bounded by the validated container depth), so this does too.
export function isEligibleContainer(graph, root) {
  for (const child of graph.Containers.get(root) ?? []) {
    if (child.FixedTopLeft != null) {
      return false;
    }
    if (graph.NodeToTree.has(child)) {
      return false;
    }
    if (graph.isTreeSentinel(child) || child.Sequence != null) {
      return false;
    }
    if (!child.IsContainer() && !isSimpleCandidate(graph, child)) {
      return false;
    }
    for (const edge of child.Edges) {
      if (!isHierarchyStructuralEdge(edge)) {
        continue;
      }
      if (child.adjacent(edge).isDescendantOf(root)) {
        return false;
      }
    }
    if (child.IsContainer() && !isEligibleContainer(graph, child)) {
      return false;
    }
  }
  return true;
}
