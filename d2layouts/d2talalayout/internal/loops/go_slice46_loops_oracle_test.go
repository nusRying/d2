package loops

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 46 loops oracle: shape ports (the nodeshape subset loops depend on),
// self-edge routing, loop offsets and the exact stable edge ordering. With
// TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-loops-reference.json; otherwise it recomputes
// every value and asserts the committed fixture is byte-identical.

// s46lF encodes float64 values JSON-safely (NaN, +/-Inf, -0 as strings).
type s46lF float64

func (f s46lF) MarshalJSON() ([]byte, error) {
	v := float64(f)
	switch {
	case math.IsNaN(v):
		return []byte(`"NaN"`), nil
	case math.IsInf(v, 1):
		return []byte(`"+Inf"`), nil
	case math.IsInf(v, -1):
		return []byte(`"-Inf"`), nil
	case v == 0 && math.Signbit(v):
		return []byte(`"-0"`), nil
	}
	return []byte(strconv.FormatFloat(v, 'g', -1, 64)), nil
}

var s46lShapes = []string{
	"", "Callout", "Circle", "Cloud", "Cylinder", "Diamond", "Document", "Hexagon",
	"Image", "Oval", "Package", "Page", "Parallelogram", "Person", "C4Person", "Queue",
	"RealSquare", "Square", "Step", "StoredData", "Text", "Class", "Table", "Code",
}

var s46lArrowheads = []string{"", "none", "triangle", "arrow", "diamond", "circle"}

// ── Specs ───────────────────────────────────────────────────────────────────

type s46lLabelSpec struct {
	W   s46lF `json:"w"`
	H   s46lF `json:"h"`
	Pos int   `json:"pos"`
}

type s46lNodeSpec struct {
	ID         int64          `json:"id"`
	W          s46lF          `json:"w"`
	H          s46lF          `json:"h"`
	Placed     bool           `json:"placed"`
	X          s46lF          `json:"x"`
	Y          s46lF          `json:"y"`
	Shape      string         `json:"shape"`
	NumColumns int            `json:"numColumns,omitempty"`
	Is3D       bool           `json:"is3d,omitempty"`
	Multiple   bool           `json:"multiple,omitempty"`
	Label      *s46lLabelSpec `json:"label,omitempty"`
}

type s46lEdgeSpec struct {
	From  int64          `json:"from"`
	To    int64          `json:"to"`
	Src   string         `json:"src,omitempty"`
	Dst   string         `json:"dst,omitempty"`
	Label *s46lLabelSpec `json:"label,omitempty"`
}

type s46lSpec struct {
	Nodes []s46lNodeSpec `json:"nodes"`
	Edges []s46lEdgeSpec `json:"edges"`
}

func (spec s46lSpec) build() (*layoutgraph.Graph, []*layoutgraph.Edge) {
	g := layoutgraph.NewGraph()
	nodes := make(map[int64]*layoutgraph.Node, len(spec.Nodes))
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(ns.ID, float64(ns.W), float64(ns.H))
		n.SetShape(ns.Shape)
		if ns.NumColumns != 0 {
			n.SetNumColumns(ns.NumColumns)
		}
		if ns.Placed {
			n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Width: float64(ns.Label.W), Height: float64(ns.Label.H), Position: label.Position(ns.Label.Pos)}
		}
		g.AddNewNodeToContainer(nil, n)
		nodes[ns.ID] = n
	}
	edges := make([]*layoutgraph.Edge, 0, len(spec.Edges))
	for _, es := range spec.Edges {
		e := g.Connect(nodes[es.From], nodes[es.To])
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		if es.Label != nil {
			e.Label = &layoutgraph.Label{Width: float64(es.Label.W), Height: float64(es.Label.H), Position: label.Position(es.Label.Pos)}
		}
		edges = append(edges, e)
	}
	return g, edges
}

func s46lPoints(points []*geo.Point) [][2]s46lF {
	out := make([][2]s46lF, 0, len(points))
	for _, p := range points {
		out = append(out, [2]s46lF{s46lF(p.X), s46lF(p.Y)})
	}
	return out
}

