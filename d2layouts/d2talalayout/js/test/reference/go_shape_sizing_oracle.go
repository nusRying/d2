//go:build tala_inside_geometry_oracle

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
	"github.com/d2lang/d2/lib/shape"
)

type ShapeSizingOracleOutput struct {
	Metadata           map[string]string          `json:"metadata"`
	GetDimensionsToFit []DimensionsToFitScenario  `json:"getDimensionsToFit"`
	FitToBoundingBox   []FitToBoundingBoxScenario `json:"fitToBoundingBox"`
}

type PointJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type SpacingJSON struct {
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
}

type LabelJSON struct {
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Position int     `json:"position"`
}

type DimensionsToFitScenario struct {
	Name      string  `json:"name"`
	Shape     string  `json:"shape"`
	Width     float64 `json:"width"`
	Height    float64 `json:"height"`
	PaddingX  float64 `json:"paddingX"`
	PaddingY  float64 `json:"paddingY"`
	FitWidth  float64 `json:"fitWidth"`
	FitHeight float64 `json:"fitHeight"`
}

type FitToBoundingBoxScenario struct {
	Name          string      `json:"name"`
	Shape         string      `json:"shape"`
	TL            *PointJSON  `json:"tl"`
	BR            *PointJSON  `json:"br"`
	Padding       SpacingJSON `json:"padding"`
	Label         *LabelJSON  `json:"label"`
	DesiredWidth  *float64    `json:"desiredWidth"`
	DesiredHeight *float64    `json:"desiredHeight"`
	HasTopLeft    bool        `json:"hasTopLeft"`
	Panicked      bool        `json:"panicked"`
	BeforeWidth   float64     `json:"beforeWidth"`
	BeforeHeight  float64     `json:"beforeHeight"`
	AfterWidth    float64     `json:"afterWidth"`
	AfterHeight   float64     `json:"afterHeight"`
}

