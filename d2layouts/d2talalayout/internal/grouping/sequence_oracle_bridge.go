//go:build tala_sequence_oracle

package grouping

import (
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
)

// IdentifySequencesBridge exposes private identifySequences for the test oracle.
func IdentifySequencesBridge(graph *layoutgraph.Graph, nodes []*layoutgraph.Node, guard *limits.WorkGuard) ([][]*layoutgraph.Node, error) {
	return identifySequences(graph, nodes, guard)
}

// IsValidRememberedSequenceBridge exposes private isValidRememberedSequence for the test oracle.
func IsValidRememberedSequenceBridge(
	graph *layoutgraph.Graph,
	vessel *layoutgraph.Node,
	sequence *layoutgraph.Sequence,
	activeNodes map[*layoutgraph.Node]struct{},
	guard *limits.WorkGuard,
) (bool, error) {
	return isValidRememberedSequence(graph, vessel, sequence, activeNodes, guard)
}

// HasNodeIDBridge exposes private hasNodeID for the test oracle.
func HasNodeIDBridge(graph *layoutgraph.Graph, id layoutgraph.EntityID) bool {
	return hasNodeID(graph, id)
}

// NextAvailableNodeIDBridge exposes private nextAvailableNodeID for the test oracle.
func NextAvailableNodeIDBridge(graph *layoutgraph.Graph, candidate layoutgraph.EntityID, unavailable map[layoutgraph.EntityID]struct{}) layoutgraph.EntityID {
	return nextAvailableNodeID(graph, candidate, unavailable)
}
