# ADR-023: WrapChildren Composition

## Status
Accepted

## Context
In D2's layout engine (specifically TALA), container nodes enclose child nodes and clusters. During layout, containers must wrap tightly around their positioned children, accounting for shape-specific geometry, label expansions, and container padding.

In Go TALA, this composition is implemented primarily via:
- `Node.wrapChildren()` (unexported internal method)
- `Node.WrapChildren()` (exported public alias on `Node`)

This ADR documents the exact procedural sequence, translation sign conventions, non-mutation of children, error behavior, and boundary constraints ported to JavaScript in Slice 22.

## Decision

### 1. Scope and API
- Implemented `Node.wrapChildren()` and `Node.WrapChildren()` on `Node` in `src/graph/node.js`.
- Future operations such as `fitNodeToGraph`, `FitToGraph`, `binPackWrapChildren`, `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, `Graph.SyncClusters`, `Graph.SyncNestedGeometry`, `Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs`, and tree/hierarchy placement orchestration remain strictly un-implemented.
- `setContainer` and `SetContainer` remain strictly absent from JS production code.

### 2. Procedural Pipeline and Ordering
`wrapChildren()` executes the exact procedural steps of pinned Go `node.go`:
```text
if (!this.isContainer) return;
children = this.Graph.Containers.get(this) ?? [];
padding = this.Graph.containerPadding(this, false);
[tl, br] = nodesFixedBounds(children);
this.expandForLabels(tl, br);
this.fitToBoundingBox(tl, br, padding);
innerTL = this.InsidePlacement(br.X - tl.X, br.Y - tl.Y, padding);
this.translate(tl.X - innerTL.X, tl.Y - innerTL.Y);
```

### 3. Key Invariants & Behavioral Quirks
- **Non-container early return**: If `!this.isContainer`, returns immediately before accessing `this.Graph`, `Graph.Containers`, `containerPadding`, or `TopLeft`. It is a safe no-op even if `Graph` or `TopLeft` is `null`.
- **Exact child source**: Children are obtained exclusively from `this.Graph.Containers.get(this) ?? []`. Missing map key behaves as an empty array without inserting into the map.
- **Padding is always enabled**: Always calls `this.Graph.containerPadding(this, false)` with `considerChildren = false`.
- **Bounds calculation**: Uses `nodesFixedBounds(children)` (incorporating `FixedTopLeft` offsets, outside labels, outside icons, loop offsets, and modifier extents).
- **Label expansion**: Calls `this.expandForLabels(tl, br)`, expanding horizontal bounds for boundary children whose `Label.Width > child.Width`. Interior children are ignored.
- **Resize before InsidePlacement**: `this.fitToBoundingBox(tl, br, padding)` mutates `container.Width` and `container.Height` *before* `InsidePlacement` is called. `InsidePlacement` must see the container's newly resized dimensions (observable for shapes like Circle, Oval, and Cloud).
- **Translation direction**: Container is moved by `dx = tl.X - innerTL.X` and `dy = tl.Y - innerTL.Y`. This is the opposite sign of Slice 20 `positionContainerChildren` (`innerTL - tl` for children).
- **Container moves only**: Only the container itself is translated via `this.translate(dx, dy)`. Children, grandchildren, and all deeper descendants remain completely stationary.
- **Edge routes untouched**: `translate` modifies only `TopLeft.X` and `TopLeft.Y`; edge routes, ports, and points are not moved.
- **FixedTopLeft preservation**: Neither container nor child `FixedTopLeft` is modified. Direct child `FixedTopLeft` replaces effective `tl` through `nodesFixedBounds`.
- **Empty container non-finite legacy behavior**: For empty containers, `nodesFixedBounds` produces `tl = (-Infinity, -Infinity)` and `br = (Infinity, Infinity)`. WrapChildren does NOT early-return; it computes `Width = +Infinity`, `Height = +Infinity`, and `TopLeft = (-Infinity, -Infinity)`, matching Go.
- **Natural failure & partial mutation**:
  - `isContainer == true && Graph == null` throws naturally when accessing `Containers`.
  - `nil` child or child with `TopLeft == null` throws during `fixedBounds()` before container dimensions change.
  - Container with `TopLeft == null` succeeds through `fitToBoundingBox` (mutating `Width` and `Height`), then throws during `InsidePlacement` when dereferencing `box.TopLeft.X`. No rollback occurs.
- **Unmetered & nontransactional**: No `WorkGuard`, step accounting, `GraphState`, or rollback mechanism is used.

## Consequences
- Full parity with Go `Node.wrapChildren()` and `Node.WrapChildren()`.
- Successfully compositions all previous geometric and sizing layers (Slices 17, 18, 19, 20, and 21) into container wrapping.
- Fully browser-safe: 0 Node.js built-ins, 0 `Math.random`.
