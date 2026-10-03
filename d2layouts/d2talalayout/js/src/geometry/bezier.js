import { Point } from './point.js';

// Pinned Go: lib/geo/bezier.go (newBezierCurveImpl, bezierCurveImpl.pointAt,
// NewBezierCurve, BezierCurve.At). Only point evaluation is ported; the
// line-intersection helpers are not needed by TALA's shape ports.

function newBezierCurveImpl(points) {
  if (points.length === 0) {
    return null;
  }
  const c = points.map((p) => ({
    Point: { X: p.X, Y: p.Y },
    Control: { X: 0, Y: 0 },
  }));

  let w = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    switch (i) {
      case 0:
        w = 1;
        break;
      case 1:
        w = c.length - 1;
        break;
      default:
        w *= (c.length - i) / i;
    }
    c[i].Control.X = p.Point.X * w;
    c[i].Control.Y = p.Point.Y * w;
  }
  return c;
}

function pointAt(c, t) {
  c[0].Point = { X: c[0].Control.X, Y: c[0].Control.Y };
  let u = t;
  for (let i = 0; i < c.length - 1; i++) {
    const p = c[i + 1];
    c[i + 1].Point = {
      X: p.Control.X * u,
      Y: p.Control.Y * u,
    };
    u *= t;
  }

  const t1 = 1 - t;
  let tt = t1;
  const p = { X: c[c.length - 1].Point.X, Y: c[c.length - 1].Point.Y };
  for (let i = c.length - 2; i >= 0; i--) {
    p.X += c[i].Point.X * tt;
    p.Y += c[i].Point.Y * tt;
    tt *= t1;
  }
  return p;
}

/**
 * BezierCurve mirrors Go geo.BezierCurve point evaluation.
 */
export class BezierCurve {
  constructor(points) {
    this.curve = newBezierCurveImpl(points);
    this.points = points;
  }

  /** At returns the point at t along the curve, where 0 <= t <= 1. */
  at(t) {
    const curvePoint = pointAt(this.curve, t);
    return new Point(curvePoint.X, curvePoint.Y);
  }

  At(t) {
    return this.at(t);
  }
}

export function newBezierCurve(points) {
  return new BezierCurve(points);
}

export const NewBezierCurve = newBezierCurve;
