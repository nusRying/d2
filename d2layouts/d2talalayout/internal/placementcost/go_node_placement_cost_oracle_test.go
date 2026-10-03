package placementcost

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type PointJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type OracleFixtureData struct {
	LayoutgraphAccessors []AccessorScenarioJSON     `json:"layoutgraphAccessors"`
	Geometry             []GeometryScenarioJSON     `json:"geometry"`
	Compass              []CompassScenarioJSON      `json:"compass"`
	AxisScore            []AxisScoreScenarioJSON    `json:"axisScore"`
	ClusterExternalPair  []ClusterPairScenarioJSON  `json:"clusterExternalPair"`
	ObstructionBounds    []ObstructionScenarioJSON  `json:"obstructionBounds"`
	FlowContinuity       []FlowScenarioJSON         `json:"flowContinuity"`
	Symmetry             []SymmetryScenarioJSON     `json:"symmetry"`
	NodeEdgeLength       []EdgeLengthScenarioJSON   `json:"nodeEdgeLength"`
	NodeEdgeLengthScorer []ScorerScenarioJSON       `json:"nodeEdgeLengthScorer"`
	Cancellation         []CancellationScenarioJSON `json:"cancellation"`
}

type AccessorScenarioJSON struct {
	Name            string      `json:"name"`
	Accessor        string      `json:"accessor"`
	Center          *PointJSON  `json:"center,omitempty"`
	Orientation     int         `json:"orientation,omitempty"`
	OverlapsLine    *bool       `json:"overlapsLine,omitempty"`
	PassesThrough   *bool       `json:"passesThrough,omitempty"`
	Area            *float64    `json:"area,omitempty"`
	OverlapsDim     *bool       `json:"overlapsDim,omitempty"`
	TablePort       *PointJSON  `json:"tablePort,omitempty"`
	HasTablePort    *bool       `json:"hasTablePort,omitempty"`
	FacingFromPort  *PointJSON  `json:"facingFromPort,omitempty"`
	FacingToPort    *PointJSON  `json:"facingToPort,omitempty"`
	HasFacingFrom   *bool       `json:"hasFacingFrom,omitempty"`
	HasFacingTo     *bool       `json:"hasFacingTo,omitempty"`
	FacingOrient    int         `json:"facingOrient,omitempty"`
	HasTableCol     *bool       `json:"hasTableCol,omitempty"`
	BetweenTableCol *bool       `json:"betweenTableCol,omitempty"`
	LargeArrowhead  *bool       `json:"largeArrowhead,omitempty"`
	DirectedFrom    string      `json:"directedFrom,omitempty"`
	DirectedTo      string      `json:"directedTo,omitempty"`
	IsDirected      *bool       `json:"isDirected,omitempty"`
	Panic           string      `json:"panic,omitempty"`
}

type GeometryScenarioJSON struct {
	Name             string   `json:"name"`
	Operation        string   `json:"operation"`
	Value            *float64 `json:"value,omitempty"`
	OrientationValue int      `json:"orientationValue,omitempty"`
	DepthValue       *int     `json:"depthValue,omitempty"`
	Panic            string   `json:"panic,omitempty"`
}

type CompassScenarioJSON struct {
	Name      string `json:"name"`
	Operation string `json:"operation"`
	Arg1      int    `json:"arg1"`
	Arg2      int    `json:"arg2,omitempty"`
	Result    int    `json:"result"`
}

type AxisScoreScenarioJSON struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type ClusterPairScenarioJSON struct {
	Panic bool `json:"panic,omitempty"`
	Name       string `json:"name"`
	FirstID    string `json:"firstId,omitempty"`
	SecondID   string `json:"secondId,omitempty"`
	ExactlyTwo bool   `json:"exactlyTwo"`
}

type ObstructionScenarioJSON struct {
	Name     string   `json:"name"`
	Usable   bool     `json:"usable"`
	Left     float64  `json:"left"`
	Top      float64  `json:"top"`
	Right    float64  `json:"right"`
	Bottom   float64  `json:"bottom"`
	Excludes []string `json:"excludes,omitempty"`
}

type FlowScenarioJSON struct {
	Name string  `json:"name"`
	Cost float64 `json:"cost"`
}

type SymmetryScenarioJSON struct {
	Name         string   `json:"name"`
	Symmetry     *float64 `json:"symmetry,omitempty"`
	CrossingCost *float64 `json:"crossingCost,omitempty"`
	Error        string   `json:"error,omitempty"`
}

type EdgeLengthScenarioJSON struct {
	Name              string  `json:"name"`
	IncludeNodeSizes  bool    `json:"includeNodeSizes"`
	EnforceMinimumGap bool    `json:"enforceMinimumGap"`
	PenalizeDirection bool    `json:"penalizeDirection"`
	HasAbductions     bool    `json:"hasAbductions"`
	Score             float64 `json:"score"`
	Error             string  `json:"error,omitempty"`
}

type ScorerScenarioJSON struct {
	Name              string  `json:"name"`
	IncludeNodeSizes  bool    `json:"includeNodeSizes"`
	EnforceMinimumGap bool    `json:"enforceMinimumGap"`
	PenalizeDirection bool    `json:"penalizeDirection"`
	Score1            float64 `json:"score1"`
	MutatedX          float64 `json:"mutatedX"`
	Score2            float64 `json:"score2"`
	ClosedScoreError  string  `json:"closedScoreError,omitempty"`
}

type CancellationScenarioJSON struct {
	Name          string `json:"name"`
	Target        string `json:"target"`
	CancelAt      int    `json:"cancelAt"`
	ExpectedError string `json:"expectedError"`
	CheckCount    int    `json:"checkCount"`
}

