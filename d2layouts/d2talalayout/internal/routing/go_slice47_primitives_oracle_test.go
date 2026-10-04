package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/labeling"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 47 routing-primitives oracle. With TALA_SLICE47_ORACLE=1 the test
// rewrites js/test/fixtures/go-slice47-primitives-reference.json; otherwise
// it recomputes every value and asserts the committed fixture is
// byte-identical (after normalizing CRLF line endings).
//
// Every case carries its own inputs (graph specs, scripts, arguments) so the
// JS replay rebuilds exactly the same structures.

const (
	s47pLocation        = "Slice47Primitives"
	s47pBigLimit uint64 = 1 << 40
)

// s47pF encodes float64 values JSON-safely: NaN, +/-Inf and negative zero are
// strings so JS can reconstruct the exact IEEE value.
type s47pF float64

func (f s47pF) MarshalJSON() ([]byte, error) {
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

type s47pPt = *[2]s47pF

func s47pP(x, y float64) s47pPt { return &[2]s47pF{s47pF(x), s47pF(y)} }

func s47pPts(coords ...float64) []s47pPt {
	out := make([]s47pPt, 0, len(coords)/2)
	for i := 0; i+1 < len(coords); i += 2 {
		out = append(out, s47pP(coords[i], coords[i+1]))
	}
	return out
}

// ─── Graph specs ─────────────────────────────────────────────────────────────

type s47pLabel struct {
	Text string `json:"text"`
	W    s47pF  `json:"w"`
	H    s47pF  `json:"h"`
	Pos  int    `json:"pos"`
}

type s47pNodeSpec struct {
	ID         int64  `json:"id"`
	W          s47pF  `json:"w"`
	H          s47pF  `json:"h"`
	X          s47pF  `json:"x"`
	Y          s47pF  `json:"y"`
	Unplaced   bool   `json:"unplaced,omitempty"`
	Shape      string `json:"shape,omitempty"`
	Container  int64  `json:"container,omitempty"`
	Is3D       bool   `json:"is3d,omitempty"`
	Multiple   bool   `json:"multiple,omitempty"`
	NotInGraph bool   `json:"notInGraph,omitempty"`
}

type s47pEdgeSpec struct {
	From       int64      `json:"from"`
	To         int64      `json:"to"`
	Points     []s47pPt   `json:"points"`
	NilPoints  bool       `json:"nilPoints,omitempty"`
	Src        string     `json:"src,omitempty"`
	Dst        string     `json:"dst,omitempty"`
	Label      *s47pLabel `json:"label,omitempty"`
	SrcLabel   *s47pLabel `json:"srcLabel,omitempty"`
	DstLabel   *s47pLabel `json:"dstLabel,omitempty"`
	FromCol    *int       `json:"fromCol,omitempty"`
	ToCol      *int       `json:"toCol,omitempty"`
	Stroke     string     `json:"stroke,omitempty"`
	Curve      bool       `json:"curve,omitempty"`
	NotInGraph bool       `json:"notInGraph,omitempty"`
}

type s47pClusterSpec struct {
	Vessel      int64   `json:"vessel"`
	Nodes       []int64 `json:"nodes"`
	Arrangement string  `json:"arrangement"`
	Desired     string  `json:"desired"`
}

type s47pSpec struct {
	Nodes    []s47pNodeSpec    `json:"nodes"`
	Edges    []s47pEdgeSpec    `json:"edges"`
	Clusters []s47pClusterSpec `json:"clusters,omitempty"`
	Trees    []int64           `json:"trees,omitempty"`
	NilNode  bool              `json:"nilNode,omitempty"`
	NilEdge  bool              `json:"nilEdge,omitempty"`
}

type s47pGraph struct {
	g      *layoutgraph.Graph
	nodes  map[int64]*layoutgraph.Node
	edges  []*layoutgraph.Edge
	ids    map[*geo.Point]int
	nextID int
}

func (sg *s47pGraph) pointID(p *geo.Point) int {
	if p == nil {
		return -1
	}
	if id, ok := sg.ids[p]; ok {
		return id
	}
	id := sg.nextID
	sg.nextID++
	sg.ids[p] = id
	return id
}

func s47pNewLabel(spec *s47pLabel) *layoutgraph.Label {
	if spec == nil {
		return nil
	}
	return &layoutgraph.Label{Text: spec.Text, Width: float64(spec.W), Height: float64(spec.H), Position: label.Position(spec.Pos)}
}

func (spec s47pSpec) build() *s47pGraph {
	sg := &s47pGraph{g: layoutgraph.NewGraph(), nodes: map[int64]*layoutgraph.Node{}, ids: map[*geo.Point]int{}}
	g := sg.g
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
		n.SetShape(ns.Shape)
		if !ns.Unplaced {
			n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
		sg.nodes[ns.ID] = n
		if ns.NotInGraph {
			n.Graph = g
			continue
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = sg.nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
	}
	for _, es := range spec.Edges {
		from, to := sg.nodes[es.From], sg.nodes[es.To]
		var e *layoutgraph.Edge
		if es.NotInGraph {
			e = layoutgraph.NewEdge(from, to)
		} else {
			e = g.Connect(from, to)
		}
		if es.NilPoints {
			e.Points = nil
		} else {
			e.Points = make([]*geo.Point, len(es.Points))
			for i, p := range es.Points {
				if p != nil {
					e.Points[i] = geo.NewPoint(float64(p[0]), float64(p[1]))
					sg.pointID(e.Points[i])
				}
			}
		}
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		e.Label = s47pNewLabel(es.Label)
		e.SourceArrowheadLabel = s47pNewLabel(es.SrcLabel)
		e.TargetArrowheadLabel = s47pNewLabel(es.DstLabel)
		if es.FromCol != nil {
			v := *es.FromCol
			e.FromTableColumnIndex = &v
		}
		if es.ToCol != nil {
			v := *es.ToCol
			e.ToTableColumnIndex = &v
		}
		if es.Stroke != "" {
			e.Style.Stroke = &layoutgraph.StyleScalar{Value: es.Stroke}
		}
		e.IsCurve = es.Curve
		sg.edges = append(sg.edges, e)
	}
	for _, cs := range spec.Clusters {
		cluster := &layoutgraph.Cluster{
			Vessel:             sg.nodes[cs.Vessel],
			Arrangement:        layoutgraph.ClusterArrangement(cs.Arrangement),
			DesiredArrangement: layoutgraph.ClusterArrangement(cs.Desired),
			Graph:              g,
		}
		for _, id := range cs.Nodes {
			cluster.Nodes = append(cluster.Nodes, sg.nodes[id])
			sg.nodes[id].Cluster = cluster
		}
		g.Clusters[cluster.Vessel] = cluster
	}
	if len(spec.Trees) > 0 && g.NodeToTree == nil {
		g.NodeToTree = map[*layoutgraph.Node]*layoutgraph.Tree{}
	}
	for _, id := range spec.Trees {
		g.NodeToTree[sg.nodes[id]] = &layoutgraph.Tree{}
	}
	if spec.NilNode {
		g.Nodes = append(g.Nodes, nil)
	}
	if spec.NilEdge {
		g.Edges = append(g.Edges, nil)
	}
	return sg
}

func (sg *s47pGraph) edgeList(indices []int) []*layoutgraph.Edge {
	out := make([]*layoutgraph.Edge, 0, len(indices))
	for _, index := range indices {
		if index < 0 {
			out = append(out, nil)
			continue
		}
		out = append(out, sg.edges[index])
	}
	return out
}

func (sg *s47pGraph) nodeList(ids []int64) []*layoutgraph.Node {
	out := make([]*layoutgraph.Node, 0, len(ids))
	for _, id := range ids {
		out = append(out, sg.nodes[id])
	}
	return out
}

func (sg *s47pGraph) edgeIndex(edge *layoutgraph.Edge) int {
	for i, e := range sg.edges {
		if e == edge {
			return i
		}
	}
	return -1
}

func s47pEncPoint(p *geo.Point) any {
	if p == nil {
		return nil
	}
	return []s47pF{s47pF(p.X), s47pF(p.Y)}
}

// route encodes [pointID, x, y] per route point (nil points as null).
func (sg *s47pGraph) route(points []*geo.Point) [][]any {
	out := make([][]any, 0, len(points))
	for _, p := range points {
		if p == nil {
			out = append(out, nil)
			continue
		}
		out = append(out, []any{sg.pointID(p), s47pF(p.X), s47pF(p.Y)})
	}
	return out
}

type s47pState struct {
	Cell  s47pF   `json:"cell"`
	Costs []s47pF `json:"costs"`
	Nodes []any   `json:"nodes"`
	Edges []any   `json:"edges"`
}

// state serializes everything a route stage may roll back.
func (sg *s47pGraph) state() s47pState {
	g := sg.g
	costs := g.RoutingCosts()
	st := s47pState{
		Cell:  s47pF(g.CellSize),
		Costs: []s47pF{s47pF(costs.Crossing), s47pF(costs.Turn), s47pF(costs.NonCenterPort)},
		Nodes: []any{},
		Edges: []any{},
	}
	ids := make([]int64, 0, len(sg.nodes))
	for id := range sg.nodes {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		n := sg.nodes[id]
		st.Nodes = append(st.Nodes, []any{id, s47pEncPoint(n.TopLeft), n.Graph == g})
	}
	for _, e := range sg.edges {
		var lbl any
		if e.Label != nil {
			lbl = []any{s47pF(e.Label.Width), s47pF(e.Label.Height), int(e.Label.Position)}
		}
		st.Edges = append(st.Edges, map[string]any{
			"route": sg.route(e.Points),
			"nil":   e.Points == nil,
			"label": lbl,
			"curve": e.IsCurve,
		})
	}
	return st
}

// ─── Guard runs ──────────────────────────────────────────────────────────────

type s47pCountingContext struct {
	context.Context
	calls    int
	cancelAt int
}

func (ctx *s47pCountingContext) Err() error {
	ctx.calls++
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

type s47pRun struct {
	Value any    `json:"value"`
	Used  uint64 `json:"used"`
	Err   string `json:"err"`
}

type s47pCancelRun struct {
	At   int    `json:"at"`
	Used uint64 `json:"used"`
	Err  string `json:"err"`
}

type s47pSweep struct {
	Full   s47pRun         `json:"full"`
	Under  *s47pRun        `json:"under,omitempty"`
	Cancel []s47pCancelRun `json:"cancel"`
}

type s47pOp func(guard *routeWorkGuard) (any, error)

func s47pGuardRun(ctx context.Context, limit uint64, op s47pOp) s47pRun {
	guard, err := newRouteWorkGuard(ctx, s47pLocation, limit)
	if err != nil {
		return s47pRun{Err: err.Error()}
	}
	value, err := op(guard)
	if err != nil {
		return s47pRun{Used: guard.used, Err: err.Error()}
	}
	return s47pRun{Value: value, Used: guard.used}
}

func s47pSweepRun(build func() s47pOp) s47pSweep {
	sweep := s47pSweep{Full: s47pGuardRun(context.Background(), s47pBigLimit, build())}
	if sweep.Full.Err == "" && sweep.Full.Used > 0 {
		under := s47pGuardRun(context.Background(), sweep.Full.Used-1, build())
		under.Value = nil
		sweep.Under = &under
	}
	for at := 1; at <= 3; at++ {
		ctx := &s47pCountingContext{Context: context.Background(), cancelAt: at}
		run := s47pGuardRun(ctx, s47pBigLimit, build())
		sweep.Cancel = append(sweep.Cancel, s47pCancelRun{At: at, Used: run.Used, Err: run.Err})
	}
	return sweep
}

// ─── Priority queue ──────────────────────────────────────────────────────────

var errS47pBudget = errors.New("slice47 budget exhausted")

type s47pBudget struct {
	used, limit uint64
}

func (b *s47pBudget) step() error { return b.add(1) }
func (b *s47pBudget) add(units uint64) error {
	if units > b.limit-b.used {
		return errS47pBudget
	}
	b.used += units
	return nil
}
func (b *s47pBudget) check() error { return nil }

type s47pPQOp struct {
	Op  string `json:"op"`
	P   s47pF  `json:"p"`
	H   bool   `json:"h"`
	Ref int    `json:"ref"`
}

type s47pPQResult struct {
	Entry    int    `json:"entry"`
	Priority s47pF  `json:"priority"`
	H        bool   `json:"h"`
	Order    uint64 `json:"order"`
	Err      string `json:"err"`
	Used     uint64 `json:"used"`
	Items    []int  `json:"items"`
	Indices  []int  `json:"indices"`
	Empty    bool   `json:"empty"`
}

type s47pPQCase struct {
	Name    string         `json:"name"`
	Limit   uint64         `json:"limit"`
	Compact bool           `json:"compact"`
	Ops     []s47pPQOp     `json:"ops"`
	Out     []s47pPQResult `json:"out"`
}

func s47pRunPQ(c s47pPQCase) []s47pPQResult {
	var queue priorityQueue
	var budget *s47pBudget
	var guard workBudget
	if c.Limit > 0 {
		budget = &s47pBudget{limit: c.Limit}
		guard = budget
	}
	registry := map[*priorityQueueEntry]int{}
	var entries []*priorityQueueEntry
	idOf := func(entry *priorityQueueEntry) int {
		if entry == nil {
			return -1
		}
		if id, ok := registry[entry]; ok {
			return id
		}
		registry[entry] = len(entries)
		entries = append(entries, entry)
		return len(entries) - 1
	}
	var out []s47pPQResult
	for _, op := range c.Ops {
		res := s47pPQResult{Entry: -1}
		var entry *priorityQueueEntry
		var err error
		switch op.Op {
		case "push":
			entry, err = queue.push(float64(op.P), nil, op.H, guard)
		case "pop":
			entry, err = queue.pop(guard)
		case "decrease":
			var target *priorityQueueEntry
			if op.Ref >= 0 {
				target = entries[op.Ref]
			}
			err = queue.decrease(target, float64(op.P), guard)
		case "reset":
			queue.reset()
		}
		if err != nil {
			res.Err = err.Error()
		}
		if entry != nil {
			res.Entry = idOf(entry)
			res.Priority = s47pF(entry.priority)
			res.H = entry.isHorizontal
			res.Order = entry.order
		}
		if budget != nil {
			res.Used = budget.used
		}
		if !c.Compact {
			res.Items = []int{}
			res.Indices = []int{}
			for _, item := range queue.items {
				res.Items = append(res.Items, idOf(item))
				res.Indices = append(res.Indices, item.index)
			}
		}
		res.Empty = queue.empty()
		out = append(out, res)
	}
	return out
}

func s47pPQCases() []s47pPQCase {
	push := func(p float64, h bool) s47pPQOp { return s47pPQOp{Op: "push", P: s47pF(p), H: h} }
	pop := s47pPQOp{Op: "pop"}
	dec := func(ref int, p float64) s47pPQOp { return s47pPQOp{Op: "decrease", Ref: ref, P: s47pF(p)} }
	reset := s47pPQOp{Op: "reset"}
	pops := func(n int) []s47pPQOp {
		out := make([]s47pPQOp, n)
		for i := range out {
			out[i] = pop
		}
		return out
	}
	var cases []s47pPQCase
	add := func(name string, limit uint64, ops ...s47pPQOp) {
		cases = append(cases, s47pPQCase{Name: name, Limit: limit, Ops: ops})
	}
	add("single entry", 0, push(5, false), pop, pop)
	add("single entry guarded", 1000, push(5, true), pop)
	add("descending pushes", 1000, push(3, false), push(2, false), push(1, false), pop, pop, pop)
	add("equal priorities insertion order", 1000, append([]s47pPQOp{push(1, true), push(1, false), push(1, true), push(1, false)}, pops(4)...)...)
	add("duplicate distances mixed", 1000, append([]s47pPQOp{push(4, false), push(2, true), push(4, true), push(2, false), push(3, false), push(2, true)}, pops(6)...)...)
	add("decrease key", 1000, push(3, false), push(2, false), dec(0, 1), pop, dec(0, 0), pop)
	add("decrease preserves order", 1000, push(1, false), push(2, false), dec(1, 1), pop, pop)
	add("decrease errors", 0, dec(-1, 1), push(2, false), dec(-1, 1), dec(0, 2), dec(0, 3), dec(0, 1e6), dec(0, 2.5), pop, dec(0, 1), push(1e21, false), dec(1, 1e21), dec(1, 1234567), dec(1, 1234567),
		push(0.5, false), dec(2, 0.5), dec(2, 0.0001), dec(2, 0.0001), dec(2, 1e-05), dec(2, 2e-05), push(-3, false), dec(3, -2.5), dec(3, 123456), push(math.Inf(1), false), dec(4, math.Inf(1)),
		dec(4, 123456789), dec(4, 123456789), dec(4, 100000), dec(4, 999999), dec(4, 1.5e-300), dec(4, 1.5e-300), dec(4, math.Copysign(0, -1)), dec(4, math.Inf(-1)), dec(4, math.Inf(-1)))
	add("nan priority", 1000, push(3, false), push(math.NaN(), false), push(1, false), dec(1, math.NaN()), pop, pop, pop)
	add("negative zero ties", 1000, push(0, false), push(math.Copysign(0, -1), true), push(0, true), pop, pop, pop)
	add("reset reuses entries", 1000, push(1, false), push(2, false), reset, push(3, false), push(0, true), pop, pop)
	add("pop empty", 1000, pop, push(1, false), pop, pop)
	add("budget exhausted on push", 4, push(1, false), push(2, false), push(3, false), push(4, false), pop)
	add("budget exhausted on pop", 6, push(1, false), push(2, false), push(3, false), pop, pop)
	add("budget exhausted on decrease", 3, push(5, false), push(6, false), dec(1, 1), pop)
	// Large queue crossing entry chunks, with decreases.
	var large []s47pPQOp
	for i := 0; i < priorityQueueEntryChunkSize*2+7; i++ {
		large = append(large, push(float64((i*37)%100), i%2 == 0))
	}
	for i := 0; i < priorityQueueEntryChunkSize*2+7; i += 17 {
		large = append(large, dec(i, -float64(i+1)))
	}
	large = append(large, pops(priorityQueueEntryChunkSize*2+8)...)
	cases = append(cases, s47pPQCase{Name: "large queue across chunks", Limit: 1 << 30, Compact: true, Ops: large})
	return cases
}

// ─── Case model ──────────────────────────────────────────────────────────────

type s47pBoxLabel struct {
	X      s47pF  `json:"x"`
	Y      s47pF  `json:"y"`
	W      s47pF  `json:"w"`
	H      s47pF  `json:"h"`
	Edge   int    `json:"edge"`
	Target bool   `json:"target"`
	Text   string `json:"text"`
}

type s47pRouteSpec struct {
	Edge   int      `json:"edge"`
	Points []s47pPt `json:"points"`
	From   s47pPt   `json:"from"`
	To     s47pPt   `json:"to"`
}

type s47pSortItem struct {
	K  s47pF `json:"k"`
	ID int   `json:"id"`
}

type s47pScriptOp struct {
	Op  string   `json:"op"`
	E   int      `json:"e"`
	F   int      `json:"f"`
	I   int      `json:"i"`
	N   int64    `json:"n"`
	X   s47pF    `json:"x"`
	Y   s47pF    `json:"y"`
	V   s47pF    `json:"v"`
	Pts []s47pPt `json:"pts,omitempty"`
}

type s47pArgs struct {
	Edge       int             `json:"edge"`
	Edges      []int           `json:"edges,omitempty"`
	Others     []int           `json:"others,omitempty"`
	Node       int64           `json:"node"`
	Nodes      []int64         `json:"nodes,omitempty"`
	Source     int64           `json:"source"`
	Target     int64           `json:"target"`
	SrcCluster []int64         `json:"srcCluster,omitempty"`
	DstCluster []int64         `json:"dstCluster,omitempty"`
	Start      s47pPt          `json:"start,omitempty"`
	End        s47pPt          `json:"end,omitempty"`
	Points     []s47pPt        `json:"points,omitempty"`
	IsH        bool            `json:"isH"`
	Floor      s47pF           `json:"floor"`
	Ceil       s47pF           `json:"ceil"`
	Buffer     s47pF           `json:"buffer"`
	Count      int             `json:"count"`
	Batch      []int           `json:"batch,omitempty"`
	Proposed   []s47pF         `json:"proposed,omitempty"`
	Special    []int           `json:"special,omitempty"`
	Regular    []int           `json:"regular,omitempty"`
	Positioned *s47pBoxLabel   `json:"positioned,omitempty"`
	Labels     []s47pBoxLabel  `json:"labels,omitempty"`
	Routes     []s47pRouteSpec `json:"routes,omitempty"`
	Extras     []int           `json:"extras,omitempty"`
	ExtraCount int             `json:"extraCount"`
	HugeRoute  bool            `json:"hugeRoute,omitempty"`
	Values     []s47pSortItem  `json:"values,omitempty"`
	Entry      string          `json:"entry,omitempty"`
	Script     []s47pScriptOp  `json:"script,omitempty"`
	Limit      uint64          `json:"limit"`
	CancelAt   int             `json:"cancelAt"`
	AllEdges   bool            `json:"allEdges,omitempty"`
}

type s47pCase struct {
	Group string    `json:"group"`
	Name  string    `json:"name"`
	Op    string    `json:"op"`
	Spec  *s47pSpec `json:"spec,omitempty"`
	Args  s47pArgs  `json:"args"`
	Out   any       `json:"out"`
}

func (sg *s47pGraph) others(args s47pArgs) []*layoutgraph.Edge {
	if args.AllEdges {
		return sg.g.Edges
	}
	return sg.edgeList(args.Others)
}

func s47pClusterMap(sg *s47pGraph, ids []int64) map[*layoutgraph.Node]bool {
	if ids == nil {
		return nil
	}
	out := map[*layoutgraph.Node]bool{}
	for _, id := range ids {
		out[sg.nodes[id]] = true
	}
	return out
}

func s47pSortedIDs(nodes map[*layoutgraph.Node]bool) []int64 {
	out := []int64{}
	for node := range nodes {
		out = append(out, int64(node.ID))
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func s47pNodeIDs(nodes []*layoutgraph.Node) []int64 {
	out := []int64{}
	for _, node := range nodes {
		out = append(out, int64(node.ID))
	}
	return out
}

func (sg *s47pGraph) edgeIndices(edges []*layoutgraph.Edge) []int {
	out := []int{}
	for _, e := range edges {
		out = append(out, sg.edgeIndex(e))
	}
	return out
}

func (sg *s47pGraph) allRoutes() [][][]any {
	out := [][][]any{}
	for _, e := range sg.edges {
		out = append(out, sg.route(e.Points))
	}
	return out
}

func (sg *s47pGraph) segments(edges []*layoutgraph.Edge, isH bool) []*layoutgraph.EdgeSegment {
	guard, _ := newRouteWorkGuard(context.Background(), s47pLocation, s47pBigLimit)
	segments, err := edgeSegmentsGuarded(layoutgraph.Edges(edges), isH, guard)
	if err != nil {
		panic(err)
	}
	return segments
}

func s47pBuildRoutes(sg *s47pGraph, specs []s47pRouteSpec) []*Route {
	routes := make([]*Route, 0, len(specs))
	for _, rs := range specs {
		route := &Route{GEdge: sg.edges[rs.Edge]}
		for _, p := range rs.Points {
			route.OVGNodes = append(route.OVGNodes, NewOVGNode(geo.NewPoint(float64(p[0]), float64(p[1]))))
		}
		if rs.From != nil {
			route.FromPort = geo.Point{X: float64(rs.From[0]), Y: float64(rs.From[1])}
		}
		if rs.To != nil {
			route.ToPort = geo.Point{X: float64(rs.To[0]), Y: float64(rs.To[1])}
		}
		routes = append(routes, route)
	}
	return routes
}

// s47pGuardedOp builds a fresh graph and returns the guarded operation.
func s47pGuardedOp(c s47pCase) func() s47pOp {
	return func() s47pOp {
		spec := c.Spec
		if spec == nil {
			spec = &s47pSpec{}
		}
		sg := spec.build()
		a := c.Args
		switch c.Op {
		case "portEdges":
			return func(guard *routeWorkGuard) (any, error) {
				portEdges, err := portEdgesGuarded(layoutgraph.Edges(sg.g.Edges), sg.nodes[a.Node], guard)
				if err != nil {
					return nil, err
				}
				type entry struct {
					p     geo.Point
					edges []*layoutgraph.Edge
				}
				var list []entry
				for p, edges := range portEdges {
					list = append(list, entry{p, edges})
				}
				sort.Slice(list, func(i, j int) bool {
					if list[i].p.X != list[j].p.X {
						return list[i].p.X < list[j].p.X
					}
					return list[i].p.Y < list[j].p.Y
				})
				out := []any{}
				for _, item := range list {
					out = append(out, []any{s47pF(item.p.X), s47pF(item.p.Y), sg.edgeIndices(item.edges)})
				}
				return out, nil
			}
		case "edgeHasDuplicateIn":
			return func(guard *routeWorkGuard) (any, error) {
				return edgeHasDuplicateInGuarded(sg.edges[a.Edge], sg.edgeList(a.Others), guard)
			}
		case "filterEdgeAncestors":
			return func(guard *routeWorkGuard) (any, error) {
				nodes, err := filterEdgeAncestorsGuarded(sg.edges[a.Edge], layoutgraph.Nodes(sg.g.Nodes), guard)
				if err != nil {
					return nil, err
				}
				return s47pNodeIDs(nodes), nil
			}
		case "clusterNodes":
			return func(guard *routeWorkGuard) (any, error) {
				src, dst, err := sourceAndTargetClusterNodesGuarded(sg.g, sg.nodes[a.Source], sg.nodes[a.Target], guard)
				if err != nil {
					return nil, err
				}
				return map[string]any{"src": s47pSortedIDs(src), "dst": s47pSortedIDs(dst)}, nil
			}
		case "overlappingEdges":
			return func(guard *routeWorkGuard) (any, error) {
				start := geo.NewPoint(float64(a.Start[0]), float64(a.Start[1]))
				end := geo.NewPoint(float64(a.End[0]), float64(a.End[1]))
				edges, err := overlappingEdgesGuarded(start, end, sg.others(a), guard)
				if err != nil {
					return nil, err
				}
				return sg.edgeIndices(edges), nil
			}
		case "edgeCanOverlap":
			return func(guard *routeWorkGuard) (any, error) {
				return edgeCanOverlapEdgesGuarded(sg.edges[a.Edge], sg.others(a), s47pClusterMap(sg, a.SrcCluster), s47pClusterMap(sg, a.DstCluster), guard)
			}
		case "arrowheadCost":
			return func(guard *routeWorkGuard) (any, error) {
				toLabel := func(b s47pBoxLabel) labeling.PositionedArrowheadLabel {
					return labeling.PositionedArrowheadLabel{
						Box:      *geo.NewBox(geo.NewPoint(float64(b.X), float64(b.Y)), float64(b.W), float64(b.H)),
						Edge:     sg.edges[b.Edge],
						IsTarget: b.Target,
						Text:     b.Text,
					}
				}
				var labels []labeling.PositionedArrowheadLabel
				for _, b := range a.Labels {
					labels = append(labels, toLabel(b))
				}
				cost, err := positionedArrowheadLabelCostGuarded(toLabel(*a.Positioned), sg.nodeList(a.Nodes), labels, s47pBuildRoutes(sg, a.Routes), sg.edgeList(a.Others), guard)
				return s47pF(cost), err
			}
		case "edgeIsStraight":
			return func(guard *routeWorkGuard) (any, error) {
				return edgeIsStraightGuarded(sg.edges[a.Edge], guard)
			}
		case "overlappingEnd":
			return func(guard *routeWorkGuard) (any, error) {
				return edgeHasOverlappingEndGuarded(sg.edges[a.Edge], guard)
			}
		case "reorderDuplicates":
			return func(guard *routeWorkGuard) (any, error) {
				edges := sg.g.Edges
				if a.Edges != nil {
					edges = sg.edgeList(a.Edges)
				}
				if err := reorderDuplicatesInEdgesGuarded(edges, guard); err != nil {
					return nil, err
				}
				return sg.allRoutes(), nil
			}
		case "reverse":
			return func(guard *routeWorkGuard) (any, error) {
				if err := reverseEdgeRouteGuarded(sg.edges[a.Edge], guard); err != nil {
					return nil, err
				}
				return sg.allRoutes(), nil
			}
		case "trace":
			return func(guard *routeWorkGuard) (any, error) {
				edge := sg.edges[a.Edge]
				if err := traceToShapeBorderGuarded(edge, guard); err != nil {
					return nil, err
				}
				return map[string]any{"routes": sg.allRoutes(), "from": s47pEncPoint(edge.From.TopLeft), "to": s47pEncPoint(edge.To.TopLeft)}, nil
			}
		case "intersectsNode":
			return func(guard *routeWorkGuard) (any, error) {
				return routeIntersectsNodeGuarded(layoutgraph.Nodes(sg.nodeList(a.Nodes)), sg.edges[a.Edge], guard)
			}
		case "routeCostGuarded":
			return func(guard *routeWorkGuard) (any, error) {
				cost, err := estimateRouteCostGuarded(layoutgraph.Edges(sg.others(a)), sg.edges[a.Edge], guard)
				return s47pF(cost), err
			}
		case "removeDuplicates":
			return func(guard *routeWorkGuard) (any, error) {
				var points []*geo.Point
				if a.Points != nil {
					points = make([]*geo.Point, len(a.Points))
					for i, p := range a.Points {
						points[i] = geo.NewPoint(float64(p[0]), float64(p[1]))
						sg.pointID(points[i])
					}
				}
				out, err := removeDuplicatePointsGuarded(points, guard)
				if err != nil {
					return nil, err
				}
				return map[string]any{"nil": out == nil, "route": sg.route(out)}, nil
			}
		case "nodeSegments":
			return func(guard *routeWorkGuard) (any, error) {
				nodes := sg.nodeList(a.Nodes)
				segments, err := nodeSegmentsGuarded(layoutgraph.Nodes(nodes), a.IsH, guard)
				if err != nil {
					return nil, err
				}
				out := []any{}
				for i, s := range segments {
					out = append(out, []any{s47pF(s.Start.X), s47pF(s.Start.Y), s47pF(s.End.X), s47pF(s.End.Y), s.Start == nodes[i/2].TopLeft})
				}
				return out, nil
			}
		case "edgeSegments":
			return func(guard *routeWorkGuard) (any, error) {
				segments, err := edgeSegmentsGuarded(layoutgraph.Edges(sg.edgeList(a.Edges)), a.IsH, guard)
				if err != nil {
					return nil, err
				}
				out := []any{}
				for _, s := range segments {
					out = append(out, []any{sg.pointID(s.Start), sg.pointID(s.End), sg.edgeIndex(s.Owner())})
				}
				return out, nil
			}
		case "segmentBounds":
			return func(guard *routeWorkGuard) (any, error) {
				segment := geo.Segment{Start: geo.NewPoint(float64(a.Start[0]), float64(a.Start[1])), End: geo.NewPoint(float64(a.End[0]), float64(a.End[1]))}
				var segments []*geo.Segment
				for i := 0; i+1 < len(a.Points); i += 2 {
					segments = append(segments, &geo.Segment{
						Start: geo.NewPoint(float64(a.Points[i][0]), float64(a.Points[i][1])),
						End:   geo.NewPoint(float64(a.Points[i+1][0]), float64(a.Points[i+1][1])),
					})
				}
				floor, ceil, err := routeSegmentBounds(segment, segments, float64(a.Buffer), guard)
				if err != nil {
					return nil, err
				}
				return []s47pF{s47pF(floor), s47pF(ceil)}, nil
			}
		case "distribute":
			return func(guard *routeWorkGuard) (any, error) {
				values, err := evenlyDistributeGuarded(float64(a.Floor), float64(a.Ceil), a.Count, guard)
				if err != nil {
					return nil, err
				}
				out := []s47pF{}
				for _, v := range values {
					out = append(out, s47pF(v))
				}
				return out, nil
			}
		case "balanceOrder", "reversal":
			return func(guard *routeWorkGuard) (any, error) {
				all := sg.segments(sg.edgeList(a.Edges), !a.IsH)
				var batch []*layoutgraph.EdgeSegment
				batchSet := map[*layoutgraph.EdgeSegment]bool{}
				for _, index := range a.Batch {
					batch = append(batch, all[index])
					batchSet[all[index]] = true
				}
				proposed := make([]float64, len(a.Proposed))
				for i, v := range a.Proposed {
					proposed[i] = float64(v)
				}
				if c.Op == "reversal" {
					return balanceReversalRemovesCrossings(sg.g, batch, proposed, a.IsH, guard)
				}
				status, err := checkBalanceOrder(batch, batchSet, all, proposed, a.IsH, guard)
				return int(status), err
			}
		case "balanceRegular":
			return func(guard *routeWorkGuard) (any, error) {
				if err := balanceRegularEdgesGuarded(sg.g, sg.edgeList(a.Special), sg.edgeList(a.Regular), guard); err != nil {
					return nil, err
				}
				return sg.allRoutes(), nil
			}
		case "reserveSort":
			return func(guard *routeWorkGuard) (any, error) {
				return nil, guard.reserveSort(a.Count)
			}
		case "canSwap":
			return func(guard *routeWorkGuard) (any, error) {
				routes := s47pBuildRoutes(sg, a.Routes)
				return routes[a.Batch[0]].canSwapEdgesGuarded(routes[a.Batch[1]], routes, guard)
			}
		case "capture":
			return func(guard *routeWorkGuard) (any, error) {
				before := sg.state()
				snapshot, err := captureRouteMutations(sg.g, sg.edgeList(a.Extras), guard)
				if err != nil {
					return nil, err
				}
				s47pMutateEverything(sg)
				mutated := sg.state()
				snapshot.restore()
				after := sg.state()
				return map[string]any{
					"nodes":    len(snapshot.nodes),
					"edges":    len(snapshot.edges),
					"changed":  !s47pSameJSON(before, mutated),
					"restored": s47pSameJSON(before, after),
				}, nil
			}
		case "validate":
			return func(guard *routeWorkGuard) (any, error) {
				extras := sg.edgeList(a.Extras)
				if a.ExtraCount > 0 {
					extras = make([]*layoutgraph.Edge, a.ExtraCount)
				}
				if a.HugeRoute {
					huge := layoutgraph.NewEdge(sg.edges[0].From, sg.edges[0].To)
					huge.Points = make([]*geo.Point, layoutgraph.MaxRoutePoints+1)
					extras = append(extras, huge)
				}
				return nil, validateRouteStageGeometry(sg.g, extras, guard)
			}
		case "bbox":
			return func(guard *routeWorkGuard) (any, error) {
				tl, br, err := routeStageGraphBoundingBox(sg.g, guard)
				if err != nil {
					return nil, err
				}
				return []s47pF{s47pF(tl.X), s47pF(tl.Y), s47pF(br.X), s47pF(br.Y)}, nil
			}
		case "sort":
			return func(guard *routeWorkGuard) (any, error) {
				values := append([]s47pSortItem(nil), a.Values...)
				if err := stableSortRouteValues(values, func(x, y s47pSortItem) bool { return x.K < y.K }, guard); err != nil {
					return nil, err
				}
				out := []int{}
				for _, v := range values {
					out = append(out, v.ID)
				}
				return out, nil
			}
		}
		panic("unknown guarded op " + c.Op)
	}
}

// s47pMutateEverything performs every mutation a route stage can roll back.
func s47pMutateEverything(sg *s47pGraph) {
	g := sg.g
	g.CellSize = 4321
	g.RestoreRoutingCosts(layoutgraph.RoutingCostState{Crossing: 7, Turn: 8, NonCenterPort: 9})
	for _, e := range sg.edges {
		for _, p := range e.Points {
			if p != nil {
				p.X += 1000
				p.Y -= 1000
			}
		}
		for i, j := 0, len(e.Points)-1; i < j; i, j = i+1, j-1 {
			e.Points[i], e.Points[j] = e.Points[j], e.Points[i]
		}
		if e.Label != nil {
			e.Label.Width = 999
			e.Label.Position = label.UnlockedBottom
		}
		e.Points = []*geo.Point{geo.NewPoint(-1, -1), geo.NewPoint(-2, -2)}
		e.IsCurve = !e.IsCurve
	}
	ids := make([]int64, 0, len(sg.nodes))
	for id := range sg.nodes {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		n := sg.nodes[id]
		if n.TopLeft != nil {
			n.TopLeft.X += 5
		}
		n.TopLeft = geo.NewPoint(float64(id)*-3, 77)
		n.Graph = nil
	}
}

func s47pSameJSON(a, b any) bool {
	x, err := json.Marshal(a)
	if err != nil {
		panic(err)
	}
	y, err := json.Marshal(b)
	if err != nil {
		panic(err)
	}
	return bytes.Equal(x, y)
}

// ─── Atomic stage scripts ────────────────────────────────────────────────────

type s47pAtomicOut struct {
	Err     string    `json:"err"`
	Panic   string    `json:"panic"`
	Used    uint64    `json:"used"`
	Ran     bool      `json:"ran"`
	Changed bool      `json:"changed"`
	State   s47pState `json:"state"`
}

func s47pRunScript(sg *s47pGraph, script []s47pScriptOp, guard *routeWorkGuard) error {
	for _, op := range script {
		switch op.Op {
		case "point":
			p := sg.edges[op.E].Points[op.I]
			p.X, p.Y = float64(op.X), float64(op.Y)
		case "replace":
			points := make([]*geo.Point, len(op.Pts))
			for i, p := range op.Pts {
				points[i] = geo.NewPoint(float64(p[0]), float64(p[1]))
			}
			sg.edges[op.E].Points = points
		case "swap":
			sg.edges[op.E].Points, sg.edges[op.F].Points = sg.edges[op.F].Points, sg.edges[op.E].Points
		case "reverse":
			points := sg.edges[op.E].Points
			for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
				points[i], points[j] = points[j], points[i]
			}
		case "label":
			sg.edges[op.E].Label.Width = float64(op.V)
		case "cell":
			sg.g.CellSize = float64(op.V)
		case "costs":
			v := float64(op.V)
			sg.g.RestoreRoutingCosts(layoutgraph.RoutingCostState{Crossing: v, Turn: v + 1, NonCenterPort: v + 2})
		case "move":
			sg.nodes[op.N].TopLeft = geo.NewPoint(float64(op.X), float64(op.Y))
		case "nudge":
			sg.nodes[op.N].TopLeft.X += float64(op.X)
		case "graph":
			sg.nodes[op.N].Graph = nil
		case "curve":
			sg.edges[op.E].IsCurve = true
		case "step":
			if err := guard.step(); err != nil {
				return err
			}
		case "add":
			if err := guard.add(uint64(op.V)); err != nil {
				return err
			}
		case "fail":
			return errors.New("slice47 callback failure")
		case "panic":
			panic("slice47 callback panic")
		default:
			panic("unknown script op " + op.Op)
		}
	}
	return nil
}

func s47pRunAtomic(c s47pCase) s47pAtomicOut {
	sg := c.Spec.build()
	a := c.Args
	var ctx context.Context = context.Background()
	if a.CancelAt > 0 {
		ctx = &s47pCountingContext{Context: context.Background(), cancelAt: a.CancelAt}
	}
	limit := a.Limit
	if limit == 0 {
		limit = s47pBigLimit
	}
	extras := sg.edgeList(a.Extras)
	before := sg.state()
	out := s47pAtomicOut{}
	var seen *routeWorkGuard
	fn := func(guard *routeWorkGuard) error {
		seen = guard
		out.Ran = true
		return s47pRunScript(sg, a.Script, guard)
	}
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				out.Panic = fmt.Sprint(recovered)
			}
		}()
		var err error
		switch a.Entry {
		case "stage":
			err = runAtomicRouteStage(ctx, s47pLocation, sg.g, extras, limit, fn)
		case "afterPreflight":
			err = runAtomicRouteStageAfterPreflight(ctx, s47pLocation, sg.g, extras, limit, fn)
		case "withGuard", "validated":
			guard, guardErr := newRouteWorkGuard(ctx, s47pLocation, limit)
			if guardErr != nil {
				err = guardErr
				break
			}
			seen = guard
			if a.Entry == "withGuard" {
				err = runAtomicRouteStageWithGuard(sg.g, extras, guard, fn)
			} else {
				err = runAtomicRouteStageWithValidatedGeometry(sg.g, extras, guard, fn)
			}
		case "trace":
			err = traceEdgesToShapeBorderWithWorkLimit(ctx, sg.g, limit)
		}
		if err != nil {
			out.Err = err.Error()
		}
	}()
	if seen != nil {
		out.Used = seen.used
	}
	out.State = sg.state()
	out.Changed = !s47pSameJSON(before, out.State)
	return out
}

// ─── Case catalogue ──────────────────────────────────────────────────────────

func s47pNode(id int64, x, y, w, h float64) s47pNodeSpec {
	return s47pNodeSpec{ID: id, X: s47pF(x), Y: s47pF(y), W: s47pF(w), H: s47pF(h)}
}

func s47pEdge(from, to int64, coords ...float64) s47pEdgeSpec {
	return s47pEdgeSpec{From: from, To: to, Points: s47pPts(coords...)}
}

func s47pIntPtr(v int) *int { return &v }

// Two stacked nodes joined by three parallel vertical routes (reorder fixture).
func s47pDuplicateSpec(reverseLast bool) *s47pSpec {
	last := s47pEdge(1, 2, 30, 40, 30, 200)
	if reverseLast {
		last = s47pEdge(2, 1, 30, 200, 30, 40)
	}
	labeled := s47pEdge(1, 2, 20, 40, 20, 200)
	labeled.Label = &s47pLabel{Text: "labeled"}
	return &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 40, 40), s47pNode(2, 0, 200, 40, 40)},
		Edges: []s47pEdgeSpec{s47pEdge(1, 2, 10, 40, 10, 200), last, labeled},
	}
}

