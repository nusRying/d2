// Pinned reference: internal/hierarchy/compound.go
//
// Go map iteration with early return: PlaceCompound ranges over
// g.NodeToTree and returns (false, nil) at the first node without an owner.
// The outcome is identical in any order, but the number of transaction work
// steps charged before that return is unspecified in Go; JS uses Map
// insertion order.
//
// orderCompoundInterfaces sorts each rank row with slices.SortFunc (unstable)
// by the row coordinate. Place lays blocks of one rank out left to right with
// positive spacing, so coordinates within a row are distinct and the order is
// unique.

import { Point } from '../geometry/point.js';
import { Orientation, isHorizontal as orientationIsHorizontal } from '../geometry/orientation.js';
import { MAX_GRAPH_SIZE } from '../limits/constants.js';
import { Validate } from '../graph/topology-preflight.js';
import { newGraphStateSnapshot } from '../graph/graph-state.js';
import { newGraph } from '../graph/graph.js';
import { Node } from '../graph/node.js';
import { newHierarchy } from '../graph/hierarchy.js';
import { hierarchyLevel } from '../graph/structural-access.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { candidates } from './eligibility.js';
import { build, countEdgeDirection } from './discovery.js';
import { place } from './placement.js';
import { MAX_COMPOUND_BLOCKS, MAX_COMPOUND_INTERFACES } from './constants.js';
import { copyLabel, nodesBounds } from './layoutgraph-support.js';

export class CompoundBlock {
  constructor(original, proxy) {
    this.original = original;
    this.proxy = proxy;
    this.members = [];
  }
}

export class CompoundInterface {
  constructor(from, to, fromOffset, toOffset) {
    this.from = from;
    this.to = to;
    this.fromOffset = fromOffset;
    this.toOffset = toOffset;
  }
}

function rootChildren(g) {
  return g.Containers.get(null) ?? [];
}

/**
 * PlaceCompound lays out the outer flow of detailed containers after their
 * interiors have been placed, preserving every interior coordinate relative
 * to its container. Returns whether the graph changed; errors throw.
 */
