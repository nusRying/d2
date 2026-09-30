//go:build tala_add_clusters_oracle

package layoutgraph

// SetNodeMarginForOracle sets node.margin for oracle test cases.
func SetNodeMarginForOracle(node *Node, top, bottom, left, right float64) {
	if node != nil {
		node.margin = Spacing{top: top, bottom: bottom, left: left, right: right}
	}
}

// SetNodePaddingForOracle sets node.padding for oracle test cases.
func SetNodePaddingForOracle(node *Node, top, bottom, left, right float64) {
	if node != nil {
		node.padding = Spacing{top: top, bottom: bottom, left: left, right: right}
	}
}
