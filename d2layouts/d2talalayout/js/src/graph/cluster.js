/**
 * Cluster represents a grouping of nodes arranged in a row or column.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/cluster.go
 */

export const ClusterArrangement = Object.freeze({
  Row: 'Row',
  Column: 'Column',
});

/**
 * flipArrangement flips between Row and Column.
 * Go behavior: Row -> Column; anything else -> Row.
 */
export function flipArrangement(arrangement) {
  if (arrangement === ClusterArrangement.Row) {
    return ClusterArrangement.Column;
  }
  return ClusterArrangement.Row;
}

export class Cluster {
  Vessel = null;
  Nodes = [];
  Arrangement = '';
  DesiredArrangement = '';
  Graph = null;
  EdgeAbductions = [];
  Padding = 0;
  FixedSize = false;
  Container = null;

  constructor(fields = {}) {
    if (fields.Vessel !== undefined) this.Vessel = fields.Vessel;
    if (fields.Nodes !== undefined) this.Nodes = fields.Nodes;
    if (fields.Arrangement !== undefined) this.Arrangement = fields.Arrangement;
    if (fields.DesiredArrangement !== undefined) this.DesiredArrangement = fields.DesiredArrangement;
    if (fields.Graph !== undefined) this.Graph = fields.Graph;
    if (fields.EdgeAbductions !== undefined) this.EdgeAbductions = fields.EdgeAbductions;
    if (fields.Padding !== undefined) this.Padding = fields.Padding;
    if (fields.FixedSize !== undefined) this.FixedSize = fields.FixedSize;
    if (fields.Container !== undefined) this.Container = fields.Container;
  }

  /**
   * flip changes Arrangement between Row and Column.
   */
  flip() {
    this.Arrangement = flipArrangement(this.Arrangement);
  }

  Flip() {
    this.flip();
  }

  /**
   * isActive reports whether the cluster is actively part of layout.
   * Exact Go semantics: cluster != nil && cluster.Vessel.Graph != nil
   */
  isActive() {
    return this.Vessel != null && this.Vessel.Graph != null;
  }

  IsActive() {
    return this.isActive();
  }
}
