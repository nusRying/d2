import { Point, intersectionPoint } from './point.js';

export class Box {
  constructor(topLeft, width, height) {
    this.TopLeft = topLeft;
    this.Width = width;
    this.Height = height;
  }

  copy() {
    if (!this.TopLeft) {
      return new Box(null, this.Width, this.Height); // Though Go expects TopLeft != nil mostly.
    }
    return new Box(this.TopLeft.copy(), this.Width, this.Height);
  }

  center() {
    return new Point(this.TopLeft.X + this.Width / 2, this.TopLeft.Y + this.Height / 2);
  }

  intersects(s, buffer) {
    const tl = new Point(this.TopLeft.X - buffer, this.TopLeft.Y - buffer);
    const tr = new Point(tl.X + this.Width + buffer * 2, tl.Y);
    const br = new Point(tr.X, tr.Y + this.Height + buffer * 2);
    const bl = new Point(tl.X, br.Y);

    if (intersectionPoint(s.Start, s.End, tl, tr) !== null) return true;
    if (intersectionPoint(s.Start, s.End, tr, br) !== null) return true;
    if (intersectionPoint(s.Start, s.End, br, bl) !== null) return true;
    if (intersectionPoint(s.Start, s.End, bl, tl) !== null) return true;
    return false;
  }

  intersections(s) {
    const pts = [];

    const tl = this.TopLeft;
    const tr = new Point(tl.X + this.Width, tl.Y);
    const br = new Point(tr.X, tr.Y + this.Height);
    const bl = new Point(tl.X, br.Y);

    let p = intersectionPoint(s.Start, s.End, tl, tr);
    if (p !== null) pts.push(p);

    p = intersectionPoint(s.Start, s.End, tr, br);
    if (p !== null) pts.push(p);

    p = intersectionPoint(s.Start, s.End, br, bl);
    if (p !== null) pts.push(p);

    p = intersectionPoint(s.Start, s.End, bl, tl);
    if (p !== null) pts.push(p);

    return pts;
  }

  contains(p) {
    return !(
      p.X < this.TopLeft.X ||
      this.TopLeft.X + this.Width < p.X ||
      p.Y < this.TopLeft.Y ||
      this.TopLeft.Y + this.Height < p.Y
    );
  }

  overlaps(b2) {
    return (
      (this.TopLeft.X < (b2.TopLeft.X + b2.Width)) &&
      ((this.TopLeft.X + this.Width) > b2.TopLeft.X) &&
      (this.TopLeft.Y < (b2.TopLeft.Y + b2.Height)) &&
      ((this.TopLeft.Y + this.Height) > b2.TopLeft.Y)
    );
  }
}
