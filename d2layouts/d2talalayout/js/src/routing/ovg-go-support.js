// Slice 47 — private Go-semantics helpers for the OVG substrate.
//
// Not a port of one Go file: these helpers reproduce Go runtime/stdlib
// behavior the pinned routing sources rely on (map key semantics, uint64
// checked arithmetic from internal/limits, runtime panics, sort.Search,
// strconv/fmt/encoding/json float formatting).
//
// Pinned references:
//   internal/limits/checked.go — CheckedAddUint64, CheckedMulUint64
//   Go runtime map semantics — float keys compare with ==, +0 == -0, NaN is
//     never equal (every NaN insert creates a fresh entry); float-bearing keys
//     are rewritten on overwrite (needkeyupdate), so the stored key carries the
//     sign of the last assignment.
//   sort.Search / sort.SearchFloat64s / slices.Sort[float64]
//   strconv.FormatFloat(f, 'g', -1, 64) as used by fmt %v
//   encoding/json floatEncoder

import { goSortSlice } from '../packing/go-support.js';

export { goSortSlice };

export const MAX_UINT64 = 18446744073709551615n;
/** Go `int(^uint(0) >> 1)` on the 64-bit oracle platform. */
export const MAX_INT64 = 9223372036854775807n;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Number when exactly representable as a safe integer, else BigInt. */
export function normalizeUint64(value) {
  if (typeof value === 'bigint') {
    return value <= BigInt(MAX_SAFE) ? Number(value) : value;
  }
  return value;
}

/** limits.CheckedAddUint64 → [sum, ok]; the sum is Number when safe. */
export function checkedAddUint64(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const sum = a + b;
    if (sum <= MAX_SAFE) return [sum, true];
  }
  const sum = BigInt(a) + BigInt(b);
  if (sum > MAX_UINT64) return [0, false];
  return [normalizeUint64(sum), true];
}

/** limits.CheckedMulUint64 → [product, ok]. */
export function checkedMulUint64(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const product = a * b;
    if (product <= MAX_SAFE) return [product, true];
  }
  const product = BigInt(a) * BigInt(b);
  if (product > MAX_UINT64) return [0, false];
  return [normalizeUint64(product), true];
}

/** uint64 subtraction for operands known to satisfy a >= b. */
export function subUint64(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return normalizeUint64(BigInt(a) - BigInt(b));
}

/** uint64 integer division. */
export function divUint64(a, d) {
  if (typeof a === 'number') return Math.floor(a / d);
  return a / BigInt(d);
}

/** Go runtime panic for an out-of-range slice index. */
export function goIndexPanic(index, length) {
  // Go omits the length for a negative index (boundsNegErrorFmt).
  const message = index < 0
    ? `runtime error: index out of range [${index}]`
    : `runtime error: index out of range [${index}] with length ${length}`;
  const err = new Error(message);
  err.goPanic = true;
  return err;
}

/**
 * Go float64→int conversion on amd64 (CVTTSD2SI): truncation, with NaN, ±Inf
 * and out-of-range values producing math.MinInt64.
 */
export function goFloatToInt(f) {
  if (!(f > -9223372036854775808 && f < 9223372036854775808)) {
    return -9223372036854775808;
  }
  return Math.trunc(f) + 0;
}

/** slice[index] with Go's bounds check (nil slice has length 0). */
export function goIndex(slice, index) {
  const length = slice == null ? 0 : slice.length;
  if (index < 0 || index >= length) throw goIndexPanic(index, length);
  return slice[index];
}

/** sort.Search(n, f): smallest index in [0, n) at which f is true. */
export function goSearch(n, f) {
  let i = 0;
  let j = n;
  while (i < j) {
    const h = (i + j) >>> 1;
    if (!f(h)) {
      i = h + 1;
    } else {
      j = h;
    }
  }
  return i;
}

/** sort.SearchFloat64s(a, x). */
export function goSearchFloat64s(a, x) {
  return goSearch(a.length, (i) => a[i] >= x);
}

/**
 * slices.Sort / sort.Float64s for []float64. NaNs order first; equal values
 * are indistinguishable except for the sign of zero, which no caller observes.
 */
