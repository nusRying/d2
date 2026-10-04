// Slice 47 — OVG construction resource accounting.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_resource.go
//
// Every Go `error` result is thrown instead (same message; wrapped errors keep
// the wrapped value in `cause`). Counters are Numbers while they stay exactly
// representable and become BigInt only past 2^53 (limits may be BigInt, e.g.
// math.MaxUint64); all arithmetic is uint64-checked like internal/limits.
//
// (*OVG).fixedOverlapsForBuild is defined in this Go file; it is exported here
// as the free function fixedOverlapsForBuild(ovg, ...) and OVG delegates to it.
//
// Go map iteration in newOVGPortIndex (owner order) and isRestrictedSequencePort
// uses JS Map insertion order. Go's order is unspecified; the resulting
// booleans are order-independent, while work totals can depend on the order
// when a candidate is aligned with more owners than it needs or a point has
// several owners (see ovg.js).

import { Point } from '../geometry/point.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { ROUTE_STAGE_CONTEXT_CHECK_STRIDE, routeAggregateWorkFromContext } from './route-guards.js';
import { cachedContextErr, contextDone } from './work.js';
import { backgroundWorkContext } from '../limits/work-context.js';
import { Orientation } from '../geometry/orientation.js';
import { OVGNode, portDirectionSetAny } from './ovg-node.js';
import { nonNilEquals } from './ovg-edge.js';
import {
  GoFloatMap,
  MAX_INT64,
  checkedAddUint64,
  checkedMulUint64,
  divUint64,
  goSortFloat64s,
  normalizeUint64,
  subUint64,
} from './ovg-go-support.js';
import { MIN_ROUTE_NODE_CLEARANCE, nodeIsPointNear } from './layoutgraph-routing-support.js';

// OVG construction derives a visibility graph much larger than its input.
// These limits bound one routing attempt independently of adapter limits.
export const MAX_OVG_INTERSECTION_CANDIDATES = 1_000_000;
export const MAX_OVG_NODES = 200_000;
export const MAX_OVG_EDGES = 500_000;
export const MAX_OVG_WORK_UNITS = 250_000_000;

/** errOVGResourceLimit sentinel. */
export const errOVGResourceLimit = new Error('TALA OVG resource limit exceeded');

/** ovgBuildLimits. Values are Numbers or BigInts (normalized). */
export class OVGBuildLimits {
  constructor({ intersectionCandidates = 0, nodes = 0, edges = 0, work = 0 } = {}) {
    this.intersectionCandidates = normalizeUint64(intersectionCandidates);
    this.nodes = normalizeUint64(nodes);
    this.edges = normalizeUint64(edges);
    this.work = normalizeUint64(work);
  }
}

export function defaultOVGBuildLimits() {
  return new OVGBuildLimits({
    intersectionCandidates: MAX_OVG_INTERSECTION_CANDIDATES,
    nodes: MAX_OVG_NODES,
    edges: MAX_OVG_EDGES,
    work: MAX_OVG_WORK_UNITS,
  });
}

/** fmt.Errorf("%w: %s arithmetic overflow", errOVGResourceLimit, resource) */
export function ovgResourceOverflow(resource) {
  return new Error(`${errOVGResourceLimit.message}: ${resource} arithmetic overflow`, { cause: errOVGResourceLimit });
}

/** fmt.Errorf("%w: %s %d exceeds limit %d", ...) */
export function ovgResourceExceeded(resource, requested, limit) {
  return new Error(`${errOVGResourceLimit.message}: ${resource} ${requested} exceeds limit ${limit}`, { cause: errOVGResourceLimit });
}

const LIMIT_FIELD = {
  candidates: 'intersectionCandidates',
  nodes: 'nodes',
  edges: 'edges',
};

/**
 * ovgBuildGuard. `aggregate` (any workBudget from the context) is shared by
 * every OVG and route-search flavor of one public routing operation.
 */
export class OVGBuildGuard {
  constructor(ctx, limits) {
    this.ctx = ctx;
    this.done = contextDone(ctx);
    this.aggregate = routeAggregateWorkFromContext(ctx);
    this.limits = limits;
    this.candidates = 0;
    this.nodes = 0;
    this.edges = 0;
    this.work = 0;
  }

