import { Point } from '../geometry/point.js';
import { Orientation, isDiagonal as isDiagonalOrientation, isHorizontal, isVertical, getOpposite } from '../geometry/orientation.js';
import {
  SIDE_EDGE_SPACING,
  SIZELESS_DIRECTION_DELTA_FACTOR,
  checkScoringCancellation,
  scoringCancellationError,
  directionCompass,
  compassDelta,
  compassAxisDelta,
  sizelessOrientation,
  distanceToPoint,
  placementDistance,
  depth,
  distanceBetweenTableColumns,
  SCORING_CANCELLATION_CHECK_INTERVAL,
} from './geometry.js';
import { axisScore } from './axis.js';
import { clusterExactlyTwoExternalConnectedNodes } from './cluster.js';
import { scoringNodeBounds } from './obstruction-bounds.js';
import { flowContinuityCost } from './flow-continuity.js';
import { sortNodesByID } from '../graph/node.js';

export class EdgeLengthOptions {
  constructor(options = {}) {
    this.EdgeAbductions = options.EdgeAbductions ?? null;
    this.IncludeNodeSizes = options.IncludeNodeSizes ?? false;
    this.EnforceMinimumGap = options.EnforceMinimumGap ?? false;
    this.PenalizeDirection = options.PenalizeDirection ?? false;
  }
}

export function createEdgeScratch() {
  return {
    used: [],
    nRepl: [],
    aRepl: [],
    clusterOrder: [],
    edgeAbductions: [],
    obstructionSets: [],
    obstructionAdded: new Set(),
    labeledEdgeCount: new Map(),
  };
}

function checkScoringSlice(ctx, length) {
  for (let start = 0; start < length; start += SCORING_CANCELLATION_CHECK_INTERVAL) {
    const err = scoringCancellationError(ctx, start);
    if (err != null) {
      return err;
    }
  }
  return null;
}

function calculateHorizontalMidpoint(nodeReplacement, adjacentNodeReplacement) {
  const ceil = Math.min(nodeReplacement.TopLeft.X + nodeReplacement.Width, adjacentNodeReplacement.TopLeft.X + adjacentNodeReplacement.Width);
  const floor = Math.max(nodeReplacement.TopLeft.X, adjacentNodeReplacement.TopLeft.X);
  const mid = (floor + ceil) / 2.0;
  const isSemiDiagonal = Math.abs(nodeReplacement.TopLeft.X - adjacentNodeReplacement.TopLeft.X) > SIDE_EDGE_SPACING ||
    Math.abs(nodeReplacement.TopLeft.X + nodeReplacement.Width - (adjacentNodeReplacement.TopLeft.X + adjacentNodeReplacement.Width)) > SIDE_EDGE_SPACING;
  return [mid, isSemiDiagonal];
}

function calculateVerticalMidpoint(nodeReplacement, adjacentNodeReplacement) {
  const ceil = Math.min(nodeReplacement.TopLeft.Y + nodeReplacement.Height, adjacentNodeReplacement.TopLeft.Y + adjacentNodeReplacement.Height);
  const floor = Math.max(nodeReplacement.TopLeft.Y, adjacentNodeReplacement.TopLeft.Y);
  const mid = (floor + ceil) / 2.0;
  const isSemiDiagonal = Math.abs(nodeReplacement.TopLeft.Y - adjacentNodeReplacement.TopLeft.Y) > SIDE_EDGE_SPACING ||
    Math.abs(nodeReplacement.TopLeft.Y + nodeReplacement.Height - (adjacentNodeReplacement.TopLeft.Y + adjacentNodeReplacement.Height)) > SIDE_EDGE_SPACING;
  return [mid, isSemiDiagonal];
}

/**
 * NodeEdgeLength evaluates the incident-edge cost rooted at node.
 * Pinned Go: placementcost.NodeEdgeLength
 *
 * @param {object} ctx
 * @param {import('../graph/node.js').Node} node
 * @param {EdgeLengthOptions|object} options
 * @returns {number}
 */
export function nodeEdgeLength(ctx, node, options = {}) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  const opts = options instanceof EdgeLengthOptions ? options : new EdgeLengthOptions(options);
  const s = createEdgeScratch();
  const setup = prepareNodeEdgeLength(ctx, node, opts, s);
  return evaluateNodeEdgeLength(ctx, node, opts, s, setup);
}

export const NodeEdgeLength = nodeEdgeLength;

/**
 * NodesEdgeLength sums the edge-length cost rooted at each node in order.
 * Pinned Go: placementcost.NodesEdgeLength
 */
export function nodesEdgeLength(ctx, nodes, options = {}) {
  const cancelErr = checkScoringCancellation(ctx);
  if (cancelErr != null) {
    throw cancelErr;
  }
  const opts = options instanceof EdgeLengthOptions ? options : new EdgeLengthOptions(options);
  let result = 0.0;
  for (const node of nodes) {
    const length = nodeEdgeLength(ctx, node, opts);
    result += length;
  }
  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  return result;
}

export const NodesEdgeLength = nodesEdgeLength;

