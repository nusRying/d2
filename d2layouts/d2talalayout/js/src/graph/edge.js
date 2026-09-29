import { Point } from '../geometry/point.js';

export class Edge {
  constructor(from, to) {
    this.ID = 0n;
    this.D2ID = null;

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

  reconnect(from, to) {
    if (this.From) this.From.removeEdge(this);
    if (this.To && !this.isLoop()) this.To.removeEdge(this);

    this.From = from;
    this.To = to;

    if (this.From) this.From.addEdge(this);
    if (this.To && !this.isLoop()) this.To.addEdge(this);
  }
}
