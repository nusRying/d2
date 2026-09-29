import { Point } from './point.js';

// A N-Dimensional Vector with components (x, y, z, ...) based on the origin
export class Vector {
  constructor(...components) {
    this.components = components;
  }

  // Getters for specific dimensions if needed, though Go uses indexing a[0], a[1]
  get 0() { return this.components[0]; }
  get 1() { return this.components[1]; }

  get lengthProperty() { return this.components.length; }

  // New Vector from components is the constructor.

  static fromProperties(length, angleInRadians) {
    return new Vector(
      length * Math.sin(angleInRadians),
      length * Math.cos(angleInRadians)
    );
  }

  addLength(length) {
    return this.unit().multiply(this.length() + length);
  }

  add(b) {
    const c = [];
    for (let i = 0; i < this.components.length; i++) {
      c.push(this.components[i] + b.components[i]);
    }
    return new Vector(...c);
  }

  minus(b) {
    const c = [];
    for (let i = 0; i < this.components.length; i++) {
      c.push(this.components[i] - b.components[i]);
    }
    return new Vector(...c);
  }

  multiply(v) {
    const c = [];
    for (let i = 0; i < this.components.length; i++) {
      c.push(this.components[i] * v);
    }
    return new Vector(...c);
  }

  length() {
    let sum = 0.0;
    for (const comp of this.components) {
      sum += comp * comp;
    }
    return Math.sqrt(sum);
  }

  unit() {
    return this.multiply(1 / this.length());
  }

  toPoint() {
    return new Point(this.components[0], this.components[1]);
  }

  radians() {
    // Go explicitly converts the result through float32(...)
    return Math.fround(Math.atan2(this.components[1], this.components[0]));
  }

  degrees() {
    return this.radians() * 180 / Math.PI;
  }

  reverse() {
    return this.multiply(-1);
  }
}
