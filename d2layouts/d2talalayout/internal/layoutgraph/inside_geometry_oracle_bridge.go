//go:build tala_inside_geometry_oracle

package layoutgraph

// OracleSpacing constructs Spacing with asymmetric values for oracle generation.
func OracleSpacing(top, bottom, left, right float64) Spacing {
	return Spacing{top: top, bottom: bottom, left: left, right: right}
}
