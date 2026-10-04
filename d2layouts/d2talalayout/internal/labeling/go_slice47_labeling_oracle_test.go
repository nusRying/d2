package labeling

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 47 labeling oracle: arrowhead label geometry, the label-placement
// guard kernels used by routing, and labeling.PlaceNewEdges with exact
// work-limit, cancellation, panic and validation behaviour. With
// TALA_SLICE47_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice47-labeling-reference.json; otherwise it recomputes
// every value and asserts the committed fixture is byte-identical.
//
// findSharedSegmentsChecked groups segments in Go maps (random iteration
// order); the oracle records its segments sorted and its work steps, which
// are order independent.

type s47lF float64

func (f s47lF) MarshalJSON() ([]byte, error) {
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

func s47lPoints(route [][2]s47lF) []*geo.Point {
	points := make([]*geo.Point, 0, len(route))
	for _, p := range route {
		points = append(points, geo.NewPoint(float64(p[0]), float64(p[1])))
	}
	return points
}

func s47lPanicText(recovered any) string {
	if _, ok := recovered.(runtime.Error); ok {
		return "runtime error"
	}
	return fmt.Sprint(recovered)
}

// ── Contexts ────────────────────────────────────────────────────────────────

type s47lContext struct {
	context.Context
	calls    int
	cancelAt int
	panicAt  int
}

func (ctx *s47lContext) Err() error {
	ctx.calls++
	if ctx.panicAt > 0 && ctx.calls >= ctx.panicAt {
		panic("label placement test panic")
	}
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

// ── Arrowhead labels ────────────────────────────────────────────────────────

var s47lArrowheads = []string{
	"", "none", "arrow", "triangle", "unfilled-triangle", "line", "filled-diamond", "diamond", "cross",
	"filled-circle", "circle", "filled-box", "box", "cf-one", "cf-many", "cf-one-required", "cf-many-required", "bogus",
}

var s47lRoutes = [][][2]s47lF{
	{{0, 0}, {100, 0}},
	{{100, 0}, {0, 0}},
	{{0, 0}, {0, 100}},
	{{0, 100}, {0, 0}},
	{{0, 0}, {60, 80}},
	{{0, 0}, {45, 0}, {45, 70}},
	{{10, 10}, {10, 200}, {150, 200}, {150, 90}},
	{{0, 0}, {3, 0}},
	{{0, 0}, {50, 0}, {50, 0}},
	{{-20.5, 7.25}, {-20.5, -90.75}, {33.125, -90.75}},
	{{5, 5}},
}

var s47lSizes = [][2]s47lF{{30, 12}, {30.9, 12.9}, {0, 0}, {-0.5, 7.7}, {200.25, 41.5}}

type s47lArrowProbe struct {
	Src      string     `json:"src"`
	Dst      string     `json:"dst"`
	Route    [][2]s47lF `json:"route"`
	IsTarget bool       `json:"isTarget"`
	HasLabel bool       `json:"hasLabel"`
	W        s47lF      `json:"w"`
	H        s47lF      `json:"h"`
	Text     string     `json:"text"`
	Nil      bool       `json:"nil,omitempty"`
	Box      []s47lF    `json:"box,omitempty"`
	Panic    string     `json:"panic,omitempty"`
}

func s47lArrowProbeOf(src, dst string, route [][2]s47lF, isTarget, hasLabel bool, size [2]s47lF, text string) s47lArrowProbe {
	probe := s47lArrowProbe{Src: src, Dst: dst, Route: route, IsTarget: isTarget, HasLabel: hasLabel, W: size[0], H: size[1], Text: text}
	edge := layoutgraph.NewEdge(nil, nil)
	edge.Points = s47lPoints(route)
	edge.SourceArrowhead = layoutgraph.Arrowhead(src)
	edge.TargetArrowhead = layoutgraph.Arrowhead(dst)
	if hasLabel {
		value := &layoutgraph.Label{Text: text, Width: float64(size[0]), Height: float64(size[1])}
		if isTarget {
			edge.TargetArrowheadLabel = value
		} else {
			edge.SourceArrowheadLabel = value
		}
	}
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				probe.Panic = fmt.Sprint(recovered)
			}
		}()
		positioned := PositionArrowheadLabel(edge, isTarget, edge.Points)
		if positioned == nil {
			probe.Nil = true
			return
		}
		if positioned.Edge != edge || positioned.IsTarget != isTarget || positioned.Text != text {
			panic("positioned arrowhead metadata mismatch")
		}
		probe.Box = []s47lF{s47lF(positioned.TopLeft.X), s47lF(positioned.TopLeft.Y), s47lF(positioned.Width), s47lF(positioned.Height)}
	}()
	return probe
}

func s47lArrowProbes() []s47lArrowProbe {
	var probes []s47lArrowProbe
	n := len(s47lArrowheads)
	for r, route := range s47lRoutes {
		for i := range s47lArrowheads {
			for _, isTarget := range []bool{false, true} {
				src := s47lArrowheads[i]
				dst := s47lArrowheads[(i*7+3)%n]
				if isTarget {
					src, dst = dst, src
				}
				size := s47lSizes[(i+r)%len(s47lSizes)]
				hasLabel := (i+r)%9 != 4
				probes = append(probes, s47lArrowProbeOf(src, dst, route, isTarget, hasLabel, size, fmt.Sprintf("a%d-%d", r, i)))
			}
		}
	}
	for _, size := range s47lSizes {
		for _, isTarget := range []bool{false, true} {
			probes = append(probes, s47lArrowProbeOf("triangle", "diamond", s47lRoutes[0], isTarget, true, size, "sized"))
		}
	}
	return probes
}

// ── Shared segments and edge sorting ───────────────────────────────────────

type s47lSharedProbe struct {
	Routes   [][][2]s47lF `json:"routes"`
	Steps    int          `json:"steps"`
	Segments []string     `json:"segments"`
}