func s47pChainSpec() *s47pSpec {
	labeled := s47pEdge(1, 2, 100, 50, 200, 50, 200, 150, 300, 150)
	labeled.Label = &s47pLabel{Text: "a", W: 20, H: 10, Pos: int(label.UnlockedMiddle)}
	labeled.Dst = "triangle"
	return &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 100, 100, 100), s47pNode(3, 0, 300, 50, 50)},
		Edges: []s47pEdgeSpec{
			labeled,
			s47pEdge(2, 3, 350, 200, 350, 325, 50, 325),
			s47pEdge(3, 1, 25, 300, 25, 100),
		},
	}
}

func s47pBalanceSpec() *s47pSpec {
	// Three regular vertical routes through one corridor plus a locked
	// special route; nodes bound the corridor.
	return &s47pSpec{
		Nodes: []s47pNodeSpec{
			s47pNode(1, 0, 0, 300, 100),
			s47pNode(2, 0, 400, 300, 100),
			s47pNode(3, 400, 0, 100, 100),
			s47pNode(4, 400, 400, 100, 100),
		},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 100, 100, 100, 250, 120, 250, 120, 400),
			s47pEdge(1, 2, 140, 100, 140, 400),
			s47pEdge(1, 2, 150, 100, 150, 400),
			s47pEdge(3, 4, 450, 100, 450, 400),
			s47pEdge(1, 4, 280, 100, 280, 300, 420, 300, 420, 400),
		},
	}
}

