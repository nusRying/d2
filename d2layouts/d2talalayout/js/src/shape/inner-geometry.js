import { goPow2 } from '../geometry/go-math.js';
import { Box } from "../geometry/box.js";
import { Point } from "../geometry/point.js";
import { goRound } from "../geometry/math.js";
import { STEP_WEDGE_WIDTH } from "./constants.js";
export const PARALLEL_WEDGE_WIDTH = 26.0;
export const STORED_DATA_WEDGE_WIDTH = 15.0;
export const DEFAULT_ARC_DEPTH = 24.0;
export const PAGE_CORNER_WIDTH = 20.8164;
export const PAGE_CORNER_HEIGHT = 20.348;
export const DOC_PATH_HEIGHT = 18.925;
export const DOC_PATH_INNER_BOTTOM = 14.0;
export const DEFAULT_TIP_HEIGHT = 45.0;
export const PERSON_SHOULDER_WIDTH_FACTOR = 20.2 / 68.3;
export const HEAD_RADIUS_FACTOR = 0.22;
export const BODY_TOP_FACTOR = 0.8;

export const PACKAGE_TOP_MAX_HEIGHT = 55.0;
export const PACKAGE_VERTICAL_SCALAR = 0.2;

export const OVAL_AR_LIMIT = 3.0;
export const PERSON_AR_LIMIT = 1.5;
export const C4_PERSON_AR_LIMIT = 1.5;

export const CLOUD_WIDE_INNER_X = 0.085;
export const CLOUD_WIDE_INNER_Y = 0.409;
export const CLOUD_WIDE_INNER_WIDTH = 0.819;
export const CLOUD_WIDE_INNER_HEIGHT = 0.548;
export const CLOUD_WIDE_ASPECT_BOUNDARY = (1 + CLOUD_WIDE_INNER_WIDTH / CLOUD_WIDE_INNER_HEIGHT) / 2;

export const CLOUD_TALL_INNER_X = 0.228;
export const CLOUD_TALL_INNER_Y = 0.179;
export const CLOUD_TALL_INNER_WIDTH = 0.549;
export const CLOUD_TALL_INNER_HEIGHT = 0.820;
export const CLOUD_TALL_ASPECT_BOUNDARY = (1 + CLOUD_TALL_INNER_WIDTH / CLOUD_TALL_INNER_HEIGHT) / 2;

export const CLOUD_SQUARE_INNER_X = 0.167;
export const CLOUD_SQUARE_INNER_Y = 0.335;
export const CLOUD_SQUARE_INNER_WIDTH = 0.663;
export const CLOUD_SQUARE_INNER_HEIGHT = 0.663;

/**
 * Calculates the inner box for a shape given its shapeType and outer bounding box.
 * Pinned reference: lib/shape/shape_*.go
 *
 * @param {string} shapeType
 * @param {Box} box
 * @returns {Box}
 */