func s47lSegmentKey(segment *geo.Segment) string {
	encoded, err := json.Marshal([]s47lF{s47lF(segment.Start.X), s47lF(segment.Start.Y), s47lF(segment.End.X), s47lF(segment.End.Y)})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func s47lSharedProbeOf(routes [][][2]s47lF) s47lSharedProbe {
	edges := make([]*layoutgraph.Edge, 0, len(routes))
	for _, route := range routes {
		edge := layoutgraph.NewEdge(nil, nil)
		edge.Points = s47lPoints(route)
		edges = append(edges, edge)
	}
	steps := 0
	segments, err := findSharedSegmentsChecked(edges, func() error {
		steps++
		return nil
	})
	if err != nil {
		panic(err)
	}
	probe := s47lSharedProbe{Routes: routes, Steps: steps, Segments: []string{}}
	for _, segment := range segments {
		probe.Segments = append(probe.Segments, s47lSegmentKey(segment))
	}
	sort.Strings(probe.Segments)
	return probe
}

func s47lRandomAxisRoute(rng *rand.Rand, maxPoints int) [][2]s47lF {
	count := 2 + rng.Intn(maxPoints-1)
	x := s47lF(10 * rng.Intn(11))
	y := s47lF(10 * rng.Intn(11))
	route := [][2]s47lF{{x, y}}
	horizontal := rng.Intn(2) == 0
	for len(route) < count {
		step := s47lF(10 * rng.Intn(11))
		if horizontal {
			x = step
		} else {
			y = step
		}
		horizontal = !horizontal
		route = append(route, [2]s47lF{x, y})
	}
	return route
}

func s47lSharedProbes(rng *rand.Rand) []s47lSharedProbe {
	nan := s47lF(math.NaN())
	negZero := s47lF(math.Copysign(0, -1))
	probes := []s47lSharedProbe{
		s47lSharedProbeOf(nil),
		s47lSharedProbeOf([][][2]s47lF{
			{{300, 300}, {200, 300}, {200, 200}, {100, 200}},
			{{300, 350}, {200, 350}, {200, 100}, {300, 100}},
			{{300, 100}, {50, 100}, {50, 150}},
			{{300, 100}, {200, 100}, {200, 180}, {100, 180}},
		}),
		s47lSharedProbeOf([][][2]s47lF{{{0, 0}, {100, 0}}, {{10, 0}, {20, 0}}, {{30, 0}, {40, 0}}, {{50, 0}, {50, 0}}}),
		s47lSharedProbeOf([][][2]s47lF{{{0, 100}, {0, 0}}, {{0, 20}, {0, 10}}, {{0, 40}, {0, 30}}, {{0, 50}, {0, 50}}}),
		s47lSharedProbeOf([][][2]s47lF{
			{{nan, 0}, {nan, 50}}, {{nan, 10}, {nan, 60}}, {{0, nan}, {50, nan}}, {{5, nan}, {60, nan}},
			{{negZero, 0}, {negZero, 50}}, {{0, 10}, {0, 70}}, {{0, negZero}, {40, negZero}}, {{10, 0}, {90, 0}},
			{{7, 0}, {7, nan}}, {{7, 5}, {7, 20}},
		}),
	}
	for i := 0; i < 40; i++ {
		count := rng.Intn(6)
		var routes [][][2]s47lF
		for j := 0; j < count; j++ {
			routes = append(routes, s47lRandomAxisRoute(rng, 6))
		}
		probes = append(probes, s47lSharedProbeOf(routes))
	}
	return probes
}

type s47lSortProbe struct {
	Routes [][][2]s47lF `json:"routes"`
	Order  []int        `json:"order"`
	Used   int64        `json:"used"`
}

func s47lSortProbes(rng *rand.Rand) []s47lSortProbe {
	var probes []s47lSortProbe
	for i := 0; i < 30; i++ {
		count := rng.Intn(13)
		routes := make([][][2]s47lF, 0, count)
		edges := make([]*layoutgraph.Edge, 0, count)
		for j := 0; j < count; j++ {
			points := 2 + rng.Intn(3)
			route := [][2]s47lF{{0, 0}}
			x := s47lF(0)
			for len(route) < points {
				x += s47lF(10 * (1 + rng.Intn(3)))
				route = append(route, [2]s47lF{x, 0})
			}
			routes = append(routes, route)
			edge := layoutgraph.NewEdge(nil, nil)
			edge.Points = s47lPoints(route)
			edges = append(edges, edge)
		}
		guard, err := newLabelPlacementWorkGuard(context.Background(), "sort", maxLabelPlacementWorkUnits)
		if err != nil {
			panic(err)
		}
		sorted, err := sortLabelPlacementEdges(edges, guard)
		if err != nil {
			panic(err)
		}
		probe := s47lSortProbe{Routes: routes, Order: []int{}, Used: guard.used}
		for _, edge := range sorted {
			for index, candidate := range edges {
				if candidate == edge {
					probe.Order = append(probe.Order, index)
				}
			}
		}
		probes = append(probes, probe)
	}
	return probes
}

// ── Overlap kernels ─────────────────────────────────────────────────────────

type s47lKernelResult struct {
	Delta      s47lF `json:"delta"`
	Count      int   `json:"count"`
	Area       s47lF `json:"area"`
	AreaCount  int   `json:"areaCount"`
	PArea      s47lF `json:"pArea"`
	PAreaCount int   `json:"pAreaCount"`
	Edges      int   `json:"edges"`
	Score      s47lF `json:"score"`
	Used       int64 `json:"used"`
}

type s47lKernelProbe struct {
	Box     [4]s47lF           `json:"box"`
	Nodes   [][5]s47lF         `json:"nodes"`
	Routes  [][][2]s47lF       `json:"routes"`
	Extra   [3]int             `json:"extra"`
	Results []s47lKernelResult `json:"results"`
}

func s47lKernelProbes(rng *rand.Rand) []s47lKernelProbe {
	var probes []s47lKernelProbe
	for i := 0; i < 40; i++ {
		probe := s47lKernelProbe{
			Box:   [4]s47lF{s47lF(rng.Intn(200)) - 20, s47lF(rng.Intn(200)) - 20, s47lF(10 + rng.Intn(90)), s47lF(5 + rng.Intn(40))},
			Extra: [3]int{rng.Intn(4), rng.Intn(4), rng.Intn(4)},
		}
		if i%7 == 3 {
			probe.Box[0] += 0.5
			probe.Box[3] = 0
		}
		g := layoutgraph.NewGraph()
		var nodes []*layoutgraph.Node
		for j, count := 0, rng.Intn(7); j < count; j++ {
			spec := [5]s47lF{s47lF(rng.Intn(220)) - 30, s47lF(rng.Intn(220)) - 30, s47lF(5 + rng.Intn(150)), s47lF(5 + rng.Intn(150)), s47lF(rng.Intn(2))}
			probe.Nodes = append(probe.Nodes, spec)
			n := layoutgraph.NewNode(layoutgraph.EntityID(j+1), float64(spec[2]), float64(spec[3]))
			n.TopLeft = geo.NewPoint(float64(spec[0]), float64(spec[1]))
			g.AddNewNodeToContainer(nil, n)
			if spec[4] == 1 {
				child := layoutgraph.NewNode(layoutgraph.EntityID(100+j), 1, 1)
				child.TopLeft = geo.NewPoint(float64(spec[0]), float64(spec[1]))
				g.AddNewNodeToContainer(n, child)
			}
			nodes = append(nodes, n)
		}
		var edges []*layoutgraph.Edge
		for j, count := 0, rng.Intn(4); j < count; j++ {
			route := s47lRandomAxisRoute(rng, 5)
			for k := range route {
				route[k][0] = route[k][0]*2 - 20
				route[k][1] = route[k][1]*2 - 20
			}
			probe.Routes = append(probe.Routes, route)
			edge := layoutgraph.NewEdge(nil, nil)
			edge.Points = s47lPoints(route)
			edges = append(edges, edge)
		}
		box := &layoutgraph.Node{Box: geo.Box{
			TopLeft: geo.NewPoint(float64(probe.Box[0]), float64(probe.Box[1])),
			Width:   float64(probe.Box[2]),
			Height:  float64(probe.Box[3]),
		}}
		box.SetShape("Square")
		for _, delta := range []float64{0, 4, 5} {
			guard, err := newLabelPlacementWorkGuard(context.Background(), "kernel", maxLabelPlacementWorkUnits)
			if err != nil {
				panic(err)
			}
			result := s47lKernelResult{Delta: s47lF(delta)}
			must := func(err error) {
				if err != nil {
					panic(err)
				}
			}
			var area, parea float64
			result.Count, err = nodeOverlapCount(box, nodes, delta, guard)
			must(err)
			area, result.AreaCount, err = nodeOverlapArea(box, nodes, delta, false, guard)
			must(err)
			parea, result.PAreaCount, err = nodeOverlapArea(box, nodes, delta, true, guard)
			must(err)
			result.Edges, err = edgeOverlapCount(box, edges, delta, guard)
			must(err)
			result.Area, result.PArea = s47lF(area), s47lF(parea)
			result.Score = s47lF(scoreEdgeLabelOverlaps(box.Area(), area+parea, result.AreaCount+result.PAreaCount, result.Edges, probe.Extra[0], probe.Extra[1], probe.Extra[2]))
			result.Used = guard.used
			probe.Results = append(probe.Results, result)
		}
		probes = append(probes, probe)
	}
	return probes
}

type s47lRangeProbe struct {
	Route [][2]s47lF `json:"route"`
	From  bool       `json:"fromCluster"`
	To    bool       `json:"toCluster"`
	W     s47lF      `json:"w"`
	H     s47lF      `json:"h"`
	Range [2]s47lF   `json:"range"`
}

func s47lRangeProbes(rng *rand.Rand) []s47lRangeProbe {
	var probes []s47lRangeProbe
	for i := 0; i < 40; i++ {
		probe := s47lRangeProbe{Route: s47lRandomAxisRoute(rng, 5), From: i%3 == 0, To: i%3 == 1 || i%5 == 0,
			W: s47lF(rng.Intn(60)), H: s47lF(rng.Intn(30))}
		from := layoutgraph.NewNode(1, 10, 10)
		to := layoutgraph.NewNode(2, 10, 10)
		if probe.From {
			from.Cluster = &layoutgraph.Cluster{}
		}
		if probe.To {
			to.Cluster = &layoutgraph.Cluster{}
		}
		edge := layoutgraph.NewEdge(from, to)
		edge.Points = s47lPoints(probe.Route)
		edge.Label = &layoutgraph.Label{Width: float64(probe.W), Height: float64(probe.H)}
		r := labelPercentageSearchRange(edge, edge.Length())
		probe.Range = [2]s47lF{s47lF(r.start), s47lF(r.end)}
		probes = append(probes, probe)
	}
	return probes
}

// ── Graph specs ─────────────────────────────────────────────────────────────

type s47lLabelSpec struct {
	Text  string `json:"text"`
	W     s47lF  `json:"w"`
	H     s47lF  `json:"h"`
	Pos   int    `json:"pos"`
	Fixed bool   `json:"fixed,omitempty"`
}

type s47lIconSpec struct {
	Pos   int  `json:"pos"`
	Fixed bool `json:"fixed,omitempty"`
}

type s47lLoopSpec struct {
	O int   `json:"o"`
	V s47lF `json:"v"`
}

type s47lNodeSpec struct {
	ID        int64          `json:"id"`
	W         s47lF          `json:"w"`
	H         s47lF          `json:"h"`
	X         s47lF          `json:"x"`
	Y         s47lF          `json:"y"`
	Unplaced  bool           `json:"unplaced,omitempty"`
	Shape     string         `json:"shape,omitempty"`
	Container int64          `json:"container,omitempty"`
	Label     *s47lLabelSpec `json:"label,omitempty"`
	Icon      *s47lIconSpec  `json:"icon,omitempty"`
	Is3D      bool           `json:"is3d,omitempty"`
	Multiple  bool           `json:"multiple,omitempty"`
	Loops     []s47lLoopSpec `json:"loops,omitempty"`
}

type s47lClusterSpec struct {
	Vessel  int64   `json:"vessel"`
	Members []int64 `json:"members"`
}

type s47lEdgeSpec struct {
	ID       int64          `json:"id"`
	From     int64          `json:"from"`
	To       int64          `json:"to"`
	Points   [][2]s47lF     `json:"points"`
	Label    *s47lLabelSpec `json:"label,omitempty"`
	Pct      s47lF          `json:"pct,omitempty"`
	Src      string         `json:"src,omitempty"`
	Dst      string         `json:"dst,omitempty"`
	SrcLabel *s47lLabelSpec `json:"srcLabel,omitempty"`
	DstLabel *s47lLabelSpec `json:"dstLabel,omitempty"`
}

type s47lSpec struct {
	Nodes    []s47lNodeSpec    `json:"nodes"`
	Clusters []s47lClusterSpec `json:"clusters,omitempty"`
	Edges    []s47lEdgeSpec    `json:"edges"`
	Selected []int             `json:"selected"`
}

type s47lBuilt struct {
	g          *layoutgraph.Graph
	byID       map[int64]*layoutgraph.Node
	edges      []*layoutgraph.Edge
	selected   []*layoutgraph.Edge
	nodeLabels []*layoutgraph.Label
	nodeIcons  []*layoutgraph.Icon
	edgeLabels []*layoutgraph.Label
}

func s47lLabelOf(spec *s47lLabelSpec) *layoutgraph.Label {
	if spec == nil {
		return nil
	}
	value := &layoutgraph.Label{Text: spec.Text, Position: label.Position(spec.Pos), Width: float64(spec.W), Height: float64(spec.H)}
	if spec.Fixed {
		value.FixPosition()
	}
	return value
}

func s47lBuild(spec s47lSpec) *s47lBuilt {
	b := &s47lBuilt{g: layoutgraph.NewGraph(), byID: map[int64]*layoutgraph.Node{}}
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		if !ns.Unplaced {
			n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		}
		n.Label = s47lLabelOf(ns.Label)
		if ns.Icon != nil {
			n.Icon = &layoutgraph.Icon{Position: label.Position(ns.Icon.Pos)}
			if ns.Icon.Fixed {
				n.Icon.FixPosition()
			}
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
		if len(ns.Loops) > 0 {
			n.LoopOffsets = map[geo.Orientation]float64{}
			for _, loop := range ns.Loops {
				n.LoopOffsets[geo.Orientation(loop.O)] = float64(loop.V)
			}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = b.byID[ns.Container]
		}
		b.g.AddNewNodeToContainer(container, n)
		b.byID[ns.ID] = n
		b.nodeLabels = append(b.nodeLabels, n.Label)
		b.nodeIcons = append(b.nodeIcons, n.Icon)
	}
	for _, cs := range spec.Clusters {
		cluster := &layoutgraph.Cluster{Vessel: layoutgraph.NewNode(layoutgraph.EntityID(cs.Vessel), 10, 10)}
		for _, member := range cs.Members {
			cluster.Nodes = append(cluster.Nodes, b.byID[member])
			b.byID[member].Cluster = cluster
		}
	}
	for _, es := range spec.Edges {
		e := b.g.Connect(b.byID[es.From], b.byID[es.To])
		e.ID = layoutgraph.EntityID(es.ID)
		e.Points = s47lPoints(es.Points)
		e.Label = s47lLabelOf(es.Label)
		e.LabelPercentage = float64(es.Pct)
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		e.SourceArrowheadLabel = s47lLabelOf(es.SrcLabel)
		e.TargetArrowheadLabel = s47lLabelOf(es.DstLabel)
		b.edges = append(b.edges, e)
		b.edgeLabels = append(b.edgeLabels, e.Label)
	}
	for _, index := range spec.Selected {
		if index < 0 {
			b.selected = append(b.selected, nil)
		} else {
			b.selected = append(b.selected, b.edges[index])
		}
	}
	return b
}

// ── State and runs ──────────────────────────────────────────────────────────

type s47lEdgeState struct {
	Pos int     `json:"pos"`
	Pct s47lF   `json:"pct"`
	TL  []s47lF `json:"tl,omitempty"`
}

type s47lState struct {
	Edges      []s47lEdgeState `json:"edges"`
	NodeLabels []int           `json:"nodeLabels"`
	Icons      []int           `json:"icons"`
}

func s47lStateOf(b *s47lBuilt, withTL bool) s47lState {
	state := s47lState{Edges: []s47lEdgeState{}, NodeLabels: []int{}, Icons: []int{}}
	for _, e := range b.edges {
		edgeState := s47lEdgeState{Pos: -1, Pct: s47lF(e.LabelPercentage)}
		if e.Label != nil {
			edgeState.Pos = int(e.Label.Position)
			if withTL {
				// Malformed routes panic inside the d2 helper; omit their box.
				func() {
					defer func() { _ = recover() }()
					if tl := e.LabelTopLeft(e.Label.Position, e.Label.Width, e.Label.Height); tl != nil {
						edgeState.TL = []s47lF{s47lF(tl.X), s47lF(tl.Y)}
					}
				}()
			}
		}
		state.Edges = append(state.Edges, edgeState)
	}
	for _, n := range b.g.Nodes {
		if n.Label != nil {
			state.NodeLabels = append(state.NodeLabels, int(n.Label.Position))
		} else {
			state.NodeLabels = append(state.NodeLabels, -1)
		}
		if n.Icon != nil {
			state.Icons = append(state.Icons, int(n.Icon.Position))
		} else {
			state.Icons = append(state.Icons, -1)
		}
	}
	return state
}

func s47lIdentityKept(b *s47lBuilt) bool {
	for i, e := range b.edges {
		if e.Label != b.edgeLabels[i] {
			return false
		}
	}
	for i, n := range b.g.Nodes {
		if i < len(b.nodeLabels) && (n.Label != b.nodeLabels[i] || n.Icon != b.nodeIcons[i]) {
			return false
		}
	}
	return true
}

type s47lRun struct {
	Err      string     `json:"err,omitempty"`
	Canceled bool       `json:"canceled,omitempty"`
	Panic    string     `json:"panic,omitempty"`
	Restored bool       `json:"restored"`
	Calls    int        `json:"calls"`
	State    *s47lState `json:"state,omitempty"`
}

func s47lExec(spec s47lSpec, mutation string, cancelAt, panicAt int, limit int64, withState bool) s47lRun {
	b := s47lBuild(spec)
	graph, selected, nilCtx := s47lApplyMutation(b, mutation)
	initial := s47lStateOf(b, false)
	ctx := &s47lContext{Context: context.Background(), cancelAt: cancelAt, panicAt: panicAt}
	var run s47lRun
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				run.Panic = s47lPanicText(recovered)
			}
		}()
		var callCtx context.Context = ctx
		if nilCtx {
			callCtx = nil
		}
		if err := placeNewEdges(callCtx, graph, selected, limit); err != nil {
			run.Err = err.Error()
			run.Canceled = errorsIsCanceled(err)
		}
	}()
	run.Calls = ctx.calls
	run.Restored = reflect.DeepEqual(s47lStateOf(b, false), initial) && s47lIdentityKept(b)
	if withState {
		state := s47lStateOf(b, true)
		run.State = &state
	}
	return run
}

