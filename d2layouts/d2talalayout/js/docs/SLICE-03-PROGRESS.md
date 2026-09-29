# Slice 03: Geometry Foundation & Parity

## Goal
Port the reusable geometry foundation required by TALA from Go to JavaScript with explicit behavioral parity tests, establishing exact numeric reproducibility.

## D2 Reference Base
01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579

## Go Toolchain
go version go1.27.0 windows/amd64
GOVERSION: go1.27.0
GOROOT: C:\Program Files\Go
GOTOOLDIR: C:\Program Files\Go\pkg\tool\windows_amd64

## Progress
- ✅ Analyzed Go codebase (`lib/geo/math.go`, `lib/geo/point.go`, `lib/geo/vector.go`, `lib/geo/segment.go`, `lib/geo/box.go`, `lib/geo/orientation.go`).
- ✅ Adopted **Option B** coordinate representation (`Point.X` and `Point.Y`) to maximize future porting clarity.
- ✅ Created `docs/ADR-004-GEOMETRY-REPRESENTATION.md` to document the decision and strategy.
- ✅ Replaced unused `Rectangle` class with `Box` matching the Go implementation.
- ✅ Designed the `go_geometry_oracle.go` to extract precise deterministic responses directly from Go 1.27.0 for all basic operations, covering typical coordinates, exact bounds calculations, truncation via `float32`, and IEEE edge cases (NaN, -0, +/-Inf).
- ✅ Hardened `truncateDecimals` to properly handle JavaScript's negative zero (`-0`) mismatch.
- ✅ Explicitly defined and tested `PRECISION` exactly as in the Go implementation (`0.0001`).
- ✅ Adapted `Orientation` enum and `Vector` semantics to perfectly match Go logic, including 0-length vectors and collinear overlapping logic.
- ✅ Validated float64 equality exactly down to the IEEE-754 bit-pattern.
- ✅ Implemented JavaScript geometry classes mirroring Go structure exactly.
- ✅ Verified ESM module circular dependency safety (`Point`/`Vector`).
- ✅ Passed exact behavioral parity assertions against the oracle data (41 assertions, 7400+ specific expectations).

## Next Steps
- Slice 03 is ready for technical review and approval.
- Wait for user instruction to begin Slice 04.
