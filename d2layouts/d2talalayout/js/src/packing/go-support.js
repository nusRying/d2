// Slice 46 — Go runtime semantics used by the packing port.
//
// Private helpers (not re-exported from js/src/packing/index.js). Each
// function cites the pinned Go source it reproduces bit for bit.

// layoutgraph/geometry_policy.go
export const NODE_GAP = 20;
export const CONNECTED_NODE_GAP = 60;
export const TABLE_NODE_GAP = 2 * CONNECTED_NODE_GAP;
export const CONTAINER_PADDING = 60;
// layoutgraph/geometry_policy.go MaxIconSize; d2 lib/label PADDING.
export const MAX_ICON_SIZE = 64;
export const LABEL_PADDING = 5;

/** invariant.ErrViolation wrapper (internal/invariant). */
export class InvariantViolationError extends Error {}

/** invariant.New (internal/invariant). */
export function invariantError(reason) {
  return new InvariantViolationError(`layout invariant violated: ${reason}`);
}

/** Go %d formatting for EntityID (uint64) values carried as BigInt. */
export function goID(id) {
  return id == null ? '0' : id.toString();
}

const scratch = new DataView(new ArrayBuffer(8));

function float64bits(x) {
  scratch.setFloat64(0, x);
  return scratch.getBigUint64(0);
}

function float64frombits(b) {
  scratch.setBigUint64(0, BigInt.asUintN(64, b));
  return scratch.getFloat64(0);
}

function signbit(x) {
  return x < 0 || Object.is(x, -0) || (Number.isNaN(x) && (float64bits(x) >> 63n) === 1n);
}

/** math.Max (dim.go; amd64 archMax has identical special cases). */
export function goMax(x, y) {
  if (x === Infinity || y === Infinity) return Infinity;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0 && x === y) return signbit(x) ? y : x;
  return x > y ? x : y;
}

/** math.Min (dim.go; amd64 archMin has identical special cases). */
export function goMin(x, y) {
  if (x === -Infinity || y === -Infinity) return -Infinity;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0 && x === y) return signbit(x) ? x : y;
  return x < y ? x : y;
}

/**
 * math.Hypot. On amd64 Go uses archHypot (hypot_amd64.s), which computes
 * max * sqrt(1 + (min/max)^2) exactly like the portable hypot.go.
 */
export function goHypot(p, q) {
  p = Math.abs(p);
  q = Math.abs(q);
  if (p === Infinity || q === Infinity) return Infinity;
  if (Number.isNaN(p) || Number.isNaN(q)) return NaN;
  if (p < q) {
    const t = p;
    p = q;
    q = t;
  }
  if (p === 0) return 0;
  q = q / p;
  return p * Math.sqrt(1 + q * q);
}

const SMALLEST_NORMAL = 2.2250738585072014e-308;

// math.normalize (bits.go)
function normalize(x) {
  if (Math.abs(x) < SMALLEST_NORMAL) {
    return [x * 2 ** 52, -52];
  }
  return [x, 0];
}

// math.frexp (frexp.go); amd64 has no arch Frexp.
function frexp(f) {
  if (f === 0 || !Number.isFinite(f)) return [f, 0];
  let exp;
  [f, exp] = normalize(f);
  let x = float64bits(f);
  exp += Number((x >> 52n) & 0x7ffn) - 1023 + 1;
  x &= ~(0x7ffn << 52n);
  x |= BigInt(-1 + 1023) << 52n;
  return [float64frombits(x), exp];
}

// math.ldexp (ldexp.go); amd64 has no arch Ldexp.
function ldexp(frac, exp) {
  if (frac === 0 || !Number.isFinite(frac)) return frac;
  let e;
  [frac, e] = normalize(frac);
  exp += e;
  let x = float64bits(frac);
  exp += Number((x >> 52n) & 0x7ffn) - 1023;
  if (exp < -1075) return frac < 0 || Object.is(frac, -0) ? -0 : 0;
  if (exp > 1023) return frac < 0 ? -Infinity : Infinity;
  let m = 1;
  if (exp < -1022) {
    exp += 53;
    m = 1.0 / 2 ** 53;
  }
  x &= ~(0x7ffn << 52n);
  x |= BigInt(exp + 1023) << 52n;
  return m * float64frombits(x);
}

