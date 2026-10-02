# ADR-032: Herd Discovery (`GroupSheep`) (Slice 31)

## Status
Implemented — awaiting Slice 31 review

## Context
In TALA's proximity and herding pipeline, `proximity.GroupSheep(ctx, graph, root, abductions)` groups the direct children of a root container by their external uncle and records the cousin connections that define each group. It is the discovery kernel underlying `AssignHerds`, establishing which sibling nodes share external connections into sibling containers.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Design Parity Decisions

### 1. Direct Context Polling (No WorkGuard)
Unlike `AssignNears`, `GroupSheep` in Go does not use `limits.WorkGuard`, `validateEngineGraph`, `GraphState`, or transactions. It directly polls `ctx.Err()`.
The JS port mirrors this exactly:
- No `WorkGuard` is instantiated.
- Cancellation checks occur directly via `checkAssignHerdsCancellation(context)`.
- If cancelled, throws `WorkCanceledError("AssignHerds")`, producing the exact Go error string `"AssignHerds: context canceled"`.

### 2. Exact Cancellation Placement and Root Children Parity
- Cancellation is checked:
  1. Once at the start of each direct child iteration in `graph.Containers[root]`.
  2. Once at the start of each abduction iteration for that child, **before** inspecting `used[i]`.
- If `graph.Containers[root]` is empty, the outer loop body never executes, so zero cancellation checks occur. Consequently, even a pre-cancelled context returns `{ byUncle: new Map(), toCousin: new Map() }` when the root has no children.

### 3. Nil Graph and Containers Semantics
- In Go, `for _, node := range graph.Containers[root]` naturally panics when `graph == nil`.
- When `graph.Containers == nil`, Go safely evaluates map indexing and returns a zero-length slice.
- In JS:
  ```javascript
  const children = graph.Containers?.get(root) ?? [];
  ```
  `graph == null` naturally throws `TypeError`, while `graph.Containers == null` returns empty children safely.

### 4. Source Ordering and Global `used` Array
- Direct children are scanned in exact source-array order without sorting.
- Abductions are scanned in exact source-array order without sorting.
- A single boolean array `used = new Array(abductions.length).fill(false)` is shared across all root children. Once an abduction is consumed by any child, it is never considered by subsequent children.

### 5. Single-Use Abduction Consumption Point
- `used[i] = true` is set immediately after resolving `cousin` and before climbing or validating the final uncle.
- If climbing later reaches a nil uncle or an uncle where `isContainer` is false, the abduction remains marked `used` and is permanently consumed.

### 6. `groupVessel` and `descendantOf` Semantics
- `groupVessel(node)`:
  - If `node.Cluster != null`, returns `node.Cluster.Vessel`.
  - Else if `node.Sequence != null`, returns `node.Sequence.Vessel`.
  - Cluster takes precedence over Sequence. Active status is not inspected.
- `descendantOf(node, ancestor)`:
  - Loop checks `node === ancestor` first.
  - Follows `node.Container` > `node.Cluster.Vessel` > `node.Sequence.Vessel`.
  - When chain terminates at null, returns `ancestor == null`.
  - No cycle detection or WorkGuard.

### 7. Branch Evaluation and Forward Precedence
- Forward branch: `abduction.OriginallyTo != null && (from === node || descendantOf(from, node))`.
- Reverse branch: `else if (abduction.OriginallyFrom != null && (to === node || descendantOf(to, node)))`.
- If both could match, forward branch takes precedence; reverse branch is never evaluated.
- Non-nil `CurrentTo` / `CurrentFrom` must have `isContainer === true`.
- Cousin must have `cousin.OwningContainer() != null`.

### 8. Cousin Climbing Precedence
- While `cousin.OwningContainer() !== current`:
  - `if (cousin.Cluster != null) cousin = cousin.Cluster.Vessel;`
  - `else if (cousin.Sequence != null) cousin = cousin.Sequence.Vessel;`
  - `else cousin = cousin.OwningContainer();`
- Precedence: Cluster > Sequence > OwningContainer.

### 9. Final Uncle and Deduplication Rules
- Final uncle is `cousin.OwningContainer()`, requiring `uncle != null && uncle.isContainer`.
- `byUncle`: Each child node appears at most once per uncle (`byUncle.get(uncle)`), in first encounter order.
- `toCousin`: Every accepted abduction appends `cousin` to `toCousin.get(uncle).get(node)`, preserving duplicate cousins in abduction encounter order.

### 10. Discovery-Only Guarantee
- `GroupSheep` is read-only with respect to graph topology, geometry, and node properties.
- Returns fresh `Map` instances on each call.
