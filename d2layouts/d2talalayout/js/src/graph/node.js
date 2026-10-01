import { Box } from '../geometry/box.js';
import { euclideanDistance, goRound } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { Orientation, orientationToString } from '../geometry/orientation.js';
import { Icon } from './icon.js';
import { LABEL_PADDING, isOutsideLabelPosition, getPointOnBox } from './label-position.js';
import { nodesLeftmost, nodesTopmost, nodesRightmost, nodesBottommost, nodesFixedBounds } from './node-bounds.js';
import { shapeGetInnerBox, shapeGetInsidePlacement, shapeGetDimensionsToFit } from '../shape/inner-geometry.js';

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
    if (this.isContainer && this.Graph != null) {
      const children = this.Graph.Containers.get(this);
      if (children) {
        for (const child of children) {
          child.rdfsWalk(applyFunc);
        }
      }
    }

    if (this.isClusterVessel && this.Graph != null) {
      const cluster = this.Graph.Clusters.get(this);
      if (cluster && cluster.Nodes) {
        for (const cn of cluster.Nodes) {
          cn.rdfsWalk(applyFunc);
        }
      }
    } else if (this.Graph != null && this.Graph.Sequences.has(this)) {
      const sequence = this.Graph.Sequences.get(this);
      if (sequence && sequence.Nodes) {
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
}
