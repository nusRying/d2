/**
 * Dejitter — micro-move nodes to straighten jittery three-segment routes.
 *
 *   .             +--------->
 *   . +-----------+
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/dejitter.go (Dejitter)
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * The boolean result is the engine's forceReroute flag
 * (internal/engine/pipeline.go: p.forceReroute, err = placement.Dejitter(...)).
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { euclideanDistance, goRound } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { GraphState } from '../graph/graph-state.js';
import {
  ErrInvalidCandidate,
  ErrNonImprovingCandidate,
  isCandidateRejection,
  restoreGraphState,
} from '../graph/transaction.js';
import { numSegments, spillsOutOf } from '../graph/structural-access.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { nodeSymmetryExport } from '../placementcost/symmetry.js';
import { JITTER_THRESHOLD, SIGN_FLIP_PADDING } from './tuning.js';

function lastIndex(points) {
  return points.length - 1;
}

function isFromVertical(otherEdge, node) {
  if (otherEdge.From === node) {
    return otherEdge.Points[0].X === otherEdge.Points[1].X;
  }
  const p = otherEdge.Points;
  return p[lastIndex(p)].X === p[lastIndex(p) - 1].X;
}

function isDiagonalRoute(otherEdge) {
  const p = otherEdge.Points;
  return p.length === 2 && p[0].X !== p[1].X && p[0].Y !== p[1].Y;
}

function countPassedThrough(g, node) {
  let count = 0;
  for (const otherEdge of g.Edges) {
    if (otherEdge.From === node || otherEdge.To === node) {
      continue;
    }
    for (let i = 0; i < otherEdge.Points.length - 1; i++) {
      if (node.PassesThrough(otherEdge.Points[i], otherEdge.Points[i + 1])) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Dejitter straightens jittery edges by moving their endpoint node by the
 * jitter delta and rewriting the incident route points in place. Atomic: a
 * stage-level graph snapshot (with edge routes) is captured before the first
 * accepted candidate and restored on any later failure or throw.
 *
 * Pinned Go: placement.Dejitter
 * @returns {boolean} dejittered (the engine's forceReroute flag). Errors throw.
 */
