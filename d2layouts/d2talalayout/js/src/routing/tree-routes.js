// Slice 47 — tree edge S-shaped route geometry.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/tree_routes.go
//
// portNodes is ovg.Ports (Map<Node, OVGNode[]>); portArrowheads is a
// Map<OVGNode, Set<Arrowhead>> or null (Go nil map). Out-of-range port
// indices throw Go's runtime panic message.

import { Point } from '../geometry/point.js';
import { euclideanDistance } from '../geometry/math.js';
import { Orientation, getOpposite, isHorizontal, isVertical } from '../geometry/orientation.js';
import { nodeCenterPortIndex, nodePortIndices } from '../shape/ports.js';
import { TREE_CHILD_ALIGNMENT_TOLERANCE } from './tuning.js';
import { NewOVGNode } from './ovg-node.js';
import { nonNilEquals } from './ovg-edge.js';
import { goIndex } from './ovg-go-support.js';
import { TREE_PARENT_SPACING } from './layoutgraph-routing-support.js';

export class TreeEdgePath {
  constructor({
    SourcePortNode = null,
    TargetPortNode = null,
    SourceMidpoint = null,
    TargetMidpoint = null,
    SourceOrientationToTarget = Orientation.TopLeft,
  } = {}) {
    this.SourcePortNode = SourcePortNode;
    this.TargetPortNode = TargetPortNode;
    this.SourceMidpoint = SourceMidpoint;
    this.TargetMidpoint = TargetMidpoint;
    this.SourceOrientationToTarget = SourceOrientationToTarget;
  }
}

export function isSentinelEdgeSource(tree) {
  return tree != null && tree.SentinelEdge != null && tree.SentinelEdge.From === tree.Node;
}

/** S-shaped path information for the tree node's sentinel edge (unguarded). */
export function treeEdgePath(t, portNodes, portArrowheads) {
  return treeEdgePathForBuild(t, portNodes, portArrowheads, null);
}

/** guard (ovgBuildGuard) may be null. Throws the guard's error. */
export function treeEdgePathForBuild(t, portNodes, portArrowheads, guard) {
  const step = guard == null ? () => {} : () => guard.step();
  step();
  const parent = t.SentinelNode();
  const child = t.Node;

  const parentPortIndex = nodeCenterPortIndex(parent, t.Orientation);
  const childPortIndex = nodeCenterPortIndex(child, getOpposite(t.Orientation));
  let parentPortNode = goIndex(portNodes.get(parent), parentPortIndex);
  let childPortNode = goIndex(portNodes.get(child), childPortIndex);

  const arrowheads = portArrowheads == null ? undefined : portArrowheads.get(parentPortNode);
  if (arrowheads !== undefined) {
    // check the arrowhead on the parent
    let arrowhead = t.SentinelEdge.TargetArrowhead;
    if (!isSentinelEdgeSource(t)) {
      arrowhead = t.SentinelEdge.SourceArrowhead;
    }
    if (arrowheads.size > 0) {
      if (!arrowheads.has(arrowhead)) {
        let closestPort = null;
        let closestDistance = Infinity;
        // mismatched arrowhead: look for a different port
        for (const portIndex of nodePortIndices(parent, t.Orientation)) {
          step();
          if (portIndex === parentPortIndex) {
            continue;
          }
          let usePort = false;
          const port = goIndex(portNodes.get(parent), portIndex);
          const portSet = portArrowheads.get(port);
          if (portSet === undefined) {
            usePort = true;
          } else if (portSet.has(arrowhead)) {
            usePort = true;
          }
          if (usePort) {
            const distance = euclideanDistance(
              port.Point.X,
              port.Point.Y,
              childPortNode.X,
              childPortNode.Y,
            );
            if (distance < closestDistance) {
              closestPort = port;
              closestDistance = distance;
            }
          }
        }
        if (closestPort != null) {
          parentPortNode = closestPort;
        }
      }
    }
  }

  childPortNode = alignedPortNodeForBuild(t, parentPortNode, childPortNode, guard);
  // alignedPortNodeForBuild may synthesize a port; addTreeNodes canonicalizes
  // it into the child's port list, so resolve it here on later lookups.
  for (const portNode of portNodes.get(child) ?? []) {
    step();
    if (nonNilEquals(portNode.Point, childPortNode.Point)) {
      childPortNode = portNode;
      break;
    }
  }

  const [parentMidpoint, childMidpoint] = treeEdgeMidpoints(parent, t.Orientation, parentPortNode.Point, childPortNode.Point);

  // if we are the target, swap these around
  if (isSentinelEdgeSource(t)) {
    return new TreeEdgePath({
      SourcePortNode: childPortNode,
      TargetPortNode: parentPortNode,
      SourceMidpoint: childMidpoint,
      TargetMidpoint: parentMidpoint,
      SourceOrientationToTarget: t.Orientation,
    });
  }
  return new TreeEdgePath({
    SourcePortNode: parentPortNode,
    TargetPortNode: childPortNode,
    SourceMidpoint: parentMidpoint,
    TargetMidpoint: childMidpoint,
    SourceOrientationToTarget: getOpposite(t.Orientation),
  });
}

