package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/trees"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 47 OVG substrate oracle. With TALA_SLICE47_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice47-ovg-reference.json; otherwise it recomputes every
// value and asserts the committed fixture byte for byte.
//
// Go map iteration makes ovg.Nodes order (and OVGNode.Index) unspecified, so
// OVGs are dumped canonically: nodes sorted by (X, Y, role key), every other
// structure referenced by canonical index. Edge order is deterministic and kept.
// Work totals are recorded only after repeated builds agree.

// ── Portable scenario specs ──────────────────────────────────────────────────

type s47Node struct {
	ID        uint64  `json:"id"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	Shape     string  `json:"shape,omitempty"`
	Columns   int     `json:"columns,omitempty"`
	Container uint64  `json:"container,omitempty"`
	Invisible bool    `json:"invisible,omitempty"`
	Fixed     bool    `json:"fixed,omitempty"`
}

type s47Edge struct {
	From uint64 `json:"from"`
	To   uint64 `json:"to"`
	Src  string `json:"src,omitempty"`
	Tgt  string `json:"tgt,omitempty"`
}

type s47Direction struct {
	Container   uint64 `json:"container"`
	Orientation int    `json:"orientation"`
}

type s47Level struct {
	ID    uint64 `json:"id"`
	Level int    `json:"level"`
}

type s47Hierarchy struct {
	Levels []s47Level `json:"levels"`
	// Members get Node.Hierarchy without a level (panic probes).
	Members []uint64 `json:"members,omitempty"`
}

type s47Group struct {
	Vessel s47Node  `json:"vessel"`
	Nodes  []uint64 `json:"nodes"`
}

type s47Spec struct {
	Nodes       []s47Node      `json:"nodes"`
	Edges       []s47Edge      `json:"edges,omitempty"`
	Directions  []s47Direction `json:"directions,omitempty"`
	Hierarchies []s47Hierarchy `json:"hierarchies,omitempty"`
	Clusters    []s47Group     `json:"clusters,omitempty"`
	Sequences   []s47Group     `json:"sequences,omitempty"`
	Nearby      []s47Node      `json:"nearby,omitempty"`
	Trees       bool           `json:"trees,omitempty"`
	// Direct "hierarchy" builds newOVGForHierarchy(g, first hierarchy).
	Direct string `json:"direct,omitempty"`
}

type s47Built struct {
	g      *layoutgraph.Graph
	nodes  map[uint64]*layoutgraph.Node
	order  []*layoutgraph.Node
	nearby []*layoutgraph.Node
	hiers  []*layoutgraph.Hierarchy
}

func s47NewNode(ns s47Node) *layoutgraph.Node {
	n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
	if ns.Shape != "" {
		n.SetShape(ns.Shape)
	}
	if ns.Columns != 0 {
		n.SetNumColumns(ns.Columns)
	}
	n.TopLeft = geo.NewPoint(ns.X, ns.Y)
	n.IsInvisible = ns.Invisible
	if ns.Fixed {
		n.FixedTopLeft = n.TopLeft.Copy()
	}
	return n
}

func (spec s47Spec) build(t *testing.T) s47Built {
	t.Helper()
	g := layoutgraph.NewGraph()
	b := s47Built{g: g, nodes: map[uint64]*layoutgraph.Node{}}
	for _, ns := range spec.Nodes {
		n := s47NewNode(ns)
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
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Tgt)
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Container != 0 {
			container = b.nodes[d.Container]
		}
		g.Directions[container] = geo.Orientation(d.Orientation)
	}
	for _, hs := range spec.Hierarchies {
		levels := make(map[*layoutgraph.Node]int, len(hs.Levels))
		for _, l := range hs.Levels {
			levels[b.nodes[l.ID]] = l.Level
		}
		h := newHierarchyWithLevels(levels)
		for _, l := range hs.Levels {
			b.nodes[l.ID].Hierarchy = h
		}
		for _, id := range hs.Members {
			b.nodes[id].Hierarchy = h
		}
		b.hiers = append(b.hiers, h)
	}
	for _, cs := range spec.Clusters {
		cluster := &layoutgraph.Cluster{Vessel: s47NewNode(cs.Vessel)}
		for _, id := range cs.Nodes {
			cluster.Nodes = append(cluster.Nodes, b.nodes[id])
			b.nodes[id].Cluster = cluster
		}
		g.Clusters[cluster.Vessel] = cluster
	}
	for _, ss := range spec.Sequences {
		sequence := &layoutgraph.Sequence{Vessel: s47NewNode(ss.Vessel)}
		for _, id := range ss.Nodes {
			sequence.Nodes = append(sequence.Nodes, b.nodes[id])
			b.nodes[id].Sequence = sequence
		}
	}
	for _, ns := range spec.Nearby {
		b.nearby = append(b.nearby, s47NewNode(ns))
	}
	if spec.Trees {
		ctx := context.Background()
		if err := trees.Preprocess(ctx, g); err != nil {
			t.Fatal(err)
		}
		if err := trees.Place(ctx, g, nil); err != nil {
			t.Fatal(err)
		}
	}
	return b
}

// run builds the scenario's OVG with the given guard.
func (spec s47Spec) run(b s47Built, guard *ovgBuildGuard) (*OVG, error) {
	if spec.Direct == "hierarchy" {
		return newOVGForHierarchy(b.g, b.hiers[0], guard)
	}
	return buildOVGFromGraphWithGuard(b.g, b.nearby, guard)
}

// ── Canonical dump ───────────────────────────────────────────────────────────

// s47F encodes non-finite floats as strings ("NaN", "+Inf", "-Inf"), which
// encoding/json rejects but OVG construction can legitimately produce.
type s47F float64

func (f s47F) MarshalJSON() ([]byte, error) {
	v := float64(f)
	switch {
	case math.IsNaN(v):
		return []byte(`"NaN"`), nil
	case math.IsInf(v, 1):
		return []byte(`"+Inf"`), nil
	case math.IsInf(v, -1):
		return []byte(`"-Inf"`), nil
	}
	return json.Marshal(v)
}

type s47NodeDump struct {
	X         s47F        `json:"x"`
	Y         s47F        `json:"y"`
	Key       string      `json:"key"`
	Container uint64      `json:"container"`
	Near      []uint64    `json:"near"`
	Owners    [][3]uint64 `json:"owners"`
	Adj       []int       `json:"adj"`
}

type s47OVGDump struct {
	Nodes      []s47NodeDump `json:"nodes"`
	Edges      [][3]s47F     `json:"edges"`
	Ports      [][2]any      `json:"ports"`
	Centers    [][2]any      `json:"centers"`
	Occupied   [][3]any      `json:"occupied"`
	Vertical   [][2]any      `json:"vertical"`
	Horizontal [][2]any      `json:"horizontal"`
	Inside     []uint64      `json:"inside"`
	FixedCache int           `json:"fixedCache"`
	IndexOK    bool          `json:"indexOK"`
}

func s47SortedIDs(nodes []*layoutgraph.Node) []uint64 {
	ids := make([]uint64, 0, len(nodes))
	for _, n := range nodes {
		ids = append(ids, uint64(n.ID))
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func s47JoinIDs(ids []uint64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatUint(id, 10)
	}
	return strings.Join(parts, ",")
}

func s47Owners(node *OVGNode) [][3]uint64 {
	owners := make([][3]uint64, 0, len(node.portOwners()))
	for owner, metadata := range node.portOwners() {
		center := uint64(0)
		if metadata.isCenterPort {
			center = 1
		}
		owners = append(owners, [3]uint64{uint64(owner.ID), uint64(metadata.directions), center})
	}
	sort.Slice(owners, func(i, j int) bool { return owners[i][0] < owners[j][0] })
	return owners
}

func s47DumpOVG(ovg *OVG) s47OVGDump {
	centerOf := map[*OVGNode][]*layoutgraph.Node{}
	for owner, center := range ovg.Centers {
		centerOf[center] = append(centerOf[center], owner)
	}
	keyOf := func(node *OVGNode) string {
		var owners []string
		for _, o := range s47Owners(node) {
			owners = append(owners, fmt.Sprintf("%d:%d:%d", o[0], o[1], o[2]))
		}
		return fmt.Sprintf("c%t;co%s;t%t;o%s", node.IsNodeCenter, s47JoinIDs(s47SortedIDs(centerOf[node])), node.IsTunnel, strings.Join(owners, ","))
	}
	sorted := append([]*OVGNode(nil), ovg.Nodes...)
	keys := map[*OVGNode]string{}
	for _, node := range sorted {
		keys[node] = keyOf(node)
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.X != b.X {
			return a.X < b.X
		}
		if a.Y != b.Y {
			return a.Y < b.Y
		}
		return keys[a] < keys[b]
	})
	index := map[*OVGNode]int{}
	for i, node := range sorted {
		index[node] = i
	}
	ref := func(node *OVGNode) [3]any {
		if i, ok := index[node]; ok {
			return [3]any{i, s47F(node.X), s47F(node.Y)}
		}
		return [3]any{-1, s47F(node.X), s47F(node.Y)}
	}
	edgeIndex := map[*OVGEdge]int{}
	dump := s47OVGDump{IndexOK: true, FixedCache: len(ovg.fixedOverlapsCache)}
	for i, edge := range ovg.Edges {
		edgeIndex[edge] = i
		dump.Edges = append(dump.Edges, [3]s47F{s47F(index[edge.From]), s47F(index[edge.To]), s47F(edge.Distance)})
	}
	for i, node := range ovg.Nodes {
		if node.Index != i {
			dump.IndexOK = false
		}
	}
	for _, node := range sorted {
		nd := s47NodeDump{X: s47F(node.X), Y: s47F(node.Y), Key: keys[node], Owners: s47Owners(node), Near: []uint64{}, Adj: []int{}}
		if node.Container != nil {
			nd.Container = uint64(node.Container.ID)
		}
		var near []*layoutgraph.Node
		for owner := range node.IsNearPort {
			near = append(near, owner)
		}
		nd.Near = append(nd.Near, s47SortedIDs(near)...)
		for _, e := range node.Edges {
			adj := node.adjacent(e)
			if i, ok := index[adj]; ok {
				nd.Adj = append(nd.Adj, i)
			} else {
				nd.Adj = append(nd.Adj, -1)
			}
		}
		dump.Nodes = append(dump.Nodes, nd)
	}
	var owners []*layoutgraph.Node
	for owner := range ovg.Ports {
		owners = append(owners, owner)
	}
	sort.Slice(owners, func(i, j int) bool { return owners[i].ID < owners[j].ID })
	for _, owner := range owners {
		refs := [][3]any{}
		for _, port := range ovg.Ports[owner] {
			refs = append(refs, ref(port))
		}
		dump.Ports = append(dump.Ports, [2]any{uint64(owner.ID), refs})
	}
	owners = owners[:0]
	for owner := range ovg.Centers {
		owners = append(owners, owner)
	}
	sort.Slice(owners, func(i, j int) bool { return owners[i].ID < owners[j].ID })
	for _, owner := range owners {
		dump.Centers = append(dump.Centers, [2]any{uint64(owner.ID), ref(ovg.Centers[owner])})
	}
	var points []geo.Point
	for p := range ovg.OccupiedPoints {
		points = append(points, p)
	}
	sort.Slice(points, func(i, j int) bool {
		if points[i].X != points[j].X {
			return points[i].X < points[j].X
		}
		return points[i].Y < points[j].Y
	})
	for _, p := range points {
		dump.Occupied = append(dump.Occupied, [3]any{s47F(p.X), s47F(p.Y), ref(ovg.OccupiedPoints[p])})
	}
	axis := func(m map[float64][]*OVGEdge) [][2]any {
		var coords []float64
		for c := range m {
			coords = append(coords, c)
		}
		sort.Float64s(coords)
		out := [][2]any{}
		for _, c := range coords {
			ids := []int{}
			for _, e := range m[c] {
				ids = append(ids, edgeIndex[e])
			}
			out = append(out, [2]any{s47F(c), ids})
		}
		return out
	}
	dump.Vertical = axis(ovg.VerticalEdges)
	dump.Horizontal = axis(ovg.HorizontalEdges)
	for _, n := range ovg.NodesInsideBoundingBox {
		dump.Inside = append(dump.Inside, uint64(n.ID))
	}
	return dump
}

// ── Probes ───────────────────────────────────────────────────────────────────

type s47CountingCtx struct {
	context.Context
	calls    int
	cancelAt int // the cancelAt-th Err call (1-based) and later return Canceled; 0 = never
}

func (ctx *s47CountingCtx) Err() error {
	ctx.calls++
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

type s47Counters struct {
	Candidates uint64 `json:"candidates"`
	Nodes      uint64 `json:"nodes"`
	Edges      uint64 `json:"edges"`
	Work       uint64 `json:"work"`
}

// s47ProbeCounters records counters only for successful probes: where a
// failing build stops mid-construction depends on Go map order.
func s47ProbeCounters(guard *ovgBuildGuard, err error) *s47Counters {
	if err != nil {
		return nil
	}
	counters := s47GuardCounters(guard)
	return &counters
}

func s47GuardCounters(guard *ovgBuildGuard) s47Counters {
	return s47Counters{Candidates: guard.candidates, Nodes: guard.nodes, Edges: guard.edges, Work: guard.work}
}

type s47LimitProbe struct {
	Resource string       `json:"resource"`
	Limit    uint64       `json:"limit"`
	Error    string       `json:"error"`
	Counters *s47Counters `json:"counters"`
}

type s47CancelProbe struct {
	At       int          `json:"at"`
	Error    string       `json:"error"`
	Counters *s47Counters `json:"counters"`
	Calls    int          `json:"calls"`
}

type s47Budget struct {
	Totals    s47Counters      `json:"totals"`
	ErrCalls  int              `json:"errCalls"`
	Limits    []s47LimitProbe  `json:"limits"`
	Aggregate []s47LimitProbe  `json:"aggregate"`
	Cancel    []s47CancelProbe `json:"cancel"`
}

type s47Result struct {
	Error    string      `json:"error"`
	Panic    string      `json:"panic,omitempty"`
	OVG      *s47OVGDump `json:"ovg,omitempty"`
	Totals   s47Counters `json:"totals"`
	Restored [][5]s47F   `json:"restored,omitempty"`
	Budget   *s47Budget  `json:"budget,omitempty"`
}

func s47ErrString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func s47Limits(resource string, limit uint64) ovgBuildLimits {
	limits := defaultOVGBuildLimits()
	switch resource {
	case "candidates":
		limits.intersectionCandidates = limit
	case "nodes":
		limits.nodes = limit
	case "edges":
		limits.edges = limit
	case "work":
		limits.work = limit
	}
	return limits
}

func s47CancelPoints(total int) []int {
	if total <= 240 {
		points := make([]int, 0, total+1)
		for at := 1; at <= total+1; at++ {
			points = append(points, at)
		}
		return points
	}
	seen := map[int]bool{}
	var points []int
	add := func(at int) {
		if at >= 1 && at <= total+1 && !seen[at] {
			seen[at] = true
			points = append(points, at)
		}
	}
	for at := 1; at <= 8; at++ {
		add(at)
	}
	stride := total / 48
	for at := 9; at < total; at += stride {
		add(at)
	}
	for at := total - 3; at <= total+1; at++ {
		add(at)
	}
	sort.Ints(points)
	return points
}

func (spec s47Spec) budget(t *testing.T) *s47Budget {
	t.Helper()
	b := spec.build(t)
	guard := newOVGBuildGuardForTest(context.Background(), t)
	if _, err := spec.run(b, guard); err != nil {
		t.Fatal(err)
	}
	budget := &s47Budget{Totals: s47GuardCounters(guard)}
	totals := map[string]uint64{
		"candidates": guard.candidates, "nodes": guard.nodes, "edges": guard.edges, "work": guard.work,
	}
	for _, resource := range []string{"candidates", "nodes", "edges", "work"} {
		for _, limit := range []uint64{totals[resource], totals[resource] - 1} {
			if totals[resource] == 0 && limit != 0 {
				continue
			}
			b := spec.build(t)
			guard, err := newOVGBuildGuard(context.Background(), s47Limits(resource, limit))
			if err != nil {
				t.Fatal(err)
			}
			_, err = spec.run(b, guard)
			budget.Limits = append(budget.Limits, s47LimitProbe{Resource: resource, Limit: limit, Error: s47ErrString(err), Counters: s47ProbeCounters(guard, err)})
		}
	}
	for _, limit := range []uint64{guard.work, guard.work - 1, guard.work / 2} {
		b := spec.build(t)
		aggregate, err := newRouteWorkGuard(context.Background(), "EdgeRouting", limit)
		if err != nil {
			t.Fatal(err)
		}
		g, err := newOVGBuildGuard(contextWithRouteAggregateWork(context.Background(), aggregate), defaultOVGBuildLimits())
		if err != nil {
			t.Fatal(err)
		}
		_, err = spec.run(b, g)
		budget.Aggregate = append(budget.Aggregate, s47LimitProbe{Resource: "aggregate", Limit: limit, Error: s47ErrString(err), Counters: s47ProbeCounters(g, err)})
	}
	counting := &s47CountingCtx{Context: context.Background()}
	{
		b := spec.build(t)
		g, err := newOVGBuildGuard(counting, defaultOVGBuildLimits())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := spec.run(b, g); err != nil {
			t.Fatal(err)
		}
	}
	budget.ErrCalls = counting.calls
	for _, at := range s47CancelPoints(counting.calls) {
		b := spec.build(t)
		ctx := &s47CountingCtx{Context: context.Background(), cancelAt: at}
		probe := s47CancelProbe{At: at}
		g, err := newOVGBuildGuard(ctx, defaultOVGBuildLimits())
		if err == nil {
			_, err = spec.run(b, g)
			probe.Counters = s47ProbeCounters(g, err)
		}
		probe.Error = s47ErrString(err)
		probe.Calls = ctx.calls
		budget.Cancel = append(budget.Cancel, probe)
	}
	return budget
}

func (spec s47Spec) result(t *testing.T, withBudget, runProbes bool) (res s47Result) {
	t.Helper()
	b := spec.build(t)
	guard := newOVGBuildGuardForTest(context.Background(), t)
	defer func() {
		if r := recover(); r != nil {
			res = s47Result{Panic: fmt.Sprint(r)}
		}
	}()
	ovg, err := spec.run(b, guard)
	res.Error = s47ErrString(err)
	res.Totals = s47GuardCounters(guard)
	if !withBudget {
		// Work totals depend on Go map order when candidates align with
		// more port owners than they need; budget scenarios avoid that.
		res.Totals.Work = 0
	}
	if ovg != nil {
		dump := s47DumpOVG(ovg)
		res.OVG = &dump
	}
	if spec.Direct != "" {
		for _, n := range b.order {
			res.Restored = append(res.Restored, [5]s47F{s47F(n.ID), s47F(n.TopLeft.X), s47F(n.TopLeft.Y), s47F(n.Width), s47F(n.Height)})
		}
	}
	if runProbes {
		res.Budget = spec.budget(t)
	}
	return res
}

// ── Scenarios ────────────────────────────────────────────────────────────────

type s47Scenario struct {
	Name   string     `json:"name"`
	Spec   s47Spec    `json:"spec"`
	Budget bool       `json:"budget,omitempty"`
	Result *s47Result `json:"result,omitempty"`
}

func s47Grid(count, columns int, dx, dy float64, edges bool) s47Spec {
	var spec s47Spec
	for i := 0; i < count; i++ {
		column, row := i%columns, i/columns
		spec.Nodes = append(spec.Nodes, s47Node{
			ID: uint64(i + 1),
			X:  float64(column)*dx + float64((i*7)%13),
			Y:  float64(row)*dy + float64((i*11)%17),
			W:  float64(40 + (i*5)%23),
			H:  float64(30 + (i*3)%19),
		})
		if edges && i > 0 {
			spec.Edges = append(spec.Edges, s47Edge{From: uint64(i), To: uint64(i + 1)})
		}
		if edges && i >= columns && i%2 == 0 {
			spec.Edges = append(spec.Edges, s47Edge{From: uint64(i - columns + 1), To: uint64(i + 1)})
		}
	}
	return spec
}

// s47Fractional gives node i the coordinate fraction (2i+1)/128 on both axes so
// every port coordinate identifies its owner: no OVG candidate can align with
// more owners than hasUnobstructedLineToPorts needs, which keeps Go's work
// totals independent of map iteration order (budget scenarios).
func s47Fractional(spec s47Spec) s47Spec {
	nodes := append([]s47Node(nil), spec.Nodes...)
	for i := range nodes {
		f := float64(2*i+1) / 128
		nodes[i].X += f
		nodes[i].Y += f
	}
	spec.Nodes = nodes
	return spec
}

func s47Scenarios() []s47Scenario {
	square := func(id uint64, x, y, w, h float64) s47Node { return s47Node{ID: id, X: x, Y: y, W: w, H: h} }
	intersections := s47Grid(9, 3, 170, 150, true)
	intersections.Edges = append(intersections.Edges, s47Edge{From: 1, To: 9}, s47Edge{From: 3, To: 7})
	ports := s47Spec{
		Nodes: []s47Node{
			{ID: 1, X: 0, Y: 0, W: 80, H: 61, Shape: "Diamond"},
			{ID: 2, X: 237, Y: 13, W: 91, H: 57, Shape: "Cloud"},
			{ID: 3, X: 19, Y: 211, W: 63, H: 77, Shape: "Person"},
			{ID: 4, X: 281, Y: 223, W: 97, H: 51, Shape: "Callout"},
			{ID: 5, X: 523, Y: 107, W: 71, H: 67, Shape: "Package"},
			{ID: 6, X: 509, Y: 331, W: 87, H: 43, Shape: "Step"},
		},
		Edges: []s47Edge{{From: 1, To: 2}, {From: 1, To: 3}, {From: 2, To: 4}, {From: 3, To: 4}, {From: 4, To: 5}, {From: 5, To: 6}, {From: 2, To: 5}},
	}
	treeSpec := s47Spec{
		Nodes: []s47Node{
			{ID: 3607948159, X: 1000, Y: 1000, W: 191, H: 111},
			{ID: 873436672, X: 919, Y: 1211, W: 158, H: 126},
			{ID: 2541194078, X: 1127, Y: 1211, W: 130, H: 126, Shape: "StoredData"},
			{ID: 4207512678, X: 919, Y: 1437, W: 158, H: 126},
			{ID: 974102386, X: 1142, Y: 1450, W: 100, H: 100},
		},
		Edges: []s47Edge{
			{From: 3607948159, To: 873436672, Tgt: "triangle"},
			{From: 3607948159, To: 2541194078, Tgt: "triangle"},
			{From: 873436672, To: 4207512678, Tgt: "triangle"},
			{From: 2541194078, To: 974102386, Tgt: "triangle"},
		},
		Trees: true,
	}
	// Level siblings must not tie on the sort axis (TopLeft.X after any
	// transpose): sort.Slice would order them by Go map iteration.
	hierarchyLR := func(direction geo.Orientation) s47Spec {
		return s47Spec{
			Nodes:       []s47Node{square(1, 0, 0, 100, 100), square(2, 100, 13, 100, 100), square(3, 37, 260, 90, 70)},
			Edges:       []s47Edge{{From: 1, To: 3}, {From: 2, To: 3}},
			Directions:  []s47Direction{{Container: 0, Orientation: int(direction)}},
			Hierarchies: []s47Hierarchy{{Levels: []s47Level{{ID: 1, Level: 0}, {ID: 2, Level: 0}, {ID: 3, Level: 1}}}},
			Direct:      "hierarchy",
		}
	}
	hierarchyFull := s47Spec{
		Nodes:       []s47Node{square(1, 0, 0, 80, 60), square(2, 0, 160, 80, 60), square(3, 171, 197, 57, 43), square(4, 300, 23, 61, 47)},
		Edges:       []s47Edge{{From: 1, To: 2}, {From: 2, To: 3}, {From: 4, To: 1}, {From: 4, To: 3}},
		Directions:  []s47Direction{{Container: 0, Orientation: int(geo.Bottom)}},
		Hierarchies: []s47Hierarchy{{Levels: []s47Level{{ID: 1, Level: 0}, {ID: 2, Level: 1}, {ID: 3, Level: 1}}}},
	}
	tableHierarchy := s47Spec{
		Nodes: []s47Node{
			{ID: 1, X: 0, Y: 0, W: 120, H: 90, Shape: "Table", Columns: 3},
			{ID: 2, X: 230, Y: 40, W: 100, H: 60, Shape: "Table", Columns: 2},
			{ID: 3, X: 237, Y: 251, W: 70, H: 50},
		},
		Edges:       []s47Edge{{From: 1, To: 2}, {From: 2, To: 3}},
		Directions:  []s47Direction{{Container: 0, Orientation: int(geo.Right)}},
		Hierarchies: []s47Hierarchy{{Levels: []s47Level{{ID: 1, Level: 0}, {ID: 2, Level: 1}}}},
	}
	scenarios := []s47Scenario{
		{Name: "simple-two-node", Budget: true, Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 40, 40), square(2, 213, 57, 53, 31)},
			Edges: []s47Edge{{From: 1, To: 2}},
		}},
		{Name: "aligned-two-node", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 40, 40), square(2, 200, 100, 40, 40)},
			Edges: []s47Edge{{From: 1, To: 2}},
		}},
		{Name: "l-shape", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 60, 40), square(2, 300, 250, 40, 60)},
			Edges: []s47Edge{{From: 1, To: 2}},
		}},
		{Name: "s-shape", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 50, 50), square(2, 300, 23, 50, 50)},
			Edges: []s47Edge{{From: 1, To: 2}},
		}},
		{Name: "obstacles", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 50, 50), square(2, 150, -20, 40, 110), square(3, 300, 10, 50, 50), square(4, 170, 140, 30, 30)},
			Edges: []s47Edge{{From: 1, To: 3}, {From: 1, To: 4}},
		}},
		{Name: "intersection-heavy", Budget: true, Spec: intersections},
		{Name: "nested-containers", Budget: true, Spec: s47Spec{
			Nodes: []s47Node{
				square(1, 0, 0, 400, 300),
				{ID: 2, X: 40, Y: 40, W: 200, H: 150, Container: 1},
				{ID: 3, X: 80, Y: 80, W: 50, H: 40, Container: 2},
				{ID: 4, X: 300, Y: 200, W: 40, H: 40, Container: 1},
				square(5, 600, 100, 50, 50),
			},
			Edges: []s47Edge{{From: 3, To: 5}, {From: 4, To: 3}},
		}},
		{Name: "tree", Spec: treeSpec},
		{Name: "table-ports", Spec: s47Spec{
			Nodes: []s47Node{
				{ID: 1, X: 0, Y: 0, W: 120, H: 90, Shape: "Table", Columns: 3},
				{ID: 2, X: 300, Y: 40, W: 100, H: 60, Shape: "Table", Columns: 2},
				{ID: 3, X: 150, Y: 250, W: 60, H: 40, Shape: "Table"},
			},
			Edges: []s47Edge{{From: 1, To: 2}, {From: 3, To: 1}},
		}},
		{Name: "cluster", Spec: s47Spec{
			Nodes:    []s47Node{square(1, 0, 0, 50, 40), square(2, 70, 0, 50, 40), square(3, 300, 150, 60, 40)},
			Edges:    []s47Edge{{From: 1, To: 3}, {From: 2, To: 3}, {From: 1, To: 2}},
			Clusters: []s47Group{{Vessel: s47Node{ID: 100, X: -10, Y: -10, W: 140, H: 60}, Nodes: []uint64{1, 2}}},
		}},
		{Name: "container-ports", Spec: s47Spec{
			Nodes: []s47Node{
				square(1, 0, 0, 300, 200),
				{ID: 2, X: 50, Y: 50, W: 40, H: 40, Container: 1},
				square(3, 500, 80, 40, 40),
			},
			Edges: []s47Edge{{From: 1, To: 3}, {From: 2, To: 3}},
		}},
		{Name: "tunnels", Budget: true, Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 100, 160), square(2, 300, 13, 100, 170), square(3, 160, 61, 40, 30)},
			Edges: []s47Edge{{From: 1, To: 2}, {From: 1, To: 2}, {From: 1, To: 2}, {From: 2, To: 1}},
		}},
		{Name: "vertical-tunnels", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 200, 60), square(2, 20, 300, 170, 60)},
			Edges: []s47Edge{{From: 1, To: 2}, {From: 1, To: 2}},
		}},
		{Name: "multiple-ports", Budget: true, Spec: ports},
		{Name: "port-merging", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 100, 100), square(2, 100, 0, 100, 100), square(3, 1, 300, 1, 1)},
			Edges: []s47Edge{{From: 1, To: 2}, {From: 3, To: 1}},
		}},
		{Name: "hierarchy-full", Budget: true, Spec: hierarchyFull},
		{Name: "hierarchy-table", Spec: tableHierarchy},
		{Name: "hierarchy-direct-left", Spec: hierarchyLR(geo.Left)},
		{Name: "hierarchy-direct-top", Spec: hierarchyLR(geo.Top)},
		{Name: "hierarchy-direct-right", Spec: hierarchyLR(geo.Right)},
		{Name: "sequence", Spec: s47Spec{
			Nodes: []s47Node{
				{ID: 1, X: 0, Y: 0, W: 80, H: 40, Shape: "Step"},
				{ID: 2, X: 80, Y: 0, W: 80, H: 40, Shape: "Step"},
				{ID: 3, X: 160, Y: 0, W: 80, H: 40, Shape: "Step"},
				square(4, 90, 200, 50, 40),
			},
			Edges:     []s47Edge{{From: 1, To: 4}, {From: 3, To: 4}, {From: 2, To: 4}},
			Sequences: []s47Group{{Vessel: s47Node{ID: 100, X: 0, Y: 0, W: 240, H: 40}, Nodes: []uint64{1, 2, 3}}},
		}},
		{Name: "fixed-invisible-nearby", Spec: s47Spec{
			Nodes: []s47Node{
				{ID: 1, X: 0, Y: 0, W: 60, H: 60, Fixed: true},
				square(2, 30, 30, 60, 60),
				{ID: 3, X: 250, Y: 20, W: 50, H: 50, Invisible: true},
				square(4, 400, 200, 40, 40),
			},
			Edges:  []s47Edge{{From: 1, To: 3}, {From: 3, To: 4}, {From: 2, To: 4}},
			Nearby: []s47Node{square(50, 150, 150, 40, 40)},
		}},
		{Name: "skip-pathing", Spec: s47Spec{
			Nodes: []s47Node{
				square(1, 0, 0, 300, 200),
				{ID: 2, X: 40, Y: 40, W: 40, H: 40, Container: 1},
				{ID: 3, X: 150, Y: 100, W: 40, H: 40, Container: 1},
				square(4, 450, 50, 50, 50),
				square(5, 450, 250, 50, 50),
			},
			Edges: []s47Edge{{From: 4, To: 5}, {From: 1, To: 4}},
		}},
		{Name: "loop-edge", Spec: s47Spec{
			Nodes: []s47Node{square(1, 0, 0, 60, 40), square(2, 200, 100, 60, 40)},
			Edges: []s47Edge{{From: 1, To: 1}, {From: 1, To: 2}},
		}},
		{Name: "large-sparse", Budget: true, Spec: s47Grid(25, 5, 260, 230, true)},
		{Name: "panic-empty-hierarchy", Spec: s47Spec{
			Nodes:       []s47Node{square(1, 0, 0, 40, 40), square(2, 200, 0, 40, 40)},
			Edges:       []s47Edge{{From: 1, To: 2}},
			Hierarchies: []s47Hierarchy{{Members: []uint64{2}}},
		}},
		{Name: "panic-missing-level", Spec: s47Spec{
			Nodes:       []s47Node{square(1, 0, 0, 40, 40), square(2, 0, 300, 40, 40)},
			Edges:       []s47Edge{{From: 1, To: 2}},
			Hierarchies: []s47Hierarchy{{Levels: []s47Level{{ID: 1, Level: 0}, {ID: 2, Level: 2}}}},
		}},
	}
	for i := range scenarios {
		if scenarios[i].Budget {
			scenarios[i].Spec = s47Fractional(scenarios[i].Spec)
		}
	}
	return scenarios
}

func TestSlice47OVGOracle(t *testing.T) {
	scenarios := s47Scenarios()
	for i := range scenarios {
		sc := &scenarios[i]
		first := sc.Spec.result(t, sc.Budget, sc.Budget)
		encoded, err := json.Marshal(first)
		if err != nil {
			t.Fatalf("scenario %s: %v", sc.Name, err)
		}
		// Go map iteration is randomized per run; repeated builds must agree.
		for repeat := 0; repeat < 6; repeat++ {
			again := sc.Spec.result(t, sc.Budget, sc.Budget && repeat < 2)
			if !(sc.Budget && repeat < 2) {
				again.Budget = first.Budget
			}
			encodedAgain, err := json.Marshal(again)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(encoded, encodedAgain) {
				t.Fatalf("scenario %s is not deterministic across Go map orders", sc.Name)
			}
		}
		sc.Result = &first
	}

	encoded, err := json.Marshal(map[string]any{
		"generator": "internal/routing/go_slice47_ovg_oracle_test.go",
		"scenarios": scenarios,
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice47-ovg-reference.json")
	if os.Getenv("TALA_SLICE47_ORACLE") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read committed fixture: %v (regenerate with TALA_SLICE47_ORACLE=1)", err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, encoded) {
		t.Fatalf("go-slice47-ovg-reference.json is stale; regenerate with TALA_SLICE47_ORACLE=1")
	}
}
