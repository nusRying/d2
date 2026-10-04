import { LabelPosition as P } from '../graph/label-position.js';

// Pinned Go: internal/nodeshape/shape.go (LabelTier) and each shape's
// LabelPositionPreferences, plus lib/shape IsRectangular. Shape types are the
// JS node._shapeType strings, which equal Go's lib/shape *_TYPE constants.
//
// Go returns map[label.Position]struct{}; iteration order of those maps is
// unspecified, so only membership is meaningful. JS returns a fresh Set.

/** LabelTier groups label positions by how suitable they are for a shape. */
export const LabelTier = Object.freeze({
  Good: 0,
  OK: 1,
  Unideal: 2,
  Bad: 3,
});

export const LABEL_TIERS = Object.freeze([LabelTier.Good, LabelTier.OK, LabelTier.Unideal, LabelTier.Bad]);

const SQUARE = [
  [P.OutsideTopCenter, P.InsideTopCenter, P.InsideMiddleCenter, P.InsideBottomCenter,
    P.OutsideBottomCenter, P.InsideTopLeft, P.InsideTopRight, P.InsideBottomLeft, P.InsideBottomRight],
  [P.InsideMiddleLeft, P.InsideMiddleRight, P.OutsideTopLeft, P.OutsideTopRight,
    P.OutsideBottomLeft, P.OutsideBottomRight],
  [P.OutsideLeftTop, P.OutsideRightTop, P.OutsideLeftMiddle, P.OutsideRightMiddle,
    P.OutsideLeftBottom, P.OutsideRightBottom],
  [],
];

const CALLOUT = [
  [P.InsideTopLeft, P.InsideTopCenter, P.InsideTopRight, P.InsideMiddleLeft, P.InsideMiddleCenter,
    P.InsideMiddleRight, P.InsideBottomLeft, P.InsideBottomCenter, P.InsideBottomRight],
  [P.OutsideTopLeft, P.OutsideTopCenter, P.OutsideTopRight, P.OutsideBottomCenter],
  [P.OutsideLeftTop, P.OutsideLeftMiddle, P.OutsideRightTop, P.OutsideRightMiddle],
  [P.OutsideLeftBottom, P.OutsideRightBottom, P.OutsideBottomLeft, P.OutsideBottomRight],
];

const CIRCLE = [
  [P.OutsideTopCenter, P.InsideMiddleCenter, P.OutsideBottomCenter],
  [P.InsideBottomCenter, P.InsideTopCenter, P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.InsideTopLeft, P.InsideTopRight, P.InsideBottomLeft, P.InsideBottomRight,
    P.OutsideLeftMiddle, P.OutsideRightMiddle],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideLeftTop, P.OutsideRightTop,
    P.OutsideBottomLeft, P.OutsideBottomRight, P.OutsideLeftBottom, P.OutsideRightBottom],
];

const CLOUD = [
  [P.InsideMiddleCenter, P.InsideBottomCenter, P.OutsideBottomCenter, P.InsideTopCenter],
  [P.OutsideTopCenter, P.OutsideBottomLeft, P.OutsideBottomRight, P.InsideTopLeft, P.InsideTopRight,
    P.InsideBottomLeft, P.InsideBottomRight, P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.OutsideLeftMiddle, P.OutsideRightMiddle, P.OutsideLeftBottom, P.OutsideRightBottom],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideLeftTop, P.OutsideRightTop],
];

const CYLINDER = [
  [P.OutsideTopCenter, P.InsideMiddleCenter, P.OutsideBottomCenter],
  [P.InsideTopCenter, P.InsideBottomCenter, P.InsideMiddleLeft, P.OutsideTopRight,
    P.OutsideBottomRight, P.OutsideLeftMiddle, P.OutsideRightMiddle, P.OutsideTopLeft,
    P.OutsideBottomLeft, P.InsideTopLeft, P.InsideBottomLeft, P.InsideMiddleRight,
    P.InsideTopRight, P.InsideBottomRight],
  [P.OutsideLeftTop, P.OutsideRightTop, P.OutsideLeftBottom, P.OutsideRightBottom],
  [],
];

const C4_PERSON = [
  [P.InsideMiddleCenter],
  [P.InsideTopCenter, P.InsideBottomCenter],
  [P.InsideBottomLeft, P.InsideBottomRight, P.InsideTopLeft, P.InsideTopRight,
    P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.OutsideTopCenter, P.OutsideBottomCenter, P.OutsideBottomLeft, P.OutsideBottomRight,
    P.OutsideLeftMiddle, P.OutsideLeftBottom, P.OutsideRightMiddle, P.OutsideRightBottom,
    P.OutsideRightTop, P.OutsideLeftTop, P.OutsideTopLeft, P.OutsideTopRight],
];

const DIAMOND = [
  [P.InsideMiddleCenter],
  [P.OutsideTopCenter, P.OutsideBottomCenter, P.InsideMiddleLeft, P.InsideMiddleRight,
    P.OutsideLeftMiddle, P.OutsideRightMiddle, P.InsideBottomCenter, P.InsideTopCenter],
  [P.InsideTopLeft, P.InsideTopRight, P.InsideBottomLeft, P.InsideBottomRight],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideLeftTop, P.OutsideRightTop,
    P.OutsideBottomLeft, P.OutsideBottomRight, P.OutsideLeftBottom, P.OutsideRightBottom],
];

