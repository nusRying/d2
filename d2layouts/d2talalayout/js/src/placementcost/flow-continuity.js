import { goHypot } from '../geometry/go-math.js';
const FLOW_SPINE_WEIGHT = 1.0;
const FLOW_BRANCH_WEIGHT = 1.0;

const INCOMING_DIRECTION = 1;
const OUTGOING_DIRECTION = 2;

/**
 * flowContinuityCost treats paths through a node as a visual unit.
 * Pinned Go: placementcost.flowContinuityCost
 *
 * @param {import('../graph/node.js').Node} node
 * @param {object} s edgeScratch
 * @returns {number}
 */
export function flowContinuityCost(node, s) {
  if (node == null || node.TopLeft == null || !node.Edges || node.Edges.length < 2 || node.Edges.length > 8 ||
    node.Cluster != null || node.Sequence != null || node.HerdAssignment != null) {
    return 0;
  }

  if (node.Graph != null && node.Graph.Containers != null) {
    const children = node.Graph.Containers instanceof Map
      ? node.Graph.Containers.get(node)
      : node.Graph.Containers[node];
    if (children != null && children.length > 0) {
      return 0;
    }
  }

  const rays = [];
  const cx = node.TopLeft.X + node.Width / 2;
  const cy = node.TopLeft.Y + node.Height / 2;

  const nRepl = s?.nRepl ?? [];
  const aRepl = s?.aRepl ?? [];

  for (let i = 0; i < node.Edges.length; i++) {
    const e = node.Edges[i];
    const nodeReplacement = nRepl[i] ?? node;
    if (e.IsInvisible || e.From === e.To || e.HasTableColumn() ||
      e.hasSourceArrow() === e.hasTargetArrow() || nodeReplacement !== node) {
      continue;
    }

    const adj = aRepl[i] ?? node.adjacent(e);
    if (adj == null || adj.TopLeft == null || adj.Container !== node.Container) {
      continue;
    }

    let incoming = e.To === node;
    if (e.hasSourceArrow()) {
      incoming = !incoming;
    }
    const direction = incoming ? INCOMING_DIRECTION : OUTGOING_DIRECTION;

    let duplicate = false;
    for (let j = 0; j < rays.length; j++) {
      if (rays[j].node === adj) {
        // Parallel edges share one geometric ray. Reciprocal edges
        // retain both roles regardless of their declaration order.
        rays[j].directions |= direction;
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      continue;
    }

    const x = adj.TopLeft.X + adj.Width / 2 - cx;
    const y = adj.TopLeft.Y + adj.Height / 2 - cy;
    const length = goHypot(x, y);
    if (length === 0) {
      continue;
    }

    rays.push({
      node: adj,
      x: x / length,
      y: y / length,
      directions: direction,
    });
  }

  let spine = Infinity;
  let branchSum = 0.0;
  let branches = 0;
  const n = rays.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dot = Math.max(-1, Math.min(1, rays[i].x * rays[j].x + rays[i].y * rays[j].y));
      const a = rays[i].directions;
      const b = rays[j].directions;

      if ((a & INCOMING_DIRECTION && b & OUTGOING_DIRECTION) ||
        (a & OUTGOING_DIRECTION && b & INCOMING_DIRECTION)) {
        spine = Math.min(spine, 1 + dot);
      }
      if ((a & b) !== 0) {
        // Directions less than 60 degrees apart compete for a small
        // visual wedge at the attachment; wider angles incur no cost.
        branchSum += Math.max(0, 2 * dot - 1);
        branches++;
      }
    }
  }

  let cost = 0.0;
  if (Number.isFinite(spine)) {
    cost += FLOW_SPINE_WEIGHT * spine;
  }
  if (branches > 0) {
    cost += FLOW_BRANCH_WEIGHT * branchSum / branches;
  }

  const turnCost = typeof node.Graph?.TurnCost === 'function'
    ? node.Graph.TurnCost()
    : (typeof node.Graph?.turnCostValue === 'function'
      ? node.Graph.turnCostValue()
      : 0);

  return turnCost * cost;
}