export function shapeGetInnerBox(shapeType, box) {
  switch (shapeType) {
    case "Circle": {
      const width = box.Width;
      const height = box.Height;
      const insideTL = shapeGetInsidePlacement(shapeType, box, width, height, 0, 0);
      const tl = box.TopLeft;
      const innerWidth = width - 2 * (insideTL.X - tl.X);
      const innerHeight = height - 2 * (insideTL.Y - tl.Y);
      return new Box(new Point(insideTL.X, insideTL.Y), innerWidth, innerHeight);
    }
    case "Oval": {
      const width = box.Width;
      const height = box.Height;
      const insideTL = shapeGetInsidePlacement(shapeType, box, width, height, 0, 0);
      const tl = box.TopLeft;
      const innerWidth = width - 2 * (insideTL.X - tl.X);
      const innerHeight = height - 2 * (insideTL.Y - tl.Y);
      return new Box(new Point(insideTL.X, insideTL.Y), innerWidth, innerHeight);
    }
    case "Cloud": {
      const width = box.Width;
      const height = box.Height;
      const insideTL = shapeGetInsidePlacement(shapeType, box, width, height, 0, 0);
      const aspectRatio = width / height;
      let innerWidth = width;
      let innerHeight = height;
      if (aspectRatio > CLOUD_WIDE_ASPECT_BOUNDARY) {
        innerWidth *= CLOUD_WIDE_INNER_WIDTH;
        innerHeight *= CLOUD_WIDE_INNER_HEIGHT;
      } else if (aspectRatio < CLOUD_TALL_ASPECT_BOUNDARY) {
        innerWidth *= CLOUD_TALL_INNER_WIDTH;
        innerHeight *= CLOUD_TALL_INNER_HEIGHT;
      } else {
        innerWidth *= CLOUD_SQUARE_INNER_WIDTH;
        innerHeight *= CLOUD_SQUARE_INNER_HEIGHT;
      }
      return new Box(new Point(insideTL.X, insideTL.Y), innerWidth, innerHeight);
    }
    case "Page": {
      let width = box.Width;
      if (box.Height < 3 * PAGE_CORNER_HEIGHT) {
        width -= PAGE_CORNER_WIDTH;
      }
      return new Box(new Point(box.TopLeft.X, box.TopLeft.Y), width, box.Height);
    }
    case "Step": {
      return new Box(
        new Point(box.TopLeft.X + STEP_WEDGE_WIDTH, box.TopLeft.Y),
        box.Width - 2 * STEP_WEDGE_WIDTH,
        box.Height
      );
    }
    case "Queue": {
      let arcWidth = DEFAULT_ARC_DEPTH;
      if (box.Width < arcWidth * 2) {
        arcWidth = box.Width / 2.0;
      }
      return new Box(
        new Point(box.TopLeft.X + arcWidth, box.TopLeft.Y),
        box.Width - 3 * arcWidth,
        box.Height
      );
    }
    case "Hexagon": {
      return new Box(
        new Point(box.TopLeft.X + box.Width / 6.0, box.TopLeft.Y + box.Height / 6.0),
        box.Width / 1.5,
        box.Height / 1.5
      );
    }
    case "Diamond": {
      return new Box(
        new Point(box.TopLeft.X + box.Width / 4.0, box.TopLeft.Y + box.Height / 4.0),
        box.Width / 2.0,
        box.Height / 2.0
      );
    }
    case "Document": {
      return new Box(
        new Point(box.TopLeft.X, box.TopLeft.Y),
        box.Width,
        (box.Height * DOC_PATH_INNER_BOTTOM) / DOC_PATH_HEIGHT
      );
    }
    case "Cylinder": {
      let arcHeight = DEFAULT_ARC_DEPTH;
      if (box.Height < arcHeight * 2) {
        arcHeight = box.Height / 2.0;
      }
      return new Box(
        new Point(box.TopLeft.X, box.TopLeft.Y + 2 * arcHeight),
        box.Width,
        box.Height - 3 * arcHeight
      );
    }
    case "StoredData": {
      return new Box(
        new Point(box.TopLeft.X + STORED_DATA_WEDGE_WIDTH, box.TopLeft.Y),
        box.Width - 2 * STORED_DATA_WEDGE_WIDTH,
        box.Height
      );
    }
    case "Parallelogram": {
      return new Box(
        new Point(box.TopLeft.X + PARALLEL_WEDGE_WIDTH, box.TopLeft.Y),
        box.Width - 2 * PARALLEL_WEDGE_WIDTH,
        box.Height
      );
    }
    case "Callout": {
      let tipHeight = DEFAULT_TIP_HEIGHT;
      if (box.Height < tipHeight * 2) {
        tipHeight = box.Height / 2.0;
      }
      return new Box(
        new Point(box.TopLeft.X, box.TopLeft.Y),
        box.Width,
        box.Height - tipHeight
      );
    }
    case "Person": {
      const shoulderWidth = PERSON_SHOULDER_WIDTH_FACTOR * box.Width;
      return new Box(
        new Point(box.TopLeft.X + shoulderWidth, box.TopLeft.Y),
        box.Width - 2 * shoulderWidth,
        box.Height
      );
    }
    case "C4Person": {
      const headRadius = box.Width * HEAD_RADIUS_FACTOR;
      const headCenterY = headRadius;
      const bodyTop = headCenterY + headRadius * BODY_TOP_FACTOR;
      const horizontalPadding = box.Width * 0.05;
      const verticalPadding = box.Height * 0.03;
      return new Box(
        new Point(box.TopLeft.X + horizontalPadding, box.TopLeft.Y + bodyTop + verticalPadding),
        box.Width - 2 * horizontalPadding,
        box.Height - bodyTop - 2 * verticalPadding
      );
    }
    case "Package": {
      const topHeight = Math.min(PACKAGE_TOP_MAX_HEIGHT, box.Height * PACKAGE_VERTICAL_SCALAR);
      return new Box(
        new Point(box.TopLeft.X, box.TopLeft.Y + topHeight),
        box.Width,
        box.Height - topHeight
      );
    }
    default: {
      // Base shape behavior: returns outer box
      return new Box(new Point(box.TopLeft.X, box.TopLeft.Y), box.Width, box.Height);
    }
  }
}

