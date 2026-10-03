package placement

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

// Slice 46 placement-stage oracle: Align (alignAxes), Swap (swapOptimize +
// direct), direct, mirrorAxes, Equidistance, Dejitter, BalanceSymmetry, and
// isSimple. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-placement-stages-reference.json; otherwise it
// recomputes every value and asserts the committed fixture byte for byte.
//
// Every scenario keeps at most 10 graph nodes so placementcost.EdgeLength
// scores sequentially (its >10-node path interleaves context checks across
// goroutines) and cancellation probe counts are deterministic.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s46stEdge struct {
	From     uint64    `json:"from"`
	To       uint64    `json:"to"`
	Points   []float64 `json:"points,omitempty"`
	FromCol  *int      `json:"fromCol,omitempty"`
	ToCol    *int      `json:"toCol,omitempty"`
	SrcArrow bool      `json:"srcArrow,omitempty"`
	TgtArrow bool      `json:"tgtArrow,omitempty"`
}

type s46stTable struct {
	ID      uint64 `json:"id"`
	Columns int    `json:"columns"`
}

type s46stOrient struct {
	Node        uint64 `json:"node"`
	Orientation string `json:"orientation"`
}

type s46stSpec struct {
	CellSize   float64       `json:"cellSize"`
	Nodes      []s44NodeSpec `json:"nodes"`
	Edges      []s46stEdge   `json:"edges,omitempty"`
	Tables     []s46stTable  `json:"tables,omitempty"`
	Directions []s46stOrient `json:"directions,omitempty"` // node 0 = root
	Trees      []s46stOrient `json:"trees,omitempty"`      // NodeToTree entries
}

var s46stOrientationNames = map[geo.Orientation]string{
	geo.TopLeft: "TopLeft", geo.TopRight: "TopRight", geo.BottomLeft: "BottomLeft",
	geo.BottomRight: "BottomRight", geo.Top: "Top", geo.Right: "Right",
	geo.Bottom: "Bottom", geo.Left: "Left", geo.NONE: "NONE",
}

func s46stOrientation(name string) geo.Orientation {
	for o, n := range s46stOrientationNames {
		if n == name {
			return o
		}
	}
	panic("unknown orientation " + name)
}

type s46stBuilt struct {
	g     *layoutgraph.Graph
	nodes map[uint64]*layoutgraph.Node
	trees []*layoutgraph.Tree
}

