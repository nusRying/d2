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
   * resize makes the cluster nodes consistent in size, and sizes the vessel to exact fit of cluster nodes.
   * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/cluster.go
   */
  resize(vessel) {
    if (vessel == null) {
      throw new Error('cluster is missing its vessel');
    }
    const nodes = this.Nodes || [];
    if (!this.FixedSize) {
      const [nodeWidth, nodeHeight] = this._maximums();
      for (const node of nodes) {
        node.Width = nodeWidth;
        node.Height = nodeHeight;
      }
    }
    const [nodeWidth, nodeHeight] = this._maximums();
    const padding = typeof this.Padding === 'number' ? this.Padding : 0;
    if (this.Arrangement === ClusterArrangement.Row) {
      vessel.Width = nodeWidth * nodes.length + padding * (nodes.length - 1);
      vessel.Height = nodeHeight;
    } else if (this.Arrangement === ClusterArrangement.Column) {
      vessel.Width = nodeWidth;
      vessel.Height = nodeHeight * nodes.length + padding * (nodes.length - 1);
    }
  }

  Resize(vessel) {
    this.resize(vessel);
  }

  _maximums() {
    let maxWidth = 0.0;
    let maxHeight = 0.0;
    const nodes = this.Nodes || [];
    for (const node of nodes) {
      if (node == null) {
        throw new Error('cluster contains a nil node');
      }
      maxWidth = Math.max(maxWidth, node.Width);
    }
    for (const node of nodes) {
      if (node == null) {
        throw new Error('cluster contains a nil node');
      }
      maxHeight = Math.max(maxHeight, node.Height);
    }
    return [maxWidth, maxHeight];
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
