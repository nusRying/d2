// Slice 47 — the regular-edge balancing closure used by RouteEdges.
//
// Pinned references (d2layouts/d2talalayout/internal/routing):
//   postprocess.go           — isSpecialEdgeForBalancing, balanceRegularEdgesGuarded
//   balance_crossings.go     — balanceReversalRemovesCrossings, balanceCollinearOverlap
//   port_interior_balance.go — hasFixedBalancingPorts
//   tunnel.go                — Range (start/end/length only)
//
// Not ported here (Slice 48 stage entry points): BalanceEdgeSegments,
// balanceEdgeSegmentsWithLimit, balanceEdgeSegmentsGuarded,
// balancePortInteriorsGuarded and the rest of port_interior_balance.go,
// FixClusterEdgeBranching and its helpers.

import { goMax, goMin } from '../geometry/go-math.js';
import { goRound } from '../geometry/math.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { isNonSharedCrossing } from './cost.js';
import { SEGMENT_SPACING_BUFFER, UNBOUNDED_SEGMENT_MOVE } from './tuning.js';
import { stableSortRouteValues } from './route-stage.js';
import {
  balanceOrderContactChanged,
  balanceOrderPreserved,
  balanceOrderReversed,
  checkBalanceOrder,
  edgeSegmentsGuarded,
  evenlyDistributeGuarded,
  nodeSegmentsGuarded,
  removeDuplicatePointsGuarded,
  routeSegmentBounds,
} from './balance-route-guard.js';
import { DIAMOND_TYPE, edgeSegmentOwner, segmentOverlaps } from './layoutgraph-route-support.js';

/** tunnel.go Range: a closed movement interval. */
export class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }

  length() {
    return this.end - this.start;
  }
}

function shapeType(node) {
  return node._shapeType ?? '';
}

/** hasFixedBalancingPorts: table-column and diamond ports are locked. */
export function hasFixedBalancingPorts(edge) {
  return edge.HasTableColumn() || shapeType(edge.From) === DIAMOND_TYPE || shapeType(edge.To) === DIAMOND_TYPE;
}

/**
 * isSpecialEdgeForBalancing identifies routes whose ports or rule-generated
 * geometry balancing must leave unchanged.
 */
export function isSpecialEdgeForBalancing(g, e) {
  if (g.NodeToTree.has(e.From)) {
    return true;
  }
  if (g.NodeToTree.has(e.To)) {
    return true;
  }
  if (e.HasTableColumn() || e.isLoop()) {
    return true;
  }
  // Edges locked to diamond ports strictly.
  if (shapeType(e.From) === DIAMOND_TYPE || shapeType(e.To) === DIAMOND_TYPE) {
    return true;
  }
  // Even/odd width alignment can leave centers misaligned by 1.
  const first = e.Points[0];
  const last = e.Points[e.Points.length - 1];
  return Math.abs(first.X - last.X) === 1 || Math.abs(first.Y - last.Y) === 1;
}

/**
 * Go map[layoutgraph.EdgeSegment]bool is keyed by the segment VALUE
 * (Start pointer, End pointer, owner edge), so distinct EdgeSegment objects
 * with the same triple are one key.
 */
class EdgeSegmentValueSet {
  constructor() {
    this._byStart = new Map();
    this.size = 0;
  }

  has(segment) {
    const byEnd = this._byStart.get(segment.Start);
    if (byEnd === undefined) return false;
    const owners = byEnd.get(segment.End);
    return owners !== undefined && owners.has(segment.edge);
  }

  add(segment) {
    let byEnd = this._byStart.get(segment.Start);
    if (byEnd === undefined) {
      byEnd = new Map();
      this._byStart.set(segment.Start, byEnd);
    }
    let owners = byEnd.get(segment.End);
    if (owners === undefined) {
      owners = new Set();
      byEnd.set(segment.End, owners);
    }
    if (!owners.has(segment.edge)) {
      owners.add(segment.edge);
      this.size++;
    }
  }
}

/**
 * Go map[Range][]*EdgeSegment keyed by two float64s. A NaN bound never
 * matches, so such entries are unreachable and are not stored.
 */
