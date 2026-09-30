//go:build tala_cluster_discovery_oracle

package grouping

import (
	"fmt"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
)

// ClusterEdgeSignatureDTO carries serializable copies of clusterEdgeSignature fields.
type ClusterEdgeSignatureDTO struct {
	From           int      `json:"from"`
	To             int      `json:"to"`
	Bidirectional  int      `json:"bidirectional"`
	Undirected     int      `json:"undirected"`
	Directed       int      `json:"directed"`
	FromArrowheads []string `json:"fromArrowheads"`
	ToArrowheads   []string `json:"toArrowheads"`
}

// ClusterDiscoveryInfoDTO carries serializable copies of clusterDiscoveryInfo fields.
type ClusterDiscoveryInfoDTO struct {
	Neighbors       []string                `json:"neighbors"` // decimal node IDs
	Edges           []string                `json:"edges"`     // decimal edge IDs
	EdgeSignature   ClusterEdgeSignatureDTO `json:"edgeSignature"`
	EstimatedWidth  float64                 `json:"estimatedWidth"`
	EstimatedHeight float64                 `json:"estimatedHeight"`
	NoClustering    bool                    `json:"noClustering"`
	ToTableColumn   bool                    `json:"toTableColumn"`
}

// ClusterDiscoveryIndexBridge is a thin holder around the REAL Go clusterDiscoveryIndex.
type ClusterDiscoveryIndexBridge struct {
	index *clusterDiscoveryIndex
}

func toSignatureDTO(sig clusterEdgeSignature) ClusterEdgeSignatureDTO {
	fromAH := make([]string, 0, len(sig.fromArrowheads))
	for ah := range sig.fromArrowheads {
		fromAH = append(fromAH, string(ah))
	}
	sort.Strings(fromAH)

	toAH := make([]string, 0, len(sig.toArrowheads))
	for ah := range sig.toArrowheads {
		toAH = append(toAH, string(ah))
	}
	sort.Strings(toAH)

	return ClusterEdgeSignatureDTO{
		From:           sig.from,
		To:             sig.to,
		Bidirectional:  sig.bidirectional,
		Undirected:     sig.undirected,
		Directed:       sig.directed,
		FromArrowheads: fromAH,
		ToArrowheads:   toAH,
	}
}

func fromSignatureDTO(dto ClusterEdgeSignatureDTO) clusterEdgeSignature {
	sig := clusterEdgeSignature{
		from:           dto.From,
		to:             dto.To,
		bidirectional:  dto.Bidirectional,
		undirected:     dto.Undirected,
		directed:       dto.Directed,
		fromArrowheads: make(map[layoutgraph.Arrowhead]struct{}, len(dto.FromArrowheads)),
		toArrowheads:   make(map[layoutgraph.Arrowhead]struct{}, len(dto.ToArrowheads)),
	}
	for _, ah := range dto.FromArrowheads {
		sig.fromArrowheads[layoutgraph.Arrowhead(ah)] = struct{}{}
	}
	for _, ah := range dto.ToArrowheads {
		sig.toArrowheads[layoutgraph.Arrowhead(ah)] = struct{}{}
	}
	return sig
}

// ClusterEdgeSignatureAddBridge adds an edge to a real clusterEdgeSignature and returns the updated DTO.
func ClusterEdgeSignatureAddBridge(node *layoutgraph.Node, edge *layoutgraph.Edge, current ClusterEdgeSignatureDTO) ClusterEdgeSignatureDTO {
	sig := fromSignatureDTO(current)
	sig.add(node, edge)
	return toSignatureDTO(sig)
}

// ClusterEdgeSignatureBuildBridge builds a real clusterEdgeSignature for a node across a slice of edges.
func ClusterEdgeSignatureBuildBridge(node *layoutgraph.Node, edges []*layoutgraph.Edge) ClusterEdgeSignatureDTO {
	sig := clusterEdgeSignature{
		fromArrowheads: make(map[layoutgraph.Arrowhead]struct{}),
		toArrowheads:   make(map[layoutgraph.Arrowhead]struct{}),
	}
	for _, e := range edges {
		sig.add(node, e)
	}
	return toSignatureDTO(sig)
}

// ClusterEdgeSignatureMatchesBridge invokes the real clusterEdgeSignature.matches method.
func ClusterEdgeSignatureMatchesBridge(sig1, sig2 ClusterEdgeSignatureDTO) bool {
	s1 := fromSignatureDTO(sig1)
	s2 := fromSignatureDTO(sig2)
	return s1.matches(s2)
}

// ClusterIsDescendantOfGuardedBridge exposes the real clusterIsDescendantOfGuarded helper.
func ClusterIsDescendantOfGuardedBridge(
	descendant, ancestor *layoutgraph.Node,
	guard *limits.WorkGuard,
) (bool, error) {
	return clusterIsDescendantOfGuarded(descendant, ancestor, guard)
}

