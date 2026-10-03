import { Box } from '../geometry/box.js';
import { euclideanDistance, goRound, truncateDecimals } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { Orientation, orientationToString, getOpposite } from '../geometry/orientation.js';
import { Icon } from './icon.js';
import { LABEL_PADDING, isOutsideLabelPosition, getPointOnBox } from './label-position.js';
import { nodesLeftmost, nodesTopmost, nodesRightmost, nodesBottommost, nodesFixedBounds } from './node-bounds.js';
import { shapeGetInnerBox, shapeGetInsidePlacement, shapeGetDimensionsToFit } from '../shape/inner-geometry.js';
import { ancestryParent } from './topology-preflight.js';

function getPaddingValues(padding) {
  if (!padding) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  const top = typeof padding.Top === 'function' ? padding.Top() : (padding.top ?? padding.Top ?? 0);
  const bottom = typeof padding.Bottom === 'function' ? padding.Bottom() : (padding.bottom ?? padding.Bottom ?? 0);
  const left = typeof padding.Left === 'function' ? padding.Left() : (padding.left ?? padding.Left ?? 0);
  const right = typeof padding.Right === 'function' ? padding.Right() : (padding.right ?? padding.Right ?? 0);
  return { top, bottom, left, right };
}

function getLoopOffset(node, orientation) {
  const offsets = node.LoopOffsets;
  if (!offsets) return 0;
  if (offsets instanceof Map) {
    if (offsets.has(orientation)) return offsets.get(orientation);
    const name = orientationToString(orientation);
    if (name && offsets.has(name)) return offsets.get(name);
    return 0;
  }
  if (typeof offsets === "object") {
    if (offsets[orientation] !== undefined) return offsets[orientation];
    const name = orientationToString(orientation);
    if (name && offsets[name] !== undefined) return offsets[name];
    if (name && offsets[name.toLowerCase()] !== undefined) return offsets[name.toLowerCase()];
    return 0;
  }
  return 0;
}

function nodeSpacingSide(node, side) {
  const spacing = node?._margin ?? node?.margin ?? null;
  if (spacing == null) return 0;
  const value = spacing[side] ?? spacing[side[0].toUpperCase() + side.slice(1)] ?? 0;
  return Number(value) || 0;
}

function boxesOverlapWithPadding(b1, b2, padding) {
  const b1Right = b1.TopLeft.X + b1.Width;
  const b2Right = b2.TopLeft.X + b2.Width;
  if (b1.TopLeft.X >= b2Right + padding || b2.TopLeft.X >= b1Right + padding) {
    return false;
  }
  const b1Bottom = b1.TopLeft.Y + b1.Height;
  const b2Bottom = b2.TopLeft.Y + b2.Height;
  return b1.TopLeft.Y < b2Bottom + padding && b2.TopLeft.Y < b1Bottom + padding;
}

function intervalGap(aStart, aEnd, bStart, bEnd) {
  if (aEnd < bStart) {
    return bStart - aEnd;
  }
  if (bEnd < aStart) {
    return aStart - bEnd;
  }
  return 0;
}

function distanceBetweenBoxes(b1, b2) {
  const dx = intervalGap(b1.TopLeft.X, b1.TopLeft.X + b1.Width, b2.TopLeft.X, b2.TopLeft.X + b2.Width);
  const dy = intervalGap(b1.TopLeft.Y, b1.TopLeft.Y + b1.Height, b2.TopLeft.Y, b2.TopLeft.Y + b2.Height);
  return euclideanDistance(0, 0, dx, dy);
}

function nodeDistanceBox(node, includeSize) {
  const box = { TopLeft: node.TopLeft, Width: 0, Height: 0 };
  if (includeSize) {
    box.Width = node.Width;
    box.Height = node.Height;
  }
  return box;
}

export function sortNodesByID(nodes) {
  nodes.sort((a, b) => {
    const aID = BigInt(a.ID);
    const bID = BigInt(b.ID);
    if (aID < bID) return -1;
    if (aID > bID) return 1;
    return 0;
  });
  return nodes;
}

export const RECOGNIZED_SHAPES = new Set([
  "",
  "Callout",
  "Circle",
  "Cloud",
  "Cylinder",
  "Diamond",
  "Document",
  "Hexagon",
  "Image",
  "Oval",
  "Package",
  "Page",
  "Parallelogram",
  "Person",
  "C4Person",
  "Queue",
  "RealSquare",
  "Square",
  "Step",
  "StoredData",
  "Text",
  "Class",
  "Table",
  "Code",
]);

function crossProductTurn(p, q, r) {
  const pqX = q.X - p.X;
  const pqY = q.Y - p.Y;
  const prX = r.X - p.X;
  const prY = r.Y - p.Y;
  return pqY * prX - pqX * prY;
}

function closedIntervalsOverlap(a1, a2, b1, b2) {
  const aMin = Math.min(a1, a2);
  const aMax = Math.max(a1, a2);
  const bMin = Math.min(b1, b2);
  const bMax = Math.max(b1, b2);
  return aMin <= bMax && bMin <= aMax;
}

function straddlesLine(side1, side2) {
  return side1 === 0 || side2 === 0 || (side1 < 0) !== (side2 < 0);
}

function segmentsIntersect(p1, q1, p2, q2) {
  const p2Side = crossProductTurn(p1, q1, p2);
  const q2Side = crossProductTurn(p1, q1, q2);
  const p1Side = crossProductTurn(p2, q2, p1);
  const q1Side = crossProductTurn(p2, q2, q1);

  if (p2Side === 0 && q2Side === 0 && p1Side === 0 && q1Side === 0) {
    return closedIntervalsOverlap(p1.X, q1.X, p2.X, q2.X) &&
      closedIntervalsOverlap(p1.Y, q1.Y, p2.Y, q2.Y);
  }

  return straddlesLine(p2Side, q2Side) && straddlesLine(p1Side, q1Side);
}

