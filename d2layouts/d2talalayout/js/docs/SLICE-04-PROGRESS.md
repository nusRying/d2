# Slice 04 Progress: LayoutGraph Structural Core & Stable Entity IDs

## Goal
Replace the minimal Slice 01 graph placeholders with a TALA-compatible structural graph model that later Go→JS algorithm ports can rely on:
- Stable numeric `EntityID` semantics and FNV-1a allocation
- `Graph` / `Node` / `Edge` ownership and container hierarchy
- Adjacency, near relationships, connect / disconnect / reconnect
- Canonical node geometry embedded as `geo.Box`
- Bidirectional lookup indexes and persistent endpoint registries
- Full clone isolation, validation, and reference rebinding
- ELK boundary adapter preserving absolute geometry and untouched multi-section routes
Without implementing concrete layout algorithms (placement, packing, routing, labeling).

## Approved Base
`87f84dd951e50f3c0b2f3e04e86ce247e1d51cf5` (Approved Slice 03 geometry parity head)

## D2 Reference Base SHA
`01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version
`go version go1.27.0 windows/amd64`

## Source Files Studied
- `d2layouts/d2talalayout/internal/layoutgraph/id.go`
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go`
- `d2layouts/d2talalayout/internal/layoutgraph/node.go`
- `d2layouts/d2talalayout/internal/layoutgraph/edge.go`
- `d2layouts/d2talalayout/internal/layoutgraph/clone.go`
- `d2layouts/d2talalayout/adapter.go`
- `lib/geo/box.go`, `lib/geo/point.go`, `lib/geo/orientation.go`

---

## Architecture & Technical Decisions

### 1. EntityID Design & Allocation
- **Type**: Native JavaScript `BigInt` guarantees lossless 64-bit integer representation matching Go's `int64` and `uint32` allocation spaces.
- **Hash Function**: 32-bit FNV-1a hash (`d2FNV32`) using `Math.imul` multiplication with prime `0x01000193` over UTF-8 encoded bytes.
- **Spill Allocation**: When hashes collide or evaluate to 0, linear spill allocation begins at `firstD2SpillEntityID = 1n << 32n` (`4294967296n`).
- **Comparator**: Collision tie-breaking uses byte-wise UTF-8 lexicographical comparison (`compareGoStringsUTF8`).

### 2. Verified FNV Collision & Spill Parity
Verified with strings `lKWF05zzXT` and `bls2q7BifE`:
- Both produce identical 32-bit FNV-1a hash: `3524517778`
- Byte ordering `bls2q7BifE` < `lKWF05zzXT`
- Deterministic spill assignment:
  - `bls2q7BifE` -> `4294967296n`
  - `lKWF05zzXT` -> `4294967297n`
- Identical assignment regardless of input arrival order.

### 3. UTF-8 vs UTF-16 Comparison Difference
Go compares strings byte-by-byte in UTF-8, whereas JavaScript natively compares UTF-16 code units.
- For code points `U+E000` and `U+10000`:
  - `U+E000` encodes to UTF-8 bytes `0xEE 0x80 0x80`
  - `U+10000` encodes to UTF-8 bytes `0xF0 0x90 0x80 0x80`
  - In Go UTF-8: `0xEE < 0xF0` => `U+E000 < U+10000` (result: `-1`)
  - In naive JS UTF-16: `"\uE000"` (0xE000) > `"\u{10000}"` (`\uD800\uDC00`, lead surrogate 0xD800) => `"\uE000" > "\u{10000}"` (result: `+1`)
- `compareGoStringsUTF8` ensures exact Go ordering across all platforms.

### 4. Graph & Node Geometry Representation
- `Node` embeds a persistent `geo.Box` (`this.Box = new Box(null, width, height)`).
- `TopLeft`, `Width`, and `Height` are getters/setters delegating directly to `this.Box`.
- `Graph.Containers` is a `Map` tracking hierarchical containment with root at `null`.
- `NewGraphDefaults`: `IsRootHierarchy = false`, `CellSize = 0`, `Containers.size = 0`.

