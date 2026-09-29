import { Orientation } from '../geometry/orientation.js';

// Matches Go's layoutgraph.HerdAssignment
export class HerdAssignment {
  constructor() {
    this.oppositeSidePaired = new Set();
    this.sameSidePaired = new Set();
    this.Orientation = Orientation.TopLeft;
    this.Val = 0;
  }

  pairSameSide(node) {
    if (node != null) {
      this.sameSidePaired.add(node);
    }
  }

  PairSameSide(node) {
    this.pairSameSide(node);
  }

  pairOppositeSide(node) {
    if (node != null) {
      this.oppositeSidePaired.add(node);
    }
  }

  PairOppositeSide(node) {
    this.pairOppositeSide(node);
  }

  sameSidePairCount() {
    return this.sameSidePaired.size;
  }

  SameSidePairCount() {
    return this.sameSidePairCount();
  }

  oppositeSidePairCount() {
    return this.oppositeSidePaired.size;
  }

  OppositeSidePairCount() {
    return this.oppositeSidePairCount();
  }

  copy() {
    const cloned = new HerdAssignment();
    cloned.Orientation = this.Orientation;
    cloned.Val = this.Val;
    for (const node of this.oppositeSidePaired) {
      cloned.oppositeSidePaired.add(node);
    }
    for (const node of this.sameSidePaired) {
      cloned.sameSidePaired.add(node);
    }
    return cloned;
  }

  Copy() {
    return this.copy();
  }
}