export function placeCompound(ctx, g, random) {
  Validate(ctx, 'PlaceCompound', g);
  const roots = rootChildren(g);
  if (roots.length < 3 || roots.length > MAX_COMPOUND_BLOCKS) {
    return false;
  }
  const [txCtx, guard] = ensureTransactionWorkGuard(ctx, 'PlaceCompoundTransactions');
  const proxy = newGraph();
  proxy.Directions.set(null, g.direction(null));
  const blocks = [];
  const byRoot = new Map();
  for (const root of roots) {
    guard.Step();
    const n = new Node(root.ID, root.Width, root.Height);
    n.TopLeft = root.TopLeft.copy();
    proxy.AddNewNodeToContainer(null, n);
    const block = new CompoundBlock(root, n);
    blocks.push(block);
    byRoot.set(root, block);
  }
  const owner = new Map();
  for (const node of g.Nodes) {
    guard.Step();
    // Absolute coordinates and active grouping vessels are not rigid-block input.
    if (node.FixedTopLeft != null || g.isSequenceVessel(node) || node.IsClusterVessel()) {
      return false;
    }
    let root = node;
    while (root.Container != null) {
      guard.Step();
      root = root.Container;
    }
    const block = byRoot.get(root);
    if (block == null) {
      return false;
    }
    block.members.push(node);
    owner.set(node, block);
  }
  // Trees must already be restored into the ordinary node collection.
  for (const node of g.NodeToTree.keys()) {
    guard.Step();
    if (owner.get(node) == null) {
      return false;
    }
  }
  const interfaces = [];
  let detailed = false;
  for (const edge of g.Edges) {
    guard.Step();
    const from = owner.get(edge.From) ?? null;
    const to = owner.get(edge.To) ?? null;
    if (from == null || to == null) {
      return false;
    }
    if (from === to) {
      detailed = detailed || (from.original.IsContainer() && edge.From !== edge.To);
      continue;
    }
    if (interfaces.length === MAX_COMPOUND_INTERFACES) {
      return false;
    }
    const e = proxy.Connect(from.proxy, to.proxy);
    e.ID = edge.ID;
    e.SourceArrowhead = edge.SourceArrowhead;
    e.TargetArrowhead = edge.TargetArrowhead;
    if (edge.Label != null) {
      e.Label = copyLabel(edge.Label);
    }
    interfaces.push(new CompoundInterface(
      from,
      to,
      compoundEndpointOffset(edge.From, from.original, edge.FromTableColumnIndex),
      compoundEndpointOffset(edge.To, to.original, edge.ToTableColumnIndex),
    ));
  }
  if (!detailed || !compoundConnected(blocks, interfaces)) {
    return false;
  }
  // Rank only this isolated proxy, then retain the compound proposal's
  // original directed backbone requirement.
  const outerHierarchy = build(txCtx, proxy, true, candidates(proxy), null);
  if (outerHierarchy == null) {
    return false;
  }
  const [forward, other] = countEdgeDirection(outerHierarchy, proxy);
  if (outerHierarchy.LevelCount < 2 || forward === 0 || forward < 1.5 * other) {
    return false;
  }
  for (const node of proxy.Nodes) {
    guard.Step();
    node.Hierarchy = outerHierarchy;
  }
  place(txCtx, proxy, null, random);
  orderCompoundInterfaces(blocks, interfaces, orientationIsHorizontal(proxy.direction(null)), guard);
  const [tl, br] = nodesBounds(proxy.Nodes);
  if (br.X - tl.X > MAX_GRAPH_SIZE || br.Y - tl.Y > MAX_GRAPH_SIZE) {
    return false;
  }
  // All planning is isolated. Snapshot only when there is an applicable plan,
  // and keep mutations atomic even if cancellation arrives during translation.
  const state = newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, guard);
  let complete = false;
  try {
    const [originalTL] = nodesBounds(rootChildren(g));
    const h = newHierarchy();
    h.LevelCount = proxy.Nodes[0].Hierarchy.LevelCount;
    for (const block of blocks) {
      guard.Step();
      const dx = block.proxy.TopLeft.X - tl.X + originalTL.X - block.original.TopLeft.X;
      const dy = block.proxy.TopLeft.Y - tl.Y + originalTL.Y - block.original.TopLeft.Y;
      for (const member of block.members) {
        guard.Step();
        member.translate(dx, dy);
      }
      // Only the opaque block belongs to the outer hierarchy.
      const previous = block.original.Hierarchy;
      if (previous != null) {
        previous.Levels().delete(block.original);
      }
      block.original.Hierarchy = h;
      h.Levels().set(block.original, hierarchyLevel(block.proxy));
    }
    guard.Finish();
    complete = true;
    return true;
  } finally {
    if (!complete) {
      state.rollback(g);
    }
  }
}

export const PlaceCompound = placeCompound;

export function compoundEndpointOffset(endpoint, block, column) {
  let center = endpoint.center();
  if (column != null && endpoint.isTable()) {
    const [port, ok] = endpoint.tableColumnPortValue(Orientation.Right, column);
    if (ok) {
      center = port;
    }
  }
  return new Point(
    Math.max(0, Math.min(block.Width, center.X - block.TopLeft.X)),
    Math.max(0, Math.min(block.Height, center.Y - block.TopLeft.Y)),
  );
}