### 5. Level Calculation
Exact Go recursive semantics:
```js
level() {
  if (this.Container) {
    return 1 + this.Container.level();
  }
  return 1;
}
```
- Top-level node: 1
- Child node: 2
- Grandchild node: 3

### 6. connectionTo Semantics
Scans the node's `Edges` list:
- Directed or undirected connection to another node: `(edge.From === this && edge.To === other) || (edge.To === this && edge.From === other)`
- Self-loop: when `this === other`, checks `edge.From === this && edge.To === this`

### 7. AddEdge Exact-Object Deduplication
Matches Go `slices.Contains`:
```js
AddEdge(edge) {
  if (this.Edges.includes(edge)) {
    return;
  }
  this.Edges.push(edge);
}
```
Does not deduplicate distinct edge instances having identical fields.

### 8. Disconnect Loop Semantics & Reconnect
- `edge.Reconnect(newEndpoint, isTo)` removes edge from old node and adds to new node.
- `Graph.disconnect(edge)` unconditionally removes edge from both `From` and `To`:
  ```js
  disconnect(edge) {
    if (!edge) return;
    if (edge.From) edge.From.removeEdge(edge);
    if (edge.To) edge.To.removeEdge(edge);
    ...
  }
  ```
  If an edge was reconnected into a loop (`A -> B` reconnected `From -> B` => `B -> B`), `B.Edges` initially contains two references. `disconnect` removes both references, leaving `B.Edges` with 0 references.

### 9. ComputeCellSize Implementation
Literal Go-shaped structure tracking min/max dimensions across all nodes:
```js
computeCellSize() {
  let minHeight = Infinity;
  let minWidth = Infinity;
  let maxHeight = -Infinity;
  let maxWidth = -Infinity;

  for (const node of this.Nodes) {
    minWidth = Math.min(minWidth, node.Width);
    minHeight = Math.min(minHeight, node.Height);
    maxWidth = Math.max(maxWidth, node.Width);
    maxHeight = Math.max(maxHeight, node.Height);
  }

  const minLength = Math.min(minWidth, minHeight);
  const maxLength = Math.max(maxWidth, maxHeight);

  if (maxLength < 3 * minLength) {
    this.CellSize = Math.ceil(maxLength);
  } else {
    this.CellSize = Math.ceil((3 * minLength) / 2);
  }

  this.CellSize = Math.max(this.CellSize, 10);
}
```
Naturally returns `10` for an empty graph without separate branches.

### 10. Clone Invariants & Validation
`cloneGraph(source)` guarantees:
- **Empty Containers**: When `source.Containers.size === 0`, skips container hierarchy check and returns clean empty `Containers` map.
- **Hierarchy Validation**: When `source.Containers.size > 0`, validates RDFS reachability from `null` and rejects unreachable containers.
- **Edge Validation**:
  - Rejects `null` / `undefined` edges
  - Rejects duplicate Edge objects appearing twice in `source.Edges`
  - Rejects duplicate non-zero Edge IDs
  - Allows multiple unassigned zero IDs (`0n`)
- **Metadata Independence**:
  - `node.elkData` and `edge.elkData` are deep-cloned via `structuredClone`. Mutating clone metadata never alters original metadata.
  - `edge.route`, `sourceEndpointId`, `targetEndpointId` preserved.
  - `endpoints` map preserves `{ kind: "node" | "port", node, port }`. Mutating cloned port properties never alters original port properties.
- **Index Rebinding**:
  - `nodesByExternalId`, `edgesByExternalId`, `nodesByEntityId`, `edgesByEntityId`, and `endpoints` point exclusively to cloned records.

### 11. ELK Boundary Integration & Route Passthrough
- Absolute internal coordinates converted to/from relative ELK coordinates during adapter conversion.
- Untouched multi-section routes with bendPoints and custom section metadata pass through the roundtrip unaltered when unrouted.

