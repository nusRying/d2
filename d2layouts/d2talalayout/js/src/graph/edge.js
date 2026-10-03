
import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';
import { LabelPosition, normalizeLabelPosition, getPointOnRoute, getUnitNormalVector, routeLength } from './label-position.js';

// NoArrowhead is the sentinel value matching Go's NoArrowhead constant ("none").
export const NO_ARROWHEAD = "none";

const EDGE_STROKE_WIDTH = 3.0;
const BASE_CONNECTION_STROKE_WIDTH = 2.0;
const MIN_ARROWHEAD_STROKE_WIDTH = 2.0;
const ARROWHEAD_PADDING = 2.0;
const LABEL_PADDING = 5.0;

function arrowheadDimensions(arrowhead, strokeWidth) {
  let baseWidth = 0;
  let baseHeight = 0;
  let widthMultiplier = 0;
  let heightMultiplier = 0;

  switch (arrowhead) {
    case "arrow":
      baseWidth = 4;
      baseHeight = 4;
      widthMultiplier = 4;
      heightMultiplier = 4;
      break;
    case "triangle":
      baseWidth = 4;
      baseHeight = 4;
      widthMultiplier = 3;
      heightMultiplier = 4;
      break;
    case "unfilled-triangle":
      baseWidth = 7;
      baseHeight = 7;
      widthMultiplier = 3;
      heightMultiplier = 4;
      break;
    case "line":
      widthMultiplier = 5;
      heightMultiplier = 8;
      break;
    case "filled-diamond":
      baseWidth = 11;
      baseHeight = 7;
      widthMultiplier = 5.5;
      heightMultiplier = 3.5;
      break;
    case "diamond":
      baseWidth = 11;
      baseHeight = 9;
      widthMultiplier = 5.5;
      heightMultiplier = 4.5;
      break;
    case "cross":
      baseWidth = 7;
      baseHeight = 7;
      widthMultiplier = 5;
      heightMultiplier = 5;
      break;
    case "filled-circle":
    case "circle":
      baseWidth = 8;
      baseHeight = 8;
      widthMultiplier = 5;
      heightMultiplier = 5;
      break;
    case "filled-box":
    case "box":
      baseWidth = 6;
      baseHeight = 6;
      widthMultiplier = 5;
      heightMultiplier = 5;
      break;
    case "cf-one":
    case "cf-many":
    case "cf-one-required":
    case "cf-many-required":
      baseWidth = 9;
      baseHeight = 9;
      widthMultiplier = 4.5;
      heightMultiplier = 4.5;
      break;
    default:
      return [0, 0];
  }

  const clippedStrokeWidth = Math.max(MIN_ARROWHEAD_STROKE_WIDTH, strokeWidth);
  return [
    baseWidth + clippedStrokeWidth * widthMultiplier,
    baseHeight + clippedStrokeWidth * heightMultiplier,
  ];
}

function arrowheadTopLeft(route, isTarget, sourceArrowhead, targetArrowhead, rawWidth, rawHeight) {
  const width = Math.trunc(rawWidth);
  const height = Math.trunc(rawHeight);

  const index = isTarget ? route.length - 2 : 0;
  const start = route[index];
  const end = route[index + 1];

  const [normalX, normalY] = getUnitNormalVector(end.X, end.Y, start.X, start.Y);

  const shift = Math.abs(normalX) * (height / 2 + LABEL_PADDING) +
                Math.abs(normalY) * (width / 2 + LABEL_PADDING);

  const length = routeLength(route);
  let position = isTarget ? 1.0 : 0.0;
  if (length > 0) {
    if (isTarget) {
      position -= shift / length;
    } else {
      position = shift / length;
    }
  }

  const strokeWidth = BASE_CONNECTION_STROKE_WIDTH;

  const [labelTL] = getPointOnRoute(
    LabelPosition.UnlockedTop,
    route,
    strokeWidth,
    position,
    width,
    height
  );

  let arrowSize = 0;
  if (isTarget && targetArrowhead !== NO_ARROWHEAD) {
    const [, h] = arrowheadDimensions(targetArrowhead, strokeWidth);
    arrowSize = h;
  } else if (sourceArrowhead !== NO_ARROWHEAD) {
    const [, h] = arrowheadDimensions(sourceArrowhead, strokeWidth);
    arrowSize = h;
  }

  if (arrowSize > 0) {
    const offset = (arrowSize / 2 + ARROWHEAD_PADDING) - strokeWidth / 2 - LABEL_PADDING;
    if (offset > 0) {
      labelTL.X += normalX * offset;
      labelTL.Y += normalY * offset;
    }
  }

  return labelTL;
}