type countingContext struct {
	context.Context
	cancelAt int
	count    int
}

func (c *countingContext) Err() error {
	c.count++
	if c.cancelAt > 0 && c.count >= c.cancelAt {
		return context.Canceled
	}
	return c.Context.Err()
}

func pPoint(x, y float64) *geo.Point {
	return geo.NewPoint(x, y)
}

func toPJ(p *geo.Point) *PointJSON {
	if p == nil {
		return nil
	}
	return &PointJSON{X: p.X, Y: p.Y}
}

func bPtr(b bool) *bool { return &b }
func fPtr(f float64) *float64 { return &f }
func iPtr(i int) *int { return &i }

var nextNodeID layoutgraph.EntityID = 1

func createTestGraph() *layoutgraph.Graph {
	g := layoutgraph.NewGraph()
	g.Clusters = make(map[*layoutgraph.Node]*layoutgraph.Cluster)
	g.Containers = make(map[*layoutgraph.Node][]*layoutgraph.Node)
	g.CellSize = 20.0
	g.ResetTurnCost()
	return g
}

func addTestNode(g *layoutgraph.Graph, x, y, w, h float64) *layoutgraph.Node {
	n := layoutgraph.NewNode(nextNodeID, w, h)
	nextNodeID++
	n.TopLeft = geo.NewPoint(x, y)
	g.AddNodeUnchecked(n)
	return n
}


func capturePanic(fn func()) (panicked bool, value string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			value = fmt.Sprint(r)
		}
	}()
	fn()
	return false, ""
}

