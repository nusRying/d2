import { Orientation } from '../geometry/orientation.js';
import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { goTruncateDecimals } from './ports.js';

// Pinned Go: internal/nodeshape/shape_table.go (TablePortIndex,
// TableColumnPortValue). Go panics on an out-of-range column; JS throws an
// Error with the identical message.

const OUT_OF_RANGE = "table column port index out of range";

function isTable(node) {
  return node != null && node._shapeType === "Table";
}

function tableNumColumns(node) {
  return node._numColumns || 0;
}

/**
 * tablePortIndex returns [index, ok]: the absolute snap-point index for a
 * table column on the requested side. Non-table nodes and non-side
 * orientations return ok=false.
 */
export function tablePortIndex(node, orientation, columnIndex) {
  if (!isTable(node)) {
    return [0, false];
  }
  let numColumns = tableNumColumns(node);
  if (numColumns === 0) {
    numColumns = 1;
  }
  if (columnIndex < 0 || columnIndex >= numColumns) {
    throw new Error(OUT_OF_RANGE);
  }
  switch (orientation) {
    case Orientation.Left:
      return [3 + columnIndex, true];
    case Orientation.Right:
      return [6 + numColumns + columnIndex, true];
    default:
      return [0, false];
  }
}

/**
 * tableColumnPortValue returns [port, ok]: the table column's concrete side
 * port. Non-table nodes and non-side orientations return [Point(0,0), false].
 */
export function tableColumnPortValue(node, orientation, columnIndex) {
  if (!isTable(node) || (orientation !== Orientation.Left && orientation !== Orientation.Right)) {
    return [new Point(0, 0), false];
  }
  const numColumns = tableNumColumns(node);
  if (numColumns === 0) {
    if (columnIndex !== 0) {
      throw new Error(OUT_OF_RANGE);
    }
  } else if (columnIndex < 0 || columnIndex >= numColumns) {
    throw new Error(OUT_OF_RANGE);
  }

  let yPercentage = 0.5;
  if (numColumns > 0) {
    const rowHeightPercentage = 1.0 / (numColumns + 1.0);
    let percentage = rowHeightPercentage + rowHeightPercentage / 2.0;
    for (let i = 0; i < columnIndex; i++) {
      percentage += rowHeightPercentage;
    }
    percentage = goRound(percentage * 10_000) / 10_000;
    yPercentage = goTruncateDecimals(percentage);
  }
  let xPercentage = 0.0;
  if (orientation === Orientation.Right) {
    xPercentage = 1.0;
  }
  const box = node.Box;
  return [
    new Point(
      box.TopLeft.X + goRound(box.Width * xPercentage),
      box.TopLeft.Y + goRound(box.Height * yPercentage),
    ),
    true,
  ];
}
