package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Constants map[string]interface{} `json:"constants"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

func recordValidation(scenarios map[string]interface{}, name string, ctx context.Context, op string, g *layoutgraph.Graph) {
	err := layoutgraph.Validate(ctx, op, g)
	entry := map[string]interface{}{}
	if err != nil {
		entry["success"] = false
		entry["error"] = err.Error()
	} else {
		entry["success"] = true
		entry["error"] = nil
	}
	scenarios[name] = entry
}

func main() {
	outPath := "test/fixtures/go-topology-preflight-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion":             runtime.Version(),
			"runtimeGOOS":                  runtime.GOOS,
			"runtimeGOARCH":                runtime.GOARCH,
			"d2BaseCommit":                 "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage":             "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph",
			"goSliceSpareCapacitySafety":   true,
			"jsArrayCapacityRepresentable": false,
		},
		Constants: map[string]interface{}{
			"MaxEngineNodes":        limits.MaxEngineNodes,
			"MaxEngineEdges":        limits.MaxEngineEdges,
			"MaxTopologyReferences": int64(1_000_000),
			"MaxRoutePoints":        limits.MaxEngineRoutePoints,
			"MaxEngineTreeDepth":    limits.MaxEngineTreeDepth,
		},
		Scenarios: make(map[string]interface{}),
	}

	ctx := context.Background()

	// 1. Valid empty graph
	{
		g := layoutgraph.NewGraph()
		recordValidation(out.Scenarios, "valid_empty_graph", ctx, "test", g)
	}

	// 2. Nil graph
	{
		recordValidation(out.Scenarios, "nil_graph", ctx, "test", nil)
	}

	// 3. Nil context with valid graph
	{
		g := layoutgraph.NewGraph()
		recordValidation(out.Scenarios, "nil_context_valid_graph", nil, "AddSequences", g)
	}

	// 4. Nil graph and nil context error ordering (graph check before context)
	{
		recordValidation(out.Scenarios, "nil_graph_nil_context_error_ordering", nil, "AddSequences", nil)
	}

	// 5. Nil graph node entry
	{
		g := layoutgraph.NewGraph()
		g.Nodes = []*layoutgraph.Node{nil}
		recordValidation(out.Scenarios, "nil_graph_node_entry", ctx, "test", g)
	}

	// 6. Nil graph edge entry
	{
		g := layoutgraph.NewGraph()
		g.Edges = []*layoutgraph.Edge{nil}
		recordValidation(out.Scenarios, "nil_graph_edge_entry", ctx, "test", g)
	}

	// 7. Edge missing endpoint
	{
		g := layoutgraph.NewGraph()
		e := layoutgraph.NewEdge(nil, nil)
		e.ID = 42
		g.Edges = []*layoutgraph.Edge{e}
		recordValidation(out.Scenarios, "edge_missing_endpoint", ctx, "test", g)
	}

	// 8. Nil container child
	{
		g := layoutgraph.NewGraph()
		g.Containers[nil] = []*layoutgraph.Node{nil}
		recordValidation(out.Scenarios, "nil_container_child", ctx, "test", g)
	}

	// 9. Nil route point
	{
		g := layoutgraph.NewGraph()
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		e := g.Connect(n1, n2)
		e.Points = []*geo.Point{nil}
		recordValidation(out.Scenarios, "nil_route_point", ctx, "test", g)
	}

	// 10. Nil cluster record
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(1, 10, 10)
		g.Clusters[v] = nil
		recordValidation(out.Scenarios, "nil_cluster_record", ctx, "test", g)
	}

	// 11. Nil sequence record
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(1, 10, 10)
		g.Sequences[v] = nil
		recordValidation(out.Scenarios, "nil_sequence_record", ctx, "test", g)
	}

	// 12. Valid nil tree root key
	{
		g := layoutgraph.NewGraph()
		rootNode := layoutgraph.NewNode(1, 10, 10)
		rootTree := &layoutgraph.Tree{Node: rootNode}
		g.Trees[nil] = []*layoutgraph.Tree{rootTree}
		recordValidation(out.Scenarios, "valid_nil_tree_root_key", ctx, "test", g)
	}

	// 13. Container parent cycle
	{
		g := layoutgraph.NewGraph()
		a := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		a.Container = a
		recordValidation(out.Scenarios, "container_parent_cycle", ctx, "test", g)
	}

	// 14. Container parent depth exceeded
	{
		g := layoutgraph.NewGraph()
		var parent *layoutgraph.Node
		for i := 0; i <= limits.MaxEngineTreeDepth; i++ {
			node := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1))
			node.Container = parent
			parent = node
		}
		recordValidation(out.Scenarios, "container_parent_depth_exceeded", ctx, "test", g)
	}

	// 15. Effective container cycle
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 1, 1)
		vesselA := layoutgraph.NewNode(2, 1, 1)
		vesselA.SetClusterVessel(true)
		g.AddNodeUnchecked(a)
		g.AddNodeUnchecked(vesselA)
		clusterA := &layoutgraph.Cluster{Vessel: vesselA, Nodes: []*layoutgraph.Node{a}, Graph: g}
		a.Cluster = clusterA
		vesselA.Container = a
		g.Clusters[vesselA] = clusterA
		recordValidation(out.Scenarios, "effective_container_cycle", ctx, "test", g)
	}

	// 16. Effective container depth exceeded
	{
		g := layoutgraph.NewGraph()
		members := make([]*layoutgraph.Node, limits.MaxEngineTreeDepth+1)
		vessels := make([]*layoutgraph.Node, len(members))
		for i := range members {
			members[i] = layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1)
			vessels[i] = layoutgraph.NewNode(layoutgraph.EntityID(10_000+i), 1, 1)
			vessels[i].SetClusterVessel(true)
			g.AddNodeUnchecked(members[i])
			g.AddNodeUnchecked(vessels[i])
		}
		for i := range members {
			cluster := &layoutgraph.Cluster{Vessel: vessels[i], Nodes: []*layoutgraph.Node{members[i]}, Graph: g}
			members[i].Cluster = cluster
			if i+1 < len(members) {
				vessels[i].Container = members[i+1]
			}
			g.Clusters[vessels[i]] = cluster
		}
		recordValidation(out.Scenarios, "effective_container_depth_exceeded", ctx, "test", g)
	}

	// 17. Cluster ancestry cycle
	{
		g := layoutgraph.NewGraph()
		a := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		clA := &layoutgraph.Cluster{Vessel: a, Graph: g}
		a.Cluster = clA
		g.Clusters[a] = clA
		recordValidation(out.Scenarios, "cluster_ancestry_cycle", ctx, "test", g)
	}

	// 18. Cluster ancestry depth exceeded
	{
		g := layoutgraph.NewGraph()
		nodes := make([]*layoutgraph.Node, limits.MaxEngineTreeDepth+1)
		for i := range nodes {
			nodes[i] = layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1)
			g.AddNodeUnchecked(nodes[i])
		}
		for i := 0; i+1 < len(nodes); i++ {
			cluster := &layoutgraph.Cluster{Vessel: nodes[i+1], Graph: g}
			nodes[i].Cluster = cluster
			g.Clusters[nodes[i+1]] = cluster
		}
		recordValidation(out.Scenarios, "cluster_ancestry_depth_exceeded", ctx, "test", g)
	}

	// 19. Sequence ancestry cycle
	{
		g := layoutgraph.NewGraph()
		a := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		seqA := &layoutgraph.Sequence{Vessel: a, Graph: g}
		a.Sequence = seqA
		g.Sequences[a] = seqA
		recordValidation(out.Scenarios, "sequence_ancestry_cycle", ctx, "test", g)
	}

	// 20. Sequence ancestry depth exceeded
	{
		g := layoutgraph.NewGraph()
		nodes := make([]*layoutgraph.Node, limits.MaxEngineTreeDepth+1)
		for i := range nodes {
			nodes[i] = layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1)
			g.AddNodeUnchecked(nodes[i])
		}
		for i := 0; i+1 < len(nodes); i++ {
			sequence := &layoutgraph.Sequence{Vessel: nodes[i+1], Graph: g}
			nodes[i].Sequence = sequence
			g.Sequences[nodes[i+1]] = sequence
		}
		recordValidation(out.Scenarios, "sequence_ancestry_depth_exceeded", ctx, "test", g)
	}

	// 21. Direct container descendant cycle
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 1, 1)
		a.SetContainer(true)
		g.AddNodeUnchecked(a)
		g.Containers[a] = []*layoutgraph.Node{a}
		recordValidation(out.Scenarios, "direct_container_descendant_cycle", ctx, "test", g)
	}

	// 22. Sequence descendant cycle
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 1, 1)
		g.AddNodeUnchecked(a)
		seqA := &layoutgraph.Sequence{Vessel: a, Nodes: []*layoutgraph.Node{a}, Graph: g}
		g.Sequences[a] = seqA
		recordValidation(out.Scenarios, "sequence_descendant_cycle", ctx, "test", g)
	}

	// 23. Descendant depth exceeded
	{
		g := layoutgraph.NewGraph()
		var parent *layoutgraph.Node
		for i := 0; i <= limits.MaxEngineTreeDepth; i++ {
			node := layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1)
			node.SetContainer(true)
			g.AddNodeUnchecked(node)
			g.Containers[parent] = []*layoutgraph.Node{node}
			parent = node
		}
		recordValidation(out.Scenarios, "descendant_depth_exceeded", ctx, "test", g)
	}

	// 24. Cluster vessel marked but missing Cluster record
	{
		g := layoutgraph.NewGraph()
		v := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		v.SetClusterVessel(true)
		recordValidation(out.Scenarios, "cluster_vessel_missing_record", ctx, "test", g)
	}

	// 25. Tree child cycle
	{
		g := layoutgraph.NewGraph()
		a := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		b := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1))}
		a.Children = []*layoutgraph.Tree{b}
		b.Children = []*layoutgraph.Tree{a}
		g.Trees[nil] = []*layoutgraph.Tree{a}
		recordValidation(out.Scenarios, "tree_child_cycle", ctx, "test", g)
	}

	// 26. Tree parent cycle
	{
		g := layoutgraph.NewGraph()
		a := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		b := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1))}
		a.Parent = b
		b.Parent = a
		g.Trees[nil] = []*layoutgraph.Tree{a, b}
		recordValidation(out.Scenarios, "tree_parent_cycle", ctx, "test", g)
	}

	// 27. Tree depth exceeded
	{
		g := layoutgraph.NewGraph()
		root := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		curr := root
		for i := 1; i <= limits.MaxEngineTreeDepth; i++ {
			next := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i+1), 1, 1)), Parent: curr}
			curr.Children = []*layoutgraph.Tree{next}
			curr = next
		}
		g.Trees[nil] = []*layoutgraph.Tree{root}
		recordValidation(out.Scenarios, "tree_depth_exceeded", ctx, "test", g)
	}

	// 28. Tree listed as more than one root
	{
		g := layoutgraph.NewGraph()
		t := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		g.Trees[nil] = []*layoutgraph.Tree{t, t}
		recordValidation(out.Scenarios, "same_tree_repeated_as_root", ctx, "test", g)
	}

	// 29. Tree repeated beneath same parent
	{
		g := layoutgraph.NewGraph()
		root := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		child := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1)), Parent: root}
		root.Children = []*layoutgraph.Tree{child, child}
		g.Trees[nil] = []*layoutgraph.Tree{root}
		recordValidation(out.Scenarios, "same_tree_repeated_beneath_same_parent", ctx, "test", g)
	}

	// 30. Tree shared by multiple parents
	{
		g := layoutgraph.NewGraph()
		root1 := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		root2 := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1))}
		child := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(3, 1, 1)), Parent: root1}
		root1.Children = []*layoutgraph.Tree{child}
		root2.Children = []*layoutgraph.Tree{child}
		g.Trees[nil] = []*layoutgraph.Tree{root1, root2}
		recordValidation(out.Scenarios, "tree_shared_by_multiple_parents", ctx, "test", g)
	}

	// 31. Same Node owned by multiple trees
	{
		g := layoutgraph.NewGraph()
		sharedNode := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		t1 := &layoutgraph.Tree{Node: sharedNode}
		t2 := &layoutgraph.Tree{Node: sharedNode}
		g.Trees[nil] = []*layoutgraph.Tree{t1, t2}
		recordValidation(out.Scenarios, "same_node_owned_by_multiple_trees", ctx, "test", g)
	}

	// 32. Inconsistent child.Parent
	{
		g := layoutgraph.NewGraph()
		root := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		child := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1)), Parent: nil}
		root.Children = []*layoutgraph.Tree{child}
		g.Trees[nil] = []*layoutgraph.Tree{root}
		recordValidation(out.Scenarios, "inconsistent_child_parent", ctx, "test", g)
	}

	// 33. Tree root also has installed parent
	{
		g := layoutgraph.NewGraph()
		p := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1))}
		r := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(2, 1, 1)), Parent: p}
		g.Trees[nil] = []*layoutgraph.Tree{p, r}
		recordValidation(out.Scenarios, "root_also_has_installed_parent", ctx, "test", g)
	}

	// 34. Placement-only wrapper parent mismatch
	{
		g := layoutgraph.NewGraph()
		wrapper := &layoutgraph.Tree{Node: layoutgraph.NewNode(99, 1, 1), Children: []*layoutgraph.Tree{}}
		root := &layoutgraph.Tree{Node: g.AddNode(layoutgraph.NewNode(1, 1, 1)), Parent: wrapper}
		g.Trees[nil] = []*layoutgraph.Tree{root}
		recordValidation(out.Scenarios, "placement_wrapper_occurrence_mismatch", ctx, "test", g)
	}

	// 35. NodeToTree alias does not match tree node
	{
		g := layoutgraph.NewGraph()
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		n1 := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		n2 := g.AddNode(layoutgraph.NewNode(2, 1, 1))
		t := &layoutgraph.Tree{Node: n2}
		g.Trees[nil] = []*layoutgraph.Tree{t}
		g.NodeToTree[n1] = t
		recordValidation(out.Scenarios, "node_to_tree_alias_does_not_match_node", ctx, "test", g)
	}

	// 36. NodeToTree alias outside installed forest
	{
		g := layoutgraph.NewGraph()
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		n1 := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		n2 := g.AddNode(layoutgraph.NewNode(2, 1, 1))
		t1 := &layoutgraph.Tree{Node: n1}
		t2 := &layoutgraph.Tree{Node: n2}
		g.Trees[nil] = []*layoutgraph.Tree{t1}
		g.NodeToTree[n2] = t2
		recordValidation(out.Scenarios, "node_to_tree_alias_outside_installed_forest", ctx, "test", g)
	}

	// 37. NodeToTree aliases do not cover installed forest
	{
		g := layoutgraph.NewGraph()
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		n1 := g.AddNode(layoutgraph.NewNode(1, 1, 1))
		n2 := g.AddNode(layoutgraph.NewNode(2, 1, 1))
		t1 := &layoutgraph.Tree{Node: n1}
		t2 := &layoutgraph.Tree{Node: n2}
		g.Trees[nil] = []*layoutgraph.Tree{t1, t2}
		g.NodeToTree[n1] = t1
		recordValidation(out.Scenarios, "node_to_tree_aliases_do_not_cover_installed_forest", ctx, "test", g)
	}

	// 38. Canceled context
	{
		cancCtx, cancel := context.WithCancel(context.Background())
		cancel()
		g := layoutgraph.NewGraph()
		recordValidation(out.Scenarios, "canceled_context", cancCtx, "AddSequences", g)
	}

	// 39. Canonical RDFS fixture from TestGraphRDFSOrder
	{
		g := layoutgraph.NewGraph()
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{}

		makeNodes := func(start layoutgraph.EntityID, count int) []*layoutgraph.Node {
			res := make([]*layoutgraph.Node, count)
			for i := 0; i < count; i++ {
				res[i] = layoutgraph.NewNode(start+layoutgraph.EntityID(i), 1, 1)
			}
			return res
		}

		ns := makeNodes(1, 10)
		for _, n := range ns {
			g.AddNode(n)
		}

		addToContainers := func(g *layoutgraph.Graph, ns []*layoutgraph.Node) {
			g.Containers[nil] = append(g.Containers[nil], ns[0])
			g.Containers[ns[0]] = []*layoutgraph.Node{ns[1], ns[2]}
			g.Containers[ns[1]] = []*layoutgraph.Node{ns[3]}
			g.Containers[ns[3]] = []*layoutgraph.Node{ns[5]}
			g.Containers[ns[5]] = []*layoutgraph.Node{ns[7]}
			g.Containers[ns[2]] = []*layoutgraph.Node{ns[4]}
			g.Containers[ns[4]] = []*layoutgraph.Node{ns[6], ns[8]}
			g.Containers[ns[8]] = []*layoutgraph.Node{ns[9]}

			for container, children := range g.Containers {
				for _, child := range children {
					child.Container = container
				}
				if container != nil {
					container.SetContainer(true)
				}
			}
		}

		ns2 := makeNodes(11, 10)
		cl := &layoutgraph.Cluster{Nodes: ns2[1:]}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{
			ns2[0]: cl,
		}
		ns2[0].SetClusterVessel(true)
		for _, n := range cl.Nodes {
			g.AddNode(n)
		}

		addToContainers(g, ns)
		addToContainers(g, ns2)

		guard, err := limits.NewWorkGuard(ctx, "TestGraphRDFSOrder", limits.MaxEngineWorkUnits)
		if err != nil {
			panic(err)
		}
		orderNodes, err := g.ContainerRDFSOrder(nil, guard)
		if err != nil {
			panic(err)
		}
		ids := make([]int64, len(orderNodes))
		for i, n := range orderNodes {
			ids[i] = int64(n.ID)
		}

		out.Scenarios["rdfs_canonical_fixture"] = map[string]interface{}{
			"order": ids,
			"used":  guard.Used(),
		}
	}

	// 40. RDFS guarded accounting & exact-limit behavior
	{
		g := layoutgraph.NewGraph()
		// root -> [c1, clVessel]
		c1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		c1.SetContainer(true)
		c2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		c2.SetContainer(true)
		leaf1 := g.AddNode(layoutgraph.NewNode(3, 10, 10))

		clVessel := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		clVessel.SetClusterVessel(true)
		c3 := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		c3.SetContainer(true)
		leaf2 := g.AddNode(layoutgraph.NewNode(6, 10, 10))
		leaf3 := g.AddNode(layoutgraph.NewNode(7, 10, 10))

		cl := &layoutgraph.Cluster{
			Vessel: clVessel,
			Nodes:  []*layoutgraph.Node{c3, leaf2},
			Graph:  g,
		}
		g.Clusters[clVessel] = cl

		g.Containers[nil] = []*layoutgraph.Node{c1, clVessel}
		g.Containers[c1] = []*layoutgraph.Node{c2}
		g.Containers[c2] = []*layoutgraph.Node{leaf1}
		g.Containers[c3] = []*layoutgraph.Node{leaf3}

		// Measure required work units with unbounded guard
		probeGuard, err := limits.NewWorkGuard(ctx, "probe", limits.MaxEngineWorkUnits)
		if err != nil {
			panic(err)
		}
		measuredOrder, err := g.ContainerRDFSOrder(nil, probeGuard)
		if err != nil {
			panic(err)
		}
		requiredUnits := probeGuard.Used()
		measuredIds := make([]int64, len(measuredOrder))
		for i, n := range measuredOrder {
			measuredIds[i] = int64(n.ID)
		}

		// Test exact limit: limit == requiredUnits
		exactGuard, _ := limits.NewWorkGuard(ctx, "exact", requiredUnits)
		_, exactErr := g.ContainerRDFSOrder(nil, exactGuard)

		// Test one below limit: limit == requiredUnits - 1
		oneBelowGuard, _ := limits.NewWorkGuard(ctx, "one_below", requiredUnits-1)
		_, belowErr := g.ContainerRDFSOrder(nil, oneBelowGuard)

		out.Scenarios["rdfs_guarded_accounting"] = map[string]interface{}{
			"order":              measuredIds,
			"requiredUnits":      requiredUnits,
			"exactLimitSuccess":  exactErr == nil,
			"belowLimitError":    belowErr != nil,
			"belowLimitErrorMsg": belowErr.Error(),
		}
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Wrote Go topology preflight oracle to %s\n", outPath)
}
