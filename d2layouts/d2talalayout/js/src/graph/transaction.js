/**
 * Transaction substrate for TALA JS.
 *
 * Ported from:
 *   d2layouts/d2talalayout/internal/layoutgraph/transaction.go
 *   d2layouts/d2talalayout/internal/layoutgraph/transaction_snapshot.go
 *
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 * Slice 44 — tala-js/slice-44-transactions-transpose-clusters
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { MAX_ENGINE_NODES, MAX_ENGINE_EDGES } from '../limits/constants.js';
import { snapshotPoint } from './graph-state.js';

// ──────────────────────────────────────────────────────────────────────────────
// Sentinel errors — Go: ErrInvalidCandidate, ErrNonImprovingCandidate
// ──────────────────────────────────────────────────────────────────────────────

export class InvalidCandidateError extends Error {
  constructor() {
    super('TALA candidate was rejected: invalid placement');
    this.name = 'InvalidCandidateError';
  }
}

export class NonImprovingCandidateError extends Error {
  constructor() {
    super('TALA candidate was rejected: non-improving placement');
    this.name = 'NonImprovingCandidateError';
  }
}

/** Singleton instances matching Go ErrInvalidCandidate / ErrNonImprovingCandidate. */
export const ErrInvalidCandidate = new InvalidCandidateError();
export const ErrNonImprovingCandidate = new NonImprovingCandidateError();

/**
 * isCandidateRejection returns true for both InvalidCandidateError and
 * NonImprovingCandidateError, whether passed as a class or an instance.
 *
 * Pinned Go: layoutgraph.IsCandidateRejection
 * @param {*} err
 * @returns {boolean}
 */
export function isCandidateRejection(err) {
  if (err == null) return false;
  if (err instanceof InvalidCandidateError) return true;
  if (err instanceof NonImprovingCandidateError) return true;
  return false;
}

export const IsCandidateRejection = isCandidateRejection;

// ──────────────────────────────────────────────────────────────────────────────
// TransactionOptions
// ──────────────────────────────────────────────────────────────────────────────