class RangeKeyMap {
  constructor() {
    this._map = new Map();
  }

  static key(range) {
    if (Number.isNaN(range.start) || Number.isNaN(range.end)) return null;
    // String(-0) === "0": +0 and -0 share a key as in Go.
    return `${range.start}|${range.end}`;
  }

  get(range) {
    const key = RangeKeyMap.key(range);
    if (key == null) return undefined;
    return this._map.get(key);
  }

  append(range, value) {
    const key = RangeKeyMap.key(range);
    if (key == null) return;
    const list = this._map.get(key);
    if (list === undefined) {
      this._map.set(key, [value]);
    } else {
      list.push(value);
    }
  }
}

// len(map[float64]struct{}) with Go float keys: +0 == -0, NaN keys distinct.
function countDistinctFloats(values) {
  const seen = new Set();
  let nanCount = 0;
  for (const value of values) {
    if (Number.isNaN(value)) {
      nanCount++;
    } else {
      seen.add(value === 0 ? 0 : value);
    }
  }
  return seen.size + nanCount;
}

/**
 * balanceRegularEdgesGuarded evenly distributes movable axis-aligned
 * segments of `regularEdges` inside their free corridors. `specialEdges`
 * are locked but bound the corridors.
 */
export function balanceRegularEdgesGuarded(g, specialEdges, regularEdges, guard) {
  // Row and diamond ports fix the endpoint and its short approach segment.
  const fixedPortPoints = new Set();
  for (const edge of regularEdges ?? []) {
    guard.step();
    if (!hasFixedBalancingPorts(edge)) {
      continue;
    }
    const points = edge.Points ?? [];
    for (const point of points.slice(0, Math.min(2, points.length))) {
      fixedPortPoints.add(point);
    }
    for (const point of points.slice(Math.max(0, points.length - 2))) {
      fixedPortPoints.add(point);
    }
  }
  const isConnectedToUnitNode = (point) => {
    for (const node of g.Nodes ?? []) {
      guard.step();
      if (node.Width === 1 && node.Height === 1) {
        if ((point.X === node.TopLeft.X || point.X === node.TopLeft.X + 1) &&
          (point.Y === node.TopLeft.Y || point.Y === node.TopLeft.Y + 1)) {
          return true;
        }
      }
    }
    return false;
  };

  const getSharedCluster = (edgeA, edgeB) => {
    const fromA = edgeA.From.Cluster;
    const toA = edgeA.To.Cluster;
    const fromB = edgeB.From.Cluster;
    const toB = edgeB.To.Cluster;
    if (fromA != null && (fromA === fromB || fromA === toB)) {
      return fromA;
    }
    if (toA != null && (toA === fromB || toA === toB)) {
      return toA;
    }
    return null;
  };

  const eq = (a, b) => Math.abs(a - b) <= 1;

  for (const isHorizontal of [true, false]) {
    let lockedSegments = nodeSegmentsGuarded(g.Nodes, !isHorizontal, guard);
    const lockedEdgeSegments = new EdgeSegmentValueSet();
    // Balancing vertical segments horizontally reads the vertical segments.
    const allEdgeSegments = edgeSegmentsGuarded(regularEdges, !isHorizontal, guard);

    const edgeSegments = [];
    const fixedSegments = [];
    for (const segment of allEdgeSegments) {
      if (fixedPortPoints.has(segment.Start) || fixedPortPoints.has(segment.End)) {
        fixedSegments.push(segment);
        continue;
      }
      const startConnected = isConnectedToUnitNode(segment.Start);
      const endConnected = isConnectedToUnitNode(segment.End);
      if (!startConnected && !endConnected) {
        edgeSegments.push(segment);
      }
    }
    // Special edges do not move but still bound the corridors.
    const specialEdgeSegments = fixedSegments;
    const guardedSpecialEdgeSegments = edgeSegmentsGuarded(specialEdges, !isHorizontal, guard);
    for (const specialEdgeSegment of guardedSpecialEdgeSegments) {
      guard.step();
      specialEdgeSegments.push(specialEdgeSegment);
    }
    // Regular segments shared with special edges are locked too.
    for (const s of edgeSegments) {
      const count = specialEdgeSegments.length; // Go ranges the slice header once
      for (let k = 0; k < count; k++) {
        const ses = specialEdgeSegments[k];
        guard.step();
        if (!segmentOverlaps(s, ses, isHorizontal, 1)) {
          continue;
        }
        if (isHorizontal) {
          if (eq(s.Start.X, ses.Start.X)) {
            specialEdgeSegments.push(s);
            lockedEdgeSegments.add(s);
            break;
          }
        } else if (eq(s.Start.Y, ses.Start.Y)) {
          specialEdgeSegments.push(s);
          lockedEdgeSegments.add(s);
          break;
        }
      }
    }
    lockedSegments = lockedSegments.concat(specialEdgeSegments);
    while (lockedEdgeSegments.size !== edgeSegments.length) {
      guard.step();
      let minRange = new Range(-Infinity, Infinity);
      const segmentRanges = new RangeKeyMap();

      for (const es of edgeSegments) {
        guard.step();
        if (lockedEdgeSegments.has(es)) {
          continue;
        }
        let [floor, ceil] = routeSegmentBounds(es, lockedSegments, SEGMENT_SPACING_BUFFER, guard);
        if (isHorizontal) {
          if (floor === -Infinity) {
            floor = es.Start.X - UNBOUNDED_SEGMENT_MOVE;
          }
          if (ceil === Infinity) {
            ceil = es.Start.X + UNBOUNDED_SEGMENT_MOVE;
          }
        } else {
          if (floor === -Infinity) {
            floor = es.Start.Y - UNBOUNDED_SEGMENT_MOVE;
          }
          if (ceil === Infinity) {
            ceil = es.Start.Y + UNBOUNDED_SEGMENT_MOVE;
          }
        }

        const movementRange = new Range(floor, ceil);
        segmentRanges.append(movementRange, es);
        if (movementRange.length() < minRange.length()) {
          minRange = movementRange;
        }
      }

      // Segments sharing the narrowest range are split by overlap and
      // distributed together.
      const minRangeSegments = segmentRanges.get(minRange) ?? [];
      for (const s of minRangeSegments) {
        guard.step();
        if (lockedEdgeSegments.has(s)) {
          continue;
        }
        const balanceBatch = [s];
        const balanceBatchSet = new Set([s]);
        for (const otherS of minRangeSegments) {
          guard.step();
          if (s === otherS) {
            continue;
          }
          if (lockedEdgeSegments.has(otherS)) {
            continue;
          }
          let buffer = SEGMENT_SPACING_BUFFER;
          // Segments of the same edge need no buffer from each other.
          if (edgeSegmentOwner(s) === edgeSegmentOwner(otherS)) {
            buffer = 0;
          }
          if (segmentOverlaps(s, otherS, isHorizontal, buffer)) {
            balanceBatch.push(otherS);
            balanceBatchSet.add(otherS);
          }
        }
        // Segments sharing a route (even partially) balance together.
        for (const otherS of edgeSegments) {
          guard.step();
          if (balanceBatchSet.has(otherS)) {
            continue;
          }
          if (lockedEdgeSegments.has(otherS)) {
            continue;
          }
          const cluster = getSharedCluster(edgeSegmentOwner(s), edgeSegmentOwner(otherS));
          if (cluster != null && cluster.Arrangement === cluster.DesiredArrangement) {
            let shouldBalanceTogether;
            if (isHorizontal) {
              shouldBalanceTogether = cluster.Arrangement === ClusterArrangement.Column && eq(s.Start.X, otherS.Start.X);
            } else {
              shouldBalanceTogether = cluster.Arrangement === ClusterArrangement.Row && eq(s.Start.Y, otherS.Start.Y);
            }
            if (shouldBalanceTogether) {
              balanceBatch.push(otherS);
              balanceBatchSet.add(otherS);
              continue;
            }
          }
          if (!segmentOverlaps(s, otherS, isHorizontal, 1)) {
            continue;
          }
          const shared = isHorizontal ? eq(s.Start.X, otherS.Start.X) : eq(s.Start.Y, otherS.Start.Y);
          if (shared) {
            balanceBatch.push(otherS);
            balanceBatchSet.add(otherS);
          }
        }
        stableSortRouteValues(balanceBatch, (a, b) => {
          let primaryDimensionI;
          let primaryDimensionJ;
          let secondaryDimensionI;
          let secondaryDimensionJ;
          if (isHorizontal) {
            primaryDimensionI = a.Start.X;
            primaryDimensionJ = b.Start.X;
            secondaryDimensionI = a.Start.Y;
            secondaryDimensionJ = b.Start.Y;
          } else {
            primaryDimensionI = a.Start.Y;
            primaryDimensionJ = b.Start.Y;
            secondaryDimensionI = a.Start.X;
            secondaryDimensionJ = b.Start.X;
          }
          if (primaryDimensionI === primaryDimensionJ) {
            return secondaryDimensionI < secondaryDimensionJ;
          }
          return primaryDimensionI < primaryDimensionJ;
        }, guard);
        // Shared routes are intentional: keep them shared.
        const rounded = [];
        for (const member of balanceBatch) {
          guard.step();
          rounded.push(goRound(isHorizontal ? member.Start.X : member.Start.Y));
        }
        const distinctCount = countDistinctFloats(rounded);

        const distributionVals = evenlyDistributeGuarded(minRange.start, minRange.end, distinctCount, guard);
        const proposed = new Array(balanceBatch.length);
        for (let i = 0; i < balanceBatch.length; i++) {
          guard.step();
          const segment = balanceBatch[i];
          proposed[i] = isHorizontal ? segment.Start.X : segment.Start.Y;
        }

        for (let valIndex = 0, segmentIndex = 0; valIndex < distributionVals.length; valIndex++) {
          guard.step();
          let sharedCount = 0;
          while (segmentIndex + sharedCount < balanceBatch.length) {
            guard.step();
            if (isHorizontal) {
              if (eq(balanceBatch[segmentIndex].Start.X, balanceBatch[segmentIndex + sharedCount].Start.X)) {
                sharedCount++;
              } else {
                break;
              }
            } else if (eq(balanceBatch[segmentIndex].Start.Y, balanceBatch[segmentIndex + sharedCount].Start.Y)) {
              sharedCount++;
            } else {
              break;
            }
          }

          const val = distributionVals[valIndex];
          for (let i = segmentIndex; i < segmentIndex + sharedCount; i++) {
            guard.step();
            proposed[i] = val;
          }
          segmentIndex += sharedCount;
        }
        let order = checkBalanceOrder(balanceBatch, balanceBatchSet, allEdgeSegments, proposed, isHorizontal, guard);
        if (order !== balanceOrderContactChanged) {
          const specialOrder = checkBalanceOrder(balanceBatch, balanceBatchSet, guardedSpecialEdgeSegments, proposed, isHorizontal, guard);
          order = Math.max(order, specialOrder);
        }
        let accept = order === balanceOrderPreserved;
        if (order === balanceOrderReversed) {
          accept = balanceReversalRemovesCrossings(g, balanceBatch, proposed, isHorizontal, guard);
        }
        if (accept) {
          for (let i = 0; i < balanceBatch.length; i++) {
            guard.step();
            const segment = balanceBatch[i];
            if (isHorizontal) {
              segment.Start.X = proposed[i];
              segment.End.X = proposed[i];
            } else {
              segment.Start.Y = proposed[i];
              segment.End.Y = proposed[i];
            }
          }
        }
        for (const member of balanceBatch) {
          guard.step();
          lockedEdgeSegments.add(member);
          lockedSegments.push(member);
        }
      }
    }
  }
  for (const e of regularEdges ?? []) {
    e.Points = removeDuplicatePointsGuarded(e.Points, guard);
  }
}

