export const LABEL_PADDING = 5;

export const LabelPosition = Object.freeze({
  Unset: 0,

  OutsideTopLeft: 1,
  OutsideTopCenter: 2,
  OutsideTopRight: 3,

  OutsideLeftTop: 4,
  OutsideLeftMiddle: 5,
  OutsideLeftBottom: 6,

  OutsideRightTop: 7,
  OutsideRightMiddle: 8,
  OutsideRightBottom: 9,

  OutsideBottomLeft: 10,
  OutsideBottomCenter: 11,
  OutsideBottomRight: 12,

  InsideTopLeft: 13,
  InsideTopCenter: 14,
  InsideTopRight: 15,

  InsideMiddleLeft: 16,
  InsideMiddleCenter: 17,
  InsideMiddleRight: 18,

  InsideBottomLeft: 19,
  InsideBottomCenter: 20,
  InsideBottomRight: 21,

  BorderTopLeft: 22,
  BorderTopCenter: 23,
  BorderTopRight: 24,

  BorderLeftTop: 25,
  BorderLeftMiddle: 26,
  BorderLeftBottom: 27,

  BorderRightTop: 28,
  BorderRightMiddle: 29,
  BorderRightBottom: 30,

  BorderBottomLeft: 31,
  BorderBottomCenter: 32,
  BorderBottomRight: 33,

  UnlockedTop: 34,
  UnlockedMiddle: 35,
  UnlockedBottom: 36,
});

const stringToPosition = Object.freeze({
  OUTSIDE_TOP_LEFT: LabelPosition.OutsideTopLeft,
  OUTSIDE_TOP_CENTER: LabelPosition.OutsideTopCenter,
  OUTSIDE_TOP_RIGHT: LabelPosition.OutsideTopRight,

  OUTSIDE_LEFT_TOP: LabelPosition.OutsideLeftTop,
  OUTSIDE_LEFT_MIDDLE: LabelPosition.OutsideLeftMiddle,
  OUTSIDE_LEFT_BOTTOM: LabelPosition.OutsideLeftBottom,

  OUTSIDE_RIGHT_TOP: LabelPosition.OutsideRightTop,
  OUTSIDE_RIGHT_MIDDLE: LabelPosition.OutsideRightMiddle,
  OUTSIDE_RIGHT_BOTTOM: LabelPosition.OutsideRightBottom,

  OUTSIDE_BOTTOM_LEFT: LabelPosition.OutsideBottomLeft,
  OUTSIDE_BOTTOM_CENTER: LabelPosition.OutsideBottomCenter,
  OUTSIDE_BOTTOM_RIGHT: LabelPosition.OutsideBottomRight,

  INSIDE_TOP_LEFT: LabelPosition.InsideTopLeft,
  INSIDE_TOP_CENTER: LabelPosition.InsideTopCenter,
  INSIDE_TOP_RIGHT: LabelPosition.InsideTopRight,

  INSIDE_MIDDLE_LEFT: LabelPosition.InsideMiddleLeft,
  INSIDE_MIDDLE_CENTER: LabelPosition.InsideMiddleCenter,
  INSIDE_MIDDLE_RIGHT: LabelPosition.InsideMiddleRight,

  INSIDE_BOTTOM_LEFT: LabelPosition.InsideBottomLeft,
  INSIDE_BOTTOM_CENTER: LabelPosition.InsideBottomCenter,
  INSIDE_BOTTOM_RIGHT: LabelPosition.InsideBottomRight,

  BORDER_TOP_LEFT: LabelPosition.BorderTopLeft,
  BORDER_TOP_CENTER: LabelPosition.BorderTopCenter,
  BORDER_TOP_RIGHT: LabelPosition.BorderTopRight,

  BORDER_LEFT_TOP: LabelPosition.BorderLeftTop,
  BORDER_LEFT_MIDDLE: LabelPosition.BorderLeftMiddle,
  BORDER_LEFT_BOTTOM: LabelPosition.BorderLeftBottom,

  BORDER_RIGHT_TOP: LabelPosition.BorderRightTop,
  BORDER_RIGHT_MIDDLE: LabelPosition.BorderRightMiddle,
  BORDER_RIGHT_BOTTOM: LabelPosition.BorderRightBottom,

  BORDER_BOTTOM_LEFT: LabelPosition.BorderBottomLeft,
  BORDER_BOTTOM_CENTER: LabelPosition.BorderBottomCenter,
  BORDER_BOTTOM_RIGHT: LabelPosition.BorderBottomRight,

  UNLOCKED_TOP: LabelPosition.UnlockedTop,
  UNLOCKED_MIDDLE: LabelPosition.UnlockedMiddle,
  UNLOCKED_BOTTOM: LabelPosition.UnlockedBottom,
});

export function normalizeLabelPosition(pos) {
  if (pos === null || pos === undefined) {
    return LabelPosition.Unset;
  }
  if (typeof pos === "number") {
    return pos;
  }
  if (typeof pos === "string") {
    const key = pos.toUpperCase();
    return stringToPosition[key] ?? LabelPosition.Unset;
  }
  if (typeof pos === "object") {
    if (typeof pos.Position === "number" || typeof pos.Position === "string") {
      return normalizeLabelPosition(pos.Position);
    }
  }
  return LabelPosition.Unset;
}

