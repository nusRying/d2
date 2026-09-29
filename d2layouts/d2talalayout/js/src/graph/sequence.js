import { Point } from '../geometry/point.js';
import { STEP_WEDGE_WIDTH } from '../shape/constants.js';
import { unmeteredGroupGeometry } from './group-geometry.js';

/**
 * SequenceAdvance is the horizontal distance from one step's top-left to
 * the next. The rendered Step shape clamps its wedge to half of the width when
 * the requested width is at most STEP_WEDGE_WIDTH, so fixed-size narrow steps
 * must use the same geometry instead of always overlapping by the full wedge.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/sequence.go
 */
export function sequenceAdvance(width) {
  if (width <= 0) {
    return 0;
  }
  let wedge = STEP_WEDGE_WIDTH;
  if (width <= wedge) {
    wedge = width / 2;
  }
  return width - wedge;
}

export const SequenceAdvance = sequenceAdvance;

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
   * first returns the first node in the sequence.
   * Throws if sequence has no nodes, matching Go panic behavior.
   */
  first() {
    if (!this.Nodes || this.Nodes.length === 0) {
      throw new Error("cannot get first node of empty sequence");
    }
    return this.Nodes[0];
  }

  First() {
    return this.first();
  }

  /**
   * last returns the last node in the sequence.
   * Throws if sequence has no nodes, matching Go panic behavior.
   */
  last() {
    if (!this.Nodes || this.Nodes.length === 0) {
      throw new Error("cannot get last node of empty sequence");
    }
    return this.Nodes[this.Nodes.length - 1];
  }

  Last() {
    return this.last();
  }

  /**
   * findAbductedNodeByEdge searches for the edge abduction related to the given edge and returns the original node.
   * Exact Go semantics:
   *   ea.CurrentFrom == s.Vessel -> OriginallyFrom
   *   ea.CurrentTo == s.Vessel -> OriginallyTo
   * When both endpoints match the vessel, CurrentFrom takes precedence.
   */
  findAbductedNodeByEdge(e) {
    if (!this.EdgeAbductions) return null;
    for (const ea of this.EdgeAbductions) {
      if (e !== ea.Edge) {
        continue;
      }
      if (ea.CurrentFrom === this.Vessel) {
        return ea.OriginallyFrom;
      }
      if (ea.CurrentTo === this.Vessel) {
        return ea.OriginallyTo;
      }
    }
    return null;
  }

  abductedNodeByEdge(edge) {
    return this.findAbductedNodeByEdge(edge);
  }

  AbductedNodeByEdge(edge) {
    return this.findAbductedNodeByEdge(edge);
  }

  /**
   * SyncGeometry resizes the sequence vessel and arranges its visible steps.
   */
  syncGeometry() {
    this.syncGeometryWithWork(unmeteredGroupGeometry);
  }

  SyncGeometry() {
    this.syncGeometry();
  }

  /**
   * SyncGeometryWithWork resizes the sequence vessel and arranges its visible
   * steps through caller-owned work accounting.
   *
   * Exact Go order:
   *   validate work != nil
   *   work.Step()
   *   validate s != nil && s.Vessel != nil
   *   resizeWithWork(work)
   *   arrangeStepsWithWork(work)
   */
  syncGeometryWithWork(work) {
    if (work == null) {
      throw new Error("sequence geometry requires work accounting");
    }
    work.Step();
    if (this == null || this.Vessel == null) {
      throw new Error("sequence is missing its vessel");
    }
    this.resizeWithWork(work);
    this.arrangeStepsWithWork(work);
  }

  SyncGeometryWithWork(work) {
    this.syncGeometryWithWork(work);
  }

  /**
   * resizeWithWork calculates the vessel dimensions based on step dimensions and advance.
   */
  resizeWithWork(work) {
    let width = 0.0;
    let offset = 0.0;
    let height = 0.0;
    if (this.Nodes) {
      for (const n of this.Nodes) {
        work.Step();
        if (n == null) {
          throw new Error("sequence contains a nil step");
        }
        width = Math.max(width, offset + Math.max(0, n.Width));
        offset += sequenceAdvance(n.Width);
        height = Math.max(height, Math.max(0, n.Height));
      }
    }
    this.Vessel.Width = width;
    this.Vessel.Height = height;
  }

  /**
   * ArrangeSteps places visible sequence steps relative to the vessel.
   */
  arrangeSteps() {
    this.arrangeStepsWithWork(unmeteredGroupGeometry);
  }

  ArrangeSteps() {
    this.arrangeSteps();
  }

  /**
   * arrangeStepsWithWork positions steps starting from Vessel.TopLeft.
   * If Vessel.TopLeft is null, finishes work and returns without altering step positions.
   */
  arrangeStepsWithWork(work) {
    if (this.Vessel.TopLeft == null) {
      work.Finish();
      return;
    }

    const tl = this.Vessel.TopLeft.copy();
    if (this.Nodes) {
      for (const n of this.Nodes) {
        work.Step();
        n.TopLeft = tl.copy();
        tl.X += sequenceAdvance(n.Width);
      }
    }
    work.Finish();
  }

  /**
   * PlaceVessel positions the sequence vessel at the top-left of its steps.
   * If any step has null TopLeft, returns immediately without modifying Vessel.TopLeft.
   * For empty sequences, positions Vessel.TopLeft at (+Infinity, +Infinity).
   */
  placeVessel() {
    const topLeft = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    if (this.Nodes) {
      for (const node of this.Nodes) {
        if (node.TopLeft == null) {
          return;
        }
        topLeft.X = Math.min(topLeft.X, node.TopLeft.X);
        topLeft.Y = Math.min(topLeft.Y, node.TopLeft.Y);
      }
    }
    this.Vessel.TopLeft = topLeft;
  }

  PlaceVessel() {
    this.placeVessel();
  }
}
