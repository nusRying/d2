import { scoringCancellationError, checkScoringCancellation, SCORING_CANCELLATION_CHECK_INTERVAL, SYMMETRY_TOLERANCE_BAND } from './geometry.js';
import { scoringNodeBounds } from './obstruction-bounds.js';

const CROSSING_COST_WEIGHT = 0.48 * 0.48 * 0.48;

/**
 * NodesSymmetry sums local symmetry scores for nodes in order.
 * Pinned Go: placementcost.NodesSymmetry
 *
 * @param {object} ctx
 * @param {Array<import('../graph/node.js').Node>} nodes
 * @param {Array<import('../graph/edge-abduction.js').EdgeAbduction>} edgeAbductions
 * @returns {Promise<number>|number}
 */
export function nodesSymmetry(ctx, nodes, edgeAbductions) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  let sum = 0.0;
  for (let i = 0; i < nodes.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const symmetry = nodeSymmetry(ctx, nodes[i], edgeAbductions, true);
    sum += symmetry;
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return sum;
}

export const NodesSymmetry = nodesSymmetry;

/**
 * NodeSymmetry evaluates a node and the neighboring symmetry it contributes to.
 * Pinned Go: placementcost.NodeSymmetry
 *
 * @param {object} ctx
 * @param {import('../graph/node.js').Node} node
 * @param {Array<import('../graph/edge-abduction.js').EdgeAbduction>} edgeAbductions
 * @returns {number}
 */
export function nodeSymmetryExport(ctx, node, edgeAbductions) {
  return nodeSymmetry(ctx, node, edgeAbductions, true);
}

export const NodeSymmetry = nodeSymmetryExport;

/**
 * Internal package-private nodeSymmetry.
 * Pinned Go: placementcost.nodeSymmetry
 */
