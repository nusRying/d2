package packing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 46 packing oracle. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-packing-reference.json; otherwise it recomputes
// every value and asserts the committed fixture byte for byte.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s46Label struct {
	W   float64 `json:"w"`
	H   float64 `json:"h"`
	Pos string  `json:"pos"`
}

type s46Node struct {
	ID        uint64    `json:"id"`
	W         float64   `json:"w"`
	H         float64   `json:"h"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
	Container uint64    `json:"container,omitempty"`
	Fixed     bool      `json:"fixed,omitempty"`
	FX        float64   `json:"fx,omitempty"`
	FY        float64   `json:"fy,omitempty"`
	Shape     string    `json:"shape,omitempty"`
	DesiredW  *float64  `json:"desiredW,omitempty"`
	DesiredH  *float64  `json:"desiredH,omitempty"`
	Label     *s46Label `json:"label,omitempty"`
	Is3D      bool      `json:"is3d,omitempty"`
	Multiple  bool      `json:"multiple,omitempty"`
	// SubOnly nodes are owned only by a combine subgraph (not master.Nodes).
	SubOnly bool `json:"subOnly,omitempty"`
	NilNear bool `json:"nilNear,omitempty"`
}

type s46Edge struct {
	From   uint64    `json:"from"`
	To     uint64    `json:"to"`
	Points []float64 `json:"points,omitempty"`
	Radius *string   `json:"radius,omitempty"`
	Curve  bool      `json:"curve,omitempty"`
	// SubOnly edges are owned only by a combine subgraph (not master.Edges).
	SubOnly bool `json:"subOnly,omitempty"`
}

type s46Sub struct {
	Nil   bool     `json:"nil,omitempty"`
	Fresh bool     `json:"fresh,omitempty"` // own topology maps instead of the master's
	Nodes []uint64 `json:"nodes,omitempty"`
	Edges []int    `json:"edges,omitempty"` // indices into spec.Edges
}

type s46Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type s46Spec struct {
	Nodes     []s46Node   `json:"nodes,omitempty"`
	Edges     []s46Edge   `json:"edges,omitempty"`
	Nears     [][2]uint64 `json:"nears,omitempty"`
	Root      uint64      `json:"root,omitempty"`
	NilMaster bool        `json:"nilMaster,omitempty"`
	Subs      []s46Sub    `json:"subs,omitempty"`
	Obstacles []s46Rect   `json:"obstacles,omitempty"`
}

type s46Built struct {
	g      *layoutgraph.Graph
	nodes  []*layoutgraph.Node
	byID   map[uint64]*layoutgraph.Node
	edges  []*layoutgraph.Edge
	root   *layoutgraph.Node
	subs   []*layoutgraph.Graph
	obst   []geo.Box
	graphs []*layoutgraph.Graph
}

func (spec s46Spec) build() *s46Built {
	b := &s46Built{g: layoutgraph.NewGraph(), byID: map[uint64]*layoutgraph.Node{}}
	b.graphs = append(b.graphs, b.g)
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		if ns.DesiredW != nil {
			v := *ns.DesiredW
			n.DesiredWidth = &v
		}
		if ns.DesiredH != nil {
			v := *ns.DesiredH
			n.DesiredHeight = &v
		}
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Width: ns.Label.W, Height: ns.Label.H, Position: label.FromString(ns.Label.Pos)}
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
		if ns.NilNear {
			n.Nears[nil] = struct{}{}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = b.byID[ns.Container]
		}
		if !ns.SubOnly {
			b.g.AddNewNodeToContainer(container, n)
		}
		b.nodes = append(b.nodes, n)
		b.byID[ns.ID] = n
	}
	for i, es := range spec.Edges {
		var e *layoutgraph.Edge
		if es.SubOnly {
			e = layoutgraph.NewEdge(b.byID[es.From], b.byID[es.To])
		} else {
			e = b.g.Connect(b.byID[es.From], b.byID[es.To])
		}
		e.ID = layoutgraph.EntityID(i + 1)
		if len(es.Points) > 0 {
			e.Points = make([]*geo.Point, 0, len(es.Points)/2)
			for j := 0; j+1 < len(es.Points); j += 2 {
				e.Points = append(e.Points, geo.NewPoint(es.Points[j], es.Points[j+1]))
			}
		}
		if es.Radius != nil {
			e.Style.BorderRadius = &layoutgraph.StyleScalar{Value: *es.Radius}
		}
		e.IsCurve = es.Curve
		b.edges = append(b.edges, e)
	}
	for _, pair := range spec.Nears {
		b.byID[pair[0]].Nears[b.byID[pair[1]]] = struct{}{}
	}
	if spec.Root != 0 {
		b.root = b.byID[spec.Root]
	}
	for _, ss := range spec.Subs {
		if ss.Nil {
			b.subs = append(b.subs, nil)
			continue
		}
		sub := layoutgraph.NewGraph()
		if !ss.Fresh {
			sub.CopyEntitiesFrom(b.g)
		}
		for _, id := range ss.Nodes {
			sub.AddNodeUnchecked(b.byID[id])
		}
		for _, index := range ss.Edges {
			sub.AddEdge(b.edges[index])
		}
		b.subs = append(b.subs, sub)
		b.graphs = append(b.graphs, sub)
	}
	for _, o := range spec.Obstacles {
		b.obst = append(b.obst, geo.Box{TopLeft: geo.NewPoint(o.X, o.Y), Width: o.W, Height: o.H})
	}
	return b
}

// ── Exact state snapshots (pointer identity included) ───────────────────────

type s46Snap struct {
	topLefts   []*geo.Point
	tlValues   []geo.Point
	sizes      [][2]float64
	owners     []*layoutgraph.Graph
	containers []*layoutgraph.Node
	points     [][]*geo.Point
	pointVals  [][]geo.Point
	pointsHead []*[]*geo.Point
	graphNodes [][]*layoutgraph.Node
	graphEdges [][]*layoutgraph.Edge
	children   map[*layoutgraph.Node][]*layoutgraph.Node
}

func (b *s46Built) snap() s46Snap {
	s := s46Snap{children: map[*layoutgraph.Node][]*layoutgraph.Node{}}
	for _, n := range b.nodes {
		s.topLefts = append(s.topLefts, n.TopLeft)
		s.tlValues = append(s.tlValues, *n.TopLeft)
		s.sizes = append(s.sizes, [2]float64{n.Width, n.Height})
		s.owners = append(s.owners, n.Graph)
		s.containers = append(s.containers, n.Container)
	}
	for _, e := range b.edges {
		s.points = append(s.points, append([]*geo.Point(nil), e.Points...))
		vals := make([]geo.Point, 0, len(e.Points))
		for _, p := range e.Points {
			vals = append(vals, *p)
		}
		s.pointVals = append(s.pointVals, vals)
	}
	for _, g := range b.graphs {
		s.graphNodes = append(s.graphNodes, append([]*layoutgraph.Node(nil), g.Nodes...))
		s.graphEdges = append(s.graphEdges, append([]*layoutgraph.Edge(nil), g.Edges...))
	}
	for k, v := range b.g.Containers {
		s.children[k] = append([]*layoutgraph.Node(nil), v...)
	}
	return s
}

func (b *s46Built) restoredTo(s s46Snap) bool {
	for i, n := range b.nodes {
		if n.TopLeft != s.topLefts[i] || *n.TopLeft != s.tlValues[i] || n.Width != s.sizes[i][0] ||
			n.Height != s.sizes[i][1] || n.Graph != s.owners[i] || n.Container != s.containers[i] {
			return false
		}
	}
	for i, e := range b.edges {
		if len(e.Points) != len(s.points[i]) {
			return false
		}
		for j, p := range e.Points {
			if p != s.points[i][j] || *p != s.pointVals[i][j] {
				return false
			}
		}
	}
	for i, g := range b.graphs {
		if len(g.Nodes) != len(s.graphNodes[i]) || len(g.Edges) != len(s.graphEdges[i]) {
			return false
		}
		for j := range g.Nodes {
			if g.Nodes[j] != s.graphNodes[i][j] {
				return false
			}
		}
		for j := range g.Edges {
			if g.Edges[j] != s.graphEdges[i][j] {
				return false
			}
		}
	}
	if len(b.g.Containers) != len(s.children) {
		return false
	}
	for k, v := range b.g.Containers {
		want, ok := s.children[k]
		if !ok || len(want) != len(v) {
			return false
		}
		for j := range v {
			if v[j] != want[j] {
				return false
			}
		}
	}
	return true
}

func (b *s46Built) geom() []float64 {
	out := make([]float64, 0, 4*len(b.nodes))
	for _, n := range b.nodes {
		out = append(out, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height)
	}
	return out
}

func (b *s46Built) routes() [][]float64 {
	out := make([][]float64, 0, len(b.edges))
	for _, e := range b.edges {
		r := make([]float64, 0, 2*len(e.Points))
		for _, p := range e.Points {
			r = append(r, p.X, p.Y)
		}
		out = append(out, r)
	}
	return out
}

func s46Err(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

type s46CountingContext struct {
	context.Context
	calls    int
	cancelAt int
	panicAt  int
}

func (ctx *s46CountingContext) Err() error {
	ctx.calls++
	if ctx.panicAt > 0 && ctx.calls >= ctx.panicAt {
		panic("s46 panic probe")
	}
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

// ── Operations ───────────────────────────────────────────────────────────────

type s46Outcome struct {
	err      error
	used     int64
	combined *layoutgraph.Graph
}

func s46Pack(ctx context.Context, b *s46Built, limit int64) s46Outcome {
	guard, err := newWorkGuard(ctx, limit)
	if err != nil {
		return s46Outcome{err: err}
	}
	err = packAtomic(ctx, b.g, b.root, guard)
	return s46Outcome{err: err, used: guard.Used()}
}

func s46Combine(ctx context.Context, b *s46Built, nilMaster bool) s46Outcome {
	master := b.g
	if nilMaster {
		master = nil
	}
	combined, err := CombineSubgraphs(ctx, master, b.subs, b.obst)
	return s46Outcome{err: err, combined: combined}
}

// ── Oracle records ───────────────────────────────────────────────────────────

type s46Case struct {
	Name     string      `json:"name"`
	Op       string      `json:"op"`
	Spec     s46Spec     `json:"spec"`
	Error    string      `json:"error"`
	Canceled bool        `json:"canceled,omitempty"`
	Used     int64       `json:"used,omitempty"`
	Calls    int         `json:"calls"`
	Restored bool        `json:"restored"`
	Geom     []float64   `json:"geom"`
	Routes   [][]float64 `json:"routes"`
	// Combine results: combined node IDs, combined edge indices, and the
	// owning graph of every node (0 = master, i+1 = subgraph i, -1 = combined).
	Combined []uint64 `json:"combined,omitempty"`
	CEdges   []int    `json:"cEdges,omitempty"`
	Owners   []int    `json:"owners,omitempty"`
	Shared   bool     `json:"shared,omitempty"` // combined shares master topology maps
}

type s46Probe struct {
	At       int    `json:"at"`
	Error    string `json:"error"`
	Canceled bool   `json:"canceled"`
	Panicked bool   `json:"panicked,omitempty"`
	Restored bool   `json:"restored"`
}

type s46ProbeSet struct {
	Name   string     `json:"name"`
	Op     string     `json:"op"`
	Spec   s46Spec    `json:"spec"`
	Calls  int        `json:"calls"`
	Stride int        `json:"stride"`
	Probes []s46Probe `json:"probes"`
}

type s46Limit struct {
	Limit    int64  `json:"limit"`
	Error    string `json:"error"`
	Used     int64  `json:"used"`
	Restored bool   `json:"restored"`
}

type s46Boundary struct {
	Name    string      `json:"name"`
	Spec    s46Spec     `json:"spec"`
	W       int64       `json:"w"`
	Geom    []float64   `json:"geom"`
	Routes  [][]float64 `json:"routes"`
	Changed bool        `json:"changed"`
	AtW     s46Limit    `json:"atW"`
	BelowW  s46Limit    `json:"belowW"`
	Stride  int64       `json:"stride"`
	Sweep   []s46Limit  `json:"sweep"`
}

type slice46Oracle struct {
	DisconnectedComponents []s46Case      `json:"disconnected components"`
	AspectRatio            []s46Case      `json:"aspect ratio"`
	RoutedContainer        []s46Case      `json:"routed container"`
	NestedContainer        []s46Case      `json:"nested container"`
	CombineSubgraphs       []s46Case      `json:"combine subgraphs"`
	WBoundary              []s46Boundary  `json:"W/W-1"`
	Cancellation           []s46ProbeSet  `json:"cancellation"`
	PanicRollback          []s46ProbeSet  `json:"panic rollback"`
	ParseFloat             []s46ParseCase `json:"parseFloat"`
	RoutedDecisions        []s46Decision  `json:"routed decisions"`
	SegmentChecks          []s46Segment   `json:"segment checks"`
}

// s46Decision drives binPackCanUseRoutedContainerBox directly: the spec's
// root is the container, Original is the pre-shrink box, and Proposed is
// written onto the container before the decision (as in routed_container_test.go).
type s46Decision struct {
	Name     string  `json:"name"`
	Spec     s46Spec `json:"spec"`
	Original s46Rect `json:"original"`
	Proposed s46Rect `json:"proposed"`
	Decision int     `json:"decision"`
	Error    string  `json:"error"`
	Used     int64   `json:"used"`
}

type s46Segment struct {
	Original s46Rect   `json:"original"`
	Proposed s46Rect   `json:"proposed"`
	Points   []float64 `json:"points"`
	Result   bool      `json:"result"`
	Used     int64     `json:"used"`
}

type s46ParseCase struct {
	Text  string  `json:"text"`
	OK    bool    `json:"ok"`
	Value float64 `json:"value"`
}

func s46Owners(b *s46Built, combined *layoutgraph.Graph) []int {
	out := make([]int, 0, len(b.nodes))
	for _, n := range b.nodes {
		owner := -2
		if n.Graph == b.g {
			owner = 0
		} else if combined != nil && n.Graph == combined {
			owner = -1
		} else {
			for i, sub := range b.subs {
				if sub != nil && n.Graph == sub {
					owner = i + 1
				}
			}
		}
		out = append(out, owner)
	}
	return out
}

func s46RunCase(name, op string, spec s46Spec) s46Case {
	run := func(ctx context.Context) (*s46Built, s46Snap, s46Outcome) {
		b := spec.build()
		before := b.snap()
		var out s46Outcome
		if op == "pack" {
			out = s46Pack(ctx, b, limits.MaxBinPackWorkUnits)
		} else {
			out = s46Combine(ctx, b, spec.NilMaster)
		}
		return b, before, out
	}
	count := &s46CountingContext{Context: context.Background()}
	b, before, out := run(count)
	c := s46Case{Name: name, Op: op, Spec: spec, Error: s46Err(out.err), Used: out.used, Calls: count.calls,
		Canceled: errors.Is(out.err, context.Canceled)}
	c.Restored = b.restoredTo(before)
	c.Geom = b.geom()
	c.Routes = b.routes()
	if op == "combine" {
		c.Owners = s46Owners(b, out.combined)
		if out.combined != nil {
			for _, n := range out.combined.Nodes {
				c.Combined = append(c.Combined, uint64(n.ID))
			}
			for _, e := range out.combined.Edges {
				for i, candidate := range b.edges {
					if candidate == e {
						c.CEdges = append(c.CEdges, i)
					}
				}
			}
			c.Shared = fmt.Sprintf("%p", out.combined.Containers) == fmt.Sprintf("%p", b.g.Containers)
		}
	}
	// Determinism: an identical second run must agree exactly.
	b2, _, out2 := run(context.Background())
	if s46Err(out2.err) != c.Error || fmt.Sprint(b2.geom()) != fmt.Sprint(c.Geom) || fmt.Sprint(b2.routes()) != fmt.Sprint(c.Routes) {
		panic(name + ": nondeterministic run")
	}
	return c
}

func s46Probes(name, op string, spec s46Spec, panicMode bool, maxProbes int) s46ProbeSet {
	set := s46ProbeSet{Name: name, Op: op, Spec: spec, Stride: 1}
	{
		count := &s46CountingContext{Context: context.Background()}
		b := spec.build()
		if op == "pack" {
			s46Pack(count, b, limits.MaxBinPackWorkUnits)
		} else {
			s46Combine(count, b, false)
		}
		set.Calls = count.calls
	}
	for set.Calls/set.Stride > maxProbes {
		set.Stride++
	}
	for at := 1; at <= set.Calls; at += set.Stride {
		b := spec.build()
		before := b.snap()
		ctx := &s46CountingContext{Context: context.Background()}
		if panicMode {
			ctx.panicAt = at
		} else {
			ctx.cancelAt = at
		}
		probe := s46Probe{At: at}
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					probe.Panicked = true
					probe.Error = fmt.Sprint(recovered)
				}
			}()
			var out s46Outcome
			if op == "pack" {
				out = s46Pack(ctx, b, limits.MaxBinPackWorkUnits)
			} else {
				out = s46Combine(ctx, b, false)
			}
			probe.Error = s46Err(out.err)
			probe.Canceled = errors.Is(out.err, context.Canceled)
		}()
		probe.Restored = b.restoredTo(before)
		set.Probes = append(set.Probes, probe)
	}
	return set
}

func s46BoundaryCase(name string, spec s46Spec) s46Boundary {
	full := spec.build()
	initial := full.geom()
	out := s46Pack(context.Background(), full, limits.MaxBinPackWorkUnits)
	if out.err != nil {
		panic(name + ": boundary scenario failed: " + out.err.Error())
	}
	bd := s46Boundary{Name: name, Spec: spec, W: out.used, Geom: full.geom(), Routes: full.routes()}
	bd.Changed = fmt.Sprint(initial) != fmt.Sprint(bd.Geom)
	at := func(limit int64) s46Limit {
		b := spec.build()
		before := b.snap()
		o := s46Pack(context.Background(), b, limit)
		return s46Limit{Limit: limit, Error: s46Err(o.err), Used: o.used, Restored: b.restoredTo(before)}
	}
	bd.AtW = at(bd.W)
	bd.BelowW = at(bd.W - 1)
	bd.Stride = max(1, (bd.W+199)/200)
	for limit := int64(1); limit < bd.W; limit += bd.Stride {
		bd.Sweep = append(bd.Sweep, at(limit))
	}
	return bd
}

// ── Scenario builders ────────────────────────────────────────────────────────

func s46F(v float64) *float64 { return &v }
func s46S(v string) *string   { return &v }

func s46Grid(n int, sizes [][2]float64, spacing float64) s46Spec {
	spec := s46Spec{}
	for i := 0; i < n; i++ {
		size := sizes[i%len(sizes)]
		spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 1), W: size[0], H: size[1],
			X: float64(i%4) * spacing, Y: float64(i/4) * spacing})
	}
	return spec
}

func s46RandomSpec(rng *rand.Rand, n int, connectEvery int) s46Spec {
	spec := s46Spec{}
	sizes := []float64{20, 30, 40, 60, 90}
	for i := 0; i < n; i++ {
		spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 1),
			W: sizes[rng.Intn(len(sizes))], H: sizes[rng.Intn(len(sizes))],
			X: float64(rng.Intn(12)) * 150, Y: float64(rng.Intn(12)) * 150})
	}
	// Resolve exact overlaps from the random grid by spreading duplicates.
	seen := map[[2]float64]int{}
	for i := range spec.Nodes {
		key := [2]float64{spec.Nodes[i].X, spec.Nodes[i].Y}
		for seen[key] > 0 {
			spec.Nodes[i].X += 2000
			key = [2]float64{spec.Nodes[i].X, spec.Nodes[i].Y}
		}
		seen[key]++
	}
	if connectEvery > 0 {
		for i := 1; i < n; i += connectEvery {
			spec.Edges = append(spec.Edges, s46Edge{From: uint64(i), To: uint64(i + 1)})
		}
	}
	return spec
}

// routedContainerSpec mirrors TestPackCompactsRoutedRectangularContainer...
func s46RoutedCompact() s46Spec {
	return s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 700, H: 600, X: 20, Y: 30, Shape: "Square", DesiredW: s46F(700)},
		{ID: 2, W: 20, H: 20, X: 80, Y: 90, Container: 1},
		{ID: 3, W: 20, H: 20, X: 40, Y: 130, Container: 1},
		{ID: 4, W: 20, H: 20, X: 80, Y: -100},
	}, Edges: []s46Edge{
		{From: 1, To: 4, Points: []float64{50, 30, 50, -80}},
		{From: 2, To: 4, Points: []float64{90, 90, 90, -80}},
	}}
}

func s46RoutedBase(shape string, extEdgeX float64, extNodeX float64, desired bool) s46Spec {
	spec := s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 700, H: 600, X: 20, Y: 30, Shape: shape},
		{ID: 2, W: 20, H: 20, X: 40, Y: 50, Container: 1},
		{ID: 3, W: 20, H: 20, X: 40, Y: 130, Container: 1},
		{ID: 4, W: 20, H: 20, X: extNodeX, Y: -100},
	}, Edges: []s46Edge{{From: 1, To: 4, Points: []float64{extEdgeX, 30, extEdgeX, -80}}}}
	if desired {
		spec.Nodes[0].DesiredW = s46F(700)
	}
	return spec
}

func TestGenerateSlice46PackingOracle(t *testing.T) {
	var oracle slice46Oracle

	// ── disconnected components ──
	dc := func(name string, spec s46Spec) {
		oracle.DisconnectedComponents = append(oracle.DisconnectedComponents, s46RunCase(name, "pack", spec))
	}
	dc("empty", s46Spec{})
	dc("single", s46Spec{Nodes: []s46Node{{ID: 1, W: 40, H: 30, X: 500, Y: 700}}})
	dc("two-far-apart", s46Spec{Nodes: []s46Node{{ID: 1, W: 40, H: 30, X: 0, Y: 0}, {ID: 2, W: 50, H: 20, X: 900, Y: 900}}})
	dc("many-rectangles", s46Grid(14, [][2]float64{{40, 30}, {90, 20}, {20, 80}, {60, 60}, {30, 30}}, 400))
	dc("identical-ties", s46Grid(13, [][2]float64{{50, 50}}, 300))
	dc("connected-and-isolated", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0}, {ID: 2, W: 40, H: 40, X: 600, Y: 0},
		{ID: 3, W: 40, H: 40, X: 0, Y: 600}, {ID: 4, W: 60, H: 30, X: 1200, Y: 1200},
		{ID: 5, W: 30, H: 60, X: 1800, Y: 300},
	}, Edges: []s46Edge{{From: 1, To: 2}, {From: 2, To: 3}}})
	dc("diagonal-edge-estimates", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0}, {ID: 2, W: 40, H: 40, X: 400, Y: 400},
		{ID: 3, W: 30, H: 30, X: 1500, Y: 100}, {ID: 4, W: 30, H: 30, X: 1500, Y: 900},
		{ID: 5, W: 20, H: 20, X: 2500, Y: 2500},
	}, Edges: []s46Edge{{From: 1, To: 2}, {From: 3, To: 4}}})
	dc("fixed-node-at-origin", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0, Fixed: true, FX: 0, FY: 0},
		{ID: 2, W: 40, H: 40, X: 700, Y: 0}, {ID: 3, W: 40, H: 40, X: 0, Y: 700},
		{ID: 4, W: 40, H: 40, X: 700, Y: 700},
	}})
	dc("fixed-subgraph", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 100, Y: 100, Fixed: true, FX: 60, FY: 60},
		{ID: 2, W: 40, H: 40, X: 400, Y: 100},
		{ID: 3, W: 50, H: 30, X: 1000, Y: 1000}, {ID: 4, W: 30, H: 50, X: 1500, Y: 300},
	}, Edges: []s46Edge{{From: 1, To: 2}}})
	dc("near-links", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0}, {ID: 2, W: 40, H: 40, X: 900, Y: 0},
		{ID: 3, W: 40, H: 40, X: 0, Y: 900}, {ID: 4, W: 40, H: 40, X: 900, Y: 900},
	}, Nears: [][2]uint64{{1, 2}}})
	dc("outside-labels", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0, Label: &s46Label{W: 120, H: 20, Pos: "OUTSIDE_TOP_CENTER"}},
		{ID: 2, W: 40, H: 40, X: 600, Y: 0, Label: &s46Label{W: 30, H: 20, Pos: "OUTSIDE_RIGHT_MIDDLE"}},
		{ID: 3, W: 40, H: 40, X: 0, Y: 600, Label: &s46Label{W: 30, H: 20, Pos: "OUTSIDE_BOTTOM_LEFT"}},
		{ID: 4, W: 70, H: 20, X: 600, Y: 600},
	}})
	dc("table-and-3d", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 120, H: 80, X: 0, Y: 0, Shape: "Table"},
		{ID: 2, W: 40, H: 40, X: 800, Y: 0, Is3D: true},
		{ID: 3, W: 40, H: 40, X: 0, Y: 800, Multiple: true},
		{ID: 4, W: 40, H: 40, X: 800, Y: 800},
	}})
	dc("partially-routed-rejected", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 10, H: 10, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, X: 100, Y: 0}, {ID: 3, W: 10, H: 10, X: 300, Y: 0},
	}, Edges: []s46Edge{{From: 1, To: 2, Points: []float64{10, 5, 100, 5}}, {From: 2, To: 3}}})
	dc("malformed-route-rejected", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 10, H: 10, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, X: 100, Y: 0},
	}, Edges: []s46Edge{{From: 1, To: 2, Points: []float64{10, 5}}}})
	for seed := int64(0); seed < 5; seed++ {
		rng := rand.New(rand.NewSource(4600 + seed))
		dc(fmt.Sprintf("random-%d", seed), s46RandomSpec(rng, 8+rng.Intn(10), 3+int(seed)))
	}

	// ── aspect ratio ──
	ar := func(name string, spec s46Spec) {
		oracle.AspectRatio = append(oracle.AspectRatio, s46RunCase(name, "pack", spec))
	}
	wideTall := func(root s46Node) s46Spec {
		spec := s46Spec{Root: 1, Nodes: []s46Node{root}}
		for i := 0; i < 6; i++ {
			w, h := 120.0, 20.0
			if i%2 == 1 {
				w, h = 20, 90
			}
			spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 2), W: w, H: h, X: 30 + float64(i)*150, Y: 40 + float64(i%3)*200, Container: 1})
		}
		return spec
	}
	ar("container-free", wideTall(s46Node{ID: 1, W: 1000, H: 700, X: 0, Y: 0}))
	ar("desired-width", wideTall(s46Node{ID: 1, W: 1000, H: 700, X: 0, Y: 0, DesiredW: s46F(900)}))
	ar("desired-height", wideTall(s46Node{ID: 1, W: 1000, H: 700, X: 0, Y: 0, DesiredH: s46F(650)}))
	ar("circle-container", wideTall(s46Node{ID: 1, W: 1000, H: 1000, X: 0, Y: 0, Shape: "Circle"}))
	ar("real-square-container", wideTall(s46Node{ID: 1, W: 1000, H: 1000, X: 0, Y: 0, Shape: "RealSquare"}))
	ar("oval-container", wideTall(s46Node{ID: 1, W: 1100, H: 700, X: 0, Y: 0, Shape: "Oval"}))
	ar("root-wide-strips", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 400, H: 20, X: 0, Y: 0}, {ID: 2, W: 400, H: 20, X: 0, Y: 500},
		{ID: 3, W: 20, H: 300, X: 900, Y: 0}, {ID: 4, W: 20, H: 300, X: 1300, Y: 0},
		{ID: 5, W: 60, H: 60, X: 2000, Y: 2000},
	}})

	// ── routed container ──
	rc := func(name string, spec s46Spec) {
		oracle.RoutedContainer = append(oracle.RoutedContainer, s46RunCase(name, "pack", spec))
	}
	rc("compact-keeps-attached-side", s46RoutedCompact())
	rc("descendant-route-leaves-candidate", func() s46Spec {
		spec := s46RoutedBase("Square", 50, 40, true)
		spec.Edges = append([]s46Edge{{From: 3, To: 3, Points: []float64{45, 150, 45, 550, 55, 550, 55, 150}}}, spec.Edges...)
		return spec
	}())
	rc("shrink-changes-attached-side", s46RoutedBase("Square", 200, 190, false))
	rc("curved-shape-keeps-box", s46RoutedBase("Oval", 370, 360, true))
	rc("self-loop-keeps-box", s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 700, H: 600, X: 20, Y: 30, Shape: "Square", DesiredW: s46F(700)},
		{ID: 2, W: 20, H: 20, X: 40, Y: 50, Container: 1},
		{ID: 3, W: 20, H: 20, X: 40, Y: 130, Container: 1},
	}, Edges: []s46Edge{{From: 1, To: 1, Points: []float64{50, 30, 50, -20, 100, -20, 100, 30}}}})
	rc("child-attached-to-container", s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 300, H: 300, X: 0, Y: 0, Shape: "Square"},
		{ID: 2, W: 20, H: 20, X: 220, Y: 140, Container: 1},
		{ID: 3, W: 20, H: 20, X: 70, Y: 70, Container: 1},
	}, Edges: []s46Edge{{From: 1, To: 2, Points: []float64{300, 150, 240, 150}}}})
	fixedRouted := func(fixContainer bool) s46Spec {
		spec := s46Spec{Root: 1, Nodes: []s46Node{
			{ID: 1, W: 300, H: 300, X: 0, Y: 0, Shape: "Square", DesiredW: s46F(300), Fixed: fixContainer},
			{ID: 2, W: 20, H: 20, X: 100, Y: 220, Container: 1, Fixed: true, FX: 40, FY: 120},
			{ID: 3, W: 20, H: 20, X: 100, Y: 140, Container: 1},
			{ID: 4, W: 20, H: 20, X: 90, Y: 400},
		}, Edges: []s46Edge{{From: 1, To: 4, Points: []float64{100, 300, 100, 400}}}}
		return spec
	}
	rc("unlocked-bottom-anchored-shrink", fixedRouted(false))
	rc("fixed-origin-keeps-box", fixedRouted(true))
	rc("whole-graph-routes-translated", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 10, H: 10, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, X: 500, Y: 500},
		{ID: 3, W: 10, H: 10, X: 1000, Y: 1000}, {ID: 4, W: 10, H: 10, X: 1600, Y: 200},
		{ID: 5, W: 10, H: 10, X: 1800, Y: 200},
	}, Edges: []s46Edge{
		{From: 1, To: 2, Points: []float64{10, 5, 250, 5, 250, 505, 500, 505}},
		{From: 4, To: 5, Points: []float64{1610, 205, 1800, 205}},
	}})
	for _, radius := range []string{"0", "10", "1_0", "0x1p3", "not-a-radius", "-1", "NaN", "inf", "1e400"} {
		spec := s46Spec{Root: 1, Nodes: []s46Node{
			{ID: 1, W: 300, H: 300, X: 0, Y: 0, Shape: "Square", DesiredW: s46F(300)},
			{ID: 2, W: 20, H: 20, X: 100, Y: 100, Container: 1},
			{ID: 3, W: 20, H: 20, X: 40, Y: 230, Container: 1},
			{ID: 4, W: 20, H: 20, X: 90, Y: -100},
			{ID: 5, W: 20, H: 20, X: 190, Y: -100},
		}, Edges: []s46Edge{
			{From: 2, To: 4, Points: []float64{110, 100, 110, 20, 125, -5, 125, -80}, Radius: s46S(radius)},
			{From: 1, To: 5, Points: []float64{200, 0, 200, -80}},
		}}
		rc("radius-"+radius, spec)
	}
	rc("curve-edge-keeps-box", func() s46Spec {
		spec := s46RoutedCompact()
		spec.Edges[1].Curve = true
		return spec
	}())

	// ── nested container ──
	nc := func(name string, spec s46Spec) {
		oracle.NestedContainer = append(oracle.NestedContainer, s46RunCase(name, "pack", spec))
	}
	nested := s46Spec{Nodes: []s46Node{
		{ID: 1, W: 1200, H: 900, X: 0, Y: 0},
		{ID: 2, W: 500, H: 400, X: 50, Y: 50, Container: 1},
		{ID: 3, W: 30, H: 30, X: 80, Y: 80, Container: 2},
		{ID: 4, W: 40, H: 20, X: 400, Y: 380, Container: 2},
		{ID: 5, W: 20, H: 50, X: 250, Y: 200, Container: 2},
		{ID: 6, W: 60, H: 60, X: 900, Y: 700, Container: 1},
		{ID: 7, W: 30, H: 30, X: 700, Y: 100, Container: 1},
		{ID: 8, W: 50, H: 50, X: 2000, Y: 2000},
	}, Edges: []s46Edge{{From: 3, To: 4}}}
	nc("root-nil", nested)
	withRoot := nested
	withRoot.Root = 1
	nc("root-outer", withRoot)
	inner := nested
	inner.Root = 2
	nc("root-inner", inner)
	cross := nested
	cross.Edges = append([]s46Edge{{From: 5, To: 7}}, nested.Edges...)
	cross.Root = 1
	nc("cross-container-edge", cross)
	nearCross := nested
	nearCross.Nears = [][2]uint64{{5, 8}}
	nearCross.Root = 2
	nc("cross-container-near", nearCross)
	nc("fixed-child", s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 900, H: 700, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, X: 100, Y: 100, Container: 1, Fixed: true, FX: 60, FY: 60},
		{ID: 3, W: 40, H: 40, X: 600, Y: 500, Container: 1},
		{ID: 4, W: 40, H: 40, X: 300, Y: 600, Container: 1},
	}})
	nc("labelled-children", s46Spec{Root: 1, Nodes: []s46Node{
		{ID: 1, W: 900, H: 700, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, X: 100, Y: 100, Container: 1, Label: &s46Label{W: 160, H: 20, Pos: "OUTSIDE_TOP_CENTER"}},
		{ID: 3, W: 40, H: 40, X: 600, Y: 500, Container: 1, Label: &s46Label{W: 140, H: 20, Pos: "INSIDE_MIDDLE_CENTER"}},
		{ID: 4, W: 40, H: 40, X: 300, Y: 600, Container: 1},
	}})

	// ── combine subgraphs ──
	cs := func(name string, spec s46Spec) {
		oracle.CombineSubgraphs = append(oracle.CombineSubgraphs, s46RunCase(name, "combine", spec))
	}
	combineBase := func() s46Spec {
		return s46Spec{Nodes: []s46Node{
			{ID: 1, W: 100, H: 80, X: 30, Y: 40}, {ID: 2, W: 50, H: 50, X: 300, Y: 40},
			{ID: 3, W: 60, H: 40, X: 10, Y: 10}, {ID: 4, W: 60, H: 40, X: 200, Y: 10},
			{ID: 5, W: 70, H: 70, X: 0, Y: 0},
			{ID: 6, W: 30, H: 30, X: 0, Y: 0}, {ID: 7, W: 30, H: 30, X: 0, Y: 0},
		}, Edges: []s46Edge{
			{From: 1, To: 2, Points: []float64{130, 80, 300, 65}},
			{From: 3, To: 4, Points: []float64{70, 30, 200, 30}},
		}, Subs: []s46Sub{
			{Nodes: []uint64{1, 2}, Edges: []int{0}},
			{Nodes: []uint64{3, 4}, Edges: []int{1}},
			{Nodes: []uint64{5}},
			{Nodes: []uint64{6}},
			{Nodes: []uint64{7}},
		}}
	}
	cs("no-subgraphs", s46Spec{Nodes: []s46Node{{ID: 1, W: 10, H: 10, X: 0, Y: 0}}})
	cs("nil-master", s46Spec{NilMaster: true})
	cs("routed-subgraphs", combineBase())
	fixedFirst := combineBase()
	fixedFirst.Nodes[0].Fixed = true
	fixedFirst.Nodes[0].FX, fixedFirst.Nodes[0].FY = 30, 40
	cs("fixed-first-subgraph", fixedFirst)
	obstacles := combineBase()
	obstacles.Obstacles = []s46Rect{{X: -60, Y: -60, W: 5000, H: 5000}, {X: 100, Y: 0, W: 200, H: 200}, {X: 0, Y: 150, W: 120, H: 100}}
	cs("ancestor-obstacles", obstacles)
	cs("equal-area-ties", func() s46Spec {
		spec := s46Spec{}
		for i := 0; i < 16; i++ {
			spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 1), W: 40, H: 40, X: float64(i%3) * 10, Y: float64(i%5) * 7})
			spec.Subs = append(spec.Subs, s46Sub{Nodes: []uint64{uint64(i + 1)}})
		}
		return spec
	}())
	cs("equal-area-ties-large", func() s46Spec {
		spec := s46Spec{}
		sizes := [][2]float64{{40, 40}, {20, 80}, {80, 20}, {30, 30}}
		for i := 0; i < 60; i++ {
			size := sizes[i%len(sizes)]
			spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 1), W: size[0], H: size[1], X: float64(i%7) * 5, Y: float64(i%4) * 3})
			spec.Subs = append(spec.Subs, s46Sub{Nodes: []uint64{uint64(i + 1)}})
		}
		return spec
	}())
	cs("containers-in-subgraphs", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 300, H: 200, X: 0, Y: 0}, {ID: 2, W: 40, H: 40, X: 50, Y: 60, Container: 1},
		{ID: 3, W: 40, H: 40, X: 200, Y: 120, Container: 1},
		{ID: 4, W: 120, H: 220, X: 500, Y: 500}, {ID: 5, W: 50, H: 50, X: 520, Y: 560, Container: 4},
		{ID: 6, W: 80, H: 30, X: 0, Y: 0},
	}, Edges: []s46Edge{{From: 2, To: 3, Points: []float64{90, 80, 200, 140}}},
		Subs: []s46Sub{{Nodes: []uint64{1}, Edges: []int{0}}, {Nodes: []uint64{4}}, {Nodes: []uint64{6}}}})
	cs("fresh-topology-subgraphs", func() s46Spec {
		spec := combineBase()
		for i := range spec.Subs {
			spec.Subs[i].Fresh = true
		}
		return spec
	}())
	cs("nil-subgraph", func() s46Spec {
		spec := combineBase()
		spec.Subs = append(spec.Subs, s46Sub{Nil: true})
		return spec
	}())
	cs("nil-near-subgraph-only-node", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 10, H: 10, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, X: 0, Y: 0, SubOnly: true, NilNear: true},
	}, Subs: []s46Sub{{Nodes: []uint64{1}}, {Nodes: []uint64{2}}}})
	cs("subgraph-only-edge", s46Spec{Nodes: []s46Node{
		{ID: 1, W: 10, H: 10, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, X: 50, Y: 0},
	}, Edges: []s46Edge{{From: 1, To: 2, SubOnly: true, Points: []float64{10, 5, 50, 5}}},
		Subs: []s46Sub{{Nodes: []uint64{1, 2}, Edges: []int{0}}}})
	for seed := int64(0); seed < 3; seed++ {
		rng := rand.New(rand.NewSource(4650 + seed))
		spec := s46Spec{}
		count := 6 + rng.Intn(8)
		for i := 0; i < count; i++ {
			spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i + 1),
				W: float64(20 + 10*rng.Intn(8)), H: float64(20 + 10*rng.Intn(8)),
				X: float64(rng.Intn(5) * 10), Y: float64(rng.Intn(5) * 10)})
			spec.Subs = append(spec.Subs, s46Sub{Nodes: []uint64{uint64(i + 1)}})
		}
		cs(fmt.Sprintf("random-%d", seed), spec)
	}

	// ── W/W-1 ──
	for _, c := range []struct {
		name string
		spec s46Spec
	}{
		{"many-rectangles", s46Grid(10, [][2]float64{{40, 30}, {90, 20}, {20, 80}, {60, 60}}, 400)},
		{"routed-compact", s46RoutedCompact()},
		{"nested-root-outer", withRoot},
		{"routes-translated", oracle.RoutedContainer[8].Spec},
	} {
		oracle.WBoundary = append(oracle.WBoundary, s46BoundaryCase(c.name, c.spec))
	}

	// ── cancellation ──
	oracle.Cancellation = append(oracle.Cancellation,
		s46Probes("pack-many-rectangles", "pack", s46Grid(8, [][2]float64{{40, 30}, {90, 20}, {20, 80}}, 400), false, 1200),
		s46Probes("pack-routed-compact", "pack", s46RoutedCompact(), false, 1200),
		s46Probes("pack-routes-translated", "pack", oracle.RoutedContainer[8].Spec, false, 1200),
		s46Probes("pack-nested", "pack", withRoot, false, 600),
		s46Probes("combine-routed", "combine", combineBase(), false, 1200),
		s46Probes("combine-containers", "combine", oracle.CombineSubgraphs[7].Spec, false, 1200),
	)

	// ── panic rollback ──
	oracle.PanicRollback = append(oracle.PanicRollback,
		s46Probes("pack-many-rectangles", "pack", s46Grid(8, [][2]float64{{40, 30}, {90, 20}, {20, 80}}, 400), true, 150),
		s46Probes("pack-routes-translated", "pack", oracle.RoutedContainer[8].Spec, true, 150),
		s46Probes("combine-routed", "combine", combineBase(), true, 150),
	)

	// strconv.ParseFloat parity for routed-container border radii.
	for _, text := range []string{"0", "10", "-0", "1_0", "1__0", "_1", "1_", "0x1p3", "0x1.8p1", "0x1P-2", "0x10",
		"1e1", "1E+2", ".5", "5.", ".", "1e", "1e+", " 5", "5 ", "inf", "+Inf", "-infinity", "infinit", "nan", "NaN",
		"+nan", "1e400", "1e-400", "4.9e-324", "2.4703282292062328e-324", "0x1p-1074", "0x1p-1075", "0x1.0000000000001p-1075",
		"0x1p1024", "0x.1p4", "0x_1p0", "0x1_0p0", "1_000.000_1", "123456789012345678901234567890", "0.1e-1_0",
		"1.7976931348623157e308", "1.7976931348623159e308", "0x1.fffffffffffff8p1023", "", "+", "-", "e5", "0x", "0xp1"} {
		value, err := parseFloat64ForOracle(text)
		c := s46ParseCase{Text: text, OK: err == nil}
		if err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			c.Value = value
		}
		oracle.ParseFloat = append(oracle.ParseFloat, c)
	}

	// Direct routed-container decisions (routed_container_test.go fixtures).
	decide := func(name string, spec s46Spec, original, proposed s46Rect) {
		b := spec.build()
		b.root.TopLeft.X, b.root.TopLeft.Y = proposed.X, proposed.Y
		b.root.Width, b.root.Height = proposed.W, proposed.H
		var incident []*layoutgraph.Edge
		for _, edge := range b.g.Edges {
			if edge != nil && (edge.From == b.root || edge.To == b.root) {
				incident = append(incident, edge)
			}
		}
		guard, err := newWorkGuard(context.Background(), 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		box := geo.Box{TopLeft: geo.NewPoint(original.X, original.Y), Width: original.W, Height: original.H}
		decision, err := binPackCanUseRoutedContainerBox(b.g, b.root, &box, incident, guard)
		oracle.RoutedDecisions = append(oracle.RoutedDecisions, s46Decision{Name: name, Spec: spec,
			Original: original, Proposed: proposed, Decision: int(decision), Error: s46Err(err), Used: guard.Used()})
	}
	square300 := s46Rect{X: 0, Y: 0, W: 300, H: 300}
	shrunk := s46Rect{X: 0, Y: 0, W: 300, H: 180}
	decisionBase := func(shape string, extra ...s46Node) s46Spec {
		spec := s46Spec{Root: 1, Nodes: []s46Node{
			{ID: 1, W: 300, H: 300, X: 0, Y: 0, Shape: shape},
			{ID: 2, W: 20, H: 20, X: 100, Y: 100, Container: 1},
		}}
		spec.Nodes = append(spec.Nodes, extra...)
		return spec
	}
	{
		spec := decisionBase("Square", s46Node{ID: 3, W: 20, H: 20, X: 90, Y: -100})
		spec.Nodes[0].Fixed = true
		spec.Edges = []s46Edge{{From: 1, To: 3, Points: []float64{100, 0, 100, -80}}}
		decide("same-side-endpoint", spec, square300, shrunk)
	}
	{
		spec := decisionBase("Square", s46Node{ID: 3, W: 20, H: 20, X: 170, Y: -100})
		spec.Edges = []s46Edge{{From: 1, To: 3, Points: []float64{180, 0, 180, -80}}}
		decide("endpoint-becomes-corner", spec, square300, s46Rect{X: 0, Y: 0, W: 180, H: 180})
	}
	{
		spec := decisionBase("Square")
		spec.Edges = []s46Edge{{From: 1, To: 1, Points: []float64{100, 0, 100, -50, 150, -50, 150, 0}}}
		decide("self-loop", spec, square300, shrunk)
	}
	{
		spec := decisionBase("Square")
		spec.Edges = []s46Edge{{From: 1, To: 2, Points: []float64{150, 0, 150, 250, 120, 250, 120, 110}}}
		decide("descendant-route", spec, square300, shrunk)
	}
	{
		spec := decisionBase("Square")
		spec.Edges = []s46Edge{{From: 2, To: 2, Points: []float64{100, 100, 100, 150, 120, 150, 120, 100}}}
		decide("descendant-only-defers", spec, square300, shrunk)
	}
	{
		spec := decisionBase("Square", s46Node{ID: 3, W: 20, H: 20, X: 90, Y: 400})
		spec.Nodes[0].Fixed = true
		spec.Edges = []s46Edge{{From: 1, To: 3, Points: []float64{100, 300, 100, 400}}}
		decide("fixed-origin-translated", spec, square300, s46Rect{X: 0, Y: 20, W: 300, H: 280})
	}
	for _, body := range []struct {
		name       string
		points     []float64
		toExternal bool
		curve      bool
		radius     *string
	}{
		{"contained-internal", []float64{100, 100, 100, 150, 120, 150, 120, 100}, false, false, nil},
		{"exit-unchanged-side", []float64{100, 100, 100, -50}, true, false, nil},
		{"crosses-moved-side", []float64{100, 100, 100, 350}, true, false, nil},
		{"reenters-removed-strip", []float64{100, 100, 100, 250, 120, 250, 120, 100}, false, false, nil},
		{"curved-route", []float64{100, 100, 100, 150, 120, 150, 120, 100}, false, true, nil},
		{"rounded-corner-straddles", []float64{100, 20, 110, -5, 140, -35}, true, false, nil},
		{"rounded-short-segment", []float64{100, 100, 100, 130, 110, 130, 110, 100}, false, false, nil},
		{"square-corner-crossing", []float64{100, 20, 110, -5, 140, -35}, true, false, s46S("0")},
		{"hex-radius-corner", []float64{100, 20, 110, -5, 140, -35}, true, false, s46S("0x0p0")},
		{"invalid-radius", []float64{100, 100, 100, -50}, true, false, s46S("not-a-radius")},
		{"negative-radius", []float64{100, 100, 100, -50}, true, false, s46S("-1")},
		{"nonfinite-radius", []float64{100, 100, 100, -50}, true, false, s46S("NaN")},
		{"oversized-radius", []float64{100, 100, 100, -50}, true, false, s46S("11111111111111111111111111111111111111111111111111111111111111111")},
		{"large-radius-corner", []float64{100, 160, 100, 40, 220, 40}, false, false, s46S("30")},
		{"hull-inside-corner", []float64{100, 160, 100, 40, 220, 40}, false, false, nil},
		{"hull-outside-left", []float64{-50, 400, -50, -50, -120, -50}, true, false, nil},
	} {
		spec := decisionBase("Square")
		to := uint64(2)
		if body.toExternal {
			spec.Nodes = append(spec.Nodes, s46Node{ID: 3, W: 20, H: 20, X: 90, Y: -100})
			to = 3
		}
		spec.Nodes = append(spec.Nodes, s46Node{ID: 4, W: 20, H: 20, X: 190, Y: -100})
		spec.Edges = []s46Edge{
			{From: 2, To: to, Points: body.points, Curve: body.curve, Radius: body.radius},
			{From: 1, To: 4, Points: []float64{200, 0, 200, -80}},
		}
		decide("body-"+body.name, spec, square300, shrunk)
	}
	for _, shape := range []string{"Oval", "Image", "Circle", "Text", "Cylinder", "RealSquare"} {
		spec := decisionBase(shape, s46Node{ID: 3, W: 20, H: 20, X: 90, Y: -100})
		spec.Edges = []s46Edge{{From: 1, To: 3, Points: []float64{100, 0, 100, -80}}}
		decide("shape-"+shape, spec, square300, shrunk)
	}
	for _, modifier := range []string{"3d", "multiple"} {
		spec := decisionBase("Square", s46Node{ID: 3, W: 20, H: 20, X: 90, Y: -100})
		spec.Nodes[0].Is3D = modifier == "3d"
		spec.Nodes[0].Multiple = modifier == "multiple"
		spec.Edges = []s46Edge{{From: 1, To: 3, Points: []float64{100, 0, 100, -80}}}
		decide("modifier-"+modifier, spec, square300, shrunk)
	}
	{
		nodes := decisionBase("Square", s46Node{ID: 3, W: 20, H: 20, X: 90, Y: -100}).Nodes
		decide("proposed-grows", s46Spec{Root: 1, Nodes: nodes, Edges: []s46Edge{{From: 1, To: 3, Points: []float64{100, 0, 100, -80}}}}, square300, s46Rect{X: 0, Y: 0, W: 300, H: 320})
		decide("left-side-endpoint", s46Spec{Root: 1, Nodes: nodes, Edges: []s46Edge{{From: 1, To: 3, Points: []float64{0, 100, -80, 100}}}}, square300, shrunk)
		decide("bottom-side-endpoint", s46Spec{Root: 1, Nodes: nodes, Edges: []s46Edge{{From: 3, To: 1, Points: []float64{100, 400, 100, 300}}}}, square300, s46Rect{X: 0, Y: 120, W: 300, H: 180})
		decide("interior-endpoint", s46Spec{Root: 1, Nodes: nodes, Edges: []s46Edge{{From: 1, To: 3, Points: []float64{100, 50, 100, -80}}}}, square300, shrunk)
	}

	for _, seg := range []struct {
		proposed s46Rect
		points   []float64
	}{
		{shrunk, []float64{100, 50, 100, 150}},
		{shrunk, []float64{100, -100, 200, -50}},
		{shrunk, []float64{100, 100, 100, -50}},
		{shrunk, []float64{100, 100, 100, 350}},
		{shrunk, []float64{-10, 310, 10, 290}},
		{shrunk, []float64{100, 100, 100, 100}},
		{shrunk, []float64{-50, 150, 350, 150}},
		{shrunk, []float64{-50, 250, 350, 250}},
		{s46Rect{X: 20, Y: 20, W: 260, H: 260}, []float64{0, 0, 300, 300}},
		{s46Rect{X: 0, Y: 0, W: 300, H: 300}, []float64{300, -10, 300, 400}},
		{s46Rect{X: 0, Y: 0, W: 0, H: 300}, []float64{10, 10, 20, 20}},
	} {
		guard, err := newWorkGuard(context.Background(), 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		original := geo.Box{TopLeft: geo.NewPoint(0, 0), Width: 300, Height: 300}
		proposed := geo.Box{TopLeft: geo.NewPoint(seg.proposed.X, seg.proposed.Y), Width: seg.proposed.W, Height: seg.proposed.H}
		result, err := routedContainerSegmentStaysInsideShrink(&original, &proposed,
			geo.NewPoint(seg.points[0], seg.points[1]), geo.NewPoint(seg.points[2], seg.points[3]), guard)
		if err != nil {
			t.Fatal(err)
		}
		oracle.SegmentChecks = append(oracle.SegmentChecks, s46Segment{Original: square300, Proposed: seg.proposed,
			Points: seg.points, Result: result, Used: guard.Used()})
	}

	writeOrAssertSlice46Fixture(t, "go-slice46-packing-reference.json", oracle)
}

func parseFloat64ForOracle(text string) (float64, error) {
	return strconv.ParseFloat(text, 64)
}

func writeOrAssertSlice46Fixture(t *testing.T, name string, oracle any) {
	t.Helper()
	encoded, err := json.Marshal(oracle)
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
