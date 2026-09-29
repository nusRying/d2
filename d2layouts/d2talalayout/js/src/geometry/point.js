import { Orientation } from './orientation.js';
import { sign, truncateDecimals, goRound } from './math.js';
import { Vector } from './vector.js';

export class Point {
  constructor(X, Y) {
    this.X = X;
    this.Y = Y;
  }

  equals(other) {
    if (!this) return !other;
    if (!other) return false;
    // Object.is correctly handles +0 and -0 differences if they ever matter, 
    // but standard == parity dictates using strict equality unless it explicitly needs IEEE exactly
    // Go's == treats -0.0 and 0.0 as equal. So we use `===`.
    return this.X === other.X && this.Y === other.Y;
  }

  compare(other) {
    const xCompare = sign(this.X - other.X);
    if (xCompare === 0) {
      return sign(this.Y - other.Y);
    }
    return xCompare;
  }

  copy() {
    return new Point(this.X, this.Y);
  }

  getOrientation(pTo) {
    if (this.Y < pTo.Y) {
      if (this.X < pTo.X) return Orientation.TopLeft;
      if (this.X > pTo.X) return Orientation.TopRight;
      return Orientation.Top;
    }
    if (this.Y > pTo.Y) {
      if (this.X < pTo.X) return Orientation.BottomLeft;
      if (this.X > pTo.X) return Orientation.BottomRight;
      return Orientation.Bottom;
    }
    if (this.X < pTo.X) return Orientation.Left;
    if (this.X > pTo.X) return Orientation.Right;
    return Orientation.NONE;
  }

  distanceToLine(p1, p2) {
    const a = this.X - p1.X;
    const b = this.Y - p1.Y;
    const c = p2.X - p1.X;
    const d = p2.Y - p1.Y;

    const dot = (a * c) + (b * d);
    const lenSq = (c * c) + (d * d);

    let param = -1.0;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;

    if (param < 0.0) {
      xx = p1.X;
      yy = p1.Y;
    } else if (param > 1.0) {
      xx = p2.X;
      yy = p2.Y;
    } else {
      xx = p1.X + (param * c);
      yy = p1.Y + (param * d);
    }

    const dx = this.X - xx;
    const dy = this.Y - yy;

    return Math.sqrt((dx * dx) + (dy * dy));
  }

  addVector(v) {
    return this.toVector().add(v).toPoint();
  }

  vectorTo(endpoint) {
    return endpoint.toVector().minus(this.toVector());
  }

  onOrthogonalSegment(a, b) {
    if (a.X < b.X) {
      if (this.X < a.X || b.X < this.X) return false;
    } else if (this.X < b.X || a.X < this.X) {
      return false;
    }
    if (a.Y < b.Y) {
      if (this.Y < a.Y || b.Y < this.Y) return false;
    } else if (this.Y < b.Y || a.Y < this.Y) {
      return false;
    }
    return true;
  }

  toVector() {
    return new Vector(this.X, this.Y);
  }

  transpose() {
    const temp = this.X;
    this.X = this.Y;
    this.Y = temp;
  }

  interpolate(b, t) {
    return new Point(
      this.X * (1.0 - t) + b.X * t,
      this.Y * (1.0 - t) + b.Y * t
    );
  }

  truncateFloat32() {
    this.X = Math.fround(this.X);
    this.Y = Math.fround(this.Y);
  }

  truncateDecimals() {
    this.X = truncateDecimals(this.X);
    this.Y = truncateDecimals(this.Y);
  }
}

export function intersectionPoint(u0, u1, v0, v1) {
  const udx = u1.X - u0.X;
  const vdx = v1.X - v0.X;
  const uvdx = v0.X - u0.X;
  const udy = u1.Y - u0.Y;
  const vdy = v1.Y - v0.Y;
  const uvdy = v0.Y - u0.Y;

  // In Go: denom := (udy*vdx - udx*vdy)
  // if denom == 0 return nil
  const denom = (udy * vdx - udx * vdy);
  // Ensure we check strict numerical zero (NaN, Infinity, 0 behave accordingly).
  // For exact parity with Go:
  if (denom === 0) {
    return null;
  }

  const s = (vdx * uvdy - vdy * uvdx) / denom;
  const t = (udx * uvdy - udy * uvdx) / denom;

  if (s < 0 || s > 1 || t < 0 || t > 1) {
    return null;
  }

  const intersection = new Point(0, 0);
  intersection.X = u0.X + goRound(s * udx);
  intersection.Y = u0.Y + goRound(s * udy);
  
  // Need to make sure -0 is represented just as Go would if needed, but in JS 
  // -0 is fine and we'll check it in test. goRound handles -0.

  return intersection;
}

export function getMedianPoint(ps) {
  if (!ps || ps.length === 0) return new Point(0, 0); // Unspecified by Go but safe
  
  const xs = [];
  const ys = [];

  for (const p of ps) {
    xs.push(p.X);
    ys.push(p.Y);
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  const middleIndex = Math.floor(xs.length / 2);

  let medianX = xs[middleIndex];
  let medianY = ys[middleIndex];

  if (xs.length % 2 === 0) {
    medianX += xs[middleIndex - 1];
    medianX /= 2;
    medianY += ys[middleIndex - 1];
    medianY /= 2;
  }

  return new Point(medianX, medianY);
}
