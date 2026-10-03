const BOUND = Number.MAX_VALUE / 8;

/**
 * obstructionBounds encloses the straight, L-shaped, and alternate midpoint
 * routes considered by placement scoring.
 * Pinned Go: placementcost.obstructionBounds
 */
export class ObstructionBounds {
  constructor(left = 0, top = 0, right = 0, bottom = 0, usable = false) {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    this.usable = usable;
  }

  including(other) {
    return new ObstructionBounds(
      Math.min(this.left, other.left),
      Math.min(this.top, other.top),
      Math.max(this.right, other.right),
      Math.max(this.bottom, other.bottom),
      this.usable && other.usable,
    );
  }

  excludes(node) {
    if (!this.usable || node == null || node.TopLeft == null) {
      return false;
    }
    const x = node.TopLeft.X;
    const y = node.TopLeft.Y;
    const right = x + node.Width;
    const bottom = y + node.Height;

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
      return false;
    }
    return (x < this.left && right < this.left) ||
      (x > this.right && right > this.right) ||
      (y < this.top && bottom < this.top) ||
      (y > this.bottom && bottom > this.bottom);
  }
}

export function scoringNodeBounds(node) {
  if (node == null || node.TopLeft == null) {
    return new ObstructionBounds(0, 0, 0, 0, false);
  }
  const x = node.TopLeft.X;
  const y = node.TopLeft.Y;
  const right = x + node.Width;
  const bottom = y + node.Height;

  const usable = x >= -BOUND && x <= BOUND && y >= -BOUND && y <= BOUND &&
    right >= -BOUND && right <= BOUND && bottom >= -BOUND && bottom <= BOUND;

  return new ObstructionBounds(
    Math.min(x, right),
    Math.min(y, bottom),
    Math.max(x, right),
    Math.max(y, bottom),
    usable,
  );
}
