package layoutgraph_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 50 clone oracle: context-aware layoutgraph.Clone behavior.
//
// For each successful scenario it records the cloned structure, the exact
// number of ctx.Err() calls made by a complete Clone, and the exact error
// returned when a counting context starts reporting cancellation at every
// call index 1..N. Error scenarios record Clone's exact error string.
//
// Generated with TALA_SLICE50_ORACLE=1.
// Replayed by js/test/unit/graph-clone-context.test.js.

type s50cEdge struct {
	ID     int64 `json:"id"`
	From   int64 `json:"from"`
	To     int64 `json:"to"`
	Points int   `json:"points"`
}

type s50cGroup struct {
	Vessel     int64   `json:"vessel"`
	Members    []int64 `json:"members"`
	Container  int64   `json:"container"`
	Abductions int     `json:"abductions"`
	Attached   bool    `json:"attached"`
}

type s50cKeyed struct {
	Key    int64   `json:"key"`
	Values []int64 `json:"values"`
}

type s50cDirection struct {
	Key       int64 `json:"key"`
	Direction int   `json:"direction"`
}

type s50cSummary struct {
	NodeIDs    []int64         `json:"nodeIds"`
	Edges      []s50cEdge      `json:"edges"`
	Containers []s50cKeyed     `json:"containers"`
	Clusters   []s50cGroup     `json:"clusters"`
	Sequences  []s50cGroup     `json:"sequences"`
	Hubs       []s50cKeyed     `json:"hubs"`
	Trees      []s50cKeyed     `json:"trees"`
	Directions []s50cDirection `json:"directions"`
	Nears      []s50cKeyed     `json:"nears"`
	CellSize   float64         `json:"cellSize"`
	RootHier   bool            `json:"rootHierarchy"`
}

type s50cSweep struct {
	Name       string      `json:"name"`
	ErrCalls   int         `json:"errCalls"`
	Summary    s50cSummary `json:"summary"`
	CancelErrs []string    `json:"cancelErrors"`
}

type s50cFailure struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

type s50cOracle struct {
	Sweeps   []s50cSweep   `json:"sweeps"`
	Failures []s50cFailure `json:"failures"`
}

func s50cID(node *layoutgraph.Node) int64 {
	if node == nil {
		return -1
	}
	return node.ID
}

func s50cIDs(nodes []*layoutgraph.Node) []int64 {
	ids := make([]int64, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, s50cID(node))
	}
	return ids
}

func s50cSortKeyed(values []s50cKeyed) {
	slices.SortFunc(values, func(a, b s50cKeyed) int {
		switch {
		case a.Key < b.Key:
			return -1
		case a.Key > b.Key:
			return 1
		}
		return 0
	})
}

func s50cGroups[T any](groups map[*layoutgraph.Node]T, read func(T) s50cGroup) []s50cGroup {
	out := make([]s50cGroup, 0, len(groups))
	for _, group := range groups {
		out = append(out, read(group))
	}
	slices.SortFunc(out, func(a, b s50cGroup) int {
		switch {
		case a.Vessel < b.Vessel:
			return -1
		case a.Vessel > b.Vessel:
			return 1
		}
		return 0
	})
	return out
}

func s50cSummarize(graph *layoutgraph.Graph) s50cSummary {
	summary := s50cSummary{
		NodeIDs:    s50cIDs(graph.Nodes),
		Edges:      []s50cEdge{},
		Containers: []s50cKeyed{},
		Hubs:       []s50cKeyed{},
		Trees:      []s50cKeyed{},
		Directions: []s50cDirection{},
		Nears:      []s50cKeyed{},
		CellSize:   graph.CellSize,
		RootHier:   graph.IsRootHierarchy,
	}
	for _, edge := range graph.Edges {
		summary.Edges = append(summary.Edges, s50cEdge{ID: edge.ID, From: s50cID(edge.From), To: s50cID(edge.To), Points: len(edge.Points)})
	}
	for container, children := range graph.Containers {
		summary.Containers = append(summary.Containers, s50cKeyed{Key: s50cID(container), Values: s50cIDs(children)})
	}
	s50cSortKeyed(summary.Containers)
	summary.Clusters = s50cGroups(graph.Clusters, func(cluster *layoutgraph.Cluster) s50cGroup {
		return s50cGroup{Vessel: cluster.Vessel.ID, Members: s50cIDs(cluster.Nodes), Container: s50cID(cluster.Container), Abductions: len(cluster.EdgeAbductions), Attached: cluster.Vessel.Graph != nil}
	})
	summary.Sequences = s50cGroups(graph.Sequences, func(sequence *layoutgraph.Sequence) s50cGroup {
		return s50cGroup{Vessel: sequence.Vessel.ID, Members: s50cIDs(sequence.Nodes), Container: s50cID(sequence.Container), Abductions: len(sequence.EdgeAbductions), Attached: sequence.Vessel.Graph != nil}
	})
	for hub, spokes := range graph.Hubs {
		summary.Hubs = append(summary.Hubs, s50cKeyed{Key: s50cID(hub), Values: s50cIDs(spokes)})
	}
	s50cSortKeyed(summary.Hubs)
	for sentinel, roots := range graph.Trees {
		ids := []int64{}
		for _, root := range roots {
			ids = append(ids, s50cID(root.Node))
		}
		summary.Trees = append(summary.Trees, s50cKeyed{Key: s50cID(sentinel), Values: ids})
	}
	s50cSortKeyed(summary.Trees)
	for container, direction := range graph.Directions {
		summary.Directions = append(summary.Directions, s50cDirection{Key: s50cID(container), Direction: int(direction)})
	}
	slices.SortFunc(summary.Directions, func(a, b s50cDirection) int {
		switch {
		case a.Key < b.Key:
			return -1
		case a.Key > b.Key:
			return 1
		}
		return 0
	})
	for _, node := range graph.Nodes {
		nears := []*layoutgraph.Node{}
		for near := range node.Nears {
			nears = append(nears, near)
		}
		if len(nears) == 0 {
			continue
		}
		ids := s50cIDs(nears)
		slices.Sort(ids)
		summary.Nears = append(summary.Nears, s50cKeyed{Key: node.ID, Values: ids})
	}
	return summary
}

