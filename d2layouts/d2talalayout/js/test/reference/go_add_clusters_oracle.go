//go:build ignore

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
	"github.com/d2lang/d2/lib/shape"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Helpers   map[string]interface{} `json:"helpers"`
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
}

type EdgeDTO struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
}

type AbductionDTO struct {
	EdgeID         string  `json:"edgeID"`
	OriginallyFrom *string `json:"originallyFrom"`
	OriginallyTo   *string `json:"originallyTo"`
	CurrentFrom    *string `json:"currentFrom"`
	CurrentTo      *string `json:"currentTo"`
}

type ClusterDTO struct {
	VesselID           string         `json:"vesselID"`
	Arrangement        string         `json:"arrangement"`
	DesiredArrangement string         `json:"desiredArrangement"`
	Padding            float64        `json:"padding"`
	FixedSize          bool           `json:"fixedSize"`
	VesselWidth        float64        `json:"vesselWidth"`
	VesselHeight       float64        `json:"vesselHeight"`
	VesselTopLeft      *PointDTO      `json:"vesselTopLeft"`
	MemberIDs          []string       `json:"memberIDs"`
	Container          *string        `json:"container"`
	EdgeAbductions     []AbductionDTO `json:"edgeAbductions"`
}

type ScenarioResult struct {
	Success         bool                  `json:"success"`
	ErrorText       *string               `json:"errorText"`
	WorkGuardUsed   int64                 `json:"workGuardUsed"`
	RandomNextInt63 string                `json:"randomNextInt63"`
	Nodes           []string              `json:"nodes"`
	Clusters        map[string]ClusterDTO `json:"clusters"`
	Containers      map[string][]string   `json:"containers"`
	Edges           []EdgeDTO             `json:"edges"`
}

func main() {
	out := OracleOutput{
		Metadata: map[string]interface{}{
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"pinnedGoRuntime":  "go1.27.0",
			"runtimeGoVersion": runtime.Version(),
			"goos":             runtime.GOOS,
			"goarch":           runtime.GOARCH,
			"buildTag":         "tala_add_clusters_oracle",
		},
		Helpers:   make(map[string]interface{}),
		Scenarios: make(map[string]interface{}),
	}

	buildHelperCoverage(&out)
	buildAddClustersScenarios(&out)

	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "test/fixtures/go-add-clusters-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	if err := os.WriteFile(outFile, b, 0644); err != nil {
		panic(err)
	}

	h := sha256.Sum256(b)
	fmt.Printf("Wrote %d bytes to %s\nSHA256: %s\n", len(b), outFile, hex.EncodeToString(h[:]))
}

