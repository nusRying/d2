package placement

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
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 45 sized-optimizer and placement-stage oracle. With
// TALA_SLICE45_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice45-sized-optimizer-reference.json; otherwise it
// recomputes every value and asserts the committed fixture byte for byte.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s45Edge struct {
	From      uint64 `json:"from"`
	To        uint64 `json:"to"`
	MinWidth  int    `json:"minWidth,omitempty"`
	MinHeight int    `json:"minHeight,omitempty"`
}

type s45Herd struct {
	Node        uint64  `json:"node"`
	Orientation string  `json:"orientation"`
	Val         float64 `json:"val"`
}

type s45Hub struct {
	Hub    uint64   `json:"hub"`
	Spokes []uint64 `json:"spokes"`
}

type s45Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type s45Spec struct {
	CellSize  float64       `json:"cellSize"`
	Compute   bool          `json:"compute,omitempty"`
	Nodes     []s44NodeSpec `json:"nodes"`
	Edges     []s45Edge     `json:"edges,omitempty"`
	Nears     [][2]uint64   `json:"nears,omitempty"`
	Herds     []s45Herd     `json:"herds,omitempty"`
	Hubs      []s45Hub      `json:"hubs,omitempty"`
	Obstacles []s45Rect     `json:"obstacles,omitempty"`
	Root      uint64        `json:"root,omitempty"`
	// Cluster builds the pinned optimizeClusters fixture (abducted edges).
	Cluster bool `json:"cluster,omitempty"`
}

var s45Orientations = map[string]geo.Orientation{
	"Top": geo.Top, "Bottom": geo.Bottom, "Left": geo.Left, "Right": geo.Right,
}

type s45Built struct {
	g          *layoutgraph.Graph
	nodes      map[uint64]*layoutgraph.Node
	abductions []*layoutgraph.EdgeAbduction
	obstacles  []geo.Box
	root       *layoutgraph.Node
	tracked    []*layoutgraph.Node
}

func (spec s45Spec) build() s45Built {
	b := s45Built{nodes: map[uint64]*layoutgraph.Node{}}
	if spec.Cluster {
		graph, fixtures := newOptimizeClustersFixtures(1)
		b.g = graph
		b.abductions = fixtures[0].cluster.EdgeAbductions
		b.tracked = fixtures[0].nodes
		for _, n := range fixtures[0].nodes {
			b.nodes[uint64(n.ID)] = n
		}
		return b
	}
	g := layoutgraph.NewGraph()
	g.CellSize = spec.CellSize
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
			container = b.nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		b.nodes[ns.ID] = n
		b.tracked = append(b.tracked, n)
	}
	for _, es := range spec.Edges {
		e := g.Connect(b.nodes[es.From], b.nodes[es.To])
		e.MinWidth = es.MinWidth
		e.MinHeight = es.MinHeight
	}
	for _, pair := range spec.Nears {
		b.nodes[pair[0]].Nears[b.nodes[pair[1]]] = struct{}{}
	}
	for _, h := range spec.Herds {
		b.nodes[h.Node].HerdAssignment = &layoutgraph.HerdAssignment{Orientation: s45Orientations[h.Orientation], Val: h.Val}
	}
	for _, hub := range spec.Hubs {
		spokes := make([]*layoutgraph.Node, 0, len(hub.Spokes))
		for _, id := range hub.Spokes {
			spokes = append(spokes, b.nodes[id])
		}
		g.Hubs[b.nodes[hub.Hub]] = spokes
	}
	for _, o := range spec.Obstacles {
		b.obstacles = append(b.obstacles, geo.Box{TopLeft: geo.NewPoint(o.X, o.Y), Width: o.W, Height: o.H})
	}
	if spec.Root != 0 {
		b.root = b.nodes[spec.Root]
	}
	if spec.Compute {
		g.ComputeCellSize()
	}
	b.g = g
	return b
}

func (b s45Built) optimizer(seed int64) (*sizedOptimizer, error) {
	return newSizedOptimizer(context.Background(), b.g, b.root, b.abductions, rand.New(rand.NewSource(seed)), b.obstacles)
}

type s45State struct {
	Boxes []s44Box   `json:"boxes"`
	Herds []float64  `json:"herds,omitempty"`
	Costs [3]float64 `json:"costs"`
	Cache int        `json:"cache"`
}

func (b s45Built) state() s45State {
	st := s45State{Boxes: s44Boxes(b.tracked), Cache: b.g.EdgeLengthCacheEntries()}
	for _, n := range b.tracked {
		if n.HerdAssignment != nil {
			st.Herds = append(st.Herds, n.HerdAssignment.Val)
		}
	}
	c := b.g.RoutingCosts()
	st.Costs = [3]float64{c.Crossing, c.Turn, c.NonCenterPort}
	return st
}

func s45StateEqual(a, b s45State) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return bytes.Equal(ja, jb)
}

func s45Points(points []geo.Point) []float64 {
	out := make([]float64, 0, 2*len(points))
	for _, p := range points {
		out = append(out, p.X, p.Y)
	}
	return out
}

func s45Guard(ctx context.Context, limit uint64) *limits.OptimizationWorkGuard {
	guard, err := limits.NewOptimizationWorkGuard(ctx, "LocalOptimize", limit)
	if err != nil {
		panic(err)
	}
	return guard
}

