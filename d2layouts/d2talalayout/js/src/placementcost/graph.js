import { scoringCancellationError, checkScoringCancellation } from './geometry.js';
import { EdgeLengthOptions, nodeEdgeLength } from './edge-length.js';
import { columnCrossingCost, nodeSymmetry } from './symmetry.js';

export const invalidEdgeLengthState = 0n;

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

class Fnv64a {
  constructor() {
    this.hash = FNV_OFFSET_BASIS_64;
  }

  write(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      this.hash ^= BigInt(bytes[i]);
      this.hash = (this.hash * FNV_PRIME_64) & MASK_64;
    }
  }

  sum64() {
    return this.hash;
  }
}

/**
 * placementEdgeLengthState produces a 64-bit FNV-1a hash representing the graph's placement state.
 * Pinned Go: placementcost.placementEdgeLengthState
 *
 * @param {import('../graph/graph.js').Graph} graph
 * @param {{ Crossing: number, Turn: number, NonCenterPort: number }} costs
 * @param {EdgeLengthOptions} options
 * @returns {bigint}
 */
export function placementEdgeLengthState(graph, costs, options) {
  const h = new Fnv64a();
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  function writeFloat64(val) {
    view.setFloat64(0, val, true);
    h.write(bytes);
  }

  function writeUint64(val) {
    view.setBigUint64(0, BigInt(val), true);
    h.write(bytes);
  }

  // Process booleans
  let flags = 0;
  if (options.IncludeNodeSizes) {
    flags |= 1 << 0;
  }
  if (options.EnforceMinimumGap) {
    flags |= 1 << 1;
  }
  if (options.PenalizeDirection) {
    flags |= 1 << 2;
  }
  h.write([flags]);

  // Process graph costs
  writeFloat64(graph.CellSize);
  writeFloat64(costs.Turn ?? 0);
  writeFloat64(costs.NonCenterPort ?? 0);
  writeFloat64(costs.Crossing ?? 0);

  // Process nodes
  const nodes = graph.Nodes || [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.TopLeft == null) {
      return invalidEdgeLengthState;
    }
    writeUint64(n.ID);
    writeFloat64(n.TopLeft.X);
    writeFloat64(n.TopLeft.Y);
    writeFloat64(n.Width);
    writeFloat64(n.Height);

    const edges = n.Edges || [];
    for (let j = 0; j < edges.length; j++) {
      writeUint64(edges[j].ID);
    }
  }

  // Process edge abductions
  if (options.EdgeAbductions) {
    for (let i = 0; i < options.EdgeAbductions.length; i++) {
      const ea = options.EdgeAbductions[i];
      writeUint64(ea.Edge.ID);
      if (ea.OriginallyFrom != null) {
        writeUint64(ea.OriginallyFrom.ID);
      }
      if (ea.OriginallyTo != null) {
        writeUint64(ea.OriginallyTo.ID);
      }
      if (ea.CurrentTo != null) {
        writeUint64(ea.CurrentTo.ID);
      }
      if (ea.CurrentFrom != null) {
        writeUint64(ea.CurrentFrom.ID);
      }
    }
  }

  return h.sum64();
}

/**
 * SegmentsCross reports whether two finite segments intersect. Parallel and
 * overlapping segments do not count as crossings.
 * Pinned Go: layoutgraph.SegmentsCross
 *
 * @param {{ X: number, Y: number }} u0
 * @param {{ X: number, Y: number }} u1
 * @param {{ X: number, Y: number }} v0
 * @param {{ X: number, Y: number }} v1
 * @returns {boolean}
 */
export function segmentsCross(u0, u1, v0, v1) {
  const denom = (u1.Y - u0.Y) * (v1.X - v0.X) - (u1.X - u0.X) * (v1.Y - v0.Y);
  if (denom === 0) {
    return false;
  }
  const s = ((v1.X - v0.X) * (v0.Y - u0.Y) - (v1.Y - v0.Y) * (v0.X - u0.X)) / denom;
  if (s < 0 || s > 1) {
    return false;
  }
  const t = ((u1.X - u0.X) * (v0.Y - u0.Y) - (u1.Y - u0.Y) * (v0.X - u0.X)) / denom;
  return t >= 0 && t <= 1;
}

export const SegmentsCross = segmentsCross;

/**
 * countEdgeCrossingsExcludingSharedNodes counts crossings between edges not sharing any node.
 * Pinned Go: placementcost.countEdgeCrossingsExcludingSharedNodes
 *
 * @param {object} ctx
 * @param {import('../graph/edge.js').Edge[]} edges
 * @returns {number}
 */