func s46lPanic(fn func()) (message string) {
	defer func() {
		if r := recover(); r != nil {
			message = fmt.Sprint(r)
		}
	}()
	fn()
	return ""
}

// ── Shape ports ─────────────────────────────────────────────────────────────

type s46lPortCase struct {
	Shape       string       `json:"shape"`
	NumColumns  int          `json:"numColumns"`
	W           s46lF        `json:"w"`
	H           s46lF        `json:"h"`
	X           s46lF        `json:"x"`
	Y           s46lF        `json:"y"`
	Snap        [][][2]s46lF `json:"snap"`
	Ports       [][2]s46lF   `json:"ports"`
	PortIndices [][]int      `json:"portIndices"`
	Centers     []int        `json:"centers"`
	CenterIndex []int        `json:"centerIndex"`
	Mirrored    [][2]int     `json:"mirrored"`
	MirroredNil bool         `json:"mirroredNil"`
	CentersNil  bool         `json:"centersNil"`
}

func s46lPortCaseOf(shape string, numColumns int, w, h, x, y float64) s46lPortCase {
	n := layoutgraph.NewNode(1, w, h)
	n.SetShape(shape)
	n.SetNumColumns(numColumns)
	n.TopLeft = geo.NewPoint(x, y)
	c := s46lPortCase{Shape: shape, NumColumns: numColumns, W: s46lF(w), H: s46lF(h), X: s46lF(x), Y: s46lF(y)}
	for _, group := range n.SnapPointPercentages() {
		rel := make([][2]s46lF, 0, len(group))
		for _, p := range group {
			rel = append(rel, [2]s46lF{s46lF(p.XPercentage), s46lF(p.YPercentage)})
		}
		c.Snap = append(c.Snap, rel)
	}
	for _, p := range n.Ports() {
		c.Ports = append(c.Ports, [2]s46lF{s46lF(p.X), s46lF(p.Y)})
	}
	for o := geo.TopLeft; o <= geo.NONE; o++ {
		indices := n.PortIndices(o)
		if indices == nil {
			indices = []int{}
		}
		c.PortIndices = append(c.PortIndices, indices)
		c.CenterIndex = append(c.CenterIndex, n.CenterPortIndex(o))
	}
	centers := n.CenterPortIndices()
	c.CentersNil = centers == nil
	c.Centers = centers
	if c.Centers == nil {
		c.Centers = []int{}
	}
	mirrored := n.MirroredPortIndices()
	c.MirroredNil = mirrored == nil
	keys := make([]int, 0, len(mirrored))
	for k := range mirrored {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	c.Mirrored = [][2]int{}
	for _, k := range keys {
		c.Mirrored = append(c.Mirrored, [2]int{k, mirrored[k]})
	}
	return c
}

func s46lPortCases() []s46lPortCase {
	sizes := [][2]float64{{0, 0}, {1, 1}, {10, 5}, {13.7, 41.3}, {100, 60}, {300, 20}, {20, 300}, {59.9, 89.9}, {123.456, 78.9}}
	var out []s46lPortCase
	for _, shape := range s46lShapes {
		for _, size := range sizes {
			out = append(out, s46lPortCaseOf(shape, 0, size[0], size[1], 3.5, -7.25))
		}
	}
	for numColumns := 1; numColumns <= 12; numColumns++ {
		out = append(out, s46lPortCaseOf("Table", numColumns, 240, float64(30*(numColumns+1))+0.5, 11, 13))
		out = append(out, s46lPortCaseOf("Table", numColumns, 99.5, 41.3, -20, 7))
	}
	// numColumns is only table metadata; every other shape ignores it.
	out = append(out, s46lPortCaseOf("", 4, 100, 60, 0, 0))
	out = append(out, s46lPortCaseOf("Cylinder", 3, 100, 60, 0, 0))
	return out
}

// ── Routing and offsets ─────────────────────────────────────────────────────

type s46lRoutedEdge struct {
	Edge       int        `json:"edge"`
	Points     [][2]s46lF `json:"points"`
	LabelPos   int        `json:"labelPos"`
	SharesFrom int        `json:"sharesFrom"`
	SharesTo   int        `json:"sharesTo"`
}

type s46lRouteResult struct {
	Node   int64            `json:"node"`
	Routed []s46lRoutedEdge `json:"routed"`
	Panic  bool             `json:"panic"`
}

type s46lNodeOffsets struct {
	ID      int64    `json:"id"`
	Offsets []s46lF  `json:"offsets"`
	Empty   bool     `json:"empty"`
	Placed  bool     `json:"placed"`
	TopLeft [2]s46lF `json:"topLeft"`
}

type s46lEdgeAfter struct {
	Points   [][2]s46lF `json:"points"`
	LabelPos int        `json:"labelPos"`
}

type s46lOffsetsResult struct {
	Nodes []s46lNodeOffsets `json:"nodes"`
	Edges []s46lEdgeAfter   `json:"edges"`
	Panic bool              `json:"panic"`
}

type s46lLoopCase struct {
	Name    string            `json:"name"`
	Spec    s46lSpec          `json:"spec"`
	Routes  []s46lRouteResult `json:"routes"`
	Offsets s46lOffsetsResult `json:"offsets"`
	// Single-node UpdateOffsets on a fresh graph for every node.
	Updates []s46lOffsetsResult `json:"updates"`
}

var s46lOffsetOrder = []geo.Orientation{
	geo.Left, geo.Right, geo.Top, geo.Bottom, geo.TopLeft, geo.TopRight, geo.BottomLeft, geo.BottomRight,
}

func s46lSnapshot(g *layoutgraph.Graph, edges []*layoutgraph.Edge) s46lOffsetsResult {
	var r s46lOffsetsResult
	for _, n := range g.Nodes {
		no := s46lNodeOffsets{ID: n.ID, Empty: len(n.LoopOffsets) == 0}
		if n.LoopOffsets == nil {
			panic("LoopOffsets unexpectedly nil after offset computation")
		}
		if !no.Empty {
			if len(n.LoopOffsets) != len(s46lOffsetOrder) {
				panic("unexpected loop offset cardinality")
			}
			for _, o := range s46lOffsetOrder {
				no.Offsets = append(no.Offsets, s46lF(n.LoopOffsets[o]))
			}
		}
		if n.TopLeft != nil {
			no.Placed = true
			no.TopLeft = [2]s46lF{s46lF(n.TopLeft.X), s46lF(n.TopLeft.Y)}
		}
		r.Nodes = append(r.Nodes, no)
	}
	for _, e := range edges {
		ea := s46lEdgeAfter{Points: s46lPoints(e.Points), LabelPos: -1}
		if e.Label != nil {
			ea.LabelPos = int(e.Label.Position)
		}
		r.Edges = append(r.Edges, ea)
	}
	return r
}

func s46lEvaluate(name string, spec s46lSpec) s46lLoopCase {
	c := s46lLoopCase{Name: name, Spec: spec}
	{
		g, _ := spec.build()
		for i := range g.Nodes {
			g2, edges2 := spec.build()
			node := g2.Nodes[i]
			index := make(map[*layoutgraph.Edge]int, len(edges2))
			for j, e := range edges2 {
				index[e] = j
			}
			rr := s46lRouteResult{Node: node.ID, Routed: []s46lRoutedEdge{}}
			var routed []*layoutgraph.Edge
			msg := s46lPanic(func() { routed = Route(node) })
			rr.Panic = msg != ""
			if !rr.Panic {
				for k, e := range routed {
					re := s46lRoutedEdge{Edge: index[e], Points: s46lPoints(e.Points), LabelPos: -1, SharesFrom: -1, SharesTo: -1}
					if e.Label != nil {
						re.LabelPos = int(e.Label.Position)
					}
					for j := 0; j < k; j++ {
						other := routed[j]
						if re.SharesFrom < 0 && other.Points[0] == e.Points[0] {
							re.SharesFrom = j
						}
						if re.SharesTo < 0 && other.Points[len(other.Points)-1] == e.Points[len(e.Points)-1] {
							re.SharesTo = j
						}
					}
					rr.Routed = append(rr.Routed, re)
				}
			}
			c.Routes = append(c.Routes, rr)
		}
	}
	{
		g, edges := spec.build()
		msg := s46lPanic(func() { ComputeOffsets(g) })
		if msg != "" {
			c.Offsets = s46lOffsetsResult{Panic: true}
		} else {
			c.Offsets = s46lSnapshot(g, edges)
		}
	}
	for i := range spec.Nodes {
		g, edges := spec.build()
		node := g.Nodes[i]
		msg := s46lPanic(func() { UpdateOffsets(node) })
		if msg != "" {
			c.Updates = append(c.Updates, s46lOffsetsResult{Panic: true})
			continue
		}
		// Only the updated node carries offsets; others keep nil maps.
		var r s46lOffsetsResult
		snap := s46lSnapshotNode(node)
		r.Nodes = []s46lNodeOffsets{snap}
		for _, e := range edges {
			ea := s46lEdgeAfter{Points: s46lPoints(e.Points), LabelPos: -1}
			if e.Label != nil {
				ea.LabelPos = int(e.Label.Position)
			}
			r.Edges = append(r.Edges, ea)
		}
		c.Updates = append(c.Updates, r)
	}
	return c
}

func s46lSnapshotNode(n *layoutgraph.Node) s46lNodeOffsets {
	no := s46lNodeOffsets{ID: n.ID, Empty: len(n.LoopOffsets) == 0}
	if !no.Empty {
		for _, o := range s46lOffsetOrder {
			no.Offsets = append(no.Offsets, s46lF(n.LoopOffsets[o]))
		}
	}
	if n.TopLeft != nil {
		no.Placed = true
		no.TopLeft = [2]s46lF{s46lF(n.TopLeft.X), s46lF(n.TopLeft.Y)}
	}
	return no
}

func s46lLabel(w, h float64) *s46lLabelSpec {
	return &s46lLabelSpec{W: s46lF(w), H: s46lF(h)}
}

func s46lHandcrafted() []s46lLoopCase {
	var out []s46lLoopCase
	add := func(name string, spec s46lSpec) { out = append(out, s46lEvaluate(name, spec)) }

	add("no-loops", s46lSpec{
		Nodes: []s46lNodeSpec{{ID: 1, W: 100, H: 60, Placed: true, X: 10, Y: 20}, {ID: 2, W: 50, H: 50, Placed: true, X: 300, Y: 20}},
		Edges: []s46lEdgeSpec{{From: 1, To: 2, Dst: "triangle"}},
	})
	add("empty-node", s46lSpec{Nodes: []s46lNodeSpec{{ID: 1, W: 100, H: 60}}})
	// One loop per shape, unplaced (UpdateOffsets uses a provisional origin).
	for i, shape := range s46lShapes {
		add("single-"+shape, s46lSpec{
			Nodes: []s46lNodeSpec{{ID: 1, W: s46lF(80 + 7*i), H: s46lF(50 + 3*i), Shape: shape, Placed: i%2 == 0, X: 40, Y: -15}},
			Edges: []s46lEdgeSpec{{From: 1, To: 1, Dst: "triangle"}},
		})
	}
	// All arrow categories on every shape (see self_edges_all_shapes).
	for i, shape := range s46lShapes {
		add("all-kinds-"+shape, s46lSpec{
			Nodes: []s46lNodeSpec{{ID: 1, W: s46lF(120 + 5*i), H: s46lF(90 + 2*i), Shape: shape, Placed: true, X: 100.5, Y: 200.25}},
			Edges: []s46lEdgeSpec{
				{From: 1, To: 1},
				{From: 1, To: 1, Src: "triangle", Dst: "triangle"},
				{From: 1, To: 1, Dst: "triangle"},
				{From: 1, To: 1, Src: "triangle"},
			},
		})
	}
	// Multiple loops sharing pairs, with labels of varied areas.
	add("stacked-labelled", s46lSpec{
		Nodes: []s46lNodeSpec{{ID: 1, W: 160, H: 100, Placed: true, X: 0, Y: 0}, {ID: 2, W: 80, H: 80, Placed: true, X: 400, Y: 0}},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Dst: "triangle", Label: s46lLabel(40, 18)},
			{From: 1, To: 1, Dst: "triangle", Label: s46lLabel(10, 18)},
			{From: 1, To: 1, Dst: "triangle"},
			{From: 1, To: 2, Dst: "triangle"},
			{From: 1, To: 1, Src: "arrow", Dst: "arrow", Label: s46lLabel(70.5, 20.5)},
			{From: 1, To: 1, Dst: "triangle", Label: s46lLabel(25, 30)},
			{From: 2, To: 2, Label: s46lLabel(12, 12)},
			{From: 1, To: 1, Src: "none", Dst: "none"},
		},
	})
	add("distinct-arrowheads", s46lSpec{
		Nodes: []s46lNodeSpec{{ID: 1, W: 140, H: 70, Placed: true, X: 7, Y: 9}},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Dst: "triangle"},
			{From: 1, To: 1, Dst: "arrow"},
			{From: 1, To: 1, Dst: "diamond"},
			{From: 1, To: 1, Src: "circle"},
			{From: 1, To: 1, Dst: "triangle", Label: s46lLabel(5, 5)},
			{From: 1, To: 1, Src: "diamond"},
		},
	})
	// Four distinct one-sided arrowheads exhaust every pair; a plain loop then
	// finds no pair and Go dereferences a nil *loopPorts.
	add("pairs-exhausted", s46lSpec{
		Nodes: []s46lNodeSpec{{ID: 1, W: 140, H: 70, Placed: true, X: 7, Y: 9}},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Dst: "triangle"},
			{From: 1, To: 1, Dst: "arrow"},
			{From: 1, To: 1, Dst: "diamond"},
			{From: 1, To: 1, Dst: "circle"},
			{From: 1, To: 1},
		},
	})
	add("modifiers", s46lSpec{
		Nodes: []s46lNodeSpec{
			{ID: 1, W: 120, H: 80, Placed: true, X: 0, Y: 0, Is3D: true},
			{ID: 2, W: 120, H: 80, Placed: true, X: 300, Y: 0, Multiple: true, Shape: "Hexagon"},
			{ID: 3, W: 120, H: 80, Placed: false, Is3D: true, Shape: "Hexagon",
				Label: &s46lLabelSpec{W: 300, H: 40, Pos: int(label.OutsideTopCenter)}},
		},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Dst: "triangle"},
			{From: 2, To: 2, Src: "triangle", Dst: "triangle", Label: s46lLabel(33, 11)},
			{From: 3, To: 3},
			{From: 1, To: 3},
		},
	})
	add("tables", s46lSpec{
		Nodes: []s46lNodeSpec{
			{ID: 1, W: 200, H: 150, Placed: true, X: 0, Y: 0, Shape: "Table", NumColumns: 4},
			{ID: 2, W: 200, H: 40, Placed: true, X: 400, Y: 0, Shape: "Table"},
		},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Dst: "triangle"},
			{From: 1, To: 1},
			{From: 2, To: 2, Dst: "cf-many"},
		},
	})
	add("tiny-and-fractional", s46lSpec{
		Nodes: []s46lNodeSpec{
			{ID: 1, W: 3, H: 2, Placed: true, X: 0.3, Y: 0.7, Shape: "Cloud"},
			{ID: 2, W: 33.3, H: 17.7, Placed: true, X: -50.5, Y: 12.25, Shape: "Callout"},
			{ID: 3, W: 0, H: 0, Placed: true, X: 5, Y: 5, Shape: "Parallelogram"},
		},
		Edges: []s46lEdgeSpec{
			{From: 1, To: 1, Src: "arrow"},
			{From: 2, To: 2, Dst: "arrow", Label: s46lLabel(9.5, 4.25)},
			{From: 3, To: 3},
		},
	})
	return out
}