func errorsIsCanceled(err error) bool {
	for current := err; current != nil; {
		if current == context.Canceled {
			return true
		}
		unwrapper, ok := current.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		current = unwrapper.Unwrap()
	}
	return false
}

func s47lApplyMutation(b *s47lBuilt, mutation string) (*layoutgraph.Graph, []*layoutgraph.Edge, bool) {
	g, selected := b.g, b.selected
	switch mutation {
	case "":
	case "nil-graph":
		return nil, selected, false
	case "nil-ctx":
		return g, selected, true
	case "node-no-position":
		g.Nodes[0].TopLeft = nil
	case "requested-nil":
		selected = append(append([]*layoutgraph.Edge(nil), selected...), nil)
	case "requested-repeat":
		selected = append(append([]*layoutgraph.Edge(nil), selected...), selected[0])
	case "graph-repeat":
		g.Edges = append(g.Edges, g.Edges[0])
	case "requested-missing-endpoint":
		extra := layoutgraph.NewEdge(nil, g.Nodes[0])
		extra.ID = 900
		selected = append(append([]*layoutgraph.Edge(nil), selected...), extra)
	case "requested-short-route":
		extra := layoutgraph.NewEdge(g.Nodes[0], g.Nodes[1])
		extra.ID = 901
		extra.Points = []*geo.Point{geo.NewPoint(1, 1)}
		extra.Label = &layoutgraph.Label{Text: "short", Width: 10, Height: 10}
		selected = append(append([]*layoutgraph.Edge(nil), selected...), extra)
	case "requested-nil-point":
		extra := layoutgraph.NewEdge(g.Nodes[0], g.Nodes[1])
		extra.ID = 902
		extra.Points = []*geo.Point{geo.NewPoint(1, 1), nil, geo.NewPoint(5, 5)}
		selected = append(append([]*layoutgraph.Edge(nil), selected...), extra)
	case "requested-arrow-label-short":
		extra := layoutgraph.NewEdge(g.Nodes[0], g.Nodes[1])
		extra.ID = 903
		extra.TargetArrowheadLabel = &layoutgraph.Label{Text: "t", Width: 4, Height: 4}
		selected = append(append([]*layoutgraph.Edge(nil), selected...), extra)
	case "graph-short-route":
		g.Edges[0].Points = g.Edges[0].Points[:1]
	case "graph-nil-point":
		g.Edges[0].Points[1] = nil
	case "cluster-no-vessel":
		g.Nodes[0].Cluster = &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{g.Nodes[0]}}
	case "sequence-no-vessel":
		g.Nodes[0].Sequence = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{g.Nodes[0]}}
	case "unselected-unset-label":
		g.Edges[0].Label = &layoutgraph.Label{Text: "unset", Width: 30, Height: 10}
		b.edgeLabels[0] = g.Edges[0].Label
		selected = selected[1:]
	default:
		panic("unknown mutation " + mutation)
	}
	return g, selected, false
}

