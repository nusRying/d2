package placement

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 44 placement oracle (transpose, cluster optimization, gap reduction,
// optimizer spatial index). With TALA_SLICE44_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice44-reference.json; otherwise it recomputes every
// value and asserts the committed fixture still matches pinned Go.

// ── Portable graph specs ─────────────────────────────────────────────────────

type s44NodeSpec struct {
	ID        uint64  `json:"id"`
	W         float64 `json:"w"`
	H         float64 `json:"h"`
	Placed    bool    `json:"placed"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Container uint64  `json:"container,omitempty"`
	Fixed     bool    `json:"fixed,omitempty"`
	FX        float64 `json:"fx,omitempty"`
	FY        float64 `json:"fy,omitempty"`
}

type s44EdgeSpec struct {
	From uint64 `json:"from"`
	To   uint64 `json:"to"`
}

type s44GraphSpec struct {
	CellSize float64       `json:"cellSize"`
	Nodes    []s44NodeSpec `json:"nodes"`
	Edges    []s44EdgeSpec `json:"edges"`
}

func (spec s44GraphSpec) build() (*layoutgraph.Graph, map[uint64]*layoutgraph.Node) {
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
	for _, es := range spec.Edges {
		g.Connect(nodes[es.From], nodes[es.To])
	}
	return g, nodes
}

type s44Box struct {
	ID     uint64  `json:"id"`
	Placed bool    `json:"placed"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
}

func s44Boxes(nodes []*layoutgraph.Node) []s44Box {
	out := make([]s44Box, 0, len(nodes))
	for _, n := range nodes {
		b := s44Box{ID: uint64(n.ID), W: n.Width, H: n.Height}
		if n.TopLeft != nil {
			b.Placed = true
			b.X = n.TopLeft.X
			b.Y = n.TopLeft.Y
		}
		out = append(out, b)
	}
	return out
}

func s44Err(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// randomFlatSpec places nodes on a jittered grid (no initial overlaps) and
// connects them with a random tree plus a few extra edges.
func randomFlatSpec(rng *rand.Rand, nodeCount int, spacing float64) s44GraphSpec {
	spec := s44GraphSpec{CellSize: 10}
	cols := int(math.Ceil(math.Sqrt(float64(nodeCount))))
	perm := rng.Perm(cols * cols)
	sizes := []float64{20, 40, 60}
	for i := 0; i < nodeCount; i++ {
		cell := perm[i]
		spec.Nodes = append(spec.Nodes, s44NodeSpec{
			ID:     uint64(i + 1),
			W:      sizes[rng.Intn(len(sizes))],
			H:      sizes[rng.Intn(2)],
			Placed: true,
			X:      float64(cell%cols)*spacing + float64(rng.Intn(4))*10,
			Y:      float64(cell/cols)*spacing + float64(rng.Intn(4))*10,
		})
	}
	seen := map[[2]uint64]bool{}
	addEdge := func(a, b uint64) {
		if a == b || seen[[2]uint64{a, b}] || seen[[2]uint64{b, a}] {
			return
		}
		seen[[2]uint64{a, b}] = true
		spec.Edges = append(spec.Edges, s44EdgeSpec{From: a, To: b})
	}
	for i := 1; i < nodeCount; i++ {
		addEdge(uint64(rng.Intn(i)+1), uint64(i+1))
	}
	for i := 0; i < nodeCount/3; i++ {
		addEdge(uint64(rng.Intn(nodeCount)+1), uint64(rng.Intn(nodeCount)+1))
	}
	return spec
}

func s44Guard(limit int64) (*limits.WorkGuard, context.Context) {
	guard, err := limits.NewWorkGuard(context.Background(), "Slice44PlacementOracle", limit)
	if err != nil {
		panic(err)
	}
	return guard, layoutgraph.ContextWithTransactionWorkGuard(context.Background(), guard)
}

// s44CountingContext returns context.Canceled from the cancelAt-th Err call.
type s44CountingContext struct {
	context.Context
	calls    int
	cancelAt int
}

func (ctx *s44CountingContext) Err() error {
	ctx.calls++
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

// ── Transpose ────────────────────────────────────────────────────────────────

type s44TransposeRun struct {
	Target    uint64   `json:"target"`
	Changed   bool     `json:"changed"`
	Error     string   `json:"error"`
	Used      int64    `json:"used"`
	Rotations int      `json:"rotations"`
	Boxes     []s44Box `json:"boxes"`
}

type s44TransposeCase struct {
	Name       string            `json:"name"`
	Spec       s44GraphSpec      `json:"spec"`
	Abductions bool              `json:"abductions"`
	Runs       []s44TransposeRun `json:"runs"`
}

// rotationsApplied reports which rotation count around which adjacent node
// produced the target's final position (0 when unchanged).
func rotationsApplied(spec s44GraphSpec, target uint64, final s44Box, round bool) int {
	for k := 1; k <= 3; k++ {
		g, nodes := spec.build()
		node := nodes[target]
		for _, e := range node.Edges {
			g2, nodes2 := spec.build()
			_ = g
			n2 := nodes2[target]
			rotateAround(n2, g2, nodes2[uint64(node.Adjacent(e).ID)], k, round)
			if n2.TopLeft.X == final.X && n2.TopLeft.Y == final.Y {
				return k
			}
		}
	}
	return 0
}

func runTransposeCase(name string, spec s44GraphSpec, abductions bool) s44TransposeCase {
	out := s44TransposeCase{Name: name, Spec: spec, Abductions: abductions}
	for _, ns := range spec.Nodes {
		g, nodes := spec.build()
		guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
		var edgeAbductions []*layoutgraph.EdgeAbduction
		if abductions {
			edgeAbductions = []*layoutgraph.EdgeAbduction{}
		}
		changed, err := transpose(ctx, g, nodes[ns.ID], edgeAbductions)
		run := s44TransposeRun{
			Target: ns.ID, Changed: changed, Error: s44Err(err), Used: guard.Used(),
			Boxes: s44Boxes(g.Nodes),
		}
		if changed {
			for _, b := range run.Boxes {
				if b.ID == ns.ID {
					run.Rotations = rotationsApplied(spec, ns.ID, b, abductions)
				}
			}
		}
		out.Runs = append(out.Runs, run)
	}
	return out
}

type s44Probe struct {
	CancelAt int    `json:"cancelAt"`
	Error    string `json:"error"`
	Canceled bool   `json:"canceled"`
	Changed  bool   `json:"changed"`
	Restored bool   `json:"restored"`
}

type s44Boundary struct {
	W        int64    `json:"w"`
	Error    string   `json:"error"`
	Used     int64    `json:"used"`
	Restored bool     `json:"restored"`
	Boxes    []s44Box `json:"boxes"`
}

// ── Cluster optimization fixtures (mirrors cluster_optimization_atomicity_test.go) ──

type s44ClusterRun struct {
	Name         string    `json:"name"`
	Changed      bool      `json:"changed"`
	Error        string    `json:"error"`
	Used         int64     `json:"used"`
	Arrangements []string  `json:"arrangements"`
	Desired      []string  `json:"desired"`
	Paddings     []float64 `json:"paddings"`
	CellSize     float64   `json:"cellSize"`
	Boxes        []s44Box  `json:"boxes"`
}

func clusterFixtureNodes(fixtures []optimizeClustersFixture) []*layoutgraph.Node {
	var nodes []*layoutgraph.Node
	for _, f := range fixtures {
		nodes = append(nodes, f.nodes...)
	}
	return nodes
}

func clusterRunRecord(name string, graph *layoutgraph.Graph, fixtures []optimizeClustersFixture, changed bool, err error, used int64) s44ClusterRun {
	run := s44ClusterRun{Name: name, Changed: changed, Error: s44Err(err), Used: used, CellSize: graph.CellSize}
	for _, f := range fixtures {
		run.Arrangements = append(run.Arrangements, string(f.cluster.Arrangement))
		run.Desired = append(run.Desired, string(f.cluster.DesiredArrangement))
		run.Paddings = append(run.Paddings, f.cluster.Padding)
	}
	run.Boxes = s44Boxes(clusterFixtureNodes(fixtures))
	return run
}

type s44GapSweepPoint struct {
	Limit int64     `json:"limit"`
	Error string    `json:"error"`
	Used  int64     `json:"used"`
	Geom  []float64 `json:"geom"` // x, y, w, h per graph node
}

func s44Geometry(nodes []*layoutgraph.Node) []float64 {
	out := make([]float64, 0, 4*len(nodes))
	for _, n := range nodes {
		out = append(out, n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height)
	}
	return out
}

type s44GapSweep struct {
	Name      string             `json:"name"`
	Axis      string             `json:"axis"`
	Direction string             `json:"direction"`
	W         int64              `json:"w"`
	Points    []s44GapSweepPoint `json:"points"`
}

type s44LimitPoint struct {
	Limit    int64  `json:"limit"`
	Error    string `json:"error"`
	Used     int64  `json:"used"`
	Restored bool   `json:"restored"`
}

func boxesEqual(a, b []s44Box) bool {
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

// ── Gap reduction ────────────────────────────────────────────────────────────

type s44GapRun struct {
	Axis      string   `json:"axis"`
	Direction string   `json:"direction"`
	Changed   bool     `json:"changed"`
	Error     string   `json:"error"`
	Used      int64    `json:"used"`
	Boxes     []s44Box `json:"boxes"`
}

type s44GapCase struct {
	Name string       `json:"name"`
	Spec s44GraphSpec `json:"spec"`
	Runs []s44GapRun  `json:"runs"`
}

var s44GapModes = []struct {
	axis      layoutAxis
	direction traversalDirection
	axisName  string
	dirName   string
}{
	{horizontalAxis, forwardDirection, "horizontal", "forward"},
	{horizontalAxis, backwardDirection, "horizontal", "backward"},
	{verticalAxis, forwardDirection, "vertical", "forward"},
	{verticalAxis, backwardDirection, "vertical", "backward"},
}

func runGapCase(name string, spec s44GraphSpec) s44GapCase {
	out := s44GapCase{Name: name, Spec: spec}
	for _, mode := range s44GapModes {
		g, _ := spec.build()
		guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
		txn, err := g.NewRequestTransaction(ctx, layoutgraph.TransactionOptions{AffectContainers: true})
		if err != nil {
			panic(err)
		}
		changed, err := gapNormalization(ctx, layoutgraph.Nodes(g.Nodes), txn, g, gapNormalizationOptions{
			axis: mode.axis, direction: mode.direction,
		})
		out.Runs = append(out.Runs, s44GapRun{
			Axis: mode.axisName, Direction: mode.dirName, Changed: changed, Error: s44Err(err),
			Used: guard.Used(), Boxes: s44Boxes(g.Nodes),
		})
	}
	return out
}

type s44GapQueries struct {
	Spec           s44GraphSpec `json:"spec"`
	IsBetween      []string     `json:"isBetween"`      // per (node, behind, ahead) in id order: 4 chars h/f,h/b,v/f,v/b
	NearestAhead   [][4]uint64  `json:"nearestAhead"`   // per node
	NearestBetween [][4]uint64  `json:"nearestBetween"` // per (behind, ahead)
}

func runGapQueries(spec s44GraphSpec) s44GapQueries {
	g, _ := spec.build()
	out := s44GapQueries{Spec: spec}
	flags := []struct{ h, f bool }{{true, true}, {true, false}, {false, true}, {false, false}}
	for _, n := range g.Nodes {
		for _, behind := range g.Nodes {
			for _, ahead := range g.Nodes {
				s := ""
				for _, fl := range flags {
					if isBetween(n, behind, ahead, fl.h, fl.f) {
						s += "1"
					} else {
						s += "0"
					}
				}
				out.IsBetween = append(out.IsBetween, s)
			}
		}
		var row [4]uint64
		for i, fl := range flags {
			if ahead := nearestConnectedAhead(n, fl.h, fl.f); ahead != nil {
				row[i] = uint64(ahead.ID)
			}
		}
		out.NearestAhead = append(out.NearestAhead, row)
	}
	for _, behind := range g.Nodes {
		for _, ahead := range g.Nodes {
			var row [4]uint64
			for i, fl := range flags {
				if nb := nearestBetween(layoutgraph.Nodes(g.Nodes), behind, ahead, nil, fl.h, fl.f); nb != nil {
					row[i] = uint64(nb.ID)
				}
			}
			out.NearestBetween = append(out.NearestBetween, row)
		}
	}
	return out
}

// ── Optimizer spatial index ──────────────────────────────────────────────────

type s44SpatialQuery struct {
	Mover       uint64  `json:"mover"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Overlaps    bool    `json:"overlaps"`
	OverlapUsed uint64  `json:"overlapUsed"`
	Occupant    uint64  `json:"occupant"`
	Occupied    bool    `json:"occupied"`
	OccupyUsed  uint64  `json:"occupyUsed"`
	CanMove     bool    `json:"canMove"`
	CanMoveUsed uint64  `json:"canMoveUsed"`
	Excepted    bool    `json:"excepted"`
	ExceptUsed  uint64  `json:"exceptUsed"`
}

type s44SpatialCase struct {
	Name        string            `json:"name"`
	Spec        s44GraphSpec      `json:"spec"`
	Mutation    string            `json:"mutation"`
	RebuildUsed uint64            `json:"rebuildUsed"`
	Queries     []s44SpatialQuery `json:"queries"`
}

func spatialSpec(rng *rand.Rand, nodeCount int) s44GraphSpec {
	spec := s44GraphSpec{CellSize: 10}
	for i := 0; i < nodeCount; i++ {
		spec.Nodes = append(spec.Nodes, s44NodeSpec{
			ID: uint64(i + 1), W: float64(10 + rng.Intn(5)*10), H: float64(10 + rng.Intn(5)*10),
			Placed: true, X: float64(rng.Intn(60) * 30), Y: float64(rng.Intn(60) * 30),
		})
	}
	for i := 0; i < nodeCount/2; i++ {
		a, b := uint64(rng.Intn(nodeCount)+1), uint64(rng.Intn(nodeCount)+1)
		if a != b {
			spec.Edges = append(spec.Edges, s44EdgeSpec{From: a, To: b})
		}
	}
	return spec
}

// applySpatialMutation perturbs the graph after building, before or after the
// index rebuild, to exercise the legacy fallback paths.
func applySpatialMutation(g *layoutgraph.Graph, nodes map[uint64]*layoutgraph.Node, mutation string, afterRebuild bool) {
	switch mutation {
	case "nan":
		if !afterRebuild {
			nodes[2].TopLeft.X = math.NaN()
		}
	case "inf":
		if !afterRebuild {
			nodes[2].Width = math.Inf(1)
		}
	case "negative":
		if !afterRebuild {
			nodes[2].Width = -5
		}
	case "duplicate":
		if !afterRebuild {
			*nodes[3].TopLeft = *nodes[2].TopLeft
			*nodes[5].TopLeft = *nodes[2].TopLeft
		}
	case "staleCount":
		if afterRebuild {
			extra := layoutgraph.NewNode(9999, 10, 10)
			extra.TopLeft = geo.NewPoint(15, 15)
			g.AddNewNodeToContainer(nil, extra)
		}
	}
}

func runSpatialCase(name string, spec s44GraphSpec, mutation string, rng *rand.Rand) s44SpatialCase {
	out := s44SpatialCase{Name: name, Spec: spec, Mutation: mutation}
	g, nodes := spec.build()
	applySpatialMutation(g, nodes, mutation, false)
	optim := &sizedOptimizer{g: g}
	guard, err := limits.NewOptimizationWorkGuard(context.Background(), "Slice44SpatialOracle", 1<<40)
	if err != nil {
		panic(err)
	}
	if mutation == "staleGraph" {
		other, _ := spec.build()
		if err := optim.spatialIndex.rebuild(other, guard); err != nil {
			panic(err)
		}
	} else if err := optim.rebuildSpatialIndex(guard); err != nil {
		panic(err)
	}
	out.RebuildUsed = guard.Used()
	applySpatialMutation(g, nodes, mutation, true)

	measure := func(fn func() error) uint64 {
		before := guard.Used()
		if err := fn(); err != nil {
			panic(err)
		}
		return guard.Used() - before
	}
	for i := 0; i < 40; i++ {
		mover := g.Nodes[rng.Intn(len(spec.Nodes))]
		var point *geo.Point
		switch {
		case i%10 == 0:
			point = geo.NewPoint(mover.TopLeft.X, mover.TopLeft.Y)
		case i%10 == 1:
			other := g.Nodes[rng.Intn(len(spec.Nodes))]
			point = geo.NewPoint(other.TopLeft.X, other.TopLeft.Y)
		default:
			point = geo.NewPoint(float64(rng.Intn(70)*25), float64(rng.Intn(70)*25))
		}
		if math.IsNaN(point.X) || math.IsNaN(point.Y) {
			// JSON cannot carry NaN; non-finite movers still exercise fallback.
			point = geo.NewPoint(float64(rng.Intn(70)*25), float64(rng.Intn(70)*25))
		}
		q := s44SpatialQuery{Mover: uint64(mover.ID), X: point.X, Y: point.Y}
		q.OverlapUsed = measure(func() error {
			overlaps, err := optim.indexedDoesOverlap(mover, point, nil, guard)
			q.Overlaps = overlaps
			return err
		})
		q.OccupyUsed = measure(func() error {
			occupant, occupied, err := optim.indexedIsOccupied(point, guard)
			q.Occupied = occupied
			if occupant != nil {
				q.Occupant = uint64(occupant.ID)
			}
			return err
		})
		q.CanMoveUsed = measure(func() error {
			canMove, err := optim.indexedCanMove(mover, point, guard)
			q.CanMove = canMove
			return err
		})
		exceptions := []*layoutgraph.Node{g.Nodes[0], g.Nodes[len(g.Nodes)/2]}
		q.ExceptUsed = measure(func() error {
			overlaps, err := optim.indexedDoesOverlap(mover, point, exceptions, guard)
			q.Excepted = overlaps
			return err
		})
		out.Queries = append(out.Queries, q)
	}
	return out
}

// ── Oracle ───────────────────────────────────────────────────────────────────

type slice44OracleData struct {
	RotateAround struct {
		X1 float64 `json:"x1"`
		Y1 float64 `json:"y1"`
		X2 float64 `json:"x2"`
		Y2 float64 `json:"y2"`
		X3 float64 `json:"x3"`
		Y3 float64 `json:"y3"`
		RX float64 `json:"rx"`
		RY float64 `json:"ry"`
	} `json:"rotateAround"`

	Transpose         []s44TransposeCase `json:"transpose"`
	TransposeGuards   []s44TransposeCase `json:"transposeGuards"`
	TransposeBoundary s44Boundary        `json:"transposeBoundary"`
	TransposeProbes   []s44Probe         `json:"transposeProbes"`
	TransposeVessel   struct {
		Changed     bool     `json:"changed"`
		Error       string   `json:"error"`
		Used        int64    `json:"used"`
		Arrangement string   `json:"arrangement"`
		Boxes       []s44Box `json:"boxes"`
	} `json:"transposeVessel"`

	Cluster                 []s44ClusterRun `json:"cluster"`
	ClusterBoundary         s44Boundary     `json:"clusterBoundary"`
	ClusterLimitSweep       []s44LimitPoint `json:"clusterLimitSweep"`
	ClusterMoveSweep        []s44LimitPoint `json:"clusterMoveSweep"`
	ClusterCacheChargeDelta int64           `json:"clusterCacheChargeDelta"`

	Gap             []s44GapCase    `json:"gap"`
	GapQueries      []s44GapQueries `json:"gapQueries"`
	GapBoundary     s44Boundary     `json:"gapBoundary"`
	GapRefreshSweep []s44GapSweep   `json:"gapRefreshSweep"`

	Spatial []s44SpatialCase `json:"spatial"`
}

func TestGenerateSlice44Oracle(t *testing.T) {
	var oracle slice44OracleData

	// rotateAround: 1/2/3 rotations and cell rounding.
	{
		spec := s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 20, H: 20, Placed: true, X: 50, Y: 50},
			{ID: 2, W: 20, H: 30, Placed: true, X: 50, Y: 103},
		}}
		for k, dst := range []*[2]float64{
			{0, 0}, {0, 0}, {0, 0},
		} {
			g, nodes := spec.build()
			rotateAround(nodes[2], g, nodes[1], k+1, false)
			dst[0], dst[1] = nodes[2].TopLeft.X, nodes[2].TopLeft.Y
			switch k {
			case 0:
				oracle.RotateAround.X1, oracle.RotateAround.Y1 = dst[0], dst[1]
			case 1:
				oracle.RotateAround.X2, oracle.RotateAround.Y2 = dst[0], dst[1]
			case 2:
				oracle.RotateAround.X3, oracle.RotateAround.Y3 = dst[0], dst[1]
			}
		}
		g, nodes := spec.build()
		g.CellSize = 7
		rotateAround(nodes[2], g, nodes[1], 1, true)
		oracle.RotateAround.RX, oracle.RotateAround.RY = nodes[2].TopLeft.X, nodes[2].TopLeft.Y
	}

	// Transpose over seeded random graphs: every node, both scoring paths.
	for seed := int64(0); seed < 14; seed++ {
		rng := rand.New(rand.NewSource(100 + seed))
		spec := randomFlatSpec(rng, 5+rng.Intn(5), 150)
		oracle.Transpose = append(oracle.Transpose, runTransposeCase("random", spec, false))
		if seed%2 == 0 {
			oracle.Transpose = append(oracle.Transpose, runTransposeCase("random-abductions", spec, true))
		}
	}

	// Transpose early rejections: fixed, three edges, diagonal second
	// neighbor (TestTransposeRejectsDiagonalSecondNeighbor), descendant.
	{
		diagonal := s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 10, H: 10, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 10, H: 10, Placed: true, X: 30, Y: 0},
			{ID: 3, W: 10, H: 10, Placed: true, X: 30, Y: 30},
			{ID: 4, W: 10, H: 10, Placed: true, X: 0, Y: 30},
		}, Edges: []s44EdgeSpec{{1, 2}, {1, 3}, {2, 4}}}
		oracle.TransposeGuards = append(oracle.TransposeGuards, runTransposeCase("diagonal", diagonal, false))
		fixed := s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 20, H: 20, Placed: true, X: 0, Y: 0, Fixed: true, FX: 0, FY: 0},
			{ID: 2, W: 20, H: 20, Placed: true, X: 200, Y: 0},
			{ID: 3, W: 20, H: 20, Placed: true, X: 400, Y: 0},
			{ID: 4, W: 20, H: 20, Placed: true, X: 200, Y: 200},
			{ID: 5, W: 20, H: 20, Placed: true, X: 600, Y: 0},
		}, Edges: []s44EdgeSpec{{1, 2}, {2, 3}, {2, 4}, {3, 5}}}
		oracle.TransposeGuards = append(oracle.TransposeGuards, runTransposeCase("fixed-and-three-edges", fixed, false))
		nested := s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 300, H: 200, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 60, Y: 60, Container: 1},
			{ID: 3, W: 40, H: 40, Placed: true, X: 200, Y: 60, Container: 1},
			{ID: 4, W: 40, H: 40, Placed: true, X: 600, Y: 60},
			{ID: 5, W: 40, H: 40, Placed: true, X: 800, Y: 60},
		}, Edges: []s44EdgeSpec{{1, 2}, {2, 3}, {3, 4}, {4, 5}}}
		oracle.TransposeGuards = append(oracle.TransposeGuards, runTransposeCase("container", nested, false))
	}

	// Choose the first changed random transpose for the boundary and probes.
	var boundarySpec s44GraphSpec
	var boundaryTarget uint64
	for _, c := range oracle.Transpose {
		if c.Abductions {
			continue
		}
		for _, r := range c.Runs {
			if r.Changed && boundaryTarget == 0 {
				boundarySpec, boundaryTarget = c.Spec, r.Target
			}
		}
	}
	if boundaryTarget == 0 {
		t.Fatal("no changed transpose case")
	}
	{
		measure := func(limit int64) (s44GraphSpec, *layoutgraph.Graph, *limits.WorkGuard, bool, error) {
			g, nodes := boundarySpec.build()
			guard, ctx := s44Guard(limit)
			changed, err := transpose(ctx, g, nodes[boundaryTarget], nil)
			return boundarySpec, g, guard, changed, err
		}
		_, _, guard, _, err := measure(limits.MaxTransactionWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		w := guard.Used()
		if _, _, g2, changed, err := measure(w); err != nil || !changed || g2.Used() != w {
			t.Fatalf("transpose at W: %v", err)
		}
		spec, g, guard, changed, err := measure(w - 1)
		if err == nil || changed {
			t.Fatal("transpose at W-1 succeeded")
		}
		initial, _ := spec.build()
		oracle.TransposeBoundary = s44Boundary{
			W: w, Error: err.Error(), Used: guard.Used(),
			Restored: boxesEqual(s44Boxes(g.Nodes), s44Boxes(initial.Nodes)), Boxes: s44Boxes(g.Nodes),
		}
	}
	// Cancel at every context checkpoint of the boundary transpose.
	{
		count := &s44CountingContext{Context: context.Background()}
		g, nodes := boundarySpec.build()
		if _, err := transpose(count, g, nodes[boundaryTarget], nil); err != nil {
			t.Fatal(err)
		}
		initial, _ := boundarySpec.build()
		for cancelAt := 1; cancelAt <= count.calls; cancelAt++ {
			g, nodes := boundarySpec.build()
			ctx := &s44CountingContext{Context: context.Background(), cancelAt: cancelAt}
			changed, err := transpose(ctx, g, nodes[boundaryTarget], nil)
			oracle.TransposeProbes = append(oracle.TransposeProbes, s44Probe{
				CancelAt: cancelAt, Error: s44Err(err), Canceled: errors.Is(err, context.Canceled),
				Changed: changed, Restored: boxesEqual(s44Boxes(g.Nodes), s44Boxes(initial.Nodes)),
			})
		}
	}

	// Transpose a cluster vessel: nested optimizeCluster shares the guard.
	{
		graph := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 200, 100)
		a.TopLeft = geo.NewPoint(1000, 1000)
		c1 := layoutgraph.NewNode(3, 200, 100)
		c1.TopLeft = geo.NewPoint(1400, 1000)
		c2 := layoutgraph.NewNode(4, 200, 100)
		c2.TopLeft = geo.NewPoint(1400, 1220)
		tail := layoutgraph.NewNode(2, 200, 100)
		tail.TopLeft = geo.NewPoint(1000, 1440)
		for _, n := range []*layoutgraph.Node{a, c1, c2, tail} {
			graph.AddNewNodeToContainer(nil, n)
		}
		graph.Connect(a, c1)
		graph.Connect(a, tail)
		vessel := layoutgraph.NewNode(5, 200, 320)
		vessel.TopLeft = geo.NewPoint(1400, 1000)
		cluster := &layoutgraph.Cluster{
			Nodes: []*layoutgraph.Node{c1, c2}, Graph: graph,
			Arrangement: layoutgraph.Column, DesiredArrangement: layoutgraph.Column, Vessel: vessel,
		}
		vessel.SetClusterVessel(true)
		grouping.AddCluster(graph, cluster)
		abductClusterEdgesForOptimizationFixture(cluster)
		graph.CellSize = 100
		guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
		changed, err := transpose(ctx, graph, vessel, nil)
		oracle.TransposeVessel.Changed = changed
		oracle.TransposeVessel.Error = s44Err(err)
		oracle.TransposeVessel.Used = guard.Used()
		oracle.TransposeVessel.Arrangement = string(cluster.Arrangement)
		oracle.TransposeVessel.Boxes = s44Boxes([]*layoutgraph.Node{a, tail, vessel, c1, c2})
	}

	// Cluster optimization fixtures.
	{
		record := func(name string, graph *layoutgraph.Graph, fixtures []optimizeClustersFixture, ctx context.Context, guard *limits.WorkGuard) {
			changed, err := OptimizeClusters(ctx, graph)
			used := int64(0)
			if guard != nil {
				used = guard.Used()
			}
			oracle.Cluster = append(oracle.Cluster, clusterRunRecord(name, graph, fixtures, changed, err, used))
		}
		{
			graph, fixtures := newOptimizeClustersFixtures(1)
			guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
			record("one", graph, fixtures, ctx, guard)
		}
		{
			graph, fixtures := newOptimizeClustersFixtures(2)
			guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
			record("two", graph, fixtures, ctx, guard)
		}
		{
			graph, fixtures := newOptimizeClustersFixtures(1)
			fixtures[0].nodes[0].TopLeft.X += 200
			fixtures[0].nodes[1].TopLeft.X += 200
			graph.CellSize = 0
			guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
			record("vessel-move-gap", graph, fixtures, ctx, guard)
		}
		{
			graph, fixtures := newOptimizeClustersFixtures(1)
			leftBlocker := layoutgraph.NewNode(100, 90, 100)
			leftBlocker.TopLeft = geo.NewPoint(900, 1220)
			rightBlocker := layoutgraph.NewNode(101, 200, 100)
			rightBlocker.TopLeft = geo.NewPoint(1210, 1220)
			graph.AddNewNodeToContainer(nil, leftBlocker)
			graph.AddNewNodeToContainer(nil, rightBlocker)
			// Pinned Go rejects this flip inside Commit's map-ordered
			// existing-overlap loop, so its work count is not deterministic.
			changed, err := OptimizeClusters(context.Background(), graph)
			oracle.Cluster = append(oracle.Cluster, clusterRunRecord("rejected-flip", graph, fixtures, changed, err, -1))
		}
		{
			graph, fixtures := newOptimizeClustersFixtures(1)
			guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
			guard.SetLimit(1)
			record("limit-1", graph, fixtures, ctx, guard)
		}
		{
			// TestFlipClustersGapReduce
			a := layoutgraph.NewNode(1, 200, 100)
			a.TopLeft = geo.NewPoint(1000, 1000)
			c1 := layoutgraph.NewNode(3, 200, 100)
			c1.TopLeft = geo.NewPoint(1000, 1220)
			c2 := layoutgraph.NewNode(4, 200, 100)
			c2.TopLeft = geo.NewPoint(1000, 1440)
			b := layoutgraph.NewNode(2, 200, 100)
			b.TopLeft = geo.NewPoint(1000, 1660)
			graph := layoutgraph.NewGraph()
			for _, node := range []*layoutgraph.Node{a, b, c1, c2} {
				graph.AddNewNodeToContainer(nil, node)
			}
			graph.ComputeCellSize()
			graph.Connect(a, c1)
			graph.Connect(a, c2)
			graph.Connect(c1, b)
			graph.Connect(c2, b)
			vessel := layoutgraph.NewNode(5, 200, 320)
			vessel.TopLeft = geo.NewPoint(1000, 1220)
			cluster := &layoutgraph.Cluster{
				Nodes: []*layoutgraph.Node{c1, c2}, Graph: graph,
				Arrangement: layoutgraph.Column, DesiredArrangement: layoutgraph.Row, Vessel: vessel,
			}
			vessel.SetClusterVessel(true)
			grouping.AddCluster(graph, cluster)
			abductClusterEdgesForOptimizationFixture(cluster)
			fixtures := []optimizeClustersFixture{{graph: graph, cluster: cluster, nodes: []*layoutgraph.Node{a, b, c1, c2, vessel}}}
			guard, ctx := s44Guard(limits.MaxTransactionWorkUnits)
			record("flip-gap-reduce", graph, fixtures, ctx, guard)
		}
		{
			changed, err := OptimizeClusters(canceledContext(), layoutgraph.NewGraph())
			oracle.Cluster = append(oracle.Cluster, s44ClusterRun{Name: "empty-canceled", Changed: changed, Error: s44Err(err)})
		}
		withoutExtra := optimizeClustersWorkWithExtraCacheEntries(t, 0)
		withExtra := optimizeClustersWorkWithExtraCacheEntries(t, 8)
		oracle.ClusterCacheChargeDelta = withExtra - withoutExtra
	}

	// OptimizeClusters (two clusters): W, W-1, and every limit below W restore
	// the whole stage, including earlier clusters' accepted mutations.
	{
		run := func(limit int64) (*layoutgraph.Graph, []optimizeClustersFixture, []s44Box, *limits.WorkGuard, bool, error) {
			graph, fixtures := newOptimizeClustersFixtures(2)
			initial := s44Boxes(clusterFixtureNodes(fixtures))
			guard, ctx := s44Guard(limit)
			changed, err := OptimizeClusters(ctx, graph)
			return graph, fixtures, initial, guard, changed, err
		}
		_, _, _, guard, changed, err := run(limits.MaxTransactionWorkUnits)
		if err != nil || !changed {
			t.Fatalf("two-cluster run: %v %v", changed, err)
		}
		w := guard.Used()
		_, fixtures, initial, guard, changed, err := run(w - 1)
		if err == nil || changed {
			t.Fatal("two-cluster W-1 succeeded")
		}
		oracle.ClusterBoundary = s44Boundary{
			W: w, Error: err.Error(), Used: guard.Used(),
			Restored: boxesEqual(initial, s44Boxes(clusterFixtureNodes(fixtures))),
			Boxes:    s44Boxes(clusterFixtureNodes(fixtures)),
		}
		for limit := int64(1); limit < w; limit++ {
			_, fixtures, initial, guard, changed, err := run(limit)
			if changed {
				t.Fatalf("limit %d changed", limit)
			}
			oracle.ClusterLimitSweep = append(oracle.ClusterLimitSweep, s44LimitPoint{
				Limit: limit, Error: s44Err(err), Used: guard.Used(),
				Restored: boxesEqual(initial, s44Boxes(clusterFixtureNodes(fixtures))) &&
					fixtures[0].cluster.Arrangement == layoutgraph.Column && fixtures[1].cluster.Arrangement == layoutgraph.Column,
			})
		}
	}

	// One cluster whose accepted alignment reaches the gap-reduction refresh:
	// every limit below W restores the whole stage, including CellSize.
	{
		run := func(limit int64) ([]optimizeClustersFixture, []s44Box, *layoutgraph.Graph, *limits.WorkGuard, bool, error) {
			graph, fixtures := newOptimizeClustersFixtures(1)
			fixtures[0].nodes[0].TopLeft.X += 200
			fixtures[0].nodes[1].TopLeft.X += 200
			graph.CellSize = 0
			initial := s44Boxes(clusterFixtureNodes(fixtures))
			guard, ctx := s44Guard(limit)
			changed, err := OptimizeClusters(ctx, graph)
			return fixtures, initial, graph, guard, changed, err
		}
		_, _, _, guard, _, err := run(limits.MaxTransactionWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		w := guard.Used()
		for limit := int64(1); limit < w; limit++ {
			fixtures, initial, graph, guard, changed, err := run(limit)
			if changed {
				t.Fatalf("move sweep limit %d changed", limit)
			}
			oracle.ClusterMoveSweep = append(oracle.ClusterMoveSweep, s44LimitPoint{
				Limit: limit, Error: s44Err(err), Used: guard.Used(),
				Restored: boxesEqual(initial, s44Boxes(clusterFixtureNodes(fixtures))) &&
					fixtures[0].cluster.Arrangement == layoutgraph.Column && graph.CellSize == 0,
			})
		}
	}

	// Gap normalization over seeded random graphs plus pinned scenarios.
	for seed := int64(0); seed < 10; seed++ {
		rng := rand.New(rand.NewSource(200 + seed))
		spacing := float64(300 + 100*rng.Intn(5))
		oracle.Gap = append(oracle.Gap, runGapCase("random", randomFlatSpec(rng, 4+rng.Intn(5), spacing)))
	}
	oracle.Gap = append(oracle.Gap,
		runGapCase("basic", s44GraphSpec{Nodes: []s44NodeSpec{
			{ID: 1, W: 10, H: 10, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 10, H: 10, Placed: true, X: 1000, Y: 0},
		}, Edges: []s44EdgeSpec{{1, 2}}}),
		runGapCase("connected-subgraph", s44GraphSpec{Nodes: []s44NodeSpec{
			{ID: 1, W: 10, H: 100, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 10, H: 10, Placed: true, X: 1000, Y: 0},
			{ID: 3, W: 10, H: 10, Placed: true, X: 2000, Y: 0},
		}, Edges: []s44EdgeSpec{{1, 2}, {1, 3}, {2, 3}}}),
		runGapCase("blocked-candidate", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 1200, Y: 0},
			{ID: 3, W: 40, H: 200, Placed: true, X: 300, Y: -80},
		}, Edges: []s44EdgeSpec{{1, 2}}}),
		runGapCase("nearest-between", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 1500, Y: 0},
			{ID: 3, W: 40, H: 40, Placed: true, X: 900, Y: 30},
			{ID: 4, W: 40, H: 40, Placed: true, X: 2400, Y: 0},
		}, Edges: []s44EdgeSpec{{1, 2}, {2, 3}, {1, 4}}}),
		runGapCase("symmetry", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 900, Y: 0},
			{ID: 3, W: 40, H: 40, Placed: true, X: 1800, Y: 0},
			{ID: 4, W: 40, H: 40, Placed: true, X: 900, Y: 400},
		}, Edges: []s44EdgeSpec{{1, 2}, {3, 2}, {2, 4}}}),
		runGapCase("container-edge", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 600, H: 200, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 40, Y: 60, Container: 1},
			{ID: 3, W: 40, H: 40, Placed: true, X: 2000, Y: 60},
		}, Edges: []s44EdgeSpec{{2, 3}}}),
		runGapCase("container-side", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 700, H: 200, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 40, Y: 60, Container: 1},
			{ID: 3, W: 40, H: 40, Placed: true, X: 600, Y: 60, Container: 1},
			{ID: 4, W: 40, H: 40, Placed: true, X: 2200, Y: 60},
		}, Edges: []s44EdgeSpec{{2, 4}}}),
		runGapCase("fixed-container", s44GraphSpec{CellSize: 10, Nodes: []s44NodeSpec{
			{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 60},
			{ID: 2, W: 300, H: 200, Placed: true, X: 1500, Y: 0, Fixed: true, FX: 1500, FY: 0},
			{ID: 3, W: 40, H: 40, Placed: true, X: 1560, Y: 60, Container: 2},
		}, Edges: []s44EdgeSpec{{1, 3}}}),
		runGapCase("small-gap", s44GraphSpec{CellSize: 400, Nodes: []s44NodeSpec{
			{ID: 1, W: 40, H: 40, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 40, H: 40, Placed: true, X: 220, Y: 0},
		}, Edges: []s44EdgeSpec{{1, 2}}}),
	)
	for seed := int64(0); seed < 6; seed++ {
		rng := rand.New(rand.NewSource(300 + seed))
		oracle.GapQueries = append(oracle.GapQueries, runGapQueries(randomFlatSpec(rng, 4+rng.Intn(4), 120)))
	}
	// Gap normalization W / W-1 and limit sweep on the symmetry scenario.
	{
		var spec s44GraphSpec
		for _, c := range oracle.Gap {
			if c.Name == "symmetry" {
				spec = c.Spec
			}
		}
		run := func(limit int64) (*layoutgraph.Graph, []s44Box, *limits.WorkGuard, bool, error) {
			g, _ := spec.build()
			initial := s44Boxes(g.Nodes)
			guard, ctx := s44Guard(limit)
			txn, err := g.NewRequestTransaction(ctx, layoutgraph.TransactionOptions{AffectContainers: true})
			if err != nil {
				return g, initial, guard, false, err
			}
			changed, err := gapNormalization(ctx, layoutgraph.Nodes(g.Nodes), txn, g, gapNormalizationOptions{
				axis: horizontalAxis, direction: forwardDirection,
			})
			if err != nil {
				return g, initial, guard, changed, err
			}
			return g, initial, guard, changed, nil
		}
		g, _, guard, changed, err := run(limits.MaxTransactionWorkUnits)
		if err != nil || !changed {
			t.Fatalf("gap boundary: %v %v", changed, err)
		}
		_ = g
		w := guard.Used()
		g, initial, guard, _, err := run(w - 1)
		if err == nil {
			t.Fatal("gap W-1 succeeded")
		}
		oracle.GapBoundary = s44Boundary{W: w, Error: err.Error(), Used: guard.Used(),
			Restored: boxesEqual(initial, s44Boxes(g.Nodes)), Boxes: s44Boxes(g.Nodes)}
	}
	// Every limit below W for several scenarios: failures land in each
	// Commit / UpdateState site (primary, backward, accepted, container-side,
	// nested mirrored, and gapNormalization's outer refresh).
	for _, name := range []string{"symmetry", "container-edge", "container-side", "nearest-between", "blocked-candidate", "random"} {
		for _, c := range oracle.Gap {
			if c.Name != name {
				continue
			}
			for mi, mode := range s44GapModes {
				if name != "random" && mi != 0 {
					continue
				}
				if name == "random" && mi != 2 {
					continue
				}
				run := func(limit int64) (*layoutgraph.Graph, *limits.WorkGuard, error) {
					g, _ := c.Spec.build()
					guard, ctx := s44Guard(limit)
					txn, err := g.NewRequestTransaction(ctx, layoutgraph.TransactionOptions{AffectContainers: true})
					if err != nil {
						return g, guard, err
					}
					_, err = gapNormalization(ctx, layoutgraph.Nodes(g.Nodes), txn, g, gapNormalizationOptions{
						axis: mode.axis, direction: mode.direction,
					})
					return g, guard, err
				}
				_, guard, err := run(limits.MaxTransactionWorkUnits)
				if err != nil {
					t.Fatal(err)
				}
				sweep := s44GapSweep{Name: name, Axis: mode.axisName, Direction: mode.dirName, W: guard.Used()}
				for limit := int64(1); limit < sweep.W; limit++ {
					g, guard, err := run(limit)
					sweep.Points = append(sweep.Points, s44GapSweepPoint{
						Limit: limit, Error: s44Err(err), Used: guard.Used(), Geom: s44Geometry(g.Nodes),
					})
				}
				oracle.GapRefreshSweep = append(oracle.GapRefreshSweep, sweep)
			}
			break
		}
	}

	// Optimizer spatial index differential coverage.
	{
		rng := rand.New(rand.NewSource(44))
		small := spatialSpec(rng, 20)
		large := spatialSpec(rng, 120)
		oracle.Spatial = append(oracle.Spatial,
			runSpatialCase("small-legacy", small, "", rand.New(rand.NewSource(1))),
			runSpatialCase("indexed", large, "", rand.New(rand.NewSource(2))),
			runSpatialCase("duplicate-occupancy", large, "duplicate", rand.New(rand.NewSource(3))),
			runSpatialCase("stale-graph", large, "staleGraph", rand.New(rand.NewSource(4))),
			runSpatialCase("stale-count", large, "staleCount", rand.New(rand.NewSource(5))),
			runSpatialCase("nan", large, "nan", rand.New(rand.NewSource(6))),
			runSpatialCase("infinity", large, "inf", rand.New(rand.NewSource(7))),
			runSpatialCase("negative", large, "negative", rand.New(rand.NewSource(8))),
		)
	}

	writeOrAssertSlice44PlacementFixture(t, "go-slice44-reference.json", oracle)
}

func writeOrAssertSlice44PlacementFixture(t *testing.T, name string, oracle any) {
	t.Helper()
	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", name)
	if os.Getenv("TALA_SLICE44_ORACLE") == "1" {
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
		t.Fatalf("%s is stale; regenerate with TALA_SLICE44_ORACLE=1", name)
	}
}
