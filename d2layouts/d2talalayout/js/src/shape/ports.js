import { Orientation } from '../geometry/orientation.js';
import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { newBezierCurve } from '../geometry/bezier.js';
import { STEP_WEDGE_WIDTH } from './constants.js';

// Pinned Go: internal/nodeshape/shape*.go (SnapPointPercentages, PortIndices,
// MirroredPortIndices, CenterPortIndices, CenterPortIndex) and
// internal/layoutgraph/node.go ports(). Shapes are identified by the JS node
// representation (node._shapeType), whose strings equal Go's lib/shape *_TYPE
// constants; "" keeps square behavior exactly like nodeshape.New("").

const INT64_MIN_AS_FLOAT = -9223372036854775808;
const TWO_POW_63 = 9223372036854775808;

/**
 * goTruncateDecimals mirrors Go geo.TruncateDecimals:
 * float64(int(v*1000)) / 1000.
 *
 * Go's float64 -> int conversion of NaN or an out-of-range value is
 * implementation-specific; this follows the amd64 CVTTSD2SQ result
 * (math.MinInt64), which is the platform the oracle fixtures were generated on.
 */
export function goTruncateDecimals(v) {
  const scaled = v * 1000;
  let truncated;
  if (!(scaled >= -TWO_POW_63 && scaled < TWO_POW_63)) {
    // NaN, +/-Inf and values outside [-2^63, 2^63) yield MinInt64.
    truncated = INT64_MIN_AS_FLOAT;
  } else {
    truncated = Math.trunc(scaled) + 0;
  }
  return truncated / 1000;
}

function rp(xPercentage, yPercentage) {
  return {
    XPercentage: goTruncateDecimals(xPercentage),
    YPercentage: goTruncateDecimals(yPercentage),
  };
}

export const SHAPE_TYPES = Object.freeze([
  "", "Callout", "Circle", "Cloud", "Cylinder", "Diamond", "Document", "Hexagon",
  "Image", "Oval", "Package", "Page", "Parallelogram", "Person", "C4Person", "Queue",
  "RealSquare", "Square", "Step", "StoredData", "Text", "Class", "Table", "Code",
]);

const KNOWN_SHAPE_TYPES = new Set(SHAPE_TYPES);

function assertShapeType(shapeType) {
  if (!KNOWN_SHAPE_TYPES.has(shapeType)) {
    throw new Error(`TALA nodeshape: unsupported shape type ${JSON.stringify(shapeType)}`);
  }
}

// ── Snap points ──────────────────────────────────────────────────────────────

function squareSnapPoints() {
  return [
    [rp(0.25, 0), rp(0.5, 0), rp(0.75, 0)],
    [rp(0, 0.25), rp(0, 0.5), rp(0, 0.75)],
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    [rp(1, 0.25), rp(1, 0.5), rp(1, 0.75)],
  ];
}

function calloutSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  let tipWidth = 30.0;
  let tipHeight = 45.0;
  if (width < tipWidth * 2) {
    tipWidth = width / 2.0;
  }
  if (height < tipHeight * 2) {
    tipHeight = height / 2.0;
  }
  return [
    [rp(0.25, 0), rp(0.5, 0), rp(0.75, 0)],
    [
      rp(0, ((height - tipHeight) / height) * 0.25),
      rp(0, ((height - tipHeight) / height) * 0.5),
      rp(0, ((height - tipHeight) / height) * 0.75),
    ],
    [
      rp(0.5 * 0.33, (height - tipHeight) / height),
      rp(0.5 * 0.66, (height - tipHeight) / height),
      rp(0.5, 1),
      rp(1 - ((width / 2.0 - tipWidth) / width) * 0.5, (height - tipHeight) / height),
    ],
    [
      rp(1, ((height - tipHeight) / height) * 0.25),
      rp(1, ((height - tipHeight) / height) * 0.5),
      rp(1, ((height - tipHeight) / height) * 0.75),
    ],
  ];
}

