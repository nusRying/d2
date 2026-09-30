//go:build tala_cluster_mutation_oracle

package grouping

import (
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
)

// AbductClusterEdgesBridge exposes the private abductClusterEdges helper for oracle testing.
func AbductClusterEdgesBridge(
	cluster *layoutgraph.Cluster,
	edges []*layoutgraph.Edge,
	guard *limits.WorkGuard,
) error {
	return abductClusterEdges(cluster, edges, guard)
}
