//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
)

type GroupSheepResult struct {
	Success      bool                           `json:"success"`
	ErrorMessage string                         `json:"errorMessage,omitempty"`
	Panic        string                         `json:"panic,omitempty"`
	ByUncle      map[string][]string            `json:"byUncle,omitempty"`
	ToCousin     map[string]map[string][]string `json:"toCousin,omitempty"`
}

type Output struct {
	Scenarios map[string]GroupSheepResult `json:"scenarios"`
}

type stepCancelContext struct {
	context.Context
	cancelAt int
	count    int
}

func (c *stepCancelContext) Err() error {
	c.count++
	if c.count >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func main() {
	out := Output{
		Scenarios: make(map[string]GroupSheepResult),
	}

	runScenario := func(
		name string,
		setup func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction),
	) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = GroupSheepResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()

		ctx, graph, root, abductions := setup()
		byUncle, toCousin, err := proximity.GroupSheep(ctx, graph, root, abductions)
		if err != nil {
			out.Scenarios[name] = GroupSheepResult{
				Success:      false,
				ErrorMessage: err.Error(),
			}
			return
		}

		res := GroupSheepResult{
			Success:  true,
			ByUncle:  make(map[string][]string),
			ToCousin: make(map[string]map[string][]string),
		}

		for uncle, nodes := range byUncle {
			uID := fmt.Sprintf("%d", uncle.ID)
			var nodeIDs []string
			for _, n := range nodes {
				nodeIDs = append(nodeIDs, fmt.Sprintf("%d", n.ID))
			}
			res.ByUncle[uID] = nodeIDs
		}

		for uncle, nodeMap := range toCousin {
			uID := fmt.Sprintf("%d", uncle.ID)
			res.ToCousin[uID] = make(map[string][]string)
			for node, cousins := range nodeMap {
				nID := fmt.Sprintf("%d", node.ID)
				var cousinIDs []string
				for _, c := range cousins {
					cousinIDs = append(cousinIDs, fmt.Sprintf("%d", c.ID))
				}
				res.ToCousin[uID][nID] = cousinIDs
			}
		}

		out.Scenarios[name] = res
	}

	// A. empty graph / empty children
	runScenario("A_empty_graph_empty_children", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 10, 10)
		return context.Background(), g, root, nil
	})

	// B. upstream TestGroupSheep canonical fixture
	runScenario("B_upstream_canonical", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		a := layoutgraph.NewNode(1, 5, 5)
		b := layoutgraph.NewNode(2, 5, 5)
		c := layoutgraph.NewNode(3, 5, 5)
		d := layoutgraph.NewNode(4, 5, 5)
		e := layoutgraph.NewNode(5, 5, 5)

		ab_cousin := layoutgraph.NewNode(6, 5, 5)
		ab_uncle := layoutgraph.NewNode(60, 10, 10)
		ab_cousin.Container = ab_uncle

		b_cousin := layoutgraph.NewNode(7, 5, 5)
		b_uncle := layoutgraph.NewNode(70, 10, 10)
		b_cousin.Container = b_uncle

		cd_cousin := layoutgraph.NewNode(8, 5, 5)
		cd_uncle := layoutgraph.NewNode(80, 10, 10)
		cd_cousin.Container = cd_uncle

		// Uncle with no children has no grouping
		e_uncle := layoutgraph.NewNode(90, 5, 5)

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: a, OriginallyTo: ab_cousin, CurrentTo: ab_uncle},
			{OriginallyFrom: b, OriginallyTo: ab_cousin, CurrentTo: ab_uncle},
			{OriginallyFrom: b, OriginallyTo: b_cousin, CurrentTo: b_uncle},
			{OriginallyFrom: c, OriginallyTo: cd_cousin, CurrentTo: cd_uncle},
			{OriginallyFrom: d, OriginallyTo: cd_cousin, CurrentTo: cd_uncle},
			{OriginallyFrom: e, OriginallyTo: e_uncle, CurrentTo: e_uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {a, b, c, d, e},
			ab_uncle:  {ab_cousin},
			b_uncle:   {b_cousin},
			cd_uncle:  {cd_cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// C. upstream nested sheep
	runScenario("C_upstream_nested_sheep", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 100, 100)
		grandChild := layoutgraph.NewNode(2, 5, 5)

		grandChild.Container = child
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: grandChild, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			child:     {grandChild},
			uncle:     {cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// D. upstream cluster sheep
	runScenario("D_upstream_cluster_sheep", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		normalChild := layoutgraph.NewNode(1, 5, 5)
		clusterNodeA := layoutgraph.NewNode(2, 5, 5)
		clusterNodeB := layoutgraph.NewNode(3, 5, 5)
		vessel := layoutgraph.NewNode(4, 5, 5)

		grouping.AddCluster(g, &layoutgraph.Cluster{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{clusterNodeA, clusterNodeB},
		})

		normalChild.Container = container
		vessel.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: clusterNodeA, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: normalChild, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {normalChild, vessel},
			uncle:     {cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// E. sequence member equivalent: sequence member resolves to vessel
	runScenario("E_sequence_sheep", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		seqStep := layoutgraph.NewNode(2, 5, 5)
		vessel := layoutgraph.NewNode(4, 5, 5)

		seq := &layoutgraph.Sequence{Vessel: vessel, Nodes: []*layoutgraph.Node{seqStep}}
		seqStep.Sequence = seq

		seqStep.Container = container
		vessel.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: seqStep, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {vessel},
			uncle:     {cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// F. Cluster + Sequence both present -> Cluster wins
	runScenario("F_cluster_and_sequence", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		node := layoutgraph.NewNode(2, 5, 5)
		clusterVessel := layoutgraph.NewNode(4, 5, 5)
		seqVessel := layoutgraph.NewNode(5, 5, 5)

		node.Cluster = &layoutgraph.Cluster{Vessel: clusterVessel}
		node.Sequence = &layoutgraph.Sequence{Vessel: seqVessel, Nodes: []*layoutgraph.Node{node}}

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: node, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {clusterVessel, seqVessel},
			uncle:     {cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// G. reverse direction: OriginallyTo belongs to root child, use CurrentFrom path
	runScenario("G_reverse_direction", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: cousin, OriginallyTo: child, CurrentFrom: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// H. both branch predicates true -> forward branch wins
	runScenario("H_both_branches_qualify", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		// In this scenario, both OriginallyFrom == child and OriginallyTo == child
		// Forward branch treats to as cousin, CurrentTo as current
		cousinFwd := layoutgraph.NewNode(6, 5, 5)
		uncleFwd := layoutgraph.NewNode(60, 10, 10)
		cousinFwd.Container = uncleFwd

		cousinRev := layoutgraph.NewNode(7, 5, 5)
		uncleRev := layoutgraph.NewNode(70, 10, 10)
		cousinRev.Container = uncleRev

		// OriginallyFrom is child, OriginallyTo is cousinFwd.
		// Reverse would match if to was child. Let's make child a loop: OriginallyFrom: child, OriginallyTo: child.
		// But child.OwningContainer is container.
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousinFwd, CurrentTo: uncleFwd, CurrentFrom: uncleRev},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncleFwd:  {cousinFwd},
			uncleRev:  {cousinRev},
		}
		for cont := range g.Containers {
			if cont != nil {
				cont.SetContainer(true)
			}
		}
		return context.Background(), g, container, edgeAbductions
	})

	// I. current endpoint is non-container -> abduction skipped
	runScenario("I_current_endpoint_non_container", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle
		// uncle is NOT a container (SetContainer(false))

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(false)
		return context.Background(), g, container, edgeAbductions
	})

	// J. current endpoint nil -> preserved
	runScenario("J_current_endpoint_nil", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		// CurrentTo is nil
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: nil},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// K. cousin OwningContainer nil -> skipped
	runScenario("K_cousin_owning_container_nil", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		// cousin has nil Container
		cousin := layoutgraph.NewNode(6, 5, 5)

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: nil},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
		}
		container.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// L. final uncle nil after climb -> skipped after used becomes true
	runScenario("L_final_uncle_nil", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child1 := layoutgraph.NewNode(1, 5, 5)
		child2 := layoutgraph.NewNode(2, 5, 5)
		child1.Container = container
		child2.Container = container

		// cousin has OwningContainer = topNode, but topNode has OwningContainer = nil
		topNode := layoutgraph.NewNode(60, 10, 10)
		cousin := layoutgraph.NewNode(6, 5, 5)
		cousin.Container = topNode

		// CurrentTo is nil, so climb climbs cousin to topNode, where topNode.OwningContainer() == nil.
		// Loop terminates with cousin = topNode.
		// Then uncle = cousin.OwningContainer() = nil!
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: nil},
			{OriginallyFrom: child2, OriginallyTo: cousin, CurrentTo: nil},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child1, child2},
			topNode:   {cousin},
		}
		container.SetContainer(true)
		topNode.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// M. final uncle exists but isContainer false -> skipped after used becomes true
	runScenario("M_final_uncle_non_container", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		grandUncle := layoutgraph.NewNode(600, 20, 20)
		grandUncle.SetContainer(false) // uncle is not a container!

		uncle := layoutgraph.NewNode(60, 10, 10)
		uncle.Container = grandUncle
		uncle.SetContainer(true)

		cousin := layoutgraph.NewNode(6, 5, 5)
		cousin.Container = uncle

		// CurrentTo is uncle, climb loop stops when cousin.OwningContainer() == uncle
		// Final uncle is cousin.OwningContainer() which is uncle.
		// Wait, if CurrentTo is grandUncle, cousin climbs to uncle, then final uncle is grandUncle!
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: grandUncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:  {child},
			uncle:      {cousin},
			grandUncle: {uncle},
		}
		container.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// N. used-abduction consumption: consumed by child1, not available for child2
	runScenario("N_used_abduction_consumption", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child1 := layoutgraph.NewNode(1, 5, 5)
		child2 := layoutgraph.NewNode(2, 5, 5)
		child1.Container = container
		child2.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		// An abduction where OriginallyFrom is child1 and OriginallyTo is cousin
		// And second abduction where child2 connects to same cousin
		// But let's create a single abduction that could match both if child2 was tried:
		// wait, an abduction has one OriginallyFrom and one OriginallyTo.
		// What if OriginallyFrom is child1, but child2 is child1's child (nested)?
		// child1 is in container, child2 is in container.
		// In an abduction from child1 to cousin: child1 matches (from == node).
		// What if abduction is reverse: OriginallyFrom: cousin, OriginallyTo: commonDescendant?
		// If commonDescendant is inside child1, it matches child1. It won't match child2.
		// What if abduction was used by child1, even if child1 fails at final uncle:
		// Then child2 would also be unable to use it!
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child1, child2},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// O. skipped before used can be reconsidered by later child
	runScenario("O_skipped_before_used", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child1 := layoutgraph.NewNode(1, 5, 5)
		child2 := layoutgraph.NewNode(2, 5, 5)
		child1.Container = container
		child2.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		// For child1, from does not match child1, so branch does not match.
		// But for child2, it matches child2!
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child2, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child1, child2},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// P. root child source order: deliberately non-ID order
	runScenario("P_root_child_source_order", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child20 := layoutgraph.NewNode(20, 5, 5)
		child10 := layoutgraph.NewNode(10, 5, 5)
		child20.Container = container
		child10.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child20, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: child10, OriginallyTo: cousin, CurrentTo: uncle},
		}

		// Source order is child20, child10
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child20, child10},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// Q. multiple cousins for same node + same uncle
	runScenario("Q_multiple_cousins_same_node", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin1 := layoutgraph.NewNode(6, 5, 5)
		cousin2 := layoutgraph.NewNode(7, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin1.Container = uncle
		cousin2.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin1, CurrentTo: uncle},
			{OriginallyFrom: child, OriginallyTo: cousin2, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin1, cousin2},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// R. duplicate cousin pointers preserved
	runScenario("R_duplicate_cousins", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle},
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// S. cluster climb inside cousin ascent
	runScenario("S_cluster_climb", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		grandUncle := layoutgraph.NewNode(600, 30, 30)
		grandUncle.SetContainer(true)

		vessel := layoutgraph.NewNode(60, 10, 10)
		vessel.Container = grandUncle
		vessel.SetContainer(true)

		cousinNode := layoutgraph.NewNode(6, 5, 5)
		cousinNode.Cluster = &layoutgraph.Cluster{Vessel: vessel}
		// cousinNode has Container = subUncle
		subUncle := layoutgraph.NewNode(50, 10, 10)
		subUncle.SetContainer(true)
		cousinNode.Container = subUncle

		// CurrentTo is grandUncle
		// cousin.OwningContainer() != grandUncle -> true
		// cousin.Cluster != nil -> cousin = cousin.Cluster.Vessel = vessel
		// next loop: vessel.OwningContainer() == grandUncle == CurrentTo -> stops!
		// uncle = vessel.OwningContainer() = grandUncle
		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousinNode, CurrentTo: grandUncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:  {child},
			grandUncle: {vessel},
		}
		container.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// T. sequence climb inside cousin ascent
	runScenario("T_sequence_climb", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		grandUncle := layoutgraph.NewNode(600, 30, 30)
		grandUncle.SetContainer(true)

		vessel := layoutgraph.NewNode(60, 10, 10)
		vessel.Container = grandUncle
		vessel.SetContainer(true)

		cousinNode := layoutgraph.NewNode(6, 5, 5)
		cousinNode.Sequence = &layoutgraph.Sequence{Vessel: vessel, Nodes: []*layoutgraph.Node{cousinNode}}
		subUncle := layoutgraph.NewNode(50, 10, 10)
		subUncle.SetContainer(true)
		cousinNode.Container = subUncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousinNode, CurrentTo: grandUncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:  {child},
			grandUncle: {vessel},
		}
		container.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// U. direct OwningContainer climb
	runScenario("U_direct_owning_container_climb", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		grandUncle := layoutgraph.NewNode(600, 30, 30)
		grandUncle.SetContainer(true)

		uncle := layoutgraph.NewNode(60, 10, 10)
		uncle.Container = grandUncle
		uncle.SetContainer(true)

		cousin := layoutgraph.NewNode(6, 5, 5)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: grandUncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container:  {child},
			uncle:      {cousin},
			grandUncle: {uncle},
		}
		container.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// V. nil abduction with root child -> error "herding has a nil edge abduction"
	runScenario("V_nil_abduction_with_child", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
		}
		container.SetContainer(true)
		return context.Background(), g, container, []*layoutgraph.EdgeAbduction{nil}
	})

	// W. nil abduction with NO root children -> no error, empty maps
	runScenario("W_nil_abduction_no_children", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {},
		}
		container.SetContainer(true)
		return context.Background(), g, container, []*layoutgraph.EdgeAbduction{nil}
	})

	// X. pre-cancelled context with root child -> AssignHerds: context canceled
	runScenario("X_precanceled_with_child", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
		}
		container.SetContainer(true)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		return ctx, g, container, nil
	})

	// Y. pre-cancelled context with NO root children -> no error, empty maps
	runScenario("Y_precanceled_no_children", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {},
		}
		container.SetContainer(true)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		return ctx, g, container, nil
	})

	// Z. cancellation during abduction scan
	runScenario("Z_cancellation_during_abduction_scan", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		cousin1 := layoutgraph.NewNode(6, 5, 5)
		cousin2 := layoutgraph.NewNode(7, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin1.Container = uncle
		cousin2.Container = uncle

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin1, cousin2},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)

		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin1, CurrentTo: uncle},
			{OriginallyFrom: child, OriginallyTo: cousin2, CurrentTo: uncle},
		}

		// cancelAt = 3:
		// count 1: child 0
		// count 2: abduction 0
		// count 3: abduction 1 -> canceled!
		ctx := &stepCancelContext{
			Context:  context.Background(),
			cancelAt: 3,
		}
		return ctx, g, container, abductions
	})

	// AA. cancellation check still occurs before used[i] skip
	runScenario("AA_cancellation_before_used", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child1 := layoutgraph.NewNode(1, 5, 5)
		child2 := layoutgraph.NewNode(2, 5, 5)
		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child1, child2},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)

		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: uncle},
		}

		// count 1: child1
		// count 2: abduction 0 (used becomes true)
		// count 3: child2
		// count 4: abduction 0 (which is used[0] == true) -> canceled before used[i] skip!
		ctx := &stepCancelContext{
			Context:  context.Background(),
			cancelAt: 4,
		}
		return ctx, g, container, abductions
	})

	// AB. nil graph -> natural panic
	runScenario("AB_nil_graph", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		root := layoutgraph.NewNode(1, 10, 10)
		return context.Background(), nil, root, nil
	})

	// AC. graph.Containers nil where representable -> safe empty result
	runScenario("AC_nil_containers", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := &layoutgraph.Graph{}
		root := layoutgraph.NewNode(1, 10, 10)
		return context.Background(), g, root, nil
	})

	// AD. root == nil -> exercise graph.Containers[nil]
	runScenario("AD_nil_root", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		child := layoutgraph.NewNode(1, 5, 5)
		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			nil:   {child},
			uncle: {cousin},
		}
		uncle.SetContainer(true)

		abductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle},
		}
		return context.Background(), g, nil, abductions
	})

	// AE. repeated call scenario (canonical)
	runScenario("AE_repeated_call", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container

		cousin := layoutgraph.NewNode(6, 5, 5)
		uncle := layoutgraph.NewNode(60, 10, 10)
		cousin.Container = uncle

		edgeAbductions := []*layoutgraph.EdgeAbduction{
			{OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle},
		}

		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
			uncle:     {cousin},
		}
		container.SetContainer(true)
		uncle.SetContainer(true)
		return context.Background(), g, container, edgeAbductions
	})

	// AF. nil context with root child -> natural panic on ctx.Err()
	runScenario("AF_nil_context_with_child", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		child := layoutgraph.NewNode(1, 5, 5)
		child.Container = container
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {child},
		}
		container.SetContainer(true)
		return nil, g, container, nil
	})

	// AG. nil context with no root children -> succeeds with empty maps (ctx.Err() never reached)
	runScenario("AG_nil_context_no_children", func() (context.Context, *layoutgraph.Graph, *layoutgraph.Node, []*layoutgraph.EdgeAbduction) {
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(0, 1000, 1000)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			container: {},
		}
		container.SetContainer(true)
		return nil, g, container, nil
	})

	outBytes, _ := json.MarshalIndent(out, "", "  ")

	targetPath := "go-group-sheep-reference.json"
	targetDir := filepath.Join(".", "test", "fixtures")
	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		targetDir = filepath.Join("d2layouts", "d2talalayout", "js", "test", "fixtures")
	}
	dest := filepath.Join(targetDir, targetPath)
	err := os.WriteFile(dest, outBytes, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error writing fixture: %v\n", err)
		os.Exit(1)
	}

	keys := make([]string, 0, len(out.Scenarios))
	for k := range out.Scenarios {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("Successfully generated %d scenarios into %s\n", len(keys), dest)
	for _, k := range keys {
		s := out.Scenarios[k]
		if s.Panic != "" {
			fmt.Printf("  %s: panic (%s)\n", k, s.Panic)
		} else if !s.Success {
			fmt.Printf("  %s: error (%s)\n", k, s.ErrorMessage)
		} else {
			fmt.Printf("  %s: success (%d uncles)\n", k, len(s.ByUncle))
		}
	}
}
