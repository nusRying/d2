# ADR 018: Descendant Traversal & Node Movement Primitives

## Date
2026-10-01

## Status
Accepted

## Context
In TALA's layout grouping pipeline, post-layout cleanup (`Cleanup`) arranges cluster members and sequence steps by moving vessels and composite child nodes (`work.MoveNodeWithChildren`, `work.PositionContainerChildren`).

Before cluster arrangement can be ported, the fundamental descendant discovery and node translation primitives must be established in JavaScript with exact Go parity.

Pinned Go reference:
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go` (`allDescendantNodes`, `allDescendantNodesGuarded`)
- `d2layouts/d2talalayout/internal/layoutgraph/node.go` (`translate`, `moveNodeWithChildren`, `moveNodeAbsWithChildren`)
- `d2layouts/d2talalayout/internal/layoutgraph/hierarchy_access.go` (`AllDescendantNodes`, `Translate`)
- `d2layouts/d2talalayout/internal/layoutgraph/packing_access.go` (`AllDescendantNodesWithWorkGuard`)
- `d2layouts/d2talalayout/internal/layoutgraph/placement_access.go` (`MoveWithChildren`, `MoveAbsWithChildren`)

---

## Architectural Decisions

### 1. Iterative Traversal, Not Recursion
- `Graph.allDescendantNodesGuarded` is implemented strictly iteratively using a stack and a `seen` Set.
- Recursion is avoided to prevent JavaScript engine call-stack overflows on deep container hierarchies (verified with 20,000+ depth chains).

### 2. Push Source Order and Observable Traversal Priority
- In `pushChildren(parent)`, ownership domains are inspected and pushed in Go source order:
  1. Sequence members (`graph.Sequences[parent]`)
  2. Cluster members (`graph.Clusters[parent]` if `parent.isClusterVessel`)
  3. Container children (`graph.Containers[parent]` if `parent == null || parent.isContainer`)
- Within each domain, members are pushed in **reverse slice order** onto the LIFO stack.
- Consequently, popping from the stack yields the exact observable traversal priority:
  1. Container domain first
  2. Cluster domain second
  3. Sequence domain third
  with forward member order preserved inside each domain.

### 3. Identity Deduplication and Seeded Root
- Traversal deduplication uses `seen = new Set()`, tracking node references by pointer/object identity (`seen.has(node)`).
- Nodes with identical IDs but distinct object instances remain distinct traversal entities.
- The root node (`node != null`) is seeded into `seen` upfront (`seen.add(node)`), preventing cyclic graphs from emitting or re-traversing the root.

### 4. Work Accounting on Null, Duplicate, and Cycle Occurrences
- In `pushChildren`, `guard.Step()` is invoked before pushing each candidate node.
- In the pop loop, `guard.Step()` is charged at the start of each iteration, before checking whether `current.node == null` or `seen.has(current.node)`.
- Consequently, null entries, duplicates, and back-edges to already-seen nodes all charge work before being skipped.
- `guard.Finish()` is called upon successful completion.

### 5. `includeClusterNodes` Semantics
- Despite the historical name, `includeClusterNodes` controls emission of **both** cluster members and sequence members.
- When `includeClusterNodes === false`, cluster and sequence members have `emit: false` (they are not added to `descendants`), but they are still pushed, popped, added to `seen`, and traversed. Any ordinary container children underneath a hidden structured member have `emit: true` and are emitted.

### 6. Unmetered Wrapper vs Guarded WorkGuard Variant
- `allDescendantNodes(node, includeClusterNodes)` delegates to `allDescendantNodesGuarded` with a lightweight browser-safe no-op stepper (`noopWorkStepper`), avoiding the overhead and cancellation semantics of full `WorkGuard` instances when unmetered traversal is desired.
- `AllDescendantNodesWithWorkGuard` delegates directly to `allDescendantNodesGuarded(node, includeClusterNodes, guard)`.

### 7. Node Translation (`translate` / `Translate`)
- `Node.translate(dx, dy)` mutates the existing `this.TopLeft` Point object in-place (`TopLeft.X += dx`, `TopLeft.Y += dy`).
- Point object identity is strictly preserved (no cloning or allocation).
- If `this.TopLeft == null`, direct property dereference throws a native `TypeError` (mirroring Go nil pointer panic).

### 8. `MoveWithChildren` Semantics
- **Zero-Delta Early Return:** If `dx === 0 && dy === 0`, `moveNodeWithChildren` returns immediately before accessing `TopLeft` or `Graph`. A detached node with null `TopLeft` or null `Graph` safely returns without error on `(0, 0)`.
- **Pre-Discovery Translation:** For nonzero deltas, `this.translate(dx, dy)` is executed **before** calling `this.Graph.allDescendantNodes(this, true)`.
- **Nontransactional Partial Failure:** If `this.Graph == null`, the root `TopLeft` is mutated before the dereference throws. Similarly, if a descendant has a null `TopLeft`, earlier descendants remain translated when the exception is raised.
- **Structured Descendants Included:** Traversal uses `includeClusterNodes = true`, translating container descendants, cluster members, sequence members, and their children. Deduplication ensures each node object translates exactly once.
- **Structural Non-Mutation:** Only `TopLeft.X` and `TopLeft.Y` are mutated. Node dimensions, flags, hierarchy pointers, and edge route `Points` arrays/objects remain completely untouched.

### 9. `MoveAbsWithChildren` Semantics
- **Exact-Equality Early Return:** If `this.TopLeft != null && this.TopLeft.X === x && this.TopLeft.Y === y`, returns immediately without dereferencing `Graph`.
- If positions differ, computes `dx = x - this.TopLeft.X, dy = y - this.TopLeft.Y` and invokes `this.moveNodeWithChildren(dx, dy)`.
- If `this.TopLeft == null`, the subtraction throws native `TypeError`.

### 10. `PositionContainerChildren` Explicitly Deferred
- `PositionContainerChildren` is deferred to subsequent slices as it involves container padding, bounds calculation, inside label placement, and shape-specific formatting that cross into a separate geometry dependency domain.
