// Slice 47 — candidate routes through the orthogonal visibility graph.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/route.go
//
// Go's OVGNode embeds *geo.Point, so `node.X` is `node.Point.X`; this port
// always reads through `.Point` (a nil Point throws, as Go panics).
// FromPort/ToPort are geo.Point values: they are compared by coordinates.

import { isDiagonal, isHorizontal, isVertical } from '../geometry/orientation.js';

// ovg_edge.go nonNilEquals: non-nil points with equal coordinates.
function nonNilEquals(p1, p2) {
  return p1 != null && p2 != null && p1.X === p2.X && p1.Y === p2.Y;
}

function pointValueEquals(a, b) {
  return a.X === b.X && a.Y === b.Y;
}

export class Route {
  constructor({ GEdge = null, OVGNodes = null, FromPort = null, ToPort = null } = {}) {
    this.GEdge = GEdge;
    this.OVGNodes = OVGNodes;
    // Go zero values: geo.Point{} for the value-typed ports.
    this.FromPort = FromPort ?? { X: 0, Y: 0 };
    this.ToPort = ToPort ?? { X: 0, Y: 0 };
  }

  createSegmentEndpoints() {
    const nodes = this.OVGNodes;
    const points = [];
    points.push(nodes[1].Point.Copy());
    for (let i = 2; i < nodes.length - 2; i++) {
      const lastPoint = nodes[i - 1].Point;
      const currentPoint = nodes[i].Point;
      const nextPoint = nodes[i + 1].Point;
      if ((currentPoint.X === lastPoint.X) && (currentPoint.X !== nextPoint.X)) {
        points.push(currentPoint.Copy());
      } else if ((currentPoint.Y === lastPoint.Y) && (currentPoint.Y !== nextPoint.Y)) {
        points.push(currentPoint.Copy());
      }
    }
    points.push(nodes[nodes.length - 2].Point.Copy());
    return points;
  }

