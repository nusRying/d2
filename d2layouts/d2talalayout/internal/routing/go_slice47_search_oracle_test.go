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
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 47 Search & Edge Router Oracle.
// When TALA_SLICE47_ORACLE=1, generates js/test/fixtures/go-slice47-search-reference.json.
// Otherwise, recomputes all values and asserts byte-for-byte equality with committed fixture.

type s47sF float64

func (f s47sF) MarshalJSON() ([]byte, error) {
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

type s47sPt struct {
	X s47sF `json:"x"`
	Y s47sF `json:"y"`
}

func s47sPoint(p *geo.Point) s47sPt {
	if p == nil {
		return s47sPt{X: s47sF(0), Y: s47sF(0)}
	}
	return s47sPt{X: s47sF(p.X), Y: s47sF(p.Y)}
}

type s47sNodeSpec struct {
	ID        uint64 `json:"id"`
	X         s47sF  `json:"x"`
	Y         s47sF  `json:"y"`
	W         s47sF  `json:"w"`
	H         s47sF  `json:"h"`
	Shape     string `json:"shape,omitempty"`
	Columns   int    `json:"columns,omitempty"`
	Container uint64 `json:"container,omitempty"`
	IsTunnel  bool   `json:"is_tunnel,omitempty"`
}

type s47sEdgeSpec struct {
	From     uint64 `json:"from"`
	To       uint64 `json:"to"`
	FromCol  *int   `json:"from_col,omitempty"`
	ToCol    *int   `json:"to_col,omitempty"`
	Directed bool   `json:"directed"`
	SrcArrow string `json:"src_arrow,omitempty"`
	TgtArrow string `json:"tgt_arrow,omitempty"`
	SrcLabel string `json:"src_label,omitempty"`
	TgtLabel string `json:"tgt_label,omitempty"`
	Label    string `json:"label,omitempty"`
}

type s47sClusterSpec struct {
	Vessel      s47sNodeSpec `json:"vessel"`
	Nodes       []uint64     `json:"nodes"`
	Arrangement string       `json:"arrangement"`
}

type s47sCaseSpec struct {
	Name                 string            `json:"name"`
	Flavor               string            `json:"flavor"`
	StraightLineFallback bool              `json:"straight_line_fallback"`
	Nodes                []s47sNodeSpec    `json:"nodes"`
	Edges                []s47sEdgeSpec    `json:"edges"`
	Clusters             []s47sClusterSpec `json:"clusters,omitempty"`
}

type s47sRouteResult struct {
	EdgeIndex int      `json:"edge_index"`
	Points    []s47sPt `json:"points"`
	FromPort  s47sPt   `json:"from_port"`
	ToPort    s47sPt   `json:"to_port"`
}

type s47sCaseResult struct {
	Name          string            `json:"name"`
	TotalDistance s47sF             `json:"total_distance"`
	Routes        []s47sRouteResult `json:"routes"`
	WorkUnits     uint64            `json:"work_units"`
	Success       bool              `json:"success"`
	Error         string            `json:"error,omitempty"`
}

type s47sPQItem struct {
	Priority s47sF `json:"priority"`
	IsHoriz  bool  `json:"is_horiz"`
	NodeID   int   `json:"node_id"`
}

type s47sPQCase struct {
	Name string       `json:"name"`
	Pops []s47sPQItem `json:"pops"`
}

type s47sReferenceData struct {
	Version   string           `json:"version"`
	Cases     []s47sCaseSpec   `json:"cases"`
	Results   []s47sCaseResult `json:"results"`
	PQResults []s47sPQCase     `json:"pq_results"`
}

func s47sCreateNode(ns s47sNodeSpec) *layoutgraph.Node {
	n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
	n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
	if ns.Shape != "" {
		n.SetShape(ns.Shape)
	}
	if ns.Columns > 0 {
		n.SetNumColumns(ns.Columns)
	}
	return n
}

func buildSearchCaseGraph(spec s47sCaseSpec) (*layoutgraph.Graph, []*layoutgraph.Edge, map[uint64]*layoutgraph.Node) {
	g := layoutgraph.NewGraph()
	nodeMap := make(map[uint64]*layoutgraph.Node)

	for _, ns := range spec.Nodes {
		n := s47sCreateNode(ns)
		g.AddNode(n)
		nodeMap[ns.ID] = n
	}

	for _, ns := range spec.Nodes {
		if ns.Container != 0 {
			if parent, ok := nodeMap[ns.Container]; ok {
				nodeMap[ns.ID].Container = parent
			}
		}
	}

	for _, cs := range spec.Clusters {
		vessel := s47sCreateNode(cs.Vessel)
		c := &layoutgraph.Cluster{
			Vessel: vessel,
		}
		for _, nid := range cs.Nodes {
			if n, ok := nodeMap[nid]; ok {
				c.Nodes = append(c.Nodes, n)
				n.Cluster = c
			}
		}
		if cs.Arrangement == "Column" {
			c.Arrangement = layoutgraph.Column
			c.DesiredArrangement = layoutgraph.Column
		} else {
			c.Arrangement = layoutgraph.Row
			c.DesiredArrangement = layoutgraph.Row
		}
		g.Clusters[vessel] = c
	}

	edges := make([]*layoutgraph.Edge, 0, len(spec.Edges))
	for _, es := range spec.Edges {
		fromNode := nodeMap[es.From]
		toNode := nodeMap[es.To]
		e := g.Connect(fromNode, toNode)
		if es.FromCol != nil {
			val := *es.FromCol
			e.FromTableColumnIndex = &val
		}
		if es.ToCol != nil {
			val := *es.ToCol
			e.ToTableColumnIndex = &val
		}
		if es.SrcArrow != "" {
			e.SourceArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.TgtArrow != "" {
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.SrcLabel != "" {
			e.SourceArrowheadLabel = &layoutgraph.Label{Text: es.SrcLabel}
		}
		if es.TgtLabel != "" {
			e.TargetArrowheadLabel = &layoutgraph.Label{Text: es.TgtLabel}
		}
		if es.Label != "" {
			e.Label = &layoutgraph.Label{Text: es.Label}
		}
		edges = append(edges, e)
	}

	return g, edges, nodeMap
}

func runSearchCase(spec s47sCaseSpec) s47sCaseResult {
	g, edges, _ := buildSearchCaseGraph(spec)
	ctx := context.Background()

	ovg, err := buildOVGFromGraph(ctx, g, nil)
	if err != nil {
		return s47sCaseResult{
			Name:    spec.Name,
			Success: false,
			Error:   err.Error(),
		}
	}

	flavor := Default
	switch spec.Flavor {
	case "ShortestToLongest":
		flavor = ShortestToLongest
	case "LongestToShortest":
		flavor = LongestToShortest
	case "TopDownLeftRight":
		flavor = TopDownLeftRight
	}

	router, err := newOVGEdgeRouterWithWorkLimit(ctx, flavor, ovg, g, nil, edges, maxRouteSearchWorkUnits)
	if err != nil {
		return s47sCaseResult{
			Name:    spec.Name,
			Success: false,
			Error:   err.Error(),
		}
	}

	resp := router.generateRoutes(ctx, spec.StraightLineFallback)
	if resp.Err != nil {
		return s47sCaseResult{
			Name:    spec.Name,
			Success: false,
			Error:   resp.Err.Error(),
		}
	}

	routes := make([]s47sRouteResult, 0, len(resp.Routes))
	for i, r := range resp.Routes {
		pts := make([]s47sPt, 0, len(r.OVGNodes))
		for _, n := range r.OVGNodes {
			pts = append(pts, s47sPoint(n.Point))
		}
		routes = append(routes, s47sRouteResult{
			EdgeIndex: i,
			Points:    pts,
			FromPort:  s47sPoint(&r.FromPort),
			ToPort:    s47sPoint(&r.ToPort),
		})
	}

	var workUnits uint64
	if router.work != nil {
		workUnits = router.work.used
	}

	return s47sCaseResult{
		Name:          spec.Name,
		TotalDistance: s47sF(resp.Distance),
		Routes:        routes,
		WorkUnits:     workUnits,
		Success:       true,
	}
}

func getSearchCaseSpecs() []s47sCaseSpec {
	intPtr := func(i int) *int { return &i }

	return []s47sCaseSpec{
		{
			Name:   "straight-route",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 40, H: 40},
				{ID: 2, X: 100, Y: 0, W: 40, H: 40},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "single-l-route",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 40, H: 40},
				{ID: 2, X: 100, Y: 100, W: 40, H: 40},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "multiple-l-candidates",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 10, Y: 10, W: 30, H: 30},
				{ID: 2, X: 120, Y: 120, W: 30, H: 30},
				{ID: 3, X: 60, Y: 10, W: 20, H: 20}, // partial obstacle on top path
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "s-route",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 40, H: 40},
				{ID: 2, X: 120, Y: 120, W: 40, H: 40},
				{ID: 3, X: 90, Y: 0, W: 20, H: 40}, // blocks direct L top
				{ID: 4, X: 0, Y: 90, W: 40, H: 20}, // blocks direct L bottom
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "blocked-straight-route",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 50, W: 40, H: 40},
				{ID: 2, X: 160, Y: 50, W: 40, H: 40},
				{ID: 3, X: 80, Y: 40, W: 40, H: 60}, // obstacle between
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "blocked-l-route",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 40, H: 40},
				{ID: 2, X: 140, Y: 140, W: 40, H: 40},
				{ID: 3, X: 0, Y: 60, W: 100, H: 30},
				{ID: 4, X: 60, Y: 0, W: 30, H: 100},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "ovg-detour",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 20, Y: 20, W: 40, H: 40},
				{ID: 2, X: 200, Y: 20, W: 40, H: 40},
				{ID: 3, X: 90, Y: 0, W: 40, H: 100}, // tall obstacle
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "nested-container",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 10, X: 0, Y: 0, W: 200, H: 200}, // container
				{ID: 1, X: 20, Y: 20, W: 40, H: 40, Container: 10},
				{ID: 2, X: 120, Y: 120, W: 40, H: 40, Container: 10},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "tunnel",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 20, Y: 20, W: 40, H: 40},
				{ID: 2, X: 200, Y: 20, W: 40, H: 40},
				{ID: 10, X: 90, Y: 0, W: 40, H: 120}, // obstacle
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "table-port",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 80, H: 100, Shape: "table", Columns: 3},
				{ID: 2, X: 180, Y: 0, W: 80, H: 100, Shape: "table", Columns: 3},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, FromCol: intPtr(0), ToCol: intPtr(2), TgtArrow: "triangle"},
			},
		},
		{
			Name:   "parallel-edges",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 40, H: 60},
				{ID: 2, X: 150, Y: 0, W: 40, H: 60},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "equal-cost-route-tie",
			Flavor: "TopDownLeftRight",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 50, Y: 50, W: 40, H: 40},
				{ID: 2, X: 150, Y: 150, W: 40, H: 40},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "quickroute-success",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 30, H: 30},
				{ID: 2, X: 50, Y: 0, W: 30, H: 30}, // Distance is 20, < 2*(20+1)
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "quickroute-rejection-to-search",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 30, H: 30},
				{ID: 2, X: 50, Y: 50, W: 30, H: 30}, // diagonal -> quickRoute rejects -> slingshot/search
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 2, TgtArrow: "triangle"},
			},
		},
		{
			Name:   "cluster-shared-routes",
			Flavor: "ShortestToLongest",
			Nodes: []s47sNodeSpec{
				{ID: 1, X: 0, Y: 0, W: 30, H: 30},
				{ID: 2, X: 0, Y: 60, W: 30, H: 30},
				{ID: 3, X: 150, Y: 30, W: 30, H: 30},
			},
			Clusters: []s47sClusterSpec{
				{
					Vessel:      s47sNodeSpec{ID: 10, X: 0, Y: 0, W: 30, H: 90},
					Nodes:       []uint64{1, 2},
					Arrangement: "Column",
				},
			},
			Edges: []s47sEdgeSpec{
				{From: 1, To: 3, TgtArrow: "triangle"},
				{From: 2, To: 3, TgtArrow: "triangle"},
			},
		},
	}
}