// ── Fixed scenarios ──────────────────────────────────────────────────────────

func s45Star(n5X, n5Y float64) s45Spec {
	return s45Spec{Compute: true, Nodes: []s44NodeSpec{
		{ID: 1, W: 50, H: 50, Placed: true, X: 100, Y: 0},
		{ID: 2, W: 50, H: 50, Placed: true, X: 0, Y: 100},
		{ID: 3, W: 50, H: 50, Placed: true, X: 200, Y: 100},
		{ID: 4, W: 50, H: 50, Placed: true, X: 100, Y: 200},
		{ID: 5, W: 50, H: 50, Placed: true, X: n5X, Y: n5Y},
	}, Edges: []s45Edge{{From: 1, To: 5}, {From: 2, To: 5}, {From: 3, To: 5}, {From: 4, To: 5}}}
}

func s45Simple() s45Spec {
	return s45Spec{Compute: true, Nodes: []s44NodeSpec{
		{ID: 1, W: 50, H: 50, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 50, H: 50, Placed: true, X: 200, Y: 0},
		{ID: 3, W: 50, H: 50, Placed: true, X: 400, Y: 100},
	}, Edges: []s45Edge{{From: 1, To: 2}, {From: 2, To: 3}}}
}

// s45Featured is a small graph exercising herd, hub, near-only, fixed,
// parallel-edge long-distance, and obstacle paths at once.
func s45Featured() s45Spec {
	return s45Spec{Compute: true, Nodes: []s44NodeSpec{
		{ID: 1, W: 60, H: 40, Placed: true, X: 300, Y: 300},
		{ID: 2, W: 40, H: 40, Placed: true, X: 600, Y: 300},
		{ID: 3, W: 40, H: 60, Placed: true, X: 300, Y: 600},
		{ID: 4, W: 40, H: 40, Placed: true, X: 0, Y: 300},
		{ID: 5, W: 40, H: 40, Placed: true, X: 300, Y: 0},
		{ID: 6, W: 40, H: 40, Placed: true, X: 900, Y: 900},
		{ID: 7, W: 40, H: 40, Placed: true, X: 900, Y: 0, Fixed: true, FX: 900, FY: 0},
		{ID: 8, W: 40, H: 40, Placed: true, X: 600, Y: 900},
		{ID: 9, W: 40, H: 40, Placed: true, X: 900, Y: 600},
	}, Edges: []s45Edge{
		{From: 1, To: 2}, {From: 1, To: 3}, {From: 1, To: 4}, {From: 1, To: 5},
		// One long-distance neighbor per endpoint keeps Go's map-ordered
		// requirement scan (which breaks early) deterministic.
		{From: 8, To: 9, MinWidth: 200, MinHeight: 200}, {From: 8, To: 9, MinWidth: 200, MinHeight: 200}, {From: 8, To: 9, MinWidth: 200, MinHeight: 200},
		{From: 7, To: 5},
	}, Nears: [][2]uint64{{6, 8}},
		Herds:     []s45Herd{{Node: 3, Orientation: "Bottom", Val: 660}},
		Hubs:      []s45Hub{{Hub: 1, Spokes: []uint64{4, 5}}},
		Obstacles: []s45Rect{{X: 450, Y: 450, W: 100, H: 100}, {X: -60, Y: -60, W: 5000, H: 5000}},
	}
}

// s45SwapGrid is a packed 4x4 grid (found by search) on which the sized
// optimizer's best-swap branch commits a swap at temp 0 with seed 46.
func s45SwapGrid() s45Spec {
	spec := s45Spec{CellSize: 100}
	for i := 0; i < 16; i++ {
		spec.Nodes = append(spec.Nodes, s44NodeSpec{ID: uint64(i + 1), W: 50, H: 50, Placed: true, X: float64(i%4) * 100, Y: float64(i/4) * 100})
	}
	for _, e := range [][2]uint64{{12, 9}, {14, 16}, {1, 5}, {9, 3}, {2, 15}, {14, 15}, {13, 4}, {3, 8}, {12, 14}, {11, 14}, {12, 15}, {2, 10}, {15, 10}} {
		spec.Edges = append(spec.Edges, s45Edge{From: e[0], To: e[1]})
	}
	return spec
}

func s45RandomSpec(rng *rand.Rand, nodeCount int) s45Spec {
	spec := s45Spec{Compute: true}
	cols := int(math.Ceil(math.Sqrt(float64(nodeCount))))
	perm := rng.Perm(cols * cols)
	sizes := []float64{20, 30, 40, 60, 80}
	for i := 0; i < nodeCount; i++ {
		cell := perm[i]
		spec.Nodes = append(spec.Nodes, s44NodeSpec{
			ID: uint64(i + 1), W: sizes[rng.Intn(len(sizes))], H: sizes[rng.Intn(len(sizes))], Placed: true,
			X: float64(cell%cols)*200 + float64(rng.Intn(5))*10, Y: float64(cell/cols)*200 + float64(rng.Intn(5))*10,
		})
	}
	seen := map[[2]uint64]bool{}
	add := func(a, b uint64) {
		if a == b || seen[[2]uint64{a, b}] || seen[[2]uint64{b, a}] {
			return
		}
		seen[[2]uint64{a, b}] = true
		spec.Edges = append(spec.Edges, s45Edge{From: a, To: b})
	}
	for i := 1; i < nodeCount; i++ {
		add(uint64(rng.Intn(i)+1), uint64(i+1))
	}
	for i := 0; i < nodeCount/4; i++ {
		add(uint64(rng.Intn(nodeCount)+1), uint64(rng.Intn(nodeCount)+1))
	}
	if rng.Intn(2) == 0 {
		spec.Herds = append(spec.Herds, s45Herd{Node: uint64(rng.Intn(nodeCount) + 1), Orientation: "Right"})
	}
	return spec
}

