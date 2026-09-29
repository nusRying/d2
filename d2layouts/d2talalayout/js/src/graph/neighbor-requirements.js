// Matches Go's layoutgraph.LongDistanceNeighborRequirements
export class LongDistanceNeighborRequirements {
  constructor(edgeCount = 0, maxWidth = 0, maxHeight = 0) {
    this.EdgeCount = edgeCount;
    this.MaxWidth = maxWidth;
    this.MaxHeight = maxHeight;
  }

  copy() {
    return new LongDistanceNeighborRequirements(
      this.EdgeCount,
      this.MaxWidth,
      this.MaxHeight
    );
  }
}
