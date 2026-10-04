import { intersectionPoint } from './point.js';
import { euclideanDistance } from './math.js';
import { Vector } from './vector.js';

export class Segment {
  constructor(start, end) {
    this.Start = start;
    this.End = end;
  }

  overlaps(otherS, isHorizontal, buffer) {
    if (isHorizontal) {
      if (Math.min(this.Start.Y, this.End.Y) - Math.max(otherS.Start.Y, otherS.End.Y) >= buffer) {
        return false;
      }
      if (Math.min(otherS.Start.Y, otherS.End.Y) - Math.max(this.Start.Y, this.End.Y) >= buffer) {
        return false;
      }
      return true;
    } else {
      if (Math.min(this.Start.X, this.End.X) - Math.max(otherS.Start.X, otherS.End.X) >= buffer) {
        return false;
      }
      if (Math.min(otherS.Start.X, otherS.End.X) - Math.max(this.Start.X, this.End.X) >= buffer) {
        return false;
      }
      return true;
    }
  }

  intersects(otherSegment) {
    return intersectionPoint(this.Start, this.End, otherSegment.Start, otherSegment.End) !== null;
  }

  intersections(otherSegment) {
    const point = intersectionPoint(this.Start, this.End, otherSegment.Start, otherSegment.End);
    if (point === null) {
      return null;
    }
    return [point];
  }

  getBounds(segments, buffer) {
    let ceil = Infinity;
    let floor = -Infinity;

    if (this.Start.X === this.End.X && this.Start.Y === this.End.Y) {
      return [floor, ceil];
    }

    const isHorizontal = this.Start.X === this.End.X;

    for (const otherSegment of segments) {
      if (isHorizontal) {
        if (otherSegment.End.Y < this.Start.Y - buffer) {
          continue;
        }
        if (otherSegment.Start.Y > this.End.Y + buffer) {
          continue;
        }
        if (otherSegment.Start.X <= this.Start.X) {
          floor = Math.max(floor, otherSegment.Start.X);
        }
        if (otherSegment.Start.X > this.Start.X) {
          ceil = Math.min(ceil, otherSegment.Start.X);
        }
      } else {
        if (otherSegment.End.X < this.Start.X - buffer) {
          continue;
        }
        if (otherSegment.Start.X > this.End.X + buffer) {
          continue;
        }
        if (otherSegment.Start.Y <= this.Start.Y) {
          floor = Math.max(floor, otherSegment.Start.Y);
        }
        if (otherSegment.Start.Y > this.Start.Y) {
          ceil = Math.min(ceil, otherSegment.Start.Y);
        }
      }
    }
    return [floor, ceil];
  }

  length() {
    return euclideanDistance(this.Start.X, this.Start.Y, this.End.X, this.End.Y);
  }

  toVector() {
    return new Vector(this.End.X - this.Start.X, this.End.Y - this.Start.Y);
  }
}