// ── Oracle data ──────────────────────────────────────────────────────────────

type s45Run struct {
	Name     string     `json:"name"`
	Spec     s45Spec    `json:"spec"`
	Seed     int64      `json:"seed"`
	Temps    []float64  `json:"temps"`
	Changed  []bool     `json:"changed"`
	Error    string     `json:"error"`
	States   []s45State `json:"states"`
	RandNext string     `json:"randNext"`
	W        uint64     `json:"w"`
	BelowErr string     `json:"belowErr"`
	Restored bool       `json:"restored"`
}

type s45Component struct {
	Name     string    `json:"name"`
	Spec     s45Spec   `json:"spec"`
	Seed     int64     `json:"seed"`
	Node     uint64    `json:"node"`
	Args     []float64 `json:"args,omitempty"`
	Points   []float64 `json:"points,omitempty"`
	Result   []float64 `json:"result,omitempty"`
	ResultID uint64    `json:"resultId,omitempty"`
	Changed  bool      `json:"changed,omitempty"`
	Error    string    `json:"error"`
	Used     uint64    `json:"used"`
	BelowErr string    `json:"belowErr,omitempty"`
	RandNext string    `json:"randNext,omitempty"`
	State    *s45State `json:"state,omitempty"`
}

type s45Probe struct {
	CancelAt int    `json:"cancelAt"`
	Error    string `json:"error"`
	Canceled bool   `json:"canceled"`
	Restored bool   `json:"restored"`
}

type s45ProbeSet struct {
	Name   string     `json:"name"`
	Spec   s45Spec    `json:"spec"`
	Seed   int64      `json:"seed"`
	Temp   float64    `json:"temp"`
	Calls  int        `json:"calls"`
	Stride int        `json:"stride"`
	Probes []s45Probe `json:"probes"`
}

type s45Setup struct {
	Name         string     `json:"name"`
	Error        string     `json:"error"`
	Requirements [][5]int   `json:"requirements,omitempty"` // owner, neighbor, count, maxW, maxH
	FixedOrigin  []float64  `json:"fixedOrigin,omitempty"`
	SetupCalls   int        `json:"setupCalls"`
	Probes       []s45Probe `json:"probes,omitempty"`
}

type s45Stage struct {
	Name    string     `json:"name"`
	Spec    s45Spec    `json:"spec"`
	Changed bool       `json:"changed"`
	Error   string     `json:"error"`
	Used    int64      `json:"used"`
	State   s45State   `json:"state"`
	W       int64      `json:"w"`
	Stride  int64      `json:"stride"`
	Calls   int        `json:"calls"`
	Sweep   []s45Sweep `json:"sweep,omitempty"`
	Probes  []s45Sweep `json:"probes,omitempty"`
}

type s45Sweep struct {
	Limit    int64     `json:"limit"`
	Error    string    `json:"error"`
	Used     int64     `json:"used"`
	Restored bool      `json:"restored"`
	Canceled bool      `json:"canceled,omitempty"`
	Geom     []float64 `json:"geom,omitempty"` // x, y, w, h per tracked node; only when not restored
}

func s45Geom(b s45Built, restored bool) []float64 {
	if restored {
		return nil
	}
	out := make([]float64, 0, 4*len(b.tracked))
	for _, n := range b.tracked {
		out = append(out, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height)
	}
	return out
}

type slice45Oracle struct {
	IterPlacements [][]float64    `json:"iterPlacements"`
	Setup          []s45Setup     `json:"setup"`
	Components     []s45Component `json:"components"`
	Runs           []s45Run       `json:"runs"`
	Probes         []s45ProbeSet  `json:"probes"`
	PanicRollback  []s45Probe     `json:"panicRollback"`
	Stages         []s45Stage     `json:"stages"`
}

func s45RandNext(r *rand.Rand) string { return fmt.Sprint(r.Int63()) }

