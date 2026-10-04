// Slice 46 — BinPack.
// Pinned reference: d2layouts/d2talalayout/internal/packing/binpack.go
//
// Go returns errors; this port throws them. Transaction.Commit returns its
// error (null on success) exactly like Go, so candidate rejection keeps Go's
// control flow. Work-guard failures raised inside a commit (Go returns them)
// are normalized to returned errors so the follow-up cancellation Step runs
// exactly as in Go.

import { Point } from '../geometry/point.js';
import { Box } from '../geometry/box.js';
import { Segment } from '../geometry/segment.js';
import { Orientation, isDiagonal, isHorizontal, isVertical } from '../geometry/orientation.js';
import { goRound } from '../geometry/math.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { newGraphStateSnapshot } from '../graph/graph-state.js';
import { Transaction, isCandidateRejection } from '../graph/transaction.js';
import { newEdgeSegment } from '../graph/structural-access.js';
import { contextWithTransactionWorkGuard } from '../limits/transaction-guard.js';
import { MAX_BIN_PACK_WORK_UNITS } from '../limits/constants.js';
import { isWorkCanceledError, isWorkLimitError } from '../limits/work-guard.js';
import { boundingBox, fixedBoundingBox, nodeBoundingBox } from '../graphbounds/index.js';
import {
  SUBGRAPH_PADDING,
  allEdgesHaveCompleteRoutesGuarded,
  binPackContainerTopLeft,
  binPackHasExternalConnection,
  binPackHierarchyBoxes,
  binPackIsDescendantOf,
  binPackPointInHierarchy,
  binPackScoreGuarded,
  binPackSmallestDeltas,
  binPackSyncClusters,
  binPackSyncSequences,
  binPackWrapChildren,
  newWorkGuard,
} from './guard.js';
import { RoutedContainerBoxDecision, binPackCanUseRoutedContainerBox } from './routed-container.js';
import { snapshotPoint } from './snapshot.js';
import { InvariantViolationError, NODE_GAP, PointKeySet, TABLE_NODE_GAP, goMax, goMin, invariantError } from './go-support.js';

const MOVE_OUT_OF_THE_WAY = 100000;

/**
 * Pack recursively arranges disconnected subgraphs into compact containers.
 * Containers may shrink but never grow, and packing may interleave subgraph
 * bounding boxes while preserving edge lengths. Throws on failure; the graph
 * is restored exactly before any error or exception propagates.
 *
 * Go: func Pack(ctx context.Context, g *layoutgraph.Graph, root *layoutgraph.Node) error
 */
export function pack(ctx, g, root = null) {
  const guard = newWorkGuard(ctx, MAX_BIN_PACK_WORK_UNITS);
  packAtomic(ctx, g, root, guard);
}

export const Pack = pack;

/** packWithWorkLimit (binpack_test_helpers_test.go) for limit probes. */
export function packWithWorkLimit(ctx, g, root, workLimit) {
  const guard = newWorkGuard(ctx, workLimit);
  packAtomic(ctx, g, root, guard);
  return guard;
}

/** packAtomic: deferred rollback on error and on panic (re-thrown). */
export function packAtomic(ctx, g, root, guard) {
  if (guard == null) {
    throw new Error('TALA BinPack requires a work guard');
  }
  ctx = contextWithTransactionWorkGuard(ctx, guard);
  const state = newGraphStateSnapshot({ CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, guard);
  const snapshot = new Transaction(g, null, null, state);
  let complete = false;
  try {
    packGuarded(ctx, g, root, guard);
    guard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      snapshot.Rollback();
    }
  }
}

function isGuardError(err) {
  return isWorkLimitError(err) || isWorkCanceledError(err);
}

// Transaction.Commit returns Go-returned errors; WorkGuard failures inside the
// commit throw in JS but are returned in Go.
function commitReturningGuardErrors(txn, ctx) {
  try {
    return txn.Commit(ctx);
  } catch (err) {
    if (isGuardError(err)) {
      return err;
    }
    throw err;
  }
}