func s47pCases() []s47pCase {
	var cases []s47pCase
	add := func(group, name, op string, spec *s47pSpec, args s47pArgs) {
		cases = append(cases, s47pCase{Group: group, Name: name, Op: op, Spec: spec, Args: args})
	}

	// Route cost.
	crossing := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 1, 1), s47pNode(2, 50, 50, 1, 1)},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 0, 0, 10, 10),
			s47pEdge(1, 2, 0, 10, 10, 0),
			s47pEdge(1, 2, 5, -5, 5, 20, 30, 20),
			s47pEdge(1, 2, 0, 5, 20, 5),
			s47pEdge(1, 2, 5, 5, 5, 30),
			s47pEdge(1, 2, 0, 0, 0, 10, 10, 10, 10, 30, 40, 30),
			{From: 1, To: 2, Points: []s47pPt{}},
			s47pEdge(1, 2, 3, 3),
		},
	}
	for e := range crossing.Edges {
		add("cost", fmt.Sprintf("estimateRouteCost edge %d", e), "routeCost", crossing, s47pArgs{Edge: e, AllEdges: true})
		add("cost", fmt.Sprintf("estimateRouteCostGuarded edge %d", e), "routeCostGuarded", crossing, s47pArgs{Edge: e, AllEdges: true})
	}
	add("cost", "crossing matrix", "crossingMatrix", crossing, s47pArgs{})
	add("cost", "shared bend exclusions", "crossingMatrix", &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 1, 1), s47pNode(2, 50, 50, 1, 1)},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 0, 0, 0, 10, 10, 10),
			s47pEdge(1, 2, 0, 5, 0, 10, -10, 10),
			s47pEdge(1, 2, -5, 5, 5, 5),
			s47pEdge(1, 2, 0, 10, 0, 20),
			s47pEdge(1, 2, 0, -5, 0, 15),
		},
	}, s47pArgs{})
	add("cost", "orientation signs", "signs", nil, s47pArgs{Points: s47pPts(
		0, 0, 10, 10, 0, 10, 10, 0,
		0, 0, 10, 0, 5, 0, 20, 0,
		0, 0, 10, 0, 10, 0, 10, 10,
		0, 0, 10, 0, 5, -5, 5, 5,
		0, 0, 1e308, 1e308, 0, 1e308, 1e308, 0,
		0, 0, math.NaN(), 1, 0, 1, 1, 0,
		0, 0, 4, 0, 4, 0, 8, 0,
		-1, -1, 1, 1, -1, 1, 1, -1,
	)})

	// Route helpers.
	routeSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 10, 10), s47pNode(2, 300, 0, 10, 10)},
		Edges: []s47pEdgeSpec{
			{From: 1, To: 2, Dst: "triangle"},
			{From: 1, To: 2},
			{From: 1, To: 2, Src: "triangle", Dst: "triangle"},
		},
	}
	segmentRoutes := [][]float64{
		{0, 0, 0, 10, 0, 20, 10, 20, 20, 20, 20, 30, 20, 40},
		{0, 0, 5, 0, 10, 0, 10, 10},
		{0, 0, 1, 1, 2, 2, 3, 3, 4, 4},
		{0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 30, 20, 40, 20, 40, 30},
		{5, 5, 5, 6, 5, 7},
	}
	for i, coords := range segmentRoutes {
		add("route", fmt.Sprintf("createSegmentEndpoints %d", i), "segmentEndpoints", routeSpec, s47pArgs{Routes: []s47pRouteSpec{{Edge: 0, Points: s47pPts(coords...)}}})
	}
	colinearRoutes := [][]float64{
		{0, 0, 100, 0, 100, 100, 200, 100},
		{-10, 0, 0, 0, 50, 0, 100, 0, 110, 0},
		{0, -10, 0, 0, 0, 50, 0, 100, 0, 110},
		{0, 0, 0, 0, 50, 0, 50, 0},
		{0, 100, 0, 50, 0, 0, 30, 0, 30, 30, 60, 30},
	}
	probes := s47pPts(0, 0, 100, 0, 100, 0, 100, 100, 190, 0, 100, 0, 90, 0, 120, 0, 101, 0, 200, 0,
		0, 0, 100, 100, 120, 100, 300, 100, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0, 0, 50, 0, 100, 0, 0, -20, 0, 200, 0,
		30, 30, 30, 0, 30, 0, 30, 30, 0, 50, 0, 10, 0, 0, 0, 0)
	for i, coords := range colinearRoutes {
		for e := 0; e < 3; e++ {
			add("route", fmt.Sprintf("colinear route %d edge %d", i, e), "colinear", routeSpec, s47pArgs{
				Routes: []s47pRouteSpec{{Edge: e, Points: s47pPts(coords...)}},
				Points: probes,
			})
		}
	}
	swapSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 0, 300, 100, 100), s47pNode(3, 400, 0, 100, 100), s47pNode(4, 300, 300, 100, 100)},
		Edges: []s47pEdgeSpec{{From: 1, To: 2}, {From: 1, To: 2}, {From: 2, To: 1}, {From: 1, To: 1}, {From: 1, To: 3}, {From: 1, To: 3}, {From: 1, To: 4}, {From: 1, To: 4}},
	}
	swapRoutes := []s47pRouteSpec{
		{Edge: 0, From: s47pP(25, 100), To: s47pP(25, 300)},
		{Edge: 1, From: s47pP(75, 100), To: s47pP(75, 300)},
		{Edge: 2, From: s47pP(50, 300), To: s47pP(50, 100)},
		{Edge: 3, From: s47pP(0, 50), To: s47pP(50, 0)},
		{Edge: 4, From: s47pP(100, 25), To: s47pP(400, 25)},
		{Edge: 5, From: s47pP(100, 75), To: s47pP(400, 75)},
		{Edge: 6, From: s47pP(100, 100), To: s47pP(300, 300)},
		{Edge: 7, From: s47pP(90, 100), To: s47pP(310, 300)},
		{Edge: 1, From: s47pP(75, 100), To: s47pP(99, 300)},
		{Edge: 1, From: s47pP(5, 100), To: s47pP(25, 300)},
	}
	swapPairs := [][2]int{{0, 1}, {1, 0}, {0, 2}, {2, 0}, {0, 3}, {3, 0}, {4, 5}, {6, 7}, {0, 8}, {0, 9}, {1, 9}, {0, 0}}
	for _, pair := range swapPairs {
		add("route", fmt.Sprintf("canSwapEdges %d-%d", pair[0], pair[1]), "canSwap", swapSpec, s47pArgs{Routes: swapRoutes, Batch: []int{pair[0], pair[1]}})
	}
	add("route", "canSwapEdges distinct ports", "canSwap", swapSpec, s47pArgs{Routes: swapRoutes[:2], Batch: []int{0, 1}})

	// Standalone helpers.
	portSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 0, 100, 100), s47pNode(3, 0, 300, 100, 100)},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 100, 50, 300, 50),
			s47pEdge(1, 2, 100, 50, 200, 50, 200, 25, 300, 25),
			s47pEdge(3, 1, 50, 300, 50, 100),
			s47pEdge(1, 3, 25, 100, 25, 300),
			{From: 2, To: 1, Points: []s47pPt{}},
			s47pEdge(2, 3, 350, 100, 350, 350, 100, 350),
			s47pEdge(1, 2, math.Copysign(0, -1), 50, 300, 75),
			s47pEdge(1, 2, 0, 50, 300, 75),
		},
	}
	add("helpers", "portEdges node 1", "portEdges", portSpec, s47pArgs{Node: 1})
	add("helpers", "portEdges node 2", "portEdges", portSpec, s47pArgs{Node: 2})
	add("helpers", "portEdges node 3", "portEdges", portSpec, s47pArgs{Node: 3})
	add("helpers", "edgeHasDuplicateIn hit", "edgeHasDuplicateIn", portSpec, s47pArgs{Edge: 0, Others: []int{2, 3, 5, 1}})
	add("helpers", "edgeHasDuplicateIn reverse hit", "edgeHasDuplicateIn", portSpec, s47pArgs{Edge: 4, Others: []int{2, 3, 0}})
	add("helpers", "edgeHasDuplicateIn miss", "edgeHasDuplicateIn", portSpec, s47pArgs{Edge: 0, Others: []int{2, 3, 5}})
	add("helpers", "edgeHasDuplicateIn empty", "edgeHasDuplicateIn", portSpec, s47pArgs{Edge: 0})

	nested := &s47pSpec{
		Nodes: []s47pNodeSpec{
			s47pNode(1, 0, 0, 500, 500),
			{ID: 2, X: 10, Y: 10, W: 200, H: 200, Container: 1},
			{ID: 3, X: 20, Y: 20, W: 50, H: 50, Container: 2},
			{ID: 4, X: 300, Y: 300, W: 50, H: 50, Container: 1},
			s47pNode(5, 600, 0, 50, 50),
			s47pNode(6, 600, 300, 50, 50),
			s47pNode(7, 700, 300, 50, 50),
			s47pNode(8, 800, 300, 50, 50),
			{ID: 9, X: 600, Y: 280, W: 250, H: 100, NotInGraph: true},
			{ID: 10, X: 0, Y: 600, W: 1, H: 1, NotInGraph: true},
		},
		Edges: []s47pEdgeSpec{
			s47pEdge(3, 4, 45, 70, 45, 325, 300, 325),
			s47pEdge(3, 5, 70, 45, 600, 25),
			s47pEdge(6, 7, 650, 325, 700, 325),
			s47pEdge(5, 8, 625, 50, 825, 300),
			s47pEdge(1, 6, 500, 300, 600, 300),
		},
		Clusters: []s47pClusterSpec{{Vessel: 9, Nodes: []int64{6, 7, 8}, Arrangement: "Row", Desired: "Row"}},
	}
	for e := 0; e < 5; e++ {
		add("helpers", fmt.Sprintf("filterEdgeAncestors edge %d", e), "filterEdgeAncestors", nested, s47pArgs{Edge: e})
	}
	for _, pair := range [][2]int64{{6, 7}, {5, 8}, {3, 5}, {8, 6}, {6, 6}} {
		add("helpers", fmt.Sprintf("clusterNodes %d-%d", pair[0], pair[1]), "clusterNodes", nested, s47pArgs{Source: pair[0], Target: pair[1]})
	}
	add("helpers", "intersectsNode through sibling", "intersectsNode", nested, s47pArgs{Edge: 0, Nodes: []int64{1, 2, 3, 4, 5, 6}})
	add("helpers", "intersectsNode ancestors skipped", "intersectsNode", nested, s47pArgs{Edge: 1, Nodes: []int64{1, 2, 3}})
	add("helpers", "intersectsNode clear", "intersectsNode", nested, s47pArgs{Edge: 2, Nodes: []int64{1, 5, 8}})
	add("helpers", "intersectsNode diagonal", "intersectsNode", nested, s47pArgs{Edge: 3, Nodes: []int64{1, 2, 3, 4, 5, 6, 7, 8}})

	overlapSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 0, 100, 100), s47pNode(3, 0, 300, 100, 100), s47pNode(4, 300, 300, 100, 100)},
		Edges: []s47pEdgeSpec{
			{From: 1, To: 2, Points: s47pPts(100, 50, 300, 50), Dst: "triangle"},
			{From: 1, To: 4, Points: s47pPts(100, 50, 200, 50, 200, 350, 300, 350), Dst: "triangle"},
			{From: 3, To: 2, Points: s47pPts(100, 350, 200, 350, 200, 50, 300, 50), Dst: "triangle"},
			{From: 1, To: 2, Points: s47pPts(50, 0, 50, -20, 350, -20, 350, 0)},
			{From: 1, To: 2, Points: s47pPts(50, 100, 50, 150, 350, 150, 350, 100), Src: "triangle", Dst: "triangle"},
			{From: 1, To: 2, Points: s47pPts(100, 75, 300, 75), Src: "diamond", Dst: "diamond"},
			{From: 1, To: 2, Points: s47pPts(100, 25, 300, 25), Dst: "triangle", Stroke: "red"},
			{From: 1, To: 2, Points: s47pPts(100, 60, 300, 60), Dst: "triangle", DstLabel: &s47pLabel{Text: "1", W: 10, H: 10}},
			{From: 3, To: 4, Points: s47pPts(100, 350, 300, 350)},
			{From: 1, To: 3, Points: s47pPts(50, 100, 50, 300)},
			{From: 4, To: 1, Points: s47pPts(300, 50, 100, 50), Src: "triangle"},
		},
	}
	add("helpers", "overlappingEdges horizontal", "overlappingEdges", overlapSpec, s47pArgs{Start: s47pP(150, 50), End: s47pP(250, 50), AllEdges: true})
	add("helpers", "overlappingEdges vertical", "overlappingEdges", overlapSpec, s47pArgs{Start: s47pP(200, 0), End: s47pP(200, 400), AllEdges: true})
	add("helpers", "overlappingEdges touching end", "overlappingEdges", overlapSpec, s47pArgs{Start: s47pP(300, 350), End: s47pP(400, 350), AllEdges: true})
	add("helpers", "overlappingEdges diagonal none", "overlappingEdges", overlapSpec, s47pArgs{Start: s47pP(0, 0), End: s47pP(400, 400), AllEdges: true})
	add("helpers", "overlappingEdges empty", "overlappingEdges", overlapSpec, s47pArgs{Start: s47pP(0, 0), End: s47pP(10, 0)})
	canOverlap := []struct {
		name   string
		edge   int
		others []int
		src    []int64
		dst    []int64
	}{
		{"empty", 0, nil, nil, nil},
		{"directed shared source", 0, []int{1}, nil, nil},
		{"directed shared target", 0, []int{2}, nil, nil},
		{"directed mismatched arrow", 0, []int{10}, nil, nil},
		{"undirected shared node", 3, []int{9}, nil, nil},
		{"undirected no shared node", 3, []int{8}, nil, nil},
		{"undirected cluster edge", 3, []int{8}, []int64{3, 4}, nil},
		{"undirected target cluster", 3, []int{8}, nil, []int64{3, 4}},
		{"bidirectional match", 4, []int{4}, nil, nil},
		{"bidirectional mismatch", 5, []int{4}, nil, nil},
		{"style mismatch", 0, []int{6}, nil, nil},
		{"arrowhead label", 0, []int{7}, nil, nil},
		{"own arrowhead label", 7, []int{0}, nil, nil},
		{"mixed directed and undirected", 0, []int{3}, nil, nil},
	}
	for _, c := range canOverlap {
		add("helpers", "edgeCanOverlap "+c.name, "edgeCanOverlap", overlapSpec, s47pArgs{Edge: c.edge, Others: c.others, SrcCluster: c.src, DstCluster: c.dst})
	}
	add("helpers", "edgeCanOverlap search guard empty", "edgeCanOverlapSearch", overlapSpec, s47pArgs{Edge: 0})
	add("helpers", "edgeCanOverlap search guard others", "edgeCanOverlapSearch", overlapSpec, s47pArgs{Edge: 0, Others: []int{1, 2}})

	labelSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 0, 100, 100), s47pNode(3, 150, 150, 40, 40)},
		Edges: []s47pEdgeSpec{
			{From: 1, To: 2, Points: s47pPts(100, 50, 300, 50), Dst: "triangle", DstLabel: &s47pLabel{Text: "1", W: 10, H: 10}},
			{From: 1, To: 2, Points: s47pPts(100, 80, 300, 80), Dst: "triangle", DstLabel: &s47pLabel{Text: "1", W: 10, H: 10}},
			{From: 1, To: 3, Points: s47pPts(50, 100, 50, 170, 150, 170)},
			{From: 2, To: 3, Points: s47pPts(350, 100, 350, 160, 190, 160)},
		},
	}
	positioned := &s47pBoxLabel{X: 270, Y: 35, W: 20, H: 10, Edge: 0, Target: true, Text: "1"}
	add("helpers", "arrowheadCost overlapping label same text", "arrowheadCost", labelSpec, s47pArgs{Positioned: positioned,
		Labels: []s47pBoxLabel{*positioned, {X: 275, Y: 40, W: 20, H: 10, Edge: 1, Target: true, Text: "1"}}, Nodes: []int64{1, 2, 3}, AllEdges: true})
	add("helpers", "arrowheadCost overlapping label other text", "arrowheadCost", labelSpec, s47pArgs{Positioned: positioned,
		Labels: []s47pBoxLabel{{X: 275, Y: 40, W: 20, H: 10, Edge: 1, Target: true, Text: "2"}}, Nodes: []int64{1, 2, 3}, AllEdges: true})
	add("helpers", "arrowheadCost node and edge overlaps", "arrowheadCost", labelSpec, s47pArgs{Positioned: &s47pBoxLabel{X: 290, Y: 45, W: 20, H: 40, Edge: 0, Target: true, Text: "1"},
		Nodes: []int64{1, 2, 3}, AllEdges: true})
	add("helpers", "arrowheadCost routes", "arrowheadCost", labelSpec, s47pArgs{Positioned: &s47pBoxLabel{X: 140, Y: 150, W: 30, H: 30, Edge: 0, Target: false, Text: "1"},
		Nodes: []int64{3}, Routes: []s47pRouteSpec{{Edge: 2, Points: s47pPts(50, 100, 50, 170, 150, 170)}, {Edge: 0, Points: s47pPts(140, 160, 200, 160)}, {Edge: 3, Points: s47pPts(350, 100, 350, 160, 190, 160)}}})
	add("helpers", "arrowheadCost clear", "arrowheadCost", labelSpec, s47pArgs{Positioned: &s47pBoxLabel{X: 1000, Y: 1000, W: 5, H: 5, Edge: 1, Text: "x"},
		Nodes: []int64{1, 2, 3}, AllEdges: true})

	straightSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 40, 40), s47pNode(2, 0, 200, 40, 40), s47pNode(3, 200, 0, 40, 40)},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 10, 40, 10, 100, 10, 200),
			s47pEdge(1, 2, 20, 40, 20, 100, 25, 200),
			s47pEdge(1, 2, 30, 40, 30, 200),
			s47pEdge(1, 3, 40, 20, 200, 20),
			s47pEdge(2, 3, 10, 200, 200, 20),
			s47pEdge(3, 2, 200, 20, 10, 200),
			s47pEdge(1, 1, 10, 40, 10, 40),
		},
	}
	for e := range straightSpec.Edges {
		add("helpers", fmt.Sprintf("edgeIsStraight edge %d", e), "edgeIsStraight", straightSpec, s47pArgs{Edge: e})
		if len(straightSpec.Edges[e].Points) > 0 {
			add("helpers", fmt.Sprintf("overlappingEnd edge %d", e), "overlappingEnd", straightSpec, s47pArgs{Edge: e})
		}
	}
	add("helpers", "reverse even", "reverse", straightSpec, s47pArgs{Edge: 3})
	add("helpers", "reverse odd", "reverse", straightSpec, s47pArgs{Edge: 0})
	emptyRoute := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 40, 40), s47pNode(2, 0, 200, 40, 40)},
		Edges: []s47pEdgeSpec{{From: 1, To: 2, Points: []s47pPt{}}, {From: 1, To: 2, Points: s47pPts(1, 1)}},
	}
	add("helpers", "reverse empty", "reverse", emptyRoute, s47pArgs{Edge: 0})
	add("helpers", "reverse single", "reverse", emptyRoute, s47pArgs{Edge: 1})
	add("helpers", "edgeIsStraight empty", "edgeIsStraight", emptyRoute, s47pArgs{Edge: 0})
	add("helpers", "edgeIsStraight single", "edgeIsStraight", emptyRoute, s47pArgs{Edge: 1})
	add("helpers", "reorderDuplicates unchanged", "reorderDuplicates", s47pDuplicateSpec(false), s47pArgs{Edges: []int{2, 0, 1}})
	add("helpers", "reorderDuplicates swap", "reorderDuplicates", s47pDuplicateSpec(false), s47pArgs{})
	add("helpers", "reorderDuplicates swap reversed", "reorderDuplicates", s47pDuplicateSpec(true), s47pArgs{})
	middle := &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 40, 40), s47pNode(2, 0, 200, 40, 40)},
		Edges: []s47pEdgeSpec{s47pEdge(1, 2, 10, 40, 10, 200), s47pEdge(1, 2, 20, 40, 20, 200), s47pEdge(1, 2, 30, 40, 30, 200)},
	}
	middle.Edges[1].Label = &s47pLabel{Text: "mid"}
	middle.Edges[2].Label = &s47pLabel{Text: "last"}
	add("helpers", "reorderDuplicates swap first", "reorderDuplicates", middle, s47pArgs{})
	add("helpers", "reorderDuplicates horizontal", "reorderDuplicates", &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 40, 40), s47pNode(2, 200, 0, 40, 40)},
		Edges: []s47pEdgeSpec{s47pEdge(1, 2, 40, 10, 200, 10), {From: 1, To: 2, Points: s47pPts(40, 20, 200, 20), Label: &s47pLabel{Text: "l"}}, s47pEdge(2, 1, 200, 30, 40, 30), {From: 1, To: 2, Points: s47pPts(40, 35, 200, 35), Dst: "triangle"}},
	}, s47pArgs{})

	traceSpec := &s47pSpec{
		Nodes: []s47pNodeSpec{
			{ID: 1, X: 0, Y: 0, W: 100, H: 100, Is3D: true},
			{ID: 2, X: 300, Y: 0, W: 100, H: 100, Multiple: true},
			{ID: 3, X: 0, Y: 300, W: 100, H: 100, Shape: "Hexagon", Is3D: true},
			{ID: 4, X: 300, Y: 300, W: 100, H: 100, Shape: "Table"},
		},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 100, 50, 300, 50),
			s47pEdge(1, 2, 50, 0, 50, -50, 350, -50, 350, 0),
			s47pEdge(2, 4, 350, 100, 350, 300),
			s47pEdge(1, 1, 100, 25, 100, 30),
			{From: 1, To: 2, Points: s47pPts(5, 5)},
			s47pEdge(4, 2, 400, 350, 450, 350, 450, 50, 400, 50),
			s47pEdge(1, 4, 75, 0, 75, 50),
		},
	}
	for e := range traceSpec.Edges {
		add("helpers", fmt.Sprintf("trace edge %d", e), "trace", traceSpec, s47pArgs{Edge: e})
	}
	traceStage := *traceSpec
	traceStage.Edges = append([]s47pEdgeSpec(nil), traceSpec.Edges...)
	traceStage.Edges[4] = s47pEdge(1, 2, 5, 5, 5, 6)
	add("helpers", "trace stage", "atomic", &traceStage, s47pArgs{Entry: "trace"})

	// Balance kernels.
	add("balance", "removeDuplicates collapse", "removeDuplicates", &s47pSpec{}, s47pArgs{Points: s47pPts(1, 1, 1, 1, 1, 1)})
	add("balance", "removeDuplicates mixed", "removeDuplicates", &s47pSpec{}, s47pArgs{Points: s47pPts(0, 0, 0, 0, 0, 10, 0, 10, 5, 10, 0, 10)})
	add("balance", "removeDuplicates single", "removeDuplicates", &s47pSpec{}, s47pArgs{Points: s47pPts(3, 4)})
	add("balance", "removeDuplicates nil", "removeDuplicates", &s47pSpec{}, s47pArgs{})
	add("balance", "removeDuplicates negative zero", "removeDuplicates", &s47pSpec{}, s47pArgs{Points: s47pPts(0, 0, math.Copysign(0, -1), 0, 1, 0)})
	balance := s47pBalanceSpec()
	add("balance", "nodeSegments horizontal", "nodeSegments", balance, s47pArgs{Nodes: []int64{1, 2, 3}, IsH: true})
	add("balance", "nodeSegments vertical", "nodeSegments", balance, s47pArgs{Nodes: []int64{4, 1}})
	add("balance", "edgeSegments vertical", "edgeSegments", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}})
	add("balance", "edgeSegments horizontal", "edgeSegments", balance, s47pArgs{Edges: []int{4, 0}, IsH: true})
	add("balance", "segmentBounds vertical", "segmentBounds", nil, s47pArgs{Start: s47pP(100, 100), End: s47pP(100, 400), Buffer: 40,
		Points: s47pPts(0, 0, 0, 500, 300, 0, 300, 500, 150, 50, 150, 450, 50, 600, 50, 700, 120, -100, 120, 50)})
	add("balance", "segmentBounds horizontal", "segmentBounds", nil, s47pArgs{Start: s47pP(0, 100), End: s47pP(200, 100), Buffer: 40,
		Points: s47pPts(0, 0, 300, 0, 0, 300, 300, 300, -100, 150, 100, 150)})
	add("balance", "segmentBounds degenerate", "segmentBounds", nil, s47pArgs{Start: s47pP(5, 5), End: s47pP(5, 5), Buffer: 40, Points: s47pPts(0, 0, 0, 10)})
	add("balance", "segmentBounds none", "segmentBounds", nil, s47pArgs{Start: s47pP(5, 5), End: s47pP(5, 50), Buffer: 0})
	for _, d := range [][3]float64{{0, 100, 3}, {0, 100, 0}, {10, 10, 2}, {0, 3, 5}, {-50, 50, 1}, {0, 7, 2}, {20, 10, 1}} {
		add("balance", fmt.Sprintf("distribute %v", d), "distribute", nil, s47pArgs{Floor: s47pF(d[0]), Ceil: s47pF(d[1]), Count: int(d[2])})
	}
	add("balance", "balanceOrder preserved", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{145}})
	add("balance", "balanceOrder far move", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{160}})
	add("balance", "balanceOrder reversed", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{130}})
	add("balance", "balanceOrder contact", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{140}})
	add("balance", "balanceOrder reversed pair", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{2, 3}, Proposed: []s47pF{125, 115}})
	add("balance", "reversal adds crossing", "reversal", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{110}})
	add("balance", "balanceOrder not moving", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3, 4}, Proposed: []s47pF{140, 150}})
	add("balance", "balanceOrder batch pair", "balanceOrder", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3, 4}, Proposed: []s47pF{130, 170}})
	add("balance", "reversal removes crossing", "reversal", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{160}})
	add("balance", "reversal pointer conflict", "reversal", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3, 3}, Proposed: []s47pF{160, 161}})
	add("balance", "reversal diagonal", "reversal", balance, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: false, Batch: []int{0}, Proposed: []s47pF{260}})
	curve := s47pBalanceSpec()
	curve.Edges[2].Curve = true
	add("balance", "reversal curve", "reversal", curve, s47pArgs{Edges: []int{0, 1, 2, 3, 4}, IsH: true, Batch: []int{3}, Proposed: []s47pF{160}})
	add("balance", "balanceRegular all", "balanceRegular", s47pBalanceSpec(), s47pArgs{Regular: []int{0, 1, 2, 3, 4}})
	add("balance", "balanceRegular special", "balanceRegular", s47pBalanceSpec(), s47pArgs{Special: []int{3}, Regular: []int{0, 1, 2, 4}})
	diamond := s47pBalanceSpec()
	diamond.Nodes[3].Shape = "Diamond"
	add("balance", "balanceRegular diamond ports", "balanceRegular", diamond, s47pArgs{Regular: []int{0, 1, 2, 3, 4}})
	unit := s47pBalanceSpec()
	unit.Nodes = append(unit.Nodes, s47pNode(5, 119, 249, 1, 1))
	add("balance", "balanceRegular unit node", "balanceRegular", unit, s47pArgs{Regular: []int{0, 1, 2, 3, 4}})
	clustered := &s47pSpec{
		Nodes: []s47pNodeSpec{
			s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 0, 100, 100), s47pNode(3, 300, 200, 100, 100), s47pNode(4, 300, 400, 100, 100),
			{ID: 5, X: 300, Y: 0, W: 100, H: 500, NotInGraph: true},
		},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 100, 50, 200, 50, 200, 50, 300, 50),
			s47pEdge(1, 3, 100, 50, 210, 50, 210, 250, 300, 250),
			s47pEdge(1, 4, 100, 75, 190, 75, 190, 450, 300, 450),
		},
		Clusters: []s47pClusterSpec{{Vessel: 5, Nodes: []int64{2, 3, 4}, Arrangement: "Column", Desired: "Column"}},
	}
	add("balance", "balanceRegular cluster column", "balanceRegular", clustered, s47pArgs{Regular: []int{0, 1, 2}})
	add("balance", "special edges", "special", &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 100, 100), s47pNode(2, 300, 0, 100, 100), {ID: 3, X: 0, Y: 300, W: 100, H: 100, Shape: "Diamond"}, s47pNode(4, 300, 300, 101, 100)},
		Edges: []s47pEdgeSpec{
			s47pEdge(1, 2, 100, 50, 300, 50),
			s47pEdge(1, 2, 100, 50, 300, 51),
			s47pEdge(1, 3, 50, 100, 50, 300),
			{From: 1, To: 2, Points: s47pPts(100, 20, 300, 20), FromCol: s47pIntPtr(0)},
			s47pEdge(1, 1, 0, 50, -20, 50, -20, 20, 0, 20),
			s47pEdge(2, 4, 350, 100, 351, 300),
			s47pEdge(4, 2, 350, 300, 350, 100),
		},
		Trees: []int64{4},
	}, s47pArgs{})

	// Route stage.
	stageSpec := s47pChainSpec()
	for _, extras := range [][]int{nil, {0, 0, -1, 1}, {2}} {
		add("stage", fmt.Sprintf("capture extras %v", extras), "capture", stageSpec, s47pArgs{Extras: extras})
	}
	containerStage := &s47pSpec{
		Nodes: []s47pNodeSpec{
			s47pNode(1, 0, 0, 500, 500),
			{ID: 2, X: 10, Y: 10, W: 50, H: 50, Container: 1},
			{ID: 3, X: 100, Y: 10, W: 50, H: 50, Container: 1},
			s47pNode(4, 600, 0, 50, 50),
			{ID: 5, X: 600, Y: 300, W: 300, H: 100, NotInGraph: true},
			{ID: 6, X: 610, Y: 310, W: 50, H: 50, NotInGraph: true},
		},
		Edges:    []s47pEdgeSpec{s47pEdge(2, 4, 60, 25, 600, 25), {From: 6, To: 4, Points: s47pPts(635, 310, 635, 50), NotInGraph: true}},
		Clusters: []s47pClusterSpec{{Vessel: 5, Nodes: []int64{6}, Arrangement: "Row", Desired: "Row"}},
	}
	add("stage", "capture container and cluster descendants", "capture", containerStage, s47pArgs{Extras: []int{1}})
	add("stage", "capture nil graph members", "capture", &s47pSpec{Nodes: []s47pNodeSpec{s47pNode(1, 0, 0, 10, 10)}, NilNode: true, NilEdge: true}, s47pArgs{})

	malformed := func(mutate func(spec *s47pSpec)) *s47pSpec {
		spec := s47pChainSpec()
		mutate(spec)
		return spec
	}
	validateCases := []struct {
		name string
		spec *s47pSpec
		args s47pArgs
	}{
		{"valid", s47pChainSpec(), s47pArgs{}},
		{"valid with extras", s47pChainSpec(), s47pArgs{Extras: []int{0, 1, 0}}},
		{"one point", malformed(func(s *s47pSpec) { s.Edges[1].Points = s47pPts(1, 2) }), s47pArgs{}},
		{"empty route", malformed(func(s *s47pSpec) { s.Edges[1].Points = []s47pPt{} }), s47pArgs{}},
		{"nil route", malformed(func(s *s47pSpec) { s.Edges[1].NilPoints = true }), s47pArgs{}},
		{"nil point", malformed(func(s *s47pSpec) { s.Edges[2].Points[1] = nil }), s47pArgs{}},
		{"nan point", malformed(func(s *s47pSpec) { s.Edges[0].Points[2] = s47pP(math.NaN(), 0) }), s47pArgs{}},
		{"inf point", malformed(func(s *s47pSpec) { s.Edges[0].Points[3] = s47pP(0, math.Inf(1)) }), s47pArgs{}},
		{"negative inf point", malformed(func(s *s47pSpec) { s.Edges[0].Points[0] = s47pP(math.Inf(-1), 0) }), s47pArgs{}},
		{"negative dimensions", malformed(func(s *s47pSpec) { s.Nodes[2].W = -50; s.Nodes[2].H = -1 }), s47pArgs{}},
		{"unplaced node", malformed(func(s *s47pSpec) { s.Nodes[1].Unplaced = true }), s47pArgs{}},
		{"nil graph node", malformed(func(s *s47pSpec) { s.NilNode = true }), s47pArgs{}},
		{"nil graph edge", malformed(func(s *s47pSpec) { s.NilEdge = true }), s47pArgs{}},
		{"nil extra edge", s47pChainSpec(), s47pArgs{Extras: []int{0, -1}}},
		{"foreign source", malformed(func(s *s47pSpec) {
			s.Nodes = append(s.Nodes, s47pNodeSpec{ID: 9, X: 1, Y: 1, W: 1, H: 1, NotInGraph: true})
			s.Edges[2].From = 9
		}), s47pArgs{}},
		{"foreign target", malformed(func(s *s47pSpec) {
			s.Nodes = append(s.Nodes, s47pNodeSpec{ID: 9, X: 1, Y: 1, W: 1, H: 1, NotInGraph: true})
			s.Edges[0].To = 9
		}), s47pArgs{}},
		{"foreign extra edge endpoint unplaced", malformed(func(s *s47pSpec) {
			s.Nodes = append(s.Nodes, s47pNodeSpec{ID: 9, W: 1, H: 1, NotInGraph: true, Unplaced: true})
			s.Edges = append(s.Edges, s47pEdgeSpec{From: 1, To: 9, Points: s47pPts(0, 0, 1, 1), NotInGraph: true})
		}), s47pArgs{Extras: []int{3}}},
		{"invalid label position", malformed(func(s *s47pSpec) { s.Edges[0].Label.Pos = int(label.BorderTopLeft) }), s47pArgs{}},
		{"invalid source arrowhead label", malformed(func(s *s47pSpec) { s.Edges[1].SrcLabel = &s47pLabel{Text: "x", Pos: int(label.InsideTopLeft)} }), s47pArgs{}},
		{"valid target arrowhead label", malformed(func(s *s47pSpec) { s.Edges[1].DstLabel = &s47pLabel{Text: "x", Pos: int(label.OutsideBottomRight)} }), s47pArgs{}},
		{"too many extras", s47pChainSpec(), s47pArgs{ExtraCount: int(layoutgraph.MaxTopologyReferences) + 1}},
		{"route capacity", s47pChainSpec(), s47pArgs{HugeRoute: true}},
	}
	for _, v := range validateCases {
		add("stage", "validate "+v.name, "validate", v.spec, v.args)
	}

	bboxSpec := s47pChainSpec()
	bboxSpec.Edges[1].SrcLabel = &s47pLabel{Text: "s", W: 20, H: 10}
	bboxSpec.Edges[2].DstLabel = &s47pLabel{Text: "t", W: 22, H: 11}
	add("stage", "bbox labels", "bbox", bboxSpec, s47pArgs{})
	add("stage", "bbox plain", "bbox", &s47pSpec{
		Nodes: []s47pNodeSpec{s47pNode(1, 0.4, -0.6, 10, 10), s47pNode(2, 100, 100, 10.5, 10)},
		Edges: []s47pEdgeSpec{s47pEdge(1, 2, -40.5, 5, 105, 5, 105, 100), {From: 1, To: 2, Points: []s47pPt{}}},
	}, s47pArgs{})

	sortCases := map[string][]float64{
		"empty":       {},
		"single":      {3},
		"ties":        {2, 1, 2, 1, 2, 1, 0, 2},
		"reversed":    {9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1},
		"nan":         {3, math.NaN(), 1, 2, math.NaN(), 0},
		"signed zero": {0, math.Copysign(0, -1), 0, -1, math.Copysign(0, -1)},
	}
	sortNames := make([]string, 0, len(sortCases))
	for name := range sortCases {
		sortNames = append(sortNames, name)
	}
	sort.Strings(sortNames)
	for _, name := range sortNames {
		var values []s47pSortItem
		for i, k := range sortCases[name] {
			values = append(values, s47pSortItem{K: s47pF(k), ID: i})
		}
		add("stage", "sort "+name, "sort", &s47pSpec{}, s47pArgs{Values: values})
	}
	var lcg uint32 = 12345
	var large []s47pSortItem
	for i := 0; i < 1500; i++ {
		lcg = lcg*1103515245 + 12345
		large = append(large, s47pSortItem{K: s47pF(float64(lcg>>16) / 97), ID: i})
	}
	add("stage", "sort large", "sort", &s47pSpec{}, s47pArgs{Values: large})
	for _, n := range []int{0, 1, 2, 3, 7, 8, 9, 1000} {
		add("stage", fmt.Sprintf("reserveSort %d", n), "reserveSort", &s47pSpec{}, s47pArgs{Count: n})
	}

	// Atomic stage boundaries.
	mutations := []s47pScriptOp{
		{Op: "point", E: 0, I: 1, X: 11, Y: 12},
		{Op: "reverse", E: 1},
		{Op: "replace", E: 2, Pts: s47pPts(1, 1, 2, 2, 3, 3)},
		{Op: "swap", E: 0, F: 1},
		{Op: "label", E: 0, V: 77},
		{Op: "cell", V: 31},
		{Op: "costs", V: 5},
		{Op: "move", N: 1, X: -5, Y: -6},
		{Op: "nudge", N: 2, X: 9},
		{Op: "graph", N: 3},
		{Op: "curve", E: 1},
		{Op: "step"},
	}
	withTail := func(tail ...s47pScriptOp) []s47pScriptOp {
		return append(append([]s47pScriptOp(nil), mutations...), tail...)
	}
	for _, entry := range []string{"stage", "afterPreflight", "withGuard", "validated"} {
		add("atomic", entry+" success commits", "atomic", s47pChainSpec(), s47pArgs{Entry: entry, Script: withTail()})
		add("atomic", entry+" returned error restores", "atomic", s47pChainSpec(), s47pArgs{Entry: entry, Script: withTail(s47pScriptOp{Op: "fail"})})
		add("atomic", entry+" work limit restores", "atomic", s47pChainSpec(), s47pArgs{Entry: entry, Limit: 200, Script: withTail(s47pScriptOp{Op: "add", V: 1000})})
		add("atomic", entry+" panic restores", "atomic", s47pChainSpec(), s47pArgs{Entry: entry, Script: withTail(s47pScriptOp{Op: "panic"})})
		add("atomic", entry+" extras restored", "atomic", containerStage, s47pArgs{Entry: entry, Extras: []int{1}, Script: []s47pScriptOp{
			{Op: "point", E: 1, I: 0, X: 1, Y: 2}, {Op: "move", N: 6, X: 3, Y: 4}, {Op: "nudge", N: 2, X: 5}, {Op: "graph", N: 6}, {Op: "fail"},
		}})
	}
	for at := 1; at <= 6; at++ {
		add("atomic", fmt.Sprintf("cancellation at %d", at), "atomic", s47pChainSpec(), s47pArgs{Entry: "afterPreflight", CancelAt: at, Script: withTail(s47pScriptOp{Op: "add", V: 2000})})
	}
	add("atomic", "preflight rejects malformed geometry", "atomic", malformed(func(s *s47pSpec) { s.Edges[0].Points[1] = nil }), s47pArgs{Entry: "afterPreflight", Script: withTail()})
	add("atomic", "stage validation rejects unplaced", "atomic", malformed(func(s *s47pSpec) { s.Nodes[0].Unplaced = true }), s47pArgs{Entry: "afterPreflight", Script: withTail()})
	add("atomic", "capture work limit", "atomic", s47pChainSpec(), s47pArgs{Entry: "afterPreflight", Limit: 30, Script: withTail()})
	add("atomic", "finish limit after mutation", "atomic", s47pChainSpec(), s47pArgs{Entry: "afterPreflight", CancelAt: 5, Script: withTail()})
	add("atomic", "trace stage limit", "atomic", &traceStage, s47pArgs{Entry: "trace", Limit: 40})
	return cases
}