func (spec s46stSpec) build() s46stBuilt {
	g := layoutgraph.NewGraph()
	g.CellSize = spec.CellSize
	nodes := make(map[uint64]*layoutgraph.Node, len(spec.Nodes))
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		if ns.Placed {
			n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		nodes[ns.ID] = n
	}
	for _, ts := range spec.Tables {
		nodes[ts.ID].SetShape(shape.TABLE_TYPE)
		nodes[ts.ID].SetNumColumns(ts.Columns)
	}
	for _, es := range spec.Edges {
		e := g.Connect(nodes[es.From], nodes[es.To])
		for i := 0; i+1 < len(es.Points); i += 2 {
			e.Points = append(e.Points, geo.NewPoint(es.Points[i], es.Points[i+1]))
		}
		if es.FromCol != nil {
			v := *es.FromCol
			e.FromTableColumnIndex = &v
		}
		if es.ToCol != nil {
			v := *es.ToCol
			e.ToTableColumnIndex = &v
		}
		if es.SrcArrow {
			e.SourceArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.TgtArrow {
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Node != 0 {
			container = nodes[d.Node]
		}
		g.Directions[container] = s46stOrientation(d.Orientation)
	}
	b := s46stBuilt{g: g, nodes: nodes}
	if len(spec.Trees) > 0 {
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		for _, ts := range spec.Trees {
			tree := &layoutgraph.Tree{Node: nodes[ts.Node], Orientation: s46stOrientation(ts.Orientation)}
			g.NodeToTree[nodes[ts.Node]] = tree
			b.trees = append(b.trees, tree)
		}
	}
	return b
}

// s46stState is the observable geometry: node boxes, edge routes, and tree
// orientations (in spec order).
type s46stState struct {
	Boxes  []s44Box    `json:"boxes"`
	Routes [][]float64 `json:"routes"`
	Trees  []string    `json:"trees,omitempty"`
}

func (b s46stBuilt) state() s46stState {
	st := s46stState{Boxes: s44Boxes(b.g.Nodes), Routes: make([][]float64, 0, len(b.g.Edges))}
	for _, e := range b.g.Edges {
		route := make([]float64, 0, 2*len(e.Points))
		for _, p := range e.Points {
			route = append(route, p.X, p.Y)
		}
		st.Routes = append(st.Routes, route)
	}
	for _, tree := range b.trees {
		st.Trees = append(st.Trees, s46stOrientationNames[tree.Orientation])
	}
	return st
}

func s46stStateEqual(a, b s46stState) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return bytes.Equal(ja, jb)
}

// ── Stage operations ─────────────────────────────────────────────────────────

// s46stOps runs one stage entry point. Ops returning no bool report false.
var s46stOps = map[string]func(ctx context.Context, b s46stBuilt) (bool, error){
	"align": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, Align(ctx, b.g)
	},
	"alignAxes": func(ctx context.Context, b s46stBuilt) (bool, error) {
		ctx, _, err := layoutgraph.EnsureTransactionWorkGuard(ctx, "Slice46AlignAxes")
		if err != nil {
			return false, err
		}
		txn, err := b.g.NewRequestTransaction(ctx, layoutgraph.TransactionOptions{AffectContainers: true})
		if err != nil {
			return false, err
		}
		return alignAxes(ctx, b.g, txn)
	},
	"swap": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, Swap(ctx, b.g)
	},
	"swapOptimize": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return swapOptimize(ctx, layoutgraph.Nodes(b.g.Nodes), b.g)
	},
	"direct": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, direct(ctx, b.g, b.g.Nodes, nil, directOptions{})
	},
	"directCheck": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, direct(ctx, b.g, b.g.Nodes, nil, directOptions{checkEdgeLength: true})
	},
	"mirrorX": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, mirrorAxes(ctx, b.g, true, false)
	},
	"mirrorXY": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, mirrorAxes(ctx, b.g, true, true)
	},
	"equidistance": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return Equidistance(ctx, b.g)
	},
	"dejitter": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return Dejitter(ctx, b.g)
	},
	"balance": func(ctx context.Context, b s46stBuilt) (bool, error) {
		return false, BalanceSymmetry(ctx, b.g)
	},
}

type s46stRun struct {
	Result bool       `json:"result"`
	Error  string     `json:"error"`
	Used   int64      `json:"used"`
	State  s46stState `json:"state"`
}

type s46stBoundary struct {
	W        int64    `json:"w"`
	AtW      s46stRun `json:"atW"`
	Below    s46stRun `json:"below"`
	Restored bool     `json:"restored"`
}

type s46stProbe struct {
	CancelAt int    `json:"cancelAt"`
	Error    string `json:"error"`
	// ErrorVaries marks probes whose cancellation lands inside Commit's
	// Graph.Containers (Go map) loop: which context check observes the
	// cancellation (the guard's stride poll or the direct check) depends on
	// map order, so only the error source varies. Error is blank then.
	ErrorVaries bool        `json:"errorVaries,omitempty"`
	Canceled    bool        `json:"canceled"`
	Result      bool        `json:"result"`
	Restored    bool        `json:"restored"`
	State       *s46stState `json:"state,omitempty"` // only when not restored
}

type s46stCase struct {
	Name       string         `json:"name"`
	Op         string         `json:"op"`
	Spec       s46stSpec      `json:"spec"`
	Simple     []bool         `json:"simple"` // isSimple per graph node (initial)
	Run        s46stRun       `json:"run"`
	Boundary   *s46stBoundary `json:"boundary,omitempty"`
	ProbeCalls int            `json:"probeCalls"`
	Probes     []s46stProbe   `json:"probes,omitempty"`
}

func s46stRunOnce(op string, spec s46stSpec, limit int64) (s46stBuilt, s46stRun) {
	b := spec.build()
	guard, ctx := s44Guard(limit)
	result, err := s46stOps[op](ctx, b)
	return b, s46stRun{Result: result, Error: s44Err(err), Used: guard.Used(), State: b.state()}
}

func s46stRunEqual(a, b s46stRun) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return bytes.Equal(ja, jb)
}

// s46stMaxProbes bounds the number of cancellation probes per case.
const s46stMaxProbes = 400

