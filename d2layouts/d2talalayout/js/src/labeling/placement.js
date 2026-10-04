// Slice 47 — edge-label placement for newly routed edges.
//
// Pinned reference: d2layouts/d2talalayout/internal/labeling/placement.go
// (PlaceNewEdges and its dependency closure) plus model.go searchRange.
//
// Deferred to Slice 49 (used only by labeling.Place): Place, place,
// scoreNodeLabelOverlaps. Shared with Place and ported here:
// findBestEdgeLabelPosition, findSharedSegmentsChecked, scoreEdgeLabelOverlaps,
// labelPercentageSearchRange, isClusterPath* and SharedSegmentClearance.
//
// Go returns errors; these functions throw the same error. A Go panic after
// the snapshot (e.g. a nil fake-node TopLeft for an unplaced reserved label)
// surfaces as a JS exception; both restore the snapshot and propagate.
//
// Nondeterminism: findSharedSegmentsChecked groups segments in Go maps and
// iterates them in random order. JS iterates groups in insertion order. Only
// the order of the returned segments (and the debug names of the shared
// segment fake nodes) depends on it; overlap counts, work accounting and
// context polling are order independent.

import { Segment } from '../geometry/segment.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { Orientation } from '../geometry/orientation.js';
import { LABEL_PADDING, LabelPosition as P, normalizeLabelPosition } from '../graph/label-position.js';
import { Node } from '../graph/node.js';
import { EDGE_LABEL_PREFERENCE_ORDER } from './model.js';
import { IsOnEdge, IsUnlocked, Mirrored } from './label-position-ops.js';
import { IconSize, IsClusterEdge, IsImage, NodeLabelTopLeft } from './labeling-access.js';
import { ValidatePositionedGraphSelection } from './positioned-validation.js';
import {
  captureLabelPlacement,
  clusterLabelPlacementOrientation,
  edgeLabelTopLeft,
  edgeOverlapCount,
  isLabelPlacementDescendantOf,
  maxLabelPlacementWorkUnits,
  newLabelPlacementWorkGuard,
  nodeOverlapArea,
  nodeOverlapCount,
  positionedArrowheadLabel,
  routeLengthPlacement,
  sortLabelPlacementEdges,
  sortSharedSegmentGroup,
} from './guard.js';

// SharedSegmentClearance reserves space around shared route segments where an
// edge label would otherwise be ambiguous.
export const SharedSegmentClearance = 2.5 * LABEL_PADDING;
export const placementSearchInterval = 0.025;

const SQUARE_TYPE = 'Square'; // shape.SQUARE_TYPE

/**
 * SearchRange (model.go searchRange) is the fraction of an edge route
 * searched for an unlocked label.
 */
