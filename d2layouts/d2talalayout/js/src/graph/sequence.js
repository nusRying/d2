/**
 * Sequence represents an ordered sequence of step nodes owned by a sequence vessel.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/sequence.go
 */
export class Sequence {
  Vessel = null;
  Nodes = [];
  Graph = null;
  EdgeAbductions = [];
  Container = null;

  constructor(fields = {}) {
    if (fields.Vessel !== undefined) this.Vessel = fields.Vessel;
    if (fields.Nodes !== undefined) this.Nodes = fields.Nodes;
    if (fields.Graph !== undefined) this.Graph = fields.Graph;
    if (fields.EdgeAbductions !== undefined) this.EdgeAbductions = fields.EdgeAbductions;
    if (fields.Container !== undefined) this.Container = fields.Container;
  }

  /**
   * isActive reports whether the sequence is actively part of layout.
   * Exact Go semantics: s != nil && s.Vessel.Graph != nil
   */
  isActive() {
    return this.Vessel != null && this.Vessel.Graph != null;
  }

  IsActive() {
    return this.isActive();
  }

  /**
   * first returns the first node in the sequence, or null if empty.
   */
  first() {
    if (!this.Nodes || this.Nodes.length === 0) {
      return null;
    }
    return this.Nodes[0];
  }

  First() {
    return this.first();
  }

  /**
   * last returns the last node in the sequence, or null if empty.
   */
  last() {
    if (!this.Nodes || this.Nodes.length === 0) {
      return null;
    }
    return this.Nodes[this.Nodes.length - 1];
  }

  Last() {
    return this.last();
  }
}
