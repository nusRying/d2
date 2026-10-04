package labeling

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

// Slice 49 labeling oracle: full labeling.Place / place(ctx, g, limit) behavior,
// covering node icon and label placement, tranches, tie-break, inside fit,
// arrowhead reservations, loop labels, shared route segments, edge labels,
// and exact W/W-1 work limit accounting.
//
// Generated with TALA_SLICE49_ORACLE=1.
// Replayed by js/test/unit/labeling-place-oracle.test.js.

type s49lF float64

func (f s49lF) MarshalJSON() ([]byte, error) {
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

type s49lLabelSpec struct {
	Text  string `json:"text"`
	W     s49lF  `json:"w"`
	H     s49lF  `json:"h"`
	Pos   int    `json:"pos"`
	Fixed bool   `json:"fixed,omitempty"`
}

type s49lIconSpec struct {
	Pos   int  `json:"pos"`
	Fixed bool `json:"fixed,omitempty"`
}

type s49lNodeSpec struct {
	ID        int64          `json:"id"`
	W         s49lF          `json:"w"`
	H         s49lF          `json:"h"`
	X         s49lF          `json:"x"`
	Y         s49lF          `json:"y"`
	Shape     string         `json:"shape,omitempty"`
	Container int64          `json:"container,omitempty"`
	Label     *s49lLabelSpec `json:"label,omitempty"`
	Icon      *s49lIconSpec  `json:"icon,omitempty"`
	Is3D      bool           `json:"is3d,omitempty"`
	Multiple  bool           `json:"multiple,omitempty"`
}

type s49lClusterSpec struct {
	Vessel  int64   `json:"vessel"`
	Members []int64 `json:"members"`
}

type s49lEdgeSpec struct {
	ID       int64          `json:"id"`
	From     int64          `json:"from"`
	To       int64          `json:"to"`
	Points   [][2]s49lF     `json:"points"`
	Label    *s49lLabelSpec `json:"label,omitempty"`
	Pct      s49lF          `json:"pct,omitempty"`
	Src      string         `json:"src,omitempty"`
	Dst      string         `json:"dst,omitempty"`
	SrcLabel *s49lLabelSpec `json:"srcLabel,omitempty"`
	DstLabel *s49lLabelSpec `json:"dstLabel,omitempty"`
}

type s49lSpec struct {
	Nodes    []s49lNodeSpec    `json:"nodes"`
	Clusters []s49lClusterSpec `json:"clusters,omitempty"`
	Edges    []s49lEdgeSpec    `json:"edges"`
}

type s49lNodeState struct {
	ID       int64 `json:"id"`
	LabelPos int   `json:"labelPos"`
	IconPos  int   `json:"iconPos"`
}

type s49lEdgeState struct {
	ID       int64 `json:"id"`
	LabelPos int   `json:"labelPos"`
	Pct      s49lF `json:"pct"`
}

type s49lScenarioResult struct {
	Name       string          `json:"name"`
	Spec       s49lSpec        `json:"spec"`
	NodesAfter []s49lNodeState `json:"nodesAfter"`
	EdgesAfter []s49lEdgeState `json:"edgesAfter"`
}

type s49lExactWorkResult struct {
	Name            string          `json:"name"`
	Spec            s49lSpec        `json:"spec"`
	W               int64           `json:"w"`
	NodesInitial    []s49lNodeState `json:"nodesInitial"`
	EdgesInitial    []s49lEdgeState `json:"edgesInitial"`
	NodesAfter      []s49lNodeState `json:"nodesAfter"`
	EdgesAfter      []s49lEdgeState `json:"edgesAfter"`
	WMinus1Error    string          `json:"wMinus1Error"`
	WMinus1Used     int64           `json:"wMinus1Used"`
	NodesAfterRoll  []s49lNodeState `json:"nodesAfterRoll"`
	EdgesAfterRoll  []s49lEdgeState `json:"edgesAfterRoll"`
}

type s49lOracle struct {
	MaxWork   int64                `json:"maxWork"`
	Scenarios []s49lScenarioResult `json:"scenarios"`
	ExactWork s49lExactWorkResult  `json:"exactWork"`
}

func s49lLabelOf(spec *s49lLabelSpec) *layoutgraph.Label {
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

func s49lPoints(route [][2]s49lF) []*geo.Point {
	points := make([]*geo.Point, 0, len(route))
	for _, p := range route {
		points = append(points, geo.NewPoint(float64(p[0]), float64(p[1])))
	}
	return points
}

func s49lBuild(spec s49lSpec) (*layoutgraph.Graph, map[int64]*layoutgraph.Node, []*layoutgraph.Edge) {
	g := layoutgraph.NewGraph()
	byID := make(map[int64]*layoutgraph.Node)
	var edges []*layoutgraph.Edge

	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(layoutgraph.EntityID(ns.ID), float64(ns.W), float64(ns.H))
		if ns.Shape != "" {
			n.SetShape(ns.Shape)
		}
		n.TopLeft = geo.NewPoint(float64(ns.X), float64(ns.Y))
		n.Label = s49lLabelOf(ns.Label)
		if ns.Icon != nil {
			n.Icon = &layoutgraph.Icon{Position: label.Position(ns.Icon.Pos)}
			if ns.Icon.Fixed {
				n.Icon.FixPosition()
			}
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
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
		e.Points = s49lPoints(es.Points)
		e.Label = s49lLabelOf(es.Label)
		e.LabelPercentage = float64(es.Pct)
		e.SourceArrowhead = layoutgraph.Arrowhead(es.Src)
		e.TargetArrowhead = layoutgraph.Arrowhead(es.Dst)
		e.SourceArrowheadLabel = s49lLabelOf(es.SrcLabel)
		e.TargetArrowheadLabel = s49lLabelOf(es.DstLabel)
		edges = append(edges, e)
	}

	return g, byID, edges
}

func s49lCaptureState(g *layoutgraph.Graph) ([]s49lNodeState, []s49lEdgeState) {
	var nodeStates []s49lNodeState
	for _, n := range g.Nodes {
		st := s49lNodeState{ID: int64(n.ID), LabelPos: -1, IconPos: -1}
		if n.Label != nil {
			st.LabelPos = int(n.Label.Position)
		}
		if n.Icon != nil {
			st.IconPos = int(n.Icon.Position)
		}
		nodeStates = append(nodeStates, st)
	}

	var edgeStates []s49lEdgeState
	for _, e := range g.Edges {
		st := s49lEdgeState{ID: int64(e.ID), LabelPos: -1, Pct: s49lF(e.LabelPercentage)}
		if e.Label != nil {
			st.LabelPos = int(e.Label.Position)
		}
		edgeStates = append(edgeStates, st)
	}

	return nodeStates, edgeStates
}

func s49lBuildScenarios() []struct {
	Name string
	Spec s49lSpec
} {
	return []struct {
		Name string
		Spec s49lSpec
	}{
		{
			Name: "simple-movable-node-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 100, H: 60, X: 50, Y: 50, Label: &s49lLabelSpec{Text: "A", W: 30, H: 16, Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "node-label-blocked-by-sibling",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 60, H: 60, X: 50, Y: 50, Label: &s49lLabelSpec{Text: "A", W: 30, H: 16, Pos: int(label.Unset)}},
					{ID: 2, W: 60, H: 60, X: 120, Y: 50}, // Blocks right side
				},
			},
		},
		{
			Name: "node-label-blocked-by-edge",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 60, H: 60, X: 50, Y: 50, Label: &s49lLabelSpec{Text: "A", W: 30, H: 16, Pos: int(label.Unset)}},
					{ID: 2, W: 40, H: 40, X: 200, Y: 50},
					{ID: 3, W: 40, H: 40, X: 200, Y: 150},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 2, To: 3,
						Points: [][2]s49lF{{220, 90}, {220, 130}, {80, 130}, {80, 150}},
					},
				},
			},
		},
		{
			Name: "inside-label-fit-rejection",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					// Label is larger than node inner box (40x40 node with 50x30 label)
					{ID: 1, W: 40, H: 40, X: 50, Y: 50, Label: &s49lLabelSpec{Text: "Large", W: 50, H: 30, Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "outside-label-placement",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 50, H: 50, X: 100, Y: 100, Label: &s49lLabelSpec{Text: "Outside", W: 40, H: 20, Pos: int(label.OutsideBottomCenter)}},
				},
			},
		},
		{
			Name: "container-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 200, H: 150, X: 20, Y: 20, Label: &s49lLabelSpec{Text: "Container", W: 60, H: 16, Pos: int(label.Unset)}},
					{ID: 2, W: 40, H: 40, X: 40, Y: 50, Container: 1},
					{ID: 3, W: 40, H: 40, X: 110, Y: 50, Container: 1},
				},
			},
		},
		{
			Name: "shape-specific-diamond",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 80, H: 80, X: 50, Y: 50, Shape: "Diamond", Label: &s49lLabelSpec{Text: "Cond", W: 30, H: 16, Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "shape-specific-circle",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 80, H: 80, X: 50, Y: 50, Shape: "Circle", Label: &s49lLabelSpec{Text: "Round", W: 30, H: 16, Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "shape-specific-hexagon",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 90, H: 60, X: 50, Y: 50, Shape: "Hexagon", Label: &s49lLabelSpec{Text: "Hex", W: 30, H: 16, Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "icon-only",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 80, H: 80, X: 50, Y: 50, Icon: &s49lIconSpec{Pos: int(label.Unset)}},
				},
			},
		},
		{
			Name: "icon-competing-with-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{
						ID: 1, W: 80, H: 80, X: 50, Y: 50,
						Icon:  &s49lIconSpec{Pos: int(label.Unset)},
						Label: &s49lLabelSpec{Text: "Competitor", W: 40, H: 16, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "fixed-icon",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{
						ID: 1, W: 80, H: 80, X: 50, Y: 50,
						Icon:  &s49lIconSpec{Pos: int(label.InsideTopLeft), Fixed: true},
						Label: &s49lLabelSpec{Text: "WithFixedIcon", W: 30, H: 16, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "fixed-node-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{
						ID: 1, W: 80, H: 80, X: 50, Y: 50,
						Label: &s49lLabelSpec{Text: "FixedNode", W: 30, H: 16, Pos: int(label.OutsideTopCenter), Fixed: true},
						Icon:  &s49lIconSpec{Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "fixed-edge-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 20},
					{ID: 2, W: 40, H: 40, X: 150, Y: 20},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49lF{{60, 40}, {150, 40}},
						Label:  &s49lLabelSpec{Text: "FixedEdge", W: 30, H: 14, Pos: int(label.InsideMiddleCenter), Fixed: true},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "loop-edge-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 60, H: 60, X: 50, Y: 50},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 1,
						Points: [][2]s49lF{{110, 60}, {140, 60}, {140, 90}, {110, 90}},
						Label:  &s49lLabelSpec{Text: "Loop", W: 24, H: 12, Pos: int(label.InsideMiddleCenter)},
						Pct:    0.5,
					},
				},
			},
		},
		{
			Name: "arrowhead-labels-reserving-space",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 50},
					{ID: 2, W: 40, H: 40, X: 180, Y: 50},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points:   [][2]s49lF{{60, 70}, {180, 70}},
						Src:      "arrow",
						Dst:      "arrow",
						SrcLabel: &s49lLabelSpec{Text: "1", W: 12, H: 12},
						DstLabel: &s49lLabelSpec{Text: "N", W: 12, H: 12},
						Label:    &s49lLabelSpec{Text: "mid", W: 24, H: 12, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "ordinary-edge-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 50, H: 50, X: 20, Y: 50},
					{ID: 2, W: 50, H: 50, X: 200, Y: 50},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49lF{{70, 75}, {200, 75}},
						Label:  &s49lLabelSpec{Text: "Straight", W: 36, H: 14, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "unlocked-multibend-edge-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 20},
					{ID: 2, W: 40, H: 40, X: 180, Y: 140},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49lF{{60, 40}, {120, 40}, {120, 160}, {180, 160}},
						Label:  &s49lLabelSpec{Text: "Multibend", W: 44, H: 14, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "shared-edge-segment",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 40, H: 40, X: 20, Y: 20},
					{ID: 2, W: 40, H: 40, X: 20, Y: 120},
					{ID: 3, W: 40, H: 40, X: 220, Y: 20},
					{ID: 4, W: 40, H: 40, X: 220, Y: 120},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 3,
						Points: [][2]s49lF{{60, 40}, {100, 40}, {100, 70}, {180, 70}, {180, 40}, {220, 40}},
						Label:  &s49lLabelSpec{Text: "Shared1", W: 36, H: 14, Pos: int(label.Unset)},
					},
					{
						ID: 2, From: 2, To: 4,
						Points: [][2]s49lF{{60, 140}, {100, 140}, {100, 70}, {180, 70}, {180, 140}, {220, 140}},
						Label:  &s49lLabelSpec{Text: "Shared2", W: 36, H: 14, Pos: int(label.Unset)},
					},
				},
			},
		},
		{
			Name: "cluster-edge-label",
			Spec: s49lSpec{
				Nodes: []s49lNodeSpec{
					{ID: 1, W: 40, H: 40, X: 30, Y: 30},
					{ID: 2, W: 40, H: 40, X: 160, Y: 30},
				},
				Clusters: []s49lClusterSpec{
					{Vessel: 99, Members: []int64{2}},
				},
				Edges: []s49lEdgeSpec{
					{
						ID: 1, From: 1, To: 2,
						Points: [][2]s49lF{{70, 50}, {160, 50}},
						Label:  &s49lLabelSpec{Text: "ToCluster", W: 40, H: 14, Pos: int(label.Unset)},
					},
				},
			},
		},
	}
}

