package placement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type slice43Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type slice43Pair struct {
	From uint64 `json:"from"`
	To   uint64 `json:"to"`
}

type slice43Node struct {
	ID uint64  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type slice43Oracle struct {
	DeltaTo      map[string]int `json:"deltaTo"`
	Visibility   []slice43Pair  `json:"visibility"`
	Candidates   []slice43Point `json:"candidates"`
	MoveNodeBest struct {
		Changed bool    `json:"changed"`
		X       float64 `json:"x"`
		Y       float64 `json:"y"`
		Used    uint64  `json:"used"`
	} `json:"moveNodeBest"`
	Compaction       []slice43Node `json:"compaction"`
	Transition       []slice43Node `json:"transition"`
	OrderedAlongAxis struct {
		Horizontal []uint64 `json:"horizontal"`
		Vertical   []uint64 `json:"vertical"`
	} `json:"orderedAlongAxis"`
	NearestFrom struct {
		HorizontalSized  uint64 `json:"horizontalSized"`
		FirstOccurrence  uint64 `json:"firstOccurrence"`
		VerticalSizeless uint64 `json:"verticalSizeless"`
	} `json:"nearestFrom"`
	CompactionFloor struct {
		HorizontalSized    float64 `json:"horizontalSized"`
		HorizontalSizeless float64 `json:"horizontalSizeless"`
		PaddingBoundary    float64 `json:"paddingBoundary"`
		VerticalSized      float64 `json:"verticalSized"`
	} `json:"compactionFloor"`
	InflateAlongAxis struct {
		Normal     []slice43Node `json:"normal"`
		Transition []slice43Node `json:"transition"`
	} `json:"inflateAlongAxis"`
	OptimizerDoesOverlap struct {
		Overlaps bool `json:"overlaps"`
		FarAway  bool `json:"farAway"`
		Excluded bool `json:"excluded"`
	} `json:"optimizerDoesOverlap"`
	OptimizerIsOccupied struct {
		OccupiedID uint64 `json:"occupiedId"`
		Occupied   bool   `json:"occupied"`
		Unoccupied bool   `json:"unoccupied"`
	} `json:"optimizerIsOccupied"`
	OptimizerCanMove struct {
		SamePoint bool `json:"samePoint"`
		Occupied  bool `json:"occupied"`
		Overlaps  bool `json:"overlaps"`
		Clear     bool `json:"clear"`
	} `json:"optimizerCanMove"`
	ShiftSubgraphs struct {
		MovesChanged        bool          `json:"movesChanged"`
		MovesPositions      []slice43Node `json:"movesPositions"`
		WontChangeChanged   bool          `json:"wontChangeChanged"`
		WontChangePositions []slice43Node `json:"wontChangePositions"`
	} `json:"shiftSubgraphs"`
	CompactAlongAxis struct {
		Changed   bool          `json:"changed"`
		Positions []slice43Node `json:"positions"`
		Used      uint64        `json:"used"`
	} `json:"compactAlongAxis"`
	ExactWorkBoundary struct {
		W             uint64        `json:"w"`
		FirstPassWork uint64        `json:"firstPassWork"`
		Positions     []slice43Node `json:"positions"`
	} `json:"exactWorkBoundary"`
	NumAdjacent struct {
		EdgeCountSemantics      int `json:"edgeCountSemantics"`
		UniqueExternalNeighbors int `json:"uniqueExternalNeighbors"`
	} `json:"numAdjacent"`
}

func slice43Positions(g *layoutgraph.Graph) []slice43Node {
	out := make([]slice43Node, 0, len(g.Nodes))
	for _, node := range g.Nodes {
		out = append(out, slice43Node{ID: uint64(node.ID), X: node.TopLeft.X, Y: node.TopLeft.Y})
	}
	return out
}

func TestSlice43CompactionOracle(t *testing.T) {
	if os.Getenv("TALA_SLICE43_ORACLE") != "1" {
		return
	}
	ctx := context.Background()
	var out slice43Oracle
	out.DeltaTo = map[string]int{}

	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 10, 10)
		a.TopLeft = geo.NewPoint(0, 0)
		b := layoutgraph.NewNode(2, 10, 10)
		b.TopLeft = geo.NewPoint(100, 0)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.CellSize = 10
		out.DeltaTo["disconnected"] = a.DeltaTo(b, a.TopLeft)
		e := g.Connect(a, b)
		out.DeltaTo["connected"] = a.DeltaTo(b, a.TopLeft)
		e.MinWidth = 90
		out.DeltaTo["min_width_90"] = a.DeltaTo(b, a.TopLeft)
	}

	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 4, 6)
		a.TopLeft = geo.NewPoint(0, 4)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 6, 4)
		b.TopLeft = geo.NewPoint(12, 8)
		g.AddNode(b)
		c := layoutgraph.NewNode(3, 9, 5)
		c.TopLeft = geo.NewPoint(25, 5)
		g.AddNode(c)
		d := layoutgraph.NewNode(4, 9, 6)
		d.TopLeft = geo.NewPoint(38, 1)
		g.AddNode(d)
		edges, err := visibilityEdges(ctx, g, true, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, edge := range edges {
			out.Visibility = append(out.Visibility, slice43Pair{From: uint64(edge.From.ID), To: uint64(edge.To.ID)})
		}
	}

	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1, 10, 10)
		a.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 10, 10)
		b.TopLeft = geo.NewPoint(100, 0)
		g.AddNode(b)
		g.Connect(a, b)
		v := layoutgraph.Edges{layoutgraph.NewEdge(a, b)}
		points, err := candidateMoves(ctx, g, b, 1, true, true, 0, v)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range points {
			out.Candidates = append(out.Candidates, slice43Point{X: p.X, Y: p.Y})
		}
	}

	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1, 10, 10)
		a.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 10, 10)
		b.TopLeft = geo.NewPoint(100, 0)
		g.AddNode(b)
		g.Connect(a, b)
		guard, err := limits.NewOptimizationWorkGuard(ctx, "oracleMove", limits.MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		points := []*geo.Point{geo.NewPoint(20, 0), geo.NewPoint(40, 0), geo.NewPoint(100, 0)}
		changed, err := moveNodeToBest(ctx, g, b, points, nil, true, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.MoveNodeBest.Changed = changed
		out.MoveNodeBest.X = b.TopLeft.X
		out.MoveNodeBest.Y = b.TopLeft.Y
		out.MoveNodeBest.Used = guard.Used()
	}

	newCompactionGraph := func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1, 10, 10)
		a.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 10, 10)
		b.TopLeft = geo.NewPoint(100, 0)
		g.AddNode(b)
		c := layoutgraph.NewNode(3, 10, 10)
		c.TopLeft = geo.NewPoint(200, 0)
		g.AddNode(c)
		g.Connect(a, b)
		g.Connect(b, c)
		return g
	}
	{
		g := newCompactionGraph()
		if err := compaction(ctx, g, compactionOptions{axis: horizontalAxis, includeSizes: true, factor: 1}); err != nil {
			t.Fatal(err)
		}
		out.Compaction = slice43Positions(g)
	}
	{
		g := newCompactionGraph()
		if err := compaction(ctx, g, compactionOptions{axis: horizontalAxis, includeSizes: true, factor: 1, transition: true}); err != nil {
			t.Fatal(err)
		}
		out.Transition = slice43Positions(g)
	}

	// 1. orderedAlongAxis
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(20, 50)
		g.AddNode(n1)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(10, 80)
		g.AddNode(n2)
		n3 := layoutgraph.NewNode(3, 10, 10)
		n3.TopLeft = geo.NewPoint(10, 20)
		g.AddNode(n3)
		n4 := layoutgraph.NewNode(4, 10, 10)
		n4.TopLeft = geo.NewPoint(40, 20)
		g.AddNode(n4)
		hOrdered := orderedAlongAxis(g, true)
		vOrdered := orderedAlongAxis(g, false)
		for _, n := range hOrdered {
			out.OrderedAlongAxis.Horizontal = append(out.OrderedAlongAxis.Horizontal, uint64(n.ID))
		}
		for _, n := range vOrdered {
			out.OrderedAlongAxis.Vertical = append(out.OrderedAlongAxis.Vertical, uint64(n.ID))
		}
	}

	// 2. nearestFrom
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(99, 10, 10)
		target.TopLeft = geo.NewPoint(100, 100)
		g.AddNode(target)
		other := layoutgraph.NewNode(98, 10, 10)
		other.TopLeft = geo.NewPoint(100, 100)
		g.AddNode(other)

		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(10, 0)
		g.AddNode(n1)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(10, 0)
		g.AddNode(n2)
		n3 := layoutgraph.NewNode(3, 10, 10)
		n3.TopLeft = geo.NewPoint(5, 0)
		g.AddNode(n3)
		n4 := layoutgraph.NewNode(4, 10, 10)
		n4.TopLeft = geo.NewPoint(50, 0)
		g.AddNode(n4)

		edges := layoutgraph.Edges{
			layoutgraph.NewEdge(n1, target),
			layoutgraph.NewEdge(n2, target), // equal trailing to n1; strict > means n1 retained
			layoutgraph.NewEdge(n3, target),
			layoutgraph.NewEdge(n4, other), // edge.To != target, ignored
		}
		nearH := nearestFrom(edges, target, true, true)
		out.NearestFrom.HorizontalSized = uint64(nearH.ID)
		out.NearestFrom.FirstOccurrence = uint64(nearH.ID)

		n1.TopLeft.Y = 10
		n3.TopLeft.Y = 30
		nearV := nearestFrom(edges, target, false, false)
		out.NearestFrom.VerticalSizeless = uint64(nearV.ID)
	}

	// 3. compactionFloor
	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		anchor := layoutgraph.NewNode(1, 20, 30)
		anchor.TopLeft = geo.NewPoint(15, 25)
		g.AddNode(anchor)
		out.CompactionFloor.HorizontalSized = compactionFloor(g, anchor, 1.5, true, true, 5)
		out.CompactionFloor.HorizontalSizeless = compactionFloor(g, anchor, 1.5, true, false, 5)
		out.CompactionFloor.PaddingBoundary = compactionFloor(g, anchor, 1.5, true, true, 20)
		out.CompactionFloor.VerticalSized = compactionFloor(g, anchor, 2.0, false, true, 10)
	}

	// 4. inflateAlongAxis
	{
		newInflateGraph := func() (*layoutgraph.Graph, *layoutgraph.Node, *layoutgraph.Node) {
			g := layoutgraph.NewGraph()
			g.CellSize = 10
			a := layoutgraph.NewNode(1, 10, 10)
			a.TopLeft = geo.NewPoint(0, 0)
			g.AddNode(a)
			b := layoutgraph.NewNode(2, 10, 10)
			b.TopLeft = geo.NewPoint(5, 0)
			g.AddNode(b)
			g.Connect(a, b)
			return g, a, b
		}
		g1, a1, b1 := newInflateGraph()
		v1 := layoutgraph.Edges{layoutgraph.NewEdge(a1, b1)}
		inflateAlongAxis(g1, true, true, 1.0, v1, false)
		out.InflateAlongAxis.Normal = slice43Positions(g1)

		g2, a2, b2 := newInflateGraph()
		v2 := layoutgraph.Edges{layoutgraph.NewEdge(a2, b2)}
		inflateAlongAxis(g2, true, true, 1.0, v2, true)
		out.InflateAlongAxis.Transition = slice43Positions(g2)
	}

	// 5. optimizerDoesOverlap
	{
		g := layoutgraph.NewGraph()
		guard, err := limits.NewOptimizationWorkGuard(ctx, "testOverlap", limits.MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		a := layoutgraph.NewNode(1, 20, 20)
		a.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 20, 20)
		b.TopLeft = geo.NewPoint(100, 0)
		g.AddNode(b)

		ov1, err := optimizerDoesOverlap(a, geo.NewPoint(90, 0), nil, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerDoesOverlap.Overlaps = ov1

		ov2, err := optimizerDoesOverlap(a, geo.NewPoint(300, 0), nil, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerDoesOverlap.FarAway = ov2

		ov3, err := optimizerDoesOverlap(a, geo.NewPoint(90, 0), []*layoutgraph.Node{b}, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerDoesOverlap.Excluded = ov3
	}

	// 6. optimizerIsOccupied
	{
		g := layoutgraph.NewGraph()
		guard, err := limits.NewOptimizationWorkGuard(ctx, "testOccupied", limits.MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		a := layoutgraph.NewNode(1, 20, 20)
		a.TopLeft = geo.NewPoint(10, 20)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 20, 20)
		b.TopLeft = geo.NewPoint(50, 60)
		g.AddNode(b)

		occNode, occ, err := optimizerIsOccupied(g, geo.NewPoint(10, 20), guard)
		if err != nil {
			t.Fatal(err)
		}
		if occNode != nil {
			out.OptimizerIsOccupied.OccupiedID = uint64(occNode.ID)
		}
		out.OptimizerIsOccupied.Occupied = occ

		_, unocc, err := optimizerIsOccupied(g, geo.NewPoint(15, 20), guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerIsOccupied.Unoccupied = !unocc
	}

	// 7. optimizerCanMove
	{
		g := layoutgraph.NewGraph()
		guard, err := limits.NewOptimizationWorkGuard(ctx, "testCanMove", limits.MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		a := layoutgraph.NewNode(1, 20, 20)
		a.TopLeft = geo.NewPoint(10, 20)
		g.AddNode(a)
		b := layoutgraph.NewNode(2, 20, 20)
		b.TopLeft = geo.NewPoint(50, 60)
		g.AddNode(b)

		cmSame, err := optimizerCanMove(a, geo.NewPoint(10, 20), true, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerCanMove.SamePoint = cmSame

		cmOcc, err := optimizerCanMove(a, geo.NewPoint(50, 60), true, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerCanMove.Occupied = cmOcc

		cmOver, err := optimizerCanMove(a, geo.NewPoint(45, 55), true, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerCanMove.Overlaps = cmOver

		cmClear, err := optimizerCanMove(a, geo.NewPoint(200, 200), true, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.OptimizerCanMove.Clear = cmClear
	}

	// 8. shiftSubgraphs
	{
		g1 := layoutgraph.NewGraph()
		g1.CellSize = 10
		a1 := layoutgraph.NewNode(1, 10, 10)
		a1.TopLeft = geo.NewPoint(0, 0)
		g1.AddNode(a1)
		b1 := layoutgraph.NewNode(2, 10, 10)
		b1.TopLeft = geo.NewPoint(100, 100)
		g1.AddNode(b1)
		g1.Connect(a1, b1)
		vEdges1, err := visibilityEdges(ctx, g1, true, true)
		if err != nil {
			t.Fatal(err)
		}
		changed1, err := shiftSubgraphs(ctx, g1, true, true, 1.0, nil, vEdges1)
		if err != nil {
			t.Fatal(err)
		}
		out.ShiftSubgraphs.MovesChanged = changed1
		out.ShiftSubgraphs.MovesPositions = slice43Positions(g1)

		g2 := layoutgraph.NewGraph()
		n15 := g2.AddNode(layoutgraph.NewNode(15, 49.0, 60.0))
		n15.TopLeft = geo.NewPoint(-180.0, -60.0)
		n19 := g2.AddNode(layoutgraph.NewNode(19, 52.0, 46.0))
		n19.TopLeft = geo.NewPoint(-180.0, 60.0)
		n21 := g2.AddNode(layoutgraph.NewNode(21, 57.0, 57.0))
		n21.TopLeft = geo.NewPoint(540.0, 180.0)
		n17 := g2.AddNode(layoutgraph.NewNode(17, 60.0, 50.0))
		n17.TopLeft = geo.NewPoint(-300.0, 60.0)
		n22 := g2.AddNode(layoutgraph.NewNode(22, 53.0, 47.0))
		n22.TopLeft = geo.NewPoint(540.0, 60.0)
		n18 := g2.AddNode(layoutgraph.NewNode(18, 50.0, 53.0))
		n18.TopLeft = geo.NewPoint(540.0, 300.0)
		n16 := g2.AddNode(layoutgraph.NewNode(16, 51.0, 48.0))
		n16.TopLeft = geo.NewPoint(660.0, -60.0)
		n20 := g2.AddNode(layoutgraph.NewNode(20, 52.0, 60.0))
		n20.TopLeft = geo.NewPoint(660.0, -180.0)
		g2.Connect(n19, n15)
		g2.Connect(n22, n21)
		g2.Connect(n18, n21)
		g2.CellSize = 60
		vEdges2, err := visibilityEdges(ctx, g2, false, true)
		if err != nil {
			t.Fatal(err)
		}
		factor2 := 2.4015748031496065
		inflateAlongAxis(g2, false, true, factor2, vEdges2, false)
		changed2, err := shiftSubgraphs(ctx, g2, false, true, factor2, []*layoutgraph.EdgeAbduction{}, vEdges2)
		if err != nil {
			t.Fatal(err)
		}
		out.ShiftSubgraphs.WontChangeChanged = changed2
		out.ShiftSubgraphs.WontChangePositions = slice43Positions(g2)
	}

	// 9. compactAlongAxis
	{
		g, _, _ := compactionGuardTestGraph()
		vEdges, err := visibilityEdges(ctx, g, true, true)
		if err != nil {
			t.Fatal(err)
		}
		inflateAlongAxis(g, true, true, 1.0, vEdges, false)
		for range 20 {
			ch, err := shiftSubgraphs(ctx, g, true, true, 1.0, nil, vEdges)
			if err != nil {
				t.Fatal(err)
			}
			if !ch {
				break
			}
		}
		guard, err := limits.NewOptimizationWorkGuard(ctx, "CompactionMoves", limits.MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		changed, err := compactAlongAxis(ctx, g, true, true, 1.0, nil, vEdges, guard)
		if err != nil {
			t.Fatal(err)
		}
		out.CompactAlongAxis.Changed = changed
		out.CompactAlongAxis.Positions = slice43Positions(g)
		out.CompactAlongAxis.Used = guard.Used()
	}

	// 10. exact CompactionMoves resource boundary
	{
		options := compactionOptions{axis: horizontalAxis, includeSizes: true, factor: 1}
		minimum := uint64(1)
		maximum := limits.MaxOptimizationWorkUnits
		for minimum < maximum {
			middle := minimum + (maximum-minimum)/2
			graph, _, _ := compactionGuardTestGraph()
			options.moveWorkLimit = middle
			if err := compaction(context.Background(), graph, options); err == nil {
				maximum = middle
			} else if errors.Is(err, limits.ErrOptimizationResourceLimit) {
				minimum = middle + 1
			} else {
				t.Fatalf("compaction with work budget %d failed unexpectedly: %v", middle, err)
			}
		}
		exactGraph, _, _ := compactionGuardTestGraph()
		options.moveWorkLimit = minimum
		if err := compaction(context.Background(), exactGraph, options); err != nil {
			t.Fatal(err)
		}
		firstPassGraph, _, _ := compactionGuardTestGraph()
		firstPassWork, _, err := firstCompactionPassWork(context.Background(), firstPassGraph)
		if err != nil {
			t.Fatal(err)
		}

		out.ExactWorkBoundary.W = minimum
		out.ExactWorkBoundary.FirstPassWork = firstPassWork
		out.ExactWorkBoundary.Positions = slice43Positions(exactGraph)
	}

	// 11. numAdjacent semantics (edge count sum vs unique external neighbors)
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(n1)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(50, 0)
		g.AddNode(n2)
		n3 := layoutgraph.NewNode(3, 10, 10)
		n3.TopLeft = geo.NewPoint(100, 0)
		g.AddNode(n3)
		n4 := layoutgraph.NewNode(4, 10, 10)
		n4.TopLeft = geo.NewPoint(150, 0)
		g.AddNode(n4)
		g.Connect(n1, n2) // internal edge
		g.Connect(n1, n3) // external edge to n3
		g.Connect(n2, n3) // another external edge to same n3
		g.Connect(n2, n4) // external edge to n4

		subgraph := layoutgraph.Nodes{n1, n2}
		out.NumAdjacent.EdgeCountSemantics = subgraph.NumAdjacent()

		uniqueExt := map[*layoutgraph.Node]bool{}
		for _, n := range subgraph {
			for _, e := range n.Edges {
				adj := n.Adjacent(e)
				if adj != n1 && adj != n2 {
					uniqueExt[adj] = true
				}
			}
		}
		out.NumAdjacent.UniqueExternalNeighbors = len(uniqueExt)
	}

	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("SLICE43_ORACLE_BEGIN\n%s\nSLICE43_ORACLE_END\n", bytes)
}
