/**
 * EdgeAbduction represents the temporary transfer of an edge from a descendant
 * container to an ancestor child so node placement can operate on containers.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/layout.go
 */
export class EdgeAbduction {
  Edge = null;
  OriginallyFrom = null;
  OriginallyTo = null;
  CurrentFrom = null;
  CurrentTo = null;

  constructor(fields = {}) {
    if (fields.Edge !== undefined) this.Edge = fields.Edge;
    if (fields.OriginallyFrom !== undefined) this.OriginallyFrom = fields.OriginallyFrom;
    if (fields.OriginallyTo !== undefined) this.OriginallyTo = fields.OriginallyTo;
    if (fields.CurrentFrom !== undefined) this.CurrentFrom = fields.CurrentFrom;
    if (fields.CurrentTo !== undefined) this.CurrentTo = fields.CurrentTo;
  }
}