function segmentIntersectsBox(p1, p2, box) {
  if (p1 == null || p2 == null || box == null || box.TopLeft == null) {
    return false;
  }

  let left = box.TopLeft.X;
  let right = box.TopLeft.X + box.Width;
  if (left > right) {
    const tmp = left;
    left = right;
    right = tmp;
  }
  let top = box.TopLeft.Y;
  let bottom = box.TopLeft.Y + box.Height;
  if (top > bottom) {
    const tmp = top;
    top = bottom;
    bottom = tmp;
  }
  if (Number.isNaN(left) || Number.isNaN(right) || Number.isNaN(top) || Number.isNaN(bottom)) {
    return false;
  }

  if ((p1.X < left && p2.X < left) || (p1.X > right && p2.X > right) ||
    (p1.Y < top && p2.Y < top) || (p1.Y > bottom && p2.Y > bottom)) {
    return false;
  }

  const contains = (p) => left <= p.X && p.X <= right && top <= p.Y && p.Y <= bottom;
  if (contains(p1) || contains(p2)) {
    return true;
  }

  let tEnter = 0.0;
  let tExit = 1.0;
  const clipAxis = (start, delta, minCoord, maxCoord) => {
    if (delta === 0) {
      return minCoord <= start && start <= maxCoord;
    }
    let t1 = (minCoord - start) / delta;
    let t2 = (maxCoord - start) / delta;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
    return tEnter <= tExit;
  };

  if (!clipAxis(p1.X, p2.X - p1.X, left, right) ||
    !clipAxis(p1.Y, p2.Y - p1.Y, top, bottom)) {
    return false;
  }
  return tEnter < tExit;
}

export class Node {
  constructor(id, width = 0, height = 0) {
    this.ID = id;
    this.D2ID = null;

    // Geometry embedded as a persistent Box
    this.Box = new Box(null, width, height);

    this.FixedTopLeft = null;
    this.DesiredWidth = null;
    this.DesiredHeight = null;

    this.Graph = null;
    this.Container = null;
    this.isContainer = false;
    this.isClusterVessel = false;

    this.Edges = [];
    this.Nears = new Set();

    this.Cluster = null;
    this.Sequence = null;
    this.Hierarchy = null;
    this.HerdAssignment = null;
    this.LoopOffsets = null;
    this.LongDistanceNeighborRequirements = null;
    this._margin = { top: 0, right: 0, bottom: 0, left: 0 };
    this._padding = { top: 0, right: 0, bottom: 0, left: 0 };
    this.elkData = null;

    this.FontSize = null;
    this.Label = null;
    this.Icon = null;

    this.ForceHierarchy = false;
    this.Is3D = false;
    this.IsMultiple = false;
    this.IsInvisible = false;

    this._shapeType = "";
    this._numColumns = 0;
  }

  get TopLeft() { return this.Box.TopLeft; }
  set TopLeft(v) { this.Box.TopLeft = v; }
  get Width() { return this.Box.Width; }
  set Width(v) { this.Box.Width = v; }
  get Height() { return this.Box.Height; }
  set Height(v) { this.Box.Height = v; }

  entityID() {
    return this.ID;
  }

  box() {
    return this.Box;
  }

  setClusterVessel(value) {
    this.isClusterVessel = Boolean(value);
  }

  SetClusterVessel(value) {
    this.setClusterVessel(value);
  }

  unmarkClusterVessel() {
    this.isClusterVessel = false;
  }

  UnmarkClusterVessel() {
    this.unmarkClusterVessel();
  }

  initIcon() {
    this.Icon = new Icon();
  }

  InitIcon() {
    this.initIcon();
  }

  addEdge(edge) {
    this.Edges.push(edge);
  }

  removeEdge(edge) {
    const idx = this.Edges.indexOf(edge);
    if (idx !== -1) {
      this.Edges.splice(idx, 1);
    }
  }

  addNear(otherN) {
    if (!this || !otherN || this === otherN) return;
    this.Nears.add(otherN);
    otherN.Nears.add(this);
  }

  AddNear(otherN) {
    this.addNear(otherN);
  }

  orderedNears() {
    const nears = Array.from(this.Nears);
    return sortNodesByID(nears);
  }

  OrderedNears() {
    return this.orderedNears();
  }

  IsClusterVessel() {
    return Boolean(this.isClusterVessel);
  }

  isMajorityTarget() {
    let counter = 0;
    for (const e of this.Edges) {
      if (e.isDirected()) {
        if (e.isTargetedTo(this)) {
          counter++;
        } else {
          counter--;
        }
      }
    }
    return counter > 0;
  }

  IsMajorityTarget() {
    return this.isMajorityTarget();
  }

  allReachableNodesGuarded(includeContainers, includeNears, traverseTrees, ignore, guard) {
    return this.reachableNodesGuarded(
      () => true,
      includeContainers,
      includeNears,
      traverseTrees,
      ignore,
      guard
    );
  }

  AllReachableNodesContext(includeContainers, includeNears, traverseTrees, ignore, guard) {
    return this.allReachableNodesGuarded(
      includeContainers,
      includeNears,
      traverseTrees,
      ignore,
      guard
    );
  }