---

## Go Oracles & Reproducibility

Two canonical Go programs generate the test oracles:
1. `test/reference/go_entity_id_oracle.go` -> `test/fixtures/go-entity-id-reference.json`
2. `test/reference/go_layoutgraph_core_oracle.go` -> `test/fixtures/go-layoutgraph-core-reference.json`

Both generated twice with real Go (`go version go1.27.0 windows/amd64`) and verified byte-identical:
- `go-entity-id-reference.json` SHA256:
  `45797643D077F301108A1DECCC9B25105232F3F426319B1069B0E7CBAFB0CA99`
- `go-layoutgraph-core-reference.json` SHA256:
  `2233BFA7929021EF13745FE8AF2F7A17DB14DBDB596899A9252E47A52E6C3EC0`

---

## Audits

- **Math.random**: 0 occurrences in `src/`.
- **Browser-Safe Runtime**: 0 references to Node.js runtime built-ins (`fs`, `path`, `Buffer`, `process`, `crypto`) in `src/`.

---

## Full Authoritative Test Suite Results

Run from `d2layouts/d2talalayout/js`:
```powershell
bun test
```

```text
bun test v1.3.14 (0d9b296a)

test\graph\entity-id.test.js:
(pass) EntityID allocation parity with Go oracle [4.78ms]
(pass) Prove UTF-8 vs UTF-16 comparator difference (U+E000 vs U+10000) [0.44ms]
(pass) FNV collision and deterministic spill assignment invariant [0.29ms]

test\unit\adapter.test.js:
(pass) ELK Adapter > should parse a simple chain graph [2.38ms]
(pass) ELK Adapter > should parse nested containers [0.57ms]
(pass) ELK Adapter > should handle empty or missing arrays gracefully [0.11ms]
(pass) ELK Adapter > should accept an empty-string root ID [0.06ms]
(pass) ELK Adapter > should reject malformed input and missing ids [0.71ms]
(pass) ELK Adapter > should reject duplicate ids [0.26ms]
(pass) ELK Adapter > should reject invalid endpoint types explicitly [0.31ms]
(pass) ELK Adapter > should reject unknown endpoints [0.15ms]
(pass) ELK Adapter > should reject hyperedges [22.63ms]
(pass) ELK Adapter > should avoid inserting duplicate self-loops in edges array [0.20ms]
(pass) ELK Adapter > untouched multi-section ELK roundtrip preserves existing routes without mutation [1.39ms]
(pass) ELK Adapter > explicit port endpoint assertions on ports.json [0.22ms]
(pass) ELK Adapter > should update geometry and edge routes during round-trip [0.41ms]
(pass) ELK Adapter > should isolate references during cloneGraph including port endpoints and elkData [2.30ms]

test\unit\geometry.test.js:
(pass) Geometry Parity > Metadata and Package > Oracle Metadata [0.11ms]
(pass) Geometry Parity > Metadata and Package > PRECISION exported correctly [0.05ms]
(pass) Geometry Parity > Metadata and Package > Circular dependency check [0.24ms]
(pass) Geometry Parity > Math functions > Random Math Parity [4.12ms]
(pass) Geometry Parity > Math functions > goRound exact parity [1.08ms]
(pass) Geometry Parity > Math functions > truncateDecimals exact parity (including tiny negatives) [0.14ms]
(pass) Geometry Parity > Point operations > Random Point Parity [4.00ms]
(pass) Geometry Parity > Point operations > Point mutation semantics [0.21ms]
(pass) Geometry Parity > Point operations > Point getOrientation and onOrthogonalSegment [0.24ms]
(pass) Geometry Parity > Point operations > getMedianPoint exact parity [0.51ms]
(pass) Geometry Parity > Vector operations > Random Vector Parity [3.90ms]
(pass) Geometry Parity > Vector operations > Vector semantic operations [0.56ms]
(pass) Geometry Parity > Segment operations > Random Segment Parity [1.73ms]
(pass) Geometry Parity > Segment operations > Segment explicit semantic tests [0.27ms]
(pass) Geometry Parity > Box operations > Random Box Parity [2.00ms]
(pass) Geometry Parity > Box operations > Box explicit semantic tests [0.22ms]
(pass) Geometry Parity > Orientation operations > Orientation getOpposite, sameSide, etc. [0.38ms]
(pass) Geometry Parity > Intersection edge cases > IntersectionPoint explicit cases [0.22ms]
(pass) Geometry Parity > Special Numeric Cases > Float32 and Radians exact parity [0.34ms]

test\unit\graph.test.js:
(pass) LayoutGraph Structure > should maintain bidirectional connections and removals [0.31ms]
(pass) LayoutGraph Structure > Graph.AddEdge() exact-object behavior [0.07ms]
(pass) LayoutGraph Structure > Graph.disconnect() loop semantics after reconnecting to loop [0.11ms]
(pass) LayoutGraph Structure > should maintain container hierarchy [0.13ms]
(pass) LayoutGraph Structure > empty-container clone succeeds when Containers.size === 0 [0.25ms]
(pass) LayoutGraph Structure > rejects malformed non-empty container maps with unreachable records [0.17ms]
(pass) LayoutGraph Structure > validates edge records on clone (reject nil, reject duplicate object, validate IDs) [2.72ms]
(pass) LayoutGraph Structure > should establish near relationships stably [0.17ms]
(pass) LayoutGraph Structure > should clone cleanly isolating references and boundary fields [0.86ms]

test\unit\graph_oracle.test.js:
(pass) LayoutGraph Go Parity > NewGraphDefaults [0.07ms]
(pass) LayoutGraph Go Parity > NodeHierarchy [0.13ms]
(pass) LayoutGraph Go Parity > NodeLevel [0.11ms]
(pass) LayoutGraph Go Parity > Nears [0.34ms]
(pass) LayoutGraph Go Parity > Edges [0.13ms]
(pass) LayoutGraph Go Parity > ConnectionTo [0.24ms]
(pass) LayoutGraph Go Parity > Disconnect [0.15ms]
(pass) LayoutGraph Go Parity > AddEdgeExactObject [0.07ms]
(pass) LayoutGraph Go Parity > DisconnectLoop [0.09ms]
(pass) LayoutGraph Go Parity > Directions [0.15ms]
(pass) LayoutGraph Go Parity > ComputeCellSize [0.34ms]
(pass) LayoutGraph Go Parity > Ports [0.15ms]
(pass) LayoutGraph Go Parity > Reconnect [0.14ms]
(pass) LayoutGraph Go Parity > Clone [0.89ms]

test\unit\random.test.js:
(pass) GoRand constructor validation [5.89ms]
(pass) GoRand Int63 parity [6.14ms]
(pass) GoRand Float64 parity [6.06ms]
(pass) GoRand Int63n parity [7.22ms]
(pass) GoRand Int63n bounds validation [1.11ms]
(pass) GoRand mixed type progression [1.53ms]
(pass) GoRand independence of multiple instances [1.43ms]
(pass) GoRand Int63n rejection sampling proof [0.77ms]

 67 pass
 0 fail
 7668 expect() calls
Ran 67 tests across 6 files. [201.00ms]
```

---

## Limitations
Layout algorithms (hierarchy ranking, placement, packing, routing, labeling, clustering, tree detection, engine pipeline) are intentionally out of scope for Slice 04.

---

## Commit History
- `d79dca8` feat(tala-js): implement Slice 04 layoutgraph structural core
- `05d9dd0` fix(tala-js): slice 04 structural core review corrections
- `13a01e8` fix(tala-js): complete Slice 04 Go oracle parity for layoutgraph core
- `53ce8be` fix(tala-js): resolve remaining layoutgraph structural mismatches
- `fix(tala-js): close Slice 04 parity gaps` (Current)
