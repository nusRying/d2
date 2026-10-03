const fs = require('fs');
const path = require('path');
const p = path.resolve('../internal/placementcost/go_node_placement_cost_oracle_test.go');
let src = fs.readFileSync(p, 'utf8');

const additionalClusterCases = `
		// null cluster
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(nil)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "null_cluster", ExactlyTwo: exact,
		})

		// empty Nodes
		clEmpty := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clEmpty)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "empty_nodes", ExactlyTwo: exact,
		})

		// nil first Node
		clNilNode := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{nil}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clNilNode)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "nil_first_node", ExactlyTwo: exact,
		})

		// nil/empty EdgeAbductions succeeds
		clEmptyAbductions := &layoutgraph.Cluster{Nodes: layoutgraph.Nodes{cn1}}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clEmptyAbductions)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "empty_abductions", ExactlyTwo: exact,
		})

		// nil EdgeAbduction
		clNilAbduction := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{nil},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clNilAbduction)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "nil_abduction", ExactlyTwo: exact,
		})

		// Case A nil CurrentFrom
		clNilFrom := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyTo: cn1}, // OriginallyFrom is nil
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clNilFrom)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "nil_current_from", ExactlyTwo: exact,
		})

		// Case B nil CurrentTo
		clNilTo := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyFrom: cn1}, // OriginallyTo is nil
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clNilTo)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "nil_current_to", ExactlyTwo: exact,
		})

		// both originals nil ignored
		clBothNil := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{CurrentFrom: ext1, CurrentTo: cn1},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clBothNil)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "both_originals_nil", ExactlyTwo: exact,
		})

		// both originals nonnil ignored
		clBothNonNil := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyFrom: ext1, OriginallyTo: cn1, CurrentFrom: ext1, CurrentTo: cn1},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clBothNonNil)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "both_originals_nonnil", ExactlyTwo: exact,
		})

		// unpositioned external ignored
		extUnpositioned := addTestNode(g, 0, 0, 0, 0)
		extUnpositioned.TopLeft = nil
		clUnpos := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyTo: cn1, CurrentFrom: extUnpositioned},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clUnpos)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "unpositioned_external", ExactlyTwo: exact,
		})

		// wrong-graph external ignored
		g2 := createTestGraph()
		extWrongGraph := addTestNode(g2, 100, 100, 40, 40)
		clWrongGraph := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyTo: cn1, CurrentFrom: extWrongGraph},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clWrongGraph)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "wrong_graph_external", ExactlyTwo: exact,
		})

		// duplicate external identity dedup
		clDuplicate := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyTo: cn1, CurrentFrom: ext1, CurrentTo: cn1},
				{OriginallyTo: cn1, CurrentFrom: ext1, CurrentTo: cn1},
				{OriginallyTo: cn1, CurrentFrom: ext1, CurrentTo: cn1},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clDuplicate)
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "duplicate_external", FirstID: fmt.Sprintf("%d", f.ID), ExactlyTwo: exact,
		})

		// distinct same-ID external nodes remain distinct
		extSameID1 := addTestNode(g, 100, 100, 40, 40)
		extSameID2 := addTestNode(g, 200, 200, 40, 40)
		extSameID1.ID = 999
		extSameID2.ID = 999
		clSameID := &layoutgraph.Cluster{
			Nodes: layoutgraph.Nodes{cn1},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{
				{OriginallyTo: cn1, CurrentFrom: extSameID1},
				{OriginallyTo: cn1, CurrentFrom: extSameID2},
			},
		}
		f, s, exact = clusterExactlyTwoExternalConnectedNodes(clSameID)
		fID, sID := "", ""
		if f != nil { fID = fmt.Sprintf("%d", f.ID) }
		if s != nil { sID = fmt.Sprintf("%d", s.ID) }
		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{
			Name: "distinct_same_id", FirstID: fID, SecondID: sID, ExactlyTwo: exact,
		})
`;

src = src.replace('		f, s, exact = clusterExactlyTwoExternalConnectedNodes(cl)\n		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{\n			Name: "three_external", FirstID: fmt.Sprintf("%d", f.ID), SecondID: fmt.Sprintf("%d", s.ID), ExactlyTwo: exact,\n		})\n	}',
'		f, s, exact = clusterExactlyTwoExternalConnectedNodes(cl)\n		fixture.ClusterExternalPair = append(fixture.ClusterExternalPair, ClusterPairScenarioJSON{\n			Name: "three_external", FirstID: fmt.Sprintf("%d", f.ID), SecondID: fmt.Sprintf("%d", s.ID), ExactlyTwo: exact,\n		})\n' + additionalClusterCases + '\n	}');

fs.writeFileSync(p, src);