/**
 * math.Pow(x, 2.0) (pow.go; amd64 has no arch Pow). The successive-squaring
 * branch rounds the squared mantissa and then Ldexp, which differs from a
 * plain x*x only for subnormal results; the port keeps Go's order.
 */
export function goPow2(x) {
  if (x === 1) return 1;
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (x === Infinity || x === -Infinity) return Infinity;
  let a1 = 1;
  let ae = 0;
  let [x1, xe] = frexp(x);
  for (let i = 2; i !== 0; i >>= 1) {
    if (xe < -(1 << 12) || (1 << 12) < xe) {
      ae += xe;
      break;
    }
    if ((i & 1) === 1) {
      a1 *= x1;
      ae += xe;
    }
    x1 *= x1;
    xe <<= 1;
    if (x1 < 0.5) {
      x1 += x1;
      xe--;
    }
  }
  return ldexp(a1, ae);
}

/**
 * PointKeySet mirrors Go map[geo.Point]struct{}: keys compare by float
 * equality (+0 == -0), and a NaN coordinate never matches any stored key.
 */
export class PointKeySet {
  constructor() {
    this._keys = new Set();
  }

  static key(point) {
    // String(-0) === "0", so +0/-0 share a key exactly as Go float equality.
    return `${point.X},${point.Y}`;
  }

  has(point) {
    if (Number.isNaN(point.X) || Number.isNaN(point.Y)) return false;
    return this._keys.has(PointKeySet.key(point));
  }

  add(point) {
    if (Number.isNaN(point.X) || Number.isNaN(point.Y)) return;
    this._keys.add(PointKeySet.key(point));
  }
}

/**
 * goSortSlice reproduces Go sort.Slice (pdqsort_func from sort/zsortfunc.go,
 * Go 1.27) exactly, including its unstable tie order. `less(a, b)` receives
 * elements rather than indices, which is equivalent because Go's less reads
 * the slice at the current indices.
 */
