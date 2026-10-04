//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"reflect"
	"runtime"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

type PointFP struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NodeFP struct {
	ID        string   `json:"id"`
	Width     float64  `json:"width"`
	Height    float64  `json:"height"`
	TopLeft   *PointFP `json:"topLeft"`
	Container *string  `json:"container"`
	Sequence  *string  `json:"sequence"`
	InGraph   bool     `json:"inGraph"`
}

type EdgeFP struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
}

type ContainerFP struct {
	Container *string  `json:"container"`
	Children  []string `json:"children"`
}

type AbductionFP struct {
	EdgeID         string  `json:"edgeID"`
	OriginallyFrom *string `json:"originallyFrom"`
	OriginallyTo   *string `json:"originallyTo"`
	CurrentFrom    *string `json:"currentFrom"`
	CurrentTo      *string `json:"currentTo"`
}

type SequenceFP struct {
	VesselID       string        `json:"vesselID"`
	Width          float64       `json:"width"`
	Height         float64       `json:"height"`
	TopLeft        *PointFP      `json:"topLeft"`
	Container      *string       `json:"container"`
	Members        []string      `json:"members"`
	EdgeAbductions []AbductionFP `json:"edgeAbductions"`
}

type GraphFingerprint struct {
	Nodes      []string      `json:"nodes"`
	Edges      []EdgeFP      `json:"edges"`
	Containers []ContainerFP `json:"containers"`
	Sequences  []SequenceFP  `json:"sequences"`
	AllNodes   []NodeFP      `json:"allNodes"`
	NextInt63  string        `json:"nextInt63"`
}

func ptrString(s string) *string {
	return &s
}

func idPtr(n *layoutgraph.Node) *string {
	if n == nil {
		return nil
	}
	s := fmt.Sprintf("%d", n.ID)
	return &s
}

func fingerprintGraph(g *layoutgraph.Graph, relevantNodes []*layoutgraph.Node, rng *rand.Rand) GraphFingerprint {
	fp := GraphFingerprint{
		Nodes:      make([]string, 0, len(g.Nodes)),
		Edges:      make([]EdgeFP, 0, len(g.Edges)),
		Containers: make([]ContainerFP, 0, len(g.Containers)),
		Sequences:  make([]SequenceFP, 0, len(g.Sequences)),
		AllNodes:   make([]NodeFP, 0),
		NextInt63:  "",
	}

	for _, n := range g.Nodes {
		fp.Nodes = append(fp.Nodes, fmt.Sprintf("%d", n.ID))
	}

	for _, e := range g.Edges {
		fromStr := ""
		if e.From != nil {
			fromStr = fmt.Sprintf("%d", e.From.ID)
		}
		toStr := ""
		if e.To != nil {
			toStr = fmt.Sprintf("%d", e.To.ID)
		}
		fp.Edges = append(fp.Edges, EdgeFP{
			ID:   fmt.Sprintf("%d", e.ID),
			From: fromStr,
			To:   toStr,
		})
	}

	// Stable container ordering: root nil first, then sorted by container ID
	var containers []*layoutgraph.Node
	for c := range g.Containers {
		if c != nil {
			containers = append(containers, c)
		}
	}
	sort.Slice(containers, func(i, j int) bool {
		return containers[i].ID < containers[j].ID
	})

	allC := append([]*layoutgraph.Node{nil}, containers...)
	for _, c := range allC {
		children, ok := g.Containers[c]
		if !ok && c != nil {
			continue
		}
		var childIDs []string
		for _, child := range children {
			if child != nil {
				childIDs = append(childIDs, fmt.Sprintf("%d", child.ID))
			}
		}
		fp.Containers = append(fp.Containers, ContainerFP{
			Container: idPtr(c),
			Children:  childIDs,
		})
	}

	// Sequences in SequenceOrder
	for _, vessel := range g.SequenceOrder() {
		seq := g.Sequences[vessel]
		if seq == nil {
			continue
		}
		var sTL *PointFP
		if vessel.TopLeft != nil {
			sTL = &PointFP{X: vessel.TopLeft.X, Y: vessel.TopLeft.Y}
		}
		var memberIDs []string
		for _, m := range seq.Nodes {
			if m != nil {
				memberIDs = append(memberIDs, fmt.Sprintf("%d", m.ID))
			}
		}
		var abductions []AbductionFP
		for _, ea := range seq.EdgeAbductions {
			if ea == nil || ea.Edge == nil {
				continue
			}
			abductions = append(abductions, AbductionFP{
				EdgeID:         fmt.Sprintf("%d", ea.Edge.ID),
				OriginallyFrom: idPtr(ea.OriginallyFrom),
				OriginallyTo:   idPtr(ea.OriginallyTo),
				CurrentFrom:    idPtr(ea.CurrentFrom),
				CurrentTo:      idPtr(ea.CurrentTo),
			})
		}
		fp.Sequences = append(fp.Sequences, SequenceFP{
			VesselID:       fmt.Sprintf("%d", vessel.ID),
			Width:          vessel.Width,
			Height:         vessel.Height,
			TopLeft:        sTL,
			Container:      idPtr(seq.Container),
			Members:        memberIDs,
			EdgeAbductions: abductions,
		})
	}

	// All relevant nodes
	seenNodes := make(map[*layoutgraph.Node]bool)
	var nodeList []*layoutgraph.Node
	for _, n := range relevantNodes {
		if n != nil && !seenNodes[n] {
			seenNodes[n] = true
			nodeList = append(nodeList, n)
		}
	}
	for _, n := range g.Nodes {
		if n != nil && !seenNodes[n] {
			seenNodes[n] = true
			nodeList = append(nodeList, n)
		}
	}
	for vessel := range g.Sequences {
		if vessel != nil && !seenNodes[vessel] {
			seenNodes[vessel] = true
			nodeList = append(nodeList, vessel)
		}
	}

	sort.Slice(nodeList, func(i, j int) bool {
		return nodeList[i].ID < nodeList[j].ID
	})

	inGraphSet := make(map[*layoutgraph.Node]bool, len(g.Nodes))
	for _, n := range g.Nodes {
		inGraphSet[n] = true
	}

	for _, n := range nodeList {
		var tl *PointFP
		if n.TopLeft != nil {
			tl = &PointFP{X: n.TopLeft.X, Y: n.TopLeft.Y}
		}
		var seqID *string
		if n.Sequence != nil && n.Sequence.Vessel != nil {
			s := fmt.Sprintf("%d", n.Sequence.Vessel.ID)
			seqID = &s
		}
		fp.AllNodes = append(fp.AllNodes, NodeFP{
			ID:        fmt.Sprintf("%d", n.ID),
			Width:     n.Width,
			Height:    n.Height,
			TopLeft:   tl,
			Container: idPtr(n.Container),
			Sequence:  seqID,
			InGraph:   inGraphSet[n],
		})
	}

	if rng != nil {
		draw := rng.Int63()
		fp.NextInt63 = fmt.Sprintf("%d", draw)
	}

	return fp
}