// A transaction op returns Go's error instead of throwing.
function guardedOp(fn) {
  return () => {
    try {
      fn();
      return null;
    } catch (err) {
      if (isGuardError(err)) {
        return err;
      }
      throw err;
    }
  };
}

function containerChildren(g, root) {
  return g.Containers.get(root) ?? [];
}

function copyRoute(edge, guard) {
  const route = [];
  for (const p of edge.Points ?? []) {
    guard.Step();
    route.push(p.copy());
  }
  return route;
}

function collectSegments(edges, guard) {
  const segments = [];
  const hSegments = routedEdgeSegments(edges, true, guard);
  const vSegments = routedEdgeSegments(edges, false, guard);
  for (const s of hSegments) {
    guard.Step();
    segments.push(s);
  }
  for (const s of vSegments) {
    guard.Step();
    segments.push(s);
  }
  return segments;
}

/** packGuarded (recursive like Go; depth is the container nesting depth). */
export function packGuarded(ctx, g, root, guard) {
  const checkCanceled = () => guard.Step();
  checkCanceled();
  const [edgesPlaced, graphIncidentEdges] = allEdgesHaveCompleteRoutesGuarded(g, root, guard);

  // Pack more nested before less nested
  for (const n of containerChildren(g, root)) {
    checkCanceled();
    if (n.isContainer) {
      packGuarded(ctx, g, n, guard);
    }
  }

  const crossContainerSubgraphs = [];
  const containedSubgraphs = [];
  const added = new Set();

  const fixedNodesSubgraph = [];
  for (const n of containerChildren(g, root)) {
    checkCanceled();
    if (n.FixedTopLeft == null) {
      continue;
    }
    const reachable = n.allReachableNodesGuarded(true, true, false, new Set([root]), guard);
    for (const rn of reachable) {
      guard.Step();
      if (!added.has(rn)) {
        fixedNodesSubgraph.push(rn);
      }
      added.add(rn);
    }
  }

  let visitErr = null;
  let shouldVisit = () => true;
  if (root != null) {
    shouldVisit = (n) => {
      if (visitErr != null) {
        return false;
      }
      try {
        return binPackIsDescendantOf(n, root, guard);
      } catch (err) {
        // Go stores only returned errors; a panic propagates immediately.
        if (!isGuardError(err) && !(err instanceof InvariantViolationError)) {
          throw err;
        }
        visitErr = err;
        return false;
      }
    };
  }

  const contained = new Set();
  for (const n of containerChildren(g, root)) {
    checkCanceled();
    if (added.has(n)) {
      continue;
    }
    const reachable = n.reachableNodesGuarded(shouldVisit, true, true, false, new Set([root]), guard);
    if (visitErr != null) {
      throw visitErr;
    }
    let cross = false;
    for (const rn of reachable) {
      guard.Step();
      if (rn.Hierarchy != null) {
        cross = true;
        break;
      }
      if (binPackHasExternalConnection(g, rn, root, false, edgesPlaced, guard)) {
        cross = true;
        break;
      }
      if (binPackHasExternalConnection(g, rn, root, true, false, guard)) {
        cross = true;
        break;
      }
    }
    if (!cross) {
      for (const rn of reachable) {
        guard.Step();
        added.add(rn);
        contained.add(rn);
      }
      containedSubgraphs.push(reachable);
    }
  }
  for (const n of containerChildren(g, root)) {
    checkCanceled();
    if (added.has(n)) {
      continue;
    }
    const filtered = [];
    const allReachable = n.allReachableNodesGuarded(true, false, false, new Set([root]), guard);
    for (const rn of allReachable) {
      guard.Step();
      if (contained.has(rn)) {
        continue;
      }
      filtered.push(rn);
    }
    for (const rn of filtered) {
      guard.Step();
      added.add(rn);
    }
    crossContainerSubgraphs.push(filtered);
  }

  if (containedSubgraphs.length === 0) {
    checkCanceled();
    return;
  }

  let packed = crossContainerSubgraphs;
  let toPack = containedSubgraphs;

  if (fixedNodesSubgraph.length > 0) {
    packed.push(fixedNodesSubgraph);
  }

  const rootTL = binPackContainerTopLeft(g, root, toPack[0], guard);
  const originalScore = binPackScoreGuarded(containerChildren(g, root), root, guard);
  const originalPos = new Map();
  const originalPosOrder = [];
  const originalRoute = new Map();
  const originalRouteOrder = [];
  const returnIfCanceled = () => checkCanceled();

  // Move out of the way
  for (const ns of toPack) {
    guard.Step();
    for (const n of ns) {
      guard.Step();
      if (!originalPos.has(n)) {
        originalPos.set(n, snapshotPoint(n.TopLeft));
        originalPosOrder.push(n);
      }
      n.translate(MOVE_OUT_OF_THE_WAY, MOVE_OUT_OF_THE_WAY);
      if (edgesPlaced) {
        for (const e of n.Edges) {
          guard.Step();
          if (originalRoute.has(e)) {
            continue;
          }
          originalRoute.set(e, copyRoute(e, guard));
          originalRouteOrder.push(e);
        }
      }
    }
  }

  if (packed.length === 0) {
    const [currTL] = boundingBox(toPack[0], guard);
    const offsetX = rootTL.X - currTL.X;
    const offsetY = rootTL.Y - currTL.Y;
    for (const n of toPack[0]) {
      guard.Step();
      n.translate(offsetX, offsetY);
    }
    if (edgesPlaced) {
      translateRoutes(toPack[0], originalPos, guard);
    }
    packed = [toPack[0]];
    toPack = toPack.slice(1);
  }
  returnIfCanceled();

  const packedRootChildren = [];
  let packedSegments = [];
  // If edges are already placed, use their actual routes
  // Otherwise consider multiple possible good routes
  if (edgesPlaced) {
    const edges = [];
    const unique = new Set();
    for (const ns of packed) {
      guard.Step();
      for (const n of ns) {
        guard.Step();
        if (n === root) {
          continue;
        }
        if (!binPackIsDescendantOf(n, root, guard)) {
          continue;
        }
        for (const e of n.Edges) {
          guard.Step();
          if (!unique.has(e)) {
            unique.add(e);
            edges.push(e);
          }
        }
      }
    }
    packedSegments = collectSegments(edges, guard);
    for (const ns of packed) {
      guard.Step();
      for (const n of ns) {
        guard.Step();
        if (n.Container === root) {
          packedRootChildren.push(n);
        }
      }
    }
  } else {
    packedSegments = [];
    for (const ns of packed) {
      guard.Step();
      for (const n of ns) {
        guard.Step();
        if (n.Container === root) {
          packedRootChildren.push(n);
        }
      }
      const [xd, yd] = binPackSmallestDeltas(toPack, guard);
      const filtered = [];
      for (const n of ns) {
        guard.Step();
        if (n === root) {
          continue;
        }
        if (binPackIsDescendantOf(n, root, guard)) {
          filtered.push(n);
        }
      }
      const segments = estimateRouteSegments(filtered, g, xd, yd, guard);
      for (const segment of segments) {
        guard.Step();
        packedSegments.push(segment);
      }
    }
  }

  const occupied = new PointKeySet();

  let canMoveLeft = true;
  let canMoveRight = true;
  let canMoveTop = true;
  let canMoveBottom = true;

  if (edgesPlaced && root != null) {
    for (const e of root.Edges) {
      guard.Step();
      let seg;
      if (e.From === root) {
        seg = new Segment(e.Points[0], e.Points[1]);
      } else {
        seg = new Segment(e.Points[e.Points.length - 1], e.Points[e.Points.length - 2]);
      }
      if (seg.Start.Y === seg.End.Y) {
        if (seg.Start.X < seg.End.X) canMoveRight = false;
        if (seg.Start.X > seg.End.X) canMoveLeft = false;
      } else if (seg.Start.X === seg.End.X) {
        if (seg.Start.Y < seg.End.Y) canMoveBottom = false;
        if (seg.Start.Y > seg.End.Y) canMoveTop = false;
      } else {
        // It's a diagonal line, can't risk any movement
        canMoveRight = false;
        canMoveLeft = false;
        canMoveTop = false;
        canMoveBottom = false;
        break;
      }
    }
  }

  let failed = false;
  // place greedily
  while (toPack.length > 0) {
    returnIfCanceled();
    const candidates = [];
    const set = new PointKeySet();
    const hierarchyBoxes = binPackHierarchyBoxes(packed, guard);

    const tl = new Point(rootTL.X, rootTL.Y);
    if (!set.has(tl)) {
      candidates.push(tl);
      set.add(tl);
    }

    let packedTLX = Infinity;
    let packedTLY = Infinity;
    for (const ns of packed) {
      guard.Step();
      const [nsTL] = boundingBox(ns, guard);
      packedTLX = goMin(packedTLX, nsTL.X);
      packedTLY = goMin(packedTLY, nsTL.Y);
      const canPlaceWithin = ns[0].Hierarchy == null;
      const placementCandidates = placementCandidatesGuarded(ns, root, canPlaceWithin, edgesPlaced, guard);
      for (const p of placementCandidates) {
        guard.Step();
        if (occupied.has(p)) {
          continue;
        }
        if (binPackPointInHierarchy(hierarchyBoxes, p, guard)) {
          continue;
        }
        if (!set.has(p)) {
          candidates.push(p);
          set.add(p);
        }
      }
    }

    const currPacking = toPack[0];
    toPack = toPack.slice(1);
    const [currPackingTL, currPackingBR] = fixedBoundingBox(currPacking, guard);
    const currPackingWidth = currPackingBR.X - currPackingTL.X;
    const currPackingHeight = currPackingBR.Y - currPackingTL.Y;

    if (canMoveTop) {
      candidates.push(new Point(packedTLX, packedTLY - currPackingHeight - SUBGRAPH_PADDING));
    }
    if (canMoveLeft) {
      candidates.push(new Point(packedTLX - currPackingWidth - SUBGRAPH_PADDING, packedTLY));
    }
    if (canMoveTop && canMoveLeft) {
      candidates.push(new Point(packedTLX - currPackingWidth - SUBGRAPH_PADDING, packedTLY - currPackingHeight - SUBGRAPH_PADDING));
    }

    const [txn, txnErr] = g.newRequestTransaction(ctx, {
      IgnoreContainerEscape: true,
      AffectEdgeRoutes: edgesPlaced,
    });
    if (txnErr != null) {
      throw txnErr;
    }

    const [currTL] = boundingBox(currPacking, guard);
    const packedWithCurr = [];
    for (const node of packedRootChildren) {
      guard.Step();
      packedWithCurr.push(node);
    }
    for (const node of currPacking) {
      guard.Step();
      packedWithCurr.push(node);
    }
    let bestScore = Infinity;

    for (const n of currPacking) {
      guard.Step();
      const original = originalPos.get(n).value;
      const og = new Point(original.X, original.Y);
      if (!set.has(og)) {
        candidates.push(og);
        set.add(og);
      }
    }
    const [packedXD, packedYD] = binPackSmallestDeltas(packed, guard);

    let bestCandidate = null;
    for (const p of candidates) {
      returnIfCanceled();
      txn.Clear();
      txn.AddOp(guardedOp(() => {
        const offsetX = p.X - currTL.X;
        const offsetY = p.Y - currTL.Y;
        for (const n of currPacking) {
          guard.Step();
          n.translate(offsetX, offsetY);
        }
      }));
      const commitErr = commitReturningGuardErrors(txn, ctx);
      if (commitErr != null) {
        if (isCandidateRejection(commitErr)) {
          continue;
        }
        checkCanceled();
        throw commitErr;
      }
      // From here a throw must first roll the candidate back (Go: txn.Rollback()).
      let rejected = false;
      let score = 0;
      try {
        // Not allowed to expand out of containers
        if (root != null) {
          const packedInContainer = [];
          for (const n of packedWithCurr) {
            guard.Step();
            if (n.Container === root) {
              packedInContainer.push(n);
            }
          }
          const [bbTL, bbBR] = boundingBox(packedInContainer, guard);
          const w = bbBR.X - bbTL.X;
          const h = bbBR.Y - bbTL.Y;
          const innerBox = root.innerBox();
          if (w > innerBox.Width || h > innerBox.Height) {
            rejected = true;
          }
        }
        if (!rejected && !edgesPlaced) {
          // Not allowed for any node to go into the bounding box of a placed hierarchy
          let is = false;
          for (const n of currPacking) {
            const [nTL, nBR] = nodeBoundingBox(n, null, guard);
            const topLeftInside = binPackPointInHierarchy(hierarchyBoxes, nTL, guard);
            const bottomRightInside = binPackPointInHierarchy(hierarchyBoxes, nBR, guard);
            if (topLeftInside || bottomRightInside) {
              is = true;
              break;
            }
          }
          if (is) {
            rejected = true;
          }
        }
        if (!rejected) {
          const blocked = blocksRoutesWithDeltasGuarded(g, currPacking, packed, packedSegments, packedXD, packedYD, guard);
          if (blocked) {
            rejected = true;
          }
        }
        if (!rejected) {
          score = binPackScoreGuarded(packedWithCurr, root, guard);
        }
      } catch (err) {
        txn.Rollback();
        throw err;
      }
      if (rejected) {
        txn.Rollback();
        continue;
      }
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = p;
      }
      txn.Rollback();
    }
    returnIfCanceled();

    if (bestCandidate == null) {
      failed = true;
      break;
    }

    txn.Clear();
    const chosen = bestCandidate;
    txn.AddOp(guardedOp(() => {
      const offsetX = chosen.X - currTL.X;
      const offsetY = chosen.Y - currTL.Y;
      for (const n of currPacking) {
        guard.Step();
        n.translate(offsetX, offsetY);
      }
      if (edgesPlaced) {
        translateRoutes(currPacking, originalPos, guard);
      }
    }));
    const commitErr = commitReturningGuardErrors(txn, ctx);
    if (commitErr != null) {
      checkCanceled();
      throw commitErr;
    }
    occupied.add(bestCandidate);

    for (const node of currPacking) {
      guard.Step();
      packedRootChildren.push(node);
    }
    packed.push(currPacking);
    const [xd, yd] = binPackSmallestDeltas(toPack, guard);

    if (edgesPlaced) {
      const edges = [];
      const unique = new Set();
      for (const n of currPacking) {
        guard.Step();
        if (n === root) {
          continue;
        }
        if (!binPackIsDescendantOf(n, root, guard)) {
          continue;
        }
        for (const e of n.Edges) {
          guard.Step();
          if (!unique.has(e)) {
            unique.add(e);
            edges.push(e);
          }
        }
      }
      for (const s of collectSegments(edges, guard)) {
        packedSegments.push(s);
      }
    } else {
      const filtered = [];
      for (const n of currPacking) {
        guard.Step();
        if (n === root) {
          continue;
        }
        if (binPackIsDescendantOf(n, root, guard)) {
          filtered.push(n);
        }
      }
      const segments = estimateRouteSegments(filtered, g, xd, yd, guard);
      for (const segment of segments) {
        guard.Step();
        packedSegments.push(segment);
      }
    }
  }
  returnIfCanceled();

  let afterBinPackScore;
  if (failed) {
    afterBinPackScore = Infinity;
  } else {
    afterBinPackScore = binPackScoreGuarded(containerChildren(g, root), root, guard);
  }
  if (originalScore < afterBinPackScore) {
    for (const node of originalPosOrder) {
      guard.Step();
      node.TopLeft = originalPos.get(node).restore();
    }
    binPackSyncClusters(g, guard);
    binPackSyncSequences(g, guard);
    failed = true;
  } else if (root != null && root.Cluster == null) {
    // record state to revert to if fitting to the children's packed position causes a bad state
    const descendants = g.allDescendantNodesGuarded(root, true, guard);
    for (const node of descendants) {
      guard.Step();
      if (!originalPos.has(node)) {
        originalPos.set(node, snapshotPoint(node.TopLeft));
        originalPosOrder.push(node);
      }
    }

    const rootX = root.TopLeft.X;
    const rootY = root.TopLeft.Y;
    const rootWidth = root.Width;
    const rootHeight = root.Height;
    const originalRootBox = new Box(new Point(rootX, rootY), rootWidth, rootHeight);

    binPackWrapChildren(root, guard);
    let routedContainerHandled = false;
    if (edgesPlaced) {
      const decision = binPackCanUseRoutedContainerBox(g, root, originalRootBox, graphIncidentEdges, guard);
      switch (decision) {
        case RoutedContainerBoxDecision.DeferToSideConstraints:
          break;
        case RoutedContainerBoxDecision.UseProposedBox:
          routedContainerHandled = true;
          break;
        case RoutedContainerBoxDecision.KeepOriginalBox:
          routedContainerHandled = true;
          // Unsupported shapes, detached endpoints, and route geometry cut
          // by the proposed shrink retain the exact routed box.
          root.TopLeft.X = rootX;
          root.TopLeft.Y = rootY;
          root.Width = rootWidth;
          root.Height = rootHeight;
          break;
        default:
          throw new Error('TALA BinPack received an invalid routed-container decision');
      }
    }
    if (!routedContainerHandled) {
      if (!canMoveLeft) root.TopLeft.X = rootX;
      if (!canMoveTop) root.TopLeft.Y = rootY;
      if (!canMoveRight) root.Width = rootWidth;
      if (!canMoveBottom) root.Height = rootHeight;
      // wrapChildren preserves the aspect ratio of circles and other square
      // shapes; retain the larger constrained dimension on both axes.
      if (root.aspectRatio1()) {
        const size = goMax(root.Width, root.Height);
        root.Width = size;
        root.Height = size;
      }
    }

    let childrenFit = true;
    const innerBox = root.innerBox();
    for (const child of containerChildren(g, root)) {
      guard.Step();
      if (!covers(innerBox, child.Box)) {
        childrenFit = false;
        break;
      }
    }
    const [badState, badErr] = g.isBadStateContext(root, null, false, guard);
    if (badErr != null) {
      throw badErr;
    }
    if (!childrenFit || badState) {
      for (const node of originalPosOrder) {
        guard.Step();
        node.TopLeft = originalPos.get(node).restore();
      }
      root.TopLeft.X = rootX;
      root.TopLeft.Y = rootY;
      root.Width = rootWidth;
      root.Height = rootHeight;
      failed = true;
    }
  }
  // Transactions don't deal with edge routes, so rollback manually
  if (failed) {
    for (const edge of originalRouteOrder) {
      guard.Step();
      const route = originalRoute.get(edge);
      for (let i = 0; i < route.length; i++) {
        guard.Step();
        edge.Points[i].X = route[i].X;
        edge.Points[i].Y = route[i].Y;
      }
    }
  }
  guard.Finish();
}

