package layoutgraph

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/lib/geo"
)

type transactionOracleData struct {
	SegmentsCross []struct {
		Name     string `json:"name"`
		Expected bool   `json:"expected"`
	} `json:"segmentsCross"`
	OverlapsExact bool `json:"overlapsExact"`
	CommitSuccess struct {
		FinalX float64 `json:"finalX"`
		FinalY float64 `json:"finalY"`
	} `json:"commitSuccess"`
	CommitOverlapRejected bool `json:"commitOverlapRejected"`
}

func TestGenerateTransactionOracle(t *testing.T) {
	var oracle transactionOracleData

	// 1. SegmentsCross
	s1 := geo.Point{X: 0, Y: 0}
	e1 := geo.Point{X: 100, Y: 100}
	s2 := geo.Point{X: 0, Y: 100}
	e2 := geo.Point{X: 100, Y: 0}
	oracle.SegmentsCross = append(oracle.SegmentsCross, struct {
		Name     string `json:"name"`
		Expected bool   `json:"expected"`
	}{Name: "intersecting_diagonals", Expected: SegmentsCross(&s1, &e1, &s2, &e2)})

	s3 := geo.Point{X: 0, Y: 0}
	e3 := geo.Point{X: 100, Y: 0}
	s4 := geo.Point{X: 0, Y: 50}
	e4 := geo.Point{X: 100, Y: 50}
	oracle.SegmentsCross = append(oracle.SegmentsCross, struct {
		Name     string `json:"name"`
		Expected bool   `json:"expected"`
	}{Name: "parallel_horizontal", Expected: SegmentsCross(&s3, &e3, &s4, &e4)})

	// 2. Overlap detection
	g := NewGraph()
	g.CellSize = 10
	n1 := NewNode(1, 20, 20)
	n1.TopLeft = geo.NewPoint(0, 0)
	g.AddNode(n1)

	n2 := NewNode(2, 20, 20)
	n2.TopLeft = geo.NewPoint(0, 0)
	g.AddNode(n2)

	bad, _ := g.isBadStateContext(nil, nil, false, nil)
	oracle.OverlapsExact = bad

	// 3. Transaction commit
	ctx := context.Background()
	g2 := NewGraph()
	g2.CellSize = 10
	tn1 := NewNode(1, 20, 20)
	tn1.TopLeft = geo.NewPoint(0, 0)
	g2.AddNode(tn1)

	txn, err := g2.NewRequestTransaction(ctx, TransactionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	txn.AddOp(func() error {
		tn1.MoveAbsWithChildren(50, 50)
		return nil
	})
	if err := txn.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	oracle.CommitSuccess.FinalX = tn1.TopLeft.X
	oracle.CommitSuccess.FinalY = tn1.TopLeft.Y

	// 4. Overlap candidate rejection
	tn2 := NewNode(2, 20, 20)
	tn2.TopLeft = geo.NewPoint(100, 100)
	g2.AddNode(tn2)

	txn2, err := g2.NewRequestTransaction(ctx, TransactionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	txn2.AddOp(func() error {
		tn1.MoveAbsWithChildren(100, 100) // overlaps with tn2
		return nil
	})
	commitErr := txn2.Commit(ctx)
	oracle.CommitOverlapRejected = IsCandidateRejection(commitErr)

	fixturePath := filepath.Join("..", "..", "js", "test", "fixtures", "go-transaction-reference.json")
	bytes, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixturePath, bytes, 0644); err != nil {
		t.Fatal(err)
	}
}