  reachableNodesGuarded(shouldVisit, includeContainers, includeNears, traverseTrees, ignore, guard) {
    const reachableNodes = [];
    const visitQueue = [this];
    const reachedOrVisited = new Set([this]);

    const queue = (n) => {
      if (ignore != null) {
        if (ignore instanceof Set || ignore instanceof Map) {
          if (ignore.has(n)) return;
        } else if (ignore[n] !== undefined) {
          return;
        }
      }
      if (reachedOrVisited.has(n)) return;
      if (!shouldVisit(n)) return;
      reachedOrVisited.add(n);
      visitQueue.push(n);
    };

    while (visitQueue.length > 0) {
      guard.Step();
      const curr = visitQueue.shift();
      let includeNode = true;
      if (traverseTrees) {
        const nodeToTree = this.Graph.NodeToTree;
        if (nodeToTree && (nodeToTree.has ? nodeToTree.has(curr) : nodeToTree[curr] !== undefined)) {
          includeNode = false;
        }
      }
      if (includeNode) {
        reachableNodes.push(curr);
      }
      reachedOrVisited.add(curr);

      for (const e of curr.Edges) {
        guard.Step();
        const adjacentNode = curr.adjacent(e);
        queue(adjacentNode);
      }

      if (traverseTrees) {
        const trees = this.Graph.Trees.get ? this.Graph.Trees.get(curr) : this.Graph.Trees[curr];
        if (trees != null) {
          for (const tree of trees) {
            guard.Step();
            queue(tree.Node);
          }
        } else if (this.Graph.NodeToTree && (this.Graph.NodeToTree.has ? this.Graph.NodeToTree.has(curr) : this.Graph.NodeToTree[curr] !== undefined)) {
          const tree = this.Graph.NodeToTree.get ? this.Graph.NodeToTree.get(curr) : this.Graph.NodeToTree[curr];
          if (tree.Parent != null) {
            queue(tree.Parent.Node);
          } else {
            queue(tree.sentinelNode());
          }
          if (tree.Children) {
            for (const c of tree.Children) {
              guard.Step();
              queue(c.Node);
            }
          }
        }
      }

      if (includeNears) {
        let nears = curr.orderedNears();
        if (curr.isClusterVessel) {
          const cluster = this.Graph.Clusters.get ? this.Graph.Clusters.get(curr) : this.Graph.Clusters[curr];
          for (const cn of cluster.Nodes) {
            nears = nears.concat(cn.orderedNears());
          }
        }
        for (let near of nears) {
          guard.Step();
          if (near.Cluster && (typeof near.Cluster.IsActive === 'function' ? near.Cluster.IsActive() : near.Cluster.isActive())) {
            near = near.Cluster.Vessel;
          } else if (near.Sequence && (typeof near.Sequence.IsActive === 'function' ? near.Sequence.IsActive() : near.Sequence.isActive())) {
            near = near.Sequence.Vessel;
          }
          if (near.Container !== this.Container) {
            continue;
          }
          queue(near);
        }
      }

      if (includeContainers) {
        if (curr.Sequence != null) {
          for (const step of curr.Sequence.Nodes) {
            guard.Step();
            queue(step);
          }
        }
        if (curr.isClusterVessel) {
          const cluster = this.Graph.Clusters.get ? this.Graph.Clusters.get(curr) : this.Graph.Clusters[curr];
          for (const cNode of cluster.Nodes) {
            guard.Step();
            queue(cNode);
          }
        }

        for (const otherNode of this.Graph.Nodes) {
          guard.Step();
          if (reachedOrVisited.has(otherNode)) {
            continue;
          }
          let isDescendant = reachabilityIsDescendantOf(curr, otherNode, guard);
          if (!isDescendant) {
            isDescendant = reachabilityIsDescendantOf(otherNode, curr, guard);
          }
          if (isDescendant) {
            queue(otherNode);
          }
        }
      }
    }
    return reachableNodes;
  }

  ReachableNodesContext(shouldVisit, includeContainers, includeNears, traverseTrees, ignore, guard) {
    return this.reachableNodesGuarded(
      shouldVisit,
      includeContainers,
      includeNears,
      traverseTrees,
      ignore,
      guard
    );
  }

  setShape(shapeType) {
    // Go SetShape() only changes shape when nodeshape.New() returns ok=true.
    // For unsupported non-empty shape types, preserve the existing shape.
    if (RECOGNIZED_SHAPES.has(shapeType)) {
      this._shapeType = shapeType;
    }
  }

  SetShape(shapeType) {
    this.setShape(shapeType);
  }

  shapeType() {
    return this._shapeType;
  }

  ShapeType() {
    return this.shapeType();
  }

  shapeKind() {
    if (this._shapeType === "") {
      return "Square";
    }
    return this._shapeType;
  }

  isTable() {
    return this._shapeType === "Table";
  }

  IsTable() {
    return this.isTable();
  }

  isClass() {
    return this._shapeType === "Class";
  }

  IsClass() {
    return this.isClass();
  }

  isSequenceStep() {
    return this._shapeType === "Step";
  }

  IsSequenceStep() {
    return this.isSequenceStep();
  }

  aspectRatio1() {
    return this._shapeType === "Circle" || this._shapeType === "RealSquare";
  }

  AspectRatio1() {
    return this.aspectRatio1();
  }

  sameShape(other) {
    if (other === null || other === undefined) {
      return false;
    }
    return this._shapeType === other._shapeType;
  }

  SameShape(other) {
    return this.sameShape(other);
  }

  distanceTo(other, includeSizes) {
    return distanceBetweenBoxes(nodeDistanceBox(this, includeSizes), nodeDistanceBox(other, includeSizes));
  }

  DistanceTo(other, includeSizes) {
    return this.distanceTo(other, includeSizes);
  }

  setNumColumns(n) {
    this._numColumns = n;
  }

  SetNumColumns(n) {
    this.setNumColumns(n);
  }

  numColumns() {
    return this._numColumns;
  }

  NumColumns() {
    return this.numColumns();
  }

  adjacent(edge) {
    // Pinned to Go node.adjacent: returns edge.From as the fallback when this
    // node is neither endpoint. This tolerates malformed adjacency inventories
    // that cluster/sequence discovery relies on during edge scanning.
    if (this === edge.From) return edge.To;
    return edge.From;
  }

  Adjacent(edge) {
    return this.adjacent(edge);
  }

  owningContainer() {
    if (this.Cluster != null && this.Cluster.isActive()) {
      return this.Cluster.Vessel.Container;
    }
    if (this.Sequence != null && this.Sequence.isActive()) {
      return this.Sequence.Vessel.Container;
    }
    return this.Container;
  }

  OwningContainer() {
    return this.owningContainer();
  }

  container() {
    return this.owningContainer();
  }

  level() {
    if (this === null || this === undefined) {
      return 0;
    }
    if (this.Cluster != null && this.Cluster.isActive()) {
      return this.Cluster.Vessel.level();
    }
    if (this.Sequence != null && this.Sequence.isActive()) {
      return this.Sequence.Vessel.level();
    }
    if (this.Container === null || this.Container === undefined) {
      return 1;
    }
    return 1 + this.Container.level();
  }

  Level() {
    return this.level();
  }

  isDescendantOf(maybeAncestor) {
    if (maybeAncestor === this) {
      return true;
    }
    if (this.Container != null) {
      return this.Container.isDescendantOf(maybeAncestor);
    }
    if (this.Cluster != null) {
      return this.Cluster.Vessel.isDescendantOf(maybeAncestor);
    }
    if (this.Sequence != null) {
      return this.Sequence.Vessel.isDescendantOf(maybeAncestor);
    }
    return maybeAncestor == null;
  }

  IsDescendantOf(maybeAncestor) {
    return this.isDescendantOf(maybeAncestor);
  }

  rdfsWalk(applyFunc) {
    if (this.isContainer) {
      const children = this.Graph.Containers.get(this) ?? [];
      for (const child of children) {
        child.rdfsWalk(applyFunc);
      }
    }

    if (this.isClusterVessel) {
      const cluster = this.Graph.Clusters.get(this);
      for (const cn of cluster.Nodes) {
        cn.rdfsWalk(applyFunc);
      }
    } else {
      const sequence = this.Graph.Sequences.get(this);
      if (sequence !== undefined) {
        for (const step of sequence.Nodes) {
          step.rdfsWalk(applyFunc);
        }
      }
    }

    applyFunc(this);
  }

