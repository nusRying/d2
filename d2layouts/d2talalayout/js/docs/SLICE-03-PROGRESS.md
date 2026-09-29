# Slice 03: Geometry Foundation & Parity

## Goal
Port the reusable geometry foundation required by TALA from Go to JavaScript with explicit behavioral parity tests, establishing exact numeric reproducibility.

## Progress
- ✅ Analyzed Go codebase (`lib/geo/math.go`, `lib/geo/point.go`, `lib/geo/vector.go`, `lib/geo/segment.go`, `lib/geo/box.go`, `lib/geo/orientation.go`).
- ✅ Adopted **Option B** coordinate representation (`Point.X` and `Point.Y`) to maximize future porting clarity.
- ✅ Created `docs/ADR-004-GEOMETRY-REPRESENTATION.md` to document the decision and strategy.
- ✅ Designed the `go_geometry_oracle.go` to extract precise deterministic responses directly from Go 1.27.0 for all basic operations, covering typical coordinates, exact bounds calculations, truncation via `float32`, and IEEE edge cases (NaN, -0, +/-Inf).
- ✅ Replaced unused `Rectangle` class with `Box` matching the Go implementation.
- ✅ Implemented JavaScript geometry classes mirroring Go structure exactly.
- ✅ Passed exact behavioral parity assertions against the oracle data.

## Next Steps
- Submit Slice 03 for technical review and approval.
- Wait for user instruction to begin Slice 04.