function cloudSnapPoints() {
  return [
    [rp(0.16, 0.368), rp(0.378, 0.155), rp(0.815, 0.328)],
    [rp(0, 0.7), rp(0.066, 0.935)],
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    [rp(1, 0.7), rp(0.95, 0.89)],
  ];
}

function cylinderSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  let arcDepth = 24.0;
  const controlPointsMultiplier = 0.45;
  if (height < arcDepth * 2) {
    arcDepth = height / 2.0;
  }
  const topLeftMidpoint = newBezierCurve([
    new Point(0, arcDepth),
    new Point(0, 0),
    new Point(width * controlPointsMultiplier, 0),
    new Point(width / 2.0, 0),
  ]).at(0.5);
  const topRightMidpoint = newBezierCurve([
    new Point(width / 2.0, 0),
    new Point(width - (width * controlPointsMultiplier), 0),
    new Point(width, 0),
    new Point(width, arcDepth),
  ]).at(0.5);
  const bottomRightMidpoint = newBezierCurve([
    new Point(width, height - arcDepth),
    new Point(width, height),
    new Point(width - width * controlPointsMultiplier, height),
    new Point(width / 2.0, height),
  ]).at(0.5);
  const bottomLeftMidpoint = newBezierCurve([
    new Point(width / 2.0, height),
    new Point(width * controlPointsMultiplier, height),
    new Point(0, height),
    new Point(0, height - arcDepth),
  ]).at(0.5);
  return [
    [
      rp(topLeftMidpoint.X / width, topLeftMidpoint.Y / height),
      rp(0.5, 0),
      rp(topRightMidpoint.X / width, topRightMidpoint.Y / height),
    ],
    [
      rp(0, arcDepth / height + ((height - arcDepth * 2) / height) * 0.25),
      rp(0, arcDepth / height + ((height - arcDepth * 2) / height) * 0.5),
      rp(0, arcDepth / height + ((height - arcDepth * 2) / height) * 0.75),
    ],
    [
      rp(bottomLeftMidpoint.X / width, bottomLeftMidpoint.Y / height),
      rp(0.5, 1),
      rp(bottomRightMidpoint.X / width, bottomRightMidpoint.Y / height),
    ],
    [
      rp(1, arcDepth / height + ((height - arcDepth * 2) / height) * 0.25),
      rp(1, arcDepth / height + ((height - arcDepth * 2) / height) * 0.5),
      rp(1, arcDepth / height + ((height - arcDepth * 2) / height) * 0.75),
    ],
  ];
}

function diamondSnapPoints() {
  return [
    [rp(0.5, 0)],
    [rp(0, 0.5)],
    [rp(0.5, 1)],
    [rp(1, 0.5)],
  ];
}

function documentSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  const bottomLeftMidpoint = newBezierCurve([
    new Point(0, height * (16.3 / 18.925)),
    new Point(width / 6, height * (19.8 / 18.925)),
    new Point(width / 3, height * (19.8 / 18.925)),
    new Point(width / 2, height * (16.3 / 18.925)),
  ]).at(0.5);
  const bottomRightCurve = newBezierCurve([
    new Point(width / 2, height * (16.3 / 18.925)),
    new Point(width * 2 / 3, height * (12.8 / 18.925)),
    new Point(width * 5 / 6, height * (12.8 / 18.925)),
    new Point(width, height * (16.3 / 18.925)),
  ]);
  return [
    [rp(0.25, 0), rp(0.5, 0), rp(0.75, 0)],
    [rp(0, 0.25), rp(0, 0.5), rp(0, 0.75)],
    [
      rp(bottomLeftMidpoint.X / width, bottomLeftMidpoint.Y / height),
      rp(bottomRightCurve.at(0).X / width, bottomRightCurve.at(0).Y / height),
      rp(bottomRightCurve.at(0.5).X / width, bottomRightCurve.at(0.5).Y / height),
    ],
    [rp(1, 0.25), rp(1, 0.5), rp(1, 0.75)],
  ];
}

