# ADR-025: Cluster Arrangement & SyncGeometry

## Status
Accepted

## Context
In D2's layout engine (specifically TALA), cluster groupings arrange their member nodes linearly in a row or column within a vessel node. Cluster geometry management provides two primary public operations:
1. `Cluster.arrangeClusterNodes()` / `Cluster.ArrangeClusterNodes()`: repositions the member nodes into their designated row or column slots within the cluster vessel.
2. `Cluster.syncGeometry()` / `Cluster.SyncGeometry()`: synchronizes cluster geometry by resizing the vessel (and normalizing members if `!FixedSize`) and then arranging the member nodes.

In pinned Go TALA (`d2lang/d2@01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`), the implementations are defined in:
- `d2layouts/d2talalayout/internal/layoutgraph/cluster.go:109-169` (`ArrangeClusterNodes`, `arrangeNodesWithWork`)
- `d2layouts/d2talalayout/internal/layoutgraph/cluster.go:179-202` (`SyncGeometry`, `SyncGeometryWithWork`)
- `d2layouts/d2talalayout/internal/layoutgraph/group_geometry.go:6-28` (`unmeteredGroupGeometry`)

```go
func (c *Cluster) ArrangeClusterNodes() {
    if err := c.arrangeNodesWithWork(unmeteredGroupGeometry); err != nil {
        panic(err)
    }
}

func (c *Cluster) arrangeNodesWithWork(work ClusterGeometryWork) error {
    if c.Vessel.TopLeft == nil {
        return work.Finish()
    }

    if c.Arrangement == Row {
        position := c.Vessel.TopLeft.X
        vesselCenter := c.Vessel.TopLeft.Y + c.Vessel.Height/2

        for _, node := range c.Nodes {
            if err := work.Step(); err != nil {
                return err
            }
            if node.TopLeft != nil {
                dx := position - node.TopLeft.X
                dy := math.Round(vesselCenter - (node.TopLeft.Y + node.Height/2))
                if err := work.MoveNodeWithChildren(node, dx, dy); err != nil {
                    return err
                }
            } else {
                node.TopLeft = geo.NewPoint(position, math.Round(vesselCenter-node.Height/2))
                if err := work.PositionContainerChildren(node); err != nil {
                    return err
                }
            }
            position += node.Width + c.Padding
        }
    }

    if c.Arrangement == Column {
        position := c.Vessel.TopLeft.Y
        vesselCenter := c.Vessel.TopLeft.X + c.Vessel.Width/2

        for _, node := range c.Nodes {
            if err := work.Step(); err != nil {
                return err
            }
            if node.TopLeft != nil {
                dx := math.Round(vesselCenter - (node.TopLeft.X + node.Width/2))
                dy := position - node.TopLeft.Y
                if err := work.MoveNodeWithChildren(node, dx, dy); err != nil {
                    return err
                }
            } else {
                node.TopLeft = geo.NewPoint(math.Round(vesselCenter-node.Width/2), position)
                if err := work.PositionContainerChildren(node); err != nil {
                    return err
                }
            }
            position += node.Height + c.Padding
        }
    }
    return work.Finish()
}

func (c *Cluster) SyncGeometry() {
    if err := c.SyncGeometryWithWork(unmeteredGroupGeometry); err != nil {
        panic(err)
    }
}

func (c *Cluster) SyncGeometryWithWork(work ClusterGeometryWork) error {
    if work == nil {
        return invariant.New("cluster geometry requires work accounting")
    }
    if err := work.Step(); err != nil {
        return err
    }
    if c == nil || c.Vessel == nil {
        return invariant.New("cluster is missing its vessel")
    }
    if err := c.resizeWithWork(c.Vessel, work); err != nil {
        return err
    }
    return c.arrangeNodesWithWork(work)
}
```

This ADR records the decisions and exact behavioral semantics for the Slice 24 JavaScript implementation.

## Decisions

### 1. Row and Column Exact Positioning
- **Row Arrangement**:
  - Main axis is X: initial slot `position = vessel.TopLeft.X`.
  - For each node:
    - If `node.TopLeft != null`: `dx = position - node.TopLeft.X`, `dy = goRound(vesselCenter - (node.TopLeft.Y + node.Height / 2))`. Moves node and all descendants via `node.moveNodeWithChildren(dx, dy)`.
    - If `node.TopLeft == null`: places node at `new Point(position, goRound(vesselCenter - node.Height / 2))`, then calls `node.positionContainerChildren(false)` to position any container children.
    - Slot advances: `position += node.Width + padding`.
- **Column Arrangement**:
  - Main axis is Y: initial slot `position = vessel.TopLeft.Y`.
  - For each node:
    - If `node.TopLeft != null`: `dx = goRound(vesselCenter - (node.TopLeft.X + node.Width / 2))`, `dy = position - node.TopLeft.Y`. Moves node and all descendants via `node.moveNodeWithChildren(dx, dy)`.
    - If `node.TopLeft == null`: places node at `new Point(goRound(vesselCenter - node.Width / 2), position)`, then calls `node.positionContainerChildren(false)`.
    - Slot advances: `position += node.Height + padding`.

### 2. Main-Axis vs. Cross-Axis Rounding
- **Main Axis**:
  - Values on the main axis (`position`, `dx` in row, `dy` in column, and increment `node.Width + padding` or `node.Height + padding`) are NOT rounded. Fractional coordinates and fractional paddings are preserved exactly.
