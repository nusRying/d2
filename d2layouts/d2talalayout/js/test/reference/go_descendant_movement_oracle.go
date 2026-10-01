package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type PointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type TraversalScenarioResult struct {
	DescendantIDs []string `json:"descendantIDs"`
	Used          int64    `json:"used"`
}

type MovementScenarioResult struct {
	Before map[string]*PointDTO `json:"before"`
	After  map[string]*PointDTO `json:"after"`
}

type PanicFactResult struct {
	Panicked     bool      `json:"panicked"`
	FinalTopLeft *PointDTO `json:"finalTopLeft,omitempty"`
}

type OracleOutput struct {
	Metadata           map[string]interface{}             `json:"metadata"`
	TraversalScenarios map[string]TraversalScenarioResult `json:"traversalScenarios"`
	MovementScenarios  map[string]MovementScenarioResult  `json:"movementScenarios"`
	PanicFacts         map[string]PanicFactResult         `json:"panicFacts"`
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{X: pt.X, Y: pt.Y}
}

func main() {
	out := OracleOutput{
		Metadata: map[string]interface{}{
			"d2BaseCommit": "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"goVersion":    runtime.Version(),
			"goOS":         runtime.GOOS,
			"goArch":       runtime.GOARCH,
		},
		TraversalScenarios: make(map[string]TraversalScenarioResult),
		MovementScenarios:  make(map[string]MovementScenarioResult),
		PanicFacts:         make(map[string]PanicFactResult),
	}

	ctx := context.Background()

	// 1. containers_preorder
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		childA := g.AddNode(layoutgraph.NewNode(2, 50, 50))
		childA1 := g.AddNode(layoutgraph.NewNode(3, 20, 20))
		childA2 := g.AddNode(layoutgraph.NewNode(4, 20, 20))
		childB := g.AddNode(layoutgraph.NewNode(5, 50, 50))
		childB1 := g.AddNode(layoutgraph.NewNode(6, 20, 20))

		g.AddNewNodeToContainer(nil, root)
		g.AddNewNodeToContainer(root, childA)
		g.AddNewNodeToContainer(childA, childA1)
		g.AddNewNodeToContainer(childA, childA2)
		g.AddNewNodeToContainer(root, childB)
		g.AddNewNodeToContainer(childB, childB1)

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(root, true, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["containers_preorder"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// 2. mixed_ownership_order
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.SetClusterVessel(true)

		childC1 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		childC2 := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		g.AddNewNodeToContainer(root, childC1)
		g.AddNewNodeToContainer(root, childC2)

		clusterM1 := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		clusterM2 := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{clusterM1, clusterM2}}

		seqM1 := g.AddNode(layoutgraph.NewNode(6, 10, 10))
		seqM2 := g.AddNode(layoutgraph.NewNode(7, 10, 10))
		g.Sequences[root] = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{seqM1, seqM2}}

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(root, true, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["mixed_ownership_order"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// 3. include_structured_false
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.SetClusterVessel(true)

		ordChild := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		g.AddNewNodeToContainer(root, ordChild)

		clusterM1 := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{clusterM1}}

		// clusterM1 is itself a container with child
		hiddenChild := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		g.AddNewNodeToContainer(clusterM1, hiddenChild)

		seqM1 := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		g.Sequences[root] = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{seqM1}}
		hiddenSeqChild := g.AddNode(layoutgraph.NewNode(6, 10, 10))
		g.AddNewNodeToContainer(seqM1, hiddenSeqChild)

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(root, false, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["include_structured_false"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// 4. duplicate_membership
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.SetClusterVessel(true)

		shared := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		g.AddNewNodeToContainer(root, shared)
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{shared}}
		g.Sequences[root] = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{shared}}

		// Distinct node with same ID = 2
		distinctSameID := layoutgraph.NewNode(2, 20, 20)
		g.AddNode(distinctSameID)
		g.AddNewNodeToContainer(root, distinctSameID)

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(root, true, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["duplicate_membership"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// 5. nil_and_cycle
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.SetClusterVessel(true)

		c1 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		c2 := g.AddNode(layoutgraph.NewNode(3, 10, 10))

		root.SetContainer(true)
		c2.SetContainer(true)

		// Container has c1, nil, c2, root (cycle)
		g.Containers[root] = []*layoutgraph.Node{c1, nil, c2, root}
		// c2 also references c1 (duplicate)
		g.Containers[c2] = []*layoutgraph.Node{c1}
		// Cluster has nil and cycle back to root
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{nil, root}}

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(root, true, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["nil_and_cycle"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// 6. null_root
	{
		g := layoutgraph.NewGraph()
		r1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		r2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		g.AddNewNodeToContainer(nil, r1)
		g.AddNewNodeToContainer(nil, r2)

		seqM := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		g.Sequences[nil] = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{seqM}}

		guard, _ := limits.NewWorkGuard(ctx, "Traversal", limits.MaxEngineWorkUnits)
		descendants, err := g.AllDescendantNodesWithWorkGuard(nil, true, guard)
		if err != nil {
			panic(err)
		}
		var ids []string
		for _, d := range descendants {
			ids = append(ids, fmt.Sprintf("%d", d.ID))
		}
		out.TraversalScenarios["null_root"] = TraversalScenarioResult{
			DescendantIDs: ids,
			Used:          guard.Used(),
		}
	}

	// Movement 1: fractional_container_move
	{
		g := layoutgraph.NewGraph()
		parent := g.AddNode(layoutgraph.NewNode(1, 20, 20))
		parent.TopLeft = geo.NewPoint(10, 10)
		child := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		child.TopLeft = geo.NewPoint(15, 15)
		g.AddNewNodeToContainer(nil, parent)
		g.AddNewNodeToContainer(parent, child)

		before := map[string]*PointDTO{
			"1": pointToDTO(parent.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}

		parent.MoveWithChildren(0.5, 1.25)

		after := map[string]*PointDTO{
			"1": pointToDTO(parent.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}
		out.MovementScenarios["fractional_container_move"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Movement 2: mixed_structured_descendants_move
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.TopLeft = geo.NewPoint(0, 0)
		root.SetClusterVessel(true)

		cChild := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		cChild.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(root, cChild)

		clMember := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		clMember.TopLeft = geo.NewPoint(20, 20)
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{clMember}}

		seqMember := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		seqMember.TopLeft = geo.NewPoint(30, 30)
		g.Sequences[root] = &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{seqMember}}

		before := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(cChild.TopLeft),
			"3": pointToDTO(clMember.TopLeft),
			"4": pointToDTO(seqMember.TopLeft),
		}

		root.MoveWithChildren(100.5, 200.75)

		after := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(cChild.TopLeft),
			"3": pointToDTO(clMember.TopLeft),
			"4": pointToDTO(seqMember.TopLeft),
		}
		out.MovementScenarios["mixed_structured_descendants_move"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Movement 3: duplicate_membership_moves_once
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.TopLeft = geo.NewPoint(0, 0)
		root.SetClusterVessel(true)

		shared := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		shared.TopLeft = geo.NewPoint(5, 5)
		g.AddNewNodeToContainer(root, shared)
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{shared}}

		before := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(shared.TopLeft),
		}

		root.MoveWithChildren(10, 10)

		after := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(shared.TopLeft),
		}
		out.MovementScenarios["duplicate_membership_moves_once"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Movement 4: fixed_descendant_moves
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.TopLeft = geo.NewPoint(0, 0)

		fixedChild := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		fixedChild.TopLeft = geo.NewPoint(10, 10)
		fixedChild.FixedTopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(root, fixedChild)

		before := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(fixedChild.TopLeft),
		}

		root.MoveWithChildren(5, 5)

		after := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(fixedChild.TopLeft),
		}
		out.MovementScenarios["fixed_descendant_moves"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Movement 5: absolute_move
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.TopLeft = geo.NewPoint(10.25, -2.5)

		child := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		child.TopLeft = geo.NewPoint(15.75, 4.5)
		g.AddNewNodeToContainer(root, child)

		before := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}

		root.MoveAbsWithChildren(20.5, 10.25)

		after := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}
		out.MovementScenarios["absolute_move"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Movement 6: absolute_equal_noop
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1, 100, 100))
		root.TopLeft = geo.NewPoint(20.5, 10.25)

		child := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		child.TopLeft = geo.NewPoint(26.0, 17.25)
		g.AddNewNodeToContainer(root, child)

		before := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}

		root.MoveAbsWithChildren(20.5, 10.25)

		after := map[string]*PointDTO{
			"1": pointToDTO(root.TopLeft),
			"2": pointToDTO(child.TopLeft),
		}
		out.MovementScenarios["absolute_equal_noop"] = MovementScenarioResult{
			Before: before,
			After:  after,
		}
	}

	// Panic fact 1: detached_nonzero_partial_mutation
	{
		root := layoutgraph.NewNode(1, 10, 10)
		root.TopLeft = geo.NewPoint(10, 20)
		root.Graph = nil

		panicked := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
				}
			}()
			root.MoveWithChildren(5, 5)
		}()

		out.PanicFacts["detached_nonzero_partial_mutation"] = PanicFactResult{
			Panicked:     panicked,
			FinalTopLeft: pointToDTO(root.TopLeft),
		}
	}

	// Panic fact 2: null_top_left_absolute_move
	{
		root := layoutgraph.NewNode(1, 10, 10)
		root.TopLeft = nil

		panicked := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panicked = true
				}
			}()
			root.MoveAbsWithChildren(10, 10)
		}()

		out.PanicFacts["null_top_left_absolute_move"] = PanicFactResult{
			Panicked: panicked,
		}
	}

	outPath := "test/fixtures/go-descendant-movement-reference.json"
	if len(os.Args) > 1 && os.Args[1] != "" {
		outPath = os.Args[1]
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

	hash := sha256.Sum256(data)
	hashHex := hex.EncodeToString(hash[:])
	fmt.Printf("Wrote %d bytes to %s\nSHA256: %s\n", len(data), outPath, hashHex)
}
