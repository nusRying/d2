import { Box } from "../geometry/box.js";
import { Point } from "../geometry/point.js";
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
      const r = (rx * ry) / Math.sqrt(Math.pow(rx * sin, 2) + Math.pow(ry * cos, 2));
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
