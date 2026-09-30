//go:build tala_add_clusters_oracle

package grouping

import (
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
)

// AverageClusterDimensionsBridge exposes the private averageClusterDimensions
// helper for real-Go oracle verification.
func AverageClusterDimensionsBridge(cluster *layoutgraph.Cluster) (width, height float64) {
	return averageClusterDimensions(cluster)
}