func runS46stCase(t *testing.T, name, op string, spec s46stSpec, boundary, probes bool) s46stCase {
	t.Helper()
	out := s46stCase{Name: name, Op: op, Spec: spec}
	{
		b := spec.build()
		for _, n := range b.g.Nodes {
			out.Simple = append(out.Simple, isSimple(b.g, n))
		}
	}
	_, out.Run = s46stRunOnce(op, spec, limits.MaxTransactionWorkUnits)
	// Seeded determinism: the same scenario must replay identically. Commit
	// iterates Graph.Containers (a Go map) and stops at the first bad
	// container, so scenarios where that loop rejects a candidate have
	// map-order-dependent work and are excluded by this check.
	for i := 0; i < 12; i++ {
		if _, again := s46stRunOnce(op, spec, limits.MaxTransactionWorkUnits); !s46stRunEqual(again, out.Run) {
			t.Fatalf("%s/%s is not deterministic in pinned Go", name, op)
		}
	}
	initial := spec.build().state()
	if boundary && out.Run.Error == "" && out.Run.Used > 0 {
		w := out.Run.Used
		_, atW := s46stRunOnce(op, spec, w)
		if !s46stRunEqual(atW, out.Run) {
			t.Fatalf("%s/%s at W differs", name, op)
		}
		_, below := s46stRunOnce(op, spec, w-1)
		if below.Error == "" {
			t.Fatalf("%s/%s at W-1 succeeded", name, op)
		}
		for i := 0; i < 8; i++ {
			if _, again := s46stRunOnce(op, spec, w-1); !s46stRunEqual(again, below) {
				t.Fatalf("%s/%s at W-1 is not deterministic", name, op)
			}
		}
		out.Boundary = &s46stBoundary{W: w, AtW: atW, Below: below, Restored: s46stStateEqual(below.State, initial)}
	}
	if probes {
		count := &s44CountingContext{Context: context.Background()}
		b := spec.build()
		if _, err := s46stOps[op](count, b); s44Err(err) != out.Run.Error {
			t.Fatalf("%s/%s counting run error %v", name, op, err)
		}
		out.ProbeCalls = count.calls
		stride := 1
		if count.calls > s46stMaxProbes {
			stride = (count.calls + s46stMaxProbes - 1) / s46stMaxProbes
		}
		for cancelAt := 1; cancelAt <= count.calls; cancelAt += stride {
			out.Probes = append(out.Probes, s46stStableProbe(t, name, op, spec, cancelAt, initial))
		}
		if (count.calls-1)%stride != 0 {
			out.Probes = append(out.Probes, s46stStableProbe(t, name, op, spec, count.calls, initial))
		}
	}
	return out
}

// s46stStableProbe replays a probe several times (each build has fresh Go
// maps) and keeps only the map-order-independent outcome.
func s46stStableProbe(t *testing.T, name, op string, spec s46stSpec, cancelAt int, initial s46stState) s46stProbe {
	t.Helper()
	first := s46stProbeAt(op, spec, cancelAt, initial)
	samples := 4
	if s46stHasContainers(spec) && (first.Error == "context canceled" || strings.HasSuffix(first.Error, "Transactions: context canceled")) {
		// Small Go maps start iteration at a random bucket offset, so the
		// minority order can appear in as few as 1/8 of runs; sample enough
		// to make a miss negligible.
		samples = 64
	}
	for i := 0; i < samples; i++ {
		again := s46stProbeAt(op, spec, cancelAt, initial)
		if again.Error != first.Error {
			first.Error = ""
			first.ErrorVaries = true
			again.Error = ""
			again.ErrorVaries = true
		}
		ja, _ := json.Marshal(first)
		jb, _ := json.Marshal(again)
		if !bytes.Equal(ja, jb) {
			t.Fatalf("%s/%s probe %d is not deterministic beyond its error source", name, op, cancelAt)
		}
	}
	return first
}

func s46stHasContainers(spec s46stSpec) bool {
	for _, n := range spec.Nodes {
		if n.Container != 0 {
			return true
		}
	}
	return false
}

