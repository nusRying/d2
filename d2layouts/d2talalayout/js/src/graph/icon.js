// Matches Go's layoutgraph.Icon
export class Icon {
  constructor(position = null) {
    this.Position = position;
    this._positionFixed = false;
  }

  positionFixed() {
    return this._positionFixed;
  }

  PositionFixed() {
    return this.positionFixed();
  }

  fixPosition() {
    this._positionFixed = true;
  }

  FixPosition() {
    this.fixPosition();
  }
}