export function goSortSlice(data, less) {
  const swap = (i, j) => {
    const t = data[i];
    data[i] = data[j];
    data[j] = t;
  };
  const lessAt = (i, j) => less(data[i], data[j]);
  const bitsLen = (n) => (n === 0 ? 0 : 32 - Math.clz32(n));

  const insertionSort = (a, b) => {
    for (let i = a + 1; i < b; i++) {
      for (let j = i; j > a && lessAt(j, j - 1); j--) swap(j, j - 1);
    }
  };
  const siftDown = (lo, hi, first) => {
    let root = lo;
    for (;;) {
      let child = 2 * root + 1;
      if (child >= hi) break;
      if (child + 1 < hi && lessAt(first + child, first + child + 1)) child++;
      if (!lessAt(first + root, first + child)) return;
      swap(first + root, first + child);
      root = child;
    }
  };
  const heapSort = (a, b) => {
    const first = a;
    const hi = b - a;
    for (let i = Math.trunc((hi - 1) / 2); i >= 0; i--) siftDown(i, hi, first);
    for (let i = hi - 1; i >= 0; i--) {
      swap(first, first + i);
      siftDown(0, i, first);
    }
  };
  const swapsBox = { n: 0 };
  const order2 = (a, b) => {
    if (lessAt(b, a)) {
      swapsBox.n++;
      return [b, a];
    }
    return [a, b];
  };
  const median = (a, b, c) => {
    [a, b] = order2(a, b);
    [b, c] = order2(b, c);
    [a, b] = order2(a, b);
    return b;
  };
  const INCREASING = 1;
  const DECREASING = 2;
  const UNKNOWN = 0;
  const choosePivot = (a, b) => {
    const l = b - a;
    swapsBox.n = 0;
    let i = a + Math.trunc(l / 4) * 1;
    let j = a + Math.trunc(l / 4) * 2;
    let k = a + Math.trunc(l / 4) * 3;
    if (l >= 8) {
      if (l >= 50) {
        i = median(i - 1, i, i + 1);
        j = median(j - 1, j, j + 1);
        k = median(k - 1, k, k + 1);
      }
      j = median(i, j, k);
    }
    if (swapsBox.n === 0) return [j, INCREASING];
    if (swapsBox.n === 12) return [j, DECREASING];
    return [j, UNKNOWN];
  };
  const reverseRange = (a, b) => {
    let i = a;
    let j = b - 1;
    while (i < j) {
      swap(i, j);
      i++;
      j--;
    }
  };
  const partialInsertionSort = (a, b) => {
    let i = a + 1;
    for (let step = 0; step < 5; step++) {
      while (i < b && !lessAt(i, i - 1)) i++;
      if (i === b) return true;
      if (b - a < 50) return false;
      swap(i, i - 1);
      if (i - a >= 2) {
        for (let j = i - 1; j >= 1; j--) {
          if (!lessAt(j, j - 1)) break;
          swap(j, j - 1);
        }
      }
      if (b - i >= 2) {
        for (let j = i + 1; j < b; j++) {
          if (!lessAt(j, j - 1)) break;
          swap(j, j - 1);
        }
      }
    }
    return false;
  };
  const partition = (a, b, pivot) => {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    while (i <= j && lessAt(i, a)) i++;
    while (i <= j && !lessAt(j, a)) j--;
    if (i > j) {
      swap(j, a);
      return [j, true];
    }
    swap(i, j);
    i++;
    j--;
    for (;;) {
      while (i <= j && lessAt(i, a)) i++;
      while (i <= j && !lessAt(j, a)) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    swap(j, a);
    return [j, false];
  };
  const partitionEqual = (a, b, pivot) => {
    swap(a, pivot);
    let i = a + 1;
    let j = b - 1;
    for (;;) {
      while (i <= j && !lessAt(a, i)) i++;
      while (i <= j && lessAt(a, j)) j--;
      if (i > j) break;
      swap(i, j);
      i++;
      j--;
    }
    return i;
  };
  const MASK64 = (1n << 64n) - 1n;
  const breakPatterns = (a, b) => {
    const length = b - a;
    if (length >= 8) {
      let random = BigInt(length);
      const modulus = BigInt(2 ** bitsLen(length));
      const next = () => {
        random ^= (random << 13n) & MASK64;
        random ^= random >> 7n;
        random ^= (random << 17n) & MASK64;
        return random;
      };
      const base = a + Math.trunc(length / 4) * 2;
      for (let idx = base - 1; idx <= base + 1; idx++) {
        let other = Number(next() & (modulus - 1n));
        if (other >= length) other -= length;
        swap(idx, a + other);
      }
    }
  };
  // Explicit work stack in place of Go's recursion on the shorter side; the
  // processing order (shorter side fully, then loop on the longer side) is
  // identical because each recursive call completes before the loop resumes.
  const pdqsort = (a0, b0, limit0) => {
    const frames = [{ a: a0, b: b0, limit: limit0, wasBalanced: true, wasPartitioned: true }];
    while (frames.length > 0) {
      const f = frames[frames.length - 1];
      let done = false;
      for (;;) {
        const length = f.b - f.a;
        if (length <= 12) {
          insertionSort(f.a, f.b);
          done = true;
          break;
        }
        if (f.limit === 0) {
          heapSort(f.a, f.b);
          done = true;
          break;
        }
        if (!f.wasBalanced) {
          breakPatterns(f.a, f.b);
          f.limit--;
        }
        let [pivot, hint] = choosePivot(f.a, f.b);
        if (hint === DECREASING) {
          reverseRange(f.a, f.b);
          pivot = (f.b - 1) - (pivot - f.a);
          hint = INCREASING;
        }
        if (f.wasBalanced && f.wasPartitioned && hint === INCREASING) {
          if (partialInsertionSort(f.a, f.b)) {
            done = true;
            break;
          }
        }
        if (f.a > 0 && !lessAt(f.a - 1, pivot)) {
          f.a = partitionEqual(f.a, f.b, pivot);
          continue;
        }
        const [mid, alreadyPartitioned] = partition(f.a, f.b, pivot);
        f.wasPartitioned = alreadyPartitioned;
        const leftLen = mid - f.a;
        const rightLen = f.b - mid;
        const balanceThreshold = Math.trunc(length / 8);
        if (leftLen < rightLen) {
          f.wasBalanced = leftLen >= balanceThreshold;
          const child = { a: f.a, b: mid, limit: f.limit, wasBalanced: true, wasPartitioned: true };
          f.a = mid + 1;
          frames.push(child);
        } else {
          f.wasBalanced = rightLen >= balanceThreshold;
          const child = { a: mid + 1, b: f.b, limit: f.limit, wasBalanced: true, wasPartitioned: true };
          f.b = mid;
          frames.push(child);
        }
        break;
      }
      if (done) frames.pop();
    }
  };
  pdqsort(0, data.length, bitsLen(data.length));
  return data;
}

// ── strconv.ParseFloat(s, 64) ───────────────────────────────────────────────

function lower(c) {
  return c | 0x20;
}

const CH = (s) => s.charCodeAt(0);
const C0 = CH('0');
const C9 = CH('9');
const CA = CH('a');
const CF = CH('f');

// internal/strconv/atoi.go underscoreOK
function underscoreOK(s) {
  let saw = '^';
  let i = 0;
  if (s.length >= 1 && (s[0] === '-' || s[0] === '+')) s = s.slice(1);
  let hex = false;
  if (s.length >= 2 && s[0] === '0' && (lower(s.charCodeAt(1)) === CH('b') || lower(s.charCodeAt(1)) === CH('o') || lower(s.charCodeAt(1)) === CH('x'))) {
    i = 2;
    saw = '0';
    hex = lower(s.charCodeAt(1)) === CH('x');
  }
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((C0 <= c && c <= C9) || (hex && CA <= lower(c) && lower(c) <= CF)) {
      saw = '0';
      continue;
    }
    if (s[i] === '_') {
      if (saw !== '0') return false;
      saw = '_';
      continue;
    }
    if (saw === '_') return false;
    saw = '!';
  }
  return saw !== '_';
}

