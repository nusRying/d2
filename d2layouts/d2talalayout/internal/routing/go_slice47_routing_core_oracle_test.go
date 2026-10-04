package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 47 Core Routing Oracle (RouteEdges & RouteGraph).
// When TALA_SLICE47_ORACLE=1, generates js/test/fixtures/go-slice47-routing-core-reference.json.
// Otherwise, recomputes all values and asserts byte-for-byte equality with committed fixture.

type s47rcF float64

func (f s47rcF) MarshalJSON() ([]byte, error) {
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

type s47rcPt struct {
	X s47rcF `json:"x"`
	Y s47rcF `json:"y"`
}

func s47rcPoint(p *geo.Point) s47rcPt {
	if p == nil {
		return s47rcPt{X: s47rcF(0), Y: s47rcF(0)}
	}
	return s47rcPt{X: s47rcF(p.X), Y: s47rcF(p.Y)}
}

type s47rcNodeSpec struct {
	ID        uint64  `json:"id"`
	X         s47rcF  `json:"x"`
	Y         s47rcF  `json:"y"`
	W         s47rcF  `json:"w"`
	H         s47rcF  `json:"h"`
	Shape     string  `json:"shape,omitempty"`
	Columns   int     `json:"columns,omitempty"`
	Container uint64  `json:"container,omitempty"`
	IsTunnel  bool    `json:"is_tunnel,omitempty"`
	Near      *uint64 `json:"near,omitempty"`
}

type s47rcEdgeSpec struct {
	ID       int      `json:"id"`
	From     uint64   `json:"from"`
	To       uint64   `json:"to"`
	Directed bool     `json:"directed"`
	SrcArrow string   `json:"src_arrow,omitempty"`
	TgtArrow string   `json:"tgt_arrow,omitempty"`
	SrcLabel string   `json:"src_label,omitempty"`
	TgtLabel string   `json:"tgt_label,omitempty"`
	Label    string   `json:"label,omitempty"`
	Points   []s47rcPt `json:"points,omitempty"`
}

type s47rcClusterSpec struct {
	Vessel s47rcNodeSpec `json:"vessel"`
	Nodes  []uint64      `json:"nodes"`
}

type s47rcSequenceSpec struct {
	Vessel s47rcNodeSpec `json:"vessel"`
	Nodes  []uint64      `json:"nodes"`
}

type s47rcRouteEdgesResult struct {
	Name    string                 `json:"name"`
	Success bool                   `json:"success"`
	Err     string                 `json:"err,omitempty"`
	Edges   map[int][]s47rcPt      `json:"edges,omitempty"`
}

type s47rcRouteGraphResult struct {
	Name             string                 `json:"name"`
	Success          bool                   `json:"success"`
	RoutingCompleted bool                   `json:"routing_completed"`
	SubgraphsRouted  int                    `json:"subgraphs_routed"`
	Err              string                 `json:"err,omitempty"`
	Edges            map[int][]s47rcPt      `json:"edges,omitempty"`
	NodeOwners       map[uint64]string      `json:"node_owners,omitempty"`
}

type s47rcWorkBudgetResult struct {
	Scenario   string `json:"scenario"`
	Target     string `json:"target"` // RouteEdges or RouteGraph
	MinWork    uint64 `json:"min_work"`
	PassWork   uint64 `json:"pass_work"`
	FailWork   uint64 `json:"fail_work"`
	FailErr    string `json:"fail_err"`
	RestoredOK bool   `json:"restored_ok"`
}

type s47rcReferenceFixture struct {
	Version     string                  `json:"version"`
	RouteEdges  []s47rcRouteEdgesResult `json:"route_edges"`
	RouteGraph  []s47rcRouteGraphResult `json:"route_graph"`
	WorkBudgets []s47rcWorkBudgetResult `json:"work_budgets"`
}

func buildGraphFromSpec(nodes []s47rcNodeSpec, edges []s47rcEdgeSpec, clusters []s47rcClusterSpec, sequences []s47rcSequenceSpec) *layoutgraph.Graph {
	g := layoutgraph.NewGraph()
	nodeMap := make(map[uint64]*layoutgraph.Node)

	for _, ns := range nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
		n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		if ns.Columns > 0 {
			n.SetNumColumns(ns.Columns)
		}
		g.AddNode(n)
		nodeMap[ns.ID] = n
	}

	for _, ns := range nodes {
		if ns.Container != 0 {
			if parent, ok := nodeMap[ns.Container]; ok {
				nodeMap[ns.ID].Container = parent
				g.AddNodeToContainer(parent, nodeMap[ns.ID])
			}
		}
		if ns.Near != nil {
			target := nodeMap[*ns.Near]
			if nodeMap[ns.ID].Nears == nil {
				nodeMap[ns.ID].Nears = make(map[*layoutgraph.Node]struct{})
			}
			nodeMap[ns.ID].Nears[target] = struct{}{}
		}
	}

	for _, cl := range clusters {
		vessel := layoutgraph.NewNode(layoutgraph.EntityID(cl.Vessel.ID), float64(cl.Vessel.W), float64(cl.Vessel.H))
		vessel.TopLeft = geo.NewPoint(float64(cl.Vessel.X), float64(cl.Vessel.Y))
		g.AddNode(vessel)

		clusterNodes := make([]*layoutgraph.Node, len(cl.Nodes))
		for i, nid := range cl.Nodes {
			clusterNodes[i] = nodeMap[nid]
		}
		g.Clusters[vessel] = &layoutgraph.Cluster{
			Vessel: vessel,
			Nodes:  clusterNodes,
		}
	}

	for _, sq := range sequences {
		vessel := layoutgraph.NewNode(layoutgraph.EntityID(sq.Vessel.ID), float64(sq.Vessel.W), float64(sq.Vessel.H))
		vessel.TopLeft = geo.NewPoint(float64(sq.Vessel.X), float64(sq.Vessel.Y))
		g.AddNode(vessel)

		seqNodes := make([]*layoutgraph.Node, len(sq.Nodes))
		for i, nid := range sq.Nodes {
			seqNodes[i] = nodeMap[nid]
		}
		g.Sequences[vessel] = &layoutgraph.Sequence{
			Nodes: seqNodes,
		}
	}

	for _, es := range edges {
		from := nodeMap[es.From]
		to := nodeMap[es.To]
		e := g.Connect(from, to)
		if es.Directed {
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.SrcArrow != "" {
			e.SourceArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.TgtArrow != "" {
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.Label != "" {
			e.Label = &layoutgraph.Label{Text: es.Label, Width: 40, Height: 20}
		}
		if es.SrcLabel != "" {
			e.SourceArrowheadLabel = &layoutgraph.Label{Text: es.SrcLabel, Width: 20, Height: 10}
		}
		if es.TgtLabel != "" {
			e.TargetArrowheadLabel = &layoutgraph.Label{Text: es.TgtLabel, Width: 20, Height: 10}
		}
		if len(es.Points) > 0 {
			pts := make([]*geo.Point, len(es.Points))
			for i, p := range es.Points {
				pts[i] = geo.NewPoint(float64(p.X), float64(p.Y))
			}
			e.Points = pts
		}
	}

	return g
}

type countingObserver struct {
	count int
	err   error
}

func (o *countingObserver) SubgraphRouted(ovg *OVG) error {
	o.count++
	return o.err
}

type testCompletionObserver struct {
	completed bool
}

func (o *testCompletionObserver) RoutingCompleted() {
	o.completed = true
}

func TestSlice47RoutingCoreReferenceOracle(t *testing.T) {
	routeEdgesCases := []struct {
		Name      string
		Nodes     []s47rcNodeSpec
		Edges     []s47rcEdgeSpec
		Clusters  []s47rcClusterSpec
		Sequences []s47rcSequenceSpec
	}{
		{
			Name: "empty",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
			},
			Edges: nil,
		},
		{
			Name: "straight-edge",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 100, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
			},
		},
		{
			Name: "chain",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 100, W: 60, H: 40},
				{ID: 3, X: 500, Y: 100, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
				{ID: 1, From: 2, To: 3, Directed: true},
			},
		},
		{
			Name: "cycle",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 100, W: 60, H: 40},
				{ID: 3, X: 300, Y: 300, W: 60, H: 40},
				{ID: 4, X: 100, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
				{ID: 1, From: 2, To: 3, Directed: true},
				{ID: 2, From: 3, To: 4, Directed: true},
				{ID: 3, From: 4, To: 1, Directed: true},
			},
		},
		{
			Name: "l-route",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
			},
		},
		{
			Name: "s-route",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 200, Y: 200, W: 60, H: 40},
				{ID: 3, X: 300, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 3, Directed: true},
			},
		},
		{
			Name: "obstacle-detour",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 100, Y: 200, W: 120, H: 60}, // obstacle
				{ID: 3, X: 100, Y: 350, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 3, Directed: true},
			},
		},
		{
			Name: "parallel-edges",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 80, H: 60},
				{ID: 2, X: 100, Y: 300, W: 80, H: 60},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
				{ID: 1, From: 1, To: 2, Directed: true},
			},
		},
		{
			Name: "nested-containers",
			Nodes: []s47rcNodeSpec{
				{ID: 10, X: 50, Y: 50, W: 400, H: 400},
				{ID: 1, X: 100, Y: 100, W: 60, H: 40, Container: 10},
				{ID: 2, X: 300, Y: 300, W: 60, H: 40, Container: 10},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
			},
		},
		{
			Name: "cluster-ports",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 100, Y: 200, W: 60, H: 40},
				{ID: 3, X: 400, Y: 150, W: 60, H: 40},
			},
			Clusters: []s47rcClusterSpec{
				{
					Vessel: s47rcNodeSpec{ID: 100, X: 80, Y: 80, W: 100, H: 180},
					Nodes:  []uint64{1, 2},
				},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 3, Directed: true},
				{ID: 1, From: 2, To: 3, Directed: true},
			},
		},
	}

	routeEdgesResults := make([]s47rcRouteEdgesResult, 0, len(routeEdgesCases))
	for _, tc := range routeEdgesCases {
		g := buildGraphFromSpec(tc.Nodes, tc.Edges, tc.Clusters, tc.Sequences)
		ctx := context.Background()
		err := RouteEdges(ctx, g, g.Edges)

		res := s47rcRouteEdgesResult{
			Name:    tc.Name,
			Success: err == nil,
			Edges:   make(map[int][]s47rcPt),
		}
		if err != nil {
			res.Err = err.Error()
		} else {
			for i, e := range g.Edges {
				pts := make([]s47rcPt, len(e.Points))
				for pi, p := range e.Points {
					pts[pi] = s47rcPoint(p)
				}
				res.Edges[i] = pts
			}
		}
		routeEdgesResults = append(routeEdgesResults, res)
	}

	routeGraphCases := []struct {
		Name                      string
		ForceReroute              bool
		RoutesPreviouslyCompleted bool
		ObserverError             bool
		Nodes                     []s47rcNodeSpec
		Edges                     []s47rcEdgeSpec
		Clusters                  []s47rcClusterSpec
		Sequences                 []s47rcSequenceSpec
	}{
		{
			Name: "zero-edge",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 200, Y: 200, W: 60, H: 40},
			},
			Edges: nil,
		},
		{
			Name: "single-subgraph",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
			},
		},
		{
			Name: "multi-subgraph",
			Nodes: []s47rcNodeSpec{
				// Subgraph 1
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 250, Y: 100, W: 60, H: 40},
				// Subgraph 2
				{ID: 3, X: 100, Y: 300, W: 60, H: 40},
				{ID: 4, X: 250, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
				{ID: 1, From: 3, To: 4, Directed: true},
			},
		},
		{
			Name: "near-linked-graph",
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 250, Y: 100, W: 60, H: 40},
				{ID: 3, X: 450, Y: 100, W: 60, H: 40, Near: func() *uint64 { v := uint64(2); return &v }()},
				{ID: 4, X: 600, Y: 100, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
				{ID: 1, From: 3, To: 4, Directed: true},
			},
		},
		{
			Name: "existing-complete-routes",
			RoutesPreviouslyCompleted: true,
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 100, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{
					ID:       0,
					From:     1,
					To:       2,
					Directed: true,
					Points: []s47rcPt{
						{X: 160, Y: 120},
						{X: 300, Y: 120},
					},
				},
			},
		},
		{
			Name:         "force-reroute-existing",
			ForceReroute: true,
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 100, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{
					ID:       0,
					From:     1,
					To:       2,
					Directed: true,
					Points: []s47rcPt{
						{X: 160, Y: 120},
						{X: 300, Y: 120},
					},
				},
			},
		},
		{
			Name:                      "partial-routes-rejected",
			RoutesPreviouslyCompleted: true,
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 100, W: 60, H: 40},
				{ID: 3, X: 500, Y: 100, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{
					ID:       0,
					From:     1,
					To:       2,
					Directed: true,
					Points: []s47rcPt{
						{X: 160, Y: 120},
						{X: 300, Y: 120},
					},
				},
				{
					ID:       1,
					From:     2,
					To:       3,
					Directed: true,
				},
			},
		},
		{
			Name:          "subgraph-observer-error",
			ObserverError: true,
			Nodes: []s47rcNodeSpec{
				{ID: 1, X: 100, Y: 100, W: 60, H: 40},
				{ID: 2, X: 300, Y: 300, W: 60, H: 40},
			},
			Edges: []s47rcEdgeSpec{
				{ID: 0, From: 1, To: 2, Directed: true},
			},
		},
	}

	routeGraphResults := make([]s47rcRouteGraphResult, 0, len(routeGraphCases))
	for _, tc := range routeGraphCases {
		g := buildGraphFromSpec(tc.Nodes, tc.Edges, tc.Clusters, tc.Sequences)
		ctx := context.Background()

		obs := &countingObserver{}
		if tc.ObserverError {
			obs.err = fmt.Errorf("simulated subgraph observer failure")
		}
		compObs := &testCompletionObserver{}

		completed, err := RouteGraph(ctx, g, GraphRouteOptions{
			ForceReroute:              tc.ForceReroute,
			RoutesPreviouslyCompleted: tc.RoutesPreviouslyCompleted,
			Observer:                  obs,
			CompletionObserver:        compObs,
		})

		res := s47rcRouteGraphResult{
			Name:             tc.Name,
			Success:          err == nil,
			RoutingCompleted: completed,
			SubgraphsRouted:  obs.count,
			Edges:            make(map[int][]s47rcPt),
			NodeOwners:       make(map[uint64]string),
		}
		if err != nil {
			res.Err = err.Error()
		} else {
			for i, e := range g.Edges {
				pts := make([]s47rcPt, len(e.Points))
				for pi, p := range e.Points {
					pts[pi] = s47rcPoint(p)
				}
				res.Edges[i] = pts
			}
		}
		for _, n := range g.Nodes {
			if n.Graph == g {
				res.NodeOwners[uint64(n.IDValue())] = "parent-graph"
			} else {
				res.NodeOwners[uint64(n.IDValue())] = "subgraph"
			}
		}
		routeGraphResults = append(routeGraphResults, res)
	}

	// W / W-1 Determinations
	workBudgets := []s47rcWorkBudgetResult{}

	// 1. RouteEdges W / W-1
	{
		specNodes := []s47rcNodeSpec{
			{ID: 1, X: 100, Y: 100, W: 60, H: 40},
			{ID: 2, X: 300, Y: 300, W: 60, H: 40},
		}
		specEdges := []s47rcEdgeSpec{
			{ID: 0, From: 1, To: 2, Directed: true},
		}

		// Find deterministic minimum W via binary search
		low, high := uint64(1), uint64(50000)
		for low < high {
			mid := low + (high-low)/2
			g := buildGraphFromSpec(specNodes, specEdges, nil, nil)
			err := routeEdgesWithBudgets(context.Background(), g, g.Edges, defaultOVGBuildLimits(), mid)
			if err == nil {
				high = mid
			} else {
				low = mid + 1
			}
		}
		w := low

		gPass := buildGraphFromSpec(specNodes, specEdges, nil, nil)
		errPass := routeEdgesWithBudgets(context.Background(), gPass, gPass.Edges, defaultOVGBuildLimits(), w)

		gFail := buildGraphFromSpec(specNodes, specEdges, nil, nil)
		origPoints := gFail.Edges[0].Points
		errFail := routeEdgesWithBudgets(context.Background(), gFail, gFail.Edges, defaultOVGBuildLimits(), w-1)

		restored := gFail.Edges[0].Points == nil || len(gFail.Edges[0].Points) == len(origPoints)

		failErrStr := ""
		if errFail != nil {
			failErrStr = errFail.Error()
		}

		workBudgets = append(workBudgets, s47rcWorkBudgetResult{
			Scenario:   "route-edges-diagonal",
			Target:     "RouteEdges",
			MinWork:    w,
			PassWork:   w,
			FailWork:   w - 1,
			FailErr:    failErrStr,
			RestoredOK: errPass == nil && errFail != nil && restored,
		})
	}

	// 2. RouteGraph W / W-1
	{
		specNodes := []s47rcNodeSpec{
			{ID: 1, X: 100, Y: 100, W: 60, H: 40},
			{ID: 2, X: 250, Y: 100, W: 60, H: 40},
			{ID: 3, X: 100, Y: 300, W: 60, H: 40},
			{ID: 4, X: 250, Y: 300, W: 60, H: 40},
		}
		specEdges := []s47rcEdgeSpec{
			{ID: 0, From: 1, To: 2, Directed: true},
			{ID: 1, From: 3, To: 4, Directed: true},
		}

		buildTestGraph := func() *layoutgraph.Graph {
			g := buildGraphFromSpec(specNodes, specEdges, nil, nil)
			h1 := newHierarchyWithLevels(map[*layoutgraph.Node]int{g.Nodes[0]: 0, g.Nodes[1]: 1})
			g.Nodes[0].Hierarchy = h1
			g.Nodes[1].Hierarchy = h1
			h2 := newHierarchyWithLevels(map[*layoutgraph.Node]int{g.Nodes[2]: 0, g.Nodes[3]: 1})
			g.Nodes[2].Hierarchy = h2
			g.Nodes[3].Hierarchy = h2
			return g
		}

		low, high := uint64(1), uint64(100000)
		for low < high {
			mid := low + (high-low)/2
			g := buildTestGraph()
			_, err := RouteGraphWithWorkLimit(context.Background(), g, GraphRouteOptions{}, mid)
			if err == nil {
				high = mid
			} else {
				low = mid + 1
			}
		}
		w := low

		gPass := buildTestGraph()
		compPass, errPass := RouteGraphWithWorkLimit(context.Background(), gPass, GraphRouteOptions{}, w)

		gFail := buildTestGraph()
		compFail, errFail := RouteGraphWithWorkLimit(context.Background(), gFail, GraphRouteOptions{}, w-1)

		allOwnersRestored := true
		for _, n := range gFail.Nodes {
			if n.Graph != gFail {
				allOwnersRestored = false
			}
		}

		failErrStr := ""
		if errFail != nil {
			failErrStr = errFail.Error()
		}

		workBudgets = append(workBudgets, s47rcWorkBudgetResult{
			Scenario:   "route-graph-multi-subgraph",
			Target:     "RouteGraph",
			MinWork:    w,
			PassWork:   w,
			FailWork:   w - 1,
			FailErr:    failErrStr,
			RestoredOK: errPass == nil && compPass && errFail != nil && !compFail && allOwnersRestored,
		})
	}

	fixture := s47rcReferenceFixture{
		Version:     "slice-47-routing-core-v1",
		RouteEdges:  routeEdgesResults,
		RouteGraph:  routeGraphResults,
		WorkBudgets: workBudgets,
	}

	fixtureJSON, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent failed: %v", err)
	}

	fixturePath := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice47-routing-core-reference.json")
	if os.Getenv("TALA_SLICE47_ORACLE") == "1" {
		if err := os.WriteFile(fixturePath, append(fixtureJSON, '\n'), 0644); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		t.Logf("Generated %s successfully", fixturePath)
		return
	}

	committed, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("ReadFile %s failed: %v (run with TALA_SLICE47_ORACLE=1 to generate)", fixturePath, err)
	}

	committedNorm := bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	encodedNorm := bytes.ReplaceAll(fixtureJSON, []byte("\r\n"), []byte("\n"))

	if !bytes.Equal(bytes.TrimSpace(committedNorm), bytes.TrimSpace(encodedNorm)) {
		c := bytes.TrimSpace(committedNorm)
		e := bytes.TrimSpace(encodedNorm)
		for i := 0; i < len(c) && i < len(e); i++ {
			if c[i] != e[i] {
				t.Logf("Mismatch at byte %d:\ncommitted: %s\nencoded:   %s", i, string(c[max(0, i-50):min(len(c), i+50)]), string(e[max(0, i-50):min(len(e), i+50)]))
				break
			}
		}
		t.Fatalf("Routing core fixture mismatch with Go reference output (committed len %d, encoded len %d); re-run with TALA_SLICE47_ORACLE=1 if intended", len(c), len(e))
	}
}
