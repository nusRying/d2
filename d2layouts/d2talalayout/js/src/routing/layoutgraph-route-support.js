// Slice 47 — layoutgraph accessors and Go value helpers needed by the routing
// primitives that have no shared JS equivalent yet. They are free functions so
// the shared graph classes stay unchanged.
//
// Pinned references (Go authority 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579):
//   internal/layoutgraph/routing_access.go   — IsDuplicateOf, MatchingArrowheads,
//                                              OwnArrowheadsMatch, PortOrientation,
//                                              EdgeSegment.Owner, IDValue
//   internal/layoutgraph/edge.go             — EquivalentStyles/stylesMatchOneWay,
//                                              isDuplicateOf, hasMatchingArrowheads,
//                                              ownArrowheadsMatch, Length
//   internal/layoutgraph/node.go             — pointToPortOrientation, nthPortValue
//   internal/layoutgraph/labeling_access.go  — LabelBoxesOverlap
//   internal/layoutgraph/geometry_policy.go  — CrossingCostWeight
//   internal/layoutgraph/structure_api.go    — MaxTopologyReferences, MaxRoutePoints
//   lib/geo/segment.go                       — Segment.Overlaps
//   lib/geo/route.go                         — Route.Length
//   lib/label/label.go                       — Position.IsEdgePosition
//   math/pow.go                              — math.Pow (integral exponents)

import { euclideanDistance, goRound } from '../geometry/math.js';
import { frexp, goMax, goMin, ldexp } from '../geometry/go-math.js';
import { Orientation } from '../geometry/orientation.js';
import { LabelPosition, normalizeLabelPosition } from '../graph/label-position.js';
import { MAX_ROUTE_POINTS, MAX_TOPOLOGY_REFERENCES } from '../limits/constants.js';
import { nodePortIndices, nodeSnapPointPercentages } from '../shape/ports.js';

/** layoutgraph.CrossingCostWeight = 0.48 * 0.48 * 0.48 (evaluated left to right). */
export const CrossingCostWeight = 0.48 * 0.48 * 0.48;
/** layoutgraph.MaxTopologyReferences. */
export const MaxTopologyReferences = MAX_TOPOLOGY_REFERENCES;
/** layoutgraph.MaxRoutePoints. */
export const MaxRoutePoints = MAX_ROUTE_POINTS;

/** d2 lib/shape type names used by routing. */
export const DIAMOND_TYPE = 'Diamond';

/** Edge.IDValue (EntityID formatted with %d). */
export function edgeIDValue(edge) {
  return edge.ID == null ? '0' : edge.ID.toString();
}

/** Edge.IsDuplicateOf(other) == other.isDuplicateOf(edge) receiver order kept. */
export function edgeIsDuplicateOf(edge, otherEdge) {
  if (otherEdge.To === edge.To && otherEdge.From === edge.From) {
    return true;
  }
  if (otherEdge.From === edge.To && otherEdge.To === edge.From) {
    return true;
  }
  return false;
}

/** Edge.OwnArrowheadsMatch. */
export function edgeOwnArrowheadsMatch(edge) {
  return edge.SourceArrowhead === edge.TargetArrowhead;
}

/** Edge.MatchingArrowheads (hasMatchingArrowheads). */
export function edgeMatchingArrowheads(edge, otherEdge) {
  if (edge.SourceArrowhead === otherEdge.SourceArrowhead && edge.TargetArrowhead === otherEdge.TargetArrowhead) {
    return true;
  }
  if (edge.SourceArrowhead === otherEdge.TargetArrowhead && edge.TargetArrowhead === otherEdge.SourceArrowhead) {
    return true;
  }
  return false;
}

// JS edges carry a nullable Style object; a null Style is Go's zero EdgeStyle.
function styleScalar(edge, name) {
  const style = edge.Style;
  if (style == null) return null;
  const scalar = style[name];
  return scalar == null ? null : scalar;
}

const COMPARED_STYLE_FIELDS = ['Opacity', 'Stroke', 'StrokeWidth', 'StrokeDash', 'Animated'];

function stylesMatchOneWay(e1, e2) {
  for (const field of COMPARED_STYLE_FIELDS) {
    const own = styleScalar(e1, field);
    if (own != null) {
      const other = styleScalar(e2, field);
      if (!(other != null && other.Value === own.Value)) {
        return false;
      }
    }
  }
  return true;
}