func s49lBuildExactWorkSpec() s49lSpec {
	return s49lSpec{
		Nodes: []s49lNodeSpec{
			{ID: 1, W: 240, H: 180, X: 20, Y: 20, Label: &s49lLabelSpec{Text: "Vessel", W: 48, H: 14, Pos: int(label.OutsideTopCenter)}},
			{ID: 2, W: 50, H: 50, X: 40, Y: 50, Container: 1, Label: &s49lLabelSpec{Text: "NodeA", W: 36, H: 12, Pos: int(label.Unset)}, Icon: &s49lIconSpec{Pos: int(label.Unset)}},
			{ID: 3, W: 50, H: 50, X: 140, Y: 50, Container: 1, Label: &s49lLabelSpec{Text: "NodeB", W: 36, H: 12, Pos: int(label.Unset)}},
		},
		Edges: []s49lEdgeSpec{
			{
				ID: 1, From: 2, To: 3,
				Points:   [][2]s49lF{{90, 75}, {140, 75}},
				Src:      "arrow",
				Dst:      "arrow",
				SrcLabel: &s49lLabelSpec{Text: "s", W: 10, H: 10},
				DstLabel: &s49lLabelSpec{Text: "t", W: 10, H: 10},
				Label:    &s49lLabelSpec{Text: "EdgeAB", W: 32, H: 12, Pos: int(label.Unset)},
			},
			{
				ID: 2, From: 2, To: 2,
				Points: [][2]s49lF{{40, 70}, {10, 70}, {10, 90}, {40, 90}},
				Label:  &s49lLabelSpec{Text: "Self", W: 20, H: 10, Pos: int(label.InsideMiddleCenter)},
				Pct:    0.5,
			},
		},
	}
}

