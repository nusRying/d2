export class Label {
  constructor(text = "", width = 0, height = 0) {
    this.Text = text;
    this.Width = width;
    this.Height = height;
    this.Position = null;
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
