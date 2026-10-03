package placement

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type slice44OracleData struct {
	RotateAround struct {
		X1 float64 `json:"x1"`
		Y1 float64 `json:"y1"`
		X2 float64 `json:"x2"`
		Y2 float64 `json:"y2"`
	} `json:"rotateAround"`
	Transpose struct {
		FixedRejected      bool `json:"fixedRejected"`
		ThreeEdgesRejected bool `json:"threeEdgesRejected"`
	} `json:"transpose"`
	GapReduction struct {
		IsBetweenMid     bool `json:"isBetweenMid"`
		IsBetweenOutside bool `json:"isBetweenOutside"`
	} `json:"gapReduction"`
	SpatialIndex struct {
		Occupied       bool `json:"occupied"`
		CandidateCount int  `json:"candidateCount"`
	} `json:"spatialIndex"`
}

func TestGenerateSlice44Oracle(t *testing.T) {
	var oracle slice44OracleData
	ctx := context.Background()

	// 1. RotateAround
	g := layoutgraph.NewGraph()
	g.CellSize = 10
	centerNode := layoutgraph.NewNode(1, 20, 20)
	centerNode.TopLeft = geo.NewPoint(50, 50)
	g.AddNode(centerNode)

	orbitNode := layoutgraph.NewNode(2, 20, 20)
	orbitNode.TopLeft = geo.NewPoint(50, 100)
	g.AddNode(orbitNode)

	rotateAround(orbitNode, g, centerNode, 1, false)
	oracle.RotateAround.X1 = orbitNode.TopLeft.X
	oracle.RotateAround.Y1 = orbitNode.TopLeft.Y

	orbitNode.TopLeft = geo.NewPoint(50, 100)
	rotateAround(orbitNode, g, centerNode, 2, false)
	oracle.RotateAround.X2 = orbitNode.TopLeft.X
	oracle.RotateAround.Y2 = orbitNode.TopLeft.Y

	// 2. Transpose guards
	fixedNode := layoutgraph.NewNode(3, 20, 20)
	fixedNode.FixedTopLeft = geo.NewPoint(0, 0)
	g.AddNode(fixedNode)
	res, _ := transpose(ctx, g, fixedNode, nil)
	oracle.Transpose.FixedRejected = !res

	multiEdgeNode := layoutgraph.NewNode(4, 20, 20)
	n5 := layoutgraph.NewNode(5, 20, 20)
	n6 := layoutgraph.NewNode(6, 20, 20)
	n7 := layoutgraph.NewNode(7, 20, 20)
	g.AddNode(multiEdgeNode)
	g.AddNode(n5)
	g.AddNode(n6)
	g.AddNode(n7)
	g.Connect(multiEdgeNode, n5)
	g.Connect(multiEdgeNode, n6)
	g.Connect(multiEdgeNode, n7)
	res2, _ := transpose(ctx, g, multiEdgeNode, nil)
	oracle.Transpose.ThreeEdgesRejected = !res2

	// 3. Gap Reduction isBetween
	behind := layoutgraph.NewNode(8, 20, 20)
	behind.TopLeft = geo.NewPoint(0, 0)

	ahead := layoutgraph.NewNode(9, 20, 20)
	ahead.TopLeft = geo.NewPoint(100, 0)

	mid := layoutgraph.NewNode(10, 20, 20)
	mid.TopLeft = geo.NewPoint(50, 0)

	outside := layoutgraph.NewNode(11, 20, 20)
	outside.TopLeft = geo.NewPoint(150, 0)

	oracle.GapReduction.IsBetweenMid = isBetween(mid, behind, ahead, true, true)
	oracle.GapReduction.IsBetweenOutside = isBetween(outside, behind, ahead, true, true)

	// 4. Spatial Index
	sg := layoutgraph.NewGraph()
	sg.CellSize = 10
	for i := 0; i < 100; i++ {
		sn := layoutgraph.NewNode(layoutgraph.EntityID(i+1), 20, 20)
		sn.TopLeft = geo.NewPoint(float64((i%10)*40), float64((i/10)*40))
		sg.AddNode(sn)
	}
	sIndex := &optimizerSpatialIndex{}
	guard, err := limits.NewOptimizationWorkGuard(ctx, "TestOracle", 10000000)
	if err != nil {
		t.Fatal(err)
	}
	if err := sIndex.rebuild(sg, guard); err != nil {
		t.Fatal(err)
	}
	_, occ, _ := sIndex.isOccupied(sg, geo.NewPoint(0, 0), guard)
	oracle.SpatialIndex.Occupied = occ

	cands, err := sIndex.query(0, 0, 50, 50, guard)
	if err != nil {
		t.Fatal(err)
	}
	oracle.SpatialIndex.CandidateCount = len(cands)

	fixturePath := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice44-reference.json")
	bytes, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, bytes, 0644); err != nil {
		t.Fatal(err)
	}
}