// ─── Non-guarded and dispatch ────────────────────────────────────────────────

func s47pEvaluate(c s47pCase) any {
	switch c.Op {
	case "routeCost":
		sg := c.Spec.build()
		return s47pF(estimateRouteCost(layoutgraph.Edges(sg.others(c.Args)), sg.edges[c.Args.Edge]))
	case "crossingMatrix":
		sg := c.Spec.build()
		matrix := [][]int64{}
		pairs := []any{}
		for _, e := range sg.edges {
			row := []int64{}
			for _, o := range sg.edges {
				row = append(row, countNonSharedCrossings(e, o))
			}
			matrix = append(matrix, row)
		}
		for i, e := range sg.edges {
			for j, o := range sg.edges {
				for a := 0; a < len(e.Points)-1; a++ {
					for b := 0; b < len(o.Points)-1; b++ {
						if isNonSharedCrossing(e, o, a, b) {
							pairs = append(pairs, []int{i, j, a, b})
						}
					}
				}
			}
		}
		return map[string]any{"matrix": matrix, "pairs": pairs}
	case "signs":
		out := []any{}
		pts := c.Args.Points
		for i := 0; i+3 < len(pts); i += 4 {
			p := func(k int) *geo.Point { return geo.NewPoint(float64(pts[i+k][0]), float64(pts[i+k][1])) }
			a, b, cc, d := p(0), p(1), p(2), p(3)
			o1, o2 := orientation(a, b, cc), orientation(a, b, d)
			out = append(out, []any{nonParallelIntersection(a, b, cc, d), equalSigns(o1, o2), s47pF(o1), s47pF(o2)})
		}
		return out
	case "segmentEndpoints":
		sg := c.Spec.build()
		routes := s47pBuildRoutes(sg, c.Args.Routes)
		points := routes[0].createSegmentEndpoints()
		out := []any{}
		for _, p := range points {
			out = append(out, s47pEncPoint(p))
		}
		return out
	case "colinear":
		sg := c.Spec.build()
		route := s47pBuildRoutes(sg, c.Args.Routes)[0]
		out := []any{}
		pts := c.Args.Points
		for i := 0; i+1 < len(pts); i += 2 {
			from := NewOVGNode(geo.NewPoint(float64(pts[i][0]), float64(pts[i][1])))
			to := NewOVGNode(geo.NewPoint(float64(pts[i+1][0]), float64(pts[i+1][1])))
			out = append(out, []bool{route.isEntireColinear(from, to), route.isOpposingColinear(from, to)})
		}
		return out
	case "special":
		sg := c.Spec.build()
		out := []bool{}
		for _, e := range sg.edges {
			out = append(out, isSpecialEdgeForBalancing(sg.g, e))
		}
		return out
	case "atomic":
		return s47pRunAtomic(c)
	case "edgeCanOverlapSearch":
		sg := c.Spec.build()
		run := func(ctx context.Context, limit uint64) s47pRun {
			guard, err := newRouteSearchWorkGuard(ctx, TopDownLeftRight, limit)
			if err != nil {
				return s47pRun{Err: err.Error()}
			}
			value, err := edgeCanOverlapEdgesGuarded(sg.edges[c.Args.Edge], sg.edgeList(c.Args.Others), nil, nil, guard)
			if err != nil {
				return s47pRun{Used: guard.used, Err: err.Error()}
			}
			return s47pRun{Value: value, Used: guard.used}
		}
		withDone, cancel := context.WithCancel(context.Background())
		defer cancel()
		canceled, cancelNow := context.WithCancel(context.Background())
		cancelNow()
		return map[string]any{
			"background": run(context.Background(), s47pBigLimit),
			"done":       run(withDone, s47pBigLimit),
			"under":      run(context.Background(), 5),
			"canceled":   run(canceled, s47pBigLimit),
		}
	}
	return s47pSweepRun(s47pGuardedOp(c))
}

