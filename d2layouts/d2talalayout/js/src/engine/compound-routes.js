// Slice 50 — preserve compound interior routes after compound re-placement.
//
// Pinned reference: d2layouts/d2talalayout/internal/engine/compound_routes.go

import { Clone } from '../graph/clone.js';
import { Point } from '../geometry/point.js';
import { Label } from '../graph/label.js';
import { Icon } from '../graph/icon.js';
import { LabelPosition } from '../graph/label-position.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { getContextError } from '../limits/work-context.js';
import { WorkGuard } from '../limits/work-guard.js';
import { ArrowheadTopLeft } from '../labeling/arrowhead.js';
import { Place as placeLabels } from '../labeling/placement.js';
import { normalize } from '../placement/stage-geometry.js';
import { nodeContainsPointOnBox } from '../routing/layoutgraph-routing-support.js';

/** Go struct copy `copied := *original.Label` (fixed bookkeeping included). */
function copyLabelStruct(source) {
  return Object.assign(Object.create(Label.prototype), source);
}

function copyIconStruct(source) {
  return Object.assign(Object.create(Icon.prototype), source);
}

/**
 * PreserveCompoundRoutes clones `selected` and restores interior routes,
 * curve flags and fixed label/icon state from `before` where the original
 * route stays enclosed in its top-level container.
 */
export function PreserveCompoundRoutes(ctx, before, selected) {
  const candidate = Clone(ctx, selected);
  for (let index = 0; index < candidate.Edges.length; index++) {
    candidate.Edges[index].IsCurve = selected.Edges[index].IsCurve;
  }
  preserveCompoundInteriors(ctx, before, candidate);
  return candidate;
}

export function preserveCompoundInteriors(ctx, before, after) {
  const guard = new WorkGuard(ctx, 'CompoundRoutes', MAX_ENGINE_WORK_UNITS);
  for (let index = 0; index < after.Nodes.length; index++) {
    const node = after.Nodes[index];
    const original = before.Nodes[index];
    if (original.Label != null && original.Label.PositionFixed()) {
      node.Label = copyLabelStruct(original.Label);
    }
    if (original.Icon != null && original.Icon.PositionFixed()) {
      node.Icon = copyIconStruct(original.Icon);
    }
  }
  for (let index = 0; index < after.Edges.length; index++) {
    const ctxErr = getContextError(ctx);
    if (ctxErr != null) throw ctxErr;
    const edge = after.Edges[index];
    const original = before.Edges[index];
    if (original.Label != null && original.Label.PositionFixed()) {
      edge.Label = copyLabelStruct(original.Label);
      edge.LabelPercentage = original.LabelPercentage;
    }
    if (compoundEnclosedRoute(original, guard)) {
      const oldRoot = compoundRoot(original.From);
      const newRoot = compoundRoot(edge.From);
      const dx = newRoot.TopLeft.X - oldRoot.TopLeft.X;
      const dy = newRoot.TopLeft.Y - oldRoot.TopLeft.Y;
      edge.Points = new Array(original.Points.length);
      for (let i = 0; i < original.Points.length; i++) {
        guard.Step();
        const point = original.Points[i];
        edge.Points[i] = new Point(point.X + dx, point.Y + dy);
      }
      edge.IsCurve = original.IsCurve;
      edge.LabelPercentage = original.LabelPercentage;
      if (original.Label != null) {
        edge.Label = copyLabelStruct(original.Label);
      }
    }
  }
  after.ResetPlacementCosts();
  placeLabels(ctx, after);
  normalize(after);
  guard.Finish();
}

export function compoundRoot(node) {
  while (node.Container != null) node = node.Container;
  return node;
}

export function compoundEnclosedRoute(edge, guard) {
  const root = compoundRoot(edge.From);
  if (!root.IsContainer() || root !== compoundRoot(edge.To) || edge.Points.length < 2) {
    return false;
  }
  // Pinned check: NaN rejection plus closed-box containment.
  const inside = (point, width, height) => point != null && !Number.isNaN(point.X) && !Number.isNaN(point.Y) &&
    point.X >= root.TopLeft.X && point.Y >= root.TopLeft.Y &&
    point.X + width <= root.TopLeft.X + root.Width && point.Y + height <= root.TopLeft.Y + root.Height;
  for (const point of edge.Points) {
    guard.Step();
    if (!inside(point, 0, 0)) return false;
  }
  const attached = (node, point) => nodeContainsPointOnBox(node, point) &&
    (point.X === node.TopLeft.X || point.X === node.TopLeft.X + node.Width ||
      point.Y === node.TopLeft.Y || point.Y === node.TopLeft.Y + node.Height);
  if (!attached(edge.From, edge.Points[0]) || !attached(edge.To, edge.Points[edge.Points.length - 1])) {
    return false;
  }
  if (edge.Label != null) {
    if (edge.Label.Position === LabelPosition.Unset) return false;
    guard.Add(edge.Points.length);
    if (!inside(edge.LabelTopLeft(edge.Label.Position, edge.Label.Width, edge.Label.Height), edge.Label.Width, edge.Label.Height)) {
      return false;
    }
  }
  const arrowLabels = [edge.SourceArrowheadLabel, edge.TargetArrowheadLabel];
  for (let i = 0; i < arrowLabels.length; i++) {
    const arrowLabel = arrowLabels[i];
    if (arrowLabel == null) continue;
    guard.Add(edge.Points.length);
    const point = ArrowheadTopLeft(edge.Points, i === 1, String(edge.SourceArrowhead), String(edge.TargetArrowhead), arrowLabel.Width, arrowLabel.Height);
    if (!inside(point, arrowLabel.Width, arrowLabel.Height)) return false;
  }
  return true;
}
