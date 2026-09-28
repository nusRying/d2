export class Node {
  constructor({ id, width = 0, height = 0, x = 0, y = 0, parent = null }) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.parent = parent;

    this.children = [];
    this.edges = [];

    // Preserve original ELK data for non-mutation and metadata preservation
    this.elkData = null;
  }
}
