//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/placement"
)

type ScenarioResult struct {
	Success bool     `json:"success"`
	Panic   string   `json:"panic,omitempty"`
	Error   string   `json:"error,omitempty"`
	Checks  int      `json:"checks"`
	Ordered []string `json:"ordered"`
}

type Output struct {
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type countingContext struct {
	context.Context
	cancelAt int
	checks   int
}

func (c *countingContext) Err() error {
	c.checks++
	if c.cancelAt > 0 && c.checks >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func runScenario(
	cancelAt int,
	setup func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string),
) (res ScenarioResult) {
	defer func() {
		if r := recover(); r != nil {
			res.Success = false
			res.Panic = fmt.Sprintf("%v", r)
		}
	}()

	nodes, abductions, nodeLabels := setup()

	ctx := &countingContext{
		Context:  context.Background(),
		cancelAt: cancelAt,
	}

	ordered, err := placement.PlaceChildrenOrder(ctx, nodes, abductions)
	res.Checks = ctx.checks

	if err != nil {
		res.Success = false
		res.Error = err.Error()
		return res
	}

	res.Success = true
	res.Ordered = make([]string, len(ordered))
	for i, n := range ordered {
		if label, ok := nodeLabels[n]; ok {
			res.Ordered[i] = label
		} else if n != nil {
			res.Ordered[i] = n.DebugID()
		} else {
			res.Ordered[i] = "nil"
		}
	}
	return res
}

func main() {
	out := Output{
		Scenarios: make(map[string]ScenarioResult),
	}

	// A. nil nodes + nil abductions -> []
	out.Scenarios["A_nil_nodes_nil_abductions"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		return nil, nil, nil
	})

	// B. empty nodes -> []
	out.Scenarios["B_empty_nodes"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		return []*layoutgraph.Node{}, []*layoutgraph.EdgeAbduction{}, nil
	})

	// C. one isolated child
	out.Scenarios["C_one_isolated_child"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// D. multiple isolated children preserve input order
	out.Scenarios["D_multiple_isolated_children"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		return []*layoutgraph.Node{a, b, c}, nil, map[*layoutgraph.Node]string{a: "a", b: "b", c: "c"}
	})

	// E. upstream: [a,b,c,d], edges: b-c, c-d, d-external -> [a,b,c,d]
	out.Scenarios["E_upstream_fixture"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		d := layoutgraph.NewNode(4, 10, 10)
		ext := layoutgraph.NewNode(5, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b", c: "c", d: "d", ext: "ext"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: b, CurrentTo: c},
			{CurrentFrom: c, CurrentTo: d},
			{CurrentFrom: d, CurrentTo: ext},
		}
		return []*layoutgraph.Node{a, b, c, d}, abductions, labels
	})

	// F. isolated child occurring LAST in source still appears before connected component
	out.Scenarios["F_isolated_child_last"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		a := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b", c: "c"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: b, CurrentTo: c},
		}
		return []*layoutgraph.Node{b, c, a}, abductions, labels
	})

	// G. two-node connected pair
	out.Scenarios["G_two_node_connected"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, labels
	})

	// H. three-node chain
	out.Scenarios["H_three_node_chain"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b", c: "c"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: b, CurrentTo: c},
		}
		return []*layoutgraph.Node{a, b, c}, abductions, labels
	})

	// I. four-node chain
	out.Scenarios["I_four_node_chain"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		d := layoutgraph.NewNode(4, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b", c: "c", d: "d"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: b, CurrentTo: c},
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: c, CurrentTo: d},
		}
		return []*layoutgraph.Node{a, b, c, d}, abductions, labels
	})

	// J. star graph, abduction ordering #1
	out.Scenarios["J_star_graph_abduction_order_1"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		center := layoutgraph.NewNode(1, 10, 10)
		leaf1 := layoutgraph.NewNode(2, 10, 10)
		leaf2 := layoutgraph.NewNode(3, 10, 10)
		leaf3 := layoutgraph.NewNode(4, 10, 10)
		labels := map[*layoutgraph.Node]string{center: "center", leaf1: "leaf1", leaf2: "leaf2", leaf3: "leaf3"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: center, CurrentTo: leaf1},
			{CurrentFrom: center, CurrentTo: leaf2},
			{CurrentFrom: center, CurrentTo: leaf3},
		}
		return []*layoutgraph.Node{center, leaf1, leaf2, leaf3}, abductions, labels
	})

	// K. same star, reordered edgeAbductions changes BFS order
	out.Scenarios["K_star_graph_abduction_order_2"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		center := layoutgraph.NewNode(1, 10, 10)
		leaf1 := layoutgraph.NewNode(2, 10, 10)
		leaf2 := layoutgraph.NewNode(3, 10, 10)
		leaf3 := layoutgraph.NewNode(4, 10, 10)
		labels := map[*layoutgraph.Node]string{center: "center", leaf1: "leaf1", leaf2: "leaf2", leaf3: "leaf3"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: center, CurrentTo: leaf3},
			{CurrentFrom: center, CurrentTo: leaf2},
			{CurrentFrom: center, CurrentTo: leaf1},
		}
		return []*layoutgraph.Node{center, leaf1, leaf2, leaf3}, abductions, labels
	})

	// L. cycle with equal degrees: start tie follows original node order
	out.Scenarios["L_cycle_equal_degrees"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b", c: "c"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: b, CurrentTo: c},
			{CurrentFrom: c, CurrentTo: a},
		}
		return []*layoutgraph.Node{a, b, c}, abductions, labels
	})

	// M. multiple connected components: lower-degree component selected before higher-degree component
	out.Scenarios["M_multiple_connected_components_degree"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		t1 := layoutgraph.NewNode(1, 10, 10)
		t2 := layoutgraph.NewNode(2, 10, 10)
		t3 := layoutgraph.NewNode(3, 10, 10)
		e1 := layoutgraph.NewNode(4, 10, 10)
		e2 := layoutgraph.NewNode(5, 10, 10)
		labels := map[*layoutgraph.Node]string{t1: "t1", t2: "t2", t3: "t3", e1: "e1", e2: "e2"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: t1, CurrentTo: t2},
			{CurrentFrom: t2, CurrentTo: t3},
			{CurrentFrom: t3, CurrentTo: t1},
			{CurrentFrom: e1, CurrentTo: e2},
		}
		return []*layoutgraph.Node{t1, t2, t3, e1, e2}, abductions, labels
	})

	// N. component degree tie: source order breaks tie
	out.Scenarios["N_component_degree_tie"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		b1 := layoutgraph.NewNode(1, 10, 10)
		b2 := layoutgraph.NewNode(2, 10, 10)
		a1 := layoutgraph.NewNode(3, 10, 10)
		a2 := layoutgraph.NewNode(4, 10, 10)
		labels := map[*layoutgraph.Node]string{b1: "b1", b2: "b2", a1: "a1", a2: "a2"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: b1, CurrentTo: b2},
			{CurrentFrom: a1, CurrentTo: a2},
		}
		return []*layoutgraph.Node{b1, b2, a1, a2}, abductions, labels
	})

	// O. duplicate abductions: degree remains unique Set cardinality
	out.Scenarios["O_duplicate_abductions_degree"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, labels
	})

	// P. duplicate abductions: output stable despite duplicate queue entries
	out.Scenarios["P_duplicate_abductions_output_stable"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, labels
	})

	// Q. self-loop: node is not initially isolated
	out.Scenarios["Q_self_loop_not_isolated"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: a},
		}
		return []*layoutgraph.Node{a}, abductions, labels
	})

	// R. self-loop plus isolated node: isolated node comes first
	out.Scenarios["R_self_loop_plus_isolated"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		loopNode := layoutgraph.NewNode(1, 10, 10)
		isoNode := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{loopNode: "loopNode", isoNode: "isoNode"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: loopNode, CurrentTo: loopNode},
		}
		return []*layoutgraph.Node{loopNode, isoNode}, abductions, labels
	})

	// S. external endpoint ignored
	out.Scenarios["S_external_endpoint_ignored"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		ext := layoutgraph.NewNode(3, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: ext},
		}
		return []*layoutgraph.Node{a, b}, abductions, labels
	})

	// T. CurrentFrom nil ignored
	out.Scenarios["T_current_from_nil_ignored"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: nil, CurrentTo: a},
		}
		return []*layoutgraph.Node{a}, abductions, labels
	})

	// U. CurrentTo nil ignored
	out.Scenarios["U_current_to_nil_ignored"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: nil},
		}
		return []*layoutgraph.Node{a}, abductions, labels
	})

	// V. both endpoints nil ignored
	out.Scenarios["V_both_endpoints_nil_ignored"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: nil, CurrentTo: nil},
		}
		return []*layoutgraph.Node{a}, abductions, labels
	})

	// W. reversed abduction direction gives symmetric connectivity
	out.Scenarios["W_reversed_abduction_symmetric"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: b, CurrentTo: a},
		}
		return []*layoutgraph.Node{a, b}, abductions, labels
	})

	// X. distinct nodes with same ID remain distinct
	out.Scenarios["X_distinct_nodes_same_id"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a1 := layoutgraph.NewNode(5, 10, 10)
		a2 := layoutgraph.NewNode(5, 10, 10)
		labels := map[*layoutgraph.Node]string{a1: "a1", a2: "a2"}
		return []*layoutgraph.Node{a1, a2}, nil, labels
	})

	// Y. IDs deliberately scrambled: ordering not ID-sorted
	out.Scenarios["Y_scrambled_ids_not_id_sorted"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		n99 := layoutgraph.NewNode(99, 10, 10)
		n10 := layoutgraph.NewNode(10, 10, 10)
		n50 := layoutgraph.NewNode(50, 10, 10)
		n1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{n99: "n99", n10: "n10", n50: "n50", n1: "n1"}
		return []*layoutgraph.Node{n99, n10, n50, n1}, nil, labels
	})

	// Z. nil child exact invariant
	out.Scenarios["Z_nil_child_invariant"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a, nil}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// AA. duplicate child exact invariant
	out.Scenarios["AA_duplicate_child_invariant"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		d2id := "dupNode"
		a := layoutgraph.NewNode(1, 10, 10)
		a.D2ID = &d2id
		return []*layoutgraph.Node{a, a}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// AB. nil edge abduction exact invariant
	out.Scenarios["AB_nil_edge_abduction_invariant"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, []*layoutgraph.EdgeAbduction{nil}, map[*layoutgraph.Node]string{a: "a"}
	})

	// AC. cancellation before work
	out.Scenarios["AC_cancellation_before_work"] = runScenario(1, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// AD. cancellation during initial node scan
	out.Scenarios["AD_cancellation_during_initial_node_scan"] = runScenario(2, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		return []*layoutgraph.Node{a, b}, nil, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AE. cancellation wins over nil-child validation
	out.Scenarios["AE_cancellation_wins_over_nil_child"] = runScenario(2, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		return []*layoutgraph.Node{nil}, nil, nil
	})

	// AF. cancellation during abduction build scan
	out.Scenarios["AF_cancellation_during_abduction_scan"] = runScenario(3, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: a},
		}
		return []*layoutgraph.Node{a}, abductions, map[*layoutgraph.Node]string{a: "a"}
	})

	// AG. cancellation wins over nil-abduction validation
	out.Scenarios["AG_cancellation_wins_over_nil_abduction"] = runScenario(3, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, []*layoutgraph.EdgeAbduction{nil}, map[*layoutgraph.Node]string{a: "a"}
	})

	// AH. cancellation during isolated-node scan
	out.Scenarios["AH_cancellation_during_isolated_scan"] = runScenario(3, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// AI. cancellation at outer connected-component check
	out.Scenarios["AI_cancellation_at_outer_component_check"] = runScenario(6, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AJ. cancellation on first BFS queue item
	out.Scenarios["AJ_cancellation_on_first_bfs_queue_item"] = runScenario(7, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AK. cancellation on later BFS queue item
	out.Scenarios["AK_cancellation_on_later_bfs_queue_item"] = runScenario(8, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AL. cancellation on duplicate/revisited queue item
	out.Scenarios["AL_cancellation_on_duplicate_queue_item"] = runScenario(9, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AM. cancellation at FINAL ctx.Err after complete local order
	out.Scenarios["AM_cancellation_at_final_check"] = runScenario(10, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AN. empty nodes exact successful check count
	out.Scenarios["AN_empty_nodes_exact_checks"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		return []*layoutgraph.Node{}, nil, nil
	})

	// AO. one isolated node exact successful check count
	out.Scenarios["AO_one_isolated_node_exact_checks"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		return []*layoutgraph.Node{a}, nil, map[*layoutgraph.Node]string{a: "a"}
	})

	// AP. connected two-node exact successful check count
	out.Scenarios["AP_connected_two_node_exact_checks"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AQ. repeated invocation deterministic
	out.Scenarios["AQ_repeated_invocation_deterministic"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		c := layoutgraph.NewNode(3, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
			{CurrentFrom: b, CurrentTo: c},
		}
		return []*layoutgraph.Node{a, b, c}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b", c: "c"}
	})

	// AR. input arrays unchanged
	out.Scenarios["AR_input_arrays_unchanged"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{CurrentFrom: a, CurrentTo: b},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// AS. OriginalFrom/OriginallyTo/Edge fields do not affect ordering
	out.Scenarios["AS_metadata_fields_do_not_affect_ordering"] = runScenario(0, func() ([]*layoutgraph.Node, []*layoutgraph.EdgeAbduction, map[*layoutgraph.Node]string) {
		a := layoutgraph.NewNode(1, 10, 10)
		b := layoutgraph.NewNode(2, 10, 10)
		dummy := layoutgraph.NewNode(99, 10, 10)
		abductions := []*layoutgraph.EdgeAbduction{
			{
				CurrentFrom:    a,
				CurrentTo:      b,
				OriginallyFrom: dummy,
				OriginallyTo:   dummy,
			},
		}
		return []*layoutgraph.Node{a, b}, abductions, map[*layoutgraph.Node]string{a: "a", b: "b"}
	})

	// Serialize and write
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal error: %v\n", err)
		os.Exit(1)
	}

	outPath := filepath.Join(".", "go-place-children-order-reference.json")
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Wrote %s\n", outPath)
}