func runPQOracleCases() []s47sPQCase {
	var cases []s47sPQCase

	// Case 1: Equal priorities preserve insertion order
	{
		pq := priorityQueue{}
		nodes := []*OVGNode{
			NewOVGNode(geo.NewPoint(0, 0)),
			NewOVGNode(geo.NewPoint(1, 1)),
			NewOVGNode(geo.NewPoint(2, 2)),
			NewOVGNode(geo.NewPoint(3, 3)),
		}
		for i, n := range nodes {
			n.Index = i
		}

		pq.push(10.0, nodes[0], true, nil)
		pq.push(10.0, nodes[1], false, nil)
		pq.push(10.0, nodes[2], true, nil)
		pq.push(10.0, nodes[3], false, nil)

		var pops []s47sPQItem
		for !pq.empty() {
			entry, _ := pq.pop(nil)
			pops = append(pops, s47sPQItem{
				Priority: s47sF(entry.priority),
				IsHoriz:  entry.isHorizontal,
				NodeID:   entry.node.Index,
			})
		}
		cases = append(cases, s47sPQCase{
			Name: "equal-priorities-order",
			Pops: pops,
		})
	}

	// Case 2: Decrease key
	{
		pq := priorityQueue{}
		nodes := make([]*OVGNode, 5)
		for i := range nodes {
			nodes[i] = NewOVGNode(geo.NewPoint(float64(i), float64(i)))
			nodes[i].Index = i
		}

		e0, _ := pq.push(50.0, nodes[0], true, nil)
		e1, _ := pq.push(40.0, nodes[1], false, nil)
		e2, _ := pq.push(30.0, nodes[2], true, nil)
		e3, _ := pq.push(20.0, nodes[3], false, nil)
		e4, _ := pq.push(10.0, nodes[4], true, nil)

		_ = pq.decrease(e0, 5.0, nil)
		_ = pq.decrease(e1, 15.0, nil)
		_ = pq.decrease(e2, 2.0, nil)
		_ = e3
		_ = e4

		var pops []s47sPQItem
		for !pq.empty() {
			entry, _ := pq.pop(nil)
			pops = append(pops, s47sPQItem{
				Priority: s47sF(entry.priority),
				IsHoriz:  entry.isHorizontal,
				NodeID:   entry.node.Index,
			})
		}
		cases = append(cases, s47sPQCase{
			Name: "decrease-key-order",
			Pops: pops,
		})
	}

	// Case 3: Large queue with mixed operations
	{
		pq := priorityQueue{}
		nodes := make([]*OVGNode, 100)
		for i := range nodes {
			nodes[i] = NewOVGNode(geo.NewPoint(float64(i), float64(i)))
			nodes[i].Index = i
		}

		entries := make([]*priorityQueueEntry, 100)
		for i := 0; i < 100; i++ {
			p := float64((i*37)%100) + 1.0
			entries[i], _ = pq.push(p, nodes[i], i%2 == 0, nil)
		}

		for i := 10; i < 90; i += 5 {
			_ = pq.decrease(entries[i], float64(i)/10.0, nil)
		}

		var pops []s47sPQItem
		for !pq.empty() {
			entry, _ := pq.pop(nil)
			pops = append(pops, s47sPQItem{
				Priority: s47sF(entry.priority),
				IsHoriz:  entry.isHorizontal,
				NodeID:   entry.node.Index,
			})
		}
		cases = append(cases, s47sPQCase{
			Name: "large-queue-mixed",
			Pops: pops,
		})
	}

	return cases
}