export function prepareNodeEdgeLength(ctx, node, options, s) {
  const includeSizes = options.IncludeNodeSizes;
  const directionPenalty = options.PenalizeDirection;

  let edgeAbductions = options.EdgeAbductions;
  if (edgeAbductions == null) {
    s.clusterOrder = [];
    if (node.Graph?.Clusters != null) {
      if (node.Graph.Clusters instanceof Map) {
        for (const vessel of node.Graph.Clusters.keys()) {
          s.clusterOrder.push(vessel);
        }
      } else {
        for (const vessel in node.Graph.Clusters) {
          s.clusterOrder.push(vessel);
        }
      }
    }
    sortNodesByID(s.clusterOrder);

    s.edgeAbductions = [];
    for (let i = 0; i < s.clusterOrder.length; i++) {
      const err = scoringCancellationError(ctx, i);
      if (err != null) {
        throw err;
      }
      const vessel = s.clusterOrder[i];
      const cluster = node.Graph.Clusters instanceof Map
        ? node.Graph.Clusters.get(vessel)
        : node.Graph.Clusters[vessel];
      if (cluster?.EdgeAbductions) {
        s.edgeAbductions.push(...cluster.EdgeAbductions);
      }
    }
    edgeAbductions = s.edgeAbductions;
  }

  const usedEdgeAbductions = new Array(edgeAbductions.length).fill(false);
  s.used = usedEdgeAbductions;
  const sliceErr1 = checkScoringSlice(ctx, usedEdgeAbductions.length);
  if (sliceErr1 != null) {
    throw sliceErr1;
  }

  const edges = node.Edges || [];
  const nodeReplacements = new Array(edges.length);
  s.nRepl = nodeReplacements;
  const sliceErr2 = checkScoringSlice(ctx, nodeReplacements.length);
  if (sliceErr2 != null) {
    throw sliceErr2;
  }

  const adjReplacements = new Array(edges.length);
  s.aRepl = adjReplacements;
  const sliceErr3 = checkScoringSlice(ctx, adjReplacements.length);
  if (sliceErr3 != null) {
    throw sliceErr3;
  }

  for (let i = 0; i < edges.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const e = edges[i];
    const adjacentNode = node.adjacent(e);
    let nodeReplacement = node;
    let adjacentNodeReplacement = adjacentNode;

    if (includeSizes) {
      for (let j = 0; j < edgeAbductions.length; j++) {
        const eaErr = scoringCancellationError(ctx, j);
        if (eaErr != null) {
          throw eaErr;
        }
        if (usedEdgeAbductions[j]) {
          continue;
        }
        const edgeAbduction = edgeAbductions[j];
        if (edgeAbduction.CurrentFrom === node && edgeAbduction.CurrentTo === adjacentNode) {
          usedEdgeAbductions[j] = true;
          if (edgeAbduction.OriginallyTo != null) {
            adjacentNodeReplacement = edgeAbduction.OriginallyTo;
          }
          if (edgeAbduction.OriginallyFrom != null) {
            nodeReplacement = edgeAbduction.OriginallyFrom;
          }
          break;
        }
        if (edgeAbduction.CurrentFrom === adjacentNode && edgeAbduction.CurrentTo === node) {
          usedEdgeAbductions[j] = true;
          if (edgeAbduction.OriginallyFrom != null) {
            adjacentNodeReplacement = edgeAbduction.OriginallyFrom;
          }
          if (edgeAbduction.OriginallyTo != null) {
            nodeReplacement = edgeAbduction.OriginallyTo;
          }
          break;
        }
      }
    }

    nodeReplacements[i] = nodeReplacement;
    adjReplacements[i] = adjacentNodeReplacement;
  }

  let direction = node.containerDirection();
  let directionFactor = 0.0;
  if (directionPenalty) {
    if (direction !== Orientation.NONE) {
      directionFactor = includeSizes ? 6.0 : 1.5;
    } else {
      if (node.isTable()) {
        direction = Orientation.Right;
        directionFactor = 0.5;
      } else {
        const edgeCounts = new Map();
        const fromCounts = new Map();
        let hasMultipleLabels = false;
        let multiLabelNode = null;

        if (includeSizes) {
          for (let i = 0; i < edges.length; i++) {
            const err = scoringCancellationError(ctx, i);
            if (err != null) {
              throw err;
            }
            const nodeReplacement = nodeReplacements[i];
            if (nodeReplacement !== node) {
              continue;
            }
            const adjacentNodeReplacement = adjReplacements[i];
            if (adjacentNodeReplacement !== node.adjacent(edges[i])) {
              continue;
            }
            const e = edges[i];
            if (e.Label != null) {
              if (adjacentNodeReplacement === nodeReplacement) {
                continue;
              }
              edgeCounts.set(adjacentNodeReplacement, (edgeCounts.get(adjacentNodeReplacement) ?? 0) + 1);
              let from = e.From;
              const [semanticFrom, , directed] = e.directedEndpoints();
              if (directed) {
                from = semanticFrom;
              }
              if (from === node) {
                fromCounts.set(adjacentNodeReplacement, (fromCounts.get(adjacentNodeReplacement) ?? 0) + 1);
              }
              if (edgeCounts.get(adjacentNodeReplacement) > 2) {
                hasMultipleLabels = true;
                multiLabelNode = adjacentNodeReplacement;
              }
            }
          }
        }

        if (hasMultipleLabels) {
          if ((fromCounts.get(multiLabelNode) ?? 0) > (edgeCounts.get(multiLabelNode) ?? 0) / 2) {
            direction = Orientation.Left;
          } else {
            direction = Orientation.Right;
          }
          directionFactor = 10.0;
        } else {
          direction = Orientation.BottomRight;
          directionFactor = 0.3;
        }
      }

      if (node.isClusterVessel) {
        directionFactor = 0.2;
        const cluster = node.Graph?.Clusters instanceof Map
          ? node.Graph.Clusters.get(node)
          : node.Graph?.Clusters?.[node];
        if (cluster != null) {
          // Row = 1, Column = 2
          if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
            direction = Orientation.Bottom;
          } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
            direction = Orientation.Right;
          }
        }
      }
    }
  }

  s.labeledEdgeCount = new Map();
  for (let i = 0; i < edges.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const edge = edges[i];
    if (!includeSizes || edge.Label == null) {
      continue;
    }
    const nodeReplacement = nodeReplacements[i];
    const adjacentNodeReplacement = adjReplacements[i];
    const pairKey = `${nodeReplacement.ID}->${adjacentNodeReplacement.ID}`;
    s.labeledEdgeCount.set(pairKey, (s.labeledEdgeCount.get(pairKey) ?? 0) + 1);
  }

  return { direction, directionFactor };
}