// findOptimizeW finds the smallest OptimizationWorkGuard limit for which the
// full optimizer run succeeds (binary search; success is monotone in limit).
func findOptimizeW(spec s45Spec, seed int64, temp float64) uint64 {
	ok := func(limit uint64) bool {
		b := spec.build()
		optim, err := b.optimizer(seed)
		if err != nil {
			panic(err)
		}
		_, err = optim.optimizeWithLimit(context.Background(), temp, limit)
		return err == nil
	}
	lo, hi := uint64(0), uint64(limits.MaxOptimizationWorkUnits)
	for lo < hi {
		mid := lo + (hi-lo)/2
		if ok(mid) {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return lo
}

func runS45(name string, spec s45Spec, seed int64, temps []float64, withW bool) s45Run {
	run := s45Run{Name: name, Spec: spec, Seed: seed, Temps: temps}
	b := spec.build()
	r := rand.New(rand.NewSource(seed))
	optim, err := newSizedOptimizer(context.Background(), b.g, b.root, b.abductions, r, b.obstacles)
	if err != nil {
		run.Error = err.Error()
		return run
	}
	for _, temp := range temps {
		changed, err := optim.optimize(context.Background(), temp)
		if err != nil {
			run.Error = err.Error()
			break
		}
		run.Changed = append(run.Changed, changed)
		run.States = append(run.States, b.state())
	}
	run.RandNext = s45RandNext(r)
	// Deterministic repeat: an identical second run must agree exactly.
	{
		b2 := spec.build()
		r2 := rand.New(rand.NewSource(seed))
		optim2, _ := newSizedOptimizer(context.Background(), b2.g, b2.root, b2.abductions, r2, b2.obstacles)
		for i, temp := range temps {
			changed, err := optim2.optimize(context.Background(), temp)
			if err != nil || changed != run.Changed[i] || !s45StateEqual(b2.state(), run.States[i]) {
				panic(fmt.Sprintf("%s: nondeterministic run %d", name, i))
			}
		}
		if s45RandNext(r2) != run.RandNext {
			panic(name + ": nondeterministic RNG")
		}
	}
	if withW && len(temps) == 1 {
		run.W = findOptimizeW(spec, seed, temps[0])
		b3 := spec.build()
		initial := b3.state()
		optim3, _ := b3.optimizer(seed)
		_, err := optim3.optimizeWithLimit(context.Background(), temps[0], run.W-1)
		run.BelowErr = s44Err(err)
		run.Restored = s45StateEqual(initial, b3.state())
	}
	return run
}

func TestGenerateSlice45SizedOptimizerOracle(t *testing.T) {
	var oracle slice45Oracle
	bg := context.Background()

	// iterPlacementsAroundPoint: exact apply order, early stop, !minimizingSelf.
	{
		g := layoutgraph.NewGraph()
		node := layoutgraph.NewNode(1, 10, 10)
		g.AddNodeUnchecked(node)
		g.CellSize = 2
		for _, c := range []struct {
			x, y   float64
			self   bool
			stopAt int
		}{{5, 5, true, -1}, {5, 5, false, -1}, {-3, 2, true, 7}, {0, -4, true, -1}} {
			var points []float64
			iterPlacementsAroundPoint(node, c.x, c.y, c.self, func(x, y float64) bool {
				points = append(points, x, y)
				return c.stopAt >= 0 && len(points)/2 == c.stopAt
			})
			oracle.IterPlacements = append(oracle.IterPlacements, points)
		}
	}

	// Setup validation, long-distance requirements, and setup cancellation.
	{
		addSetup := func(name string, build func() s45Built) {
			b := build()
			entry := s45Setup{Name: name}
			optim, err := newSizedOptimizer(bg, b.g, b.root, b.abductions, rand.New(rand.NewSource(1)), b.obstacles)
			entry.Error = s44Err(err)
			if err == nil {
				for _, n := range b.g.Nodes {
					reqs := n.LongDistanceNeighborRequirements
					if reqs == nil {
						continue
					}
					for _, other := range b.g.Nodes {
						if r, ok := reqs[other]; ok {
							entry.Requirements = append(entry.Requirements, [5]int{int(n.ID), int(other.ID), r.EdgeCount, r.MaxWidth, r.MaxHeight})
						}
					}
				}
				if optim.fixedOrigin != nil {
					entry.FixedOrigin = []float64{optim.fixedOrigin.X, optim.fixedOrigin.Y}
				}
				count := &s44CountingContext{Context: bg}
				b2 := build()
				if _, err := newSizedOptimizer(count, b2.g, b2.root, b2.abductions, rand.New(rand.NewSource(1)), b2.obstacles); err != nil {
					t.Fatal(err)
				}
				entry.SetupCalls = count.calls
				for cancelAt := 1; cancelAt <= count.calls; cancelAt++ {
					b3 := build()
					ctx := &s44CountingContext{Context: bg, cancelAt: cancelAt}
					_, err := newSizedOptimizer(ctx, b3.g, b3.root, b3.abductions, rand.New(rand.NewSource(1)), b3.obstacles)
					entry.Probes = append(entry.Probes, s45Probe{CancelAt: cancelAt, Error: s44Err(err), Canceled: errors.Is(err, context.Canceled)})
				}
			}
			oracle.Setup = append(oracle.Setup, entry)
		}
		addSetup("parallel-edges", func() s45Built {
			spec := s45Spec{CellSize: 100, Nodes: []s44NodeSpec{
				{ID: 1, W: 50, H: 50, Placed: true, X: 0, Y: 0}, {ID: 2, W: 50, H: 50, Placed: true, X: 100, Y: 0},
			}}
			for i := 0; i < 256; i++ {
				spec.Edges = append(spec.Edges, s45Edge{From: 1, To: 2, MinWidth: 5000, MinHeight: 6000})
			}
			return spec.build()
		})
		addSetup("below-threshold", func() s45Built {
			spec := s45Spec{CellSize: 100, Nodes: []s44NodeSpec{
				{ID: 1, W: 50, H: 50, Placed: true, X: 0, Y: 0}, {ID: 2, W: 50, H: 50, Placed: true, X: 300, Y: 0},
			}, Edges: []s45Edge{{From: 1, To: 2, MinWidth: 100}, {From: 1, To: 2, MinWidth: 100}, {From: 1, To: 2, MinHeight: 100}, {From: 1, To: 2, MinWidth: 2}}}
			return spec.build()
		})
		addSetup("featured", func() s45Built { return s45Featured().build() })
		addSetup("cluster-abductions", func() s45Built { return s45Spec{Cluster: true}.build() })
		addSetup("fixed-root", func() s45Built {
			spec := s45Spec{CellSize: 10, Nodes: []s44NodeSpec{
				{ID: 1, W: 400, H: 400, Placed: true, X: 0, Y: 0},
				{ID: 2, W: 40, H: 40, Placed: true, X: 100, Y: 100, Container: 1, Fixed: true, FX: 60, FY: 70},
				{ID: 3, W: 40, H: 40, Placed: true, X: 200, Y: 200, Container: 1},
			}, Edges: []s45Edge{{From: 2, To: 3}}, Root: 1}
			return spec.build()
		})
		for _, bad := range []struct {
			name string
			mut  func(b *s45Built)
		}{
			{"cell-zero", func(b *s45Built) { b.g.CellSize = 0 }},
			{"cell-fraction", func(b *s45Built) { b.g.CellSize = 10.5 }},
			{"cell-nan", func(b *s45Built) { b.g.CellSize = math.NaN() }},
			{"cell-inf", func(b *s45Built) { b.g.CellSize = math.Inf(1) }},
			{"graphless-node", func(b *s45Built) { b.g.Nodes[1].Graph = nil }},
			{"cell-mismatch", func(b *s45Built) {
				other := layoutgraph.NewGraph()
				other.CellSize = 7
				b.g.Nodes[1].Graph = other
			}},
			{"nil-abduction", func(b *s45Built) { b.abductions = []*layoutgraph.EdgeAbduction{nil} }},
			{"malformed-edge", func(b *s45Built) {
				b.g.Nodes[0].Edges = append(b.g.Nodes[0].Edges, layoutgraph.NewEdge(b.g.Nodes[1], b.g.Nodes[2]))
			}},
		} {
			addSetup(bad.name, func() s45Built {
				b := s45Simple().build()
				bad.mut(&b)
				return b
			})
		}
	}

	// Components with their own measurable OptimizationWorkGuard.
	component := func(name string, spec s45Spec, seed int64, node uint64, fn func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error) {
		run := func(limit uint64) (s45Component, s45Built, *rand.Rand) {
			c := s45Component{Name: name, Spec: spec, Seed: seed, Node: node}
			b := spec.build()
			r := rand.New(rand.NewSource(seed))
			optim, err := newSizedOptimizer(bg, b.g, b.root, b.abductions, r, b.obstacles)
			if err != nil {
				t.Fatal(err)
			}
			guard := s45Guard(bg, limit)
			err = fn(optim, b.nodes[node], guard, &c)
			c.Error = s44Err(err)
			c.Used = guard.Used()
			return c, b, r
		}
		c, b, r := run(limits.MaxOptimizationWorkUnits)
		c.RandNext = s45RandNext(r)
		st := b.state()
		c.State = &st
		if c.Used > 0 {
			below, _, _ := run(c.Used - 1)
			c.BelowErr = below.Error
		}
		oracle.Components = append(oracle.Components, c)
	}
	medianFn := func(temp float64) func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		return func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
			children, err := o.protrudingChildrenGuarded(n, g)
			if err != nil {
				return err
			}
			p, err := o.medianPointGuarded(n, temp, children, g)
			if err != nil {
				return err
			}
			c.Args = []float64{temp, float64(len(children))}
			c.Result = []float64{p.X, p.Y}
			return nil
		}
	}
	component("median-star", s45Star(0, 0), 1, 5, medianFn(0))
	component("median-temp", s45Star(0, 0), 3, 5, medianFn(1.5))
	component("median-fixed-origin", s45Spec{CellSize: 10, Nodes: []s44NodeSpec{
		{ID: 1, W: 400, H: 400, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 200, Y: 200, Container: 1, Fixed: true, FX: 50, FY: 60},
		{ID: 3, W: 40, H: 40, Placed: true, X: 300, Y: 300, Container: 1},
		{ID: 4, W: 40, H: 40, Placed: true, X: 0, Y: 0, Container: 1},
	}, Edges: []s45Edge{{From: 3, To: 4}}, Root: 1}, 5, 3, medianFn(2))
	component("median-protruding", s45Spec{Cluster: true}, 2, 5, medianFn(0.5))

	closestFn := func(px, py float64, self bool, cached bool) func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		return func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
			if err := o.rebuildSpatialIndex(g); err != nil {
				return err
			}
			var checked map[geo.Point]struct{}
			if cached {
				checked = map[geo.Point]struct{}{}
			}
			d, err := o.findClosestUnoccupiedDistanceGuarded(n, geo.NewPoint(px, py), self, checked, g)
			c.Args = []float64{px, py}
			c.Result = []float64{d, float64(len(checked))}
			return err
		}
	}
	component("closest-self", s45Star(0, 0), 1, 5, closestFn(0, 0, true, false))
	component("closest-center", s45Star(0, 0), 1, 5, closestFn(100, 100, true, false))
	component("closest-n4", s45Star(0, 0), 1, 5, closestFn(100, 200, true, true))
	component("closest-not-self", s45Star(0, 0), 1, 5, closestFn(100, 200, false, true))
	component("closest-fixed-origin", s45Spec{CellSize: 10, Nodes: []s44NodeSpec{
		{ID: 1, W: 400, H: 400, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 100, Y: 100, Container: 1, Fixed: true, FX: 60, FY: 70},
		{ID: 3, W: 40, H: 40, Placed: true, X: 200, Y: 200, Container: 1},
	}, Edges: []s45Edge{{From: 2, To: 3}}, Root: 1}, 1, 3, closestFn(30, 30, true, true))

	occupiedFn := func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		if err := o.rebuildSpatialIndex(g); err != nil {
			return err
		}
		p := geo.NewPoint(100, 100)
		for x := -150.0; x <= 150; x += 25 {
			for y := -150.0; y <= 150; y += 25 {
				occ, err := o.isPointOccupiedGuarded(x, y, p, n, g)
				if err != nil {
					return err
				}
				free, err := o.findUnoccupiedGuarded(x, y, n.Width, n.Height, true, n, p, nil, g)
				if err != nil {
					return err
				}
				v := 0.0
				if occ {
					v += 1
				}
				if free {
					v += 2
				}
				c.Result = append(c.Result, v)
			}
		}
		return nil
	}
	component("occupied-grid", s45Star(0, 0), 1, 5, occupiedFn)

	pointsFn := func(mx, my, d float64, self bool) func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		return func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
			scratch := &placementPointsScratch{}
			// A first fill populates `seen` so the second exercises the charged clear.
			if _, err := o.fillPlacementPointsGuarded(n, geo.NewPoint(mx, my), d, self, scratch, g); err != nil {
				return err
			}
			points, err := o.fillPlacementPointsGuarded(n, geo.NewPoint(mx, my), d, self, scratch, g)
			if err != nil {
				return err
			}
			c.Args = []float64{mx, my, d}
			c.Points = s45Points(points)
			if err := limits.Shuffle(points, o.randGenerator, g); err != nil {
				return err
			}
			c.Result = s45Points(points)
			return nil
		}
	}
	component("points-star", s45Star(0, 0), 1, 5, pointsFn(100, 100, 1, true))
	component("points-negative", s45Star(0, 0), 9, 5, pointsFn(-370, -230, 2, true))
	component("points-not-self", s45Star(0, 0), 2, 5, pointsFn(100, 100, 3, false))
	component("points-long-distance", s45Featured(), 4, 8, pointsFn(600, 900, 1, true))
	component("points-herd", s45Featured(), 4, 3, pointsFn(300, 600, 0, true))
	component("points-fixed-origin", s45Spec{CellSize: 10, Nodes: []s44NodeSpec{
		{ID: 1, W: 400, H: 400, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 100, Y: 100, Container: 1, Fixed: true, FX: 60, FY: 70},
		{ID: 3, W: 40, H: 40, Placed: true, X: 200, Y: 200, Container: 1},
	}, Edges: []s45Edge{{From: 2, To: 3}}, Root: 1}, 1, 3, pointsFn(40, 40, 2, true))

	moveFn := func(points []float64, mustImprove bool) func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		return func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
			if err := o.rebuildSpatialIndex(g); err != nil {
				return err
			}
			var pts []geo.Point
			for i := 0; i+1 < len(points); i += 2 {
				pts = append(pts, geo.Point{X: points[i], Y: points[i+1]})
			}
			c.Points = points
			moved, err := o.moveNodeToBestGuarded(bg, n, pts, mustImprove, g)
			c.Changed = moved
			c.Result = []float64{n.TopLeft.X, n.TopLeft.Y}
			return err
		}
	}
	component("move-stay", s45Star(0, 0), 1, 5, moveFn([]float64{0, 0, 100, 100}, false))
	component("move-best", s45Star(0, 0), 1, 5, moveFn([]float64{300, 200, 400, 200, 350, 200}, false))
	component("move-tie-current", s45Star(0, 0), 1, 5, moveFn([]float64{0, 0, 0, 0}, true))
	component("move-must-improve", s45Star(0, 0), 1, 5, moveFn([]float64{350, 200, 300, 300, 0, 0}, true))
	component("move-no-placement", s45Star(0, 0), 1, 5, moveFn([]float64{100, 100, 200, 100}, false))
	component("move-obstacle", s45Featured(), 1, 1, moveFn([]float64{450, 450, 300, 300, 420, 300, 300, 420}, false))
	component("move-cluster", s45Spec{Cluster: true}, 1, 5, moveFn([]float64{1000, 1220, 1300, 1220, 700, 1220}, false))

	swapFn := func(cell float64, nx, ny float64) func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
		return func(o *sizedOptimizer, n *layoutgraph.Node, g *limits.OptimizationWorkGuard, c *s45Component) error {
			if cell != 0 {
				o.g.CellSize = cell
			}
			if nx != 0 || ny != 0 {
				n.TopLeft = geo.NewPoint(nx, ny)
			}
			if err := o.rebuildSpatialIndex(g); err != nil {
				return err
			}
			candidate, err := o.bestSwapCandidateGuarded(bg, n, g)
			if candidate != nil {
				c.ResultID = uint64(candidate.ID)
			}
			return err
		}
	}
	swapSpec := s45Spec{Compute: true, Nodes: []s44NodeSpec{
		{ID: 1, W: 50, H: 50, Placed: true, X: 100, Y: 0},
		{ID: 2, W: 50, H: 50, Placed: true, X: 0, Y: 100},
		{ID: 3, W: 50, H: 50, Placed: true, X: 250, Y: 100},
		{ID: 4, W: 50, H: 50, Placed: true, X: 100, Y: 200},
		{ID: 5, W: 50, H: 50, Placed: true, X: 350, Y: 200},
	}, Edges: []s45Edge{{From: 1, To: 5}, {From: 2, To: 5}, {From: 3, To: 5}, {From: 4, To: 5}}}
	component("swap-none", swapSpec, 1, 5, swapFn(0, 0, 0))
	component("swap-n3", swapSpec, 1, 5, swapFn(100, 400, 100))

	// Full optimizer runs: pinned, featured, cluster, spatial-indexed, random.
	oracle.Runs = append(oracle.Runs,
		runS45("simple-temp0", s45Simple(), 1, []float64{0}, true),
		runS45("simple-seed7", s45Simple(), 7, []float64{0}, true),
		runS45("star-anneal", s45Star(0, 0), 3, []float64{2, 1, 0.5, 0}, false),
		runS45("featured-temp0", s45Featured(), 5, []float64{0}, true),
		runS45("featured-temp1", s45Featured(), 6, []float64{1}, true),
		runS45("featured-anneal", s45Featured(), 8, []float64{3, 1.5, 0.5, 0, 0}, false),
		runS45("cluster-temp1", s45Spec{Cluster: true}, 2, []float64{1}, true),
		runS45("cluster-anneal", s45Spec{Cluster: true}, 4, []float64{2, 0}, false),
		runS45("swap-grid-temp0", s45SwapGrid(), 46, []float64{0}, true),
		runS45("swap-grid-anneal", s45SwapGrid(), 46, []float64{1, 0, 0}, false),
	)
	for seed := int64(0); seed < 6; seed++ {
		rng := rand.New(rand.NewSource(500 + seed))
		spec := s45RandomSpec(rng, 6+rng.Intn(10))
		oracle.Runs = append(oracle.Runs, runS45(fmt.Sprintf("random-%d", seed), spec, 100+seed, []float64{1}, true))
		oracle.Runs = append(oracle.Runs, runS45(fmt.Sprintf("random-anneal-%d", seed), spec, 200+seed, []float64{2, 0.5, 0}, false))
	}
	{
		rng := rand.New(rand.NewSource(900))
		large := s45RandomSpec(rng, 110)
		oracle.Runs = append(oracle.Runs, runS45("indexed-110", large, 11, []float64{1}, false))
		oracle.Runs = append(oracle.Runs, runS45("indexed-110-temp0", large, 12, []float64{0}, false))
	}

	// Exhaustive cancellation checkpoints of full runs (every Err call).
	probeSet := func(name string, spec s45Spec, seed int64, temp float64) {
		set := s45ProbeSet{Name: name, Spec: spec, Seed: seed, Temp: temp, Stride: 1}
		{
			b := spec.build()
			optim, _ := b.optimizer(seed)
			count := &s44CountingContext{Context: bg}
			if _, err := optim.optimize(count, temp); err != nil {
				t.Fatal(err)
			}
			set.Calls = count.calls
		}
		for set.Calls/set.Stride > 1500 {
			set.Stride++
		}
		for cancelAt := 1; cancelAt <= set.Calls; cancelAt += set.Stride {
			b := spec.build()
			initial := b.state()
			optim, _ := b.optimizer(seed)
			ctx := &s44CountingContext{Context: bg, cancelAt: cancelAt}
			_, err := optim.optimize(ctx, temp)
			set.Probes = append(set.Probes, s45Probe{
				CancelAt: cancelAt, Error: s44Err(err), Canceled: errors.Is(err, context.Canceled),
				Restored: s45StateEqual(initial, b.state()),
			})
		}
		oracle.Probes = append(oracle.Probes, set)
	}
	probeSet("simple-temp0", s45Simple(), 1, 0)
	probeSet("featured-temp1", s45Featured(), 6, 1)
	probeSet("cluster-temp1", s45Spec{Cluster: true}, 2, 1)

	// Panic at the first context check after a trial mutation.
	for _, c := range []struct {
		spec s45Spec
		seed int64
		temp float64
	}{{s45Simple(), 1, 0}, {s45Featured(), 6, 1}} {
		b := c.spec.build()
		initial := b.state()
		positions := captureExactOptimizerPositions(b.g)
		optim, _ := b.optimizer(c.seed)
		ctx := &cancelOnOptimizerMutation{Context: bg, positions: positions, panic: true}
		var recovered any
		func() {
			defer func() { recovered = recover() }()
			_, _ = optim.optimize(ctx, c.temp)
		}()
		oracle.PanicRollback = append(oracle.PanicRollback, s45Probe{
			Error: fmt.Sprint(recovered), Canceled: ctx.observed, Restored: s45StateEqual(initial, b.state()),
		})
	}

	// Placement stage closure: NormalizeGaps and TransposeAll.
	stage := func(name string, spec s45Spec, fn func(ctx context.Context, g *layoutgraph.Graph) (bool, error), sweep bool, probes bool) {
		run := func(ctx context.Context, limit int64) (s45Built, *limits.WorkGuard, bool, error) {
			b := spec.build()
			guard, err := limits.NewWorkGuard(bg, "Slice45StageOracle", limit)
			if err != nil {
				t.Fatal(err)
			}
			changed, err := fn(layoutgraph.ContextWithTransactionWorkGuard(ctx, guard), b.g)
			return b, guard, changed, err
		}
		st := s45Stage{Name: name, Spec: spec}
		b, guard, changed, err := run(bg, limits.MaxTransactionWorkUnits)
		st.Changed, st.Error, st.Used, st.State, st.W = changed, s44Err(err), guard.Used(), b.state(), guard.Used()
		if sweep {
			st.Stride = max(1, (st.W+599)/600)
			for limit := int64(1); limit < st.W; limit += st.Stride {
				b, guard, _, err := run(bg, limit)
				initial := spec.build().state()
				st.Sweep = append(st.Sweep, s45Sweep{Limit: limit, Error: s44Err(err), Used: guard.Used(), Restored: s45StateEqual(initial, b.state()), Geom: s45Geom(b, s45StateEqual(initial, b.state()))})
			}
		}
		if probes {
			count := &s44CountingContext{Context: bg}
			run(count, limits.MaxTransactionWorkUnits)
			st.Calls = count.calls
			probeStride := max(1, (count.calls+599)/600)
			for cancelAt := 1; cancelAt <= count.calls; cancelAt += probeStride {
				ctx := &s44CountingContext{Context: bg, cancelAt: cancelAt}
				b, _, _, err := run(ctx, limits.MaxTransactionWorkUnits)
				initial := spec.build().state()
				st.Probes = append(st.Probes, s45Sweep{Limit: int64(cancelAt), Error: s44Err(err), Canceled: errors.Is(err, context.Canceled), Restored: s45StateEqual(initial, b.state()), Geom: s45Geom(b, s45StateEqual(initial, b.state()))})
			}
		}
		oracle.Stages = append(oracle.Stages, st)
	}
	normalizeGaps := func(ctx context.Context, g *layoutgraph.Graph) (bool, error) { return NormalizeGaps(ctx, g) }
	transposeAll := func(ctx context.Context, g *layoutgraph.Graph) (bool, error) { return false, TransposeAll(ctx, g) }
	containerGaps := s45Spec{CellSize: 10, Nodes: []s44NodeSpec{
		{ID: 1, W: 700, H: 200, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 40, Y: 60, Container: 1},
		{ID: 3, W: 40, H: 40, Placed: true, X: 600, Y: 60, Container: 1},
		{ID: 4, W: 40, H: 40, Placed: true, X: 2200, Y: 60},
		{ID: 5, W: 40, H: 40, Placed: true, X: 2200, Y: 1500},
	}, Edges: []s45Edge{{From: 2, To: 4}, {From: 2, To: 3}, {From: 4, To: 5}}}
	stage("normalize-gaps-containers", containerGaps, normalizeGaps, true, true)
	stage("normalize-gaps-basic", s45Spec{Nodes: []s44NodeSpec{
		{ID: 1, W: 10, H: 10, Placed: true, X: 0, Y: 0}, {ID: 2, W: 10, H: 10, Placed: true, X: 1000, Y: 0},
	}, Edges: []s45Edge{{From: 1, To: 2}}}, normalizeGaps, true, true)
	stage("normalize-gaps-empty", s45Spec{}, normalizeGaps, false, false)
	for seed := int64(0); seed < 3; seed++ {
		rng := rand.New(rand.NewSource(700 + seed))
		spec := randomFlatSpec(rng, 5+rng.Intn(4), 150)
		s := s45Spec{CellSize: spec.CellSize, Nodes: spec.Nodes}
		for _, e := range spec.Edges {
			s.Edges = append(s.Edges, s45Edge{From: e.From, To: e.To})
		}
		stage(fmt.Sprintf("transpose-all-%d", seed), s, transposeAll, seed == 0, seed == 0)
		stage(fmt.Sprintf("normalize-gaps-random-%d", seed), s, normalizeGaps, false, false)
	}

	writeOrAssertSlice45Fixture(t, "go-slice45-sized-optimizer-reference.json", oracle)
}

func writeOrAssertSlice45Fixture(t *testing.T, name string, oracle any) {
	t.Helper()
	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", name)
	if os.Getenv("TALA_SLICE45_ORACLE") == "1" {
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
		t.Fatalf("%s is stale; regenerate with TALA_SLICE45_ORACLE=1", name)
	}
}