export function nodeSymmetry(ctx, node, edgeAbductions, checkNeighbors) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }

  let score = 0.0;
  let maxScore = 0;

  const usedEdgeAbductions = new Array(edgeAbductions ? edgeAbductions.length : 0).fill(false);
  const dedupedAdjacentNodes = [];
  const added = new Set();

  if (node.IsContainer()) {
    const childNodes = [];
    if (edgeAbductions == null) {
      const containerChildren = node.Graph?.Containers instanceof Map
        ? node.Graph.Containers.get(node) ?? []
        : (node.Graph?.Containers?.[node] ?? []);

      for (let i = 0; i < containerChildren.length; i++) {
        const err = scoringCancellationError(ctx, i);
        if (err != null) {
          throw err;
        }
        const child = containerChildren[i];
        for (let j = 0; j < (child.Edges ? child.Edges.length : 0); j++) {
          const edgeErr = scoringCancellationError(ctx, j);
          if (edgeErr != null) {
            throw edgeErr;
          }
          const e = child.Edges[j];
          const adj = child.adjacent(e);
          if (!adj.Container || !adj.Container.isDescendantOf(node)) {
            added.add(child);
            childNodes.push(child);
            break;
          }
        }
      }
    } else {
      for (let i = 0; i < edgeAbductions.length; i++) {
        const err = scoringCancellationError(ctx, i);
        if (err != null) {
          throw err;
        }
        if (usedEdgeAbductions[i]) {
          continue;
        }
        const edgeAbduction = edgeAbductions[i];
        if (edgeAbduction.CurrentFrom === node) {
          if (edgeAbduction.OriginallyFrom != null) {
            usedEdgeAbductions[i] = true;
            if (added.has(edgeAbduction.OriginallyFrom)) {
              continue;
            }
            added.add(edgeAbduction.OriginallyFrom);
            childNodes.push(edgeAbduction.OriginallyFrom);
          }
        }
        if (edgeAbduction.CurrentTo === node) {
          if (edgeAbduction.OriginallyTo != null) {
            usedEdgeAbductions[i] = true;
            if (added.has(edgeAbduction.OriginallyTo)) {
              continue;
            }
            added.add(edgeAbduction.OriginallyTo);
            childNodes.push(edgeAbduction.OriginallyTo);
          }
        }
      }
    }

    for (let i = 0; i < childNodes.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      const nodeReplacement = childNodes[i];
      const symmetry = nodeSymmetry(ctx, nodeReplacement, edgeAbductions, checkNeighbors);
      score += symmetry;
      maxScore++;
    }
  }

  const edges = node.Edges || [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const err = scoringCancellationError(ctx, edgeIndex);
    if (err != null) {
      throw err;
    }
    const e = edges[edgeIndex];
    const adjacentNode = node.adjacent(e);
    let adjacentNodeReplacement = adjacentNode;

    let isConnectedToChild = false;
    if (node.IsContainer() && edgeAbductions != null) {
      for (let i = 0; i < edgeAbductions.length; i++) {
        const eaErr = scoringCancellationError(ctx, i);
        if (eaErr != null) {
          throw eaErr;
        }
        const edgeAbduction = edgeAbductions[i];
        if (edgeAbduction.CurrentFrom === node && edgeAbduction.CurrentTo === adjacentNode) {
          if (edgeAbduction.OriginallyFrom != null) {
            isConnectedToChild = true;
            break;
          }
        }
        if (edgeAbduction.CurrentFrom === adjacentNode && edgeAbduction.CurrentTo === node) {
          usedEdgeAbductions[i] = true;
          if (edgeAbduction.OriginallyTo != null) {
            isConnectedToChild = true;
            break;
          }
        }
      }
    }
    if (isConnectedToChild) {
      continue;
    }

    if (edgeAbductions != null) {
      for (let i = 0; i < edgeAbductions.length; i++) {
        const eaErr = scoringCancellationError(ctx, i);
        if (eaErr != null) {
          throw eaErr;
        }
        if (usedEdgeAbductions[i]) {
          continue;
        }
        const edgeAbduction = edgeAbductions[i];
        if (edgeAbduction.CurrentFrom != null && edgeAbduction.CurrentFrom.isClusterVessel) {
          continue;
        }
        if (edgeAbduction.CurrentTo != null && edgeAbduction.CurrentTo.isClusterVessel) {
          continue;
        }
        if (node.Graph != null && (node.Graph.isSequenceVessel(edgeAbduction.CurrentFrom) || node.Graph.isSequenceVessel(edgeAbduction.CurrentTo))) {
          continue;
        }
        if (edgeAbduction.CurrentFrom === node && edgeAbduction.CurrentTo === adjacentNode) {
          usedEdgeAbductions[i] = true;
          if (edgeAbduction.OriginallyTo != null) {
            adjacentNodeReplacement = edgeAbduction.OriginallyTo;
          }
          break;
        }
        if (edgeAbduction.CurrentFrom === adjacentNode && edgeAbduction.CurrentTo === node) {
          usedEdgeAbductions[i] = true;
          if (edgeAbduction.OriginallyFrom != null) {
            adjacentNodeReplacement = edgeAbduction.OriginallyFrom;
          }
          break;
        }
      }
    }

    if (adjacentNodeReplacement.Cluster != null && adjacentNodeReplacement.Cluster.isActive()) {
      adjacentNodeReplacement = adjacentNodeReplacement.Cluster.Vessel;
    } else if (adjacentNodeReplacement.Sequence != null && adjacentNodeReplacement.Sequence.isActive()) {
      adjacentNodeReplacement = adjacentNodeReplacement.Sequence.Vessel;
    }

    if (added.has(adjacentNodeReplacement)) {
      continue;
    }

    dedupedAdjacentNodes.push(adjacentNodeReplacement);
    added.add(adjacentNodeReplacement);
  }

  if (edgeAbductions != null) {
    for (let i = 0; i < edgeAbductions.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      const edgeAbduction = edgeAbductions[i];
      let connectedNode = null;
      if (edgeAbduction.OriginallyFrom === node) {
        if (edgeAbduction.OriginallyTo != null &&
          edgeAbduction.CurrentTo != null &&
          !edgeAbduction.CurrentTo.isClusterVessel &&
          (node.Graph == null || !node.Graph.isSequenceVessel(edgeAbduction.CurrentTo))) {
          connectedNode = edgeAbduction.OriginallyTo;
        } else {
          connectedNode = edgeAbduction.CurrentTo;
        }
      }
      if (edgeAbduction.OriginallyTo === node) {
        if (edgeAbduction.OriginallyFrom != null &&
          edgeAbduction.CurrentFrom != null &&
          !edgeAbduction.CurrentFrom.isClusterVessel &&
          (node.Graph == null || !node.Graph.isSequenceVessel(edgeAbduction.CurrentFrom))) {
          connectedNode = edgeAbduction.OriginallyFrom;
        } else {
          connectedNode = edgeAbduction.CurrentFrom;
        }
      }
      if (connectedNode != null) {
        if (added.has(connectedNode)) {
          continue;
        }
        dedupedAdjacentNodes.push(connectedNode);
        added.add(connectedNode);
      }
    }
  }

  for (let i = 0; i < dedupedAdjacentNodes.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const d = node.distanceTo(dedupedAdjacentNodes[i], true);
    if (d > 1200) {
      dedupedAdjacentNodes.splice(i, 1);
      i--;
    }
  }

  const matched = new Array(dedupedAdjacentNodes.length).fill(false);
  const s = computeSymmetryScoreInto(ctx, node, dedupedAdjacentNodes, matched);
  score += s;
  maxScore += dedupedAdjacentNodes.length;

  if (checkNeighbors) {
    for (let i = 0; i < dedupedAdjacentNodes.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      if (matched[i]) {
        continue;
      }
      const adjacentNode = dedupedAdjacentNodes[i];
      const adjNodeSymm = nodeSymmetry(ctx, adjacentNode, edgeAbductions, false);
      score += adjNodeSymm;
    }
  }

  if (maxScore === 0) {
    return 0.0;
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return score / maxScore;
}