export class Edge {
  constructor(from, to) {
    this.ID = 0n;
    this.D2ID = null;

    this.sourceEndpointId = null;
    this.targetEndpointId = null;
    this.route = [];
    this.elkData = null;

    this.From = from;
    this.To = to;
    this.Points = []; // array of geo.Point

    this.MinWidth = 0;
    this.MinHeight = 0;

    // Go zero-value for string Arrowhead is "", not a number.
    this.SourceArrowhead = "";
    this.TargetArrowhead = "";
    this.SourceArrowheadLabel = null;
    this.TargetArrowheadLabel = null;
    
    this.Label = null;
    this.LabelPercentage = 0;
    
    this.FromTableColumnIndex = null;
    this.ToTableColumnIndex = null;
    this.IsInvisible = false;
    this.Style = null;
  }

  entityID() {
    return this.ID;
  }

  isLoop() {
    return this.From === this.To;
  }

  // HasSourceArrow reports whether the source end carries a visible arrowhead.
  // Pinned reference: layoutgraph/edge.go HasSourceArrow
  hasSourceArrow() {
    return this.SourceArrowhead !== "" && this.SourceArrowhead !== NO_ARROWHEAD;
  }

  HasSourceArrow() {
    return this.hasSourceArrow();
  }

  // HasTargetArrow reports whether the target end carries a visible arrowhead.
  // Pinned reference: layoutgraph/edge.go HasTargetArrow
  hasTargetArrow() {
    return this.TargetArrowhead !== "" && this.TargetArrowhead !== NO_ARROWHEAD;
  }

  HasTargetArrow() {
    return this.hasTargetArrow();
  }

  // isDirected: exactly one end has an arrowhead. Pinned to Go edge.go.
  isDirected() {
    return this.hasSourceArrow() !== this.hasTargetArrow();
  }

  IsDirected() {
    return this.isDirected();
  }

  // isBidirectional: both ends carry visible arrowheads. Pinned to Go edge.go.
  isBidirectional() {
    return this.hasSourceArrow() && this.hasTargetArrow();
  }

  IsBidirectional() {
    return this.isBidirectional();
  }

  // isUndirected: neither end carries a visible arrowhead. Pinned to Go edge.go.
  isUndirected() {
    return !this.hasSourceArrow() && !this.hasTargetArrow();
  }

  IsUndirected() {
    return this.isUndirected();
  }

  directedEndpoints() {
    if (!this.isDirected()) {
      return [null, null, false];
    }
    if (this.hasSourceArrow()) {
      return [this.To, this.From, true];
    }
    return [this.From, this.To, true];
  }

  DirectedEndpoints() {
    return this.directedEndpoints();
  }

  hasTableColumn() {
    return this.FromTableColumnIndex != null || this.ToTableColumnIndex != null;
  }

  HasTableColumn() {
    return this.hasTableColumn();
  }

  isBetweenTableColumns() {
    return this.FromTableColumnIndex != null && this.ToTableColumnIndex != null;
  }

  IsBetweenTableColumns() {
    return this.isBetweenTableColumns();
  }

  hasLargeArrowheadLabel() {
    return (this.SourceArrowheadLabel != null && this.SourceArrowheadLabel.Text.length > 3) ||
      (this.TargetArrowheadLabel != null && this.TargetArrowheadLabel.Text.length > 3);
  }

  HasLargeArrowheadLabel() {
    return this.hasLargeArrowheadLabel();
  }

  facingTablePorts(abductionFrom, abductionTo) {
    if (!this.hasTableColumn()) {
      return {
        from: new Point(0, 0),
        to: new Point(0, 0),
        hasFrom: false,
        hasTo: false,
        orientation: Orientation.NONE,
      };
    }
    const from = abductionFrom != null ? abductionFrom : this.From;
    const to = abductionTo != null ? abductionTo : this.To;
    const orientation = from.orientation(to);
    const ports = {
      from: new Point(0, 0),
      to: new Point(0, 0),
      hasFrom: false,
      hasTo: false,
      orientation,
    };
    switch (orientation) {
      case Orientation.TopLeft:
      case Orientation.BottomLeft:
      case Orientation.Left:
        if (this.FromTableColumnIndex != null) {
          const [p, ok] = from.tableColumnPortValue(Orientation.Right, this.FromTableColumnIndex);
          ports.from = p;
          ports.hasFrom = ok;
        }
        if (this.ToTableColumnIndex != null) {
          const [p, ok] = to.tableColumnPortValue(Orientation.Left, this.ToTableColumnIndex);
          ports.to = p;
          ports.hasTo = ok;
        }
        return ports;
      case Orientation.Right:
      case Orientation.TopRight:
      case Orientation.BottomRight:
        if (this.FromTableColumnIndex != null) {
          const [p, ok] = from.tableColumnPortValue(Orientation.Left, this.FromTableColumnIndex);
          ports.from = p;
          ports.hasFrom = ok;
        }
        if (this.ToTableColumnIndex != null) {
          const [p, ok] = to.tableColumnPortValue(Orientation.Right, this.ToTableColumnIndex);
          ports.to = p;
          ports.hasTo = ok;
        }
        return ports;
    }
    return {
      from: new Point(0, 0),
      to: new Point(0, 0),
      hasFrom: false,
      hasTo: false,
      orientation: Orientation.NONE,
    };
  }

