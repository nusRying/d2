//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
)

type Output struct {
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type ScenarioResult struct {
	Common map[string][]string `json:"common,omitempty"`
	Panic  string              `json:"panic,omitempty"`
}

func main() {
	out := Output{
		Scenarios: make(map[string]ScenarioResult),
	}

	runScenario := func(name string, setup func() (*layoutgraph.Graph, func())) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = ScenarioResult{
					Panic: fmt.Sprintf("%v", r),
				}
			}
		}()
		graph, _ := setup()
		commonMap := proximity.CommonUncleSiblings(graph)

		res := ScenarioResult{
			Common: make(map[string][]string),
		}
		for node, siblings := range commonMap {
			var sibs []string
			for _, s := range siblings {
				sibs = append(sibs, fmt.Sprintf("%v", s.ID))
			}
			res.Common[fmt.Sprintf("%v", node.ID)] = sibs
		}
		out.Scenarios[name] = res
	}

	// A. empty graph
	runScenario("A_empty_graph", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		return g, nil
	})

	// B. canonical largest-group case (3 children, 1 uncle)
	runScenario("B_canonical_largest_group", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		c3 := &layoutgraph.Node{ID: 3, Container: container}

		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		g.AddNodeToContainer(container, c3)

		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}
		c3.Edges = []*layoutgraph.Edge{{From: c3, To: uncle}}

		return g, nil
	})

	// C. one child / one uncle
	runScenario("C_one_child", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		return g, nil
	})

	// D. exactly two siblings sharing uncle
	runScenario("D_two_siblings", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}
		return g, nil
	})

	// E. child order preserved [child30, child10, child20]
	runScenario("E_child_order", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c30 := &layoutgraph.Node{ID: 30, Container: container}
		c10 := &layoutgraph.Node{ID: 10, Container: container}
		c20 := &layoutgraph.Node{ID: 20, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c30)
		g.AddNodeToContainer(container, c10)
		g.AddNodeToContainer(container, c20)
		c30.Edges = []*layoutgraph.Edge{{From: c30, To: uncle}}
		c10.Edges = []*layoutgraph.Edge{{From: c10, To: uncle}}
		c20.Edges = []*layoutgraph.Edge{{From: c20, To: uncle}}
		return g, nil
	})

	// F. parallel edges deduplicate child
	runScenario("F_parallel_edges", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}, {From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}
		return g, nil
	})

	// G. different uncles
	runScenario("G_different_uncles", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle1 := &layoutgraph.Node{ID: 101}
		uncle2 := &layoutgraph.Node{ID: 102}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		c3 := &layoutgraph.Node{ID: 3, Container: container}
		c4 := &layoutgraph.Node{ID: 4, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		g.AddNodeToContainer(container, c3)
		g.AddNodeToContainer(container, c4)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle1}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle1}}
		c3.Edges = []*layoutgraph.Edge{{From: c3, To: uncle2}}
		c4.Edges = []*layoutgraph.Edge{{From: c4, To: uncle2}}
		return g, nil
	})

	// H. same child in two uncle groups — larger group wins
	runScenario("H_larger_group_wins", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle2 := &layoutgraph.Node{ID: 102} // size 2
		uncle3 := &layoutgraph.Node{ID: 103} // size 3
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		c3 := &layoutgraph.Node{ID: 3, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		g.AddNodeToContainer(container, c3)

		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle2}, {From: c1, To: uncle3}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle2}}
		c3.Edges = []*layoutgraph.Edge{{From: c3, To: uncle3}}
		c4 := &layoutgraph.Node{ID: 4, Container: container}
		g.AddNodeToContainer(container, c4)
		c4.Edges = []*layoutgraph.Edge{{From: c4, To: uncle3}}
		return g, nil
	})

	// I. equal-size tie
	runScenario("I_equal_size_tie", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle1 := &layoutgraph.Node{ID: 101}
		uncle2 := &layoutgraph.Node{ID: 102}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		c3 := &layoutgraph.Node{ID: 3, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		g.AddNodeToContainer(container, c3)

		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle1}, {From: c1, To: uncle2}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle1}} // size 2 for uncle1
		c3.Edges = []*layoutgraph.Edge{{From: c3, To: uncle2}} // size 2 for uncle2
		return g, nil
	})

	// J. raw Container versus OwningContainer
	runScenario("J_raw_vs_owning", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		parent := &layoutgraph.Node{ID: 1000}
		innerContainer := &layoutgraph.Node{ID: 10, Container: parent}
		child1 := &layoutgraph.Node{ID: 1, Container: innerContainer}
		child2 := &layoutgraph.Node{ID: 2, Container: innerContainer}

		vessel := &layoutgraph.Node{ID: 99, Container: parent, Graph: g}
		seq := &layoutgraph.Sequence{
			Vessel: vessel,
			Graph:  g,
		}
		uncle := &layoutgraph.Node{
			ID:        100,
			Sequence:  seq,
			Container: nil,
		}
		seq.Nodes = []*layoutgraph.Node{uncle}

		g.AddNodeToContainer(nil, parent)
		g.AddNodeToContainer(parent, innerContainer)
		g.AddNodeToContainer(innerContainer, child1)
		g.AddNodeToContainer(innerContainer, child2)

		child1.Edges = []*layoutgraph.Edge{{From: child1, To: uncle}}
		child2.Edges = []*layoutgraph.Edge{{From: child2, To: uncle}}
		return g, nil
	})

	// K. root-level container
	runScenario("K_root_level", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10, Container: nil}
		uncle := &layoutgraph.Node{ID: 100, Container: nil}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}
		return g, nil
	})

	// L. nested containers
	runScenario("L_nested_containers", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		c1 := &layoutgraph.Node{ID: 10, Container: nil}
		c2 := &layoutgraph.Node{ID: 20, Container: c1}
		uncle := &layoutgraph.Node{ID: 100, Container: c1}

		child1 := &layoutgraph.Node{ID: 1, Container: c2}
		child2 := &layoutgraph.Node{ID: 2, Container: c2}

		g.AddNodeToContainer(nil, c1)
		g.AddNodeToContainer(c1, c2)
		g.AddNodeToContainer(c1, uncle)
		g.AddNodeToContainer(c2, child1)
		g.AddNodeToContainer(c2, child2)

		child1.Edges = []*layoutgraph.Edge{{From: child1, To: uncle}}
		child2.Edges = []*layoutgraph.Edge{{From: child2, To: uncle}}

		return g, nil
	})

	// M. same uncle used by children under TWO different containers
	runScenario("M_same_uncle_different_containers", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		cont1 := &layoutgraph.Node{ID: 10}
		cont2 := &layoutgraph.Node{ID: 20}
		uncle := &layoutgraph.Node{ID: 100}

		c1 := &layoutgraph.Node{ID: 1, Container: cont1}
		c2 := &layoutgraph.Node{ID: 2, Container: cont1}

		c3 := &layoutgraph.Node{ID: 3, Container: cont2}
		c4 := &layoutgraph.Node{ID: 4, Container: cont2}

		g.AddNodeToContainer(nil, cont1)
		g.AddNodeToContainer(cont1, c1)
		g.AddNodeToContainer(cont1, c2)
		g.AddNodeToContainer(nil, cont2)
		g.AddNodeToContainer(cont2, c3)
		g.AddNodeToContainer(cont2, c4)

		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}
		c3.Edges = []*layoutgraph.Edge{{From: c3, To: uncle}}
		c4.Edges = []*layoutgraph.Edge{{From: c4, To: uncle}}
		return g, nil
	})

	// O. nil child edge slice
	runScenario("O_nil_edge_slice", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = nil
		c2.Edges = nil
		return g, nil
	})

	// Q. nil edge entry
	runScenario("Q_nil_edge", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		c1.Edges = append(c1.Edges, nil)
		return g, nil
	})

	// R. preexisting graph.CommonUncleSiblings
	runScenario("R_preexisting_common", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}

		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}

		preMap := make(map[*layoutgraph.Node]layoutgraph.Nodes)
		g.CommonUncleSiblings = preMap

		return g, func() {
			// To check mutation, we would need external state, but JS oracle covers that.
		}
	})

	// S. repeated call produces equivalent contents on unchanged graph
	runScenario("S_repeated_call", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		uncle := &layoutgraph.Node{ID: 100}
		c1 := &layoutgraph.Node{ID: 1, Container: container}
		c2 := &layoutgraph.Node{ID: 2, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, c1)
		g.AddNodeToContainer(container, c2)
		c1.Edges = []*layoutgraph.Edge{{From: c1, To: uncle}}
		c2.Edges = []*layoutgraph.Edge{{From: c2, To: uncle}}

		first := proximity.CommonUncleSiblings(g)
		second := proximity.CommonUncleSiblings(g)
		if len(first) != len(second) {
			panic("repeated call length mismatch in Go")
		}
		for k, v := range first {
			v2, ok := second[k]
			if !ok || len(v) != len(v2) {
				panic("repeated call content mismatch in Go")
			}
			for i := range v {
				if v[i] != v2[i] {
					panic("repeated call element mismatch in Go")
				}
			}
		}
		return g, nil
	})

	// T. nil adjacent endpoint panics in Go due to adjacent.Container dereference
	runScenario("T_nil_adjacent_endpoint", func() (*layoutgraph.Graph, func()) {
		g := layoutgraph.NewGraph()
		container := &layoutgraph.Node{ID: 10}
		child := &layoutgraph.Node{ID: 1, Container: container}
		g.AddNodeToContainer(nil, container)
		g.AddNodeToContainer(container, child)

		edge := &layoutgraph.Edge{
			From: child,
			To:   nil,
		}
		child.Edges = []*layoutgraph.Edge{edge}
		return g, nil
	})

	outBytes, _ := json.MarshalIndent(out, "", "  ")

	targetPath := "go-common-uncle-siblings-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else if _, err := os.Stat("d2layouts/d2talalayout/js/test/fixtures"); err == nil {
		targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-common-uncle-siblings-reference.json"
	} else if _, err := os.Stat("../fixtures"); err == nil {
		targetPath = filepath.Join("..", "fixtures", "go-common-uncle-siblings-reference.json")
	} else if _, err := os.Stat("test/fixtures"); err == nil {
		targetPath = "test/fixtures/go-common-uncle-siblings-reference.json"
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(targetPath, outBytes, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(outBytes))
}
