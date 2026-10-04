# ADR-021: Container Child Positioning

## Status
Accepted

## Context
In D2's layout engine (specifically TALA), containers host child nodes and clusters. Once children bounds are computed, container children must be positioned inside the container shape according to shape inner geometry and optional container padding.

In Go TALA, this is implemented primarily via:
- `Node.positionContainerChildren(withPadding bool)`
- `Node.PositionContainerChildren(withPadding bool)`
- unexported helper `Node.expandForLabels(tl, br *geo.Point)`

This ADR documents the exact semantics and invariants ported to JavaScript in Slice 20.

## Decision

### 1. Scope and Public vs Internal APIs
- Implemented `Node.positionContainerChildren(withPadding)` and its public alias `Node.PositionContainerChildren(withPadding)`.
- Implemented internal helper `Node.expandForLabels(tl, br)`.
- No public `ExpandForLabels` alias was introduced, matching the unexported Go signature.
- Future operations such as `wrapChildren`, `fitToBoundingBox`, `ArrangeClusterNodes`, `SyncGeometry`, `SyncClusters`, and `binPackPositionContainerChildren` remain strictly un-implemented.

### 2. Execution Pipeline & Invariants

#### A. Non-Container Early Return
If `node.isContainer` is `false`, `positionContainerChildren` immediately returns before accessing `node.Graph`, `Graph.Containers`, `TopLeft`, or `InsidePlacement`. This functions as a safe no-op even if `node.Graph == null` or `node.TopLeft == null`.

#### B. Direct Child Source
Children are sourced strictly from:
```javascript
const children = this.Graph.Containers.get(this) ?? [];
```
Equivalent to Go `n.Graph.Containers[n]`. If the container node is marked `isContainer: true` but has `Graph == null`, accessing `this.Graph.Containers` naturally throws, matching Go panic on nil pointer dereference.
If the map has no entry for this container, an empty list is used without mutating the map.

#### C. withPadding Parameter
- When `withPadding == false`: Zero spacing `{ top: 0, bottom: 0, left: 0, right: 0 }` is used. `Graph.containerPadding` is NOT called.
- When `withPadding == true`: `this.Graph.containerPadding(this, false)` is invoked directly.

#### D. Fixed Bounds Before Label Expansion
`nodesFixedBounds(children)` runs first, producing `[tl, br]`. This ensures outside labels, outside icons, modifiers, and fixed-origin semantics are computed prior to label expansion.

#### E. expandForLabels Exact Semantics
`expandForLabels(tl, br)`:
- Iterates `this.Graph.Containers.get(this)` in order.
- Checks children with `child.Label != null` that satisfy strict boundary equality:
  `child.TopLeft.X === tl.X || child.TopLeft.X + child.Width === br.X`
- Ignores `Label.Position` entirely (regardless of whether it is inside, border, or outside).
- Ignores `Label.Height`, `child.Height`, and Y coordinates.
- Only triggers when `child.Label.Width > child.Width`.
- Mutates the passed `tl` and `br` points in place:
  ```javascript
  tl.X = Math.min(tl.X, Math.floor(child.TopLeft.X + (child.Width / 2 - child.Label.Width / 2)));
  br.X = Math.max(br.X, Math.ceil(child.TopLeft.X + child.Width - (child.Width / 2 - child.Label.Width / 2)));
  ```
- Interior long labels (nodes not on the left or right boundary) do not expand bounds.

#### F. InsidePlacement & Shared Delta
Content width and height are derived as:
```javascript
const contentWidth = br.X - tl.X;
const contentHeight = br.Y - tl.Y;
const innerTL = this.InsidePlacement(contentWidth, contentHeight, padding);
const dx = innerTL.X - tl.X;
const dy = innerTL.Y - tl.Y;
```
The exact same delta `(dx, dy)` is applied to all direct children.

#### G. Movement & Descendants
- For each child in `children`, `child.moveNodeWithChildren(dx, dy)` is called.
- Descendants move along with their parent.
- The container itself is not moved.
- Child order is preserved as-is.
- If a child appears multiple times in `Containers`, it is moved multiple times (duplicate occurrence quirk).
- `FixedTopLeft` is not modified by `moveNodeWithChildren`.

#### H. Procedural Error Semantics (No Rollback / No WorkGuard)
- No transaction or rollback mechanism exists. If an error or exception occurs mid-loop (e.g. detached second child with `Graph == null`), earlier children retain their translated coordinates (partial mutation).
- When `dx === 0 && dy === 0`, `moveNodeWithChildren` returns early before accessing `child.Graph`, so detached children with zero delta do not panic.
- `PositionContainerChildren` is unmetered (no `WorkGuard`).

## Consequences
- Full parity with Go TALA's `positionContainerChildren`.
- Clean browser-safe implementation without Node.js dependencies, floating point non-determinism, or RNG.
