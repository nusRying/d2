package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/placement"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/placementcost"
	"github.com/d2lang/d2/d2renderers/d2fonts"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

type PrescaleOracleOutput struct {
	Metadata map[string]interface{} `json:"metadata"`
	Cases    map[string]interface{} `json:"cases"`
}

type NodeState struct {
	ID       string      `json:"id"`
	Width    float64     `json:"width"`
	Height   float64     `json:"height"`
	FontSize *int        `json:"fontSize"`
	Label    *LabelState `json:"label"`
}

type LabelState struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func recordNode(n *layoutgraph.Node) NodeState {
	ns := NodeState{
		ID:     strconv.FormatInt(int64(n.ID), 10),
		Width:  n.Width,
		Height: n.Height,
	}
	if n.FontSize != nil {
		fs := *n.FontSize
		ns.FontSize = &fs
	}
	if n.Label != nil {
		ns.Label = &LabelState{
			Width:  n.Label.Width,
			Height: n.Label.Height,
		}
	}
	return ns
}

func recordNodes(nodes []*layoutgraph.Node) []NodeState {
	res := make([]NodeState, len(nodes))
	for i, n := range nodes {
		res[i] = recordNode(n)
	}
	return res
}

func intPtr(v int) *int {
	return &v
}

func floatPtr(v float64) *float64 {
	return &v
}

