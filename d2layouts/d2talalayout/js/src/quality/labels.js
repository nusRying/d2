// Port of internal/quality/labels.go
import { Point } from '../geometry/point.js';
import { Box } from '../geometry/box.js';
import { Segment } from '../geometry/segment.js';
import { orientation } from './crossings.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { SharedSegmentClearance } from '../labeling/placement.js';
import { chargeEvaluationWork, evaluationIsDescendantOf } from './evaluation-guard.js';
import { LABEL_PADDING } from '../graph/label-position.js';
import { MAX_TOPOLOGY_DEPTH } from '../limits/constants.js';

export function scoreExistingLabelPlacements(g, guard) {
  guard.Step();

  const placedBoxes = [];
  let totalScore = 0.0;

  // Arrowhead labels and loop labels reserve space before ordinary node and
  // edge labels are scored.
  for (const edge of g.Edges) {
    guard.Step();
    if (edge.SourceArrowheadLabel != null) {
      chargeEvaluationWork(guard, edge.Points.length);
      placedBoxes.push(PositionArrowheadLabel(edge, false, edge.Points).Box);
    }
    if (edge.TargetArrowheadLabel != null) {
      chargeEvaluationWork(guard, edge.Points.length);
      placedBoxes.push(PositionArrowheadLabel(edge, true, edge.Points).Box);
    }
  }

  for (const edge of g.Edges) {
    guard.Step();
    const isLoop = typeof edge.isLoop === 'function' ? edge.isLoop() : (typeof edge.IsLoop === 'function' ? edge.IsLoop() : edge.From === edge.To);
    if (isLoop && edge.Label != null) {
      chargeEvaluationWork(guard, edge.Points.length);
      placedBoxes.push(labelBox(edge));
    }
  }

  for (const node of g.Nodes) {
    guard.Step();

    if (node.Icon != null && !node.IsImage()) {
      const iconSize = typeof node.IconSize === 'function' ? node.IconSize(node.Icon.Position) : node.iconSize(node.Icon.Position);
      const iconTopLeft = typeof node.LabelTopLeft === 'function'
        ? node.LabelTopLeft(node.Icon.Position, iconSize, iconSize)
        : node.labelTopLeft(node.Icon.Position, iconSize, iconSize);
      const iconBox = new Box(iconTopLeft, iconSize, iconSize);
      placedBoxes.push(iconBox);

      const nodeOverlaps = nodeOverlapCount(iconBox, g.Nodes, 0, guard);
      const edgeOverlaps = edgeOverlapCount(iconBox, g.Edges, 0, guard);
      const labelOverlaps = boxOverlapCount(iconBox, placedBoxes, 0, guard);
      totalScore += scoreNodeLabelOverlaps(nodeOverlaps, edgeOverlaps, labelOverlaps - 1);
    }

    if (node.Label == null) {
      continue;
    }

    const nodeLabelTopLeft = typeof node.LabelTopLeft === 'function'
      ? node.LabelTopLeft(node.Label.Position, node.Label.Width, node.Label.Height)
      : node.labelTopLeft(node.Label.Position, node.Label.Width, node.Label.Height);
    const nodeLabelBox = new Box(nodeLabelTopLeft, node.Label.Width, node.Label.Height);

    const siblingsAndChildren = [];
    const containerSiblings = (g.Containers instanceof Map)
      ? (g.Containers.get(node.Container) ?? [])
      : (g.Containers ? (g.Containers[node.Container] ?? []) : []);
    for (const sibling of containerSiblings) {
      guard.Step();
      if (sibling !== node) {
        siblingsAndChildren.push(sibling);
      }
    }
    if (typeof node.IsContainer === 'function' ? node.IsContainer() : node.isContainer()) {
      const children = (g.Containers instanceof Map)
        ? (g.Containers.get(node) ?? [])
        : (g.Containers ? (g.Containers[node] ?? []) : []);
      for (const child of children) {
        guard.Step();
        siblingsAndChildren.push(child);
      }
    }

    const ancestors = [];
    for (let current = node, depth = 0; current != null; current = (typeof current.EffectiveContainer === 'function' ? current.EffectiveContainer() : current.effectiveContainer()), depth++) {
      guard.Step();
      if (depth >= MAX_TOPOLOGY_DEPTH) {
        throw new Error(`TALA Evaluate container depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
      }
      ancestors.push(current);
    }

    const siblingOverlaps = nodeOverlapCount(nodeLabelBox, siblingsAndChildren, LABEL_PADDING, guard);
    const ancestorOverlaps = partialNodeOverlapCount(nodeLabelBox, ancestors, LABEL_PADDING, guard);
    const edgeOverlaps = edgeOverlapCount(nodeLabelBox, g.Edges, LABEL_PADDING - 1, guard);
    const labelOverlaps = boxOverlapCount(nodeLabelBox, placedBoxes, LABEL_PADDING, guard);
    totalScore += scoreNodeLabelOverlaps(siblingOverlaps + ancestorOverlaps, edgeOverlaps, labelOverlaps);
    placedBoxes.push(nodeLabelBox);
  }

  const sharedSegments = findSharedSegments(g.Edges, guard);
  const sharedSegmentBoxes = [];
  for (const segment of sharedSegments) {
    guard.Step();
    const topLeft = segment.Start.copy();
    let width = segment.End.X - segment.Start.X;
    let height = segment.End.Y - segment.Start.Y;
    if (segment.End.X === segment.Start.X) {
      width = 2 * SharedSegmentClearance;
      topLeft.X -= SharedSegmentClearance;
    } else {
      height = 2 * SharedSegmentClearance;
      topLeft.Y -= SharedSegmentClearance;
    }
    sharedSegmentBoxes.push(new Box(topLeft, width, height));
  }

  for (const edge of g.Edges) {
    guard.Step();
    const isLoop = typeof edge.isLoop === 'function' ? edge.isLoop() : (typeof edge.IsLoop === 'function' ? edge.IsLoop() : edge.From === edge.To);
    if (edge.Label == null || isLoop) {
      continue;
    }
    chargeEvaluationWork(guard, edge.Points.length);
    const edgeLabelBox = labelBox(edge);

    const otherEdges = [];
    for (const other of g.Edges) {
      guard.Step();
      if (other !== edge) {
        otherEdges.push(other);
      }
    }

    const ancestors = [];
    const nonAncestors = [];
    for (const node of g.Nodes) {
      guard.Step();
      const fromDescendant = evaluationIsDescendantOf(edge.From, node, guard);
      const toDescendant = evaluationIsDescendantOf(edge.To, node, guard);
      if (node !== edge.From && node !== edge.To && (fromDescendant || toDescendant)) {
        ancestors.push(node);
      } else {
        nonAncestors.push(node);
      }
    }

    const ancestorOverlapArea = nodeOverlapArea(edgeLabelBox, ancestors, LABEL_PADDING, true, guard);
    const nonAncestorOverlapArea = nodeOverlapArea(edgeLabelBox, nonAncestors, LABEL_PADDING, false, guard);
    const edgeOverlaps = edgeOverlapCount(edgeLabelBox, otherEdges, LABEL_PADDING, guard);
    const labelOverlaps = boxOverlapCount(edgeLabelBox, placedBoxes, 0, guard);
    const almostLabelOverlaps = boxOverlapCount(edgeLabelBox, placedBoxes, LABEL_PADDING, guard);
    const sharedSegmentOverlaps = boxOverlapCount(edgeLabelBox, sharedSegmentBoxes, LABEL_PADDING, guard);

    totalScore += scoreEdgeLabelOverlaps(
      edgeLabelBox.Width * edgeLabelBox.Height,
      ancestorOverlapArea + nonAncestorOverlapArea,
      0,
      edgeOverlaps,
      almostLabelOverlaps,
      labelOverlaps,
      sharedSegmentOverlaps,
    );
    placedBoxes.push(edgeLabelBox);
  }

  return 1 / (1 + totalScore);
}

export function labelBox(edge) {
  const topLeft = typeof edge.LabelTopLeft === 'function'
    ? edge.LabelTopLeft(edge.Label.Position, edge.Label.Width, edge.Label.Height)
    : edge.labelTopLeft(edge.Label.Position, edge.Label.Width, edge.Label.Height);
  return new Box(topLeft, edge.Label.Width, edge.Label.Height);
}

export function nodeOverlapCount(box, nodes, padding, guard) {
  let count = 0;
  for (const node of nodes) {
    guard.Step();
    if (boxesOverlapWithPadding(box, node.Box, padding)) {
      count++;
    }
  }
  return count;
}

export function partialNodeOverlapCount(box, nodes, padding, guard) {
  let count = 0;
  for (const node of nodes) {
    guard.Step();
    if (boxesOverlapWithPadding(box, node.Box, padding) && !boxCovers(node.Box, box)) {
      count++;
    }
  }
  return count;
}

export function boxOverlapCount(box, others, padding, guard) {
  let count = 0;
  for (const other of others) {
    guard.Step();
    if (boxesOverlapWithPadding(box, other, padding)) {
      count++;
    }
  }
  return count;
}

export function nodeOverlapArea(box, nodes, padding, partial, guard) {
  let area = 0.0;
  for (const node of nodes) {
    guard.Step();
    if (!boxesOverlapWithPadding(box, node.Box, padding) || (partial && boxCovers(node.Box, box))) {
      continue;
    }
    if (padding === 0 || boxesOverlapWithPadding(box, node.Box, 0)) {
      area += boxOverlapArea(box, node.Box);
    }
    const isCont = typeof node.IsContainer === 'function' ? node.IsContainer() : Boolean(node.isContainer?.());
    if (!isCont) {
      area += box.Width * box.Height;
    }
  }
  return area;
}

export function edgeOverlapCount(box, edges, padding, guard) {
  let count = 0;
  for (const edge of edges) {
    for (let pointIndex = 1; pointIndex < edge.Points.length; pointIndex++) {
      guard.Step();
      if (boxOverlapsLine(box, edge.Points[pointIndex - 1], edge.Points[pointIndex], padding)) {
        count++;
      }
    }
  }
  return count;
}

export function boxesOverlapWithPadding(first, second, padding) {
  const firstRight = first.TopLeft.X + first.Width;
  const secondRight = second.TopLeft.X + second.Width;
  if (first.TopLeft.X >= secondRight + padding || second.TopLeft.X >= firstRight + padding) {
    return false;
  }
  const firstBottom = first.TopLeft.Y + first.Height;
  const secondBottom = second.TopLeft.Y + second.Height;
  return first.TopLeft.Y < secondBottom + padding && second.TopLeft.Y < firstBottom + padding;
}

export function boxCovers(outer, inner) {
  return (
    inner.TopLeft.X >= outer.TopLeft.X &&
    inner.TopLeft.Y >= outer.TopLeft.Y &&
    inner.TopLeft.X + inner.Width <= outer.TopLeft.X + outer.Width &&
    inner.TopLeft.Y + inner.Height <= outer.TopLeft.Y + outer.Height
  );
}

export function boxOverlapArea(first, second) {
  const xs = [first.TopLeft.X, first.TopLeft.X + first.Width, second.TopLeft.X, second.TopLeft.X + second.Width];
  const ys = [first.TopLeft.Y, first.TopLeft.Y + first.Height, second.TopLeft.Y, second.TopLeft.Y + second.Height];
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return (xs[2] - xs[1]) * (ys[2] - ys[1]);
}

export function boxOverlapsLine(box, first, second, padding) {
  const contains = (point) => {
    return (
      box.TopLeft.X - padding <= point.X &&
      box.TopLeft.X + box.Width + padding >= point.X &&
      box.TopLeft.Y - padding <= point.Y &&
      box.TopLeft.Y + box.Height + padding >= point.Y
    );
  };
  if (contains(first) || contains(second)) {
    return true;
  }

  const left = box.TopLeft.X - padding;
  const right = box.TopLeft.X + box.Width + padding;
  const top = box.TopLeft.Y - padding;
  const bottom = box.TopLeft.Y + box.Height + padding;
  const topLeft = new Point(left, top);
  const topRight = new Point(right, top);
  const bottomRight = new Point(right, bottom);
  const bottomLeft = new Point(left, bottom);
  return (
    segmentsIntersect(topLeft, topRight, first, second) ||
    segmentsIntersect(topRight, bottomRight, first, second) ||
    segmentsIntersect(bottomRight, bottomLeft, first, second) ||
    segmentsIntersect(bottomLeft, topLeft, first, second)
  );
}

export function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const secondStartSide = orientation(firstStart, firstEnd, secondStart);
  const secondEndSide = orientation(firstStart, firstEnd, secondEnd);
  const firstStartSide = orientation(secondStart, secondEnd, firstStart);
  const firstEndSide = orientation(secondStart, secondEnd, firstEnd);
  if (secondStartSide === 0 && secondEndSide === 0 && firstStartSide === 0 && firstEndSide === 0) {
    return (
      closedIntervalsOverlap(firstStart.X, firstEnd.X, secondStart.X, secondEnd.X) &&
      closedIntervalsOverlap(firstStart.Y, firstEnd.Y, secondStart.Y, secondEnd.Y)
    );
  }
  return straddlesLine(secondStartSide, secondEndSide) && straddlesLine(firstStartSide, firstEndSide);
}

export function straddlesLine(first, second) {
  return first === 0 || second === 0 || (first < 0) !== (second < 0);
}

export function closedIntervalsOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  const firstMin = Math.min(firstStart, firstEnd);
  const firstMax = Math.max(firstStart, firstEnd);
  const secondMin = Math.min(secondStart, secondEnd);
  const secondMax = Math.max(secondStart, secondEnd);
  return firstMin <= secondMax && secondMin <= firstMax;
}

export function scoreNodeLabelOverlaps(nodeOverlaps, edgeOverlaps, labelOverlaps) {
  return nodeOverlaps + edgeOverlaps + 2 * labelOverlaps;
}

export function scoreEdgeLabelOverlaps(
  labelArea,
  nodeOverlapAreaValue,
  nodeOverlapCountValue,
  edgeOverlapCountValue,
  almostLabelOverlapCount,
  labelOverlapCount,
  sharedSegmentOverlapCount,
) {
  let score = (nodeOverlapAreaValue / labelArea) * 2;
  score += labelOverlapCount * 10;
  score += almostLabelOverlapCount;
  score += nodeOverlapCountValue * 2;
  score += edgeOverlapCountValue * 2;
  score += sharedSegmentOverlapCount;
  return score;
}

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
    const k = Object.is(key, -0) ? 0 : key;
    let group = this.byKey.get(k);
    if (group === undefined) {
      group = [];
      this.byKey.set(k, group);
      this.groups.push(group);
    }
    group.push(segment);
  }
}

export function findSharedSegments(edges, guard) {
  guard.Step();
  const vertical = new SegmentGroups();
  const horizontal = new SegmentGroups();

  for (const edge of edges) {
    guard.Step();
    for (let i = 0; i < edge.Points.length - 1; i++) {
      guard.Step();
      const segment = new Segment(edge.Points[i].copy(), edge.Points[i + 1].copy());
      if (segment.Start.X === segment.End.X) {
        if (segment.End.Y < segment.Start.Y) {
          const temp = segment.End.Y;
          segment.End.Y = segment.Start.Y;
          segment.Start.Y = temp;
        }
        vertical.append(segment.Start.X, segment);
      } else if (segment.Start.Y === segment.End.Y) {
        if (segment.End.X < segment.Start.X) {
          const temp = segment.End.X;
          segment.End.X = segment.Start.X;
          segment.Start.X = temp;
        }
        horizontal.append(segment.Start.Y, segment);
      }
    }
  }

  const shared = [];
  const addGroups = (groups, isHorizontal) => {
    const coordinate = (point) => (isHorizontal ? point.X : point.Y);
    const setCoordinate = (point, value) => {
      if (isHorizontal) {
        point.X = value;
      } else {
        point.Y = value;
      }
    };

    for (const segments of groups.groups) {
      guard.Step();
      if (segments.length === 1) {
        continue;
      }
      sortSharedSegments(segments, coordinate, guard);

      let previous = segments[0];
      let overlap = null;
      for (let i = 1; i < segments.length; i++) {
        guard.Step();
        const current = segments[i];
        if (coordinate(previous.End) > coordinate(current.Start)) {
          if (overlap == null) {
            overlap = new Segment(current.Start.copy(), current.Start.copy());
            setCoordinate(overlap.End, Math.min(coordinate(previous.End), coordinate(current.End)));
          } else {
            const minimumOverlap = Math.min(coordinate(previous.End), coordinate(current.End));
            setCoordinate(overlap.End, Math.max(coordinate(overlap.End), minimumOverlap));
          }
        } else if (overlap != null) {
          shared.push(overlap);
          overlap = null;
        }
        if (coordinate(current.End) > coordinate(previous.End)) {
          previous = current;
        }
      }
      if (overlap != null) {
        shared.push(overlap);
      }
    }
  };

  addGroups(vertical, false);
  addGroups(horizontal, true);
  return shared;
}

export function sortSharedSegments(segments, coordinate, guard) {
  if (segments.length < 2) {
    return;
  }
  let buffer = new Array(segments.length);
  const less = (left, right) => {
    if (coordinate(left.Start) === coordinate(right.Start)) {
      return coordinate(left.End) < coordinate(right.End);
    }
    return coordinate(left.Start) < coordinate(right.Start);
  };
  let items = segments;
  for (let width = 1; width < items.length; ) {
    for (let start = 0; start < items.length; start += 2 * width) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + 2 * width, items.length);
      let left = start;
      let right = middle;
      let output = start;
      while (left < middle && right < end) {
        guard.Step();
        if (less(items[right], items[left])) {
          buffer[output] = items[right];
          right++;
        } else {
          buffer[output] = items[left];
          left++;
        }
        output++;
      }
      while (left < middle) {
        guard.Step();
        buffer[output] = items[left];
        left++;
        output++;
      }
      while (right < end) {
        guard.Step();
        buffer[output] = items[right];
        right++;
        output++;
      }
    }
    const temp = items;
    items = buffer;
    buffer = temp;
    if (width > Math.floor(items.length / 2)) {
      break;
    }
    width *= 2;
  }
  if (items.length > 0 && items !== segments) {
    for (let i = 0; i < items.length; i++) {
      segments[i] = items[i];
    }
  }
}
