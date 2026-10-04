package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/quality"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 50 engine oracle. Builds internal layoutgraph graphs directly (no D2
// adapter), runs engine.Layout for each configured seed and pins the complete
// layout result. With TALA_SLICE50_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice50-engine-reference.json; otherwise it recomputes
// every value and asserts the committed fixture byte for byte.

type s50Label struct {
	Text  string  `json:"text"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Pos   int     `json:"pos,omitempty"`
	Fixed bool    `json:"fixed,omitempty"`
}

type s50Node struct {
	ID        uint64    `json:"id"`
	W         float64   `json:"w"`
	H         float64   `json:"h"`
	Container uint64    `json:"container,omitempty"`
	Fixed     bool      `json:"fixed,omitempty"`
	FX        float64   `json:"fx,omitempty"`
	FY        float64   `json:"fy,omitempty"`
	Shape     string    `json:"shape,omitempty"`
	Label     *s50Label `json:"label,omitempty"`
}

type s50Edge struct {
	ID       uint64    `json:"id"`
	From     uint64    `json:"from"`
	To       uint64    `json:"to"`
	Directed bool      `json:"directed,omitempty"`
	Label    *s50Label `json:"label,omitempty"`
}

type s50Direction struct {
	Container   uint64 `json:"container"`
	Orientation int    `json:"orientation"`
}

type s50Spec struct {
	Nodes      []s50Node      `json:"nodes"`
	Edges      []s50Edge      `json:"edges,omitempty"`
	Directions []s50Direction `json:"directions,omitempty"`
}

func (spec s50Spec) build() *layoutgraph.Graph {
	g := layoutgraph.NewGraph()
	nodes := map[uint64]*layoutgraph.Node{}
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), ns.W, ns.H)
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Text: ns.Label.Text, Width: ns.Label.W, Height: ns.Label.H, Position: label.Position(ns.Label.Pos)}
			if ns.Label.Fixed {
				n.Label.FixPosition()
			}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		nodes[ns.ID] = n
	}
	for _, es := range spec.Edges {
		e := g.Connect(nodes[es.From], nodes[es.To])
		e.ID = layoutgraph.EntityID(es.ID)
		if es.Directed {
			e.SourceArrowhead = layoutgraph.NoArrowhead
			e.TargetArrowhead = layoutgraph.TriangleArrowhead
		}
		if es.Label != nil {
			e.Label = &layoutgraph.Label{Text: es.Label.Text, Width: es.Label.W, Height: es.Label.H, Position: label.Position(es.Label.Pos)}
			if es.Label.Fixed {
				e.Label.FixPosition()
			}
		}
	}
	for _, d := range spec.Directions {
		var container *layoutgraph.Node
		if d.Container != 0 {
			container = nodes[d.Container]
		}
		g.Directions[container] = geo.Orientation(d.Orientation)
	}
	return g
}

type s50NodeResult struct {
	ID       uint64  `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	LabelPos int     `json:"labelPos"`
}

type s50EdgeResult struct {
	ID              uint64    `json:"id"`
	Points          []float64 `json:"points"`
	IsCurve         bool      `json:"isCurve"`
	LabelPos        int       `json:"labelPos"`
	LabelPercentage float64   `json:"labelPercentage"`
}

type s50Result struct {
	Seed    int64           `json:"seed"`
	Error   string          `json:"error"`
	Nodes   []s50NodeResult `json:"nodes,omitempty"`
	Edges   []s50EdgeResult `json:"edges,omitempty"`
	Area    float64         `json:"area"`
	Penalty float64         `json:"penalty"`
	Empty   bool            `json:"empty,omitempty"`
}

type s50Case struct {
	Name    string      `json:"name"`
	Spec    s50Spec     `json:"spec"`
	Stable  bool        `json:"stable"`
	Results []s50Result `json:"results"`
}