export class SearchRange {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

// &layoutgraph.Node{Box: geo.Box{TopLeft, Width, Height}, D2ID, Graph} followed
// by SetShape(shape.SQUARE_TYPE).
function newFakeNode(topLeft, width, height, d2id, graph) {
  const node = new Node(0n, width, height);
  node.TopLeft = topLeft;
  node.D2ID = d2id;
  node.Graph = graph;
  node.setShape(SQUARE_TYPE);
  return node;
}

/**
 * PlaceNewEdges chooses label positions only for edges, preserving all
 * existing label placements in graph as obstacles.
 */
export function PlaceNewEdges(ctx, graph, edges) {
  placeNewEdges(ctx, graph, edges, maxLabelPlacementWorkUnits);
}

/** placeNewEdges with an explicit label-placement work limit. */
export function placeNewEdges(ctx, g, edges, workLimit) {
  const location = 'PlaceNewEdgeLabels';
  ValidatePositionedGraphSelection(ctx, location, g, edges);
  const requested = edges ?? [];
  const snapshot = captureLabelPlacement(g, requested);
  try {
    placeNewEdgesBody(ctx, g, requested, workLimit, location);
  } catch (err) {
    snapshot.restore();
    throw err;
  }
}

function placeNewEdgesBody(ctx, g, edges, workLimit, location) {
  const guard = newLabelPlacementWorkGuard(ctx, location, workLimit);
  const checkCanceled = () => guard.step();

  const placedFakeNodes = [];

  const newEdges = new Set();
  for (const e of edges) {
    checkCanceled();
    newEdges.add(e);
  }

  // Reserve existing and caller-fixed edge labels, plus all arrowhead labels.
  for (const e of g.Edges) {
    checkCanceled();
    if (e.SourceArrowheadLabel != null) {
      const label = e.SourceArrowheadLabel;
      const pal = positionedArrowheadLabel(e, false, guard);
      placedFakeNodes.push(newFakeNode(pal.Box.TopLeft, pal.Box.Width, pal.Box.Height, label.Text, g));
    }
    if (e.TargetArrowheadLabel != null) {
      const label = e.TargetArrowheadLabel;
      const pal = positionedArrowheadLabel(e, true, guard);
      placedFakeNodes.push(newFakeNode(pal.Box.TopLeft, pal.Box.Width, pal.Box.Height, label.Text, g));
    }

    if (e.Label == null || e.isLoop()) {
      continue;
    }
    if (newEdges.has(e) && !e.Label.PositionFixed()) {
      continue;
    }

    const topLeft = edgeLabelTopLeft(e, e.Label.Position, e.Label.Width, e.Label.Height, guard);
    placedFakeNodes.push(newFakeNode(topLeft, e.Label.Width, e.Label.Height, e.Label.Text, g));
  }

  for (const e of g.Edges) {
    checkCanceled();
    if (e.isLoop() && e.Label != null) {
      const topLeft = edgeLabelTopLeft(e, e.Label.Position, e.Label.Width, e.Label.Height, guard);
      placedFakeNodes.push(newFakeNode(topLeft, e.Label.Width, e.Label.Height, e.Label.Text, g));
    }
  }

  // Reserve every node icon and movable node label at its current position.
  for (const node of g.Nodes) {
    checkCanceled();
    if (node.Icon != null && !IsImage(node)) {
      const iconSize = IconSize(node, node.Icon.Position);
      placedFakeNodes.push(newFakeNode(
        NodeLabelTopLeft(node, node.Icon.Position, iconSize, iconSize),
        iconSize,
        iconSize,
        null,
        g,
      ));
    }

    if (node.Label == null || node.Label.PositionFixed()) {
      continue;
    }

    placedFakeNodes.push(newFakeNode(
      NodeLabelTopLeft(node, node.Label.Position, node.Label.Width, node.Label.Height),
      node.Label.Width,
      node.Label.Height,
      node.Label.Text,
      g,
    ));
  }

  // Create fake nodes around shared segments to avoid placing labels there.
  const sharedSegments = findSharedSegmentsChecked(g.Edges, checkCanceled);
  const sharedSegmentFakeNodes = [];
  for (let i = 0; i < sharedSegments.length; i++) {
    const seg = sharedSegments[i];
    checkCanceled();
    const tl = seg.Start.copy();
    let width = seg.End.X - seg.Start.X;
    let height = seg.End.Y - seg.Start.Y;
    if (seg.End.X === seg.Start.X) {
      // vertical
      width = 2 * SharedSegmentClearance;
      tl.X -= SharedSegmentClearance;
    } else {
      // horizontal
      height = 2 * SharedSegmentClearance;
      tl.Y -= SharedSegmentClearance;
    }
    sharedSegmentFakeNodes.push(newFakeNode(tl, width, height, `fake_shared_segment_${i}`, g));
  }

  let sortedEdges = [];
  for (const e of edges) {
    checkCanceled();
    if (e.Label == null || e.isLoop() || e.Label.PositionFixed()) {
      continue;
    }
    sortedEdges.push(e);
  }

  sortedEdges = sortLabelPlacementEdges(sortedEdges, guard);

  for (const edge of sortedEdges) {
    checkCanceled();
    const [fakeNode, position, percentage] = findBestEdgeLabelPosition(edge, g, placedFakeNodes, sharedSegmentFakeNodes, guard);
    placedFakeNodes.push(fakeNode);
    edge.Label.Position = position;
    edge.LabelPercentage = percentage;
  }
  guard.check();
}

/**
 * findBestEdgeLabelPosition → [fakeNode, position, percentage]. A null fake
 * node with position Unset (0) is returned when no candidate scores below
 * +Inf (e.g. NaN scores), exactly like Go's zero values.
 */
export function findBestEdgeLabelPosition(edge, g, placedFakeNodes, sharedSegmentFakeNodes, guard) {
  // we don't want to count the edge itself as overlapping, we already prefer outside labels
  const otherEdges = [];
  for (const otherEdge of g.Edges) {
    guard.step();
    if (otherEdge === edge) {
      continue;
    }
    otherEdges.push(otherEdge);
  }

  const positions = [];
  const current = normalizeLabelPosition(edge.Label.Position);
  if (IsUnlocked(current)) {
    // prefer the unlocked positions before trying other positions
    if (current === P.UnlockedMiddle) {
      positions.push(P.UnlockedMiddle);
      positions.push(P.UnlockedTop);
      positions.push(P.UnlockedBottom);
    } else {
      positions.push(current);
      positions.push(Mirrored(current));
      positions.push(P.UnlockedMiddle);
    }
    positions.push(...EDGE_LABEL_PREFERENCE_ORDER);
  } else if (IsClusterEdge(edge)) {
    const pathShared = isClusterPathSharedPlacement(edge, guard);
    if (!pathShared) {
      positions.push(...EDGE_LABEL_PREFERENCE_ORDER);
      positions.push(P.UnlockedTop);
      positions.push(P.UnlockedBottom);
      positions.push(P.UnlockedMiddle);
    } else {
      // Give preference for symmetrical placements for clustered nodes.
      if (edge.From.Cluster != null) {
        const [orientation, clusterIndex] = clusterLabelPlacementOrientation(edge.To, edge.From, edge.From.Cluster, guard);
        const half = (edge.From.Cluster.Nodes.length - 1) / 2;
        switch (orientation) {
          case Orientation.Right:
          case Orientation.Top:
            if (clusterIndex < half) {
              positions.push(P.UnlockedTop);
            } else if (clusterIndex > half) {
              positions.push(P.UnlockedBottom);
            }
            break;
          case Orientation.Left:
          case Orientation.Bottom:
            if (clusterIndex < half) {
              positions.push(P.UnlockedBottom);
            } else if (clusterIndex > half) {
              positions.push(P.UnlockedTop);
            }
            break;
          default:
            break;
        }
      } else {
        const [orientation, clusterIndex] = clusterLabelPlacementOrientation(edge.From, edge.To, edge.To.Cluster, guard);
        const half = (edge.To.Cluster.Nodes.length - 1) / 2;
        switch (orientation) {
          case Orientation.Left:
          case Orientation.Bottom:
            if (clusterIndex < half) {
              positions.push(P.UnlockedTop);
            } else if (clusterIndex > half) {
              positions.push(P.UnlockedBottom);
            }
            break;
          case Orientation.Right:
          case Orientation.Top:
            if (clusterIndex < half) {
              positions.push(P.UnlockedBottom);
            } else if (clusterIndex > half) {
              positions.push(P.UnlockedTop);
            }
            break;
          default:
            break;
        }
      }
      positions.push(P.UnlockedMiddle);
      positions.push(...EDGE_LABEL_PREFERENCE_ORDER);
    }
  } else {
    positions.push(...EDGE_LABEL_PREFERENCE_ORDER);
    positions.push(P.UnlockedTop);
    positions.push(P.UnlockedBottom);
    positions.push(P.UnlockedMiddle);
  }

  const ancestors = [];
  const nonAncestors = [];
  for (const n of g.Nodes) {
    guard.step();
    const fromDescendant = isLabelPlacementDescendantOf(edge.From, n, guard);
    const toDescendant = isLabelPlacementDescendantOf(edge.To, n, guard);
    if (n !== edge.From && n !== edge.To && (fromDescendant || toDescendant)) {
      ancestors.push(n);
    } else {
      nonAncestors.push(n);
    }
  }

  let bestLabelPosition = P.Unset;
  let bestLabelPercentage = 0;
  let bestLabelFakeNode = null;
  let bestScore = Infinity;

  const checkPosition = (labelPosition) => {
    guard.step();
    const topLeft = edgeLabelTopLeft(edge, labelPosition, edge.Label.Width, edge.Label.Height, guard);
    const fakeLabelNode = newFakeNode(topLeft, edge.Label.Width, edge.Label.Height, edge.Label.Text, g);

    let edges = g.Edges;
    if (IsOnEdge(labelPosition)) {
      edges = otherEdges;
    }

    // Especially don't want labels of a cluster edge path intersecting other
    // cluster edge paths, so count the other cluster edges as double.
    if (edge.From.Cluster != null) {
      edges = [...edges];
      for (const otherEdge of otherEdges) {
        guard.step();
        if (otherEdge.From.Cluster === edge.From.Cluster) {
          edges.push(otherEdge);
        }
      }
    } else if (edge.To.Cluster != null) {
      edges = [...edges];
      for (const otherEdge of otherEdges) {
        guard.step();
        if (otherEdge.To.Cluster === edge.To.Cluster) {
          edges.push(otherEdge);
        }
      }
    }

    // it only counts as overlapping an ancestor if it is partially overlapping
    const [ancestorPartialOverlapArea, ancestorCount] = nodeOverlapArea(fakeLabelNode, ancestors, LABEL_PADDING, true, guard);
    const [nonAncestorOverlapArea, nonAncestorCount] = nodeOverlapArea(fakeLabelNode, nonAncestors, LABEL_PADDING, false, guard);
    const edgePaddingOverlaps = edgeOverlapCount(fakeLabelNode, edges, LABEL_PADDING, guard);
    const edgeExactOverlaps = edgeOverlapCount(fakeLabelNode, edges, 0, guard);
    const edgeOverlaps = edgePaddingOverlaps + Math.ceil(edgeExactOverlaps * 0.5);
    const almostLabelPaddingOverlaps = nodeOverlapCount(fakeLabelNode, placedFakeNodes, LABEL_PADDING, guard);
    const almostLabelExactOverlaps = nodeOverlapCount(fakeLabelNode, placedFakeNodes, 0, guard);
    const almostLabelOverlaps = almostLabelPaddingOverlaps + Math.ceil(almostLabelExactOverlaps * 0.5);
    const labelOverlaps = nodeOverlapCount(fakeLabelNode, placedFakeNodes, 0, guard);
    const sharedSegmentOverlap = nodeOverlapCount(fakeLabelNode, sharedSegmentFakeNodes, LABEL_PADDING, guard);
    const score = scoreEdgeLabelOverlaps(
      fakeLabelNode.area(),
      ancestorPartialOverlapArea + nonAncestorOverlapArea,
      ancestorCount + nonAncestorCount,
      edgeOverlaps,
      almostLabelOverlaps,
      labelOverlaps,
      sharedSegmentOverlap,
    );

    if (score < bestScore) {
      bestLabelPosition = labelPosition;
      bestLabelFakeNode = fakeLabelNode;
      bestLabelPercentage = edge.LabelPercentage;
      bestScore = score;
    }
  };

  let routeLength = 0.0;
  let routeLengthCalculated = false;
  // pick the label position based on how many nodes, edges and already placed labels overlap
  for (const labelPosition of positions) {
    guard.step();
    if (bestScore === 0) {
      break;
    }
    if (IsUnlocked(labelPosition)) {
      if (edge.LabelPercentage !== 0) {
        // if label percentage was set on the edge during layout, use it
        checkPosition(labelPosition);
      } else {
        if (!routeLengthCalculated) {
          routeLength = routeLengthPlacement(edge, guard);
          routeLengthCalculated = true;
        }
        const r = labelPercentageSearchRange(edge, routeLength);
        for (let i = r.start; i < r.end; i += placementSearchInterval) {
          guard.step();
          edge.LabelPercentage = i;
          checkPosition(labelPosition);
          if (bestScore === 0) {
            break;
          }
        }
        edge.LabelPercentage = 0;
      }
    } else {
      checkPosition(labelPosition);
    }
  }

  guard.check();
  return [bestLabelFakeNode, bestLabelPosition, bestLabelPercentage];
}

/** labelPercentageSearchRange */
export function labelPercentageSearchRange(edge, length) {
  const halfHeight = edge.Label.Height / 2;
  const halfWidth = edge.Label.Width / 2;
  if (edge.From.Cluster != null) {
    // if the edge is coming from a cluster node, use only the first segment
    // extension to find the placement
    const p1 = edge.Points[0];
    const p2 = edge.Points[1];
    if (p1.X === p2.X && Math.abs(p1.Y - p2.Y) > halfHeight) {
      const end = (Math.abs(p1.Y - p2.Y) - halfHeight) / length;
      return new SearchRange(0, goMin(1, end));
    } else if (Math.abs(p1.X - p2.X) > halfWidth) {
      const end = (Math.abs(p1.X - p2.X) - halfWidth) / length;
      return new SearchRange(0, goMin(1, end));
    }
  } else if (edge.To.Cluster != null) {
    // if the edge is going to a cluster node, use only the last segment
    // extension to find the placement
    const p1 = edge.Points[edge.Points.length - 1];
    const p2 = edge.Points[edge.Points.length - 2];
    if (p1.X === p2.X && Math.abs(p1.Y - p2.Y) > halfHeight) {
      const start = (length - Math.abs(p1.Y - p2.Y) + halfHeight) / length;
      return new SearchRange(goMax(0, start), 1);
    } else if (Math.abs(p1.X - p2.X) > halfWidth) {
      const start = (length - Math.abs(p1.X - p2.X) + halfWidth) / length;
      return new SearchRange(goMax(0, start), 1);
    }
  }
  return new SearchRange(0, 1);
}

/**
 * SegmentGroups models a Go map[float64][]*geo.Segment: +0/-0 share a key
 * (Go ==), while every NaN key inserts a fresh entry (NaN != NaN). Groups
 * iterate in insertion order (Go: random map order).
 */
class SegmentGroups {
  constructor() {
    this.byKey = new Map();
    this.groups = [];
  }

