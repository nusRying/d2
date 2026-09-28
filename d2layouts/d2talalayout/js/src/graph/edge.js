export class Edge {
  constructor({ id, from, to, sourceEndpointId, targetEndpointId }) {
    this.id = id;
    this.from = from;
    this.to = to;
    this.sourceEndpointId = sourceEndpointId;
    this.targetEndpointId = targetEndpointId;
    this.route = []; // Edge sections/bend points
    this.elkData = null; // Original ELK payload
  }
}