func newSlice50RouteGraph() *layoutgraph.Graph {
	graph := layoutgraph.NewGraph()
	graph.CellSize = 20
	container := layoutgraph.NewNode(1, 400, 400)
	container.TopLeft = geo.NewPoint(0, 0)
	graph.AddNewNodeToContainer(nil, container)
	a := layoutgraph.NewNode(2, 20, 20)
	a.TopLeft = geo.NewPoint(10, 10)
	graph.AddNewNodeToContainer(container, a)
	b := layoutgraph.NewNode(3, 20, 20)
	b.TopLeft = geo.NewPoint(500, 10)
	graph.AddNewNodeToContainer(nil, b)
	edge := graph.Connect(a, b)
	edge.ID = 7
	for i := 0; i < 300; i++ {
		edge.Points = append(edge.Points, geo.NewPoint(float64(i), float64(i%7)))
	}
	loop := graph.Connect(b, b)
	loop.ID = 8
	loop.Points = []*geo.Point{geo.NewPoint(500, 0), geo.NewPoint(520, 0)}
	a.AddNear(b)
	graph.Directions[nil] = geo.Bottom
	graph.Directions[container] = geo.TopLeft
	return graph
}

func TestSlice50CloneOracle(t *testing.T) {
	oracle := s50cOracle{}
	for _, scenario := range []struct {
		name  string
		build func() *layoutgraph.Graph
	}{
		{name: "empty", build: layoutgraph.NewGraph},
		{name: "layout state", build: newCloneParityGraph},
		{name: "detached tree records", build: newDetachedTreeGraph},
		{name: "inactive grouping vessels", build: newInactiveGroupingGraph},
		{name: "shared inactive grouping vessel", build: newSharedGroupingVesselGraph},
		{name: "long route", build: newSlice50RouteGraph},
	} {
		counter := &countContext{Context: context.Background()}
		cloned, err := layoutgraph.Clone(counter, scenario.build())
		if err != nil {
			t.Fatalf("Clone(%s): %v", scenario.name, err)
		}
		sweep := s50cSweep{Name: scenario.name, ErrCalls: counter.calls, Summary: s50cSummarize(cloned), CancelErrs: []string{}}
		for cancelAt := 1; cancelAt <= counter.calls; cancelAt++ {
			ctx := &countContext{Context: context.Background(), cancelAt: cancelAt}
			canceled, err := layoutgraph.Clone(ctx, scenario.build())
			if canceled != nil || err == nil {
				t.Fatalf("Clone(%s) cancelAt %d = (%v, %v), want an error", scenario.name, cancelAt, canceled, err)
			}
			sweep.CancelErrs = append(sweep.CancelErrs, err.Error())
		}
		oracle.Sweeps = append(oracle.Sweeps, sweep)
	}

	for _, scenario := range []struct {
		name  string
		build func() *layoutgraph.Graph
	}{
		{name: "cluster vessel id collision", build: newClusterVesselIDCollisionGraph},
		{name: "sequence vessel id collision", build: newSequenceVesselIDCollisionGraph},
		{name: "cluster contains itself", build: newSelfContainingClusterGraph},
		{name: "sequence contains itself", build: newSelfContainingSequenceGraph},
		{name: "tree node id collision", build: newTreeNodeIDCollisionGraph},
		{name: "tree sentinel edge id collision", build: newTreeSentinelEdgeIDCollisionGraph},
		{name: "tree node repeats grouping vessel", build: newTreeNodeAuxiliaryReuseGraph},
		{name: "duplicate tree ownership", build: newDuplicateTreeNodeOwnershipGraph},
		{name: "container child alias", build: newContainerChildAliasGraph},
		{name: "container child inactive vessel", build: newInactiveVesselContainerChildGraph},
		{name: "hub spoke alias", build: newHubSpokeAliasGraph},
	} {
		cloned, err := layoutgraph.Clone(context.Background(), scenario.build())
		if cloned != nil || err == nil {
			t.Fatalf("Clone(%s) = (%v, %v), want an error", scenario.name, cloned, err)
		}
		oracle.Failures = append(oracle.Failures, s50cFailure{Name: scenario.name, Error: err.Error()})
	}

	encoded, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')

	path := filepath.Join("..", "..", "js", "test", "fixtures", "go-slice50-clone-reference.json")
	if os.Getenv("TALA_SLICE50_ORACLE") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, encoded) {
		t.Fatalf("go-slice50-clone-reference.json is stale; regenerate with TALA_SLICE50_ORACLE=1")
	}
}
