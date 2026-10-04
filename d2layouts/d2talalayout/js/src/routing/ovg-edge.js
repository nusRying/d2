// Slice 47 — OVG edges.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_edge.go
//
// Go uses OVGEdge both by pointer (graph edges) and by value (ovgEdgeSet
// entries, sharePoints arguments). JS edges are objects; value copies are made
// explicitly with copy() where Go copies the struct.

export class OVGEdge {
  constructor(from = null, to = null, distance = 0) {
    this.From = from;
    this.To = to;
    this.Distance = distance;
  }

  /** Struct copy (Go value semantics). */
  copy() {
    return new OVGEdge(this.From, this.To, this.Distance);
  }

  isVertical() {
    return this.From.X === this.To.X;
  }

  isHorizontal() {
    return this.From.Y === this.To.Y;
  }

  sharePoints(other) {
    return nonNilEquals(this.From.Point, other.From.Point) ||
      nonNilEquals(this.From.Point, other.To.Point) ||
      nonNilEquals(this.To.Point, other.From.Point) ||
      nonNilEquals(this.To.Point, other.To.Point);
  }
}

export function NewOVGEdge(from, to) {
  return new OVGEdge(from, to);
}

/** geo.Point equality without the nil check. */
export function nonNilEquals(p1, p2) {
  return p1.X === p2.X && p1.Y === p2.Y;
}
