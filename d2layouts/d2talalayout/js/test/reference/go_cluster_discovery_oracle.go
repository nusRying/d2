//go:build tala_cluster_discovery_oracle

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

func idStr(n *layoutgraph.Node) string {
	if n == nil {
		return ""
	}
	return fmt.Sprintf("%d", n.ID)
}

func edgeIDStr(e *layoutgraph.Edge) string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%d", e.ID)
}

func legacyAddIncidentEdge(node *layoutgraph.Node, edge *layoutgraph.Edge) {
	node.Edges = append(node.Edges, edge)
}

func legacyRemoveIncidentEdge(node *layoutgraph.Node, edge *layoutgraph.Edge) {
	for index, candidate := range node.Edges {
		if candidate == edge {
			node.Edges = append(node.Edges[:index], node.Edges[index+1:]...)
			return
		}
	}
}

func reverseEdges(s []*layoutgraph.Edge) {
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
}

func main() {
	outPath := "test/fixtures/go-cluster-discovery-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"d2PinnedSha":    "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoos":    runtime.GOOS,
			"runtimeGoarch":  runtime.GOARCH,
			"goVersion":      runtime.Version(),
			"oracleBuildTag": "tala_cluster_discovery_oracle",
		},
		Scenarios: make(map[string]interface{}),
	}

	// =========================================================================
	// Scenario 1: Arrowhead and Edge Classification (Section 7)
	// =========================================================================
	{
		type ArrowCase struct {
			Source string `json:"source"`
			Target string `json:"target"`
		}
		pairs := []ArrowCase{
			{"", ""},
			{"none", "none"},
			{"triangle", ""},
			{"", "triangle"},
			{"triangle", "triangle"},
			{"diamond", "triangle"},
			{"none", "triangle"},
		}

		results := make([]map[string]interface{}, 0, len(pairs))
		for _, p := range pairs {
			g := layoutgraph.NewGraph()
			n1 := layoutgraph.NewNode(1, 10, 10)
			n2 := layoutgraph.NewNode(2, 10, 10)
			g.AddNewNodeToContainer(nil, n1)
			g.AddNewNodeToContainer(nil, n2)
			edge := g.Connect(n1, n2)
			edge.SourceArrowhead = layoutgraph.Arrowhead(p.Source)
			edge.TargetArrowhead = layoutgraph.Arrowhead(p.Target)

			results = append(results, map[string]interface{}{
				"source":          p.Source,
				"target":          p.Target,
				"hasSourceArrow":  edge.HasSourceArrow(),
				"hasTargetArrow":  edge.HasTargetArrow(),
				"isDirected":      edge.IsDirected(),
				"isBidirectional": edge.IsBidirectional(),
				"isUndirected":    edge.IsUndirected(),
			})
		}
		out.Scenarios["arrowheadAndEdgeClassification"] = results
	}

	// =========================================================================
	// Scenario 2: Node.Adjacent Oracle (Section 8)
	// =========================================================================
	{
		g := layoutgraph.NewGraph()
		from := layoutgraph.NewNode(1, 10, 10)
		to := layoutgraph.NewNode(2, 10, 10)
		loopNode := layoutgraph.NewNode(3, 10, 10)
		unrelated := layoutgraph.NewNode(4, 10, 10)

		g.AddNewNodeToContainer(nil, from)
		g.AddNewNodeToContainer(nil, to)
		g.AddNewNodeToContainer(nil, loopNode)
		g.AddNewNodeToContainer(nil, unrelated)

		edge := g.Connect(from, to)
		edge.ID = 100
		loopEdge := g.Connect(loopNode, loopNode)
		loopEdge.ID = 200

		out.Scenarios["nodeAdjacent"] = map[string]interface{}{
			"nodeIsFrom":      idStr(from.Adjacent(edge)),      // returns to (2)
			"nodeIsTo":        idStr(to.Adjacent(edge)),        // returns from (1)
			"nodeIsLoop":      idStr(loopNode.Adjacent(loopEdge)), // returns loopNode (3)
			"nodeIsUnrelated": idStr(unrelated.Adjacent(edge)), // malformed fallback returns edge.From (1)
		}
	}

	// =========================================================================
	// Scenario 3: Signature and Directed-Count Quirk (Section 9)
	// =========================================================================
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n3 := layoutgraph.NewNode(3, 10, 10)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, n3)

		// Empty
		sigEmpty := grouping.ClusterEdgeSignatureBuildBridge(n1, nil)

		// Single undirected
		eUndir := g.Connect(n1, n2)
		eUndir.ID = 10
		eUndir.SourceArrowhead = ""
		eUndir.TargetArrowhead = ""
		sigUndir := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eUndir})

		// Single directed
		eDir := g.Connect(n1, n2)
		eDir.ID = 11
		eDir.SourceArrowhead = ""
		eDir.TargetArrowhead = "triangle"
		sigDir := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eDir})

		// Single bidirectional
		eBidir := g.Connect(n1, n2)
		eBidir.ID = 12
		eBidir.SourceArrowhead = "triangle"
		eBidir.TargetArrowhead = "triangle"
		sigBidir := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eBidir})

		// Parallel edges (2 directed)
		eDir2 := g.Connect(n1, n2)
		eDir2.ID = 13
		eDir2.SourceArrowhead = ""
		eDir2.TargetArrowhead = "triangle"
		sigParallel := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eDir, eDir2})

		// Loop edge
		eLoop := g.Connect(n1, n1)
		eLoop.ID = 14
		eLoop.SourceArrowhead = ""
		eLoop.TargetArrowhead = ""
		sigLoop := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eLoop})

		// Mixed arrow types: 1 directed + 1 undirected
		sigMixed := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eDir, eUndir})

		// Different arrowheads: triangle vs diamond
		eDiamond := g.Connect(n1, n2)
		eDiamond.ID = 15
		eDiamond.SourceArrowhead = ""
		eDiamond.TargetArrowhead = "diamond"
		sigDiamond := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eDiamond})

		// Directed count quirk:
		// Directed count quirk:
		// Node A has 2 directed edges: A->B (source="triangle", target="") and B->A (source="", target="triangle").
		// For A: From=1, To=1, Directed=2, Bidir=0, Undir=0, fromAH={"triangle"}, toAH={""}.
		eAtoB := g.Connect(n1, n2)
		eAtoB.ID = 20
		eAtoB.SourceArrowhead = "triangle"
		eAtoB.TargetArrowhead = ""
		eBtoA := g.Connect(n2, n1)
		eBtoA.ID = 21
		eBtoA.SourceArrowhead = ""
		eBtoA.TargetArrowhead = "triangle"
		sigQuirkA := grouping.ClusterEdgeSignatureBuildBridge(n1, []*layoutgraph.Edge{eAtoB, eBtoA})

		// Node C has 1 directed loop: C->C with source="triangle", target="".
		// For C: From=1, To=1, Directed=1, Bidir=0, Undir=0, fromAH={"triangle"}, toAH={""}.
		eLoopDir := g.Connect(n3, n3)
		eLoopDir.ID = 22
		eLoopDir.SourceArrowhead = "triangle"
		eLoopDir.TargetArrowhead = ""
		sigQuirkC := grouping.ClusterEdgeSignatureBuildBridge(n3, []*layoutgraph.Edge{eLoopDir})

		quirkMatches := grouping.ClusterEdgeSignatureMatchesBridge(sigQuirkA, sigQuirkC)

		out.Scenarios["edgeSignatures"] = map[string]interface{}{
			"empty":            sigEmpty,
			"singleUndirected": sigUndir,
			"singleDirected":   sigDir,
			"singleBidir":      sigBidir,
			"parallel":         sigParallel,
			"loop":             sigLoop,
			"mixed":            sigMixed,
			"diamond":          sigDiamond,
			"quirkSigA":        sigQuirkA,
			"quirkSigC":        sigQuirkC,
			"quirkMatches":     quirkMatches, // true in Go!
			"matching": map[string]bool{
				"empty_vs_empty":       grouping.ClusterEdgeSignatureMatchesBridge(sigEmpty, sigEmpty),
				"undir_vs_undir":       grouping.ClusterEdgeSignatureMatchesBridge(sigUndir, sigUndir),
				"undir_vs_dir":         grouping.ClusterEdgeSignatureMatchesBridge(sigUndir, sigDir),
				"undir_vs_bidir":       grouping.ClusterEdgeSignatureMatchesBridge(sigUndir, sigBidir),
				"dir_vs_parallel":      grouping.ClusterEdgeSignatureMatchesBridge(sigDir, sigParallel),
				"dir_vs_diamond":       grouping.ClusterEdgeSignatureMatchesBridge(sigDir, sigDiamond),
				"mixed_vs_mixed":       grouping.ClusterEdgeSignatureMatchesBridge(sigMixed, sigMixed),
				"mixed_vs_dir":         grouping.ClusterEdgeSignatureMatchesBridge(sigMixed, sigDir),
			},
		}
	}

	// =========================================================================
	// Scenario 4: Sequence Neighbor Recovery Oracle (Section 10)
	// =========================================================================
	{
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		step := layoutgraph.NewNode(3, 10, 10)
		vessel := layoutgraph.NewNode(4, 10, 10)
		other := layoutgraph.NewNode(5, 10, 10)

		for idx, n := range []*layoutgraph.Node{first, second, step, vessel, other} {
			n.TopLeft = geo.NewPoint(float64(idx*50), 0)
			n.Graph = g
		}
		g.AddNewNodeToContainer(nil, first)
		g.AddNewNodeToContainer(nil, second)
		g.AddNewNodeToContainer(nil, other)

		edge := g.Connect(first, vessel)
		edge.ID = 100
		legacyAddIncidentEdge(second, edge) // malformed observer

		edgeOther := g.Connect(other, vessel)
		edgeOther.ID = 101

		edgeUncached := g.Connect(first, other)
		edgeUncached.ID = 102

		sequence := &layoutgraph.Sequence{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{step},
			Graph:  g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{Edge: edge, CurrentFrom: first, CurrentTo: vessel},
				{Edge: edge, OriginallyTo: step, CurrentFrom: first, CurrentTo: vessel},
				{Edge: edgeOther, OriginallyFrom: step, CurrentFrom: vessel, CurrentTo: other},
			},
		}
		g.Sequences[vessel] = sequence

		guard, _ := limits.NewWorkGuard(context.Background(), "seq recovery oracle", limits.MaxTransactionWorkUnits)
		bridge, err := grouping.BuildClusterDiscoveryIndexBridge(g, nil, guard)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to build bridge for seq recovery: %v\n", err)
			os.Exit(1)
		}

		infoFirst := bridge.GetInfoDTO(first)
		infoSecond := bridge.GetInfoDTO(second)

		// Test sequenceOriginal directly and measure WorkGuard Used delta
		guard1, _ := limits.NewWorkGuard(context.Background(), "seq delta 1", limits.MaxTransactionWorkUnits)
		gFresh := layoutgraph.NewGraph()
		bridgeFresh, _ := grouping.BuildClusterDiscoveryIndexBridge(gFresh, nil, guard1)

		usedBefore1 := guard1.Used()
		orig1, _ := bridgeFresh.SequenceOriginalBridge(sequence, edge, guard1)
		usedAfter1 := guard1.Used()
		delta1 := usedAfter1 - usedBefore1

		usedBefore2 := guard1.Used()
		orig2, _ := bridgeFresh.SequenceOriginalBridge(sequence, edge, guard1)
		usedAfter2 := guard1.Used()
		delta2 := usedAfter2 - usedBefore2

		// Cached null lookup
		usedBeforeNull := guard1.Used()
		origNull, _ := bridgeFresh.SequenceOriginalBridge(sequence, edgeUncached, guard1)
		usedAfterNull := guard1.Used()
		deltaNull := usedAfterNull - usedBeforeNull

		out.Scenarios["sequenceNeighborRecovery"] = map[string]interface{}{
			"firstNeighbors":   infoFirst.Neighbors,  // [3]
			"secondNeighbors":  infoSecond.Neighbors, // [3]
			"orig1":            idStr(orig1),
			"orig2":            idStr(orig2),
			"origNull":         idStr(origNull),
			"deltaFirstLookup": delta1,
			"deltaSecondLookup": delta2, // 0 in Go!
			"deltaNullLookup":  deltaNull,
		}
	}

	// =========================================================================
	// Scenario 5: Legacy/Index Parity Corpus 0..99 (Section 11)
	// =========================================================================
	{
		arrowheads := []layoutgraph.Arrowhead{"", layoutgraph.NoArrowhead, layoutgraph.TriangleArrowhead, layoutgraph.Arrowhead("diamond")}
		type EdgeRecipe struct {
			ID                    int64  `json:"id"`
			FromID                int64  `json:"fromId"`
			ToID                  int64  `json:"toId"`
			SourceArrowhead       string `json:"sourceArrowhead"`
			TargetArrowhead       string `json:"targetArrowhead"`
			RemovedToSideIncident bool   `json:"removedToSideIncident"`
			FromTableColumnIndex  *int   `json:"fromTableColumnIndex"`
		}
		type SeedResult struct {
			Seed        int64                                        `json:"seed"`
			NodeCount   int                                          `json:"nodeCount"`
			EdgeRecipes []EdgeRecipe                                 `json:"edgeRecipes"`
			Nodes       map[string]*grouping.ClusterDiscoveryInfoDTO `json:"nodes"`
			Matches     map[string]bool                              `json:"matches"`
		}

		corpus := make([]SeedResult, 0, 100)
		for seed := int64(0); seed < 100; seed++ {
			random := rand.New(rand.NewSource(seed))
			g := layoutgraph.NewGraph()
			for index := 0; index < 12; index++ {
				node := layoutgraph.NewNode(layoutgraph.EntityID(index+1), float64(10+index), float64(20+index))
				node.TopLeft = geo.NewPoint(float64(index*50), float64((index%3)*50))
				g.AddNewNodeToContainer(nil, node)
			}
			edgeRecipes := make([]EdgeRecipe, 0, 40)
			for index := 0; index < 40; index++ {
				from := g.Nodes[random.Intn(len(g.Nodes))]
				to := g.Nodes[random.Intn(len(g.Nodes))]
				edge := g.Connect(from, to)
				edge.ID = layoutgraph.EntityID(1000 + index)
				edge.SourceArrowhead = arrowheads[random.Intn(len(arrowheads))]
				edge.TargetArrowhead = arrowheads[random.Intn(len(arrowheads))]
				removed := false
				if from != to && random.Intn(4) == 0 {
					legacyRemoveIncidentEdge(to, edge)
					removed = true
				}
				var colPtr *int
				if random.Intn(9) == 0 {
					column := index
					colPtr = &column
					edge.FromTableColumnIndex = &column
				}
				edgeRecipes = append(edgeRecipes, EdgeRecipe{
					ID:                    int64(edge.ID),
					FromID:                int64(from.ID),
					ToID:                  int64(to.ID),
					SourceArrowhead:       string(edge.SourceArrowhead),
					TargetArrowhead:       string(edge.TargetArrowhead),
					RemovedToSideIncident: removed,
					FromTableColumnIndex:  colPtr,
				})
			}

			guard, _ := limits.NewWorkGuard(context.Background(), "legacy corpus", limits.MaxTransactionWorkUnits)
			bridge, err := grouping.BuildClusterDiscoveryIndexBridge(g, nil, guard)
			if err != nil {
				fmt.Fprintf(os.Stderr, "seed %d: build index failed: %v\n", seed, err)
				os.Exit(1)
			}

			nodeInfos := make(map[string]*grouping.ClusterDiscoveryInfoDTO, len(g.Containers[nil]))
			for _, node := range g.Containers[nil] {
				nodeInfos[idStr(node)] = bridge.GetInfoDTO(node)
			}

			matches := make(map[string]bool)
			for _, first := range g.Containers[nil] {
				for _, second := range g.Containers[nil] {
					key := fmt.Sprintf("%d_%d", first.ID, second.ID)
					matches[key] = bridge.SignaturesMatch(first, second)
				}
			}

			corpus = append(corpus, SeedResult{
				Seed:        seed,
				NodeCount:   12,
				EdgeRecipes: edgeRecipes,
				Nodes:       nodeInfos,
				Matches:     matches,
			})
		}
		out.Scenarios["legacyCorpus"] = corpus
	}

	// =========================================================================
	// Scenario 6: Leaky-Container Oracle (Section 12)
	// =========================================================================
	{
		leakyResults := make(map[string]interface{})
		for _, leaky := range []bool{false, true} {
			g := layoutgraph.NewGraph()
			container := layoutgraph.NewNode(1, 100, 100)
			child := layoutgraph.NewNode(2, 10, 10)
			external := layoutgraph.NewNode(3, 10, 10)
			container.TopLeft = geo.NewPoint(0, 0)
			child.TopLeft = geo.NewPoint(10, 10)
			external.TopLeft = geo.NewPoint(200, 0)
			g.AddNewNodeToContainer(nil, container)
			g.AddNewNodeToContainer(container, child)

			if leaky {
				g.AddNewNodeToContainer(nil, external)
				e := g.Connect(child, external)
				e.ID = 10
			} else {
				e := g.Connect(container, child)
				e.ID = 10
			}

			guard, _ := limits.NewWorkGuard(context.Background(), "leaky oracle", limits.MaxTransactionWorkUnits)
			order, _ := g.ContainerRDFSOrder(nil, guard)
			usedBeforeBuild := guard.Used()
			bridge, err := grouping.BuildClusterDiscoveryIndexBridge(g, order, guard)
			if err != nil {
				fmt.Fprintf(os.Stderr, "leaky=%v: build bridge failed: %v\n", leaky, err)
				os.Exit(1)
			}
			usedAfterBuild := guard.Used()

			guardLeaky, _ := limits.NewWorkGuard(context.Background(), "leaky standalone", limits.MaxTransactionWorkUnits)
			isLeaky, _ := grouping.ClusterHasLeakyEdgeGuardedBridge(g, container, guardLeaky)
			leakyUsed := guardLeaky.Used()

			infoContainer := bridge.GetInfoDTO(container)
			caseKey := "leaky_false"
			if leaky {
				caseKey = "leaky_true"
			}
			leakyResults[caseKey] = map[string]interface{}{
				"isLeaky":           isLeaky,
				"noClustering":      infoContainer.NoClustering,
				"leakyStandaloneUsed": leakyUsed,
				"buildUsedDelta":    usedAfterBuild - usedBeforeBuild,
			}
		}
		out.Scenarios["leakyContainer"] = leakyResults
	}

	// =========================================================================
	// Scenario 7: RefreshAfterClusterAbduction Oracle (Section 13)
	// =========================================================================
	{
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		external := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		malformedObserver := layoutgraph.NewNode(5, 10, 10)

		for idx, n := range []*layoutgraph.Node{first, second, external, other, malformedObserver} {
			n.TopLeft = geo.NewPoint(float64(idx*50), 0)
			g.AddNewNodeToContainer(nil, n)
		}

		firstEdge := g.Connect(first, external)
		firstEdge.ID = 100
		legacyAddIncidentEdge(malformedObserver, firstEdge)

		e2 := g.Connect(external, other)
		e2.ID = 101
		e3 := g.Connect(second, external)
		e3.ID = 102

		guard, _ := limits.NewWorkGuard(context.Background(), "refresh abduction", limits.MaxTransactionWorkUnits)
		bridge, err := grouping.BuildClusterDiscoveryIndexBridge(g, nil, guard)
		if err != nil {
			fmt.Fprintf(os.Stderr, "refresh abduction build failed: %v\n", err)
			os.Exit(1)
		}

		initialExtNeighbors := bridge.GetInfoDTO(external).Neighbors
		initialMalformedNeighbors := bridge.GetInfoDTO(malformedObserver).Neighbors

		cluster := &layoutgraph.Cluster{
			Nodes:              []*layoutgraph.Node{first, second},
			Graph:              g,
			Arrangement:        layoutgraph.Row,
			DesiredArrangement: layoutgraph.Row,
		}
		vessel := grouping.CreateVessel(cluster, 100)
		cluster.Vessel = vessel
		grouping.AddCluster(g, cluster)

		incidentEdges, err := bridge.ClusterIncidentEdgesBridge(cluster, guard)
		if err != nil {
			fmt.Fprintf(os.Stderr, "incident edges failed: %v\n", err)
			os.Exit(1)
		}

		incidentEdgeIDs := make([]string, 0, len(incidentEdges))
		for _, e := range incidentEdges {
			incidentEdgeIDs = append(incidentEdgeIDs, edgeIDStr(e))
		}

		// Reconnect incident edges to simulate abduction (only in test setup!)
		for _, edge := range incidentEdges {
			if edge.From.Cluster == cluster {
				edge.Reconnect(cluster.Vessel, false)
			}
			if edge.To.Cluster == cluster {
				edge.Reconnect(cluster.Vessel, true)
			}
		}

		usedBeforeRefresh := guard.Used()
		if err := bridge.RefreshAfterClusterAbductionBridge(g, cluster, incidentEdges, guard); err != nil {
			fmt.Fprintf(os.Stderr, "refresh after abduction failed: %v\n", err)
			os.Exit(1)
		}
		usedAfterRefresh := guard.Used()

		postExtNeighbors := bridge.GetInfoDTO(external).Neighbors
		postMalformedNeighbors := bridge.GetInfoDTO(malformedObserver).Neighbors

		out.Scenarios["refreshAfterClusterAbduction"] = map[string]interface{}{
			"initialExternalNeighbors":  initialExtNeighbors,
			"initialMalformedNeighbors": initialMalformedNeighbors,
			"incidentEdgeIDs":           incidentEdgeIDs,
			"postExternalNeighbors":     postExtNeighbors,
			"postMalformedNeighbors":    postMalformedNeighbors,
			"vesselHasInfo":             bridge.HasInfo(vessel), // false: vessel is excluded from discovery index
			"refreshUsedDelta":          usedAfterRefresh - usedBeforeRefresh,
		}
	}

	// =========================================================================
	// Scenario 8: ClusterIncidentEdges Oracle (Section 14)
	// =========================================================================
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n3 := layoutgraph.NewNode(3, 10, 10)
		ext := layoutgraph.NewNode(4, 10, 10)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.AddNewNodeToContainer(nil, n3)
		g.AddNewNodeToContainer(nil, ext)

		// Create edges with specific Graph.Edges order
		e1 := g.Connect(n1, ext) // ID 10
		e1.ID = 10
		e2 := g.Connect(n1, n2)  // ID 11 (shared between n1 and n2)
		e2.ID = 11
		e3 := g.Connect(n2, ext) // ID 12
		e3.ID = 12
		eLoop := g.Connect(n1, n1) // ID 13 (loop)
		eLoop.ID = 13
		eParallel := g.Connect(n2, ext) // ID 14 (parallel to e3)
		eParallel.ID = 14

		guard, _ := limits.NewWorkGuard(context.Background(), "incident oracle", limits.MaxTransactionWorkUnits)
		bridge, _ := grouping.BuildClusterDiscoveryIndexBridge(g, nil, guard)

		// 1. Empty cluster
		cEmpty := &layoutgraph.Cluster{Nodes: nil, Graph: g}
		edgesEmpty, _ := bridge.ClusterIncidentEdgesBridge(cEmpty, guard)

		// 2. One member (n3 has no edges)
		cOneEmpty := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{n3}, Graph: g}
		edgesOneEmpty, _ := bridge.ClusterIncidentEdgesBridge(cOneEmpty, guard)

		// 3. Cluster with n1 and n2 (includes shared, parallel, loop, external)
		cMembers := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{n1, n2}, Graph: g}
		edgesMembers, _ := bridge.ClusterIncidentEdgesBridge(cMembers, guard)

		// 4. Duplicate member occurrence
		cDup := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{n1, n1, n2}, Graph: g}
		edgesDup, _ := bridge.ClusterIncidentEdgesBridge(cDup, guard)

		// 5. Graph.Edges order vs Node.Edges order:
		// Reverse n1.Edges order
		reverseEdges(n1.Edges)
		edgesReversedNode, _ := bridge.ClusterIncidentEdgesBridge(cMembers, guard)
		reverseEdges(n1.Edges) // restore

		// 6. Missing member info error
		unindexedNode := layoutgraph.NewNode(999, 10, 10)
		cMissing := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{unindexedNode}, Graph: g}
		_, errMissing := bridge.ClusterIncidentEdgesBridge(cMissing, guard)
		missingErrMsg := ""
		if errMissing != nil {
			missingErrMsg = errMissing.Error()
		}

		toIDList := func(edges []*layoutgraph.Edge) []string {
			ids := make([]string, 0, len(edges))
			for _, e := range edges {
				ids = append(ids, edgeIDStr(e))
			}
			return ids
		}

		out.Scenarios["clusterIncidentEdges"] = map[string]interface{}{
			"emptyCluster":        toIDList(edgesEmpty),
			"oneMemberEmpty":      toIDList(edgesOneEmpty),
			"membersEdges":        toIDList(edgesMembers),
			"duplicateMembers":    toIDList(edgesDup),
			"reversedNodeEdges":   toIDList(edgesReversedNode),
			"missingMemberErrMsg": missingErrMsg,
		}
	}

	// =========================================================================
	// Scenario 9: Exact WorkGuard Parity (Section 15)
	// =========================================================================
	{
		workGuardCases := make(map[string]int64)

		// clusterIsDescendantOfGuarded
		{
			g := layoutgraph.NewGraph()
			root := layoutgraph.NewNode(1, 100, 100)
			mid := layoutgraph.NewNode(2, 50, 50)
			leaf := layoutgraph.NewNode(3, 10, 10)
			unrelated := layoutgraph.NewNode(4, 10, 10)

			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, mid)
			g.AddNewNodeToContainer(mid, leaf)
			g.AddNewNodeToContainer(nil, unrelated)

			measureDescendant := func(d, a *layoutgraph.Node) int64 {
				gd, _ := limits.NewWorkGuard(context.Background(), "desc test", limits.MaxTransactionWorkUnits)
				_, _ = grouping.ClusterIsDescendantOfGuardedBridge(d, a, gd)
				return gd.Used()
			}

			workGuardCases["descendant_self"] = measureDescendant(leaf, leaf)
			workGuardCases["descendant_null_null"] = measureDescendant(nil, nil)
			workGuardCases["descendant_null_non_null"] = measureDescendant(nil, root)
			workGuardCases["descendant_parent"] = measureDescendant(mid, root)
			workGuardCases["descendant_nested"] = measureDescendant(leaf, root)
			workGuardCases["descendant_unrelated"] = measureDescendant(unrelated, root)

			// Cycle in containers
			cycle1 := layoutgraph.NewNode(10, 10, 10)
			cycle2 := layoutgraph.NewNode(11, 10, 10)
			cycle1.Container = cycle2
			cycle2.Container = cycle1
			workGuardCases["descendant_cycle"] = measureDescendant(cycle1, root)
		}

		// AllDescendantNodesWithWorkGuard
		{
			measureDescendants := func(setup func(*layoutgraph.Graph) *layoutgraph.Node, includeClusters bool) int64 {
				g := layoutgraph.NewGraph()
				target := setup(g)
				gd, _ := limits.NewWorkGuard(context.Background(), "all desc", limits.MaxTransactionWorkUnits)
				_, _ = g.AllDescendantNodesWithWorkGuard(target, includeClusters, gd)
				return gd.Used()
			}

			workGuardCases["allDesc_empty"] = measureDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
				n := layoutgraph.NewNode(1, 10, 10)
				g.AddNewNodeToContainer(nil, n)
				return n
			}, true)

			workGuardCases["allDesc_nested_container"] = measureDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
				root := layoutgraph.NewNode(1, 10, 10)
				c1 := layoutgraph.NewNode(2, 10, 10)
				c2 := layoutgraph.NewNode(3, 10, 10)
				g.AddNewNodeToContainer(nil, root)
				g.AddNewNodeToContainer(root, c1)
				g.AddNewNodeToContainer(c1, c2)
				return root
			}, true)

			workGuardCases["allDesc_cluster_vessel_include_true"] = measureDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
				root := layoutgraph.NewNode(1, 10, 10)
				m1 := layoutgraph.NewNode(2, 10, 10)
				m2 := layoutgraph.NewNode(3, 10, 10)
				cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
				vessel := grouping.CreateVessel(cluster, 100)
				cluster.Vessel = vessel
				grouping.AddCluster(g, cluster)
				g.AddNewNodeToContainer(nil, root)
				g.AddNewNodeToContainer(root, vessel)
				return root
			}, true)

			workGuardCases["allDesc_cluster_vessel_include_false"] = measureDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
				root := layoutgraph.NewNode(1, 10, 10)
				m1 := layoutgraph.NewNode(2, 10, 10)
				m2 := layoutgraph.NewNode(3, 10, 10)
				cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
				vessel := grouping.CreateVessel(cluster, 100)
				cluster.Vessel = vessel
				grouping.AddCluster(g, cluster)
				g.AddNewNodeToContainer(nil, root)
				g.AddNewNodeToContainer(root, vessel)
				return root
			}, false)
		}

		// sequenceOriginal
		{
			g := layoutgraph.NewGraph()
			vessel := layoutgraph.NewNode(1, 10, 10)
			s1 := layoutgraph.NewNode(2, 10, 10)
			s2 := layoutgraph.NewNode(3, 10, 10)
			e1 := g.Connect(s1, vessel)
			e2 := g.Connect(s2, vessel)

			seqEmpty := &layoutgraph.Sequence{Vessel: vessel, Nodes: nil, Graph: g}
			seqMulti := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
				Graph:  g,
				EdgeAbductions: []*layoutgraph.EdgeAbduction{
					{Edge: e1, OriginallyFrom: s1, CurrentFrom: vessel},
					{Edge: e2, OriginallyFrom: s2, CurrentFrom: vessel},
				},
			}

			gd, _ := limits.NewWorkGuard(context.Background(), "seq orig guard", limits.MaxTransactionWorkUnits)
			bridge, _ := grouping.BuildClusterDiscoveryIndexBridge(g, nil, gd)

			gd1, _ := limits.NewWorkGuard(context.Background(), "seq1", limits.MaxTransactionWorkUnits)
			_, _ = bridge.SequenceOriginalBridge(seqEmpty, e1, gd1)
			workGuardCases["sequenceOriginal_empty"] = gd1.Used()

			gd2, _ := limits.NewWorkGuard(context.Background(), "seq2", limits.MaxTransactionWorkUnits)
			_, _ = bridge.SequenceOriginalBridge(seqMulti, e1, gd2)
			workGuardCases["sequenceOriginal_first_cached_build"] = gd2.Used()

			usedBefore := gd2.Used()
			_, _ = bridge.SequenceOriginalBridge(seqMulti, e1, gd2)
			workGuardCases["sequenceOriginal_second_cached_lookup"] = gd2.Used() - usedBefore
		}

		// refreshNeighbors
		{
			measureRefresh := func(setup func(*layoutgraph.Graph) *layoutgraph.Node) int64 {
				g := layoutgraph.NewGraph()
				n := setup(g)
				gd, _ := limits.NewWorkGuard(context.Background(), "refresh", limits.MaxTransactionWorkUnits)
				bridge, _ := grouping.BuildClusterDiscoveryIndexBridge(g, nil, gd)
				gdNode, _ := limits.NewWorkGuard(context.Background(), "refresh node", limits.MaxTransactionWorkUnits)
				_ = bridge.RefreshNeighborsBridge(g, n, gdNode)
				return gdNode.Used()
			}

			workGuardCases["refreshNeighbors_no_edge"] = measureRefresh(func(g *layoutgraph.Graph) *layoutgraph.Node {
				n := layoutgraph.NewNode(1, 10, 10)
				g.AddNewNodeToContainer(nil, n)
				return n
			})

			workGuardCases["refreshNeighbors_one_edge"] = measureRefresh(func(g *layoutgraph.Graph) *layoutgraph.Node {
				n1 := layoutgraph.NewNode(1, 10, 10)
				n2 := layoutgraph.NewNode(2, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				g.AddNewNodeToContainer(nil, n2)
				g.Connect(n1, n2)
				return n1
			})

			workGuardCases["refreshNeighbors_duplicate_neighbor"] = measureRefresh(func(g *layoutgraph.Graph) *layoutgraph.Node {
				n1 := layoutgraph.NewNode(1, 10, 10)
				n2 := layoutgraph.NewNode(2, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				g.AddNewNodeToContainer(nil, n2)
				g.Connect(n1, n2)
				g.Connect(n1, n2)
				return n1
			})
		}

		// clusterIncidentEdges
		{
			measureIncident := func(edgeCount int) int64 {
				g := layoutgraph.NewGraph()
				n1 := layoutgraph.NewNode(1, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				for i := 0; i < edgeCount; i++ {
					ext := layoutgraph.NewNode(layoutgraph.EntityID(10+i), 10, 10)
					g.AddNewNodeToContainer(nil, ext)
					g.Connect(n1, ext)
				}
				gdInit, _ := limits.NewWorkGuard(context.Background(), "init", limits.MaxTransactionWorkUnits)
				bridge, _ := grouping.BuildClusterDiscoveryIndexBridge(g, nil, gdInit)

				cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{n1}, Graph: g}
				gdIncident, _ := limits.NewWorkGuard(context.Background(), "incident", limits.MaxTransactionWorkUnits)
				_, _ = bridge.ClusterIncidentEdgesBridge(cluster, gdIncident)
				return gdIncident.Used()
			}

			workGuardCases["clusterIncidentEdges_empty"] = measureIncident(0)
			workGuardCases["clusterIncidentEdges_1_edge"] = measureIncident(1)
			workGuardCases["clusterIncidentEdges_2_edges"] = measureIncident(2)
			workGuardCases["clusterIncidentEdges_4_edges"] = measureIncident(4)
		}

		// buildClusterDiscoveryIndex representative real topologies
		{
			// 1. root only
			{
				g := layoutgraph.NewGraph()
				n1 := layoutgraph.NewNode(1, 10, 10)
				n2 := layoutgraph.NewNode(2, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				g.AddNewNodeToContainer(nil, n2)
				g.Connect(n1, n2)
				gd, _ := limits.NewWorkGuard(context.Background(), "b_root_only", limits.MaxTransactionWorkUnits)
				_, _ = grouping.BuildClusterDiscoveryIndexBridge(g, []*layoutgraph.Node{n1, n2}, gd)
				workGuardCases["buildClusterDiscoveryIndex_root_only"] = gd.Used()
			}

			// 2. nested
			{
				g := layoutgraph.NewGraph()
				root := layoutgraph.NewNode(1, 100, 100)
				child1 := layoutgraph.NewNode(2, 10, 10)
				child2 := layoutgraph.NewNode(3, 10, 10)
				g.AddNewNodeToContainer(nil, root)
				g.AddNewNodeToContainer(root, child1)
				g.AddNewNodeToContainer(root, child2)
				g.Connect(child1, child2)
				gd, _ := limits.NewWorkGuard(context.Background(), "b_nested", limits.MaxTransactionWorkUnits)
				_, _ = grouping.BuildClusterDiscoveryIndexBridge(g, []*layoutgraph.Node{root, child1, child2}, gd)
				workGuardCases["buildClusterDiscoveryIndex_nested"] = gd.Used()
			}

			// 3. malformed adjacency
			{
				g := layoutgraph.NewGraph()
				n1 := layoutgraph.NewNode(1, 10, 10)
				n2 := layoutgraph.NewNode(2, 10, 10)
				n3 := layoutgraph.NewNode(3, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				g.AddNewNodeToContainer(nil, n2)
				g.AddNewNodeToContainer(nil, n3)
				e := g.Connect(n1, n2)
				legacyAddIncidentEdge(n3, e)
				gd, _ := limits.NewWorkGuard(context.Background(), "b_malformed", limits.MaxTransactionWorkUnits)
				_, _ = grouping.BuildClusterDiscoveryIndexBridge(g, []*layoutgraph.Node{n1, n2, n3}, gd)
				workGuardCases["buildClusterDiscoveryIndex_malformed_adjacency"] = gd.Used()
			}

			// 4. sequence recovery
			{
				g := layoutgraph.NewGraph()
				n1 := layoutgraph.NewNode(1, 10, 10)
				vessel := layoutgraph.NewNode(2, 10, 10)
				step := layoutgraph.NewNode(3, 10, 10)
				g.AddNewNodeToContainer(nil, n1)
				g.AddNewNodeToContainer(nil, vessel)
				e := g.Connect(n1, vessel)
				seq := &layoutgraph.Sequence{
					Vessel: vessel,
					Nodes:  []*layoutgraph.Node{step},
					Graph:  g,
					EdgeAbductions: []*layoutgraph.EdgeAbduction{
						{Edge: e, OriginallyTo: step, CurrentFrom: n1, CurrentTo: vessel},
					},
				}
				g.Sequences[vessel] = seq
				gd, _ := limits.NewWorkGuard(context.Background(), "b_seq", limits.MaxTransactionWorkUnits)
				_, _ = grouping.BuildClusterDiscoveryIndexBridge(g, []*layoutgraph.Node{n1, vessel}, gd)
				workGuardCases["buildClusterDiscoveryIndex_sequence_recovery"] = gd.Used()
			}

			// 5. leaky container
			{
				g := layoutgraph.NewGraph()
				container := layoutgraph.NewNode(1, 100, 100)
				child := layoutgraph.NewNode(2, 10, 10)
				external := layoutgraph.NewNode(3, 10, 10)
				g.AddNewNodeToContainer(nil, container)
				g.AddNewNodeToContainer(container, child)
				g.AddNewNodeToContainer(nil, external)
				g.Connect(child, external)
				gd, _ := limits.NewWorkGuard(context.Background(), "b_leaky", limits.MaxTransactionWorkUnits)
				_, _ = grouping.BuildClusterDiscoveryIndexBridge(g, []*layoutgraph.Node{container, child, external}, gd)
				workGuardCases["buildClusterDiscoveryIndex_leaky_container"] = gd.Used()
			}
		}

		out.Scenarios["exactWorkGuard"] = workGuardCases
	}

	// =========================================================================
	// Scenario 10: Full Descendant Traversal Oracle (Section 18)
	// =========================================================================
	{
		type DescendantCase struct {
			Descendants []string `json:"descendants"`
			GuardUsed   int64    `json:"guardUsed"`
		}
		descendantCases := make(map[string]DescendantCase)

		runDescendants := func(setup func(*layoutgraph.Graph) *layoutgraph.Node, includeCluster bool) DescendantCase {
			g := layoutgraph.NewGraph()
			target := setup(g)
			gd, _ := limits.NewWorkGuard(context.Background(), "desc traversal", limits.MaxTransactionWorkUnits)
			nodes, _ := g.AllDescendantNodesWithWorkGuard(target, includeCluster, gd)
			ids := make([]string, 0, len(nodes))
			for _, n := range nodes {
				ids = append(ids, idStr(n))
			}
			return DescendantCase{
				Descendants: ids,
				GuardUsed:   gd.Used(),
			}
		}

		// Plain containers
		descendantCases["plain_containers"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			c1 := layoutgraph.NewNode(2, 10, 10)
			c2 := layoutgraph.NewNode(3, 10, 10)
			n1 := layoutgraph.NewNode(4, 10, 10)
			n2 := layoutgraph.NewNode(5, 10, 10)
			n3 := layoutgraph.NewNode(6, 10, 10)
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, c1)
			g.AddNewNodeToContainer(root, c2)
			g.AddNewNodeToContainer(c1, n1)
			g.AddNewNodeToContainer(c1, n2)
			g.AddNewNodeToContainer(c2, n3)
			return root
		}, true)

		// Nested containers
		descendantCases["nested_containers"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			c1 := layoutgraph.NewNode(2, 10, 10)
			c2 := layoutgraph.NewNode(3, 10, 10)
			n1 := layoutgraph.NewNode(4, 10, 10)
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, c1)
			g.AddNewNodeToContainer(c1, c2)
			g.AddNewNodeToContainer(c2, n1)
			return root
		}, true)

		// Cluster vessel: include=true vs include=false
		descendantCases["cluster_vessel_include_true"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			m1 := layoutgraph.NewNode(2, 10, 10)
			m2 := layoutgraph.NewNode(3, 10, 10)
			cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
			vessel := grouping.CreateVessel(cluster, 100)
			cluster.Vessel = vessel
			grouping.AddCluster(g, cluster)
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, vessel)
			return root
		}, true)

		descendantCases["cluster_vessel_include_false"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			m1 := layoutgraph.NewNode(2, 10, 10)
			m2 := layoutgraph.NewNode(3, 10, 10)
			cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
			vessel := grouping.CreateVessel(cluster, 100)
			cluster.Vessel = vessel
			grouping.AddCluster(g, cluster)
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, vessel)
			return root
		}, false)

		// Sequence vessel: include=true vs include=false
		descendantCases["sequence_vessel_include_true"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			vessel := layoutgraph.NewNode(2, 10, 10)
			sm1 := layoutgraph.NewNode(3, 10, 10)
			sm2 := layoutgraph.NewNode(4, 10, 10)
			seq := &layoutgraph.Sequence{Vessel: vessel, Nodes: []*layoutgraph.Node{sm1, sm2}, Graph: g}
			g.Sequences[vessel] = seq
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, vessel)
			return root
		}, true)

		descendantCases["sequence_vessel_include_false"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			vessel := layoutgraph.NewNode(2, 10, 10)
			sm1 := layoutgraph.NewNode(3, 10, 10)
			sm2 := layoutgraph.NewNode(4, 10, 10)
			seq := &layoutgraph.Sequence{Vessel: vessel, Nodes: []*layoutgraph.Node{sm1, sm2}, Graph: g}
			g.Sequences[vessel] = seq
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, vessel)
			return root
		}, false)

		// Mixed topology
		descendantCases["mixed_topology_include_true"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			child := layoutgraph.NewNode(2, 10, 10)
			cm1 := layoutgraph.NewNode(3, 10, 10)
			cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{cm1}, Graph: g}
			cv := grouping.CreateVessel(cluster, 100)
			cluster.Vessel = cv
			grouping.AddCluster(g, cluster)

			sv := layoutgraph.NewNode(4, 10, 10)
			sm1 := layoutgraph.NewNode(5, 10, 10)
			seq := &layoutgraph.Sequence{Vessel: sv, Nodes: []*layoutgraph.Node{sm1}, Graph: g}
			g.Sequences[sv] = seq

			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, child)
			g.AddNewNodeToContainer(root, cv)
			g.AddNewNodeToContainer(root, sv)
			return root
		}, true)

		// Duplicate references & seen suppression
		descendantCases["duplicate_references"] = runDescendants(func(g *layoutgraph.Graph) *layoutgraph.Node {
			root := layoutgraph.NewNode(1, 10, 10)
			child := layoutgraph.NewNode(2, 10, 10)
			g.AddNewNodeToContainer(nil, root)
			g.AddNewNodeToContainer(root, child)
			g.Containers[root] = append(g.Containers[root], child) // duplicate child in container list
			return root
		}, true)

		out.Scenarios["descendantTraversal"] = descendantCases
	}

	// Write formatted JSON
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to marshal oracle json: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write oracle file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Wrote Go cluster discovery reference to %s (%d bytes)\n", outPath, len(bytes))
}
