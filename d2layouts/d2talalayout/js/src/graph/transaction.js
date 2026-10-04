/**
 * Transaction substrate for TALA JS.
 *
 * Ported from:
 *   d2layouts/d2talalayout/internal/layoutgraph/transaction.go
 *   d2layouts/d2talalayout/internal/layoutgraph/errors.go
 *   d2layouts/d2talalayout/internal/layoutgraph/placement_access.go (OriginalDimensions)
 *   d2layouts/d2talalayout/internal/layoutgraph/structure_api.go (RestoreGraphState)
 *
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * Rollback points reuse the approved GraphState port (graph-state.js), which
 * mirrors Go GraphState.updateContext / captureGeometryStateContext /
 * Rollback including pointer identity and work accounting.
 *
 * Error conventions:
 *   - Errors that pinned Go *returns* are returned (Commit, UpdateState,
 *     CapturePlacementCosts, constructors as [value, err] tuples).
 *   - WorkGuard failures throw (the established JS WorkGuard contract).
 *   - Anything thrown while Commit runs rolls the graph back and is rethrown
 *     with its original identity (Go: rollback before repanicking).
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import {
  MAX_ENGINE_NODES,
  MAX_TOPOLOGY_REFERENCES,
  MAX_TRANSACTION_OVERLAP_REFERENCES,
} from '../limits/constants.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { getContextError } from '../limits/work-context.js';
import { GraphState } from './graph-state.js';

const TABLE_NODE_GAP = 120;
const NODE_GAP = 20;
const MAX_SAFE_DELTA = 500.0;
const OVERLAP_REFERENCE_LIMIT = Number(MAX_TRANSACTION_OVERLAP_REFERENCES);

function invariantError(reason) {
  return new Error(`layout invariant violated: ${reason}`);
}

function contextErr(ctx) {
  return getContextError(ctx);
}

function compareIDs(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sentinel errors — Go: ErrInvalidCandidate, ErrNonImprovingCandidate
// ──────────────────────────────────────────────────────────────────────────────

export class InvalidCandidateError extends Error {
  constructor() {
    super('invalid layout candidate');
    this.name = 'InvalidCandidateError';
  }
}

export class NonImprovingCandidateError extends Error {
  constructor() {
    super('layout candidate did not improve');
    this.name = 'NonImprovingCandidateError';
  }
}

/** Singleton instances matching Go ErrInvalidCandidate / ErrNonImprovingCandidate. */
export const ErrInvalidCandidate = new InvalidCandidateError();
export const ErrNonImprovingCandidate = new NonImprovingCandidateError();

function errorChainContains(err, predicate) {
  const seen = new Set();
  for (let current = err; current != null && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (predicate(current)) return true;
    if (typeof current !== 'object') return false;
  }
  return false;
}

/** Go errors.Is(err, ErrInvalidCandidate), following `cause` wrapping. */
export function isInvalidCandidate(err) {
  return errorChainContains(err, (e) => e instanceof InvalidCandidateError);
}

/** Go errors.Is(err, ErrNonImprovingCandidate), following `cause` wrapping. */
export function isNonImprovingCandidate(err) {
  return errorChainContains(err, (e) => e instanceof NonImprovingCandidateError);
}

/**
 * isCandidateRejection reports whether err rejects only the current
 * speculative candidate. Callers must propagate every other error.
 *
 * Pinned Go: layoutgraph.IsCandidateRejection
 * @param {*} err
 * @returns {boolean}
 */
export function isCandidateRejection(err) {
  return isInvalidCandidate(err) || isNonImprovingCandidate(err);
}

export const IsCandidateRejection = isCandidateRejection;

// ──────────────────────────────────────────────────────────────────────────────
// TransactionOptions
// ──────────────────────────────────────────────────────────────────────────────

const TRANSACTION_OPTION_KEYS = new Set(['AffectContainers', 'IgnoreContainerEscape', 'AffectEdgeRoutes']);

export class TransactionOptions {
  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!TRANSACTION_OPTION_KEYS.has(key)) {
        throw new TypeError(`TALA transaction option ${key} is not supported`);
      }
    }
    const {
      AffectContainers = false,
      IgnoreContainerEscape = false,
      AffectEdgeRoutes = false,
    } = options;
    this.AffectContainers = Boolean(AffectContainers);
    this.IgnoreContainerEscape = Boolean(IgnoreContainerEscape);
    this.AffectEdgeRoutes = Boolean(AffectEdgeRoutes);
  }
}

function normalizeOptions(options) {
  return options instanceof TransactionOptions ? options : new TransactionOptions(options || {});
}