function hexagonSnapPoints() {
  return [
    [rp(0.25, 0), rp(0.5, 0), rp(0.75, 0)],
    [rp(0.125, 0.25), rp(0, 0.5), rp(0.125, 0.75)],
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    [rp(0.875, 0.25), rp(1, 0.5), rp(0.875, 0.75)],
  ];
}

function ovalSnapPoints() {
  return [
    [rp(0.25, 0.066), rp(0.5, 0), rp(0.75, 0.066)],
    [rp(0.066, 0.25), rp(0, 0.5), rp(0.066, 0.75)],
    [rp(0.25, 0.934), rp(0.5, 1), rp(0.75, 0.934)],
    [rp(0.934, 0.25), rp(1, 0.5), rp(0.934, 0.75)],
  ];
}

function packageSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  const verticalScalar = 0.2;
  const horizontalScalar = 0.5;
  const minTopHeight = 34.0;
  const maxTopHeight = 55.0;
  const minTopWidth = 50.0;
  const maxTopWidth = 150.0;

  let topWidth = Math.min(maxTopWidth, Math.max(minTopWidth, width * horizontalScalar));
  if (width < 2 * minTopWidth) {
    topWidth = width * horizontalScalar;
  }
  let topHeight = Math.min(maxTopHeight, Math.max(minTopHeight, height * verticalScalar));
  if (height < 2 * minTopHeight) {
    topHeight = height * verticalScalar;
  }
  const topWidthRatio = topWidth / width;
  const topHeightRatio = topHeight / height;
  const negativeTopWidthRatio = 1 - topWidthRatio;
  const negativeTopHeightRatio = 1 - topHeightRatio;
  return [
    [
      rp(topWidthRatio * 0.33, 0),
      rp(topWidthRatio * 0.66, 0),
      rp(topWidthRatio + negativeTopWidthRatio * 0.5, topHeightRatio),
    ],
    [
      rp(0, topHeightRatio + negativeTopHeightRatio * 0.25),
      rp(0, topHeightRatio + negativeTopHeightRatio * 0.5),
      rp(0, topHeightRatio + negativeTopHeightRatio * 0.75),
    ],
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    [
      rp(1, topHeightRatio + negativeTopHeightRatio * 0.25),
      rp(1, topHeightRatio + negativeTopHeightRatio * 0.5),
      rp(1, topHeightRatio + negativeTopHeightRatio * 0.75),
    ],
  ];
}

function parallelogramSnapPoints(box) {
  const width = box.Width;
  let wedgeWidth = 26.0;
  if (width < wedgeWidth) {
    wedgeWidth = width / 2.0;
  }
  return [
    [
      rp(wedgeWidth / width + ((width - wedgeWidth) / width) * 0.25, 0),
      rp(wedgeWidth / width + ((width - wedgeWidth) / width) * 0.5, 0),
      rp(wedgeWidth / width + ((width - wedgeWidth) / width) * 0.75, 0),
    ],
    [
      rp((wedgeWidth / 2.0 + wedgeWidth) / 2.0 / width, 0.25),
      rp(wedgeWidth / 2.0 / width, 0.5),
      rp(wedgeWidth / 2.0 / 2.0 / width, 0.75),
    ],
    [
      rp(((width - wedgeWidth) / width) * 0.25, 1),
      rp(((width - wedgeWidth) / width) * 0.5, 1),
      rp(((width - wedgeWidth) / width) * 0.75, 1),
    ],
    [
      rp((width - wedgeWidth) / width + (wedgeWidth / 2.0 + wedgeWidth) / 2.0 / width, 0.25),
      rp((width - wedgeWidth) / width + wedgeWidth / 2.0 / width, 0.5),
      rp((width - wedgeWidth) / width + wedgeWidth / 2.0 / 2.0 / width, 0.75),
    ],
  ];
}