export function computeSymmetryScoreInto(ctx, node, neigh, matchedSlice) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  const n = neigh.length;
  if (n < 2) {
    return 0;
  }
  for (let i = 0; i < n; i++) {
    matchedSlice[i] = false;
  }

  let score = 0.0;
  const ownSiblings = node.Graph?.Containers instanceof Map
    ? node.Graph.Containers.get(node.Container) ?? []
    : (node.Graph?.Containers?.[node.Container] ?? []);

  let otherSiblings = null;

  for (let i = 0; i < n; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    if (matchedSlice[i]) {
      continue;
    }
    const n1 = neigh[i];
    if (n1.Container !== node.Container) {
      otherSiblings = node.Graph?.Containers instanceof Map
        ? node.Graph.Containers.get(n1.Container) ?? []
        : (node.Graph?.Containers?.[n1.Container] ?? []);
    } else {
      otherSiblings = null;
    }

    let bestIdx = -1;
    let best = 0.0;

    for (let j = i + 1; j < n; j++) {
      const pairErr = scoringCancellationError(ctx, j - i - 1);
      if (pairErr != null) {
        throw pairErr;
      }
      if (matchedSlice[j]) {
        continue;
      }
      const n2 = neigh[j];
      if (n1.Container !== n2.Container) {
        continue;
      }

      const area1 = n1.area();
      const area2 = n2.area();
      if (area1 > 2 * area2 || area2 > 2 * area1) {
        continue;
      }

      let ms = -Infinity;
      for (const isX of [true, false]) {
        let axis = node.TopLeft.X + node.Width / 2;
        if (!isX) {
          axis = node.TopLeft.Y + node.Height / 2;
        }
        if (isMirrored(n1, n2, isX, axis)) {
          if (node.overlapsAlongDimension(n1, isX, true) &&
            node.overlapsAlongDimension(n2, isX, true)) {
            ms = 2;
          } else {
            ms = 0.5;
          }
          break;
        }
      }
      if (ms < 0) {
        continue;
      }

      const isObstructed = obstructed(ctx, node, n1, n2, ownSiblings, otherSiblings);
      if (isObstructed) {
        continue;
      }

      if (ms > best) {
        best = ms;
        bestIdx = j;
        if (ms === 2) {
          break;
        }
      }
    }

    if (bestIdx !== -1) {
      matchedSlice[i] = true;
      matchedSlice[bestIdx] = true;
      score += best;
    }
  }

  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return score;
}

export function obstructed(ctx, center, a, b, sib1, sib2) {
  const bounds = scoringNodeBounds(center).including(scoringNodeBounds(a)).including(scoringNodeBounds(b));

  const check = (sibs) => {
    if (!sibs) return false;
    for (let i = 0; i < sibs.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      const s = sibs[i];
      if (s == null || s.TopLeft == null || s.Graph !== center.Graph) {
        continue;
      }
      if (s === center || s === a || s === b) {
        continue;
      }
      if (bounds.excludes(s)) {
        continue;
      }
      if (center.isDescendantOf(s) || a.isDescendantOf(s) || b.isDescendantOf(s)) {
        continue;
      }
      if (s.isDescendantOf(center) || s.isDescendantOf(a) || s.isDescendantOf(b)) {
        continue;
      }
      if (s.passesThrough(center.center(), a.center()) ||
        s.passesThrough(center.center(), b.center())) {
        return true;
      }
    }
    return false;
  };

  const isObstructed = check(sib1);
  if (isObstructed) {
    return true;
  }
  return check(sib2);
}