export function dejitter(ctx, g) {
  let guard;
  [ctx, guard] = ensureTransactionWorkGuard(ctx, 'DejitterTransactions');
  let dejittered = false;
  const [txn, txnErr] = g.NewRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }
  if (g.Nodes.length === 0) {
    return false;
  }
  let rollbackState = null;
  let complete = false;
  try {
    for (const node of g.Nodes) {
      if (node.Cluster != null) {
        continue;
      }
      // Too much trouble to have to jitter all children too
      if (node.IsContainer()) {
        continue;
      }
      if (g.NodeToTree.has(node)) {
        continue;
      }
      if (node.Sequence != null) {
        continue;
      }
      if (node.FixedTopLeft != null) {
        continue;
      }

      const prevSymmetry = nodeSymmetryExport(ctx, node, null);
      for (const edge of node.Edges) {
        // No jitter possible with less than 3 segments
        if (numSegments(edge) < 3) {
          continue;
        }
        if (node.adjacent(edge).Cluster != null) {
          continue;
        }

        let pointBeforeBends = null;
        let pointOnNode = null;
        const lastTwoBends = [];
        // Skip the first of each since it's the port
        if (edge.From === node) {
          lastTwoBends.push(edge.Points[1], edge.Points[2]);
          pointBeforeBends = edge.Points[3];
          pointOnNode = edge.Points[0];
        } else if (edge.To === node) {
          const p = edge.Points;
          lastTwoBends.push(p[p.length - 2], p[p.length - 3]);
          pointBeforeBends = p[p.length - 4];
          pointOnNode = p[p.length - 1];
        }

        // Only a jitter if the last two bends fall within threshold
        if (euclideanDistance(lastTwoBends[0].X, lastTwoBends[0].Y, lastTwoBends[1].X, lastTwoBends[1].Y) > JITTER_THRESHOLD) {
          continue;
        }

        // A vertical line moves horizontally to the second bend's X.
        const isVerticalLine = lastTwoBends[0].Y === lastTwoBends[1].Y;

        // U-turns (both neighbors of the bends on one side) are left alone.
        if (isVerticalLine) {
          if (pointBeforeBends.Y > lastTwoBends[0].Y && pointOnNode.Y > lastTwoBends[0].Y) {
            continue;
          }
          if (pointBeforeBends.Y < lastTwoBends[0].Y && pointOnNode.Y < lastTwoBends[0].Y) {
            continue;
          }
        } else {
          if (pointBeforeBends.X > lastTwoBends[0].X && pointOnNode.X > lastTwoBends[0].X) {
            continue;
          }
          if (pointBeforeBends.X < lastTwoBends[0].X && pointOnNode.X < lastTwoBends[0].X) {
            continue;
          }
        }

        if (isVerticalLine) {
          if (lastTwoBends[1].X === lastTwoBends[0].X) {
            continue;
          }
        } else if (lastTwoBends[1].Y === lastTwoBends[0].Y) {
          continue;
        }

        // ---- from here on we know it is a jitter line

        // Look for other connected edges which are straight lines
        let hasAnotherConnectedStraightEdge = false;
        for (const otherEdge of node.Edges) {
          if (otherEdge === edge) {
            continue;
          }
          if (numSegments(otherEdge) > 1) {
            continue;
          }
          const p = otherEdge.Points;
          // If the jittering one is vertical, we only look for other vertical ones
          if (otherEdge.From === node) {
            if (isVerticalLine && p[0].X === p[1].X) {
              hasAnotherConnectedStraightEdge = true;
              break;
            }
            if (!isVerticalLine && p[0].Y === p[1].Y) {
              hasAnotherConnectedStraightEdge = true;
              break;
            }
          } else {
            if (isVerticalLine && p[p.length - 1].X === p[p.length - 2].X) {
              hasAnotherConnectedStraightEdge = true;
              break;
            }
            if (!isVerticalLine && p[p.length - 1].Y === p[p.length - 2].Y) {
              hasAnotherConnectedStraightEdge = true;
              break;
            }
          }
        }
        // Don't want to move other nodes
        if (hasAnotherConnectedStraightEdge) {
          continue;
        }

        let delta;
        if (isVerticalLine) {
          delta = goRound(lastTwoBends[1].X - lastTwoBends[0].X);
        } else {
          delta = goRound(lastTwoBends[1].Y - lastTwoBends[0].Y);
        }

        // Extend delta slightly so near sign flips count as sign flips.
        const signFlipDelta = delta < 0 ? delta - SIGN_FLIP_PADDING : delta + SIGN_FLIP_PADDING;

        // A sign flip is when the moved endpoint ends up past the nearest
        // (perpendicular) or second-nearest (parallel) bend.
        let signFlip = false;
        // Map of the original edge to its closest two segments
        const newSegments = new Map();

        // The edge itself is included when it's opposite direction, as it
        // needs to be checked for new intersections as well.
        for (const otherEdge of node.Edges) {
          const isOtherEdgeVertical = isFromVertical(otherEdge, node);
          // Diagonal routes are free to move; no flips or intersections.
          if (isDiagonalRoute(otherEdge)) {
            continue;
          }
          const p = otherEdge.Points;
          const n = p.length;

          // Moving horizontally and edge vertical (move both x distance)
          if (isVerticalLine && isOtherEdgeVertical) {
            let second;
            let third;
            if (otherEdge.From === node) {
              second = 1;
              third = 2;
              newSegments.set(otherEdge, [new Point(p[0].X + delta, p[0].Y), new Point(p[1].X + delta, p[1].Y)]);
            } else {
              second = n - 2;
              third = n - 3;
              newSegments.set(otherEdge, [new Point(p[n - 1].X + delta, p[n - 1].Y), new Point(p[n - 2].X + delta, p[n - 2].Y)]);
            }
            if (otherEdge !== edge) {
              if ((p[second].X + signFlipDelta < p[third].X && p[second].X > p[third].X) ||
                (p[second].X + signFlipDelta > p[third].X && p[second].X < p[third].X)) {
                signFlip = true;
              }
            }
          }
          // Moving horizontally and edge horizontal (move closest x distance)
          if (isVerticalLine && !isOtherEdgeVertical) {
            let first;
            let second;
            if (otherEdge.From === node) {
              first = 0;
              second = 1;
              newSegments.set(otherEdge, [new Point(p[0].X + delta, p[0].Y), p[1]]);
            } else {
              first = n - 1;
              second = n - 2;
              newSegments.set(otherEdge, [new Point(p[n - 1].X + delta, p[n - 1].Y), p[n - 2]]);
            }
            if ((p[first].X + signFlipDelta < p[second].X && p[first].X > p[second].X) ||
              (p[first].X + signFlipDelta > p[second].X && p[first].X < p[second].X)) {
              signFlip = true;
            }
          }
          // Moving vertical and edge horizontal (move both y distance)
          if (!isVerticalLine && !isOtherEdgeVertical) {
            let second;
            let third;
            if (otherEdge.From === node) {
              second = 1;
              third = 2;
              newSegments.set(otherEdge, [new Point(p[0].X, p[0].Y + delta), new Point(p[1].X, p[1].Y + delta)]);
            } else {
              second = n - 2;
              third = n - 3;
              newSegments.set(otherEdge, [new Point(p[n - 1].X, p[n - 1].Y + delta), new Point(p[n - 2].X, p[n - 2].Y + delta)]);
            }
            if (otherEdge !== edge) {
              if ((p[second].Y + signFlipDelta < p[third].Y && p[second].Y > p[third].Y) ||
                (p[second].Y + signFlipDelta > p[third].Y && p[second].Y < p[third].Y)) {
                signFlip = true;
              }
            }
          }
          // Moving vertical and edge vertical (move closest y distance)
          if (!isVerticalLine && isOtherEdgeVertical) {
            let first;
            let second;
            if (otherEdge.From === node) {
              first = 0;
              second = 1;
              newSegments.set(otherEdge, [new Point(p[0].X, p[0].Y + delta), p[1]]);
            } else {
              first = n - 1;
              second = n - 2;
              newSegments.set(otherEdge, [new Point(p[n - 1].X, p[n - 1].Y + delta), p[n - 2]]);
            }
            if ((p[first].Y + signFlipDelta < p[second].Y && p[first].Y > p[second].Y) ||
              (p[first].Y + signFlipDelta > p[second].Y && p[first].Y < p[second].Y)) {
              signFlip = true;
            }
          }

          if (signFlip) {
            break;
          }
        }

        if (signFlip) {
          continue;
        }

        // Go ranges over the newSegments map (unordered) with an early break;
        // the result is a pure "any intersection" so iteration order is not
        // observable. JS uses Map insertion order.
        let intersects = false;
        for (const [segmentEdge, newSegment] of newSegments) {
          // Check for intersections on other nodes
          for (const otherNode of g.Nodes) {
            if (otherNode === node) {
              continue;
            }
            // Can intersect with a container if one endpoint is inside it
            if (segmentEdge.From.isDescendantOf(otherNode)) {
              continue;
            }
            if (segmentEdge.To.isDescendantOf(otherNode)) {
              continue;
            }
            // It can touch the node it's connected to
            if (otherNode !== segmentEdge.To && otherNode !== segmentEdge.From &&
              otherNode.PassesThrough(newSegment[0], newSegment[1])) {
              intersects = true;
              break;
            }
          }
          if (intersects) {
            break;
          }
        }
        if (intersects) {
          continue;
        }

        // ---- no object intersection is introduced; safe to shift

        const numEdgesPassedThrough = countPassedThrough(g, node);

        if (rollbackState == null) {
          const state = new GraphState({ CaptureEdgeRoutes: true });
          state.updateWithWorkGuard(g, guard);
          rollbackState = state;
        }

        txn.AddOp(() => {
          // Tentatively commit the node
          if (isVerticalLine) {
            node.TopLeft.X += delta;
          } else {
            node.TopLeft.Y += delta;
          }

          const newNumEdgesPassedThrough = countPassedThrough(g, node);

          let currSymmetry;
          try {
            currSymmetry = nodeSymmetryExport(ctx, node, null);
          } catch (err) {
            // Go returns NodeSymmetry's error from the op.
            return err;
          }
          if (newNumEdgesPassedThrough > numEdgesPassedThrough) {
            return ErrNonImprovingCandidate;
          } else if (node.Container != null && spillsOutOf(node, node.Container)) {
            return ErrInvalidCandidate;
          } else if (currSymmetry < prevSymmetry) {
            return ErrNonImprovingCandidate;
          }
          return null;
        });

        const commitErr = txn.Commit(ctx);
        if (commitErr != null) {
          txn.Clear();
          if (isCandidateRejection(commitErr)) {
            continue;
          }
          throw commitErr;
        }
        const stateErr = txn.UpdateState();
        if (stateErr != null) {
          throw stateErr;
        }
        txn.Clear();

        // ---- jittering this node adds no route intersections

        // Commit new segments
        for (const otherEdge of node.Edges) {
          const isOtherEdgeVertical = isFromVertical(otherEdge, node);
          const p = otherEdge.Points;
          const n = p.length;
          // A diagonal route only moves its endpoint on the moved node.
          if (isDiagonalRoute(otherEdge)) {
            if (isVerticalLine) {
              if (otherEdge.From === node) {
                p[0].X += delta;
              } else {
                p[n - 1].X += delta;
              }
            } else if (otherEdge.From === node) {
              p[0].Y += delta;
            } else {
              p[n - 1].Y += delta;
            }
          } else {
            // Moving horizontally and edge vertical (move both x distance)
            if (isVerticalLine && isOtherEdgeVertical) {
              if (otherEdge.From === node) {
                p[0].X += delta;
                p[1].X += delta;
              } else {
                p[n - 1].X += delta;
                p[n - 2].X += delta;
              }
            }
            // Moving horizontally and edge horizontal (move closest x distance)
            if (isVerticalLine && !isOtherEdgeVertical) {
              if (otherEdge.From === node) {
                p[0].X += delta;
              } else {
                p[n - 1].X += delta;
              }
            }
            // Moving vertical and edge horizontal (move both y distance)
            if (!isVerticalLine && !isOtherEdgeVertical) {
              if (otherEdge.From === node) {
                p[0].Y += delta;
                p[1].Y += delta;
              } else {
                p[n - 1].Y += delta;
                p[n - 2].Y += delta;
              }
            }
            // Moving vertical and edge vertical (move closest y distance)
            if (!isVerticalLine && isOtherEdgeVertical) {
              if (otherEdge.From === node) {
                p[0].Y += delta;
              } else {
                p[n - 1].Y += delta;
              }
            }
          }
        }

        // Remove the two defunct points corresponding to the old bends. Go
        // appends into the same backing array, so the route array identity is
        // kept and shortened in place.
        if (edge.From === node) {
          // This should remove 1 and 2
          edge.Points.splice(1, 2);
        } else {
          edge.Points.splice(edge.Points.length - 3, 2);
        }
        dejittered = true;
      }
    }
    if (dejittered) {
      guard.Finish();
    }
    complete = true;
    return dejittered;
  } finally {
    if (rollbackState != null && !complete) {
      restoreGraphState(g, rollbackState);
    }
  }
}

export const Dejitter = dejitter;
