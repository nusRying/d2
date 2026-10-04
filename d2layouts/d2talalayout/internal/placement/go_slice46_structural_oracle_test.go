package placement

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/hierarchy"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/trees"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 46 structural placement oracle (Place, placeNodes, Prepare,
// JoinDistancedClusters, container orientation). With TALA_SLICE46_ORACLE=1
// the test rewrites js/test/fixtures/go-slice46-placement-reference.json;
// otherwise it recomputes every value and asserts the committed fixture.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s46Label struct {
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Pos   int     `json:"pos,omitempty"`
	Fixed bool    `json:"fixed,omitempty"`
}

type s46Node struct {
	ID        uint64    `json:"id"`
	W         float64   `json:"w"`
	H         float64   `json:"h"`
	Container uint64    `json:"container,omitempty"`
	Fixed     bool      `json:"fixed,omitempty"`
	FX        float64   `json:"fx,omitempty"`
	FY        float64   `json:"fy,omitempty"`
	Placed    bool      `json:"placed,omitempty"`
	X         float64   `json:"x,omitempty"`
	Y         float64   `json:"y,omitempty"`
	Shape     string    `json:"shape,omitempty"`
	Label     *s46Label `json:"label,omitempty"`
	FontSize  int       `json:"fontSize,omitempty"`
	Multiple  bool      `json:"multiple,omitempty"`
}

type s46Edge struct {
	From     uint64 `json:"from"`
	To       uint64 `json:"to"`
	Directed bool   `json:"directed,omitempty"`
}

type s46Direction struct {
	Container   uint64 `json:"container"`
	Orientation int    `json:"orientation"`
}

type s46Spec struct {
	Nodes      []s46Node      `json:"nodes"`
	Edges      []s46Edge      `json:"edges,omitempty"`
	Nears      [][2]uint64    `json:"nears,omitempty"`
	Directions []s46Direction `json:"directions,omitempty"`
	CellSize   float64        `json:"cellSize,omitempty"`
	// Pre-Place pipeline stages, in engine order.
	Sequences bool `json:"sequences,omitempty"`
	Trees     bool `json:"trees,omitempty"`
	Hierarchy bool `json:"hierarchy,omitempty"`
	Clusters  bool `json:"clusters,omitempty"`
	Hubs      bool `json:"hubs,omitempty"`
}

type s46Built struct {
	g     *layoutgraph.Graph
	nodes map[uint64]*layoutgraph.Node
	order []*layoutgraph.Node
}

func (spec s46Spec) build() s46Built {
	g := layoutgraph.NewGraph()
	g.CellSize = spec.CellSize
	b := s46Built{g: g, nodes: map[uint64]*layoutgraph.Node{}}
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		if ns.Placed {
			n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		}
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Text: fmt.Sprint(ns.ID), Width: ns.Label.W, Height: ns.Label.H, Position: label.Position(ns.Label.Pos)}
			if ns.Label.Fixed {
				n.Label.FixPosition()
			}
		}
		if ns.FontSize != 0 {
			size := ns.FontSize
			n.FontSize = &size
		}
		n.IsMultiple = ns.Multiple
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = b.nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		b.nodes[ns.ID] = n
		b.order = append(b.order, n)
	}
	for _, es := range spec.Edges {
		e := g.Connect(b.nodes[es.From], b.nodes[es.To])
		if es.Directed {
			e.SourceArrowhead = layoutgraph.NoArrowhead
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
	}
	for _, pair := range spec.Nears {
		b.nodes[pair[0]].AddNear(b.nodes[pair[1]])
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Container != 0 {
			container = b.nodes[d.Container]
		}
		g.Directions[container] = geo.Orientation(d.Orientation)
	}
	return b
}

// preprocess runs the engine's pre-Place stages selected by the spec, in the
// pinned pipeline order, with the pipeline's RNG wiring.
func (spec s46Spec) preprocess(ctx context.Context, b s46Built, seed int64) error {
	random := rand.New(rand.NewSource(seed))
	hierarchyRandom := rand.New(rand.NewSource(seed))
	Prescale(b.g)
	if spec.Sequences {
		if err := grouping.AddSequences(ctx, b.g, random); err != nil {
			return err
		}
	}
	Prepare(b.g)
	if spec.Trees {
		if err := trees.Preprocess(ctx, b.g); err != nil {
			return err
		}
	}
	if spec.Hierarchy {
		if err := hierarchy.Assign(ctx, b.g, nil, hierarchy.Candidates(b.g)); err != nil {
			return err
		}
		if err := hierarchy.Place(ctx, b.g, nil, hierarchyRandom); err != nil {
			return err
		}
		hierarchy.RemoveIsolatedMemberships(b.g)
	}
	if spec.Clusters {
		if err := grouping.AddClusters(ctx, b.g, seed, random); err != nil {
			return err
		}
	}
	if spec.Hubs {
		if err := proximity.AddHubs(ctx, b.g); err != nil {
			return err
		}
	}
	return nil
}