export class TransactionOptions {
  constructor({
    AffectContainers = false,
    IgnoreContainerEscape = false,
    AffectEdgeRoutes = false,
  } = {}) {
    this.AffectContainers = Boolean(AffectContainers);
    this.IgnoreContainerEscape = Boolean(IgnoreContainerEscape);
    this.AffectEdgeRoutes = Boolean(AffectEdgeRoutes);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GraphGeometrySnapshot — mirrors Go graphGeometrySnapshot
// ──────────────────────────────────────────────────────────────────────────────

class GraphGeometrySnapshot {
  constructor(topLeftSnap, width, height) {
    this.topLeft = topLeftSnap; // { pointer, x, y, restore() }
    this.width = width;
    this.height = height;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GraphState (geometry-only subset required for Transaction)
// Mirrors: layoutgraph.GraphState (geometry paths only)
// ──────────────────────────────────────────────────────────────────────────────

class GraphState {
  constructor() {
    /** @type {Map<object, GraphGeometrySnapshot>} */
    this.nodeGeometry = null;
    /** @type {Array<object>} */
    this.originalNodes = null;
    /** @type {Array<object>} */
    this.originalNodesRef = null;
    this.hasFixedTopLeft = false;

    // Cluster geometry rollback
    /** @type {Map<object, *>} */
    this.clusterArrangements = null;
    /** @type {Map<object, *>} */
    this.clusterDesired = null;
    /** @type {Map<object, number>} */
    this.clusterPaddings = null;

    // Edge geometry (AffectEdgeRoutes)
    /** @type {Map<object, *>} */
    this.edgeGeometry = null;

    // Tree orientation rollback
    /** @type {Map<object, *>} */
    this.treeOrientations = null;

    // Existing-overlap exceptions (set once at transaction construction)
    /** @type {Map<object, Set<object>>} */
    this.existingOverlaps = null;
    /** @type {Map<object, Set<object>>} */
    this.existingExactOverlaps = null;

    this.captureEdgeRoutes = false;
  }

  /**
   * updateContext snapshots geometry from every node reachable in the graph.
   * Mirrors: Go GraphState.updateContext
   * @param {import('./graph.js').Graph} g
   * @param {object} guard — { Step(): null|Error, Finish(): null|Error }
   * @returns {null|Error}
   */
  updateContext(g, guard) {
    if (g == null) return new Error('TALA transaction graph is nil');
    if (guard == null) return new Error('TALA transaction requires a work guard');

    const nodeCount = (g.Nodes || []).length;
    if (nodeCount > MAX_ENGINE_NODES) {
      return new Error(`TALA transaction node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    const edgeCount = (g.Edges || []).length;
    if (edgeCount > MAX_ENGINE_EDGES) {
      return new Error(`TALA transaction edge count exceeds limit ${MAX_ENGINE_EDGES}`);
    }

    const totalNodes = Math.min(nodeCount, MAX_ENGINE_NODES);

    // Reset or recreate nodeGeometry map
    if (this.nodeGeometry == null || this.nodeGeometry.size > 2 * totalNodes) {
      this.nodeGeometry = new Map();
    } else {
      this.nodeGeometry.clear();
    }
    this.hasFixedTopLeft = false;

    // Cluster maps
    const clusterCount = g.Clusters ? g.Clusters.size : 0;
    if (this.clusterArrangements == null || this.clusterArrangements.size > 2 * clusterCount) {
      this.clusterArrangements = new Map();
      this.clusterDesired = new Map();
      this.clusterPaddings = new Map();
    } else {
      this.clusterArrangements.clear();
      this.clusterDesired.clear();
      this.clusterPaddings.clear();
    }

    // Capture original node order
    this.originalNodesRef = g.Nodes;
    if (this.originalNodes == null || this.originalNodes.length !== nodeCount) {
      this.originalNodes = new Array(nodeCount);
    }
    for (let i = 0; i < nodeCount; i++) {
      this.originalNodes[i] = g.Nodes[i];
    }

    const recordNode = (n) => {
      if (n == null) return [false, null];
      if (this.nodeGeometry.has(n)) return [false, null];
      if (this.nodeGeometry.size >= MAX_ENGINE_NODES) {
        return [false, new Error(`TALA transaction unique node snapshot exceeds limit ${MAX_ENGINE_NODES}`)];
      }
      const err = guard.Step();
      if (err) return [false, err];
      const topLeftSnap = snapshotPoint(n.TopLeft);
      this.nodeGeometry.set(n, new GraphGeometrySnapshot(topLeftSnap, n.Width, n.Height));
      if (n.FixedTopLeft != null) this.hasFixedTopLeft = true;
      return [true, null];
    };

    const recordDescendants = (root) => {
      const queue = [root];
      while (queue.length > 0) {
        const node = queue.pop();
        const [recorded, err] = recordNode(node);
        if (err) return err;
        if (!recorded) continue;
        const children = g.Containers ? g.Containers.get(node) : null;
        if (children) {
          for (let i = 0; i < children.length; i++) {
            const e = guard.Step();
            if (e) return e;
            queue.push(children[i]);
          }
        }
      }
      return null;
    };

    // Walk all graph nodes
    for (const n of (g.Nodes || [])) {
      const err = recordDescendants(n);
      if (err) return err;
    }

    // Cover container keys/values not in g.Nodes
    if (g.Containers) {
      for (const [container, children] of g.Containers.entries()) {
        const e1 = guard.Step();
        if (e1) return e1;
        const e2 = recordDescendants(container);
        if (e2) return e2;
        if (children) {
          for (const child of children) {
            const e3 = recordDescendants(child);
            if (e3) return e3;
          }
        }
      }
    }

    // Store cluster policy and nodes
    if (g.Clusters) {
      for (const [, c] of g.Clusters.entries()) {
        const e1 = guard.Step();
        if (e1) return e1;
        if (c == null) continue;
        this.clusterArrangements.set(c, c.Arrangement);
        this.clusterDesired.set(c, c.DesiredArrangement);
        this.clusterPaddings.set(c, c.Padding);
        const e2 = recordDescendants(c.Vessel);
        if (e2) return e2;
        const e3 = recordDescendants(c.Container);
        if (e3) return e3;
        if (c.Nodes) {
          for (const n of c.Nodes) {
            const e4 = recordDescendants(n);
            if (e4) return e4;
          }
        }
      }
    }

    // Store sequence nodes
    if (g.Sequences) {
      for (const [, s] of g.Sequences.entries()) {
        const e1 = guard.Step();
        if (e1) return e1;
        if (s == null) continue;
        const e2 = recordDescendants(s.Vessel);
        if (e2) return e2;
        const e3 = recordDescendants(s.Container);
        if (e3) return e3;
        if (s.Nodes) {
          for (const n of s.Nodes) {
            const e4 = recordDescendants(n);
            if (e4) return e4;
          }
        }
      }
    }

    // Capture edge routes if AffectEdgeRoutes is set
    if (this.captureEdgeRoutes) {
      const edges = new Set();
      if (g.Edges) {
        for (const edge of g.Edges) {
          if (edge != null) edges.add(edge);
        }
      }
      for (const [n] of this.nodeGeometry.entries()) {
        if (n.Edges) {
          for (const edge of n.Edges) {
            if (edge != null) edges.add(edge);
          }
        }
      }
      this.edgeGeometry = new Map();
      for (const edge of edges) {
        const e1 = guard.Step();
        if (e1) return e1;
        this.edgeGeometry.set(edge, captureEdgeGeometry(edge));
      }
    } else {
      this.edgeGeometry = null;
    }

    // Capture tree orientations
    this.treeOrientations = new Map();
    if (g.NodeToTree) {
      for (const [, tree] of g.NodeToTree.entries()) {
        const e1 = guard.Step();
        if (e1) return e1;
        if (tree != null) {
          this.treeOrientations.set(tree, tree.Orientation);
        }
      }
    }

    return guard.Finish();
  }

  /**
   * hasOriginalNodeOrder checks if the graph's Nodes still match the snapshot.
   * Mirrors: Go GraphState.hasOriginalNodeOrder
   * @param {import('./graph.js').Graph} g
   * @returns {boolean}
   */
  hasOriginalNodeOrder(g) {
    if (g == null || this.originalNodes == null) return false;
    if (this.originalNodes.length !== g.Nodes.length) return false;
    for (let i = 0; i < g.Nodes.length; i++) {
      if (this.originalNodes[i] !== g.Nodes[i]) return false;
    }
    return true;
  }

  /**
   * geometryChanged returns true if the node's geometry differs from snapshot.
   * Mirrors: Go GraphState.geometryChanged
   * @param {object} node
   * @returns {boolean}
   */
  geometryChanged(node) {
    if (node == null) return true;
    const original = this.nodeGeometry ? this.nodeGeometry.get(node) : undefined;
    if (original === undefined) return true;
    if (node.TopLeft == null) {
      return original.topLeft != null || node.Width !== original.width || node.Height !== original.height;
    }
    return (
      original.topLeft == null ||
      node.TopLeft.X !== original.topLeft.x ||
      node.TopLeft.Y !== original.topLeft.y ||
      node.Width !== original.width ||
      node.Height !== original.height
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Edge geometry capture (for AffectEdgeRoutes)
// ──────────────────────────────────────────────────────────────────────────────

function captureEdgeGeometry(edge) {
  // Snapshot Points array and individual point values
  const points = edge.Points ? edge.Points.slice() : null;
  const pointValues = points ? points.map(p => p ? { pointer: p, x: p.X, y: p.Y } : null) : [];
  return {
    points,
    pointValues,
    originalPoints: edge.Points,
    restore(e) {
      // Restore point values in-place
      for (let i = 0; i < this.pointValues.length; i++) {
        const pv = this.pointValues[i];
        if (pv && pv.pointer) {
          pv.pointer.X = pv.x;
          pv.pointer.Y = pv.y;
        }
      }
      // Restore points array
      if (this.originalPoints != null && this.points != null) {
        this.originalPoints.length = this.points.length;
        for (let i = 0; i < this.points.length; i++) {
          this.originalPoints[i] = this.points[i];
        }
        e.Points = this.originalPoints;
      } else if (this.originalPoints == null) {
        e.Points = null;
      }
    }
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Build overlap maps  (sweep-line, mirrors buildTransactionOverlaps)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_TRANSACTION_OVERLAP_REFERENCES = 2_000_000;
const TABLE_NODE_GAP = 5;
const NODE_GAP = 10;
const MAX_SAFE_DELTA = 500.0;

function transactionFinite(v) {
  return !isNaN(v) && isFinite(v);
}

function transactionNodeHasFiniteBox(node) {
  if (node == null || node.TopLeft == null) return false;
  return (
    transactionFinite(node.TopLeft.X) &&
    transactionFinite(node.TopLeft.Y) &&
    transactionFinite(node.Width) &&
    transactionFinite(node.Height) &&
    transactionFinite(node.TopLeft.X + node.Width) &&
    transactionFinite(node.TopLeft.Y + node.Height) &&
    node.Width >= 0 &&
    node.Height >= 0
  );
}

function transactionSweepPadding(g) {
  let padding = TABLE_NODE_GAP;
  let maxMargin = 0;
  let maxLoopOffset = 0;
  const edges = new Set();

  for (const node of (g.Nodes || [])) {
    if (node == null) return [0, new Error('TALA transaction contains a nil node')];
    if (node.TopLeft != null) {
      if (!transactionNodeHasFiniteBox(node)) {
        // Empty containers with NaN/Inf sentinel geometry are allowed
        if (node.isContainer && (!g.Containers || !g.Containers.get(node) || g.Containers.get(node).length === 0)) {
          continue;
        }
        return [0, new Error(`transaction node ${node.ID} has invalid geometry`)];
      }
    }
    const margin = node._margin || node.margin || {};
    const mTop = Number(typeof margin.top === 'function' ? margin.top() : (margin.top ?? 0)) || 0;
    const mRight = Number(typeof margin.right === 'function' ? margin.right() : (margin.right ?? 0)) || 0;
    const mBottom = Number(typeof margin.bottom === 'function' ? margin.bottom() : (margin.bottom ?? 0)) || 0;
    const mLeft = Number(typeof margin.left === 'function' ? margin.left() : (margin.left ?? 0)) || 0;
    if (!transactionFinite(mTop) || !transactionFinite(mRight) || !transactionFinite(mBottom) || !transactionFinite(mLeft)) {
      return [0, new Error(`transaction node ${node.ID} has non-finite margin`)];
    }
    maxMargin = Math.max(maxMargin, mTop, mRight, mBottom, mLeft);
    if (node.LoopOffsets) {
      const offsets = node.LoopOffsets instanceof Map ? node.LoopOffsets.values() : Object.values(node.LoopOffsets);
      for (const offset of offsets) {
        if (!transactionFinite(offset)) return [0, new Error(`transaction node ${node.ID} has a non-finite loop offset`)];
        if (offset > maxLoopOffset) maxLoopOffset = offset;
      }
    }
    if (node.Edges) {
      for (const edge of node.Edges) {
        if (edge == null) return [0, new Error(`TALA transaction node ${node.ID} contains a nil edge`)];
        edges.add(edge);
      }
    }
  }

  for (const edge of (g.Edges || [])) {
    if (edge == null) return [0, new Error('TALA transaction contains a nil edge')];
    edges.add(edge);
  }
  for (const edge of edges) {
    padding = Math.max(padding, Number(edge.MinWidth) || 0, Number(edge.MinHeight) || 0);
  }
  padding = Math.max(padding, 2 * maxMargin, NODE_GAP + 2 * maxLoopOffset);
  if (!transactionFinite(padding)) return [0, new Error('transaction overlap padding is non-finite')];
  return [padding, null];
}

function buildTransactionOverlaps(g) {
  const [padding, padErr] = transactionSweepPadding(g);
  if (padErr) return [null, null, padErr];

  // Collect placed nodes
  const placed = [];
  for (let index = 0; index < (g.Nodes || []).length; index++) {
    const node = g.Nodes[index];
    if (node && node.TopLeft != null && transactionNodeHasFiniteBox(node)) {
      placed.push({ node, index });
    }
  }

  // Sort by TopLeft.X, then ID, then index
  placed.sort((l, r) => {
    if (l.node.TopLeft.X !== r.node.TopLeft.X) {
      return l.node.TopLeft.X < r.node.TopLeft.X ? -1 : 1;
    }
    const lId = BigInt(l.node.ID != null ? l.node.ID : 0);
    const rId = BigInt(r.node.ID != null ? r.node.ID : 0);
    if (lId < rId) return -1;
    if (lId > rId) return 1;
    return l.index - r.index;
  });

  const existingOverlaps = new Map();
  const existingExactOverlaps = new Map();
  let retainedReferences = 0;

  const addPair = (overlaps, first, second) => {
    if (retainedReferences > MAX_TRANSACTION_OVERLAP_REFERENCES - 2) {
      return new Error(`TALA transaction overlap references exceed limit ${MAX_TRANSACTION_OVERLAP_REFERENCES}`);
    }
    if (!overlaps.has(first)) overlaps.set(first, new Set());
    if (!overlaps.has(second)) overlaps.set(second, new Set());
    overlaps.get(first).add(second);
    overlaps.get(second).add(first);
    retainedReferences += 2;
    return null;
  };

  const active = [];
  for (const current of placed) {
    const kept = [];
    for (const other of active) {
      if (other === current.node) continue;
      if (other.TopLeft.X + other.Width + padding <= current.node.TopLeft.X) continue;
      kept.push(other);
      if (
        other.TopLeft.Y >= current.node.TopLeft.Y + current.node.Height + padding ||
        current.node.TopLeft.Y >= other.TopLeft.Y + other.Height + padding
      ) {
        continue;
      }
      // Check exact overlap
      if (_doesOverlapExact(current.node, other)) {
        const err = addPair(existingExactOverlaps, current.node, other);
        if (err) return [null, null, err];
      }
      // Check delta overlap
      if (_doesOverlapWithDelta(current.node, other) || _doesOverlapWithDelta(other, current.node)) {
        const err = addPair(existingOverlaps, current.node, other);
        if (err) return [null, null, err];
      }
    }
    kept.push(current.node);
    active.length = 0;
    for (const k of kept) active.push(k);
  }

  return [existingOverlaps, existingExactOverlaps, null];
}

function _doesOverlapExact(a, b) {
  if (a.TopLeft == null || b.TopLeft == null) return false;
  const aRight = a.TopLeft.X + a.Width;
  const bRight = b.TopLeft.X + b.Width;
  if (a.TopLeft.X >= bRight || b.TopLeft.X >= aRight) return false;
  const aBottom = a.TopLeft.Y + a.Height;
  const bBottom = b.TopLeft.Y + b.Height;
  return a.TopLeft.Y < bBottom && b.TopLeft.Y < aBottom;
}

function _doesOverlapWithDelta(a, b) {
  if (a.TopLeft == null || b.TopLeft == null) return false;
  // Delegate to node's deltaTo method if available, else use 0
  const delta = (typeof a.deltaTo === 'function') ? Number(a.deltaTo(b, a.TopLeft)) : 0;
  const aRight = a.TopLeft.X + a.Width;
  const bRight = b.TopLeft.X + b.Width;
  return (
    a.TopLeft.X < bRight + delta &&
    aRight + delta > b.TopLeft.X &&
    a.TopLeft.Y < b.TopLeft.Y + b.Height + delta &&
    a.TopLeft.Y + a.Height + delta > b.TopLeft.Y
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Transaction
// Mirrors: layoutgraph.Transaction
// ──────────────────────────────────────────────────────────────────────────────

export class Transaction {
  /**
   * @param {import('./graph.js').Graph} graph
   * @param {TransactionOptions} options
   * @param {object} guard
   * @param {GraphState} graphState
   */
  constructor(graph, options, guard, graphState) {
    /** @type {Array<function(): null|Error>} */
    this.Ops = [];
    /** @type {import('./graph.js').Graph} */
    this.Graph = graph;
    this._options = options;
    this._guard = guard;
    /** @type {GraphState} */
    this.PriorGraphState = graphState;
    /** @type {GraphState|null} */
    this._spareGraphState = null;
    /** @type {import('./graph.js').PlacementCostSnapshot|null} */
    this._placementCostSnapshot = null;
    this._priorGraphStateShared = false;

    // Dirty-node tracking for overlap validation
    /** @type {Map<object,boolean>|null} */
    this._dirtyNodes = null;
    /** @type {Array<boolean>} */
    this._dirtyNodeMarks = [];

    // Fixed origins for containment checks
    /** @type {Map<object,{X:number,Y:number}>|null} */
    this._fixedOrigins = null;

    // Overlap candidate index (post-state sweep)
    /** @type {Array<Array<number>>} */
    this._overlapCandidates = [];
    /** @type {Array<{node:object,index:number}>} */
    this._overlapSweepNodes = [];
    /** @type {Array<{node:object,index:number}>} */
    this._overlapActiveNodes = [];
    /** @type {Map<object,Array<number>>|null} */
    this._overlapNodeIndices = null;
    this._overlapNodeIndexReady = false;
    /** @type {Array<boolean>} */
    this._overlapInvalidBoxes = [];
    /** @type {Array<number>} */
    this._exceptionMarks = [];
    this._exceptionGeneration = 0;

    // Descendant exception tracking (reused across many commit calls)
    this._descendantStack = [];
    this._descendantNodes = [];
    /** @type {Map<object,number>|null} */
    this._descendantSeen = null;
    this._descendantGeneration = 0;
  }

  // ── Public read accessors ──────────────────────────────────────────────────

  get options() { return this._options; }

  /**
   * OriginalDimensions returns the width and height the node had at the start
   * of this transaction (geometry rollback point).
   * @param {object} node
   * @returns {[number, number]} [width, height]
   */
  OriginalDimensions(node) {
    const snap = this.PriorGraphState.nodeGeometry
      ? this.PriorGraphState.nodeGeometry.get(node)
      : null;
    if (snap == null) return [node.Width, node.Height];
    return [snap.width, snap.height];
  }

  originalDimensions(node) {
    return this.OriginalDimensions(node);
  }

  // ── Graph-state operations ─────────────────────────────────────────────────

  /**
   * PreservePriorGraphState pins the current rollback point.
   * Mirrors: Go Transaction.PreservePriorGraphState
   * @returns {GraphState}
   */
  PreservePriorGraphState() {
    this._priorGraphStateShared = true;
    return this.PriorGraphState;
  }

  preservePriorGraphState(state) {
    if (state != null) {
      this.PriorGraphState = state;
    }
    return this.PreservePriorGraphState();
  }

  CapturePlacementCosts(location) {
    if (this.Graph == null || this._guard == null) {
      return new Error(`TALA ${location} placement-cost snapshot requires an initialized transaction`);
    }
    if (this._placementCostSnapshot != null) return null;
    const costs = this.Graph.SnapshotPlacementCosts
      ? this.Graph.SnapshotPlacementCosts()
      : this.Graph.snapshotPlacementCosts();
    this._placementCostSnapshot = costs;
    return null;
  }

  capturePlacementCosts(location) {
    return this.CapturePlacementCosts(location);
  }

  RestorePlacementCosts() {
    if (this._placementCostSnapshot == null) return false;
    const costs = this._placementCostSnapshot;
    this._placementCostSnapshot = null;
    costs.Restore ? costs.Restore() : costs.restore();
    return true;
  }

  restorePlacementCosts() {
    return this.RestorePlacementCosts();
  }

  // ── Ops management ─────────────────────────────────────────────────────────

  AddOp(fn) {
    this.Ops.push(fn);
  }

  addOp(fn) {
    this.AddOp(fn);
  }

  Clear() {
    this.Ops = [];
  }

  clear() {
    this.Clear();
  }

  // ── UpdateState ────────────────────────────────────────────────────────────

  /**
   * UpdateState refreshes the rollback point to the current graph geometry.
   * Mirrors: Go Transaction.UpdateState
   * @returns {null|Error}
   */
  UpdateState() {
    const previous = this.PriorGraphState;
    let updated = this._spareGraphState;
    if (updated == null) {
      updated = new GraphState();
    }
    updated.captureEdgeRoutes = previous.captureEdgeRoutes;
    const err = updated.updateContext(this.Graph, this._guard);
    if (err) {
      this.Rollback();
      return err;
    }
    updated.existingOverlaps = previous.existingOverlaps;
    updated.existingExactOverlaps = previous.existingExactOverlaps;
    this.PriorGraphState = updated;
    if (this._priorGraphStateShared) {
      this._spareGraphState = null;
      this._priorGraphStateShared = false;
    } else {
      this._spareGraphState = previous;
    }
    return null;
  }

  updateState() {
    return this.UpdateState();
  }

  // ── Rollback ───────────────────────────────────────────────────────────────

  Rollback() {
    const state = this.PriorGraphState;
    if (state == null) return;

    // Rollback node geometry
    if (state.nodeGeometry) {
      for (const [node, geometry] of state.nodeGeometry.entries()) {
        // Restore TopLeft via the snapshot's pointer restore
        if (geometry.topLeft != null) {
          if (geometry.topLeft.pointer != null) {
            node.TopLeft = geometry.topLeft.restore();
          } else {
            node.TopLeft = null;
          }
        } else {
          node.TopLeft = null;
        }
        node.Width = geometry.width;
        node.Height = geometry.height;
      }
    }

    // Rollback cluster arrangements
    if (state.clusterArrangements) {
      for (const [cluster, arrangement] of state.clusterArrangements.entries()) {
        cluster.Arrangement = arrangement;
        if (state.clusterDesired) cluster.DesiredArrangement = state.clusterDesired.get(cluster);
        if (state.clusterPaddings) cluster.Padding = state.clusterPaddings.get(cluster);
      }
    }

    // Rollback edge geometry (AffectEdgeRoutes)
    if (state.edgeGeometry) {
      for (const [edge, snap] of state.edgeGeometry.entries()) {
        snap.restore(edge);
      }
    }

    // Rollback tree orientations
    if (state.treeOrientations) {
      for (const [tree, orientation] of state.treeOrientations.entries()) {
        tree.Orientation = orientation;
      }
    }

    // Restore original node order
    if (state.originalNodesRef != null && state.originalNodes != null) {
      state.originalNodesRef.length = state.originalNodes.length;
      for (let i = 0; i < state.originalNodes.length; i++) {
        state.originalNodesRef[i] = state.originalNodes[i];
      }
      this.Graph.Nodes = state.originalNodesRef;
    }
  }

  rollback() {
    this.Rollback();
  }

  // ── Clone ──────────────────────────────────────────────────────────────────

  CloneGeometryContext() {
    if (this.PriorGraphState == null || this._guard == null) {
      return [null, new Error('TALA geometry transaction clone requires an initialized transaction')];
    }
    const e = this._guard.Finish ? this._guard.Finish() : null;
    if (e) return [null, e];
    this._priorGraphStateShared = true;
    const cloned = new Transaction(
      this.Graph,
      this._options,
      this._guard,
      this.PriorGraphState
    );
    cloned.Ops = this.Ops.slice();
    cloned._priorGraphStateShared = true;
    return [cloned, null];
  }

  cloneGeometryContext() {
    return this.CloneGeometryContext();
  }

  // ── Commit ─────────────────────────────────────────────────────────────────

  Commit(ctx) {
    if (ctx == null) return new Error('TALA transaction commit requires a context');
    if (this._guard == null) return new Error('TALA transaction commit requires a work guard');

    let commitErr = null;
    try {
      commitErr = this._doCommit(ctx);
    } catch (recovered) {
      this.Rollback();
      if (isCandidateRejection(recovered)) {
        return recovered;
      }
      throw recovered;
    }
    if (commitErr != null) {
      this.Rollback();
    }
    return commitErr;
  }

  commit(ctx) {
    return this.Commit(ctx);
  }

  _doCommit(ctx) {
    const getCtxErr = (c) => {
      if (!c) return null;
      if (typeof c.Err === 'function') return c.Err();
      if (typeof c.isCancelled === 'function' && c.isCancelled()) return new Error('context canceled');
      return null;
    };

    // Run all ops
    for (const op of this.Ops) {
      const err = getCtxErr(ctx);
      if (err) return err;
      const opErr = op();
      if (opErr) return opErr;
    }

    const ctxErr = getCtxErr(ctx);
    if (ctxErr) return ctxErr;

    // Reposition containers if needed
    if (this._options.AffectContainers) {
      const e = this._repositionContainers(ctx);
      if (e) return e;

      // Validate containers
      if (this.Graph.Containers) {
        for (const [container] of this.Graph.Containers.entries()) {
          const e2 = getCtxErr(ctx);
          if (e2) return e2;
          if (container == null || container.TopLeft == null) continue;
          const [bad, badErr] = this.Graph.isBadStateContext
            ? this.Graph.isBadStateContext(container, this.PriorGraphState, this._options.IgnoreContainerEscape, this._guard)
            : [false, null];
          if (badErr) return badErr;
          if (bad) return ErrInvalidCandidate;
        }
      }
      this.Graph.SyncClusters ? this.Graph.SyncClusters() : null;
      this.Graph.SyncSequences ? this.Graph.SyncSequences() : null;
    }

    // Collect dirty nodes
    const [useDirtyValidation, dirtyErr] = this._collectOverlapValidationNodes(ctx);
    if (dirtyErr) return dirtyErr;

    // Collect fixed origins
    const fixedErr = this._collectFixedOrigins(ctx);
    if (fixedErr) return fixedErr;

    // Structural bad-state check for every placed node
    for (const n of (this.Graph.Nodes || [])) {
      const e1 = ctx.Err ? ctx.Err() : null;
      if (e1) return e1;
      if (n == null) return new Error('transaction bad-state check received a nil node');
      if (n.TopLeft == null) continue;

      let fixedOriginPointer = null;
      if (this._fixedOrigins) {
        const container = (typeof n.container === 'function') ? n.container() : n.Container;
        const fo = this._fixedOrigins.get(container);
        if (fo !== undefined) fixedOriginPointer = fo;
      }

      const badResult = this.Graph.isStructurallyBadStateWithFixedOriginContext
        ? this.Graph.isStructurallyBadStateWithFixedOriginContext(
            n,
            this.PriorGraphState,
            this._options.IgnoreContainerEscape,
            fixedOriginPointer,
            true,
            this._guard
          )
        : [false, false, null];
      const [bad, , badErr] = badResult;
      if (badErr) return badErr;
      if (bad) return ErrInvalidCandidate;
    }

    // Build post-state overlap candidates
    const candidateErr = this._buildPostStateOverlapCandidates(ctx, useDirtyValidation);
    if (candidateErr) return candidateErr;

    // Check pairwise overlaps
    for (let nodeIndex = 0; nodeIndex < (this.Graph.Nodes || []).length; nodeIndex++) {
      if (!this._overlapCandidates[nodeIndex] || this._overlapCandidates[nodeIndex].length === 0) continue;
      const e1 = ctx.Err ? ctx.Err() : null;
      if (e1) return e1;
      const n = this.Graph.Nodes[nodeIndex];
      if (n.TopLeft == null) continue;
      const [bad, badErr] = this._hasBadPostStateOverlap(nodeIndex);
      if (badErr) return badErr;
      if (bad) return ErrInvalidCandidate;
    }

    // Check non-exact → exact overlap regression
    if (this.PriorGraphState.existingOverlaps) {
      for (const [n1, overlaps] of this.PriorGraphState.existingOverlaps.entries()) {
        const e1 = ctx.Err ? ctx.Err() : null;
        if (e1) return e1;
        for (const n2 of overlaps) {
          if (useDirtyValidation) {
            const firstChanged = this._dirtyNodes && this._dirtyNodes.has(n1);
            const secondChanged = this._dirtyNodes && this._dirtyNodes.has(n2);
            if (!firstChanged && !secondChanged) continue;
          }
          const wasExact =
            this.PriorGraphState.existingExactOverlaps &&
            this.PriorGraphState.existingExactOverlaps.has(n1) &&
            this.PriorGraphState.existingExactOverlaps.get(n1).has(n2);
          if (!wasExact) {
            if (_doesOverlapExact(n1, n2)) return ErrInvalidCandidate;
          }
        }
      }
    }

    return null;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  _repositionContainers(ctx) {
    const smallestToLargest = [];
    if (this.Graph.Containers) {
      for (const [container] of this.Graph.Containers.entries()) {
        if (container == null || container.TopLeft == null) continue;
        smallestToLargest.push(container);
      }
    }
    smallestToLargest.sort((a, b) => {
      const aArea = a.Width * a.Height;
      const bArea = b.Width * b.Height;
      if (aArea !== bArea) return aArea - bArea;
      const aId = BigInt(a.ID != null ? a.ID : 0);
      const bId = BigInt(b.ID != null ? b.ID : 0);
      if (aId < bId) return -1;
      if (aId > bId) return 1;
      return 0;
    });
    for (const container of smallestToLargest) {
      const e = ctx.Err ? ctx.Err() : null;
      if (e) return e;
      if (typeof container.wrapChildren === 'function') {
        container.wrapChildren();
      } else if (typeof container.WrapChildren === 'function') {
        container.WrapChildren();
      }
    }
    return null;
  }

  _collectFixedOrigins(ctx) {
    if (this._fixedOrigins == null) {
      this._fixedOrigins = new Map();
    } else {
      this._fixedOrigins.clear();
    }
    if (!this.PriorGraphState.hasFixedTopLeft) return null;
    for (const node of (this.Graph.Nodes || [])) {
      const e = ctx.Err ? ctx.Err() : null;
      if (e) return e;
      if (node == null || node.TopLeft == null || node.FixedTopLeft == null) continue;
      const container = (typeof node.container === 'function') ? node.container() : (node.Container || null);
      if (this._fixedOrigins.has(container)) continue;
      this._fixedOrigins.set(container, {
        X: node.TopLeft.X - node.FixedTopLeft.X,
        Y: node.TopLeft.Y - node.FixedTopLeft.Y,
      });
    }
    return null;
  }

  _collectOverlapValidationNodes(ctx) {
    if (!this.PriorGraphState.hasOriginalNodeOrder(this.Graph)) {
      return [false, null];
    }
    if (this._dirtyNodes == null) {
      this._dirtyNodes = new Map();
    } else {
      this._dirtyNodes.clear();
    }
    const nodeCount = this.Graph.Nodes.length;
    if (this._dirtyNodeMarks.length !== nodeCount) {
      this._dirtyNodeMarks = new Array(nodeCount).fill(false);
    } else {
      this._dirtyNodeMarks.fill(false);
    }
    for (let index = 0; index < nodeCount; index++) {
      const e = ctx.Err ? ctx.Err() : null;
      if (e) return [false, e];
      const node = this.Graph.Nodes[index];
      if (this.PriorGraphState.geometryChanged(node)) {
        this._dirtyNodes.set(node, true);
        this._dirtyNodeMarks[index] = true;
      }
    }
    return [true, null];
  }

  _transactionBoxesMayInteract(first, second) {
    if (first == null || second == null || first === second || first.TopLeft == null || second.TopLeft == null) {
      return false;
    }
    return !(
      first.TopLeft.X > second.TopLeft.X + second.Width + MAX_SAFE_DELTA ||
      first.TopLeft.X + first.Width + MAX_SAFE_DELTA < second.TopLeft.X ||
      first.TopLeft.Y > second.TopLeft.Y + second.Height + MAX_SAFE_DELTA ||
      first.TopLeft.Y + first.Height + MAX_SAFE_DELTA < second.TopLeft.Y
    );
  }

  _buildPostStateOverlapCandidates(ctx, dirtyOnly) {
    const nodeCount = (this.Graph.Nodes || []).length;

    // Resize overlapCandidates
    if (this._overlapCandidates.length < nodeCount) {
      for (let i = this._overlapCandidates.length; i < nodeCount; i++) {
        this._overlapCandidates.push([]);
      }
    } else {
      this._overlapCandidates.length = nodeCount;
    }
    for (let i = 0; i < nodeCount; i++) {
      this._overlapCandidates[i] = this._overlapCandidates[i] || [];
      this._overlapCandidates[i].length = 0;
    }

    // Resize overlapInvalidBoxes
    if (this._overlapInvalidBoxes.length !== nodeCount) {
      this._overlapInvalidBoxes = new Array(nodeCount).fill(false);
    } else {
      this._overlapInvalidBoxes.fill(false);
    }

    // Resize exceptionMarks
    if (this._exceptionMarks.length !== nodeCount) {
      this._exceptionMarks = new Array(nodeCount).fill(0);
    }

    const rebuildNodeIndex = !dirtyOnly || !this._overlapNodeIndexReady;
    if (this._overlapNodeIndices == null) {
      this._overlapNodeIndices = new Map();
    } else if (rebuildNodeIndex) {
      for (const [, indices] of this._overlapNodeIndices.entries()) {
        indices.length = 0;
      }
    }

    this._overlapSweepNodes = [];
    let hasInvalidBox = false;
    let dirtyCount = 0;

    for (let index = 0; index < nodeCount; index++) {
      const e = ctx.Err ? ctx.Err() : null;
      if (e) return e;
      const node = this.Graph.Nodes[index];
      if (node == null) return new Error('transaction overlap check encountered a nil graph node');
      if (rebuildNodeIndex) {
        let arr = this._overlapNodeIndices.get(node);
        if (!arr) { arr = []; this._overlapNodeIndices.set(node, arr); }
        arr.push(index);
      }
      if (dirtyOnly && this._dirtyNodeMarks[index]) dirtyCount++;
      if (node.TopLeft == null) continue;
      if (!transactionNodeHasFiniteBox(node)) {
        this._overlapInvalidBoxes[index] = true;
        hasInvalidBox = true;
        continue;
      }
      this._overlapSweepNodes.push({ node, index });
    }
    this._overlapNodeIndexReady = dirtyOnly;

    let retainedReferences = 0;
    const addPair = (first, second) => {
      if (retainedReferences > MAX_TRANSACTION_OVERLAP_REFERENCES - 2) {
        return new Error(`TALA transaction overlap references exceed limit ${MAX_TRANSACTION_OVERLAP_REFERENCES}`);
      }
      this._overlapCandidates[first].push(second);
      this._overlapCandidates[second].push(first);
      retainedReferences += 2;
      return null;
    };

    const useDirtyScan = dirtyOnly && dirtyCount * 4 < nodeCount;
    if (useDirtyScan) {
      for (let first = 0; first < nodeCount; first++) {
        if (!this._dirtyNodeMarks[first] || this.Graph.Nodes[first].TopLeft == null) continue;
        const firstNode = this.Graph.Nodes[first];
        for (let second = 0; second < nodeCount; second++) {
          if (second === first) continue;
          const secondNode = this.Graph.Nodes[second];
          if (firstNode === secondNode || secondNode.TopLeft == null) continue;
          if (dirtyOnly && this._dirtyNodeMarks[second] && second < first) continue;
          if (!this._transactionBoxesMayInteract(firstNode, secondNode)) continue;
          const err = addPair(first, second);
          if (err) return err;
        }
      }
    } else {
      // Sweep-line sort
      this._overlapSweepNodes.sort((l, r) => {
        if (l.node.TopLeft.X !== r.node.TopLeft.X) {
          return l.node.TopLeft.X < r.node.TopLeft.X ? -1 : 1;
        }
        const lId = BigInt(l.node.ID != null ? l.node.ID : 0);
        const rId = BigInt(r.node.ID != null ? r.node.ID : 0);
        if (lId < rId) return -1;
        if (lId > rId) return 1;
        return l.index - r.index;
      });

      this._overlapActiveNodes = [];
      for (const current of this._overlapSweepNodes) {
        const kept = [];
        for (const other of this._overlapActiveNodes) {
          if (other.node.TopLeft.X + other.node.Width + 500 < current.node.TopLeft.X) continue;
          kept.push(other);
          if (other.node === current.node || !this._transactionBoxesMayInteract(other.node, current.node)) continue;
          if (dirtyOnly && !this._dirtyNodeMarks[other.index] && !this._dirtyNodeMarks[current.index]) continue;
          const err = addPair(other.index, current.index);
          if (err) return err;
        }
        kept.push(current);
        this._overlapActiveNodes = kept;
      }

      // Invalid boxes — fallback all-pairs
      if (hasInvalidBox) {
        for (let first = 0; first < nodeCount; first++) {
          for (let second = first + 1; second < nodeCount; second++) {
            if (!this._overlapInvalidBoxes[first] && !this._overlapInvalidBoxes[second]) continue;
            if (dirtyOnly && !this._dirtyNodeMarks[first] && !this._dirtyNodeMarks[second]) continue;
            const firstNode = this.Graph.Nodes[first];
            const secondNode = this.Graph.Nodes[second];
            if (firstNode === secondNode || firstNode.TopLeft == null || secondNode.TopLeft == null) continue;
            if (!this._transactionBoxesMayInteract(firstNode, secondNode)) continue;
            const err = addPair(first, second);
            if (err) return err;
          }
        }
      }
    }

    // Sort candidate lists
    for (const candidates of this._overlapCandidates) {
      candidates.sort((a, b) => a - b);
    }

    return null;
  }

  _markOverlapException(node, generation) {
    const indices = this._overlapNodeIndices ? this._overlapNodeIndices.get(node) : null;
    if (!indices) return;
    for (const index of indices) {
      this._exceptionMarks[index] = generation;
    }
  }

  _markDescendantOverlapExceptions(node, includeClusterNodes, generation) {
    this._descendantGeneration++;
    if (this._descendantGeneration === 0 || this._descendantGeneration > 0xFFFFFFFF) {
      if (this._descendantSeen) this._descendantSeen.clear();
      this._descendantGeneration = 1;
    }
    const seenGeneration = this._descendantGeneration;
    if (!this._descendantSeen) this._descendantSeen = new Map();
    this._descendantStack = [];
    this._descendantNodes = [];
    if (node != null) this._descendantSeen.set(node, seenGeneration);

    const g = this.Graph;
    const pushChildren = (parent) => {
      // Sequence members
      if (g.Sequences) {
        const seq = g.Sequences.get(parent);
        if (seq && seq.Nodes) {
          for (let i = seq.Nodes.length - 1; i >= 0; i--) {
            this._descendantStack.push({ node: seq.Nodes[i], emit: includeClusterNodes });
          }
        }
      }
      // Cluster members
      if (parent != null && parent.isClusterVessel && g.Clusters) {
        const cluster = g.Clusters.get(parent);
        if (cluster && cluster.Nodes) {
          for (let i = cluster.Nodes.length - 1; i >= 0; i--) {
            this._descendantStack.push({ node: cluster.Nodes[i], emit: includeClusterNodes });
          }
        }
      }
      // Container children
      if (parent == null || parent.isContainer) {
        const children = g.Containers ? g.Containers.get(parent) : null;
        if (children) {
          for (let i = children.length - 1; i >= 0; i--) {
            this._descendantStack.push({ node: children[i], emit: true });
          }
        }
      }
    };

    pushChildren(node);
    while (this._descendantStack.length > 0) {
      const current = this._descendantStack.pop();
      if (current.node == null || this._descendantSeen.get(current.node) === seenGeneration) continue;
      this._descendantSeen.set(current.node, seenGeneration);
      if (current.emit) this._descendantNodes.push(current.node);
      pushChildren(current.node);
    }
    for (const descendant of this._descendantNodes) {
      this._markOverlapException(descendant, generation);
    }
  }

  _hasBadPostStateOverlap(nodeIndex) {
    const node = this.Graph.Nodes[nodeIndex];
    if (node == null || node.TopLeft == null) return [node == null, null];
    if (node.Cluster != null) return [false, null];

    this._exceptionGeneration++;
    if (this._exceptionGeneration === 0 || this._exceptionGeneration > 0xFFFFFFFF) {
      this._exceptionMarks.fill(0);
      this._exceptionGeneration = 1;
    }
    const generation = this._exceptionGeneration;

    if (node.isContainer || node.isClusterVessel || (this.Graph.Sequences && this.Graph.Sequences.get(node))) {
      this._markDescendantOverlapExceptions(node, true, generation);
    }

    if (node.Container != null || node.Cluster != null || node.Sequence != null) {
      if (this.Graph.ancestorsOfGuarded) {
        const ancestors = this.Graph.ancestorsOfGuarded(node, this._guard);
        for (const ancestor of ancestors) {
          this._markOverlapException(ancestor, generation);
        }
      }
    }

    const pairwiseExceptions = this.PriorGraphState.existingOverlaps
      ? this.PriorGraphState.existingOverlaps.get(node)
      : null;
    const right = node.TopLeft.X + node.Width;
    const bottom = node.TopLeft.Y + node.Height;

    for (const otherIndex of this._overlapCandidates[nodeIndex]) {
      const other = this.Graph.Nodes[otherIndex];
      if (other == null) return [false, new Error('transaction overlap check encountered a nil graph node')];
      const isExcepted = (pairwiseExceptions && pairwiseExceptions.has(other)) ||
                         this._exceptionMarks[otherIndex] === generation;
      if (isExcepted) continue;
      if (other.TopLeft == null || !this._transactionBoxesMayInteract(node, other)) continue;

      const delta = (typeof node.deltaTo === 'function')
        ? Number(node.deltaTo(other, node.TopLeft))
        : 0;

      if (
        node.TopLeft.X < other.TopLeft.X + other.Width + delta &&
        right + delta > other.TopLeft.X &&
        node.TopLeft.Y < other.TopLeft.Y + other.Height + delta &&
        bottom + delta > other.TopLeft.Y
      ) {
        return [true, null];
      }
    }
    return [false, null];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Noop guard — used when callers don't provide a work guard
// ──────────────────────────────────────────────────────────────────────────────

const noopGuard = {
  Step() { return null; },
  Finish() { return null; },
  Add() { return null; },
  AddSort() { return null; },
};

// ──────────────────────────────────────────────────────────────────────────────
// Graph-level factory functions (to be mixed into Graph or called standalone)
// Mirrors: Graph.newRequestTransaction, Graph.newTransactionWithOptionsContext
// ──────────────────────────────────────────────────────────────────────────────

/**
 * newRequestTransaction constructs a new Transaction for the given graph.
 * Mirrors: Go Graph.newRequestTransaction / Graph.newTransactionWithOptionsContext
 *
 * @param {import('./graph.js').Graph} g
 * @param {object} ctx — { Err(): null|Error }
 * @param {TransactionOptions|object} options
 * @returns {[Transaction, null]|[null, Error]}
 */
export function newRequestTransaction(g, ctx, options) {
  const opts = options instanceof TransactionOptions ? options : new TransactionOptions(options || {});
  return newTransactionWithOptionsContext(g, ctx, opts, noopGuard);
}

/**
 * newTransactionWithOptionsContext is the low-level factory used by both
 * newRequestTransaction and newRequestTransactionWithGuard.
 * Mirrors: Go Graph.newTransactionWithOptionsContext
 *
 * @param {import('./graph.js').Graph} g
 * @param {object} ctx
 * @param {TransactionOptions} options
 * @param {object} guard
 * @returns {[Transaction, null]|[null, Error]}
 */
export function newTransactionWithOptionsContext(g, ctx, options, guard) {
  if (guard == null) guard = noopGuard;
  if (ctx == null) return [null, new Error('TALA transaction requires a context')];
  if (g == null) return [null, new Error('TALA transaction requires a graph')];

  const graphState = new GraphState();
  graphState.captureEdgeRoutes = options.AffectEdgeRoutes;
  const updateErr = graphState.updateContext(g, guard);
  if (updateErr) return [null, updateErr];

  const [existingOverlaps, existingExactOverlaps, overlapErr] = buildTransactionOverlaps(g);
  if (overlapErr) return [null, overlapErr];

  graphState.existingOverlaps = existingOverlaps;
  graphState.existingExactOverlaps = existingExactOverlaps;

  const txn = new Transaction(g, options, guard, graphState);
  return [txn, null];
}

/**
 * restoreGraphState restores graph geometry from a previously-captured GraphState.
 * Used by optimizeClustersRollback.restore() path.
 * Mirrors: Go layoutgraph.RestoreGraphState (exported from layoutgraph package)
 *
 * @param {import('./graph.js').Graph} g
 * @param {GraphState} state
 */
export function restoreGraphState(g, state) {
  if (g == null || state == null) return;
  // Restore node geometry
  if (state.nodeGeometry) {
    for (const [node, geometry] of state.nodeGeometry.entries()) {
      if (geometry.topLeft != null) {
        if (geometry.topLeft.pointer != null) {
          node.TopLeft = geometry.topLeft.restore();
        } else {
          node.TopLeft = null;
        }
      } else {
        node.TopLeft = null;
      }
      node.Width = geometry.width;
      node.Height = geometry.height;
    }
  }
  if (state.clusterArrangements) {
    for (const [cluster, arrangement] of state.clusterArrangements.entries()) {
      cluster.Arrangement = arrangement;
      if (state.clusterDesired) cluster.DesiredArrangement = state.clusterDesired.get(cluster);
      if (state.clusterPaddings) cluster.Padding = state.clusterPaddings.get(cluster);
    }
  }
  if (state.edgeGeometry) {
    for (const [edge, snap] of state.edgeGeometry.entries()) {
      snap.restore(edge);
    }
  }
  if (state.treeOrientations) {
    for (const [tree, orientation] of state.treeOrientations.entries()) {
      tree.Orientation = orientation;
    }
  }
  if (state.originalNodesRef != null && state.originalNodes != null) {
    state.originalNodesRef.length = state.originalNodes.length;
    for (let i = 0; i < state.originalNodes.length; i++) {
      state.originalNodesRef[i] = state.originalNodes[i];
    }
    g.Nodes = state.originalNodesRef;
  }
}

export const RestoreGraphState = restoreGraphState;
