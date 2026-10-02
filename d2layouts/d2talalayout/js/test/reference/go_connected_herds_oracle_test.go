package proximity

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
)

type ComponentOutput struct {
	Nodes  []*string `json:"nodes"`
	Uncles []*string `json:"uncles"`
}

type ConnectedHerdsResult struct {
	Success    bool              `json:"success"`
	Panic      string            `json:"panic,omitempty"`
	Error      string            `json:"error,omitempty"`
	Components []ComponentOutput `json:"components"`
}

type OracleOutput struct {
	Scenarios map[string]ConnectedHerdsResult `json:"scenarios"`
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

func strPtr(s string) *string {
	return &s
}

func serializeComponents(comps []herdComponent, labels map[*layoutgraph.Node]string) []ComponentOutput {
	if comps == nil {
		return nil
	}

	result := make([]ComponentOutput, 0, len(comps))
	for _, c := range comps {
		out := ComponentOutput{}

		if c.uncles == nil {
			out.Uncles = nil
		} else {
			out.Uncles = make([]*string, 0, len(c.uncles))
			for _, u := range c.uncles {
				if u == nil {
					out.Uncles = append(out.Uncles, nil)
				} else {
					lbl, ok := labels[u]
					if !ok || lbl == "" {
						lbl = fmt.Sprintf("node_%d", u.ID)
					}
					out.Uncles = append(out.Uncles, strPtr(lbl))
				}
			}
		}

		if c.nodes == nil {
			out.Nodes = nil
		} else {
			out.Nodes = make([]*string, 0, len(c.nodes))
			for _, n := range c.nodes {
				if n == nil {
					out.Nodes = append(out.Nodes, nil)
				} else {
					lbl, ok := labels[n]
					if !ok || lbl == "" {
						lbl = fmt.Sprintf("node_%d", n.ID)
					}
					out.Nodes = append(out.Nodes, strPtr(lbl))
				}
			}
		}

		result = append(result, out)
	}

	return result
}

func TestGenerateConnectedHerdsOracle(t *testing.T) {
	out := OracleOutput{
		Scenarios: make(map[string]ConnectedHerdsResult),
	}

	runScenario := func(name string, labels map[*layoutgraph.Node]string, fn func() ([]herdComponent, error)) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = ConnectedHerdsResult{
					Success:    false,
					Panic:      fmt.Sprintf("%v", r),
					Components: nil,
				}
			}
		}()

		comps, err := fn()
		if err != nil {
			out.Scenarios[name] = ConnectedHerdsResult{
				Success:    false,
				Error:      err.Error(),
				Components: serializeComponents(comps, labels),
			}
		} else {
			out.Scenarios[name] = ConnectedHerdsResult{
				Success:    true,
				Components: serializeComponents(comps, labels),
			}
		}
	}

	// A. nil herdOrder
	runScenario("A_nil_herd_order", nil, func() ([]herdComponent, error) {
		return connectedHerds(context.Background(), nil, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// B. empty herdOrder
	runScenario("B_empty_herd_order", nil, func() ([]herdComponent, error) {
		return connectedHerds(context.Background(), []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// C. pre-cancelled + empty order
	runScenario("C_precanceled_empty_order", nil, func() ([]herdComponent, error) {
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 0}
		return connectedHerds(ctx, []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// D. nil context + empty order
	runScenario("D_nil_context_empty_order", nil, func() ([]herdComponent, error) {
		return connectedHerds(nil, []*layoutgraph.Node{}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// E. nil context + one uncle
	runScenario("E_nil_context_one_uncle", nil, func() ([]herdComponent, error) {
		u1 := layoutgraph.NewNode(1, 10, 10)
		return connectedHerds(nil, []*layoutgraph.Node{u1}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// F. pre-cancelled + one uncle
	runScenario("F_precanceled_one_uncle", nil, func() ([]herdComponent, error) {
		ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 0}
		u1 := layoutgraph.NewNode(1, 10, 10)
		return connectedHerds(ctx, []*layoutgraph.Node{u1}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
	})

	// G. one uncle / one node
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", a: "a"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{u1: {a}}
		runScenario("G_one_uncle_one_node", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// H. one uncle / zero nodes
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{u1: {}}
		runScenario("H_one_uncle_zero_nodes", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// I. nil herds map / one uncle
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1"}
		runScenario("I_nil_herds_map_one_uncle", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, nil)
		})
	}

	// J. missing map key
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1"}
		herds := make(map[*layoutgraph.Node][]*layoutgraph.Node)
		runScenario("J_missing_map_key", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// K. two disconnected uncles
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
			u2: {b},
		}
		runScenario("K_two_disconnected_uncles", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// L. two connected uncles via shared node
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		shared := layoutgraph.NewNode(99, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a", shared: "shared", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, shared},
			u2: {shared, b},
		}
		runScenario("L_two_connected_uncles_shared_node", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// M. transitive three-uncle connection
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		u3 := layoutgraph.NewNode(3, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		x := layoutgraph.NewNode(91, 10, 10)
		y := layoutgraph.NewNode(92, 10, 10)
		z := layoutgraph.NewNode(30, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", u3: "u3", a: "a", x: "x", y: "y", z: "z"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, x},
			u2: {x, y},
			u3: {y, z},
		}
		runScenario("M_transitive_three_uncle_connection", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2, u3}, herds)
		})
	}

	// N. source order versus ID order
	{
		u30 := layoutgraph.NewNode(30, 10, 10)
		u10 := layoutgraph.NewNode(10, 10, 10)
		u20 := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u30: "u30", u10: "u10", u20: "u20"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u30: {},
			u10: {},
			u20: {},
		}
		runScenario("N_source_order_vs_id_order", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u30, u10, u20}, herds)
		})
	}

	// O. node source order preserved
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		c := layoutgraph.NewNode(30, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", c: "c", a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {c, a, b},
		}
		runScenario("O_node_source_order_preserved", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// P. duplicate uncle in herdOrder
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", a: "a"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
		}
		runScenario("P_duplicate_uncle_in_herd_order", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u1}, herds)
		})
	}

	// Q. duplicate node in one herd
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, a, b},
		}
		runScenario("Q_duplicate_node_in_one_herd", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// R. duplicate node across connected herds
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, b},
			u2: {b, b},
		}
		runScenario("R_duplicate_node_across_connected_herds", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// S. null uncle missing key
	{
		runScenario("S_null_uncle_missing_key", nil, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{nil}, make(map[*layoutgraph.Node][]*layoutgraph.Node))
		})
	}

	// T. null uncle with nodes
	{
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			nil: {a, b},
		}
		runScenario("T_null_uncle_with_nodes", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{nil}, herds)
		})
	}

	// U. nil node member
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {nil},
		}
		runScenario("U_nil_node_member", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// V. nil node shared by two uncles
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {nil},
			u2: {nil},
		}
		runScenario("V_nil_node_shared_by_two_uncles", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// W. duplicate nil node within herd
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {nil, nil},
		}
		runScenario("W_duplicate_nil_node_within_herd", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// X. multiple disconnected components with empty trailing component
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
			u2: {},
		}
		runScenario("X_multiple_disconnected_with_empty_trailing", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// Y. first shared node discovers multiple related uncles
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		u3 := layoutgraph.NewNode(3, 10, 10)
		shared := layoutgraph.NewNode(99, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", u3: "u3", shared: "shared"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {shared},
			u2: {shared},
			u3: {shared},
		}
		runScenario("Y_first_shared_node_discovers_multiple_uncles", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2, u3}, herds)
		})
	}

	// Z. related uncle already seen (triangle)
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		u3 := layoutgraph.NewNode(3, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		c := layoutgraph.NewNode(30, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", u3: "u3", a: "a", b: "b", c: "c"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, c},
			u2: {a, b},
			u3: {b, c},
		}
		runScenario("Z_related_uncle_already_seen", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2, u3}, herds)
		})
	}

	// AA. duplicate herdOrder occurrences alter byNode duplicates but not component.uncles duplication
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
			u2: {a},
		}
		runScenario("AA_duplicate_herd_order_alter_by_node", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u1, u2}, herds)
		})
	}

	// AB. cancellation after first uncle expansion in a multi-uncle connected component
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		shared := layoutgraph.NewNode(99, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", shared: "shared"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {shared},
			u2: {shared},
		}
		runScenario("AB_cancellation_after_first_uncle_in_multi_uncle", labels, func() ([]herdComponent, error) {
			ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 1}
			return connectedHerds(ctx, []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// AC. cancellation between disconnected components
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", u2: "u2", a: "a", b: "b"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
			u2: {b},
		}
		runScenario("AC_cancellation_between_disconnected_components", labels, func() ([]herdComponent, error) {
			ctx := &cancelAfterErrChecks{Context: context.Background(), remaining: 1}
			return connectedHerds(ctx, []*layoutgraph.Node{u1, u2}, herds)
		})
	}

	// AD. repeated call
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		labels := map[*layoutgraph.Node]string{u1: "u1", a: "a"}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a},
		}
		runScenario("AD_repeated_call", labels, func() ([]herdComponent, error) {
			_, _ = connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1}, herds)
		})
	}

	// AE. discriminating FIFO topology (Section 40)
	{
		u1 := layoutgraph.NewNode(1, 10, 10)
		u2 := layoutgraph.NewNode(2, 10, 10)
		u3 := layoutgraph.NewNode(3, 10, 10)
		a := layoutgraph.NewNode(10, 10, 10)
		x := layoutgraph.NewNode(91, 10, 10)
		y := layoutgraph.NewNode(92, 10, 10)
		b := layoutgraph.NewNode(20, 10, 10)
		c := layoutgraph.NewNode(30, 10, 10)
		labels := map[*layoutgraph.Node]string{
			u1: "u1", u2: "u2", u3: "u3",
			a: "a", x: "x", y: "y", b: "b", c: "c",
		}
		herds := map[*layoutgraph.Node][]*layoutgraph.Node{
			u1: {a, x, y},
			u2: {x, b},
			u3: {y, c},
		}
		runScenario("AE_discriminating_fifo_topology", labels, func() ([]herdComponent, error) {
			return connectedHerds(context.Background(), []*layoutgraph.Node{u1, u2, u3}, herds)
		})
	}

	// Write oracle fixture JSON
	keys := make([]string, 0, len(out.Scenarios))
	for k := range out.Scenarios {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatalf("json marshal failed: %v", err)
	}

	// Write to js/test/fixtures/go-connected-herds-reference.json
	targetPath := filepath.Join("..", "..", "js", "test", "fixtures", "go-connected-herds-reference.json")
	if err := os.WriteFile(targetPath, data, 0644); err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	t.Logf("Wrote %d scenarios to %s", len(out.Scenarios), targetPath)
}
