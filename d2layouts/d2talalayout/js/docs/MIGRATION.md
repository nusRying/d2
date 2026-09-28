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

## Migration strategy
Instead of translating the whole engine in one step, we use an incremental, parity-focused slice approach. 
The first slice establishes the foundational JavaScript graph structures and the ELK-to-internal conversion boundary, without any actual layout algorithms. Subsequent slices will port subsystems one at a time (e.g., deterministic RNG, geometry, hierarchy, placement, routing), using the existing Go engine as a specification and comparing outputs using automated round-trip tests and fixtures to ensure exact parity.

## Third-Party Provenance and Licensing
The JavaScript migration retains exact parity with the original Go behaviors. This requires porting specific Go components:
- **Go math/rand (Slice 02):** The JavaScript port includes a strict parity reproduction of Go 1.27.0's `math/rand` (specifically `int31`, `int63`, `float64`, and LFSR permutations). 
This port is distributed under the original BSD-style license used by the Go Authors. The `THIRD_PARTY_NOTICES.txt` file at the repository root contains the full copyright notice, conditions, and attribution for this port. Any modifications to this ported component must preserve the original behavior and comply with the included BSD-style license terms.