function personSnapPoints() {
  return [
    [rp(0.21, 0.122), rp(0.5, 0), rp(0.79, 0.122)],
    [rp(0.135, 0.35), rp(0.08, 0.75)],
    [rp(0.25, 0.985), rp(0.5, 1), rp(0.75, 0.985)],
    [rp(0.865, 0.35), rp(0.92, 0.75)],
  ];
}

function c4PersonSnapPoints() {
  return [
    [rp(0.5, 0)],
    [rp(0, 0.45), rp(0, 0.65), rp(0, 0.85)],
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    [rp(1, 0.45), rp(1, 0.65), rp(1, 0.85)],
  ];
}

function queueSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  let arcDepth = 24.0;
  const controlPointsMultiplier = 0.45;
  if (width < arcDepth * 2) {
    arcDepth = width / 2.0;
  }
  const topLeftMidpoint = newBezierCurve([
    new Point(arcDepth, 0),
    new Point(0, 0),
    new Point(0, height * controlPointsMultiplier),
    new Point(0, height / 2.0),
  ]).at(0.5);
  const topRightMidpoint = newBezierCurve([
    new Point(width - arcDepth, 0),
    new Point(width, 0),
    new Point(width, height * controlPointsMultiplier),
    new Point(width, height / 2.0),
  ]).at(0.5);
  const bottomRightMidpoint = newBezierCurve([
    new Point(width, height / 2.0),
    new Point(width, height - height * controlPointsMultiplier),
    new Point(width, height),
    new Point(width - arcDepth, height),
  ]).at(0.5);
  const bottomLeftMidpoint = newBezierCurve([
    new Point(0, height / 2.0),
    new Point(0, height - height * controlPointsMultiplier),
    new Point(0, height),
    new Point(arcDepth, height),
  ]).at(0.5);
  return [
    [
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.25, 0),
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.5, 0),
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.75, 0),
    ],
    [
      rp(topLeftMidpoint.X / width, topLeftMidpoint.Y / height),
      rp(0, 0.5),
      rp(bottomLeftMidpoint.X / width, bottomLeftMidpoint.Y / height),
    ],
    [
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.25, 1),
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.5, 1),
      rp(arcDepth / width + ((width - arcDepth * 2) / width) * 0.75, 1),
    ],
    [
      rp(topRightMidpoint.X / width, topRightMidpoint.Y / height),
      rp(1, 0.5),
      rp(bottomRightMidpoint.X / width, bottomRightMidpoint.Y / height),
    ],
  ];
}

function stepSnapPoints(box) {
  const width = box.Width;
  let wedgeWidth = STEP_WEDGE_WIDTH;
  if (width < wedgeWidth) {
    wedgeWidth = width / 2.0;
  }
  return [
    [
      rp(((width - wedgeWidth) / width) * 0.25, 0),
      rp(((width - wedgeWidth) / width) * 0.5, 0),
      rp(((width - wedgeWidth) / width) * 0.75, 0),
    ],
    [
      rp(wedgeWidth / width / 2, 0.25),
      rp(wedgeWidth / width, 0.5),
      rp(wedgeWidth / width / 2, 0.75),
    ],
    [
      rp(((width - wedgeWidth) / width) * 0.25, 1),
      rp(((width - wedgeWidth) / width) * 0.5, 1),
      rp(((width - wedgeWidth) / width) * 0.75, 1),
    ],
    [rp(1, 0.5)],
  ];
}

