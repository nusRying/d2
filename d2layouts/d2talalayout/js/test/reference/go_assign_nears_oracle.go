package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
)

type NodeNearState struct {
	Nears    []string `json:"nears"`
	Replaced bool     `json:"replaced"`
}

type ScenarioResult struct {
	Success      bool                     `json:"success"`
	ErrorMessage string                   `json:"errorMessage,omitempty"`
	Panic        string                   `json:"panic,omitempty"`
	Nodes        map[string]NodeNearState `json:"nodes,omitempty"`
}

type Output struct {
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type cancelAfterSteps struct {
	context.Context
	remaining int
}

func (ctx *cancelAfterSteps) Err() error {
	if ctx.remaining <= 0 {
		return context.Canceled
	}
	ctx.remaining--
	return ctx.Context.Err()
}

type cancelWhenNearInstalled struct {
	context.Context
	nodes    []*layoutgraph.Node
	observed bool
}

func (ctx *cancelWhenNearInstalled) Err() error {
	for _, node := range ctx.nodes {
		if len(node.Nears) > 0 {
			ctx.observed = true
			return context.Canceled
		}
	}
	return ctx.Context.Err()
}

func sameMap(a, b map[*layoutgraph.Node]struct{}) bool {
	if a == nil && b == nil {
		return true
	}
	if (a == nil) != (b == nil) {
		return false
	}
	return reflect.ValueOf(a).Pointer() == reflect.ValueOf(b).Pointer()
}

func main() {
	out := Output{
		Scenarios: make(map[string]ScenarioResult),
	}

	runScenario := func(
		name string,
		setup func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node),
	) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = ScenarioResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()

		ctx, g, root, abductions, trackedNodes := setup()
		originalMaps := make(map[*layoutgraph.Node]map[*layoutgraph.Node]struct{})
		for _, n := range trackedNodes {
			originalMaps[n] = n.Nears
		}

		err := proximity.AssignNears(ctx, g, root, abductions)

		res := ScenarioResult{
			Success: err == nil,
			Nodes:   make(map[string]NodeNearState),
		}
		if err != nil {
			res.ErrorMessage = err.Error()
		}

		for _, n := range trackedNodes {
			var nearIDs []string
			if n.Nears != nil {
				for near := range n.Nears {
					nearIDs = append(nearIDs, fmt.Sprintf("%v", near.ID))
				}
			}
			sort.Strings(nearIDs)
			if nearIDs == nil {
				nearIDs = []string{}
			}
			res.Nodes[fmt.Sprintf("%v", n.ID)] = NodeNearState{
				Nears:    nearIDs,
				Replaced: !sameMap(n.Nears, originalMaps[n]),
			}
		}

		out.Scenarios[name] = res
	}

	// A. empty abductions
	runScenario("A_empty_abductions", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		root := &layoutgraph.Node{ID: 10}
		c1 := &layoutgraph.Node{ID: 1, Container: root, Nears: make(map[*layoutgraph.Node]struct{})}
		c2 := &layoutgraph.Node{ID: 2, Container: root, Nears: make(map[*layoutgraph.Node]struct{})}
		ext := &layoutgraph.Node{ID: 100, Nears: make(map[*layoutgraph.Node]struct{})}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		return context.Background(), g, root, []*layoutgraph.EdgeAbduction{}, []*layoutgraph.Node{c1, c2, ext}
	})

	// B. canonical upstream case
	runScenario("B_canonical_upstream", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		external := layoutgraph.NewNode(100, 10, 10)
		root := layoutgraph.NewNode(10, 1000, 1000)
		for _, node := range []*layoutgraph.Node{first, second, external, root} {
			graphNode := node
			graphNode.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(graphNode)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, external)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		g.Connect(first, external)
		g.Connect(second, external)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: external},
			{OriginallyFrom: second, CurrentTo: external},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second, external}
	})

	// C. three siblings same uncle
	runScenario("C_three_siblings", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		c3 := layoutgraph.NewNode(3, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{c1, c2, c3, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		g.AddNodeToContainer(root, c3)
		g.Connect(c1, ext)
		g.Connect(c2, ext)
		g.Connect(c3, ext)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: c1, CurrentTo: ext},
			{OriginallyFrom: c2, CurrentTo: ext},
			{OriginallyFrom: c3, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2, c3}
	})

	// D. duplicate abductions
	runScenario("D_duplicate_abductions", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{c1, c2, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		g.Connect(c1, ext)
		g.Connect(c2, ext)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: c1, CurrentTo: ext},
			{OriginallyFrom: c1, CurrentTo: ext},
			{OriginallyFrom: c2, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2}
	})

	// E. different uncles
	runScenario("E_different_uncles", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		c3 := layoutgraph.NewNode(3, 10, 10)
		c4 := layoutgraph.NewNode(4, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		u1 := layoutgraph.NewNode(101, 10, 10)
		u2 := layoutgraph.NewNode(102, 10, 10)
		for _, n := range []*layoutgraph.Node{c1, c2, c3, c4, root, u1, u2} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, u1)
		g.AddNodeToContainer(nil, u2)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		g.AddNodeToContainer(root, c3)
		g.AddNodeToContainer(root, c4)
		g.Connect(c1, u1)
		g.Connect(c2, u1)
		g.Connect(c3, u2)
		g.Connect(c4, u2)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: c1, CurrentTo: u1},
			{OriginallyFrom: c2, CurrentTo: u1},
			{OriginallyFrom: c3, CurrentTo: u2},
			{OriginallyFrom: c4, CurrentTo: u2},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2, c3, c4}
	})

	// F. nested descendants case from upstream
	runScenario("F_nested_descendants", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		nestedFirst := layoutgraph.NewNode(21, 10, 10)
		nestedSecond := layoutgraph.NewNode(22, 10, 10)
		nestedContainer := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 10, 10)
		external := layoutgraph.NewNode(100, 10, 10)
		for _, node := range []*layoutgraph.Node{first, nestedFirst, nestedSecond, nestedContainer, root, external} {
			node.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(node)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, external)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, nestedContainer)
		g.AddNodeToContainer(nestedContainer, nestedFirst)
		g.AddNodeToContainer(nestedContainer, nestedSecond)
		g.Connect(first, external)
		g.Connect(nestedFirst, external)
		g.Connect(nestedSecond, external)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: external},
			{OriginallyFrom: nestedFirst, CurrentTo: external},
			{OriginallyFrom: nestedSecond, CurrentTo: external},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, nestedContainer, nestedFirst, nestedSecond}
	})

	// G. nested descendant using Cluster membership
	runScenario("G_nested_cluster_vessel", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		clusterVessel := layoutgraph.NewNode(2, 10, 10)
		member := layoutgraph.NewNode(21, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, clusterVessel, member, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		cluster := &layoutgraph.Cluster{Vessel: clusterVessel}
		member.Cluster = cluster
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, clusterVessel)
		g.Connect(first, ext)
		g.Connect(member, ext)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: member, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, clusterVessel, member}
	})

	// H. nested descendant using Sequence membership
	runScenario("H_nested_sequence_vessel", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		seqVessel := layoutgraph.NewNode(2, 10, 10)
		member := layoutgraph.NewNode(21, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, seqVessel, member, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		seq := &layoutgraph.Sequence{Vessel: seqVessel}
		member.Sequence = seq
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, seqVessel)
		g.Connect(first, ext)
		g.Connect(member, ext)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: member, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, seqVessel, member}
	})

	// I. groupVessel Cluster precedence over Sequence
	runScenario("I_cluster_precedence_over_sequence", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		other := layoutgraph.NewNode(1, 10, 10)
		clusterVessel := layoutgraph.NewNode(2, 10, 10)
		seqVessel := layoutgraph.NewNode(3, 10, 10)
		member := layoutgraph.NewNode(21, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{other, clusterVessel, seqVessel, member, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		cluster := &layoutgraph.Cluster{Vessel: clusterVessel}
		seq := &layoutgraph.Sequence{Vessel: seqVessel}
		member.Cluster = cluster
		member.Sequence = seq
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, other)
		g.AddNodeToContainer(root, clusterVessel)
		g.AddNodeToContainer(root, seqVessel)
		g.Connect(other, ext)
		g.Connect(member, ext)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: other, CurrentTo: ext},
			{OriginallyFrom: member, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{other, clusterVessel, seqVessel}
	})

	// J. FROM and TO both descendants (From branch wins -> CurrentTo becomes uncle)
	runScenario("J_from_and_to_both_descendants", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		uncleFrom := layoutgraph.NewNode(101, 10, 10)
		uncleTo := layoutgraph.NewNode(102, 10, 10)
		for _, n := range []*layoutgraph.Node{c1, c2, root, uncleFrom, uncleTo} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, uncleFrom)
		g.AddNodeToContainer(nil, uncleTo)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: c1, OriginallyTo: c1, CurrentFrom: uncleFrom, CurrentTo: uncleTo},
			{OriginallyFrom: c2, CurrentTo: uncleTo},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2}
	})

	// K. no matching direct child
	runScenario("K_no_matching_direct_child", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(10, 100, 100)
		otherRoot := layoutgraph.NewNode(20, 100, 100)
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		otherChild := layoutgraph.NewNode(21, 10, 10)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{root, otherRoot, c1, c2, otherChild, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, otherRoot)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		g.AddNodeToContainer(otherRoot, otherChild)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: otherChild, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2}
	})

	// L. CurrentTo / CurrentFrom nil
	runScenario("L_nil_uncle", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(10, 100, 100)
		c1 := layoutgraph.NewNode(1, 10, 10)
		c2 := layoutgraph.NewNode(2, 10, 10)
		for _, n := range []*layoutgraph.Node{root, c1, c2} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(root, c1)
		g.AddNodeToContainer(root, c2)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: c1, CurrentTo: nil},
			{OriginallyFrom: c2, CurrentTo: nil},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{c1, c2}
	})

	// M. hierarchy on first
	runScenario("M_hierarchy_on_first", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		first.Hierarchy = &layoutgraph.Hierarchy{}
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// N. hierarchy on second
	runScenario("N_hierarchy_on_second", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		second.Hierarchy = &layoutgraph.Hierarchy{}
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// O. existing direct edge between candidate siblings
	runScenario("O_existing_direct_edge", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		g.Connect(first, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// P. malformed nil edge inside first.Edges
	runScenario("P_nil_edge_in_edges", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		first.Edges = append(first.Edges, nil)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// Q. existing Near preservation
	runScenario("Q_existing_near_preservation", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		oldNear := layoutgraph.NewNode(99, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, oldNear, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		first.Nears[oldNear] = struct{}{}
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second, oldNear}
	})

	// R. already symmetric Near pair
	runScenario("R_already_symmetric_near", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		first.Nears[second] = struct{}{}
		second.Nears[first] = struct{}{}
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// S. asymmetric existing Near (first has second, second lacks first)
	runScenario("S_asymmetric_existing_near", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		first.Nears[second] = struct{}{}
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// T. null/nil Near map
	runScenario("T_nil_near_map", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			g.AddNodeUnchecked(n)
		}
		first.Nears = nil
		second.Nears = nil
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// U. pre-cancelled context
	runScenario("U_precanceled_context", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		return ctx, g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// V. ordinary cancellation during discovery
	runScenario("V_cancellation_during_discovery", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		ctx := &cancelAfterSteps{Context: context.Background(), remaining: 1}
		return ctx, g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// W. cancellation after first commit assignment
	runScenario("W_cancellation_after_commit", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		ctx := &cancelWhenNearInstalled{Context: context.Background(), nodes: []*layoutgraph.Node{first, second}}
		return ctx, g, root, abductions, []*layoutgraph.Node{first, second}
	})

	// Z. unchanged unrelated external node
	runScenario("Z_unrelated_external_node", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		ext := layoutgraph.NewNode(100, 10, 10)
		marker := layoutgraph.NewNode(999, 10, 10)
		for _, n := range []*layoutgraph.Node{first, second, root, ext, marker} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		ext.Nears[marker] = struct{}{}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(nil, ext)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: first, CurrentTo: ext},
			{OriginallyFrom: second, CurrentTo: ext},
		}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second, ext}
	})

	// AA. nil abduction in slice throws invariant error
	runScenario("AA_nil_abduction_error", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction, []*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		first := layoutgraph.NewNode(1, 10, 10)
		second := layoutgraph.NewNode(2, 10, 10)
		root := layoutgraph.NewNode(10, 100, 100)
		for _, n := range []*layoutgraph.Node{first, second, root} {
			n.Nears = make(map[*layoutgraph.Node]struct{})
			g.AddNodeUnchecked(n)
		}
		g.AddNodeToContainer(nil, root)
		g.AddNodeToContainer(root, first)
		g.AddNodeToContainer(root, second)
		abductions := []*layoutgraph.EdgeAbduction{nil}
		return context.Background(), g, root, abductions, []*layoutgraph.Node{first, second}
	})

	outBytes, _ := json.MarshalIndent(out, "", "  ")

	targetPath := "go-assign-nears-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else if _, err := os.Stat("d2layouts/d2talalayout/js/test/fixtures"); err == nil {
		targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-assign-nears-reference.json"
	} else if _, err := os.Stat("../fixtures"); err == nil {
		targetPath = filepath.Join("..", "fixtures", "go-assign-nears-reference.json")
	} else if _, err := os.Stat("test/fixtures"); err == nil {
		targetPath = "test/fixtures/go-assign-nears-reference.json"
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(targetPath, outBytes, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(outBytes))
}
