import { Box } from '../geometry/box.js';

export class Node {
  constructor(id, width = 0, height = 0) {
    this.ID = id;
    this.D2ID = null;

    // Geometry embedded as properties matching geo.Box embedded struct
    this.TopLeft = null;
    this.Width = width;
    this.Height = height;

    this.FixedTopLeft = null;
    this.DesiredWidth = null;
    this.DesiredHeight = null;

    this.Graph = null;
    this.Container = null;
    this.isContainer = false;

    this.Edges = [];
    this.Nears = [];
    this.nearByNode = new Map();

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

  box() {
    return new Box(this.TopLeft, this.Width, this.Height);
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

  addNear(near) {
    if (this.nearByNode.has(near)) return;
    this.Nears.push(near);
    this.nearByNode.set(near, true);
  }

  orderedNears() {
    return this.Nears;
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
}
