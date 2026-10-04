package quality

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 49 quality oracle: legacy candidate scoring, crossings, label penalties,
// unrounded area calculation, Score.Compare ordering, and exact W/W-1 work limit accounting.
//
// Generated with TALA_SLICE49_ORACLE=1.
// Replayed by js/test/unit/quality-scoring-oracle.test.js.

type s49qF float64

func (f s49qF) MarshalJSON() ([]byte, error) {
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

type s49qLabelSpec struct {
	Text  string `json:"text"`
	W     s49qF  `json:"w"`
	H     s49qF  `json:"h"`
	Pos   int    `json:"pos"`
	Fixed bool   `json:"fixed,omitempty"`
}

type s49qIconSpec struct {
	Pos   int  `json:"pos"`
	Fixed bool `json:"fixed,omitempty"`
}

type s49qNodeSpec struct {
	ID        int64          `json:"id"`
	W         s49qF          `json:"w"`
	H         s49qF          `json:"h"`
	X         s49qF          `json:"x"`
	Y         s49qF          `json:"y"`
	Shape     string         `json:"shape,omitempty"`
	Container int64          `json:"container,omitempty"`
	Label     *s49qLabelSpec `json:"label,omitempty"`
	Icon      *s49qIconSpec  `json:"icon,omitempty"`
}

type s49qClusterSpec struct {
	Vessel  int64   `json:"vessel"`
	Members []int64 `json:"members"`
}

type s49qEdgeSpec struct {
	ID       int64          `json:"id"`
	From     int64          `json:"from"`
	To       int64          `json:"to"`
	Points   [][2]s49qF     `json:"points"`
	Label    *s49qLabelSpec `json:"label,omitempty"`
	Pct      s49qF          `json:"pct,omitempty"`
	Src      string         `json:"src,omitempty"`
	Dst      string         `json:"dst,omitempty"`
	SrcLabel *s49qLabelSpec `json:"srcLabel,omitempty"`
	DstLabel *s49qLabelSpec `json:"dstLabel,omitempty"`
}

type s49qSpec struct {
	Nodes    []s49qNodeSpec    `json:"nodes"`
	Clusters []s49qClusterSpec `json:"clusters,omitempty"`
	Edges    []s49qEdgeSpec    `json:"edges"`
}

type s49qScenarioResult struct {
	Name    string   `json:"name"`
	Spec    s49qSpec `json:"spec"`
	Penalty s49qF    `json:"penalty"`
	Area    s49qF    `json:"area"`
}

type s49qCompareProbe struct {
	A       [2]s49qF `json:"a"` // [penalty, area]
	B       [2]s49qF `json:"b"`
	Outcome int      `json:"outcome"`
}

type s49qExactWorkResult struct {
	Name         string   `json:"name"`
	Spec         s49qSpec `json:"spec"`
	W            int64    `json:"w"`
	Penalty      s49qF    `json:"penalty"`
	Area         s49qF    `json:"area"`
	WMinus1Error string   `json:"wMinus1Error"`
	WMinus1Used  int64    `json:"wMinus1Used"`
}

type s49qOracle struct {
	MaxWork   int64                `json:"maxWork"`
	Scenarios []s49qScenarioResult `json:"scenarios"`
	Compare   []s49qCompareProbe   `json:"compare"`
	ExactWork s49qExactWorkResult  `json:"exactWork"`
}

func s49qLabelOf(spec *s49qLabelSpec) *layoutgraph.Label {
	if spec == nil {
		return nil
	}
	value := &layoutgraph.Label{
		Text:     spec.Text,
		Position: label.Position(spec.Pos),
		Width:    float64(spec.W),
		Height:   float64(spec.H),
	}
	if spec.Fixed {
		value.FixPosition()
	}
	return value
}

func s49qPoints(route [][2]s49qF) []*geo.Point {
	points := make([]*geo.Point, 0, len(route))
	for _, p := range route {
		points = append(points, geo.NewPoint(float64(p[0]), float64(p[1])))
	}
	return points
}

func s49qBuild(spec s49qSpec) *layoutgraph.Graph {
	g := layoutgraph.NewGraph()
	byID := make(map[int64]*layoutgraph.Node)

	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		n.Label = s49qLabelOf(ns.Label)
		if ns.Icon != nil {
			n.Icon = &layoutgraph.Icon{Position: label.Position(ns.Icon.Pos)}
			if ns.Icon.Fixed {
				n.Icon.FixPosition()
			}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = byID[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		byID[ns.ID] = n
	}

	for _, cs := range spec.Clusters {
		cluster := &layoutgraph.Cluster{Vessel: layoutgraph.NewNode(layoutgraph.EntityID(cs.Vessel), 10, 10)}
		for _, member := range cs.Members {
			cluster.Nodes = append(cluster.Nodes, byID[member])
			byID[member].Cluster = cluster
		}
	}

	for _, es := range spec.Edges {
		e := g.Connect(byID[es.From], byID[es.To])
		e.ID = layoutgraph.EntityID(es.ID)
		e.Points = s49qPoints(es.Points)
		e.Label = s49qLabelOf(es.Label)
		e.LabelPercentage = float64(es.Pct)
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		e.SourceArrowheadLabel = s49qLabelOf(es.SrcLabel)
		e.TargetArrowheadLabel = s49qLabelOf(es.DstLabel)
	}

	return g
}

func s49qBuildScenarios() []struct {
	Name string
	Spec s49qSpec
} {
	return []struct {
		Name string
		Spec s49qSpec
	}{
		{
			Name: "empty-graph",
			Spec: s49qSpec{},
		},
		{
			Name: "single-node",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 60, H: 40, X: 10, Y: 20},
				},
			},
		},
		{
			Name: "fractional-area",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 12.5, H: 3.25, X: 0.25, Y: 0.5},
				},
			},
		},
		{
			Name: "large-area",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 1_000_000_000, H: 1_000_000_000, X: 0, Y: 0},
				},
			},
		},
		{
			Name: "orthogonal-edge",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 10, Y: 10},
					{ID: 2, W: 40, H: 40, X: 150, Y: 10},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{50, 30}, {150, 30}},
					},
				},
			},
		},
		{
			Name: "multibend-edge",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 10, Y: 10},
					{ID: 2, W: 40, H: 40, X: 150, Y: 150},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{50, 30}, {100, 30}, {100, 170}, {150, 170}},
					},
				},
			},
		},
		{
			Name: "diagonal-edge",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 10, Y: 10},
					{ID: 2, W: 40, H: 40, X: 150, Y: 150},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{50, 30}, {150, 170}},
					},
				},
			},
		},
		{
			Name: "crossing-edges",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 20, H: 20, X: 0, Y: 0},
					{ID: 2, W: 20, H: 20, X: 100, Y: 100},
					{ID: 3, W: 20, H: 20, X: 0, Y: 100},
					{ID: 4, W: 20, H: 20, X: 100, Y: 0},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{10, 10}, {110, 110}},
					},
					{
						ID: 2, From: 3, To: 4,
						Points: [][2]s49qF{{10, 110}, {110, 10}},
					},
				},
			},
		},
		{
			Name: "cluster-edge",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 20},
					{ID: 2, W: 40, H: 40, X: 160, Y: 20},
				},
				Clusters: []s49qClusterSpec{
					{Vessel: 99, Members: []int64{2}},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{60, 40}, {100, 40}, {100, 80}, {160, 80}},
					},
				},
			},
		},
		{
			Name: "node-label",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 80, H: 50, X: 40, Y: 40, Label: &s49qLabelSpec{Text: "A", W: 30, H: 14, Pos: int(label.InsideMiddleCenter)}},
				},
			},
		},
		{
			Name: "outside-node-label",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 60, H: 40, X: 100, Y: 100, Label: &s49qLabelSpec{Text: "Out", W: 40, H: 14, Pos: int(label.OutsideTopCenter)}},
				},
			},
		},
		{
			Name: "icon",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 80, H: 60, X: 50, Y: 50, Icon: &s49qIconSpec{Pos: int(label.InsideTopLeft)}},
				},
			},
		},
		{
			Name: "edge-label",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 50},
					{ID: 2, W: 40, H: 40, X: 200, Y: 50},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49qF{{60, 70}, {200, 70}},
						Label:  &s49qLabelSpec{Text: "mid", W: 30, H: 14, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "arrowhead-label",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 50},
					{ID: 2, W: 40, H: 40, X: 200, Y: 50},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points:   [][2]s49qF{{60, 70}, {200, 70}},
						Src:      "arrow",
						Dst:      "arrow",
						SrcLabel: &s49qLabelSpec{Text: "1", W: 12, H: 12},
						DstLabel: &s49qLabelSpec{Text: "*", W: 12, H: 12},
					},
				},
			},
		},
		{
			Name: "loop-label",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 60, H: 60, X: 40, Y: 40},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 1,
						Points: [][2]s49qF{{100, 50}, {140, 50}, {140, 80}, {100, 80}},
						Label:  &s49qLabelSpec{Text: "cycle", W: 28, H: 12, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "shared-edge-segments",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 30, H: 30, X: 10, Y: 10},
					{ID: 2, W: 30, H: 30, X: 10, Y: 100},
					{ID: 3, W: 30, H: 30, X: 200, Y: 10},
					{ID: 4, W: 30, H: 30, X: 200, Y: 100},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 1, To: 3,
						Points: [][2]s49qF{{40, 25}, {90, 25}, {90, 60}, {150, 60}, {150, 25}, {200, 25}},
						Label:  &s49qLabelSpec{Text: "S1", W: 20, H: 10, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
					{
						ID: 2, From: 2, To: 4,
						Points: [][2]s49qF{{40, 115}, {90, 115}, {90, 60}, {150, 60}, {150, 115}, {200, 115}},
						Label:  &s49qLabelSpec{Text: "S2", W: 20, H: 10, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "container-ancestry",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 200, H: 160, X: 10, Y: 10},
					{ID: 2, W: 40, H: 40, X: 30, Y: 30, Container: 1, Label: &s49qLabelSpec{Text: "Child1", W: 28, H: 12, Pos: int(label.InsideMiddleCenter)}},
					{ID: 3, W: 40, H: 40, X: 120, Y: 30, Container: 1, Label: &s49qLabelSpec{Text: "Child2", W: 28, H: 12, Pos: int(label.InsideMiddleCenter)}},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 2, To: 3,
						Points: [][2]s49qF{{70, 50}, {120, 50}},
						Label:  &s49qLabelSpec{Text: "Link", W: 24, H: 10, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "mixed-completed-layout",
			Spec: s49qSpec{
				Nodes: []s49qNodeSpec{
					{ID: 1, W: 260, H: 200, X: 10, Y: 10, Label: &s49qLabelSpec{Text: "Container", W: 50, H: 14, Pos: int(label.OutsideTopCenter)}},
					{ID: 2, W: 50, H: 50, X: 30, Y: 40, Container: 1, Label: &s49qLabelSpec{Text: "Node1", W: 30, H: 12, Pos: int(label.InsideMiddleCenter)}, Icon: &s49qIconSpec{Pos: int(label.InsideTopLeft)}},
					{ID: 3, W: 50, H: 50, X: 150, Y: 40, Container: 1, Label: &s49qLabelSpec{Text: "Node2", W: 30, H: 12, Pos: int(label.InsideMiddleCenter)}},
					{ID: 4, W: 50, H: 50, X: 90, Y: 120, Container: 1, Label: &s49qLabelSpec{Text: "Node3", W: 30, H: 12, Pos: int(label.InsideMiddleCenter)}},
				},
				Edges: []s49qEdgeSpec{
					{
						ID: 1, From: 2, To: 3,
						Points:   [][2]s49qF{{80, 65}, {150, 65}},
						Src:      "arrow",
						Dst:      "arrow",
						SrcLabel: &s49qLabelSpec{Text: "s", W: 10, H: 10},
						DstLabel: &s49qLabelSpec{Text: "d", W: 10, H: 10},
						Label:    &s49qLabelSpec{Text: "e1", W: 20, H: 10, Pos: int(label.InsideMiddleCenter)},
						Pct:      0.5,
					},
					{
						ID: 2, From: 3, To: 4,
						Points: [][2]s49qF{{175, 90}, {175, 145}, {140, 145}},
						Label:  &s49qLabelSpec{Text: "e2", W: 20, H: 10, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
	}
}

func s49qBuildCompareProbes() []s49qCompareProbe {
	nan := math.NaN()
	inf := math.Inf(1)
	negInf := math.Inf(-1)

	cases := []struct {
		a [2]float64
		b [2]float64
	}{
		// Lower penalty wins
		{[2]float64{1.0, 100}, [2]float64{2.0, 50}},
		// Higher penalty loses
		{[2]float64{5.0, 10}, [2]float64{3.0, 10}},
		// Equal penalty, lower area wins
		{[2]float64{1.5, 99}, [2]float64{1.5, 100}},
		// Equal penalty, higher area loses
		{[2]float64{1.5, 100}, [2]float64{1.5, 99}},
		// Equal penalty, equal area
		{[2]float64{2.5, 50}, [2]float64{2.5, 50}},
		// Finite penalty beats NaN penalty
		{[2]float64{10.0, 100}, [2]float64{nan, 100}},
		// Finite penalty beats +Inf penalty
		{[2]float64{10.0, 100}, [2]float64{inf, 100}},
		// Finite penalty beats -Inf penalty
		{[2]float64{10.0, 100}, [2]float64{negInf, 100}},
		// Both NaN penalties are equal
		{[2]float64{nan, 50}, [2]float64{nan, 100}},
		// Both +Inf penalties are equal
		{[2]float64{inf, 50}, [2]float64{inf, 100}},
		// Valid area beats NaN area
		{[2]float64{1.0, 50}, [2]float64{1.0, nan}},
		// Valid area beats +Inf area
		{[2]float64{1.0, 50}, [2]float64{1.0, inf}},
		// Valid area beats negative area
		{[2]float64{1.0, 50}, [2]float64{1.0, -10}},
		// Both negative areas are equal invalid
		{[2]float64{1.0, -5}, [2]float64{1.0, -10}},
		// Fractional values exact comparison
		{[2]float64{1.125, 40.625}, [2]float64{1.125, 40.626}},
		// Large finite values
		{[2]float64{1e9, 1e18}, [2]float64{1e9, 1e18 + 1}},
	}

	var probes []s49qCompareProbe
	for _, c := range cases {
		scoreA := Score{Penalty: c.a[0], Area: c.a[1]}
		scoreB := Score{Penalty: c.b[0], Area: c.b[1]}
		outcome := scoreA.Compare(scoreB)
		probes = append(probes, s49qCompareProbe{
			A:       [2]s49qF{s49qF(c.a[0]), s49qF(c.a[1])},
			B:       [2]s49qF{s49qF(c.b[0]), s49qF(c.b[1])},
			Outcome: outcome,
		})
	}
	return probes
}

func TestSlice49QualityOracle(t *testing.T) {
	ctx := context.Background()
	oracle := s49qOracle{MaxWork: maxEvaluationWorkUnits}

	// 1. Scenarios
	for _, sc := range s49qBuildScenarios() {
		g := s49qBuild(sc.Spec)
		score, area, err := EvaluateWithArea(ctx, g)
		if err != nil {
			t.Fatalf("EvaluateWithArea(%s): %v", sc.Name, err)
		}
		oracle.Scenarios = append(oracle.Scenarios, s49qScenarioResult{
			Name:    sc.Name,
			Spec:    sc.Spec,
			Penalty: s49qF(score),
			Area:    s49qF(area),
		})
	}

	// 2. Score.Compare
	oracle.Compare = s49qBuildCompareProbes()

	// 3. Exact W/W-1 measurement
	exactSpec := s49qSpec{
		Nodes: []s49qNodeSpec{
			{ID: 1, W: 240, H: 180, X: -40, Y: -40},
			{ID: 2, W: 40, H: 40, X: 0, Y: 0, Container: 1, Label: &s49qLabelSpec{Text: "A", W: 20, H: 12, Pos: int(label.OutsideTopCenter)}},
			{ID: 3, W: 40, H: 40, X: 120, Y: 80, Container: 1, Label: &s49qLabelSpec{Text: "B", W: 20, H: 12, Pos: int(label.InsideMiddleCenter)}},
		},
		Edges: []s49qEdgeSpec{
			{
				ID: 1, From: 2, To: 3,
				Points:   [][2]s49qF{{20, 20}, {70, 20}, {140, 100}},
				Label:    &s49qLabelSpec{Text: "first", W: 28, H: 12, Pos: int(label.InsideMiddleCenter)},
				Pct:      0.5,
				SrcLabel: &s49qLabelSpec{Text: "source", W: 32, H: 12},
			},
			{
				ID: 2, From: 2, To: 3,
				Points: [][2]s49qF{{20, 20}, {70, 20}, {140, 60}},
				Label:  &s49qLabelSpec{Text: "second", W: 36, H: 12, Pos: int(label.InsideMiddleCenter)},
				Pct:    0.5,
			},
		},
	}
	gExact := s49qBuild(exactSpec)
	wantScore, wantArea, required, err := evaluateWithAreaLimit(ctx, gExact, maxEvaluationWorkUnits)
	if err != nil {
		t.Fatalf("evaluateWithAreaLimit(exactSpec): %v", err)
	}

	// At exact W
	gAtW := s49qBuild(exactSpec)
	gotScore, gotArea, exact, err := evaluateWithAreaLimit(ctx, gAtW, required)
	if err != nil {
		t.Fatalf("exact required work %d failed: %v", required, err)
	}
	if exact != required || gotScore != wantScore || gotArea != wantArea {
		t.Fatalf("exact result = (%v, %v, %d), want (%v, %v, %d)", gotScore, gotArea, exact, wantScore, wantArea, required)
	}

	// At W-1
	gShort := s49qBuild(exactSpec)
	_, _, rejectedAt, errShort := evaluateWithAreaLimit(ctx, gShort, required-1)
	if errShort == nil || !strings.Contains(errShort.Error(), "TALA Evaluate work exceeds limit") {
		t.Fatalf("one-unit-short error = %v, want evaluation work limit", errShort)
	}

	oracle.ExactWork = s49qExactWorkResult{
		Name:         "representative-scoring-exact-work",
		Spec:         exactSpec,
		W:            required,
		Penalty:      s49qF(wantScore),
		Area:         s49qF(wantArea),
		WMinus1Error: errShort.Error(),
		WMinus1Used:  rejectedAt,
	}

	encoded, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')

	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice49-quality-reference.json")
	if os.Getenv("TALA_SLICE49_ORACLE") == "1" {
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
		t.Fatalf("go-slice49-quality-reference.json is stale; regenerate with TALA_SLICE49_ORACLE=1")
	}
}