/**
 * Calculates inside placement point for a shape given its shapeType, outer box, content dimensions and padding.
 * Pinned reference: lib/shape/shape_*.go
 *
 * @param {string} shapeType
 * @param {Box} box
 * @param {number} width
 * @param {number} height
 * @param {number} paddingX
 * @param {number} paddingY
 * @returns {Point}
 */
export function shapeGetInsidePlacement(shapeType, box, width, height, paddingX, paddingY) {
  switch (shapeType) {
    case "Circle": {
      const r = box.Width / 2.0;
      const halfLength = (r * Math.SQRT2) / 2.0;
      return new Point(
        box.TopLeft.X + Math.ceil(r - halfLength + paddingX / 2.0),
        box.TopLeft.Y + Math.ceil(r - halfLength + paddingY / 2.0)
      );
    }
    case "Oval": {
      const rx = box.Width / 2.0;
      const ry = box.Height / 2.0;
      // Precision quirk in pinned Go: theta := float64(float32(math.Atan2(ry, rx)))
      const theta = Math.fround(Math.atan2(ry, rx));
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const r = (rx * ry) / Math.sqrt(goPow2(rx * sin) + goPow2(ry * cos));
      return new Point(
        box.TopLeft.X + Math.ceil(rx - cos * (r - paddingX / 2.0)),
        box.TopLeft.Y + Math.ceil(ry - sin * (r - paddingY / 2.0))
      );
    }
    case "Cloud": {
      const totalW = width + paddingX;
      const totalH = height + paddingY;
      const aspectRatio = totalW / totalH;
      if (aspectRatio > CLOUD_WIDE_ASPECT_BOUNDARY) {
        return new Point(
          box.TopLeft.X + Math.ceil(box.Width * CLOUD_WIDE_INNER_X + paddingX / 2.0),
          box.TopLeft.Y + Math.ceil(box.Height * CLOUD_WIDE_INNER_Y + paddingY / 2.0)
        );
      } else if (aspectRatio < CLOUD_TALL_ASPECT_BOUNDARY) {
        return new Point(
          box.TopLeft.X + Math.ceil(box.Width * CLOUD_TALL_INNER_X + paddingX / 2.0),
          box.TopLeft.Y + Math.ceil(box.Height * CLOUD_TALL_INNER_Y + paddingY / 2.0)
        );
      } else {
        return new Point(
          box.TopLeft.X + Math.ceil(box.Width * CLOUD_SQUARE_INNER_X + paddingX / 2.0),
          box.TopLeft.Y + Math.ceil(box.Height * CLOUD_SQUARE_INNER_Y + paddingY / 2.0)
        );
      }
    }
    default: {
      // Base shape behavior: delegates to full shape's GetInnerBox().TopLeft + padding/2
      const innerBox = shapeGetInnerBox(shapeType, box);
      return new Point(
        innerBox.TopLeft.X + paddingX / 2.0,
        innerBox.TopLeft.Y + paddingY / 2.0
      );
    }
  }
}