export function evaluateNodeEdgeLength(ctx, node, options, s, setup) {
  const includeSizes = options.IncludeNodeSizes;
  const directionPenalty = options.PenalizeDirection;
  let minGapSize = 0.0;
  if (options.IncludeNodeSizes && options.EnforceMinimumGap) {
    minGapSize = node.Graph?.CellSize ?? 0;
  }
  const nodeReplacements = s.nRepl;
  const adjReplacements = s.aRepl;
  const direction = setup.direction;
  const directionFactor = setup.directionFactor;
  const compass = directionCompass(direction);
  let totalDistance = 0.0;
  const nodeContainer = node.effectiveContainer();

  const edges = node.Edges || [];
  for (let i = 0; i < edges.length; i++) {
    const err = scoringCancellationError(ctx, i);
    if (err != null) {
      throw err;
    }
    const e = edges[i];
    const adjacentNode = node.adjacent(e);
    if (adjacentNode.TopLeft == null) {
      continue;
    }
    const nodeReplacement = nodeReplacements[i];
    const adjacentNodeReplacement = adjReplacements[i];

    let nodeVal = null;
    let adjacentNodeVal = null;

    let nodeCenter = null;
    let adjacentNodeCenter = null;
    let edgeDirection = null;
    let edgeDirectionCalculated = false;
    let edgeDir = null;

    const getCenters = () => {
      if (nodeCenter == null) {
        nodeCenter = nodeReplacement.center();
        adjacentNodeCenter = adjacentNodeReplacement.center();
      }
    };

    const getEdgeDirection = () => {
      if (!edgeDirectionCalculated) {
        if (includeSizes) {
          edgeDirection = nodeReplacement.orientation(adjacentNodeReplacement);
        } else {
          edgeDirection = sizelessOrientation(nodeReplacement, adjacentNodeReplacement);
        }
        edgeDirectionCalculated = true;
      }
      return edgeDirection;
    };

    let isDiagonal = false;
    let isSemiDiagonal = false;

    if (includeSizes) {
      edgeDir = getEdgeDirection();
      if (edgeDir === Orientation.NONE) {
        continue;
      }
      if (isDiagonalOrientation(edgeDir)) {
        isDiagonal = true;
      }
      switch (edgeDir) {
        case Orientation.Top: {
          const [mid, semiDiag] = calculateHorizontalMidpoint(nodeReplacement, adjacentNodeReplacement);
          nodeVal = new Point(mid, nodeReplacement.TopLeft.Y + nodeReplacement.Height);
          adjacentNodeVal = new Point(mid, adjacentNodeReplacement.TopLeft.Y);
          isSemiDiagonal = semiDiag;
          break;
        }
        case Orientation.Bottom: {
          const [mid, semiDiag] = calculateHorizontalMidpoint(nodeReplacement, adjacentNodeReplacement);
          nodeVal = new Point(mid, nodeReplacement.TopLeft.Y);
          adjacentNodeVal = new Point(mid, adjacentNodeReplacement.TopLeft.Y + adjacentNodeReplacement.Height);
          isSemiDiagonal = semiDiag;
          break;
        }
        case Orientation.Left: {
          const [mid, semiDiag] = calculateVerticalMidpoint(nodeReplacement, adjacentNodeReplacement);
          nodeVal = new Point(nodeReplacement.TopLeft.X + nodeReplacement.Width, mid);
          adjacentNodeVal = new Point(adjacentNodeReplacement.TopLeft.X, mid);
          isSemiDiagonal = semiDiag;
          break;
        }
        case Orientation.Right: {
          const [mid, semiDiag] = calculateVerticalMidpoint(nodeReplacement, adjacentNodeReplacement);
          nodeVal = new Point(nodeReplacement.TopLeft.X, mid);
          adjacentNodeVal = new Point(adjacentNodeReplacement.TopLeft.X + adjacentNodeReplacement.Width, mid);
          isSemiDiagonal = semiDiag;
          break;
        }
        case Orientation.TopLeft:
        case Orientation.TopRight:
        case Orientation.BottomLeft:
        case Orientation.BottomRight:
          getCenters();
          nodeVal = nodeCenter;
          adjacentNodeVal = adjacentNodeCenter;
          break;
      }

      if (nodeReplacement.Cluster != null || adjacentNodeReplacement.Cluster != null) {
        isSemiDiagonal = false;
        isDiagonal = false;
        getCenters();
        switch (edgeDir) {
          case Orientation.Top:
          case Orientation.TopLeft:
          case Orientation.TopRight:
            nodeVal = new Point(nodeCenter.X, nodeReplacement.TopLeft.Y + nodeReplacement.Height);
            adjacentNodeVal = new Point(adjacentNodeCenter.X, adjacentNodeReplacement.TopLeft.Y);
            break;
          case Orientation.Bottom:
          case Orientation.BottomLeft:
          case Orientation.BottomRight:
            nodeVal = new Point(nodeCenter.X, nodeReplacement.TopLeft.Y);
            adjacentNodeVal = new Point(adjacentNodeCenter.X, adjacentNodeReplacement.TopLeft.Y + adjacentNodeReplacement.Height);
            break;
          case Orientation.Left:
            nodeVal = new Point(nodeReplacement.TopLeft.X + nodeReplacement.Width, nodeCenter.Y);
            adjacentNodeVal = new Point(adjacentNodeReplacement.TopLeft.X, adjacentNodeCenter.Y);
            break;
          case Orientation.Right:
            nodeVal = new Point(nodeReplacement.TopLeft.X, nodeCenter.Y);
            adjacentNodeVal = new Point(adjacentNodeReplacement.TopLeft.X + adjacentNodeReplacement.Width, adjacentNodeCenter.Y);
            break;
        }
      }
    } else {
      nodeVal = nodeReplacement.TopLeft;
      adjacentNodeVal = adjacentNodeReplacement.TopLeft;
    }

    let distance = 0.0;
    if (includeSizes && e.hasTableColumn()) {
      let from = nodeReplacement;
      let to = adjacentNodeReplacement;
      if (node !== e.From) {
        from = adjacentNodeReplacement;
        to = nodeReplacement;
      }
      distance = distanceBetweenTableColumns(node.Graph, e, from, to);
    } else {
      if (nodeReplacement.Cluster != null || adjacentNodeReplacement.Cluster != null) {
        if (nodeReplacement.Cluster != null) {
          distance = placementDistance(nodeReplacement.Cluster.Vessel, adjacentNodeReplacement, includeSizes);
        } else {
          distance = placementDistance(adjacentNodeReplacement.Cluster.Vessel, nodeReplacement, includeSizes);
        }
      } else if (isDiagonal) {
        distance = distanceToPoint(nodeReplacement, new Point(nodeVal.X, adjacentNodeVal.Y), includeSizes) +
          distanceToPoint(adjacentNodeReplacement, new Point(nodeVal.X, adjacentNodeVal.Y), includeSizes);
        if (includeSizes) {
          distance += node.Graph.TurnCost();
        }
      } else {
        distance = placementDistance(nodeReplacement, adjacentNodeReplacement, includeSizes);
      }
    }

    if (includeSizes && node.IsContainer() && adjacentNode.IsContainer() && nodeContainer === adjacentNode.effectiveContainer()) {
      let containerAlignmentPenalty = 0.0;
      if (Math.min(node.Width, adjacentNode.Width) > Math.max(node.Width, adjacentNode.Width) * 0.75) {
        if ((node.TopLeft.X !== adjacentNode.TopLeft.X) &&
          (node.TopLeft.X + node.Width !== adjacentNode.TopLeft.X + adjacentNode.Width) &&
          ((node.TopLeft.X + node.Width) / 2 !== (adjacentNode.TopLeft.X + adjacentNode.Width) / 2)) {
          containerAlignmentPenalty = node.Graph.TurnCost();
        }
      }

      if (Math.min(node.Height, adjacentNode.Height) > Math.max(node.Height, adjacentNode.Height) * 0.75) {
        if ((node.TopLeft.Y !== adjacentNode.TopLeft.Y) &&
          (node.TopLeft.Y + node.Height !== adjacentNode.TopLeft.Y + adjacentNode.Height) &&
          ((node.TopLeft.Y + node.Height) / 2 !== (adjacentNode.TopLeft.Y + adjacentNode.Height) / 2)) {
          containerAlignmentPenalty = node.Graph.TurnCost();
        }
      }

      distance += containerAlignmentPenalty;
    }

    if (includeSizes && !e.isBetweenTableColumns()) {
      const bounds = scoringNodeBounds(nodeReplacement).including(scoringNodeBounds(adjacentNodeReplacement));
      let passesThroughCornerA = false;
      let passesThroughCornerB = false;

      const checkBestRouteBlocked = (otherNode) => {
        if (otherNode.isDescendantOf(nodeReplacement) || otherNode.isDescendantOf(adjacentNodeReplacement)) {
          return false;
        }
        if (isDiagonal) {
          if (!passesThroughCornerA &&
            (otherNode.passesThrough(nodeVal, new Point(nodeVal.X, adjacentNodeVal.Y)) ||
              otherNode.passesThrough(adjacentNodeVal, new Point(nodeVal.X, adjacentNodeVal.Y)))) {
            passesThroughCornerA = true;
          }
          if (!passesThroughCornerB &&
            (otherNode.passesThrough(nodeVal, new Point(adjacentNodeVal.X, nodeVal.Y)) ||
              otherNode.passesThrough(adjacentNodeVal, new Point(adjacentNodeVal.X, nodeVal.Y)))) {
            passesThroughCornerB = true;
          }
          if (passesThroughCornerA && passesThroughCornerB) {
            return true;
          }
        } else {
          if (otherNode.passesThrough(nodeVal, adjacentNodeVal)) {
            return true;
          }
        }
        return false;
      };

      let isL1Blocked = false;
      let isL2Blocked = false;

      if (isSemiDiagonal) {
        edgeDir = getEdgeDirection();
        switch (edgeDir) {
          case Orientation.Left:
          case Orientation.Right:
            if (Math.abs(nodeReplacement.TopLeft.Y - adjacentNodeReplacement.TopLeft.Y) <= SIDE_EDGE_SPACING) {
              isL1Blocked = true;
            } else if (Math.abs(nodeReplacement.TopLeft.Y + nodeReplacement.Height - (adjacentNodeReplacement.TopLeft.Y + adjacentNodeReplacement.Height)) <= SIDE_EDGE_SPACING) {
              isL2Blocked = true;
            }
            break;
          case Orientation.Top:
          case Orientation.Bottom:
            if (Math.abs(nodeReplacement.TopLeft.X - adjacentNodeReplacement.TopLeft.X) <= SIDE_EDGE_SPACING) {
              isL2Blocked = true;
            } else if (Math.abs(nodeReplacement.TopLeft.X + nodeReplacement.Width - (adjacentNodeReplacement.TopLeft.X + adjacentNodeReplacement.Width)) <= SIDE_EDGE_SPACING) {
              isL1Blocked = true;
            }
            break;
        }
      }

      const checkAlternateRouteBlocked = (otherNode) => {
        if (otherNode.isDescendantOf(nodeReplacement) || otherNode.isDescendantOf(adjacentNodeReplacement)) {
          return false;
        }
        getCenters();
        edgeDir = getEdgeDirection();
        let nr = nodeReplacement;
        let anr = adjacentNodeReplacement;
        let nc = nodeCenter;
        let anc = adjacentNodeCenter;

        switch (edgeDir) {
          case Orientation.Top: {
            const floor = Math.max(nr.TopLeft.X, anr.TopLeft.X);
            const ceil = Math.min(nr.TopLeft.X + nr.Width, anr.TopLeft.X + anr.Width);
            if (!isL2Blocked) {
              const minX = Math.min(nr.TopLeft.X, anr.TopLeft.X);
              const lowerMidX = minX + Math.abs(floor - minX) / 2.0;
              if (nr.TopLeft.X < anr.TopLeft.X) {
                if (otherNode.passesThrough(new Point(lowerMidX, nc.Y), new Point(lowerMidX, anc.Y)) ||
                  otherNode.passesThrough(new Point(lowerMidX, anc.Y), anc)) {
                  isL2Blocked = true;
                }
              }
              if (nr.TopLeft.X > anr.TopLeft.X) {
                if (otherNode.passesThrough(nc, new Point(lowerMidX, nc.Y)) ||
                  otherNode.passesThrough(new Point(lowerMidX, anc.Y), new Point(lowerMidX, nc.Y))) {
                  isL2Blocked = true;
                }
              }
            }
            if (!isL1Blocked) {
              const maxX = Math.max(nr.TopLeft.X + nr.Width, anr.TopLeft.X + anr.Width);
              const upperMidX = maxX - Math.abs(ceil - maxX) / 2.0;
              if (nr.TopLeft.X + nr.Width > anr.TopLeft.X + anr.Width) {
                if (otherNode.passesThrough(new Point(upperMidX, nc.Y), new Point(upperMidX, anc.Y)) ||
                  otherNode.passesThrough(anc, new Point(upperMidX, anc.Y))) {
                  isL1Blocked = true;
                }
              }
              if (nr.TopLeft.X + nr.Width < anr.TopLeft.X + anr.Width) {
                if (otherNode.passesThrough(nc, new Point(upperMidX, nc.Y)) ||
                  otherNode.passesThrough(new Point(upperMidX, anc.Y), new Point(upperMidX, nc.Y))) {
                  isL1Blocked = true;
                }
              }
            }
            break;
          }
          case Orientation.Bottom: {
            // swap
            nr = adjacentNodeReplacement;
            anr = nodeReplacement;
            nc = adjacentNodeCenter;
            anc = nodeCenter;

            const floor = Math.max(nr.TopLeft.X, anr.TopLeft.X);
            const ceil = Math.min(nr.TopLeft.X + nr.Width, anr.TopLeft.X + anr.Width);
            if (!isL2Blocked) {
              const minX = Math.min(nr.TopLeft.X, anr.TopLeft.X);
              const lowerMidX = minX + Math.abs(floor - minX) / 2.0;
              if (nr.TopLeft.X < anr.TopLeft.X) {
                if (otherNode.passesThrough(new Point(lowerMidX, nc.Y), new Point(lowerMidX, anc.Y)) ||
                  otherNode.passesThrough(new Point(lowerMidX, anc.Y), anc)) {
                  isL2Blocked = true;
                }
              }
              if (nr.TopLeft.X > anr.TopLeft.X) {
                if (otherNode.passesThrough(nc, new Point(lowerMidX, nc.Y)) ||
                  otherNode.passesThrough(new Point(lowerMidX, anc.Y), new Point(lowerMidX, nc.Y))) {
                  isL2Blocked = true;
                }
              }
            }
            if (!isL1Blocked) {
              const maxX = Math.max(nr.TopLeft.X + nr.Width, anr.TopLeft.X + anr.Width);
              const upperMidX = maxX - Math.abs(ceil - maxX) / 2.0;
              if (nr.TopLeft.X + nr.Width > anr.TopLeft.X + anr.Width) {
                if (otherNode.passesThrough(new Point(upperMidX, nc.Y), new Point(upperMidX, anc.Y)) ||
                  otherNode.passesThrough(anc, new Point(upperMidX, anc.Y))) {
                  isL1Blocked = true;
                }
              }
              if (nr.TopLeft.X + nr.Width < anr.TopLeft.X + anr.Width) {
                if (otherNode.passesThrough(nc, new Point(upperMidX, nc.Y)) ||
                  otherNode.passesThrough(new Point(upperMidX, anc.Y), new Point(upperMidX, nc.Y))) {
                  isL1Blocked = true;
                }
              }
            }
            break;
          }
          case Orientation.Left: {
            const floor = Math.max(nr.TopLeft.Y, anr.TopLeft.Y);
            const ceil = Math.min(nr.TopLeft.Y + nr.Height, anr.TopLeft.Y + anr.Height);
            if (!isL1Blocked) {
              const minY = Math.min(nr.TopLeft.Y, anr.TopLeft.Y);
              const lowerMidY = minY + Math.abs(floor - minY) / 2.0;
              if (nr.TopLeft.Y < anr.TopLeft.Y) {
                if (otherNode.passesThrough(new Point(nc.X, lowerMidY), new Point(anc.X, lowerMidY)) ||
                  otherNode.passesThrough(anc, new Point(anc.X, lowerMidY))) {
                  isL1Blocked = true;
                }
              }
              if (nr.TopLeft.Y > anr.TopLeft.Y) {
                if (otherNode.passesThrough(nc, new Point(nc.X, lowerMidY)) ||
                  otherNode.passesThrough(new Point(anc.X, lowerMidY), new Point(nc.X, lowerMidY))) {
                  isL1Blocked = true;
                }
              }
            }
            if (!isL2Blocked) {
              const maxY = Math.max(nr.TopLeft.Y + nr.Height, anr.TopLeft.Y + anr.Height);
              const upperMidY = maxY - Math.abs(ceil - maxY) / 2.0;
              if (nr.TopLeft.Y + nr.Height > anr.TopLeft.Y + anr.Height) {
                if (otherNode.passesThrough(new Point(nc.X, upperMidY), new Point(anc.X, upperMidY)) ||
                  otherNode.passesThrough(anc, new Point(anc.X, upperMidY))) {
                  isL2Blocked = true;
                }
              }
              if (nr.TopLeft.Y + nr.Height < anr.TopLeft.Y + anr.Height) {
                if (otherNode.passesThrough(nc, new Point(nc.X, upperMidY)) ||
                  otherNode.passesThrough(new Point(anc.X, upperMidY), new Point(nc.X, upperMidY))) {
                  isL2Blocked = true;
                }
              }
            }
            break;
          }
          case Orientation.Right: {
            // swap
            nr = adjacentNodeReplacement;
            anr = nodeReplacement;
            nc = adjacentNodeCenter;
            anc = nodeCenter;

            const floor = Math.max(nr.TopLeft.Y, anr.TopLeft.Y);
            const ceil = Math.min(nr.TopLeft.Y + nr.Height, anr.TopLeft.Y + anr.Height);
            if (!isL1Blocked) {
              const minY = Math.min(nr.TopLeft.Y, anr.TopLeft.Y);
              const lowerMidY = minY + Math.abs(floor - minY) / 2.0;
              if (nr.TopLeft.Y < anr.TopLeft.Y) {
                if (otherNode.passesThrough(new Point(nc.X, lowerMidY), new Point(anc.X, lowerMidY)) ||
                  otherNode.passesThrough(anc, new Point(anc.X, lowerMidY))) {
                  isL1Blocked = true;
                }
              }
              if (nr.TopLeft.Y > anr.TopLeft.Y) {
                if (otherNode.passesThrough(nc, new Point(nc.X, lowerMidY)) ||
                  otherNode.passesThrough(new Point(anc.X, lowerMidY), new Point(nc.X, lowerMidY))) {
                  isL1Blocked = true;
                }
              }
            }
            if (!isL2Blocked) {
              const maxY = Math.max(nr.TopLeft.Y + nr.Height, anr.TopLeft.Y + anr.Height);
              const upperMidY = maxY - Math.abs(ceil - maxY) / 2.0;
              if (nr.TopLeft.Y + nr.Height > anr.TopLeft.Y + anr.Height) {
                if (otherNode.passesThrough(new Point(nc.X, upperMidY), new Point(anc.X, upperMidY)) ||
                  otherNode.passesThrough(anc, new Point(anc.X, upperMidY))) {
                  isL2Blocked = true;
                }
              }
              if (nr.TopLeft.Y + nr.Height < anr.TopLeft.Y + anr.Height) {
                if (otherNode.passesThrough(nc, new Point(nc.X, upperMidY)) ||
                  otherNode.passesThrough(new Point(anc.X, upperMidY), new Point(nc.X, upperMidY))) {
                  isL2Blocked = true;
                }
              }
            }
            break;
          }
        }

        return isL1Blocked && isL2Blocked;
      };

      let bestRouteBlocked = false;
      let alternateRouteBlocked = !isSemiDiagonal;

      const obstructionSets = [];
      const obstructionAdded = new Set();
      const ancestor = nodeReplacement.nearestSharedAncestor(adjacentNodeReplacement);

      let curr = nodeReplacement.effectiveContainer();
      while (true) {
        if (obstructionAdded.has(curr)) break;
        const set = node.Graph?.Containers instanceof Map
          ? node.Graph.Containers.get(curr) ?? []
          : (node.Graph?.Containers?.[curr] ?? []);
        obstructionSets.push(set);
        obstructionAdded.add(curr);
        if (curr == null || curr === ancestor) break;
        curr = curr.effectiveContainer();
        if (curr === ancestor) break;
      }

      curr = adjacentNodeReplacement.effectiveContainer();
      while (true) {
        if (obstructionAdded.has(curr)) break;
        const set = node.Graph?.Containers instanceof Map
          ? node.Graph.Containers.get(curr) ?? []
          : (node.Graph?.Containers?.[curr] ?? []);
        obstructionSets.push(set);
        obstructionAdded.add(curr);
        if (curr == null || curr === ancestor) break;
        curr = curr.effectiveContainer();
        if (curr === ancestor) break;
      }

      for (let obstructionSetIndex = 0; obstructionSetIndex < obstructionSets.length; obstructionSetIndex++) {
        const setErr = scoringCancellationError(ctx, obstructionSetIndex);
        if (setErr != null) {
          throw setErr;
        }
        const obstructions = obstructionSets[obstructionSetIndex];
        for (let j = 0; j < obstructions.length; j++) {
          const obsErr = scoringCancellationError(ctx, j);
          if (obsErr != null) {
            throw obsErr;
          }
          const obstruction = obstructions[j];
          if (bounds.excludes(obstruction)) {
            continue;
          }
          if (nodeReplacement.isDescendantOf(obstruction) || adjacentNodeReplacement.isDescendantOf(obstruction)) {
            continue;
          }
          if (obstruction.TopLeft == null || obstruction.Graph !== nodeReplacement.Graph) {
            continue;
          }
          if (obstruction === nodeReplacement || obstruction === adjacentNodeReplacement) {
            continue;
          }
          if (obstruction.isClusterVessel) {
            if ((nodeReplacement.Cluster != null && nodeReplacement.Cluster.Vessel === obstruction) ||
              (adjacentNodeReplacement.Cluster != null && adjacentNodeReplacement.Cluster.Vessel === obstruction)) {
              continue;
            }
          }

          if (!bestRouteBlocked && checkBestRouteBlocked(obstruction)) {
            bestRouteBlocked = true;
          }
          if (bestRouteBlocked && !alternateRouteBlocked && checkAlternateRouteBlocked(obstruction)) {
            alternateRouteBlocked = true;
          }
          if (bestRouteBlocked && alternateRouteBlocked) {
            break;
          }
        }
        if (bestRouteBlocked && alternateRouteBlocked) {
          break;
        }
      }

      if (bestRouteBlocked) {
        let passThroughCost = 0.0;
        if (nodeReplacement.Cluster != null || adjacentNodeReplacement.Cluster != null) {
          passThroughCost = node.Graph.TurnCost() * 2;
        } else if (isDiagonal) {
          passThroughCost = node.Graph.TurnCost();
        } else if (isSemiDiagonal) {
          if (alternateRouteBlocked) {
            passThroughCost = node.Graph.TurnCost() * 2;
          } else {
            passThroughCost = node.Graph.TurnCost();
          }
        } else {
          passThroughCost = node.Graph.TurnCost() * 2;
        }
        distance += passThroughCost;
      }

      const badClusterArrangementPenalty = node.Graph.TurnCost();

      if (nodeReplacement.Cluster != null) {
        const cluster = nodeReplacement.Cluster;
        if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
          edgeDir = getEdgeDirection();
          if (edgeDir === Orientation.Left || edgeDir === Orientation.Right) {
            distance += badClusterArrangementPenalty * 2;
          }
        } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
          edgeDir = getEdgeDirection();
          if (edgeDir === Orientation.Top || edgeDir === Orientation.Bottom) {
            distance += badClusterArrangementPenalty * 2;
          }
        }

        const thisClusterDirection = cluster.Vessel.orientation(adjacentNodeReplacement);
        const [firstExternalNode, secondExternalNode, exactlyTwo] = clusterExactlyTwoExternalConnectedNodes(cluster);
        if (exactlyTwo) {
          const otherClusterNode = firstExternalNode === adjacentNodeReplacement ? secondExternalNode : firstExternalNode;
          const otherClusterDirection = cluster.Vessel.orientation(otherClusterNode);

          if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
            switch (otherClusterDirection) {
              case Orientation.TopLeft:
              case Orientation.Top:
              case Orientation.TopRight:
                switch (thisClusterDirection) {
                  case Orientation.TopLeft:
                  case Orientation.Top:
                  case Orientation.TopRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
              case Orientation.BottomLeft:
              case Orientation.Bottom:
              case Orientation.BottomRight:
                switch (thisClusterDirection) {
                  case Orientation.BottomLeft:
                  case Orientation.Bottom:
                  case Orientation.BottomRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
            }
          } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
            switch (otherClusterDirection) {
              case Orientation.TopLeft:
              case Orientation.Left:
              case Orientation.BottomLeft:
                switch (thisClusterDirection) {
                  case Orientation.TopLeft:
                  case Orientation.Left:
                  case Orientation.BottomLeft:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
              case Orientation.TopRight:
              case Orientation.Right:
              case Orientation.BottomRight:
                switch (thisClusterDirection) {
                  case Orientation.TopRight:
                  case Orientation.Right:
                  case Orientation.BottomRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
            }
          }
        }

        let cost = node.Graph.TurnCost();
        if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
          if (thisClusterDirection === Orientation.Top || thisClusterDirection === Orientation.Bottom) {
            cost = Math.abs(cluster.Vessel.center().X - adjacentNodeReplacement.center().X);
          }
        } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
          if (thisClusterDirection === Orientation.Right || thisClusterDirection === Orientation.Left) {
            cost = Math.abs(cluster.Vessel.center().Y - adjacentNodeReplacement.center().Y);
          }
        }
        distance += cost;
      }

      if (adjacentNodeReplacement.Cluster != null) {
        const cluster = adjacentNodeReplacement.Cluster;
        if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
          edgeDir = getEdgeDirection();
          if (edgeDir === Orientation.Left || edgeDir === Orientation.Right) {
            distance += badClusterArrangementPenalty * 2;
          }
        } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
          edgeDir = getEdgeDirection();
          if (edgeDir === Orientation.Top || edgeDir === Orientation.Bottom) {
            distance += badClusterArrangementPenalty * 2;
          }
        }

        const thisClusterDirection = cluster.Vessel.orientation(nodeReplacement);
        const [firstExternalNode, secondExternalNode, exactlyTwo] = clusterExactlyTwoExternalConnectedNodes(cluster);
        if (exactlyTwo) {
          const otherClusterNode = firstExternalNode === nodeReplacement ? secondExternalNode : firstExternalNode;
          const otherClusterDirection = cluster.Vessel.orientation(otherClusterNode);

          if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
            switch (otherClusterDirection) {
              case Orientation.TopLeft:
              case Orientation.Top:
              case Orientation.TopRight:
                switch (thisClusterDirection) {
                  case Orientation.TopLeft:
                  case Orientation.Top:
                  case Orientation.TopRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
              case Orientation.BottomLeft:
              case Orientation.Bottom:
              case Orientation.BottomRight:
                switch (thisClusterDirection) {
                  case Orientation.BottomLeft:
                  case Orientation.Bottom:
                  case Orientation.BottomRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
            }
          } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
            switch (otherClusterDirection) {
              case Orientation.TopLeft:
              case Orientation.Left:
              case Orientation.BottomLeft:
                switch (thisClusterDirection) {
                  case Orientation.TopLeft:
                  case Orientation.Left:
                  case Orientation.BottomLeft:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
              case Orientation.TopRight:
              case Orientation.Right:
              case Orientation.BottomRight:
                switch (thisClusterDirection) {
                  case Orientation.TopRight:
                  case Orientation.Right:
                  case Orientation.BottomRight:
                    distance += badClusterArrangementPenalty;
                    break;
                }
                break;
            }
          }
        }

        let cost = node.Graph.TurnCost();
        if (cluster.Arrangement === 1 || cluster.Arrangement === "row" || cluster.Arrangement === "Row") {
          if (thisClusterDirection === Orientation.Top || thisClusterDirection === Orientation.Bottom) {
            cost = Math.abs(cluster.Vessel.center().X - nodeReplacement.center().X);
          }
        } else if (cluster.Arrangement === 2 || cluster.Arrangement === "column" || cluster.Arrangement === "Column") {
          if (thisClusterDirection === Orientation.Right || thisClusterDirection === Orientation.Left) {
            cost = Math.abs(cluster.Vessel.center().Y - nodeReplacement.center().Y);
          }
        }
        distance += cost;
      }
    }

    if (includeSizes && e.isBetweenTableColumns()) {
      let columnIndex = 0;
      if (e.From === nodeReplacement) {
        columnIndex = e.ToTableColumnIndex;
      } else {
        columnIndex = e.FromTableColumnIndex;
      }

      const adjEdges = adjacentNodeReplacement.Edges || [];
      for (let j = 0; j < adjEdges.length; j++) {
        const edgeErr = scoringCancellationError(ctx, j);
        if (edgeErr != null) {
          throw edgeErr;
        }
        const e2 = adjEdges[j];
        if (!e2.isBetweenTableColumns()) {
          continue;
        }
        const otherTable = adjacentNodeReplacement.adjacent(e2);
        let otherColumnIndex = 0;
        if (e2.From === otherTable) {
          otherColumnIndex = e2.ToTableColumnIndex;
        } else {
          otherColumnIndex = e2.FromTableColumnIndex;
        }

        const directionToOther = nodeReplacement.orientation(otherTable);
        let sameSide = false;
        const otherEdgeDirection = otherTable.orientation(adjacentNodeReplacement);
        edgeDir = getEdgeDirection();

        switch (edgeDir) {
          case Orientation.BottomRight:
          case Orientation.Right:
          case Orientation.TopRight:
            switch (otherEdgeDirection) {
              case Orientation.BottomRight:
              case Orientation.Right:
              case Orientation.TopRight:
                sameSide = true;
                break;
            }
            break;
          case Orientation.BottomLeft:
          case Orientation.Left:
          case Orientation.TopLeft:
            switch (otherEdgeDirection) {
              case Orientation.BottomLeft:
              case Orientation.Left:
              case Orientation.TopLeft:
                sameSide = true;
                break;
            }
            break;
        }

        if (sameSide) {
          switch (directionToOther) {
            case Orientation.TopRight:
            case Orientation.Top:
            case Orientation.TopLeft:
              if (otherColumnIndex < columnIndex) {
                distance += node.Graph.CrossingCost();
              }
              break;
            case Orientation.BottomRight:
            case Orientation.Bottom:
            case Orientation.BottomLeft:
              if (otherColumnIndex > columnIndex) {
                distance += node.Graph.CrossingCost();
              }
              break;
          }
        }
      }
    }

    distance = Math.max(distance, minGapSize);

    let outerNode = nodeReplacement;
    if (nodeReplacement.Container !== adjacentNodeReplacement.Container) {
      if (depth(nodeReplacement) > depth(adjacentNodeReplacement)) {
        outerNode = adjacentNodeReplacement;
      }
    }

    if (directionPenalty && (e.isDirected() || outerNode.containerDirection() !== Orientation.NONE)) {
      edgeDir = getEdgeDirection();
      let from = e.From;
      const [semanticFrom, , directed] = e.directedEndpoints();
      if (directed) {
        from = semanticFrom;
      }
      if (from === node) {
        edgeDir = getOpposite(edgeDir);
      }

      let directionUsed = edgeDir;
      if (nodeReplacement.Cluster != null || adjacentNodeReplacement.Cluster != null) {
        switch (direction) {
          case Orientation.Left:
            if (directionUsed === Orientation.TopLeft || directionUsed === Orientation.BottomLeft) {
              directionUsed = Orientation.Left;
            }
            break;
          case Orientation.Right:
            if (directionUsed === Orientation.TopRight || directionUsed === Orientation.BottomRight) {
              directionUsed = Orientation.Right;
            }
            break;
          case Orientation.Top:
            if (directionUsed === Orientation.TopLeft || directionUsed === Orientation.TopRight) {
              directionUsed = Orientation.Top;
            }
            break;
          case Orientation.Bottom:
            if (directionUsed === Orientation.BottomLeft || directionUsed === Orientation.BottomRight) {
              directionUsed = Orientation.Bottom;
            }
            break;
        }
      }

      let dirDelta = Math.abs(compassDelta(compass, directionCompass(directionUsed)));
      if (!e.isDirected()) {
        dirDelta = 0.1 * dirDelta + 0.9 * Math.abs(compassAxisDelta(compass, directionCompass(directionUsed)));
      }
      let baseCost = node.Graph.CellSize;
      if (!includeSizes) {
        baseCost = 1.0;
      }
      distance += directionFactor * dirDelta * baseCost * SIZELESS_DIRECTION_DELTA_FACTOR;
    }

    if (includeSizes) {
      if (e.hasLargeArrowheadLabel()) {
        edgeDir = getEdgeDirection();
        if (!isHorizontal(edgeDir)) {
          distance += 10 * node.Graph.TurnCost();
        }
      } else if (e.Label != null) {
        if (!directionPenalty || !isVertical(direction)) {
          const pairKey = `${nodeReplacement.ID}->${adjacentNodeReplacement.ID}`;
          const count = s.labeledEdgeCount?.get(pairKey) ?? 0;
          if (count > 2) {
            edgeDir = getEdgeDirection();
            if (!isHorizontal(edgeDir)) {
              distance += count * node.Graph.TurnCost();
            }
          }
        }
      }
    }

    totalDistance += distance;
  }

  if (node.Nears != null && node.Nears.size > 0) {
    let minDistanceToNear = Infinity;
    let nearIndex = 0;
    for (const near of node.Nears) {
      const err = scoringCancellationError(ctx, nearIndex);
      if (err != null) {
        throw err;
      }
      nearIndex++;
      if (near.TopLeft == null) {
        minDistanceToNear = 0;
        continue;
      }
      const dist = node.distanceTo(near, includeSizes);
      minDistanceToNear = Math.min(minDistanceToNear, dist);
    }
    totalDistance += minDistanceToNear;
  }

  if (node.HerdAssignment != null && includeSizes) {
    let d = 0.0;
    switch (node.HerdAssignment.Orientation) {
      case Orientation.Bottom:
        d = node.HerdAssignment.Val - (node.TopLeft.Y + node.Height);
        break;
      case Orientation.Top:
        d = node.TopLeft.Y - node.HerdAssignment.Val;
        break;
      case Orientation.Left:
        d = node.TopLeft.X - node.HerdAssignment.Val;
        break;
      case Orientation.Right:
        d = node.HerdAssignment.Val - (node.TopLeft.X + node.Width);
        break;
    }
    if (d >= 0) {
      totalDistance += d;
    } else {
      totalDistance -= (d - node.Graph.CellSize);
    }
  }

  const siblings = node.Graph?.CommonUncleSiblings instanceof Map
    ? node.Graph.CommonUncleSiblings.get(node)
    : node.Graph?.CommonUncleSiblings?.[node];
  if (siblings != null && siblings.length > 0) {
    const axis = axisScore(siblings);
    let cost = node.Graph.CellSize;
    if (!includeSizes) {
      cost = 1.0;
    }
    totalDistance += cost * (1.0 - axis) * (siblings.length - 1);
  }

  const finalErr = checkScoringCancellation(ctx);
  if (finalErr != null) {
    throw finalErr;
  }
  if (includeSizes) {
    totalDistance += flowContinuityCost(node, s);
  }
  return totalDistance;
}