type s47lProbe struct {
	At int `json:"at"`
	s47lRun
}

type s47lScenario struct {
	Name     string      `json:"name"`
	Spec     s47lSpec    `json:"spec"`
	Mutation string      `json:"mutation,omitempty"`
	Main     s47lRun     `json:"main"`
	W        int64       `json:"w"`
	AtW      *s47lRun    `json:"atW,omitempty"`
	AtWMinus *s47lRun    `json:"atWMinus1,omitempty"`
	Cancels  []s47lProbe `json:"cancels"`
	Panics   []s47lProbe `json:"panics"`
}

func s47lEvaluate(name string, spec s47lSpec, mutation string) s47lScenario {
	scenario := s47lScenario{Name: name, Spec: spec, Mutation: mutation, Cancels: []s47lProbe{}, Panics: []s47lProbe{}}
	scenario.Main = s47lExec(spec, mutation, 0, 0, maxLabelPlacementWorkUnits, true)
	if scenario.Main.Err == "" && scenario.Main.Panic == "" {
		lo, hi := int64(0), maxLabelPlacementWorkUnits
		for lo < hi {
			mid := lo + (hi-lo)/2
			if run := s47lExec(spec, mutation, 0, 0, mid, false); run.Err == "" && run.Panic == "" {
				hi = mid
			} else {
				lo = mid + 1
			}
		}
		scenario.W = lo
		atW := s47lExec(spec, mutation, 0, 0, lo, false)
		atWMinus := s47lExec(spec, mutation, 0, 0, lo-1, false)
		scenario.AtW = &atW
		scenario.AtWMinus = &atWMinus
	}
	calls := scenario.Main.Calls
	var points []int
	if calls <= 300 {
		for at := 1; at <= calls+1; at++ {
			points = append(points, at)
		}
	} else {
		stride := calls / 80
		seen := map[int]bool{}
		add := func(at int) {
			if at >= 1 && at <= calls+1 && !seen[at] {
				seen[at] = true
				points = append(points, at)
			}
		}
		for at := 1; at <= 40; at++ {
			add(at)
		}
		for at := 41; at <= calls; at += stride {
			add(at)
		}
		for at := calls - 10; at <= calls+1; at++ {
			add(at)
		}
		sort.Ints(points)
	}
	for _, at := range points {
		scenario.Cancels = append(scenario.Cancels, s47lProbe{At: at, s47lRun: s47lExec(spec, mutation, at, 0, maxLabelPlacementWorkUnits, false)})
	}
	panicSeen := map[int]bool{}
	for _, at := range []int{1, calls / 4, calls / 2, calls} {
		if at < 1 || panicSeen[at] {
			continue
		}
		panicSeen[at] = true
		scenario.Panics = append(scenario.Panics, s47lProbe{At: at, s47lRun: s47lExec(spec, mutation, 0, at, maxLabelPlacementWorkUnits, false)})
	}
	return scenario
}

