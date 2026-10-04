export const Orientation = {
  TopLeft: 0,
  TopRight: 1,
  BottomLeft: 2,
  BottomRight: 3,
  Top: 4,
  Right: 5,
  Bottom: 6,
  Left: 7,
  None: 8,
  NONE: 8,
  isDiagonal,
  isHorizontal,
  isVertical,
  getOpposite,
};

export function orientationToString(o) {
  switch (o) {
    case Orientation.TopLeft:
      return 'TopLeft';
    case Orientation.TopRight:
      return 'TopRight';
    case Orientation.BottomLeft:
      return 'BottomLeft';
    case Orientation.BottomRight:
      return 'BottomRight';
    case Orientation.Top:
      return 'Top';
    case Orientation.Right:
      return 'Right';
    case Orientation.Bottom:
      return 'Bottom';
    case Orientation.Left:
      return 'Left';
    default:
      return '';
  }
}

export function sameSide(o1, o2) {
  const sides = [
    [Orientation.TopLeft, Orientation.Top, Orientation.TopRight],
    [Orientation.BottomLeft, Orientation.Bottom, Orientation.BottomRight],
    [Orientation.Left, Orientation.TopLeft, Orientation.BottomLeft],
    [Orientation.Right, Orientation.TopRight, Orientation.BottomRight],
  ];
  for (const sameSides of sides) {
    let isO1 = false;
    for (const side of sameSides) {
      if (side === o1) {
        isO1 = true;
        break;
      }
    }
    if (isO1) {
      for (const side of sameSides) {
        if (side === o2) {
          return true;
        }
      }
    }
  }
  return false;
}

export function isDiagonal(o) {
  return o === Orientation.TopLeft || o === Orientation.TopRight || o === Orientation.BottomLeft || o === Orientation.BottomRight;
}

export function isHorizontal(o) {
  return o === Orientation.Left || o === Orientation.Right;
}

export function isVertical(o) {
  return o === Orientation.Top || o === Orientation.Bottom;
}

export function getOpposite(o) {
  switch (o) {
    case Orientation.TopLeft:
      return Orientation.BottomRight;
    case Orientation.TopRight:
      return Orientation.BottomLeft;
    case Orientation.BottomLeft:
      return Orientation.TopRight;
    case Orientation.BottomRight:
      return Orientation.TopLeft;
    case Orientation.Top:
      return Orientation.Bottom;
    case Orientation.Bottom:
      return Orientation.Top;
    case Orientation.Right:
      return Orientation.Left;
    case Orientation.Left:
      return Orientation.Right;
    default:
      return o;
  }
}
