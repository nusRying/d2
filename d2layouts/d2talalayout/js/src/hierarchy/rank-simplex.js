// Pinned reference: internal/hierarchy/rank_simplex.go
//
// rankSimplex is the graphical network-simplex formulation from Gansner,
// Koutsofios, North, and Vo, "A Technique for Drawing Directed Graphs,"
// IEEE TSE 19(3), 1993, section 2.3. Every traversal uses explicit queues or
// stacks exactly as Go does, so hostile depth cannot overflow the JS stack.

import { goError, invariantNew } from './layoutgraph-support.js';
import { checkedAddInt64, checkedMulInt64, checkedSubInt64 } from './layoutgraph-support.js';
import { RANK_MIN_SPAN } from './rank-graph.js';
import { nodeDebugID } from '../graph/node.js';

function idString(id) {
  return BigInt(id).toString();
}

export class RankSimplex {
  constructor(problem, incidentStart, incidentEdges, balance) {
    const nodeCount = problem.nodes.length;
    this.problem = problem;
    this.incidentStart = incidentStart;
    this.incidentEdges = incidentEdges;
    this.balance = balance;
    this.scratch = {
      parent: new Array(nodeCount).fill(0),
      parentEdge: new Array(nodeCount).fill(0),
      subtreeBalance: new Array(nodeCount).fill(0),
      cutValue: new Array(problem.edges.length).fill(0),
      head: new Array(nodeCount).fill(false),
      computedBalance: new Array(nodeCount).fill(0),
    };
  }
}

/** rankProblem.solve → [levels, dualValue]. */
export function solveRankProblem(problem, initialLevels, guard) {
  const solver = newRankSimplex(problem, guard);
  const levels = initialLevels.slice();
  const tree = feasibleTree(solver, levels, guard);
  optimize(solver, levels, tree, guard);
  const dualValue = certify(solver, levels, tree, guard);
  return [levels, dualValue];
}

export function newRankSimplex(problem, guard) {
  const nodeCount = problem.nodes.length;
  const degree = new Array(nodeCount).fill(0);
  const balance = new Array(nodeCount).fill(0);
  for (const edge of problem.edges) {
    guard.Step();
    degree[edge.from]++;
    degree[edge.to]++;
    let ok;
    [balance[edge.from], ok] = checkedAddInt64(balance[edge.from], edge.weight);
    if (!ok) {
      throw goError('supply overflow');
    }
    [balance[edge.to], ok] = checkedSubInt64(balance[edge.to], edge.weight);
    if (!ok) {
      throw goError('demand overflow');
    }
  }

  const incidentStart = new Array(nodeCount + 1).fill(0);
  for (let node = 0; node < nodeCount; node++) {
    guard.Step();
    incidentStart[node + 1] = incidentStart[node] + degree[node];
  }
  const incidentEdges = new Array(problem.edges.length * 2).fill(0);
  const next = incidentStart.slice(0, nodeCount);
  for (const edgeIndex of problem.pivotOrder) {
    guard.Step();
    const edge = problem.edges[edgeIndex];
    incidentEdges[next[edge.from]] = edgeIndex;
    next[edge.from]++;
    incidentEdges[next[edge.to]] = edgeIndex;
    next[edge.to]++;
  }

  let total = 0;
  for (const amount of balance) {
    guard.Step();
    let ok;
    [total, ok] = checkedAddInt64(total, amount);
    if (!ok) {
      throw goError('balance overflow');
    }
  }
  if (total !== 0) {
    throw invariantNew(`unbalanced supplies: ${total}`);
  }
  return new RankSimplex(problem, incidentStart, incidentEdges, balance);
}