  check() {
    const err = cachedContextErr(this.ctx, this.done);
    if (err != null) {
      throw new Error(`EdgeRouting: ${err.message ?? String(err)}`, { cause: err });
    }
  }

  /** reserve(resource, field, amount, limit); `field` names the counter. */
  reserve(resource, field, amount, limit) {
    this.check();
    const [next, ok] = checkedAddUint64(this[field], amount);
    if (!ok) {
      throw ovgResourceOverflow(resource);
    }
    if (next > limit) {
      throw ovgResourceExceeded(resource, next, limit);
    }
    this[field] = next;
  }

  reserveCandidates(amount) {
    this.reserve('intersection candidate count', 'candidates', amount, this.limits[LIMIT_FIELD.candidates]);
  }

  reserveNodes(amount) {
    this.reserve('node count', 'nodes', amount, this.limits.nodes);
  }

  reserveEdges(amount) {
    this.reserve('edge count', 'edges', amount, this.limits.edges);
  }

  reserveWork(amount) {
    const [next, ok] = checkedAddUint64(this.work, amount);
    if (!ok) {
      this.check();
      throw ovgResourceOverflow('work units');
    }
    if (next > this.limits.work) {
      this.check();
      throw ovgResourceExceeded('work units', next, this.limits.work);
    }
    // Contexts without Done poll Err on every reservation; Done-backed
    // contexts poll at a bounded stride (always before a limit result).
    if (this.done == null || amount == 0 ||
      divUint64(this.work, ROUTE_STAGE_CONTEXT_CHECK_STRIDE) != divUint64(next, ROUTE_STAGE_CONTEXT_CHECK_STRIDE)) {
      this.check();
    }
    this.work = next;
    if (this.aggregate != null) {
      this.aggregate.add(amount);
    }
  }

  step() {
    this.reserveWork(1);
  }

  reserveSortWork(length) {
    if (length < 2) {
      this.check();
      return;
    }
    let levels = 0;
    for (let remaining = length - 1; remaining > 0; remaining = Math.floor(remaining / 2)) {
      levels++;
    }
    const [work, ok] = checkedMulUint64(length, levels);
    if (!ok) {
      throw ovgResourceOverflow('sort work units');
    }
    this.reserveWork(work);
  }

  /** addNode returns the canonical node at the point (existing or added). */
  addNode(ovg, node) {
    this.step();
    const occupant = ovg.OccupiedPoints.get(node.Point);
    if (occupant !== undefined) {
      return occupant;
    }
    this.reserveNodes(1);
    ovg.AddNodeUnchecked(node);
    return node;
  }

  addPoint(ovg, point) {
    this.step();
    const occupant = ovg.OccupiedPoints.get(point);
    if (occupant !== undefined) {
      return occupant;
    }
    this.reserveNodes(1);
    const node = new OVGNode(point);
    ovg.AddNodeUnchecked(node);
    return node;
  }

  /**
   * newDerivedNode accounts for a temporary OVG node before allocating it;
   * later OVG memberships are counted separately by addNode.
   */
  newDerivedNode(point) {
    this.step();
    this.reserveNodes(1);
    return new OVGNode(point);
  }

  newCandidateNode(point) {
    this.step();
    return new OVGNode(point);
  }

  addNodeUnchecked(ovg, node) {
    this.step();
    this.reserveNodes(1);
    ovg.AddNodeUnchecked(node);
  }

  /** → the new OVGEdge, or null when a center would connect to a non-port. */
  connect(ovg, nodeA, nodeB) {
    this.step();
    if ((nodeA.IsNodeCenter && !nodeB.isPort()) || (nodeB.IsNodeCenter && !nodeA.isPort())) {
      return null;
    }
    this.reserveEdges(1);
    return ovg.Connect(nodeA, nodeB);
  }

  pointNearGraphNode(graph, point) {
    for (const node of graph.Nodes) {
      this.step();
      // Visibility nodes may lie on container boundaries.
      if (node.IsContainer()) {
        continue;
      }
      if (nodeIsPointNear(node, point)) {
        return true;
      }
    }
    return false;
  }