const DOCUMENT = [
  [P.InsideTopLeft, P.InsideTopCenter, P.InsideTopRight, P.InsideMiddleCenter],
  [P.OutsideTopLeft, P.OutsideTopCenter, P.OutsideTopRight, P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.OutsideLeftTop, P.OutsideLeftMiddle, P.OutsideLeftBottom, P.OutsideRightTop,
    P.OutsideRightMiddle, P.OutsideRightBottom, P.InsideBottomCenter, P.InsideBottomLeft,
    P.InsideBottomRight],
  [P.OutsideBottomLeft, P.OutsideBottomCenter, P.OutsideBottomRight],
];

const HEXAGON = [
  [P.OutsideTopCenter, P.InsideMiddleCenter, P.OutsideBottomCenter],
  [P.InsideMiddleLeft, P.InsideMiddleRight, P.InsideTopCenter, P.InsideBottomCenter],
  [P.OutsideLeftMiddle, P.OutsideRightMiddle, P.InsideTopLeft, P.InsideTopRight,
    P.InsideBottomLeft, P.InsideBottomRight],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideLeftTop, P.OutsideLeftBottom,
    P.OutsideRightTop, P.OutsideRightBottom, P.OutsideBottomLeft, P.OutsideBottomRight],
];

const IMAGE = [
  [P.OutsideBottomCenter, P.OutsideTopCenter],
  [P.OutsideLeftMiddle, P.OutsideRightMiddle],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideBottomLeft, P.OutsideBottomRight,
    P.OutsideLeftTop, P.OutsideRightTop, P.OutsideLeftBottom, P.OutsideRightBottom],
  [],
];

const OVAL = [
  [P.OutsideTopCenter, P.InsideMiddleCenter, P.OutsideBottomCenter],
  [P.InsideBottomCenter, P.InsideTopCenter, P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.OutsideLeftMiddle, P.OutsideRightMiddle],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideLeftTop, P.OutsideRightTop,
    P.OutsideBottomLeft, P.OutsideBottomRight, P.OutsideLeftBottom, P.OutsideRightBottom,
    P.InsideTopLeft, P.InsideTopRight, P.InsideBottomLeft, P.InsideBottomRight],
];

const PACKAGE = [
  [P.InsideMiddleCenter, P.InsideMiddleLeft, P.InsideBottomLeft, P.InsideBottomCenter,
    P.OutsideBottomLeft, P.OutsideBottomCenter, P.InsideTopLeft, P.InsideTopCenter, P.InsideTopRight],
  [P.OutsideTopLeft, P.InsideMiddleRight, P.InsideBottomRight, P.OutsideBottomRight],
  [P.OutsideTopCenter, P.OutsideLeftMiddle, P.OutsideRightMiddle, P.OutsideLeftTop,
    P.OutsideLeftBottom, P.OutsideRightBottom],
  [P.OutsideTopRight, P.OutsideRightTop],
];

const PAGE = [
  [P.InsideMiddleCenter, P.InsideBottomCenter, P.OutsideBottomCenter],
  [P.InsideTopLeft, P.InsideMiddleLeft, P.InsideMiddleRight, P.InsideBottomLeft,
    P.InsideBottomRight, P.OutsideTopLeft, P.OutsideTopCenter, P.OutsideBottomLeft,
    P.OutsideBottomRight],
  [P.OutsideTopRight, P.InsideTopCenter, P.OutsideRightBottom, P.OutsideRightMiddle,
    P.OutsideLeftTop, P.OutsideLeftMiddle, P.OutsideLeftBottom],
  [P.InsideTopRight, P.OutsideRightTop],
];

const PARALLELOGRAM = [
  [P.InsideTopLeft, P.InsideMiddleCenter, P.InsideBottomRight, P.OutsideTopRight, P.OutsideBottomLeft],
  [P.OutsideTopCenter, P.InsideTopCenter, P.InsideBottomCenter, P.OutsideBottomCenter],
  [P.OutsideLeftMiddle, P.OutsideLeftBottom, P.OutsideRightTop, P.OutsideRightMiddle,
    P.InsideTopRight, P.InsideMiddleLeft, P.InsideMiddleRight, P.InsideBottomLeft],
  [P.OutsideTopLeft, P.OutsideLeftTop, P.OutsideRightBottom, P.OutsideBottomRight],
];

const PERSON = [
  [P.OutsideBottomCenter],
  [P.OutsideTopCenter, P.OutsideBottomLeft, P.OutsideBottomRight],
  [P.InsideTopCenter, P.InsideMiddleCenter, P.InsideBottomCenter, P.InsideBottomLeft,
    P.InsideBottomRight, P.OutsideLeftMiddle, P.OutsideLeftBottom, P.OutsideRightMiddle,
    P.OutsideRightBottom],
  [P.InsideTopLeft, P.InsideTopRight, P.InsideMiddleLeft, P.InsideMiddleRight,
    P.OutsideRightTop, P.OutsideLeftTop, P.OutsideTopLeft, P.OutsideTopRight],
];

