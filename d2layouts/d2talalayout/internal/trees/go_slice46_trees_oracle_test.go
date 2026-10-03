package trees

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 46 trees oracle. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-trees-reference.json; otherwise it recomputes
// every value and asserts the committed fixture byte for byte.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s46Node struct {
	ID        uint64  `json:"id"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	Placed    bool    `json:"placed,omitempty"`
	X         float64 `json:"x,omitempty"`
	Y         float64 `json:"y,omitempty"`
	Fixed     bool    `json:"fixed,omitempty"`
	FX        float64 `json:"fx,omitempty"`
	FY        float64 `json:"fy,omitempty"`
	Container uint64  `json:"container,omitempty"`
	Shape     string  `json:"shape,omitempty"`
	// Detached nodes are not added to the graph (sequence members, foreign
	// containers).
	Detached bool `json:"detached,omitempty"`
}

type s46Edge struct {
	From   uint64    `json:"from"`
	To     uint64    `json:"to"`
	Src    string    `json:"src,omitempty"`
	Dst    string    `json:"dst,omitempty"`
	MinW   int       `json:"minW,omitempty"`
	MinH   int       `json:"minH,omitempty"`
	Label  bool      `json:"label,omitempty"`
	Points []float64 `json:"points,omitempty"`
}

type s46Seq struct {
	Vessel  uint64   `json:"vessel"`
	Members []uint64 `json:"members"`
}

type s46Dir struct {
	Container uint64 `json:"container"`
	Dir       int    `json:"dir"`
}

type s46Spec struct {
	Nodes      []s46Node   `json:"nodes"`
	Edges      []s46Edge   `json:"edges,omitempty"`
	Nears      [][2]uint64 `json:"nears,omitempty"`
	Sequences  []s46Seq    `json:"sequences,omitempty"`
	Directions []s46Dir    `json:"directions,omitempty"`
}

type s46Built struct {
	g     *layoutgraph.Graph
	nodes []*layoutgraph.Node
	byID  map[uint64]*layoutgraph.Node
	edges []*layoutgraph.Edge
}

func (spec s46Spec) build() s46Built {
	b := s46Built{byID: map[uint64]*layoutgraph.Node{}}
	g := layoutgraph.NewGraph()
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		if ns.Placed {
			n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		b.byID[ns.ID] = n
		b.nodes = append(b.nodes, n)
		if ns.Detached {
			continue
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = b.byID[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
	}
	for _, es := range spec.Edges {
		e := g.Connect(b.byID[es.From], b.byID[es.To])
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		e.MinWidth = es.MinW
		e.MinHeight = es.MinH
		if es.Label {
			e.Label = &layoutgraph.Label{Text: "label", Width: float64(es.MinW), Height: float64(es.MinH)}
		}
		// Exact capacity: GraphState charges cap(edge.Points), which JS
		// arrays cannot express, so specs never carry spare route capacity.
		if len(es.Points) > 0 {
			e.Points = make([]*geo.Point, 0, len(es.Points)/2)
		}
		for i := 0; i+1 < len(es.Points); i += 2 {
			e.Points = append(e.Points, geo.NewPoint(es.Points[i], es.Points[i+1]))
		}
		b.edges = append(b.edges, e)
	}
	for _, pair := range spec.Nears {
		b.byID[pair[0]].Nears[b.byID[pair[1]]] = struct{}{}
	}
	for _, s := range spec.Sequences {
		seq := &layoutgraph.Sequence{Vessel: b.byID[s.Vessel], Graph: g}
		for _, id := range s.Members {
			member := b.byID[id]
			member.Graph = g
			member.Sequence = seq
			seq.Nodes = append(seq.Nodes, member)
		}
		g.Sequences[b.byID[s.Vessel]] = seq
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Container != 0 {
			container = b.byID[d.Container]
		}
		g.Directions[container] = geo.Orientation(d.Dir)
	}
	b.g = g
	return b
}

// ── Observable state ─────────────────────────────────────────────────────────

type s46TreeDump struct {
	Node        uint64        `json:"n"`
	Parent      uint64        `json:"p"`
	Edge        int           `json:"e"`
	Orientation int           `json:"o"`
	Children    []s46TreeDump `json:"c,omitempty"`
}

type s46TreeEntry struct {
	Sentinel uint64        `json:"s"`
	Roots    []s46TreeDump `json:"roots"`
}

type s46State struct {
	Nodes         [][]float64    `json:"nodes"`
	NodeEdges     [][]int        `json:"nodeEdges"`
	NodeContainer []uint64       `json:"nodeContainer"`
	NodeInGraph   []bool         `json:"nodeInGraph"`
	GraphNodes    []uint64       `json:"graphNodes"`
	GraphEdges    []int          `json:"graphEdges"`
	Containers    [][]uint64     `json:"containers"`
	Trees         []s46TreeEntry `json:"trees"`
	NodeToTree    [][]uint64     `json:"nodeToTree"`
	Labels        [][]float64    `json:"labels,omitempty"`
	Descendants   [][]uint64     `json:"descendants"`
}

func s46ID(n *layoutgraph.Node) uint64 {
	if n == nil {
		return 0
	}
	return uint64(n.ID)
}

func (b s46Built) state() s46State {
	st := s46State{
		Nodes: [][]float64{}, NodeEdges: [][]int{}, NodeContainer: []uint64{}, NodeInGraph: []bool{},
		GraphNodes: []uint64{}, GraphEdges: []int{}, Containers: [][]uint64{}, Trees: []s46TreeEntry{},
		NodeToTree: [][]uint64{}, Descendants: [][]uint64{},
	}
	edgeIndex := map[*layoutgraph.Edge]int{}
	for i, e := range b.edges {
		edgeIndex[e] = i
	}
	idx := func(e *layoutgraph.Edge) int {
		if e == nil {
			return -1
		}
		if i, ok := edgeIndex[e]; ok {
			return i
		}
		return -2
	}
	for _, n := range b.nodes {
		if n.TopLeft == nil {
			st.Nodes = append(st.Nodes, []float64{n.Width, n.Height})
		} else {
			st.Nodes = append(st.Nodes, []float64{n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height})
		}
		edges := []int{}
		for _, e := range n.Edges {
			edges = append(edges, idx(e))
		}
		st.NodeEdges = append(st.NodeEdges, edges)
		st.NodeContainer = append(st.NodeContainer, s46ID(n.Container))
		st.NodeInGraph = append(st.NodeInGraph, n.Graph == b.g)
	}
	g := b.g
	for _, n := range g.Nodes {
		st.GraphNodes = append(st.GraphNodes, s46ID(n))
	}
	for _, e := range g.Edges {
		st.GraphEdges = append(st.GraphEdges, idx(e))
	}
	containerKeys := make([]*layoutgraph.Node, 0, len(g.Containers))
	for k := range g.Containers {
		containerKeys = append(containerKeys, k)
	}
	sort.Slice(containerKeys, func(i, j int) bool { return s46ID(containerKeys[i]) < s46ID(containerKeys[j]) })
	for _, k := range containerKeys {
		row := []uint64{s46ID(k)}
		for _, c := range g.Containers[k] {
			row = append(row, s46ID(c))
		}
		st.Containers = append(st.Containers, row)
	}
	inTrees := map[*layoutgraph.Tree]bool{}
	var dump func(t *layoutgraph.Tree) s46TreeDump
	dump = func(t *layoutgraph.Tree) s46TreeDump {
		inTrees[t] = true
		d := s46TreeDump{Node: s46ID(t.Node), Edge: idx(t.SentinelEdge), Orientation: int(t.Orientation)}
		if t.Parent != nil {
			d.Parent = s46ID(t.Parent.Node)
		}
		for _, c := range t.Children {
			d.Children = append(d.Children, dump(c))
		}
		return d
	}
	treeKeys := make([]*layoutgraph.Node, 0, len(g.Trees))
	for k := range g.Trees {
		treeKeys = append(treeKeys, k)
	}
	sort.Slice(treeKeys, func(i, j int) bool { return s46ID(treeKeys[i]) < s46ID(treeKeys[j]) })
	for _, k := range treeKeys {
		entry := s46TreeEntry{Sentinel: s46ID(k), Roots: []s46TreeDump{}}
		for _, root := range g.Trees[k] {
			entry.Roots = append(entry.Roots, dump(root))
			row := []uint64{s46ID(root.Node)}
			for _, d := range Descendants(root) {
				row = append(row, s46ID(d.Node))
			}
			st.Descendants = append(st.Descendants, row)
		}
		st.Trees = append(st.Trees, entry)
	}
	nodeKeys := make([]*layoutgraph.Node, 0, len(g.NodeToTree))
	for k := range g.NodeToTree {
		nodeKeys = append(nodeKeys, k)
	}
	sort.Slice(nodeKeys, func(i, j int) bool { return s46ID(nodeKeys[i]) < s46ID(nodeKeys[j]) })
	for _, k := range nodeKeys {
		t := g.NodeToTree[k]
		var parent uint64
		if t.Parent != nil {
			parent = s46ID(t.Parent.Node)
		}
		in := uint64(0)
		if inTrees[t] {
			in = 1
		}
		st.NodeToTree = append(st.NodeToTree, []uint64{s46ID(k), s46ID(t.Node), parent, in})
	}
	for i, e := range b.edges {
		if e.Label != nil {
			st.Labels = append(st.Labels, []float64{float64(i), float64(e.Label.Position), e.LabelPercentage})
		}
	}
	return st
}

func s46StateEqual(a, b s46State) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return bytes.Equal(ja, jb)
}

func s46Err(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// s46Ctx returns context.Canceled from the cancelAt-th Err call and panics
// once at the panicAt-th call.
type s46Ctx struct {
	context.Context
	calls    int
	cancelAt int
	panicAt  int
}

func (ctx *s46Ctx) Err() error {
	ctx.calls++
	if ctx.panicAt > 0 && ctx.calls == ctx.panicAt {
		panic("slice46 tree probe panic")
	}
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

// ── Oracle data ──────────────────────────────────────────────────────────────

type s46Probe struct {
	At       int       `json:"at"`
	Error    string    `json:"error"`
	Canceled bool      `json:"canceled"`
	Restored bool      `json:"restored"`
	State    *s46State `json:"state,omitempty"`
}

type s46Case struct {
	Group         string     `json:"group"`
	Name          string     `json:"name"`
	Spec          s46Spec    `json:"spec"`
	Op            string     `json:"op"`
	Container     uint64     `json:"container,omitempty"`
	Orientation   int        `json:"orientation,omitempty"`
	Error         string     `json:"error"`
	State         s46State   `json:"state"`
	W             int64      `json:"w,omitempty"`
	BelowError    string     `json:"belowError,omitempty"`
	BelowRestored bool       `json:"belowRestored,omitempty"`
	Calls         int        `json:"calls,omitempty"`
	Stride        int        `json:"stride,omitempty"`
	Probes        []s46Probe `json:"probes,omitempty"`
	Panics        []s46Probe `json:"panics,omitempty"`
}

type s46Oracle struct {
	Cases []s46Case `json:"cases"`
}

// prepare builds a spec and, for place-like ops, runs the background
// preprocessing pass that real pipelines run before placement.
func (c s46Case) prepare(t *testing.T) s46Built {
	b := c.Spec.build()
	if c.Op != "preprocess" {
		if err := Preprocess(context.Background(), b.g); err != nil {
			t.Fatalf("%s: preprocess: %v", c.Name, err)
		}
	}
	return b
}

func (c s46Case) container(b s46Built) *layoutgraph.Node {
	if c.Container == 0 {
		return nil
	}
	return b.byID[c.Container]
}

func (c s46Case) run(t *testing.T, ctx context.Context, limit int64) (s46Built, s46State, error) {
	b := c.prepare(t)
	initial := b.state()
	var err error
	switch c.Op {
	case "preprocess":
		if limit == 0 {
			err = Preprocess(ctx, b.g)
		} else {
			err = preprocessTreesWithWorkLimit(ctx, b.g, limit)
		}
	case "place":
		if limit == 0 {
			err = Place(ctx, b.g, c.container(b))
		} else {
			err = placeTreesWithWorkLimit(ctx, b.g, c.container(b), limit)
		}
	case "construct":
		err = c.construct(ctx, b)
	default:
		t.Fatalf("unknown op %s", c.Op)
	}
	return b, initial, err
}

// construct lays out the first placement tree in one orientation without
// placing it against the graph (orientation transforms + level layout).
func (c s46Case) construct(ctx context.Context, b s46Built) error {
	guard, err := newWorkGuard(ctx, "Slice46Construct")
	if err != nil {
		return err
	}
	placementTrees, err := buildPlacementTrees(b.g, guard)
	if err != nil {
		return err
	}
	if len(placementTrees) == 0 {
		return nil
	}
	tree := placementTrees[0]
	descendants, err := treeDescendants(tree, guard)
	if err != nil {
		return err
	}
	for _, d := range descendants {
		d.Node.TopLeft = new(geo.Point)
	}
	if err := constructToOrientation(tree, geo.Orientation(c.Orientation), guard); err != nil {
		return err
	}
	return positionTreeEdgeLabels(tree, false, guard)
}

func s46Record(t *testing.T, c s46Case, probes bool, boundary bool) s46Case {
	b, _, err := c.run(t, context.Background(), 0)
	c.Error = s46Err(err)
	c.State = b.state()
	// Determinism: every scenario must be independent of Go map order.
	for repeat := 0; repeat < 3; repeat++ {
		again, _, againErr := c.run(t, context.Background(), 0)
		if s46Err(againErr) != c.Error || !s46StateEqual(again.state(), c.State) {
			t.Fatalf("%s: nondeterministic result", c.Name)
		}
	}
	if boundary && err == nil && c.Op != "construct" {
		lo, hi := int64(1), int64(limits.MaxEngineWorkUnits)
		for lo < hi {
			mid := lo + (hi-lo)/2
			if _, _, e := c.run(t, context.Background(), mid); e == nil {
				hi = mid
			} else {
				lo = mid + 1
			}
		}
		c.W = lo
		atW, _, e := c.run(t, context.Background(), lo)
		if e != nil || !s46StateEqual(atW.state(), c.State) {
			t.Fatalf("%s: run at W=%d differs: %v", c.Name, lo, e)
		}
		below, initial, e := c.run(t, context.Background(), lo-1)
		c.BelowError = s46Err(e)
		c.BelowRestored = s46StateEqual(initial, below.state())
		if e == nil || !c.BelowRestored {
			t.Fatalf("%s: W-1 run error=%v restored=%v", c.Name, e, c.BelowRestored)
		}
	}
	if probes {
		count := &s46Ctx{Context: context.Background()}
		if _, _, e := c.run(t, count, 0); s46Err(e) != c.Error {
			t.Fatalf("%s: counting run error %v", c.Name, e)
		}
		c.Calls = count.calls
		c.Stride = max(1, (c.Calls+299)/300)
		for at := 1; at <= c.Calls; at += c.Stride {
			ctx := &s46Ctx{Context: context.Background(), cancelAt: at}
			b, initial, e := c.run(t, ctx, 0)
			p := s46Probe{At: at, Error: s46Err(e), Canceled: errors.Is(e, context.Canceled)}
			after := b.state()
			p.Restored = s46StateEqual(initial, after)
			if !p.Restored {
				p.State = &after
			}
			c.Probes = append(c.Probes, p)
		}
		for _, at := range []int{1, c.Calls / 3, c.Calls / 2, c.Calls - 1} {
			if at < 1 {
				continue
			}
			ctx := &s46Ctx{Context: context.Background(), panicAt: at}
			b := c.prepare(t)
			initial := b.state()
			var recovered any
			func() {
				defer func() { recovered = recover() }()
				switch c.Op {
				case "preprocess":
					_ = Preprocess(ctx, b.g)
				case "place":
					_ = Place(ctx, b.g, c.container(b))
				}
			}()
			after := b.state()
			p := s46Probe{At: at, Error: fmt.Sprint(recovered), Restored: s46StateEqual(initial, after)}
			if !p.Restored {
				p.State = &after
			}
			c.Panics = append(c.Panics, p)
		}
	}
	return c
}

// ── Scenario builders ────────────────────────────────────────────────────────

const s46Tri = "triangle"

func s46N(id uint64, x, y float64) s46Node {
	return s46Node{ID: id, W: 100, H: 100, Placed: true, X: x, Y: y}
}

func s46Small(id uint64, x, y float64) s46Node {
	return s46Node{ID: id, W: 10, H: 10, Placed: true, X: x, Y: y}
}

func s46D(from, to uint64) s46Edge { return s46Edge{From: from, To: to, Dst: s46Tri} }
func s46U(from, to uint64) s46Edge { return s46Edge{From: from, To: to} }
func s46B(from, to uint64) s46Edge {
	return s46Edge{From: from, To: to, Src: s46Tri, Dst: s46Tri}
}

// s46Core returns a three-node cycle (ids 1..3) that keeps attached trees
// from being treated as isolated tree subgraphs.
func s46Core() s46Spec {
	return s46Spec{
		Nodes: []s46Node{s46Small(1, 20, 0), s46Small(2, 40, 0), s46Small(3, 60, 0)},
		Edges: []s46Edge{s46U(1, 2), s46U(2, 3), s46U(3, 1)},
	}
}

func s46ManyBranching(treeCount int) s46Spec {
	spec := s46Core()
	for i := 0; i < treeCount; i++ {
		root := uint64(1000 + 3*i)
		spec.Nodes = append(spec.Nodes,
			s46Small(root, float64(root*20), 0),
			s46Small(root+1, float64((root+1)*20), 0),
			s46Small(root+2, float64((root+2)*20), 0))
		spec.Edges = append(spec.Edges, s46U(1, root), s46U(root, root+1), s46U(root, root+2))
	}
	return spec
}

func s46DeepBranching(depth int) s46Spec {
	spec := s46Core()
	previous := uint64(1)
	for i := 0; i < depth; i++ {
		id := uint64(10_000 + i)
		spec.Nodes = append(spec.Nodes, s46Small(id, float64(i*20), 40))
		spec.Edges = append(spec.Edges, s46D(previous, id))
		previous = id
	}
	for i := 0; i < 2; i++ {
		id := uint64(20_000 + i)
		spec.Nodes = append(spec.Nodes, s46Small(id, float64(i*20), 80))
		spec.Edges = append(spec.Edges, s46D(previous, id))
	}
	return spec
}

func s46Wide(leaves int) s46Spec {
	spec := s46Core()
	spec.Nodes = append(spec.Nodes, s46N(100, 0, 300))
	spec.Edges = append(spec.Edges, s46D(2, 100))
	for i := 0; i < leaves; i++ {
		id := uint64(200 + i)
		w := float64(40 + (i%3)*30)
		spec.Nodes = append(spec.Nodes, s46Node{ID: id, W: w, H: float64(30 + (i%4)*20), Placed: true, X: float64(i * 150), Y: 600})
		spec.Edges = append(spec.Edges, s46D(100, id))
	}
	return spec
}

// Graphs from domain_test.go, ids shifted by one so 0 can mean "root".
func s46DirectedTree() s46Spec {
	return s46Spec{Nodes: []s46Node{
		s46N(1, 200, 0), s46N(2, 0, 200), s46N(3, 200, 200), s46N(4, 100, 400),
		s46N(5, 300, 400), s46N(6, 100, 600), s46N(7, 300, 600),
	}, Edges: []s46Edge{s46D(1, 3), s46D(3, 1), s46D(3, 2), s46D(4, 3), s46D(6, 4), s46D(5, 3), s46D(5, 7)}}
}

func s46UndirectedTree() s46Spec {
	spec := s46DirectedTree()
	for i := range spec.Edges {
		spec.Edges[i].Dst = ""
	}
	return spec
}

func s46MixedTree() s46Spec {
	pos := [][2]float64{{300, 0}, {500, 0}, {700, 0}, {900, 0}, {300, 200}, {800, 200}, {200, 400}, {400, 400},
		{600, 400}, {800, 400}, {1000, 400}, {0, 600}, {200, 600}, {400, 600}, {900, 600}, {1100, 600}}
	spec := s46Spec{}
	for i, p := range pos {
		spec.Nodes = append(spec.Nodes, s46N(uint64(i+1), p[0], p[1]))
	}
	e := func(a, b int) (uint64, uint64) { return uint64(a + 1), uint64(b + 1) }
	bi := func(a, b int) { f, t := e(a, b); spec.Edges = append(spec.Edges, s46B(f, t)) }
	di := func(a, b int) { f, t := e(a, b); spec.Edges = append(spec.Edges, s46D(f, t)) }
	un := func(a, b int) { f, t := e(a, b); spec.Edges = append(spec.Edges, s46U(f, t)) }
	bi(0, 1)
	bi(1, 2)
	bi(2, 3)
	bi(0, 4)
	bi(4, 5)
	bi(5, 4)
	di(6, 4)
	di(4, 7)
	un(5, 9)
	un(9, 10)
	di(7, 8)
	di(11, 6)
	di(12, 6)
	di(7, 13)
	un(10, 14)
	un(10, 15)
	return spec
}

func s46Line(n int, connect func(a, b uint64) s46Edge) s46Spec {
	spec := s46Spec{}
	for i := 0; i < n; i++ {
		spec.Nodes = append(spec.Nodes, s46N(uint64(i+1), float64(i*200), 0))
	}
	for i := 1; i < n; i++ {
		spec.Edges = append(spec.Edges, connect(uint64(i), uint64(i+1)))
	}
	return spec
}

func s46Directed1() s46Spec {
	return s46Spec{Nodes: []s46Node{s46N(1, 200, 0), s46N(2, 400, 0), s46N(3, 0, 200), s46N(4, 200, 200), s46N(5, 400, 200), s46N(6, 600, 200)},
		Edges: []s46Edge{s46D(1, 4), s46D(2, 5), s46D(3, 4), s46D(5, 4), s46D(6, 5)}}
}

func s46Directed2() s46Spec {
	return s46Spec{Nodes: []s46Node{s46N(1, 200, 0), s46N(2, 400, 0), s46N(3, 0, 200), s46N(4, 200, 200), s46N(5, 400, 200), s46N(6, 600, 200)},
		Edges: []s46Edge{s46D(1, 4), s46D(2, 5), s46D(4, 3), s46D(5, 4), s46D(6, 5)}}
}

func s46Directed3() s46Spec {
	return s46Spec{Nodes: []s46Node{s46N(1, 600, 0), s46N(2, 600, 200), s46N(3, 0, 400), s46N(4, 200, 400), s46N(5, 400, 400), s46N(6, 600, 400), s46N(7, 800, 400)},
		Edges: []s46Edge{s46D(1, 2), s46D(2, 5), s46D(7, 6), s46D(6, 5), s46D(5, 4), s46D(4, 3)}}
}

// s46CoreTree attaches a labeled branching tree (root 10) to core node 1.
func s46CoreTree(labels bool, minW, minH int) s46Spec {
	spec := s46Spec{
		Nodes: []s46Node{s46N(1, 0, 0), s46N(2, 300, 0), s46N(3, 150, 300),
			s46N(10, 0, 0), {ID: 11, W: 60, H: 40}, {ID: 12, W: 80, H: 120}, {ID: 13, W: 40, H: 40}, {ID: 14, W: 50, H: 70}},
		Edges: []s46Edge{s46U(1, 2), s46U(2, 3), s46U(3, 1), s46D(1, 10), s46D(10, 11), s46D(10, 12), s46D(12, 13), s46D(12, 14)},
	}
	if labels {
		for i := 3; i < len(spec.Edges); i++ {
			spec.Edges[i].Label = true
			spec.Edges[i].MinW = minW + i*3
			spec.Edges[i].MinH = minH + i*2
		}
	}
	return spec
}

func s46Random(rng *rand.Rand) s46Spec {
	spec := s46Spec{Nodes: []s46Node{s46N(1, 0, 0), s46N(2, 400, 0), s46N(3, 200, 400)},
		Edges: []s46Edge{s46U(1, 2), s46U(2, 3), s46U(3, 1)}}
	next := uint64(10)
	arrow := func() (string, string) {
		switch rng.Intn(4) {
		case 0:
			return "", ""
		case 1:
			return "", s46Tri
		case 2:
			return s46Tri, ""
		default:
			return s46Tri, s46Tri
		}
	}
	trees := 1 + rng.Intn(3)
	for i := 0; i < trees; i++ {
		sentinel := uint64(1 + rng.Intn(3))
		ids := []uint64{sentinel}
		size := 2 + rng.Intn(8)
		dir := rng.Intn(2)
		for j := 0; j < size; j++ {
			id := next
			next++
			spec.Nodes = append(spec.Nodes, s46Node{ID: id, W: float64(20 + rng.Intn(6)*20), H: float64(20 + rng.Intn(6)*20),
				Placed: true, X: float64(id%8) * 200, Y: 800 + float64(id/8)*200})
			parent := ids[rng.Intn(len(ids))]
			e := s46Edge{From: parent, To: id}
			if dir == 1 {
				e = s46Edge{From: id, To: parent}
			}
			if rng.Intn(5) == 0 {
				e.Src, e.Dst = arrow()
			} else {
				e.Dst = s46Tri
			}
			if rng.Intn(3) == 0 {
				e.Label = true
				e.MinW = 10 + rng.Intn(60)
				e.MinH = 10 + rng.Intn(30)
			}
			spec.Edges = append(spec.Edges, e)
			ids = append(ids, id)
		}
	}
	return spec
}

// ── Oracle ───────────────────────────────────────────────────────────────────

func TestSlice46TreesOracle(t *testing.T) {
	oracle := s46Oracle{}
	add := func(c s46Case, probes, boundary bool) {
		oracle.Cases = append(oracle.Cases, s46Record(t, c, probes, boundary))
	}

	// chain
	coreChain := s46Core()
	coreChain.Nodes = append(coreChain.Nodes, s46Small(10, 0, 40), s46Small(11, 0, 80), s46Small(12, 0, 120))
	coreChain.Edges = append(coreChain.Edges, s46D(3, 10), s46D(10, 11), s46D(11, 12))
	add(s46Case{Group: "chain", Name: "chain-core-put-back", Spec: coreChain, Op: "preprocess"}, false, true)
	add(s46Case{Group: "chain", Name: "chain-directed-line", Spec: s46Line(3, s46D), Op: "preprocess"}, false, true)
	add(s46Case{Group: "chain", Name: "chain-undirected-line", Spec: s46Line(5, s46U), Op: "preprocess"}, false, true)
	add(s46Case{Group: "chain", Name: "chain-directed-pair", Spec: s46Line(2, s46D), Op: "preprocess"}, false, true)
	add(s46Case{Group: "chain", Name: "chain-self-loop", Spec: s46Spec{Nodes: []s46Node{s46N(1, 0, 0), s46N(2, 200, 0)},
		Edges: []s46Edge{s46U(1, 1), s46D(1, 2)}}, Op: "preprocess"}, false, true)

	// branching
	add(s46Case{Group: "branching", Name: "branching-directed", Spec: s46DirectedTree(), Op: "preprocess"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-undirected", Spec: s46UndirectedTree(), Op: "preprocess"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-mixed", Spec: s46MixedTree(), Op: "preprocess"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-mixed-place", Spec: s46MixedTree(), Op: "place"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-directed-place", Spec: s46DirectedTree(), Op: "place"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-deep-60", Spec: s46DeepBranching(60), Op: "place"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-wide-12", Spec: s46Wide(12), Op: "place"}, false, true)
	add(s46Case{Group: "branching", Name: "branching-core-tree-place", Spec: s46CoreTree(false, 0, 0), Op: "place"}, true, true)

	// multiple trees
	add(s46Case{Group: "multiple trees", Name: "multiple-many-4", Spec: s46ManyBranching(4), Op: "place"}, true, true)
	add(s46Case{Group: "multiple trees", Name: "multiple-many-12-preprocess", Spec: s46ManyBranching(12), Op: "preprocess"}, true, true)
	twoSentinels := s46ManyBranching(2)
	twoSentinels.Edges[3].From = 2
	add(s46Case{Group: "multiple trees", Name: "multiple-two-sentinels", Spec: twoSentinels, Op: "place"}, false, true)
	isolatedGroups := s46Spec{Nodes: []s46Node{s46N(1, 0, 0),
		s46N(10, 0, 0), s46N(11, 0, 0), s46N(12, 0, 0),
		s46N(20, 0, 0), s46N(21, 0, 0), s46N(22, 0, 0), s46N(23, 0, 0),
		s46N(30, 0, 0), s46N(31, 0, 0)},
		Edges: []s46Edge{
			s46D(1, 10), s46D(10, 11), s46D(10, 12),
			s46D(20, 1), s46D(21, 20), s46D(22, 20), s46D(23, 20),
			s46U(1, 30), s46U(30, 31),
		}}
	add(s46Case{Group: "multiple trees", Name: "multiple-isolated-groups", Spec: isolatedGroups, Op: "preprocess"}, false, true)
	add(s46Case{Group: "multiple trees", Name: "multiple-isolated-groups-place", Spec: isolatedGroups, Op: "place"}, true, true)

	// fixed root
	fixedCore := s46CoreTree(false, 0, 0)
	fixedCore.Nodes[0].Fixed = true
	fixedCore.Nodes[0].FX, fixedCore.Nodes[0].FY = 0, 0
	add(s46Case{Group: "fixed root", Name: "fixed-sentinel-terminal", Spec: fixedCore, Op: "place"}, false, true)
	fixedOther := s46CoreTree(false, 0, 0)
	fixedOther.Nodes[1].Fixed = true
	fixedOther.Nodes[1].FX, fixedOther.Nodes[1].FY = 250, -20
	add(s46Case{Group: "fixed root", Name: "fixed-origin-in-container", Spec: fixedOther, Op: "place"}, true, true)
	nearTree := s46CoreTree(false, 0, 0)
	nearTree.Nears = [][2]uint64{{12, 2}}
	add(s46Case{Group: "fixed root", Name: "near-node-terminal", Spec: nearTree, Op: "place"}, false, true)

	// orientation changes
	for _, o := range []geo.Orientation{geo.Bottom, geo.Top, geo.Left, geo.Right} {
		add(s46Case{Group: "orientation changes", Name: fmt.Sprintf("construct-%d", o), Spec: s46CoreTree(true, 30, 20), Op: "construct", Orientation: int(o)}, false, false)
	}
	for _, d := range []geo.Orientation{geo.Right, geo.Left, geo.Top, geo.Bottom} {
		spec := s46CoreTree(false, 0, 0)
		spec.Directions = []s46Dir{{Container: 0, Dir: int(d)}}
		add(s46Case{Group: "orientation changes", Name: fmt.Sprintf("direction-%d", d), Spec: spec, Op: "place"}, false, true)
	}
	blocked := s46CoreTree(false, 0, 0)
	blocked.Nodes = append(blocked.Nodes, s46N(4, 0, 160), s46N(5, 0, -260), s46N(6, -300, 0))
	blocked.Edges = append(blocked.Edges, s46U(4, 2), s46U(5, 2), s46U(6, 2))
	add(s46Case{Group: "orientation changes", Name: "obstacles-around-sentinel", Spec: blocked, Op: "place"}, false, true)

	// labels
	add(s46Case{Group: "labels", Name: "labels-core-tree", Spec: s46CoreTree(true, 30, 20), Op: "place"}, true, true)
	add(s46Case{Group: "labels", Name: "labels-wide-text", Spec: s46CoreTree(true, 140, 10), Op: "place"}, false, true)
	isolatedLabels := s46Spec{Nodes: []s46Node{s46N(1, 0, 0), s46N(2, 0, 0), s46N(3, 0, 0), s46N(4, 0, 0),
		s46N(5, 0, 0), s46N(6, 0, 0), s46N(7, 0, 0)},
		Edges: []s46Edge{
			{From: 1, To: 2, Dst: s46Tri, Label: true, MinW: 40, MinH: 20},
			{From: 2, To: 3, Dst: s46Tri, Label: true, MinW: 30, MinH: 25},
			{From: 2, To: 4, Dst: s46Tri, Label: true, MinW: 50, MinH: 10},
			{From: 1, To: 5, Dst: s46Tri, Label: true, MinW: 20, MinH: 30},
			{From: 5, To: 6, Dst: s46Tri},
			{From: 7, To: 5, Src: s46Tri, Label: true, MinW: 25, MinH: 15},
		}}
	add(s46Case{Group: "labels", Name: "labels-isolated", Spec: isolatedLabels, Op: "place"}, false, true)
	routed := s46CoreTree(true, 20, 20)
	routed.Edges[0].Points = []float64{5, 5, 305, 5, 305, 50}
	add(s46Case{Group: "labels", Name: "labels-with-routes", Spec: routed, Op: "place"}, false, true)

	// container tree
	containerSpec := s46Spec{Nodes: []s46Node{
		{ID: 1, W: 600, H: 600, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 50, H: 50, Placed: true, X: 20, Y: 20, Container: 1},
		{ID: 3, W: 50, H: 50, Placed: true, X: 200, Y: 20, Container: 1},
		{ID: 4, W: 50, H: 50, Placed: true, X: 100, Y: 200, Container: 1},
		{ID: 5, W: 30, H: 30, Container: 1}, {ID: 6, W: 30, H: 30, Container: 1}, {ID: 7, W: 30, H: 30, Container: 1},
		s46N(8, 800, 0), s46N(9, 1000, 0), s46N(10, 900, 300),
		{ID: 11, W: 40, H: 40}, {ID: 12, W: 40, H: 40}, {ID: 13, W: 40, H: 40},
	}, Edges: []s46Edge{
		s46U(2, 3), s46U(3, 4), s46U(4, 2), s46D(2, 5), s46D(5, 6), s46D(5, 7),
		s46U(8, 9), s46U(9, 10), s46U(10, 8), s46U(1, 8), s46D(9, 11), s46D(11, 12), s46D(11, 13),
	}}
	add(s46Case{Group: "container tree", Name: "container-preprocess", Spec: containerSpec, Op: "preprocess"}, true, true)
	add(s46Case{Group: "container tree", Name: "container-place-root", Spec: containerSpec, Op: "place"}, false, true)
	add(s46Case{Group: "container tree", Name: "container-place-inner", Spec: containerSpec, Op: "place", Container: 1}, true, true)
	tableSpec := containerSpec
	tableSpec.Nodes = append([]s46Node{}, containerSpec.Nodes...)
	tableSpec.Nodes[1].Shape = "Table"
	add(s46Case{Group: "container tree", Name: "container-table-skips", Spec: tableSpec, Op: "preprocess"}, false, true)
	foreign := s46CoreTree(false, 0, 0)
	foreign.Nodes = append(foreign.Nodes, s46Node{ID: 99, W: 10, H: 10, Placed: true, Detached: true})
	add(s46Case{Group: "container tree", Name: "container-unknown-rejected", Spec: foreign, Op: "place", Container: 99}, false, false)
	seqSpec := s46Spec{Nodes: []s46Node{
		s46N(1, 0, 0), s46N(2, 300, 0), s46N(3, 150, 300),
		{ID: 40, W: 30, H: 30, Placed: true, Detached: true}, {ID: 41, W: 30, H: 30, Placed: true, Detached: true},
		s46N(10, 0, 0), s46N(11, 0, 0), s46N(12, 0, 0), s46N(20, 0, 0), s46N(21, 0, 0),
	}, Edges: []s46Edge{s46U(1, 2), s46U(2, 3), s46U(3, 1), s46D(1, 10), s46D(10, 11), s46D(10, 12), s46D(1, 20), s46D(20, 21)},
		Sequences: []s46Seq{{Vessel: 1, Members: []uint64{40, 41}}}}
	add(s46Case{Group: "container tree", Name: "sequence-sentinel", Spec: seqSpec, Op: "place"}, false, true)
	seqIsolated := s46Spec{Nodes: []s46Node{
		s46N(1, 0, 0), {ID: 40, W: 30, H: 30, Placed: true, Detached: true},
		s46N(10, 0, 0), s46N(11, 0, 0), s46N(20, 0, 0), s46N(21, 0, 0), s46N(22, 0, 0),
	}, Edges: []s46Edge{s46D(1, 10), s46D(10, 11), s46D(1, 20), s46D(20, 21), s46D(20, 22)},
		Sequences: []s46Seq{{Vessel: 1, Members: []uint64{40}}}}
	add(s46Case{Group: "container tree", Name: "sequence-isolated-put-back", Spec: seqIsolated, Op: "preprocess"}, false, true)

	// preprocessing reversal
	add(s46Case{Group: "preprocessing reversal", Name: "reversal-directed-1", Spec: s46Directed1(), Op: "preprocess"}, false, true)
	add(s46Case{Group: "preprocessing reversal", Name: "reversal-directed-2", Spec: s46Directed2(), Op: "preprocess"}, false, true)
	add(s46Case{Group: "preprocessing reversal", Name: "reversal-directed-3", Spec: s46Directed3(), Op: "preprocess"}, true, true)
	add(s46Case{Group: "preprocessing reversal", Name: "reversal-directed-3-place", Spec: s46Directed3(), Op: "place"}, false, true)
	add(s46Case{Group: "preprocessing reversal", Name: "reversal-mixed-place", Spec: s46MixedTree(), Op: "place"}, false, true)

	// reconnect
	reconnectSpec := s46ManyBranching(3)
	reconnectSpec.Nodes = append(reconnectSpec.Nodes, s46Small(50, 0, 50), s46Small(51, 0, 70), s46Small(52, 0, 90))
	reconnectSpec.Edges = append(reconnectSpec.Edges, s46D(2, 50), s46D(50, 51), s46D(51, 52))
	add(s46Case{Group: "reconnect", Name: "reconnect-mixed-preprocess", Spec: reconnectSpec, Op: "preprocess"}, true, true)
	add(s46Case{Group: "reconnect", Name: "reconnect-mixed-place", Spec: reconnectSpec, Op: "place"}, true, true)

	// cancellation: dedicated whole-call probes on multi-tree placement
	add(s46Case{Group: "cancellation", Name: "cancellation-many-6-place", Spec: s46ManyBranching(6), Op: "place"}, true, true)
	add(s46Case{Group: "cancellation", Name: "cancellation-mixed-preprocess", Spec: s46MixedTree(), Op: "preprocess"}, true, true)

	// seeded determinism
	for seed := int64(0); seed < 8; seed++ {
		rng := rand.New(rand.NewSource(4600 + seed))
		spec := s46Random(rng)
		add(s46Case{Group: "seeded determinism", Name: fmt.Sprintf("random-%d-preprocess", seed), Spec: spec, Op: "preprocess"}, false, true)
		add(s46Case{Group: "seeded determinism", Name: fmt.Sprintf("random-%d-place", seed), Spec: spec, Op: "place"}, seed == 0, true)
	}

	writeOrAssertSlice46Fixture(t, "go-slice46-trees-reference.json", oracle)
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