func connectWithID(g *layoutgraph.Graph, id layoutgraph.EntityID, from, to *layoutgraph.Node) *layoutgraph.Edge {
	edge := g.Connect(from, to)
	edge.ID = id
	return edge
}

func main() {
	outPath := "test/fixtures/go-sequence-mutation-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping",
		},
		Scenarios: make(map[string]interface{}),
	}

	ctx := context.Background()

	// =========================================================================
	// 1. Direct Helper: clearRememberedSequenceMembership
	// =========================================================================
	clearScenarios := make(map[string]interface{})
	{
		// 1.1 nil sequence
		guard, _ := limits.NewWorkGuard(ctx, "ClearNil", 100)
		err := grouping.ClearRememberedSequenceMembershipBridge(nil, guard)
		clearScenarios["nil_sequence"] = map[string]interface{}{
			"err":       err == nil,
			"guardUsed": guard.Used(),
		}

		// 1.2 empty nodes
		seqEmpty := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{}}
		guard, _ = limits.NewWorkGuard(ctx, "ClearEmpty", 100)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqEmpty, guard)
		clearScenarios["empty_nodes"] = map[string]interface{}{
			"err":       err == nil,
			"guardUsed": guard.Used(),
		}

		// 1.3 normal two-node clear
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		seqNorm := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n1, n2}}
		n1.Sequence = seqNorm
		n2.Sequence = seqNorm
		guard, _ = limits.NewWorkGuard(ctx, "ClearNorm", 100)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqNorm, guard)
		clearScenarios["normal_two_node"] = map[string]interface{}{
			"err":          err == nil,
			"guardUsed":    guard.Used(),
			"n1SeqCleared": n1.Sequence == nil,
			"n2SeqCleared": n2.Sequence == nil,
		}

		// 1.4 nil member in list
		n3 := layoutgraph.NewNode(3, 40, 30)
		n4 := layoutgraph.NewNode(4, 40, 30)
		seqNilMember := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n3, nil, n4}}
		n3.Sequence = seqNilMember
		n4.Sequence = seqNilMember
		guard, _ = limits.NewWorkGuard(ctx, "ClearNilMember", 100)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqNilMember, guard)
		clearScenarios["nil_member"] = map[string]interface{}{
			"err":          err == nil,
			"guardUsed":    guard.Used(),
			"n3SeqCleared": n3.Sequence == nil,
			"n4SeqCleared": n4.Sequence == nil,
		}

		// 1.5 member belongs to another sequence
		n5 := layoutgraph.NewNode(5, 40, 30)
		n6 := layoutgraph.NewNode(6, 40, 30)
		seqA := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n5, n6}}
		seqOther := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n6}}
		n5.Sequence = seqA
		n6.Sequence = seqOther
		guard, _ = limits.NewWorkGuard(ctx, "ClearOtherSeq", 100)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqA, guard)
		clearScenarios["member_other_sequence"] = map[string]interface{}{
			"err":            err == nil,
			"guardUsed":      guard.Used(),
			"n5SeqCleared":   n5.Sequence == nil,
			"n6SeqUntouched": n6.Sequence == seqOther,
		}

		// 1.6 duplicate member reference
		n7 := layoutgraph.NewNode(7, 40, 30)
		seqDup := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n7, n7}}
		n7.Sequence = seqDup
		guard, _ = limits.NewWorkGuard(ctx, "ClearDup", 100)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqDup, guard)
		clearScenarios["duplicate_member"] = map[string]interface{}{
			"err":          err == nil,
			"guardUsed":    guard.Used(),
			"n7SeqCleared": n7.Sequence == nil,
		}

		// 1.7 low workguard limit -> partial mutation
		n8 := layoutgraph.NewNode(8, 40, 30)
		n9 := layoutgraph.NewNode(9, 40, 30)
		seqPartial := &layoutgraph.Sequence{Nodes: []*layoutgraph.Node{n8, n9}}
		n8.Sequence = seqPartial
		n9.Sequence = seqPartial
		guard, _ = limits.NewWorkGuard(ctx, "ClearPartial", 1)
		err = grouping.ClearRememberedSequenceMembershipBridge(seqPartial, guard)
		clearScenarios["work_guard_limit_partial"] = map[string]interface{}{
			"errOccurred":   err != nil,
			"guardUsed":     guard.Used(),
			"n8SeqCleared":  n8.Sequence == nil,
			"n9SeqRetained": n9.Sequence == seqPartial,
		}
	}
	out.Scenarios["clearRememberedSequenceMembership"] = clearScenarios

	// =========================================================================
	// 2. Direct Helper: buildSequence
	// =========================================================================
	buildScenarios := make(map[string]interface{})
	{
		// 2.1 two-step unpositioned
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		e1 := connectWithID(g, 10, s1, s2)
		seq := grouping.BuildSequenceBridge([]*layoutgraph.Node{s1, s2}, g, nil, 100)
		buildScenarios["two_step_unpositioned"] = map[string]interface{}{
			"vesselID":            fmt.Sprintf("%d", seq.Vessel.ID),
			"vesselWidth":         seq.Vessel.Width,
			"vesselHeight":        seq.Vessel.Height,
			"vesselTopLeft":       seq.Vessel.TopLeft == nil,
			"definingEdgeRemoved": len(g.Edges) == 0 && s1.ConnectionTo(s2) == nil,
			"s1Width":             s1.Width,
			"s1Height":            s1.Height,
			"s2Width":             s2.Width,
			"s2Height":            s2.Height,
			"originalEdgeID":      fmt.Sprintf("%d", e1.ID),
		}

		// 2.2 three-step positioned
		g = layoutgraph.NewGraph()
		s1 = layoutgraph.NewNode(1, 40, 30)
		s2 = layoutgraph.NewNode(2, 40, 20)
		s3 := layoutgraph.NewNode(3, 40, 50)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		s1.TopLeft = geo.NewPoint(10, 20)
		s2.TopLeft = geo.NewPoint(50, 15)
		s3.TopLeft = geo.NewPoint(90, 30)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, s3)
		connectWithID(g, 11, s1, s2)
		connectWithID(g, 12, s2, s3)
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{s1, s2, s3}, g, nil, 200)
		buildScenarios["three_step_positioned"] = map[string]interface{}{
			"vesselID":     fmt.Sprintf("%d", seq.Vessel.ID),
			"vesselWidth":  seq.Vessel.Width,
			"vesselHeight": seq.Vessel.Height,
			"vesselTLX":    seq.Vessel.TopLeft.X,
			"vesselTLY":    seq.Vessel.TopLeft.Y,
			"stepHeights":  []float64{s1.Height, s2.Height, s3.Height},
		}

		// 2.3 narrow width <= wedge normalization (width = 20 <= 35 -> 70)
		g = layoutgraph.NewGraph()
		sn := layoutgraph.NewNode(1, 20, 30)
		sNorm := layoutgraph.NewNode(2, 50, 30)
		g.AddNewNodeToContainer(nil, sn)
		g.AddNewNodeToContainer(nil, sNorm)
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{sn, sNorm}, g, nil, 300)
		buildScenarios["narrow_width"] = map[string]interface{}{
			"snWidth":    sn.Width,
			"sNormWidth": sNorm.Width,
		}

		// 2.4 width exactly wedge (width = 35 -> 70)
		g = layoutgraph.NewGraph()
		sWedge := layoutgraph.NewNode(1, shape.STEP_WEDGE_WIDTH, 30)
		g.AddNewNodeToContainer(nil, sWedge)
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{sWedge}, g, nil, 400)
		buildScenarios["width_exactly_wedge"] = map[string]interface{}{
			"sWedgeWidth": sWedge.Width,
		}

		// 2.5 all-negative heights
		g = layoutgraph.NewGraph()
		sNeg1 := layoutgraph.NewNode(1, 40, -10)
		sNeg2 := layoutgraph.NewNode(2, 40, -5)
		g.AddNewNodeToContainer(nil, sNeg1)
		g.AddNewNodeToContainer(nil, sNeg2)
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{sNeg1, sNeg2}, g, nil, 500)
		buildScenarios["all_negative_heights"] = map[string]interface{}{
			"height1": sNeg1.Height,
			"height2": sNeg2.Height,
		}

		// 2.6 remembered rebuild with defining edge absent
		g = layoutgraph.NewGraph()
		sa := layoutgraph.NewNode(1, 40, 30)
		sb := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, sa)
		g.AddNewNodeToContainer(nil, sb)
		// No edge connected
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{sa, sb}, g, nil, 600)
		buildScenarios["remembered_rebuild_no_edge"] = map[string]interface{}{
			"vesselID":   fmt.Sprintf("%d", seq.Vessel.ID),
			"nodesCount": len(seq.Nodes),
		}

		// 2.7 parallel defining edges: only first is disconnected
		g = layoutgraph.NewGraph()
		p1 := layoutgraph.NewNode(1, 40, 30)
		p2 := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, p1)
		g.AddNewNodeToContainer(nil, p2)
		eFirst := connectWithID(g, 101, p1, p2)
		eSecond := connectWithID(g, 102, p1, p2)
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{p1, p2}, g, nil, 700)
		buildScenarios["parallel_defining_edges"] = map[string]interface{}{
			"remainingEdges":         len(g.Edges),
			"survivingEdgeID":        fmt.Sprintf("%d", g.Edges[0].ID),
			"disconnectedEdgeID":     fmt.Sprintf("%d", eFirst.ID),
			"survivingMatchesSecond": g.Edges[0] == eSecond,
		}

		// 2.8 external edge abduction
		g = layoutgraph.NewGraph()
		stepA := layoutgraph.NewNode(1, 40, 30)
		stepB := layoutgraph.NewNode(2, 40, 30)
		stepC := layoutgraph.NewNode(3, 40, 30)
		extOut := layoutgraph.NewNode(4, 40, 30)
		extIn := layoutgraph.NewNode(5, 40, 30)
		g.AddNewNodeToContainer(nil, stepA)
		g.AddNewNodeToContainer(nil, stepB)
		g.AddNewNodeToContainer(nil, stepC)
		g.AddNewNodeToContainer(nil, extOut)
		g.AddNewNodeToContainer(nil, extIn)
		connectWithID(g, 1, stepA, stepB)               // defining edge 1
		connectWithID(g, 2, stepB, stepC)               // defining edge 2
		eOutgoing := connectWithID(g, 3, stepA, extOut) // external outgoing
		eIncoming := connectWithID(g, 4, extIn, stepC)  // external incoming
		eInternal := connectWithID(g, 5, stepA, stepC)  // internal non-defining edge between members!
		seq = grouping.BuildSequenceBridge([]*layoutgraph.Node{stepA, stepB, stepC}, g, nil, 800)
		buildScenarios["external_and_internal_edges"] = map[string]interface{}{
			"abductionsCount":     len(seq.EdgeAbductions),
			"outgoingCurrentFrom": fmt.Sprintf("%d", eOutgoing.From.ID),
			"outgoingCurrentTo":   fmt.Sprintf("%d", eOutgoing.To.ID),
			"incomingCurrentFrom": fmt.Sprintf("%d", eIncoming.From.ID),
			"incomingCurrentTo":   fmt.Sprintf("%d", eIncoming.To.ID),
			"internalFrom":        fmt.Sprintf("%d", eInternal.From.ID),
			"internalTo":          fmt.Sprintf("%d", eInternal.To.ID),
		}
	}
	out.Scenarios["buildSequence"] = buildScenarios

	// =========================================================================
	// 3. Direct Helper: abductSequenceEdges
	// =========================================================================
	abductScenarios := make(map[string]interface{})
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		ext1 := layoutgraph.NewNode(3, 40, 30)
		ext2 := layoutgraph.NewNode(4, 40, 30)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, ext1)
		g.AddNewNodeToContainer(nil, ext2)
		eOut := connectWithID(g, 201, s1, ext1)
		eIn := connectWithID(g, 202, ext2, s2)
		eInternal := connectWithID(g, 203, s1, s2)

		vessel := layoutgraph.NewNode(999, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{s1, s2},
			Graph:  g,
		}
		grouping.AbductSequenceEdgesBridge(seq)

		var abductions []map[string]interface{}
		for _, ea := range seq.EdgeAbductions {
			abductions = append(abductions, map[string]interface{}{
				"edgeID":         fmt.Sprintf("%d", ea.Edge.ID),
				"originallyFrom": idPtr(ea.OriginallyFrom),
				"originallyTo":   idPtr(ea.OriginallyTo),
				"currentFrom":    idPtr(ea.CurrentFrom),
				"currentTo":      idPtr(ea.CurrentTo),
			})
		}
		abductScenarios["direct_abduction"] = map[string]interface{}{
			"abductions":    abductions,
			"eOutFrom":      fmt.Sprintf("%d", eOut.From.ID),
			"eOutTo":        fmt.Sprintf("%d", eOut.To.ID),
			"eInFrom":       fmt.Sprintf("%d", eIn.From.ID),
			"eInTo":         fmt.Sprintf("%d", eIn.To.ID),
			"eInternalFrom": fmt.Sprintf("%d", eInternal.From.ID),
			"eInternalTo":   fmt.Sprintf("%d", eInternal.To.ID),
		}
	}
	out.Scenarios["abductSequenceEdges"] = abductScenarios

	// =========================================================================
	// 4. Direct Helper: addSequence
	// =========================================================================
	addSeqScenarios := make(map[string]interface{})
	{
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(10, 100, 100)
		container.SetContainer(true)
		g.AddNewNodeToContainer(nil, container)

		unrelated1 := layoutgraph.NewNode(11, 40, 30)
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		unrelated2 := layoutgraph.NewNode(12, 40, 30)
		g.AddNewNodeToContainer(container, unrelated1)
		g.AddNewNodeToContainer(container, s1)
		g.AddNewNodeToContainer(container, s2)
		g.AddNewNodeToContainer(container, unrelated2)

		vessel := layoutgraph.NewNode(500, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{s1, s2},
			Graph:     g,
			Container: container,
		}

		grouping.AddSequenceBridge(g, seq)

		var containerChildIDs []string
		for _, c := range g.Containers[container] {
			containerChildIDs = append(containerChildIDs, fmt.Sprintf("%d", c.ID))
		}

		addSeqScenarios["direct_add_sequence"] = map[string]interface{}{
			"vesselInGraphNodes":  slicesContainsNode(g.Nodes, vessel),
			"s1InGraphNodes":      slicesContainsNode(g.Nodes, s1),
			"s2InGraphNodes":      slicesContainsNode(g.Nodes, s2),
			"containerChildren":   containerChildIDs,
			"s1SequencePointsSeq": s1.Sequence == seq,
			"s2SequencePointsSeq": s2.Sequence == seq,
			"s1Container":         idPtr(s1.Container),
			"s2Container":         idPtr(s2.Container),
			"s1Graph":             s1.Graph == g,
			"s2Graph":             s2.Graph == g,
			"seqInMap":            g.Sequences[vessel] == seq,
			"vesselGraph":         vessel.Graph == g,
			"vesselContainer":     idPtr(vessel.Container),
		}
	}
	out.Scenarios["addSequence"] = addSeqScenarios

	// =========================================================================
	// 5. Public AddSequences Canonical Scenarios
	// =========================================================================
	addSequencesScenarios := make(map[string]interface{})

	// 5.1 Simple two-step sequence
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)
		rng := rand.New(rand.NewSource(1))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["simple_two_step"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng)
	}

	// 5.2 Three-step chain
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, s3)
		connectWithID(g, 10, s1, s2)
		connectWithID(g, 11, s2, s3)
		rng := rand.New(rand.NewSource(42))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["three_step_chain"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2, s3}, rng)
	}

	// 5.3 Two separate runs in one container
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		s4 := layoutgraph.NewNode(4, 40, 30)
		for _, s := range []*layoutgraph.Node{s1, s2, s3, s4} {
			s.SetShape(shape.STEP_TYPE)
			g.AddNewNodeToContainer(nil, s)
		}
		connectWithID(g, 10, s1, s2)
		connectWithID(g, 11, s3, s4)
		// Disconnected between s2 and s3
		rng := rand.New(rand.NewSource(77))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["two_separate_runs"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2, s3, s4}, rng)
	}

	// 5.4 No sequence candidates
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		connectWithID(g, 10, n1, n2)
		rng := rand.New(rand.NewSource(1))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["no_sequence_candidates"] = fingerprintGraph(g, []*layoutgraph.Node{n1, n2}, rng)
	}

	// 5.5 Fixed step skipped
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s1.FixedTopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)
		rng := rand.New(rand.NewSource(1))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["fixed_step_skipped"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng)
	}

	// 5.6 Container step skipped
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s1.SetContainer(true)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)
		rng := rand.New(rand.NewSource(1))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["container_step_skipped"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng)
	}

	// 5.7 Nested containers
	{
		g := layoutgraph.NewGraph()
		parent := layoutgraph.NewNode(10, 100, 100)
		parent.SetContainer(true)
		g.AddNewNodeToContainer(nil, parent)

		child := layoutgraph.NewNode(20, 80, 80)
		child.SetContainer(true)
		g.AddNewNodeToContainer(parent, child)

		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(child, s1)
		g.AddNewNodeToContainer(child, s2)
		connectWithID(g, 10, s1, s2)

		rng := rand.New(rand.NewSource(123))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["nested_containers"] = fingerprintGraph(g, []*layoutgraph.Node{parent, child, s1, s2}, rng)
	}

	// 5.8 Multiple containers RDFS ordering
	{
		g := layoutgraph.NewGraph()
		cB := layoutgraph.NewNode(100, 100, 100)
		cB.SetContainer(true)
		cA := layoutgraph.NewNode(200, 100, 100)
		cA.SetContainer(true)
		g.AddNewNodeToContainer(nil, cB)
		g.AddNewNodeToContainer(nil, cA)

		sA1 := layoutgraph.NewNode(1, 40, 30)
		sA2 := layoutgraph.NewNode(2, 40, 30)
		sA1.SetShape(shape.STEP_TYPE)
		sA2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(cA, sA1)
		g.AddNewNodeToContainer(cA, sA2)
		connectWithID(g, 10, sA1, sA2)

		sB1 := layoutgraph.NewNode(3, 40, 30)
		sB2 := layoutgraph.NewNode(4, 40, 30)
		sB1.SetShape(shape.STEP_TYPE)
		sB2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(cB, sB1)
		g.AddNewNodeToContainer(cB, sB2)
		connectWithID(g, 20, sB1, sB2)

		rng := rand.New(rand.NewSource(99))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["multiple_containers_rdfs"] = fingerprintGraph(g, []*layoutgraph.Node{cA, cB, sA1, sA2, sB1, sB2}, rng)
	}

	// 5.9 External edge abduction
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		extOut := layoutgraph.NewNode(3, 40, 30)
		extIn := layoutgraph.NewNode(4, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, extOut)
		g.AddNewNodeToContainer(nil, extIn)
		connectWithID(g, 1, s1, s2)
		connectWithID(g, 2, s2, extOut)
		connectWithID(g, 3, extIn, s1)

		rng := rand.New(rand.NewSource(5))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["external_edge_abduction"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2, extOut, extIn}, rng)
	}

	// 5.10 Positioned step geometry
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s1.TopLeft = geo.NewPoint(25, 40)
		s2.TopLeft = geo.NewPoint(60, 15)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		rng := rand.New(rand.NewSource(7))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["positioned_step_geometry"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng)
	}

	// 5.11 Narrow step geometry
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 20, 30)
		s2 := layoutgraph.NewNode(2, 35, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		rng := rand.New(rand.NewSource(8))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["narrow_step_geometry"] = fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng)
	}

	// 5.12 Valid inactive remembered sequence reuses vessel ID & defining edge absent
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		rng1 := rand.New(rand.NewSource(1))
		_ = grouping.AddSequences(ctx, g, rng1)
		var oldVesselID layoutgraph.EntityID
		for v := range g.Sequences {
			oldVesselID = v.ID
		}

		grouping.Cleanup(g)
		// After Cleanup, defining edge is gone, but sequence remembered state is valid
		rng2 := rand.New(rand.NewSource(999)) // Different seed!
		_ = grouping.AddSequences(ctx, g, rng2)

		var newVesselID layoutgraph.EntityID
		for v := range g.Sequences {
			newVesselID = v.ID
		}

		fp := fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng2)
		addSequencesScenarios["valid_remembered_rebuild"] = map[string]interface{}{
			"oldVesselID": fmt.Sprintf("%d", oldVesselID),
			"newVesselID": fmt.Sprintf("%d", newVesselID),
			"idsMatch":    oldVesselID == newVesselID,
			"fingerprint": fp,
		}
	}

	// 5.13 Stale remembered shape
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		grouping.Cleanup(g)

		// Mutate shape
		s1.SetShape(shape.SQUARE_TYPE)

		rng := rand.New(rand.NewSource(2))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["stale_remembered_shape"] = map[string]interface{}{
			"seqCount":    len(g.Sequences),
			"s1Seq":       s1.Sequence == nil,
			"s2Seq":       s2.Sequence == nil,
			"fingerprint": fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng),
		}
	}

	// 5.14 Stale remembered container
	{
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 100, 100)
		c1.SetContainer(true)
		c2 := layoutgraph.NewNode(20, 100, 100)
		c2.SetContainer(true)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(nil, c2)

		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(c1, s1)
		g.AddNewNodeToContainer(c1, s2)
		connectWithID(g, 10, s1, s2)

		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		grouping.Cleanup(g)

		// Move s2 to c2
		g.Containers[c1] = []*layoutgraph.Node{s1}
		g.AddNewNodeToContainer(c2, s2)

		rng := rand.New(rand.NewSource(2))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["stale_remembered_container"] = map[string]interface{}{
			"seqCount":    len(g.Sequences),
			"fingerprint": fingerprintGraph(g, []*layoutgraph.Node{c1, c2, s1, s2}, rng),
		}
	}

	// 5.15 Stale remembered noncontiguous members
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		other := layoutgraph.NewNode(3, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		grouping.Cleanup(g)

		// Insert 'other' between s1 and s2 in container
		g.Containers[nil] = []*layoutgraph.Node{s1, other, s2}

		rng := rand.New(rand.NewSource(3))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["stale_remembered_noncontiguous"] = map[string]interface{}{
			"seqCount":    len(g.Sequences),
			"fingerprint": fingerprintGraph(g, []*layoutgraph.Node{s1, s2, other}, rng),
		}
	}

	// 5.16 Removed remembered member not resurrected
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		grouping.Cleanup(g)

		// Remove s2 from graph.Nodes
		g.RemoveNode(s2)

		rng := rand.New(rand.NewSource(4))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["removed_remembered_member"] = map[string]interface{}{
			"seqCount":    len(g.Sequences),
			"s2InNodes":   slicesContainsNode(g.Nodes, s2),
			"fingerprint": fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng),
		}
	}

	// 5.17 Stale remembered membership cleared/changed
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 10, s1, s2)

		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		grouping.Cleanup(g)

		// One member's Sequence membership is manually cleared
		s1.Sequence = nil

		rng := rand.New(rand.NewSource(5))
		_ = grouping.AddSequences(ctx, g, rng)
		addSequencesScenarios["stale_remembered_membership"] = map[string]interface{}{
			"seqCount":    len(g.Sequences),
			"s1Seq":       s1.Sequence == nil,
			"s2Seq":       s2.Sequence == nil,
			"fingerprint": fingerprintGraph(g, []*layoutgraph.Node{s1, s2}, rng),
		}
	}

	// 5.18 Ordinary ID collision with seed 19
	{
		g := layoutgraph.NewGraph()
		probe := rand.New(rand.NewSource(19))
		firstDraw := probe.Int63()
		probeNextDraw := probe.Int63()

		collidingNode := layoutgraph.NewNode(layoutgraph.EntityID(firstDraw), 10, 10)
		g.AddNewNodeToContainer(nil, collidingNode)

		s1 := layoutgraph.NewNode(100, 40, 30)
		s2 := layoutgraph.NewNode(101, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 20, s1, s2)

		layoutRand := rand.New(rand.NewSource(19))
		_ = grouping.AddSequences(ctx, g, layoutRand)

		var vesselID layoutgraph.EntityID
		for v := range g.Sequences {
			vesselID = v.ID
		}

		nextDraw := layoutRand.Int63()
		addSequencesScenarios["ordinary_id_collision_seed_19"] = map[string]interface{}{
			"firstDraw":      fmt.Sprintf("%d", firstDraw),
			"expectedVessel": fmt.Sprintf("%d", firstDraw+1),
			"resolvedVessel": fmt.Sprintf("%d", vesselID),
			"nextDraw":       fmt.Sprintf("%d", nextDraw),
			"probeNextDraw":  fmt.Sprintf("%d", probeNextDraw),
			"streamParity":   nextDraw == probeNextDraw,
			"fingerprint":    fingerprintGraph(g, []*layoutgraph.Node{collidingNode, s1, s2}, layoutRand),
		}
	}

	// 5.19 Remembered IDs reserved across containers with seed 73
	{
		g := layoutgraph.NewGraph()
		cB := layoutgraph.NewNode(100, 100, 100)
		cB.SetContainer(true)
		cA := layoutgraph.NewNode(200, 100, 100)
		cA.SetContainer(true)
		g.AddNewNodeToContainer(nil, cB)
		g.AddNewNodeToContainer(nil, cA)

		addSteps := func(container *layoutgraph.Node, firstID layoutgraph.EntityID) []*layoutgraph.Node {
			first := layoutgraph.NewNode(firstID, 40, 30)
			second := layoutgraph.NewNode(firstID+1, 40, 30)
			first.SetShape(shape.STEP_TYPE)
			second.SetShape(shape.STEP_TYPE)
			g.AddNewNodeToContainer(container, first)
			g.AddNewNodeToContainer(container, second)
			connectWithID(g, firstID+1000, first, second)
			return []*layoutgraph.Node{first, second}
		}

		oldA := addSteps(cA, 1)
		oldB := addSteps(cB, 3)

		const seed int64 = 73
		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(seed)))

		oldAID := oldA[0].Sequence.Vessel.ID
		oldBID := oldB[0].Sequence.Vessel.ID

		grouping.Cleanup(g)
		newA := addSteps(cA, 5)

		rng := rand.New(rand.NewSource(seed))
		_ = grouping.AddSequences(ctx, g, rng)

		var allVesselIDs []string
		for v := range g.Sequences {
			allVesselIDs = append(allVesselIDs, fmt.Sprintf("%d", v.ID))
		}
		sort.Strings(allVesselIDs)

		addSequencesScenarios["remembered_ids_reserved_across_containers_seed_73"] = map[string]interface{}{
			"oldAID":           fmt.Sprintf("%d", oldAID),
			"oldBID":           fmt.Sprintf("%d", oldBID),
			"newAVesselID":     fmt.Sprintf("%d", newA[0].Sequence.Vessel.ID),
			"newADidNotReuseB": newA[0].Sequence.Vessel.ID != oldBID,
			"sequenceCount":    len(g.Sequences),
			"allVesselIDs":     allVesselIDs,
			"fingerprint":      fingerprintGraph(g, append(oldA, append(oldB, newA...)...), rng),
		}
	}

	// 5.20 Repeated deterministic reconstruction
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		ext := layoutgraph.NewNode(99, 50, 50)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		s1.TopLeft = geo.NewPoint(10, 20)
		s2.TopLeft = geo.NewPoint(60, 20)
		s3.TopLeft = geo.NewPoint(110, 20)
		ext.TopLeft = geo.NewPoint(200, 20)

		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, s3)
		g.AddNewNodeToContainer(nil, ext)
		connectWithID(g, 10, s1, s2)
		connectWithID(g, 11, s2, s3)
		connectWithID(g, 12, s3, ext)

		const runSeed int64 = 42

		// Initial creation
		_ = grouping.AddSequences(ctx, g, rand.New(rand.NewSource(runSeed)))

		// First reconstruction: Cleanup + AddSequences
		grouping.Cleanup(g)
		rngA := rand.New(rand.NewSource(runSeed))
		_ = grouping.AddSequences(ctx, g, rngA)
		fpA := fingerprintGraph(g, []*layoutgraph.Node{s1, s2, s3, ext}, rngA)

		// Second reconstruction: Cleanup + AddSequences
		grouping.Cleanup(g)
		rngB := rand.New(rand.NewSource(runSeed))
		_ = grouping.AddSequences(ctx, g, rngB)
		fpB := fingerprintGraph(g, []*layoutgraph.Node{s1, s2, s3, ext}, rngB)

		addSequencesScenarios["repeated_deterministic_reconstruction"] = map[string]interface{}{
			"fingerprintA": fpA,
			"fingerprintB": fpB,
			"areEqual":     reflect.DeepEqual(fpA, fpB),
		}
	}

	out.Scenarios["addSequences"] = addSequencesScenarios

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

	fmt.Printf("Wrote Go sequence mutation reference to %s (%d bytes)\n", outPath, len(bytes))
}

func slicesContainsNode(nodes []*layoutgraph.Node, target *layoutgraph.Node) bool {
	for _, n := range nodes {
		if n == target {
			return true
		}
	}
	return false
}