func s46stProbeAt(op string, spec s46stSpec, cancelAt int, initial s46stState) s46stProbe {
	b := spec.build()
	ctx := &s44CountingContext{Context: context.Background(), cancelAt: cancelAt}
	result, err := s46stOps[op](ctx, b)
	st := b.state()
	probe := s46stProbe{
		CancelAt: cancelAt, Error: s44Err(err), Canceled: errors.Is(err, context.Canceled),
		Result: result, Restored: s46stStateEqual(st, initial),
	}
	if !probe.Restored {
		probe.State = &st
	}
	return probe
}

// ── Scenario builders ────────────────────────────────────────────────────────

func s46stBox(id uint64, w, h, x, y float64) s44NodeSpec {
	return s44NodeSpec{ID: id, W: w, H: h, Placed: true, X: x, Y: y}
}

func s46stIn(n s44NodeSpec, container uint64) s44NodeSpec {
	n.Container = container
	return n
}

func s46stFixed(n s44NodeSpec) s44NodeSpec {
	n.Fixed = true
	n.FX = n.X
	n.FY = n.Y
	return n
}

func s46stCol(v int) *int { return &v }

func s46stEdges(pairs ...uint64) []s46stEdge {
	var out []s46stEdge
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, s46stEdge{From: pairs[i], To: pairs[i+1]})
	}
	return out
}

func s46stRandom(seed int64) s46stSpec {
	rng := rand.New(rand.NewSource(seed))
	flat := randomFlatSpec(rng, 4+rng.Intn(5), 150)
	spec := s46stSpec{CellSize: flat.CellSize, Nodes: flat.Nodes}
	for _, e := range flat.Edges {
		spec.Edges = append(spec.Edges, s46stEdge{From: e.From, To: e.To})
	}
	return spec
}

// Alignment scenarios.
func s46stAlignSpecs() map[string]s46stSpec {
	return map[string]s46stSpec{
		"offset-pair": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 200, 30),
		}, Edges: s46stEdges(1, 2)},
		"offset-chain": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 200, 30),
			s46stBox(3, 40, 40, 400, 70), s46stBox(4, 40, 40, 230, 260),
		}, Edges: s46stEdges(1, 2, 2, 3, 2, 4)},
		"diagonal-near": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 70, 90),
		}, Edges: s46stEdges(1, 2)},
		"fixed-endpoint": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stFixed(s46stBox(1, 40, 40, 0, 0)), s46stBox(2, 40, 40, 200, 30),
			s46stBox(3, 40, 40, 400, 30),
		}, Edges: s46stEdges(1, 2, 2, 3)},
		"blocked": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 300, 50),
			s46stBox(3, 60, 200, 140, -40),
		}, Edges: s46stEdges(1, 2)},
		"container": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 300, 200, 0, 0),
			s46stIn(s46stBox(2, 40, 40, 40, 60), 1), s46stIn(s46stBox(3, 40, 40, 200, 100), 1),
			s46stBox(4, 40, 40, 500, 20),
		}, Edges: s46stEdges(2, 3, 3, 4)},
		"twin-containers": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 200, 200, 0, 0), s46stIn(s46stBox(2, 40, 40, 60, 60), 1),
			s46stBox(3, 200, 200, 400, 40), s46stIn(s46stBox(4, 40, 40, 460, 100), 3),
		}, Edges: s46stEdges(1, 3)},
		"tree-node": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 200, 30), s46stBox(3, 40, 40, 400, 70),
		}, Edges: s46stEdges(1, 2, 2, 3), Trees: []s46stOrient{{Node: 3, Orientation: "Right"}}},
		"table-ports": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 120, 160, 0, 0), s46stBox(2, 120, 160, 400, 50),
		}, Tables: []s46stTable{{ID: 1, Columns: 3}, {ID: 2, Columns: 3}},
			Edges: []s46stEdge{{From: 1, To: 2, FromCol: s46stCol(0), ToCol: s46stCol(2)}}},
		"table-from-port": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 120, 160, 0, 0), s46stBox(2, 60, 60, 400, 120),
		}, Tables: []s46stTable{{ID: 1, Columns: 3}},
			Edges: []s46stEdge{{From: 1, To: 2, FromCol: s46stCol(1)}}},
		"table-to-port": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 60, 60, 0, 0), s46stBox(2, 120, 160, 400, 30),
		}, Tables: []s46stTable{{ID: 2, Columns: 2}},
			Edges: []s46stEdge{{From: 1, To: 2, ToCol: s46stCol(1)}}},
		"table-stacked": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 120, 100, 0, 0), s46stBox(2, 120, 100, 70, 400),
		}, Tables: []s46stTable{{ID: 1, Columns: 2}, {ID: 2, Columns: 2}},
			Edges: []s46stEdge{{From: 1, To: 2, FromCol: s46stCol(0), ToCol: s46stCol(1)}}},
	}
}

