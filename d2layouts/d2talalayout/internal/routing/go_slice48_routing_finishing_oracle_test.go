package routing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/quality"
)

// Explicit generation only. Ordinary runs recompute and never write.
type s48Case struct {
	Name          string          `json:"name"`
	Stage         string          `json:"stage"`
	Nodes         []s47rcNodeSpec `json:"nodes"`
	Edges         []s47rcEdgeSpec `json:"edges"`
	Cluster       []uint64        `json:"cluster,omitempty"`
	Before        [][]s47rcPt     `json:"before"`
	After         [][]s47rcPt     `json:"after"`
	MetricsBefore quality.Metrics `json:"metrics_before"`
	MetricsAfter  quality.Metrics `json:"metrics_after"`
	Work          uint64          `json:"work,omitempty"`
}

func s48pts(v ...float64) []s47rcPt {
	p := []s47rcPt{}
	for i := 0; i < len(v); i += 2 {
		p = append(p, s47rcPt{s47rcF(v[i]), s47rcF(v[i+1])})
	}
	return p
}
func s48nodes(v ...float64) []s47rcNodeSpec {
	ns := []s47rcNodeSpec{}
	for i := 0; i < len(v); i += 4 {
		ns = append(ns, s47rcNodeSpec{ID: uint64(i/4 + 1), X: s47rcF(v[i]), Y: s47rcF(v[i+1]), W: s47rcF(v[i+2]), H: s47rcF(v[i+3])})
	}
	return ns
}
func s48edge(from, to uint64, ps ...float64) s47rcEdgeSpec {
	return s47rcEdgeSpec{From: from, To: to, Points: s48pts(ps...)}
}
func s48build(c s48Case) *layoutgraph.Graph {
	g := buildGraphFromSpec(c.Nodes, c.Edges, nil, nil)
	if len(c.Cluster) > 0 {
		ns := []*layoutgraph.Node{}
		for _, id := range c.Cluster {
			for _, n := range g.Nodes {
				if uint64(n.ID) == id {
					ns = append(ns, n)
				}
			}
		}
		v := layoutgraph.NewNode(100, 500, 100)
		v.TopLeft = g.Nodes[0].TopLeft.Copy()
		cl := &layoutgraph.Cluster{Vessel: v, Nodes: ns, Arrangement: layoutgraph.Row, DesiredArrangement: layoutgraph.Row, Graph: g}
		if c.Stage == "Crosshatch" {
			for _, e := range g.Edges {
				cl.EdgeAbductions = append(cl.EdgeAbductions, &layoutgraph.EdgeAbduction{Edge: e, OriginallyFrom: e.From, CurrentFrom: e.From, CurrentTo: e.To})
			}
		}
		g.Clusters[v] = cl
		for _, n := range ns {
			n.Cluster = cl
		}
	}
	return g
}
func s48routes(g *layoutgraph.Graph) [][]s47rcPt {
	out := [][]s47rcPt{}
	for _, e := range g.Edges {
		ps := []s47rcPt{}
		for _, p := range e.Points {
			ps = append(ps, s47rcPoint(p))
		}
		out = append(out, ps)
	}
	return out
}
func s48run(stage string, g *layoutgraph.Graph, w uint64) error {
	ctx := context.Background()
	switch stage {
	case "SimplifyEdgeRoutes":
		return simplifyEdgeRoutesWithLimit(ctx, g, w)
	case "SwapAllEdgePorts":
		return swapAllEdgePortsWithWorkLimit(ctx, g, w)
	case "StraightEdgesFallback":
		return StraightEdgesFallback(ctx, g)
	case "ReorderDuplicates":
		return ReorderDuplicates(ctx, g)
	case "Crosshatch":
		return crosshatchWithWorkLimit(ctx, g, w)
	case "BalanceEdgeSegments":
		return balanceEdgeSegmentsWithLimit(ctx, g, w)
	case "FixClusterEdgeBranching":
		return fixClusterEdgeBranchingWithLimit(ctx, g, w)
	case "TraceEdgesToShapeBorder":
		return traceEdgesToShapeBorderWithWorkLimit(ctx, g, w)
	case "NudgeEdgeChannels":
		return nudgeChannelsWithLimit(ctx, g, w)
	case "ShortcutEdgeRoutes":
		return shortcutRoutesWithLimit(ctx, g, w)
	case "Inspect":
		_, err := quality.Inspect(ctx, g)
		return err
	}
	panic(stage)
}
func TestGoSlice48RoutingFinishingOracle(t *testing.T) {
	basic := s48nodes(-10, -5, 10, 10, 40, -25, 10, 10)
	staircase := s48nodes(0, 200, 100, 100, 500, 0, 100, 100)
	cases := []s48Case{
		{Name: "detour", Stage: "SimplifyEdgeRoutes", Nodes: basic, Edges: []s47rcEdgeSpec{s48edge(1, 2, 0, 0, 10, 0, 10, 20, 40, 20, 40, -20)}},
		{Name: "opposite_vertical", Stage: "SimplifyEdgeRoutes", Nodes: s48nodes(-5, -10, 10, 10, -25, 40, 10, 10), Edges: []s47rcEdgeSpec{s48edge(1, 2, 0, 0, 0, 10, 20, 10, 20, 40, -20, 40)}},
		{Name: "second_leg_obstacle", Stage: "SimplifyEdgeRoutes", Nodes: append(append([]s47rcNodeSpec{}, basic...), s47rcNodeSpec{ID: 3, X: 35, Y: -15, W: 10, H: 10}), Edges: []s47rcEdgeSpec{s48edge(1, 2, 0, 0, 10, 0, 10, 20, 40, 20, 40, -20)}},
		{Name: "same_side", Stage: "SwapAllEdgePorts", Nodes: s48nodes(0, 0, 10, 10, 100, 100, 10, 10, 100, -100, 10, 10), Edges: []s47rcEdgeSpec{s48edge(1, 2, 10, 2, 30, 2, 30, 110, 100, 110), s48edge(1, 3, 10, 8, 40, 8, 40, -90, 100, -90)}},
		{Name: "free_straight", Stage: "StraightEdgesFallback", Nodes: s48nodes(0, 0, 100, 100, 300, 0, 100, 100), Edges: []s47rcEdgeSpec{s48edge(1, 2, 100, 50, 150, 50, 150, -100, 250, -100, 250, 50, 300, 50)}},
		{Name: "duplicate_reversal", Stage: "ReorderDuplicates", Nodes: s48nodes(0, 0, 40, 40, 0, 200, 40, 40), Edges: []s47rcEdgeSpec{s48edge(1, 2, 10, 40, 10, 200), s48edge(2, 1, 30, 200, 30, 40), {From: 1, To: 2, Points: s48pts(20, 40, 20, 200), Label: "labeled"}}},
		{Name: "cluster_shared", Stage: "Crosshatch", Nodes: s48nodes(0, 0, 100, 100, 0, 200, 100, 100, 400, 0, 100, 100, 400, 200, 100, 100), Cluster: []uint64{1, 2}, Edges: []s47rcEdgeSpec{s48edge(1, 3, 100, 100, 400, 50), s48edge(2, 4, 100, 100, 400, 250)}},
		{Name: "regular_bends", Stage: "BalanceEdgeSegments", Nodes: staircase, Edges: []s47rcEdgeSpec{s48edge(1, 2, 100, 250, 200, 250, 200, 150, 400, 150, 400, 50, 500, 50)}},
		{Name: "cluster_branch", Stage: "FixClusterEdgeBranching", Nodes: s48nodes(200, 0, 20, 20, 0, 200, 20, 20, 400, 200, 20, 20), Cluster: []uint64{2, 3}, Edges: []s47rcEdgeSpec{s48edge(1, 2, 210, 20, 210, 80, 10, 80, 10, 200), s48edge(1, 3, 210, 20, 210, 120, 410, 120, 410, 200)}},
		{Name: "rectangle", Stage: "TraceEdgesToShapeBorder", Nodes: s48nodes(0, 0, 100, 100, 300, 0, 100, 100), Edges: []s47rcEdgeSpec{s48edge(1, 2, 50, 50, 350, 50)}},
		{Name: "ellipse", Stage: "TraceEdgesToShapeBorder", Nodes: s48nodes(0, 0, 100, 100, 300, 0, 100, 100), Edges: []s47rcEdgeSpec{s48edge(1, 2, 100, 25, 300, 25)}},
		{Name: "diamond", Stage: "TraceEdgesToShapeBorder", Nodes: s48nodes(0, 0, 100, 100, 300, 0, 100, 100), Edges: []s47rcEdgeSpec{s48edge(1, 2, 100, 25, 300, 25)}},
		{Name: "channel_wire_shortening", Stage: "NudgeEdgeChannels", Nodes: []s47rcNodeSpec{{ID: 1, X: 0, Y: 200, W: 200, H: 300}, {ID: 2, X: 50, Y: 300, W: 50, H: 50, Container: 1}, {ID: 3, X: 400, Y: 300, W: 50, H: 50}, {ID: 4, X: 0, Y: 0, W: 500, H: 130}}, Edges: []s47rcEdgeSpec{s48edge(2, 3, 75, 300, 75, 140, 425, 140, 425, 300)}},
		{Name: "staircase", Stage: "ShortcutEdgeRoutes", Nodes: staircase, Edges: []s47rcEdgeSpec{s48edge(1, 2, 100, 250, 200, 250, 200, 150, 400, 150, 400, 50, 500, 50)}},
		{Name: "crossing_obstruction_overlap", Stage: "Inspect", Nodes: s48nodes(0, 0, 100, 100, 50, 50, 100, 100, 300, 0, 100, 100, 150, -200, 100, 100, 150, 200, 100, 100), Edges: []s47rcEdgeSpec{s48edge(1, 3, 100, 50, 300, 50), s48edge(4, 5, 200, -100, 200, 200)}},
	}

	for _, shapeName := range []string{"Circle", "Oval", "C4Person", "Callout", "Cloud", "Cylinder", "Diamond", "Document", "Hexagon", "Package", "Page", "Parallelogram", "Person", "Queue", "Step", "StoredData"} {
		for _, diagonal := range []bool{false, true} {
			ns := s48nodes(0, 0, 100, 100, 300, 0, 100, 100)
			for i := range ns {
				ns[i].Shape = shapeName
			}
			ps := []s47rcEdgeSpec{s48edge(1, 2, 100, 25, 300, 25)}
			name := shapeName + "/horizontal"
			if diagonal {
				ps = []s47rcEdgeSpec{s48edge(1, 2, 100, 25, 300, 75)}
				name = shapeName + "/diagonal"
			}
			cases = append(cases, s48Case{Name: name, Stage: "TraceEdgesToShapeBorder", Nodes: ns, Edges: ps})
		}
	}
	for i := range cases {
		c := &cases[i]
		if c.Name == "ellipse" || c.Name == "diamond" {
			for j := range c.Nodes {
				if c.Name == "ellipse" {
					c.Nodes[j].Shape = "Oval"
				} else {
					c.Nodes[j].Shape = "Diamond"
				}
			}
		}
		g := s48build(*c)
		c.Before = s48routes(g)
		var err error
		c.MetricsBefore, err = quality.Inspect(context.Background(), g)
		if err != nil {
			t.Fatalf("%s before metrics: %v", c.Name, err)
		}
		if err = s48run(c.Stage, g, maxRouteStageWorkUnits); err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		c.After = s48routes(g)
		c.MetricsAfter, err = quality.Inspect(context.Background(), g)
		if err != nil {
			t.Fatal(err)
		}
		if c.Stage != "StraightEdgesFallback" && c.Stage != "ReorderDuplicates" && c.Stage != "Inspect" {
			lo, hi := uint64(0), uint64(maxRouteStageWorkUnits)
			for lo < hi {
				mid := (lo + hi) / 2
				err = s48run(c.Stage, s48build(*c), mid)
				if err == nil {
					hi = mid
				} else if errors.Is(err, errRouteStageWorkLimit) {
					lo = mid + 1
				} else {
					t.Fatalf("%s work: %v", c.Name, err)
				}
			}
			c.Work = lo
			if err = s48run(c.Stage, s48build(*c), lo); err != nil {
				t.Fatal(err)
			}
			g = s48build(*c)
			before, _ := json.Marshal(s48routes(g))
			err = s48run(c.Stage, g, lo-1)
			after, _ := json.Marshal(s48routes(g))
			if !errors.Is(err, errRouteStageWorkLimit) || !bytes.Equal(before, after) {
				t.Fatalf("%s W-1 rollback: %v", c.Name, err)
			}
		}
	}
	data, err := json.MarshalIndent(struct {
		Authority string    `json:"authority"`
		Cases     []s48Case `json:"cases"`
	}{"01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579", cases}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice48-routing-finishing-reference.json")
	if os.Getenv("TALA_SLICE48_ORACLE") == "1" {
		if err = os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
	} else {
		stored, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(stored, data) {
			t.Fatal("Slice 48 fixture stale; regenerate explicitly with TALA_SLICE48_ORACLE=1")
		}
	}
}