// ── Scenario catalogue ──────────────────────────────────────────────────────

func s47lLabel(text string, w, h float64, pos label.Position) *s47lLabelSpec {
	return &s47lLabelSpec{Text: text, W: s47lF(w), H: s47lF(h), Pos: int(pos)}
}

func s47lFixed(text string, w, h float64, pos label.Position) *s47lLabelSpec {
	l := s47lLabel(text, w, h, pos)
	l.Fixed = true
	return l
}

func s47lRoute(points ...float64) [][2]s47lF {
	route := make([][2]s47lF, 0, len(points)/2)
	for i := 0; i+1 < len(points); i += 2 {
		route = append(route, [2]s47lF{s47lF(points[i]), s47lF(points[i+1])})
	}
	return route
}

func s47lBox(id int64, x, y, w, h float64) s47lNodeSpec {
	return s47lNodeSpec{ID: id, X: s47lF(x), Y: s47lF(y), W: s47lF(w), H: s47lF(h)}
}

func s47lHandcrafted() []struct {
	name     string
	spec     s47lSpec
	mutation string
} {
	type entry = struct {
		name     string
		spec     s47lSpec
		mutation string
	}
	var out []entry
	add := func(name string, spec s47lSpec, mutation string) {
		out = append(out, entry{name, spec, mutation})
	}

	twoNodes := []s47lNodeSpec{s47lBox(1, 0, 0, 40, 40), s47lBox(2, 300, 0, 40, 40)}
	add("single-edge", s47lSpec{
		Nodes:    twoNodes,
		Edges:    []s47lEdgeSpec{{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lLabel("first", 40, 20, label.Unset)}},
		Selected: []int{0},
	}, "")
	add("empty-selection", s47lSpec{
		Nodes:    twoNodes,
		Edges:    []s47lEdgeSpec{{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lLabel("first", 40, 20, label.OutsideTopCenter)}},
		Selected: []int{},
	}, "")

	// Parallel and crossing edges between a 3x2 grid of nodes.
	grid := []s47lNodeSpec{
		s47lBox(1, 0, 0, 60, 40), s47lBox(2, 300, 0, 60, 40), s47lBox(3, 600, 0, 60, 40),
		s47lBox(4, 0, 300, 60, 40), s47lBox(5, 300, 300, 60, 40), s47lBox(6, 600, 300, 60, 40),
	}
	add("multiple-edges", s47lSpec{
		Nodes: grid,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(60, 20, 300, 20), Label: s47lLabel("a", 50, 18, label.Unset)},
			{ID: 2, From: 2, To: 3, Points: s47lRoute(360, 20, 600, 20), Label: s47lLabel("b", 70, 18, label.Unset)},
			{ID: 3, From: 1, To: 5, Points: s47lRoute(30, 40, 30, 170, 330, 170, 330, 300), Label: s47lLabel("long one", 90, 24, label.Unset)},
			{ID: 4, From: 4, To: 6, Points: s47lRoute(60, 320, 600, 320), Label: s47lLabel("passes", 60, 20, label.Unset)},
			{ID: 5, From: 2, To: 5, Points: s47lRoute(330, 40, 330, 300), Label: s47lLabel("vertical", 64, 16, label.Unset)},
			{ID: 6, From: 3, To: 6, Points: s47lRoute(630, 40, 630, 300)},
		},
		Selected: []int{0, 1, 2, 3, 4, 5},
	}, "")

	// A large label squeezed between nodes must avoid the obstacles.
	add("avoid-nodes-and-labels", s47lSpec{
		Nodes: []s47lNodeSpec{
			s47lBox(1, 0, 0, 40, 40), s47lBox(2, 400, 0, 40, 40),
			s47lBox(3, 180, -60, 60, 50), s47lBox(4, 120, 45, 60, 50),
			{ID: 5, X: 300, Y: -80, W: 80, H: 40, Label: s47lLabel("node label", 50, 15, label.OutsideBottomCenter)},
		},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 400, 20), Label: s47lLabel("squeezed label", 110, 30, label.Unset)},
			{ID: 2, From: 1, To: 2, Points: s47lRoute(40, 30, 400, 30), Label: s47lLabel("second", 60, 20, label.OutsideTopCenter)},
		},
		Selected: []int{0},
	}, "")

	// Fixed labels: selected fixed labels are reserved (not moved);
	// unselected labels are reserved at their current position.
	add("fixed-positions", s47lSpec{
		Nodes: twoNodes,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lFixed("fixed", 80, 20, label.InsideMiddleCenter), Pct: 0.25},
			{ID: 2, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lLabel("automatic", 80, 20, label.Unset)},
			{ID: 3, From: 1, To: 2, Points: s47lRoute(40, 25, 300, 25), Label: s47lFixed("top", 70, 20, label.OutsideTopCenter)},
			{ID: 4, From: 2, To: 1, Points: s47lRoute(300, 10, 40, 10), Label: s47lLabel("locked", 40, 14, label.OutsideBottomLeft)},
		},
		Selected: []int{0, 1, 2},
	}, "")

	// Arrowhead labels at both ends are obstacles.
	add("arrowhead-labels", s47lSpec{
		Nodes: grid,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(60, 20, 300, 20), Label: s47lLabel("mid", 40, 16, label.Unset),
				Src: "diamond", Dst: "triangle", SrcLabel: s47lLabel("1", 12, 14, 0), DstLabel: s47lLabel("many", 34.6, 14.2, 0)},
			{ID: 2, From: 2, To: 5, Points: s47lRoute(330, 40, 330, 300), Label: s47lLabel("down", 40, 16, label.Unset),
				Src: "cf-one", Dst: "cf-many-required", SrcLabel: s47lLabel("one", 22, 14, 0), DstLabel: s47lLabel("0..n", 30, 14, 0)},
			{ID: 3, From: 4, To: 6, Points: s47lRoute(60, 320, 200, 320, 200, 360, 600, 360), Dst: "arrow", DstLabel: s47lLabel("end", 26, 12, 0)},
			{ID: 4, From: 3, To: 6, Points: s47lRoute(630, 40, 630, 300), Label: s47lLabel("plain", 36, 16, label.Unset), Src: "none", Dst: "circle", SrcLabel: s47lLabel("s", 10, 10, 0)},
		},
		Selected: []int{0, 1, 3},
	}, "")

	// Loop labels are reserved; selected loops are skipped.
	add("loops", s47lSpec{
		Nodes: []s47lNodeSpec{s47lBox(1, 0, 0, 80, 60), s47lBox(2, 300, 0, 40, 40)},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 1, Points: s47lRoute(80, 20, 120, 20, 120, -30, 40, -30, 40, 0), Label: s47lLabel("loop", 30, 14, label.OutsideTopCenter)},
			{ID: 2, From: 1, To: 2, Points: s47lRoute(80, 40, 300, 40), Label: s47lLabel("edge", 40, 16, label.Unset)},
			{ID: 3, From: 2, To: 2, Points: s47lRoute(340, 10, 380, 10, 380, 60, 320, 60, 320, 40), Label: s47lLabel("loop2", 30, 14, label.InsideMiddleCenter)},
		},
		Selected: []int{0, 1, 2},
	}, "")

	// Unlocked labels: a preset percentage is honoured; zero searches.
	add("unlocked", s47lSpec{
		Nodes: grid,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(60, 20, 300, 20), Label: s47lLabel("preset", 40, 16, label.UnlockedTop), Pct: 0.3},
			{ID: 2, From: 2, To: 3, Points: s47lRoute(360, 20, 600, 20), Label: s47lLabel("search", 40, 16, label.UnlockedBottom)},
			{ID: 3, From: 1, To: 4, Points: s47lRoute(30, 40, 30, 300), Label: s47lLabel("middle", 40, 16, label.UnlockedMiddle)},
			{ID: 4, From: 4, To: 5, Points: s47lRoute(60, 320, 300, 320), Label: s47lLabel("crowd", 200, 30, label.UnlockedTop)},
			{ID: 5, From: 4, To: 5, Points: s47lRoute(60, 330, 300, 330), Label: s47lLabel("crowd2", 200, 30, label.OutsideTopCenter)},
		},
		Selected: []int{0, 1, 2, 3},
	}, "")

	// Containers: ancestors only count partial overlaps.
	add("containers", s47lSpec{
		Nodes: []s47lNodeSpec{
			{ID: 1, X: 0, Y: 0, W: 500, H: 300, Label: s47lLabel("outer", 60, 20, label.InsideTopCenter)},
			{ID: 2, X: 40, Y: 60, W: 300, H: 200, Container: 1, Label: s47lFixed("inner", 50, 18, label.InsideTopLeft)},
			{ID: 3, X: 60, Y: 120, W: 40, H: 40, Container: 2},
			{ID: 4, X: 240, Y: 120, W: 40, H: 40, Container: 2, Icon: &s47lIconSpec{Pos: int(label.OutsideTopRight)}},
			{ID: 5, X: 700, Y: 120, W: 40, H: 40, Icon: &s47lIconSpec{Pos: int(label.InsideMiddleCenter), Fixed: true}},
			{ID: 6, X: 420, Y: 200, W: 40, H: 40, Container: 1, Shape: "Image", Icon: &s47lIconSpec{Pos: int(label.OutsideTopLeft)}},
		},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 3, To: 4, Points: s47lRoute(100, 140, 240, 140), Label: s47lLabel("inside", 50, 16, label.Unset)},
			{ID: 2, From: 4, To: 5, Points: s47lRoute(280, 140, 700, 140), Label: s47lLabel("escapes", 70, 18, label.Unset)},
			{ID: 3, From: 3, To: 6, Points: s47lRoute(80, 160, 80, 220, 420, 220), Label: s47lLabel("down", 40, 16, label.Unset)},
		},
		Selected: []int{0, 1, 2},
	}, "")

	// Clusters: a trunk shared by cluster edges uses symmetrical placements.
	clusterNodes := []s47lNodeSpec{
		s47lBox(1, 0, 100, 60, 60),
		s47lBox(2, 300, 0, 60, 40), s47lBox(3, 300, 80, 60, 40), s47lBox(4, 300, 160, 60, 40), s47lBox(5, 300, 240, 60, 40),
	}
	clusterNodes[2].Label = s47lLabel("member", 40, 14, label.OutsideRightMiddle)
	clusterNodes[3].Is3D = true
	clusterNodes[4].Multiple = true
	clusterNodes[4].Loops = []s47lLoopSpec{{O: int(geo.Right), V: 12}, {O: int(geo.Bottom), V: 7.5}}
	clusterNodes[1].Icon = &s47lIconSpec{Pos: int(label.OutsideTopLeft)}
	add("cluster-shared-trunk-to", s47lSpec{
		Nodes:    clusterNodes,
		Clusters: []s47lClusterSpec{{Vessel: 100, Members: []int64{2, 3, 4, 5}}},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(60, 130, 200, 130, 200, 20, 300, 20), Label: s47lLabel("e1", 24, 14, label.Unset)},
			{ID: 2, From: 1, To: 3, Points: s47lRoute(60, 130, 200, 130, 200, 100, 300, 100), Label: s47lLabel("e2", 24, 14, label.Unset)},
			{ID: 3, From: 1, To: 4, Points: s47lRoute(60, 130, 200, 130, 200, 180, 300, 180), Label: s47lLabel("e3", 24, 14, label.Unset)},
			{ID: 4, From: 1, To: 5, Points: s47lRoute(60, 130, 200, 130, 200, 260, 300, 260), Label: s47lLabel("e4", 24, 14, label.Unset)},
		},
		Selected: []int{0, 1, 2, 3},
	}, "")
	add("cluster-shared-trunk-from", s47lSpec{
		Nodes:    clusterNodes,
		Clusters: []s47lClusterSpec{{Vessel: 100, Members: []int64{2, 3, 4, 5}}},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 2, To: 1, Points: s47lRoute(300, 20, 200, 20, 200, 130, 60, 130), Label: s47lLabel("e1", 24, 14, label.Unset)},
			{ID: 2, From: 3, To: 1, Points: s47lRoute(300, 100, 200, 100, 200, 130, 60, 130), Label: s47lLabel("e2", 24, 14, label.Unset)},
			{ID: 3, From: 4, To: 1, Points: s47lRoute(300, 180, 200, 180, 200, 130, 60, 130), Label: s47lLabel("e3", 24, 14, label.Unset)},
			{ID: 4, From: 5, To: 1, Points: s47lRoute(300, 260, 200, 260, 200, 130, 60, 130), Label: s47lLabel("e4", 24, 14, label.Unset)},
		},
		Selected: []int{0, 1, 2, 3},
	}, "")
	add("cluster-unshared", s47lSpec{
		Nodes:    clusterNodes,
		Clusters: []s47lClusterSpec{{Vessel: 100, Members: []int64{2, 3, 4, 5}}},
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(30, 100, 30, 20, 300, 20), Label: s47lLabel("u1", 24, 14, label.Unset)},
			{ID: 2, From: 1, To: 5, Points: s47lRoute(30, 160, 30, 260, 300, 260), Label: s47lLabel("u2", 24, 14, label.Unset)},
		},
		Selected: []int{0, 1},
	}, "")

	// Shared segments around a trunk become label obstacles.
	add("shared-segments", s47lSpec{
		Nodes: grid,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 6, Points: s47lRoute(60, 20, 200, 20, 200, 320, 600, 320), Label: s47lLabel("s1", 30, 14, label.Unset)},
			{ID: 2, From: 1, To: 5, Points: s47lRoute(60, 30, 200, 30, 200, 250, 330, 250, 330, 300), Label: s47lLabel("s2", 30, 14, label.Unset)},
			{ID: 3, From: 2, To: 4, Points: s47lRoute(300, 30, 200, 30, 200, 320, 60, 320), Label: s47lLabel("s3", 30, 14, label.Unset)},
		},
		Selected: []int{0, 1, 2},
	}, "")

	// Zero-size labels score NaN, keep Go's zero values, and a later
	// candidate dereferences the nil fake node (runtime panic + rollback).
	add("zero-size-label", s47lSpec{
		Nodes:    twoNodes,
		Edges:    []s47lEdgeSpec{{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lLabel("", 0, 0, label.OutsideTopCenter)}},
		Selected: []int{0},
	}, "")
	add("zero-size-labels-panic", s47lSpec{
		Nodes: twoNodes,
		Edges: []s47lEdgeSpec{
			// Multi-point routes sort first, so the zero-size label is placed
			// before the regular one and leaves a nil obstacle behind.
			{ID: 1, From: 1, To: 2, Points: s47lRoute(40, 20, 170, 20, 170, 30, 300, 30), Label: s47lLabel("", 0, 0, label.OutsideTopCenter)},
			{ID: 2, From: 1, To: 2, Points: s47lRoute(40, 20, 300, 20), Label: s47lLabel("x", 20, 10, label.Unset)},
		},
		Selected: []int{0, 1},
	}, "")

	// Validation, malformed input and panic probes on a common base.
	base := s47lSpec{
		Nodes: grid,
		Edges: []s47lEdgeSpec{
			{ID: 1, From: 1, To: 2, Points: s47lRoute(60, 20, 300, 20), Label: s47lLabel("a", 30, 14, label.Unset)},
			{ID: 2, From: 2, To: 3, Points: s47lRoute(360, 20, 600, 20), Label: s47lLabel("b", 30, 14, label.Unset)},
		},
		Selected: []int{0, 1},
	}
	for _, mutation := range []string{
		"nil-graph", "nil-ctx", "node-no-position", "requested-nil", "requested-repeat", "graph-repeat",
		"requested-missing-endpoint", "requested-short-route", "requested-nil-point", "requested-arrow-label-short",
		"graph-short-route", "graph-nil-point", "cluster-no-vessel", "sequence-no-vessel", "unselected-unset-label",
	} {
		add("mutation-"+mutation, base, mutation)
	}
	return out
}