  /** → [tl, br]; [null, null] when a node has no position. */
  tightBoundingBox(nodes) {
    if (nodes == null || nodes.length === 0) {
      const result = [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
      this.check();
      return result;
    }
    if (nodes[0].TopLeft == null) {
      this.check();
      return [null, null];
    }

    let minX = nodes[0].TopLeft.X;
    let minY = nodes[0].TopLeft.Y;
    let maxX = nodes[0].TopLeft.X + nodes[0].Width;
    let maxY = nodes[0].TopLeft.Y + nodes[0].Height;
    for (const node of nodes) {
      this.step();
      if (node.TopLeft == null) {
        return [null, null];
      }
      minX = goMin(minX, node.TopLeft.X);
      minY = goMin(minY, node.TopLeft.Y);
      maxX = goMax(maxX, node.TopLeft.X + node.Width);
      maxY = goMax(maxY, node.TopLeft.Y + node.Height);
    }
    const result = [new Point(minX, minY), new Point(maxX, maxY)];
    this.check();
    return result;
  }

  /** → [tl, br] of the OVG nodes. */
  ovgBoundingBox(ovg) {
    if (ovg.Nodes.length === 0) {
      const result = [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
      this.check();
      return result;
    }
    let minX = ovg.Nodes[0].X;
    let minY = ovg.Nodes[0].Y;
    let maxX = ovg.Nodes[0].X;
    let maxY = ovg.Nodes[0].Y;
    for (const node of ovg.Nodes) {
      this.step();
      minX = goMin(minX, node.X);
      minY = goMin(minY, node.Y);
      maxX = goMax(maxX, node.X);
      maxY = goMax(maxY, node.Y);
    }
    const result = [new Point(minX, minY), new Point(maxX, maxY)];
    this.check();
    return result;
  }

  portsByOrientation(ovg, owner, orientation) {
    const ownerPorts = ovg.Ports.get(owner) ?? [];
    const ports = [];
    const seen = new Set();
    for (const port of ownerPorts) {
      this.step();
      if (seen.has(port)) {
        continue;
      }
      seen.add(port);
      if (port.hasPortDirection(owner, orientation)) {
        ports.push(port);
      }
    }
    this.check();
    return ports;
  }

  passesThroughAllowingPorts(node, p1, p2, direction, ports) {
    if (ports == null || ports.length === 0) {
      const passes = node.PassesThrough(p1, p2);
      this.check();
      return passes;
    }
    // A port exempts a segment only when it points outwards in `direction`;
    // check that invariant before scanning the shape's port list.
    let allowsPort = false;
    switch (direction) {
      case Orientation.Top:
        allowsPort = p1.X === p2.X && p1.Y > p2.Y;
        break;
      case Orientation.Bottom:
        allowsPort = p1.X === p2.X && p1.Y < p2.Y;
        break;
      case Orientation.Left:
        allowsPort = p1.Y === p2.Y && p1.X > p2.X;
        break;
      case Orientation.Right:
        allowsPort = p1.Y === p2.Y && p1.X < p2.X;
        break;
      default:
        break;
    }
    if (allowsPort) {
      for (const port of ports) {
        this.step();
        if (nonNilEquals(port.Point, p1) || nonNilEquals(port.Point, p2)) {
          return false;
        }
      }
    }
    const passes = node.PassesThrough(p1, p2);
    this.check();
    return passes;
  }

  isDescendantOf(descendant, ancestor) {
    for (let current = descendant; ;) {
      this.step();
      if (ancestor === current) {
        return true;
      }
      if (current == null) {
        return false;
      }
      if (current.Container != null) {
        current = current.Container;
      } else if (current.Cluster != null) {
        current = current.Cluster.Vessel;
      } else if (current.Sequence != null) {
        current = current.Sequence.Vessel;
      } else {
        return ancestor == null;
      }
    }
  }

  hasFixedAncestor(node) {
    for (let current = node; current != null; current = current.OwningContainer()) {
      this.step();
      if (current.FixedTopLeft != null) {
        return true;
      }
    }
    return false;
  }

  sameNodes(a, b) {
    const aLength = a == null ? 0 : a.length;
    const bLength = b == null ? 0 : b.length;
    if (aLength !== bLength) {
      this.check();
      return false;
    }
    for (let i = 0; i < aLength; i++) {
      this.step();
      if (a[i] !== b[i]) {
        return false;
      }
    }
    this.check();
    return true;
  }

  isRestrictedSequencePort(node) {
    const owners = node.portOwners();
    if (owners.size === 0) {
      this.check();
      return false;
    }
    for (const [owner, metadata] of owners) {
      this.step();
      if (owner.Sequence == null) {
        return false;
      }
      if (portDirectionSetAny(metadata.directions, (direction) => {
        switch (direction) {
          case Orientation.Left:
            return owner.Sequence.First() === owner;
          case Orientation.Right:
            return owner.Sequence.Last() === owner;
          default:
            return true;
        }
      })) {
        return false;
      }
    }
    this.check();
    return true;
  }

  /** Reverse DFS container order below `root` (null = graph root). */
  containerRDFSOrder(graph, root) {
    const order = [];
    if (root != null && !root.IsContainer()) {
      this.check();
      return order;
    }
    const children = graph.Containers.get(root) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      this.step();

      if (child.IsContainer()) {
        const descendants = this.containerRDFSOrder(graph, child);
        order.push(...descendants);
        order.push(child);
        continue;
      }
      if (child.IsClusterVessel()) {
        const cluster = graph.Clusters.get(child);
        const clusterNodes = cluster.Nodes ?? [];
        for (let j = clusterNodes.length - 1; j >= 0; j--) {
          const clusterNode = clusterNodes[j];
          this.step();

          if (!clusterNode.IsContainer()) {
            continue;
          }
          const descendants = this.containerRDFSOrder(graph, clusterNode);
          order.push(...descendants);
          order.push(clusterNode);
        }
      }
    }
    this.check();
    return order;
  }

  /**
   * reserveHierarchyTransform accounts for a complete coordinate transform
   * before it mutates graph or OVG state, so the inverse can stay infallible.
   */
  reserveHierarchyTransform(ovg, graphNodeCount) {
    this.reserveWork(graphNodeCount);
    for (const node of ovg.Nodes) {
      this.step(); // preflight scan
      this.reserveWork(2); // point transform and reindex
      for (let i = 0; i < node.portOwners().size; i++) {
        this.step(); // preflight scan
        this.reserveWork(1); // direction transform
      }
    }
    this.check();
  }

  /** hasCoordinateWithin: binary search of a sorted coordinate list. */
  hasCoordinateWithin(sortedValues, coordinate, distance) {
    const values = sortedValues ?? [];
    let low = 0;
    let high = values.length;
    const threshold = coordinate - distance;
    while (low < high) {
      this.step();
      const mid = (low + high) >>> 1;
      if (values[mid] < threshold) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const within = low < values.length && values[low] <= coordinate + distance;
    this.check();
    return within;
  }
}

/** newOVGBuildGuard: a null ctx is context.Background(); checks once. */
export function newOVGBuildGuard(ctx, limits) {
  const guard = new OVGBuildGuard(ctx ?? backgroundWorkContext(), limits);
  guard.check();
  return guard;
}

export function checkedOVGIntersectionCount(xCount, yCount) {
  const [count, ok] = checkedMulUint64(xCount, yCount);
  if (!ok) {
    throw ovgResourceOverflow('intersection candidate count');
  }
  return count;
}

export function checkedUint64ToInt(value, intLimit) {
  if (value > intLimit) {
    throw ovgResourceExceeded('allocation capacity', value, intLimit);
  }
  return normalizeUint64(value);
}

export function checkedOVGSliceCapacity(...lengths) {
  let total = 0;
  for (const length of lengths) {
    const [next, ok] = checkedAddUint64(total, length);
    if (!ok) {
      throw ovgResourceOverflow('allocation capacity');
    }
    total = next;
  }
  return checkedUint64ToInt(total, maxIntAsUint64());
}

/** Go `uint64(^uint(0) >> 1)` on a 64-bit platform. */
export function maxIntAsUint64() {
  return MAX_INT64;
}

/**
 * checkedOVGEdgeCapacity: the exact sweep upper bound for edge preallocation.
 * Every eligible node appears on one horizontal and one vertical line, so the
 * sweeps add at most (n-h)+(n-v) edges.
 */
export function checkedOVGEdgeCapacity(existing, nodeCount, horizontalLines, verticalLines, edgeLimit, intLimit) {
  if (existing > edgeLimit) {
    throw ovgResourceExceeded('edge count', existing, edgeLimit);
  }

  const [twiceNodes, mulOK] = checkedMulUint64(nodeCount, 2);
  if (!mulOK) {
    throw ovgResourceOverflow('edge capacity');
  }
  const [lineCount, addOK] = checkedAddUint64(horizontalLines, verticalLines);
  if (!addOK || twiceNodes < lineCount) {
    throw ovgResourceOverflow('edge capacity');
  }
  const newEdges = subUint64(twiceNodes, lineCount);
  let [capacity, capOK] = checkedAddUint64(existing, newEdges);
  if (!capOK) {
    throw ovgResourceOverflow('edge capacity');
  }
  if (capacity > edgeLimit) {
    capacity = edgeLimit;
  }
  return checkedUint64ToInt(capacity, intLimit);
}

// ─── Point proximity index ───────────────────────────────────────────────────

/**
 * ovgPointProximityIndex: build-local broad phase for the Cartesian grid.
 * Each candidate X keeps, in graph order, the non-container nodes whose
 * expanded box can contain it; isPointNear stays the exact final test.
 */
export class OVGPointProximityIndex {
  constructor() {
    this.byX = new GoFloatMap();
  }

  pointNear(x, y, guard) {
    guard.step();
    const point = new Point(x, y);
    for (const node of this.byX.get(x) ?? []) {
      guard.step();
      if (nodeIsPointNear(node, point)) {
        return true;
      }
    }
    return false;
  }
}

export function newOVGPointProximityIndex(graph, xs, guard) {
  const index = new OVGPointProximityIndex();
  for (const x of xs) {
    guard.step();
    for (const node of graph.Nodes) {
      guard.step();
      if (node.IsContainer()) {
        continue;
      }
      if (node.TopLeft.X - MIN_ROUTE_NODE_CLEARANCE <= x &&
        node.TopLeft.X + node.Width + MIN_ROUTE_NODE_CLEARANCE >= x) {
        const current = index.byX.get(x);
        if (current === undefined) {
          index.byX.set(x, [node]);
        } else {
          current.push(node);
          index.byX.set(x, current);
        }
      }
    }
  }
  guard.check();
  return index;
}

// ─── Fixed overlaps ──────────────────────────────────────────────────────────

/** fixedOverlapsCacheEntry */
export class FixedOverlapsCacheEntry {
  constructor(graph, nodes, overlaps) {
    this.graph = graph;
    this.nodes = nodes;
    this.overlaps = overlaps;
  }
}

/**
 * (*OVG).fixedOverlapsForBuild → Set of fixed nodes overlapping another node.
 * Cached per (graph, node list). Go guards the cache with a mutex; JS is
 * single-threaded.
 */
export function fixedOverlapsForBuild(ovg, graph, nodes, guard) {
  for (const entry of ovg.fixedOverlapsCache) {
    guard.step();
    const same = guard.sameNodes(entry.nodes, nodes);
    if (entry.graph === graph && same) {
      return entry.overlaps;
    }
  }

  const nodeList = nodes ?? [];
  const fixedNodes = [];
  for (const node of nodeList) {
    guard.step();
    if (guard.hasFixedAncestor(node)) {
      fixedNodes.push(node);
    }
  }

  const overlaps = new Set();
  for (const node of fixedNodes) {
    if (overlaps.has(node)) {
      continue;
    }
    for (const other of nodeList) {
      guard.step();
      const nodeBelowOther = guard.isDescendantOf(node, other);
      const otherBelowNode = guard.isDescendantOf(other, node);
      if (node === other || nodeBelowOther || otherBelowNode) {
        continue;
      }
      if (node.Box.overlaps(other.Box)) {
        overlaps.add(node);
        if (guard.hasFixedAncestor(other)) {
          overlaps.add(other);
        }
        break;
      }
    }
  }

  ovg.fixedOverlapsCache.push(new FixedOverlapsCacheEntry(graph, nodeList.slice(), overlaps));
  return overlaps;
}

// ─── Port index ──────────────────────────────────────────────────────────────

/** ovgPortIndex. Float-keyed maps are GoFloatMap. */
export class OVGPortIndex {
  constructor() {
    this.xByY = new GoFloatMap();
    this.yByX = new GoFloatMap();
    this.owners = [];
    this.ownersByX = new GoFloatMap();
    this.ownersByY = new GoFloatMap();
    this.verticalBlockers = new GoFloatMap();
    this.horizontalBlockers = new GoFloatMap();
  }

  /**
   * alignedOwners merges the two axis lists so a query visits aligned owners
   * once each, in ascending owner-index order.
   */
  alignedOwners(x, y) {
    return new OVGAlignedOwners(this.ownersByX.get(x) ?? [], this.ownersByY.get(y) ?? []);
  }

  tooClose(x, y, distance, guard) {
    const tooClose = guard.hasCoordinateWithin(this.xByY.get(y), x, distance);
    if (tooClose) {
      return true;
    }
    return guard.hasCoordinateWithin(this.yByX.get(x), y, distance);
  }
}

function floatMapAppend(map, key, value) {
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, [value]);
  } else {
    current.push(value);
    map.set(key, current);
  }
}

