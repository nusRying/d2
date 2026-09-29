package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type TopologyOracleOutput struct {
	Metadata map[string]string      `json:"metadata"`
	Cases    map[string]interface{} `json:"cases"`
}

func idStr(n *layoutgraph.Node) string {
	if n == nil {
		return "null"
	}
	return strconv.FormatInt(int64(n.ID), 10)
}

func idList(nodes []*layoutgraph.Node) []string {
	res := make([]string, len(nodes))
	for i, n := range nodes {
		res[i] = idStr(n)
	}
	return res
}

func main() {
	out := TopologyOracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion":   runtime.Version(),
			"d2BaseCommit":       "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage":   "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph",
		},
		Cases: make(map[string]interface{}),
	}

	// 1. Sequence active / inactive semantics and First/Last
	{
		g := layoutgraph.NewGraph()
		vesselAct := layoutgraph.NewNode(1, 100, 100)
		s1 := layoutgraph.NewNode(2, 50, 50)
		s2 := layoutgraph.NewNode(3, 50, 50)
		g.AddNodeUnchecked(vesselAct)
		g.AddNodeUnchecked(s1)
		g.AddNodeUnchecked(s2)
		seqAct := &layoutgraph.Sequence{
			Vessel: vesselAct,
			Nodes:  []*layoutgraph.Node{s1, s2},
			Graph:  g,
		}
		g.Sequences[vesselAct] = seqAct
		s1.Sequence = seqAct
		s2.Sequence = seqAct

		vesselInact := layoutgraph.NewNode(4, 100, 100)
		vesselInact.Graph = nil
		seqInact := &layoutgraph.Sequence{
			Vessel: vesselInact,
			Nodes:  []*layoutgraph.Node{s1, s2},
			Graph:  nil,
		}

		out.Cases["SequenceSemantics"] = map[string]interface{}{
			"activeIsActive":      seqAct.IsActive(),
			"activeFirstID":       idStr(seqAct.First()),
			"activeLastID":        idStr(seqAct.Last()),
			"inactiveIsActive":    seqInact.IsActive(),
			"isSequenceVesselAct": g.IsSequenceVessel(vesselAct),
			"isSequenceVesselMem": g.IsSequenceVessel(s1),
		}
	}

	// 2. Cluster active / inactive semantics and Flip
	{
		g := layoutgraph.NewGraph()
		vesselAct := layoutgraph.NewNode(10, 100, 100)
		g.AddNodeUnchecked(vesselAct)
		vesselAct.SetClusterVessel(true)
		m1 := layoutgraph.NewNode(11, 40, 40)
		m2 := layoutgraph.NewNode(12, 40, 40)
		g.AddNodeUnchecked(m1)
		g.AddNodeUnchecked(m2)
		clusterAct := &layoutgraph.Cluster{
			Vessel:             vesselAct,
			Nodes:              []*layoutgraph.Node{m1, m2},
			Arrangement:        layoutgraph.Row,
			DesiredArrangement: layoutgraph.Row,
			Graph:              g,
		}
		g.Clusters[vesselAct] = clusterAct
		m1.Cluster = clusterAct
		m2.Cluster = clusterAct

		arr1 := string(clusterAct.Arrangement)
		clusterAct.Arrangement = clusterAct.Arrangement.Flip()
		arr2 := string(clusterAct.Arrangement)
		clusterAct.Arrangement = clusterAct.Arrangement.Flip()
		arr3 := string(clusterAct.Arrangement)

		vesselInact := layoutgraph.NewNode(13, 100, 100)
		vesselInact.Graph = nil
		clusterInact := &layoutgraph.Cluster{
			Vessel:      vesselInact,
			Nodes:       []*layoutgraph.Node{m1, m2},
			Arrangement: layoutgraph.Row,
			Graph:       nil,
		}

		out.Cases["ClusterSemantics"] = map[string]interface{}{
			"activeIsActive":   clusterAct.IsActive(),
			"flip1":            arr1,
			"flip2":            arr2,
			"flip3":            arr3,
			"inactiveIsActive": clusterInact.IsActive(),
			"isClusterVessel":  vesselAct.IsClusterVessel(),
		}
	}

	// 3. Stable group order (numeric BigInt EntityID sorting)
	{
		g := layoutgraph.NewGraph()
		// Deliberately scrambled insertion: 30, -2, 5, 100
		ids := []layoutgraph.EntityID{30, -2, 5, 100}
		for _, id := range ids {
			n := layoutgraph.NewNode(id, 10, 10)
			g.AddNodeUnchecked(n)
			g.Clusters[n] = &layoutgraph.Cluster{Vessel: n}
			g.Sequences[n] = &layoutgraph.Sequence{Vessel: n}
			g.Trees[n] = []*layoutgraph.Tree{layoutgraph.NewTree(n)}
		}

		cOrder := g.ClusterOrder()
		sOrder := g.SequenceOrder()
		tOrder := g.TreeOrder()

		out.Cases["StableGroupOrder"] = map[string]interface{}{
			"clusterOrder":  idList(cOrder),
			"sequenceOrder": idList(sOrder),
			"treeOrder":     idList(tOrder),
			"isTreeSentinel": g.IsTreeSentinel(g.Nodes[0]),
		}
	}

	// 4. OwningContainer and Level
	{
		g := layoutgraph.NewGraph()
		rootContainer := layoutgraph.NewNode(1, 200, 200)
		g.AddNewNodeToContainer(nil, rootContainer)

		childContainer := layoutgraph.NewNode(2, 150, 150)
		g.AddNewNodeToContainer(rootContainer, childContainer)

		directNode := layoutgraph.NewNode(3, 50, 50)
		g.AddNewNodeToContainer(childContainer, directNode)

		// Active cluster inside childContainer
		clusterVessel := layoutgraph.NewNode(4, 80, 80)
		clusterVessel.SetClusterVessel(true)
		g.AddNewNodeToContainer(childContainer, clusterVessel)
		clusterMember := layoutgraph.NewNode(5, 30, 30)
		g.AddNodeUnchecked(clusterMember)
		clAct := &layoutgraph.Cluster{
			Vessel:    clusterVessel,
			Nodes:     []*layoutgraph.Node{clusterMember},
			Graph:     g,
			Container: childContainer,
		}
		g.Clusters[clusterVessel] = clAct
		clusterMember.Cluster = clAct

		// Inactive cluster member
		clusterMemberInact := layoutgraph.NewNode(6, 30, 30)
		g.AddNewNodeToContainer(childContainer, clusterMemberInact)
		clInactVessel := layoutgraph.NewNode(7, 80, 80)
		clInactVessel.Graph = nil
		clInact := &layoutgraph.Cluster{
			Vessel: clInactVessel,
			Nodes:  []*layoutgraph.Node{clusterMemberInact},
			Graph:  nil,
		}
		clusterMemberInact.Cluster = clInact

		// Active sequence inside childContainer
		seqVessel := layoutgraph.NewNode(8, 80, 80)
		g.AddNewNodeToContainer(childContainer, seqVessel)
		seqStep := layoutgraph.NewNode(9, 30, 30)
		g.AddNodeUnchecked(seqStep)
		sqAct := &layoutgraph.Sequence{
			Vessel:    seqVessel,
			Nodes:     []*layoutgraph.Node{seqStep},
			Graph:     g,
			Container: childContainer,
		}
		g.Sequences[seqVessel] = sqAct
		seqStep.Sequence = sqAct

		// Inactive sequence member
		seqStepInact := layoutgraph.NewNode(10, 30, 30)
		g.AddNewNodeToContainer(childContainer, seqStepInact)
		sqInactVessel := layoutgraph.NewNode(11, 80, 80)
		sqInactVessel.Graph = nil
		sqInact := &layoutgraph.Sequence{
			Vessel: sqInactVessel,
			Nodes:  []*layoutgraph.Node{seqStepInact},
			Graph:  nil,
		}
		seqStepInact.Sequence = sqInact

		out.Cases["OwningContainerAndLevel"] = map[string]interface{}{
			"directOwning":          idStr(directNode.OwningContainer()),
			"directLevel":           directNode.Level(),
			"clusterMemberOwning":   idStr(clusterMember.OwningContainer()),
			"clusterMemberLevel":    clusterMember.Level(),
			"inactClusterOwning":    idStr(clusterMemberInact.OwningContainer()),
			"inactClusterLevel":     clusterMemberInact.Level(),
			"seqStepOwning":         idStr(seqStep.OwningContainer()),
			"seqStepLevel":          seqStep.Level(),
			"inactSeqOwning":        idStr(seqStepInact.OwningContainer()),
			"inactSeqLevel":         seqStepInact.Level(),
			"rootLevel":             rootContainer.Level(),
			"childContainerLevel":   childContainer.Level(),
		}
	}

	// 5. IsDescendantOf
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(100, 200, 200)
		g.AddNewNodeToContainer(nil, root)
		child := layoutgraph.NewNode(101, 100, 100)
		g.AddNewNodeToContainer(root, child)
		other := layoutgraph.NewNode(102, 50, 50)
		g.AddNewNodeToContainer(nil, other)

		// Cluster member
		cVessel := layoutgraph.NewNode(103, 80, 80)
		cVessel.Graph = nil // even inactive
		cMember := layoutgraph.NewNode(104, 30, 30)
		cVessel.Container = child
		cl := &layoutgraph.Cluster{Vessel: cVessel, Nodes: []*layoutgraph.Node{cMember}}
		cMember.Cluster = cl

		// Sequence member
		sVessel := layoutgraph.NewNode(105, 80, 80)
		sVessel.Graph = nil // even inactive
		sMember := layoutgraph.NewNode(106, 30, 30)
		sVessel.Container = child
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{sMember}}
		sMember.Sequence = seq

		out.Cases["IsDescendantOf"] = map[string]interface{}{
			"childDescOfRoot":    child.IsDescendantOf(root),
			"childDescOfNull":    child.IsDescendantOf(nil),
			"childDescOfOther":   child.IsDescendantOf(other),
			"selfDesc":           child.IsDescendantOf(child),
			"cMemberDescOfChild": cMember.IsDescendantOf(child),
			"cMemberDescOfRoot":  cMember.IsDescendantOf(root),
			"sMemberDescOfChild": sMember.IsDescendantOf(child),
			"sMemberDescOfRoot":  sMember.IsDescendantOf(root),
			"sMemberDescOfOther": sMember.IsDescendantOf(other),
		}
	}

	// 6. ContainerRDFSOrder and ClusterRDFSOrder
	{
		g := layoutgraph.NewGraph()
		// Hierarchy:
		// root (nil)
		//   A (ID 1, container)
		//     B (ID 2, container)
		//     leaf1 (ID 3)
		//   C (ID 4, container)
		//     leaf2 (ID 5)
		A := layoutgraph.NewNode(1, 100, 100)
		B := layoutgraph.NewNode(2, 50, 50)
		leaf1 := layoutgraph.NewNode(3, 20, 20)
		C := layoutgraph.NewNode(4, 80, 80)
		leaf2 := layoutgraph.NewNode(5, 20, 20)

		g.AddNewNodeToContainer(nil, A)
		g.AddNewNodeToContainer(A, B)
		g.AddNewNodeToContainer(A, leaf1)
		g.AddNewNodeToContainer(nil, C)
		g.AddNewNodeToContainer(C, leaf2)

		normalOrder := g.ContainerRDFSOrderUnbounded(nil)

		// Now add a cluster vessel containing a Node which is itself a container
		// Vessel inside C
		cVessel := layoutgraph.NewNode(6, 60, 60)
		cVessel.SetClusterVessel(true)
		g.AddNewNodeToContainer(C, cVessel)

		cMemberContainer := layoutgraph.NewNode(7, 40, 40)
		g.AddNodeUnchecked(cMemberContainer)
		g.AddNewNodeToContainer(cMemberContainer, layoutgraph.NewNode(8, 10, 10))
		cluster := &layoutgraph.Cluster{
			Vessel: cVessel,
			Nodes:  []*layoutgraph.Node{cMemberContainer},
			Graph:  g,
		}
		g.Clusters[cVessel] = cluster

		orderWithCluster := g.ContainerRDFSOrderUnbounded(nil)
		clusterRDFS := g.ClusterRDFSOrder()

		out.Cases["RDFSOrders"] = map[string]interface{}{
			"normalContainerOrder": idList(normalOrder),
			"clusterMemberOrder":   idList(orderWithCluster),
			"clusterRDFSOrder":     idList(clusterRDFS),
		}
	}

	// 7. Tree SentinelNode
	{
		n1 := layoutgraph.NewNode(1, 50, 50)
		n2 := layoutgraph.NewNode(2, 50, 50)
		edgeFwd := layoutgraph.NewEdge(n1, n2)
		tFwd := layoutgraph.NewTree(n1)
		tFwd.SentinelEdge = edgeFwd

		edgeRev := layoutgraph.NewEdge(n2, n1)
		tRev := layoutgraph.NewTree(n1)
		tRev.SentinelEdge = edgeRev

		out.Cases["TreeSentinelNode"] = map[string]interface{}{
			"fwdSentinel": idStr(tFwd.SentinelNode()),
			"revSentinel": idStr(tRev.SentinelNode()),
		}
	}

	// 8. WalkRDFS ordering (pathological test with container children, cluster vessel, and sequence)
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		child := layoutgraph.NewNode(2, 30, 30)
		g.AddNewNodeToContainer(nil, root)
		g.AddNewNodeToContainer(root, child)

		root.SetClusterVessel(true)
		cNode := layoutgraph.NewNode(3, 20, 20)
		g.AddNodeUnchecked(cNode)
		g.Clusters[root] = &layoutgraph.Cluster{
			Vessel: root,
			Nodes:  []*layoutgraph.Node{cNode},
			Graph:  g,
		}

		sNode := layoutgraph.NewNode(4, 20, 20)
		g.AddNodeUnchecked(sNode)
		g.Sequences[root] = &layoutgraph.Sequence{
			Vessel: root,
			Nodes:  []*layoutgraph.Node{sNode},
			Graph:  g,
		}

		var walkOrder []string
		root.WalkRDFS(func(n *layoutgraph.Node) {
			walkOrder = append(walkOrder, idStr(n))
		})

		out.Cases["WalkRDFSPrecedence"] = map[string]interface{}{
			"walkOrder": walkOrder,
		}
	}

	// 9. Clone isolating and rebinding groups and EdgeAbductions
	{
		g := layoutgraph.NewGraph()
		vesselAct := layoutgraph.NewNode(1, 100, 100)
		vesselAct.SetClusterVessel(true)
		m1 := layoutgraph.NewNode(2, 40, 40)
		m2 := layoutgraph.NewNode(3, 40, 40)
		g.AddNodeUnchecked(vesselAct)
		g.AddNodeUnchecked(m1)
		g.AddNodeUnchecked(m2)

		edge := g.Connect(m1, m2)
		abduction := &layoutgraph.EdgeAbduction{
			Edge:           edge,
			OriginallyFrom: m1,
			OriginallyTo:   m2,
			CurrentFrom:    vesselAct,
			CurrentTo:      m2,
		}

		clAct := &layoutgraph.Cluster{
			Vessel:             vesselAct,
			Nodes:              []*layoutgraph.Node{m1, m2},
			Arrangement:        layoutgraph.Column,
			DesiredArrangement: layoutgraph.Row,
			Graph:              g,
			EdgeAbductions:     []*layoutgraph.EdgeAbduction{abduction},
		}
		g.Clusters[vesselAct] = clAct
		m1.Cluster = clAct
		m2.Cluster = clAct

		// Inactive sequence
		vesselInact := layoutgraph.NewNode(4, 100, 100)
		vesselInact.Graph = nil
		sStep1 := layoutgraph.NewNode(5, 30, 30)
		sStep2 := layoutgraph.NewNode(6, 30, 30)
		g.AddNodeUnchecked(sStep1)
		g.AddNodeUnchecked(sStep2)
		seqInact := &layoutgraph.Sequence{
			Vessel: vesselInact,
			Nodes:  []*layoutgraph.Node{sStep1, sStep2},
			Graph:  nil,
		}
		g.Sequences[vesselInact] = seqInact
		sStep1.Sequence = seqInact
		sStep2.Sequence = seqInact

		// Tree
		treeNode := layoutgraph.NewNode(7, 40, 40)
		g.AddNodeUnchecked(treeNode)
		treeSentinel := layoutgraph.NewNode(8, 40, 40)
		g.AddNodeUnchecked(treeSentinel)
		tEdge := g.Connect(treeSentinel, treeNode)
		treeRoot := layoutgraph.NewTree(treeNode)
		treeRoot.SentinelEdge = tEdge
		treeRoot.Orientation = geo.Top
		g.Trees[treeSentinel] = []*layoutgraph.Tree{treeRoot}
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		g.NodeToTree[treeNode] = treeRoot

		cloned, err := layoutgraph.Clone(context.Background(), g)
		if err != nil {
			panic(fmt.Sprintf("Go Clone failed: %v", err))
		}

		clonedCVessel := cloned.Nodes[0]
		clonedCluster := cloned.Clusters[clonedCVessel]
		clonedAbduction := clonedCluster.EdgeAbductions[0]

		var clonedInactVessel *layoutgraph.Node
		for v := range cloned.Sequences {
			if v.ID == 4 {
				clonedInactVessel = v
			}
		}
		clonedSeqInact := cloned.Sequences[clonedInactVessel]

		var clonedTreeSentinel *layoutgraph.Node
		for s := range cloned.Trees {
			if s.ID == 8 {
				clonedTreeSentinel = s
			}
		}
		clonedTreeRoot := cloned.Trees[clonedTreeSentinel][0]

		out.Cases["CloneParity"] = map[string]interface{}{
			"clonedClusterActive":     clonedCluster.IsActive(),
			"clonedClusterArrangement": string(clonedCluster.Arrangement),
			"clonedClusterVesselFlag": clonedCVessel.IsClusterVessel(),
			"clonedAbductionEdgeID":   strconv.FormatInt(int64(clonedAbduction.Edge.ID), 10),
			"clonedAbductionOrigFrom": idStr(clonedAbduction.OriginallyFrom),
			"clonedAbductionCurrFrom": idStr(clonedAbduction.CurrentFrom),
			"clonedSeqActive":         clonedSeqInact.IsActive(),
			"clonedSeqVesselGraphNil": clonedInactVessel.Graph == nil,
			"clonedTreeRootNodeID":    idStr(clonedTreeRoot.Node),
			"clonedTreeOrientation":   clonedTreeRoot.Orientation.ToString(),
			"clonedNodeToTreeMatches": cloned.NodeToTree[clonedTreeRoot.Node] == clonedTreeRoot,
		}
	}

	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "test/fixtures/go-topology-foundation-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	if err := os.WriteFile(outFile, b, 0644); err != nil {
		panic(err)
	}
}