function storedDataSnapPoints(box) {
  const width = box.Width;
  const height = box.Height;
  let wedgeWidth = 15.0;
  if (width < wedgeWidth) {
    wedgeWidth = width / 2;
  }
  const controlPointsMultiplier = 0.27;

  const topLeftMidpoint = newBezierCurve([
    new Point(wedgeWidth, 0.0),
    new Point(wedgeWidth - (wedgeWidth * controlPointsMultiplier), 0.0),
    new Point(0.0, height * controlPointsMultiplier),
    new Point(0.0, height / 2.0),
  ]).at(0.5);
  const bottomLeftMidpoint = newBezierCurve([
    new Point(wedgeWidth, height),
    new Point(wedgeWidth - (wedgeWidth * controlPointsMultiplier), height),
    new Point(0.0, height - height * controlPointsMultiplier),
    new Point(0.0, height / 2.0),
  ]).at(0.5);
  const topRightMidpoint = newBezierCurve([
    new Point(width, 0),
    new Point(width - (wedgeWidth * controlPointsMultiplier), 0),
    new Point(width - wedgeWidth, height * controlPointsMultiplier),
    new Point(width - wedgeWidth, height / 2.0),
  ]).at(0.5);
  const bottomRightMidpoint = newBezierCurve([
    new Point(width - wedgeWidth, height / 2.0),
    new Point(width - wedgeWidth, height - height * controlPointsMultiplier),
    new Point(width - wedgeWidth * controlPointsMultiplier, height),
    new Point(width, height),
  ]).at(0.5);

  const sideWidthPercentage = (width - wedgeWidth) / width;
  const sideWidthStartPercentage = 1 - sideWidthPercentage;
  return [
    [
      rp(sideWidthStartPercentage + (0.25 * sideWidthPercentage), 0),
      rp(sideWidthStartPercentage + (0.5 * sideWidthPercentage), 0),
      rp(sideWidthStartPercentage + (0.75 * sideWidthPercentage), 0),
    ],
    [
      rp(topLeftMidpoint.X / width, topLeftMidpoint.Y / height),
      rp(0.0, 0.5),
      rp(bottomLeftMidpoint.X / width, bottomLeftMidpoint.Y / height),
    ],
    [
      rp(sideWidthStartPercentage + (0.25 * sideWidthPercentage), 1),
      rp(sideWidthStartPercentage + (0.5 * sideWidthPercentage), 1),
      rp(sideWidthStartPercentage + (0.75 * sideWidthPercentage), 1),
    ],
    [
      rp(topRightMidpoint.X / width, topRightMidpoint.Y / height),
      rp((width - wedgeWidth) / width, 0.5),
      rp(bottomRightMidpoint.X / width, bottomRightMidpoint.Y / height),
    ],
  ];
}

function tableSnapPoints(numColumns) {
  let left;
  let right;
  if (numColumns === 0) {
    left = [rp(0.0, 0.5)];
    right = [rp(1.0, 0.5)];
  } else {
    left = [];
    right = [];
    const rowHeightPercentage = 1.0 / (numColumns + 1.0);
    const midRowPercentage = rowHeightPercentage / 2.0;
    for (let perc = rowHeightPercentage + midRowPercentage; perc < 1.0; perc += rowHeightPercentage) {
      const h = goRound(perc * 10_000) / 10_000;
      left.push(rp(0.0, h));
      right.push(rp(1.0, h));
    }
  }
  return [
    [rp(0.25, 0), rp(0.5, 0), rp(0.75, 0)],
    left,
    [rp(0.25, 1), rp(0.5, 1), rp(0.75, 1)],
    right,
  ];
}

/**
 * shapeSnapPointPercentages returns relative port groups in top, left,
 * bottom, right order. Mirrors nodeshape.Shape.SnapPointPercentages.
 */