// ClusterHasLeakyEdgeGuardedBridge exposes the real clusterHasLeakyEdgeGuarded helper.
func ClusterHasLeakyEdgeGuardedBridge(
	g *layoutgraph.Graph,
	node *layoutgraph.Node,
	guard *limits.WorkGuard,
) (bool, error) {
	return clusterHasLeakyEdgeGuarded(g, node, guard)
}

// BuildClusterDiscoveryIndexBridge invokes buildClusterDiscoveryIndex and retains the real private index.
func BuildClusterDiscoveryIndexBridge(
	g *layoutgraph.Graph,
	containerOrder []*layoutgraph.Node,
	guard *limits.WorkGuard,
) (*ClusterDiscoveryIndexBridge, error) {
	idx, err := buildClusterDiscoveryIndex(g, containerOrder, guard)
	if err != nil {
		return nil, err
	}
	return &ClusterDiscoveryIndexBridge{index: idx}, nil
}

// SequenceOriginalBridge invokes the real clusterDiscoveryIndex.sequenceOriginal method.
func (b *ClusterDiscoveryIndexBridge) SequenceOriginalBridge(
	sequence *layoutgraph.Sequence,
	edge *layoutgraph.Edge,
	guard *limits.WorkGuard,
) (*layoutgraph.Node, error) {
	return b.index.sequenceOriginal(sequence, edge, guard)
}

// RefreshNeighborsBridge invokes the real clusterDiscoveryIndex.refreshNeighbors method.
func (b *ClusterDiscoveryIndexBridge) RefreshNeighborsBridge(
	g *layoutgraph.Graph,
	node *layoutgraph.Node,
	guard *limits.WorkGuard,
) error {
	return b.index.refreshNeighbors(g, node, guard)
}

// RefreshAfterClusterAbductionBridge invokes the real clusterDiscoveryIndex.refreshAfterClusterAbduction method.
func (b *ClusterDiscoveryIndexBridge) RefreshAfterClusterAbductionBridge(
	g *layoutgraph.Graph,
	cluster *layoutgraph.Cluster,
	edges []*layoutgraph.Edge,
	guard *limits.WorkGuard,
) error {
	return b.index.refreshAfterClusterAbduction(g, cluster, edges, guard)
}

// ClusterIncidentEdgesBridge operates directly on the real b.index.infos and b.index.edgeOrder.
func (b *ClusterDiscoveryIndexBridge) ClusterIncidentEdgesBridge(
	cluster *layoutgraph.Cluster,
	guard *limits.WorkGuard,
) ([]*layoutgraph.Edge, error) {
	return clusterIncidentEdges(cluster, b.index.infos, b.index.edgeOrder, guard)
}

// GetInfoDTO returns a serializable snapshot of the discovery info for node.
func (b *ClusterDiscoveryIndexBridge) GetInfoDTO(node *layoutgraph.Node) *ClusterDiscoveryInfoDTO {
	info := b.index.infos[node]
	if info == nil {
		return nil
	}

	neighborIDs := make([]string, 0, len(info.neighbors))
	for _, n := range info.neighbors {
		if n != nil {
			neighborIDs = append(neighborIDs, fmt.Sprintf("%d", n.ID))
		} else {
			neighborIDs = append(neighborIDs, "")
		}
	}

	edgeIDs := make([]string, 0, len(info.edges))
	for _, e := range info.edges {
		if e != nil {
			edgeIDs = append(edgeIDs, fmt.Sprintf("%d", e.ID))
		}
	}

	return &ClusterDiscoveryInfoDTO{
		Neighbors:       neighborIDs,
		Edges:           edgeIDs,
		EdgeSignature:   toSignatureDTO(info.edgeSignature),
		EstimatedWidth:  info.estimatedWidth,
		EstimatedHeight: info.estimatedHeight,
		NoClustering:    info.noClustering,
		ToTableColumn:   info.toTableColumn,
	}
}

// HasInfo reports whether node has an entry in index.infos.
func (b *ClusterDiscoveryIndexBridge) HasInfo(node *layoutgraph.Node) bool {
	return b.index.infos[node] != nil
}

// SignaturesMatch invokes matches on the real private edgeSignatures for n1 and n2.
func (b *ClusterDiscoveryIndexBridge) SignaturesMatch(n1, n2 *layoutgraph.Node) bool {
	i1 := b.index.infos[n1]
	i2 := b.index.infos[n2]
	if i1 == nil || i2 == nil {
		return false
	}
	return i1.edgeSignature.matches(i2.edgeSignature)
}