- **Cross Axis**:
  - Cross-axis alignment uses `goRound` (matching Go's `math.Round`).
  - Importantly, `goRound(-0.5) === -1` (rounds half away from zero), whereas standard JavaScript `Math.round(-0.5) === -0`. This distinguishes `goRound` and ensures parity with Go.

### 3. MoveNodeWithChildren for Placed Members
- When `node.TopLeft != null`, the member is translated via `node.moveNodeWithChildren(dx, dy)`.
- This ensures all descendant nodes in the hierarchy move by the exact same `(dx, dy)` offset, preserving their relative positions within the member.
- Point identities for `node.TopLeft` and descendant `TopLeft` points are preserved by in-place coordinate translation.

### 4. New Point + PositionContainerChildren(false) for Unplaced Members
- When `node.TopLeft == null`, the member is newly placed:
  - A new `Point` instance is assigned to `node.TopLeft`.
  - Then `node.positionContainerChildren(false)` is invoked with `withPadding = false` (matching `unmeteredGroupGeometry.PositionContainerChildren`).
  - If the unplaced member is not a container, `positionContainerChildren` early-returns safely.

### 5. Early Return When Vessel TopLeft is Null
- In `arrangeClusterNodes()`, if `this.Vessel.TopLeft == null`, the method returns immediately without inspecting or validating `this.Nodes`.
- If `this.Nodes = [null]`, it is an observable no-op without throws.

### 6. Nil Vessel Behavior
- In `arrangeClusterNodes()`, if `this.Vessel == null`, accessing `vessel.TopLeft` naturally throws a TypeError/panic (no defensive guard).
- In `syncGeometry()`, an explicit invariant check runs first: if `this.Vessel == null`, throws `new Error("cluster is missing its vessel")`.

### 7. Member Order and Duplicate Occurrences
- Members are processed strictly in `this.Nodes` array order (no sorting by ID or coordinate).
- Duplicates in `this.Nodes` are not deduplicated; if the same node reference appears multiple times, it is processed multiple times. The node moves to slot 1, then to slot 2, ending at the final slot.

### 8. Unknown Arrangement Behavior
- If `Arrangement` is neither `"Row"` nor `"Column"` (e.g. `""` or `"Diagonal"`), `arrangeClusterNodes()` performs no movement and returns silently.

### 9. Padding Progression
- Padding is applied after each node: `position += node.Width + padding` (Row) or `position += node.Height + padding` (Column).
- Negative padding is supported without clamping, allowing deliberate member overlapping. Fractional padding is also supported without rounding.

### 10. Arrange Idempotence and Dimensions Invariance
- `arrangeClusterNodes()` only moves and positions nodes; it does NOT alter `Vessel.Width`, `Vessel.Height`, `node.Width`, or `node.Height`.
- Calling `ArrangeClusterNodes()` multiple times is idempotent. On subsequent calls, `dx == 0 && dy == 0`, resulting in zero movement deltas.

### 11. SyncGeometry Exact Ordering: Resize then Arrange
- `syncGeometry()` strictly executes `this.resize(this.Vessel)` first, followed by `this.arrangeClusterNodes()`.
- Sizing precedes arrangement because `resize()` may normalize member sizes and sizes the vessel, which determines slot positions and cross-axis alignment centers.

### 12. FixedSize Semantics
- When `FixedSize === false`:
  - `resize()` normalizes all member widths and heights to the maximum member width and height.
  - Vessel is sized to fit the normalized members.
  - `arrangeClusterNodes()` arranges using the normalized dimensions.
- When `FixedSize === true`:
  - `resize()` does not modify member dimensions.
  - Vessel is sized using `maxWidth * count + padding * (count - 1)`.
  - `arrangeClusterNodes()` advances slots by each member's actual individual dimension plus padding, creating non-uniform slot spacing.

### 13. Empty Cluster Negative Vessel Dimension Quirk
- When `Nodes` is empty:
  - `maxWidth = 0`, `maxHeight = 0`, `count = 0`.
  - Row vessel: `Width = 0 * 0 + padding * (0 - 1) = -padding`, `Height = 0`.
  - Column vessel: `Width = 0`, `Height = 0 * 0 + padding * (0 - 1) = -padding`.
  - This pinned Go legacy quirk is preserved exactly without clamping to zero.

### 14. Unplaced Vessel Resize-Only Behavior
- If `Vessel.TopLeft == null`, `syncGeometry()` executes `resize(vessel)` (updating vessel dimensions and normalizing members if `!FixedSize`), but `arrangeClusterNodes()` returns early. Member positions remain untouched.

### 15. Nontransactional Nature and Natural Partial Failures
- Neither `ArrangeClusterNodes` nor `SyncGeometry` implements rollback or snapshot recovery.
- If a later member causes a panic (e.g., `Nodes = [validMember, null]`), earlier member translations remain committed.
- In `SyncGeometry`, if `Resize` succeeds but `Arrange` later fails (e.g., due to a detached member with `Graph = null`), the resized dimensions on the vessel and members remain committed.

### 16. Scope Boundaries and Deferred Features
- The following remain strictly out of scope for Slice 24:
  - Work-accounted variants: `arrangeNodesWithWork`, `resizeWithWork`, `maximumsWithWork`, `SyncGeometryWithWork`, `ClusterGeometryWork`, `binPackClusterGeometryWork`.
  - Graph-level cluster synchronization: `Graph.SyncClusters`, `Graph.SyncNestedGeometry`.
  - Sequence geometry: `Sequence.SyncGeometry`, `Sequence.ArrangeSteps`, `Graph.SyncSequences`.
  - Grouping orchestration: `grouping.Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs`.
  - Container mutations: `setContainer`, `SetContainer`.