const QUEUE = [
  [P.OutsideTopCenter, P.InsideTopCenter, P.InsideMiddleCenter, P.InsideBottomCenter, P.OutsideBottomCenter],
  [P.InsideTopLeft, P.InsideBottomLeft, P.InsideMiddleRight],
  [P.InsideTopRight, P.InsideBottomRight, P.OutsideLeftMiddle, P.OutsideRightMiddle, P.InsideMiddleLeft],
  [P.OutsideTopLeft, P.OutsideTopRight, P.OutsideBottomLeft, P.OutsideBottomRight,
    P.OutsideLeftTop, P.OutsideRightTop, P.OutsideLeftBottom, P.OutsideRightBottom],
];

const STEP = [
  [P.InsideMiddleCenter],
  [P.InsideTopCenter, P.InsideTopRight, P.InsideBottomRight, P.InsideMiddleLeft,
    P.InsideMiddleRight, P.InsideBottomCenter, P.OutsideTopLeft, P.OutsideTopCenter,
    P.OutsideBottomLeft, P.OutsideBottomCenter],
  [P.OutsideRightMiddle, P.OutsideLeftTop, P.OutsideLeftBottom, P.InsideTopLeft, P.InsideBottomLeft],
  [P.OutsideTopRight, P.OutsideLeftMiddle, P.OutsideRightTop, P.OutsideRightBottom, P.OutsideBottomRight],
];

const STORED_DATA = [
  [P.OutsideTopCenter, P.InsideTopCenter, P.InsideMiddleCenter, P.InsideBottomCenter, P.OutsideBottomCenter],
  [P.OutsideTopRight, P.OutsideBottomRight, P.InsideTopRight, P.InsideBottomRight,
    P.InsideMiddleRight, P.InsideTopLeft, P.InsideBottomLeft],
  [P.InsideMiddleLeft, P.OutsideLeftMiddle, P.OutsideTopLeft, P.OutsideBottomLeft],
  [P.OutsideRightMiddle, P.OutsideLeftTop, P.OutsideRightTop, P.OutsideLeftBottom, P.OutsideRightBottom],
];

// nodeshape.New: Text, Class, Table, Code, RealSquare, Square and "" use the
// shapeSquare preferences (shapeTable embeds *shapeSquare).
const PREFERENCES_BY_TYPE = new Map([
  ["", SQUARE],
  ["Square", SQUARE],
  ["RealSquare", SQUARE],
  ["Text", SQUARE],
  ["Class", SQUARE],
  ["Code", SQUARE],
  ["Table", SQUARE],
  ["Callout", CALLOUT],
  ["Circle", CIRCLE],
  ["Cloud", CLOUD],
  ["Cylinder", CYLINDER],
  ["C4Person", C4_PERSON],
  ["Diamond", DIAMOND],
  ["Document", DOCUMENT],
  ["Hexagon", HEXAGON],
  ["Image", IMAGE],
  ["Oval", OVAL],
  ["Package", PACKAGE],
  ["Page", PAGE],
  ["Parallelogram", PARALLELOGRAM],
  ["Person", PERSON],
  ["Queue", QUEUE],
  ["Step", STEP],
  ["StoredData", STORED_DATA],
]);

function preferencesFor(shapeType) {
  const preferences = PREFERENCES_BY_TYPE.get(shapeType);
  if (preferences === undefined) {
    throw new Error(`TALA nodeshape: unsupported shape type ${JSON.stringify(shapeType)}`);
  }
  return preferences;
}

/**
 * shapeLabelPositionPreferences returns the label positions in a preference
 * tier as a Set. An unknown tier yields an empty set, like Go.
 */
export function shapeLabelPositionPreferences(shapeType, tier) {
  const preferences = preferencesFor(shapeType);
  switch (tier) {
    case LabelTier.Good:
    case LabelTier.OK:
    case LabelTier.Unideal:
    case LabelTier.Bad:
      return new Set(preferences[tier]);
    default:
      return new Set();
  }
}

/** nodeLabelPositionPreferences mirrors node.Shape.LabelPositionPreferences. */
export function nodeLabelPositionPreferences(node, tier) {
  return shapeLabelPositionPreferences(node._shapeType, tier);
}

// lib/shape: only shapeSquare (including the default ""-typed shapeSquare and
// the Class/Code/Table/Text wrappers that embed it), shapeRealSquare and
// shapeImage override baseShape.IsRectangular to true.
const RECTANGULAR_TYPES = new Set(["", "Square", "RealSquare", "Image", "Text", "Class", "Table", "Code"]);

/** shapeIsRectangular mirrors Shape.IsRectangular. */
export function shapeIsRectangular(shapeType) {
  preferencesFor(shapeType);
  return RECTANGULAR_TYPES.has(shapeType);
}

export function nodeIsRectangular(node) {
  return shapeIsRectangular(node._shapeType);
}