  WalkRDFS(applyFunc) {
    this.rdfsWalk(applyFunc);
  }

  connectionTo(node) {
    for (const edge of this.Edges) {
      if (this.adjacent(edge) === node) {
        return edge;
      }
    }
    return null;
  }

  ConnectionTo(node) {
    return this.connectionTo(node);
  }

  area() {
    return this.Width * this.Height;
  }

  Area() {
    return this.area();
  }

  covers(node) {
    const b1 = this.Box;
    const b2 = node.Box;
    return (
      b2.TopLeft.X >= b1.TopLeft.X &&
      b2.TopLeft.Y >= b1.TopLeft.Y &&
      b2.TopLeft.X + b2.Width <= b1.TopLeft.X + b1.Width &&
      b2.TopLeft.Y + b2.Height <= b1.TopLeft.Y + b1.Height
    );
  }

  doesOverlapExact(node) {
    return this.Box.overlaps(node.Box);
  }

  translate(dx, dy) {
    this.TopLeft.X += dx;
    this.TopLeft.Y += dy;
  }

  Translate(dx, dy) {
    this.translate(dx, dy);
  }

  moveNodeWithChildren(dx, dy) {
    if (dx === 0 && dy === 0) {
      return;
    }
    this.translate(dx, dy);
    for (const child of this.Graph.allDescendantNodes(this, true)) {
      child.translate(dx, dy);
    }
  }

  moveWithChildren(dx, dy) {
    this.moveNodeWithChildren(dx, dy);
  }

  MoveWithChildren(dx, dy) {
    this.moveNodeWithChildren(dx, dy);
  }

  moveNodeAbsWithChildren(x, y) {
    if (this.TopLeft != null && this.TopLeft.X === x && this.TopLeft.Y === y) {
      return;
    }
    this.moveNodeWithChildren(x - this.TopLeft.X, y - this.TopLeft.Y);
  }

  moveAbsWithChildren(x, y) {
    this.moveNodeAbsWithChildren(x, y);
  }

  MoveAbsWithChildren(x, y) {
    this.moveNodeAbsWithChildren(x, y);
  }

  modifierElementAdjustments() {
    let dx = 0;
    let dy = 0;
    if (this.Is3D) {
      if (this._shapeType === "Hexagon") {
        dy = 15 / 2;
      } else {
        dy = 15;
      }
      dx = 15;
    } else if (this.IsMultiple) {
      dx = 10;
      dy = 10;
    }
    return [dx, dy];
  }

  ModifierElementAdjustments() {
    return this.modifierElementAdjustments();
  }

  boundingBoxValues(allNodes, roundDimensions) {
    const tl = new Point(this.TopLeft.X, this.TopLeft.Y);
    const br = new Point(tl.X + this.Width, tl.Y + this.Height);

    if (roundDimensions) {
      br.X = goRound(br.X);
      br.Y = goRound(br.Y);
    }

    const [dx, dy] = this.modifierElementAdjustments();
    if (dx !== 0 || dy !== 0) {
      tl.Y -= dy;
      br.X += dx;
    }

    tl.X -= getLoopOffset(this, Orientation.Left);
    tl.Y -= getLoopOffset(this, Orientation.Top);
    br.X += getLoopOffset(this, Orientation.Right);
    br.Y += getLoopOffset(this, Orientation.Bottom);

    if (this.Label != null && isOutsideLabelPosition(this.Label.Position) && allNodes != null) {
      const labelTL = getPointOnBox(this.Label.Position, this.Box, LABEL_PADDING, this.Label.Width, this.Label.Height);
      const boundaryOutsidePadding = LABEL_PADDING;
      const outsidePadding = 2 * LABEL_PADDING;

      if (labelTL.X < tl.X) {
        if (nodesLeftmost(allNodes, this)) {
          tl.X = Math.floor(labelTL.X - boundaryOutsidePadding);
        } else {
          tl.X = Math.floor(labelTL.X - outsidePadding);
        }
      }
      if (labelTL.Y < tl.Y) {
        if (nodesTopmost(allNodes, this)) {
          tl.Y = Math.floor(labelTL.Y - boundaryOutsidePadding);
        } else {
          tl.Y = Math.floor(labelTL.Y - outsidePadding);
        }
      }
      if (labelTL.X > br.X) {
        if (nodesRightmost(allNodes, this)) {
          br.X = Math.ceil(labelTL.X + this.Label.Width + boundaryOutsidePadding);
        } else {
          br.X = Math.ceil(labelTL.X + this.Label.Width + outsidePadding);
        }
      }
      if (labelTL.Y > br.Y) {
        if (nodesBottommost(allNodes, this)) {
          br.Y = Math.ceil(labelTL.Y + this.Label.Height + boundaryOutsidePadding);
        } else {
          br.Y = Math.ceil(labelTL.Y + this.Label.Height + outsidePadding);
        }
      }
    }

    if (this.Icon != null && this._shapeType !== "Image" && isOutsideLabelPosition(this.Icon.Position) && allNodes != null) {
      const iconSize = 64;
      const iconTL = getPointOnBox(this.Icon.Position, this.Box, LABEL_PADDING, iconSize, iconSize);
      const outsidePadding = 2 * LABEL_PADDING;

      const left = Math.floor(iconTL.X - outsidePadding);
      if (left < tl.X) {
        tl.X = left;
      }
      const top = Math.floor(iconTL.Y - outsidePadding);
      if (top < tl.Y) {
        tl.Y = top;
      }
      const right = Math.ceil(iconTL.X + iconSize + outsidePadding);
      if (right > br.X) {
        br.X = right;
      }
      const bottom = Math.ceil(iconTL.Y + iconSize + outsidePadding);
      if (bottom > br.Y) {
        br.Y = bottom;
      }
    }

    return [tl, br];
  }

  boundsWithRounding(allNodes, roundDimensions) {
    return this.boundingBoxValues(allNodes, roundDimensions);
  }

  bounds(allNodes) {
    return this.boundsWithRounding(allNodes, true);
  }

  Bounds(allNodes) {
    return this.bounds(allNodes);
  }

  fixedOrigin() {
    if (this.TopLeft != null && this.FixedTopLeft != null) {
      return new Point(
        this.TopLeft.X - this.FixedTopLeft.X,
        this.TopLeft.Y - this.FixedTopLeft.Y
      );
    }
    return null;
  }