/**
 * Limits aspect ratio of (width, height) to not exceed aspectRatio.
 * Pinned reference: lib/shape/shape.go LimitAR
 *
 * @param {number} width
 * @param {number} height
 * @param {number} aspectRatio
 * @returns {[number, number]}
 */
export function limitAR(width, height, aspectRatio) {
  if (width > aspectRatio * height) {
    height = goRound(width / aspectRatio);
  } else if (height > aspectRatio * width) {
    width = goRound(height / aspectRatio);
  }
  return [width, height];
}

/**
 * Returns the minimum shape dimensions needed to fit content (width x height)
 * in the shape's innerBox with padding.
 * Pinned reference: lib/shape/shape_*.go GetDimensionsToFit
 *
 * @param {string} shapeType
 * @param {number} width
 * @param {number} height
 * @param {number} paddingX
 * @param {number} paddingY
 * @returns {[number, number]} [fitWidth, fitHeight]
 */
export function shapeGetDimensionsToFit(shapeType, width, height, paddingX, paddingY) {
  switch (shapeType) {
    case "RealSquare": {
      const sideLength = Math.ceil(Math.max(width + paddingX, height + paddingY));
      return [sideLength, sideLength];
    }
    case "Circle": {
      const length = Math.max(width + paddingX, height + paddingY);
      const diameter = Math.ceil(Math.SQRT2 * length);
      return [diameter, diameter];
    }
    case "Oval": {
      const theta = Math.fround(Math.atan2(height, width));
      const paddedWidth = width + paddingX * Math.cos(theta);
      const paddedHeight = height + paddingY * Math.sin(theta);
      let totalWidth = Math.ceil(Math.SQRT2 * paddedWidth);
      let totalHeight = Math.ceil(Math.SQRT2 * paddedHeight);
      [totalWidth, totalHeight] = limitAR(totalWidth, totalHeight, OVAL_AR_LIMIT);
      return [totalWidth, totalHeight];
    }
    case "Cloud": {
      const w = width + paddingX;
      const h = height + paddingY;
      const aspectRatio = w / h;
      if (aspectRatio > CLOUD_WIDE_ASPECT_BOUNDARY) {
        return [Math.ceil(w / CLOUD_WIDE_INNER_WIDTH), Math.ceil(h / CLOUD_WIDE_INNER_HEIGHT)];
      } else if (aspectRatio < CLOUD_TALL_ASPECT_BOUNDARY) {
        return [Math.ceil(w / CLOUD_TALL_INNER_WIDTH), Math.ceil(h / CLOUD_TALL_INNER_HEIGHT)];
      } else {
        return [Math.ceil(w / CLOUD_SQUARE_INNER_WIDTH), Math.ceil(h / CLOUD_SQUARE_INNER_HEIGHT)];
      }
    }
    case "Page": {
      let totalWidth = width + paddingX;
      let totalHeight = height + paddingY;
      if (totalHeight < 3 * PAGE_CORNER_HEIGHT) {
        totalWidth += PAGE_CORNER_WIDTH;
      }
      totalWidth = Math.max(totalWidth, 2 * PAGE_CORNER_WIDTH);
      totalHeight = Math.max(totalHeight, PAGE_CORNER_HEIGHT);
      return [Math.ceil(totalWidth), Math.ceil(totalHeight)];
    }
    case "Step": {
      const totalWidth = width + paddingX + 2 * STEP_WEDGE_WIDTH;
      return [Math.ceil(totalWidth), Math.ceil(height + paddingY)];
    }
    case "Queue": {
      const totalWidth = 3 * DEFAULT_ARC_DEPTH + width + paddingX;
      return [Math.ceil(totalWidth), Math.ceil(height + paddingY)];
    }
    case "Hexagon": {
      const totalWidth = 1.5 * (width + paddingX);
      const totalHeight = 1.5 * (height + paddingY);
      return [Math.ceil(totalWidth), Math.ceil(totalHeight)];
    }
    case "Diamond": {
      const totalWidth = 2 * (width + paddingX);
      const totalHeight = 2 * (height + paddingY);
      return [Math.ceil(totalWidth), Math.ceil(totalHeight)];
    }
    case "Document": {
      const baseHeight = ((height + paddingY) * DOC_PATH_HEIGHT) / DOC_PATH_INNER_BOTTOM;
      return [Math.ceil(width + paddingX), Math.ceil(baseHeight)];
    }
    case "Cylinder": {
      const totalHeight = height + paddingY + 3 * DEFAULT_ARC_DEPTH;
      return [Math.ceil(width + paddingX), Math.ceil(totalHeight)];
    }
    case "StoredData": {
      const totalWidth = width + paddingX + 2 * STORED_DATA_WEDGE_WIDTH;
      return [Math.ceil(totalWidth), Math.ceil(height + paddingY)];
    }
    case "Parallelogram": {
      const totalWidth = width + paddingX + 2 * PARALLEL_WEDGE_WIDTH;
      return [Math.ceil(totalWidth), Math.ceil(height + paddingY)];
    }
    case "Callout": {
      let baseHeight = height + paddingY;
      if (baseHeight < DEFAULT_TIP_HEIGHT) {
        baseHeight *= 2;
      } else {
        baseHeight += DEFAULT_TIP_HEIGHT;
      }
      return [Math.ceil(width + paddingX), Math.ceil(baseHeight)];
    }
    case "Person": {
      let totalWidth = width + paddingX;
      const shoulderWidth = (totalWidth * PERSON_SHOULDER_WIDTH_FACTOR) / (1 - 2 * PERSON_SHOULDER_WIDTH_FACTOR);
      totalWidth += 2 * shoulderWidth;
      let totalHeight = height + paddingY;
      [totalWidth, totalHeight] = limitAR(totalWidth, totalHeight, PERSON_AR_LIMIT);
      return [Math.ceil(totalWidth), Math.ceil(totalHeight)];
    }
    case "C4Person": {
      const contentWidth = width + paddingX;
      const contentHeight = height + paddingY;
      let totalWidth = contentWidth / 0.9;
      const headRadius = totalWidth * HEAD_RADIUS_FACTOR;
      const headCenterY = headRadius;
      const bodyTop = headCenterY + headRadius * BODY_TOP_FACTOR;
      const verticalPadding = totalWidth * 0.06;
      let totalHeight = contentHeight + bodyTop + verticalPadding;
      const minHeight = totalWidth * 0.95;
      if (totalHeight < minHeight) {
        totalHeight = minHeight;
      }
      [totalWidth, totalHeight] = limitAR(totalWidth, totalHeight, C4_PERSON_AR_LIMIT);
      return [Math.ceil(totalWidth), Math.ceil(totalHeight)];
    }
    case "Package": {
      const innerHeight = height + paddingY;
      const topHeight = (innerHeight * PACKAGE_VERTICAL_SCALAR) / (1 - PACKAGE_VERTICAL_SCALAR);
      const totalHeight = innerHeight + Math.min(topHeight, PACKAGE_TOP_MAX_HEIGHT);
      return [Math.ceil(width + paddingX), Math.ceil(totalHeight)];
    }
    default: {
      return [Math.ceil(width + paddingX), Math.ceil(height + paddingY)];
    }
  }
}
