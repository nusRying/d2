# ADR 003: Go math/rand Deterministic Parity

## Status
Accepted (Slice 02)

## Context
D2's TALA layout engine uses Go's `math/rand` to orchestrate deterministic, seeded graph operations (such as node placement, clustering, packing, and sequences).
Because these layouts must remain structurally stable (the exact same dimensions and placements across renders of the identical script),
the RNG parity must be precise down to the exact bit.

For a JavaScript migration, we cannot use `Math.random()` or standard deterministic PRNGs (like Mersenne Twister) without rewriting all TALA algorithmic usages.
Additionally, Go's PRNG uses a highly specific combination of:
1. Mitchell & Reeds LFSR state progression (with 607 integers of cooked startup state)
2. A 31-bit integer LCG warmup (`seedrand` algorithm)
3. Bit masking for power-of-2 distributions
4. Exact rejection sampling boundaries (`Int63n`)
5. Specific behavior for floating point mapping around `1.0` (`Float64`)

## Decision
We will implement an exact bit-for-bit parity clone of Go's `math/rand` package in JavaScript (`GoRand`), using:
- ES6 `BigInt` for 64-bit precision without losing fidelity (as JavaScript's `Number` is limited to 53 bits).
- Direct ported algorithms for LFSR `Seed()` logic and bounds rejection in `Int63n()`.
- Go-compatible precision mapping for `Float64()`, ensuring the exact same IEEE-754 bit representations are generated.

We will validate the JS implementation against an oracle script (`go_rand_oracle.go`) that generates `Float64` bitstrings, mixed sequences, and `Int63n` values across bounds including edge cases (`0`, `-1`, `-2147483648`, `9223372036854775807`).

## Consequences
- Requires use of ES6 `BigInt`, capping our backwards compatibility to ES2020.
- All layout seeds must be parsed as `BigInt` or wrapped natively.
- Ensures TALA routing outputs in JavaScript can be directly diffed structurally against Go's rendering.