export function compoundConnected(blocks, interfaces) {
  const adjacent = new Map();
  const add = (a, b) => {
    let list = adjacent.get(a);
    if (list == null) {
      list = [];
      adjacent.set(a, list);
    }
    list.push(b);
  };
  for (const edge of interfaces) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  const seen = new Set([blocks[0]]);
  const queue = [blocks[0]];
  for (let head = 0; head < queue.length; head++) {
    const block = queue[head];
    for (const next of adjacent.get(block) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === blocks.length;
}

/**
 * orderCompoundInterfaces refines the center-based layered ordering using
 * actual boundary offsets with at most two adjacent-swap sweeps.
 */
export function orderCompoundInterfaces(blocks, interfaces, horizontal, guard) {
  const levels = new Map();
  for (const block of blocks) {
    const level = hierarchyLevel(block.proxy);
    let row = levels.get(level);
    if (row == null) {
      row = [];
      levels.set(level, row);
    }
    row.push(block);
  }
  const axis = horizontal ? 'Y' : 'X';
  const coordinate = (b) => b.proxy.TopLeft[axis];
  const setCoordinate = (b, value) => {
    b.proxy.TopLeft[axis] = value;
  };
  const size = (b) => (horizontal ? b.proxy.Height : b.proxy.Width);
  const levelCount = blocks[0].proxy.Hierarchy.LevelCount;
  for (let level = 0; level < levelCount; level++) {
    const row = levels.get(level);
    if (row == null) {
      continue;
    }
    row.sort((a, b) => {
      const ax = coordinate(a);
      const bx = coordinate(b);
      if (ax < bx) return -1;
      if (ax > bx) return 1;
      return 0;
    });
  }
  let score = compoundInterfaceScore(interfaces, horizontal, guard);
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (let level = 0; level < levelCount; level++) {
      const row = levels.get(level) ?? [];
      for (let i = 0; i + 1 < row.length; i++) {
        guard.Step();
        const a = row[i];
        const b = row[i + 1];
        const aw = size(a);
        const bw = size(b);
        const oldA = coordinate(a);
        const oldB = coordinate(b);
        setCoordinate(a, oldB + bw - aw);
        setCoordinate(b, oldA);
        const candidate = compoundInterfaceScore(interfaces, horizontal, guard);
        if (candidate.crossings < score.crossings || (candidate.crossings === score.crossings && candidate.span < score.span)) {
          score = candidate;
          row[i] = b;
          row[i + 1] = a;
          improved = true;
        } else {
          setCoordinate(a, oldA);
          setCoordinate(b, oldB);
        }
      }
    }
    if (!improved) {
      break;
    }
  }
  guard.Finish();
}

export function compoundInterfaceScore(interfaces, horizontal, guard) {
  const score = { crossings: 0, span: 0 };
  const segments = new Array(interfaces.length);
  for (let i = 0; i < interfaces.length; i++) {
    const edge = interfaces[i];
    guard.Step();
    const from = edge.from.proxy;
    const to = edge.to.proxy;
    const a = { X: from.TopLeft.X + edge.fromOffset.X, Y: from.TopLeft.Y + edge.fromOffset.Y };
    const b = { X: to.TopLeft.X + edge.toOffset.X, Y: to.TopLeft.Y + edge.toOffset.Y };
    if (horizontal) {
      if (from.center().X < to.center().X) {
        a.X = from.TopLeft.X + from.Width;
        b.X = to.TopLeft.X;
      } else {
        a.X = from.TopLeft.X;
        b.X = to.TopLeft.X + to.Width;
      }
      score.span += Math.abs(a.Y - b.Y);
    } else {
      if (from.center().Y < to.center().Y) {
        a.Y = from.TopLeft.Y + from.Height;
        b.Y = to.TopLeft.Y;
      } else {
        a.Y = from.TopLeft.Y;
        b.Y = to.TopLeft.Y + to.Height;
      }
      score.span += Math.abs(a.X - b.X);
    }
    segments[i] = { a, b };
  }
  const orientation = (a, b, c) => (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      guard.Step();
      if (orientation(a.a, a.b, b.a) * orientation(a.a, a.b, b.b) < 0 && orientation(b.a, b.b, a.a) * orientation(b.a, b.b, a.b) < 0) {
        score.crossings++;
      }
    }
  }
  return score;
}