func main() {
	out := ShapeSizingOracleOutput{
		Metadata: map[string]string{
			"slice":            "Slice 21 — Shape Sizing & FitToBoundingBox",
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoVersion": runtime.Version(),
		},
		GetDimensionsToFit: make([]DimensionsToFitScenario, 0),
		FitToBoundingBox:   make([]FitToBoundingBoxScenario, 0),
	}

	// 1. Mandatory GetDimensionsToFit scenarios (Section 41)
	shapes := []string{
		"", // default
		shape.SQUARE_TYPE,
		shape.REAL_SQUARE_TYPE,
		shape.CIRCLE_TYPE,
		shape.OVAL_TYPE,
		shape.CLOUD_TYPE,
		shape.PAGE_TYPE,
		shape.STEP_TYPE,
		shape.QUEUE_TYPE,
		shape.HEXAGON_TYPE,
		shape.DIAMOND_TYPE,
		shape.DOCUMENT_TYPE,
		shape.CYLINDER_TYPE,
		shape.STORED_DATA_TYPE,
		shape.PARALLELOGRAM_TYPE,
		shape.CALLOUT_TYPE,
		shape.PERSON_TYPE,
		shape.C4_PERSON_TYPE,
		shape.PACKAGE_TYPE,
		shape.IMAGE_TYPE,
		shape.TABLE_TYPE,
		shape.CLASS_TYPE,
		shape.TEXT_TYPE,
		shape.CODE_TYPE,
	}

	for _, sh := range shapes {
		name := sh
		if name == "" {
			name = "default"
		}
		node := layoutgraph.NewNode(1, 100, 100)
		node.SetShape(sh)
		fw, fh := node.GetDimensionsToFit(120, 80, 20, 16)
		out.GetDimensionsToFit = append(out.GetDimensionsToFit, DimensionsToFitScenario{
			Name:      name,
			Shape:     sh,
			Width:     120,
			Height:    80,
			PaddingX:  20,
			PaddingY:  16,
			FitWidth:  fw,
			FitHeight: fh,
		})
	}

	// Special branches for GetDimensionsToFit
	specialDTF := []struct {
		name string
		sh   string
		w, h float64
		padX float64
		padY float64
	}{
		{"oval_float32_regression", shape.OVAL_TYPE, 16.2, 28.3, 6.5, 6.5},
		{"oval_wide_limit", shape.OVAL_TYPE, 500, 50, 10, 10},
		{"oval_tall_limit", shape.OVAL_TYPE, 50, 500, 10, 10},
		{"cloud_wide", shape.CLOUD_TYPE, 300, 100, 10, 10},
		{"cloud_tall", shape.CLOUD_TYPE, 100, 300, 10, 10},
		{"cloud_square", shape.CLOUD_TYPE, 200, 200, 10, 10},
		{"page_short", shape.PAGE_TYPE, 100, 30, 10, 10},
		{"page_tall", shape.PAGE_TYPE, 100, 100, 10, 10},
		{"page_minimum_dimensions", shape.PAGE_TYPE, 5, 5, 2, 2},
		{"callout_short", shape.CALLOUT_TYPE, 100, 20, 10, 10},
		{"callout_tall", shape.CALLOUT_TYPE, 100, 50, 10, 10},
		{"person_wide_limit", shape.PERSON_TYPE, 300, 60, 10, 10},
		{"person_tall_limit", shape.PERSON_TYPE, 60, 300, 10, 10},
		{"c4_person_min_height", shape.C4_PERSON_TYPE, 100, 20, 10, 10},
		{"c4_person_aspect_limit", shape.C4_PERSON_TYPE, 50, 300, 10, 10},
		{"package_uncapped", shape.PACKAGE_TYPE, 100, 60, 10, 10},
		{"package_top_cap", shape.PACKAGE_TYPE, 100, 300, 10, 10},
		{"queue_small_content", shape.QUEUE_TYPE, 5, 5, 2, 2},
		{"cylinder_small_content", shape.CYLINDER_TYPE, 5, 5, 2, 2},
		{"fractional_dimensions", shape.SQUARE_TYPE, 123.45, 67.89, 11.11, 22.22},
		{"negative_dimensions", shape.SQUARE_TYPE, -20, -10, 5, 5},
		{"zero_dimensions", shape.SQUARE_TYPE, 0, 0, 0, 0},
	}

	for _, tc := range specialDTF {
		node := layoutgraph.NewNode(1, 100, 100)
		node.SetShape(tc.sh)
		fw, fh := node.GetDimensionsToFit(tc.w, tc.h, tc.padX, tc.padY)
		out.GetDimensionsToFit = append(out.GetDimensionsToFit, DimensionsToFitScenario{
			Name:      tc.name,
			Shape:     tc.sh,
			Width:     tc.w,
			Height:    tc.h,
			PaddingX:  tc.padX,
			PaddingY:  tc.padY,
			FitWidth:  fw,
			FitHeight: fh,
		})
	}

	// 2. Mandatory FitToBoundingBox scenarios (Section 42)
	runFit := func(
		name string,
		sh string,
		tl *geo.Point,
		br *geo.Point,
		top, bottom, left, right float64,
		lbl *layoutgraph.Label,
		desiredW *float64,
		desiredH *float64,
		hasTopLeft bool,
	) {
		node := layoutgraph.NewNode(1, 40, 30)
		node.SetShape(sh)
		if !hasTopLeft {
			node.TopLeft = nil
		}
		if lbl != nil {
			node.Label = lbl
		}
		node.DesiredWidth = desiredW
		node.DesiredHeight = desiredH

		spacing := layoutgraph.OracleSpacing(top, bottom, left, right)

		beforeW := node.Width
		beforeH := node.Height

		panicked := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
				}
			}()
			node.FitToBoundingBox(tl, br, spacing)
		}()

		var tlJSON *PointJSON
		if tl != nil {
			tlJSON = &PointJSON{X: tl.X, Y: tl.Y}
		}
		var brJSON *PointJSON
		if br != nil {
			brJSON = &PointJSON{X: br.X, Y: br.Y}
		}

		var lblJSON *LabelJSON
		if lbl != nil {
			lblJSON = &LabelJSON{
				Width:    lbl.Width,
				Height:   lbl.Height,
				Position: int(lbl.Position),
			}
		}

		out.FitToBoundingBox = append(out.FitToBoundingBox, FitToBoundingBoxScenario{
			Name:          name,
			Shape:         sh,
			TL:            tlJSON,
			BR:            brJSON,
			Padding:       SpacingJSON{Top: top, Bottom: bottom, Left: left, Right: right},
			Label:         lblJSON,
			DesiredWidth:  desiredW,
			DesiredHeight: desiredH,
			HasTopLeft:    hasTopLeft,
			Panicked:      panicked,
			BeforeWidth:   beforeW,
			BeforeHeight:  beforeH,
			AfterWidth:    node.Width,
			AfterHeight:   node.Height,
		})
	}

	ptr := func(v float64) *float64 { return &v }

	// square_no_label
	runFit("square_no_label", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 100), 0, 0, 0, 0, nil, nil, nil, true)

	// square_uniform_padding
	runFit("square_uniform_padding", shape.SQUARE_TYPE, geo.NewPoint(10, 10), geo.NewPoint(110, 110), 20, 20, 20, 20, nil, nil, nil, true)

	// square_asymmetric_padding
	runFit("square_asymmetric_padding", shape.SQUARE_TYPE, geo.NewPoint(10, 20), geo.NewPoint(150, 120), 5, 15, 10, 25, nil, nil, nil, true)

	// inside_label_expands_both
	runFit("inside_label_expands_both", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 120, Height: 80, Position: label.InsideMiddleCenter}, nil, nil, true)

	// unset_label_expands
	runFit("unset_label_expands", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 100, Height: 70, Position: label.Unset}, nil, nil, true)

	// outside_label_ignored
	runFit("outside_label_ignored", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 200, Height: 150, Position: label.OutsideTopLeft}, nil, nil, true)

	// desired_width_suppresses_label_min
	runFit("desired_width_suppresses_label_min", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 300, Height: 50, Position: label.InsideTopLeft}, ptr(60), nil, true)

	// desired_height_suppresses_label_min
	runFit("desired_height_suppresses_label_min", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 50, Height: 300, Position: label.InsideTopLeft}, nil, ptr(60), true)

	// desired_width_larger_wins
	runFit("desired_width_larger_wins", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 100), 0, 0, 0, 0,
		nil, ptr(500), nil, true)

	// desired_height_larger_wins
	runFit("desired_height_larger_wins", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 100), 0, 0, 0, 0,
		nil, nil, ptr(400), true)

	// desired_width_smaller_loses_to_fit
	runFit("desired_width_smaller_loses_to_fit", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 100), 0, 0, 0, 0,
		nil, ptr(20), nil, true)

	// desired_height_smaller_loses_to_fit
	runFit("desired_height_smaller_loses_to_fit", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 100), 0, 0, 0, 0,
		nil, nil, ptr(30), true)

	// desired_width_zero_is_non_nil
	runFit("desired_width_zero_is_non_nil", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(50, 50), 0, 0, 0, 0,
		&layoutgraph.Label{Width: 200, Height: 50, Position: label.InsideTopLeft}, ptr(0), nil, true)

	// real_square_fit
	runFit("real_square_fit", shape.REAL_SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(120, 80), 10, 10, 10, 10, nil, nil, nil, true)

	// circle_fit
	runFit("circle_fit", shape.CIRCLE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 60), 10, 10, 10, 10, nil, nil, nil, true)

	// oval_fit
	runFit("oval_fit", shape.OVAL_TYPE, geo.NewPoint(0, 0), geo.NewPoint(120, 80), 10, 10, 10, 10, nil, nil, nil, true)

	// cloud_fit
	runFit("cloud_fit", shape.CLOUD_TYPE, geo.NewPoint(0, 0), geo.NewPoint(150, 80), 10, 10, 10, 10, nil, nil, nil, true)

	// page_fit
	runFit("page_fit", shape.PAGE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(80, 40), 5, 5, 5, 5, nil, nil, nil, true)

	// fractional_bounds
	runFit("fractional_bounds", shape.SQUARE_TYPE, geo.NewPoint(10.5, 20.25), geo.NewPoint(115.75, 85.5), 3.3, 4.4, 5.5, 6.6, nil, nil, nil, true)

	// inverted_bounds
	runFit("inverted_bounds", shape.SQUARE_TYPE, geo.NewPoint(150, 200), geo.NewPoint(50, 80), 10, 10, 10, 10, nil, nil, nil, true)

	// null_node_top_left_still_succeeds
	runFit("null_node_top_left_still_succeeds", shape.SQUARE_TYPE, geo.NewPoint(0, 0), geo.NewPoint(100, 80), 10, 10, 10, 10, nil, nil, nil, false)

	// nil_tl_panics
	runFit("nil_tl_panics", shape.SQUARE_TYPE, nil, geo.NewPoint(100, 100), 0, 0, 0, 0, nil, nil, nil, true)

	// nil_br_panics
	runFit("nil_br_panics", shape.SQUARE_TYPE, geo.NewPoint(0, 0), nil, 0, 0, 0, 0, nil, nil, nil, true)

	// Output serialization
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling JSON: %v\n", err)
		os.Exit(1)
	}

	// Always ensure trailing newline
	bytes = append(bytes, '\n')

	outPath := filepath.Join("test", "fixtures", "go-shape-sizing-reference.json")
	if err := os.WriteFile(outPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing fixture: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d GetDimensionsToFit and %d FitToBoundingBox scenarios at %s (%d bytes)\n",
		len(out.GetDimensionsToFit), len(out.FitToBoundingBox), outPath, len(bytes))
}