export function isOutsideLabelPosition(pos) {
  if (pos === null || pos === undefined) {
    return false;
  }
  if (typeof pos === "object" && typeof pos.IsOutside === "function") {
    return pos.IsOutside();
  }
  if (typeof pos === "number") {
    return pos >= LabelPosition.OutsideTopLeft && pos <= LabelPosition.OutsideBottomRight;
  }
  if (typeof pos === "string") {
    return pos.toUpperCase().startsWith("OUTSIDE_");
  }
  return false;
}

export function getPointOnBox(position, box, padding, width, height) {
  const p = box.TopLeft.copy();
  const boxCenter = box.center();
  const pos = normalizeLabelPosition(position);

  switch (pos) {
    case LabelPosition.OutsideTopLeft:
      p.X -= padding;
      p.Y -= padding + height;
      break;
    case LabelPosition.OutsideTopCenter:
      p.X = boxCenter.X - width / 2;
      p.Y -= padding + height;
      break;
    case LabelPosition.OutsideTopRight:
      p.X += box.Width - width - padding;
      p.Y -= padding + height;
      break;

    case LabelPosition.OutsideLeftTop:
      p.X -= padding + width;
      p.Y += padding;
      break;
    case LabelPosition.OutsideLeftMiddle:
      p.X -= padding + width;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.OutsideLeftBottom:
      p.X -= padding + width;
      p.Y += box.Height - height - padding;
      break;

    case LabelPosition.OutsideRightTop:
      p.X += box.Width + padding;
      p.Y += padding;
      break;
    case LabelPosition.OutsideRightMiddle:
      p.X += box.Width + padding;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.OutsideRightBottom:
      p.X += box.Width + padding;
      p.Y += box.Height - height - padding;
      break;

    case LabelPosition.OutsideBottomLeft:
      p.X += padding;
      p.Y += box.Height + padding;
      break;
    case LabelPosition.OutsideBottomCenter:
      p.X = boxCenter.X - width / 2;
      p.Y += box.Height + padding;
      break;
    case LabelPosition.OutsideBottomRight:
      p.X += box.Width - width - padding;
      p.Y += box.Height + padding;
      break;

    case LabelPosition.InsideTopLeft:
      p.X += padding;
      p.Y += padding;
      break;
    case LabelPosition.InsideTopCenter:
      p.X = boxCenter.X - width / 2;
      p.Y += padding;
      break;
    case LabelPosition.InsideTopRight:
      p.X += box.Width - width - padding;
      p.Y += padding;
      break;

    case LabelPosition.InsideMiddleLeft:
      p.X += padding;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.InsideMiddleCenter:
      p.X = boxCenter.X - width / 2;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.InsideMiddleRight:
      p.X += box.Width - width - padding;
      p.Y = boxCenter.Y - height / 2;
      break;

    case LabelPosition.InsideBottomLeft:
      p.X += padding;
      p.Y += box.Height - height - padding;
      break;
    case LabelPosition.InsideBottomCenter:
      p.X = boxCenter.X - width / 2;
      p.Y += box.Height - height - padding;
      break;
    case LabelPosition.InsideBottomRight:
      p.X += box.Width - width - padding;
      p.Y += box.Height - height - padding;
      break;

    case LabelPosition.BorderTopLeft:
      p.X += padding;
      p.Y -= height / 2;
      break;
    case LabelPosition.BorderTopCenter:
      p.X = boxCenter.X - width / 2;
      p.Y -= height / 2;
      break;
    case LabelPosition.BorderTopRight:
      p.X += box.Width - width - padding;
      p.Y -= height / 2;
      break;

    case LabelPosition.BorderLeftTop:
      p.X -= width / 2;
      p.Y += padding;
      break;
    case LabelPosition.BorderLeftMiddle:
      p.X -= width / 2;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.BorderLeftBottom:
      p.X -= width / 2;
      p.Y += box.Height - height - padding;
      break;

    case LabelPosition.BorderRightTop:
      p.X += box.Width - width / 2;
      p.Y += padding;
      break;
    case LabelPosition.BorderRightMiddle:
      p.X += box.Width - width / 2;
      p.Y = boxCenter.Y - height / 2;
      break;
    case LabelPosition.BorderRightBottom:
      p.X += box.Width - width / 2;
      p.Y += box.Height - height - padding;
      break;

    case LabelPosition.BorderBottomLeft:
      p.X += padding;
      p.Y += box.Height - height / 2;
      break;
    case LabelPosition.BorderBottomCenter:
      p.X = boxCenter.X - width / 2;
      p.Y += box.Height - height / 2;
      break;
    case LabelPosition.BorderBottomRight:
      p.X += box.Width - width - padding;
      p.Y += box.Height - height / 2;
      break;

    default:
      // Unknown / Unset position leaves the point at box.TopLeft.copy()
      break;
  }

  return p;
}