export function isMirrored(nodeA, nodeB, isXAxis, axisVal) {
  const nodeAtlX = nodeA.TopLeft.X;
  const nodeAtlY = nodeA.TopLeft.Y;
  const nodeAbrX = nodeA.TopLeft.X + nodeA.Width;
  const nodeAbrY = nodeA.TopLeft.Y + nodeA.Height;

  const nodeBtlX = nodeB.TopLeft.X;
  const nodeBtlY = nodeB.TopLeft.Y;
  const nodeBbrX = nodeB.TopLeft.X + nodeB.Width;
  const nodeBbrY = nodeB.TopLeft.Y + nodeB.Height;

  const symmetryTolerance = SYMMETRY_TOLERANCE_BAND * (nodeA.Graph?.CellSize ?? 0);
  if (isXAxis) {
    if (nodeA.TopLeft.X === nodeB.TopLeft.X) {
      return false;
    }

    if (nodeA.TopLeft.X > nodeB.TopLeft.X) {
      if (!((axisVal > nodeBbrX) && (axisVal < nodeAtlX))) {
        return false;
      }
      if (Math.abs((nodeAtlX - axisVal) - (axisVal - nodeBbrX)) > symmetryTolerance) {
        return false;
      }
    } else if (nodeA.TopLeft.X < nodeB.TopLeft.X) {
      if (!((axisVal > nodeAbrX) && (axisVal < nodeBtlX))) {
        return false;
      }
      if (Math.abs((nodeBtlX - axisVal) - (axisVal - nodeAbrX)) > symmetryTolerance) {
        return false;
      }
    }

    return Math.abs(((nodeAtlY + nodeAbrY) / 2.0) - ((nodeBtlY + nodeBbrY) / 2.0)) <= symmetryTolerance;
  }

  if (nodeA.TopLeft.Y === nodeB.TopLeft.Y) {
    return false;
  }
  if (nodeA.TopLeft.Y > nodeB.TopLeft.Y) {
    if (!((axisVal > nodeBbrY) && (axisVal < nodeAtlY))) {
      return false;
    }
    if (Math.abs((nodeAtlY - axisVal) - (axisVal - nodeBbrY)) > symmetryTolerance) {
      return false;
    }
  } else if (nodeA.TopLeft.Y < nodeB.TopLeft.Y) {
    if (!((axisVal > nodeAbrY) && (axisVal < nodeBtlY))) {
      return false;
    }
    if (Math.abs((nodeBtlY - axisVal) - (axisVal - nodeAbrY)) > symmetryTolerance) {
      return false;
    }
  }

  return Math.abs(((nodeAtlX + nodeAbrX) / 2.0) - ((nodeBtlX + nodeBbrX) / 2.0)) <= symmetryTolerance;
}

function segmentsCross(u0, u1, v0, v1) {
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

function countSegmentCrossingsContext(ctx, segments) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  let crossings = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const iStart = segments[i].Start;
    const iEnd = segments[i].End;
    let minX = Math.min(iStart.X, iEnd.X);
    let maxX = Math.max(iStart.X, iEnd.X);
    let minY = Math.min(iStart.Y, iEnd.Y);
    let maxY = Math.max(iStart.Y, iEnd.Y);

    for (let j = i + 1; j < segments.length; j++) {
      const pairErr = scoringCancellationError(ctx, j - i - 1);
      if (pairErr != null) {
        throw pairErr;
      }
      const jStart = segments[j].Start;
      const jEnd = segments[j].End;
      if (jStart.X < jEnd.X) {
        if (jEnd.X < minX || maxX < jStart.X) continue;
      } else {
        if (jStart.X < minX || maxX < jEnd.X) continue;
      }
      if (jStart.Y < jEnd.Y) {
        if (jEnd.Y < minY || maxY < jStart.Y) continue;
      } else {
        if (jStart.Y < minY || maxY < jEnd.Y) continue;
      }

      if (iStart.equals(jStart) || iEnd.equals(jEnd)) {
        continue;
      }
      if (segmentsCross(iStart, iEnd, jStart, jEnd)) {
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
 * ColumnCrossingCost scores crossings between labeled table-column edges.
 * Pinned Go: placementcost.ColumnCrossingCost
 *
 * @param {object} ctx
 * @param {import('../graph/node.js').Node} node
 * @param {Array<import('../graph/edge-abduction.js').EdgeAbduction>} edgeAbductions
 * @returns {number}
 */
export function columnCrossingCost(ctx, node, edgeAbductions) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  if (!node.isTable()) {
    return 0;
  }

  const edgeToAbduction = new Map();
  if (edgeAbductions != null) {
    for (let i = 0; i < edgeAbductions.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      const abduction = edgeAbductions[i];
      edgeToAbduction.set(abduction.Edge, abduction);
    }
  }

  const segments = [];
  const edges = node.Edges || [];
  for (let i = 0; i < edges.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const e = edges[i];
    let fromPort, toPort, hasFromPort, hasToPort;
    const abduction = edgeToAbduction.get(e);
    if (abduction != null) {
      [fromPort, toPort, hasFromPort, hasToPort] = e.FacingTablePortValues(abduction.OriginallyFrom, abduction.OriginallyTo);
    } else {
      [fromPort, toPort, hasFromPort, hasToPort] = e.FacingTablePortValues(null, null);
    }

    if (!hasFromPort || !hasToPort) {
      continue;
    }
    segments.push({ Start: fromPort, End: toPort });
  }

  const crossings = countSegmentCrossingsContext(ctx, segments);
  return CROSSING_COST_WEIGHT * crossings * (node.Graph?.CellSize ?? 0);
}

export const ColumnCrossingCost = columnCrossingCost;