// Swap/direct scenarios.
func s46stSwapSpecs() map[string]s46stSpec {
	return map[string]s46stSpec{
		"crossing": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 300, 0),
			s46stBox(3, 40, 40, 0, 300), s46stBox(4, 40, 40, 300, 300),
		}, Edges: s46stEdges(1, 4, 2, 3)},
		"crossing-fixed": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stFixed(s46stBox(1, 40, 40, 0, 0)), s46stFixed(s46stBox(2, 40, 40, 300, 0)),
			s46stBox(3, 40, 40, 0, 300), s46stBox(4, 40, 40, 300, 300),
		}, Edges: s46stEdges(1, 4, 2, 3)},
		"sizes": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 80, 40, 0, 0), s46stBox(2, 40, 120, 300, 0),
			s46stBox(3, 40, 40, 0, 300), s46stBox(4, 60, 60, 300, 300), s46stBox(5, 40, 40, 600, 150),
		}, Edges: s46stEdges(1, 4, 2, 3, 5, 1)},
		"container-siblings": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 500, 200, 0, 0),
			s46stIn(s46stBox(2, 40, 40, 60, 80), 1), s46stIn(s46stBox(3, 40, 40, 360, 80), 1),
			s46stBox(4, 40, 40, 700, 80), s46stBox(5, 40, 40, -300, 80),
		}, Edges: s46stEdges(2, 5, 3, 4, 2, 3)},
		"leaky-container": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 200, 200, 0, 0), s46stIn(s46stBox(2, 40, 40, 80, 80), 1),
			s46stBox(3, 40, 40, 400, 400), s46stBox(4, 40, 40, 800, 80),
		}, Edges: s46stEdges(2, 4, 3, 1)},
		"directed-left": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 300, 0), s46stBox(2, 40, 40, 0, 0), s46stBox(3, 40, 40, -300, 0),
		}, Edges: []s46stEdge{{From: 1, To: 2, TgtArrow: true}, {From: 2, To: 3, TgtArrow: true}}},
		"directed-up-left": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 300, 300), s46stBox(2, 40, 40, 0, 0), s46stBox(3, 40, 40, 300, 0),
		}, Edges: []s46stEdge{{From: 1, To: 2, TgtArrow: true}, {From: 1, To: 3, TgtArrow: true}, {From: 3, To: 2, SrcArrow: true}}},
		"directed-explicit-down": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 300), s46stBox(2, 40, 40, 0, 0), s46stBox(3, 40, 40, 300, 0),
		}, Edges: []s46stEdge{{From: 1, To: 2, TgtArrow: true}, {From: 2, To: 3, TgtArrow: true}},
			Directions: []s46stOrient{{Node: 0, Orientation: "Bottom"}}},
		"directed-container": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 400, 200, 0, 0),
			s46stIn(s46stBox(2, 40, 40, 300, 80), 1), s46stIn(s46stBox(3, 40, 40, 60, 80), 1),
			s46stBox(4, 40, 40, -300, 80),
		}, Edges: []s46stEdge{{From: 2, To: 3, TgtArrow: true}, {From: 1, To: 4, TgtArrow: true}}},
		"directed-fixed": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 300, 0), s46stFixed(s46stBox(2, 40, 40, 0, 0)),
		}, Edges: []s46stEdge{{From: 1, To: 2, TgtArrow: true}}},
		"directed-tree": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 300, 0), s46stBox(2, 40, 40, 0, 0), s46stBox(3, 40, 40, 0, 200),
		}, Edges: []s46stEdge{{From: 1, To: 2, TgtArrow: true}, {From: 1, To: 3, TgtArrow: true}},
			Trees: []s46stOrient{{Node: 2, Orientation: "Right"}, {Node: 3, Orientation: "Bottom"}}},
		"undirected": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 300, 0), s46stBox(2, 40, 40, 0, 0),
		}, Edges: s46stEdges(1, 2)},
	}
}