/** Edge.EquivalentStyles. */
export function edgeEquivalentStyles(e1, e2) {
  return stylesMatchOneWay(e1, e2) && stylesMatchOneWay(e2, e1);
}

/** geo.Route(points).Length(). */
export function routeLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += euclideanDistance(points[i].X, points[i].Y, points[i + 1].X, points[i + 1].Y);
  }
  return length;
}

/** Edge.Length. */
export function edgeLength(edge) {
  return routeLength(edge.Points ?? []);
}

/** EdgeSegment.Owner. */
export function edgeSegmentOwner(segment) {
  return segment.edge;
}

/** geo.Segment.Overlaps with Go math.Min/Max. */
export function segmentOverlaps(s, otherS, isHorizontal, buffer) {
  if (isHorizontal) {
    if (goMin(s.Start.Y, s.End.Y) - goMax(otherS.Start.Y, otherS.End.Y) >= buffer) {
      return false;
    }
    if (goMin(otherS.Start.Y, otherS.End.Y) - goMax(s.Start.Y, s.End.Y) >= buffer) {
      return false;
    }
    return true;
  }
  if (goMin(s.Start.X, s.End.X) - goMax(otherS.Start.X, otherS.End.X) >= buffer) {
    return false;
  }
  if (goMin(otherS.Start.X, otherS.End.X) - goMax(s.Start.X, s.End.X) >= buffer) {
    return false;
  }
  return true;
}

/** Node.LabelBoxesOverlap → doesOverlapCalc → boxesOverlapWithPadding. */
export function nodeLabelBoxesOverlap(node, other, padding) {
  const b1 = node.Box;
  const b2 = other.Box;
  const b1Right = b1.TopLeft.X + b1.Width;
  const b2Right = b2.TopLeft.X + b2.Width;
  if (b1.TopLeft.X >= b2Right + padding || b2.TopLeft.X >= b1Right + padding) {
    return false;
  }
  const b1Bottom = b1.TopLeft.Y + b1.Height;
  const b2Bottom = b2.TopLeft.Y + b2.Height;
  return b1.TopLeft.Y < b2Bottom + padding && b2.TopLeft.Y < b1Bottom + padding;
}

// Node.nthPortValue: walk the snap points in Go order.
function nthPort(node, index) {
  let i = 0;
  for (const relativePoints of nodeSnapPointPercentages(node)) {
    for (const point of relativePoints) {
      if (i === index) {
        return {
          X: node.TopLeft.X + goRound(node.Width * point.XPercentage),
          Y: node.TopLeft.Y + goRound(node.Height * point.YPercentage),
        };
      }
      i++;
    }
  }
  return null;
}

/** Node.PortOrientation (pointToPortOrientation). */
export function nodePortOrientation(node, point) {
  for (const o of [Orientation.Top, Orientation.Right, Orientation.Left, Orientation.Bottom]) {
    for (const index of nodePortIndices(node, o)) {
      const port = nthPort(node, index);
      // geo.Point.Equals: nil-aware exact coordinate equality.
      if (point == null ? port == null : (port != null && point.X === port.X && point.Y === port.Y)) {
        return o;
      }
    }
  }
  return Orientation.NONE;
}

/** label.Position.IsEdgePosition. */
export function isEdgePosition(position) {
  switch (normalizeLabelPosition(position)) {
    case LabelPosition.OutsideTopLeft:
    case LabelPosition.OutsideTopCenter:
    case LabelPosition.OutsideTopRight:
    case LabelPosition.InsideMiddleLeft:
    case LabelPosition.InsideMiddleCenter:
    case LabelPosition.InsideMiddleRight:
    case LabelPosition.OutsideBottomLeft:
    case LabelPosition.OutsideBottomCenter:
    case LabelPosition.OutsideBottomRight:
    case LabelPosition.UnlockedTop:
    case LabelPosition.UnlockedMiddle:
    case LabelPosition.UnlockedBottom:
      return true;
    default:
      return false;
  }
}

/** label.Position != label.Unset. */
export function isLabelPositionSet(position) {
  return normalizeLabelPosition(position) !== LabelPosition.Unset;
}

/**
 * math.Pow(x, y) for integral y (math/pow.go; amd64 has no arch Pow). The
 * routing kernels only raise turnPenalty to float64(len(points)-2). A
 * fractional exponent would need Go's Exp/Log and is rejected loudly.
 */