/** Synthesizes a parent-aligned child port for nearly aligned tree nodes. */
export function alignedPortNodeForBuild(tree, parentPort, childPort, guard) {
  const isWithinThreshold = (a, b, t) => Math.abs(a - b) <= t;
  const parent = tree.SentinelNode();
  const child = tree.Node;

  const endOfNodeBuffer = 5.0;

  // centers such as (100.5, 100) and (100, 150) are aligned up to rounding
  const nodesAreVerticallyAligned = isWithinThreshold(parent.Center().X, child.Center().X, TREE_CHILD_ALIGNMENT_TOLERANCE);
  const portsAreVerticallyMisaligned = parentPort.X !== childPort.X;
  if (isVertical(tree.Orientation) && nodesAreVerticallyAligned && portsAreVerticallyMisaligned) {
    if (child.TopLeft.X + endOfNodeBuffer < parentPort.X && parentPort.X < child.TopLeft.X + child.Width - endOfNodeBuffer) {
      if (guard != null) {
        return guard.newDerivedNode(new Point(parentPort.X, childPort.Y));
      }
      return NewOVGNode(new Point(parentPort.X, childPort.Y));
    }
  }

  const nodesAreHorizontallyAligned = isWithinThreshold(parent.Center().Y, child.Center().Y, TREE_CHILD_ALIGNMENT_TOLERANCE);
  const portsAreHorizontallyMisaligned = parentPort.Y !== childPort.Y;
  if (isHorizontal(tree.Orientation) && nodesAreHorizontallyAligned && portsAreHorizontallyMisaligned) {
    if (child.TopLeft.Y + endOfNodeBuffer < parentPort.Y && parentPort.Y < child.TopLeft.Y + child.Height - endOfNodeBuffer) {
      if (guard != null) {
        return guard.newDerivedNode(new Point(childPort.X, parentPort.Y));
      }
      return NewOVGNode(new Point(childPort.X, parentPort.Y));
    }
  }

  return childPort;
}

/**
 * treeEdgeMidpoints → [parentMidpoint, childMidpoint], the two bends of a tree
 * edge's S-shaped route, relative to the parent.
 */
export function treeEdgeMidpoints(parent, treeOrientation, parentPortPosition, childPortPosition) {
  const parentMidpoint = new Point(0, 0);
  const childMidpoint = new Point(0, 0);
  switch (treeOrientation) {
    case Orientation.Left: {
      parentMidpoint.Y = parentPortPosition.Y;
      childMidpoint.Y = childPortPosition.Y;
      const centerX = parent.TopLeft.X - TREE_PARENT_SPACING / 2;
      parentMidpoint.X = centerX;
      childMidpoint.X = centerX;
      break;
    }
    case Orientation.Right: {
      parentMidpoint.Y = parentPortPosition.Y;
      childMidpoint.Y = childPortPosition.Y;
      const centerX = parent.TopLeft.X + parent.Width + TREE_PARENT_SPACING / 2;
      parentMidpoint.X = centerX;
      childMidpoint.X = centerX;
      break;
    }
    case Orientation.Top: {
      parentMidpoint.X = parentPortPosition.X;
      childMidpoint.X = childPortPosition.X;
      const centerY = parent.TopLeft.Y - TREE_PARENT_SPACING / 2;
      parentMidpoint.Y = centerY;
      childMidpoint.Y = centerY;
      break;
    }
    case Orientation.Bottom: {
      parentMidpoint.X = parentPortPosition.X;
      childMidpoint.X = childPortPosition.X;
      const centerY = parent.TopLeft.Y + parent.Height + TREE_PARENT_SPACING / 2;
      parentMidpoint.Y = centerY;
      childMidpoint.Y = centerY;
      break;
    }
    default:
      break;
  }
  return [parentMidpoint, childMidpoint];
}