  append(key, segment) {
    if (Number.isNaN(key)) {
      this.groups.push([segment]);
      return;
    }
    let group = this.byKey.get(key);
    if (group === undefined) {
      group = [];
      this.byKey.set(key, group);
      this.groups.push(group);
    }
    group.push(segment);
  }

  get size() {
    return this.groups.length;
  }
}

/**
 * findSharedSegmentsChecked finds the longest shared vertical/horizontal
 * segments among the edge routes. checkCanceled may be null.
 */
export function findSharedSegmentsChecked(edges, checkCanceled) {
  if (checkCanceled != null) checkCanceled();
  const verticalSegments = new SegmentGroups();
  const horizontalSegments = new SegmentGroups();

  // group vertical/horizontal segments by X/Y
  for (const edge of edges) {
    if (checkCanceled != null) checkCanceled();
    for (let i = 0; i < edge.Points.length - 1; i++) {
      if (checkCanceled != null) checkCanceled();
      const segment = new Segment(edge.Points[i].copy(), edge.Points[i + 1].copy());
      if (segment.Start.X === segment.End.X && segment.Start.Y === segment.End.Y) {
        continue;
      }
      if (segment.Start.X === segment.End.X) {
        if (segment.End.Y < segment.Start.Y) {
          // swap so segments are always top to bottom
          [segment.End.Y, segment.Start.Y] = [segment.Start.Y, segment.End.Y];
        }
        verticalSegments.append(segment.Start.X, segment);
      } else if (segment.Start.Y === segment.End.Y) {
        if (segment.End.X < segment.Start.X) {
          // swap so segments are always left to right
          [segment.End.X, segment.Start.X] = [segment.Start.X, segment.End.X];
        }
        horizontalSegments.append(segment.Start.Y, segment);
      }
    }
  }

  const sharedSegments = [];
  const addSharedSegments = (segmentsByCoord, isHorizontalSegment) => {
    const coordinate = (p) => (isHorizontalSegment ? p.X : p.Y);
    const setCoordinate = (p, v) => {
      if (isHorizontalSegment) {
        p.X = v;
      } else {
        p.Y = v;
      }
    };

    for (const segments of segmentsByCoord.groups) {
      if (checkCanceled != null) checkCanceled();
      if (segments.length === 1) {
        continue;
      }
      // Sort segments from starting positions (segments are top to bottom
      // and left to right).
      sortSharedSegmentGroup(segments, coordinate, checkCanceled);

      let prev = segments[0];
      let shared = null;
      for (let i = 1; i < segments.length; i++) {
        if (checkCanceled != null) checkCanceled();
        const curr = segments[i];
        // segments overlap
        if (coordinate(prev.End) > coordinate(curr.Start)) {
          // A long trunk can contain disjoint shared intervals. Keep its
          // exclusive label corridor between them available.
          if (shared != null && coordinate(curr.Start) > coordinate(shared.End)) {
            sharedSegments.push(shared);
            shared = null;
          }
          if (shared == null) {
            shared = new Segment(curr.Start.copy(), curr.Start.copy());
            setCoordinate(shared.End, goMin(coordinate(prev.End), coordinate(curr.End)));
          } else {
            // extend the current ongoing overlap
            const minOverlap = goMin(coordinate(prev.End), coordinate(curr.End));
            setCoordinate(shared.End, goMax(coordinate(shared.End), minOverlap));
          }
        } else if (shared != null) {
          // there's no need to extend the segment, so close it
          sharedSegments.push(shared);
          shared = null;
        }
        // keep prev as the longest segment
        if (coordinate(curr.End) > coordinate(prev.End)) {
          prev = curr;
        }
      }
      if (shared != null) {
        // just in case the last segment had an overlap
        sharedSegments.push(shared);
      }
    }
  };

  addSharedSegments(verticalSegments, false);
  addSharedSegments(horizontalSegments, true);
  return sharedSegments;
}

/** scoreEdgeLabelOverlaps */
export function scoreEdgeLabelOverlaps(
  labelArea, nodeOverlapAreaValue,
  nodeOverlapCountValue, edgeOverlapCountValue,
  almostLabelOverlapCount, labelOverlapCount, sharedSegmentOverlapCount,
) {
  let score = (nodeOverlapAreaValue / labelArea) * 2;
  // avoid as much as possible overlapping with other labels
  score += labelOverlapCount * 10;
  score += almostLabelOverlapCount;
  // overlapping with other edges is worse than placing the label on a shared segment
  score += nodeOverlapCountValue * 2;
  score += edgeOverlapCountValue * 2;
  score += sharedSegmentOverlapCount;
  return score;
}

/** isClusterPathSharedPlacement */
export function isClusterPathSharedPlacement(e, guard) {
  return isClusterPathSharedChecked(e, () => guard.step());
}

// Go slice indexing: panics (here: throws) for an out-of-range index.
function goIndex(slice, index) {
  if (index < 0) {
    throw new RangeError(`runtime error: index out of range [${index}]`);
  }
  if (index >= slice.length) {
    throw new RangeError(`runtime error: index out of range [${index}] with length ${slice.length}`);
  }
  return slice[index];
}

/**
 * isClusterPathSharedChecked checks if a given cluster edge has a shared path
 * with the other cluster edges. checkWork may be null.
 */
export function isClusterPathSharedChecked(e, checkWork) {
  if (checkWork != null) checkWork();
  let clusterNodes;
  let adjacentNode;
  let fromCluster = false;
  if (e.From.Cluster != null) {
    clusterNodes = e.From.Cluster.Nodes;
    adjacentNode = e.To;
    fromCluster = true;
  } else if (e.To.Cluster != null) {
    clusterNodes = e.To.Cluster.Nodes;
    adjacentNode = e.From;
  } else {
    return false;
  }

  let p1;
  let p2;
  if (fromCluster) {
    // if the edge is coming from a cluster, only the last segment can be shared
    p1 = goIndex(e.Points, e.Points.length - 1);
    p2 = goIndex(e.Points, e.Points.length - 2);
  } else {
    // if the edge is going to a cluster, only the first segment can be shared
    p1 = goIndex(e.Points, 0);
    p2 = goIndex(e.Points, 1);
  }
  for (const n of clusterNodes ?? []) {
    if (checkWork != null) checkWork();
    for (const ce of n.Edges) {
      if (checkWork != null) checkWork();
      if (ce === e) {
        continue;
      }
      if (n.adjacent(ce) !== adjacentNode) {
        // only checks edges to the same connected node
        continue;
      }
      let op1;
      let op2;
      if (fromCluster) {
        op1 = goIndex(ce.Points, ce.Points.length - 1);
        op2 = goIndex(ce.Points, ce.Points.length - 2);
      } else {
        op1 = goIndex(ce.Points, 0);
        op2 = goIndex(ce.Points, 1);
      }
      if (p1.X === p2.X && op1.X === op2.X && p1.X === op1.X) {
        // both vertical and at same X
        if (goMax(p1.Y, p2.Y) >= goMin(op1.Y, op2.Y) &&
          goMax(op1.Y, op2.Y) >= goMin(p1.Y, p2.Y)) {
          // The closed intervals overlap.
          return true;
        }
      } else if (p1.Y === p2.Y && op1.Y === op2.Y && p1.Y === op1.Y) {
        // both horizontal and at same Y
        if (goMax(p1.X, p2.X) >= goMin(op1.X, op2.X) &&
          goMax(op1.X, op2.X) >= goMin(p1.X, p2.X)) {
          // The closed intervals overlap.
          return true;
        }
      }
    }
  }
  return false;
}

