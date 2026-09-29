export function euclideanDistance(x1, y1, x2, y2) {
  if (x1 === x2) {
    return Math.abs(y1 - y2);
  } else if (y1 === y2) {
    return Math.abs(x1 - x2);
  } else {
    return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
  }
}

export function precisionCompare(a, b, e) {
  if (Math.abs(a - b) < e) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

export function truncateDecimals(v) {
  // Go uses float64(int(v*1000)) / 1000, which truncates towards zero.
  return Math.trunc(v * 1000) / 1000;
}

export function sign(i) {
  if (i < 0) {
    return -1;
  }
  if (i > 0) {
    return 1;
  }
  return 0;
}

// Internal helper for Go-compatible math.Round
// JavaScript's Math.round(-0.5) returns -0, but Go's math.Round(-0.5) returns -1.
// JavaScript rounds half values towards +infinity, Go rounds half values away from zero.
export function goRound(v) {
  let r = Math.round(v);
  if (v < 0 && v % 1 === -0.5) {
    r -= 1;
  }
  return r === 0 && v < 0 ? -0 : r;
}