export function shapeSnapPointPercentages(shapeType, box, numColumns = 0) {
  assertShapeType(shapeType);
  switch (shapeType) {
    case "Callout": return calloutSnapPoints(box);
    case "Cloud": return cloudSnapPoints();
    case "Cylinder": return cylinderSnapPoints(box);
    case "Diamond": return diamondSnapPoints();
    case "Document": return documentSnapPoints(box);
    case "Hexagon": return hexagonSnapPoints();
    case "Oval": return ovalSnapPoints();
    case "Package": return packageSnapPoints(box);
    case "Parallelogram": return parallelogramSnapPoints(box);
    case "Person": return personSnapPoints();
    case "C4Person": return c4PersonSnapPoints();
    case "Queue": return queueSnapPoints(box);
    case "Step": return stepSnapPoints(box);
    case "StoredData": return storedDataSnapPoints(box);
    case "Table": return tableSnapPoints(numColumns);
    default: return squareSnapPoints();
  }
}

// ── Port indices ─────────────────────────────────────────────────────────────

function fixedPortIndices(top, left, bottom, right, orientation) {
  switch (orientation) {
    case Orientation.Top: return top.slice();
    case Orientation.Left: return left.slice();
    case Orientation.Bottom: return bottom.slice();
    case Orientation.Right: return right.slice();
    case Orientation.TopLeft: return top.concat(left);
    case Orientation.TopRight: return top.concat(right);
    case Orientation.BottomLeft: return bottom.concat(left);
    case Orientation.BottomRight: return bottom.concat(right);
    default: return [];
  }
}

function tablePortIndices(numColumnsValue, orientation) {
  let numColumns = numColumnsValue;
  if (numColumns === 0) {
    numColumns = 1;
  }
  const topIndices = [0, 1, 2];
  const firstLeftIndex = topIndices[2] + 1;
  const leftIndices = new Array(numColumns);
  for (let i = 0; i < numColumns; i++) {
    leftIndices[i] = firstLeftIndex + i;
  }
  const firstBottomIndex = leftIndices[numColumns - 1] + 1;
  const bottomIndices = new Array(3);
  for (let i = 0; i < 3; i++) {
    bottomIndices[i] = firstBottomIndex + i;
  }
  const firstRightIndex = bottomIndices[2] + 1;
  const rightIndices = new Array(numColumns);
  for (let i = 0; i < numColumns; i++) {
    rightIndices[i] = firstRightIndex + i;
  }
  return fixedPortIndices(topIndices, leftIndices, bottomIndices, rightIndices, orientation);
}

/**
 * shapePortIndices returns the snap-point indices available for an
 * orientation. Mirrors nodeshape.Shape.PortIndices.
 */
export function shapePortIndices(shapeType, orientation, numColumns = 0) {
  assertShapeType(shapeType);
  switch (shapeType) {
    case "Callout":
      return fixedPortIndices([0, 1, 2], [3, 4, 5], [6, 7, 8, 9], [10, 11, 12], orientation);
    case "Cloud":
    case "Person":
      return fixedPortIndices([0, 1, 2], [3, 4], [5, 6, 7], [8, 9], orientation);
    case "Diamond":
      return fixedPortIndices([0], [1], [2], [3], orientation);
    case "C4Person":
      return fixedPortIndices([0], [1, 2, 3], [4, 5, 6], [7, 8, 9], orientation);
    case "Step":
      return fixedPortIndices([0, 1, 2], [3, 4, 5], [6, 7, 8], [9], orientation);
    case "Table":
      return tablePortIndices(numColumns, orientation);
    default:
      // shapeSquare (and every wrapper embedding it) plus shapePackage.
      return fixedPortIndices([0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], orientation);
  }
}

/**
 * shapeCenterPortIndices mirrors nodeshape.Shape.CenterPortIndices. A nil Go
 * slice is returned as null.
 */
export function shapeCenterPortIndices(shapeType, numColumns = 0) {
  assertShapeType(shapeType);
  switch (shapeType) {
    case "Callout": return [1, 4, 8, 11];
    case "Cloud": return [1, 3, 6, 8];
    case "Person": return [1, 3, 6, 8];
    case "C4Person": return [0, 2, 5, 7];
    case "Diamond": return [0, 1, 2, 3];
    case "Package": return [0, 1, 4, 7, 10];
    case "Step": return [1, 4, 7, 9];
    case "Table": return numColumns > 0 ? null : [1, 3, 5, 7];
    default: return [1, 4, 7, 10];
  }
}

