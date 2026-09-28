export class Edge {
  constructor({ id, source, target }) {
    this.id = id;
    this.source = source;
    this.target = target;
    this.route = []; // Edge sections/bend points
    this.elkData = null; // Original ELK payload
  }
}
