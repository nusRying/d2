
// NoArrowhead is the sentinel value matching Go's NoArrowhead constant ("none").
export const NO_ARROWHEAD = "none";


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
}
