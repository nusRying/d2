//go:build tala_cluster_oracle

package grouping

import (
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
)

// ClusterEdgeSignatureResult carries exported copies of the unexported
// clusterEdgeSignature fields for oracle comparison with the JS port.
type ClusterEdgeSignatureResult struct {
	From          int
	To            int
	Bidirectional int
	Undirected    int
	Directed      int
	FromArrowheads map[layoutgraph.Arrowhead]struct{}
	ToArrowheads   map[layoutgraph.Arrowhead]struct{}
}

// ClusterDiscoveryInfoResult carries exported copies of the unexported
// clusterDiscoveryInfo fields for oracle comparison with the JS port.
type ClusterDiscoveryInfoResult struct {
	Neighbors      []*layoutgraph.Node
	Edges          []*layoutgraph.Edge
	EdgeSignature  ClusterEdgeSignatureResult
	EstimatedWidth float64
	EstimatedHeight float64
	NoClustering   bool
	ToTableColumn  bool
}

// BuildClusterDiscoveryIndexBridge exposes buildClusterDiscoveryIndex for the
// test oracle so the JS port results can be compared against Go ground truth.
func BuildClusterDiscoveryIndexBridge(
	g *layoutgraph.Graph,
	containerOrder []*layoutgraph.Node,
	guard *limits.WorkGuard,
) (map[*layoutgraph.Node]*ClusterDiscoveryInfoResult, map[*layoutgraph.Edge]int, error) {
	idx, err := buildClusterDiscoveryIndex(g, containerOrder, guard)
	if err != nil {
		return nil, nil, err
	}

	infoResults := make(map[*layoutgraph.Node]*ClusterDiscoveryInfoResult, len(idx.infos))
	for node, info := range idx.infos {
		fromAH := make(map[layoutgraph.Arrowhead]struct{}, len(info.edgeSignature.fromArrowheads))
		for k, v := range info.edgeSignature.fromArrowheads {
			fromAH[k] = v
		}
		toAH := make(map[layoutgraph.Arrowhead]struct{}, len(info.edgeSignature.toArrowheads))
		for k, v := range info.edgeSignature.toArrowheads {
			toAH[k] = v
		}
		infoResults[node] = &ClusterDiscoveryInfoResult{
			Neighbors: info.neighbors,
			Edges:     info.edges,
			EdgeSignature: ClusterEdgeSignatureResult{
				From:           info.edgeSignature.from,
				To:             info.edgeSignature.to,
				Bidirectional:  info.edgeSignature.bidirectional,
				Undirected:     info.edgeSignature.undirected,
				Directed:       info.edgeSignature.directed,
				FromArrowheads: fromAH,
				ToArrowheads:   toAH,
			},
			EstimatedWidth:  info.estimatedWidth,
			EstimatedHeight: info.estimatedHeight,
			NoClustering:    info.noClustering,
			ToTableColumn:   info.toTableColumn,
		}
	}

	edgeOrderCopy := make(map[*layoutgraph.Edge]int, len(idx.edgeOrder))
	for k, v := range idx.edgeOrder {
		edgeOrderCopy[k] = v
	}

	return infoResults, edgeOrderCopy, nil
}

// ClusterIsDescendantOfGuardedBridge exposes the unexported helper for oracle
// tests that verify ancestry traversal parity.
func ClusterIsDescendantOfGuardedBridge(
	descendant, ancestor *layoutgraph.Node,
	guard *limits.WorkGuard,
) (bool, error) {
	return clusterIsDescendantOfGuarded(descendant, ancestor, guard)
}

// ClusterHasLeakyEdgeGuardedBridge exposes the unexported helper for oracle
// tests that verify leaky-container classification parity.
func ClusterHasLeakyEdgeGuardedBridge(
	g *layoutgraph.Graph,
	node *layoutgraph.Node,
	guard *limits.WorkGuard,
) (bool, error) {
	return clusterHasLeakyEdgeGuarded(g, node, guard)
}

// ClusterIncidentEdgesBridge exposes clusterIncidentEdges for oracle tests.
func ClusterIncidentEdgesBridge(
	cluster *layoutgraph.Cluster,
	infos map[*layoutgraph.Node]*ClusterDiscoveryInfoResult,
	edgeOrder map[*layoutgraph.Edge]int,
	guard *limits.WorkGuard,
) ([]*layoutgraph.Edge, error) {
	// Re-wrap the exported infos into the internal type so we can call the real function.
	internalInfos := make(map[*layoutgraph.Node]*clusterDiscoveryInfo, len(infos))
	for node, r := range infos {
		internalInfos[node] = &clusterDiscoveryInfo{
			neighbors:       r.Neighbors,
			edges:           r.Edges,
			estimatedWidth:  r.EstimatedWidth,
			estimatedHeight: r.EstimatedHeight,
			noClustering:    r.NoClustering,
			toTableColumn:   r.ToTableColumn,
			neighborSet:     nil, // not needed for clusterIncidentEdges
			edgeSignature: clusterEdgeSignature{
				from:           r.EdgeSignature.From,
				to:             r.EdgeSignature.To,
				bidirectional:  r.EdgeSignature.Bidirectional,
				undirected:     r.EdgeSignature.Undirected,
				directed:       r.EdgeSignature.Directed,
				fromArrowheads: r.EdgeSignature.FromArrowheads,
				toArrowheads:   r.EdgeSignature.ToArrowheads,
			},
		}
	}
	return clusterIncidentEdges(cluster, internalInfos, edgeOrder, guard)
}