func s46lRandomSpec(rng *rand.Rand) s46lSpec {
	var spec s46lSpec
	nodeCount := 1 + rng.Intn(3)
	for i := 0; i < nodeCount; i++ {
		spec.Nodes = append(spec.Nodes, s46lNodeSpec{
			ID:     int64(i + 1),
			W:      s46lF(float64(20+rng.Intn(200)) + float64(rng.Intn(4))*0.25),
			H:      s46lF(float64(20+rng.Intn(160)) + float64(rng.Intn(4))*0.25),
			Placed: rng.Intn(4) != 0,
			X:      s46lF(float64(rng.Intn(800) - 300)),
			Y:      s46lF(float64(rng.Intn(800)-300) + 0.5),
			Shape:  s46lShapes[rng.Intn(len(s46lShapes))],
			Is3D:   rng.Intn(6) == 0,
		})
	}
	edgeCount := rng.Intn(9)
	for i := 0; i < edgeCount; i++ {
		from := int64(1 + rng.Intn(nodeCount))
		to := from
		if rng.Intn(4) == 0 {
			to = int64(1 + rng.Intn(nodeCount))
		}
		es := s46lEdgeSpec{From: from, To: to}
		// Keep arrowhead variety low so loops never exhaust the four pairs.
		switch rng.Intn(4) {
		case 0:
		case 1:
			es.Dst = "triangle"
		case 2:
			es.Src = "triangle"
		case 3:
			es.Src, es.Dst = "triangle", "triangle"
		}
		if rng.Intn(2) == 0 {
			es.Label = s46lLabel(float64(5+rng.Intn(60)), float64(5+rng.Intn(25)))
		}
		spec.Edges = append(spec.Edges, es)
	}
	return spec
}