var s47lRoutePositions = []label.Position{
	label.OutsideTopLeft, label.OutsideTopCenter, label.OutsideTopRight,
	label.OutsideBottomLeft, label.OutsideBottomCenter, label.OutsideBottomRight,
	label.InsideMiddleLeft, label.InsideMiddleCenter, label.InsideMiddleRight,
	label.UnlockedTop, label.UnlockedMiddle, label.UnlockedBottom,
}

func s47lRandomSpec(rng *rand.Rand, dense bool) s47lSpec {
	var spec s47lSpec
	spacingX, spacingY, labelScale := 220.0, 200.0, 1.0
	if dense {
		// Crowded layouts leave no zero-score candidate, so the score weights
		// (not just the first clear position) decide every placement.
		spacingX, spacingY, labelScale = 130.0, 110.0, 2.5
	}
	nodeCount := 3 + rng.Intn(10)
	type cell struct{ x, y, w, h float64 }
	cells := make([]cell, nodeCount)
	for i := 0; i < nodeCount; i++ {
		c := cell{x: float64(i%4) * spacingX, y: float64(i/4) * spacingY, w: float64(40 + rng.Intn(80)), h: float64(30 + rng.Intn(60))}
		cells[i] = c
		ns := s47lNodeSpec{ID: int64(i + 1), X: s47lF(c.x), Y: s47lF(c.y), W: s47lF(c.w), H: s47lF(c.h)}
		if rng.Intn(3) == 0 {
			ns.Label = s47lLabel(fmt.Sprintf("n%d", i), float64(20+rng.Intn(50)), float64(10+rng.Intn(10)), label.Position(1+rng.Intn(21)))
			if rng.Intn(3) == 0 {
				ns.Label.Fixed = true
			}
		}
		if rng.Intn(5) == 0 {
			ns.Icon = &s47lIconSpec{Pos: 1 + rng.Intn(21)}
		}
		spec.Nodes = append(spec.Nodes, ns)
	}
	edgeCount := 1 + rng.Intn(12)
	for i := 0; i < edgeCount; i++ {
		from := rng.Intn(nodeCount)
		to := rng.Intn(nodeCount)
		a, c := cells[from], cells[to]
		ax, ay := a.x+a.w/2, a.y+a.h/2
		cx, cy := c.x+c.w/2, c.y+c.h/2
		var route [][2]s47lF
		switch {
		case from == to:
			route = s47lRoute(ax+a.w/2, ay, ax+a.w/2+30, ay, ax+a.w/2+30, ay-a.h/2-30, ax, ay-a.h/2-30, ax, ay-a.h/2)
		case rng.Intn(2) == 0:
			route = s47lRoute(ax, ay, cx, ay, cx, cy)
		default:
			mid := (ay + cy) / 2
			route = s47lRoute(ax, ay, ax, mid, cx, mid, cx, cy)
		}
		es := s47lEdgeSpec{ID: int64(i + 1), From: int64(from + 1), To: int64(to + 1), Points: route}
		if rng.Intn(5) != 0 {
			pos := label.Unset
			if rng.Intn(2) == 0 || from == to {
				// Loop labels are always reserved, so they need a route position.
				pos = s47lRoutePositions[rng.Intn(len(s47lRoutePositions))]
			}
			es.Label = s47lLabel(fmt.Sprintf("e%d", i), float64(15+rng.Intn(70))*labelScale, float64(10+rng.Intn(14))*labelScale, pos)
			if pos != label.Unset && rng.Intn(4) == 0 {
				es.Label.Fixed = true
			}
			if pos.IsUnlocked() && rng.Intn(2) == 0 {
				es.Pct = s47lF(float64(rng.Intn(100)) / 100)
			}
		}
		if rng.Intn(4) == 0 {
			es.Src = s47lArrowheads[rng.Intn(len(s47lArrowheads))]
			es.SrcLabel = s47lLabel("s", float64(5+rng.Intn(20)), float64(5+rng.Intn(10)), 0)
		}
		if rng.Intn(4) == 0 {
			es.Dst = s47lArrowheads[rng.Intn(len(s47lArrowheads))]
			es.DstLabel = s47lLabel("d", float64(5+rng.Intn(20))+0.5, float64(5+rng.Intn(10)), 0)
		}
		spec.Edges = append(spec.Edges, es)
	}
	// Unselected labels must already be placed (Go dereferences their box).
	spec.Selected = []int{}
	for i := range spec.Edges {
		es := &spec.Edges[i]
		if es.Label != nil && label.Position(es.Label.Pos) == label.Unset || rng.Intn(3) != 0 {
			spec.Selected = append(spec.Selected, i)
		}
	}
	return spec
}