  FixedOrigin() {
    return this.fixedOrigin();
  }

  containerLevel() {
    let level = 0;
    for (let curr = this; curr != null; curr = curr.owningContainer()) {
      level++;
    }
    return level;
  }

  ContainerLevel() {
    return this.containerLevel();
  }

  insidePlacement(width, height, padding) {
    const pad = getPaddingValues(padding);
    const padX = pad.left + pad.right;
    const padY = pad.top + pad.bottom;

    const p = shapeGetInsidePlacement(this._shapeType, this.Box, width, height, padX, padY);

    if (this._shapeType === "Circle") {
      const totalWidth = width + padX;
      const totalHeight = height + padY;

      const innerBox = shapeGetInnerBox(this._shapeType, this.Box);
      if (innerBox.Width > totalWidth) {
        p.X += (innerBox.Width - totalWidth) / 2.0;
      }
      if (innerBox.Height > totalHeight) {
        p.Y += (innerBox.Height - totalHeight) / 2.0;
      }
    }

    p.X = goRound(p.X);
    p.Y = goRound(p.Y);
    p.X -= goRound(padX / 2.0) - pad.left;
    p.Y -= goRound(padY / 2.0) - pad.top;

    return p;
  }

  InsidePlacement(width, height, padding) {
    return this.insidePlacement(width, height, padding);
  }

  innerBox() {
    const box = shapeGetInnerBox(this._shapeType, this.Box);
    return new Box(
      new Point(goRound(box.TopLeft.X), goRound(box.TopLeft.Y)),
      goRound(box.Width),
      goRound(box.Height)
    );
  }

  InnerBox() {
    return this.innerBox();
  }

  expandForLabels(tl, br) {
    const children = this.Graph.Containers.get(this) ?? [];

    for (const child of children) {
      if (
        child.Label != null &&
        (child.TopLeft.X === tl.X || child.TopLeft.X + child.Width === br.X)
      ) {
        if (child.Label.Width > child.Width) {
          tl.X = Math.min(
            tl.X,
            Math.floor(
              child.TopLeft.X + (child.Width / 2.0 - child.Label.Width / 2.0)
            )
          );

          br.X = Math.max(
            br.X,
            Math.ceil(
              child.TopLeft.X + child.Width - (child.Width / 2.0 - child.Label.Width / 2.0)
            )
          );
        }
      }
    }
  }

  positionContainerChildren(withPadding) {
    if (!this.isContainer) {
      return;
    }

    const children = this.Graph.Containers.get(this) ?? [];

    let padding;
    if (withPadding) {
      padding = this.Graph.containerPadding(this, false);
    } else {
      padding = { top: 0, bottom: 0, left: 0, right: 0 };
    }

    const [tl, br] = nodesFixedBounds(children);

    this.expandForLabels(tl, br);

    const innerTL = this.InsidePlacement(
      br.X - tl.X,
      br.Y - tl.Y,
      padding
    );

    const dx = innerTL.X - tl.X;
    const dy = innerTL.Y - tl.Y;

    for (const childN of children) {
      childN.moveNodeWithChildren(dx, dy);
    }
  }

  PositionContainerChildren(withPadding) {
    this.positionContainerChildren(withPadding);
  }

  getDimensionsToFit(width, height, paddingX, paddingY) {
    return shapeGetDimensionsToFit(this._shapeType, width, height, paddingX, paddingY);
  }

  GetDimensionsToFit(width, height, paddingX, paddingY) {
    return this.getDimensionsToFit(width, height, paddingX, paddingY);
  }

  fitToBoundingBox(tl, br, padding) {
    let width = br.X - tl.X;
    let height = br.Y - tl.Y;
    const pad = getPaddingValues(padding);

    if (this.Label != null && !isOutsideLabelPosition(this.Label.Position)) {
      const minWidth = this.Label.Width - pad.left - pad.right + LABEL_PADDING * 4;
      const minHeight = this.Label.Height - pad.top - pad.bottom + LABEL_PADDING * 4;
      if (this.DesiredWidth == null) {
        width = Math.max(width, minWidth);
      }
      if (this.DesiredHeight == null) {
        height = Math.max(height, minHeight);
      }
    }

    const [fitWidth, fitHeight] = this.GetDimensionsToFit(
      width,
      height,
      pad.left + pad.right,
      pad.top + pad.bottom
    );

    if (this.DesiredWidth != null) {
      this.Width = Math.max(fitWidth, this.DesiredWidth);
    } else {
      this.Width = fitWidth;
    }

    if (this.DesiredHeight != null) {
      this.Height = Math.max(fitHeight, this.DesiredHeight);
    } else {
      this.Height = fitHeight;
    }
  }

  FitToBoundingBox(tl, br, padding) {
    this.fitToBoundingBox(tl, br, padding);
  }

  wrapChildren() {
    if (!this.isContainer) {
      return;
    }

    const children = this.Graph.Containers.get(this) ?? [];

    const padding = this.Graph.containerPadding(this, false);

    const [tl, br] = nodesFixedBounds(children);

    this.expandForLabels(tl, br);

    this.fitToBoundingBox(tl, br, padding);

    const innerTL = this.InsidePlacement(
      br.X - tl.X,
      br.Y - tl.Y,
      padding
    );

    this.translate(
      tl.X - innerTL.X,
      tl.Y - innerTL.Y
    );
  }

  WrapChildren() {
    this.wrapChildren();
  }

  fitNodeToGraph(graph, padding) {
    const [tl, br] = nodesFixedBounds(graph.Nodes);

    this.expandForLabels(tl, br);

    this.fitToBoundingBox(tl, br, padding);
  }

  FitToGraph(graph, padding) {
    this.fitNodeToGraph(graph, padding);
  }

  center() {
    return new Point(this.TopLeft.X + this.Width / 2, this.TopLeft.Y + this.Height / 2);
  }

  Center() {
    return this.center();
  }

  // containerDirection reports the layout direction of this node's owning
  // container, mirroring Go Node.ContainerDirection() (node.go:2419).
  containerDirection() {
    return this.Graph.direction(this.effectiveContainer());
  }

  ContainerDirection() {
    return this.containerDirection();
  }

