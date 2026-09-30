package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type OracleOutput struct {
	Metadata  map[string]interface{}    `json:"metadata"`
	Helpers   map[string]interface{}    `json:"helpers"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type PointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type EdgeDTO struct {
	ID     string     `json:"id"`
	From   string     `json:"from"`
	To     string     `json:"to"`
	Points []PointDTO `json:"points"`
}

type TrackedNodeDTO struct {
	ID              string   `json:"id"`
	InGraph         bool     `json:"inGraph"`
	Container       *string  `json:"container"`
	IsClusterVessel bool     `json:"isClusterVessel"`
	HasCluster      bool     `json:"hasCluster"`
	ClusterVesselID *string  `json:"clusterVesselID"`
	NearsNull       bool     `json:"nearsNull"`
	Nears           []string `json:"nears"`
	Edges           []string `json:"edges"`
}

type ScenarioResult struct {
	Nodes        []*string                 `json:"nodes"`
	Containers   map[string]*[]*string     `json:"containers"`
	Edges        []EdgeDTO                 `json:"edges"`
	Clusters     map[string]interface{}    `json:"clusters"`
	TrackedNodes map[string]TrackedNodeDTO `json:"trackedNodes"`
}

func nodeIDStr(n *layoutgraph.Node) *string {
	if n == nil {
		return nil
	}
	s := fmt.Sprintf("%d", n.ID)
	return &s
}

func edgeIDStr(e *layoutgraph.Edge) string {
	if e == nil {
		return "null"
	}
	return fmt.Sprintf("%d", e.ID)
}

func serializeScenario(g *layoutgraph.Graph, tracked []*layoutgraph.Node) ScenarioResult {
	res := ScenarioResult{
		Containers:   make(map[string]*[]*string),
		Clusters:     make(map[string]interface{}),
		TrackedNodes: make(map[string]TrackedNodeDTO),
	}

	for _, n := range g.Nodes {
		res.Nodes = append(res.Nodes, nodeIDStr(n))
	}

	// Stable order for container keys
	containerKeys := make([]*layoutgraph.Node, 0, len(g.Containers))
	for c := range g.Containers {
		containerKeys = append(containerKeys, c)
	}
	sort.Slice(containerKeys, func(i, j int) bool {
		if containerKeys[i] == nil {
			return true
		}
		if containerKeys[j] == nil {
			return false
		}
		return containerKeys[i].ID < containerKeys[j].ID
	})

	for _, c := range containerKeys {
		children := g.Containers[c]
		cID := "null"
		if c != nil {
			cID = fmt.Sprintf("%d", c.ID)
		}
		if children == nil {
			res.Containers[cID] = nil
		} else {
			childIDs := make([]*string, 0, len(children))
			for _, child := range children {
				childIDs = append(childIDs, nodeIDStr(child))
			}
			res.Containers[cID] = &childIDs
		}
	}

	for v, cl := range g.Clusters {
		vID := "null"
		if v != nil {
			vID = fmt.Sprintf("%d", v.ID)
		}
		if cl == nil {
			res.Clusters[vID] = nil
		} else {
			res.Clusters[vID] = map[string]interface{}{"vessel": nodeIDStr(cl.Vessel)}
		}
	}

	for _, e := range g.Edges {
		if e == nil {
			continue
		}
		var points []PointDTO
		for _, pt := range e.Points {
			if pt != nil {
				points = append(points, PointDTO{X: pt.X, Y: pt.Y})
			}
		}
		fromID := "null"
		if e.From != nil {
			fromID = fmt.Sprintf("%d", e.From.ID)
		}
		toID := "null"
		if e.To != nil {
			toID = fmt.Sprintf("%d", e.To.ID)
		}
		res.Edges = append(res.Edges, EdgeDTO{
			ID:     edgeIDStr(e),
			From:   fromID,
			To:     toID,
			Points: points,
		})
	}

	for _, n := range tracked {
		if n == nil {
			continue
		}
		nID := fmt.Sprintf("%d", n.ID)
		dto := TrackedNodeDTO{
			ID:              nID,
			InGraph:         n.Graph != nil,
			Container:       nodeIDStr(n.Container),
			IsClusterVessel: n.IsClusterVessel(),
			HasCluster:      n.Cluster != nil,
			NearsNull:       n.Nears == nil,
		}
		if n.Cluster != nil && n.Cluster.Vessel != nil {
			dto.ClusterVesselID = nodeIDStr(n.Cluster.Vessel)
		}
		if n.Nears != nil {
			nearList := make([]string, 0, len(n.Nears))
			hasNilNear := false
			for near := range n.Nears {
				if near == nil {
					hasNilNear = true
				} else {
					nearList = append(nearList, fmt.Sprintf("%d", near.ID))
				}
			}
			sort.Slice(nearList, func(i, j int) bool {
				vI, _ := strconv.ParseInt(nearList[i], 10, 64)
				vJ, _ := strconv.ParseInt(nearList[j], 10, 64)
				return vI < vJ
			})
			if hasNilNear {
				nearList = append([]string{"null"}, nearList...)
			}
			dto.Nears = nearList
		}
		for _, e := range n.Edges {
			dto.Edges = append(dto.Edges, edgeIDStr(e))
		}
		res.TrackedNodes[nID] = dto
	}

	return res
}

func main() {
	nilGraphPanics := func() (panicked bool) {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		grouping.ResetClusters(nil)
		return false
	}()

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"d2BaseCommit": "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"goVersion":    runtime.Version(),
			"goOS":         runtime.GOOS,
			"goArch":       runtime.GOARCH,
		},
		Helpers: map[string]interface{}{
			"nilGraphPanics": nilGraphPanics,
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. empty_clusters
	{
		g := layoutgraph.NewGraph()
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{}
		grouping.ResetClusters(g)
		out.Scenarios["empty_clusters"] = serializeScenario(g, []*layoutgraph.Node{n1, n2})
	}

	// 2. single_nil_value
	{
		g := layoutgraph.NewGraph()
		stale := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		stale.SetClusterVessel(true)
		g.AddNewNodeToContainer(nil, stale)
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{stale: nil}
		grouping.ResetClusters(g)
		out.Scenarios["single_nil_value"] = serializeScenario(g, []*layoutgraph.Node{stale})
	}

	// 3. single_nil_key
	{
		g := layoutgraph.NewGraph()
		ordinary := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		member := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		keep := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		g.AddNewNodeToContainer(nil, ordinary)
		g.AddNewNodeToContainer(nil, member)
		g.AddNewNodeToContainer(nil, keep)
		cluster := &layoutgraph.Cluster{Graph: g, Nodes: []*layoutgraph.Node{member}}
		member.Cluster = cluster
		member.Nears = map[*layoutgraph.Node]struct{}{nil: {}}
		edge := g.Connect(ordinary, keep)
		edge.ID = 101
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{{Edge: edge, OriginallyTo: member}}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{nil: cluster}
		grouping.ResetClusters(g)
		out.Scenarios["single_nil_key"] = serializeScenario(g, []*layoutgraph.Node{ordinary, member, keep})
	}

	// 4. bulk_one_retired_among_multiple_entries
	{
		g := layoutgraph.NewGraph()
		ordinary := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		vessel := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		stale := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		root := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		vessel.SetClusterVessel(true)
		vessel.Container = root
		cluster := &layoutgraph.Cluster{Vessel: vessel, Graph: g}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{vessel: cluster, stale: nil}
		g.Nodes = []*layoutgraph.Node{ordinary, vessel, stale, vessel}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: {vessel, ordinary, stale, vessel}}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_one_retired_among_multiple_entries"] = serializeScenario(g, []*layoutgraph.Node{ordinary, vessel, stale, root})
	}

	// 5. bulk_zero_retired
	{
		g := layoutgraph.NewGraph()
		ordinary := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		member := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		keep := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		stale := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		root := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		cluster := &layoutgraph.Cluster{Graph: g, Nodes: []*layoutgraph.Node{member}}
		member.Cluster = cluster
		member.Nears = map[*layoutgraph.Node]struct{}{nil: {}}
		edge := g.Connect(ordinary, keep)
		edge.ID = 101
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{{Edge: edge, OriginallyFrom: member}}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{stale: nil, nil: cluster}
		g.Nodes = []*layoutgraph.Node{ordinary, nil, stale, member, keep}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: {nil, stale, ordinary, member, keep}}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_zero_retired"] = serializeScenario(g, []*layoutgraph.Node{ordinary, member, keep, stale, root})
	}

	// 6. legacy_edge_cases
	{
		g := layoutgraph.NewGraph()
		ordinary := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		keepNilCluster := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		survivor := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		member := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		mismatchedMember := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		vesselA := g.AddNode(layoutgraph.NewNode(6, 10, 10))
		vesselB := g.AddNode(layoutgraph.NewNode(7, 10, 10))
		root := g.AddNode(layoutgraph.NewNode(8, 10, 10))
		nested := g.AddNode(layoutgraph.NewNode(9, 10, 10))
		nilChildren := g.AddNode(layoutgraph.NewNode(10, 10, 10))
		emptyChildren := g.AddNode(layoutgraph.NewNode(11, 10, 10))

		clusterA := &layoutgraph.Cluster{Vessel: vesselA, Graph: g}
		clusterB := &layoutgraph.Cluster{Vessel: vesselB, Graph: g}
		otherCluster := &layoutgraph.Cluster{Graph: g}
		member.Cluster = clusterA
		mismatchedMember.Cluster = otherCluster
		clusterA.Nodes = []*layoutgraph.Node{member, mismatchedMember, nil}
		clusterB.Nodes = []*layoutgraph.Node{nil}
		vesselA.SetClusterVessel(true)
		vesselB.SetClusterVessel(true)
		keepNilCluster.SetClusterVessel(true)
		vesselA.Container = root
		vesselB.Container = nested
		member.AddNear(vesselA)
		ordinary.AddNear(vesselA)
		vesselB.Nears = nil

		fromEdge := g.Connect(vesselA, ordinary)
		fromEdge.ID = 201
		toEdge := g.Connect(ordinary, vesselA)
		toEdge.ID = 202
		clusterA.EdgeAbductions = []*layoutgraph.EdgeAbduction{
			{Edge: fromEdge, OriginallyFrom: member},
			{Edge: toEdge, OriginallyTo: member},
			nil,
			{},
		}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{
			vesselA:        clusterA,
			vesselB:        clusterB,
			keepNilCluster: nil,
			nil:            {},
		}

		g.Nodes = append(make([]*layoutgraph.Node, 0, 12), ordinary, vesselA, nil, keepNilCluster, vesselB, vesselA, survivor)
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{
			root:          append(make([]*layoutgraph.Node, 0, 10), ordinary, vesselB, nil, keepNilCluster, vesselA, survivor, vesselB),
			nested:        {vesselA, ordinary},
			nilChildren:   nil,
			emptyChildren: make([]*layoutgraph.Node, 0, 4),
		}

		grouping.ResetClusters(g)
		out.Scenarios["legacy_edge_cases"] = serializeScenario(g, []*layoutgraph.Node{
			ordinary, keepNilCluster, survivor, member, mismatchedMember,
			vesselA, vesselB, root, nested, nilChildren, emptyChildren,
		})
	}

	// 7. bulk_matrix_1
	{
		g := layoutgraph.NewGraph()
		vessel := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		member := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		ordinary := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		root := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		vessel.SetClusterVessel(true)
		vessel.Container = root
		cluster := &layoutgraph.Cluster{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{member}}
		member.Cluster = cluster
		member.AddNear(vessel)
		vessel.AddNear(ordinary)
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{vessel: cluster}
		g.Nodes = []*layoutgraph.Node{ordinary, vessel, member, vessel}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: {vessel, ordinary, member, vessel}}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_matrix_1"] = serializeScenario(g, []*layoutgraph.Node{vessel, member, ordinary, root})
	}

	// 8. bulk_matrix_2
	{
		g := layoutgraph.NewGraph()
		vessel1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		vessel2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		member1 := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		member2 := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		ordinary := g.AddNode(layoutgraph.NewNode(5, 10, 10))
		root := g.AddNode(layoutgraph.NewNode(6, 10, 10))
		vessel1.SetClusterVessel(true)
		vessel1.Container = root
		vessel2.SetClusterVessel(true)
		vessel2.Container = root
		c1 := &layoutgraph.Cluster{Vessel: vessel1, Graph: g, Nodes: []*layoutgraph.Node{member1}}
		c2 := &layoutgraph.Cluster{Vessel: vessel2, Graph: g, Nodes: []*layoutgraph.Node{member2}}
		member1.Cluster = c1
		member2.Cluster = c2
		member1.AddNear(vessel1)
		member2.AddNear(vessel2)
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{vessel1: c1, vessel2: c2}
		g.Nodes = []*layoutgraph.Node{ordinary, vessel1, member1, vessel2, vessel1}
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: {vessel2, ordinary, member2, vessel1, vessel2}}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_matrix_2"] = serializeScenario(g, []*layoutgraph.Node{vessel1, vessel2, member1, member2, ordinary, root})
	}

	// 9. bulk_matrix_10
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(1000, 10, 10))
		tracked := []*layoutgraph.Node{root}
		g.Clusters = make(map[*layoutgraph.Node]*layoutgraph.Cluster)
		var nodes []*layoutgraph.Node
		var rootChildren []*layoutgraph.Node

		for i := 1; i <= 10; i++ {
			vessel := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i), 10, 10))
			member := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(100+i), 10, 10))
			ordinary := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(200+i), 10, 10))
			vessel.SetClusterVessel(true)
			vessel.Container = root
			cl := &layoutgraph.Cluster{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{member}}
			member.Cluster = cl
			member.AddNear(vessel)
			g.Clusters[vessel] = cl

			nodes = append(nodes, ordinary, vessel, member, vessel)
			rootChildren = append(rootChildren, vessel, ordinary, member, vessel)
			tracked = append(tracked, vessel, member, ordinary)
		}
		g.Nodes = nodes
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: rootChildren}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_matrix_10"] = serializeScenario(g, tracked)
	}

	// 10. bulk_matrix_100
	{
		g := layoutgraph.NewGraph()
		root := g.AddNode(layoutgraph.NewNode(10000, 10, 10))
		tracked := []*layoutgraph.Node{root}
		g.Clusters = make(map[*layoutgraph.Node]*layoutgraph.Cluster)
		var nodes []*layoutgraph.Node
		var rootChildren []*layoutgraph.Node

		for i := 1; i <= 100; i++ {
			vessel := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i), 10, 10))
			member := g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(1000+i), 10, 10))
			vessel.SetClusterVessel(true)
			vessel.Container = root
			cl := &layoutgraph.Cluster{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{member}}
			member.Cluster = cl
			member.AddNear(vessel)
			g.Clusters[vessel] = cl

			nodes = append(nodes, vessel, member, vessel)
			rootChildren = append(rootChildren, member, vessel, vessel)
			if i <= 5 || i >= 96 {
				tracked = append(tracked, vessel, member)
			}
		}
		g.Nodes = nodes
		g.Containers = map[*layoutgraph.Node][]*layoutgraph.Node{root: rootChildren}
		grouping.ResetClusters(g)
		out.Scenarios["bulk_matrix_100"] = serializeScenario(g, tracked)
	}

	// 11. reconnect_ordering_regression
	{
		g := layoutgraph.NewGraph()
		member := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		targetA := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		targetB := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		vessel := g.AddNode(layoutgraph.NewNode(4, 10, 10))
		vessel.SetClusterVessel(true)

		e1 := g.Connect(member, targetA)
		e1.ID = 101
		e1.Points = []*geo.Point{geo.NewPoint(10, 20), geo.NewPoint(30, 40)}

		e2 := g.Connect(member, targetB)
		e2.ID = 102

		cluster := &layoutgraph.Cluster{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{member}}
		// Abduction has e1 with OriginallyFrom = member, OriginallyTo = targetA
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{
			{Edge: e1, OriginallyFrom: member, OriginallyTo: targetA},
		}
		g.Clusters = map[*layoutgraph.Node]*layoutgraph.Cluster{vessel: cluster}
		g.AddNewNodeToContainer(nil, member)
		g.AddNewNodeToContainer(nil, targetA)
		g.AddNewNodeToContainer(nil, targetB)
		g.AddNewNodeToContainer(nil, vessel)

		grouping.ResetClusters(g)
		out.Scenarios["reconnect_ordering_regression"] = serializeScenario(g, []*layoutgraph.Node{member, targetA, targetB, vessel})
	}

	outPath := "test/fixtures/go-reset-clusters-reference.json"
	if len(os.Args) > 1 && os.Args[1] != "" {
		outPath = os.Args[1]
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	hash := sha256.Sum256(data)
	hashHex := hex.EncodeToString(hash[:])
	fmt.Printf("Wrote %d bytes to %s\nSHA256: %s\n", len(data), outPath, hashHex)
}