/**
 * balanceReversalRemovesCrossings permits a rejected reversal only when it
 * removes crossings without increasing them for any affected route pair or
 * creating a new shared run. The graph is untouched.
 */
export function balanceReversalRemovesCrossings(g, batch, proposed, isHorizontal, guard) {
  const pointCopies = new Map();
  for (let i = 0; i < batch.length; i++) {
    guard.step();
    const segment = batch[i];
    for (const point of [segment.Start, segment.End]) {
      guard.step();
      const candidate = { X: point.X, Y: point.Y };
      if (isHorizontal) {
        candidate.X = proposed[i];
      } else {
        candidate.Y = proposed[i];
      }
      const previous = pointCopies.get(point);
      if (previous !== undefined && (previous.X !== candidate.X || previous.Y !== candidate.Y)) {
        return false;
      }
      pointCopies.set(point, candidate);
    }
  }

  const edges = g.Edges ?? [];
  guard.add(edges.length);
  const candidates = new Array(edges.length).fill(null);
  const affected = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    guard.step();
    const points = edge.Points ?? [];
    let changed = false;
    for (const point of points) {
      guard.step();
      const candidate = pointCopies.get(point);
      if (candidate !== undefined && (candidate.X !== point.X || candidate.Y !== point.Y)) {
        changed = true;
      }
    }
    if (!changed) {
      continue;
    }
    if (edge.IsCurve) {
      return false;
    }
    guard.add(points.length);
    const candidatePoints = new Array(points.length);
    for (let j = 0; j < points.length; j++) {
      guard.step();
      const point = points[j];
      candidatePoints[j] = point;
      const replacement = pointCopies.get(point);
      if (replacement !== undefined) {
        candidatePoints[j] = replacement;
      }
      if (j > 0) {
        const before = points[j - 1];
        const after = candidatePoints[j - 1];
        if ((before.X !== point.X && before.Y !== point.Y) ||
          (after.X !== candidatePoints[j].X && after.Y !== candidatePoints[j].Y)) {
          return false;
        }
      }
    }
    // candidate := *edge with a new Points slice; only Points is read below.
    candidates[i] = { Points: candidatePoints };
    affected.push(i);
  }

  let improved = false;
  for (const i of affected) {
    guard.step();
    for (let j = 0; j < edges.length; j++) {
      const other = edges[j];
      guard.step();
      if (i === j || (candidates[j] != null && j < i)) {
        continue;
      }
      // A curve's control polygon cannot prove its rendered crossings.
      if (other.IsCurve) {
        return false;
      }
      let otherCandidate = candidates[j];
      if (otherCandidate == null) {
        otherCandidate = other;
      }
      let before = 0;
      let after = 0;
      const edgePoints = edges[i].Points;
      const otherPoints = other.Points ?? [];
      for (let a = 0; a + 1 < edgePoints.length; a++) {
        guard.step();
        for (let b = 0; b + 1 < otherPoints.length; b++) {
          guard.step();
          if (isNonSharedCrossing(edges[i], other, a, b)) {
            before++;
          }
          if (isNonSharedCrossing(candidates[i], otherCandidate, a, b)) {
            after++;
          }
          // Dragged adjacent legs must not gain a new shared run.
          const oldOverlap = balanceCollinearOverlap(edgePoints[a], edgePoints[a + 1], otherPoints[b], otherPoints[b + 1]);
          const newOverlap = balanceCollinearOverlap(candidates[i].Points[a], candidates[i].Points[a + 1], otherCandidate.Points[b], otherCandidate.Points[b + 1]);
          if (oldOverlap === 0 && newOverlap > 0) {
            return false;
          }
        }
      }
      if (after > before) {
        return false;
      }
      improved = improved || after < before;
    }
  }
  return improved;
}

export function balanceCollinearOverlap(a, b, c, d) {
  if (a.X === b.X && c.X === d.X && a.X === c.X) {
    return goMax(0, goMin(goMax(a.Y, b.Y), goMax(c.Y, d.Y)) - goMax(goMin(a.Y, b.Y), goMin(c.Y, d.Y)));
  }
  if (a.Y === b.Y && c.Y === d.Y && a.Y === c.Y) {
    return goMax(0, goMin(goMax(a.X, b.X), goMax(c.X, d.X)) - goMax(goMin(a.X, b.X), goMin(c.X, d.X)));
  }
  return 0;
}
