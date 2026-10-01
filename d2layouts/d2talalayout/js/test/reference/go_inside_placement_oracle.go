//go:build tala_inside_geometry_oracle

package main

import (
	"encoding/json"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

type InsidePlacementOracleOutput struct {
	Metadata        map[string]string         `json:"metadata"`
	InsidePlacement []InsidePlacementScenario `json:"insidePlacement"`
	InnerBox        []InnerBoxScenario        `json:"innerBox"`
}

type PointJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type BoxJSON struct {
	TopLeft PointJSON `json:"topLeft"`
	Width   float64   `json:"width"`
	Height  float64   `json:"height"`
}

type SpacingJSON struct {
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
}

type InsidePlacementScenario struct {
	Name          string      `json:"name"`
	Shape         string      `json:"shape"`
	OuterBox      BoxJSON     `json:"outerBox"`
	ContentWidth  float64     `json:"contentWidth"`
	ContentHeight float64     `json:"contentHeight"`
	Padding       SpacingJSON `json:"padding"`
	Point         PointJSON   `json:"point"`
}

type InnerBoxScenario struct {
	Name     string  `json:"name"`
	Shape    string  `json:"shape"`
	OuterBox BoxJSON `json:"outerBox"`
	InnerBox BoxJSON `json:"innerBox"`
}

func makeBox(x, y, w, h float64) geo.Box {
	return *geo.NewBox(geo.NewPoint(x, y), w, h)
}

func boxToJSON(b *geo.Box) BoxJSON {
	return BoxJSON{
		TopLeft: PointJSON{X: b.TopLeft.X, Y: b.TopLeft.Y},
		Width:   b.Width,
		Height:  b.Height,
	}
}

func pointToJSON(p geo.Point) PointJSON {
	return PointJSON{X: p.X, Y: p.Y}
}

func main() {
	out := InsidePlacementOracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion": runtime.Version(),
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"slice":            "Slice 19 — Shape Inner Geometry & Node InsidePlacement",
		},
		InsidePlacement: make([]InsidePlacementScenario, 0),
		InnerBox:        make([]InnerBoxScenario, 0),
	}

	// 1. Mandatory Node.InsidePlacement scenarios
	type ipDef struct {
		name          string
		shapeType     string
		x, y, w, h    float64
		contentW      float64
		contentH      float64
		top, bot, l, r float64
	}

	ipDefs := []ipDef{
		{
			name:      "default_square_zero_padding",
			shapeType: "",
			x:         10, y: 20, w: 100, h: 80,
			contentW: 40, contentH: 30,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "square_uniform_padding",
			shapeType: shape.SQUARE_TYPE,
			x:         10, y: 20, w: 100, h: 80,
			contentW: 40, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "square_asymmetric_padding",
			shapeType: shape.SQUARE_TYPE,
			x:         100, y: 150, w: 200, h: 160,
			contentW: 60, contentH: 40,
			top: 11, bot: 29, l: 7, r: 21,
		},
		{
			name:      "square_fractional",
			shapeType: shape.REAL_SQUARE_TYPE,
			x:         10.25, y: 20.75, w: 100.5, h: 80.5,
			contentW: 40.2, contentH: 30.8,
			top: 5.5, bot: 4.5, l: 3.5, r: 2.5,
		},
		{
			name:      "negative_coordinates",
			shapeType: shape.SQUARE_TYPE,
			x:         -100, y: -200, w: 150, h: 120,
			contentW: 50, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "circle_content_smaller_than_inner",
			shapeType: shape.CIRCLE_TYPE,
			x:         0, y: 0, w: 200, h: 200,
			contentW: 40, contentH: 40,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "circle_content_fills_inner",
			shapeType: shape.CIRCLE_TYPE,
			x:         0, y: 0, w: 200, h: 200,
			contentW: 140, contentH: 140,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "oval",
			shapeType: shape.OVAL_TYPE,
			x:         50, y: 50, w: 300, h: 150,
			contentW: 80, contentH: 40,
			top: 12, bot: 12, l: 12, r: 12,
		},
		{
			name:      "oval_float32_regression",
			shapeType: shape.OVAL_TYPE,
			x:         10, y: 15, w: 333, h: 217,
			contentW: 77, contentH: 55,
			top: 7, bot: 13, l: 9, r: 17,
		},
		{
			name:      "cloud_wide",
			shapeType: shape.CLOUD_TYPE,
			x:         0, y: 0, w: 400, h: 200,
			contentW: 200, contentH: 50,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "cloud_tall",
			shapeType: shape.CLOUD_TYPE,
			x:         0, y: 0, w: 200, h: 400,
			contentW: 50, contentH: 200,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "cloud_square",
			shapeType: shape.CLOUD_TYPE,
			x:         0, y: 0, w: 300, h: 300,
			contentW: 100, contentH: 100,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "page",
			shapeType: shape.PAGE_TYPE,
			x:         0, y: 0, w: 120, h: 50,
			contentW: 40, contentH: 20,
			top: 8, bot: 8, l: 8, r: 8,
		},
		{
			name:      "page_tall",
			shapeType: shape.PAGE_TYPE,
			x:         0, y: 0, w: 120, h: 200,
			contentW: 40, contentH: 20,
			top: 8, bot: 8, l: 8, r: 8,
		},
		{
			name:      "step",
			shapeType: shape.STEP_TYPE,
			x:         0, y: 0, w: 200, h: 100,
			contentW: 50, contentH: 30,
			top: 6, bot: 6, l: 6, r: 6,
		},
		{
			name:      "step_narrow",
			shapeType: shape.STEP_TYPE,
			x:         0, y: 0, w: 50, h: 100,
			contentW: 20, contentH: 30,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "queue",
			shapeType: shape.QUEUE_TYPE,
			x:         0, y: 0, w: 250, h: 100,
			contentW: 60, contentH: 40,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "queue_narrow",
			shapeType: shape.QUEUE_TYPE,
			x:         0, y: 0, w: 30, h: 50,
			contentW: 10, contentH: 20,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "hexagon",
			shapeType: shape.HEXAGON_TYPE,
			x:         0, y: 0, w: 180, h: 120,
			contentW: 50, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "diamond",
			shapeType: shape.DIAMOND_TYPE,
			x:         0, y: 0, w: 200, h: 200,
			contentW: 40, contentH: 40,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "document",
			shapeType: shape.DOCUMENT_TYPE,
			x:         0, y: 0, w: 150, h: 100,
			contentW: 50, contentH: 30,
			top: 8, bot: 8, l: 8, r: 8,
		},
		{
			name:      "cylinder",
			shapeType: shape.CYLINDER_TYPE,
			x:         0, y: 0, w: 160, h: 200,
			contentW: 60, contentH: 40,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "cylinder_short",
			shapeType: shape.CYLINDER_TYPE,
			x:         0, y: 0, w: 100, h: 30,
			contentW: 20, contentH: 10,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "stored_data",
			shapeType: shape.STORED_DATA_TYPE,
			x:         0, y: 0, w: 180, h: 100,
			contentW: 50, contentH: 30,
			top: 8, bot: 8, l: 8, r: 8,
		},
		{
			name:      "parallelogram",
			shapeType: shape.PARALLELOGRAM_TYPE,
			x:         0, y: 0, w: 220, h: 110,
			contentW: 60, contentH: 40,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "callout",
			shapeType: shape.CALLOUT_TYPE,
			x:         0, y: 0, w: 200, h: 150,
			contentW: 50, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "callout_short",
			shapeType: shape.CALLOUT_TYPE,
			x:         0, y: 0, w: 200, h: 60,
			contentW: 40, contentH: 20,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "person",
			shapeType: shape.PERSON_TYPE,
			x:         0, y: 0, w: 150, h: 200,
			contentW: 40, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "c4_person",
			shapeType: shape.C4_PERSON_TYPE,
			x:         0, y: 0, w: 150, h: 200,
			contentW: 40, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "package",
			shapeType: shape.PACKAGE_TYPE,
			x:         0, y: 0, w: 200, h: 150,
			contentW: 50, contentH: 30,
			top: 10, bot: 10, l: 10, r: 10,
		},
		{
			name:      "rounding_half_negative_x",
			shapeType: shape.SQUARE_TYPE,
			x:         -10.5, y: -20.5, w: 100, h: 80,
			contentW: 30, contentH: 20,
			top: 0, bot: 0, l: 0, r: 0,
		},
		{
			name:      "rounding_half_positive",
			shapeType: shape.SQUARE_TYPE,
			x:         10.5, y: 20.5, w: 100, h: 80,
			contentW: 30, contentH: 20,
			top: 0, bot: 0, l: 0, r: 0,
		},
	}

	for _, tc := range ipDefs {
		node := layoutgraph.NewNode(1, tc.w, tc.h)
		node.TopLeft = geo.NewPoint(tc.x, tc.y)
		node.SetShape(tc.shapeType)

		spacing := layoutgraph.OracleSpacing(tc.top, tc.bot, tc.l, tc.r)
		pt := node.InsidePlacement(tc.contentW, tc.contentH, spacing)

		box := makeBox(tc.x, tc.y, tc.w, tc.h)
		out.InsidePlacement = append(out.InsidePlacement, InsidePlacementScenario{
			Name:          tc.name,
			Shape:         tc.shapeType,
			OuterBox:      boxToJSON(&box),
			ContentWidth:  tc.contentW,
			ContentHeight: tc.contentH,
			Padding: SpacingJSON{
				Top:    tc.top,
				Bottom: tc.bot,
				Left:   tc.l,
				Right:  tc.r,
			},
			Point: pointToJSON(pt),
		})
	}

	// 2. Mandatory Node.InnerBox scenarios for EVERY recognized shape
	allShapes := []struct {
		name      string
		shapeType string
		x, y, w, h float64
	}{
		{"default", "", 10, 20, 100, 80},
		{"Square", shape.SQUARE_TYPE, 10, 20, 100, 80},
		{"RealSquare", shape.REAL_SQUARE_TYPE, 10, 20, 80, 80},
		{"Circle", shape.CIRCLE_TYPE, 0, 0, 200, 200},
		{"Oval", shape.OVAL_TYPE, 50, 50, 300, 150},
		{"Cloud", shape.CLOUD_TYPE, 0, 0, 400, 200},
		{"Page", shape.PAGE_TYPE, 0, 0, 120, 200},
		{"Page_short", shape.PAGE_TYPE, 0, 0, 120, 50},
		{"Step", shape.STEP_TYPE, 0, 0, 200, 100},
		{"Step_narrow", shape.STEP_TYPE, 0, 0, 50, 100},
		{"Queue", shape.QUEUE_TYPE, 0, 0, 250, 100},
		{"Queue_narrow", shape.QUEUE_TYPE, 0, 0, 30, 50},
		{"Hexagon", shape.HEXAGON_TYPE, 0, 0, 180, 120},
		{"Diamond", shape.DIAMOND_TYPE, 0, 0, 200, 200},
		{"Document", shape.DOCUMENT_TYPE, 0, 0, 150, 100},
		{"Cylinder", shape.CYLINDER_TYPE, 0, 0, 160, 200},
		{"Cylinder_short", shape.CYLINDER_TYPE, 0, 0, 100, 30},
		{"StoredData", shape.STORED_DATA_TYPE, 0, 0, 180, 100},
		{"Parallelogram", shape.PARALLELOGRAM_TYPE, 0, 0, 220, 110},
		{"Callout", shape.CALLOUT_TYPE, 0, 0, 200, 150},
		{"Callout_short", shape.CALLOUT_TYPE, 0, 0, 200, 60},
		{"Person", shape.PERSON_TYPE, 0, 0, 150, 200},
		{"C4Person", shape.C4_PERSON_TYPE, 0, 0, 150, 200},
		{"Package", shape.PACKAGE_TYPE, 0, 0, 200, 150},
		{"Image", shape.IMAGE_TYPE, 10, 20, 120, 80},
		{"Table", shape.TABLE_TYPE, 10, 20, 120, 80},
		{"Class", shape.CLASS_TYPE, 10, 20, 120, 80},
		{"Text", shape.TEXT_TYPE, 10, 20, 120, 80},
		{"Code", shape.CODE_TYPE, 10, 20, 120, 80},
		{"Rounding_half_negative", shape.SQUARE_TYPE, -10.5, -20.5, 99.5, 89.5},
		{"Rounding_half_positive", shape.SQUARE_TYPE, 10.5, 20.5, 99.5, 89.5},
	}

	for _, sc := range allShapes {
		node := layoutgraph.NewNode(1, sc.w, sc.h)
		node.TopLeft = geo.NewPoint(sc.x, sc.y)
		node.SetShape(sc.shapeType)

		ib := node.InnerBox()
		box := makeBox(sc.x, sc.y, sc.w, sc.h)

		out.InnerBox = append(out.InnerBox, InnerBoxScenario{
			Name:     sc.name,
			Shape:    sc.shapeType,
			OuterBox: boxToJSON(&box),
			InnerBox: boxToJSON(ib),
		})
	}

	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "test/fixtures/go-inside-placement-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	if err := os.WriteFile(outFile, b, 0644); err != nil {
		panic(err)
	}
}