// Equidistance scenarios.
func s46stEquidistanceSpecs() map[string]s46stSpec {
	return map[string]s46stSpec{
		"horizontal": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 100, 0), s46stBox(3, 40, 40, 500, 0),
		}, Edges: s46stEdges(2, 1, 2, 3)},
		"vertical": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 0, 360), s46stBox(3, 40, 40, 0, 500),
		}, Edges: s46stEdges(2, 1, 2, 3)},
		"with-connected": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 100, 0), s46stBox(3, 40, 40, 500, 0),
			s46stBox(4, 40, 40, 100, 200), s46stBox(5, 40, 40, 100, 400),
		}, Edges: s46stEdges(2, 1, 2, 3, 2, 4, 4, 5)},
		"connected-fixed": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 100, 0), s46stBox(3, 40, 40, 500, 0),
			s46stFixed(s46stBox(4, 40, 40, 100, 200)),
		}, Edges: s46stEdges(2, 1, 2, 3, 2, 4)},
		"both-axes": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 200), s46stBox(2, 40, 40, 100, 100), s46stBox(3, 40, 40, 600, 140),
			s46stBox(4, 40, 40, 100, -400), s46stBox(5, 40, 40, 120, 500),
		}, Edges: s46stEdges(2, 1, 2, 3, 2, 4, 2, 5)},
		"container-move": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 60), s46stBox(2, 120, 160, 100, 0),
			s46stIn(s46stBox(3, 40, 40, 140, 60), 2), s46stBox(4, 40, 40, 700, 60),
		}, Edges: s46stEdges(3, 1, 3, 4)},
		"neighbor-container": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 160, 160, 0, 0), s46stIn(s46stBox(2, 40, 40, 60, 60), 1),
			s46stBox(3, 40, 40, 220, 60), s46stBox(4, 40, 40, 800, 60),
		}, Edges: s46stEdges(3, 2, 3, 4)},
		"fixed-center": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stFixed(s46stBox(2, 40, 40, 100, 0)), s46stBox(3, 40, 40, 500, 0),
		}, Edges: s46stEdges(2, 1, 2, 3)},
		"balanced": {CellSize: 10, Nodes: []s44NodeSpec{
			s46stBox(1, 40, 40, 0, 0), s46stBox(2, 40, 40, 200, 0), s46stBox(3, 40, 40, 400, 0),
		}, Edges: s46stEdges(2, 1, 2, 3)},
	}
}

func s46stRoute(points ...float64) []float64 { return points }

