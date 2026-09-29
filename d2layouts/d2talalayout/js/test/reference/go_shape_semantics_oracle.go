package main

import (
	"encoding/json"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/shape"
)

type ShapeOracleOutput struct {
	Metadata           map[string]string          `json:"metadata"`
	RecognizedShapes   []ShapeBehaviorCase        `json:"recognizedShapes"`
	UnsupportedCases   []UnsupportedShapeCase     `json:"unsupportedCases"`
	SameShapeCases     []SameShapeCase            `json:"sameShapeCases"`
}

type ShapeBehaviorCase struct {
	Input          string `json:"input"`
	ShapeType      string `json:"shapeType"`
	IsTable        bool   `json:"isTable"`
	IsClass        bool   `json:"isClass"`
	IsSequenceStep bool   `json:"isSequenceStep"`
	AspectRatio1   bool   `json:"aspectRatio1"`
}

type UnsupportedShapeCase struct {
	InitialShape     string `json:"initialShape"`
	AttemptedShape   string `json:"attemptedShape"`
	ResultShapeType  string `json:"resultShapeType"`
	IsTable          bool   `json:"isTable"`
	IsClass          bool   `json:"isClass"`
	IsSequenceStep   bool   `json:"isSequenceStep"`
	AspectRatio1     bool   `json:"aspectRatio1"`
}

type SameShapeCase struct {
	ShapeA string `json:"shapeA"`
	ShapeB string `json:"shapeB"`
	Result bool   `json:"result"`
}

func main() {
	out := ShapeOracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion":   runtime.Version(),
			"d2BaseCommit":       "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage":   "github.com/d2lang/d2/d2layouts/d2talalayout/internal/nodeshape",
		},
		RecognizedShapes: make([]ShapeBehaviorCase, 0),
		UnsupportedCases: make([]UnsupportedShapeCase, 0),
		SameShapeCases:   make([]SameShapeCase, 0),
	}

	recognizedInputs := []string{
		"",
		shape.CALLOUT_TYPE,
		shape.CIRCLE_TYPE,
		shape.CLOUD_TYPE,
		shape.CYLINDER_TYPE,
		shape.DIAMOND_TYPE,
		shape.DOCUMENT_TYPE,
		shape.HEXAGON_TYPE,
		shape.IMAGE_TYPE,
		shape.OVAL_TYPE,
		shape.PACKAGE_TYPE,
		shape.PAGE_TYPE,
		shape.PARALLELOGRAM_TYPE,
		shape.PERSON_TYPE,
		shape.C4_PERSON_TYPE,
		shape.QUEUE_TYPE,
		shape.REAL_SQUARE_TYPE,
		shape.SQUARE_TYPE,
		shape.STEP_TYPE,
		shape.STORED_DATA_TYPE,
		shape.TEXT_TYPE,
		shape.CLASS_TYPE,
		shape.TABLE_TYPE,
		shape.CODE_TYPE,
	}

	for _, input := range recognizedInputs {
		node := layoutgraph.NewNode(1, 100, 100)
		node.SetShape(input)
		out.RecognizedShapes = append(out.RecognizedShapes, ShapeBehaviorCase{
			Input:          input,
			ShapeType:      node.ShapeType(),
			IsTable:        node.IsTable(),
			IsClass:        node.IsClass(),
			IsSequenceStep: node.IsSequenceStep(),
			AspectRatio1:   node.AspectRatio1(),
		})
	}

	// Unsupported shapes tests
	unsupportedAttempts := []struct {
		initial   string
		attempted string
	}{
		{shape.STEP_TYPE, "unsupported"},
		{shape.STEP_TYPE, "circle"},
		{shape.TABLE_TYPE, "table_invalid"},
		{shape.CIRCLE_TYPE, "non_existent"},
		{shape.CLASS_TYPE, "square"},
	}

	for _, tc := range unsupportedAttempts {
		node := layoutgraph.NewNode(1, 100, 100)
		node.SetShape(tc.initial)
		node.SetShape(tc.attempted)
		out.UnsupportedCases = append(out.UnsupportedCases, UnsupportedShapeCase{
			InitialShape:     tc.initial,
			AttemptedShape:   tc.attempted,
			ResultShapeType:  node.ShapeType(),
			IsTable:          node.IsTable(),
			IsClass:          node.IsClass(),
			IsSequenceStep:   node.IsSequenceStep(),
			AspectRatio1:     node.AspectRatio1(),
		})
	}

	// SameShape comparisons
	sameShapePairs := [][]string{
		{shape.TABLE_TYPE, shape.TABLE_TYPE},
		{shape.CLASS_TYPE, shape.CLASS_TYPE},
		{shape.STEP_TYPE, shape.STEP_TYPE},
		{shape.CIRCLE_TYPE, shape.CIRCLE_TYPE},
		{shape.REAL_SQUARE_TYPE, shape.REAL_SQUARE_TYPE},
		{shape.SQUARE_TYPE, shape.SQUARE_TYPE},
		{"", ""},
		{"", shape.SQUARE_TYPE},
		{shape.TABLE_TYPE, shape.CLASS_TYPE},
		{shape.CIRCLE_TYPE, shape.REAL_SQUARE_TYPE},
		{shape.STEP_TYPE, shape.SQUARE_TYPE},
		{shape.DOCUMENT_TYPE, shape.PAGE_TYPE},
	}

	for _, pair := range sameShapePairs {
		nA := layoutgraph.NewNode(1, 100, 100)
		nA.SetShape(pair[0])
		nB := layoutgraph.NewNode(2, 100, 100)
		nB.SetShape(pair[1])
		out.SameShapeCases = append(out.SameShapeCases, SameShapeCase{
			ShapeA: pair[0],
			ShapeB: pair[1],
			Result: nA.SameShape(nB),
		})
	}

	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "test/fixtures/go-shape-semantics-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	if err := os.WriteFile(outFile, b, 0644); err != nil {
		panic(err)
	}
}
