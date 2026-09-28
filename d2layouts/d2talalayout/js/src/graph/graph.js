export class Graph {
  constructor(id = "root") {
    this.id = id;
    this.nodes = new Map();
    this.edges = new Map();
    this.endpoints = new Map();
    this.rootNodes = [];
    this.elkData = null;
  }
}