// Dejitter scenarios (pinned dejitter_test.go / dejitter_atomicity_test.go
// graphs plus vertical, To-side, spill, and intersection variants).
func s46stDejitterSpecs() map[string]s46stSpec {
	return map[string]s46stSpec{
		"basic": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 4), s46stBox(2, 8, 8, 20, 3)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(12, 4, 16, 4, 16, 3, 20, 3)}}},
		"final-candidate-fixed": {Nodes: []s44NodeSpec{s46stFixed(s46stBox(2, 8, 8, 20, 3)), s46stBox(1, 8, 8, 4, 4)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(12, 4, 16, 4, 16, 3, 20, 3)}}},
		"prohibit-one": {Nodes: []s44NodeSpec{s46stBox(2, 8, 8, 20, 4), s46stBox(3, 8, 8, 40, 3), s46stBox(1, 8, 8, 4, 4)},
			Edges: []s46stEdge{
				{From: 2, To: 3, Points: s46stRoute(28, 4, 34, 4, 34, 3, 40, 3)},
				{From: 1, To: 2, Points: s46stRoute(12, 4, 20, 4)},
			}},
		"no-dejitter": {Nodes: []s44NodeSpec{s46stBox(2, 8, 8, 20, 4), s46stBox(3, 8, 8, 40, 3), s46stBox(4, 8, 8, 60, 3), s46stBox(1, 8, 8, 4, 4)},
			Edges: []s46stEdge{
				{From: 2, To: 3, Points: s46stRoute(28, 4, 34, 4, 34, 3, 40, 3)},
				{From: 1, To: 2, Points: s46stRoute(12, 4, 20, 4)},
				{From: 3, To: 4, Points: s46stRoute(48, 3, 60, 3)},
			}},
		"tangent": {Nodes: []s44NodeSpec{s46stBox(2, 8, 8, 4, 20), s46stBox(3, 8, 8, 20, 18), s46stBox(4, 8, 8, 20, 4), s46stBox(1, 8, 8, 4, 40)},
			Edges: []s46stEdge{
				{From: 2, To: 3, Points: s46stRoute(12, 24, 16, 24, 16, 22, 20, 22)},
				{From: 2, To: 1, Points: s46stRoute(8, 28, 8, 40)},
				{From: 3, To: 4, Points: s46stRoute(24, 18, 24, 12)},
			}},
		"vertical-line": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 4), s46stBox(2, 8, 8, 6, 30)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(8, 12, 8, 20, 10, 20, 10, 30)}}},
		"to-side": {Nodes: []s44NodeSpec{s46stFixed(s46stBox(1, 8, 8, 4, 4)), s46stBox(2, 8, 8, 20, 3)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(12, 4, 16, 4, 16, 3, 20, 3)}}},
		"u-turn": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 4), s46stBox(2, 8, 8, 4, 30)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(12, 8, 20, 8, 20, 34, 12, 34)}}},
		"far-bends": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 4), s46stBox(2, 8, 8, 300, 200)},
			Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(12, 8, 150, 8, 150, 204, 300, 204)}}},
		"intersects-node": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 10), s46stBox(2, 8, 8, 40, 3), s46stBox(3, 8, 8, 4, 3)},
			Edges: []s46stEdge{
				{From: 1, To: 2, Points: s46stRoute(12, 14, 26, 14, 26, 7, 40, 7)},
				{From: 3, To: 2, Points: s46stRoute(12, 4, 40, 4)},
			}},
		"container-spill": {Nodes: []s44NodeSpec{
			s46stBox(10, 40, 30, 0, 0), s46stIn(s46stBox(1, 8, 8, 30, 4), 10), s46stFixed(s46stBox(2, 8, 8, 60, -4)),
		}, Edges: []s46stEdge{{From: 1, To: 2, Points: s46stRoute(38, 8, 48, 8, 48, 0, 60, 0)}}},
		"two-jitters": {Nodes: []s44NodeSpec{s46stBox(1, 8, 8, 4, 4), s46stBox(2, 8, 8, 20, 3), s46stBox(3, 8, 8, 60, 50), s46stBox(4, 8, 8, 80, 52)},
			Edges: []s46stEdge{
				{From: 1, To: 2, Points: s46stRoute(12, 4, 16, 4, 16, 3, 20, 3)},
				{From: 3, To: 4, Points: s46stRoute(68, 54, 74, 54, 74, 56, 80, 56)},
			}},
	}
}

// BalanceSymmetry scenarios: every candidate has exactly two distinct
// adjacents, so Go's map-ordered adjacency construction is unobservable.
func s46stBalanceSpecs() map[string]s46stSpec {
	star := func(id, x float64, columns bool, extra []s44NodeSpec) (nodes []s44NodeSpec, edges []s46stEdge) {
		c, top, bottom := uint64(id), uint64(id+1), uint64(id+2)
		nodes = []s44NodeSpec{
			s46stBox(c, 10, 10, x, 40), s46stBox(top, 10, 10, x+100, 0), s46stBox(bottom, 10, 10, x+100, 100),
		}
		e1 := s46stEdge{From: c, To: top}
		e2 := s46stEdge{From: c, To: bottom}
		if columns {
			e1.FromCol = s46stCol(0)
			e2.FromCol = s46stCol(0)
		}
		return append(nodes, extra...), []s46stEdge{e1, e2}
	}
	twoStars := func(secondQualifies bool) s46stSpec {
		n1, e1 := star(1, 0, false, nil)
		n2, e2 := star(4, 2000, !secondQualifies, nil)
		return s46stSpec{Nodes: append(n1, n2...), Edges: append(e1, e2...)}
	}
	uneven := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 10, 10, 0, 40), s46stBox(2, 10, 10, 100, 0), s46stBox(3, 40, 40, 100, 100),
	}, Edges: s46stEdges(1, 2, 1, 3)}
	opposite := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 10, 10, 100, 40), s46stBox(2, 10, 10, 0, 0), s46stBox(3, 10, 10, 200, 100),
	}, Edges: s46stEdges(1, 2, 1, 3)}
	horizontal := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 10, 10, 30, 0), s46stBox(2, 10, 10, 0, 100), s46stBox(3, 10, 10, 100, 100),
	}, Edges: s46stEdges(1, 2, 1, 3)}
	containerCenter := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 60, 60, 0, 20), s46stIn(s46stBox(4, 10, 10, 20, 40), 1),
		s46stBox(2, 10, 10, 200, 0), s46stBox(3, 10, 10, 200, 100),
	}, Edges: s46stEdges(1, 2, 1, 3)}
	repeated := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 10, 10, 0, 40), s46stBox(2, 10, 10, 100, 0), s46stBox(3, 10, 10, 100, 100),
	}, Edges: s46stEdges(1, 2, 1, 3, 1, 2)}
	blocked := s46stSpec{Nodes: []s44NodeSpec{
		s46stBox(1, 10, 10, 0, 40), s46stBox(2, 10, 10, 100, 0), s46stBox(3, 10, 10, 100, 100),
		s46stBox(4, 10, 10, 0, 52),
	}, Edges: s46stEdges(1, 2, 1, 3)}
	return map[string]s46stSpec{
		"two-stars":        twoStars(true),
		"one-star-columns": twoStars(false),
		"uneven":           uneven,
		"opposite-sides":   opposite,
		"horizontal":       horizontal,
		"container-center": containerCenter,
		"repeated-edge":    repeated,
		"blocked":          blocked,
	}
}

