// Pinned reference: internal/hierarchy/rank_graph.go
//
// Go sorts with slices.SortFunc (unstable pdqsort). Every sort key here is
// unique once validation succeeds: node IDs (a duplicate is reported with the
// same message whichever duplicate sorts first), (from, to, edge ID) after
// duplicate directed pairs are rejected, and edge IDs after duplicate IDs are
// rejected. JS stable sorting therefore yields the identical order.

import { MAX_ENGINE_EDGES, MAX_ENGINE_NODES } from '../limits/constants.js';
import { nodeDebugID } from '../graph/node.js';
import { hierarchyRankWeight } from '../graph/structural-access.js';
import { NodeMinHeap } from './rank-queue.js';
import { checkedAddInt64, goError } from './layoutgraph-support.js';

export const RANK_MIN_SPAN = 1;

export function compareEntityIDs(a, b) {
  const x = BigInt(a);
  const y = BigInt(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function compareInts(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function idString(id) {
  return BigInt(id).toString();
}

/** rankEdge. */
export class RankEdge {
  constructor(from, to, weight, id) {
    this.from = from;
    this.to = to;
    this.weight = weight;
    this.id = id;
  }
}

/** rankProblem. */
export class RankProblem {
  constructor(nodes, edges, outgoingStart, pivotOrder) {
    this.nodes = nodes;
    this.edges = edges;
    this.outgoingStart = outgoingStart;
    this.pivotOrder = pivotOrder;
  }
}

/** newRankProblem validates the DAG and builds canonical index arrays. */
export function newRankProblem(g, guard) {
  if (g == null) {
    throw goError('graph is required');
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw goError(`node count exceeds limit ${MAX_ENGINE_NODES}`);
  }
  if (g.Edges.length > MAX_ENGINE_EDGES) {
    throw goError(`edge count exceeds limit ${MAX_ENGINE_EDGES}`);
  }

  const nodes = g.Nodes.slice();
  guard.AddSort(nodes.length);
  nodes.sort((a, b) => {
    if (a == null) {
      return b == null ? 0 : -1;
    }
    if (b == null) {
      return 1;
    }
    return compareEntityIDs(a.ID, b.ID);
  });

  const index = new Map();
  for (let i = 0; i < nodes.length; i++) {
    guard.Step();
    const node = nodes[i];
    if (node == null) {
      throw goError('nil node');
    }
    if (i > 0 && BigInt(nodes[i - 1].ID) === BigInt(node.ID)) {
      throw goError(`duplicate node ID ${idString(node.ID)}`);
    }
    if (index.has(node)) {
      throw goError(`duplicate node ${nodeDebugID(node)}`);
    }
    index.set(node, i);
  }

  const edges = [];
  const seenEdges = new Set();
  const seenEdgeIDs = new Set();
  const seenEndpoints = new Set();
  for (const edge of g.Edges) {
    guard.Step();
    if (edge == null || edge.From == null || edge.To == null) {
      throw goError('edge has a nil endpoint');
    }
    const fromExists = index.has(edge.From);
    const toExists = index.has(edge.To);
    if (!fromExists || !toExists) {
      throw goError(`edge ${idString(edge.ID)} references a node outside the graph`);
    }
    const from = index.get(edge.From);
    const to = index.get(edge.To);
    if (from === to) {
      throw goError(`self edge on ${nodeDebugID(edge.From)}`);
    }
    if (edge.hasSourceArrow() || !edge.hasTargetArrow()) {
      throw goError('canonical source-to-target directed edges required');
    }
    const weight = hierarchyRankWeight(edge);
    if (weight <= 0 || weight > MAX_ENGINE_EDGES) {
      throw goError(`edge ${idString(edge.ID)} has invalid rank weight ${weight}`);
    }
    if (seenEdges.has(edge)) {
      throw goError(`duplicate edge reference ${idString(edge.ID)}`);
    }
    const edgeID = BigInt(edge.ID);
    if (seenEdgeIDs.has(edgeID)) {
      throw goError(`duplicate edge ID ${idString(edge.ID)}`);
    }
    const pair = `${from},${to}`;
    if (seenEndpoints.has(pair)) {
      throw goError(`duplicate directed edge ${nodeDebugID(edge.From)} -> ${nodeDebugID(edge.To)}`);
    }
    seenEdges.add(edge);
    seenEdgeIDs.add(edgeID);
    seenEndpoints.add(pair);
    edges.push({ edge, from, to });
  }

  guard.AddSort(edges.length);
  edges.sort((a, b) => {
    const byFrom = compareInts(a.from, b.from);
    if (byFrom !== 0) return byFrom;
    const byTo = compareInts(a.to, b.to);
    if (byTo !== 0) return byTo;
    return compareEntityIDs(a.edge.ID, b.edge.ID);
  });

  const incidentCounts = new Map();
  let incidentReferences = 0;
  for (const node of nodes) {
    for (const edge of node.Edges) {
      guard.Step();
      incidentReferences++;
      if (incidentReferences > MAX_ENGINE_EDGES * 2) {
        throw goError(`incident edge references exceed limit ${MAX_ENGINE_EDGES * 2}`);
      }
      if (edge == null || (edge.From !== node && edge.To !== node)) {
        throw goError(`malformed incident edge on ${nodeDebugID(node)}`);
      }
      if (!seenEdges.has(edge)) {
        throw goError(`node ${nodeDebugID(node)} references an edge outside the graph`);
      }
      let counts = incidentCounts.get(edge);
      if (counts == null) {
        counts = { from: 0, to: 0 };
        incidentCounts.set(edge, counts);
      }
      if (edge.From === node) {
        counts.from++;
      } else {
        counts.to++;
      }
    }
  }
  for (const edge of edges) {
    guard.Step();
    const counts = incidentCounts.get(edge.edge) ?? { from: 0, to: 0 };
    if (counts.from !== 1 || counts.to !== 1) {
      throw goError(`edge ${idString(edge.edge.ID)} must appear once on each endpoint; got source=${counts.from} target=${counts.to}`);
    }
  }

  if (nodes.length > 1) {
    const seen = new Array(nodes.length).fill(false);
    seen[0] = true;
    const queue = [0];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const edge of nodes[u].Edges) {
        guard.Step();
        const v = index.get(nodes[u].adjacent(edge));
        if (!seen[v]) {
          seen[v] = true;
          queue.push(v);
        }
      }
    }
    if (queue.length !== nodes.length) {
      throw goError('input graph is disconnected');
    }
  }

  const problemEdges = new Array(edges.length);
  const outgoingStart = new Array(nodes.length + 1).fill(0);
  for (let i = 0; i < edges.length; i++) {
    guard.Step();
    const edge = edges[i];
    problemEdges[i] = new RankEdge(edge.from, edge.to, hierarchyRankWeight(edge.edge), edge.edge.ID);
    outgoingStart[edge.from + 1]++;
  }
  for (let node = 0; node < nodes.length; node++) {
    guard.Step();
    outgoingStart[node + 1] += outgoingStart[node];
  }
  const pivotOrder = new Array(problemEdges.length);
  for (let edgeIndex = 0; edgeIndex < pivotOrder.length; edgeIndex++) {
    guard.Step();
    pivotOrder[edgeIndex] = edgeIndex;
  }
  guard.AddSort(pivotOrder.length);
  pivotOrder.sort((a, b) => compareEntityIDs(problemEdges[a].id, problemEdges[b].id));
  return new RankProblem(nodes, problemEdges, outgoingStart, pivotOrder);
}

/** longestPathLevels computes the stable Kahn longest-path feasible ranking. */
export function longestPathLevels(problem, guard) {
  const indegree = new Array(problem.nodes.length).fill(0);
  for (const edge of problem.edges) {
    guard.Step();
    indegree[edge.to]++;
  }

  const ready = new NodeMinHeap();
  for (let node = 0; node < indegree.length; node++) {
    guard.Step();
    if (indegree[node] === 0) {
      ready.push(node);
      guard.Step();
    }
  }

  const levels = new Array(problem.nodes.length).fill(0);
  let visited = 0;
  while (ready.length > 0) {
    guard.Step();
    const u = ready.pop();
    visited++;
    for (let edgeIndex = problem.outgoingStart[u]; edgeIndex < problem.outgoingStart[u + 1]; edgeIndex++) {
      guard.Step();
      const edge = problem.edges[edgeIndex];
      const [candidate, ok] = checkedAddInt64(levels[u], RANK_MIN_SPAN);
      if (!ok) {
        throw goError('initial level overflow');
      }
      levels[edge.to] = Math.max(levels[edge.to], candidate);
      indegree[edge.to]--;
      if (indegree[edge.to] === 0) {
        ready.push(edge.to);
        guard.Step();
      }
    }
  }
  if (visited !== problem.nodes.length) {
    throw goError('input graph contains a directed cycle');
  }
  return levels;
}
