package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
	"github.com/d2lang/d2/lib/geo"
)

type NodeState struct {
	ID                     int64   `json:"id"`
	HasAssignment          bool    `json:"hasAssignment"`
	Orientation            string  `json:"orientation,omitempty"`
	OrientationInt         int     `json:"orientationInt,omitempty"`
	Val                    float64 `json:"val,omitempty"`
	SameSidePairCount      int     `json:"sameSidePairCount,omitempty"`
	OppositeSidePairCount  int     `json:"oppositeSidePairCount,omitempty"`
}

type ApplyVirallyResult struct {
	Success    bool                 `json:"success"`
	Panic      string               `json:"panic,omitempty"`
	Error      string               `json:"error,omitempty"`
	NodeStates map[string]NodeState `json:"nodeStates,omitempty"`
}

type Output struct {
	Scenarios map[string]ApplyVirallyResult `json:"scenarios"`
}

func strPtr(s string) *string {
	return &s
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

func main() {
	out := Output{
		Scenarios: make(map[string]ApplyVirallyResult),
	}

	runScenario := func(name string, fn func() (map[string]*layoutgraph.Node, error)) {
		var nodes map[string]*layoutgraph.Node
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = ApplyVirallyResult{
					Success:    false,
					Panic:      fmt.Sprintf("%v", r),
					NodeStates: captureNodeStates(nodes),
				}
			}
		}()

		trackedNodes, err := fn()
		nodes = trackedNodes

		if err != nil {
			out.Scenarios[name] = ApplyVirallyResult{
				Success:    false,
				Error:      err.Error(),
				NodeStates: captureNodeStates(nodes),
			}
		} else {
			out.Scenarios[name] = ApplyVirallyResult{
				Success:    true,
				NodeStates: captureNodeStates(nodes),
			}
		}
	}

	// A. empty herdOrder
	runScenario("A_empty_herd_order", func() (map[string]*layoutgraph.Node, error) {
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
		return nil, err
	})

	// B. nil herdOrder
	runScenario("B_nil_herd_order", func() (map[string]*layoutgraph.Node, error) {
		err := proximity.ApplyVirally(context.Background(), nil, make(map[*layoutgraph.Node][]*layoutgraph.Node))
		return nil, err
	})

	// C. pre-cancelled + empty herdOrder
	runScenario("C_precanceled_empty_order", func() (map[string]*layoutgraph.Node, error) {
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 0}
		err := proximity.ApplyVirally(ctx, []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
		return nil, err
	})

	// D. nil context + empty herdOrder
	runScenario("D_nil_context_empty_order", func() (map[string]*layoutgraph.Node, error) {
		err := proximity.ApplyVirally(nil, []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
		return nil, err
	})

	// E. nil herds map + one uncle
	runScenario("E_nil_herds_map_one_uncle", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, nil)
		return map[string]*layoutgraph.Node{"uncle": uncle}, err
	})

	// F. missing uncle key
	runScenario("F_missing_uncle_key", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		herds := make(map[*layoutgraph.Node][]*layoutgraph.Node)
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"uncle": uncle}, err
	})

	// G. nil uncle missing key
	runScenario("G_nil_uncle_missing_key", func() (map[string]*layoutgraph.Node, error) {
		herds := make(map[*layoutgraph.Node][]*layoutgraph.Node)
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{nil}, herds)
		return nil, err
	})

	// H. all nodes nil HerdAssignment
	runScenario("H_all_nodes_nil_assignment", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// I. all nodes Orientation.NONE
	runScenario("I_all_nodes_none_assignment", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.NONE
		b := layoutgraph.NewNode(3, 10, 10)
		b.HerdAssignment = layoutgraph.NewHerdAssignment()
		b.HerdAssignment.Orientation = geo.NONE
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// J. mixed nil + NONE, no known source
	runScenario("J_mixed_nil_and_none", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10) // nil
		b := layoutgraph.NewNode(3, 10, 10)
		b.HerdAssignment = layoutgraph.NewHerdAssignment()
		b.HerdAssignment.Orientation = geo.NONE
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// K. simple propagation
	runScenario("K_simple_propagation", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(3, 10, 10) // nil
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// L. propagation copies Val
	runScenario("L_propagation_copies_val", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Top
		a.HerdAssignment.Val = 123.456
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// M. propagation copies same-side pair set
	runScenario("M_propagation_copies_same_side_pairs", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		pairedNode := layoutgraph.NewNode(99, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Bottom
		a.HerdAssignment.PairSameSide(pairedNode)
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// N. propagation copies opposite-side pair set
	runScenario("N_propagation_copies_opposite_side_pairs", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		oppNode := layoutgraph.NewNode(98, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Right
		a.HerdAssignment.PairOppositeSide(oppNode)
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// O. two nil targets get independent copies
	runScenario("O_two_nil_targets_get_independent_copies", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(3, 10, 10)
		c := layoutgraph.NewNode(4, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b, c},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b, "c": c}, err
	})

	// P. existing same-orientation assignment unchanged
	runScenario("P_existing_same_orientation_unchanged", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		a.HerdAssignment.Val = 100
		b := layoutgraph.NewNode(3, 10, 10)
		b.HerdAssignment = layoutgraph.NewHerdAssignment()
		b.HerdAssignment.Orientation = geo.Left
		b.HerdAssignment.Val = 200 // should remain 200
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// Q. existing NONE assignment remains NONE
	runScenario("Q_existing_none_remains_none", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(3, 10, 10)
		b.HerdAssignment = layoutgraph.NewHerdAssignment()
		b.HerdAssignment.Orientation = geo.NONE // should remain NONE
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// R. default new HerdAssignment / TopLeft acts as source
	runScenario("R_default_new_assignment_topleft_source", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment() // defaults to TopLeft (0)
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// S. diagonal known orientation propagates
	runScenario("S_diagonal_known_orientation", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.TopRight
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// T. unknown non-NONE orientation integer propagates
	runScenario("T_unknown_orientation_int", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Orientation(99)
		b := layoutgraph.NewNode(3, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// U. direct conflicting orientations
	runScenario("U_direct_conflicting_orientations", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		left := layoutgraph.NewNode(2, 10, 10)
		left.HerdAssignment = layoutgraph.NewHerdAssignment()
		left.HerdAssignment.Orientation = geo.Left
		right := layoutgraph.NewNode(3, 10, 10)
		right.HerdAssignment = layoutgraph.NewHerdAssignment()
		right.HerdAssignment.Orientation = geo.Right
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {left, right},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"left": left, "right": right}, err
	})

	// V. conflict uses D2ID
	runScenario("V_conflict_uses_d2id", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		left := layoutgraph.NewNode(2, 10, 10)
		left.HerdAssignment = layoutgraph.NewHerdAssignment()
		left.HerdAssignment.Orientation = geo.Left
		right := layoutgraph.NewNode(3, 10, 10)
		right.D2ID = strPtr("conflict.node")
		right.HerdAssignment = layoutgraph.NewHerdAssignment()
		right.HerdAssignment.Orientation = geo.Right
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {left, right},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"left": left, "right": right}, err
	})

	// W. reversed conflicting node order
	runScenario("W_reversed_conflicting_node_order", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		right := layoutgraph.NewNode(3, 10, 10)
		right.HerdAssignment = layoutgraph.NewHerdAssignment()
		right.HerdAssignment.Orientation = geo.Right
		left := layoutgraph.NewNode(2, 10, 10)
		left.HerdAssignment = layoutgraph.NewHerdAssignment()
		left.HerdAssignment.Orientation = geo.Left
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {right, left},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"left": left, "right": right}, err
	})

	// X. nil target BEFORE later conflict (partial mutation)
	runScenario("X_nil_target_before_later_conflict", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		nilTarget := layoutgraph.NewNode(10, 10, 10) // nil
		left := layoutgraph.NewNode(20, 10, 10)
		left.HerdAssignment = layoutgraph.NewHerdAssignment()
		left.HerdAssignment.Orientation = geo.Left
		right := layoutgraph.NewNode(30, 10, 10)
		right.HerdAssignment = layoutgraph.NewHerdAssignment()
		right.HerdAssignment.Orientation = geo.Right
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {nilTarget, left, right},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"nilTarget": nilTarget, "left": left, "right": right}, err
	})

	// Y. two groups; first mutates, cancellation before second
	runScenario("Y_partial_mutation_before_cancellation", func() (map[string]*layoutgraph.Node, error) {
		u1 := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(3, 10, 10) // nil

		u2 := layoutgraph.NewNode(4, 10, 10)
		c := layoutgraph.NewNode(5, 10, 10)
		c.HerdAssignment = layoutgraph.NewHerdAssignment()
		c.HerdAssignment.Orientation = geo.Right
		d := layoutgraph.NewNode(6, 10, 10) // nil

		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, b},
			u2: {c, d},
		}

		// pass 1 top check (remaining: 2 -> 1)
		// u1 check (remaining: 1 -> 0)
		// u2 check (remaining: 0 -> cancel!)
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 2}
		err := proximity.ApplyVirally(ctx, []*layoutgraph.Node{u1, u2}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b, "c": c, "d": d}, err
	})

	// Z. cancellation after successful propagation before stability pass
	runScenario("Z_cancellation_after_propagation_before_stability", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(2, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(3, 10, 10) // nil

		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}

		// pass 1 top check (2 -> 1)
		// uncle check (1 -> 0)
		// pass 2 top check (0 -> cancel!)
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 2}
		err := proximity.ApplyVirally(ctx, []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// AA. chained virality requiring multiple passes (reverse order: [u2, u1])
	runScenario("AA_chained_virality_multiple_passes", func() (map[string]*layoutgraph.Node, error) {
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)

		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(20, 10, 10) // nil
		c := layoutgraph.NewNode(30, 10, 10) // nil

		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, b},
			u2: {b, c},
		}

		// Order: [u2, u1]
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{u2, u1}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b, "c": c}, err
	})

	// AB. same-pass chaining with order [u1, u2]
	runScenario("AB_same_pass_chaining", func() (map[string]*layoutgraph.Node, error) {
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)

		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(20, 10, 10) // nil
		c := layoutgraph.NewNode(30, 10, 10) // nil

		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, b},
			u2: {b, c},
		}

		// Order: [u1, u2]
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b, "c": c}, err
	})

	// AC. group with nil node member
	runScenario("AC_group_with_nil_node", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {nil},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return nil, err
	})

	// AD. null uncle key present in herds
	runScenario("AD_null_uncle_key_present", func() (map[string]*layoutgraph.Node, error) {
		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Top
		b := layoutgraph.NewNode(20, 10, 10)

		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			nil: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{nil}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// AE. duplicate uncle in herdOrder
	runScenario("AE_duplicate_uncle_in_order", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Bottom
		b := layoutgraph.NewNode(20, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle, uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// AF. duplicate node in a herd group
	runScenario("AF_duplicate_node_in_herd", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Left
		b := layoutgraph.NewNode(20, 10, 10) // nil, appears twice
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b, b},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// AG. empty node slice for uncle
	runScenario("AG_empty_node_slice_for_uncle", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {},
		}
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return nil, err
	})

	// AH. repeated invocation on already-stable result
	runScenario("AH_repeated_invocation_stable", func() (map[string]*layoutgraph.Node, error) {
		uncle := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		a.HerdAssignment = layoutgraph.NewHerdAssignment()
		a.HerdAssignment.Orientation = geo.Right
		b := layoutgraph.NewNode(20, 10, 10)
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			uncle: {a, b},
		}
		_ = proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		err := proximity.ApplyVirally(context.Background(), []*layoutgraph.Node{uncle}, herds)
		return map[string]*layoutgraph.Node{"a": a, "b": b}, err
	})

	// Output serialization
	keys := make([]string, 0, len(out.Scenarios))
	for k := range out.Scenarios {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal failed: %v\n", err)
		os.Exit(1)
	}

	targetPath := filepath.Join("test", "fixtures", "go-apply-virally-reference.json")
	if err := os.WriteFile(targetPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write file failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Wrote %d scenarios to %s\n", len(out.Scenarios), targetPath)
}
