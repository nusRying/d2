package hierarchy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 46 hierarchy oracle. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-hierarchy-reference.json; otherwise it
// recomputes every value and asserts the committed fixture byte for byte.
//
// Go map iteration: findCycleEdges' work-step count (and so its stride-64
// cancellation polls) depends on Go's randomized map order, and
// placeNodesInHierarchy polls ctx.Err() while scanning Hierarchy.Levels() for
// a fixed member. Every recorded value is recomputed several times during
// generation and must agree; probe scenarios keep FindCycleEdges below one
// polling stride and avoid fixed hierarchy members, so their call counts are
// stable.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s46NodeSpec struct {
	ID        uint64  `json:"id"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Container uint64  `json:"container,omitempty"`
	Shape     string  `json:"shape,omitempty"`
	Columns   int     `json:"columns,omitempty"`
	Fixed     bool    `json:"fixed,omitempty"`
	Force     bool    `json:"force,omitempty"`
}

type s46EdgeSpec struct {
	ID      uint64  `json:"id"`
	From    uint64  `json:"from"`
	To      uint64  `json:"to"`
	Src     string  `json:"src,omitempty"`
	Dst     string  `json:"dst,omitempty"`
	FromCol *int    `json:"fromCol,omitempty"`
	ToCol   *int    `json:"toCol,omitempty"`
	LabelW  float64 `json:"labelW,omitempty"`
	LabelH  float64 `json:"labelH,omitempty"`
	Weight  *int    `json:"weight,omitempty"`
}

type s46HierarchySpec struct {
	Members    [][2]int64 `json:"members"` // node id, level
	LevelCount int        `json:"levelCount"`
}

type s46DirectionSpec struct {
	Container uint64 `json:"container"`
	Direction string `json:"direction"`
}

type s46Spec struct {
	Nodes         []s46NodeSpec      `json:"nodes"`
	Edges         []s46EdgeSpec      `json:"edges,omitempty"`
	RootHierarchy bool               `json:"rootHierarchy,omitempty"`
	Directions    []s46DirectionSpec `json:"directions,omitempty"`
	Nears         [][2]uint64        `json:"nears,omitempty"`
	Hierarchies   []s46HierarchySpec `json:"hierarchies,omitempty"`
}

var s46Orientations = map[string]geo.Orientation{
	"Top": geo.Top, "Bottom": geo.Bottom, "Left": geo.Left, "Right": geo.Right,
}

type s46Built struct {
	g     *layoutgraph.Graph
	nodes []*layoutgraph.Node
	byID  map[uint64]*layoutgraph.Node
	edges []*layoutgraph.Edge
}

func (spec s46Spec) build() s46Built {
	b := s46Built{g: layoutgraph.NewGraph(), byID: map[uint64]*layoutgraph.Node{}}
	b.g.IsRootHierarchy = spec.RootHierarchy
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		if ns.Columns > 0 {
			n.SetNumColumns(ns.Columns)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.X, ns.Y)
		}
		n.ForceHierarchy = ns.Force
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = b.byID[ns.Container]
		}
		b.g.AddNewNodeToContainer(container, n)
		b.nodes = append(b.nodes, n)
		b.byID[ns.ID] = n
	}
	for _, es := range spec.Edges {
		e := b.g.Connect(b.byID[es.From], b.byID[es.To])
		e.ID = layoutgraph.EntityID(es.ID)
		if es.Src != "" {
			e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		}
		if es.Dst != "" {
			e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		}
		if es.FromCol != nil {
			v := *es.FromCol
			e.FromTableColumnIndex = &v
		}
		if es.ToCol != nil {
			v := *es.ToCol
			e.ToTableColumnIndex = &v
		}
		if es.LabelW != 0 || es.LabelH != 0 {
			e.Label = &layoutgraph.Label{Width: es.LabelW, Height: es.LabelH}
		}
		if es.Weight != nil {
			e.SetHierarchyRankWeight(*es.Weight)
		}
		b.edges = append(b.edges, e)
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Container != 0 {
			container = b.byID[d.Container]
		}
		b.g.Directions[container] = s46Orientations[d.Direction]
	}
	for _, pair := range spec.Nears {
		b.byID[pair[0]].AddNear(b.byID[pair[1]])
	}
	for _, hs := range spec.Hierarchies {
		h := layoutgraph.NewHierarchy()
		h.LevelCount = hs.LevelCount
		for _, m := range hs.Members {
			n := b.byID[uint64(m[0])]
			h.Levels()[n] = int(m[1])
			n.Hierarchy = h
		}
	}
	return b
}

// ── Observable state ─────────────────────────────────────────────────────────

type s46State struct {
	Boxes       []float64  `json:"boxes"`
	Hier        []int      `json:"hier"`
	Levels      []int      `json:"levels"`
	LevelCounts []int      `json:"levelCounts"`
	HierSizes   []int      `json:"hierSizes"`
	Edges       []uint64   `json:"edges"`
	Adj         [][]uint64 `json:"adj"`
	Nears       [][]uint64 `json:"nears"`
	Owned       []bool     `json:"owned"`
}

func (b s46Built) state() s46State {
	st := s46State{}
	index := map[*layoutgraph.Hierarchy]int{}
	for _, n := range b.nodes {
		st.Boxes = append(st.Boxes, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height)
		if n.Hierarchy == nil {
			st.Hier = append(st.Hier, -1)
			st.Levels = append(st.Levels, 0)
		} else {
			i, ok := index[n.Hierarchy]
			if !ok {
				i = len(st.LevelCounts)
				index[n.Hierarchy] = i
				st.LevelCounts = append(st.LevelCounts, n.Hierarchy.LevelCount)
				st.HierSizes = append(st.HierSizes, len(n.Hierarchy.Levels()))
			}
			st.Hier = append(st.Hier, i)
			st.Levels = append(st.Levels, n.HierarchyLevel())
		}
		adj := []uint64{}
		for _, e := range n.Edges {
			adj = append(adj, uint64(e.ID))
		}
		st.Adj = append(st.Adj, adj)
		nears := []uint64{}
		for near := range n.Nears {
			nears = append(nears, uint64(near.ID))
		}
		slices.Sort(nears)
		st.Nears = append(st.Nears, nears)
		st.Owned = append(st.Owned, n.Graph == b.g)
	}
	for _, e := range b.edges {
		st.Edges = append(st.Edges, uint64(e.From.ID), uint64(e.To.ID))
	}
	return st
}

func s46Equal(a, b any) bool {
	ja, err := json.Marshal(a)
	if err != nil {
		panic(err)
	}
	jb, err := json.Marshal(b)
	if err != nil {
		panic(err)
	}
	return bytes.Equal(ja, jb)
}

func s46Err(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func s46Rand(seed int64) *rand.Rand {
	if seed < 0 {
		return nil
	}
	return rand.New(rand.NewSource(seed))
}

type s46CountingContext struct {
	context.Context
	calls    int
	cancelAt int
	panicAt  int
}

func (ctx *s46CountingContext) Err() error {
	ctx.calls++
	if ctx.panicAt > 0 && ctx.calls == ctx.panicAt {
		panic("s46 injected panic")
	}
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

// ── Stages ───────────────────────────────────────────────────────────────────

type s46StageRun struct {
	b       s46Built
	pre     s46State
	used    int64
	changed bool
	err     error
}

// runStage runs one public entry point under a transaction WorkGuard with the
// given limit (whose own context is Background), passing ctx to the stage.
func runStage(stage string, spec s46Spec, seed int64, ctx context.Context, limit int64) s46StageRun {
	bg := context.Background()
	run := s46StageRun{b: spec.build()}
	g := run.b.g
	if stage == "place" {
		if err := Assign(bg, g, nil, Candidates(g)); err != nil {
			panic(err)
		}
	}
	run.pre = run.b.state()
	guard, err := limits.NewWorkGuard(bg, "Slice46Oracle", limit)
	if err != nil {
		panic(err)
	}
	txCtx := layoutgraph.ContextWithTransactionWorkGuard(ctx, guard)
	switch stage {
	case "assign":
		run.err = Assign(txCtx, g, nil, Candidates(g))
	case "place", "placeOnly":
		run.err = Place(txCtx, g, nil, s46Rand(seed))
	case "compound":
		run.changed, run.err = PlaceCompound(txCtx, g, s46Rand(seed))
	default:
		panic("unknown stage " + stage)
	}
	run.used = guard.Used()
	return run
}

func runRank(spec s46Spec, ctx context.Context, limit uint64) (rankResult, error) {
	b := spec.build()
	return rankDAGWithLimit(ctx, b.g, limit)
}

// ── Oracle records ───────────────────────────────────────────────────────────

type s46Probe struct {
	CancelAt int    `json:"cancelAt"`
	Error    string `json:"error"`
	Canceled bool   `json:"canceled"`
	Restored bool   `json:"restored"`
}

type s46Case struct {
	Name  string  `json:"name"`
	Op    string  `json:"op"`
	Stage string  `json:"stage,omitempty"`
	Spec  s46Spec `json:"spec"`
	Seed  int64   `json:"seed"`

	Candidates []uint64    `json:"candidates,omitempty"`
	Errors     []string    `json:"errors,omitempty"`
	States     []s46State  `json:"states,omitempty"`
	Used       []int64     `json:"used,omitempty"`
	Changed    bool        `json:"changed,omitempty"`
	Error      string      `json:"error,omitempty"`
	Levels     [][2]int64  `json:"levels,omitempty"`
	LevelCount int         `json:"levelCount,omitempty"`
	DagNodes   []uint64    `json:"dagNodes,omitempty"`
	DagEdges   [][3]int64  `json:"dagEdges,omitempty"`
	CycleEdges [][2]uint64 `json:"cycleEdges,omitempty"`
	Orders     [][][]int64 `json:"orders,omitempty"`
	Crossings  []int64     `json:"crossings,omitempty"`

	W             int64  `json:"w,omitempty"`
	BelowErr      string `json:"belowErr,omitempty"`
	BelowRestored bool   `json:"belowRestored,omitempty"`

	Calls  int        `json:"calls,omitempty"`
	Stride int        `json:"stride,omitempty"`
	Probes []s46Probe `json:"probes,omitempty"`

	PanicAt  int    `json:"panicAt,omitempty"`
	Panic    string `json:"panic,omitempty"`
	Restored bool   `json:"restored,omitempty"`
}

type slice46Oracle struct {
	Groups map[string][]s46Case `json:"groups"`
}

// ── Case runners ─────────────────────────────────────────────────────────────

func pipelineCase(name string, spec s46Spec, seed int64) s46Case {
	c := s46Case{Name: name, Op: "pipeline", Spec: spec, Seed: seed}
	bg := context.Background()
	b := spec.build()
	for id, n := range b.byID {
		if _, ok := Candidates(b.g)[n]; ok {
			c.Candidates = append(c.Candidates, id)
		}
	}
	slices.Sort(c.Candidates)
	err := Assign(bg, b.g, nil, Candidates(b.g))
	c.Errors = append(c.Errors, s46Err(err))
	c.States = append(c.States, b.state())
	err = Place(bg, b.g, nil, s46Rand(seed))
	c.Errors = append(c.Errors, s46Err(err))
	c.States = append(c.States, b.state())
	RemoveIsolatedMemberships(b.g)
	c.States = append(c.States, b.state())
	return c
}

func stageCase(name, stage string, spec s46Spec, seed int64) s46Case {
	c := s46Case{Name: name, Op: "stage", Stage: stage, Spec: spec, Seed: seed}
	run := runStage(stage, spec, seed, context.Background(), limits.MaxTransactionWorkUnits)
	c.Error = s46Err(run.err)
	c.Changed = run.changed
	c.States = []s46State{run.pre, run.b.state()}
	c.W = run.used
	if c.W > 0 {
		below := runStage(stage, spec, seed, context.Background(), c.W-1)
		c.BelowErr = s46Err(below.err)
		c.BelowRestored = s46Equal(below.pre, below.b.state())
	}
	return c
}

func findRankW(spec s46Spec) uint64 {
	lo, hi := uint64(0), limits.MaxOptimizationWorkUnits
	for lo < hi {
		mid := lo + (hi-lo)/2
		if _, err := runRank(spec, context.Background(), mid); err == nil {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return lo
}

func rankCase(name string, spec s46Spec) s46Case {
	c := s46Case{Name: name, Op: "rank", Spec: spec}
	b := spec.build()
	result, err := rankDAG(context.Background(), b.g)
	c.Error = s46Err(err)
	if err == nil {
		for _, n := range b.nodes {
			if level, ok := result.nodeToLevel[n]; ok {
				c.Levels = append(c.Levels, [2]int64{int64(n.ID), int64(level)})
			}
		}
		c.LevelCount = result.levelCount
		w := findRankW(spec)
		c.W = int64(w)
		if w > 0 {
			_, below := runRank(spec, context.Background(), w-1)
			c.BelowErr = s46Err(below)
		}
	}
	return c
}

func simpleDAGCase(name string, spec s46Spec) s46Case {
	c := s46Case{Name: name, Op: "simpleDAG", Spec: spec}
	bg := context.Background()
	{
		b := spec.build()
		dag, err := makeSimpleDAG(bg, b.g)
		c.Error = s46Err(err)
		if err == nil {
			for _, n := range dag.Nodes {
				c.DagNodes = append(c.DagNodes, uint64(n.ID))
			}
			for _, e := range dag.Edges {
				c.DagEdges = append(c.DagEdges, [3]int64{int64(e.From.ID), int64(e.To.ID), int64(e.HierarchyRankWeight())})
			}
		}
	}
	{
		// findCycleEdges on the unsimplified arc graph (before reversal).
		b := spec.build()
		dag := layoutgraph.NewGraph()
		ids := map[layoutgraph.EntityID]*layoutgraph.Node{}
		for _, n := range b.g.Nodes {
			ids[n.ID] = dag.AddNode(layoutgraph.NewNode(n.ID, n.Width, n.Height))
		}
		connect := func(from, to *layoutgraph.Node) {
			e := dag.Connect(ids[from.ID], ids[to.ID])
			e.SourceArrowhead = layoutgraph.NoArrowhead
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
			e.ID = layoutgraph.EntityID(len(dag.Edges))
		}
		for _, e := range b.g.Edges {
			if !isHierarchyStructuralEdge(e) {
				continue
			}
			if e.IsDirected() {
				from, to, _ := e.DirectedEndpoints()
				connect(from, to)
			} else {
				connect(e.From, e.To)
				connect(e.To, e.From)
			}
		}
		cycles, err := findCycleEdges(bg, dag)
		if err != nil {
			panic(err)
		}
		for _, e := range dag.Edges {
			if _, ok := cycles[e]; ok {
				c.CycleEdges = append(c.CycleEdges, [2]uint64{uint64(e.From.ID), uint64(e.To.ID)})
			}
		}
	}
	return c
}

func s46LevelOrders(byLevel map[int][]*placementNode) [][]int64 {
	var out [][]int64
	for level := 0; level < len(byLevel); level++ {
		var row []int64
		for _, pn := range allDescendants(byLevel[level], false) {
			id := int64(0)
			if pn.graphNode != nil {
				id = int64(pn.graphNode.ID)
			}
			row = append(row, id, int64(pn.rank))
		}
		out = append(out, row)
	}
	return out
}

func s46LevelCrossings(byLevel map[int][]*placementNode) []int64 {
	var out []int64
	for level := 0; level < len(byLevel); level++ {
		var scratch crossingScratch
		out = append(out, countCrossings(scratch.crossLevelSegments(byLevel[level], false, true)))
	}
	return out
}

// orderCase runs the ordering phases of placeNodesInHierarchy on manually
// assigned hierarchy levels and records every level's order after each phase.
func orderCase(name string, spec s46Spec, seed int64) s46Case {
	c := s46Case{Name: name, Op: "order", Spec: spec, Seed: seed}
	b := spec.build()
	pns := createPlacementNodes(b.g, b.g.Nodes, s46Rand(seed))
	connectPlacementNodes(b.g, pns)
	byLevel := groupPlacementNodesByLevel(pns)
	initializeRanks(byLevel)
	breakLongConnections(pns, byLevel)
	c.Orders = append(c.Orders, s46LevelOrders(byLevel))
	c.Crossings = append(c.Crossings, s46LevelCrossings(byLevel)...)
	minimizeHierarchyCrossings(byLevel)
	c.Orders = append(c.Orders, s46LevelOrders(byLevel))
	c.Crossings = append(c.Crossings, s46LevelCrossings(byLevel)...)
	if err := globalSifting(byLevel); err != nil {
		c.Error = err.Error()
	}
	c.Orders = append(c.Orders, s46LevelOrders(byLevel))
	c.Crossings = append(c.Crossings, s46LevelCrossings(byLevel)...)
	return c
}

func probeCase(name, stage string, spec s46Spec, seed int64, maxProbes int) s46Case {
	c := s46Case{Name: name, Op: "probes", Stage: stage, Spec: spec, Seed: seed, Stride: 1}
	countCalls := func() int {
		count := &s46CountingContext{Context: context.Background()}
		if stage == "rank" {
			if _, err := runRank(spec, count, limits.MaxOptimizationWorkUnits); err != nil {
				panic(err)
			}
		} else if run := runStage(stage, spec, seed, count, limits.MaxTransactionWorkUnits); run.err != nil {
			panic(run.err)
		}
		return count.calls
	}
	c.Calls = countCalls()
	for i := 0; i < 8; i++ {
		if again := countCalls(); again != c.Calls {
			panic(fmt.Sprintf("%s: unstable Err call count %d vs %d", name, c.Calls, again))
		}
	}
	for c.Calls/c.Stride > maxProbes {
		c.Stride++
	}
	for cancelAt := 1; cancelAt <= c.Calls+1; cancelAt += c.Stride {
		ctx := &s46CountingContext{Context: context.Background(), cancelAt: cancelAt}
		if stage == "rank" {
			_, err := runRank(spec, ctx, limits.MaxOptimizationWorkUnits)
			c.Probes = append(c.Probes, s46Probe{CancelAt: cancelAt, Error: s46Err(err), Canceled: errors.Is(err, context.Canceled), Restored: true})
			continue
		}
		run := runStage(stage, spec, seed, ctx, limits.MaxTransactionWorkUnits)
		c.Probes = append(c.Probes, s46Probe{
			CancelAt: cancelAt, Error: s46Err(run.err), Canceled: errors.Is(run.err, context.Canceled),
			Restored: s46Equal(run.pre, run.b.state()),
		})
	}
	return c
}

func panicCase(name, stage string, spec s46Spec, seed int64, panicAt int) s46Case {
	c := s46Case{Name: name, Op: "panic", Stage: stage, Spec: spec, Seed: seed, PanicAt: panicAt}
	ctx := &s46CountingContext{Context: context.Background(), panicAt: panicAt}
	b := spec.build()
	g := b.g
	if stage == "place" {
		if err := Assign(context.Background(), g, nil, Candidates(g)); err != nil {
			panic(err)
		}
	}
	pre := b.state()
	func() {
		defer func() { c.Panic = fmt.Sprint(recover()) }()
		switch stage {
		case "assign":
			_ = Assign(ctx, g, nil, Candidates(g))
		case "place":
			_ = Place(ctx, g, nil, s46Rand(seed))
		case "compound":
			_, _ = PlaceCompound(ctx, g, s46Rand(seed))
		}
	}()
	c.Restored = s46Equal(pre, b.state())
	return c
}

// ── Scenarios ────────────────────────────────────────────────────────────────

func s46Directed(edges ...[2]uint64) []s46EdgeSpec {
	out := make([]s46EdgeSpec, 0, len(edges))
	for i, e := range edges {
		out = append(out, s46EdgeSpec{ID: uint64(i + 1), From: e[0], To: e[1], Dst: "triangle"})
	}
	return out
}

func s46Grid(count int, w, h float64) []s46NodeSpec {
	out := make([]s46NodeSpec, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, s46NodeSpec{ID: uint64(i + 1), W: w, H: h, X: float64(i) * 200, Y: float64(i%3) * 150})
	}
	return out
}

func s46RankSpec(count int, edges [][2]uint64, weights []int) s46Spec {
	spec := s46Spec{Nodes: s46Grid(count, 1, 1), Edges: s46Directed(edges...)}
	for i, w := range weights {
		if i < len(spec.Edges) {
			v := w
			spec.Edges[i].Weight = &v
		}
	}
	return spec
}

func s46ChainDiamond() s46Spec {
	return s46Spec{Nodes: s46Grid(6, 50, 40), Edges: s46Directed([2]uint64{1, 2}, [2]uint64{1, 3}, [2]uint64{2, 4}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{1, 6}, [2]uint64{6, 5})}
}

func s46ForcedChain() s46Spec {
	return s46Spec{RootHierarchy: true, Nodes: s46Grid(3, 60, 30), Edges: s46Directed([2]uint64{1, 2}, [2]uint64{2, 3})}
}

func s46Crossing() s46Spec {
	// Two sources fan into four middle nodes in a crossing pattern, then sink.
	return s46Spec{RootHierarchy: true, Nodes: s46Grid(8, 40, 30), Edges: s46Directed(
		[2]uint64{1, 6}, [2]uint64{1, 4}, [2]uint64{2, 3}, [2]uint64{2, 5},
		[2]uint64{3, 7}, [2]uint64{4, 8}, [2]uint64{5, 7}, [2]uint64{6, 8}, [2]uint64{1, 5}, [2]uint64{2, 6},
	)}
}

func s46LongEdges() s46Spec {
	spec := s46Spec{RootHierarchy: true, Nodes: s46Grid(5, 70, 40), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{1, 5}, [2]uint64{1, 4},
	)}
	spec.Edges[4].LabelW, spec.Edges[4].LabelH = 80, 24
	spec.Edges[0].LabelW, spec.Edges[0].LabelH = 40, 70
	return spec
}

func s46ContainerHierarchy() s46Spec {
	return s46Spec{Nodes: []s46NodeSpec{
		{ID: 1, W: 60, H: 40, X: 0, Y: 0},
		{ID: 2, W: 300, H: 200, X: 200, Y: 0},
		{ID: 3, W: 60, H: 40, X: 230, Y: 60, Container: 2},
		{ID: 4, W: 60, H: 40, X: 330, Y: 60, Container: 2},
		{ID: 5, W: 60, H: 40, X: 600, Y: 0},
		{ID: 6, W: 60, H: 40, X: 800, Y: 0},
		{ID: 7, W: 60, H: 40, X: 1000, Y: 0},
	}, Edges: s46Directed([2]uint64{1, 3}, [2]uint64{1, 4}, [2]uint64{3, 5}, [2]uint64{4, 5}, [2]uint64{5, 6}, [2]uint64{1, 7}, [2]uint64{7, 5})}
}

func s46Compound(direction string) s46Spec {
	spec := s46Spec{}
	for i := 0; i < 6; i++ {
		spec.Nodes = append(spec.Nodes, s46NodeSpec{ID: uint64(i + 1), W: 120, H: 90, X: float64(i) * 400, Y: 300})
	}
	spec.Nodes[3].W, spec.Nodes[3].H = 300, 220
	spec.Nodes = append(spec.Nodes,
		s46NodeSpec{ID: 7, W: 80, H: 50, X: 1200 + 40, Y: 300 + 60, Container: 4},
		s46NodeSpec{ID: 8, W: 80, H: 50, X: 1200 + 40 + 120, Y: 300 + 60 + 60, Container: 4},
	)
	spec.Edges = s46Directed([2]uint64{1, 3}, [2]uint64{1, 4}, [2]uint64{2, 4}, [2]uint64{3, 5}, [2]uint64{4, 6}, [2]uint64{7, 8}, [2]uint64{8, 6})
	spec.Directions = []s46DirectionSpec{{Container: 4, Direction: "Right"}}
	if direction != "" {
		spec.Directions = append(spec.Directions, s46DirectionSpec{Container: 0, Direction: direction})
	}
	spec.Hierarchies = []s46HierarchySpec{{Members: [][2]int64{{7, 0}, {8, 1}}, LevelCount: 2}}
	return spec
}

func s46Disconnected() s46Spec {
	return s46Spec{Nodes: []s46NodeSpec{
		{ID: 1, W: 40, H: 40, X: 0, Y: 0}, {ID: 2, W: 40, H: 40, X: 100, Y: 0}, {ID: 3, W: 40, H: 40, X: 200, Y: 0},
		{ID: 4, W: 40, H: 40, X: 300, Y: 0}, {ID: 5, W: 40, H: 40, X: 400, Y: 0}, {ID: 6, W: 40, H: 40, X: 500, Y: 0},
		{ID: 7, W: 40, H: 40, X: 600, Y: 0},
		{ID: 8, W: 80, H: 120, X: 700, Y: 0, Shape: "Table", Columns: 3},
		{ID: 9, W: 300, H: 300, X: 900, Y: 0, Shape: "Circle"},
		{ID: 10, W: 40, H: 40, X: 950, Y: 50, Container: 9},
		{ID: 11, W: 300, H: 300, X: 1300, Y: 0, Shape: "Package"},
		{ID: 12, W: 40, H: 40, X: 1350, Y: 50, Container: 11},
		{ID: 13, W: 40, H: 40, X: 1450, Y: 50, Container: 11},
	}, Edges: append(s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{5, 6}, [2]uint64{2, 4},
	), s46EdgeSpec{ID: 7, From: 12, To: 13, Dst: "triangle"}, s46EdgeSpec{ID: 8, From: 7, To: 7, Dst: "triangle"}),
		Nears: [][2]uint64{{1, 7}, {7, 8}}}
}

func s46Tables() s46Spec {
	zero, one, two := 0, 1, 2
	spec := s46Spec{RootHierarchy: true, Nodes: []s46NodeSpec{
		{ID: 1, W: 100, H: 120, X: 0, Y: 0, Shape: "Table", Columns: 3},
		{ID: 2, W: 100, H: 90, X: 300, Y: 0, Shape: "Table", Columns: 2},
		{ID: 3, W: 100, H: 120, X: 600, Y: 0, Shape: "Table", Columns: 3},
		{ID: 4, W: 50, H: 40, X: 900, Y: 0},
	}}
	spec.Edges = []s46EdgeSpec{
		{ID: 1, From: 1, To: 2, Dst: "triangle", FromCol: &two, ToCol: &zero},
		{ID: 2, From: 2, To: 3, Dst: "triangle", FromCol: &one, ToCol: &one},
		{ID: 3, From: 1, To: 3, Dst: "triangle", FromCol: &zero, ToCol: &two},
		{ID: 4, From: 3, To: 4, Dst: "triangle"},
	}
	return spec
}

func s46Mixed(seed int64) s46Spec {
	rng := rand.New(rand.NewSource(seed))
	count := 7 + rng.Intn(4)
	spec := s46Spec{RootHierarchy: rng.Intn(2) == 0, Nodes: s46Grid(count, float64(30+rng.Intn(50)), float64(20+rng.Intn(40)))}
	id := uint64(0)
	add := func(from, to uint64, src, dst string) {
		id++
		spec.Edges = append(spec.Edges, s46EdgeSpec{ID: id, From: from, To: to, Src: src, Dst: dst})
	}
	for i := 2; i <= count; i++ {
		add(uint64(rng.Intn(i-1)+1), uint64(i), "", "triangle")
	}
	for i := 0; i < 2; i++ {
		a, b := uint64(rng.Intn(count)+1), uint64(rng.Intn(count)+1)
		if a != b {
			add(b, a, "", "triangle")
		}
	}
	return spec
}

// s46Random builds a larger random layered graph with optional containers,
// labels, mixed arrowheads, back edges, and long edges.
func s46Random(seed int64) s46Spec {
	rng := rand.New(rand.NewSource(seed))
	count := 8 + rng.Intn(9)
	spec := s46Spec{RootHierarchy: rng.Intn(3) != 0}
	for i := 0; i < count; i++ {
		spec.Nodes = append(spec.Nodes, s46NodeSpec{ID: uint64(i + 1), W: float64(20 + rng.Intn(80)), H: float64(20 + rng.Intn(60)), X: float64(i) * 250, Y: float64(rng.Intn(4)) * 120})
	}
	next := uint64(count)
	containers := rng.Intn(3)
	var children []uint64
	for c := 0; c < containers; c++ {
		parent := uint64(rng.Intn(count) + 1)
		if spec.Nodes[parent-1].Container != 0 {
			continue
		}
		spec.Nodes[parent-1].W, spec.Nodes[parent-1].H = 400, 300
		for k := 0; k < 2+rng.Intn(2); k++ {
			next++
			p := spec.Nodes[parent-1]
			spec.Nodes = append(spec.Nodes, s46NodeSpec{ID: next, W: 40, H: 30, X: p.X + 30 + float64(k)*90, Y: p.Y + 40, Container: parent})
			children = append(children, next)
		}
	}
	isContainer := map[uint64]bool{}
	for _, n := range spec.Nodes {
		if n.Container != 0 {
			isContainer[n.Container] = true
		}
	}
	var leaves []uint64
	for _, n := range spec.Nodes {
		if !isContainer[n.ID] {
			leaves = append(leaves, n.ID)
		}
	}
	id := uint64(0)
	seen := map[[2]uint64]bool{}
	add := func(from, to uint64) {
		if from == to || seen[[2]uint64{from, to}] {
			return
		}
		seen[[2]uint64{from, to}] = true
		id++
		e := s46EdgeSpec{ID: id, From: from, To: to, Dst: "triangle"}
		switch rng.Intn(12) {
		case 0:
			e.Dst = ""
		case 1:
			e.Src = "triangle"
		case 2:
			e.Src, e.Dst = "triangle", ""
		}
		if rng.Intn(5) == 0 {
			e.LabelW, e.LabelH = float64(20+rng.Intn(60)), float64(10+rng.Intn(30))
		}
		spec.Edges = append(spec.Edges, e)
	}
	for i := 1; i < len(leaves); i++ {
		add(leaves[rng.Intn(i)], leaves[i])
	}
	for i := 0; i < len(leaves)/3; i++ {
		add(leaves[rng.Intn(len(leaves))], leaves[rng.Intn(len(leaves))])
	}
	if len(children) > 0 && rng.Intn(2) == 0 {
		add(children[0], leaves[rng.Intn(len(leaves))])
	}
	if rng.Intn(2) == 0 {
		spec.Directions = []s46DirectionSpec{{Container: 0, Direction: []string{"Top", "Bottom", "Left", "Right"}[rng.Intn(4)]}}
	}
	return spec
}

func s46ManualOrder(levels [][]uint64, edges [][2]uint64) s46Spec {
	spec := s46Spec{}
	h := s46HierarchySpec{LevelCount: len(levels)}
	for level, ids := range levels {
		for i, id := range ids {
			spec.Nodes = append(spec.Nodes, s46NodeSpec{ID: id, W: 40, H: 30, X: float64(i) * 100, Y: float64(level) * 100})
			h.Members = append(h.Members, [2]int64{int64(id), int64(level)})
		}
	}
	spec.Edges = s46Directed(edges...)
	spec.Hierarchies = []s46HierarchySpec{h}
	return spec
}

func generateSlice46Oracle() slice46Oracle {
	groups := map[string][]s46Case{}
	add := func(group string, c s46Case) { groups[group] = append(groups[group], c) }

	// simple DAG
	add("simple DAG", pipelineCase("chain-diamond", s46ChainDiamond(), 1))
	add("simple DAG", pipelineCase("forced-chain", s46ForcedChain(), 2))
	add("simple DAG", pipelineCase("forced-chain-horizontal", func() s46Spec {
		s := s46ForcedChain()
		s.Directions = []s46DirectionSpec{{Container: 0, Direction: "Right"}}
		return s
	}(), 2))
	add("simple DAG", pipelineCase("forced-chain-up", func() s46Spec {
		s := s46ForcedChain()
		s.Directions = []s46DirectionSpec{{Container: 0, Direction: "Top"}}
		return s
	}(), 2))
	add("simple DAG", pipelineCase("forced-chain-left", func() s46Spec {
		s := s46ForcedChain()
		s.Directions = []s46DirectionSpec{{Container: 0, Direction: "Left"}}
		return s
	}(), 2))
	add("simple DAG", rankCase("rank-chain", s46RankSpec(4, [][2]uint64{{1, 2}, {2, 3}, {3, 4}}, nil)))
	add("simple DAG", rankCase("rank-optimal-7", s46RankSpec(5, [][2]uint64{{1, 2}, {1, 3}, {1, 5}, {2, 4}, {3, 4}, {3, 5}}, nil)))
	add("simple DAG", rankCase("rank-empty", s46Spec{}))
	add("simple DAG", rankCase("rank-single", s46RankSpec(1, nil, nil)))
	for seed := int64(0); seed < 4; seed++ {
		add("simple DAG", pipelineCase(fmt.Sprintf("mixed-%d", seed), s46Mixed(4600+seed), seed+1))
	}

	// multiple valid ranks
	add("multiple valid ranks", rankCase("normalized-optimum", s46RankSpec(5, [][2]uint64{{1, 2}, {2, 3}, {3, 4}, {1, 5}, {5, 4}}, nil)))
	add("multiple valid ranks", rankCase("simplex-exchange", s46RankSpec(4, [][2]uint64{{1, 4}, {2, 3}, {3, 4}}, nil)))
	add("multiple valid ranks", rankCase("basis-tie", s46RankSpec(6, [][2]uint64{{1, 2}, {3, 4}, {5, 1}, {5, 4}, {6, 2}, {6, 3}}, nil)))
	add("multiple valid ranks", rankCase("weighted-certificate", s46RankSpec(4, [][2]uint64{{1, 2}, {1, 3}, {1, 4}, {2, 4}, {3, 4}}, []int{2, 1, 1, 1, 3})))
	add("multiple valid ranks", rankCase("bland-degenerate", s46RankSpec(5, [][2]uint64{{1, 2}, {1, 3}, {2, 4}, {2, 5}, {3, 4}, {3, 5}}, []int{1, 1, 1, 1, 2, 2})))
	add("multiple valid ranks", rankCase("parallel-weight", s46RankSpec(5, [][2]uint64{{1, 2}, {2, 3}, {3, 4}, {1, 5}, {5, 4}}, []int{1, 1, 1, 1, 10})))
	{
		// many exchanges: a layered grid with long skip edges and varied weights.
		width, height := 5, 6
		var edges [][2]uint64
		var weights []int
		node := func(layer, column int) uint64 { return uint64(layer*width + column + 1) }
		for layer := 0; layer+1 < height; layer++ {
			for column := 0; column < width; column++ {
				edges = append(edges, [2]uint64{node(layer, column), node(layer+1, column)})
			}
		}
		for span := 2; span < height && len(edges) < 60; span++ {
			for layer := 0; layer+span < height && len(edges) < 60; layer++ {
				for column := 0; column < width && len(edges) < 60; column++ {
					edges = append(edges, [2]uint64{node(layer, column), node(layer+span, (column+span-1)%width)})
				}
			}
		}
		for i, e := range edges {
			weights = append(weights, 1+int(e[0]*31+e[1]*17+uint64(i))%97)
		}
		add("multiple valid ranks", rankCase("many-exchanges", s46RankSpec(width*height, edges, weights)))
	}
	add("multiple valid ranks", pipelineCase("parallel-branches", s46Spec{Nodes: s46Grid(7, 50, 30), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{1, 6}, [2]uint64{6, 7}, [2]uint64{7, 5},
	)}, 3))
	add("multiple valid ranks", rankCase("invalid-weight", s46RankSpec(2, [][2]uint64{{1, 2}}, []int{0})))
	add("multiple valid ranks", rankCase("cyclic", s46RankSpec(3, [][2]uint64{{1, 2}, {2, 3}, {3, 1}}, nil)))
	add("multiple valid ranks", rankCase("disconnected", s46RankSpec(2, nil, nil)))
	add("multiple valid ranks", rankCase("undirected", func() s46Spec {
		s := s46RankSpec(2, [][2]uint64{{1, 2}}, nil)
		s.Edges[0].Dst = ""
		return s
	}()))
	add("multiple valid ranks", rankCase("duplicate-pair", s46RankSpec(2, [][2]uint64{{1, 2}, {1, 2}}, nil)))

	// long edges
	add("long edges", pipelineCase("skip-levels", s46LongEdges(), 5))
	add("long edges", pipelineCase("skip-levels-horizontal", func() s46Spec {
		s := s46LongEdges()
		s.Directions = []s46DirectionSpec{{Container: 0, Direction: "Right"}}
		return s
	}(), 5))
	add("long edges", orderCase("order-long", s46ManualOrder(
		[][]uint64{{1, 2}, {3, 4}, {5}, {6, 7}},
		[][2]uint64{{1, 3}, {2, 4}, {1, 6}, {2, 7}, {3, 5}, {4, 5}, {5, 6}, {2, 6}, {1, 7}},
	), 7))
	add("long edges", pipelineCase("tables", s46Tables(), 3))

	// crossings
	add("crossings", pipelineCase("crossing-fan", s46Crossing(), 1))
	add("crossings", orderCase("order-k33", s46ManualOrder(
		[][]uint64{{1, 2, 3}, {4, 5, 6}, {7, 8}},
		[][2]uint64{{1, 6}, {2, 4}, {3, 5}, {1, 5}, {3, 4}, {4, 8}, {5, 7}, {6, 7}, {6, 8}},
	), 11))
	add("crossings", orderCase("order-k33-unshuffled", s46ManualOrder(
		[][]uint64{{1, 2, 3}, {4, 5, 6}, {7, 8}},
		[][2]uint64{{1, 6}, {2, 4}, {3, 5}, {1, 5}, {3, 4}, {4, 8}, {5, 7}, {6, 7}, {6, 8}},
	), -1))
	add("crossings", orderCase("order-wide", s46ManualOrder(
		[][]uint64{{1, 2, 3, 4, 5}, {6, 7, 8, 9, 10}, {11, 12, 13}},
		[][2]uint64{{1, 10}, {2, 9}, {3, 8}, {4, 7}, {5, 6}, {1, 6}, {6, 13}, {7, 12}, {8, 11}, {9, 11}, {10, 12}, {3, 6}},
	), 4))

	for seed := int64(0); seed < 24; seed++ {
		add("crossings", pipelineCase(fmt.Sprintf("random-%d", seed), s46Random(46_000+seed), seed))
	}

	// fixed hierarchy
	add("fixed hierarchy", pipelineCase("fixed-member-excluded", func() s46Spec {
		s := s46ChainDiamond()
		s.Nodes[3].Fixed = true
		return s
	}(), 1))
	add("fixed hierarchy", pipelineCase("fixed-descendant-container", func() s46Spec {
		s := s46ContainerHierarchy()
		s.Nodes[2].Fixed = true
		return s
	}(), 1))
	add("fixed hierarchy", stageCase("fixed-member-place-noop", "placeOnly", func() s46Spec {
		s := s46ManualOrder([][]uint64{{1}, {2}, {3}}, [][2]uint64{{1, 2}, {2, 3}})
		s.Nodes[1].Fixed = true
		return s
	}(), 1))

	// compound hierarchy
	for _, direction := range []string{"", "Top", "Left", "Right"} {
		add("compound hierarchy", stageCase("compound-"+direction, "compound", s46Compound(direction), 1))
	}
	add("compound hierarchy", stageCase("compound-fixed-descendant", "compound", func() s46Spec {
		s := s46Compound("")
		s.Nodes[6].Fixed = true
		return s
	}(), 1))
	add("compound hierarchy", stageCase("compound-disconnected", "compound", func() s46Spec {
		s := s46Compound("")
		s.Nodes = append(s.Nodes, s46NodeSpec{ID: 9, W: 50, H: 50, X: 3000, Y: 0})
		return s
	}(), 1))
	add("compound hierarchy", stageCase("compound-no-internal-edges", "compound", func() s46Spec {
		s := s46Compound("")
		s.Edges = s.Edges[:5]
		s.Edges = append(s.Edges, s46EdgeSpec{ID: 7, From: 8, To: 6, Dst: "triangle"})
		return s
	}(), 1))
	add("compound hierarchy", pipelineCase("container-hierarchy", s46ContainerHierarchy(), 2))
	add("compound hierarchy", pipelineCase("container-internal-edge", func() s46Spec {
		s := s46ContainerHierarchy()
		s.Edges = append(s.Edges, s46EdgeSpec{ID: 8, From: 3, To: 4, Dst: "triangle"})
		return s
	}(), 2))

	// disconnected candidates
	add("disconnected candidates", pipelineCase("components-and-isolated", s46Disconnected(), 1))
	add("disconnected candidates", pipelineCase("components-and-isolated-forced", func() s46Spec {
		s := s46Disconnected()
		s.RootHierarchy = true
		return s
	}(), 1))
	add("disconnected candidates", pipelineCase("workflow-and-chain", s46Spec{Nodes: s46Grid(9, 30, 30), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{1, 3}, [2]uint64{2, 4}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{6, 7}, [2]uint64{7, 8},
	)}, 1))
	add("disconnected candidates", pipelineCase("two-forced-components", s46Spec{RootHierarchy: true, Nodes: s46Grid(6, 20, 20), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{4, 5}, [2]uint64{5, 6},
	)}, 1))

	// cycle handling
	add("cycle handling", simpleDAGCase("triangle-cycle", s46Spec{Nodes: s46Grid(3, 10, 10), Edges: s46Directed([2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 1})}))
	add("cycle handling", simpleDAGCase("two-cycles", s46Spec{Nodes: s46Grid(6, 10, 10), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 1}, [2]uint64{3, 4}, [2]uint64{4, 5}, [2]uint64{5, 6}, [2]uint64{6, 4},
	)}))
	add("cycle handling", simpleDAGCase("mixed-arrows", s46Spec{Nodes: s46Grid(4, 10, 10), Edges: []s46EdgeSpec{
		{ID: 1, From: 1, To: 2, Dst: "triangle"},
		{ID: 2, From: 2, To: 3},
		{ID: 3, From: 3, To: 4, Src: "triangle", Dst: "triangle"},
		{ID: 4, From: 4, To: 1, Src: "triangle"},
		{ID: 5, From: 1, To: 2, Dst: "triangle"},
		{ID: 6, From: 3, To: 3, Dst: "triangle"},
	}}))
	add("cycle handling", pipelineCase("cyclic-workflow", s46Spec{Nodes: s46Grid(5, 40, 30), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 4}, [2]uint64{4, 2}, [2]uint64{4, 5},
	)}, 1))
	add("cycle handling", pipelineCase("cyclic-wide", s46Spec{Nodes: s46Grid(7, 40, 30), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{1, 3}, [2]uint64{1, 4}, [2]uint64{2, 5}, [2]uint64{3, 5}, [2]uint64{4, 6}, [2]uint64{5, 7}, [2]uint64{6, 7}, [2]uint64{6, 4}, [2]uint64{3, 6},
	)}, 1))
	add("cycle handling", pipelineCase("bidirectional-mix", s46Spec{Nodes: s46Grid(6, 40, 30), Edges: append(s46Directed(
		[2]uint64{1, 2}, [2]uint64{1, 3}, [2]uint64{2, 4}, [2]uint64{3, 4}, [2]uint64{4, 5},
	), s46EdgeSpec{ID: 6, From: 5, To: 6, Src: "triangle", Dst: "triangle"}, s46EdgeSpec{ID: 7, From: 2, To: 3}, s46EdgeSpec{ID: 8, From: 6, To: 6, Dst: "triangle"})}, 1))
	add("cycle handling", pipelineCase("forced-cycle", s46Spec{RootHierarchy: true, Nodes: s46Grid(4, 40, 30), Edges: s46Directed(
		[2]uint64{1, 2}, [2]uint64{2, 3}, [2]uint64{3, 4}, [2]uint64{4, 1},
	)}, 1))

	// resource boundary: exact W and W-1 for every exposed limit.
	add("resource boundary", stageCase("assign-chain-diamond", "assign", s46ChainDiamond(), 1))
	add("resource boundary", stageCase("place-chain-diamond", "place", s46ChainDiamond(), 1))
	add("resource boundary", stageCase("assign-containers", "assign", s46ContainerHierarchy(), 1))
	add("resource boundary", stageCase("place-containers", "place", s46ContainerHierarchy(), 1))
	add("resource boundary", stageCase("place-tables", "place", s46Tables(), 2))
	add("resource boundary", stageCase("compound-bottom", "compound", s46Compound(""), 1))
	add("resource boundary", rankCase("rank-diamond", s46RankSpec(4, [][2]uint64{{1, 2}, {1, 3}, {2, 4}, {3, 4}}, nil)))

	// cancellation probes
	add("cancellation probes", probeCase("assign-chain-diamond", "assign", s46ChainDiamond(), 1, 400))
	add("cancellation probes", probeCase("place-chain-diamond", "place", s46ChainDiamond(), 1, 400))
	add("cancellation probes", probeCase("place-containers", "place", s46ContainerHierarchy(), 1, 300))
	add("cancellation probes", probeCase("compound-bottom", "compound", s46Compound(""), 1, 400))
	add("cancellation probes", probeCase("place-random-0", "place", s46Random(46_000), 0, 300))
	add("cancellation probes", probeCase("assign-random-9", "assign", s46Random(46_009), 9, 300))
	add("cancellation probes", probeCase("place-tables", "place", s46Tables(), 2, 300))
	add("cancellation probes", probeCase("rank-optimal-7", "rank", s46RankSpec(5, [][2]uint64{{1, 2}, {1, 3}, {1, 5}, {2, 4}, {3, 4}, {3, 5}}, nil), 0, 400))

	// panic rollback
	for _, at := range []int{5, 40} {
		add("panic rollback", panicCase(fmt.Sprintf("assign-%d", at), "assign", s46ChainDiamond(), 1, at))
		add("panic rollback", panicCase(fmt.Sprintf("place-%d", at), "place", s46ChainDiamond(), 1, at))
		add("panic rollback", panicCase(fmt.Sprintf("compound-%d", at), "compound", s46Compound(""), 1, at))
	}

	// seeded determinism
	for _, seed := range []int64{-1, 1, 2, 46} {
		add("seeded determinism", pipelineCase(fmt.Sprintf("crossing-seed-%d", seed), s46Crossing(), seed))
		add("seeded determinism", orderCase(fmt.Sprintf("order-seed-%d", seed), s46ManualOrder(
			[][]uint64{{1, 2, 3, 4}, {5, 6, 7, 8}},
			[][2]uint64{{1, 8}, {2, 7}, {3, 6}, {4, 5}, {1, 5}, {4, 8}},
		), seed))
	}
	return slice46Oracle{Groups: groups}
}

func TestGenerateSlice46HierarchyOracle(t *testing.T) {
	oracle := generateSlice46Oracle()
	// Every value must be reproducible despite Go's randomized map order.
	for i := 0; i < 3; i++ {
		if again := generateSlice46Oracle(); !s46Equal(oracle, again) {
			t.Fatal("Slice 46 hierarchy oracle is nondeterministic")
		}
	}
	for _, name := range []string{
		"simple DAG", "multiple valid ranks", "long edges", "crossings", "fixed hierarchy",
		"compound hierarchy", "disconnected candidates", "cycle handling", "resource boundary",
		"cancellation probes", "panic rollback", "seeded determinism",
	} {
		if len(oracle.Groups[name]) == 0 {
			t.Fatalf("oracle group %q is empty", name)
		}
	}
	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice46-hierarchy-reference.json")
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
		t.Fatal("go-slice46-hierarchy-reference.json is stale; regenerate with TALA_SLICE46_ORACLE=1")
	}
}