func TestGenerateNodePlacementCostOracle(t *testing.T) {
	fixture := OracleFixtureData{}

	// ==========================================
	// 1. Layoutgraph Accessors
	// ==========================================
	// Center
	{
		g := createTestGraph()
		n1 := addTestNode(g, 100, 200, 80, 40)
		c := n1.Center()
		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
			Name: "center_normal", Accessor: "Center", Center: toPJ(c),
		})
	}
	{
		g := createTestGraph()
		n1 := addTestNode(g, -50, -30, 10, 20)
		c := n1.Center()
		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
			Name: "center_negative", Accessor: "Center", Center: toPJ(c),
		})
	}

	// Orientation (all 8 + NONE)
	{
		g := createTestGraph()
		centerNode := addTestNode(g, 100, 100, 100, 100)

		scenarios := []struct {
			name   string
			tl     *geo.Point
			w, h   float64
			expect geo.Orientation
		}{
			{"top_left", pPoint(0, 0), 50, 50, geo.TopLeft},
			{"top", pPoint(120, 0), 50, 50, geo.Top},
			{"top_right", pPoint(250, 0), 50, 50, geo.TopRight},
			{"left", pPoint(0, 120), 50, 50, geo.Left},
			{"right", pPoint(250, 120), 50, 50, geo.Right},
			{"bottom_left", pPoint(0, 250), 50, 50, geo.BottomLeft},
			{"bottom", pPoint(120, 250), 50, 50, geo.Bottom},
			{"bottom_right", pPoint(250, 250), 50, 50, geo.BottomRight},
			{"overlap", pPoint(150, 150), 50, 50, geo.NONE},
			{"unpositioned", nil, 50, 50, geo.NONE},
		}
		for _, s := range scenarios {
			other := layoutgraph.NewNode(nextNodeID, s.w, s.h)
			nextNodeID++
			other.TopLeft = s.tl
			g.AddNodeUnchecked(other)
			o := other.Orientation(centerNode)
			fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
				Name: "orientation_" + s.name, Accessor: "Orientation", Orientation: int(o),
			})
		}
	}

	// OverlapsLine
	{
		g := createTestGraph()
		n := addTestNode(g, 100, 100, 100, 100)

		tests := []struct {
			name  string
			p1    *geo.Point
			p2    *geo.Point
			delta float64
		}{
			{"cross_through", pPoint(50, 150), pPoint(250, 150), 0},
			{"touch_border", pPoint(50, 100), pPoint(80, 100), 0},
			{"outside", pPoint(50, 50), pPoint(80, 50), 0},
			{"endpoint_inside", pPoint(150, 150), pPoint(300, 300), 0},
			{"padded_delta_hit", pPoint(95, 50), pPoint(95, 95), 10},
			{"padded_delta_miss", pPoint(80, 50), pPoint(80, 80), 10},
		}
		for _, tst := range tests {
			res := n.OverlapsLine(tst.p1, tst.p2, tst.delta)
			fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
				Name: "overlaps_line_" + tst.name, Accessor: "OverlapsLine", OverlapsLine: bPtr(res),
			})
		}
	}

	// PassesThrough
	{
		g := createTestGraph()
		n := addTestNode(g, 100, 100, 100, 100)

		tests := []struct {
			name string
			p1   *geo.Point
			p2   *geo.Point
		}{
			{"cross_straight", pPoint(50, 150), pPoint(250, 150)},
			{"cross_diagonal", pPoint(50, 50), pPoint(250, 250)},
			{"miss_above", pPoint(50, 50), pPoint(250, 50)},
			{"touch_corner", pPoint(50, 100), pPoint(100, 50)},
		}
		for _, tst := range tests {
			res := n.PassesThrough(tst.p1, tst.p2)
			fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
				Name: "passes_through_" + tst.name, Accessor: "PassesThrough", PassesThrough: bPtr(res),
			})
		}
	}

	// Area & OverlapsAlongDimension
	{
		g := createTestGraph()
		n1 := addTestNode(g, 10, 20, 40, 60)
		a := n1.Area()
		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
			Name: "area_normal", Accessor: "Area", Area: fPtr(a),
		})

		n2 := addTestNode(g, 30, 50, 50, 50)

		hWithSizes := n1.OverlapsAlongDimension(n2, true, true)
		hWithoutSizes := n1.OverlapsAlongDimension(n2, true, false)
		vWithSizes := n1.OverlapsAlongDimension(n2, false, true)
		vWithoutSizes := n1.OverlapsAlongDimension(n2, false, false)

		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors,
			AccessorScenarioJSON{Name: "overlaps_dim_h_with_sizes", Accessor: "OverlapsAlongDimension", OverlapsDim: bPtr(hWithSizes)},
			AccessorScenarioJSON{Name: "overlaps_dim_h_without_sizes", Accessor: "OverlapsAlongDimension", OverlapsDim: bPtr(hWithoutSizes)},
			AccessorScenarioJSON{Name: "overlaps_dim_v_with_sizes", Accessor: "OverlapsAlongDimension", OverlapsDim: bPtr(vWithSizes)},
			AccessorScenarioJSON{Name: "overlaps_dim_v_without_sizes", Accessor: "OverlapsAlongDimension", OverlapsDim: bPtr(vWithoutSizes)},
		)
	}

	// Table column ports on Edge
	{
		g := createTestGraph()
		table1 := addTestNode(g, 100, 100, 120, 200)
		table1.SetShape("Table")
		table1.SetNumColumns(4)

		table2 := addTestNode(g, 400, 100, 120, 200)
		table2.SetShape("Table")
		table2.SetNumColumns(4)

		e := g.Connect(table1, table2)
		col0 := 0
		col2 := 2
		e.FromTableColumnIndex = &col0
		e.ToTableColumnIndex = &col2

		fp, tp, hasF, hasT, orient := e.FacingTablePortValues(nil, nil)
		hasCol := e.HasTableColumn()
		betweenCol := e.IsBetweenTableColumns()

		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
			Name:            "edge_table_columns_facing_ports",
			Accessor:        "FacingTablePortValues",
			FacingFromPort:  toPJ(&fp),
			FacingToPort:    toPJ(&tp),
			HasFacingFrom:   bPtr(hasF),
			HasFacingTo:     bPtr(hasT),
			FacingOrient:    int(orient),
			HasTableCol:     bPtr(hasCol),
			BetweenTableCol: bPtr(betweenCol),
		})

		// Directed endpoints & large arrowhead
		e.SourceArrowhead = "arrow"
		from, to, directed := e.DirectedEndpoints()
		largeArrow := e.HasLargeArrowheadLabel()
		fixture.LayoutgraphAccessors = append(fixture.LayoutgraphAccessors, AccessorScenarioJSON{
			Name:           "edge_directed_endpoints_source_arrow",
			Accessor:       "DirectedEndpoints",
			DirectedFrom:   fmt.Sprintf("%d", from.ID),
			DirectedTo:     fmt.Sprintf("%d", to.ID),
			IsDirected:     bPtr(directed),
			LargeArrowhead: bPtr(largeArrow),
		})
	}

	// ==========================================
	// 2. Compass Helpers
	// ==========================================
	directions := []geo.Orientation{
		geo.BottomLeft, geo.Left, geo.TopLeft, geo.Top,
		geo.TopRight, geo.Right, geo.BottomRight, geo.Bottom, geo.NONE,
	}
	for _, d := range directions {
		r := directionCompass(d)
		fixture.Compass = append(fixture.Compass, CompassScenarioJSON{
			Name: "direction_compass_" + fmt.Sprintf("%d", d), Operation: "directionCompass", Arg1: int(d), Result: int(r),
		})
	}
	readings := []compassReading{-3, -2, -1, 0, 1, 2, 3, 4}
	for _, r1 := range readings {
		for _, r2 := range readings {
			cd := compassDelta(r1, r2)
			cad := compassAxisDelta(r1, r2)
			fixture.Compass = append(fixture.Compass,
				CompassScenarioJSON{Name: fmt.Sprintf("compass_delta_%d_%d", r1, r2), Operation: "compassDelta", Arg1: int(r1), Arg2: int(r2), Result: int(cd)},
				CompassScenarioJSON{Name: fmt.Sprintf("compass_axis_delta_%d_%d", r1, r2), Operation: "compassAxisDelta", Arg1: int(r1), Arg2: int(r2), Result: int(cad)},
			)
		}
	}

	// ==========================================
	// 3. Geometry Helpers
	// ==========================================
	{
		g := createTestGraph()
		n1 := addTestNode(g, 100, 100, 60, 40)
		n2 := addTestNode(g, 250, 180, 80, 50)

		pDistNoSizes := placementDistance(n1, n2, false)
		pDistWithSizes := placementDistance(n1, n2, true)
		distPtNoSizes := distanceToPoint(n1, pPoint(200, 150), false)
		distPtWithSizes := distanceToPoint(n1, pPoint(200, 150), true)
		sizelessOrient := sizelessOrientation(n1, n2)

		fixture.Geometry = append(fixture.Geometry,
			GeometryScenarioJSON{Name: "placement_distance_no_sizes", Operation: "placementDistance", Value: fPtr(pDistNoSizes)},
			GeometryScenarioJSON{Name: "placement_distance_with_sizes", Operation: "placementDistance", Value: fPtr(pDistWithSizes)},
			GeometryScenarioJSON{Name: "distance_to_point_no_sizes", Operation: "distanceToPoint", Value: fPtr(distPtNoSizes)},
			GeometryScenarioJSON{Name: "distance_to_point_with_sizes", Operation: "distanceToPoint", Value: fPtr(distPtWithSizes)},
			GeometryScenarioJSON{Name: "sizeless_orientation", Operation: "sizelessOrientation", OrientationValue: int(sizelessOrient)},
		)

		// Depth
		c1 := addTestNode(g, 0, 0, 10, 10)
		c1.SetContainer(true)
		c2 := addTestNode(g, 0, 0, 10, 10)
		c2.SetContainer(true)
		c2.Container = c1
		child := addTestNode(g, 0, 0, 10, 10)
		child.Container = c2

		dNil := depth(nil)
		dRoot := depth(c1)
		dNested := depth(child)

		fixture.Geometry = append(fixture.Geometry,
			GeometryScenarioJSON{Name: "depth_nil", Operation: "depth", DepthValue: iPtr(dNil)},
			GeometryScenarioJSON{Name: "depth_root", Operation: "depth", DepthValue: iPtr(dRoot)},
			GeometryScenarioJSON{Name: "depth_nested", Operation: "depth", DepthValue: iPtr(dNested)},
		)

		// Malformed cases
		p, _ := capturePanic(func() { n1.Orientation(nil) })
		fixture.Geometry = append(fixture.Geometry, GeometryScenarioJSON{Name: "node_orientation_nil", Panic: fmt.Sprintf("%t", p)})

		p, _ = capturePanic(func() {
			n1.Graph = nil
			n1.ContainerDirection()
		})
		n1.Graph = g
		fixture.Geometry = append(fixture.Geometry, GeometryScenarioJSON{Name: "node_container_direction_nil_graph", Panic: fmt.Sprintf("%t", p)})

		p, _ = capturePanic(func() { n1.NearestSharedAncestor(nil) })
		fixture.Geometry = append(fixture.Geometry, GeometryScenarioJSON{Name: "node_nearest_shared_ancestor_nil", Panic: fmt.Sprintf("%t", p)})

		p, _ = capturePanic(func() { sizelessOrientation(nil, n2) })
		fixture.Geometry = append(fixture.Geometry, GeometryScenarioJSON{Name: "sizeless_orientation_nil_valid", Panic: fmt.Sprintf("%t", p)})

		p, _ = capturePanic(func() { sizelessOrientation(n1, nil) })
		fixture.Geometry = append(fixture.Geometry, GeometryScenarioJSON{Name: "sizeless_orientation_valid_nil", Panic: fmt.Sprintf("%t", p)})
	}

	// ==========================================
	// 4. AxisScore
	// ==========================================
	{
		g := createTestGraph()
		// 0 nodes
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "zero_nodes", Score: AxisScore(nil)})

		// 1 node
		n1 := addTestNode(g, 0, 0, 100, 50)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "one_node", Score: AxisScore(layoutgraph.Nodes{n1})})

		// 2 nodes horizontal
		n2 := addTestNode(g, 200, 0, 100, 50)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "two_horizontal", Score: AxisScore(layoutgraph.Nodes{n1, n2})})

		// 2 nodes vertical
		n3 := addTestNode(g, 0, 200, 100, 50)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "two_vertical", Score: AxisScore(layoutgraph.Nodes{n1, n3})})

		// 2 nodes diagonal
		n4 := addTestNode(g, 200, 200, 100, 50)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "two_diagonal", Score: AxisScore(layoutgraph.Nodes{n1, n4})})

		// 3 nodes perfect vertical alignment (side-by-side horizontally)
		na := addTestNode(g, 0, 100, 80, 100)
		nb := addTestNode(g, 120, 100, 80, 100)
		nc := addTestNode(g, 240, 100, 80, 100)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "three_perfect_vertical_aligned", Score: AxisScore(layoutgraph.Nodes{na, nb, nc})})

		// 3 nodes ties on largest size (first in source order selected)
		nTie1 := addTestNode(g, 0, 0, 100, 100)
		nTie2 := addTestNode(g, 150, 10, 100, 100)
		nTie3 := addTestNode(g, 300, 20, 80, 80)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "ties_largest_size", Score: AxisScore(layoutgraph.Nodes{nTie1, nTie2, nTie3})})

		// small node multipliers (<0.25 and <0.75)
		ns1 := addTestNode(g, 0, 100, 100, 200) // largest height
		ns2 := addTestNode(g, 150, 100, 50, 40) // height < 0.25*200 (40 < 50)
		ns3 := addTestNode(g, 300, 100, 50, 120) // height < 0.75*200 (120 < 150)
		fixture.AxisScore = append(fixture.AxisScore, AxisScoreScenarioJSON{Name: "small_node_multipliers", Score: AxisScore(layoutgraph.Nodes{ns1, ns2, ns3})})
	}

	// ==========================================
	// 5. Cluster Exactly Two External Connected Nodes
	// ==========================================
	{
		g := createTestGraph()
		cn1 := addTestNode(g, 100, 100, 50, 50)
		cn2 := addTestNode(g, 200, 100, 50, 50)

		cl := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1, cn2},
		}
		cn1.Cluster = cl
		cn2.Cluster = cl

		// 0 external
		f, s, exact := clusterExactlyTwoExternalConnectedNodes(cl)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "zero_external", ExactlyTwo: exact,
		})

		// 1 external
		ext1 := addTestNode(g, 50, 100, 40, 40)
		cl.EdgeAbductions = append(cl.EdgeAbductions, &layoutgraph.EdgeAbduction{
			CurrentFrom: ext1, CurrentTo: cn1, OriginallyFrom: nil, OriginallyTo: cn1,
		})
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(cl)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "one_external", FirstID: fmt.Sprintf("%d", f.ID), ExactlyTwo: exact,
		})

		// 2 external
		ext2 := addTestNode(g, 300, 100, 40, 40)
		cl.EdgeAbductions = append(cl.EdgeAbductions, &layoutgraph.EdgeAbduction{
			CurrentFrom: cn2, CurrentTo: ext2, OriginallyFrom: cn2, OriginallyTo: nil,
		})
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(cl)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "two_external", FirstID: fmt.Sprintf("%d", f.ID), SecondID: fmt.Sprintf("%d", s.ID), ExactlyTwo: exact,
		})

		// 3 external (makes exactlyTwo false)
		ext3 := addTestNode(g, 400, 100, 40, 40)
		cl.EdgeAbductions = append(cl.EdgeAbductions, &layoutgraph.EdgeAbduction{
			CurrentFrom: cn2, CurrentTo: ext3, OriginallyFrom: cn2, OriginallyTo: nil,
		})
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(cl)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "three_external", FirstID: fmt.Sprintf("%d", f.ID), SecondID: fmt.Sprintf("%d", s.ID), ExactlyTwo: exact,
		})

		// --- SLICE 41 CLUSTER PANIC & MALFORMED CASES ---
		p, _ := capturePanic(func() { clusterExactlyTwoExternalConnectedNodes(nil) })
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "nil_cluster", Panic: p})

		p, _ = capturePanic(func() { clusterExactlyTwoExternalConnectedNodes(&layoutgraph.Cluster{Nodes: layoutgraph.Nodes{}}) })
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "empty_nodes", Panic: p})

		p, _ = capturePanic(func() { clusterExactlyTwoExternalConnectedNodes(&layoutgraph.Cluster{Nodes: layoutgraph.Nodes{nil}}) })
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "nil_first_node", Panic: p})

		p, _ = capturePanic(func() {
			clusterExactlyTwoExternalConnectedNodes(&layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{nil}})
		})
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "nil_edge_abduction", Panic: p})

		p, _ = capturePanic(func() {
			clusterExactlyTwoExternalConnectedNodes(&layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyTo: cn1, CurrentFrom: nil}}})
		})
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "case_a_nil_current_from", Panic: p})

		p, _ = capturePanic(func() {
			clusterExactlyTwoExternalConnectedNodes(&layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyFrom: cn1, CurrentTo: nil}}})
		})
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "case_b_nil_current_to", Panic: p})

		// Non-panic cases
		clNilAbductions := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: nil}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clNilAbductions)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "nil_edge_abductions", ExactlyTwo: exact})

		clBothNil := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyFrom: nil, OriginallyTo: nil, CurrentFrom: ext1, CurrentTo: cn2}}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clBothNil)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "both_originals_nil", ExactlyTwo: exact})

		clBothNonNil := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyFrom: cn1, OriginallyTo: cn2, CurrentFrom: ext1, CurrentTo: cn2}}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clBothNonNil)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "both_originals_nonnil", ExactlyTwo: exact})

		unpos := addTestNode(g, 0, 0, 0, 0)
		unpos.TopLeft = nil
		clUnpos := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyTo: cn1, CurrentFrom: unpos}}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clUnpos)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "unpositioned_candidate", ExactlyTwo: exact})

		g2 := createTestGraph()
		wrong := addTestNode(g2, 10, 10, 10, 10)
		clWrongGraph := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyTo: cn1, CurrentFrom: wrong}}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clWrongGraph)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "wrong_graph_candidate", ExactlyTwo: exact})

		dup1 := addTestNode(g, 50, 50, 10, 10)
		dup2 := addTestNode(g, 60, 60, 10, 10)
		dup1.ID = 999
		dup2.ID = 999
		clDistinctSameId := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{
			{OriginallyTo: cn1, CurrentFrom: dup1},
			{OriginallyTo: cn1, CurrentFrom: dup2},
		}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clDistinctSameId)
		fID, sID := "", ""
		if f != nil { fID = fmt.Sprintf("%d", f.ID) }
		if s != nil { sID = fmt.Sprintf("%d", s.ID) }
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "distinct_same_id", FirstID: fID, SecondID: sID, ExactlyTwo: exact})

		clDuplicate := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{
			{OriginallyTo: cn1, CurrentFrom: ext1},
			{OriginallyTo: cn1, CurrentFrom: ext1},
		}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clDuplicate)
		fID = ""
		if f != nil { fID = fmt.Sprintf("%d", f.ID) }
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "duplicate_external_identity", FirstID: fID, ExactlyTwo: exact})

		clFirstSeen := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{
			{OriginallyTo: cn1, CurrentFrom: ext2},
			{OriginallyTo: cn1, CurrentFrom: ext1},
		}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clFirstSeen)
		fID, sID = "", ""
		if f != nil { fID = fmt.Sprintf("%d", f.ID) }
		if s != nil { sID = fmt.Sprintf("%d", s.ID) }
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "first_seen_order", FirstID: fID, SecondID: sID, ExactlyTwo: exact})

		ext4 := addTestNode(g, 100, 100, 10, 10)
		ext5 := addTestNode(g, 100, 100, 10, 10)
		clThirdDistinct := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{
			{OriginallyTo: cn1, CurrentFrom: ext1},
			{OriginallyTo: cn1, CurrentFrom: ext2},
			{OriginallyTo: cn1, CurrentFrom: ext4},
			{OriginallyTo: cn1, CurrentFrom: ext5},
		}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clThirdDistinct)
		fID, sID = "", ""
		if f != nil { fID = fmt.Sprintf("%d", f.ID) }
		if s != nil { sID = fmt.Sprintf("%d", s.ID) }
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{Name: "third_distinct_external", FirstID: fID, SecondID: sID, ExactlyTwo: exact})
	}

	// ==========================================
	// 6. Obstruction Bounds
	// ==========================================
	{
		g := createTestGraph()
		n1 := addTestNode(g, 50, 60, 100, 80)

		b1 := scoringNodeBounds(n1)
		fixture.ObstructionBounds = append(fixture.ObstructionBounds, ObstructionScenarioJSON{
			Name: "scoring_bounds_normal", Usable: b1.usable, Left: b1.left, Top: b1.top, Right: b1.right, Bottom: b1.bottom,
		})

		n2 := addTestNode(g, 200, 150, 50, 40)
		b2 := scoringNodeBounds(n2)
		bCombined := b1.including(b2)

		fixture.ObstructionBounds = append(fixture.ObstructionBounds, ObstructionScenarioJSON{
			Name: "including_bounds", Usable: bCombined.usable, Left: bCombined.left, Top: bCombined.top, Right: bCombined.right, Bottom: bCombined.bottom,
		})

		// Excludes check
		nInside := addTestNode(g, 100, 100, 20, 20)
		nOutside := addTestNode(g, 500, 500, 20, 20)

		fixture.ObstructionBounds = append(fixture.ObstructionBounds, ObstructionScenarioJSON{
			Name:     "excludes_check",
			Usable:   bCombined.usable,
			Left:     bCombined.left,
			Top:      bCombined.top,
			Right:    bCombined.right,
			Bottom:   bCombined.bottom,
			Excludes: []string{fmt.Sprintf("%t", bCombined.excludes(nInside)), fmt.Sprintf("%t", bCombined.excludes(nOutside))},
		})
	}

	// ==========================================
	// 7. Flow Continuity
	// ==========================================
	{
		g := createTestGraph()
		n0 := addTestNode(g, 100, 100, 40, 40)
		s := &edgeScratch{}
		c0 := flowContinuityCost(n0, s)
		fixture.FlowContinuity = append(fixture.FlowContinuity, FlowScenarioJSON{Name: "degree_zero", Cost: c0})

		// Degree 2 straight flow (in from left, out to right)
		nStraight := addTestNode(g, 100, 100, 40, 40)
		leftNode := addTestNode(g, 20, 100, 40, 40)
		rightNode := addTestNode(g, 180, 100, 40, 40)

		eIn := g.Connect(leftNode, nStraight)
		eIn.TargetArrowhead = "arrow"
		eOut := g.Connect(nStraight, rightNode)
		eOut.TargetArrowhead = "arrow"

		sStraight := &edgeScratch{
			nRepl: []*layoutgraph.Node{nStraight, nStraight},
			aRepl: []*layoutgraph.Node{leftNode, rightNode},
		}
		cStraight := flowContinuityCost(nStraight, sStraight)
		fixture.FlowContinuity = append(fixture.FlowContinuity, FlowScenarioJSON{Name: "straight_flow", Cost: cStraight})

		// Degree 2 90-degree turn
		bottomNode := addTestNode(g, 100, 180, 40, 40)
		nTurn := addTestNode(g, 100, 100, 40, 40)

		eIn2 := g.Connect(leftNode, nTurn)
		eIn2.TargetArrowhead = "arrow"
		eOut2 := g.Connect(nTurn, bottomNode)
		eOut2.TargetArrowhead = "arrow"

		sTurn := &edgeScratch{
			nRepl: []*layoutgraph.Node{nTurn, nTurn},
			aRepl: []*layoutgraph.Node{leftNode, bottomNode},
		}
		cTurn := flowContinuityCost(nTurn, sTurn)
		fixture.FlowContinuity = append(fixture.FlowContinuity, FlowScenarioJSON{Name: "turn_flow", Cost: cTurn})

		// Reciprocal pair has both roles
		nRecip := addTestNode(g, 100, 100, 40, 40)
		eFwd := g.Connect(nRecip, rightNode)
		eFwd.TargetArrowhead = "arrow"
		eBack := g.Connect(rightNode, nRecip)
		eBack.TargetArrowhead = "arrow"

		sRecip := &edgeScratch{
			nRepl: []*layoutgraph.Node{nRecip, nRecip},
			aRepl: []*layoutgraph.Node{rightNode, rightNode},
		}
		cRecip := flowContinuityCost(nRecip, sRecip)
		fixture.FlowContinuity = append(fixture.FlowContinuity, FlowScenarioJSON{Name: "reciprocal_pair", Cost: cRecip})
	}

	// ==========================================
	// 8. Symmetry Scoring
	// ==========================================
	{
		g := createTestGraph()
		center := addTestNode(g, 200, 200, 60, 60)
		left := addTestNode(g, 80, 200, 60, 60)
		right := addTestNode(g, 320, 200, 60, 60)

		g.Connect(center, left)
		g.Connect(center, right)

		ctx := context.Background()
		symm, err := NodeSymmetry(ctx, center, nil)
		if err != nil {
			t.Fatal(err)
		}
		fixture.Symmetry = append(fixture.Symmetry, SymmetryScenarioJSON{
			Name: "perfect_pair_symmetry", Symmetry: fPtr(symm),
		})

		// Single neighbor (asymmetric)
		g2 := createTestGraph()
		cSingle := addTestNode(g2, 200, 200, 60, 60)
		lSingle := addTestNode(g2, 80, 200, 60, 60)
		g2.Connect(cSingle, lSingle)

		symmSingle, _ := NodeSymmetry(ctx, cSingle, nil)
		fixture.Symmetry = append(fixture.Symmetry, SymmetryScenarioJSON{
			Name: "single_neighbor_symmetry", Symmetry: fPtr(symmSingle),
		})

		// ColumnCrossingCost
		g3 := createTestGraph()
		t1 := addTestNode(g3, 100, 100, 100, 150)
		t1.SetShape("Table")
		t1.SetNumColumns(4)
		t2 := addTestNode(g3, 300, 100, 100, 150)
		t2.SetShape("Table")
		t2.SetNumColumns(4)

		eCross1 := g3.Connect(t1, t2)
		c0 := 0
		c2 := 2
		eCross1.FromTableColumnIndex = &c0
		eCross1.ToTableColumnIndex = &c2

		eCross2 := g3.Connect(t1, t2)
		c1 := 1
		c0to := 0
		eCross2.FromTableColumnIndex = &c1
		eCross2.ToTableColumnIndex = &c0to

		crossCost, _ := ColumnCrossingCost(ctx, t1, nil)
		fixture.Symmetry = append(fixture.Symmetry, SymmetryScenarioJSON{
			Name: "table_column_crossing_cost", CrossingCost: fPtr(crossCost),
		})
	}

	// ==========================================
	// 9. NodeEdgeLength (with Option Matrix)
	// ==========================================
	{
		g := createTestGraph()
		src := addTestNode(g, 100, 100, 80, 50)
		tgt := addTestNode(g, 300, 100, 80, 50)

		e := g.Connect(src, tgt)
		e.TargetArrowhead = "arrow"

		ctx := context.Background()

		optionsMatrix := []struct {
			name  string
			sizes bool
			gap   bool
			dir   bool
		}{
			{"sizeless_default", false, false, false},
			{"sizeless_dir", false, false, true},
			{"sized_default", true, false, false},
			{"sized_gap", true, true, false},
			{"sized_dir", true, false, true},
			{"sized_gap_dir", true, true, true},
		}

		for _, opt := range optionsMatrix {
			opts := EdgeLengthOptions{
				IncludeNodeSizes:  opt.sizes,
				EnforceMinimumGap: opt.gap,
				PenalizeDirection: opt.dir,
			}
			score, err := NodeEdgeLength(ctx, src, opts)
			if err != nil {
				t.Fatal(err)
			}
			fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{
				Name:              "horizontal_edge_" + opt.name,
				IncludeNodeSizes:  opt.sizes,
				EnforceMinimumGap: opt.gap,
				PenalizeDirection: opt.dir,
				Score:             score,
			})
		}

		// Parallel edges (counted individually, not deduped)
		gParallel := createTestGraph()
		pSrc := addTestNode(gParallel, 100, 100, 60, 40)
		pTgt := addTestNode(gParallel, 250, 100, 60, 40)

		gParallel.Connect(pSrc, pTgt)
		gParallel.Connect(pSrc, pTgt)
		gParallel.Connect(pSrc, pTgt)

		pScore, _ := NodeEdgeLength(ctx, pSrc, EdgeLengthOptions{IncludeNodeSizes: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{
			Name:             "three_parallel_edges",
			IncludeNodeSizes: true,
			Score:            pScore,
		})

		// 127 parallel edges
		g127 := createTestGraph()
		n127_1 := addTestNode(g127, 100, 100, 60, 40)
		n127_2 := addTestNode(g127, 250, 100, 60, 40)
		for i := 0; i < 127; i++ {
			g127.Connect(n127_1, n127_2)
		}
		s127, _ := NodeEdgeLength(ctx, n127_1, EdgeLengthOptions{IncludeNodeSizes: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "parallel_127", Score: s127})

		// 128 parallel edges
		g127.Connect(n127_1, n127_2)
		s128, _ := NodeEdgeLength(ctx, n127_1, EdgeLengthOptions{IncludeNodeSizes: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "parallel_128", Score: s128})

		// 129 parallel edges
		g127.Connect(n127_1, n127_2)
		s129, _ := NodeEdgeLength(ctx, n127_1, EdgeLengthOptions{IncludeNodeSizes: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "parallel_129", Score: s129})

		// Minimum Gap Observable
		gMinGap := createTestGraph()
		mg1 := addTestNode(gMinGap, 100, 100, 50, 50)
		mg2 := addTestNode(gMinGap, 110, 100, 50, 50)
		gMinGap.Connect(mg1, mg2)
		sMinGapF, _ := NodeEdgeLength(ctx, mg1, EdgeLengthOptions{IncludeNodeSizes: true, EnforceMinimumGap: false})
		sMinGapT, _ := NodeEdgeLength(ctx, mg1, EdgeLengthOptions{IncludeNodeSizes: true, EnforceMinimumGap: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "min_gap_false", Score: sMinGapF})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "min_gap_true", Score: sMinGapT})

		// Source Abduction
		gSrcAbd := createTestGraph()
		sa1 := addTestNode(gSrcAbd, 100, 100, 50, 50)
		sa2 := addTestNode(gSrcAbd, 300, 100, 50, 50)
		gSrcAbd.Connect(sa1, sa2)
		saExt := addTestNode(gSrcAbd, 0, 0, 50, 50)
		clSrcAbd := &layoutgraph.Cluster{Graph: gSrcAbd, Nodes: layoutgraph.Nodes{sa1}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyFrom: sa1, OriginallyTo: sa2, CurrentFrom: saExt, CurrentTo: sa2}}}
		sSrcAbd, _ := NodeEdgeLength(ctx, sa1, EdgeLengthOptions{IncludeNodeSizes: true, EdgeAbductions: clSrcAbd.EdgeAbductions})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "source_abduction", Score: sSrcAbd})

		// Target Abduction
		gTgtAbd := createTestGraph()
		ta1 := addTestNode(gTgtAbd, 100, 100, 50, 50)
		ta2 := addTestNode(gTgtAbd, 300, 100, 50, 50)
		gTgtAbd.Connect(ta1, ta2)
		taExt := addTestNode(gTgtAbd, 400, 400, 50, 50)
		clTgtAbd := &layoutgraph.Cluster{Graph: gTgtAbd, Nodes: layoutgraph.Nodes{ta2}, EdgeAbductions: []*layoutgraph.EdgeAbduction{{OriginallyFrom: ta1, OriginallyTo: ta2, CurrentFrom: ta1, CurrentTo: taExt}}}
		sTgtAbd, _ := NodeEdgeLength(ctx, ta1, EdgeLengthOptions{IncludeNodeSizes: true, EdgeAbductions: clTgtAbd.EdgeAbductions})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "target_abduction", Score: sTgtAbd})

		// Label Contribution
		gLabel := createTestGraph()
		l1 := addTestNode(gLabel, 100, 100, 50, 50)
		l2 := addTestNode(gLabel, 300, 100, 50, 50)
		lEdge := gLabel.Connect(l1, l2)
		lEdge.Label = &layoutgraph.Label{Text: "a very very very long main label", Width: 200, Height: 20}
		sLabel, _ := NodeEdgeLength(ctx, l1, EdgeLengthOptions{IncludeNodeSizes: true})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{Name: "label_contribution", Score: sLabel})

		// CommonUncleSiblings contribution
		gUncle := createTestGraph()
		u1 := addTestNode(gUncle, 100, 100, 50, 50)
		u2 := addTestNode(gUncle, 200, 200, 50, 50) // diagonal -> axisScore 0
		gUncle.CommonUncleSiblings = map[*layoutgraph.Node]layoutgraph.Nodes{
			u1: {u1, u2},
		}
		uScore, _ := NodeEdgeLength(ctx, u1, EdgeLengthOptions{IncludeNodeSizes: false})
		fixture.NodeEdgeLength = append(fixture.NodeEdgeLength, EdgeLengthScenarioJSON{
			Name:  "common_uncle_siblings_axis_penalty",
			Score: uScore,
		})
	}

	// ==========================================
	// 10. NodeEdgeLengthScorer & Live Geometry
	// ==========================================
	{
		g := createTestGraph()
		src := addTestNode(g, 100, 100, 60, 40)
		tgt := addTestNode(g, 250, 100, 60, 40)
		g.Connect(src, tgt)

		ctx := context.Background()
		opts := EdgeLengthOptions{IncludeNodeSizes: true, PenalizeDirection: true}

		scorer := NewNodeEdgeLengthScorer(src, opts)
		s1, err := scorer.Score(ctx)
		if err != nil {
			t.Fatal(err)
		}

		// Mutate live geometry
		tgt.TopLeft.X = 350
		s2, err := scorer.Score(ctx)
		if err != nil {
			t.Fatal(err)
		}

		scorer.Close()
		var closedErr string
		_, errClosed := scorer.Score(ctx)
		if errClosed != nil {
			closedErr = errClosed.Error()
		}

		fixture.NodeEdgeLengthScorer = append(fixture.NodeEdgeLengthScorer, ScorerScenarioJSON{
			Name:              "live_geometry_mutation",
			IncludeNodeSizes:  true,
			PenalizeDirection: true,
			Score1:            s1,
			MutatedX:          350,
			Score2:            s2,
			ClosedScoreError:  closedErr,
		})
	}

	// ==========================================
	// 11. Cancellation Checks
	// ==========================================
	{
		g := createTestGraph()
		src := addTestNode(g, 100, 100, 60, 40)
		tgt := addTestNode(g, 200, 100, 60, 40)
		g.Connect(src, tgt)

		// Immediate cancellation
		canceledCtx, cancel := context.WithCancel(context.Background())
		cancel()

		_, err := NodeEdgeLength(canceledCtx, src, EdgeLengthOptions{})
		var errMsg string
		if err != nil {
			errMsg = err.Error()
		}
		fixture.Cancellation = append(fixture.Cancellation, CancellationScenarioJSON{
			Name:          "immediate_entry_cancellation",
			Target:        "NodeEdgeLength",
			ExpectedError: errMsg,
		})

		// Counting cancellation during preparation
		counting := &countingContext{Context: context.Background(), cancelAt: 2}
		_, errCount := NodeEdgeLength(counting, src, EdgeLengthOptions{IncludeNodeSizes: true})
		var countErr string
		if errCount != nil {
			countErr = errCount.Error()
		}
		fixture.Cancellation = append(fixture.Cancellation, CancellationScenarioJSON{
			Name:          "counting_context_cancellation",
			Target:        "NodeEdgeLength",
			CancelAt:      2,
			ExpectedError: countErr,
			CheckCount:    counting.count,
		})
	}

	// Write fixture to file
	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join("..", "..", "js", "test", "fixtures", "go-node-placement-cost-reference.json")
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("Wrote %d bytes to %s", len(data), outPath)
}