// Shared by the single-subgraph fast path and the accepted-candidate op:
// translate every incident route once by its node's displacement.
function translateRoutes(nodes, originalPos, guard) {
  const moved = new Set();
  for (const n of nodes) {
    guard.Step();
    for (const e of n.Edges) {
      guard.Step();
      if (moved.has(e)) {
        continue;
      }
      moved.add(e);
      for (const p of e.Points ?? []) {
        guard.Step();
        p.X += (n.TopLeft.X - originalPos.get(n).value.X);
        p.Y += (n.TopLeft.Y - originalPos.get(n).value.Y);
      }
    }
  }
}

// layoutgraph.Covers (node.go covers)
function covers(b1, b2) {
  return (b2.TopLeft.X >= b1.TopLeft.X) &&
    (b2.TopLeft.Y >= b1.TopLeft.Y) &&
    (b2.TopLeft.X + b2.Width <= b1.TopLeft.X + b1.Width) &&
    (b2.TopLeft.Y + b2.Height <= b1.TopLeft.Y + b1.Height);
}

/**
 * placementCandidatesGuarded returns the candidate points suitable to pack
 * more nodes/subgraphs at, in Go's exact order.
 */
export function placementCandidatesGuarded(nodes, root, considerWithin, edgesPlaced, guard) {
  const candidatePoints = [];
  const inContainer = [];
  for (const n of nodes) {
    guard.Step();
    // Avoid placement points that'd move into different container
    if (n.Container !== root) {
      continue;
    }
    inContainer.push(n);
    if (!considerWithin) {
      continue;
    }
    let sideDelta = SUBGRAPH_PADDING;
    if (n.isTable()) {
      sideDelta = TABLE_NODE_GAP;
    }
    if (edgesPlaced) {
      candidatePoints.push(new Point(n.TopLeft.X + n.Width + sideDelta, n.TopLeft.Y));
      candidatePoints.push(new Point(n.TopLeft.X, n.TopLeft.Y + n.Height + SUBGRAPH_PADDING));
      candidatePoints.push(new Point(n.TopLeft.X + n.Width + sideDelta, n.TopLeft.Y + n.Height));
    } else {
      // Avoid placement points that are likely to cause obstructions
      let hasRight = false;
      let hasBottom = false;
      let hasBottomRight = false;
      for (const e of n.Edges) {
        guard.Step();
        const adj = n.adjacent(e);
        switch (n.orientation(adj)) {
          case Orientation.Left:
            hasRight = true;
            break;
          case Orientation.Top:
            hasBottom = true;
            break;
          case Orientation.TopLeft:
            hasBottomRight = true;
            break;
          default:
            break;
        }
        if (hasRight && hasBottom && hasBottomRight) {
          break;
        }
      }
      if (!hasRight) {
        candidatePoints.push(new Point(n.TopLeft.X + n.Width + sideDelta, n.TopLeft.Y));
      }
      if (!hasBottom) {
        candidatePoints.push(new Point(n.TopLeft.X, n.TopLeft.Y + n.Height + SUBGRAPH_PADDING));
      }
      if (!hasBottomRight) {
        candidatePoints.push(new Point(n.TopLeft.X + n.Width + sideDelta, n.TopLeft.Y + n.Height));
      }
    }
  }

  const [graphTL, graphBR] = fixedBoundingBox(inContainer, guard);
  candidatePoints.push(
    new Point(graphBR.X, graphTL.Y),
    new Point(graphBR.X, graphBR.Y),
    new Point(graphTL.X, graphBR.Y),
    new Point(graphBR.X + SUBGRAPH_PADDING, graphTL.Y),
    new Point(graphBR.X + SUBGRAPH_PADDING, graphBR.Y),
    new Point(graphTL.X, graphBR.Y + SUBGRAPH_PADDING),
  );
  guard.Finish();
  return candidatePoints;
}