func s50Run(spec s50Spec, seed int64) s50Result {
	res := s50Result{Seed: seed}
	input := spec.build()
	out, err := Layout(context.Background(), input, LayoutOptions{Seed: seed})
	if err != nil {
		res.Error = err.Error()
		return res
	}
	if len(out.Nodes) == 0 {
		res.Empty = true
	}
	for _, n := range out.Nodes {
		nr := s50NodeResult{ID: uint64(n.ID), W: n.Width, H: n.Height}
		if n.TopLeft != nil {
			nr.X, nr.Y = n.TopLeft.X, n.TopLeft.Y
		}
		if n.Label != nil {
			nr.LabelPos = int(n.Label.Position)
		}
		res.Nodes = append(res.Nodes, nr)
	}
	for _, e := range out.Edges {
		er := s50EdgeResult{ID: uint64(e.ID), IsCurve: e.IsCurve, LabelPercentage: e.LabelPercentage, Points: []float64{}}
		for _, p := range e.Points {
			er.Points = append(er.Points, p.X, p.Y)
		}
		if e.Label != nil {
			er.LabelPos = int(e.Label.Position)
		}
		res.Edges = append(res.Edges, er)
	}
	if len(out.Nodes) > 0 {
		penalty, area, err := quality.EvaluateWithArea(context.Background(), out)
		if err != nil {
			res.Error = "evaluate: " + err.Error()
			return res
		}
		res.Penalty, res.Area = penalty, area
	}
	return res
}

func s50Chain(n int) ([]s50Node, []s50Edge) {
	var nodes []s50Node
	var edges []s50Edge
	for i := 1; i <= n; i++ {
		nodes = append(nodes, s50Node{ID: uint64(i), W: 100, H: 50})
		if i > 1 {
			edges = append(edges, s50Edge{ID: uint64(1000 + i), From: uint64(i - 1), To: uint64(i), Directed: true})
		}
	}
	return nodes, edges
}

