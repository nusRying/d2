//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
	"github.com/d2lang/d2/lib/geo"
)

func markClusterVessel(node *layoutgraph.Node) {
	layoutgraph.MarkDecodedClusterVessel(node)
}

// NodeState captures the observable HerdAssignment state of a named node.
type NodeState struct {
	ID                    int64   `json:"id"`
	HasAssignment         bool    `json:"hasAssignment"`
	Orientation           string  `json:"orientation,omitempty"`
	OrientationInt        int     `json:"orientationInt,omitempty"`
	Val                   float64 `json:"val,omitempty"`
	SameSidePairCount     int     `json:"sameSidePairCount,omitempty"`
	OppositeSidePairCount int     `json:"oppositeSidePairCount,omitempty"`
}

// ClusterState captures the Arrangement after AssignHerds.
type ClusterState struct {
	Arrangement string `json:"arrangement"`
}

// AssignHerdsResult is the per-scenario outcome.
type AssignHerdsResult struct {
	Success       bool                    `json:"success"`
	Panic         string                  `json:"panic,omitempty"`
	Error         string                  `json:"error,omitempty"`
	NodeStates    map[string]NodeState    `json:"nodeStates,omitempty"`
	ClusterStates map[string]ClusterState `json:"clusterStates,omitempty"`
}

type Output struct {
	Scenarios map[string]AssignHerdsResult `json:"scenarios"`
}

type cancelAfterErrChecks struct {
	context.Context
	remaining int
}

func (ctx *cancelAfterErrChecks) Err() error {
	if ctx.remaining <= 0 {
		return context.Canceled
	}
	ctx.remaining--
	return nil
}

func orientationToString(o geo.Orientation) string {
	return o.ToString()
}

func captureNodeStates(nodes map[string]*layoutgraph.Node) map[string]NodeState {
	res := make(map[string]NodeState)
	for name, n := range nodes {
		if n == nil {
			continue
		}
		st := NodeState{
			ID: n.ID,
		}
		if n.HerdAssignment != nil {
			st.HasAssignment = true
			st.Orientation = orientationToString(n.HerdAssignment.Orientation)
			st.OrientationInt = int(n.HerdAssignment.Orientation)
			st.Val = n.HerdAssignment.Val
			st.SameSidePairCount = n.HerdAssignment.SameSidePairCount()
			st.OppositeSidePairCount = n.HerdAssignment.OppositeSidePairCount()
		}
		res[name] = st
	}
	return res
}

func captureClusterStates(clusters map[string]*layoutgraph.Cluster) map[string]ClusterState {
	res := make(map[string]ClusterState)
	for name, c := range clusters {
		if c == nil {
			continue
		}
		arr := ""
		switch c.Arrangement {
		case layoutgraph.Row:
			arr = "Row"
		case layoutgraph.Column:
			arr = "Column"
		default:
			arr = string(c.Arrangement)
		}
		res[name] = ClusterState{Arrangement: arr}
	}
	return res
}

func makeGraph() *layoutgraph.Graph {
	return layoutgraph.NewGraph()
}

func setContainerFlag(g *layoutgraph.Graph) {
	for c := range g.Containers {
		if c != nil {
			c.SetContainer(true)
		}
	}
}