func buildHelperCoverage(out *OracleOutput) {
	// 1. SameShape Cases
	type sameShapeCase struct {
		Name   string `json:"name"`
		ShapeA string `json:"shapeA"`
		ShapeB string `json:"shapeB"`
		Result bool   `json:"result"`
	}
	pairs := []struct {
		name, sA, sB string
		res          bool
	}{
		{"default_vs_default", "", "", true},
		{"square_vs_square", shape.SQUARE_TYPE, shape.SQUARE_TYPE, true},
		{"circle_vs_circle", shape.CIRCLE_TYPE, shape.CIRCLE_TYPE, true},
		{"circle_vs_square", shape.CIRCLE_TYPE, shape.SQUARE_TYPE, false},
		{"step_vs_step", shape.STEP_TYPE, shape.STEP_TYPE, true},
	}
	var sameShapeResults []sameShapeCase
	for _, p := range pairs {
		nA := layoutgraph.NewNode(1, 100, 100)
		nA.SetShape(p.sA)
		nB := layoutgraph.NewNode(2, 100, 100)
		nB.SetShape(p.sB)
		sameShapeResults = append(sameShapeResults, sameShapeCase{
			Name:   p.name,
			ShapeA: p.sA,
			ShapeB: p.sB,
			Result: nA.SameShape(nB),
		})
	}
	out.Helpers["sameShapeCases"] = sameShapeResults

	// 2. DistanceTo Cases
	type distanceToCase struct {
		Name         string  `json:"name"`
		TopLeftAX    float64 `json:"tlAX"`
		TopLeftAY    float64 `json:"tlAY"`
		WidthA       float64 `json:"widthA"`
		HeightA      float64 `json:"heightA"`
		TopLeftBX    float64 `json:"tlBX"`
		TopLeftBY    float64 `json:"tlBY"`
		WidthB       float64 `json:"widthB"`
		HeightB      float64 `json:"heightB"`
		IncludeSizes bool    `json:"includeSizes"`
		Distance     float64 `json:"distance"`
	}
	distDefs := []struct {
		name           string
		ax, ay, aw, ah float64
		bx, by, bw, bh float64
		includeSizes   bool
	}{
		{"horizontal_separated", 0, 0, 10, 10, 20, 0, 10, 10, true},
		{"horizontal_without_sizes", 0, 0, 10, 10, 20, 0, 10, 10, false},
		{"vertical_separated", 0, 0, 10, 10, 0, 25, 10, 10, true},
		{"diagonal_separated", 0, 0, 10, 10, 13, 14, 10, 10, true},
		{"overlap", 0, 0, 20, 20, 10, 10, 20, 20, true},
		{"touching", 0, 0, 10, 10, 10, 0, 10, 10, true},
		{"negative_dimensions", 0, 0, -10, -10, 20, 20, 10, 10, true},
	}
	var distResults []distanceToCase
	for _, d := range distDefs {
		nA := layoutgraph.NewNode(1, d.aw, d.ah)
		nA.TopLeft = geo.NewPoint(d.ax, d.ay)
		nB := layoutgraph.NewNode(2, d.bw, d.bh)
		nB.TopLeft = geo.NewPoint(d.bx, d.by)
		dist := nA.DistanceTo(nB, d.includeSizes)
		distResults = append(distResults, distanceToCase{
			Name:         d.name,
			TopLeftAX:    d.ax,
			TopLeftAY:    d.ay,
			WidthA:       d.aw,
			HeightA:      d.ah,
			TopLeftBX:    d.bx,
			TopLeftBY:    d.by,
			WidthB:       d.bw,
			HeightB:      d.bh,
			IncludeSizes: d.includeSizes,
			Distance:     dist,
		})
	}
	out.Helpers["distanceToCases"] = distResults

	// 3. averageClusterDimensions Cases
	type avgDimCase struct {
		Name    string    `json:"name"`
		Widths  []float64 `json:"widths"`
		Heights []float64 `json:"heights"`
		OutW    *float64  `json:"outW"`
		OutH    *float64  `json:"outH"`
		IsNaNW  bool      `json:"isNaNW"`
		IsNaNH  bool      `json:"isNaNH"`
	}
	avgDefs := []struct {
		name    string
		widths  []float64
		heights []float64
	}{
		{"ordinary", []float64{100, 200}, []float64{50, 70}},
		{"rounded_averages", []float64{10, 15}, []float64{20, 25}},
		{"negative_values", []float64{-10, -20}, []float64{10, 20}},
		{"empty", []float64{}, []float64{}},
	}
	var avgResults []avgDimCase
	for _, ad := range avgDefs {
		c := &layoutgraph.Cluster{}
		for i := 0; i < len(ad.widths); i++ {
			n := layoutgraph.NewNode(layoutgraph.EntityID(i+1), ad.widths[i], ad.heights[i])
			c.Nodes = append(c.Nodes, n)
		}
		w, h := grouping.AverageClusterDimensionsBridge(c)
		var pw, ph *float64
		if !math.IsNaN(w) {
			pw = &w
		}
		if !math.IsNaN(h) {
			ph = &h
		}
		avgResults = append(avgResults, avgDimCase{
			Name:    ad.name,
			Widths:  ad.widths,
			Heights: ad.heights,
			OutW:    pw,
			OutH:    ph,
			IsNaNW:  math.IsNaN(w),
			IsNaNH:  math.IsNaN(h),
		})
	}
	out.Helpers["averageClusterDimensionsCases"] = avgResults

	// 4. AssignArrangement Cases
	type assignArrangementCase struct {
		Name                  string    `json:"name"`
		Widths                []float64 `json:"widths"`
		Heights               []float64 `json:"heights"`
		IsConnectedToSequence bool      `json:"isConnectedToSequence"`
		Seed                  int64     `json:"seed"`
		Arrangement           string    `json:"arrangement"`
		NextFloat64           float64   `json:"nextFloat64"`
	}
	arrDefs := []struct {
		name        string
		widths      []float64
		heights     []float64
		isConnToSeq bool
		seed        int64
	}{
		{"connected_sequence", []float64{100, 100}, []float64{200, 200}, true, 42},
		{"width_gt_height", []float64{200, 200}, []float64{100, 100}, false, 42},
		{"width_lt_height", []float64{100, 100}, []float64{200, 200}, false, 42},
		{"equality_seed_row", []float64{100, 100}, []float64{100, 100}, false, 1},
		{"equality_seed_col", []float64{100, 100}, []float64{100, 100}, false, 2},
		{"empty_cluster_rng", []float64{}, []float64{}, false, 1},
	}
	var arrResults []assignArrangementCase
	for _, ar := range arrDefs {
		c := &layoutgraph.Cluster{}
		for i := 0; i < len(ar.widths); i++ {
			n := layoutgraph.NewNode(layoutgraph.EntityID(i+1), ar.widths[i], ar.heights[i])
			c.Nodes = append(c.Nodes, n)
		}
		rng := rand.New(rand.NewSource(ar.seed))
		res := grouping.AssignArrangement(c, ar.isConnToSeq, rng)
		arrResults = append(arrResults, assignArrangementCase{
			Name:                  ar.name,
			Widths:                ar.widths,
			Heights:               ar.heights,
			IsConnectedToSequence: ar.isConnToSeq,
			Seed:                  ar.seed,
			Arrangement:           string(res),
			NextFloat64:           rng.Float64(),
		})
	}
	out.Helpers["assignArrangementCases"] = arrResults

	// 5. PaddingBetween Cases
	type paddingBetweenCase struct {
		Name              string    `json:"name"`
		Arrangement       string    `json:"arrangement"`
		Widths            []float64 `json:"widths"`
		Heights           []float64 `json:"heights"`
		TopLeftsX         []float64 `json:"topleftsX"`
		TopLeftsY         []float64 `json:"topleftsY"`
		HasIcon           bool      `json:"hasIcon"`
		LabelWidth        float64   `json:"labelWidth"`
		LabelHeight       float64   `json:"labelHeight"`
		ConsiderPositions bool      `json:"considerPositions"`
		Padding           *float64  `json:"padding"`
		IsNaN             bool      `json:"isNaN"`
	}
	padDefs := []struct {
		name              string
		arrangement       layoutgraph.ClusterArrangement
		widths, heights   []float64
		tlX, tlY          []float64
		hasIcon           bool
		lblW, lblH        float64
		considerPositions bool
	}{
		{"row_min_gap", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 0}, []float64{0, 0}, false, 0, 0, false},
		{"col_min_gap", layoutgraph.Column, []float64{10, 10}, []float64{10, 10}, []float64{0, 0}, []float64{0, 0}, false, 0, 0, false},
		{"large_avg_width", layoutgraph.Row, []float64{500, 500}, []float64{10, 10}, []float64{0, 0}, []float64{0, 0}, false, 0, 0, false},
		{"large_avg_height", layoutgraph.Column, []float64{10, 10}, []float64{600, 600}, []float64{0, 0}, []float64{0, 0}, false, 0, 0, false},
		{"icon_plus_labels", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 0}, []float64{0, 0}, true, 30, 20, false},
		{"labels_without_icon", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 0}, []float64{0, 0}, false, 30, 20, false},
		{"unknown_arrangement_non_row", "Custom", []float64{10, 10}, []float64{400, 400}, []float64{0, 0}, []float64{0, 0}, false, 0, 0, false},
		{"consider_positions_false", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 50}, []float64{0, 0}, false, 0, 0, false},
		{"consider_positions_horizontal_gap", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 25}, []float64{0, 0}, false, 0, 0, true},
		{"consider_positions_diagonal_gap", layoutgraph.Row, []float64{10, 10}, []float64{10, 10}, []float64{0, 13}, []float64{0, 14}, false, 0, 0, true},
		{"consider_positions_overlap_fallback", layoutgraph.Row, []float64{20, 20}, []float64{20, 20}, []float64{0, 10}, []float64{0, 10}, false, 0, 0, true},
		{"consider_positions_single_node", layoutgraph.Row, []float64{10}, []float64{10}, []float64{0}, []float64{0}, false, 0, 0, true},
		{"consider_positions_empty", layoutgraph.Row, []float64{}, []float64{}, []float64{}, []float64{}, false, 0, 0, true},
	}
	var padResults []paddingBetweenCase
	for _, pd := range padDefs {
		c := &layoutgraph.Cluster{Arrangement: pd.arrangement}
		for i := 0; i < len(pd.widths); i++ {
			n := layoutgraph.NewNode(layoutgraph.EntityID(i+1), pd.widths[i], pd.heights[i])
			if i < len(pd.tlX) {
				n.TopLeft = geo.NewPoint(pd.tlX[i], pd.tlY[i])
			}
			if pd.hasIcon {
				n.InitIcon()
			}
			if pd.lblW > 0 || pd.lblH > 0 {
				n.Label = &layoutgraph.Label{Width: pd.lblW, Height: pd.lblH}
			}
			c.Nodes = append(c.Nodes, n)
		}
		p := grouping.PaddingBetween(c, pd.considerPositions)
		var pp *float64
		if !math.IsNaN(p) {
			pp = &p
		}
		padResults = append(padResults, paddingBetweenCase{
			Name:              pd.name,
			Arrangement:       string(pd.arrangement),
			Widths:            pd.widths,
			Heights:           pd.heights,
			TopLeftsX:         pd.tlX,
			TopLeftsY:         pd.tlY,
			HasIcon:           pd.hasIcon,
			LabelWidth:        pd.lblW,
			LabelHeight:       pd.lblH,
			ConsiderPositions: pd.considerPositions,
			Padding:           pp,
			IsNaN:             math.IsNaN(p),
		})
	}
	out.Helpers["paddingBetweenCases"] = padResults

	// 6. ContainerPadding Cases
	type containerPaddingCase struct {
		Name               string  `json:"name"`
		HasContainer       bool    `json:"hasContainer"`
		Shape              string  `json:"shape"`
		Width              float64 `json:"width"`
		Height             float64 `json:"height"`
		HasIcon            bool    `json:"hasIcon"`
		IconFixed          bool    `json:"iconFixed"`
		LabelPosition      string  `json:"labelPosition"`
		LabelWidth         float64 `json:"labelWidth"`
		LabelHeight        float64 `json:"labelHeight"`
		ConsiderChildren   bool    `json:"considerChildren"`
		ChildHasIcon       bool    `json:"childHasIcon"`
		ChildIconFixed     bool    `json:"childIconFixed"`
		ChildMarginTop     float64 `json:"childMarginTop"`
		ChildMarginBottom  float64 `json:"childMarginBottom"`
		ChildMarginLeft    float64 `json:"childMarginLeft"`
		ChildMarginRight   float64 `json:"childMarginRight"`
		ContainerPadTop    float64 `json:"containerPadTop"`
		ContainerPadBottom float64 `json:"containerPadBottom"`
		ContainerPadLeft   float64 `json:"containerPadLeft"`
		ContainerPadRight  float64 `json:"containerPadRight"`
		Top                float64 `json:"top"`
		Bottom             float64 `json:"bottom"`
		Left               float64 `json:"left"`
		Right              float64 `json:"right"`
	}
	cpDefs := []struct {
		name               string
		hasContainer       bool
		shapeType          string
		width, height      float64
		hasIcon            bool
		iconFixed          bool
		labelPos           label.Position
		lblW, lblH         float64
		considerChildren   bool
		childHasIcon       bool
		childIconFixed     bool
		childMarginTop     float64
		childMarginBottom  float64
		childMarginLeft    float64
		childMarginRight   float64
		containerPadTop    float64
		containerPadBottom float64
		containerPadLeft   float64
		containerPadRight  float64
	}{
		{"root_null", false, "", 0, 0, false, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"ordinary", true, "", 200, 200, false, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"circle", true, shape.CIRCLE_TYPE, 200, 200, false, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"container_icon", true, "", 200, 200, true, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"image_icon", true, shape.IMAGE_TYPE, 200, 200, true, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"inside_top_label", true, "", 200, 200, false, false, label.InsideTopCenter, 50, 20, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"inside_bottom_label", true, "", 200, 200, false, false, label.InsideBottomCenter, 50, 20, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"inside_middle_left", true, "", 200, 200, false, false, label.InsideMiddleLeft, 50, 20, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"inside_middle_right", true, "", 200, 200, false, false, label.InsideMiddleRight, 50, 20, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"outside_label", true, "", 200, 200, false, false, label.OutsideTopCenter, 50, 20, false, false, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"child_icon_unfixed", true, "", 200, 200, false, false, label.Unset, 0, 0, true, true, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"child_icon_fixed", true, "", 200, 200, false, false, label.Unset, 0, 0, true, true, true, 0, 0, 0, 0, 0, 0, 0, 0},
		{"circle_plus_interactions", true, shape.CIRCLE_TYPE, 100, 100, true, false, label.InsideTopCenter, 40, 20, true, true, false, 0, 0, 0, 0, 0, 0, 0, 0},
		{"child_margin_only", true, "", 200, 200, false, false, label.Unset, 0, 0, true, false, false, 15, 25, 35, 45, 0, 0, 0, 0},
		{"container_padding_only", true, "", 200, 200, false, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 12, 24, 36, 48},
		{"child_margin_plus_container_padding", true, "", 200, 200, false, false, label.Unset, 0, 0, true, false, false, 10, 15, 20, 25, 30, 35, 40, 45},
		{"circle_custom_padding", true, shape.CIRCLE_TYPE, 200, 200, false, false, label.Unset, 0, 0, false, false, false, 0, 0, 0, 0, 40, 40, 40, 40},
	}
	var cpResults []containerPaddingCase
	for _, cpd := range cpDefs {
		g := layoutgraph.NewGraph()
		var container *layoutgraph.Node
		if cpd.hasContainer {
			container = g.AddNode(layoutgraph.NewNode(1, cpd.width, cpd.height))
			if cpd.shapeType != "" {
				container.SetShape(cpd.shapeType)
			}
			if cpd.containerPadTop > 0 || cpd.containerPadBottom > 0 || cpd.containerPadLeft > 0 || cpd.containerPadRight > 0 {
				layoutgraph.SetNodePaddingForOracle(container, cpd.containerPadTop, cpd.containerPadBottom, cpd.containerPadLeft, cpd.containerPadRight)
			}
			if cpd.hasIcon {
				container.InitIcon()
				if cpd.iconFixed {
					container.Icon.FixPosition()
				}
			}
			if cpd.lblW > 0 || cpd.lblH > 0 || cpd.labelPos != label.Unset {
				container.Label = &layoutgraph.Label{Width: cpd.lblW, Height: cpd.lblH, Position: cpd.labelPos}
			}
			if cpd.considerChildren && (cpd.childHasIcon || cpd.childMarginTop > 0 || cpd.childMarginBottom > 0 || cpd.childMarginLeft > 0 || cpd.childMarginRight > 0) {
				child := layoutgraph.NewNode(2, 50, 50)
				if cpd.childHasIcon {
					child.InitIcon()
					if cpd.childIconFixed {
						child.Icon.FixPosition()
					}
				}
				if cpd.childMarginTop > 0 || cpd.childMarginBottom > 0 || cpd.childMarginLeft > 0 || cpd.childMarginRight > 0 {
					layoutgraph.SetNodeMarginForOracle(child, cpd.childMarginTop, cpd.childMarginBottom, cpd.childMarginLeft, cpd.childMarginRight)
				}
				g.AddNodeToContainer(container, child)
			}
		}
		sp := g.ContainerPadding(container, cpd.considerChildren)
		cpResults = append(cpResults, containerPaddingCase{
			Name:               cpd.name,
			HasContainer:       cpd.hasContainer,
			Shape:              cpd.shapeType,
			Width:              cpd.width,
			Height:             cpd.height,
			HasIcon:            cpd.hasIcon,
			IconFixed:          cpd.iconFixed,
			LabelPosition:      cpd.labelPos.String(),
			LabelWidth:         cpd.lblW,
			LabelHeight:        cpd.lblH,
			ConsiderChildren:   cpd.considerChildren,
			ChildHasIcon:       cpd.childHasIcon,
			ChildIconFixed:     cpd.childIconFixed,
			ChildMarginTop:     cpd.childMarginTop,
			ChildMarginBottom:  cpd.childMarginBottom,
			ChildMarginLeft:    cpd.childMarginLeft,
			ChildMarginRight:   cpd.childMarginRight,
			ContainerPadTop:    cpd.containerPadTop,
			ContainerPadBottom: cpd.containerPadBottom,
			ContainerPadLeft:   cpd.containerPadLeft,
			ContainerPadRight:  cpd.containerPadRight,
			Top:                sp.Top(),
			Bottom:             sp.Bottom(),
			Left:               sp.Left(),
			Right:              sp.Right(),
		})
	}
	out.Helpers["containerPaddingCases"] = cpResults
}