// ── Oracle ───────────────────────────────────────────────────────────────────

type slice46StagesOracle struct {
	Cases []s46stCase `json:"cases"`
}

func s46stSortedNames(specs map[string]s46stSpec) []string {
	names := make([]string, 0, len(specs))
	for name := range specs {
		names = append(names, name)
	}
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	return names
}

func TestSlice46StagesOracle(t *testing.T) {
	var oracle slice46StagesOracle
	add := func(name, op string, spec s46stSpec, boundary, probes bool) {
		oracle.Cases = append(oracle.Cases, runS46stCase(t, name, op, spec, boundary, probes))
	}

	aligns := s46stAlignSpecs()
	for _, name := range s46stSortedNames(aligns) {
		add(name, "align", aligns[name], true, true)
		add(name, "alignAxes", aligns[name], false, false)
	}
	for seed := int64(0); seed < 6; seed++ {
		spec := s46stRandom(4600 + seed)
		add("random", "align", spec, true, false)
		add("random", "swap", spec, true, false)
		add("random", "equidistance", spec, false, false)
		add("random", "balance", spec, false, false)
		add("random", "directCheck", spec, false, false)
	}

	swaps := s46stSwapSpecs()
	for _, name := range s46stSortedNames(swaps) {
		add(name, "swap", swaps[name], true, true)
		add(name, "swapOptimize", swaps[name], false, false)
		add(name, "direct", swaps[name], true, true)
		add(name, "directCheck", swaps[name], true, false)
		add(name, "mirrorX", swaps[name], false, false)
		add(name, "mirrorXY", swaps[name], true, true)
	}

	equis := s46stEquidistanceSpecs()
	for _, name := range s46stSortedNames(equis) {
		add(name, "equidistance", equis[name], true, true)
	}

	dejitters := s46stDejitterSpecs()
	for _, name := range s46stSortedNames(dejitters) {
		add(name, "dejitter", dejitters[name], true, true)
	}

	balances := s46stBalanceSpecs()
	for _, name := range s46stSortedNames(balances) {
		add(name, "balance", balances[name], true, true)
	}

	// Pin both forceReroute outcomes.
	var sawTrue, sawFalse bool
	for _, c := range oracle.Cases {
		if c.Op == "dejitter" && c.Run.Error == "" {
			sawTrue = sawTrue || c.Run.Result
			sawFalse = sawFalse || !c.Run.Result
		}
	}
	if !sawTrue || !sawFalse {
		t.Fatalf("dejitter oracle must pin forceReroute true and false (true=%v false=%v)", sawTrue, sawFalse)
	}

	s46stWriteOrAssert(t, "go-slice46-placement-stages-reference.json", oracle)
}

func s46stWriteOrAssert(t *testing.T, name string, oracle any) {
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
