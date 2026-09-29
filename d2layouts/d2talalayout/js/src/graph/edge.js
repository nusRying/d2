import { Point } from '../geometry/point.js';

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

    this.SourceArrowhead = 0;
    this.TargetArrowhead = 0;
    this.SourceArrowheadLabel = null;
    this.TargetArrowheadLabel = null;
    
    this.Label = null;
    this.LabelPercentage = 0;
    
    this.FromTableColumnIndex = null;
    this.ToTableColumnIndex = null;
    this.IsInvisible = false;
    this.Style = null;
  }

  isLoop() {
    return this.From === this.To;
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