/**
 * blocksRoutesWithDeltasGuarded checks if the given `packing` placement
 * overlaps with some desired routes in `packed` or if `packed` nodes overlap
 * with routes in `packing`.
 */
export function blocksRoutesWithDeltasGuarded(g, packing, packed, packedSegments, xd, yd, guard) {
  if (guard == null) {
    throw new Error('TALA BinPack route check requires a work guard');
  }
  const packingSegments = estimateRouteSegments(packing, g, xd, yd, guard);

  // check if `packed` nodes could block routes in `packing`
  for (const nodes of packed) {
    guard.Step();
    for (const n of nodes) {
      guard.Step();
      for (const seg of packingSegments) {
        guard.Step();
        if (n.overlapsLine(seg.Start, seg.End, NODE_GAP)) {
          guard.Finish();
          return true;
        }
      }
    }
  }
  // check if `packing` nodes could block routes in `packed`
  for (const n of packing) {
    guard.Step();
    for (const seg of packedSegments) {
      guard.Step();
      if (n.overlapsLine(seg.Start, seg.End, NODE_GAP)) {
        guard.Finish();
        return true;
      }
    }
  }
  guard.Finish();
  return false;
}

/** estimateRouteSegments */
export function estimateRouteSegments(nodes, g, smallestXGap, smallestYGap, guard) {
  const segments = [];
  const unique = new Set();
  for (const n of nodes) {
    guard.Step();
    for (const e of n.Edges) {
      guard.Step();
      if (unique.has(e)) {
        continue;
      }
      unique.add(e);
      const edgeSegments = estimateEdgeSegments(e, g, smallestXGap, smallestYGap, guard);
      if (edgeSegments != null) {
        for (const s of edgeSegments) segments.push(s);
      }
    }
  }
  guard.Finish();
  return segments;
}