function commonPrefixLenIgnoreCase(s, prefix) {
  let n = Math.min(prefix.length, s.length);
  for (let i = 0; i < n; i++) {
    let c = s.charCodeAt(i);
    if (CH('A') <= c && c <= CH('Z')) c += CH('a') - CH('A');
    if (c !== prefix.charCodeAt(i)) return i;
  }
  return n;
}

// internal/strconv/atof.go special
function special(s) {
  if (s.length === 0) return null;
  let sign = 1;
  let nsign = 0;
  let rest = s;
  const c = s[0];
  if (c === '+' || c === '-' || c === 'i' || c === 'I') {
    if (c === '+' || c === '-') {
      if (c === '-') sign = -1;
      nsign = 1;
      rest = s.slice(1);
    }
    let n = commonPrefixLenIgnoreCase(rest, 'infinity');
    if (3 < n && n < 8) n = 3;
    if (n === 3 || n === 8) return { value: sign * Infinity, n: nsign + n };
  } else if (c === 'n' || c === 'N') {
    if (commonPrefixLenIgnoreCase(s, 'nan') === 3) return { value: NaN, n: 3 };
  }
  return null;
}

// Exact binary rounding (round-half-even, subnormals) of mant * 2^exp2,
// matching atofHex's sticky-bit rounding. Returns null on overflow (ErrRange).
function roundBinary(mant, exp2, neg) {
  if (mant === 0n) return neg ? -0 : 0;
  // Normalize to 55 significant bits plus sticky.
  const bitLen = mant.toString(2).length;
  // value = mant * 2^exp2; target unbiased exponent of leading bit.
  const lead = exp2 + bitLen - 1;
  if (lead < -1075) return neg ? -0 : 0;
  let precisionBits;
  if (lead >= -1022) {
    precisionBits = 53;
  } else {
    precisionBits = 53 - (-1022 - lead);
    if (precisionBits < 0) precisionBits = 0;
  }
  // Keep precisionBits bits; shift = bitLen - precisionBits.
  const shift = bitLen - precisionBits;
  let kept;
  if (shift > 0) {
    const s = BigInt(shift);
    kept = mant >> s;
    const rem = mant & ((1n << s) - 1n);
    const half = 1n << (s - 1n);
    if (rem > half || (rem === half && (kept & 1n) === 1n)) kept += 1n;
    exp2 += shift;
  } else {
    kept = mant;
  }
  if (kept === 0n) return neg ? -0 : 0;
  // value = kept * 2^exp2
  const keptLen = kept.toString(2).length;
  if (exp2 + keptLen - 1 > 1023) return null;
  let value = Number(kept);
  // Scale exactly by powers of two in safe steps.
  let e = exp2;
  while (e > 0) {
    const step = Math.min(e, 1000);
    value *= 2 ** step;
    e -= step;
  }
  while (e < 0) {
    const step = Math.min(-e, 1000);
    value /= 2 ** step;
    e += step;
  }
  if (!Number.isFinite(value)) return null;
  return neg ? -value : value;
}

