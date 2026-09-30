import { Box } from '../geometry/box.js';
import { Icon } from './icon.js';

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
    return this.shapeKind() === other.shapeKind();
  }

  SameShape(other) {
    return this.sameShape(other);
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
    if (edge.From === this) return edge.To;
    if (edge.To === this) return edge.From;
    return null;
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
}