export function goPow(x, y) {
  if (y === 0 || x === 1) return 1;
  if (y === 1) return x;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const isOddInt = (v) => Number.isInteger(v) && Math.abs(v) < 2 ** 53 && Math.abs(v % 2) === 1;
  if (x === 0) {
    const negZero = Object.is(x, -0);
    if (y < 0) return negZero && isOddInt(y) ? -Infinity : Infinity;
    if (y > 0) return negZero && isOddInt(y) ? x : 0;
  }
  if (y === Infinity || y === -Infinity) {
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === (y === Infinity)) return 0;
    return Infinity;
  }
  if (x === Infinity || x === -Infinity) {
    if (x === -Infinity) return goPow(1 / x, -y);
    if (y < 0) return 0;
    if (y > 0) return Infinity;
  }
  if (y === 0.5) return Math.sqrt(x);
  if (y === -0.5) return 1 / Math.sqrt(x);
  const absY = Math.abs(y);
  const yi = Math.trunc(absY);
  const yf = absY - yi;
  if (yf !== 0) {
    throw new Error('TALA JS goPow supports only integral exponents');
  }
  if (yi >= 2 ** 63) {
    if (x === -1) return 1;
    if ((Math.abs(x) < 1) === (y > 0)) return 0;
    return Infinity;
  }
  let a1 = 1.0;
  let ae = 0;
  let [x1, xe] = frexp(x);
  for (let i = BigInt(yi); i !== 0n; i >>= 1n) {
    if (xe < -(1 << 12) || (1 << 12) < xe) {
      ae += xe;
      break;
    }
    if ((i & 1n) === 1n) {
      a1 *= x1;
      ae += xe;
    }
    x1 *= x1;
    xe <<= 1;
    if (x1 < 0.5) {
      x1 += x1;
      xe--;
    }
  }
  if (y < 0) {
    a1 = 1 / a1;
    ae = -ae;
  }
  return ldexp(a1, ae);
}

/** Go %v formatting of a float64 (strconv 'g', shortest). */
export function goFormatFloat(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const negative = value < 0;
  const [mantissa, expText] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exp = Number(expText);
  let out;
  // strconv 'g' with shortest precision switches to %e at exp < -4 || exp >= 6.
  if (exp < -4 || exp >= 6) {
    out = digits[0] + (digits.length > 1 ? `.${digits.slice(1)}` : '') + 'e' + (exp < 0 ? '-' : '+') +
      String(Math.abs(exp)).padStart(2, '0');
  } else if (exp < 0) {
    out = `0.${'0'.repeat(-exp - 1)}${digits}`;
  } else if (digits.length <= exp + 1) {
    out = digits + '0'.repeat(exp + 1 - digits.length);
  } else {
    out = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  }
  return negative ? `-${out}` : out;
}

/**
 * PointValueMap models Go map[geo.Point]V: keys compare by float equality
 * (+0 == -0) and a NaN coordinate never matches, so every NaN insert creates
 * a new unreachable entry. Iteration follows insertion order; Go's order is
 * randomized, so callers must not depend on it.
 */
export class PointValueMap {
  constructor() {
    this._index = new Map();
    this._entries = [];
  }

  static key(point) {
    return `${point.X},${point.Y}`;
  }

  get size() {
    return this._entries.length;
  }

  get(point) {
    if (Number.isNaN(point.X) || Number.isNaN(point.Y)) return undefined;
    const entry = this._index.get(PointValueMap.key(point));
    return entry === undefined ? undefined : entry.value;
  }

  has(point) {
    if (Number.isNaN(point.X) || Number.isNaN(point.Y)) return false;
    return this._index.has(PointValueMap.key(point));
  }

  set(point, value) {
    const key = { X: point.X, Y: point.Y };
    if (Number.isNaN(point.X) || Number.isNaN(point.Y)) {
      this._entries.push({ key, value });
      return;
    }
    const existing = this._index.get(PointValueMap.key(point));
    if (existing !== undefined) {
      // Go updates float keys on assignment (+0/-0 spelling follows the write).
      existing.key = key;
      existing.value = value;
      return;
    }
    const entry = { key, value };
    this._index.set(PointValueMap.key(point), entry);
    this._entries.push(entry);
  }

  *entries() {
    for (const entry of this._entries) yield [entry.key, entry.value];
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}
