// Slice 50 — public layout options and seed normalization.
//
// Pinned reference: d2layouts/d2talalayout/layout.go (Options, DefaultOptions,
// normalizeSeeds, seedsFromData, layoutPlan, defaultSeedConcurrency).

export const MAX_SEEDS = 16;
export const MAX_SEED_ENTRIES = MAX_SEEDS * 4;
export const DEFAULT_MAX_SEED_CONCURRENCY = 4;
export const DEFAULT_SEEDS = Object.freeze([1n, 2n, 3n]);

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const PUBLIC_OPTION_KEYS = new Set(['seed', 'seeds', 'maxConcurrency', 'signal']);

/**
 * defaultSeedConcurrency mirrors Go min(GOMAXPROCS, 4) using the browser's
 * hardware concurrency (fallback 4). No Node APIs.
 */
export function defaultSeedConcurrency() {
  const hardware = globalThis.navigator?.hardwareConcurrency;
  const available = Number.isSafeInteger(hardware) && hardware > 0 ? hardware : DEFAULT_MAX_SEED_CONCURRENCY;
  return Math.min(available, DEFAULT_MAX_SEED_CONCURRENCY);
}

/** defaultOptions returns a NEW options object every call. */
export function defaultOptions() {
  return {
    seeds: DEFAULT_SEEDS.map((seed) => Number(seed)),
    maxConcurrency: defaultSeedConcurrency(),
  };
}

/**
 * toInt64Seed converts one public seed value (safe-integer Number, BigInt, or
 * an exact base-10 integer string) to a signed 64-bit BigInt, or throws.
 */
export function toInt64Seed(value, index) {
  let seed = null;
  if (typeof value === 'bigint') {
    seed = value;
  } else if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) seed = BigInt(value);
  } else if (typeof value === 'string' && /^[+-]?[0-9]+$/.test(value)) {
    seed = BigInt(value);
  }
  if (seed == null || seed < INT64_MIN || seed > INT64_MAX) {
    throw new Error(`invalid tala seed at index ${index} (${String(value)}): must be a signed 64-bit integer`);
  }
  return seed;
}

/** normalizeSeeds: dedupe preserving first occurrence; enforce entry and unique limits. */
export function normalizeSeeds(seeds) {
  if (seeds == null || seeds.length === 0) {
    throw new Error('tala requires at least one seed');
  }
  if (seeds.length > MAX_SEED_ENTRIES) {
    throw new Error(`tala accepts at most ${MAX_SEED_ENTRIES} seed entries`);
  }
  const unique = [];
  const seen = new Set();
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    seen.add(seed);
    unique.push(seed);
    if (unique.length > MAX_SEEDS) {
      throw new Error(`tala supports at most ${MAX_SEEDS} unique seeds`);
    }
  }
  return unique;
}

/** seedsFromList mirrors seedsFromData: list check, entry limit, then per-entry parsing. */
export function seedsFromList(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('tala seeds must be a list of signed 64-bit integers');
  }
  if (raw.length > MAX_SEED_ENTRIES) {
    throw new Error(`tala accepts at most ${MAX_SEED_ENTRIES} seed entries`);
  }
  return raw.map((value, index) => toInt64Seed(value, index));
}

/**
 * validatePublicOptions checks option shape (unknown keys, seed vs seeds,
 * signal type) without normalizing seeds.
 */
export function validatePublicOptions(options) {
  if (options == null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('TALA layout options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!PUBLIC_OPTION_KEYS.has(key)) {
      throw new Error(`unknown TALA layout option "${key}"`);
    }
  }
  if (options.seed !== undefined && options.seeds !== undefined) {
    throw new Error('TALA layout options must not specify both seed and seeds');
  }
  return options;
}

/**
 * layoutPlan → { seeds: BigInt[], concurrency }. Mirrors Go layoutPlan:
 * seeds default to [1, 2, 3]; MaxConcurrency 0/undefined selects the default,
 * must be within 1..16, and is clamped to the seed count.
 */
export function layoutPlan(options) {
  const opts = validatePublicOptions(options);
  let seeds;
  if (opts.seed !== undefined) {
    seeds = seedsFromList([opts.seed]);
  } else if (opts.seeds !== undefined) {
    seeds = seedsFromList(opts.seeds);
  } else {
    seeds = DEFAULT_SEEDS.slice();
  }
  seeds = normalizeSeeds(seeds);
  let concurrency = opts.maxConcurrency ?? 0;
  if (!Number.isSafeInteger(concurrency)) {
    throw new Error(`tala MaxConcurrency must be between 1 and ${MAX_SEEDS}, or zero for the default`);
  }
  if (concurrency === 0) {
    concurrency = defaultSeedConcurrency();
  }
  if (concurrency < 0 || concurrency > MAX_SEEDS) {
    throw new Error(`tala MaxConcurrency must be between 1 and ${MAX_SEEDS}, or zero for the default`);
  }
  if (concurrency > seeds.length) {
    concurrency = seeds.length;
  }
  return { seeds, concurrency };
}