/** feasibleTree implements figure 2-2 of Gansner et al. */
export function feasibleTree(solver, levels, guard) {
  const nodeCount = solver.problem.nodes.length;
  const tree = new Array(solver.problem.edges.length).fill(false);
  const inTree = new Array(nodeCount).fill(false);
  inTree[0] = true;
  let treeNodeCount = 1;
  let queue = [0];

  const growTight = () => {
    for (let head = 0; head < queue.length; head++) {
      guard.Step();
      const node = queue[head];
      for (let i = solver.incidentStart[node]; i < solver.incidentStart[node + 1]; i++) {
        guard.Step();
        const edgeIndex = solver.incidentEdges[i];
        const edge = solver.problem.edges[edgeIndex];
        let other = edge.from;
        if (other === node) {
          other = edge.to;
        }
        if (inTree[other]) {
          continue;
        }
        const slack = rankSlack(edge, levels);
        if (slack !== 0) {
          continue;
        }
        tree[edgeIndex] = true;
        inTree[other] = true;
        treeNodeCount++;
        queue.push(other);
      }
    }
    queue = [];
  };
  growTight();

  let boundary = [];
  while (treeNodeCount < nodeCount) {
    let bestSlack = Infinity;
    boundary = [];
    for (const edgeIndex of solver.problem.pivotOrder) {
      guard.Step();
      const edge = solver.problem.edges[edgeIndex];
      if (inTree[edge.from] === inTree[edge.to]) {
        continue;
      }
      const slack = rankSlack(edge, levels);
      if (slack < bestSlack) {
        bestSlack = slack;
        boundary = [edgeIndex];
      } else if (slack === bestSlack) {
        boundary.push(edgeIndex);
      }
    }
    if (boundary.length === 0) {
      throw invariantNew('could not construct a spanning feasible tree');
    }

    const selected = solver.problem.edges[boundary[0]];
    const selectedTailInTree = inTree[selected.from];
    let delta = bestSlack;
    if (!selectedTailInTree) {
      let ok;
      [delta, ok] = checkedSubInt64(0, bestSlack);
      if (!ok) {
        throw goError('feasible-tree shift overflow');
      }
    }
    for (let node = 0; node < inTree.length; node++) {
      guard.Step();
      if (!inTree[node]) {
        continue;
      }
      let ok;
      [levels[node], ok] = checkedAddInt64(levels[node], delta);
      if (!ok) {
        throw goError('feasible-tree level overflow');
      }
    }

    for (const edgeIndex of boundary) {
      guard.Step();
      const edge = solver.problem.edges[edgeIndex];
      if (inTree[edge.from] === inTree[edge.to]) {
        continue;
      }
      const tailInTree = inTree[edge.from];
      if (bestSlack !== 0 && tailInTree !== selectedTailInTree) {
        continue;
      }
      const slack = rankSlack(edge, levels);
      if (slack !== 0) {
        continue;
      }
      let outside = edge.from;
      if (tailInTree) {
        outside = edge.to;
      }
      tree[edgeIndex] = true;
      inTree[outside] = true;
      treeNodeCount++;
      queue.push(outside);
    }
    if (queue.length === 0) {
      throw invariantNew('feasible-tree shift did not add a node');
    }
    growTight();
  }
  return tree;
}

/** optimize performs the feasible-tree exchanges with Bland's rule. */
export function optimize(solver, levels, tree, guard) {
  for (;;) {
    computeCutValues(solver, tree, guard);
    const cutValue = solver.scratch.cutValue;
    let leaving = -1;
    for (const edgeIndex of solver.problem.pivotOrder) {
      guard.Step();
      if (tree[edgeIndex] && cutValue[edgeIndex] < 0) {
        leaving = edgeIndex;
        break;
      }
    }
    if (leaving < 0) {
      return;
    }

    computeHeadComponent(solver, tree, leaving, guard);
    const head = solver.scratch.head;
    let entering = -1;
    let minimumSlack = Infinity;
    for (const edgeIndex of solver.problem.pivotOrder) {
      guard.Step();
      const edge = solver.problem.edges[edgeIndex];
      if (tree[edgeIndex] || !head[edge.from] || head[edge.to]) {
        continue;
      }
      const slack = rankSlack(edge, levels);
      if (slack < minimumSlack) {
        minimumSlack = slack;
        entering = edgeIndex;
      }
    }
    if (entering < 0) {
      throw invariantNew(`negative cut on edge ${idString(solver.problem.edges[leaving].id)} has no entering edge`);
    }

    for (let node = 0; node < head.length; node++) {
      guard.Step();
      if (!head[node]) {
        continue;
      }
      let ok;
      [levels[node], ok] = checkedAddInt64(levels[node], minimumSlack);
      if (!ok) {
        throw goError('simplex level overflow');
      }
    }
    const slack = rankSlack(solver.problem.edges[entering], levels);
    if (slack !== 0) {
      throw invariantNew(`entering edge ${idString(solver.problem.edges[entering].id)} has slack ${slack} after exchange`);
    }
    tree[leaving] = false;
    tree[entering] = true;
  }
}

