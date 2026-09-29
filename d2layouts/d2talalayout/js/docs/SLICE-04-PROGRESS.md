# Slice 04 Progress

## Goal
Replace the minimal Slice 01 graph placeholders with a TALA-compatible structural graph model that later Go→JS algorithm ports can rely on.

## D2 Reference Base
`01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Toolchain
`go version go1.27.0 windows/amd64`
`GOROOT` and `GOTOOL` environment configurations apply depending on local settings.

## Overview
This slice refactors the minimal AST-to-graph translation placeholders created in Slice 01 to align with Go's `internal/layoutgraph` contracts. It establishes a correct and stable foundation for algorithm implementation without yet introducing routing or placement code.

### Completed Structural Features
1. **Stable Numeric EntityID Semantics**: 
    - Replaced the string IDs with deterministic `BigInt` based allocations.
    - Implemented a faithful replica of `hash.FNV32` and `allocateD2EntityIDs` for parity.
    - Verified against a Go-generated JSON oracle.
2. **Graph / Node / Edge Ownership**:
    - Embedded `geo.Box` structure as capitalized properties (`TopLeft`, `Width`, `Height`) inside `Node`.
    - Rewrote `Graph`, `Node`, and `Edge` to mirror Go struct references (arrays, properties).
3. **Hierarchy and Containers**:
    - Introduced `addNewNodeToContainer` and a `Containers` Map keeping track of nested structure.
4. **Adjacency and Nears**:
    - Introduced `addNear` tracking logic with stable ordering semantics.
5. **Connection Management**:
    - Introduced bidirectional explicit connect, disconnect, and reconnect methods in the API.
6. **Clone Isolation and Rebinding**:
    - Implemented `clone.js` mirroring `layoutgraph.Clone()`.
    - Fully preserves entity boundaries, cloning Points and properties cleanly without leaking external mutations.
7. **ELK Boundary Integration**:
    - Adapted the `adapter.js` mapper to consume ELK's relative node inputs, calculating the true absolute position assigned to the layoutgraph.
    - Preserved TALA's round-trip layout compatibility tests.

## Testing & Verifications
- Run `bun test` in the JS directory for 42 passing unit tests.
- Cross-language oracle provided in `test/reference/go_entity_id_oracle.go`.
- Structural tests available inside `test/unit/graph.test.js`.

## Next Steps
- Commit the Slice 04 functionality to `tala-js/slice-04-layoutgraph-core` branch.
- Request Review of Slice 04 LayoutGraph architecture.
