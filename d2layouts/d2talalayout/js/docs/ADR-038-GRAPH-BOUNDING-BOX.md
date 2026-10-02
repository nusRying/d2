# ADR-038: Graph & Edge Bounding Box Kernel (Slice 37)

## Status
Implemented — awaiting Slice 37 review

## Context
In TALA's layout pipeline, `graph.BoundingBox()` computes the bounding box encompassing all nodes and routed edges. It is a critical kernel consumed by diagram framing, coordinate normalization, and hierarchy containment.

Pinned reference:
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.
- `d2layouts/d2talalayout/internal/layoutgraph/edge.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.
- `d2layouts/d2talalayout/internal/layoutgraph/structure_api.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.
- `d2layouts/d2talalayout/internal/labelgeom/arrowhead.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.
- `lib/label/label.go`, `lib/geo/route.go`, `lib/geo/vector.go`, and `d2target/d2target.go`.

Pinned Go sources:
```go
func (g *Graph) bounds() (*geo.Point, *geo.Point) {
	tl, br := g.boundingBox(true)
	if tl == nil || br == nil {
		return nil, nil
	}
	// Placement consumes a pixel-aligned graph box even when edge points are
	// fractional.
	return geo.NewPoint(math.Round(tl.X), math.Round(tl.Y)), geo.NewPoint(math.Round(br.X), math.Round(br.Y))
}

func (g *Graph) unroundedBounds() (*geo.Point, *geo.Point) {
	return g.boundingBox(false)
}

func (g *Graph) boundingBox(roundNodeDimensions bool) (*geo.Point, *geo.Point) {
	var tl, br *geo.Point
	if roundNodeDimensions {
		tl, br = Nodes(g.Nodes).fixedBounds()
	} else {
		tl, br = Nodes(g.Nodes).unroundedFixedBounds()
	}
	if tl == nil || br == nil {
		return nil, nil
	}

	minX := tl.X
	minY := tl.Y

	maxX := br.X
	maxY := br.Y

	for _, edge := range g.Edges {
		edgeTL, edgeBR := edge.boundingBoxValues()
		if !math.IsInf(edgeTL.X, 0) {
			minX = math.Min(minX, edgeTL.X)
			minY = math.Min(minY, edgeTL.Y)
			maxX = math.Max(maxX, edgeBR.X)
			maxY = math.Max(maxY, edgeBR.Y)
		}
	}

	return geo.NewPoint(minX, minY), geo.NewPoint(maxX, maxY)
}

func (graph *Graph) BoundingBox() (*geo.Point, *geo.Point) {
	return graph.bounds()
}
```

And for edges:
```go
func (e *Edge) bounds() (*geo.Point, *geo.Point) {
	tl, br := e.boundingBoxValues()
	return &tl, &br
}

func (e *Edge) boundingBoxValues() (geo.Point, geo.Point) {
	tl := geo.Point{X: math.Inf(1), Y: math.Inf(1)}
	br := geo.Point{X: math.Inf(-1), Y: math.Inf(-1)}

	for _, p := range e.Points {
		tl.X = math.Min(tl.X, p.X)
		tl.Y = math.Min(tl.Y, p.Y)
		br.X = math.Max(br.X, p.X)
		br.Y = math.Max(br.Y, p.Y)
	}

	if e.Label != nil && len(e.Points) != 0 && e.Label.Position != label.Unset {
		labelTL := e.LabelTopLeft(e.Label.Position, e.Label.Width, e.Label.Height)
		tl.X = math.Min(tl.X, labelTL.X)
		tl.Y = math.Min(tl.Y, labelTL.Y)
		br.X = math.Max(br.X, labelTL.X+e.Label.Width)
		br.Y = math.Max(br.Y, labelTL.Y+e.Label.Height)
	}
	if len(e.Points) > 0 {
		if label := e.SourceArrowheadLabel; label != nil {
			labelTL := labelgeom.ArrowheadTopLeft(
				e.Points,
				false,
				string(e.SourceArrowhead),
				string(e.TargetArrowhead),
				label.Width,
				label.Height,
			)
			tl.X = math.Min(tl.X, labelTL.X)
			tl.Y = math.Min(tl.Y, labelTL.Y)
			br.X = math.Max(br.X, labelTL.X+label.Width)
			br.Y = math.Max(br.Y, labelTL.Y+label.Height)
		}
		if label := e.TargetArrowheadLabel; label != nil {
			labelTL := labelgeom.ArrowheadTopLeft(
				e.Points,
				true,
				string(e.SourceArrowhead),
				string(e.TargetArrowhead),
				label.Width,
				label.Height,
			)
			tl.X = math.Min(tl.X, labelTL.X)
			tl.Y = math.Min(tl.Y, labelTL.Y)
			br.X = math.Max(br.X, labelTL.X+label.Width)
			br.Y = math.Max(br.Y, labelTL.Y+label.Height)
		}
	}

	tl.X = math.Round(tl.X)
	tl.Y = math.Round(tl.Y)
	br.X = math.Round(br.X)
	br.Y = math.Round(br.Y)
	return tl, br
}
```

## Decisions & Parity Rules
1. **Reuse Existing Node Bounds**: Node fixed bounding box semantics (`nodesFixedBounds` and `nodesUnroundedFixedBounds`) from `src/graph/node-bounds.js` are preserved without behavioral rewrite.
2. **Empty Graph Infinities**: For empty graphs (`g.Nodes == []`), `nodesFixedBounds` returns `[-Infinity, -Infinity]` to `[Infinity, Infinity]`. Because `edgeTL.X` is tested against infinite node bounds, even a finite edge does not shrink the initial infinities.
3. **Unplaced Node Null**: If any node in `g.Nodes` has `TopLeft == null`, `nodesFixedBounds` returns `[null, null]`, causing `Graph.BoundingBox()` to immediately return `[null, null]` without inspecting edges.
4. **Edge Aggregation Condition**: Edges are skipped only if `edgeTL.X === Infinity || edgeTL.X === -Infinity` (exact Go check `!math.IsInf(edgeTL.X, 0)`).
5. **Rounding Parity (`goRound`)**: Both edge bounds and final graph bounds use `goRound(...)` matching Go's `math.Round` half-value behavior away from zero.
6. **Main Label Geometry**: Main edge label uses constant `EDGE_STROKE_WIDTH = 3.0` and `getPointOnRoute(...)`.
7. **Float32 Precision Chopping (`chopPrecision`)**: Label coordinates use `goRound(Math.fround(f * 10000) / 10000)` and normalize `-0` to `+0`.
8. **Arrowhead Label Dimensions and Geometry**: Dimensions truncate via `Math.trunc`, stroke width is `2.0` (from `d2target.BaseConnection()`), unit normal is `(end -> start)` order, arrow size uses arrow height, and target arrowhead label falls back to source arrowhead dimensions if target has no arrowhead.

## Verification
- Real Go oracle program: `test/reference/go_graph_bounding_box_oracle.go` (56 scenarios).
- Generated oracle fixtures: `test/fixtures/go-graph-bounding-box-reference.json`.
- Oracle replay test: `test/unit/graph-bounding-box-oracle.test.js` (56/56 PASS).
- Direct unit tests: `test/unit/graph-bounding-box.test.js` (30/30 PASS).
- Full suite: 1903 passed, 0 failed across 75 test files.
