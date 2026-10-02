# ADR-034: LayoutGraph Diagnostic IDs (`DebugID` Parity) (Slice 33)

## Status
Accepted

## Context
In TALA's layout graph data structures, diagnostic string representations (`DebugID()`) are used for logging, tracing, error formatting, and test diagnostics. In particular, subsequent proximity operations such as `proximity.ApplyVirally` rely on `node.DebugID()` for consistent conflict and assertion messaging.

Pinned references at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`:
- `Node.DebugID`: `d2layouts/d2talalayout/internal/layoutgraph/node.go`
- `Cluster.DebugID`: `d2layouts/d2talalayout/internal/layoutgraph/cluster.go`
- `Sequence.DebugID`: `d2layouts/d2talalayout/internal/layoutgraph/sequence.go`

## Design Parity Decisions

### 1. Free Helper `nodeDebugID` and Nil Receiver Handling
- In Go, `(*Node)(nil).DebugID()` is valid and returns `"nil"`.
- Since JavaScript does not permit method calls on `null` or `undefined`, a module-level free helper `nodeDebugID(node)` is exported in `src/graph/node.js`.
- `nodeDebugID(null)` and `nodeDebugID(undefined)` return `"nil"`.
- Instance methods `node.debugID()` and `node.DebugID()` invoke `nodeDebugID(this)`.
- `nodeDebugID` is used by `Cluster.DebugID` and `Sequence.DebugID` when formatting member nodes so that `null` members format as `"nil"`.

### 2. Strict Precedence Hierarchy
`Node.DebugID` evaluates in the exact order of pinned Go:
1. **Nil Check**: `node == null` -> `"nil"`.
2. **D2ID Precedence**: `if (node.D2ID != null) return node.D2ID`. This takes precedence over cluster vessel status, sequence vessel status, and numeric ID. Empty string `""` is preserved exactly without falling back to numeric ID.
3. **Cluster Vessel**: If `node.isClusterVessel`, formats `"Cluster vessel of: " + cluster.DebugID()`.
4. **Sequence Vessel**: If `node.Graph != null` and `node.Graph.Sequences` has an entry for `node`, formats `"Sequence vessel of: " + sequence.DebugID()`.
5. **Numeric Fallback**: Formats `node.ID` as canonical signed decimal string `BigInt(node.ID).toString(10)`.

### 3. Cluster-Over-Sequence Precedence
- When a node is both marked as `isClusterVessel` and present in `Graph.Sequences`, the cluster vessel branch precedes sequence detection, matching Go exactly.

### 4. Malformed State Parity
- Pinned Go does not guard `n.Graph` inside the `isClusterVessel` branch; dereferencing `n.Graph` or indexing a missing cluster panics. In JS, accessing `node.Graph.Clusters` or invoking `.DebugID()` on `undefined` naturally throws a `TypeError`.
- For sequences, Go evaluates `n.Graph != nil && len(n.Graph.Sequences) > 0`. If `node.Graph` is null or `Sequences` is empty/null, it safely falls back to numeric ID. If `node` is present in `Sequences` but mapped to `nil`, invoking `s.DebugID()` panics in Go and throws `TypeError` in JS.
- No artificial defensive guards or error normalizations are introduced.

### 5. Signed Int64 Decimal Serialization
- Fallback entity ID serialization uses `BigInt(node.ID).toString(10)` to preserve full 64-bit precision for `math.MinInt64` (`-9223372036854775808`) and `math.MaxInt64` (`9223372036854775807`) without locale commas or floating-point rounding.

### 6. Cluster and Sequence Formatting
- Both `Cluster.DebugID` and `Sequence.DebugID` preserve exact source-array member order.
- `Cluster.DebugID` formats as `[<members>]; Arrangement: <arrangement>`. An empty cluster produces `[]; Arrangement: ` (with a trailing space).
- `Sequence.DebugID` formats as `[<members>]`. An empty sequence produces `[]`.
- Calling `clusterDebugID(null)` or `sequenceDebugID(null)` naturally throws `TypeError`, matching Go's panic on nil cluster/sequence receivers.

### 7. Clean Import Direction
- `cluster.js` and `sequence.js` import `nodeDebugID` from `./node.js`.
- `node.js` does not import `cluster.js` or `sequence.js`; it calls polymorphic `.DebugID()` on the contained cluster/sequence instances.
- Zero circular dependencies are introduced.
- Neither helper is exported from root `src/index.js`.
