//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
)

type DebugIDResult struct {
	Success bool    `json:"success"`
	Panic   string  `json:"panic,omitempty"`
	Output  *string `json:"output,omitempty"`
}

type Output struct {
	Scenarios map[string]DebugIDResult `json:"scenarios"`
}

func strPtr(s string) *string {
	return &s
}

func main() {
	out := Output{
		Scenarios: make(map[string]DebugIDResult),
	}

	runScenario := func(name string, fn func() string) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = DebugIDResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()

		result := fn()
		out.Scenarios[name] = DebugIDResult{
			Success: true,
			Output:  &result,
		}
	}

	// ==========================================
	// Section 22: Node.DebugID Scenarios
	// ==========================================

	// A. nil node
	runScenario("A_nil_node", func() string {
		var n *layoutgraph.Node = nil
		return n.DebugID()
	})

	// B. zero ID
	runScenario("B_zero_id", func() string {
		n := &layoutgraph.Node{ID: 0}
		return n.DebugID()
	})

	// C. positive ID
	runScenario("C_positive_id", func() string {
		n := &layoutgraph.Node{ID: 42}
		return n.DebugID()
	})

	// D. negative ID
	runScenario("D_negative_id", func() string {
		n := &layoutgraph.Node{ID: -42}
		return n.DebugID()
	})

	// E. INT64_MAX
	runScenario("E_int64_max", func() string {
		n := &layoutgraph.Node{ID: math.MaxInt64}
		return n.DebugID()
	})

	// F. INT64_MIN
	runScenario("F_int64_min", func() string {
		n := &layoutgraph.Node{ID: math.MinInt64}
		return n.DebugID()
	})

	// G. D2ID ordinary string
	runScenario("G_d2id_ordinary_string", func() string {
		n := &layoutgraph.Node{ID: 1, D2ID: strPtr("alpha.beta")}
		return n.DebugID()
	})

	// H. D2ID empty string
	runScenario("H_d2id_empty_string", func() string {
		n := &layoutgraph.Node{ID: 2, D2ID: strPtr("")}
		return n.DebugID()
	})

	// I. D2ID overrides cluster vessel
	runScenario("I_d2id_overrides_cluster_vessel", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 3, D2ID: strPtr("d2.wins"), Graph: g}
		n.SetClusterVessel(true)
		c := &layoutgraph.Cluster{
			Vessel:      n,
			Nodes:       []*layoutgraph.Node{{ID: 100}},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		g.Clusters[n] = c
		return n.DebugID()
	})

	// J. D2ID overrides sequence vessel
	runScenario("J_d2id_overrides_sequence_vessel", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 4, D2ID: strPtr("d2.seq.wins"), Graph: g}
		s := &layoutgraph.Sequence{
			Vessel: n,
			Nodes:  []*layoutgraph.Node{{ID: 200}},
		}
		g.Sequences[n] = s
		return n.DebugID()
	})

	// K. cluster vessel canonical
	runScenario("K_cluster_vessel_canonical", func() string {
		g := layoutgraph.NewGraph()
		vessel := &layoutgraph.Node{ID: 5, Graph: g}
		vessel.SetClusterVessel(true)
		c := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{{ID: 10}, {ID: 20}},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		g.Clusters[vessel] = c
		return vessel.DebugID()
	})

	// L. cluster vessel + Graph nil
	runScenario("L_cluster_vessel_nil_graph", func() string {
		n := &layoutgraph.Node{ID: 6}
		n.SetClusterVessel(true)
		return n.DebugID()
	})

	// M. cluster vessel + graph exists + missing cluster map entry
	runScenario("M_cluster_vessel_missing_cluster_entry", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 7, Graph: g}
		n.SetClusterVessel(true)
		return n.DebugID()
	})

	// N. cluster vessel AND sequence vessel
	runScenario("N_cluster_vessel_and_sequence_vessel", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 8, Graph: g}
		n.SetClusterVessel(true)
		c := &layoutgraph.Cluster{
			Vessel:      n,
			Nodes:       []*layoutgraph.Node{{ID: 11}},
			Arrangement: layoutgraph.ClusterArrangement("Column"),
		}
		s := &layoutgraph.Sequence{
			Vessel: n,
			Nodes:  []*layoutgraph.Node{{ID: 22}},
		}
		g.Clusters[n] = c
		g.Sequences[n] = s
		return n.DebugID()
	})

	// O. Graph nil non-cluster node
	runScenario("O_graph_nil_non_cluster_node", func() string {
		n := &layoutgraph.Node{ID: 9}
		return n.DebugID()
	})

	// P. Graph Sequences empty
	runScenario("P_graph_sequences_empty", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 10, Graph: g}
		return n.DebugID()
	})

	// Q. Graph Sequences non-empty but node absent
	runScenario("Q_graph_sequences_node_absent", func() string {
		g := layoutgraph.NewGraph()
		other := &layoutgraph.Node{ID: 99, Graph: g}
		s := &layoutgraph.Sequence{
			Vessel: other,
			Nodes:  []*layoutgraph.Node{{ID: 101}},
		}
		g.Sequences[other] = s

		n := &layoutgraph.Node{ID: 11, Graph: g}
		return n.DebugID()
	})

	// R. Graph Sequences contains node
	runScenario("R_graph_sequences_contains_node", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 12, Graph: g}
		s := &layoutgraph.Sequence{
			Vessel: n,
			Nodes:  []*layoutgraph.Node{{ID: 301}, {ID: 302}},
		}
		g.Sequences[n] = s
		return n.DebugID()
	})

	// S. Graph Sequences contains node mapped to nil
	runScenario("S_graph_sequences_contains_node_mapped_to_nil", func() string {
		g := layoutgraph.NewGraph()
		n := &layoutgraph.Node{ID: 13, Graph: g}
		g.Sequences[n] = nil
		return n.DebugID()
	})

	// ==========================================
	// Section 23: Cluster.DebugID Scenarios
	// ==========================================

	// T. empty cluster default arrangement
	runScenario("T_empty_cluster_default_arrangement", func() string {
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{},
			Arrangement: layoutgraph.ClusterArrangement(""),
		}
		return c.DebugID()
	})

	// U. empty Row cluster
	runScenario("U_empty_row_cluster", func() string {
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// V. empty Column cluster
	runScenario("V_empty_column_cluster", func() string {
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{},
			Arrangement: layoutgraph.ClusterArrangement("Column"),
		}
		return c.DebugID()
	})

	// W. one numeric member
	runScenario("W_one_numeric_member", func() string {
		c := &layoutgraph.Cluster{
			Nodes:       []*layoutgraph.Node{{ID: 1}},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// X. members preserve order (30, 10, 20)
	runScenario("X_members_preserve_order", func() string {
		c := &layoutgraph.Cluster{
			Nodes: []*layoutgraph.Node{
				{ID: 30},
				{ID: 10},
				{ID: 20},
			},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// Y. nil member
	runScenario("Y_nil_member", func() string {
		c := &layoutgraph.Cluster{
			Nodes: []*layoutgraph.Node{
				{ID: 1},
				nil,
				{ID: 2},
			},
			Arrangement: layoutgraph.ClusterArrangement("Column"),
		}
		return c.DebugID()
	})

	// Z. D2ID member
	runScenario("Z_d2id_member", func() string {
		c := &layoutgraph.Cluster{
			Nodes: []*layoutgraph.Node{
				{ID: 1, D2ID: strPtr("a.b")},
				{ID: 2},
			},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// AA. member is sequence vessel
	runScenario("AA_member_is_sequence_vessel", func() string {
		g := layoutgraph.NewGraph()
		seqVessel := &layoutgraph.Node{ID: 50, Graph: g}
		s := &layoutgraph.Sequence{
			Vessel: seqVessel,
			Nodes:  []*layoutgraph.Node{{ID: 51}, {ID: 52}},
		}
		g.Sequences[seqVessel] = s

		c := &layoutgraph.Cluster{
			Nodes: []*layoutgraph.Node{
				seqVessel,
				{ID: 99},
			},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// AB. nil cluster receiver
	runScenario("AB_nil_cluster_receiver", func() string {
		var c *layoutgraph.Cluster = nil
		return c.DebugID()
	})

	// ==========================================
	// Section 24: Sequence.DebugID Scenarios
	// ==========================================

	// AC. empty sequence
	runScenario("AC_empty_sequence", func() string {
		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{},
		}
		return s.DebugID()
	})

	// AD. one member
	runScenario("AD_one_member", func() string {
		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{{ID: 1}},
		}
		return s.DebugID()
	})

	// AE. ordered members
	runScenario("AE_ordered_members", func() string {
		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{
				{ID: 30},
				{ID: 10},
				{ID: 20},
			},
		}
		return s.DebugID()
	})

	// AF. nil member
	runScenario("AF_nil_member", func() string {
		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{
				{ID: 1},
				nil,
				{ID: 2},
			},
		}
		return s.DebugID()
	})

	// AG. D2ID member
	runScenario("AG_d2id_member", func() string {
		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{
				{ID: 1, D2ID: strPtr("a.b")},
				{ID: 2},
			},
		}
		return s.DebugID()
	})

	// AH. member is cluster vessel
	runScenario("AH_member_is_cluster_vessel", func() string {
		g := layoutgraph.NewGraph()
		clusterVessel := &layoutgraph.Node{ID: 60, Graph: g}
		clusterVessel.SetClusterVessel(true)
		c := &layoutgraph.Cluster{
			Vessel:      clusterVessel,
			Nodes:       []*layoutgraph.Node{{ID: 61}, {ID: 62}},
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		g.Clusters[clusterVessel] = c

		s := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{
				clusterVessel,
				{ID: 77},
			},
		}
		return s.DebugID()
	})

	// AI. nil sequence receiver
	runScenario("AI_nil_sequence_receiver", func() string {
		var s *layoutgraph.Sequence = nil
		return s.DebugID()
	})

	// ==========================================
	// Additional Scenarios: Nil Nodes Slice & Deep Nesting
	// ==========================================

	// AJ. cluster with nil Nodes slice
	runScenario("AJ_cluster_nil_nodes_slice", func() string {
		c := &layoutgraph.Cluster{
			Nodes:       nil,
			Arrangement: layoutgraph.ClusterArrangement("Row"),
		}
		return c.DebugID()
	})

	// AK. sequence with nil Nodes slice
	runScenario("AK_sequence_nil_nodes_slice", func() string {
		s := &layoutgraph.Sequence{
			Nodes: nil,
		}
		return s.DebugID()
	})

	// AL. deep nesting: sequence vessel of cluster vessel of sequence vessel
	runScenario("AL_nested_cluster_in_sequence_in_cluster", func() string {
		g := layoutgraph.NewGraph()
		leafSeqVessel := &layoutgraph.Node{ID: 80, Graph: g}
		s1 := &layoutgraph.Sequence{
			Vessel: leafSeqVessel,
			Nodes:  []*layoutgraph.Node{{ID: 81, D2ID: strPtr("deep.leaf")}},
		}
		g.Sequences[leafSeqVessel] = s1

		midClusterVessel := &layoutgraph.Node{ID: 90, Graph: g}
		midClusterVessel.SetClusterVessel(true)
		c1 := &layoutgraph.Cluster{
			Vessel:      midClusterVessel,
			Nodes:       []*layoutgraph.Node{leafSeqVessel},
			Arrangement: layoutgraph.ClusterArrangement("Column"),
		}
		g.Clusters[midClusterVessel] = c1

		outerSeq := &layoutgraph.Sequence{
			Nodes: []*layoutgraph.Node{midClusterVessel},
		}
		return outerSeq.DebugID()
	})

	// Serialize
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

	targetPath := filepath.Join("test", "fixtures", "go-debug-ids-reference.json")
	if err := os.WriteFile(targetPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write file failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Wrote %d scenarios to %s\n", len(out.Scenarios), targetPath)
}