func main() {
	outPath := "test/fixtures/go-prescale-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := PrescaleOracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/placement",
			"sideEdgeSpacing":  placementcost.SideEdgeSpacing,
			"adapterFontSizes": d2fonts.FontSizes,
		},
		Cases: make(map[string]interface{}),
	}

	// 1. GenericNoEdges
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 60)
		n.FontSize = intPtr(16)
		n.Label = &layoutgraph.Label{Width: 50, Height: 20}
		g.Nodes = append(g.Nodes, n)
		placement.Prescale(g)
		out.Cases["GenericNoEdges"] = recordNode(n)
	}

	// 2. CircleNoEdges
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 40, 60)
		n.SetShape(shape.CIRCLE_TYPE)
		n.FontSize = intPtr(16)
		g.Nodes = append(g.Nodes, n)
		placement.Prescale(g)
		out.Cases["CircleNoEdges"] = recordNode(n)
	}

	// 3. RealSquareNoEdges
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 40, 80)
		n.SetShape(shape.REAL_SQUARE_TYPE)
		g.Nodes = append(g.Nodes, n)
		placement.Prescale(g)
		out.Cases["RealSquareNoEdges"] = recordNode(n)
	}

	// 4. SquareAspectRatioCheck
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 40, 80)
		n.SetShape(shape.SQUARE_TYPE)
		g.Nodes = append(g.Nodes, n)
		placement.Prescale(g)
		out.Cases["SquareAspectRatioCheck"] = recordNode(n)
	}

	// 5. FixedCircleDenseEdges
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 40, 60)
		nA.SetShape(shape.CIRCLE_TYPE)
		nA.FixedTopLeft = &geo.Point{X: 10, Y: 20}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 4; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["FixedCircleDenseEdges"] = recordNode(nA)
	}

	// 6. DesiredWidthSkip
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.DesiredWidth = floatPtr(80)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 4; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["DesiredWidthSkip"] = recordNode(nA)
	}

	// 7. DesiredHeightSkip
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.DesiredHeight = floatPtr(80)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 4; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["DesiredHeightSkip"] = recordNode(nA)
	}

	// 8. TableSkip
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.SetShape(shape.TABLE_TYPE)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 4; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["TableSkip"] = recordNode(nA)
	}

	// 9. ClassSkip
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.SetShape(shape.CLASS_TYPE)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 4; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["ClassSkip"] = recordNode(nA)
	}

	// 10. SingleNormalEdge
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 30, Height: 10}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["SingleNormalEdge"] = recordNode(nA)
	}

	// 11. TwoParallelEdges
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 30, Height: 10}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["TwoParallelEdges"] = recordNode(nA)
	}

	// 12. ThreeParallelEdges
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 3; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["ThreeParallelEdges"] = recordNode(nA)
	}

	// 13. FiveDistinctNeighbors
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		g.Nodes = append(g.Nodes, nA)
		for i := 2; i <= 6; i++ {
			nb := layoutgraph.NewNode(layoutgraph.EntityID(i), 100, 100)
			g.Nodes = append(g.Nodes, nb)
			g.Connect(nA, nb)
		}
		placement.Prescale(g)
		out.Cases["FiveDistinctNeighbors"] = recordNode(nA)
	}

	// 14. MixedParallelGlobalDensity
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		g.Nodes = append(g.Nodes, nA)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nB)
		for i := 0; i < 3; i++ {
			g.Connect(nA, nB)
		}
		for i := 3; i <= 6; i++ {
			nb := layoutgraph.NewNode(layoutgraph.EntityID(i), 100, 100)
			g.Nodes = append(g.Nodes, nb)
			g.Connect(nA, nb)
		}
		placement.Prescale(g)
		out.Cases["MixedParallelGlobalDensity"] = recordNode(nA)
	}

	// 15. LargeNodeEarlyReturn
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 121, 121)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 40, Height: 20}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["LargeNodeEarlyReturn"] = recordNode(nA)
	}

	// 16. ExactMinLengthEquality
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 120, 120)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 40, Height: 20}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["ExactMinLengthEquality"] = recordNode(nA)
	}

	// 17. OneAxisOnlyGrowth
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 200, 80)
		nA.FontSize = intPtr(16)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["OneAxisOnlyGrowth"] = recordNode(nA)
	}

	// 18. AspectRatio1EdgeGrowth
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 60, 40)
		nA.SetShape(shape.CIRCLE_TYPE)
		nA.FontSize = intPtr(16)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		for i := 0; i < 3; i++ {
			g.Connect(nA, nB)
		}
		placement.Prescale(g)
		out.Cases["AspectRatio1EdgeGrowth"] = recordNode(nA)
	}

	// 19. FontSizeNullLabelPresent
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = nil
		nA.Label = &layoutgraph.Label{Width: 40, Height: 20}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["FontSizeNullLabelPresent"] = recordNode(nA)
	}

	// 20. FontSizePresentLabelNull
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = nil
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["FontSizePresentLabelNull"] = recordNode(nA)
	}

	// 21. ExactSupportedFontRatio
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["ExactSupportedFontRatio"] = recordNode(nA)
	}

	// 22. FontOvershootCorrection
	{
		g := layoutgraph.NewGraph()
		w := 600.0 / 7.0
		nA := layoutgraph.NewNode(1, w, w)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 40, Height: 20}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["FontOvershootCorrection"] = recordNode(nA)
	}

	// 23. NearestTieFontCase
	{
		g := layoutgraph.NewGraph()
		// minLength = 120. With w = 120/1.125 = 106.66666666666667, minRatio = 1.125.
		// For fontSize = 16: 16/16 = 1.0 (diff 0.125), 20/16 = 1.25 (diff 0.125).
		w := 120.0 / 1.125
		nA := layoutgraph.NewNode(1, w, w)
		nA.FontSize = intPtr(16)
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["NearestTieFontCase"] = recordNode(nA)
	}

	// 24. FractionalLabelRounding
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 10.2, Height: 5.1}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["FractionalLabelRounding"] = recordNode(nA)
	}

	// 25. ZeroDimension
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 0, 0)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 10, Height: 10}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["ZeroDimension"] = recordNode(nA)
	}

	// 26. SingleSelfLoopOnly
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 20, 20)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 10, Height: 10}
		g.Nodes = append(g.Nodes, nA)
		g.Connect(nA, nA)
		placement.Prescale(g)
		out.Cases["SingleSelfLoopOnly"] = recordNode(nA)
	}

	// 27. MultipleSelfLoopsOnly
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 20, 20)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 10, Height: 10}
		g.Nodes = append(g.Nodes, nA)
		for i := 0; i < 3; i++ {
			g.Connect(nA, nA)
		}
		placement.Prescale(g)
		out.Cases["MultipleSelfLoopsOnly"] = recordNode(nA)
	}

	// 28. SelfLoopPlusNormalEdge
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 30, Height: 10}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		// 1 self loop
		g.Connect(nA, nA)
		// 2 normal edges to nB
		g.Connect(nA, nB)
		g.Connect(nA, nB)
		placement.Prescale(g)
		out.Cases["SelfLoopPlusNormalEdge"] = recordNode(nA)
	}

	// 29. Idempotence
	{
		g := layoutgraph.NewGraph()
		nA := layoutgraph.NewNode(1, 80, 80)
		nA.FontSize = intPtr(16)
		nA.Label = &layoutgraph.Label{Width: 30, Height: 10}
		nB := layoutgraph.NewNode(2, 100, 100)
		g.Nodes = append(g.Nodes, nA, nB)
		g.Connect(nA, nB)
		g.Connect(nA, nB)

		placement.Prescale(g)
		firstPass := recordNode(nA)

		placement.Prescale(g)
		secondPass := recordNode(nA)

		out.Cases["Idempotence"] = map[string]interface{}{
			"firstPass":  firstPass,
			"secondPass": secondPass,
		}
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Wrote Go Prescale oracle reference fixture to %s\n", outPath)
}
