// Slice 47 — routing geometry kernels.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/geometry.go

import { goMax, goMin } from '../geometry/go-math.js';

/** segmentIntersectsBox: Liang–Barsky clip of a closed segment against a box. */
export function segmentIntersectsBox(first, second, box) {
  if (first == null || second == null || box == null || box.TopLeft == null) {
    return false;
  }
  const left = goMin(box.TopLeft.X, box.TopLeft.X + box.Width);
  const right = goMax(box.TopLeft.X, box.TopLeft.X + box.Width);
  const top = goMin(box.TopLeft.Y, box.TopLeft.Y + box.Height);
  const bottom = goMax(box.TopLeft.Y, box.TopLeft.Y + box.Height);
  if (
    goMax(first.X, second.X) < left || right < goMin(first.X, second.X) ||
    goMax(first.Y, second.Y) < top || bottom < goMin(first.Y, second.Y)
  ) {
    return false;
  }
  const contains = (point) => left <= point.X && point.X <= right && top <= point.Y && point.Y <= bottom;
  if (contains(first) || contains(second)) {
    return true;
  }
  let tEnter = 0.0;
  let tExit = 1.0;
  const clipAxis = (start, delta, minCoord, maxCoord) => {
    if (delta === 0) {
      return minCoord <= start && start <= maxCoord;
    }
    let one = (minCoord - start) / delta;
    let two = (maxCoord - start) / delta;
    if (one > two) {
      [one, two] = [two, one];
    }
    tEnter = goMax(tEnter, one);
    tExit = goMin(tExit, two);
    return tEnter <= tExit;
  };
  if (!clipAxis(first.X, second.X - first.X, left, right) || !clipAxis(first.Y, second.Y - first.Y, top, bottom)) {
    return false;
  }
  return tEnter < tExit;
}

/** orientation of third relative to the directed line first→second. */
export function orientation(first, second, third) {
  const firstSecondX = second.X - first.X;
  const firstSecondY = second.Y - first.Y;
  const firstThirdX = third.X - first.X;
  const firstThirdY = third.Y - first.Y;
  return firstSecondY * firstThirdX - firstSecondX * firstThirdY;
}

/** intersects: closed-segment intersection, including collinear overlap. */
export function intersects(firstStart, firstEnd, secondStart, secondEnd) {
  const secondStartSide = orientation(firstStart, firstEnd, secondStart);
  const secondEndSide = orientation(firstStart, firstEnd, secondEnd);
  const firstStartSide = orientation(secondStart, secondEnd, firstStart);
  const firstEndSide = orientation(secondStart, secondEnd, firstEnd);
  if (secondStartSide === 0 && secondEndSide === 0 && firstStartSide === 0 && firstEndSide === 0) {
    return closedIntervalsOverlap(firstStart.X, firstEnd.X, secondStart.X, secondEnd.X) &&
      closedIntervalsOverlap(firstStart.Y, firstEnd.Y, secondStart.Y, secondEnd.Y);
  }
  return straddlesLine(secondStartSide, secondEndSide) && straddlesLine(firstStartSide, firstEndSide);
}

export function straddlesLine(first, second) {
  return first === 0 || second === 0 || (first < 0) !== (second < 0);
}

export function closedIntervalsOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  const firstMin = goMin(firstStart, firstEnd);
  const firstMax = goMax(firstStart, firstEnd);
  const secondMin = goMin(secondStart, secondEnd);
  const secondMax = goMax(secondStart, secondEnd);
  return firstMin <= secondMax && secondMin <= firstMax;
}
