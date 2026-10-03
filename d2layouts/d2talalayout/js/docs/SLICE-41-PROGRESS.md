# Slice 41 Progress: Node Placement-Cost Kernel Bundle

## Pinned Reference
- **Go Commit**: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`
- **Frozen Base Commit**: `f9c3a79195fbe6e796cc4ae2d17bcc798e3358b8` (Slice 40 Approved)
- **Branch**: `tala-js/slice-41-placement-cost-kernel`

---

## 1. Dependency Audit Checklist

Per Section 5 of Slice 41 requirements, every call from the pinned Go files in Slice 41 to layoutgraph `Node`, `Edge`, and `Graph` methods has been scanned and classified into:
1. Already present in JS with exact semantics
2. Present but missing Pascal alias only
3. Missing and must be ported in Slice 41
4. Outside Slice 41 and therefore must not be required

### Node Methods
| Method | Classification | Description |
|---|---|---|
| `Node.Center()` / `node.center()` | 3. Missing and must be ported in Slice 41 | Returns fresh `Point(TopLeft.X + Width/2, TopLeft.Y + Height/2)` without caching |
| `Node.Orientation(other)` / `node.orientation(other)` | 3. Missing and must be ported in Slice 41 | Box-relative 8 orientations + `NONE`; returns `NONE` if either TopLeft is nil |
| `Node.OverlapsLine(p1, p2, delta)` / `node.overlapsLine(...)` | 3. Missing and must be ported in Slice 41 | Padded box boundary intersection & point containment test |
| `Node.PassesThrough(p1, p2)` / `node.passesThrough(...)` | 3. Missing and must be ported in Slice 41 | Line segment intersection against closed node box |
| `Node.Area()` / `node.area()` | 3. Missing and must be ported in Slice 41 | Returns `Width * Height` |
| `Node.OverlapsAlongDimension(...)` | 3. Missing and must be ported in Slice 41 | 1D projection overlap test (horizontal/vertical, with/without sizes) |
| `Node.TableColumnPortValue(...)` / `tableColumnPortValue(...)` | 3. Missing and must be ported in Slice 41 | Side port calculation for table columns with fallback to standard side ports |
| `Node.NumColumns()` / `SetNumColumns(n)` | 3. Missing and must be ported in Slice 41 | Table column metadata getter/setter |
| `Node.Adjacent(e)` | 1. Already present in JS | `node.adjacent(e)` and `node.Adjacent(e)` present |
| `Node.ContainerDirection()` | 1. Already present in JS | `node.containerDirection()` and `node.ContainerDirection()` present |
| `Node.IsTable()` | 1. Already present in JS | `node.isTable()` and `node.IsTable()` present |
| `Node.IsClusterVessel()` | 1. Already present in JS | `node.isClusterVessel()` and `node.IsClusterVessel()` present |
| `Node.EffectiveContainer()` | 1. Already present in JS | `node.effectiveContainer()` and `node.EffectiveContainer()` present |
| `Node.IsContainer()` | 1. Already present in JS | `node.isContainer()` and `node.IsContainer()` present |
| `Node.IsDescendantOf(...)` | 1. Already present in JS | `node.isDescendantOf(...)` and `node.IsDescendantOf(...)` present |
| `Node.NearestSharedAncestor(...)` | 1. Already present in JS | `node.nearestSharedAncestor(...)` and `node.NearestSharedAncestor(...)` present |
| `Node.DistanceTo(...)` | 1. Already present in JS | `node.distanceTo(...)` and `node.DistanceTo(...)` present |

### Edge Methods
| Method | Classification | Description |
|---|---|---|
| `Edge.FacingTablePortValues(from, to)` / `facingTablePorts(...)` | 3. Missing and must be ported in Slice 41 | Resolves concrete ports, hasFrom/hasTo flags, and relative orientation |
| `Edge.HasTableColumn()` / `edge.hasTableColumn()` | 3. Missing and must be ported in Slice 41 | Returns `FromTableColumnIndex != null \|\| ToTableColumnIndex != null` |
| `Edge.IsBetweenTableColumns()` / `edge.isBetweenTableColumns()` | 3. Missing and must be ported in Slice 41 | Returns `FromTableColumnIndex != null && ToTableColumnIndex != null` |
| `Edge.HasLargeArrowheadLabel()` / `edge.hasLargeArrowheadLabel()` | 3. Missing and must be ported in Slice 41 | Checks if arrowhead label length > 3 |
| `Edge.DirectedEndpoints()` / `edge.directedEndpoints()` | 3. Missing and must be ported in Slice 41 | Returns semantic `(from, to, isDirected)` accounting for arrowheads |
| `Edge.IsDirected()` | 1. Already present in JS | `edge.isDirected()` and `edge.IsDirected()` present |
| `Edge.HasSourceArrow()` / `HasTargetArrow()` | 1. Already present in JS | Present with Pascal aliases |

### Graph Methods & Topology Fields
| Field/Method | Classification | Description |
|---|---|---|
| `Graph.TurnCost()` | 1. Already present in JS | `graph.turnCost()` and `graph.TurnCost()` present |
| `Graph.CrossingCost()` | 1. Already present in JS | `graph.crossingCost()` and `graph.CrossingCost()` present |
| `Graph.CellSize` | 1. Already present in JS | Present on Graph instance |
| `Graph.Clusters` | 1. Already present in JS | `Map<Node, Cluster>` present |
| `Graph.Containers` | 1. Already present in JS | `Map<Node, Node[]>` present |
| `Graph.CommonUncleSiblings` | 1. Already present in JS | `Map<Node, Node[]>` present |
| `Graph.IsSequenceVessel(...)` | 1. Already present in JS | `graph.isSequenceVessel(...)` present |

### Methods Outside Slice 41 (Explicitly Excluded)
| Method | Classification | Notes |
|---|---|---|
| `placementcost.EdgeLength(graph)` | 4. Outside Slice 41 | Graph-wide aggregate scoring is explicitly out of scope |
| `GraphEdgeCrossings` | 4. Outside Slice 41 | Graph-wide aggregate crossing score |
| `sizelessOptimizer` / `sizedOptimizer` | 4. Outside Slice 41 | Optimizer orchestration begins in Slice 42+ |
| `PlaceNodes` / `compaction` / `packing` | 4. Outside Slice 41 | Downstream placement stages |

---

## 2. Implementation Modules Plan

1. **`src/graph/node.js`**:
   - Add `center()` / `Center()`.
   - Add `orientation(other)` / `Orientation(other)`.
   - Add `overlapsLine(p1, p2, delta)` / `OverlapsLine(...)`.
   - Add `passesThrough(p1, p2)` / `PassesThrough(...)`.
   - Add `area()` / `Area()`.
   - Add `overlapsAlongDimension(other, isHorizontal, includeSizes)` / `OverlapsAlongDimension(...)`.
   - Add `tableColumnPortValue(orientation, columnIndex)` / `TableColumnPortValue(...)`.
   - Add `numColumns()` / `NumColumns()` and `setNumColumns(n)` / `SetNumColumns(n)`.

2. **`src/graph/edge.js`**:
   - Add `hasTableColumn()` / `HasTableColumn()`.
   - Add `isBetweenTableColumns()` / `IsBetweenTableColumns()`.
   - Add `hasLargeArrowheadLabel()` / `HasLargeArrowheadLabel()`.
   - Add `directedEndpoints()` / `DirectedEndpoints()`.
   - Add `facingTablePorts(abductionFrom, abductionTo)` / `FacingTablePortValues(from, to)`.

3. **`src/placementcost/geometry.js`**:
   - `scoringCancellationCheckInterval = 64`, `sizelessDirectionDeltaFactor = 0.25`, `symmetryToleranceBand = 1.0`.
   - `SideEdgeSpacing = 40.0`, `IdealGapSize = 2.5 * ConnectedNodeGap`.
   - `checkScoringCancellation(ctx)` and `scoringCancellationError(ctx, iteration)`.
   - `directionCompass(direction)`, `compassDelta(first, second)`, `compassAxisDelta(first, second)`.
   - `distanceToPoint(node, point, includeSizes)`, `placementDistance(first, second, includeSizes)`, `distanceBetweenBoxes(first, second)`, `intervalGap(...)`.
   - `sizelessOrientation(node, other)`.
   - `depth(node)`.
   - `distanceBetweenTableColumns(graph, edge, from, to)`.

4. **`src/placementcost/axis.js`**:
   - `AxisScore(nodes)` with exact 0.33 float increment, 0.99 -> 1 special branch, strict `>` tie-breaking on first largest width/height node, vertical phase first.

5. **`src/placementcost/cluster.js`**:
   - `clusterExactlyTwoExternalConnectedNodes(cluster)`.

6. **`src/placementcost/obstruction-bounds.js`**:
   - `obstructionBounds` with `usable`, `scoringNodeBounds(node)`, `including(other)`, `excludes(node)`.

7. **`src/placementcost/flow-continuity.js`**:
   - `flowContinuityCost(node, s)` with degree <= 8 limit, ray dot products, reciprocal role preservation, spine & branch weights, TurnCost multiplier.

8. **`src/placementcost/symmetry.js`**:
   - `NodeSymmetry(ctx, node, edgeAbductions)`, `nodeSymmetry(ctx, node, edgeAbductions, checkNeighbors)`.
   - `computeSymmetryScoreInto(...)`, `obstructed(...)`, `isMirrored(...)`.
   - `ColumnCrossingCost(ctx, node, edgeAbductions)`.

9. **`src/placementcost/edge-length.js`**:
   - `EdgeLengthOptions` class / object.
   - `NodeEdgeLength(ctx, node, options)`.
   - `edgeScratch`, `prepareNodeEdgeLength`, `evaluateNodeEdgeLength`.

10. **`src/placementcost/edge-length-scorer.js`**:
    - `NodeEdgeLengthScorer` class.
    - `NewNodeEdgeLengthScorer(node, options)`.
    - `Score(ctx)` reading live geometry and replaying prep checks.
    - `Close()`.

---

## 3. Real Go Oracle Plan
- Harness: in-package test `go_node_placement_cost_oracle_test.go` calling actual pinned Go functions.
- Output: `test/fixtures/go-node-placement-cost-reference.json` (100+ scenarios across layoutgraph accessors, geometry, compass, axisScore, clusterExternalPair, obstructionBounds, flowContinuity, symmetry, nodeEdgeLength, scorer, cancellation).
- Reference copy saved in `test/reference/go_node_placement_cost_oracle.go`.