// ──────────────────────────────────────────────────────────────────────────────
// GraphState helpers that live in transaction.go
// ──────────────────────────────────────────────────────────────────────────────

/** Go GraphState.hasOriginalNodeOrder */
function hasOriginalNodeOrder(state, g) {
  if (state == null || g == null || state.originalNodes == null || state.originalNodes.length !== g.Nodes.length) {
    return false;
  }
  for (let i = 0; i < g.Nodes.length; i++) {
    if (state.originalNodes[i] !== g.Nodes[i]) return false;
  }
  return true;
}

/** Go GraphState.geometryChanged */
function geometryChanged(state, node) {
  if (state == null || node == null) return true;
  const original = state.nodeGeometry.get(node);
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

// ──────────────────────────────────────────────────────────────────────────────
// Existing-overlap construction (Go transactionSweepPadding / buildTransactionOverlaps)
// ──────────────────────────────────────────────────────────────────────────────

function transactionFinite(value) {
  return Number.isFinite(value);
}

function transactionNodeHasFiniteBox(node) {
  return (
    node != null &&
    node.TopLeft != null &&
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

function nodeMargin(node) {
  const margin = node._margin ?? {};
  return [margin.top ?? 0, margin.right ?? 0, margin.bottom ?? 0, margin.left ?? 0];
}

function loopOffsetValues(node) {
  const offsets = node.LoopOffsets;
  if (offsets == null) return [];
  if (offsets instanceof Map) return Array.from(offsets.values());
  return Object.values(offsets);
}

/**
 * Go transactionSweepPadding. Returns [padding, err]; WorkGuard failures throw.
 */
function transactionSweepPadding(g, guard) {
  let padding = TABLE_NODE_GAP;
  let maxMargin = 0;
  let maxLoopOffset = 0;
  const edges = new Set();
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null) {
      return [0, new Error('TALA transaction contains a nil node')];
    }
    if (node.TopLeft != null && !transactionNodeHasFiniteBox(node)) {
      const children = g.Containers ? g.Containers.get(node) : null;
      if (node.isContainer && (children == null || children.length === 0)) {
        continue;
      }
      return [0, invariantError(
        `transaction node ${node.ID} has invalid geometry (x=${node.TopLeft.X} y=${node.TopLeft.Y} width=${node.Width} height=${node.Height})`,
      )];
    }
    const margins = nodeMargin(node);
    for (const margin of margins) {
      if (!transactionFinite(margin)) {
        return [0, invariantError(`transaction node ${node.ID} has non-finite margin`)];
      }
    }
    maxMargin = Math.max(maxMargin, ...margins);
    for (const offset of loopOffsetValues(node)) {
      guard.Step();
      if (!transactionFinite(offset)) {
        return [0, invariantError(`transaction node ${node.ID} has a non-finite loop offset`)];
      }
      if (offset > maxLoopOffset) maxLoopOffset = offset;
    }
    for (const edge of node.Edges) {
      guard.Step();
      if (edge == null) {
        return [0, new Error(`TALA transaction node ${node.ID} contains a nil edge`)];
      }
      edges.add(edge);
    }
  }
  for (const edge of g.Edges) {
    guard.Step();
    if (edge == null) {
      return [0, new Error('TALA transaction contains a nil edge')];
    }
    edges.add(edge);
  }
  for (const edge of edges) {
    guard.Step();
    padding = Math.max(padding, Number(edge.MinWidth), Number(edge.MinHeight));
  }
  padding = Math.max(padding, 2 * maxMargin, NODE_GAP + 2 * maxLoopOffset);
  if (!transactionFinite(padding)) {
    return [0, invariantError('transaction overlap padding is non-finite')];
  }
  guard.Finish();
  return [padding, null];
}

function compareSweepNodes(left, right) {
  if (left.node.TopLeft.X !== right.node.TopLeft.X) {
    if (left.node.TopLeft.X < right.node.TopLeft.X) return -1;
    if (right.node.TopLeft.X < left.node.TopLeft.X) return 1;
    return 0;
  }
  const order = compareIDs(left.node.ID, right.node.ID);
  if (order !== 0) return order;
  return left.index - right.index;
}

/**
 * Go buildTransactionOverlapsWithReferenceLimit.
 * @returns {[Map|null, Map|null, Error|null]}
 */
export function buildTransactionOverlapsWithReferenceLimit(g, guard, referenceLimit) {
  const [padding, paddingErr] = transactionSweepPadding(g, guard);
  if (paddingErr != null) return [null, null, paddingErr];

  const placed = [];
  for (let index = 0; index < g.Nodes.length; index++) {
    guard.Step();
    const node = g.Nodes[index];
    if (node.TopLeft != null && transactionNodeHasFiniteBox(node)) {
      placed.push({ node, index });
    }
  }
  guard.Step();
  placed.sort(compareSweepNodes);

  const existingOverlaps = new Map();
  const existingExactOverlaps = new Map();
  let retainedReferences = 0;
  const addPair = (overlaps, first, second) => {
    if (referenceLimit < 2 || retainedReferences > referenceLimit - 2) {
      return new Error(`TALA transaction overlap references exceed limit ${referenceLimit}`);
    }
    if (!overlaps.has(first)) overlaps.set(first, new Set());
    if (!overlaps.has(second)) overlaps.set(second, new Set());
    overlaps.get(first).add(second);
    overlaps.get(second).add(first);
    retainedReferences += 2;
    return null;
  };

  let active = [];
  for (const current of placed) {
    guard.Step();
    const kept = [];
    for (const other of active) {
      guard.Step();
      if (other === current.node) continue;
      if (other.TopLeft.X + other.Width + padding <= current.node.TopLeft.X) continue;
      kept.push(other);
      if (
        other.TopLeft.Y >= current.node.TopLeft.Y + current.node.Height + padding ||
        current.node.TopLeft.Y >= other.TopLeft.Y + other.Height + padding
      ) {
        continue;
      }
      if (current.node.doesOverlapExact(other)) {
        const err = addPair(existingExactOverlaps, current.node, other);
        if (err != null) return [null, null, err];
      }
      if (current.node.doesOverlap(other) || other.doesOverlap(current.node)) {
        const err = addPair(existingOverlaps, current.node, other);
        if (err != null) return [null, null, err];
      }
    }
    kept.push(current.node);
    active = kept;
  }
  guard.Finish();
  return [existingOverlaps, existingExactOverlaps, null];
}

/** Go buildTransactionOverlaps. */
export function buildTransactionOverlaps(g, guard) {
  return buildTransactionOverlapsWithReferenceLimit(g, guard, OVERLAP_REFERENCE_LIMIT);
}

// ──────────────────────────────────────────────────────────────────────────────
// Transaction
// Mirrors: layoutgraph.Transaction
// ──────────────────────────────────────────────────────────────────────────────

export class Transaction {
  /**
   * @param {import('./graph.js').Graph} graph
   * @param {TransactionOptions} options
   * @param {import('../limits/work-guard.js').WorkGuard} guard
   * @param {GraphState} graphState
   */
  constructor(graph, options, guard, graphState) {
    /** @type {Array<function(): (Error|null|undefined)>} */
    this.Ops = [];
    this.Graph = graph;
    this._options = options;
    this._guard = guard;
    /** @type {GraphState} */
    this.PriorGraphState = graphState;
    /** @type {GraphState|null} */
    this._spareGraphState = null;
    this._placementCostSnapshot = null;

    this._dirtyNodes = null;
    this._dirtyNodeMarks = [];
    this._fixedOrigins = null;

    this._overlapCandidates = [];
    this._overlapSweepNodes = [];
    this._overlapActiveNodes = [];
    this._overlapNodeIndices = null;
    this._overlapNodeIndexReady = false;
    this._priorGraphStateShared = false;
    this._overlapInvalidBoxes = [];
    this._exceptionMarks = [];
    this._exceptionGeneration = 0;
    this._descendantStack = [];
    this._descendantNodes = [];
    this._descendantSeen = null;
    this._descendantGeneration = 0;
  }

  get options() { return this._options; }

  /** Shared request work guard (test and diagnostics access). */
  get guard() { return this._guard; }

  /**
   * OriginalDimensions returns the dimensions recorded at the current rollback
   * point. Go: zero values for untracked nodes.
   * @returns {[number, number]}
   */
  OriginalDimensions(node) {
    const geometry = this.PriorGraphState.nodeGeometry.get(node);
    if (geometry === undefined) return [0, 0];
    return [geometry.width, geometry.height];
  }

  originalDimensions(node) {
    return this.OriginalDimensions(node);
  }

  /** Go Transaction.PreservePriorGraphState */
  PreservePriorGraphState() {
    this._priorGraphStateShared = true;
    return this.PriorGraphState;
  }

  preservePriorGraphState() {
    return this.PreservePriorGraphState();
  }

  /**
   * Go Transaction.CapturePlacementCosts. Returns an Error or null; WorkGuard
   * failures throw.
   */
  CapturePlacementCosts(location) {
    if (this.Graph == null || this._guard == null) {
      return new Error(`TALA ${location} placement-cost snapshot requires an initialized transaction`);
    }
    if (this._placementCostSnapshot != null) return null;
    const cacheEntries = this.Graph.edgeLengthCacheEntries();
    if (cacheEntries > MAX_TOPOLOGY_REFERENCES) {
      return new Error(`TALA ${location} edge-length cache entries exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
    }
    for (let i = 0; i < cacheEntries; i++) {
      this._guard.Step();
    }
    const costs = this.Graph.snapshotPlacementCosts();
    this._guard.Finish();
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
    costs.restore();
    return true;
  }

  restorePlacementCosts() {
    return this.RestorePlacementCosts();
  }

  AddOp(fn) {
    this.Ops.push(fn);
  }

  addOp(fn) {
    this.AddOp(fn);
  }

  /** Clear only needs to be called if the transaction will be reused. */
  Clear() {
    this.Ops = [];
  }

  clear() {
    this.Clear();
  }

  /**
   * UpdateState advances the rollback point to the current graph. Existing-
   * overlap exceptions remain anchored to construction. A failed refresh only
   * mutates the spare snapshot, so the prior rollback point is still exact and
   * the accepted candidate is rolled back before the error is returned.
   *
   * Pinned Go: Transaction.UpdateState
   * @returns {Error|null}
   */
  UpdateState() {
    const previous = this.PriorGraphState;
    let updated = this._spareGraphState;
    if (updated == null) {
      updated = new GraphState();
    }
    updated.captureTopology = previous.captureTopology;
    updated.captureEdgeRoutes = previous.captureEdgeRoutes;
    try {
      updated.updateWithWorkGuard(this.Graph, this._guard);
    } catch (err) {
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

  /** Go Transaction.Rollback */
  Rollback() {
    this.PriorGraphState.rollback(this.Graph);
  }

  rollback() {
    this.Rollback();
  }

  /**
   * CloneGeometryContext creates a nested speculative transaction that shares
   * the immutable rollback point. Go: Transaction.CloneGeometryContext
   * @returns {[Transaction|null, Error|null]}
   */
  CloneGeometryContext() {
    if (this.PriorGraphState == null || this._guard == null) {
      return [null, new Error('TALA geometry transaction clone requires an initialized transaction')];
    }
    if (this.PriorGraphState.captureTopology) {
      return [null, new Error('TALA topology transaction requires an independent clone')];
    }
    this._guard.Finish();
    this._priorGraphStateShared = true;
    const cloned = new Transaction(this.Graph, this._options, this._guard, this.PriorGraphState);
    cloned.Ops = this.Ops.slice();
    cloned._priorGraphStateShared = true;
    return [cloned, null];
  }

  cloneGeometryContext() {
    return this.CloneGeometryContext();
  }

  /**
   * Commit runs every operation and validates the resulting graph. Any
   * returned error rolls back; anything thrown rolls back and is rethrown with
   * its original identity.
   *
   * Pinned Go: Transaction.Commit
   * @returns {Error|null}
   */
  Commit(ctx) {
    let err;
    try {
      err = this._commit(ctx);
    } catch (recovered) {
      this.Rollback();
      throw recovered;
    }
    if (err != null) {
      this.Rollback();
      return err;
    }
    return null;
  }

  commit(ctx) {
    return this.Commit(ctx);
  }

  _commit(ctx) {
    if (ctx == null) {
      return new Error('TALA transaction commit requires a context');
    }
    const guard = this._guard;
    if (guard == null) {
      return new Error('TALA transaction commit requires a work guard');
    }
    guard.Finish();
    let err = contextErr(ctx);
    if (err != null) return err;

    // Go ranges over the slice header captured at loop entry.
    const ops = this.Ops;
    const opCount = ops.length;
    for (let i = 0; i < opCount; i++) {
      guard.Step();
      err = contextErr(ctx);
      if (err != null) return err;
      const opErr = ops[i]();
      if (opErr != null) return opErr;
      err = contextErr(ctx);
      if (err != null) return err;
      if (this._options.AffectContainers) {
        err = this._repositionContainers(ctx);
        if (err != null) return err;
        for (const container of this.Graph.Containers.keys()) {
          guard.Step();
          err = contextErr(ctx);
          if (err != null) return err;
          if (container == null || container.TopLeft == null) continue;
          const [bad, badErr] = this.Graph.isBadStateContext(
            container,
            this.PriorGraphState,
            this._options.IgnoreContainerEscape,
            guard,
          );
          if (badErr != null) return badErr;
          if (bad) return ErrInvalidCandidate;
        }
      }
      this.Graph.SyncClusters();
      this.Graph.SyncSequences();
      err = contextErr(ctx);
      if (err != null) return err;
    }

    const [useDirtyValidation, dirtyErr] = this._collectOverlapValidationNodes(ctx);
    if (dirtyErr != null) return dirtyErr;
    err = this._collectFixedOrigins(ctx);
    if (err != null) return err;

    for (const n of this.Graph.Nodes) {
      guard.Step();
      err = contextErr(ctx);
      if (err != null) return err;
      if (n == null) {
        return invariantError('transaction bad-state check received a nil node');
      }
      if (n.TopLeft == null) continue;
      const container = n.container();
      const hasFixedOrigin = this._fixedOrigins.has(container);
      const fixedOrigin = hasFixedOrigin ? this._fixedOrigins.get(container) : null;
      const [bad, , badErr] = this.Graph.isStructurallyBadStateWithFixedOriginContext(
        n,
        this.PriorGraphState,
        this._options.IgnoreContainerEscape,
        fixedOrigin,
        true,
        guard,
      );
      if (badErr != null) return badErr;
      if (bad) return ErrInvalidCandidate;
    }

    err = this._buildPostStateOverlapCandidates(ctx, useDirtyValidation);
    if (err != null) return err;
    for (let nodeIndex = 0; nodeIndex < this.Graph.Nodes.length; nodeIndex++) {
      if (this._overlapCandidates[nodeIndex].length === 0) continue;
      guard.Step();
      err = contextErr(ctx);
      if (err != null) return err;
      const n = this.Graph.Nodes[nodeIndex];
      if (n.TopLeft == null) continue;
      const [bad, badErr] = this._hasBadPostStateOverlap(nodeIndex);
      if (badErr != null) return badErr;
      if (bad) return ErrInvalidCandidate;
    }

    // If a non-exact overlap became an exact overlap, that's bad.
    const existingOverlaps = this.PriorGraphState.existingOverlaps;
    const existingExactOverlaps = this.PriorGraphState.existingExactOverlaps;
    if (existingOverlaps != null) {
      for (const [n1, overlaps] of existingOverlaps) {
        guard.Step();
        err = contextErr(ctx);
        if (err != null) return err;
        for (const n2 of overlaps) {
          if (useDirtyValidation) {
            if (!this._dirtyNodes.has(n1) && !this._dirtyNodes.has(n2)) continue;
          }
          guard.Step();
          err = contextErr(ctx);
          if (err != null) return err;
          const exact = existingExactOverlaps != null ? existingExactOverlaps.get(n1) : undefined;
          const wasExact = exact !== undefined && exact.has(n2);
          if (!wasExact && n1.doesOverlapExact(n2)) {
            return ErrInvalidCandidate;
          }
        }
      }
    }

    err = contextErr(ctx);
    if (err != null) return err;
    guard.Finish();
    return null;
  }

  /** Go Transaction.repositionContainers */
  _repositionContainers(ctx) {
    const guard = this._guard;
    const smallestToLargest = [];
    for (const container of this.Graph.Containers.keys()) {
      guard.Step();
      if (container == null || container.TopLeft == null) continue;
      smallestToLargest.push(container);
    }
    smallestToLargest.sort((a, b) => {
      const aArea = a.area();
      const bArea = b.area();
      if (aArea === bArea) return compareIDs(a.ID, b.ID);
      return aArea < bArea ? -1 : 1;
    });
    for (const container of smallestToLargest) {
      const err = contextErr(ctx);
      if (err != null) return err;
      container.wrapChildren();
      guard.Step();
    }
    guard.Finish();
    return null;
  }

  /** Go Transaction.collectFixedOrigins */
  _collectFixedOrigins(ctx) {
    const guard = this._guard;
    if (this._fixedOrigins == null) {
      this._fixedOrigins = new Map();
    } else {
      this._fixedOrigins.clear();
    }
    if (!this.PriorGraphState.hasFixedTopLeft) {
      guard.Finish();
      return null;
    }
    for (const node of this.Graph.Nodes) {
      guard.Step();
      const err = contextErr(ctx);
      if (err != null) return err;
      if (node == null || node.TopLeft == null || node.FixedTopLeft == null) continue;
      const container = node.container();
      if (this._fixedOrigins.has(container)) continue;
      this._fixedOrigins.set(container, {
        X: node.TopLeft.X - node.FixedTopLeft.X,
        Y: node.TopLeft.Y - node.FixedTopLeft.Y,
      });
    }
    guard.Finish();
    return null;
  }

  /**
   * Go Transaction.collectOverlapValidationNodes
   * @returns {[boolean, Error|null]}
   */
  _collectOverlapValidationNodes(ctx) {
    const guard = this._guard;
    if (!hasOriginalNodeOrder(this.PriorGraphState, this.Graph)) {
      return [false, null];
    }
    if (this._dirtyNodes == null) {
      this._dirtyNodes = new Set();
    } else {
      this._dirtyNodes.clear();
    }
    const nodeCount = this.Graph.Nodes.length;
    this._dirtyNodeMarks = new Array(nodeCount).fill(false);
    for (let index = 0; index < nodeCount; index++) {
      guard.Step();
      const err = contextErr(ctx);
      if (err != null) return [false, err];
      const node = this.Graph.Nodes[index];
      if (geometryChanged(this.PriorGraphState, node)) {
        this._dirtyNodes.add(node);
        this._dirtyNodeMarks[index] = true;
      }
    }
    guard.Finish();
    return [true, null];
  }

  /** Go transactionBoxesMayInteract */
  _transactionBoxesMayInteract(first, second) {
    return transactionBoxesMayInteract(first, second);
  }

  /** Go Transaction.buildPostStateOverlapCandidates */
  _buildPostStateOverlapCandidates(ctx, dirtyOnly) {
    const guard = this._guard;
    const nodes = this.Graph.Nodes;
    const nodeCount = nodes.length;
    if (nodeCount > MAX_ENGINE_NODES) {
      return new Error(`TALA transaction node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    this._overlapCandidates.length = nodeCount;
    for (let index = 0; index < nodeCount; index++) {
      if (this._overlapCandidates[index] == null) {
        this._overlapCandidates[index] = [];
      } else {
        this._overlapCandidates[index].length = 0;
      }
    }
    this._overlapInvalidBoxes = new Array(nodeCount).fill(false);
    if (this._exceptionMarks.length < nodeCount) {
      for (let index = this._exceptionMarks.length; index < nodeCount; index++) {
        this._exceptionMarks.push(0);
      }
    } else {
      this._exceptionMarks.length = nodeCount;
    }

    let rebuildNodeIndex = !dirtyOnly || !this._overlapNodeIndexReady;
    if (this._overlapNodeIndices == null) {
      this._overlapNodeIndices = new Map();
      rebuildNodeIndex = true;
    } else if (rebuildNodeIndex) {
      for (const indices of this._overlapNodeIndices.values()) {
        indices.length = 0;
      }
    }
    this._overlapSweepNodes = [];
    let hasInvalidBox = false;
    let dirtyCount = 0;
    for (let index = 0; index < nodeCount; index++) {
      guard.Step();
      const err = contextErr(ctx);
      if (err != null) return err;
      const node = nodes[index];
      if (node == null) {
        return invariantError('transaction overlap check encountered a nil graph node');
      }
      if (rebuildNodeIndex) {
        let indices = this._overlapNodeIndices.get(node);
        if (indices === undefined) {
          indices = [];
          this._overlapNodeIndices.set(node, indices);
        }
        indices.push(index);
      }
      if (dirtyOnly && this._dirtyNodeMarks[index]) {
        dirtyCount++;
      }
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
      if (retainedReferences > OVERLAP_REFERENCE_LIMIT - 2) {
        return new Error(`TALA transaction overlap references exceed limit ${OVERLAP_REFERENCE_LIMIT}`);
      }
      this._overlapCandidates[first].push(second);
      this._overlapCandidates[second].push(first);
      retainedReferences += 2;
      return null;
    };

    const useDirtyScan = dirtyOnly && dirtyCount * 4 < nodeCount;
    if (useDirtyScan) {
      for (let first = 0; first < nodeCount; first++) {
        const firstNode = nodes[first];
        if (!this._dirtyNodeMarks[first] || firstNode.TopLeft == null) continue;
        for (let second = 0; second < nodeCount; second++) {
          guard.Step();
          const secondNode = nodes[second];
          if (second === first || firstNode === secondNode || secondNode.TopLeft == null) continue;
          if (this._dirtyNodeMarks[second] && second < first) continue;
          if (!transactionBoxesMayInteract(firstNode, secondNode)) continue;
          const err = addPair(first, second);
          if (err != null) return err;
        }
      }
    } else {
      this._overlapSweepNodes.sort(compareSweepNodes);
      this._overlapActiveNodes = [];
      for (const current of this._overlapSweepNodes) {
        guard.Step();
        const kept = [];
        for (const other of this._overlapActiveNodes) {
          guard.Step();
          // Equality remains active because the legacy broad phase only rejects
          // a pair when there is a strict gap greater than 500.
          if (other.node.TopLeft.X + other.node.Width + 500 < current.node.TopLeft.X) continue;
          kept.push(other);
          if (other.node === current.node || !transactionBoxesMayInteract(other.node, current.node)) continue;
          if (dirtyOnly && !this._dirtyNodeMarks[other.index] && !this._dirtyNodeMarks[current.index]) continue;
          const err = addPair(other.index, current.index);
          if (err != null) return err;
        }
        kept.push(current);
        this._overlapActiveNodes = kept;
      }

      // Non-finite or negative boxes deliberately follow legacy comparisons.
      if (hasInvalidBox) {
        for (let first = 0; first < nodeCount; first++) {
          for (let second = first + 1; second < nodeCount; second++) {
            if (!this._overlapInvalidBoxes[first] && !this._overlapInvalidBoxes[second]) continue;
            if (dirtyOnly && !this._dirtyNodeMarks[first] && !this._dirtyNodeMarks[second]) continue;
            guard.Step();
            const firstNode = nodes[first];
            const secondNode = nodes[second];
            if (
              firstNode === secondNode ||
              firstNode.TopLeft == null ||
              secondNode.TopLeft == null ||
              !transactionBoxesMayInteract(firstNode, secondNode)
            ) {
              continue;
            }
            const err = addPair(first, second);
            if (err != null) return err;
          }
        }
      }
    }

    for (const candidates of this._overlapCandidates) {
      guard.Step();
      candidates.sort((a, b) => a - b);
    }
    guard.Finish();
    return null;
  }

  _markOverlapException(node, generation) {
    const indices = this._overlapNodeIndices.get(node);
    if (indices === undefined) return;
    for (const index of indices) {
      this._exceptionMarks[index] = generation;
    }
  }

  /** Go Transaction.markDescendantOverlapExceptions; guard failures throw. */
  _markDescendantOverlapExceptions(node, includeClusterNodes, generation) {
    const guard = this._guard;
    const g = this.Graph;
    this._descendantGeneration++;
    if (this._descendantGeneration > 0xffffffff) {
      if (this._descendantSeen != null) this._descendantSeen.clear();
      this._descendantGeneration = 1;
    }
    const seenGeneration = this._descendantGeneration;
    if (this._descendantSeen == null) this._descendantSeen = new Map();
    this._descendantStack = [];
    this._descendantNodes = [];
    if (node != null) this._descendantSeen.set(node, seenGeneration);

    const pushChildren = (parent) => {
      const sequence = g.Sequences.get(parent);
      if (sequence != null) {
        for (let i = sequence.Nodes.length - 1; i >= 0; i--) {
          guard.Step();
          this._descendantStack.push({ node: sequence.Nodes[i], emit: includeClusterNodes });
        }
      }
      if (parent != null && parent.isClusterVessel) {
        const cluster = g.Clusters.get(parent);
        if (cluster != null) {
          for (let i = cluster.Nodes.length - 1; i >= 0; i--) {
            guard.Step();
            this._descendantStack.push({ node: cluster.Nodes[i], emit: includeClusterNodes });
          }
        }
      }
      if (parent == null || parent.isContainer) {
        const children = g.Containers.get(parent) ?? [];
        for (let i = children.length - 1; i >= 0; i--) {
          guard.Step();
          this._descendantStack.push({ node: children[i], emit: true });
        }
      }
    };
    pushChildren(node);
    while (this._descendantStack.length > 0) {
      guard.Step();
      const current = this._descendantStack.pop();
      if (current.node == null || this._descendantSeen.get(current.node) === seenGeneration) continue;
      this._descendantSeen.set(current.node, seenGeneration);
      if (current.emit) this._descendantNodes.push(current.node);
      pushChildren(current.node);
    }
    for (const descendant of this._descendantNodes) {
      guard.Step();
      this._markOverlapException(descendant, generation);
    }
    guard.Finish();
  }

  /**
   * Go Transaction.hasBadPostStateOverlap
   * @returns {[boolean, Error|null]}
   */
  _hasBadPostStateOverlap(nodeIndex) {
    const guard = this._guard;
    const node = this.Graph.Nodes[nodeIndex];
    if (node == null || node.TopLeft == null) return [node == null, null];
    if (node.Cluster != null) return [false, null];

    this._exceptionGeneration++;
    if (this._exceptionGeneration > 0xffffffff) {
      this._exceptionMarks.fill(0);
      this._exceptionGeneration = 1;
    }
    const generation = this._exceptionGeneration;
    if (node.isContainer || node.isClusterVessel || this.Graph.Sequences.get(node) != null) {
      this._markDescendantOverlapExceptions(node, true, generation);
    }
    if (node.Container != null || node.Cluster != null || node.Sequence != null) {
      const [ancestors, ancestorsErr] = this.Graph.ancestorsOfGuarded(node, guard);
      if (ancestorsErr != null) return [false, ancestorsErr];
      for (const ancestor of ancestors) {
        guard.Step();
        this._markOverlapException(ancestor, generation);
      }
    }

    const pairwiseExceptions = this.PriorGraphState.existingOverlaps?.get(node);
    const right = node.TopLeft.X + node.Width;
    const bottom = node.TopLeft.Y + node.Height;
    for (const otherIndex of this._overlapCandidates[nodeIndex]) {
      guard.Step();
      const other = this.Graph.Nodes[otherIndex];
      if (other == null) {
        return [false, invariantError('transaction overlap check encountered a nil graph node')];
      }
      if ((pairwiseExceptions !== undefined && pairwiseExceptions.has(other)) ||
          this._exceptionMarks[otherIndex] === generation) {
        continue;
      }
      if (other.TopLeft == null || !transactionBoxesMayInteract(node, other)) continue;
      const delta = node.deltaToGuarded(other, node.TopLeft, guard);
      if (
        node.TopLeft.X < other.TopLeft.X + other.Width + delta &&
        right + delta > other.TopLeft.X &&
        node.TopLeft.Y < other.TopLeft.Y + other.Height + delta &&
        bottom + delta > other.TopLeft.Y
      ) {
        return [true, null];
      }
    }
    guard.Finish();
    return [false, null];
  }
}

/** Go transactionBoxesMayInteract */
function transactionBoxesMayInteract(first, second) {
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

// ──────────────────────────────────────────────────────────────────────────────
// Constructors — Go Graph.newRequestTransaction / newRequestTransactionWithGuard /
// newTransactionWithOptionsContext
// ──────────────────────────────────────────────────────────────────────────────

/**
 * newTransactionWithOptionsContext constructs a transaction using a
 * request-scoped work guard. A null guard ensures the context's shared
 * transaction guard (Go: ensureTransactionWorkGuard(ctx, "Transaction")).
 *
 * @returns {[Transaction, null]|[null, Error]}
 */
export function newTransactionWithOptionsContext(g, ctx, options, guard) {
  const opts = normalizeOptions(options);
  if (guard == null) {
    [, guard] = ensureTransactionWorkGuard(ctx, 'Transaction');
  } else if (ctx == null) {
    return [null, new Error('TALA transaction requires a context')];
  }
  guard.Finish();
  const graphState = new GraphState({ CaptureEdgeRoutes: opts.AffectEdgeRoutes });
  // Snapshot failures (limits and WorkGuard) throw from the approved
  // GraphState port; nothing has been mutated, so there is nothing to undo.
  graphState.updateWithWorkGuard(g, guard);
  const [existingOverlaps, existingExactOverlaps, overlapErr] = buildTransactionOverlaps(g, guard);
  if (overlapErr != null) return [null, overlapErr];
  graphState.existingOverlaps = existingOverlaps;
  graphState.existingExactOverlaps = existingExactOverlaps;
  const txn = new Transaction(g, opts, guard, graphState);
  guard.Finish();
  return [txn, null];
}

/**
 * newRequestTransaction constructs a transaction charged to the request's
 * shared transaction guard. Go: Graph.newRequestTransaction
 * @returns {[Transaction, null]|[null, Error]}
 */
export function newRequestTransaction(g, ctx, options) {
  const opts = normalizeOptions(options);
  const [, guard] = ensureTransactionWorkGuard(ctx, 'Transaction');
  return newTransactionWithOptionsContext(g, ctx, opts, guard);
}

/** Go Graph.newRequestTransactionWithGuard */
export function newRequestTransactionWithGuard(g, ctx, guard, options) {
  if (guard == null) {
    return [null, new Error('TALA transaction requires a shared work guard')];
  }
  return newTransactionWithOptionsContext(g, ctx, normalizeOptions(options), guard);
}

/**
 * restoreGraphState restores a rollback point captured by a transaction.
 * Go: layoutgraph.RestoreGraphState (Transaction{...}.Rollback()).
 */
export function restoreGraphState(g, state) {
  state.rollback(g);
}

export const RestoreGraphState = restoreGraphState;
