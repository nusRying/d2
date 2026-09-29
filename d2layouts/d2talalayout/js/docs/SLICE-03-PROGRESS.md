# Slice 03: Core Geometry Parity

## Goal
Port the reusable geometry foundation required by TALA from Go to JavaScript with explicit behavioral parity tests. Provide a deterministic testing oracle based on Go's output.

## D2 Reference Base
`01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Toolchain
Generated via `runtime.Version()` in oracle.

## Source files studied
`lib/geo/math.go`, `lib/geo/orientation.go`, `lib/geo/point.go`, `lib/geo/vector.go`, `lib/geo/segment.go`, `lib/geo/box.go`

## Production TALA geometry usage inventory
The foundation is isolated as an ES module library used as a dependency for upcoming layout stages.

## Scope
Coordinate representation, Math/rounding semantics, Orientation contract, Mutation semantics. Excludes optimization or full D2 coverage beyond TALA needs.

## Geometry provenance
The geometry source is from D2 itself: `github.com/d2lang/d2/lib/geo` under the repository's MPL-2.0 licensing context.

## Precision
Retained exactly: `export const PRECISION = 0.0001;`

## Median support
JS empty median throws an explicit error: `getMedianPoint requires at least one point`

## TruncateDecimals negative-zero finding
Fixed to return `+0` in JS for inputs like `-0.0001` matching Go's behavior `float64(int(v*1000)) / 1000`.

## Zero-vector Unit finding
Fixed `Vector{0,0}.Unit()` to return `NaN` components matching Go's IEEE-754 `1 / 0 = +Inf, 0 * +Inf = NaN`.

## Oracle metadata
Fixture `runtimeGoVersion` is now generated dynamically using `runtime.Version()`.

## Randomized case count
Oracle tests across all models with deterministic sequences.

## Median oracle cases
Median test parity checks cases including single point, odd count, even count, negative coordinates, duplicates, and unsorted input points using full reconstruction.

## IEEE bit comparisons
Raw IEEE-754 hex representations checked via `DataView.getUint8`.

## Orientation contract
Matches exported Go-style semantics exactly. Final review found that Orientation.NONE had been given the string "NONE" in JavaScript, while Go's ToString falls through to the default empty string. The JS implementation and parity test were corrected to return "" and are backed by the Go oracle fixture.

## Mutation semantics
Points and Vectors mutate locally as in Go.

## Full regression result
41 pass
0 fail
7455 expect() calls
3 test files

## Oracle reproducibility SHA256
Oracle SHA256: DE12A93BFE9D3C885EAF68F4E60197971D441A2B3BE9557AE2662829E0DAAAED

## Math.random audit
0 occurrences found.

## Performance sanity
Informational benchmarking confirms acceptable layout geometry operations.

## Scratch-file cleanup
Temporary `test_go_behaviors.go` and `update_geometry_tests.js` removed.

## Result
Complete.