/**
 * newOVGPortIndex(ports Map<Node, OVGNode[]>, graph|null, fixedOverlaps
 * Set|null, guard). Owner indexes follow the Map's iteration order.
 */
export function newOVGPortIndex(ports, graph, fixedOverlaps, guard) {
  const index = new OVGPortIndex();
  for (const [owner, nodePorts] of ports) {
    guard.step();
    const ownerIndex = index.owners.length;
    index.owners.push(owner);
    for (const port of nodePorts ?? []) {
      guard.step();
      floatMapAppend(index.xByY, port.Y, port.X);
      floatMapAppend(index.yByX, port.X, port.Y);
      floatMapAppend(index.ownersByX, port.X, ownerIndex);
      floatMapAppend(index.ownersByY, port.Y, ownerIndex);
    }
  }
  for (const values of index.xByY.values()) {
    guard.reserveSortWork(values.length);
    goSortFloat64s(values);
  }
  for (const values of index.yByX.values()) {
    guard.reserveSortWork(values.length);
    goSortFloat64s(values);
  }

  // Port-to-candidate segments are axis aligned: precompute the graph-order
  // blockers per port axis; passesThrough stays the exact query predicate.
  if (graph != null) {
    for (const x of index.ownersByX.keys()) {
      guard.step();
      for (const node of graph.Nodes) {
        guard.step();
        if (node == null || node.TopLeft == null || node.IsContainer()) {
          continue;
        }
        if (fixedOverlaps != null && fixedOverlaps.has(node)) {
          continue;
        }
        const left = goMin(node.TopLeft.X, node.TopLeft.X + node.Width);
        const right = goMax(node.TopLeft.X, node.TopLeft.X + node.Width);
        if (left <= x && x <= right) {
          floatMapAppend(index.verticalBlockers, x, node);
        }
      }
    }
    for (const y of index.ownersByY.keys()) {
      guard.step();
      for (const node of graph.Nodes) {
        guard.step();
        if (node == null || node.TopLeft == null || node.IsContainer()) {
          continue;
        }
        if (fixedOverlaps != null && fixedOverlaps.has(node)) {
          continue;
        }
        const top = goMin(node.TopLeft.Y, node.TopLeft.Y + node.Height);
        const bottom = goMax(node.TopLeft.Y, node.TopLeft.Y + node.Height);
        if (top <= y && y <= bottom) {
          floatMapAppend(index.horizontalBlockers, y, node);
        }
      }
    }
  }
  return index;
}

/**
 * ovgAlignedOwners: two ascending owner-index lists consumed from the front.
 * Go reslices `byX = byX[1:]`; JS keeps the arrays (never mutated) and cursors.
 */
export class OVGAlignedOwners {
  constructor(byX = [], byY = []) {
    this.byX = byX;
    this.byY = byY;
    this.xStart = 0;
    this.yStart = 0;
  }

  /** → [owner, ok] */
  next(guard) {
    guard.step();
    const byX = this.byX;
    const byY = this.byY;
    const xEmpty = this.xStart >= byX.length;
    const yEmpty = this.yStart >= byY.length;
    if (xEmpty && yEmpty) {
      return [0, false];
    }
    let owner;
    if (yEmpty || (!xEmpty && byX[this.xStart] < byY[this.yStart])) {
      owner = byX[this.xStart];
    } else {
      owner = byY[this.yStart];
    }
    while (this.xStart < byX.length && byX[this.xStart] === owner) {
      guard.step();
      this.xStart++;
    }
    while (this.yStart < byY.length && byY[this.yStart] === owner) {
      guard.step();
      this.yStart++;
    }
    return [owner, true];
  }
}