/** computeCutValues roots the feasible tree at node zero (explicit stack). */
export function computeCutValues(solver, tree, guard) {
  const nodeCount = solver.problem.nodes.length;
  let treeEdgeCount = 0;
  for (const present of tree) {
    guard.Step();
    if (present) {
      treeEdgeCount++;
    }
  }
  if (treeEdgeCount !== nodeCount - 1) {
    throw invariantNew(`basis has ${treeEdgeCount} tree edges, want ${nodeCount - 1}`);
  }

  const unvisited = -2;
  const parent = solver.scratch.parent;
  const parentEdge = solver.scratch.parentEdge;
  for (let node = 0; node < parent.length; node++) {
    guard.Step();
    parent[node] = unvisited;
    parentEdge[node] = -1;
  }
  parent[0] = -1;
  const order = [];
  const stack = [0];
  while (stack.length > 0) {
    guard.Step();
    const node = stack.pop();
    order.push(node);
    for (let i = solver.incidentStart[node]; i < solver.incidentStart[node + 1]; i++) {
      guard.Step();
      const edgeIndex = solver.incidentEdges[i];
      if (!tree[edgeIndex] || edgeIndex === parentEdge[node]) {
        continue;
      }
      const edge = solver.problem.edges[edgeIndex];
      let other = edge.from;
      if (other === node) {
        other = edge.to;
      }
      if (parent[other] !== unvisited) {
        throw invariantNew(`basis contains a cycle through edge ${idString(edge.id)}`);
      }
      parent[other] = node;
      parentEdge[other] = edgeIndex;
      stack.push(other);
    }
  }
  if (order.length !== nodeCount) {
    throw invariantNew('basis is disconnected');
  }

  const subtreeBalance = solver.scratch.subtreeBalance;
  for (let node = 0; node < solver.balance.length; node++) {
    guard.Step();
    subtreeBalance[node] = solver.balance[node];
  }
  const cutValue = solver.scratch.cutValue;
  cutValue.fill(0);
  for (let i = order.length - 1; i > 0; i--) {
    guard.Step();
    const node = order[i];
    const edgeIndex = parentEdge[node];
    const edge = solver.problem.edges[edgeIndex];
    const amount = subtreeBalance[node];
    if (edge.from === node) {
      cutValue[edgeIndex] = amount;
    } else if (edge.to === node) {
      let ok;
      [cutValue[edgeIndex], ok] = checkedSubInt64(0, amount);
      if (!ok) {
        throw goError('cut-value overflow');
      }
    } else {
      throw invariantNew(`malformed tree edge ${idString(edge.id)}`);
    }
    let ok;
    [subtreeBalance[parent[node]], ok] = checkedAddInt64(subtreeBalance[parent[node]], amount);
    if (!ok) {
      throw goError('subtree-balance overflow');
    }
  }
  if (subtreeBalance[0] !== 0) {
    throw invariantNew(`tree balance is ${subtreeBalance[0]}, want zero`);
  }
}

/** computeHeadComponent stores the head component of leaving in scratch.head. */
export function computeHeadComponent(solver, tree, leaving, guard) {
  const head = solver.scratch.head;
  head.fill(false);
  const start = solver.problem.edges[leaving].to;
  head[start] = true;
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    guard.Step();
    const node = queue[cursor];
    for (let i = solver.incidentStart[node]; i < solver.incidentStart[node + 1]; i++) {
      guard.Step();
      const edgeIndex = solver.incidentEdges[i];
      if (edgeIndex === leaving || !tree[edgeIndex]) {
        continue;
      }
      const edge = solver.problem.edges[edgeIndex];
      let other = edge.from;
      if (other === node) {
        other = edge.to;
      }
      if (!head[other]) {
        head[other] = true;
        queue.push(other);
      }
    }
  }
  if (queue.length === solver.problem.nodes.length) {
    throw invariantNew(`leaving edge ${idString(solver.problem.edges[leaving].id)} does not cut the tree`);
  }
}

/** certify constructs the dual flow of the final tree and returns its value. */
export function certify(solver, levels, tree, guard) {
  computeCutValues(solver, tree, guard);
  const cutValue = solver.scratch.cutValue;
  const computedBalance = solver.scratch.computedBalance;
  computedBalance.fill(0);
  let dualValue = 0;
  const edges = solver.problem.edges;
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const edge = edges[edgeIndex];
    guard.Step();
    let flow = 0;
    if (tree[edgeIndex]) {
      flow = cutValue[edgeIndex];
      if (flow < 0) {
        throw invariantNew(`final tree edge ${idString(edge.id)} has negative cut value ${flow}`);
      }
      const span = rankSpan(edge, levels);
      if (span !== RANK_MIN_SPAN) {
        throw invariantNew(`final tree edge ${idString(edge.id)} is not tight`);
      }
    }
    let ok;
    [computedBalance[edge.from], ok] = checkedAddInt64(computedBalance[edge.from], flow);
    if (ok) {
      [computedBalance[edge.to], ok] = checkedSubInt64(computedBalance[edge.to], flow);
    }
    if (!ok) {
      throw goError('certificate balance overflow');
    }
    let contribution;
    [contribution, ok] = checkedMulInt64(flow, RANK_MIN_SPAN);
    if (ok) {
      [dualValue, ok] = checkedAddInt64(dualValue, contribution);
    }
    if (!ok) {
      throw goError('dual value overflow');
    }
  }
  for (let node = 0; node < solver.balance.length; node++) {
    guard.Step();
    const want = solver.balance[node];
    if (computedBalance[node] !== want) {
      throw invariantNew(`certificate balance mismatch on node ${nodeDebugID(solver.problem.nodes[node])}: got ${computedBalance[node]}, want ${want}`);
    }
  }
  return dualValue;
}

export function rankSlack(edge, levels) {
  const span = rankSpan(edge, levels);
  const [slack, ok] = checkedSubInt64(span, RANK_MIN_SPAN);
  if (!ok) {
    throw goError('edge slack overflow');
  }
  if (slack < 0) {
    throw invariantNew(`infeasible span ${span}`);
  }
  return slack;
}

export function rankSpan(edge, levels) {
  const [span, ok] = checkedSubInt64(levels[edge.to], levels[edge.from]);
  if (!ok) {
    throw goError('edge span overflow');
  }
  return span;
}