export function countEdgeCrossingsExcludingSharedNodes(ctx, edges) {
  let crossings = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const err1 = scoringCancellationError(ctx, i);
    if (err1 != null) {
      throw err1;
    }
    const edge1 = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const err2 = scoringCancellationError(ctx, j - i - 1);
      if (err2 != null) {
        throw err2;
      }
      const edge2 = edges[j];

      // Skip if edges share a common node
      if (
        edge1.From === edge2.From || edge1.From === edge2.To ||
        edge1.To === edge2.From || edge1.To === edge2.To
      ) {
        continue;
      }

      const seg1Start = edge1.From.center();
      const seg1End = edge1.To.center();
      const seg2Start = edge2.From.center();
      const seg2End = edge2.To.center();

      if (segmentsCross(seg1Start, seg1End, seg2Start, seg2End)) {
        crossings++;
      }
    }
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return crossings;
}

/**
 * GraphEdgeCrossings counts crossings between edges that do not share a node.
 * Pinned Go: placementcost.GraphEdgeCrossings
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} graph
 * @returns {number}
 */
export function graphEdgeCrossings(ctx, graph) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  if (!graph.Edges || graph.Edges.length === 0) {
    return 0;
  }

  const levelGroups = new Map();
  for (let i = 0; i < graph.Edges.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const edge = graph.Edges[i];
    if (!edge.From || !edge.To || !edge.From.TopLeft || !edge.To.TopLeft) {
      continue;
    }
    const fromLevel = edge.From.containerLevel();
    const toLevel = edge.To.containerLevel();
    if (fromLevel !== toLevel) {
      continue;
    }

    let group = levelGroups.get(fromLevel);
    if (!group) {
      group = [];
      levelGroups.set(fromLevel, group);
    }
    group.push(edge);
  }

  let totalCrossings = 0;
  for (const group of levelGroups.values()) {
    const crossings = countEdgeCrossingsExcludingSharedNodes(ctx, group);
    totalCrossings += crossings;
  }

  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return totalCrossings;
}

export const GraphEdgeCrossings = graphEdgeCrossings;

/**
 * EdgeLength evaluates the graph's placement cost and may populate its
 * graph-owned edge-length cache.
 * Pinned Go: placementcost.EdgeLength
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} graph
 * @param {EdgeLengthOptions|object} options
 * @returns {number}
 */
export function edgeLength(ctx, graph, options = {}) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  const opts = options instanceof EdgeLengthOptions ? options : new EdgeLengthOptions(options);

  const costs = graph.routingCosts ? graph.routingCosts() : { Crossing: 0, Turn: 0, NonCenterPort: 0 };
  const edgeLengthState = placementEdgeLengthState(graph, costs, opts);

  if (edgeLengthState !== invalidEdgeLengthState && graph.lookupEdgeLengthCost) {
    const [d, ok] = graph.lookupEdgeLengthCost(edgeLengthState);
    if (ok) {
      return d;
    }
  }

  const symmetryCost = graph.CellSize;
  let totalSum = 0;

  for (const n of graph.Nodes || []) {
    let nl = nodeEdgeLength(ctx, n, opts);
    if (opts.IncludeNodeSizes) {
      const columnCrossingCostVal = columnCrossingCost(ctx, n, opts.EdgeAbductions);
      const symmetry = nodeSymmetry(ctx, n, opts.EdgeAbductions, true);
      nl += columnCrossingCostVal;
      nl -= symmetry * symmetryCost * (n.Edges ? n.Edges.length : 0);
    }
    const err = checkScoringCancellation(ctx);
    if (err != null) {
      throw err;
    }
    totalSum += nl;
  }

  const crossings = graphEdgeCrossings(ctx, graph);
  // Go: graph.CrossingCost() lazily computes and caches the crossing penalty.
  totalSum += graph.CrossingCost() * crossings;

  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }

  if (edgeLengthState !== invalidEdgeLengthState && graph.storeEdgeLengthCost) {
    graph.storeEdgeLengthCost(edgeLengthState, totalSum);
  }

  return totalSum;
}

export const EdgeLength = edgeLength;

/**
 * ContainerAlignmentCost scores misalignment between peer containers.
 * Pinned Go: placementcost.ContainerAlignmentCost
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} graph
 * @returns {number}
 */
export function containerAlignmentCost(ctx, graph) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  let l = 0.0;
  const nodes = graph.Nodes || [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const err1 = scoringCancellationError(ctx, i);
    if (err1 != null) {
      throw err1;
    }
    const n1 = nodes[i];
    if (!n1.IsContainer()) {
      continue;
    }
    for (let j = i + 1; j < nodes.length; j++) {
      const err2 = scoringCancellationError(ctx, j - i - 1);
      if (err2 != null) {
        throw err2;
      }
      const n2 = nodes[j];
      if (!n2.IsContainer()) {
        continue;
      }
      if (n1.effectiveContainer() !== n2.effectiveContainer()) {
        continue;
      }
      if (n1.Width === n2.Width && n1.Height === n2.Height) {
        if (n1.TopLeft.X !== n2.TopLeft.X && n1.TopLeft.Y !== n2.TopLeft.Y) {
          l += graph.nonCenterPortCostValue();
        }
      }
    }
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return l;
}

export const ContainerAlignmentCost = containerAlignmentCost;