  /** isEntireColinear: the entire route lies on the segment <from, to>. */
  isEntireColinear(from, to) {
    const nodes = this.OVGNodes ?? [];
    if (from.Point.Y === to.Point.Y) {
      const y = from.Point.Y;
      let minX = from.Point.X;
      let maxX = to.Point.X;
      if (maxX < minX) {
        [minX, maxX] = [maxX, minX];
      }
      for (let i = 1; i < nodes.length - 2; i++) {
        const rFrom = nodes[i];
        const rTo = nodes[i + 1];
        if (rFrom.Point.Y !== y || rTo.Point.Y !== y) {
          return false;
        }
        let rMinX = rFrom.Point.X;
        let rMaxX = rTo.Point.X;
        if (rMaxX < rMinX) {
          [rMinX, rMaxX] = [rMaxX, rMinX];
        }
        if (rMinX < minX || rMaxX > maxX) {
          return false;
        }
      }
      return true;
    }

    if (from.Point.X === to.Point.X) {
      const x = from.Point.X;
      let minY = from.Point.Y;
      let maxY = to.Point.Y;
      if (maxY < minY) {
        [minY, maxY] = [maxY, minY];
      }
      for (let i = 1; i < nodes.length - 2; i++) {
        const rFrom = nodes[i];
        const rTo = nodes[i + 1];
        if (rFrom.Point.X !== x || rTo.Point.X !== x) {
          return false;
        }
        let rMinY = rFrom.Point.Y;
        let rMaxY = rTo.Point.Y;
        if (rMaxY < rMinY) {
          [rMinY, rMaxY] = [rMaxY, rMinY];
        }
        if (rMinY < minY || rMaxY > maxY) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * isOpposingColinear reports whether <from, to> spans colinearly in the
   * opposite direction to any segment of a directed route. Sharing a single
   * endpoint does not count.
   */
  isOpposingColinear(from, to) {
    if (!this.GEdge.IsDirected()) {
      return false;
    }
    const nodes = this.OVGNodes ?? [];
    if (from.Point.Y === to.Point.Y) {
      const y = from.Point.Y;
      let minX = from.Point.X;
      let maxX = to.Point.X;
      if (maxX < minX) {
        [minX, maxX] = [maxX, minX];
      }
      for (let i = 0; i < nodes.length - 2; i++) {
        if (nodes[i + 1].Point.Y !== y) {
          i++;
          continue;
        }
        if (nodes[i].Point.Y !== y) {
          continue;
        }
        const rFrom = nodes[i];
        const rTo = nodes[i + 1];
        if (rTo.Point.X !== rFrom.Point.X) {
          if (rFrom.Point.X < rTo.Point.X) {
            if (maxX < rFrom.Point.X || rTo.Point.X < minX) {
              continue;
            }
          } else if (maxX < rTo.Point.X || rFrom.Point.X < minX) {
            continue;
          }

          let rMinX = rFrom.Point.X;
          let rMaxX = rTo.Point.X;
          if (rMaxX < rMinX) {
            [rMinX, rMaxX] = [rMaxX, rMinX];
          }

          if (rMinX <= from.Point.X && from.Point.X <= rMaxX && (to.Point.X < rMinX || rMaxX < to.Point.X)) {
            if (nonNilEquals(from.Point, rFrom.Point) || nonNilEquals(from.Point, rTo.Point)) {
              return false;
            }
          } else if (rMinX <= to.Point.X && to.Point.X <= rMaxX && (from.Point.X < rMinX || rMaxX < from.Point.X)) {
            if (nonNilEquals(to.Point, rFrom.Point) || nonNilEquals(to.Point, rTo.Point)) {
              return false;
            }
          }

          if ((rTo.Point.X > rFrom.Point.X) && (to.Point.X < from.Point.X)) {
            return true;
          } else if ((rTo.Point.X < rFrom.Point.X) && (to.Point.X > from.Point.X)) {
            return true;
          }
        }
      }
    } else if (from.Point.X === to.Point.X) {
      const x = from.Point.X;
      let minY = from.Point.Y;
      let maxY = to.Point.Y;
      if (maxY < minY) {
        [minY, maxY] = [maxY, minY];
      }
      for (let i = 0; i < nodes.length - 2; i++) {
        if (nodes[i + 1].Point.X !== x) {
          i++;
          continue;
        }
        if (nodes[i].Point.X !== x) {
          continue;
        }
        const rFrom = nodes[i];
        const rTo = nodes[i + 1];

        if (rTo.Point.Y !== rFrom.Point.Y) {
          if (rFrom.Point.Y < rTo.Point.Y) {
            if (maxY < rFrom.Point.Y || rTo.Point.Y < minY) {
              continue;
            }
          } else if (maxY < rTo.Point.Y || rFrom.Point.Y < minY) {
            continue;
          }

          let rMinY = rFrom.Point.Y;
          let rMaxY = rTo.Point.Y;
          if (rMaxY < rMinY) {
            [rMinY, rMaxY] = [rMaxY, rMinY];
          }

          if (rMinY <= from.Point.Y && from.Point.Y <= rMaxY && (to.Point.Y < rMinY || rMaxY < to.Point.Y)) {
            if (nonNilEquals(from.Point, rFrom.Point) || nonNilEquals(from.Point, rTo.Point)) {
              return false;
            }
          } else if (rMinY <= to.Point.Y && to.Point.Y <= rMaxY && (from.Point.Y < rMinY || rMaxY < from.Point.Y)) {
            if (nonNilEquals(to.Point, rFrom.Point) || nonNilEquals(to.Point, rTo.Point)) {
              return false;
            }
          }

          if ((rTo.Point.Y > rFrom.Point.Y) && (to.Point.Y < from.Point.Y)) {
            return true;
          } else if ((rTo.Point.Y < rFrom.Point.Y) && (to.Point.Y > from.Point.Y)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * canSwapEdgesGuarded: same endpoints, not a self-route, not diagonal,
   * same-side ports for parallel routes, and no third route on any port.
   * Returns a boolean; guard failures throw.
   */
  canSwapEdgesGuarded(r2, allRoutes, guard) {
    const r = this;
    if (r.GEdge.From === r.GEdge.To) {
      return false;
    }
    if (r2.GEdge.From === r2.GEdge.To) {
      return false;
    }
    if (!((r.GEdge.From === r2.GEdge.From && r.GEdge.To === r2.GEdge.To) ||
      (r.GEdge.From === r2.GEdge.To && r.GEdge.To === r2.GEdge.From))) {
      return false;
    }

    if (isDiagonal(r.GEdge.From.Orientation(r.GEdge.To))) {
      return false;
    }

    if (r.GEdge.From === r2.GEdge.From && r.GEdge.To === r2.GEdge.To) {
      if (isVertical(r.GEdge.From.Orientation(r.GEdge.To))) {
        if (r.FromPort.Y !== r2.FromPort.Y) {
          return false;
        }
        if (r.ToPort.Y !== r2.ToPort.Y) {
          return false;
        }
      }
      if (isHorizontal(r.GEdge.From.Orientation(r.GEdge.To))) {
        if (r.FromPort.X !== r2.FromPort.X) {
          return false;
        }
        if (r.ToPort.X !== r2.ToPort.X) {
          return false;
        }
      }
    }

    for (const r3 of allRoutes ?? []) {
      if (guard != null) {
        guard.step();
      }
      if (r === r3 || r2 === r3) {
        continue;
      }
      if (pointValueEquals(r.FromPort, r3.FromPort) || pointValueEquals(r.FromPort, r3.ToPort)) {
        return false;
      }
      if (pointValueEquals(r.ToPort, r3.FromPort) || pointValueEquals(r.ToPort, r3.ToPort)) {
        return false;
      }
      if (pointValueEquals(r2.FromPort, r3.FromPort) || pointValueEquals(r2.FromPort, r3.ToPort)) {
        return false;
      }
      if (pointValueEquals(r2.ToPort, r3.FromPort) || pointValueEquals(r2.ToPort, r3.ToPort)) {
        return false;
      }
    }

    return true;
  }
}