/**
 * goParseFloat64 reproduces strconv.ParseFloat(s, 64)
 * (internal/strconv/atof.go): returns { value, ok } where ok is false for
 * every error (ErrSyntax and ErrRange). Decimal literals round exactly like
 * Go (correct IEEE rounding, the same result as JS Number()); hexadecimal
 * literals use exact BigInt rounding equivalent to atofHex.
 */
export function goParseFloat64(s) {
  const sp = special(s);
  if (sp != null) {
    return sp.n === s.length ? { value: sp.value, ok: true } : { value: 0, ok: false };
  }
  // readFloat
  let i = 0;
  let underscores = false;
  let neg = false;
  if (i >= s.length) return { value: 0, ok: false };
  if (s[i] === '+') i++;
  else if (s[i] === '-') {
    i++;
    neg = true;
  }
  let base = 10;
  let expChar = CH('e');
  let hex = false;
  if (i + 2 < s.length && s[i] === '0' && lower(s.charCodeAt(i + 1)) === CH('x')) {
    base = 16;
    i += 2;
    expChar = CH('p');
    hex = true;
  }
  let sawdot = false;
  let sawdigits = false;
  let digits = '';
  let fracDigits = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (s[i] === '_') {
      underscores = true;
      continue;
    }
    if (s[i] === '.') {
      if (sawdot) break;
      sawdot = true;
      continue;
    }
    if (C0 <= c && c <= C9) {
      sawdigits = true;
      digits += s[i];
      if (sawdot) fracDigits++;
      continue;
    }
    if (base === 16 && CA <= lower(c) && lower(c) <= CF) {
      sawdigits = true;
      digits += s[i];
      if (sawdot) fracDigits++;
      continue;
    }
    break;
  }
  if (!sawdigits) return { value: 0, ok: false };
  let e = 0;
  let esign = 1;
  let hasExp = false;
  if (i < s.length && lower(s.charCodeAt(i)) === expChar) {
    i++;
    if (i >= s.length) return { value: 0, ok: false };
    if (s[i] === '+') i++;
    else if (s[i] === '-') {
      i++;
      esign = -1;
    }
    if (i >= s.length || s.charCodeAt(i) < C0 || s.charCodeAt(i) > C9) return { value: 0, ok: false };
    for (; i < s.length && ((C0 <= s.charCodeAt(i) && s.charCodeAt(i) <= C9) || s[i] === '_'); i++) {
      if (s[i] === '_') {
        underscores = true;
        continue;
      }
      if (e < 10000) e = e * 10 + (s.charCodeAt(i) - C0);
    }
    hasExp = true;
  } else if (base === 16) {
    return { value: 0, ok: false };
  }
  if (underscores && !underscoreOK(s.slice(0, i))) return { value: 0, ok: false };
  if (i !== s.length) return { value: 0, ok: false };
  if (!hex) {
    // Correctly rounded decimal; overflow is ErrRange.
    const cleaned = `${neg ? '-' : ''}${digits.slice(0, digits.length - fracDigits) || '0'}.${digits.slice(digits.length - fracDigits)}e${hasExp ? esign * e : 0}`;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) return { value, ok: false };
    return { value, ok: true };
  }
  const mant = BigInt(`0x${digits}`);
  const value = roundBinary(mant, esign * e - 4 * fracDigits, neg);
  if (value == null) return { value: neg ? -Infinity : Infinity, ok: false };
  return { value, ok: true };
}