/** routedEdgeSegments */
export function routedEdgeSegments(edges, isHorizontalScan, guard) {
  const out = [];
  for (const edge of edges) {
    guard.Step();
    if (edge == null) {
      throw invariantError('BinPack routed segment scan encountered a nil edge');
    }
    const points = edge.Points ?? [];
    for (let index = 0; index < points.length - 1; index++) {
      guard.Step();
      const first = points[index];
      const second = points[index + 1];
      if (first == null || second == null) {
        throw invariantError('BinPack routed segment scan encountered a nil point');
      }
      let start = null;
      let end = null;
      if (isHorizontalScan) {
        if (first.Y === second.Y) {
          if (first.X < second.X) {
            start = first;
            end = second;
          } else {
            start = second;
            end = first;
          }
        }
      } else if (first.X === second.X) {
        if (first.Y < second.Y) {
          start = first;
          end = second;
        } else {
          start = second;
          end = first;
        }
      }
      if (start != null && end != null) {
        out.push(newEdgeSegment(start, end, edge));
      }
    }
  }
  guard.Finish();
  return out;
}

// Node.BoundingBox(nil) without outside label/icon expansion.
function vesselBounds(vessel) {
  return vessel.bounds(null);
}

/**
 * estimateEdgeSegments generates horizontal and vertical segments for the
 * given edge (L-shaped and S-shaped estimates for diagonal edges).
 */
