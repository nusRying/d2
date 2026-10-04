// Slice 47 — hierarchy (SQL-table style) OVG construction.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_hierarchy.go
//
// Go's (*OVG) methods from this file are free functions taking the OVG first;
// OVG delegates to them. Go's deferred inverse transforms run in a finally
// block in reverse registration order, on success and on error, exactly as the
// Go defers do. Hierarchy.Levels() and the per-level grouping iterate JS Map
// insertion order (Go: unspecified); every level list is then sorted.

import { Point } from '../geometry/point.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { Orientation } from '../geometry/orientation.js';
import { isHorizontal as hierarchyIsHorizontal } from '../hierarchy/orientation.js';
import { transposeNode } from '../hierarchy/layoutgraph-support.js';
import { hierarchyLevel, mirrorNode } from '../graph/structural-access.js';
import { OVG_PADDING } from './tuning.js';
import { portDirectionSetTransformed } from './ovg-node.js';
import { newBuildOVG } from './ovg.js';
import { GoFloatMap, goFloatToInt, goIndex, goSortSlice, mapAppend } from './ovg-go-support.js';
import { edgeIsLoop } from './layoutgraph-routing-support.js';

function compareIDs(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * newOVGForHierarchy builds the OVG for one hierarchy (Top→Bottom,
 * Left→Right frame). Ports are added before any transpose because transposing
 * changes node sizes and therefore snap point positions.
 */
export function newOVGForHierarchy(g, h, guard) {
  guard.check();
  const levels = h.Levels();
  const nodes = [];
  for (const n of levels.keys()) {
    guard.step();
    nodes.push(n);
  }
  guard.reserveSortWork(nodes.length);
  // slices.SortFunc by cmp.Compare(ID): entity IDs are unique.
  nodes.sort((a, b) => compareIDs(a.ID, b.ID));
  guard.check();

  const ovg = newBuildOVG(nodes, guard);
  ovg.addPorts(g, guard);

  const restores = [];
  try {
    // Left/Top hierarchies are mirrored for construction and mirrored back.
    switch (goIndex(nodes, 0).ContainerDirection()) {
      case Orientation.Left: {
        guard.reserveHierarchyTransform(ovg, nodes.length);
        for (const node of nodes) {
          mirrorNode(node, true, false);
        }
        transformHierarchyOVGNodes(ovg, (node) => {
          node.X = -node.X;
        }, (direction) => mirrorPortDirection(direction, true, false));
        restores.push(() => {
          for (const node of nodes) {
            mirrorNode(node, true, false);
          }
          transformHierarchyOVGNodes(ovg, (node) => {
            node.X = -node.X;
          }, (direction) => mirrorPortDirection(direction, true, false));
        });
        guard.check();
        break;
      }
      case Orientation.Top: {
        guard.reserveHierarchyTransform(ovg, nodes.length);
        for (const node of nodes) {
          mirrorNode(node, false, true);
        }
        transformHierarchyOVGNodes(ovg, (node) => {
          node.Y = -node.Y;
        }, (direction) => mirrorPortDirection(direction, false, true));
        restores.push(() => {
          for (const node of nodes) {
            mirrorNode(node, false, true);
          }
          transformHierarchyOVGNodes(ovg, (node) => {
            node.Y = -node.Y;
          }, (direction) => mirrorPortDirection(direction, false, true));
        });
        guard.check();
        break;
      }
      default:
        break;
    }

    // Horizontal hierarchies are transposed to vertical for construction.
    guard.reserveWork(nodes.length);
    const isHorizontalHierarchy = hierarchyIsHorizontal(nodes);
    if (isHorizontalHierarchy) {
      guard.reserveHierarchyTransform(ovg, (ovg.NodesInsideBoundingBox ?? []).length);
      transposeOVG(ovg);
      restores.push(() => {
        transposeOVG(ovg);
      });
      guard.check();
    }

    ovg.addNodesIntersections(g, guard);
    addHierarchyLevelNodes(ovg, g, h, guard);
    const [tl, br] = guard.ovgBoundingBox(ovg);
    ovg.addNewBoundaryLayers(g, tl, br, guard);
    ovg.addCornerNodes(g, tl, br, guard);
    guard.check();

    return ovg;
  } finally {
    for (let i = restores.length - 1; i >= 0; i--) {
      restores[i]();
    }
  }
}

export function addHierarchyLevelNodes(ovg, g, hierarchy, guard) {
  guard.check();
  const levelToNodes = new Map();
  for (const [n, level] of hierarchy.Levels()) {
    guard.step();
    mapAppend(levelToNodes, level, n);
  }
  for (let level = 0; level < levelToNodes.size; level++) {
    guard.step();
    const levelNodes = levelToNodes.get(level) ?? [];
    guard.reserveSortWork(levelNodes.length);
    goSortSlice(levelNodes, (a, b) => a.TopLeft.X < b.TopLeft.X);
  }
  const [tl, br] = guard.ovgBoundingBox(ovg);
  // Align the bounds to ovgPadding so OVG nodes line up across levels, with
  // one interval before the first node and one after the last.
  tl.X -= OVG_PADDING;
  tl.X = Math.floor(tl.X / OVG_PADDING) * OVG_PADDING;
  const width = Math.ceil((br.X - tl.X) / OVG_PADDING) * OVG_PADDING;
  br.X = tl.X + width + OVG_PADDING;
  const ys = new GoFloatMap();
  for (let level = 1; level < levelToNodes.size; level++) {
    guard.step();
    const levelYs = addBoundaryNodesAboveLevelNodes(ovg, levelToNodes.get(level - 1) ?? [], levelToNodes.get(level) ?? [], tl.X, br.X, guard);
    addPortAlignedNodes(ovg, levelToNodes.get(level - 1) ?? [], levelToNodes.get(level) ?? [], levelYs, guard);
    for (const y of levelYs) {
      ys.set(y, true);
    }
  }

  const xs = addLevelNodes(ovg, levelToNodes, tl.X, br.X, guard);
  ovg.addIntersections(g, xs, ys, guard);
}

/**
 * addBoundaryNodesAboveLevelNodes adds nodes between two levels at the
 * left/right OVG boundaries. → the added Y coordinates.
 */
export function addBoundaryNodesAboveLevelNodes(ovg, nodesAbove, nodesBelow, leftX, rightX, guard) {
  guard.check();
  let nodesBelowMinY = Infinity;
  let nEdgesAbove = 1.0;
  for (const node of nodesBelow) {
    guard.step();
    // top is the closest to 0, 0 in SVG space
    nodesBelowMinY = goMin(nodesBelowMinY, node.TopLeft.Y);
    for (const e of node.Edges) {
      guard.step();
      const adj = node.Adjacent(e);
      if (edgeIsLoop(e) || adj.Hierarchy == null) {
        // hierarchical nodes may connect to nodes outside the hierarchy
        continue;
      }
      if (hierarchyLevel(adj) < hierarchyLevel(node)) {
        nEdgesAbove++;
      }
    }
  }

  let nodesAboveMaxY = -Infinity;
  for (const node of nodesAbove) {
    guard.step();
    nodesAboveMaxY = goMax(nodesAboveMaxY, node.TopLeft.Y + node.Height);
  }

  const levelDistance = (nodesBelowMinY - nodesAboveMaxY);
  const maxHorizontalLines = levelDistance / OVG_PADDING;
  const nHorizontalLines = goMin(nEdgesAbove, maxHorizontalLines);
  let pad = Math.ceil(levelDistance / nHorizontalLines);
  pad = goMax(pad, OVG_PADDING);

  // horizontal lines above `nodesBelow`
  const ys = [];
  let y = nodesBelowMinY;
  const lineCount = goFloatToInt(nHorizontalLines) - 1;
  for (let i = 0; i < lineCount; i++) {
    guard.step();
    y -= pad;
    ys.push(y);
    guard.addPoint(ovg, new Point(leftX, y));
    guard.addPoint(ovg, new Point(rightX, y));
  }
  guard.check();
  return ys;
}

/** addPortAlignedNodes adds port-aligned nodes at the given level Ys. */
export function addPortAlignedNodes(ovg, nodesAbove, nodesBelow, ys, guard) {
  guard.check();
  for (const y of ys ?? []) {
    guard.step();
    for (const node of nodesAbove) {
      guard.step();
      for (const port of guard.portsByOrientation(ovg, node, Orientation.Bottom)) {
        guard.addPoint(ovg, new Point(port.X, y));
      }
    }
    for (const node of nodesBelow) {
      guard.step();
      for (const port of guard.portsByOrientation(ovg, node, Orientation.Top)) {
        guard.addPoint(ovg, new Point(port.X, y));
      }
    }
  }
  guard.check();
}

/**
 * addLevelNodes creates port-aligned nodes between ordered siblings.
 * → GoFloatMap set of the X coordinates used.
 */
export function addLevelNodes(ovg, levelToNodes, minXBound, maxXBound, guard) {
  guard.check();
  const xs = new GoFloatMap();
  for (let l = 0; l < levelToNodes.size; l++) {
    guard.step();
    let isLastNode = false;
    let ni = 0;
    const levelNodes = levelToNodes.get(l);
    let node = goIndex(levelNodes, ni);
    let ports = guard.portsByOrientation(ovg, node, Orientation.Left);
    for (let x = minXBound; x <= maxXBound; x += OVG_PADDING) {
      guard.step();
      xs.set(x, true);
      for (const port of ports) {
        guard.addPoint(ovg, new Point(x, port.Y));
      }
      if (!isLastNode && x >= node.TopLeft.X - OVG_PADDING) {
        // continue at the next X aligned with the common OVG nodes
        const nextX = node.TopLeft.X + node.Width;
        x = Math.ceil(nextX / OVG_PADDING) * OVG_PADDING;
        // now use the ports on the right of this node
        ports = guard.portsByOrientation(ovg, node, Orientation.Right);
        isLastNode = ni === levelNodes.length - 1;
        if (!isLastNode) {
          // a node to the right contributes its left ports too
          ni++;
          node = levelNodes[ni];
          const leftPorts = guard.portsByOrientation(ovg, node, Orientation.Left);
          ports = ports.concat(leftPorts);
        }
      }
    }
  }
  guard.check();
  return xs;
}

/**
 * (*OVG).transpose: transposes each canonical OVG point and each owner's
 * direction set once (Ports may list a shared point several times), then the
 * bounding-box graph nodes.
 */
export function transposeOVG(ovg) {
  transformHierarchyOVGNodes(ovg, (node) => {
    const x = node.X;
    node.X = node.Y;
    node.Y = x;
  }, transposePortDirection);
  for (const node of ovg.NodesInsideBoundingBox ?? []) {
    transposeNode(node);
  }
}

export function transformHierarchyOVGNodes(ovg, transformPoint, transformDirection) {
  for (const node of ovg.Nodes) {
    transformPoint(node);
    for (const [owner, metadata] of node.portOwners()) {
      node.setPortDirections(owner, portDirectionSetTransformed(metadata.directions, transformDirection));
    }
  }
  ovg.reindexOccupiedPoints();
}

export function transposePortDirection(direction) {
  switch (direction) {
    case Orientation.Top:
      return Orientation.Left;
    case Orientation.Bottom:
      return Orientation.Right;
    case Orientation.Left:
      return Orientation.Top;
    case Orientation.Right:
      return Orientation.Bottom;
    case Orientation.TopRight:
      return Orientation.BottomLeft;
    case Orientation.BottomLeft:
      return Orientation.TopRight;
    default:
      return direction;
  }
}

export function mirrorPortDirection(direction, x, y) {
  if (x) {
    switch (direction) {
      case Orientation.Left:
        direction = Orientation.Right;
        break;
      case Orientation.Right:
        direction = Orientation.Left;
        break;
      case Orientation.TopLeft:
        direction = Orientation.TopRight;
        break;
      case Orientation.TopRight:
        direction = Orientation.TopLeft;
        break;
      case Orientation.BottomLeft:
        direction = Orientation.BottomRight;
        break;
      case Orientation.BottomRight:
        direction = Orientation.BottomLeft;
        break;
      default:
        break;
    }
  }
  if (y) {
    switch (direction) {
      case Orientation.Top:
        direction = Orientation.Bottom;
        break;
      case Orientation.Bottom:
        direction = Orientation.Top;
        break;
      case Orientation.TopLeft:
        direction = Orientation.BottomLeft;
        break;
      case Orientation.TopRight:
        direction = Orientation.BottomRight;
        break;
      case Orientation.BottomLeft:
        direction = Orientation.TopLeft;
        break;
      case Orientation.BottomRight:
        direction = Orientation.TopRight;
        break;
      default:
        break;
    }
  }
  return direction;
}
