// Go math package functions whose results JS built-ins do not reproduce bit
// for bit (pinned Go authority 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579).
//
// math.Pow with a non-integer exponent is intentionally NOT ported: on amd64
// it goes through math.Exp/math.Log assembly whose FMA path is selected by
// CPU features, so pinned Go itself is not bit-stable across machines there.

const scratch = new DataView(new ArrayBuffer(8));

export function float64bits(x) {
  scratch.setFloat64(0, x);
  return scratch.getBigUint64(0);
}

export function float64frombits(b) {
  scratch.setBigUint64(0, BigInt.asUintN(64, b));
  return scratch.getFloat64(0);
}

export function signbit(x) {
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
export function frexp(f) {
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
export function ldexp(frac, exp) {
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