// ── Oracle ──────────────────────────────────────────────────────────────────

type s47lOracle struct {
	MaxWork   int64             `json:"maxWork"`
	Arrows    []s47lArrowProbe  `json:"arrows"`
	Shared    []s47lSharedProbe `json:"shared"`
	Sorts     []s47lSortProbe   `json:"sorts"`
	Kernels   []s47lKernelProbe `json:"kernels"`
	Ranges    []s47lRangeProbe  `json:"ranges"`
	Scenarios []s47lScenario    `json:"scenarios"`
}

func TestSlice47LabelingOracle(t *testing.T) {
	rng := rand.New(rand.NewSource(47))
	oracle := s47lOracle{MaxWork: maxLabelPlacementWorkUnits}
	oracle.Arrows = s47lArrowProbes()
	oracle.Shared = s47lSharedProbes(rng)
	oracle.Sorts = s47lSortProbes(rng)
	oracle.Kernels = s47lKernelProbes(rng)
	oracle.Ranges = s47lRangeProbes(rng)
	for _, entry := range s47lHandcrafted() {
		oracle.Scenarios = append(oracle.Scenarios, s47lEvaluate(entry.name, entry.spec, entry.mutation))
	}
	for i := 0; i < 24; i++ {
		oracle.Scenarios = append(oracle.Scenarios, s47lEvaluate(fmt.Sprintf("random-%d", i), s47lRandomSpec(rng, false), ""))
	}
	for i := 0; i < 16; i++ {
		oracle.Scenarios = append(oracle.Scenarios, s47lEvaluate(fmt.Sprintf("dense-%d", i), s47lRandomSpec(rng, true), ""))
	}

	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice47-labeling-reference.json")
	if os.Getenv("TALA_SLICE47_ORACLE") == "1" {
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
		t.Fatalf("go-slice47-labeling-reference.json is stale; regenerate with TALA_SLICE47_ORACLE=1")
	}
}