func TestSlice49LabelingOracle(t *testing.T) {
	ctx := context.Background()
	oracle := s49lOracle{MaxWork: maxLabelPlacementWorkUnits}

	// 1. Scenarios
	for _, sc := range s49lBuildScenarios() {
		g, _, _ := s49lBuild(sc.Spec)
		if err := Place(ctx, g); err != nil {
			t.Fatalf("Place(%s): %v", sc.Name, err)
		}
		nodesAfter, edgesAfter := s49lCaptureState(g)
		oracle.Scenarios = append(oracle.Scenarios, s49lScenarioResult{
			Name:       sc.Name,
			Spec:       sc.Spec,
			NodesAfter: nodesAfter,
			EdgesAfter: edgesAfter,
		})
	}

	// 2. Exact W/W-1 measurement
	exactSpec := s49lBuildExactWorkSpec()
	gNolimit, _, _ := s49lBuild(exactSpec)
	nodesInitial, edgesInitial := s49lCaptureState(gNolimit)

	// Measure exact W by binary searching minimum successful work limit
	low := int64(1)
	high := int64(100000)
	for low < high {
		mid := (low + high) / 2
		gMid, _, _ := s49lBuild(exactSpec)
		if err := place(ctx, gMid, mid); err != nil {
			low = mid + 1
		} else {
			high = mid
		}
	}
	requiredWork := low

	// Test at exact W
	gExact, _, _ := s49lBuild(exactSpec)
	if err := place(ctx, gExact, requiredWork); err != nil {
		t.Fatalf("place at exact requiredWork %d failed: %v", requiredWork, err)
	}
	nodesAfter, edgesAfter := s49lCaptureState(gExact)

	// Test at W-1
	gShort, _, _ := s49lBuild(exactSpec)
	errShort := place(ctx, gShort, requiredWork-1)
	if errShort == nil || !strings.Contains(errShort.Error(), "TALA PlaceLabels work exceeds limit") {
		t.Fatalf("place at W-1 error = %v, want work exceeds limit", errShort)
	}
	nodesRollback, edgesRollback := s49lCaptureState(gShort)

	oracle.ExactWork = s49lExactWorkResult{
		Name:           "representative-exact-work",
		Spec:           exactSpec,
		W:              requiredWork,
		NodesInitial:   nodesInitial,
		EdgesInitial:   edgesInitial,
		NodesAfter:     nodesAfter,
		EdgesAfter:     edgesAfter,
		WMinus1Error:   errShort.Error(),
		WMinus1Used:    requiredWork,
		NodesAfterRoll: nodesRollback,
		EdgesAfterRoll: edgesRollback,
	}

	encoded, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')

	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice49-labeling-reference.json")
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
		t.Fatalf("go-slice49-labeling-reference.json is stale; regenerate with TALA_SLICE49_ORACLE=1")
	}
}