export function estimateEdgeSegments(e, g, smallestXGap, smallestYGap, guard) {
  guard.Step();
  if (e == null || e.From == null || e.To == null || e.From.TopLeft == null || e.To.TopLeft == null) {
    throw invariantError('BinPack segment estimate encountered an incomplete edge');
  }
  const o = e.From.orientation(e.To);

  // Straight lines only matter if they're long (can potentially fit other subgraphs)
  if (!isDiagonal(o) && !e.From.isClusterVessel && !e.To.isClusterVessel) {
    const from = e.From.center();
    const to = e.To.center();
    if (isHorizontal(o)) {
      if (Math.abs(from.X - to.X) > smallestXGap) {
        return [new Segment(from, to)];
      }
    }
    if (isVertical(o)) {
      if (Math.abs(from.Y - to.Y) > smallestYGap) {
        return [new Segment(from, to)];
      }
    }
    return null;
  }

  const clusterEndpoints = (c) => {
    const center = c.Vessel.center();
    const [tl, br] = vesselBounds(c.Vessel);
    if (c.Arrangement === ClusterArrangement.Row) {
      return [new Point(tl.X, center.Y), new Point(br.X, center.Y)];
    }
    if (c.Arrangement === ClusterArrangement.Column) {
      return [new Point(center.X, tl.Y), new Point(center.X, br.Y)];
    }
    return [];
  };
  const segments = [];
  const fromPoints = e.From.isClusterVessel ? clusterEndpoints(g.Clusters.get(e.From)) : [e.From.center()];
  const toPoints = e.To.isClusterVessel ? clusterEndpoints(g.Clusters.get(e.To)) : [e.To.center()];

  for (const from of fromPoints) {
    for (const to of toPoints) {
      guard.Step();
      // L-shaped estimate
      segments.push(new Segment(from, new Point(from.X, to.Y)));
      segments.push(new Segment(new Point(from.X, to.Y), to));
      segments.push(new Segment(from, new Point(to.X, from.Y)));
      segments.push(new Segment(new Point(to.X, from.Y), to));
      // S-shaped estimate
      const midX = goRound((from.X + to.X) / 2);
      segments.push(new Segment(new Point(midX, from.Y), new Point(midX, to.Y)));
      const midY = goRound((from.Y + to.Y) / 2);
      segments.push(new Segment(new Point(from.X, midY), new Point(to.X, midY)));
    }
  }
  guard.Finish();
  return segments;
}