  // effectiveContainer returns the node's active layout container.
  // Active cluster and sequence vessels replace the node's direct container
  // while those grouping algorithms are running.
  // Pinned Go: layoutgraph.Node.EffectiveContainer (quality_api.go:26)
  effectiveContainer() {
    if (this.Cluster != null && this.Cluster.isActive && this.Cluster.isActive() &&
        this.Cluster.Vessel != null) {
      return this.Cluster.Vessel.Container ?? null;
    }
    if (this.Sequence != null && this.Sequence.isActive && this.Sequence.isActive() &&
        this.Sequence.Vessel != null) {
      return this.Sequence.Vessel.Container ?? null;
    }
    return this.Container ?? null;
  }

  EffectiveContainer() {
    return this.effectiveContainer();
  }

  // IsContainer reports whether this node acts as a layout container.
  // Mirrors Go Node.IsContainer() (hierarchy_access.go:140).
  // The underlying boolean field `isContainer` is set by addNodeToContainer().
  IsContainer() {
    return this.isContainer === true;
  }

  // containerLevel returns the nesting depth of this node's container chain.
  // Pinned Go: layoutgraph.Node.containerLevel (node.go:2354)
  containerLevel() {
    let level = 0;
    for (let curr = this; curr != null; curr = curr.effectiveContainer()) {
      level++;
    }
    return level;
  }

  // nearestSharedAncestor returns the most-nested container that is an ancestor
  // of both this node and otherNode.
  // Pinned Go: layoutgraph.Node.nearestSharedAncestor (node.go:2380)
  nearestSharedAncestor(otherNode) {
    let container = this.effectiveContainer();
    let otherContainer = otherNode.effectiveContainer();
    if (container == null || otherContainer == null) return null;
    let nLevel = this.containerLevel();
    let otherLevel = otherNode.containerLevel();

    while (container !== otherContainer) {
      if (nLevel === otherLevel) {
        container = container.effectiveContainer();
        nLevel--;
        otherContainer = otherContainer.effectiveContainer();
        otherLevel--;
      } else if (nLevel > otherLevel) {
        container = container.effectiveContainer();
        nLevel--;
      } else {
        otherContainer = otherContainer.effectiveContainer();
        otherLevel--;
      }
      if (container == null || otherContainer == null) return null;
    }
    return container;
  }

  NearestSharedAncestor(otherNode) {
    return this.nearestSharedAncestor(otherNode);
  }

  orientation(otherNode) {
    if (this.TopLeft == null || otherNode.TopLeft == null) {
      return Orientation.NONE;
    }
    if ((this.TopLeft.Y + this.Height) < otherNode.TopLeft.Y) {
      if ((this.TopLeft.X + this.Width) < otherNode.TopLeft.X) {
        return Orientation.TopLeft;
      }
      if ((otherNode.TopLeft.X + otherNode.Width) < this.TopLeft.X) {
        return Orientation.TopRight;
      }
      return Orientation.Top;
    }

    if ((otherNode.TopLeft.Y + otherNode.Height) < this.TopLeft.Y) {
      if ((this.TopLeft.X + this.Width) < otherNode.TopLeft.X) {
        return Orientation.BottomLeft;
      }
      if ((otherNode.TopLeft.X + otherNode.Width) < this.TopLeft.X) {
        return Orientation.BottomRight;
      }
      return Orientation.Bottom;
    }

    if ((otherNode.TopLeft.X + otherNode.Width) < this.TopLeft.X) {
      return Orientation.Right;
    }

    if ((this.TopLeft.X + this.Width) < otherNode.TopLeft.X) {
      return Orientation.Left;
    }

    return Orientation.NONE;
  }

  Orientation(otherNode) {
    return this.orientation(otherNode);
  }

  orientationAtPoint(otherNode, point) {
    if (point == null || otherNode.TopLeft == null) {
      return Orientation.NONE;
    }
    if ((point.Y + this.Height) < otherNode.TopLeft.Y) {
      if ((point.X + this.Width) < otherNode.TopLeft.X) return Orientation.TopLeft;
      if ((otherNode.TopLeft.X + otherNode.Width) < point.X) return Orientation.TopRight;
      return Orientation.Top;
    }
    if ((otherNode.TopLeft.Y + otherNode.Height) < point.Y) {
      if ((point.X + this.Width) < otherNode.TopLeft.X) return Orientation.BottomLeft;
      if ((otherNode.TopLeft.X + otherNode.Width) < point.X) return Orientation.BottomRight;
      return Orientation.Bottom;
    }
    if ((otherNode.TopLeft.X + otherNode.Width) < point.X) return Orientation.Right;
    if ((point.X + this.Width) < otherNode.TopLeft.X) return Orientation.Left;
    return Orientation.NONE;
  }

