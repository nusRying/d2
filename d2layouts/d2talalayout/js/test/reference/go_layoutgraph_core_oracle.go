package main

import (
	"context"
	"encoding/json"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"strconv"
)

type Output struct {
	Metadata map[string]string      `json:"metadata"`
	Cases    map[string]interface{} `json:"cases"`
}

func main() {
	outData := Output{
		Metadata: map[string]string{
			"runtimeGoVersion":   runtime.Version(),
			"d2BaseCommit":       "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referenceAlgorithm": "TALA layoutgraph core operations",
		},
		Cases: make(map[string]interface{}),
	}

	// 1. NewGraph defaults
	g1 := layoutgraph.NewGraph()
	outData.Cases["NewGraphDefaults"] = map[string]interface{}{
		"IsRootHierarchy": g1.IsRootHierarchy,
		"CellSize":        g1.CellSize,
	}

	// 2. AddNodeUnchecked, AddNodeToContainer, AddNewNodeToContainer
	g2 := layoutgraph.NewGraph()
	n1 := &layoutgraph.Node{ID: 1}
	n2 := &layoutgraph.Node{ID: 2}
	n3 := &layoutgraph.Node{ID: 3}

	g2.AddNodeUnchecked(n1)
	g2.AddNewNodeToContainer(n1, n2)
	g2.AddNodeToContainer(n1, n3)

	outData.Cases["NodeHierarchy"] = map[string]interface{}{
		"N1Graph":     n1.Graph != nil,
		"N1Container": n1.Container == nil,
		"N2Graph":     n2.Graph != nil,
		"N2Container": n2.Container != nil && n2.Container.ID == 1,
		"N3Graph":     n3.Graph != nil,
		"N3Container": n3.Container != nil && n3.Container.ID == 1,
		"RootNodesCount": len(g2.Containers[nil]),
		"N1ChildrenCount": len(g2.Containers[n1]),
	}

	n19 := &layoutgraph.Node{ID: 19}
	n20 := &layoutgraph.Node{ID: 20}
	n21 := &layoutgraph.Node{ID: 21}
	g6 := layoutgraph.NewGraph()
	g6.AddNodeUnchecked(n19)
	g6.AddNewNodeToContainer(n19, n20)
	g6.AddNewNodeToContainer(n20, n21)
	
	outData.Cases["NodeLevel"] = map[string]interface{}{
		"TopLevel":   n19.Level(),
		"Child":      n20.Level(),
		"Grandchild": n21.Level(),
	}

	// 3. AddNear symmetry and OrderedNears ID ordering
	n4 := &layoutgraph.Node{ID: 4, Nears: make(map[*layoutgraph.Node]struct{})}
	n5 := &layoutgraph.Node{ID: 5, Nears: make(map[*layoutgraph.Node]struct{})}
	n6 := &layoutgraph.Node{ID: 6, Nears: make(map[*layoutgraph.Node]struct{})}
	n7 := &layoutgraph.Node{ID: 2, Nears: make(map[*layoutgraph.Node]struct{})}

	n4.AddNear(n6)
	n4.AddNear(n5)
	n4.AddNear(n7)

	ordered := n4.OrderedNears()
	orderedIDs := make([]string, len(ordered))
	for i, n := range ordered {
		orderedIDs[i] = strconv.FormatInt(int64(n.ID), 10)
	}

	outData.Cases["Nears"] = map[string]interface{}{
		"N4HasN6": n4.Nears[n6] == struct{}{},
		"N6HasN4": n6.Nears[n4] == struct{}{},
		"N4HasN5": n4.Nears[n5] == struct{}{},
		"N5HasN4": n5.Nears[n4] == struct{}{},
		"OrderedIDs": orderedIDs,
	}

	// 4. Connect, Disconnect, self-loop adjacency
	g3 := layoutgraph.NewGraph()
	n8 := &layoutgraph.Node{ID: 8}
	n9 := &layoutgraph.Node{ID: 9}
	g3.AddNodeUnchecked(n8)
	g3.AddNodeUnchecked(n9)

	e1 := g3.Connect(n8, n9)
	g3.Connect(n8, n8) // self-loop

	outData.Cases["Edges"] = map[string]interface{}{
		"E1From": strconv.FormatInt(int64(e1.From.ID), 10),
		"E1To":   strconv.FormatInt(int64(e1.To.ID), 10),
		"N8EdgesCount": len(n8.Edges),
		"N9EdgesCount": len(n9.Edges),
	}

	g3.Disconnect(e1)
	outData.Cases["Disconnect"] = map[string]interface{}{
		"GraphEdgesCount": len(g3.Edges),
		"N8EdgesCount": len(n8.Edges),
		"N9EdgesCount": len(n9.Edges),
	}

	g7 := layoutgraph.NewGraph()
	n22 := &layoutgraph.Node{ID: 22}
	n23 := &layoutgraph.Node{ID: 23}
	n24 := &layoutgraph.Node{ID: 24}
	n25 := &layoutgraph.Node{ID: 25}
	g7.AddNodeUnchecked(n22)
	g7.AddNodeUnchecked(n23)
	g7.AddNodeUnchecked(n24)
	g7.AddNodeUnchecked(n25)
	
	g7.Connect(n22, n23)
	g7.Connect(n22, n24)
	g7.Connect(n22, n22) // self loop
	
	eToB := n22.ConnectionTo(n23)
	eToC := n22.ConnectionTo(n24)
	eToA := n22.ConnectionTo(n22)
	eToD := n22.ConnectionTo(n25)

	outData.Cases["ConnectionTo"] = map[string]interface{}{
		"HasEToB": eToB != nil,
		"HasEToC": eToC != nil,
		"HasEToA": eToA != nil,
		"HasEToD": eToD != nil,
	}

	// 5. Direction default, Direction explicit
	n10 := &layoutgraph.Node{ID: 10}
	n11 := &layoutgraph.Node{ID: 11}
	n12 := &layoutgraph.Node{ID: 12}
	g3.AddNodeUnchecked(n10)
	g3.AddNodeUnchecked(n11)
	g3.AddNodeUnchecked(n12)
	g3.Connect(n10, n11)
	g3.Connect(n11, n12)

	g3.Directions = map[*layoutgraph.Node]geo.Orientation{
		n10: geo.Left,
		n11: geo.Right,
	}

	outData.Cases["Directions"] = map[string]interface{}{
		"N10Direction": g3.Direction(n10),
		"N11Direction": g3.Direction(n11),
	}

	// 6. ComputeCellSize
	g4 := layoutgraph.NewGraph()
	n13 := &layoutgraph.Node{ID: 13, Width: 1000, Height: 2000}
	n14 := &layoutgraph.Node{ID: 14, Width: 15, Height: 25}
	g4.AddNodeUnchecked(n13)
	g4.AddNewNodeToContainer(n13, n14) // n13 is now a container
	g4.ComputeCellSize()

	outData.Cases["ComputeCellSize"] = g4.CellSize

	// 7. SourcePort, TargetPort
	e5 := &layoutgraph.Edge{From: n13, To: n14, Points: []*geo.Point{{X: 1, Y: 2}, {X: 3, Y: 4}}}
	sPort := e5.SourcePort()
	tPort := e5.TargetPort()

	outData.Cases["Ports"] = map[string]interface{}{
		"SourcePortX": sPort.X,
		"TargetPortX": tPort.X,
	}

	e6 := g3.Connect(n8, n9) // Recreate edge for test
	n15 := &layoutgraph.Node{ID: 15}
	n16 := &layoutgraph.Node{ID: 16}
	g3.AddNodeUnchecked(n15)
	g3.AddNodeUnchecked(n16)
	
	e6.Reconnect(n15, false) // Reconnect From n8 to n15
	e6.Reconnect(n16, true)  // Reconnect To n9 to n16

	outData.Cases["Reconnect"] = map[string]interface{}{
		"E6FromID": strconv.FormatInt(int64(e6.From.ID), 10),
		"E6ToID":   strconv.FormatInt(int64(e6.To.ID), 10),
		"N8EdgesCount": len(n8.Edges),
		"N15EdgesCount": len(n15.Edges),
		"N9EdgesCount": len(n9.Edges),
		"N16EdgesCount": len(n16.Edges),
	}

	// 9. Clone ownership/rebinding
	g5 := layoutgraph.NewGraph()
	n17 := layoutgraph.NewNode(17, 0, 0)
	n17.TopLeft = &geo.Point{X: 1, Y: 2}
	n18 := layoutgraph.NewNode(18, 0, 0)
	n18.TopLeft = &geo.Point{X: 3, Y: 4}
	g5.AddNodeUnchecked(n17)
	g5.AddNewNodeToContainer(n17, n18)
	n17.AddNear(n18)
	e7 := g5.Connect(n17, n18)
	e7.Points = []*geo.Point{{X: 5, Y: 6}}

	g5Cloned, err := layoutgraph.Clone(context.Background(), g5)
	if err != nil {
		panic(err)
	}
	cN17 := g5Cloned.Nodes[0]
	cN18 := g5Cloned.Nodes[1]
	if cN17.ID == 18 {
		cN17, cN18 = cN18, cN17
	}
	cE7 := g5Cloned.Edges[0]

	outData.Cases["Clone"] = map[string]interface{}{
		"N17PointerDiff": cN17 != n17,
		"E7PointerDiff":  cE7 != e7,
		"N17TopLeftX":    cN17.TopLeft.X,
		"N17IsContainer": cN17.IsContainer(),
		"N18HasContainer": cN18.Container != nil,
		"N18ContainerID": func() string {
			if cN18.Container != nil {
				return strconv.FormatInt(int64(cN18.Container.ID), 10)
			}
			return "0"
		}(),
		"N17NearsCount":  len(cN17.Nears),
		"E7FromID":       strconv.FormatInt(int64(cE7.From.ID), 10),
		"E7ToID":         strconv.FormatInt(int64(cE7.To.ID), 10),
		"E7Points0X":     cE7.Points[0].X,
	}
	b, err := json.MarshalIndent(outData, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "../fixtures/go-layoutgraph-core-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	err = os.WriteFile(outFile, b, 0644)
	if err != nil {
		panic(err)
	}
}
