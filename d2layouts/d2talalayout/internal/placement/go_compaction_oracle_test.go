package placement

import (
	"context"
	"encoding/json"
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
	ID uint64 `json:"id"`
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type slice43Oracle struct {
	DeltaTo map[string]int `json:"deltaTo"`
	Visibility []slice43Pair `json:"visibility"`
	Candidates []slice43Point `json:"candidates"`
	MoveNodeBest struct {
		Changed bool `json:"changed"`
		X float64 `json:"x"`
		Y float64 `json:"y"`
		Used uint64 `json:"used"`
	} `json:"moveNodeBest"`
	Compaction []slice43Node `json:"compaction"`
	Transition []slice43Node `json:"transition"`
}

func slice43Positions(g *layoutgraph.Graph) []slice43Node {
	out := make([]slice43Node, 0, len(g.Nodes))
	for _, node := range g.Nodes {
		out = append(out, slice43Node{ID:uint64(node.ID), X:node.TopLeft.X, Y:node.TopLeft.Y})
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
		e := g.Connect(a,b)
		out.DeltaTo["connected"] = a.DeltaTo(b, a.TopLeft)
		e.MinWidth = 90
		out.DeltaTo["min_width_90"] = a.DeltaTo(b, a.TopLeft)
	}

	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 4, 6); a.TopLeft = geo.NewPoint(0,4); g.AddNode(a)
		b := layoutgraph.NewNode(2, 6, 4); b.TopLeft = geo.NewPoint(12,8); g.AddNode(b)
		c := layoutgraph.NewNode(3, 9, 5); c.TopLeft = geo.NewPoint(25,5); g.AddNode(c)
		d := layoutgraph.NewNode(4, 9, 6); d.TopLeft = geo.NewPoint(38,1); g.AddNode(d)
		edges, err := visibilityEdges(ctx,g,true,true)
		if err != nil { t.Fatal(err) }
		for _, edge := range edges {
			out.Visibility = append(out.Visibility, slice43Pair{From:uint64(edge.From.ID),To:uint64(edge.To.ID)})
		}
	}

	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1,10,10); a.TopLeft = geo.NewPoint(0,0); g.AddNode(a)
		b := layoutgraph.NewNode(2,10,10); b.TopLeft = geo.NewPoint(100,0); g.AddNode(b)
		g.Connect(a,b)
		v := layoutgraph.Edges{layoutgraph.NewEdge(a,b)}
		points, err := candidateMoves(ctx,g,b,1,true,true,0,v)
		if err != nil { t.Fatal(err) }
		for _, p := range points { out.Candidates = append(out.Candidates,slice43Point{X:p.X,Y:p.Y}) }
	}

	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1,10,10); a.TopLeft = geo.NewPoint(0,0); g.AddNode(a)
		b := layoutgraph.NewNode(2,10,10); b.TopLeft = geo.NewPoint(100,0); g.AddNode(b)
		g.Connect(a,b)
		guard, err := limits.NewOptimizationWorkGuard(ctx,"oracleMove",limits.MaxOptimizationWorkUnits)
		if err != nil { t.Fatal(err) }
		points := []*geo.Point{geo.NewPoint(20,0),geo.NewPoint(40,0),geo.NewPoint(100,0)}
		changed, err := moveNodeToBest(ctx,g,b,points,nil,true,guard)
		if err != nil { t.Fatal(err) }
		out.MoveNodeBest.Changed = changed
		out.MoveNodeBest.X = b.TopLeft.X
		out.MoveNodeBest.Y = b.TopLeft.Y
		out.MoveNodeBest.Used = guard.Used()
	}

	newCompactionGraph := func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		a := layoutgraph.NewNode(1,10,10); a.TopLeft = geo.NewPoint(0,0); g.AddNode(a)
		b := layoutgraph.NewNode(2,10,10); b.TopLeft = geo.NewPoint(100,0); g.AddNode(b)
		c := layoutgraph.NewNode(3,10,10); c.TopLeft = geo.NewPoint(200,0); g.AddNode(c)
		g.Connect(a,b)
		g.Connect(b,c)
		return g
	}
	{
		g := newCompactionGraph()
		if err := compaction(ctx,g,compactionOptions{axis:horizontalAxis,includeSizes:true,factor:1}); err != nil { t.Fatal(err) }
		out.Compaction = slice43Positions(g)
	}
	{
		g := newCompactionGraph()
		if err := compaction(ctx,g,compactionOptions{axis:horizontalAxis,includeSizes:true,factor:1,transition:true}); err != nil { t.Fatal(err) }
		out.Transition = slice43Positions(g)
	}

	bytes, err := json.MarshalIndent(out,"","  ")
	if err != nil { t.Fatal(err) }
	fmt.Printf("SLICE43_ORACLE_BEGIN\n%s\nSLICE43_ORACLE_END\n", bytes)
}