  deltaTo(other, atPoint) {
    if (other == null || atPoint == null) {
      throw new Error("spacing check received incomplete nodes");
    }
    let maxEdgeWidth = Number.MIN_SAFE_INTEGER;
    let maxEdgeHeight = Number.MIN_SAFE_INTEGER;
    let isConnected = false;
    for (const edge of this.Edges) {
      if (edge == null || edge.From == null || edge.To == null) {
        throw new Error("spacing check encountered an incomplete edge");
      }
      if (this.adjacent(edge) === other) {
        isConnected = true;
        maxEdgeWidth = Math.max(maxEdgeWidth, Number(edge.MinWidth ?? 0));
        maxEdgeHeight = Math.max(maxEdgeHeight, Number(edge.MinHeight ?? 0));
      }
    }
    let horizontalDelta = isConnected ? 60 : 20;
    let verticalDelta = isConnected ? 60 : 20;
    if (this._shapeType === "Table" || other._shapeType === "Table") {
      horizontalDelta = 120;
    }
    if (maxEdgeHeight > verticalDelta) verticalDelta = maxEdgeHeight;
    if (maxEdgeWidth > horizontalDelta) horizontalDelta = maxEdgeWidth;

    const m1 = this._margin ?? {};
    const m2 = other._margin ?? {};
    const hasMargin = [m1.top,m1.right,m1.bottom,m1.left,m2.top,m2.right,m2.bottom,m2.left]
      .some((v) => Number(v ?? 0) !== 0);
    const hasLoops =
      (this.LoopOffsets instanceof Map ? this.LoopOffsets.size > 0 : this.LoopOffsets != null && Object.keys(this.LoopOffsets).length > 0) ||
      (other.LoopOffsets instanceof Map ? other.LoopOffsets.size > 0 : other.LoopOffsets != null && Object.keys(other.LoopOffsets).length > 0);
    if (horizontalDelta === verticalDelta && !hasLoops && !hasMargin) {
      return horizontalDelta;
    }

    const o = this.orientationAtPoint(other, atPoint);
    if (hasLoops) {
      let loopDelta = 20;
      loopDelta += Number(getLoopOffset(this, getOpposite(o)) || 0);
      loopDelta += Number(getLoopOffset(other, o) || 0);
      horizontalDelta = Math.max(horizontalDelta, loopDelta);
      verticalDelta = Math.max(verticalDelta, loopDelta);
    }

    let n1LabelWidth = 0, n1LabelHeight = 0, n2LabelWidth = 0, n2LabelHeight = 0;
    const applyMargin = (node, orientation, first) => {
      let w = 0, h = 0;
      switch (orientation) {
        case Orientation.Bottom: h = nodeSpacingSide(node, "bottom"); break;
        case Orientation.Top: h = nodeSpacingSide(node, "top"); break;
        case Orientation.Right: w = nodeSpacingSide(node, "right"); break;
        case Orientation.Left: w = nodeSpacingSide(node, "left"); break;
        case Orientation.BottomLeft: w = nodeSpacingSide(node, "left"); h = nodeSpacingSide(node, "bottom"); break;
        case Orientation.BottomRight: w = nodeSpacingSide(node, "right"); h = nodeSpacingSide(node, "bottom"); break;
        case Orientation.TopLeft: w = nodeSpacingSide(node, "left"); h = nodeSpacingSide(node, "top"); break;
        case Orientation.TopRight: w = nodeSpacingSide(node, "right"); h = nodeSpacingSide(node, "top"); break;
      }
      if (first) { n1LabelWidth = Math.trunc(w); n1LabelHeight = Math.trunc(h); }
      else { n2LabelWidth = Math.trunc(w); n2LabelHeight = Math.trunc(h); }
    };
    applyMargin(this, getOpposite(o), true);
    applyMargin(other, o, false);
    horizontalDelta = Math.max(horizontalDelta, n1LabelWidth + n2LabelWidth);
    verticalDelta = Math.max(verticalDelta, n1LabelHeight + n2LabelHeight);

    if (o === Orientation.Top || o === Orientation.Bottom) return verticalDelta;
    if (o === Orientation.Left || o === Orientation.Right) return horizontalDelta;
    return Math.min(horizontalDelta, verticalDelta);
  }

  DeltaTo(other, atPoint) {
    return this.deltaTo(other, atPoint);
  }

  doesOverlapAt(other, point) {
    const delta = this.deltaTo(other, point);
    return boxesOverlapWithPadding(
      { TopLeft: point, Width: this.Width, Height: this.Height },
      other.Box,
      delta
    );
  }

  DoesOverlapAt(other, point) {
    return this.doesOverlapAt(other, point);
  }

  visibilityGraphCandidate(isHorizontal, checkSide, includeSizes, otherNode, padding) {
    if (isHorizontal) {
      if (checkSide && this.TopLeft.X >= otherNode.TopLeft.X) return false;
      if (includeSizes) {
        if (this.TopLeft.Y > otherNode.TopLeft.Y + otherNode.Height + padding) return false;
        if (this.TopLeft.Y + this.Height + padding < otherNode.TopLeft.Y) return false;
      } else if (this.TopLeft.Y !== otherNode.TopLeft.Y) {
        return false;
      }
    } else {
      if (checkSide && this.TopLeft.Y >= otherNode.TopLeft.Y) return false;
      if (includeSizes) {
        if (this.TopLeft.X > otherNode.TopLeft.X + otherNode.Width + padding) return false;
        if (this.TopLeft.X + this.Width + padding < otherNode.TopLeft.X) return false;
      } else if (this.TopLeft.X !== otherNode.TopLeft.X) {
        return false;
      }
    }
    return true;
  }

  VisibilityGraphCandidate(isHorizontal, checkSide, includeSizes, otherNode, padding) {
    return this.visibilityGraphCandidate(isHorizontal, checkSide, includeSizes, otherNode, padding);
  }

  IsBlocked(nodeA, nodeB, includeSizes, isHorizontal) {
    if (isHorizontal) {
      if (includeSizes) {
        if (!(this.TopLeft.X >= nodeA.TopLeft.X + nodeA.Width &&
              this.TopLeft.X + this.Width <= nodeB.TopLeft.X)) return false;
      } else if (!(this.TopLeft.X >= nodeA.TopLeft.X && this.TopLeft.X <= nodeB.TopLeft.X)) {
        return false;
      }
      if (includeSizes) {
        return this.TopLeft.Y <= Math.max(nodeA.TopLeft.Y, nodeB.TopLeft.Y) &&
          this.TopLeft.Y + this.Height >= Math.min(nodeA.TopLeft.Y + nodeA.Height, nodeB.TopLeft.Y + nodeB.Height);
      }
      return this.TopLeft.Y <= Math.max(nodeA.TopLeft.Y, nodeB.TopLeft.Y) &&
        this.TopLeft.Y >= Math.min(nodeA.TopLeft.Y, nodeB.TopLeft.Y);
    }
    if (includeSizes) {
      if (!(this.TopLeft.Y >= nodeA.TopLeft.Y + nodeA.Height &&
            this.TopLeft.Y + this.Height <= nodeB.TopLeft.Y)) return false;
      return this.TopLeft.X <= Math.max(nodeA.TopLeft.X, nodeB.TopLeft.X) &&
        this.TopLeft.X + this.Width >= Math.min(nodeA.TopLeft.X + nodeA.Width, nodeB.TopLeft.X + nodeB.Width);
    }
    if (!(this.TopLeft.Y >= nodeA.TopLeft.Y && this.TopLeft.Y <= nodeB.TopLeft.Y)) return false;
    return this.TopLeft.X <= Math.max(nodeA.TopLeft.X, nodeB.TopLeft.X) &&
      this.TopLeft.X >= Math.min(nodeA.TopLeft.X, nodeB.TopLeft.X);
  }

  isPointPastFixedOrigin(x, y, includeSizes) {
    const fixedOrigin = this.Graph.containerFixedOrigin(this.container());
    if (fixedOrigin == null) return false;
    let fx = fixedOrigin.X;
    let fy = fixedOrigin.Y;
    if (!includeSizes) {
      fx = goRound(fx / this.Graph.CellSize);
      fy = goRound(fy / this.Graph.CellSize);
    }
    return x < fx || y < fy;
  }

  PointPastFixedOrigin(x, y, includeSizes) {
    return this.isPointPastFixedOrigin(x, y, includeSizes);
  }