export function goSortFloat64s(values) {
  values.sort((a, b) => {
    const aNaN = a !== a;
    const bNaN = b !== b;
    if (aNaN || bNaN) return aNaN === bNaN ? 0 : (aNaN ? -1 : 1);
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  return values;
}

// ─── Go map key emulation ────────────────────────────────────────────────────

/**
 * GoFloatMap models Go `map[float64]V`. JS Map already folds -0 into +0; this
 * wrapper keeps the key as last assigned (Go rewrites float keys on overwrite)
 * and gives NaN Go semantics: lookups never match and every insert adds a new
 * entry. Iteration is insertion order (finite keys) followed by NaN entries;
 * Go's order is unspecified, see the ovg.js nondeterminism notes.
 */
export class GoFloatMap {
  constructor() {
    this._map = new Map();
    this._nan = null;
  }

  get size() {
    return this._map.size + (this._nan == null ? 0 : this._nan.length);
  }

  has(key) {
    if (key !== key) return false;
    return this._map.has(key);
  }

  get(key) {
    if (key !== key) return undefined;
    const entry = this._map.get(key);
    return entry === undefined ? undefined : entry.value;
  }

  set(key, value) {
    if (key !== key) {
      if (this._nan == null) this._nan = [];
      this._nan.push({ key, value });
      return this;
    }
    const entry = this._map.get(key);
    if (entry === undefined) {
      this._map.set(key, { key, value });
    } else {
      entry.key = key;
      entry.value = value;
    }
    return this;
  }

  *entries() {
    for (const entry of this._map.values()) yield [entry.key, entry.value];
    if (this._nan != null) {
      for (const entry of this._nan) yield [entry.key, entry.value];
    }
  }

  *keys() {
    for (const [key] of this.entries()) yield key;
  }

  *values() {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

/** pointMapKey: equal coordinates (with +0 == -0) share a key. */
function pointMapKey(x, y) {
  return `${x},${y}`;
}

/**
 * GoPointMap models Go `map[geo.Point]V`: keys are point VALUES (copied on
 * insert), coordinates compare with == (+0 == -0), a NaN coordinate never
 * matches, and an overwrite rewrites the stored key (last assignment wins).
 */
export class GoPointMap {
  constructor() {
    this._map = new Map();
    this._nan = null;
  }

  get size() {
    return this._map.size + (this._nan == null ? 0 : this._nan.length);
  }

  static _isNaNPoint(point) {
    return point.X !== point.X || point.Y !== point.Y;
  }

  has(point) {
    if (GoPointMap._isNaNPoint(point)) return false;
    return this._map.has(pointMapKey(point.X, point.Y));
  }

  get(point) {
    if (GoPointMap._isNaNPoint(point)) return undefined;
    const entry = this._map.get(pointMapKey(point.X, point.Y));
    return entry === undefined ? undefined : entry.value;
  }

  set(point, value) {
    const key = { X: point.X, Y: point.Y };
    if (GoPointMap._isNaNPoint(point)) {
      if (this._nan == null) this._nan = [];
      this._nan.push({ key, value });
      return this;
    }
    const mapKey = pointMapKey(point.X, point.Y);
    const entry = this._map.get(mapKey);
    if (entry === undefined) {
      this._map.set(mapKey, { key, value });
    } else {
      entry.key = key;
      entry.value = value;
    }
    return this;
  }

  /** Entries yield [{X, Y} key copy, value]. */
  *entries() {
    for (const entry of this._map.values()) yield [entry.key, entry.value];
    if (this._nan != null) {
      for (const entry of this._nan) yield [entry.key, entry.value];
    }
  }

  *keys() {
    for (const [key] of this.entries()) yield key;
  }

  *values() {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

/** Go `m[k] = append(m[k], value)` for a JS Map (pointer keys). */
export function mapAppend(map, key, ...values) {
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, values);
  } else {
    current.push(...values);
  }
}

// ─── Float formatting ────────────────────────────────────────────────────────

/** Shortest digits and decimal exponent of a finite non-zero |f|. */
function shortestDigits(abs) {
  const text = abs.toExponential();
  const ePos = text.indexOf('e');
  const mantissa = text.slice(0, ePos).replace('.', '');
  const exponent = Number(text.slice(ePos + 1));
  return [mantissa, exponent];
}

function formatExponentForm(neg, digits, exponent, minExpDigits) {
  let out = neg ? '-' : '';
  out += digits[0];
  if (digits.length > 1) out += `.${digits.slice(1)}`;
  const expSign = exponent < 0 ? '-' : '+';
  let expDigits = String(Math.abs(exponent));
  while (expDigits.length < minExpDigits) expDigits = `0${expDigits}`;
  return `${out}e${expSign}${expDigits}`;
}

/**
 * fmt %v of a float64: strconv.FormatFloat(f, 'g', -1, 64). Shortest digits;
 * exponent form when the decimal exponent is < -4 or >= 6 (shortest %g uses
 * precision 6 for the switch), with at least two exponent digits.
 */
export function goFormatFloatV(f) {
  if (f !== f) return 'NaN';
  if (f === Infinity) return '+Inf';
  if (f === -Infinity) return '-Inf';
  if (f === 0) return Object.is(f, -0) ? '-0' : '0';
  const neg = f < 0;
  const [digits, exponent] = shortestDigits(Math.abs(f));
  if (exponent < -4 || exponent >= 6) {
    return formatExponentForm(neg, digits, exponent, 2);
  }
  let out;
  if (exponent >= digits.length - 1) {
    out = digits + '0'.repeat(exponent - (digits.length - 1));
  } else if (exponent >= 0) {
    out = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  } else {
    out = `0.${'0'.repeat(-exponent - 1)}${digits}`;
  }
  return (neg ? '-' : '') + out;
}

/** fmt %v of a geo.Point value: "{X Y}". */
export function goFormatPointValue(point) {
  return `{${goFormatFloatV(point.X)} ${goFormatFloatV(point.Y)}}`;
}

/**
 * encoding/json float64 encoding: shortest round-trip digits, exponent form
 * below 1e-6 or from 1e21 (the same thresholds as Number#toString), "-0" for
 * negative zero, and an UnsupportedValueError for NaN and ±Inf.
 */
export function goJSONFloat(f) {
  if (f !== f || f === Infinity || f === -Infinity) {
    throw new Error(`json: unsupported value: ${goFormatFloatV(f)}`);
  }
  if (f === 0) return Object.is(f, -0) ? '-0' : '0';
  return String(f);
}