func buildAddClustersScenarios(out *OracleOutput) {
	runScenario := func(name string, buildGraph func(*layoutgraph.Graph) (*rand.Rand, int64)) {
		g := layoutgraph.NewGraph()
		rnd, seed := buildGraph(g)

		ctx := context.Background()
		guard, err := limits.NewWorkGuard(ctx, "AddClustersTransactions", limits.MaxTransactionWorkUnits)
		if err != nil {
			panic(err)
		}
		txCtx := layoutgraph.ContextWithTransactionWorkGuard(ctx, guard)

		addErr := grouping.AddClusters(txCtx, g, seed, rnd)
		var errText *string
		if addErr != nil {
			s := addErr.Error()
			errText = &s
		}

		res := ScenarioResult{
			Success:         addErr == nil,
			ErrorText:       errText,
			WorkGuardUsed:   int64(guard.Used()),
			RandomNextInt63: fmt.Sprintf("%d", rnd.Int63()),
			Clusters:        make(map[string]ClusterDTO),
			Containers:      make(map[string][]string),
		}

		for _, n := range g.Nodes {
			res.Nodes = append(res.Nodes, fmt.Sprintf("%d", n.ID))
		}

		for vessel, cluster := range g.Clusters {
			if vessel == nil || cluster == nil {
				continue
			}
			vesselIDStr := fmt.Sprintf("%d", vessel.ID)
			var memberIDs []string
			for _, m := range cluster.Nodes {
				memberIDs = append(memberIDs, fmt.Sprintf("%d", m.ID))
			}
			var containerIDStr *string
			if cluster.Container != nil {
				s := fmt.Sprintf("%d", cluster.Container.ID)
				containerIDStr = &s
			}
			var vesselTL *PointDTO
			if vessel.TopLeft != nil {
				vesselTL = &PointDTO{X: vessel.TopLeft.X, Y: vessel.TopLeft.Y}
			}
			var abductions []AbductionDTO
			for _, abd := range cluster.EdgeAbductions {
				if abd == nil {
					continue
				}
				var oFrom, oTo, cFrom, cTo *string
				if abd.OriginallyFrom != nil {
					s := fmt.Sprintf("%d", abd.OriginallyFrom.ID)
					oFrom = &s
				}
				if abd.OriginallyTo != nil {
					s := fmt.Sprintf("%d", abd.OriginallyTo.ID)
					oTo = &s
				}
				if abd.CurrentFrom != nil {
					s := fmt.Sprintf("%d", abd.CurrentFrom.ID)
					cFrom = &s
				}
				if abd.CurrentTo != nil {
					s := fmt.Sprintf("%d", abd.CurrentTo.ID)
					cTo = &s
				}
				edgeIDStr := fmt.Sprintf("%d", abd.Edge.ID)
				abductions = append(abductions, AbductionDTO{
					EdgeID:         edgeIDStr,
					OriginallyFrom: oFrom,
					OriginallyTo:   oTo,
					CurrentFrom:    cFrom,
					CurrentTo:      cTo,
				})
			}

			res.Clusters[vesselIDStr] = ClusterDTO{
				VesselID:           vesselIDStr,
				Arrangement:        string(cluster.Arrangement),
				DesiredArrangement: string(cluster.DesiredArrangement),
				Padding:            cluster.Padding,
				FixedSize:          cluster.FixedSize,
				VesselWidth:        vessel.Width,
				VesselHeight:       vessel.Height,
				VesselTopLeft:      vesselTL,
				MemberIDs:          memberIDs,
				Container:          containerIDStr,
				EdgeAbductions:     abductions,
			}
		}

		for container, children := range g.Containers {
			cID := "null"
			if container != nil {
				cID = fmt.Sprintf("%d", container.ID)
			}
			var childIDs []string
			for _, child := range children {
				childIDs = append(childIDs, fmt.Sprintf("%d", child.ID))
			}
			res.Containers[cID] = childIDs
		}

		for _, e := range g.Edges {
			res.Edges = append(res.Edges, EdgeDTO{
				ID:   fmt.Sprintf("%d", e.ID),
				From: fmt.Sprintf("%d", e.From.ID),
				To:   fmt.Sprintf("%d", e.To.ID),
			})
		}

		out.Scenarios[name] = res
	}

	// 1. Basic shared adjacent cluster
	runScenario("basic_shared_adjacent_cluster", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 2. Already clustered node is ineligible for new clustering
	runScenario("already_clustered_ineligible_node", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		vesselExisting := layoutgraph.NewNode(99, 100, 100)
		vesselExisting.SetClusterVessel(true)

		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.AddNewNodeToContainer(nil, vesselExisting)

		existingCluster := &layoutgraph.Cluster{Vessel: vesselExisting, Nodes: []*layoutgraph.Node{n1}}
		n1.Cluster = existingCluster
		g.Clusters[vesselExisting] = existingCluster

		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 2b. Genuine hierarchy ineligible node (node.Hierarchy != nil -> no clustering)
	runScenario("hierarchy_ineligible_nodes", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		c := layoutgraph.NewNode(10, 300, 300)
		c.SetContainer(true)
		g.AddNewNodeToContainer(nil, c)

		n1 := layoutgraph.NewNode(11, 80, 80)
		n2 := layoutgraph.NewNode(12, 80, 80)
		target := layoutgraph.NewNode(13, 60, 60)
		g.AddNewNodeToContainer(c, n1)
		g.AddNewNodeToContainer(c, n2)
		g.AddNewNodeToContainer(c, target)

		g.Connect(n1, target)
		g.Connect(n2, target)

		n1.Hierarchy = &layoutgraph.Hierarchy{} // sets noClustering = true
		return rand.New(rand.NewSource(12345)), 42
	})

	// 2c. RealSquare members -> FixedSize == true
	runScenario("real_square_members_fixed_size", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		c := layoutgraph.NewNode(10, 300, 300)
		c.SetContainer(true)
		g.AddNewNodeToContainer(nil, c)

		n1 := layoutgraph.NewNode(11, 80, 80)
		n1.SetShape(shape.REAL_SQUARE_TYPE)
		n2 := layoutgraph.NewNode(12, 80, 80)
		n2.SetShape(shape.REAL_SQUARE_TYPE)
		target := layoutgraph.NewNode(13, 60, 60)
		g.AddNewNodeToContainer(c, n1)
		g.AddNewNodeToContainer(c, n2)
		g.AddNewNodeToContainer(c, target)

		g.Connect(n1, target)
		g.Connect(n2, target)

		return rand.New(rand.NewSource(12345)), 42
	})

	// 3. Inconsistent multiple shared adjacency -> no cluster
	runScenario("inconsistent_multiple_shared_adjacency", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		targetA := layoutgraph.NewNode(3, 80, 80)
		targetB := layoutgraph.NewNode(4, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, targetA)
		g.AddNewNodeToContainer(nil, targetB)
		g.Connect(n1, targetA)
		g.Connect(n2, targetB)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 4. Consistent multiple shared adjacency -> 1 cluster created
	runScenario("consistent_multiple_shared_adjacency", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		targetA := layoutgraph.NewNode(3, 80, 80)
		targetB := layoutgraph.NewNode(4, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, targetA)
		g.AddNewNodeToContainer(nil, targetB)
		g.Connect(n1, targetA)
		g.Connect(n2, targetA)
		g.Connect(n1, targetB)
		g.Connect(n2, targetB)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 5. Zero-neighbor sibling pair -> no cluster
	runScenario("zero_neighbor_sibling_pair", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 6. Shape mismatch: Circle vs Square
	runScenario("shape_mismatch_circle_vs_square", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 100)
		n1.SetShape(shape.CIRCLE_TYPE)
		n2 := layoutgraph.NewNode(2, 100, 100)
		n2.SetShape(shape.SQUARE_TYPE)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 7. Size ratio: exactly 4x eligible -> cluster created
	runScenario("size_ratio_exactly_4x", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 25, 100)
		n2 := layoutgraph.NewNode(2, 100, 100)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 8. Size ratio: beyond 4x rejected -> no cluster
	runScenario("size_ratio_beyond_4x", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 24, 100)
		n2 := layoutgraph.NewNode(2, 100, 100)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 9. Circle cluster: FixedSize=true
	runScenario("circle_cluster_fixed_size", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 80, 80)
		n1.SetShape(shape.CIRCLE_TYPE)
		n2 := layoutgraph.NewNode(2, 80, 80)
		n2.SetShape(shape.CIRCLE_TYPE)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 10. Connected to sequence candidate -> forced Row (width 200 > height 50 would normally be Column)
	runScenario("connected_to_sequence_forced_row", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 200, 50)
		n2 := layoutgraph.NewNode(2, 200, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		seqVessel := layoutgraph.NewNode(99, 100, 100)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.AddNewNodeToContainer(nil, seqVessel)
		seq := &layoutgraph.Sequence{Vessel: seqVessel, Nodes: []*layoutgraph.Node{target}}
		target.Sequence = seq
		g.Sequences[seqVessel] = seq
		g.Connect(n1, target)
		g.Connect(n2, target)
		return rand.New(rand.NewSource(12345)), 42
	})

	// 11. Table-column edge metadata -> skipped
	runScenario("table_column_edge_metadata", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		e1 := g.Connect(n1, target)
		e2 := g.Connect(n2, target)
		colIdx := 0
		e1.ToTableColumnIndex = &colIdx
		e2.ToTableColumnIndex = &colIdx
		return rand.New(rand.NewSource(12345)), 42
	})

	// 12. Ordinary node vessel-ID collision
	runScenario("ordinary_node_vessel_id_collision", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		// Predict next Int63 draw from seed 1
		rndTest := rand.New(rand.NewSource(1))
		predictedID := layoutgraph.EntityID(rndTest.Int63())
		// Place an obstacle node with that exact ID in root container
		obs := layoutgraph.NewNode(predictedID, 50, 50)
		g.AddNewNodeToContainer(nil, obs)
		return rand.New(rand.NewSource(1)), 42
	})

	// 13. Sequence-vessel ID collision
	runScenario("sequence_vessel_id_collision", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		rndTest := rand.New(rand.NewSource(2))
		predictedID := layoutgraph.EntityID(rndTest.Int63())
		seqV := layoutgraph.NewNode(predictedID, 50, 50)
		g.AddNewNodeToContainer(nil, seqV)
		g.Sequences[seqV] = &layoutgraph.Sequence{Vessel: seqV}
		return rand.New(rand.NewSource(2)), 42
	})

	// 14. Sequence-member ID collision
	runScenario("sequence_member_id_collision", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		rndTest := rand.New(rand.NewSource(3))
		predictedID := layoutgraph.EntityID(rndTest.Int63())
		seqV := layoutgraph.NewNode(999, 50, 50)
		seqM := layoutgraph.NewNode(predictedID, 50, 50)
		g.AddNewNodeToContainer(nil, seqV)
		g.AddNewNodeToContainer(nil, seqM)
		seq := &layoutgraph.Sequence{Vessel: seqV, Nodes: []*layoutgraph.Node{seqM}}
		seqM.Sequence = seq
		g.Sequences[seqV] = seq
		return rand.New(rand.NewSource(3)), 42
	})

	// 15. Tree-sentinel ID collision
	runScenario("tree_sentinel_id_collision", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		rndTest := rand.New(rand.NewSource(4))
		predictedID := layoutgraph.EntityID(rndTest.Int63())
		sentinel := layoutgraph.NewNode(predictedID, 50, 50)
		g.AddNewNodeToContainer(nil, sentinel)
		g.Trees[sentinel] = []*layoutgraph.Tree{}
		return rand.New(rand.NewSource(4)), 42
	})

	// 16. Tree-node ID collision
	runScenario("tree_node_id_collision", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.Connect(n1, target)
		g.Connect(n2, target)
		rndTest := rand.New(rand.NewSource(5))
		predictedID := layoutgraph.EntityID(rndTest.Int63())
		sentinel := layoutgraph.NewNode(998, 50, 50)
		treeNode := layoutgraph.NewNode(predictedID, 50, 50)
		g.AddNewNodeToContainer(nil, sentinel)
		g.AddNewNodeToContainer(nil, treeNode)
		g.Trees[sentinel] = []*layoutgraph.Tree{{Node: treeNode}}
		return rand.New(rand.NewSource(5)), 42
	})

	// 17. Nested containers
	runScenario("nested_containers", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		cRoot := layoutgraph.NewNode(10, 500, 500)
		cRoot.SetContainer(true)
		g.AddNewNodeToContainer(nil, cRoot)

		cInner := layoutgraph.NewNode(20, 300, 300)
		cInner.SetContainer(true)
		g.AddNewNodeToContainer(cRoot, cInner)

		n1 := layoutgraph.NewNode(21, 80, 40)
		n2 := layoutgraph.NewNode(22, 80, 40)
		target := layoutgraph.NewNode(23, 60, 60)
		g.AddNewNodeToContainer(cInner, n1)
		g.AddNewNodeToContainer(cInner, n2)
		g.AddNewNodeToContainer(cInner, target)

		g.Connect(n1, target)
		g.Connect(n2, target)

		return rand.New(rand.NewSource(12345)), 42
	})

	// 18. Two containers with equal square clusters: proves per-container RNG reset
	runScenario("two_containers_equal_square_clusters", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		cA := layoutgraph.NewNode(10, 300, 300)
		cA.SetContainer(true)
		g.AddNewNodeToContainer(nil, cA)

		cB := layoutgraph.NewNode(20, 300, 300)
		cB.SetContainer(true)
		g.AddNewNodeToContainer(nil, cB)

		nA1 := layoutgraph.NewNode(11, 80, 80)
		nA2 := layoutgraph.NewNode(12, 80, 80)
		targetA := layoutgraph.NewNode(13, 60, 60)
		g.AddNewNodeToContainer(cA, nA1)
		g.AddNewNodeToContainer(cA, nA2)
		g.AddNewNodeToContainer(cA, targetA)
		g.Connect(nA1, targetA)
		g.Connect(nA2, targetA)

		nB1 := layoutgraph.NewNode(21, 80, 80)
		nB2 := layoutgraph.NewNode(22, 80, 80)
		targetB := layoutgraph.NewNode(23, 60, 60)
		g.AddNewNodeToContainer(cB, nB1)
		g.AddNewNodeToContainer(cB, nB2)
		g.AddNewNodeToContainer(cB, targetB)
		g.Connect(nB1, targetB)
		g.Connect(nB2, targetB)

		return rand.New(rand.NewSource(54321)), 100
	})

	// 19. Multiple accepted clusters in same graph
	runScenario("multiple_accepted_clusters", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target1 := layoutgraph.NewNode(3, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target1)
		g.Connect(n1, target1)
		g.Connect(n2, target1)

		n4 := layoutgraph.NewNode(4, 120, 60)
		n5 := layoutgraph.NewNode(5, 120, 60)
		target2 := layoutgraph.NewNode(6, 70, 70)
		g.AddNewNodeToContainer(nil, n4)
		g.AddNewNodeToContainer(nil, n5)
		g.AddNewNodeToContainer(nil, target2)
		g.Connect(n4, target2)
		g.Connect(n5, target2)

		return rand.New(rand.NewSource(99999)), 77
	})

	// 20. Candidate rejected before vessel draw (descendant cycle / containment edge)
	runScenario("candidate_rejected_before_vessel_draw", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		c := layoutgraph.NewNode(10, 300, 300)
		c.SetContainer(true)
		g.AddNewNodeToContainer(nil, c)

		n1 := layoutgraph.NewNode(11, 80, 80)
		n2 := layoutgraph.NewNode(12, 80, 80)
		g.AddNewNodeToContainer(c, n1)
		g.AddNewNodeToContainer(c, n2)

		// Edge from n1 directly to its own container c makes c a descendant of n1's container
		g.Connect(n1, c)
		g.Connect(n2, c)

		return rand.New(rand.NewSource(11111)), 42
	})

	// 21. Discovery refresh interaction: edge abduction changes topology for later candidates
	runScenario("discovery_refresh_interaction", func(g *layoutgraph.Graph) (*rand.Rand, int64) {
		n1 := layoutgraph.NewNode(1, 100, 50)
		n2 := layoutgraph.NewNode(2, 100, 50)
		target := layoutgraph.NewNode(3, 80, 80)
		n4 := layoutgraph.NewNode(4, 100, 50)
		n5 := layoutgraph.NewNode(5, 80, 80)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, target)
		g.AddNewNodeToContainer(nil, n4)
		g.AddNewNodeToContainer(nil, n5)

		g.Connect(n1, target)
		g.Connect(n1, n4)
		g.Connect(n2, target)
		g.Connect(n2, n4)
		g.Connect(n4, n5)

		return rand.New(rand.NewSource(12345)), 42
	})
}