/**
 * shapeCenterPortIndex mirrors nodeshape.Shape.CenterPortIndex.
 */
export function shapeCenterPortIndex(shapeType, orientation, numColumns = 0) {
  assertShapeType(shapeType);
  if (shapeType === "Table" && numColumns > 0) {
    return -1;
  }
  const centerPorts = shapeCenterPortIndices(shapeType, numColumns);
  const base = shapeType === "Package" ? 1 : 0;
  let centerPortsIndex;
  switch (orientation) {
    case Orientation.Top: centerPortsIndex = base; break;
    case Orientation.Left: centerPortsIndex = base + 1; break;
    case Orientation.Bottom: centerPortsIndex = base + 2; break;
    case Orientation.Right: centerPortsIndex = base + 3; break;
    default: return -1;
  }
  return centerPorts[centerPortsIndex];
}

/**
 * shapeMirroredPortIndices mirrors nodeshape.Shape.MirroredPortIndices as a
 * Map (Go map iteration order is unspecified; callers must not rely on order).
 * A nil Go map is returned as null.
 */
export function shapeMirroredPortIndices(shapeType, numColumns = 0) {
  assertShapeType(shapeType);
  switch (shapeType) {
    case "Callout": return new Map([[4, 11], [11, 4]]);
    case "Cloud": return new Map([[3, 8], [8, 3]]);
    case "Person": return new Map([[1, 6], [6, 1], [3, 8], [8, 3]]);
    case "C4Person": return new Map([[1, 6], [6, 1], [3, 8], [8, 3]]);
    case "Diamond": return new Map([[0, 2], [2, 0], [1, 3], [3, 1]]);
    case "Package": return new Map([[4, 10], [10, 4]]);
    case "Step": return new Map([[1, 7], [7, 1], [4, 9], [9, 4]]);
    case "Table": {
      if (numColumns > 0) return null;
      const c = [1, 3, 5, 7];
      return new Map([[c[0], c[2]], [c[2], c[0]], [c[1], c[3]], [c[3], c[1]]]);
    }
    default: return new Map([[1, 7], [7, 1], [4, 10], [10, 4]]);
  }
}

// ── Node helpers (layoutgraph.Node embeds nodeshape.Shape) ───────────────────

function nodeNumColumns(node) {
  // Go nodeshape.NumColumns returns 0 for every non-table shape.
  return node._shapeType === "Table" ? (node._numColumns || 0) : 0;
}

export function nodeSnapPointPercentages(node) {
  return shapeSnapPointPercentages(node._shapeType, node.Box, nodeNumColumns(node));
}

export function nodePortIndices(node, orientation) {
  return shapePortIndices(node._shapeType, orientation, nodeNumColumns(node));
}

export function nodeCenterPortIndices(node) {
  return shapeCenterPortIndices(node._shapeType, nodeNumColumns(node));
}

export function nodeCenterPortIndex(node, orientation) {
  return shapeCenterPortIndex(node._shapeType, orientation, nodeNumColumns(node));
}

export function nodeMirroredPortIndices(node) {
  return shapeMirroredPortIndices(node._shapeType, nodeNumColumns(node));
}

/**
 * nodePorts mirrors layoutgraph Node.ports(): every snap point in absolute
 * coordinates, X/Y offsets rounded with Go math.Round.
 */
export function nodePorts(node) {
  const ports = [];
  for (const relativePoints of nodeSnapPointPercentages(node)) {
    for (const point of relativePoints) {
      ports.push(new Point(
        node.TopLeft.X + goRound(node.Width * point.XPercentage),
        node.TopLeft.Y + goRound(node.Height * point.YPercentage),
      ));
    }
  }
  return ports;
}