func main() {
	out := Output{
		Scenarios: make(map[string]AssignHerdsResult),
	}

	type scenarioState struct {
		nodes    map[string]*layoutgraph.Node
		clusters map[string]*layoutgraph.Cluster
	}

	runScenario := func(name string, fn func() (scenarioState, error)) {
		var state scenarioState
		defer func() {
			if r := recover(); r != nil {
				res := AssignHerdsResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
				if state.nodes != nil {
					res.NodeStates = captureNodeStates(state.nodes)
				}
				if state.clusters != nil {
					res.ClusterStates = captureClusterStates(state.clusters)
				}
				out.Scenarios[name] = res
			}
		}()

		st, err := fn()
		state = st

		res := AssignHerdsResult{}
		if state.nodes != nil {
			res.NodeStates = captureNodeStates(state.nodes)
		}
		if state.clusters != nil {
			res.ClusterStates = captureClusterStates(state.clusters)
		}

		if err != nil {
			res.Success = false
			res.Error = err.Error()
		} else {
			res.Success = true
		}
		out.Scenarios[name] = res
	}

	// Helper: build a simple 2-sheep / 1-uncle / 1-cousin graph
	// root contains [sheep1, sheep2]
	// uncle contains [cousin]
	// sheep1 and sheep2 are each abducted via edgeAbduction to cousin/uncle
	makeMinimalHerd := func(uncleW, uncleH float64, cousinPlaced bool, cousinOrientation geo.Orientation) (
		root, sheep1, sheep2, uncle, cousin *layoutgraph.Node,
		g *layoutgraph.Graph,
		abductions []*layoutgraph.EdgeAbduction,
	) {
		g = makeGraph()
		root = layoutgraph.NewNode(0, 100, 100)
		sheep1 = layoutgraph.NewNode(1, 5, 5)
		sheep2 = layoutgraph.NewNode(2, 5, 5)
		uncle = layoutgraph.NewNode(10, uncleW, uncleH)
		cousin = layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		sheep1.Container = root
		sheep2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {sheep1, sheep2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		if cousinPlaced {
			cousin.TopLeft = geo.NewPoint(8, 8)
			cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
			cousin.HerdAssignment.Orientation = cousinOrientation
		}
		abductions = []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: sheep1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: sheep2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		return
	}

	// A. empty graph / no root children / no abductions — live context
	runScenario("A_empty_graph", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		g.Containers[root] = []*layoutgraph.Node{}
		root.SetContainer(true)
		err := proximity.AssignHerds(context.Background(), g, root, nil)
		return scenarioState{}, err
	})

	// B. pre-cancelled empty graph
	runScenario("B_precancelled_empty_graph", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		g.Containers[root] = []*layoutgraph.Node{}
		root.SetContainer(true)
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 0}
		err := proximity.AssignHerds(ctx, g, root, nil)
		return scenarioState{}, err
	})

	// C. nil context
	runScenario("C_nil_context", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		g.Containers[root] = []*layoutgraph.Node{}
		root.SetContainer(true)
		err := proximity.AssignHerds(nil, g, root, nil)
		return scenarioState{}, err
	})

	// D. nil graph (after initial context check)
	runScenario("D_nil_graph", func() (scenarioState, error) {
		err := proximity.AssignHerds(context.Background(), nil, nil, nil)
		return scenarioState{}, err
	})

	// E. nil Containers map
	runScenario("E_nil_containers_map", func() (scenarioState, error) {
		g := layoutgraph.NewGraph()
		g.Containers = nil
		root := layoutgraph.NewNode(0, 100, 100)
		err := proximity.AssignHerds(context.Background(), g, root, nil)
		return scenarioState{}, err
	})

	// F. nil abduction with no root children
	runScenario("F_nil_abduction_no_children", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		g.Containers[root] = []*layoutgraph.Node{}
		root.SetContainer(true)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{nil})
		return scenarioState{}, err
	})

	// G. nil abduction with root child — GroupSheep panics
	runScenario("G_nil_abduction_with_child", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = root
		g.Containers[root] = []*layoutgraph.Node{child}
		root.SetContainer(true)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{nil})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"child": child}}, err
	})

	// H. singleton group — removed, no HerdAssignment
	runScenario("H_singleton_group_removed", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		sheep := layoutgraph.NewNode(1, 5, 5)
		sheep.Container = root
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {sheep},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: sheep, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"sheep": sheep}}, err
	})

	// I. singleton + retained group
	runScenario("I_singleton_plus_retained", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		sheep1 := layoutgraph.NewNode(1, 5, 5) // singleton group member
		sheep2 := layoutgraph.NewNode(2, 5, 5) // retained group members
		sheep3 := layoutgraph.NewNode(3, 5, 5)
		sheep1.Container = root
		sheep2.Container = root
		sheep3.Container = root
		uncleA := layoutgraph.NewNode(10, 10, 10)
		uncleB := layoutgraph.NewNode(20, 10, 10)
		cousinA := layoutgraph.NewNode(11, 5, 5)
		cousinB := layoutgraph.NewNode(21, 5, 5)
		cousinA.Container = uncleA
		cousinB.Container = uncleB
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:   {sheep1, sheep2, sheep3},
			uncleA: {cousinA},
			uncleB: {cousinB},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: sheep1, OriginallyTo: cousinA, CurrentTo: uncleA},
			{OriginallyFrom: sheep2, OriginallyTo: cousinB, CurrentTo: uncleB},
			{OriginallyFrom: sheep3, OriginallyTo: cousinB, CurrentTo: uncleB},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"sheep1": sheep1, "sheep2": sheep2, "sheep3": sheep3,
		}}, err
	})

	// J. out-of-order uncle IDs — sorted by ID
	runScenario("J_sorted_uncle_ids", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		s3 := layoutgraph.NewNode(3, 5, 5)
		s4 := layoutgraph.NewNode(4, 5, 5)
		s5 := layoutgraph.NewNode(5, 5, 5)
		s6 := layoutgraph.NewNode(6, 5, 5)
		s7 := layoutgraph.NewNode(7, 5, 5)
		s8 := layoutgraph.NewNode(8, 5, 5)
		for _, s := range []*layoutgraph.Node{s1, s2, s3, s4, s5, s6, s7, s8} {
			s.Container = root
		}
		// uncles with IDs presented in non-sorted order: 30, 10, 20, 40
		u30 := layoutgraph.NewNode(30, 10, 10)
		u10 := layoutgraph.NewNode(10, 10, 10)
		u20 := layoutgraph.NewNode(20, 10, 10)
		u40 := layoutgraph.NewNode(40, 10, 10)
		c30a := layoutgraph.NewNode(31, 5, 5)
		c30b := layoutgraph.NewNode(32, 5, 5)
		c10a := layoutgraph.NewNode(11, 5, 5)
		c10b := layoutgraph.NewNode(12, 5, 5)
		c20a := layoutgraph.NewNode(21, 5, 5)
		c20b := layoutgraph.NewNode(22, 5, 5)
		c40a := layoutgraph.NewNode(41, 5, 5)
		c40b := layoutgraph.NewNode(42, 5, 5)
		for c, u := range map[*layoutgraph.Node]*layoutgraph.Node{
			c30a: u30, c30b: u30, c10a: u10, c10b: u10, c20a: u20, c20b: u20, c40a: u40, c40b: u40,
		} {
			c.Container = u
		}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root: {s1, s2, s3, s4, s5, s6, s7, s8},
			u30:  {c30a, c30b},
			u10:  {c10a, c10b},
			u20:  {c20a, c20b},
			u40:  {c40a, c40b},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: c30a, CurrentTo: u30},
			{OriginallyFrom: s2, OriginallyTo: c30b, CurrentTo: u30},
			{OriginallyFrom: s3, OriginallyTo: c10a, CurrentTo: u10},
			{OriginallyFrom: s4, OriginallyTo: c10b, CurrentTo: u10},
			{OriginallyFrom: s5, OriginallyTo: c20a, CurrentTo: u20},
			{OriginallyFrom: s6, OriginallyTo: c20b, CurrentTo: u20},
			{OriginallyFrom: s7, OriginallyTo: c40a, CurrentTo: u40},
			{OriginallyFrom: s8, OriginallyTo: c40b, CurrentTo: u40},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "s3": s3, "s4": s4, "s5": s5, "s6": s6, "s7": s7, "s8": s8,
		}}, err
	})

	// K. negative uncle IDs
	runScenario("K_negative_uncle_ids", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		s3 := layoutgraph.NewNode(3, 5, 5)
		s4 := layoutgraph.NewNode(4, 5, 5)
		s5 := layoutgraph.NewNode(5, 5, 5)
		s6 := layoutgraph.NewNode(6, 5, 5)
		s7 := layoutgraph.NewNode(7, 5, 5)
		s8 := layoutgraph.NewNode(8, 5, 5)
		for _, s := range []*layoutgraph.Node{s1, s2, s3, s4, s5, s6, s7, s8} {
			s.Container = root
		}
		un3 := layoutgraph.NewNode(-3, 10, 10)
		un2 := layoutgraph.NewNode(-2, 10, 10)
		un1 := layoutgraph.NewNode(-1, 10, 10)
		u1 := layoutgraph.NewNode(1, 10, 10)
		cn3a := layoutgraph.NewNode(91, 5, 5)
		cn3b := layoutgraph.NewNode(92, 5, 5)
		cn2a := layoutgraph.NewNode(93, 5, 5)
		cn2b := layoutgraph.NewNode(94, 5, 5)
		cn1a := layoutgraph.NewNode(95, 5, 5)
		cn1b := layoutgraph.NewNode(96, 5, 5)
		c1a := layoutgraph.NewNode(97, 5, 5)
		c1b := layoutgraph.NewNode(98, 5, 5)
		for c, u := range map[*layoutgraph.Node]*layoutgraph.Node{
			cn3a: un3, cn3b: un3, cn2a: un2, cn2b: un2, cn1a: un1, cn1b: un1, c1a: u1, c1b: u1,
		} {
			c.Container = u
		}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root: {s1, s2, s3, s4, s5, s6, s7, s8},
			un3:  {cn3a, cn3b},
			un2:  {cn2a, cn2b},
			un1:  {cn1a, cn1b},
			u1:   {c1a, c1b},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cn3a, CurrentTo: un3},
			{OriginallyFrom: s2, OriginallyTo: cn3b, CurrentTo: un3},
			{OriginallyFrom: s3, OriginallyTo: cn2a, CurrentTo: un2},
			{OriginallyFrom: s4, OriginallyTo: cn2b, CurrentTo: un2},
			{OriginallyFrom: s5, OriginallyTo: cn1a, CurrentTo: un1},
			{OriginallyFrom: s6, OriginallyTo: cn1b, CurrentTo: un1},
			{OriginallyFrom: s7, OriginallyTo: c1a, CurrentTo: u1},
			{OriginallyFrom: s8, OriginallyTo: c1b, CurrentTo: u1},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "s3": s3, "s4": s4, "s5": s5, "s6": s6, "s7": s7, "s8": s8,
		}}, err
	})

	// L. five unconstrained groups — unbiased cycling
	runScenario("L_five_unconstrained_cycling", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		sheep := make([]*layoutgraph.Node, 10)
		for i := range sheep {
			sheep[i] = layoutgraph.NewNode(int64(i+1), 5, 5)
			sheep[i].Container = root
		}
		uncles := make([]*layoutgraph.Node, 5)
		cousins := make([]*layoutgraph.Node, 5)
		containers := map[*layoutgraph.Node][]*layoutgraph.Node{root: {}}
		abductions := []*layoutgraph.EdgeAbduction{}
		for i := 0; i < 5; i++ {
			uncles[i] = layoutgraph.NewNode(int64(i+10), 10, 10)
			cousins[i] = layoutgraph.NewNode(int64(i+20), 5, 5)
			cousins[i].Container = uncles[i]
			containers[uncles[i]] = []*layoutgraph.Node{cousins[i]}
			containers[root] = append(containers[root], sheep[2*i], sheep[2*i+1])
			abductions = append(abductions,
				&layoutgraph.EdgeAbduction{OriginallyFrom: sheep[2*i], OriginallyTo: cousins[i], CurrentTo: uncles[i]},
				&layoutgraph.EdgeAbduction{OriginallyFrom: sheep[2*i+1], OriginallyTo: cousins[i], CurrentTo: uncles[i]},
			)
		}
		g.Containers = containers
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		ns := map[string]*layoutgraph.Node{}
		for i, s := range sheep {
			ns[fmt.Sprintf("sheep%d", i)] = s
		}
		return scenarioState{nodes: ns}, err
	})

	// M. placed Right / non-tall uncle → Left only
	runScenario("M_placed_right_non_tall_uncle", func() (scenarioState, error) {
		_, sheep1, sheep2, _, _, g, abductions := makeMinimalHerd(10, 10, true, geo.Right)
		err := proximity.AssignHerds(context.Background(), g, layoutgraph.NewNode(0, 100, 100), abductions)
		// Rebuild correctly with the actual root
		g2 := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10) // not tall, width == height
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		s1.Container = root
		s2.Container = root
		g2.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g2)
		abductions2 := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err = proximity.AssignHerds(context.Background(), g2, root, abductions2)
		_ = sheep1
		_ = sheep2
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "cousin": cousin,
		}}, err
	})

	// N. tall Right uncle with oppositeCount > sameCount → Right (same side)
	runScenario("N_tall_right_opposite_gt_same", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 30) // tall: Height >= 2*Width
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		cousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(99, 1, 1))
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "cousin": cousin,
		}}, err
	})

	// O. tall Right equal pair counts → Left (opposite)
	runScenario("O_tall_right_equal_counts", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 30)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		// equal counts: 0 same, 0 opposite → strict < is false → choose Left
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "cousin": cousin,
		}}, err
	})

	// P. wide Top cousin bias
	runScenario("P_wide_top_cousin_bias", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 30, 10) // wide: Width >= 2*Height
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Top
		cousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(99, 1, 1))
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "cousin": cousin,
		}}, err
	})

	// Q. invalid diagonal cousin orientation
	runScenario("Q_invalid_diagonal_cousin", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.TopLeft // invalid diagonal
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2}}, err
	})

	// R. NONE cousin orientation invalid
	runScenario("R_none_cousin_orientation", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(8, 8)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.NONE
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2}}, err
	})

	// S. unplaced uncle skips invalid cousin
	runScenario("S_unplaced_uncle_skips_invalid_cousin", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		// cousin.TopLeft = nil (unplaced first child)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.TopLeft // would be invalid if evaluated
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "cousin": cousin}}, err
	})

	// T. first child unplaced / later child placed — still unplaced
	runScenario("T_first_child_nil_topleft", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		child0 := layoutgraph.NewNode(11, 5, 5) // first child, NOT placed
		child1 := layoutgraph.NewNode(12, 5, 5) // second child, placed
		child0.Container = uncle
		child1.Container = uncle
		child1.TopLeft = geo.NewPoint(8, 8)
		child1.HerdAssignment = layoutgraph.NewHerdAssignment()
		child1.HerdAssignment.Orientation = geo.Right
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {child0, child1},
		}
		setContainerFlag(g)
		// s1 abducts to child1 (placed), s2 abducts to child1 too
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: child1, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: child1, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "child0": child0, "child1": child1}}, err
	})

	// U. unindexed uncle exact invariant
	runScenario("U_unindexed_uncle", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		a := layoutgraph.NewNode(2, 10, 10)
		b := layoutgraph.NewNode(3, 10, 10)
		uncle := layoutgraph.NewNode(4, 100, 100)
		uncle.SetContainer(true)
		cousinA := layoutgraph.NewNode(5, 10, 10)
		cousinB := layoutgraph.NewNode(6, 10, 10)
		cousinA.Container = uncle
		cousinB.Container = uncle
		g.Containers[root] = []*layoutgraph.Node{a, b}
		a.Container = root
		b.Container = root
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a, OriginallyTo: cousinA, CurrentTo: uncle},
			{OriginallyFrom: b, OriginallyTo: cousinB, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"a": a, "b": b}}, err
	})

	// V. overlapping compatible groups
	runScenario("V_overlapping_compatible", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		root.SetContainer(true)
		a.Container = root
		b.Container = root
		c.Container = root
		g.Containers[root] = []*layoutgraph.Node{a, b, c}
		first := layoutgraph.NewNode(4, 300, 100) // wide, firstWide=true
		last := layoutgraph.NewNode(5, 100, 100)
		first.SetContainer(true)
		last.SetContainer(true)
		firstCousin := layoutgraph.NewNode(6, 10, 10)
		lastCousin := layoutgraph.NewNode(7, 10, 10)
		firstCousin.Container = first
		lastCousin.Container = last
		g.Containers[first] = []*layoutgraph.Node{firstCousin}
		g.Containers[last] = []*layoutgraph.Node{lastCousin}
		firstCousin.TopLeft = geo.NewPoint(0, 0)
		lastCousin.TopLeft = geo.NewPoint(0, 0)
		firstCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		firstCousin.HerdAssignment.Orientation = geo.Top
		firstCousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(8, 10, 10))
		lastCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		lastCousin.HerdAssignment.Orientation = geo.Bottom
		lastCousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(9, 10, 10))
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a, OriginallyTo: firstCousin, CurrentTo: first},
			{OriginallyFrom: b, OriginallyTo: firstCousin, CurrentTo: first},
			{OriginallyFrom: b, OriginallyTo: lastCousin, CurrentTo: last},
			{OriginallyFrom: c, OriginallyTo: lastCousin, CurrentTo: last},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"a": a, "b": b, "c": c, "firstCousin": firstCousin, "lastCousin": lastCousin,
		}}, err
	})

	// W. preferred removed but sides remain — sides[0]
	runScenario("W_preferred_removed_sides_remain", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		root.SetContainer(true)
		a.Container = root
		b.Container = root
		c.Container = root
		g.Containers[root] = []*layoutgraph.Node{a, b, c}
		// first uncle: tall, cousin orientation Right
		// bothSides=true, but 0 same < 1 opposite → preferred=Right initially
		// allowed: [Right, Left]
		first := layoutgraph.NewNode(4, 10, 30)
		first.SetContainer(true)
		firstCousin := layoutgraph.NewNode(6, 10, 10)
		firstCousin.Container = first
		g.Containers[first] = []*layoutgraph.Node{firstCousin}
		firstCousin.TopLeft = geo.NewPoint(0, 0)
		firstCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		firstCousin.HerdAssignment.Orientation = geo.Right
		firstCousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(99, 1, 1))
		// last uncle: NOT tall (so bothSides=false for Left orientation)
		// cousin orientation Left → allowed: [Right]
		last := layoutgraph.NewNode(5, 10, 10)
		last.SetContainer(true)
		lastCousin := layoutgraph.NewNode(7, 10, 10)
		lastCousin.Container = last
		g.Containers[last] = []*layoutgraph.Node{lastCousin}
		lastCousin.TopLeft = geo.NewPoint(0, 0)
		lastCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		lastCousin.HerdAssignment.Orientation = geo.Left
		// After intersecting: preferred=Right, but initial preferred from first was Right (which survives)
		// Actually from the spec: first cousin = Right, tall, oppositeCount>sameCount → preferred=Right
		// allowed after first: [Right, Left]
		// last cousin = Left, non-tall: allowed only Right
		// intersection: [Right]
		// preferred=Right is still in sides → use Right
		// This is scenario 59 in spec: preferred NOT removed
		// To match spec scenario 59 "preferred removed" we need Left chosen by first, then Right from last
		// Reset: let's do firstCousin orientation=Right, equal counts (0<0 false) → preferred=Left
		// allowed: [Right, Left] since tall
		// then lastCousin=Left, non-tall: opposite=Right, allowed=[Right]
		// intersection: [Right]; preferred=Left not in sides → sides[0]=Right
		// Fix: reset firstCousin pair counts
		firstCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		firstCousin.HerdAssignment.Orientation = geo.Right // bothSides, 0<0 false → Left
		lastCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		lastCousin.HerdAssignment.Orientation = geo.Left
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a, OriginallyTo: firstCousin, CurrentTo: first},
			{OriginallyFrom: b, OriginallyTo: firstCousin, CurrentTo: first},
			{OriginallyFrom: b, OriginallyTo: lastCousin, CurrentTo: last},
			{OriginallyFrom: c, OriginallyTo: lastCousin, CurrentTo: last},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"a": a, "b": b, "c": c, "firstCousin": firstCousin, "lastCousin": lastCousin,
		}}, err
	})

	// X. incompatible component clears all assignments
	runScenario("X_incompatible_clears_assignments", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		root.SetContainer(true)
		a.Container = root
		b.Container = root
		g.Containers[root] = []*layoutgraph.Node{a, b}
		// Two placed cousins with incompatible orientations:
		// uncle1: cousin with Left orientation (not tall)
		// uncle2: cousin with Right orientation (not tall)
		// Left → allowed=[Right]; Right → allowed=[Left]
		// intersection = empty
		uncle1 := layoutgraph.NewNode(10, 10, 10)
		uncle2 := layoutgraph.NewNode(11, 10, 10)
		cousin1 := layoutgraph.NewNode(20, 5, 5)
		cousin2 := layoutgraph.NewNode(21, 5, 5)
		cousin1.Container = uncle1
		cousin2.Container = uncle2
		cousin1.TopLeft = geo.NewPoint(0, 0)
		cousin2.TopLeft = geo.NewPoint(0, 0)
		cousin1.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin1.HerdAssignment.Orientation = geo.Left
		cousin2.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin2.HerdAssignment.Orientation = geo.Right
		g.Containers[uncle1] = []*layoutgraph.Node{cousin1}
		g.Containers[uncle2] = []*layoutgraph.Node{cousin2}
		setContainerFlag(g)
		// Pre-assign sheep so we can verify clearing
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Top
		b.HerdAssignment = layoutgraph.NewHerdAssignment()
		b.HerdAssignment.Orientation = geo.Bottom
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a, OriginallyTo: cousin1, CurrentTo: uncle1},
			{OriginallyFrom: b, OriginallyTo: cousin2, CurrentTo: uncle2},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"a": a, "b": b}}, err
	})

	// Y. incompatible component does NOT advance unbiasedSide
	runScenario("Y_incompatible_no_unbiased_advance", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		// 3 groups: incompatible middle flanked by two unconstrained
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		s3 := layoutgraph.NewNode(3, 5, 5)
		s4 := layoutgraph.NewNode(4, 5, 5)
		s5 := layoutgraph.NewNode(5, 5, 5)
		s6 := layoutgraph.NewNode(6, 5, 5)
		for _, s := range []*layoutgraph.Node{s1, s2, s3, s4, s5, s6} {
			s.Container = root
		}
		// u10 (first unconstrained): IDs 10
		u10 := layoutgraph.NewNode(10, 10, 10)
		c10a := layoutgraph.NewNode(101, 5, 5)
		c10b := layoutgraph.NewNode(102, 5, 5)
		c10a.Container = u10
		c10b.Container = u10
		// u20 (incompatible): ID 20
		u20 := layoutgraph.NewNode(20, 10, 10)
		c20a := layoutgraph.NewNode(201, 5, 5)
		c20b := layoutgraph.NewNode(202, 5, 5)
		c20a.Container = u20
		c20b.Container = u20
		c20a.TopLeft = geo.NewPoint(0, 0)
		c20b.TopLeft = geo.NewPoint(0, 0)
		c20a.HerdAssignment = layoutgraph.NewHerdAssignment()
		c20a.HerdAssignment.Orientation = geo.Left
		c20b.HerdAssignment = layoutgraph.NewHerdAssignment()
		c20b.HerdAssignment.Orientation = geo.Right
		// u30 (second unconstrained): ID 30
		u30 := layoutgraph.NewNode(30, 10, 10)
		c30a := layoutgraph.NewNode(301, 5, 5)
		c30b := layoutgraph.NewNode(302, 5, 5)
		c30a.Container = u30
		c30b.Container = u30
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root: {s1, s2, s3, s4, s5, s6},
			u10:  {c10a, c10b},
			u20:  {c20a, c20b},
			u30:  {c30a, c30b},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: c10a, CurrentTo: u10},
			{OriginallyFrom: s2, OriginallyTo: c10b, CurrentTo: u10},
			{OriginallyFrom: s3, OriginallyTo: c20a, CurrentTo: u20},
			{OriginallyFrom: s4, OriginallyTo: c20b, CurrentTo: u20},
			{OriginallyFrom: s5, OriginallyTo: c30a, CurrentTo: u30},
			{OriginallyFrom: s6, OriginallyTo: c30b, CurrentTo: u30},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "s3": s3, "s4": s4, "s5": s5, "s6": s6,
		}}, err
	})

	// Z. fresh sheep assignment overwrite
	runScenario("Z_fresh_sheep_assignment", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		s1.Container = root
		s2.Container = root
		// Pre-assign sheep with "old" assignment
		s1.HerdAssignment = layoutgraph.NewHerdAssignment()
		s1.HerdAssignment.Orientation = geo.Right
		s1.HerdAssignment.Val = 99
		s1.HerdAssignment.PairSameSide(layoutgraph.NewNode(999, 1, 1))
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2}}, err
	})

	// AA. cousin assignment identity preserved (only pair counts change)
	runScenario("AA_cousin_identity_preserved", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(0, 0)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "cousin": cousin}}, err
	})

	// AB. same-side pair recording
	runScenario("AB_same_side_pair", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 30) // tall, bothSides for Right
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(0, 0)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		cousin.HerdAssignment.PairOppositeSide(layoutgraph.NewNode(99, 1, 1)) // 0 < 1 → preferred=Right
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		// preferred==Right==cousin.orientation → same side pair
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "cousin": cousin}}, err
	})

	// AC. opposite-side pair recording
	runScenario("AC_opposite_side_pair", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10) // not tall, bothSides=false for Right
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(0, 0)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		// preferred=Left != Right → opposite side pair
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "cousin": cousin}}, err
	})

	// AD. duplicate cousin pair Set uniqueness
	runScenario("AD_duplicate_cousin_pair_set_uniqueness", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(0, 0)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		// Send same cousin twice per sheep
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2, "cousin": cousin}}, err
	})

	// AE. virality fixture (from TestAssignHerdVirality)
	runScenario("AE_assign_herd_virality", func() (scenarioState, error) {
		g := makeGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		x := layoutgraph.NewNode(1, 5, 5)
		y := layoutgraph.NewNode(2, 5, 5)
		a := layoutgraph.NewNode(3, 5, 5)
		b := layoutgraph.NewNode(4, 5, 5)
		c := layoutgraph.NewNode(5, 5, 5)
		for _, s := range []*layoutgraph.Node{x, y, a, b, c} {
			s.Container = container
		}
		placedCousin := layoutgraph.NewNode(6, 5, 5)
		placedCousin.TopLeft = geo.NewPoint(8, 8)
		placedUncle := layoutgraph.NewNode(7, 10, 10)
		placedCousin.Container = placedUncle
		placedCousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		placedCousin.HerdAssignment.Orientation = geo.Right
		cousin := layoutgraph.NewNode(8, 5, 5)
		uncle := layoutgraph.NewNode(9, 10, 10)
		cousin.Container = uncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:   {x, y, a, b, c},
			placedUncle: {placedCousin},
			uncle:       {cousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, container, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: x, OriginallyTo: placedCousin, CurrentTo: placedUncle},
			{OriginallyFrom: y, OriginallyTo: placedCousin, CurrentTo: placedUncle},
			{OriginallyFrom: x, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: y, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: a, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: b, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: c, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"x": x, "y": y, "a": a, "b": b, "c": c, "placedCousin": placedCousin,
		}}, err
	})

	// AF. random virality (from TestRandomHerdVirality)
	runScenario("AF_random_herd_virality", func() (scenarioState, error) {
		g := makeGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		a1 := layoutgraph.NewNode(1, 5, 5)
		a2 := layoutgraph.NewNode(2, 5, 5)
		b1 := layoutgraph.NewNode(3, 5, 5)
		b2 := layoutgraph.NewNode(4, 5, 5)
		c1 := layoutgraph.NewNode(5, 5, 5)
		c2 := layoutgraph.NewNode(6, 5, 5)
		for _, s := range []*layoutgraph.Node{a1, a2, b1, b2, c1, c2} {
			s.Container = container
		}
		aCousin := layoutgraph.NewNode(10, 5, 5)
		aUncle := layoutgraph.NewNode(11, 10, 10)
		aCousin.Container = aUncle
		bCousin := layoutgraph.NewNode(20, 5, 5)
		bUncle := layoutgraph.NewNode(21, 10, 10)
		bCousin.Container = bUncle
		cCousin := layoutgraph.NewNode(30, 5, 5)
		cUncle := layoutgraph.NewNode(31, 10, 10)
		cCousin.Container = cUncle
		commonCousin := layoutgraph.NewNode(40, 5, 5)
		commonUncle := layoutgraph.NewNode(41, 10, 10)
		commonCousin.Container = commonUncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:   {a1, a2, b1, b2, c1, c2},
			aUncle:      {aCousin},
			bUncle:      {bCousin},
			cUncle:      {cCousin},
			commonUncle: {commonCousin},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, container, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a1, OriginallyTo: aCousin, CurrentTo: aUncle},
			{OriginallyFrom: a2, OriginallyTo: aCousin, CurrentTo: aUncle},
			{OriginallyFrom: b1, OriginallyTo: bCousin, CurrentTo: bUncle},
			{OriginallyFrom: b2, OriginallyTo: bCousin, CurrentTo: bUncle},
			{OriginallyFrom: c1, OriginallyTo: cCousin, CurrentTo: cUncle},
			{OriginallyFrom: c2, OriginallyTo: cCousin, CurrentTo: cUncle},
			{OriginallyFrom: a1, OriginallyTo: commonCousin, CurrentTo: commonUncle},
			{OriginallyFrom: a2, OriginallyTo: commonCousin, CurrentTo: commonUncle},
			{OriginallyFrom: b1, OriginallyTo: commonCousin, CurrentTo: commonUncle},
			{OriginallyFrom: b2, OriginallyTo: commonCousin, CurrentTo: commonUncle},
			{OriginallyFrom: c1, OriginallyTo: commonCousin, CurrentTo: commonUncle},
			{OriginallyFrom: c2, OriginallyTo: commonCousin, CurrentTo: commonUncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"a1": a1, "a2": a2, "b1": b1, "b2": b2, "c1": c1, "c2": c2,
		}}, err
	})

	// AG. partial mutation before later invalid-orientation error
	runScenario("AG_partial_mutation_before_error", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		// Group 1 (ID 10) — unplaced, will get unbiased side
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		u10 := layoutgraph.NewNode(10, 10, 10)
		c10a := layoutgraph.NewNode(101, 5, 5)
		c10b := layoutgraph.NewNode(102, 5, 5)
		c10a.Container = u10
		c10b.Container = u10
		s1.Container = root
		s2.Container = root
		// Group 2 (ID 20) — placed with invalid orientation
		s3 := layoutgraph.NewNode(3, 5, 5)
		s4 := layoutgraph.NewNode(4, 5, 5)
		u20 := layoutgraph.NewNode(20, 10, 10)
		c20 := layoutgraph.NewNode(201, 5, 5)
		c20.Container = u20
		c20.TopLeft = geo.NewPoint(0, 0)
		c20.HerdAssignment = layoutgraph.NewHerdAssignment()
		c20.HerdAssignment.Orientation = geo.TopLeft // invalid
		s3.Container = root
		s4.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root: {s1, s2, s3, s4},
			u10:  {c10a, c10b},
			u20:  {c20},
		}
		setContainerFlag(g)
		err := proximity.AssignHerds(context.Background(), g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: c10a, CurrentTo: u10},
			{OriginallyFrom: s2, OriginallyTo: c10b, CurrentTo: u10},
			{OriginallyFrom: s3, OriginallyTo: c20, CurrentTo: u20},
			{OriginallyFrom: s4, OriginallyTo: c20, CurrentTo: u20},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "s3": s3, "s4": s4,
		}}, err
	})

	// AH. partial mutation before cancellation
	runScenario("AH_partial_mutation_before_cancellation", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		s3 := layoutgraph.NewNode(3, 5, 5)
		s4 := layoutgraph.NewNode(4, 5, 5)
		u10 := layoutgraph.NewNode(10, 10, 10)
		u20 := layoutgraph.NewNode(20, 10, 10)
		c10a := layoutgraph.NewNode(101, 5, 5)
		c10b := layoutgraph.NewNode(102, 5, 5)
		c20a := layoutgraph.NewNode(201, 5, 5)
		c20b := layoutgraph.NewNode(202, 5, 5)
		for _, c := range []*layoutgraph.Node{c10a, c10b} {
			c.Container = u10
		}
		for _, c := range []*layoutgraph.Node{c20a, c20b} {
			c.Container = u20
		}
		s1.Container = root
		s2.Container = root
		s3.Container = root
		s4.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root: {s1, s2, s3, s4},
			u10:  {c10a, c10b},
			u20:  {c20a, c20b},
		}
		setContainerFlag(g)
		// Component 1 uncle check: 1 Err check → allow (remaining=1→0); component 1 gets assigned
		// Component 2 first uncle check: remaining=0 → cancel
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 2}
		// remaining=2: initial check (1→ok), connectedHerds u10 expansion (2), comp1 uncle u10 check (3)...
		// Let's count: initial AssignHerds = 1; GroupSheep = 0 (no children placed); connectedHerds uncle exp u10 = 1; u20 = 1; comp1 uncle u10 = 1; comp2 uncle u20 = 1
		// total checks needed before cancel at comp2: initial(1) + connected(2) + comp1 uncle(1) = 4
		// So remaining=4 to pass through comp1, cancel at comp2
		ctx = &cancelAfterErrChecks{Context: context.Background(), remaining: 4}
		err := proximity.AssignHerds(ctx, g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: c10a, CurrentTo: u10},
			{OriginallyFrom: s2, OriginallyTo: c10b, CurrentTo: u10},
			{OriginallyFrom: s3, OriginallyTo: c20a, CurrentTo: u20},
			{OriginallyFrom: s4, OriginallyTo: c20b, CurrentTo: u20},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{
			"s1": s1, "s2": s2, "s3": s3, "s4": s4,
		}}, err
	})

	// AI. ApplyVirally cancellation after component mutation
	runScenario("AI_apply_virally_cancellation", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		// Count: initial(1) + connectedHerds uncle exp uncle(1) + comp uncle(1) = 3
		// ApplyVirally top check = 1 more → cancel at 4th check
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 3}
		err := proximity.AssignHerds(ctx, g, root, []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		})
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2}}, err
	})

	// AJ. cluster Column → Row on Top
	runScenario("AJ_cluster_column_to_row_on_top", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		vessel := layoutgraph.NewNode(1, 5, 5)
		sheep2 := layoutgraph.NewNode(2, 5, 5)
		vessel.Container = root
		sheep2.Container = root
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {vessel, sheep2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Arrangement: layoutgraph.Column}
		g.Clusters[vessel] = cluster
		markClusterVessel(vessel)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: vessel, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: sheep2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		// To get Top as the unbiased choice, unbiasedSide=0, sides=[Top,Right,Bottom,Left] → Top
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		clusterStates := map[string]*layoutgraph.Cluster{"cluster": cluster}
		return scenarioState{nodes: map[string]*layoutgraph.Node{"vessel": vessel, "sheep2": sheep2},
			clusters: clusterStates}, err
	})

	// AK. cluster Row → Column on Left
	runScenario("AK_cluster_row_to_column_on_left", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		vessel := layoutgraph.NewNode(1, 5, 5)
		sheep2 := layoutgraph.NewNode(2, 5, 5)
		vessel.Container = root
		sheep2.Container = root
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		cousin.TopLeft = geo.NewPoint(0, 0)
		cousin.HerdAssignment = layoutgraph.NewHerdAssignment()
		cousin.HerdAssignment.Orientation = geo.Right // non-tall → preferred=Left
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {vessel, sheep2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Arrangement: layoutgraph.Row}
		g.Clusters[vessel] = cluster
		markClusterVessel(vessel)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: vessel, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: sheep2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		clusterStates := map[string]*layoutgraph.Cluster{"cluster": cluster}
		return scenarioState{nodes: map[string]*layoutgraph.Node{"vessel": vessel, "sheep2": sheep2},
			clusters: clusterStates}, err
	})

	// AL. cluster no-op cases
	runScenario("AL_cluster_noop", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		// vessel gets Top, cluster starts Row → Top+Row is no-op
		vessel := layoutgraph.NewNode(1, 5, 5)
		sheep2 := layoutgraph.NewNode(2, 5, 5)
		vessel.Container = root
		sheep2.Container = root
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {vessel, sheep2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		cluster := &layoutgraph.Cluster{Vessel: vessel, Arrangement: layoutgraph.Row} // Row, Top→no-op
		g.Clusters[vessel] = cluster
		markClusterVessel(vessel)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: vessel, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: sheep2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		clusterStates := map[string]*layoutgraph.Cluster{"cluster": cluster}
		return scenarioState{nodes: map[string]*layoutgraph.Node{"vessel": vessel, "sheep2": sheep2},
			clusters: clusterStates}, err
	})

	// AM. malformed cluster vessel missing graph.Clusters entry
	runScenario("AM_malformed_cluster_vessel", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		vessel := layoutgraph.NewNode(1, 5, 5)
		sheep2 := layoutgraph.NewNode(2, 5, 5)
		vessel.Container = root
		sheep2.Container = root
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {vessel, sheep2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		// vessel is a cluster vessel but NOT in graph.Clusters
		markClusterVessel(vessel)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: vessel, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: sheep2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{"vessel": vessel, "sheep2": sheep2}}, err
	})

	// AN. repeated invocation
	runScenario("AN_repeated_invocation", func() (scenarioState, error) {
		g := makeGraph()
		root := layoutgraph.NewNode(0, 100, 100)
		s1 := layoutgraph.NewNode(1, 5, 5)
		s2 := layoutgraph.NewNode(2, 5, 5)
		uncle := layoutgraph.NewNode(10, 10, 10)
		cousin := layoutgraph.NewNode(11, 5, 5)
		cousin.Container = uncle
		s1.Container = root
		s2.Container = root
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:  {s1, s2},
			uncle: {cousin},
		}
		setContainerFlag(g)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: s1, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: s2, OriginallyTo: cousin, CurrentTo: uncle},
		}
		if err := proximity.AssignHerds(context.Background(), g, root, abductions); err != nil {
			return scenarioState{}, err
		}
		// Reset sheep assignments
		s1.HerdAssignment = nil
		s2.HerdAssignment = nil
		err := proximity.AssignHerds(context.Background(), g, root, abductions)
		return scenarioState{nodes: map[string]*layoutgraph.Node{"s1": s1, "s2": s2}}, err
	})

	// Serialize and write
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal error: %v\n", err)
		os.Exit(1)
	}

	outPath := filepath.Join(".", "go-assign-herds-reference.json")
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Wrote %s\n", outPath)
}