type s47pFixture struct {
	Location string       `json:"location"`
	BigLimit uint64       `json:"bigLimit"`
	PQ       []s47pPQCase `json:"pq"`
	Cases    []s47pCase   `json:"cases"`
}

func s47pBuildFixture() s47pFixture {
	fixture := s47pFixture{Location: s47pLocation, BigLimit: s47pBigLimit}
	for _, c := range s47pPQCases() {
		c.Out = s47pRunPQ(c)
		fixture.PQ = append(fixture.PQ, c)
	}
	for _, c := range s47pCases() {
		c.Out = s47pEvaluate(c)
		fixture.Cases = append(fixture.Cases, c)
	}
	return fixture
}

func TestGoSlice47PrimitivesOracle(t *testing.T) {
	fixture := s47pBuildFixture()
	data, err := json.MarshalIndent(fixture, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice47-primitives-reference.json")
	if os.Getenv("TALA_SLICE47_ORACLE") == "1" {
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read committed fixture (regenerate with TALA_SLICE47_ORACLE=1): %v", err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, data) {
		t.Fatalf("Slice 47 primitives fixture is stale; regenerate with TALA_SLICE47_ORACLE=1")
	}
	// Sanity: atomic failures must leave the graph exactly as it started.
	for _, c := range fixture.Cases {
		if out, ok := c.Out.(s47pAtomicOut); ok && (out.Err != "" || out.Panic != "") && out.Changed {
			t.Errorf("%s: failed stage changed the graph", c.Name)
		}
	}
	if !strings.Contains(string(data), "context canceled") {
		t.Error("fixture has no cancellation probe")
	}
}
