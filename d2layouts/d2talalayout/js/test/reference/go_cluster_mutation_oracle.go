//go:build ignore

//go:build tala_cluster_mutation_oracle

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"slices"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

type PointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NodeDTO struct {
	ID        string    `json:"id"`
	Width     float64   `json:"width"`
	Height    float64   `json:"height"`
	TopLeft   *PointDTO `json:"topLeft"`
	Container *string   `json:"container"`
	Cluster   bool      `json:"cluster"`
	InGraph   bool      `json:"inGraph"`
	Edges     []string  `json:"edges"`
}

type EdgeDTO struct {
	ID     string     `json:"id"`
	From   string     `json:"from"`
	To     string     `json:"to"`
	Points []PointDTO `json:"points"`
}

type AbductionDTO struct {
	EdgeID         string  `json:"edgeID"`
	OriginallyFrom *string `json:"originallyFrom"`
	OriginallyTo   *string `json:"originallyTo"`
	CurrentFrom    *string `json:"currentFrom"`
	CurrentTo      *string `json:"currentTo"`
}

type VesselDTO struct {
	ID              string    `json:"id"`
	Width           float64   `json:"width"`
	Height          float64   `json:"height"`
	TopLeft         *PointDTO `json:"topLeft"`
	IsClusterVessel bool      `json:"isClusterVessel"`
	Container       *string   `json:"container"`
	HasGraph        bool      `json:"hasGraph"`
	Edges           []string  `json:"edges"`
}

func idPtr(n *layoutgraph.Node) *string {
	if n == nil {
		return nil
	}
	s := fmt.Sprintf("%d", n.ID)
	return &s
}

func pointToDTO(p *geo.Point) *PointDTO {
	if p == nil {
		return nil
	}
	return &PointDTO{X: p.X, Y: p.Y}
}

func nodeToDTO(n *layoutgraph.Node, g *layoutgraph.Graph) NodeDTO {
	var edges []string
	for _, e := range n.Edges {
		edges = append(edges, fmt.Sprintf("%d", e.ID))
	}
	inGraph := false
	if g != nil {
		inGraph = slices.Contains(g.Nodes, n)
	}
	return NodeDTO{
		ID:        fmt.Sprintf("%d", n.ID),
		Width:     n.Width,
		Height:    n.Height,
		TopLeft:   pointToDTO(n.TopLeft),
		Container: idPtr(n.Container),
		Cluster:   n.Cluster != nil,
		InGraph:   inGraph,
		Edges:     edges,
	}
}

func vesselToDTO(v *layoutgraph.Node) VesselDTO {
	if v == nil {
		return VesselDTO{}
	}
	var edges []string
	for _, e := range v.Edges {
		edges = append(edges, fmt.Sprintf("%d", e.ID))
	}
	return VesselDTO{
		ID:              fmt.Sprintf("%d", v.ID),
		Width:           v.Width,
		Height:          v.Height,
		TopLeft:         pointToDTO(v.TopLeft),
		IsClusterVessel: v.IsClusterVessel(),
		Container:       idPtr(v.Container),
		HasGraph:        v.Graph != nil,
		Edges:           edges,
	}
}

func abductionsToDTO(abductions []*layoutgraph.EdgeAbduction) []AbductionDTO {
	result := make([]AbductionDTO, 0, len(abductions))
	for _, a := range abductions {
		result = append(result, AbductionDTO{
			EdgeID:         fmt.Sprintf("%d", a.Edge.ID),
			OriginallyFrom: idPtr(a.OriginallyFrom),
			OriginallyTo:   idPtr(a.OriginallyTo),
			CurrentFrom:    idPtr(a.CurrentFrom),
			CurrentTo:      idPtr(a.CurrentTo),
		})
	}
	return result
}

func connectWithID(g *layoutgraph.Graph, id layoutgraph.EntityID, from, to *layoutgraph.Node) *layoutgraph.Edge {
	e := g.Connect(from, to)
	e.ID = id
	return e
}