func TestSlice47SearchOracle(t *testing.T) {
	specs := getSearchCaseSpecs()
	results := make([]s47sCaseResult, 0, len(specs))

	for _, spec := range specs {
		res := runSearchCase(spec)
		results = append(results, res)
	}

	pqResults := runPQOracleCases()

	refData := s47sReferenceData{
		Version:   "1.0",
		Cases:     specs,
		Results:   results,
		PQResults: pqResults,
	}

	encoded, err := json.MarshalIndent(refData, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')

	fixturePath := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice47-search-reference.json")

	if os.Getenv("TALA_SLICE47_ORACLE") == "1" {
		if err := os.WriteFile(fixturePath, encoded, 0644); err != nil {
			t.Fatal(err)
		}
		t.Logf("Wrote reference fixture to %s (%d bytes)", fixturePath, len(encoded))
		return
	}

	committed, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to read committed fixture %s: %v. Run with TALA_SLICE47_ORACLE=1 to generate.", fixturePath, err)
	}

	committedNorm := bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	encodedNorm := bytes.ReplaceAll(encoded, []byte("\r\n"), []byte("\n"))

	if !bytes.Equal(committedNorm, encodedNorm) {
		t.Fatalf("Search oracle output differs from committed fixture %s. Run with TALA_SLICE47_ORACLE=1 to update if intentional.", fixturePath)
	}
}

// Ensure unused sort is not flagged
var _ = sort.Strings
var _ = fmt.Sprintf