func s50Cases() []struct {
	name  string
	spec  s50Spec
	seeds []int64
} {
	type c = struct {
		name  string
		spec  s50Spec
		seeds []int64
	}
	chainNodes, chainEdges := s50Chain(3)
	hierNodes, hierEdges := s50Chain(6)
	hierEdges = append(hierEdges, s50Edge{ID: 2001, From: 1, To: 4, Directed: true}, s50Edge{ID: 2002, From: 2, To: 5, Directed: true})
	clusterNodes := []s50Node{{ID: 1, W: 120, H: 60}}
	var clusterEdges []s50Edge
	for i := uint64(2); i <= 7; i++ {
		clusterNodes = append(clusterNodes, s50Node{ID: i, W: 60, H: 40})
		clusterEdges = append(clusterEdges, s50Edge{ID: 3000 + i, From: 1, To: i, Directed: true})
	}
	return []c{
		{"empty", s50Spec{}, []int64{1}},
		{"single-node", s50Spec{Nodes: []s50Node{{ID: 1, W: 100, H: 50}}}, []int64{1}},
		{"two-node-edge", s50Spec{Nodes: []s50Node{{ID: 1, W: 100, H: 50}, {ID: 2, W: 100, H: 50}}, Edges: []s50Edge{{ID: 10, From: 1, To: 2, Directed: true}}}, []int64{1, 2}},
		{"three-node-chain", s50Spec{Nodes: chainNodes, Edges: chainEdges}, []int64{1, 2, 3}},
		{"branch", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 100, H: 50}, {ID: 2, W: 80, H: 40}, {ID: 3, W: 80, H: 40}, {ID: 4, W: 80, H: 40}},
			Edges: []s50Edge{{ID: 11, From: 1, To: 2}, {ID: 12, From: 1, To: 3}, {ID: 13, From: 1, To: 4}, {ID: 14, From: 3, To: 4}},
		}, []int64{1, 2}},
		{"nested-container", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 0, H: 0, Label: &s50Label{Text: "group", W: 40, H: 16}}, {ID: 2, W: 80, H: 40, Container: 1}, {ID: 3, W: 80, H: 40, Container: 1}},
			Edges: []s50Edge{{ID: 21, From: 2, To: 3, Directed: true}},
		}, []int64{1}},
		{"inner-and-outer-edge", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 0, H: 0}, {ID: 2, W: 80, H: 40, Container: 1}, {ID: 3, W: 80, H: 40, Container: 1}, {ID: 4, W: 100, H: 50}},
			Edges: []s50Edge{{ID: 31, From: 2, To: 3, Directed: true}, {ID: 32, From: 4, To: 2, Directed: true}, {ID: 33, From: 3, To: 4}},
		}, []int64{1, 3}},
		{"loop", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 100, H: 50}, {ID: 2, W: 100, H: 50}},
			Edges: []s50Edge{{ID: 41, From: 1, To: 1, Directed: true}, {ID: 42, From: 1, To: 2, Directed: true}},
		}, []int64{1}},
		{"labeled", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 100, H: 50, Label: &s50Label{Text: "a", W: 30, H: 16}}, {ID: 2, W: 100, H: 50, Label: &s50Label{Text: "b", W: 30, H: 16}}},
			Edges: []s50Edge{{ID: 51, From: 1, To: 2, Directed: true, Label: &s50Label{Text: "edge", W: 40, H: 16}}},
		}, []int64{1, 2}},
		{"fixed-node", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 100, H: 50, Fixed: true, FX: 0, FY: 0}, {ID: 2, W: 100, H: 50}, {ID: 3, W: 100, H: 50}},
			Edges: []s50Edge{{ID: 61, From: 1, To: 2}, {ID: 62, From: 2, To: 3}},
		}, []int64{1}},
		{"hierarchy-friendly", s50Spec{Nodes: hierNodes, Edges: hierEdges, Directions: []s50Direction{{Container: 0, Orientation: int(geo.Bottom)}}}, []int64{1}},
		{"direction-right", s50Spec{Nodes: chainNodes, Edges: chainEdges, Directions: []s50Direction{{Container: 0, Orientation: int(geo.Right)}}}, []int64{1}},
		{"cluster-friendly", s50Spec{Nodes: clusterNodes, Edges: clusterEdges}, []int64{1}},
		{"multiple-components", s50Spec{
			Nodes: []s50Node{{ID: 1, W: 100, H: 50}, {ID: 2, W: 100, H: 50}, {ID: 3, W: 60, H: 60}, {ID: 4, W: 60, H: 60}, {ID: 5, W: 40, H: 40}},
			Edges: []s50Edge{{ID: 71, From: 1, To: 2}, {ID: 72, From: 3, To: 4}},
		}, []int64{1, 2}},
	}
}

func TestSlice50EngineOracle(t *testing.T) {
	if testing.Short() {
		t.Skip("oracle")
	}
	var cases []s50Case
	for _, sc := range s50Cases() {
		c := s50Case{Name: sc.name, Spec: sc.spec, Stable: true}
		for _, seed := range sc.seeds {
			first := s50Run(sc.spec, seed)
			again := s50Run(sc.spec, seed)
			a, _ := json.Marshal(first)
			b, _ := json.Marshal(again)
			if !bytes.Equal(a, b) {
				c.Stable = false
			}
			if first.Error != "" {
				t.Fatalf("%s seed %d: %s", sc.name, seed, first.Error)
			}
			c.Results = append(c.Results, first)
		}
		if !c.Stable {
			t.Fatalf("%s: engine layout is not deterministic", sc.name)
		}
		cases = append(cases, c)
	}
	encoded, err := json.Marshal(map[string]any{"cases": cases})
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice50-engine-reference.json")
	if os.Getenv("TALA_SLICE50_ORACLE") == "1" {
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
		t.Fatal(fmt.Errorf("go-slice50-engine-reference.json is stale; regenerate with TALA_SLICE50_ORACLE=1"))
	}
}