func fileSHA256(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func classifyFloat(v float64) string {
	if math.IsNaN(v) {
		return "nan"
	}
	if math.IsInf(v, 1) {
		return "positive_inf"
	}
	if math.IsInf(v, -1) {
		return "negative_inf"
	}
	return "finite"
}

func makeLargeTieScenario(arrangement layoutgraph.ClusterArrangement, coords []float64, startID int) map[string]interface{} {
	nodes := make([]*layoutgraph.Node, len(coords))
	inputMemberIDs := make([]string, len(coords))
	for i, c := range coords {
		id := startID + i
		n := layoutgraph.NewNode(layoutgraph.EntityID(id), 40, 30)
		if arrangement == layoutgraph.Row {
			n.TopLeft = geo.NewPoint(c, 10)
		} else {
			n.TopLeft = geo.NewPoint(10, c)
		}
		nodes[i] = n
		inputMemberIDs[i] = fmt.Sprintf("%d", id)
	}

	cluster := &layoutgraph.Cluster{
		Nodes:       nodes,
		Arrangement: arrangement,
		Padding:     10,
		FixedSize:   true,
	}

	v := grouping.CreateVessel(cluster, layoutgraph.EntityID(startID+1000))

	outputMemberIDs := make([]string, len(cluster.Nodes))
	for i, n := range cluster.Nodes {
		outputMemberIDs[i] = fmt.Sprintf("%d", n.ID)
	}

	return map[string]interface{}{
		"inputMemberIDs":  inputMemberIDs,
		"coordinates":     coords,
		"outputMemberIDs": outputMemberIDs,
		"vessel":          vesselToDTO(v),
	}
}

func makeSpecialCoordScenario(arrangement layoutgraph.ClusterArrangement, x1, y1, x2, y2 float64, startID int) map[string]interface{} {
	n1 := layoutgraph.NewNode(layoutgraph.EntityID(startID), 40, 30)
	n1.TopLeft = geo.NewPoint(x1, y1)
	n2 := layoutgraph.NewNode(layoutgraph.EntityID(startID+1), 40, 30)
	n2.TopLeft = geo.NewPoint(x2, y2)

	cluster := &layoutgraph.Cluster{
		Nodes:       []*layoutgraph.Node{n1, n2},
		Arrangement: arrangement,
		Padding:     10,
		FixedSize:   true,
	}

	v := grouping.CreateVessel(cluster, layoutgraph.EntityID(startID+1000))

	nodeOrder := make([]string, len(cluster.Nodes))
	for i, n := range cluster.Nodes {
		nodeOrder[i] = fmt.Sprintf("%d", n.ID)
	}

	hasTopLeft := v.TopLeft != nil
	var xKind, yKind string
	if hasTopLeft {
		xKind = classifyFloat(v.TopLeft.X)
		yKind = classifyFloat(v.TopLeft.Y)
	} else {
		xKind = "none"
		yKind = "none"
	}

	return map[string]interface{}{
		"hasTopLeft":     hasTopLeft,
		"topLeftXKind":   xKind,
		"topLeftYKind":   yKind,
		"enteredSorting": hasTopLeft,
		"finalMemberIDs": nodeOrder,
		"vesselID":       fmt.Sprintf("%d", v.ID),
		"vesselWidth":    v.Width,
		"vesselHeight":   v.Height,
	}
}

func main() {
	outPath := "test/fixtures/go-cluster-mutation-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"pinnedD2SHA":      "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"oracleBuildTag":   "tala_cluster_mutation_oracle",
		},
		Scenarios: make(map[string]interface{}),
	}

	// =========================================================================
	// 1. Cluster.Resize
	// =========================================================================
	resizeScenarios := make(map[string]interface{})

	// 1.1 Row, FixedSize=false, unequal dimensions
	{
		n1 := layoutgraph.NewNode(1, 50, 30)
		n2 := layoutgraph.NewNode(2, 80, 20)
		n3 := layoutgraph.NewNode(3, 40, 60)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["row_unequal_dimensions"] = map[string]interface{}{
			"vesselWidth":   vessel.Width,
			"vesselHeight":  vessel.Height,
			"node1Width":    n1.Width,
			"node1Height":   n1.Height,
			"node2Width":    n2.Width,
			"node2Height":   n2.Height,
			"node3Width":    n3.Width,
			"node3Height":   n3.Height,
			"nodesMutated":  true,
			"allSameWidth":  n1.Width == n2.Width && n2.Width == n3.Width,
			"allSameHeight": n1.Height == n2.Height && n2.Height == n3.Height,
		}
	}

	// 1.2 Column, FixedSize=false, unequal dimensions
	{
		n1 := layoutgraph.NewNode(1, 30, 40)
		n2 := layoutgraph.NewNode(2, 50, 20)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Column,
			Padding:     15,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["column_unequal_dimensions"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
		}
	}

	// 1.3 Row, FixedSize=true
	{
		n1 := layoutgraph.NewNode(1, 50, 30)
		n2 := layoutgraph.NewNode(2, 80, 20)
		n3 := layoutgraph.NewNode(3, 40, 60)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   true,
		}
		c.Resize(vessel)
		resizeScenarios["row_fixed_size"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
			"node3Width":   n3.Width,
			"node3Height":  n3.Height,
		}
	}

	// 1.4 Column, FixedSize=true
	{
		n1 := layoutgraph.NewNode(1, 30, 40)
		n2 := layoutgraph.NewNode(2, 50, 20)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Column,
			Padding:     15,
			FixedSize:   true,
		}
		c.Resize(vessel)
		resizeScenarios["column_fixed_size"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
		}
	}

	// 1.5 Negative member width/height (clamped by 0.0 maxima start)
	{
		n1 := layoutgraph.NewNode(1, -10, -20)
		n2 := layoutgraph.NewNode(2, -5, 15)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     5,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["negative_dimensions"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
		}
	}

	// 1.6 Zero dimensions
	{
		n1 := layoutgraph.NewNode(1, 0, 0)
		n2 := layoutgraph.NewNode(2, 0, 0)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Column,
			Padding:     8,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["zero_dimensions"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
		}
	}

	// 1.7 Duplicate member reference
	{
		n1 := layoutgraph.NewNode(1, 25, 35)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n1},
			Arrangement: layoutgraph.Row,
			Padding:     12,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["duplicate_member_reference"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
		}
	}

	// 1.8 Empty Row cluster
	{
		vessel := layoutgraph.NewNode(99, 100, 100)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["empty_row"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
		}
	}

	// 1.9 Empty Column cluster
	{
		vessel := layoutgraph.NewNode(99, 100, 100)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{},
			Arrangement: layoutgraph.Column,
			Padding:     15,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["empty_column"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
		}
	}

	// 1.10 Unknown/empty arrangement (dimensions untouched)
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 50, 20)
		vessel := layoutgraph.NewNode(99, 999, 888)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.ClusterArrangement("Other"),
			Padding:     10,
			FixedSize:   false,
		}
		c.Resize(vessel)
		resizeScenarios["unknown_arrangement"] = map[string]interface{}{
			"vesselWidth":  vessel.Width,
			"vesselHeight": vessel.Height,
			"node1Width":   n1.Width,
			"node1Height":  n1.Height,
			"node2Width":   n2.Width,
			"node2Height":  n2.Height,
		}
	}

	// 1.11 Null member failure and mutation timing
	{
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 20, 20)
		vessel := layoutgraph.NewNode(99, 0, 0)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, nil, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		panicked := false
		var panicMsg string
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
					panicMsg = fmt.Sprintf("%v", r)
				}
			}()
			c.Resize(vessel)
		}()
		resizeScenarios["nil_member_failure"] = map[string]interface{}{
			"panicked":    panicked,
			"panicMsg":    panicMsg,
			"node1Width":  n1.Width,
			"node1Height": n1.Height,
			"node2Width":  n2.Width,
			"node2Height": n2.Height,
		}
	}

	// 1.12 Null vessel failure
	{
		n1 := layoutgraph.NewNode(1, 10, 10)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		panicked := false
		var panicMsg string
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
					panicMsg = fmt.Sprintf("%v", r)
				}
			}()
			c.Resize(nil)
		}()
		resizeScenarios["nil_vessel_failure"] = map[string]interface{}{
			"panicked": panicked,
			"panicMsg": panicMsg,
		}
	}

	out.Scenarios["resize"] = resizeScenarios

	// =========================================================================
	// 2. CreateVessel
	// =========================================================================
	createVesselScenarios := make(map[string]interface{})

	// 2.1 Row unsorted positioned members
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(100, 50)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = geo.NewPoint(20, 80)
		n3 := layoutgraph.NewNode(3, 40, 30)
		n3.TopLeft = geo.NewPoint(60, 10)

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 500)
		var nodeOrder []string
		for _, node := range c.Nodes {
			nodeOrder = append(nodeOrder, fmt.Sprintf("%d", node.ID))
		}
		createVesselScenarios["row_unsorted_positioned"] = map[string]interface{}{
			"vessel":        vesselToDTO(v),
			"nodeOrder":     nodeOrder,
			"clusterVessel": idPtr(c.Vessel),
			"allSameWidth":  n1.Width == n2.Width && n2.Width == n3.Width,
			"allSameHeight": n1.Height == n2.Height && n2.Height == n3.Height,
		}
	}

	// 2.2 Column unsorted positioned members
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(50, 100)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = geo.NewPoint(80, 20)
		n3 := layoutgraph.NewNode(3, 40, 30)
		n3.TopLeft = geo.NewPoint(10, 60)

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3},
			Arrangement: layoutgraph.Column,
			Padding:     15,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 501)
		var nodeOrder []string
		for _, node := range c.Nodes {
			nodeOrder = append(nodeOrder, fmt.Sprintf("%d", node.ID))
		}
		createVesselScenarios["column_unsorted_positioned"] = map[string]interface{}{
			"vessel":        vesselToDTO(v),
			"nodeOrder":     nodeOrder,
			"clusterVessel": idPtr(c.Vessel),
		}
	}

	// 2.3 Independent minimum X and minimum Y
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(15, 80) // has min X
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = geo.NewPoint(90, 25) // has min Y

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 502)
		createVesselScenarios["independent_min_x_min_y"] = map[string]interface{}{
			"vessel": vesselToDTO(v),
		}
	}

	// 2.4 No positioned members (all TopLeft == nil)
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 50, 20)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 503)
		var nodeOrder []string
		for _, node := range c.Nodes {
			nodeOrder = append(nodeOrder, fmt.Sprintf("%d", node.ID))
		}
		createVesselScenarios["no_positioned_members"] = map[string]interface{}{
			"vessel":    vesselToDTO(v),
			"nodeOrder": nodeOrder,
		}
	}

	// 2.5 FixedSize=false resize side effects
	{
		n1 := layoutgraph.NewNode(1, 30, 40)
		n1.TopLeft = geo.NewPoint(10, 10)
		n2 := layoutgraph.NewNode(2, 60, 25)
		n2.TopLeft = geo.NewPoint(50, 50)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 504)
		createVesselScenarios["fixed_size_false_resize"] = map[string]interface{}{
			"vessel":      vesselToDTO(v),
			"node1Width":  n1.Width,
			"node1Height": n1.Height,
			"node2Width":  n2.Width,
			"node2Height": n2.Height,
		}
	}

	// 2.6 FixedSize=true behavior
	{
		n1 := layoutgraph.NewNode(1, 30, 40)
		n1.TopLeft = geo.NewPoint(10, 10)
		n2 := layoutgraph.NewNode(2, 60, 25)
		n2.TopLeft = geo.NewPoint(50, 50)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   true,
		}
		v := grouping.CreateVessel(c, 505)
		createVesselScenarios["fixed_size_true"] = map[string]interface{}{
			"vessel":      vesselToDTO(v),
			"node1Width":  n1.Width,
			"node1Height": n1.Height,
			"node2Width":  n2.Width,
			"node2Height": n2.Height,
		}
	}

	// 2.7 Negative dimensions via Resize
	{
		n1 := layoutgraph.NewNode(1, -10, -5)
		n1.TopLeft = geo.NewPoint(5, 5)
		n2 := layoutgraph.NewNode(2, -20, 30)
		n2.TopLeft = geo.NewPoint(20, 20)
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Column,
			Padding:     5,
			FixedSize:   false,
		}
		v := grouping.CreateVessel(c, 506)
		createVesselScenarios["negative_dimensions_resize"] = map[string]interface{}{
			"vessel":      vesselToDTO(v),
			"node1Width":  n1.Width,
			"node1Height": n1.Height,
			"node2Width":  n2.Width,
			"node2Height": n2.Height,
		}
	}

	// 2.8 Equal-X Row tie
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(50, 10)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = geo.NewPoint(50, 20)
		n3 := layoutgraph.NewNode(3, 40, 30)
		n3.TopLeft = geo.NewPoint(20, 30)
		n4 := layoutgraph.NewNode(4, 40, 30)
		n4.TopLeft = geo.NewPoint(50, 5)

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3, n4},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   true,
		}
		v := grouping.CreateVessel(c, 507)
		var nodeOrder []string
		for _, node := range c.Nodes {
			nodeOrder = append(nodeOrder, fmt.Sprintf("%d", node.ID))
		}
		createVesselScenarios["equal_x_row_tie"] = map[string]interface{}{
			"vessel":    vesselToDTO(v),
			"nodeOrder": nodeOrder,
		}
	}

	// 2.9 Equal-Y Column tie
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(10, 50)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = geo.NewPoint(20, 50)
		n3 := layoutgraph.NewNode(3, 40, 30)
		n3.TopLeft = geo.NewPoint(30, 20)
		n4 := layoutgraph.NewNode(4, 40, 30)
		n4.TopLeft = geo.NewPoint(5, 50)

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2, n3, n4},
			Arrangement: layoutgraph.Column,
			Padding:     10,
			FixedSize:   true,
		}
		v := grouping.CreateVessel(c, 508)
		var nodeOrder []string
		for _, node := range c.Nodes {
			nodeOrder = append(nodeOrder, fmt.Sprintf("%d", node.ID))
		}
		createVesselScenarios["equal_y_column_tie"] = map[string]interface{}{
			"vessel":    vesselToDTO(v),
			"nodeOrder": nodeOrder,
		}
	}

	// 2.10 Mixed positioned / unpositioned members (causes panic in Go)
	{
		n1 := layoutgraph.NewNode(1, 40, 30)
		n1.TopLeft = geo.NewPoint(10, 20)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n2.TopLeft = nil // unpositioned!

		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{n1, n2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   true,
		}
		panicked := false
		var panicMsg string
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
					panicMsg = fmt.Sprintf("%v", r)
				}
			}()
			grouping.CreateVessel(c, 509)
		}()
		createVesselScenarios["mixed_positioned_unpositioned"] = map[string]interface{}{
			"panicked": panicked,
			"panicMsg": panicMsg,
		}
	}

	// 2.11 Large tie scenarios: sizes 13, 20, 32 for Row and Column
	tieCoords13 := []float64{50, 50, 20, 50, 30, 30, 50, 20, 40, 50, 30, 20, 50}
	tieCoords20 := []float64{50, 20, 30, 50, 20, 40, 30, 50, 20, 30, 40, 50, 20, 30, 50, 40, 20, 30, 50, 20}
	tieCoords32 := []float64{
		50, 20, 30, 50, 20, 40, 30, 50, 20, 30, 40, 50, 20, 30, 50, 40,
		20, 30, 50, 20, 10, 60, 30, 20, 50, 40, 30, 20, 50, 60, 10, 30,
	}

	createVesselScenarios["row_large_tie_13"] = makeLargeTieScenario(layoutgraph.Row, tieCoords13, 100)
	createVesselScenarios["col_large_tie_13"] = makeLargeTieScenario(layoutgraph.Column, tieCoords13, 200)
	createVesselScenarios["row_large_tie_20"] = makeLargeTieScenario(layoutgraph.Row, tieCoords20, 300)
	createVesselScenarios["col_large_tie_20"] = makeLargeTieScenario(layoutgraph.Column, tieCoords20, 400)
	createVesselScenarios["row_large_tie_32"] = makeLargeTieScenario(layoutgraph.Row, tieCoords32, 500)
	createVesselScenarios["col_large_tie_32"] = makeLargeTieScenario(layoutgraph.Column, tieCoords32, 600)

	// 2.12 Special coordinates parity: -Inf and NaN
	infNeg := math.Inf(-1)
	nan := math.NaN()
	createVesselScenarios["row_min_x_neg_inf"] = makeSpecialCoordScenario(layoutgraph.Row, infNeg, 20, 50, 20, 701)
	createVesselScenarios["col_min_y_neg_inf"] = makeSpecialCoordScenario(layoutgraph.Column, 20, 50, 20, infNeg, 711)
	createVesselScenarios["row_nan_x"] = makeSpecialCoordScenario(layoutgraph.Row, nan, 20, 50, 20, 721)
	createVesselScenarios["col_nan_y"] = makeSpecialCoordScenario(layoutgraph.Column, 20, nan, 20, 50, 731)

	out.Scenarios["createVessel"] = createVesselScenarios

	// =========================================================================
	// 3. AddCluster
	// =========================================================================
	addClusterScenarios := make(map[string]interface{})

	// 3.1 Root-level cluster
	{
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 40, 30)
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		c2 := layoutgraph.NewNode(20, 40, 30)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, c2)

		vessel := layoutgraph.NewNode(500, 90, 30)
		vessel.SetClusterVessel(true)

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: nil,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		var graphNodes []string
		for _, n := range g.Nodes {
			graphNodes = append(graphNodes, fmt.Sprintf("%d", n.ID))
		}
		var rootChildren []string
		for _, n := range g.Containers[nil] {
			rootChildren = append(rootChildren, fmt.Sprintf("%d", n.ID))
		}

		addClusterScenarios["root_level_cluster"] = map[string]interface{}{
			"graphNodes":      graphNodes,
			"rootChildren":    rootChildren,
			"vesselInGraph":   slices.Contains(g.Nodes, vessel),
			"vesselContainer": idPtr(vessel.Container),
			"vesselHasGraph":  vessel.Graph == g,
			"node1Cluster":    n1.Cluster == cluster,
			"node2Cluster":    n2.Cluster == cluster,
			"node1Container":  idPtr(n1.Container),
			"node2Container":  idPtr(n2.Container),
			"node1HasGraph":   n1.Graph == g,
			"node2HasGraph":   n2.Graph == g,
			"clusterInMap":    g.Clusters[vessel] == cluster,
		}
	}

	// 3.2 Nested-container cluster
	{
		g := layoutgraph.NewGraph()
		parent := layoutgraph.NewNode(100, 200, 200)
		parent.SetContainer(true)
		g.AddNewNodeToContainer(nil, parent)

		c1 := layoutgraph.NewNode(10, 40, 30)
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		c2 := layoutgraph.NewNode(20, 40, 30)
		g.AddNewNodeToContainer(parent, c1)
		g.AddNewNodeToContainer(parent, n1)
		g.AddNewNodeToContainer(parent, n2)
		g.AddNewNodeToContainer(parent, c2)

		vessel := layoutgraph.NewNode(501, 90, 30)
		vessel.SetClusterVessel(true)

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: parent,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		var parentChildren []string
		for _, n := range g.Containers[parent] {
			parentChildren = append(parentChildren, fmt.Sprintf("%d", n.ID))
		}

		addClusterScenarios["nested_container_cluster"] = map[string]interface{}{
			"parentChildren":  parentChildren,
			"vesselInGraph":   slices.Contains(g.Nodes, vessel),
			"vesselContainer": idPtr(vessel.Container),
			"clusterInMap":    g.Clusters[vessel] == cluster,
			"node1InGraph":    slices.Contains(g.Nodes, n1),
			"node2InGraph":    slices.Contains(g.Nodes, n2),
		}
	}

	// 3.3 Duplicate member in cluster.Nodes
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)

		vessel := layoutgraph.NewNode(502, 90, 30)
		vessel.SetClusterVessel(true)

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2, n1}, // duplicate n1!
			Container: nil,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		var rootChildren []string
		for _, n := range g.Containers[nil] {
			rootChildren = append(rootChildren, fmt.Sprintf("%d", n.ID))
		}
		addClusterScenarios["duplicate_member_in_cluster_nodes"] = map[string]interface{}{
			"rootChildren":  rootChildren,
			"vesselInGraph": slices.Contains(g.Nodes, vessel),
			"node1InGraph":  slices.Contains(g.Nodes, n1),
			"node2InGraph":  slices.Contains(g.Nodes, n2),
			"clusterInMap":  g.Clusters[vessel] == cluster,
		}
	}

	// 3.4 Duplicate member pointer in graph.Nodes
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n3 := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.Nodes = append(g.Nodes, n1) // manually duplicate n1 in graph.Nodes!
		g.AddNewNodeToContainer(nil, n3)

		vessel := layoutgraph.NewNode(503, 90, 30)
		vessel.SetClusterVessel(true)

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: nil,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		var graphNodes []string
		for _, n := range g.Nodes {
			graphNodes = append(graphNodes, fmt.Sprintf("%d", n.ID))
		}
		addClusterScenarios["duplicate_member_in_graph_nodes"] = map[string]interface{}{
			"graphNodes":    graphNodes,
			"node1Count":    0, // count how many times n1 appears
			"vesselInGraph": slices.Contains(g.Nodes, vessel),
		}
		countN1 := 0
		for _, n := range g.Nodes {
			if n == n1 {
				countN1++
			}
		}
		addClusterScenarios["duplicate_member_in_graph_nodes"].(map[string]interface{})["node1Count"] = countN1
	}

	// 3.5 Extra container child already carrying same cluster pointer
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		rogue := layoutgraph.NewNode(99, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, rogue)

		vessel := layoutgraph.NewNode(504, 90, 30)
		vessel.SetClusterVessel(true)

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: nil,
			Graph:     g,
		}

		// Rogue child carries cluster pointer beforehand, but is NOT in cluster.Nodes!
		rogue.Cluster = cluster

		grouping.AddCluster(g, cluster)

		var rootChildren []string
		for _, n := range g.Containers[nil] {
			rootChildren = append(rootChildren, fmt.Sprintf("%d", n.ID))
		}
		addClusterScenarios["extra_child_with_same_cluster"] = map[string]interface{}{
			"rootChildren":     rootChildren,
			"rogueInGraph":     slices.Contains(g.Nodes, rogue),           // rogue was NOT in cluster.Nodes, so g.RemoveNode was not called on it!
			"rogueInContainer": slices.Contains(g.Containers[nil], rogue), // but was filtered from Containers because child.Cluster == cluster!
		}
	}

	// 3.6 Pre-existing unrelated cluster entry in graph.Clusters
	{
		g := layoutgraph.NewGraph()
		unrelatedVessel := layoutgraph.NewNode(400, 50, 50)
		unrelatedCluster := &layoutgraph.Cluster{Vessel: unrelatedVessel}
		g.Clusters[unrelatedVessel] = unrelatedCluster

		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)

		vessel := layoutgraph.NewNode(505, 90, 30)
		vessel.SetClusterVessel(true)
		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: nil,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		addClusterScenarios["preexisting_unrelated_cluster"] = map[string]interface{}{
			"clusterCount":        len(g.Clusters),
			"hasUnrelatedCluster": g.Clusters[unrelatedVessel] == unrelatedCluster,
			"hasNewCluster":       g.Clusters[vessel] == cluster,
		}
	}

	// 3.7 Members with incident edges (AddCluster does NOT touch edges)
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		ext := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, ext)

		e1 := connectWithID(g, 101, n1, ext)
		e2 := connectWithID(g, 102, ext, n2)
		eInternal := connectWithID(g, 103, n1, n2)

		vessel := layoutgraph.NewNode(506, 90, 30)
		vessel.SetClusterVessel(true)
		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{n1, n2},
			Container: nil,
			Graph:     g,
		}

		grouping.AddCluster(g, cluster)

		addClusterScenarios["members_with_incident_edges"] = map[string]interface{}{
			"e1From":         fmt.Sprintf("%d", e1.From.ID),
			"e1To":           fmt.Sprintf("%d", e1.To.ID),
			"e2From":         fmt.Sprintf("%d", e2.From.ID),
			"e2To":           fmt.Sprintf("%d", e2.To.ID),
			"eInternalFrom":  fmt.Sprintf("%d", eInternal.From.ID),
			"eInternalTo":    fmt.Sprintf("%d", eInternal.To.ID),
			"vesselEdgesLen": len(vessel.Edges),
			"n1EdgesLen":     len(n1.Edges),
			"n2EdgesLen":     len(n2.Edges),
		}
	}

	out.Scenarios["addCluster"] = addClusterScenarios

	// =========================================================================
	// 4. abductClusterEdges
	// =========================================================================
	abductScenarios := make(map[string]interface{})

	// 4.1 No supplied edges
	{
		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel}
		guard, err := limits.NewWorkGuard(context.Background(), "test", 1000)
		if err != nil {
			panic(err)
		}
		err = grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{}, guard)
		abductScenarios["no_supplied_edges"] = map[string]interface{}{
			"err":             err != nil,
			"used":            guard.Used(),
			"abductionsCount": len(cluster.EdgeAbductions),
		}
	}

	// 4.2 One irrelevant edge
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		ext1 := layoutgraph.NewNode(2, 40, 30)
		ext2 := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, ext1)
		g.AddNewNodeToContainer(nil, ext2)
		e := connectWithID(g, 201, ext1, ext2)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)
		abductScenarios["one_irrelevant_edge"] = map[string]interface{}{
			"err":             err != nil,
			"used":            guard.Used(),
			"abductionsCount": len(cluster.EdgeAbductions),
			"edgeFrom":        fmt.Sprintf("%d", e.From.ID),
			"edgeTo":          fmt.Sprintf("%d", e.To.ID),
		}
	}

	// 4.3 One outgoing cluster edge
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		ext := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, ext)
		e := connectWithID(g, 202, n1, ext)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)
		abductScenarios["one_outgoing_edge"] = map[string]interface{}{
			"err":            err != nil,
			"used":           guard.Used(),
			"abductions":     abductionsToDTO(cluster.EdgeAbductions),
			"edgeFrom":       fmt.Sprintf("%d", e.From.ID),
			"edgeTo":         fmt.Sprintf("%d", e.To.ID),
			"vesselEdgesLen": len(vessel.Edges),
			"n1EdgesLen":     len(n1.Edges),
		}
	}

	// 4.4 One incoming cluster edge
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		ext := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, ext)
		e := connectWithID(g, 203, ext, n1)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)
		abductScenarios["one_incoming_edge"] = map[string]interface{}{
			"err":            err != nil,
			"used":           guard.Used(),
			"abductions":     abductionsToDTO(cluster.EdgeAbductions),
			"edgeFrom":       fmt.Sprintf("%d", e.From.ID),
			"edgeTo":         fmt.Sprintf("%d", e.To.ID),
			"vesselEdgesLen": len(vessel.Edges),
			"n1EdgesLen":     len(n1.Edges),
		}
	}

	// 4.5 One member-to-member internal edge (2 abductions, dynamic charging!)
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		e := connectWithID(g, 204, n1, n2)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1, n2}}
		n1.Cluster = cluster
		n2.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)
		abductScenarios["one_internal_edge"] = map[string]interface{}{
			"err":            err != nil,
			"used":           guard.Used(),
			"abductions":     abductionsToDTO(cluster.EdgeAbductions),
			"edgeFrom":       fmt.Sprintf("%d", e.From.ID),
			"edgeTo":         fmt.Sprintf("%d", e.To.ID),
			"vesselEdgesLen": len(vessel.Edges), // should be 2!
			"n1EdgesLen":     len(n1.Edges),
			"n2EdgesLen":     len(n2.Edges),
		}
	}

	// 4.6 Member self-loop
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		e := connectWithID(g, 205, n1, n1) // self loop

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)
		abductScenarios["one_self_loop"] = map[string]interface{}{
			"err":            err != nil,
			"used":           guard.Used(),
			"abductions":     abductionsToDTO(cluster.EdgeAbductions),
			"edgeFrom":       fmt.Sprintf("%d", e.From.ID),
			"edgeTo":         fmt.Sprintf("%d", e.To.ID),
			"vesselEdgesLen": len(vessel.Edges),
			"n1EdgesLen":     len(n1.Edges),
		}
	}

	// 4.7 Multiple supplied edges
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		ext1 := layoutgraph.NewNode(3, 40, 30)
		ext2 := layoutgraph.NewNode(4, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, ext1)
		g.AddNewNodeToContainer(nil, ext2)

		eIrrelevant := connectWithID(g, 301, ext1, ext2)
		eOut := connectWithID(g, 302, n1, ext1)
		eIn := connectWithID(g, 303, ext2, n2)
		eInternal := connectWithID(g, 304, n1, n2)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1, n2}}
		n1.Cluster = cluster
		n2.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		edges := []*layoutgraph.Edge{eIrrelevant, eOut, eIn, eInternal}
		err := grouping.AbductClusterEdgesBridge(cluster, edges, guard)
		abductScenarios["multiple_supplied_edges"] = map[string]interface{}{
			"err":             err != nil,
			"used":            guard.Used(),
			"abductions":      abductionsToDTO(cluster.EdgeAbductions),
			"eIrrelevantFrom": fmt.Sprintf("%d", eIrrelevant.From.ID),
			"eIrrelevantTo":   fmt.Sprintf("%d", eIrrelevant.To.ID),
			"eOutFrom":        fmt.Sprintf("%d", eOut.From.ID),
			"eOutTo":          fmt.Sprintf("%d", eOut.To.ID),
			"eInFrom":         fmt.Sprintf("%d", eIn.From.ID),
			"eInTo":           fmt.Sprintf("%d", eIn.To.ID),
			"eInternalFrom":   fmt.Sprintf("%d", eInternal.From.ID),
			"eInternalTo":     fmt.Sprintf("%d", eInternal.To.ID),
			"vesselEdgesLen":  len(vessel.Edges),
		}
	}

	// 4.8 Vessel already has incident edges before abduction starts
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		ext1 := layoutgraph.NewNode(2, 40, 30)
		ext2 := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, ext1)
		g.AddNewNodeToContainer(nil, ext2)

		vessel := layoutgraph.NewNode(500, 0, 0)
		g.AddNewNodeToContainer(nil, vessel)

		// Pre-existing edges on vessel:
		eV1 := connectWithID(g, 401, vessel, ext2)
		eV2 := connectWithID(g, 402, ext2, vessel)
		_ = eV1
		_ = eV2

		// Member edge to abduct:
		eMember := connectWithID(g, 403, n1, ext1)

		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{eMember}, guard)
		abductScenarios["vessel_preexisting_edges"] = map[string]interface{}{
			"err":            err != nil,
			"used":           guard.Used(),
			"abductions":     abductionsToDTO(cluster.EdgeAbductions),
			"vesselEdgesLen": len(vessel.Edges), // 2 pre-existing + 1 abducted = 3
		}
	}

	// 4.9 Exact route preservation
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		ext := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, ext)
		e := connectWithID(g, 501, n1, ext)

		// Add custom route points
		e.Points = []*geo.Point{
			geo.NewPoint(10, 20),
			geo.NewPoint(30, 20),
			geo.NewPoint(30, 40),
			geo.NewPoint(50, 40),
		}

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "test", 1000)
		_ = grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e}, guard)

		var routePoints []PointDTO
		for _, pt := range e.Points {
			routePoints = append(routePoints, PointDTO{X: pt.X, Y: pt.Y})
		}
		abductScenarios["route_preservation"] = map[string]interface{}{
			"pointsCount": len(e.Points),
			"points":      routePoints,
			"edgeFrom":    fmt.Sprintf("%d", e.From.ID),
			"edgeTo":      fmt.Sprintf("%d", e.To.ID),
		}
	}

	out.Scenarios["abductClusterEdges"] = abductScenarios

	// =========================================================================
	// 5. WorkGuard Boundaries and Nontransactional Partial Failure
	// =========================================================================
	boundaryScenarios := make(map[string]interface{})

	// 5.1 Exact limit success vs limit - 1 failure
	{
		// Exact used for multiple_supplied_edges is recorded from 4.7
		multiUsed := abductScenarios["multiple_supplied_edges"].(map[string]interface{})["used"].(int64)

		// Run at exact limit
		{
			g := layoutgraph.NewGraph()
			n1 := layoutgraph.NewNode(1, 40, 30)
			n2 := layoutgraph.NewNode(2, 40, 30)
			ext1 := layoutgraph.NewNode(3, 40, 30)
			ext2 := layoutgraph.NewNode(4, 40, 30)
			g.AddNewNodeToContainer(nil, n1)
			g.AddNewNodeToContainer(nil, n2)
			g.AddNewNodeToContainer(nil, ext1)
			g.AddNewNodeToContainer(nil, ext2)
			eIrrelevant := connectWithID(g, 301, ext1, ext2)
			eOut := connectWithID(g, 302, n1, ext1)
			eIn := connectWithID(g, 303, ext2, n2)
			eInternal := connectWithID(g, 304, n1, n2)

			vessel := layoutgraph.NewNode(500, 0, 0)
			cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1, n2}}
			n1.Cluster = cluster
			n2.Cluster = cluster

			guard, _ := limits.NewWorkGuard(context.Background(), "test", multiUsed)
			err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{eIrrelevant, eOut, eIn, eInternal}, guard)
			boundaryScenarios["exact_limit_success"] = map[string]interface{}{
				"limit": multiUsed,
				"err":   err != nil,
				"used":  guard.Used(),
			}
		}

		// Run at exact limit - 1
		{
			g := layoutgraph.NewGraph()
			n1 := layoutgraph.NewNode(1, 40, 30)
			n2 := layoutgraph.NewNode(2, 40, 30)
			ext1 := layoutgraph.NewNode(3, 40, 30)
			ext2 := layoutgraph.NewNode(4, 40, 30)
			g.AddNewNodeToContainer(nil, n1)
			g.AddNewNodeToContainer(nil, n2)
			g.AddNewNodeToContainer(nil, ext1)
			g.AddNewNodeToContainer(nil, ext2)
			eIrrelevant := connectWithID(g, 301, ext1, ext2)
			eOut := connectWithID(g, 302, n1, ext1)
			eIn := connectWithID(g, 303, ext2, n2)
			eInternal := connectWithID(g, 304, n1, n2)

			vessel := layoutgraph.NewNode(500, 0, 0)
			cluster := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{n1, n2}}
			n1.Cluster = cluster
			n2.Cluster = cluster

			guard, _ := limits.NewWorkGuard(context.Background(), "test", multiUsed-1)
			err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{eIrrelevant, eOut, eIn, eInternal}, guard)
			boundaryScenarios["limit_minus_1_failure"] = map[string]interface{}{
				"limit": multiUsed - 1,
				"err":   err != nil,
				"used":  guard.Used(),
			}
		}
	}

	// 5.2 Nontransactional partial failure: first edge reconnects, second fails
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		ext := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, ext)

		e1 := connectWithID(g, 601, n1, ext) // charges: 1 outer + 1 reconnect = 2
		e2 := connectWithID(g, 602, n2, ext) // charges: 1 outer + 2 reconnect (n2 has 1, vessel now has 1!)

		vessel := layoutgraph.NewNode(500, 0, 0)
		sentinelEdge := connectWithID(g, 999, ext, ext)
		sentinelAbduction := &layoutgraph.EdgeAbduction{Edge: sentinelEdge}
		cluster := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{n1, n2},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{sentinelAbduction}, // pre-existing sentinel!
		}
		n1.Cluster = cluster
		n2.Cluster = cluster

		// e1 takes 2 steps. e2 outer takes 1 step (total 3).
		// If limit is 2: e1 finishes (used=2). e2 outer attempts step 3 and fails!
		guard, _ := limits.NewWorkGuard(context.Background(), "test", 2)
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e1, e2}, guard)

		boundaryScenarios["partial_mutation_failure"] = map[string]interface{}{
			"err":              err != nil,
			"used":             guard.Used(),
			"e1From":           fmt.Sprintf("%d", e1.From.ID), // should be vessel (reconnected!)
			"e1To":             fmt.Sprintf("%d", e1.To.ID),
			"e2From":           fmt.Sprintf("%d", e2.From.ID), // should still be n2 (NOT reconnected!)
			"e2To":             fmt.Sprintf("%d", e2.To.ID),
			"sentinelRetained": len(cluster.EdgeAbductions) == 1 && cluster.EdgeAbductions[0] == sentinelAbduction,
			"vesselEdgesLen":   len(vessel.Edges), // should be 1 (from e1)
			"n1EdgesLen":       len(n1.Edges),     // should be 0
			"n2EdgesLen":       len(n2.Edges),     // should be 1
		}
	}

	out.Scenarios["boundaries"] = boundaryScenarios

	// =========================================================================
	// 6. Mid-operation Cancellation
	// =========================================================================
	cancellationScenarios := make(map[string]interface{})
	{
		// Construct a scenario where context is canceled during Step inside abductClusterEdges.
		// We use a cancellable context, and we create an edge whose incident charge loop crosses the stride (64 for nil-Done context).
		// Let's create dummy edges on ext node or member node so that len(edge.From.Edges) >= 70.
		// That will cause the inner charge loop to step > 64 times, triggering cancellation at the stride boundary!
		ctx, cancel := context.WithCancel(context.Background())
		cancel() // context is already canceled, but with a custom WorkGuard without immediate Done check or using a step counter.
		// Wait, NewWorkGuard immediately calls Finish() which would fail if context is already canceled.
		// So context must NOT be canceled initially!
		_ = ctx
		_ = cancel

		// To cancel MID-OPERATION, we can create a context that gets canceled after N steps,
		// OR we can test cancellation with a WorkGuard constructed with active context, then canceled.
		// Let's see how go_sequence_mutation_oracle or go_work_guard_oracle did it!
	}

	// Let's check how mid-operation cancellation is done with standard Go context
	{
		ctx, cancel := context.WithCancel(context.Background())
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		ext := layoutgraph.NewNode(3, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, ext)

		e1 := connectWithID(g, 701, n1, ext)

		// Add enough edges to n2 so that its charge loop has > 70 steps:
		for i := 0; i < 70; i++ {
			connectWithID(g, layoutgraph.EntityID(800+i), n2, ext)
		}
		e2 := connectWithID(g, 702, n2, ext)

		vessel := layoutgraph.NewNode(500, 0, 0)
		sentinelEdge := connectWithID(g, 999, ext, ext)
		sentinelAbduction := &layoutgraph.EdgeAbduction{Edge: sentinelEdge}
		cluster := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{n1, n2},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{sentinelAbduction},
		}
		n1.Cluster = cluster
		n2.Cluster = cluster

		guard, _ := limits.NewWorkGuard(ctx, "test", 10000)
		// Cancel the context now! Notice that WorkGuard checks context at stride (which for WithCancel context is 1024, or for nil-Done context is 64).
		// But wait! If we cancel ctx right before, when does guard check?
		// For cancellable context (ctx.Done() != nil), stride is 1024!
		// If we want it to check at 1024, we need 1024 steps, OR we can cancel in another goroutine, or use nil-Done context (stride 64) with a custom context type!
		cancel()

		// For cancellable context with stride 1024, let's create 1050 edges on n2:
		for i := 0; i < 1000; i++ {
			connectWithID(g, layoutgraph.EntityID(2000+i), n2, ext)
		}

		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e1, e2}, guard)
		var errText string
		if err != nil {
			errText = err.Error()
		}
		cancellationScenarios["mid_operation_cancellation"] = map[string]interface{}{
			"err":              err != nil,
			"isCanceled":       errors.Is(err, context.Canceled),
			"errorText":        errText,
			"expectedLocation": "test",
			"used":             guard.Used(),
			"e1From":           fmt.Sprintf("%d", e1.From.ID), // should be vessel (first edge succeeded!)
			"e2From":           fmt.Sprintf("%d", e2.From.ID), // should still be n2 (failed mid-way!)
			"sentinelRetained": len(cluster.EdgeAbductions) == 1 && cluster.EdgeAbductions[0] == sentinelAbduction,
			"vesselEdgesLen":   len(vessel.Edges),
		}
	}

	// 6.2 Final-Finish cancellation
	{
		ctx, cancel := context.WithCancel(context.Background())
		guard, _ := limits.NewWorkGuard(ctx, "test", 10000)
		cancel() // Cancel AFTER guard creation

		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		ext := layoutgraph.NewNode(2, 10, 10)
		g.AddNodeUnchecked(n1)
		g.AddNodeUnchecked(ext)
		e1 := connectWithID(g, 901, n1, ext)

		vessel := layoutgraph.NewNode(500, 0, 0)
		cluster := &layoutgraph.Cluster{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{n1},
		}
		n1.Cluster = cluster

		// Loop steps will be: 1 (outer) + (1 + 0) = 2 steps total, well below 1024 stride!
		err := grouping.AbductClusterEdgesBridge(cluster, []*layoutgraph.Edge{e1}, guard)
		var errText string
		if err != nil {
			errText = err.Error()
		}
		cancellationScenarios["final_finish_cancellation"] = map[string]interface{}{
			"err":                    err != nil,
			"isCanceled":             errors.Is(err, context.Canceled),
			"errorText":              errText,
			"expectedLocation":       "test",
			"used":                   guard.Used(),
			"publishedAbductionsLen": len(cluster.EdgeAbductions),
			"e1From":                 fmt.Sprintf("%d", e1.From.ID),
			"e1To":                   fmt.Sprintf("%d", e1.To.ID),
			"vesselEdgesLen":         len(vessel.Edges),
			"n1EdgesLen":             len(n1.Edges),
			"abductions":             abductionsToDTO(cluster.EdgeAbductions),
		}
	}
	out.Scenarios["cancellation"] = cancellationScenarios

	// Serialize JSON output
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		panic(err)
	}

	hash, err := fileSHA256(outPath)
	if err != nil {
		panic(err)
	}
	fmt.Printf("Generated %s (%d bytes, SHA256: %s)\n", outPath, len(data), hash)
}