// ── edgesInOrder ────────────────────────────────────────────────────────────

type s46lOrderCase struct {
	Edges []s46lEdgeSpec `json:"edges"`
	Order []int          `json:"order"`
}

func s46lOrderCases(rng *rand.Rand) []s46lOrderCase {
	areas := []float64{0, 6, 12, math.NaN(), 25}
	var out []s46lOrderCase
	for i := 0; i < 60; i++ {
		count := 1 + rng.Intn(70)
		var spec []s46lEdgeSpec
		for j := 0; j < count; j++ {
			es := s46lEdgeSpec{From: 1, To: 1}
			if rng.Intn(3) == 0 {
				es.To = 2
			}
			es.Src = s46lArrowheads[rng.Intn(len(s46lArrowheads))]
			es.Dst = s46lArrowheads[rng.Intn(len(s46lArrowheads))]
			if rng.Intn(3) != 0 {
				area := areas[rng.Intn(len(areas))]
				es.Label = s46lLabel(area, 1)
				if rng.Intn(2) == 0 && !math.IsNaN(area) {
					es.Label = s46lLabel(1, area)
				}
			}
			spec = append(spec, es)
		}
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		edges := make([]*layoutgraph.Edge, 0, count)
		index := make(map[*layoutgraph.Edge]int, count)
		for j, es := range spec {
			to := n1
			if es.To == 2 {
				to = n2
			}
			e := layoutgraph.NewEdge(n1, to)
			e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
			e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
			if es.Label != nil {
				e.Label = &layoutgraph.Label{Width: float64(es.Label.W), Height: float64(es.Label.H)}
			}
			edges = append(edges, e)
			index[e] = j
		}
		var order []int
		for _, e := range edgesInOrder(edges) {
			order = append(order, index[e])
		}
		out = append(out, s46lOrderCase{Edges: spec, Order: order})
	}
	return out
}

type s46lOracle struct {
	Ports  []s46lPortCase  `json:"ports"`
	Loops  []s46lLoopCase  `json:"loops"`
	Orders []s46lOrderCase `json:"orders"`
}

func TestSlice46LoopsOracle(t *testing.T) {
	oracle := s46lOracle{Ports: s46lPortCases(), Loops: s46lHandcrafted()}
	rng := rand.New(rand.NewSource(4646))
	for i := 0; i < 60; i++ {
		oracle.Loops = append(oracle.Loops, s46lEvaluate(fmt.Sprintf("random-%d", i), s46lRandomSpec(rng)))
	}
	oracle.Orders = s46lOrderCases(rng)
	s46lWriteOrCompare(t, "go-slice46-loops-reference.json", oracle)
}

func s46lWriteOrCompare(t *testing.T, name string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", name)
	if os.Getenv("TALA_SLICE46_ORACLE") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, encoded) {
		t.Fatalf("%s is stale; regenerate with TALA_SLICE46_ORACLE=1", name)
	}
}
