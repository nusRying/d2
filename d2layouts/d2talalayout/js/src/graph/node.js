import { Box } from '../geometry/box.js';

export function sortNodesByID(nodes) {
  nodes.sort((a, b) => {
    if (a.ID < b.ID) return -1;
    if (a.ID > b.ID) return 1;
    return 0;
  });
  return nodes;
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

    this.Edges = [];
    this.Nears = new Set();

    this.Cluster = null;
    this.Sequence = null;
    this.Hierarchy = null;

    this.FontSize = null;
    this.Label = null;
    this.Icon = null;
    
    this.ForceHierarchy = false;
    this.Is3D = false;
    this.IsMultiple = false;
    this.IsInvisible = false;

    this._shapeType = 0;
    this._numColumns = 0;
  }

  get TopLeft() { return this.Box.TopLeft; }
  set TopLeft(v) { this.Box.TopLeft = v; }
  get Width() { return this.Box.Width; }
  set Width(v) { this.Box.Width = v; }
  get Height() { return this.Box.Height; }
  set Height(v) { this.Box.Height = v; }

  box() {
    return this.Box;
  }

  addEdge(edge) {
    if (!this.Edges.includes(edge)) {
      this.Edges.push(edge);
    }
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

  orderedNears() {
    const nears = Array.from(this.Nears);
    return sortNodesByID(nears);
  }

  setShape(shapeType) {
    this._shapeType = shapeType;
  }

  shapeType() {
    return this._shapeType;
  }

  setNumColumns(n) {
    this._numColumns = n;
  }

  numColumns() {
    return this._numColumns;
  }

  adjacent(edge) {
    if (edge.From === this) return edge.To;
    if (edge.To === this) return edge.From;
    return null;
  }

  level() {
    let l = 0;
    let n = this;
    while (n.Container) {
      l++;
      n = n.Container;
    }
    return l;
  }

  isDescendantOf(node) {
    if (node === null) {
      // In Go layoutgraph, checking if descendant of root (nil container)
      return true; // Actually if it's not root, it's descendant of null? Wait, `isDescendantOf(null) === true once ancestry reaches root`
    }
    let n = this;
    while (n) {
      if (n === node) return true;
      n = n.Container;
    }
    // If we reached root, it depends on whether the node is root (null).
    if (node === null) return true;
    return false;
  }

  connectionTo(node) {
    for (const edge of this.Edges) {
      if (edge.From === node || edge.To === node) {
        return edge;
      }
    }
    return null;
  }

  area() {
    return this.Width * this.Height;
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
