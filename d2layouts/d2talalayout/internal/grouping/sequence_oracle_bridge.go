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

// ClearRememberedSequenceMembershipBridge exposes private clearRememberedSequenceMembership for the test oracle.
func ClearRememberedSequenceMembershipBridge(sequence *layoutgraph.Sequence, guard *limits.WorkGuard) error {
	return clearRememberedSequenceMembership(sequence, guard)
}

// BuildSequenceBridge exposes private buildSequence for the test oracle.
func BuildSequenceBridge(steps []*layoutgraph.Node, graph *layoutgraph.Graph, container *layoutgraph.Node, id layoutgraph.EntityID) *layoutgraph.Sequence {
	return buildSequence(steps, graph, container, id)
}

// AddSequenceBridge exposes private addSequence for the test oracle.
func AddSequenceBridge(graph *layoutgraph.Graph, sequence *layoutgraph.Sequence) {
	addSequence(graph, sequence)
}

// AbductSequenceEdgesBridge exposes private abductSequenceEdges for the test oracle.
func AbductSequenceEdgesBridge(sequence *layoutgraph.Sequence) {
	abductSequenceEdges(sequence)
}