  FacingTablePortValues(from, to) {
    const ports = this.facingTablePorts(from, to);
    return [ports.from, ports.to, ports.hasFrom, ports.hasTo, ports.orientation];
  }

  reconnect(newEndpoint, isTo) {
    if (isTo) {
      if (this.To) this.To.removeEdge(this);
      newEndpoint.addEdge(this);
      this.To = newEndpoint;
    } else {
      if (this.From) this.From.removeEdge(this);
      newEndpoint.addEdge(this);
      this.From = newEndpoint;
    }
  }

  Reconnect(newEndpoint, isTo) {
    this.reconnect(newEndpoint, isTo);
  }

  sourcePort() {
    if (this.Points.length === 0) return null;
    return this.Points[0];
  }

  targetPort() {
    if (this.Points.length === 0) return null;
    return this.Points[this.Points.length - 1];
  }

  labelTopLeft(labelPosition, width, height) {
    const [point] = getPointOnRoute(
      labelPosition,
      this.Points,
      EDGE_STROKE_WIDTH,
      this.LabelPercentage,
      width,
      height
    );
    return point;
  }

  LabelTopLeft(labelPosition, width, height) {
    return this.labelTopLeft(labelPosition, width, height);
  }

  boundingBoxValues() {
    const tl = new Point(Infinity, Infinity);
    const br = new Point(-Infinity, -Infinity);

    for (const p of this.Points) {
      tl.X = Math.min(tl.X, p.X);
      tl.Y = Math.min(tl.Y, p.Y);
      br.X = Math.max(br.X, p.X);
      br.Y = Math.max(br.Y, p.Y);
    }

    if (this.Label != null && this.Points.length !== 0 && normalizeLabelPosition(this.Label.Position) !== LabelPosition.Unset) {
      const labelTL = this.labelTopLeft(this.Label.Position, this.Label.Width, this.Label.Height);
      tl.X = Math.min(tl.X, labelTL.X);
      tl.Y = Math.min(tl.Y, labelTL.Y);
      br.X = Math.max(br.X, labelTL.X + this.Label.Width);
      br.Y = Math.max(br.Y, labelTL.Y + this.Label.Height);
    }

    if (this.Points.length > 0) {
      if (this.SourceArrowheadLabel != null) {
        const label = this.SourceArrowheadLabel;
        const labelTL = arrowheadTopLeft(
          this.Points,
          false,
          this.SourceArrowhead != null ? String(this.SourceArrowhead) : "",
          this.TargetArrowhead != null ? String(this.TargetArrowhead) : "",
          label.Width,
          label.Height
        );
        tl.X = Math.min(tl.X, labelTL.X);
        tl.Y = Math.min(tl.Y, labelTL.Y);
        br.X = Math.max(br.X, labelTL.X + label.Width);
        br.Y = Math.max(br.Y, labelTL.Y + label.Height);
      }
      if (this.TargetArrowheadLabel != null) {
        const label = this.TargetArrowheadLabel;
        const labelTL = arrowheadTopLeft(
          this.Points,
          true,
          this.SourceArrowhead != null ? String(this.SourceArrowhead) : "",
          this.TargetArrowhead != null ? String(this.TargetArrowhead) : "",
          label.Width,
          label.Height
        );
        tl.X = Math.min(tl.X, labelTL.X);
        tl.Y = Math.min(tl.Y, labelTL.Y);
        br.X = Math.max(br.X, labelTL.X + label.Width);
        br.Y = Math.max(br.Y, labelTL.Y + label.Height);
      }
    }

    tl.X = goRound(tl.X);
    tl.Y = goRound(tl.Y);
    br.X = goRound(br.X);
    br.Y = goRound(br.Y);

    return [tl, br];
  }

  BoundingBoxValues() {
    return this.boundingBoxValues();
  }

  bounds() {
    const [tl, br] = this.boundingBoxValues();
    return [tl, br];
  }

  BoundingBox() {
    return this.bounds();
  }
}
