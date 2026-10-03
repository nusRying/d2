# TALA JavaScript Migration

## Problem understanding
TALA is a layout and edge-routing engine for D2. The existing implementation is written in Go. The goal of this migration is to port the engine to JavaScript so that it can be used natively in browser environments and JavaScript-based tools, enabling client-side layout generation without needing WebAssembly (if WASM is not ideal for the specific use-case) or server-side rendering.

The JS migration needs to accept an ELK-compatible node tree as input, perform TALA layouting in JavaScript, and return an ELK-compatible node tree containing node positions, dimensions, nested/container geometry, and routed edge sections/bend points. ELK input/output provides a standardized graph representation that is widely understood and already used by the D2 ecosystem for its other integrations.

## Existing architecture
Based on the Go implementation in `d2layouts/d2talalayout`:
- `d2talalayout` acts as the D2 integration boundary, adapting D2 graphs into TALA's representation.
- `internal/layoutgraph` owns the mutable graph used during layout (graph, node, edge, topology, shared geometry).
- Concrete algorithms live in dedicated packages (e.g., `hierarchy`, `placement`, `packing`, `routing`, `labeling`).
- `internal/engine` orchestrates these stages.
- Every seed exclusively owns its mutable TALA graph clone.
- The original D2 graph is only mutated after a completed graph has been validated and selected.

## Migration Roadmap
* Slice 01 — complete
* Slice 02 — complete
* Slice 03 — complete
* Slice 04 — complete
* Slice 05 — complete
* Slice 06 — complete
* Slice 07 — complete
* Slice 08 — complete
* Slice 09 — complete
* Slice 10 — complete
* Slice 11 — complete
* Slice 12 — complete
* Slice 13 — complete
* Slice 14 — complete
* Slice 15 — complete
* Slice 16 — complete
* Slice 17 — complete
* Slice 18 — complete
* Slice 19 — complete
* Slice 20 — complete
* Slice 21 — complete
* Slice 22 — complete
* Slice 23 — complete
* Slice 24 — complete
* Slice 25 — complete
* Slice 26 — complete
* Slice 27 — complete
* Slice 28 — complete
* Slice 29 — complete
* Slice 30 — complete
* Slice 31 — complete
* Slice 32 — complete
* Slice 33 — complete
* Slice 34 — complete
* Slice 35 — complete
* Slice 36 — complete
* Slice 37 — complete
* Slice 38 — complete
* Slice 39 — complete
* Slice 40 — complete
Slice 41 — implemented, awaiting review

## Third-Party Provenance and Licensing
The JavaScript migration retains exact parity with the original Go behaviors. This requires porting specific Go components:
- **Go math/rand (Slice 02):** The Slice 02 implementation reproduces the portions of Go `math/rand` needed by the current TALA code path: underlying `rngSource` state progression, `Uint64`, `Int63`, `Int63n` and `Float64` behavior. 
- **Go geometry (Slice 03):** Slice 03 ports the core `lib/geo` behavior required by the current TALA migration scope and validates selected numeric outputs against a deterministic Go oracle, including exact IEEE-754 comparisons where relevant.

The overall TALA JS project lives in the MPL-2.0 D2 repository. Portions of `go-math-rand.js` are derived from Go standard-library source. Those derived portions retain the Go Authors copyright and BSD attribution. `THIRD_PARTY_NOTICES.txt` records this provenance explicitly. Any modifications to this ported component must preserve the original behavior and comply with the included BSD-style license terms.