  containsPoint(p, delta) {
    return this.TopLeft.X - delta <= p.X &&
      this.TopLeft.X + this.Width + delta >= p.X &&
      this.TopLeft.Y - delta <= p.Y &&
      this.TopLeft.Y + this.Height + delta >= p.Y;
  }

  overlapsLine(p1, p2, delta) {
    if (this.containsPoint(p1, delta) || this.containsPoint(p2, delta)) {
      return true;
    }

    const l = this.TopLeft.X - delta;
    const r = this.TopLeft.X + this.Width + delta;
    const t = this.TopLeft.Y - delta;
    const b = this.TopLeft.Y + this.Height + delta;

    const tl = new Point(l, t);
    const br = new Point(r, b);
    const tr = new Point(r, t);
    const bl = new Point(l, b);

    return segmentsIntersect(tl, tr, p1, p2) ||
      segmentsIntersect(tr, br, p1, p2) ||
      segmentsIntersect(br, bl, p1, p2) ||
      segmentsIntersect(bl, tl, p1, p2);
  }

  OverlapsLine(p1, p2, delta) {
    return this.overlapsLine(p1, p2, delta);
  }

  passesThrough(p1, p2) {
    return segmentIntersectsBox(p1, p2, this);
  }

  PassesThrough(p1, p2) {
    return this.passesThrough(p1, p2);
  }

  area() {
    return this.Width * this.Height;
  }

  Area() {
    return this.area();
  }

  overlapsAlongDimension(other, isHorizontal, includeSizes) {
    if (isHorizontal) {
      if (includeSizes) {
        if (this.TopLeft.Y > (other.TopLeft.Y + other.Height)) {
          return false;
        }
        if ((this.TopLeft.Y + this.Height) < other.TopLeft.Y) {
          return false;
        }
      } else {
        if (this.TopLeft.Y > other.TopLeft.Y) {
          return false;
        }
        if (this.TopLeft.Y < other.TopLeft.Y) {
          return false;
        }
      }
    } else {
      if (includeSizes) {
        if (this.TopLeft.X > (other.TopLeft.X + other.Width)) {
          return false;
        }
        if ((this.TopLeft.X + this.Width) < other.TopLeft.X) {
          return false;
        }
      } else {
        if (this.TopLeft.X > other.TopLeft.X) {
          return false;
        }
        if (this.TopLeft.X < other.TopLeft.X) {
          return false;
        }
      }
    }
    return true;
  }

  OverlapsAlongDimension(other, isHorizontal, includeSizes) {
    return this.overlapsAlongDimension(other, isHorizontal, includeSizes);
  }

  numColumns() {
    return this._numColumns || 0;
  }

  NumColumns() {
    return this.numColumns();
  }

  setNumColumns(numColumns) {
    this._numColumns = numColumns;
  }

  SetNumColumns(numColumns) {
    this.setNumColumns(numColumns);
  }

  tableColumnPortValue(orientation, columnIndex) {
    if (this.isTable()) {
      if (orientation !== Orientation.Left && orientation !== Orientation.Right) {
        return [new Point(0, 0), false];
      }
      const numCols = this._numColumns || 0;
      if (numCols === 0) {
        if (columnIndex !== 0) {
          throw new Error("table column port index out of range");
        }
      } else if (columnIndex < 0 || columnIndex >= numCols) {
        throw new Error("table column port index out of range");
      }

      let yPercentage = 0.5;
      if (numCols > 0) {
        const rowHeightPercentage = 1 / (numCols + 1);
        let percentage = rowHeightPercentage + rowHeightPercentage / 2;
        for (let i = 0; i < columnIndex; i++) {
          percentage += rowHeightPercentage;
        }
        percentage = Math.round(percentage * 10000) / 10000;
        yPercentage = truncateDecimals(percentage);
      }
      const xPercentage = orientation === Orientation.Right ? 1.0 : 0.0;
      return [
        new Point(
          this.TopLeft.X + Math.round(this.Width * xPercentage),
          this.TopLeft.Y + Math.round(this.Height * yPercentage),
        ),
        true,
      ];
    }
    const standardSidePercentages = [0.25, 0.5, 0.75];
    if (columnIndex >= 0 && columnIndex < standardSidePercentages.length) {
      const yPct = standardSidePercentages[columnIndex];
      const xPct = orientation === Orientation.Right ? 1.0 : 0.0;
      return [
        new Point(
          this.TopLeft.X + Math.round(this.Width * xPct),
          this.TopLeft.Y + Math.round(this.Height * yPct),
        ),
        true,
      ];
    }
    return [new Point(0, 0), false];
  }

  TableColumnPortValue(orientation, columnIndex) {
    return this.tableColumnPortValue(orientation, columnIndex);
  }

  debugID() {
    return nodeDebugID(this);
  }

  DebugID() {
    return nodeDebugID(this);
  }
}

/**
 * nodeDebugID formats a diagnostic ID for a node, preserving Go TALA semantics.
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/node.go
 *
 * @param {Node|null|undefined} node
 * @returns {string}
 */
export function nodeDebugID(node) {
  if (node == null) {
    return "nil";
  }
  if (node.D2ID != null) {
    return node.D2ID;
  }
  if (node.isClusterVessel) {
    const cluster = node.Graph.Clusters instanceof Map
      ? node.Graph.Clusters.get(node)
      : node.Graph.Clusters[node];
    return "Cluster vessel of: " + (typeof cluster.DebugID === "function" ? cluster.DebugID() : cluster.debugID());
  }
  if (node.Graph != null && node.Graph.Sequences != null) {
    const seqs = node.Graph.Sequences;
    const hasSeq = seqs instanceof Map
      ? (seqs.size > 0 && seqs.has(node))
      : (typeof seqs === "object" && Object.keys(seqs).length > 0 && node in seqs);
    if (hasSeq) {
      const s = seqs instanceof Map ? seqs.get(node) : seqs[node];
      return "Sequence vessel of: " + (typeof s.DebugID === "function" ? s.DebugID() : s.debugID());
    }
  }
  return BigInt(node.ID != null ? node.ID : 0).toString(10);
}

export function reachabilityIsDescendantOf(maybeDescendant, maybeAncestor, guard) {
  if (guard == null) {
    throw new Error("TALA reachability ancestry requires a work guard");
  }
  for (let current = maybeDescendant; ; current = ancestryParent(current)) {
    guard.Step();
    if (maybeAncestor === current) {
      return true;
    }
    if (current == null) {
      return false;
    }
  }
}