// ── Observations ─────────────────────────────────────────────────────────────

// s46Universe lists every node the scenario can observe: spec nodes plus
// graph nodes and their descendants (vessels and sentinels), sorted by ID.
func s46Universe(b s46Built) []*layoutgraph.Node {
	seen := map[*layoutgraph.Node]bool{}
	var out []*layoutgraph.Node
	add := func(n *layoutgraph.Node) {
		if n != nil && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, n := range b.order {
		add(n)
	}
	for _, n := range b.g.Nodes {
		add(n)
		for _, d := range b.g.AllDescendantNodes(n, true) {
			add(d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

type s46Owners struct {
	nodes  []*layoutgraph.Node
	graphs []*layoutgraph.Graph
}

func s46CaptureOwners(b s46Built) s46Owners {
	o := s46Owners{nodes: s46Universe(b)}
	for _, n := range o.nodes {
		o.graphs = append(o.graphs, n.Graph)
	}
	return o
}

func (o s46Owners) restored() bool {
	for i, n := range o.nodes {
		if n.Graph != o.graphs[i] {
			return false
		}
	}
	return true
}

type s46Features struct {
	Trees       int `json:"trees"`
	Sequences   int `json:"sequences"`
	Clusters    int `json:"clusters"`
	Hierarchies int `json:"hierarchies"`
	Herds       int `json:"herds"`
	Hubs        int `json:"hubs"`
}

func s46Observe(b s46Built) s46Features {
	f := s46Features{Trees: len(b.g.Trees), Sequences: len(b.g.Sequences), Clusters: len(b.g.Clusters), Hubs: len(b.g.Hubs)}
	for _, n := range s46Universe(b) {
		if n.Hierarchy != nil {
			f.Hierarchies++
		}
		if n.HerdAssignment != nil {
			f.Herds++
		}
	}
	return f
}

type s46Result struct {
	Error    string      `json:"error"`
	Geom     []float64   `json:"geom,omitempty"` // id, placed, x, y, w, h per universe node
	Edges    []uint64    `json:"edges,omitempty"`
	CellSize float64     `json:"cellSize"`
	CUSNil   bool        `json:"cusNil"`
	OwnedOK  bool        `json:"ownedOK"`
	Features s46Features `json:"features"`
}

func s46Geom(b s46Built) []float64 {
	var out []float64
	for _, n := range s46Universe(b) {
		if n.TopLeft == nil {
			out = append(out, float64(n.ID), 0, 0, 0, n.Width, n.Height)
		} else {
			out = append(out, float64(n.ID), 1, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height)
		}
	}
	return out
}

func s46EdgeList(g *layoutgraph.Graph) []uint64 {
	var out []uint64
	for _, e := range g.Edges {
		out = append(out, uint64(e.From.ID), uint64(e.To.ID))
	}
	return out
}

func s46OwnedOK(b s46Built) bool {
	for _, n := range b.g.Nodes {
		if n.Graph != b.g {
			return false
		}
		for _, d := range b.g.AllDescendantNodes(n, true) {
			if d.Graph != b.g {
				return false
			}
		}
	}
	return true
}

// ── Contexts ─────────────────────────────────────────────────────────────────

type s46Ctx struct {
	context.Context
	calls   int
	cancel  int
	panicAt int
}

func (ctx *s46Ctx) Err() error {
	ctx.calls++
	if ctx.panicAt > 0 && ctx.calls == ctx.panicAt {
		panic("s46 injected panic")
	}
	if ctx.cancel > 0 && ctx.calls >= ctx.cancel {
		return context.Canceled
	}
	return nil
}

func newS46Ctx(cancel, panicAt int) *s46Ctx {
	return &s46Ctx{Context: context.Background(), cancel: cancel, panicAt: panicAt}
}

func s46Call(fn func() error) (err error, panicked string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = fmt.Sprint(r)
		}
	}()
	return fn(), ""
}

// ── Place scenarios ──────────────────────────────────────────────────────────

type s46Probe struct {
	At         int    `json:"at"`
	Error      string `json:"error"`
	Panic      string `json:"panic,omitempty"`
	OwnersOK   bool   `json:"ownersOK"`
	CUSRestore bool   `json:"cusRestored"`
}

type s46Limit struct {
	W         int64  `json:"w"`
	WMinus1   string `json:"wMinus1Error"`
	UsedAtW1  int64  `json:"usedAtWMinus1"`
	OwnersOK  bool   `json:"ownersOK"`
	CUSRestor bool   `json:"cusRestored"`
}

type s46PlaceCase struct {
	Name     string     `json:"name"`
	Group    string     `json:"group"`
	Seed     int64      `json:"seed"`
	Spec     s46Spec    `json:"spec"`
	Stable   bool       `json:"stable"`
	Result   s46Result  `json:"result"`
	ErrCalls int        `json:"errCalls"` // -1 when not pinned
	Probes   []s46Probe `json:"probes,omitempty"`
	Panics   []s46Probe `json:"panics,omitempty"`
	Limit    *s46Limit  `json:"limit,omitempty"`
}

var s46PriorCUS = map[*layoutgraph.Node]layoutgraph.Nodes{}

func s46RunPlace(spec s46Spec, seed int64, ctx context.Context) (s46Built, s46Result, s46Owners, error) {
	b := spec.build()
	if err := spec.preprocess(context.Background(), b, seed); err != nil {
		return b, s46Result{Error: "preprocess: " + err.Error()}, s46Owners{}, err
	}
	owners := s46CaptureOwners(b)
	features := s46Observe(b)
	b.g.CommonUncleSiblings = s46PriorCUS
	err := Place(ctx, b.g, seed)
	features.Herds = s46Observe(b).Herds
	res := s46Result{Error: s44Err(err), CellSize: b.g.CellSize, CUSNil: b.g.CommonUncleSiblings == nil, Features: features}
	if err == nil {
		res.Geom = s46Geom(b)
		res.Edges = s46EdgeList(b.g)
		res.OwnedOK = s46OwnedOK(b)
	}
	return b, res, owners, err
}

func s46CUSRestored(g *layoutgraph.Graph) bool {
	if g.CommonUncleSiblings == nil {
		return false
	}
	// Pointer identity of the prior map.
	return fmt.Sprintf("%p", g.CommonUncleSiblings) == fmt.Sprintf("%p", s46PriorCUS)
}

func s46Strided(n, maxProbes int) []int {
	if n <= 0 {
		return nil
	}
	stride := 1
	if n > maxProbes {
		stride = (n + maxProbes - 1) / maxProbes
	}
	var out []int
	for at := 1; at <= n; at += stride {
		out = append(out, at)
	}
	if out[len(out)-1] != n {
		out = append(out, n)
	}
	return out
}

func s46PlaceScenario(t *testing.T, name, group string, spec s46Spec, seed int64, probe bool) s46PlaceCase {
	t.Helper()
	c := s46PlaceCase{Name: name, Group: group, Seed: seed, Spec: spec, ErrCalls: -1}
	var encoded []byte
	c.Stable = true
	for run := 0; run < 3; run++ {
		_, res, _, _ := s46RunPlace(spec, seed, context.Background())
		enc, _ := json.Marshal(res)
		if run == 0 {
			c.Result = res
			encoded = enc
		} else if !bytes.Equal(enc, encoded) {
			c.Stable = false
		}
	}
	if !c.Stable || !probe || c.Result.Error != "" {
		return c
	}
	nodeCount := len(spec.Nodes)
	if nodeCount <= 10 {
		counter := newS46Ctx(0, 0)
		if _, res, _, err := s46RunPlace(spec, seed, counter); err != nil || res.Error != "" {
			t.Fatalf("%s: counting run failed: %v", name, err)
		}
		c.ErrCalls = counter.calls
		for _, at := range s46Strided(counter.calls, 24) {
			ctx := newS46Ctx(at, 0)
			b, res, owners, _ := s46RunPlace(spec, seed, ctx)
			c.Probes = append(c.Probes, s46Probe{At: at, Error: res.Error, OwnersOK: owners.restored(), CUSRestore: s46CUSRestored(b.g)})
		}
		for _, at := range s46Strided(counter.calls, 4) {
			ctx := newS46Ctx(0, at)
			var b s46Built
			var owners s46Owners
			var res s46Result
			_, panicked := s46Call(func() error {
				b = spec.build()
				if err := spec.preprocess(context.Background(), b, seed); err != nil {
					return err
				}
				owners = s46CaptureOwners(b)
				b.g.CommonUncleSiblings = s46PriorCUS
				err := Place(ctx, b.g, seed)
				res.Error = s44Err(err)
				return err
			})
			c.Panics = append(c.Panics, s46Probe{At: at, Error: res.Error, Panic: panicked, OwnersOK: owners.restored(), CUSRestore: s46CUSRestored(b.g)})
		}
	}
	// W/W−1 on the request transaction guard shared by every placement transaction.
	guard, gctx := s44Guard(limits.MaxTransactionWorkUnits)
	if _, res, _, err := s46RunPlace(spec, seed, gctx); err == nil && res.Error == "" {
		w := int64(guard.Used())
		lim := &s46Limit{W: w}
		if w == 0 {
			// No transactional work: there is no W−1 boundary to probe.
			c.Limit = lim
			return c
		}
		guard1, gctx1 := s44Guard(w - 1)
		b, res1, owners, _ := s46RunPlace(spec, seed, gctx1)
		lim.WMinus1 = res1.Error
		lim.UsedAtW1 = int64(guard1.Used())
		lim.OwnersOK = owners.restored()
		lim.CUSRestor = s46CUSRestored(b.g)
		guardW, gctxW := s44Guard(w)
		if _, resW, _, errW := s46RunPlace(spec, seed, gctxW); errW != nil || resW.Error != "" {
			t.Fatalf("%s: run at W=%d failed: %v (used %d)", name, w, errW, guardW.Used())
		}
		c.Limit = lim
	}
	return c
}

func s46Chain(n int, start uint64, w, h float64) ([]s46Node, []s46Edge) {
	var nodes []s46Node
	var edges []s46Edge
	for i := 0; i < n; i++ {
		nodes = append(nodes, s46Node{ID: start + uint64(i), W: w, H: h})
		if i > 0 {
			edges = append(edges, s46Edge{From: start + uint64(i-1), To: start + uint64(i)})
		}
	}
	return nodes, edges
}

func s46RandomSpec(rng *rand.Rand, n int) s46Spec {
	spec := s46Spec{}
	sizes := []float64{40, 60, 80, 100}
	for i := 1; i <= n; i++ {
		spec.Nodes = append(spec.Nodes, s46Node{ID: uint64(i), W: sizes[rng.Intn(4)], H: sizes[rng.Intn(3)]})
	}
	seen := map[[2]uint64]bool{}
	add := func(a, b uint64) {
		if a == b || seen[[2]uint64{a, b}] || seen[[2]uint64{b, a}] {
			return
		}
		seen[[2]uint64{a, b}] = true
		spec.Edges = append(spec.Edges, s46Edge{From: a, To: b, Directed: rng.Intn(2) == 0})
	}
	for i := 2; i <= n; i++ {
		add(uint64(rng.Intn(i-1)+1), uint64(i))
	}
	for i := 0; i < n/3; i++ {
		add(uint64(rng.Intn(n)+1), uint64(rng.Intn(n)+1))
	}
	return spec
}

func s46PlaceCases(t *testing.T) []s46PlaceCase {
	var cases []s46PlaceCase
	add := func(name, group string, spec s46Spec, seed int64, probe bool) {
		cases = append(cases, s46PlaceScenario(t, name, group, spec, seed, probe))
	}

	add("empty", "empty", s46Spec{}, 1, true)
	add("singleton", "singleton", s46Spec{Nodes: []s46Node{{ID: 1, W: 80, H: 40}}}, 1, true)
	add("fixed-singleton", "fixed singleton", s46Spec{Nodes: []s46Node{{ID: 1, W: 80, H: 40, Fixed: true, FX: 37, FY: -12}}}, 1, true)
	add("singleton-with-trees", "singleton", s46Spec{
		Nodes: []s46Node{{ID: 1, W: 80, H: 60}, {ID: 2, W: 40, H: 40}, {ID: 3, W: 40, H: 40}, {ID: 4, W: 40, H: 40}},
		Edges: []s46Edge{{From: 1, To: 2, Directed: true}, {From: 1, To: 3, Directed: true}, {From: 1, To: 4, Directed: true}},
		Trees: true,
	}, 1, true)
	add("container-only", "nested container", s46Spec{Nodes: []s46Node{{ID: 1, W: 0, H: 0}, {ID: 2, W: 60, H: 40, Container: 1}}}, 1, true)
	{
		nodes := []s46Node{
			{ID: 1, W: 0, H: 0, Label: &s46Label{W: 40, H: 16}},
			{ID: 2, W: 0, H: 0, Container: 1},
			{ID: 3, W: 60, H: 40, Container: 2},
			{ID: 4, W: 60, H: 40, Container: 2},
			{ID: 5, W: 60, H: 40, Container: 1},
			{ID: 6, W: 80, H: 40},
			{ID: 7, W: 80, H: 40},
		}
		edges := []s46Edge{{From: 3, To: 4}, {From: 4, To: 5}, {From: 6, To: 3}, {From: 5, To: 7}, {From: 6, To: 7}}
		add("nested-container-abduction", "edge abduction", s46Spec{Nodes: nodes, Edges: edges}, 1, true)
		add("nested-container-even-seed", "nested container", s46Spec{Nodes: nodes, Edges: edges}, 2, true)
	}
	{
		nodes, edges := s46Chain(4, 1, 60, 40)
		nodes = append(nodes, s46Node{ID: 10, W: 40, H: 30}, s46Node{ID: 11, W: 40, H: 30}, s46Node{ID: 12, W: 40, H: 30})
		edges = append(edges, s46Edge{From: 2, To: 10, Directed: true}, s46Edge{From: 10, To: 11, Directed: true}, s46Edge{From: 10, To: 12, Directed: true})
		add("tree-and-ordinary", "tree + ordinary nodes", s46Spec{Nodes: nodes, Edges: edges, Trees: true}, 3, true)
	}
	{
		var nodes []s46Node
		var edges []s46Edge
		for i := uint64(1); i <= 8; i++ {
			nodes = append(nodes, s46Node{ID: i, W: 60, H: 40})
		}
		for _, e := range [][2]uint64{{1, 2}, {1, 3}, {2, 4}, {3, 4}, {4, 5}, {5, 6}, {5, 7}, {6, 8}, {7, 8}, {2, 5}} {
			edges = append(edges, s46Edge{From: e[0], To: e[1], Directed: true})
		}
		add("hierarchy-members", "hierarchy members", s46Spec{Nodes: nodes, Edges: edges, Hierarchy: true, Directions: []s46Direction{{Container: 0, Orientation: int(geo.Bottom)}}}, 1, true)
	}
	{
		nodes := []s46Node{{ID: 1, W: 80, H: 60}}
		var edges []s46Edge
		for i := uint64(2); i <= 7; i++ {
			nodes = append(nodes, s46Node{ID: i, W: 50, H: 30})
			edges = append(edges, s46Edge{From: 1, To: i})
		}
		add("cluster", "cluster", s46Spec{Nodes: nodes, Edges: edges, Clusters: true}, 4, true)
	}
	add("hub", "Herd", s46Spec{
		Nodes: []s46Node{{ID: 1, W: 80, H: 60}, {ID: 2, W: 60, H: 40}, {ID: 3, W: 60, H: 40}, {ID: 4, W: 40, H: 30}, {ID: 5, W: 40, H: 30}, {ID: 6, W: 40, H: 30}},
		Edges: []s46Edge{{From: 1, To: 2}, {From: 2, To: 3}, {From: 1, To: 4}, {From: 1, To: 5}, {From: 1, To: 6}},
		Hubs:  true,
	}, 4, true)
	add("herd", "Herd", s46Spec{
		Nodes: []s46Node{
			{ID: 1, W: 0, H: 0}, {ID: 2, W: 50, H: 40, Container: 1}, {ID: 3, W: 50, H: 40, Container: 1},
			{ID: 4, W: 0, H: 0}, {ID: 5, W: 50, H: 40, Container: 4}, {ID: 6, W: 50, H: 40, Container: 4},
		},
		Edges: []s46Edge{{From: 2, To: 5}, {From: 3, To: 6}, {From: 2, To: 3}},
	}, 4, true)
	{
		nodes, edges := s46Chain(5, 1, 60, 40)
		for i := range edges {
			edges[i].Directed = true
		}
		for i := range nodes {
			nodes[i].Shape = "Step"
		}
		nodes = append(nodes, s46Node{ID: 9, W: 60, H: 40})
		edges = append(edges, s46Edge{From: 9, To: 3})
		add("sequence", "sequence", s46Spec{Nodes: nodes, Edges: edges, Sequences: true}, 5, true)
	}
	add("near", "Near", s46Spec{
		Nodes: []s46Node{{ID: 1, W: 60, H: 40}, {ID: 2, W: 60, H: 40}, {ID: 3, W: 60, H: 40}, {ID: 4, W: 40, H: 40}},
		Edges: []s46Edge{{From: 1, To: 2}, {From: 2, To: 3}},
		Nears: [][2]uint64{{4, 1}},
	}, 6, true)
	add("fixed-child-obstacles", "fixed child obstacles", s46Spec{
		Nodes: []s46Node{
			{ID: 1, W: 0, H: 0, Fixed: true, FX: 10, FY: 0},
			{ID: 2, W: 50, H: 40, Container: 1},
			{ID: 3, W: 50, H: 40, Container: 1},
			{ID: 4, W: 0, H: 0, Fixed: true, FX: 0, FY: 300},
			{ID: 5, W: 50, H: 40, Container: 4},
			{ID: 6, W: 50, H: 40},
		},
		Edges: []s46Edge{{From: 2, To: 3}, {From: 3, To: 5}, {From: 6, To: 2}},
	}, 7, true)
	add("self-loop-disables-orientation", "nested container", s46Spec{
		Nodes: []s46Node{{ID: 1, W: 60, H: 40}, {ID: 2, W: 60, H: 40}, {ID: 3, W: 60, H: 40}},
		Edges: []s46Edge{{From: 1, To: 1, Directed: true}, {From: 1, To: 2}, {From: 2, To: 3}},
	}, 8, true)
	add("labels-and-multiple", "singleton", s46Spec{
		Nodes: []s46Node{
			{ID: 1, W: 60, H: 40, Label: &s46Label{W: 30, H: 12, Pos: int(label.OutsideTopCenter), Fixed: true}},
			{ID: 2, W: 60, H: 40, Multiple: true, FontSize: 16},
			{ID: 3, W: 60, H: 40, Label: &s46Label{W: 20, H: 12}},
		},
		Edges: []s46Edge{{From: 1, To: 2}, {From: 1, To: 3}},
	}, 9, true)

	// Seeded determinism over random graphs (larger graphs pin geometry only).
	for _, seed := range []int64{11, 12, 13} {
		rng := rand.New(rand.NewSource(seed))
		add(fmt.Sprintf("random-small-%d", seed), "seeded determinism", s46RandomSpec(rng, 8), seed, true)
	}
	for _, seed := range []int64{21, 22} {
		rng := rand.New(rand.NewSource(seed))
		add(fmt.Sprintf("random-large-%d", seed), "seeded determinism", s46RandomSpec(rng, 16), seed, false)
	}
	return cases
}

// ── JoinDistancedClusters ────────────────────────────────────────────────────

type s46JoinCase struct {
	Name    string     `json:"name"`
	Spec    s46Spec    `json:"spec"`
	Shared  bool       `json:"shared"`
	Error   string     `json:"error"`
	Geom    []float64  `json:"geom"`
	Used    int64      `json:"used"`
	Limit   *s46Limit  `json:"limit,omitempty"`
	Calls   int        `json:"errCalls"`
	Probes  []s46Probe `json:"probes,omitempty"`
	Changed bool       `json:"changed"`
}

func s46JoinRun(spec s46Spec, ctx context.Context) (s46Built, []float64, error) {
	b := spec.build()
	before := s46Geom(b)
	err := grouping.JoinDistancedClusters(ctx, b.g)
	return b, before, err
}

func s46JoinScenario(t *testing.T, name string, spec s46Spec, shared bool) s46JoinCase {
	c := s46JoinCase{Name: name, Spec: spec, Shared: shared}
	var guard *limits.WorkGuard
	ctx := context.Background()
	if shared {
		guard, ctx = s44Guard(limits.MaxTransactionWorkUnits)
	}
	b, before, err := s46JoinRun(spec, ctx)
	c.Error = s44Err(err)
	c.Geom = s46Geom(b)
	c.Changed = !floatsEqual(before, c.Geom)
	if guard != nil {
		c.Used = int64(guard.Used())
		if err == nil && c.Used > 0 {
			g1, ctx1 := s44Guard(c.Used - 1)
			b1, before1, err1 := s46JoinRun(spec, ctx1)
			c.Limit = &s46Limit{W: c.Used, WMinus1: s44Err(err1), UsedAtW1: int64(g1.Used()), OwnersOK: floatsEqual(before1, s46Geom(b1))}
		}
	}
	counter := newS46Ctx(0, 0)
	if _, _, err := s46JoinRun(spec, counter); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	c.Calls = counter.calls
	for _, at := range s46Strided(counter.calls, 16) {
		bp, beforeP, errP := s46JoinRun(spec, newS46Ctx(at, 0))
		c.Probes = append(c.Probes, s46Probe{At: at, Error: s44Err(errP), OwnersOK: floatsEqual(beforeP, s46Geom(bp))})
	}
	return c
}

func floatsEqual(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func s46JoinCases(t *testing.T) []s46JoinCase {
	islands := s46Spec{CellSize: 10, Nodes: []s46Node{
		{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 60, Y: 0},
		{ID: 3, W: 40, H: 40, Placed: true, X: 600, Y: 400},
		{ID: 4, W: 40, H: 40, Placed: true, X: 660, Y: 400},
		{ID: 5, W: 40, H: 40, Placed: true, X: 0, Y: 700},
	}, Edges: []s46Edge{{From: 1, To: 2}, {From: 3, To: 4}, {From: 2, To: 3}, {From: 4, To: 5}}}
	fixed := islands
	fixed.Nodes = append([]s46Node{}, islands.Nodes...)
	fixed.Nodes[0].Fixed, fixed.Nodes[0].FX, fixed.Nodes[0].FY = true, 0, 0
	container := s46Spec{CellSize: 10, Nodes: []s46Node{
		{ID: 1, W: 120, H: 100, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 40, H: 40, Placed: true, X: 20, Y: 30, Container: 1},
		{ID: 3, W: 40, H: 40, Placed: true, X: 900, Y: 0},
	}, Edges: []s46Edge{{From: 2, To: 3}}}
	single := s46Spec{CellSize: 10, Nodes: []s46Node{{ID: 1, W: 40, H: 40, Placed: true}}}
	noEdges := s46Spec{CellSize: 10, Nodes: []s46Node{{ID: 1, W: 40, H: 40, Placed: true}, {ID: 2, W: 40, H: 40, Placed: true, X: 500}}}
	return []s46JoinCase{
		s46JoinScenario(t, "islands-standalone", islands, false),
		s46JoinScenario(t, "islands-shared", islands, true),
		s46JoinScenario(t, "fixed-target", fixed, true),
		s46JoinScenario(t, "container-moves-children", container, true),
		s46JoinScenario(t, "single-node", single, true),
		s46JoinScenario(t, "no-edges", noEdges, true),
	}
}

// ── Container orientation ───────────────────────────────────────────────────

type s46OrientCase struct {
	Name     string     `json:"name"`
	Spec     s46Spec    `json:"spec"`
	Root     uint64     `json:"root"`
	Disabled bool       `json:"disabled"`
	Error    string     `json:"error"`
	Geom     []float64  `json:"geom"`
	Changed  bool       `json:"changed"`
	Calls    int        `json:"errCalls"`
	Probes   []s46Probe `json:"probes,omitempty"`
}

// s46OrientGraph builds the parent graph and the root's interior graph the
// way placeNodes hands it to orientSourceInterior.
func s46OrientGraph(spec s46Spec, root uint64) (s46Built, *layoutgraph.Graph, *layoutgraph.Node) {
	b := spec.build()
	r := b.nodes[root]
	inner := layoutgraph.NewGraph()
	inner.CopyEntitiesFrom(b.g)
	inner.CellSize = b.g.CellSize
	for _, child := range b.g.Containers[r] {
		inner.AddNodeUnchecked(child)
	}
	for _, e := range b.g.Edges {
		if e.From.Container == r && e.To.Container == r {
			inner.AddEdge(e)
		}
	}
	return b, inner, r
}

func s46OrientRun(spec s46Spec, root uint64, disabled bool, ctx context.Context) (s46Built, []float64, error) {
	b, inner, r := s46OrientGraph(spec, root)
	before := s46Geom(b)
	if disabled {
		var err error
		if ctx, err = orientationContext(ctx, b.g); err != nil {
			return b, before, err
		}
	}
	err := orientSourceInterior(ctx, inner, r, nil)
	return b, before, err
}

func s46OrientCases(t *testing.T) []s46OrientCase {
	source := s46Spec{CellSize: 10,
		Directions: []s46Direction{{Container: 0, Orientation: int(geo.Bottom)}},
		Nodes: []s46Node{
			{ID: 1, W: 400, H: 160, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 60, H: 40, Placed: true, X: 60, Y: 60, Container: 1},
			{ID: 3, W: 60, H: 40, Placed: true, X: 170, Y: 60, Container: 1},
			{ID: 4, W: 60, H: 40, Placed: true, X: 280, Y: 60, Container: 1},
			{ID: 5, W: 60, H: 40, Placed: true, X: 0, Y: 300},
			{ID: 6, W: 60, H: 40, Placed: true, X: 200, Y: 300},
		},
		Edges: []s46Edge{
			{From: 2, To: 3, Directed: true}, {From: 3, To: 4, Directed: true},
			{From: 1, To: 5, Directed: true}, {From: 1, To: 6, Directed: true}, {From: 1, To: 5, Directed: true},
		},
	}
	looped := source
	looped.Edges = append(append([]s46Edge{}, source.Edges...), s46Edge{From: 5, To: 5, Directed: true})
	upward := source
	upward.Directions = []s46Direction{{Container: 0, Orientation: int(geo.Top)}}
	tooFew := source
	tooFew.Edges = source.Edges[:3]
	var cases []s46OrientCase
	for _, sc := range []struct {
		name     string
		spec     s46Spec
		disabled bool
	}{
		{"source-down", source, false},
		{"source-up", upward, false},
		{"loop-preflight-disabled", looped, true},
		{"loop-preflight-clear", source, true},
		{"too-few-root-edges", tooFew, false},
	} {
		c := s46OrientCase{Name: sc.name, Spec: sc.spec, Root: 1, Disabled: sc.disabled}
		b, before, err := s46OrientRun(sc.spec, 1, sc.disabled, context.Background())
		c.Error = s44Err(err)
		c.Geom = s46Geom(b)
		c.Changed = !floatsEqual(before, c.Geom)
		counter := newS46Ctx(0, 0)
		if _, _, err := s46OrientRun(sc.spec, 1, sc.disabled, counter); err != nil {
			t.Fatalf("%s: %v", sc.name, err)
		}
		c.Calls = counter.calls
		for _, at := range s46Strided(counter.calls, 16) {
			bp, beforeP, errP := s46OrientRun(sc.spec, 1, sc.disabled, newS46Ctx(at, 0))
			c.Probes = append(c.Probes, s46Probe{At: at, Error: s44Err(errP), OwnersOK: floatsEqual(beforeP, s46Geom(bp))})
		}
		cases = append(cases, c)
	}
	return cases
}

// ── Prepare ──────────────────────────────────────────────────────────────────

type s46PrepareCase struct {
	Name   string    `json:"name"`
	Spec   s46Spec   `json:"spec"`
	Labels []int     `json:"labels"` // id, position, fixed per labeled node
	Loops  []float64 `json:"loops"`  // id, top, right, bottom, left per node with offsets
	Geom   []float64 `json:"geom"`
}

func s46PrepareCases() []s46PrepareCase {
	specs := []struct {
		name string
		spec s46Spec
	}{
		{"labels", s46Spec{Nodes: []s46Node{
			{ID: 1, W: 60, H: 40, Label: &s46Label{W: 30, H: 12}},
			{ID: 2, W: 60, H: 40, Shape: "Circle", Label: &s46Label{W: 30, H: 12}},
			{ID: 3, W: 60, H: 40, Label: &s46Label{W: 30, H: 12, Pos: int(label.InsideTopLeft), Fixed: true}},
			{ID: 4, W: 0, H: 0, Label: &s46Label{W: 50, H: 20}},
			{ID: 5, W: 40, H: 40, Container: 4},
		}}},
		{"self-loops", s46Spec{Nodes: []s46Node{{ID: 1, W: 60, H: 40}, {ID: 2, W: 80, H: 50, Shape: "Diamond"}}, Edges: []s46Edge{
			{From: 1, To: 1, Directed: true}, {From: 1, To: 1}, {From: 2, To: 2, Directed: true}, {From: 1, To: 2},
		}}},
	}
	var out []s46PrepareCase
	for _, s := range specs {
		b := s.spec.build()
		Prescale(b.g)
		Prepare(b.g)
		c := s46PrepareCase{Name: s.name, Spec: s.spec}
		for _, n := range b.order {
			if n.Label != nil {
				fixed := 0
				if n.Label.PositionFixed() {
					fixed = 1
				}
				c.Labels = append(c.Labels, int(n.ID), int(n.Label.Position), fixed)
			}
			if len(n.LoopOffsets) > 0 {
				c.Loops = append(c.Loops, float64(n.ID), n.LoopOffsets[geo.Top], n.LoopOffsets[geo.Right], n.LoopOffsets[geo.Bottom], n.LoopOffsets[geo.Left])
			}
		}
		c.Geom = s46Geom(b)
		out = append(out, c)
	}
	return out
}

// ── Oracle ───────────────────────────────────────────────────────────────────

type s46Oracle struct {
	Place   []s46PlaceCase   `json:"place"`
	Join    []s46JoinCase    `json:"join"`
	Orient  []s46OrientCase  `json:"orientation"`
	Prepare []s46PrepareCase `json:"prepare"`
}

func TestSlice46StructuralPlacementOracle(t *testing.T) {
	if testing.Short() {
		t.Skip("oracle")
	}
	oracle := s46Oracle{
		Place:   s46PlaceCases(t),
		Join:    s46JoinCases(t),
		Orient:  s46OrientCases(t),
		Prepare: s46PrepareCases(),
	}
	for _, c := range oracle.Place {
		if c.Result.Error != "" {
			t.Fatalf("%s: Place failed: %s", c.Name, c.Result.Error)
		}
		for _, p := range append(append([]s46Probe{}, c.Probes...), c.Panics...) {
			if (p.Error != "" || p.Panic != "") && (!p.OwnersOK || !p.CUSRestore) {
				t.Fatalf("%s: ownership not restored at probe %d", c.Name, p.At)
			}
		}
	}
	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice46-placement-reference.json")
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
		t.Fatalf("go-slice46-placement-reference.json is stale; regenerate with TALA_SLICE46_ORACLE=1")
	}
}
