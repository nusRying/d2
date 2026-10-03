/**
 * Bounded, iterative tree-preprocessing helpers.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/preprocess_helpers.go
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *
 * Conventions: Go (value, error) returns become a returned value or a thrown
 * Error; WorkGuard Step/Check/Finish throw. Every guard call is made in the
 * same order and count as pinned Go. Explicit stacks replace recursion.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { invariantError } from './layoutgraph-support.js';
import { Undirected, Outwards, Inwards, Bidirectional, treeEdgeDirection } from './types.js';
import { addIncidentEdgeUnchecked } from '../graph/structural-access.js';

export const treePreprocessLocation = 'PreprocessTrees';

export function treePreprocessBadState(reason) {
  return invariantError(reason);
}

function containerChildren(g, container) {
  return g.Containers.get(container) ?? [];
}

/**
 * treeContainerRDFSOrder is the bounded, iterative equivalent of
 * containerRDFSOrder. The stack is populated in forward slice order so its
 * LIFO traversal preserves the existing reverse-DFS output order exactly.
 * Go returns nil for a non-container root; JS returns null.
 */
export function treeContainerRDFSOrder(g, root, guard) {
  if (root != null && !root.IsContainer()) {
    return null;
  }

  const stack = [];
  for (const child of containerChildren(g, root)) {
    guard.Step();
    stack.push({ node: child, emit: false });
  }

  const order = [];
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current.node == null) {
      throw treePreprocessBadState('tree preprocessing encountered a nil container child');
    }
    if (current.emit) {
      order.push(current.node);
      continue;
    }

    if (current.node.IsContainer()) {
      stack.push({ node: current.node, emit: true });
      for (const child of containerChildren(g, current.node)) {
        guard.Step();
        stack.push({ node: child, emit: false });
      }
      continue;
    }

    if (current.node.IsClusterVessel()) {
      const cluster = g.Clusters.get(current.node);
      if (cluster == null) {
        throw treePreprocessBadState(`cluster vessel ${current.node.ID} has no cluster record`);
      }
      for (const clusterNode of cluster.Nodes ?? []) {
        guard.Step();
        if (clusterNode == null) {
          throw treePreprocessBadState(`cluster vessel ${current.node.ID} contains a nil node`);
        }
        if (clusterNode.IsContainer()) {
          stack.push({ node: clusterNode, emit: false });
        }
      }
    }
  }
  return order;
}

/** buildTreeAdjacencyMatrix returns edgeBetween(a, b) (null when absent). */
export function buildTreeAdjacencyMatrix(g, guard) {
  const fromNodeToToNodeToEdge = new Map();
  for (const edge of g.Edges) {
    guard.Step();
    if (edge == null || edge.From == null || edge.To == null) {
      throw treePreprocessBadState('tree preprocessing encountered an edge with missing endpoints');
    }
    let inner = fromNodeToToNodeToEdge.get(edge.From);
    if (inner === undefined) {
      inner = new Map();
      fromNodeToToNodeToEdge.set(edge.From, inner);
    }
    inner.set(edge.To, edge);
  }
  return (a, b) => {
    const forward = fromNodeToToNodeToEdge.get(a);
    if (forward !== undefined && forward.has(b)) {
      return forward.get(b);
    }
    const backward = fromNodeToToNodeToEdge.get(b);
    if (backward !== undefined && backward.has(a)) {
      return backward.get(a);
    }
    return null;
  };
}

export function treeFringeNodes(nodes, guard) {
  const inSet = new Set();
  for (const node of nodes) {
    guard.Step();
    if (node == null) {
      throw treePreprocessBadState('tree preprocessing encountered a nil node');
    }
    inSet.add(node);
  }

  const fringeNodes = [];
  for (const node of nodes) {
    guard.Step();
    if (node.Edges.length !== 1) {
      continue;
    }
    const edge = node.Edges[0];
    if (edge == null || (edge.From !== node && edge.To !== node)) {
      throw treePreprocessBadState(`node ${node.ID} contains a non-incident fringe edge`);
    }
    const adjacent = node.adjacent(edge);
    if (inSet.has(adjacent)) {
      fringeNodes.push(node);
    }
  }
  return fringeNodes;
}

/** terminals: Map/Set keyed by Node; only key presence matters (Go map lookup). */
export function filterTerminalTrees(trees, terminals, guard) {
  const filtered = [];
  for (const tree of trees) {
    guard.Step();
    if (tree == null || tree.Node == null) {
      throw treePreprocessBadState('tree preprocessing encountered a tree without a node');
    }
    if (!terminals.has(tree.Node)) {
      filtered.push(tree);
    }
  }
  return filtered;
}

/**
 * dominantTreeEdgeDirection preserves the recursive helper's preorder search:
 * the first non-undirected sentinel direction wins, otherwise the root's
 * undirected direction is returned.
 */
export function dominantTreeEdgeDirection(root, includeRoot, guard) {
  if (root == null || root.Node == null) {
    throw treePreprocessBadState('tree preprocessing encountered an incomplete tree');
  }
  if (root.SentinelEdge == null) {
    throw treePreprocessBadState(`tree node ${root.Node.ID} has no sentinel edge`);
  }

  const stack = [];
  if (includeRoot) {
    stack.push(root);
  } else {
    for (let i = root.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(root.Children[i]);
    }
  }
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null || current.SentinelEdge == null) {
      throw treePreprocessBadState('tree preprocessing encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a repeated tree node');
    }
    seen.add(current);
    const direction = treeEdgeDirection(current.Node, current.SentinelEdge);
    if (direction !== Undirected) {
      return direction;
    }
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
  return treeEdgeDirection(root.Node, root.SentinelEdge);
}

/** countTreeDirections → Map<direction, count> in first-seen order. */
export function countTreeDirections(trees, guard) {
  const directionCounts = new Map();
  for (const tree of trees) {
    guard.Step();
    const direction = dominantTreeEdgeDirection(tree, true, guard);
    directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1);
  }
  return directionCounts;
}

export function candidateTreeRoots(roots, guard) {
  const rootsByDirection = new Map();
  for (const root of roots) {
    guard.Step();
    const direction = dominantTreeEdgeDirection(root, false, guard);
    let list = rootsByDirection.get(direction);
    if (list === undefined) {
      list = [];
      rootsByDirection.set(direction, list);
    }
    list.push(root);
  }

  const group = (direction) => rootsByDirection.get(direction) ?? [];
  const nOutwards = group(Outwards).length;
  const nInwards = group(Inwards).length;
  const nBidirectional = group(Bidirectional).length;
  const nUndirected = group(Undirected).length;
  const candidates = [];
  const appendRoots = (values) => {
    for (const value of values) {
      guard.Step();
      candidates.push(value);
    }
  };
  if (nOutwards === 1 && 1 + nInwards + nUndirected === roots.length) {
    appendRoots(group(Outwards));
  }
  if (nInwards === 1 && 1 + nOutwards + nUndirected === roots.length) {
    appendRoots(group(Inwards));
  }
  if (nUndirected > 0 && nOutwards > 1 && nUndirected + nOutwards === roots.length) {
    appendRoots(group(Undirected));
  }
  if (nUndirected > 0 && nInwards > 1 && nUndirected + nInwards === roots.length) {
    appendRoots(group(Undirected));
  }
  if (nBidirectional + nUndirected === roots.length) {
    appendRoots(group(Bidirectional));
    appendRoots(group(Undirected));
  }
  guard.Check();
  return candidates;
}

/** treeEndOfLine returns the leaf of a non-branching chain, or null when it branches. */
export function treeEndOfLine(root, guard) {
  const seen = new Set();
  let current = root;
  for (;;) {
    guard.Step();
    if (current == null) {
      throw treePreprocessBadState('tree preprocessing encountered a nil tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a tree cycle');
    }
    seen.add(current);
    switch (current.Children.length) {
      case 0:
        return current;
      case 1:
        current = current.Children[0];
        break;
      default:
        return null;
    }
  }
}

export function removeTreeChild(parent, child, guard) {
  const filtered = [];
  for (const current of parent.Children) {
    guard.Step();
    if (current !== child) {
      filtered.push(current);
    }
  }
  parent.Children = filtered;
}

export function addTreeChild(parent, child, guard) {
  if (parent == null || child == null) {
    throw treePreprocessBadState('tree preprocessing cannot connect a nil tree');
  }
  if (child.Parent != null) {
    removeTreeChild(child.Parent, child, guard);
  }
  guard.Step();
  child.Parent = parent;
  parent.Children.push(child);
}

export function reverseTreeChain(root, guard) {
  if (root == null) {
    throw treePreprocessBadState('tree preprocessing cannot reverse a nil tree');
  }
  const chain = [root];
  const seen = new Set();
  let current = root;
  while (current.Children.length > 0) {
    guard.Step();
    if (current.Children.length !== 1) {
      throw treePreprocessBadState('tree preprocessing attempted to reverse a branching tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a tree cycle');
    }
    seen.add(current);
    const next = current.Children[0];
    if (next == null) {
      throw treePreprocessBadState('tree preprocessing encountered a nil tree child');
    }
    current.SentinelEdge = next.SentinelEdge;
    next.SentinelEdge = null;
    removeTreeChild(current, next, guard);
    chain.push(next);
    current = next;
  }
  for (let i = chain.length - 1; i > 0; i--) {
    addTreeChild(chain[i], chain[i - 1], guard);
  }
}

export function treeBranches(root, guard) {
  const seen = new Set();
  let current = root;
  for (;;) {
    guard.Step();
    if (current == null) {
      throw treePreprocessBadState('tree preprocessing encountered a nil tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a tree cycle');
    }
    seen.add(current);
    switch (current.Children.length) {
      case 0:
        return false;
      case 1:
        current = current.Children[0];
        break;
      default:
        return true;
    }
  }
}

export function treeSize(root, guard) {
  if (root == null) {
    throw treePreprocessBadState('tree preprocessing cannot size a nil tree');
  }
  const stack = [root];
  const seen = new Set();
  let size = 0;
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree preprocessing encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a repeated tree node');
    }
    seen.add(current);
    size++;
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
  return size;
}

export function treeDescendants(root, guard) {
  if (root == null) {
    throw treePreprocessBadState('tree preprocessing cannot traverse a nil tree');
  }
  const descendants = [];
  const queue = [root];
  const seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    guard.Step();
    const current = queue[index];
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree preprocessing encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a repeated tree node');
    }
    seen.add(current);
    for (const child of current.Children) {
      guard.Step();
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

/**
 * rootsByTreeDirection → Map<direction, Tree[]>. JS Map iteration follows the
 * first root of each direction; Go map iteration order is unspecified.
 */
export function rootsByTreeDirection(treeRoots, guard) {
  const rootsByDirection = new Map();
  for (const root of treeRoots) {
    guard.Step();
    const direction = dominantTreeEdgeDirection(root, false, guard);
    let list = rootsByDirection.get(direction);
    if (list === undefined) {
      list = [];
      rootsByDirection.set(direction, list);
    }
    list.push(root);
  }
  return rootsByDirection;
}

export function removeNodeFromGraph(node, graph, guard) {
  if (graph.Nodes.length === 0) {
    throw treePreprocessBadState(`node ${node.ID} is missing from the graph`);
  }
  const newNodes = [];
  let found = false;
  for (const current of graph.Nodes) {
    guard.Step();
    if (current === node) {
      found = true;
      continue;
    }
    newNodes.push(current);
  }
  if (!found) {
    throw treePreprocessBadState(`node ${node.ID} is missing from the graph`);
  }
  graph.Nodes = newNodes;
}

/** Removes the first occurrence in place (Go append(s[:i], s[i+1:]...)). */
export function removeEdgeFromNode(node, edge, guard) {
  const edges = node.Edges;
  for (let i = 0; i < edges.length; i++) {
    guard.Step();
    if (edges[i] === edge) {
      edges.splice(i, 1);
      return;
    }
  }
  throw treePreprocessBadState(`edge ${edge.ID} is missing from node ${node.ID}`);
}

export function disconnectTreeEdge(graph, edge, guard) {
  if (edge == null || edge.From == null || edge.To == null) {
    throw treePreprocessBadState('tree preprocessing cannot disconnect an incomplete edge');
  }
  removeEdgeFromNode(edge.From, edge, guard);
  if (edge.To !== edge.From) {
    removeEdgeFromNode(edge.To, edge, guard);
  } else {
    // Disconnect historically calls removeEdge for each endpoint even on a
    // self-loop. Preserve the second removal only when a duplicate exists.
    for (const current of edge.To.Edges) {
      guard.Step();
      if (current === edge) {
        removeEdgeFromNode(edge.To, edge, guard);
        break;
      }
    }
  }

  const newEdges = [];
  let found = false;
  for (const current of graph.Edges) {
    guard.Step();
    if (current === edge) {
      found = true;
      continue;
    }
    newEdges.push(current);
  }
  if (!found) {
    throw treePreprocessBadState(`edge ${edge.ID} is missing from the graph`);
  }
  graph.Edges = newEdges;
}

export function removeNodeFromContainer(graph, container, node, guard) {
  const filtered = [];
  let found = false;
  for (const current of containerChildren(graph, container)) {
    guard.Step();
    if (current === node) {
      found = true;
      continue;
    }
    filtered.push(current);
  }
  if (!found) {
    throw treePreprocessBadState(`node ${node.ID} is missing from its tree container`);
  }
  graph.Containers.set(container, filtered);
}

export function reconnectTreeGuarded(g, tree, container, guard) {
  if (tree == null) {
    throw treePreprocessBadState('tree preprocessing cannot reconnect a nil tree');
  }
  const stack = [tree];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree preprocessing encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree preprocessing encountered a repeated tree node');
    }
    seen.add(current);

    if (current.Parent != null) {
      const edge = current.SentinelEdge;
      if (edge == null || edge.From == null || edge.To == null) {
        throw treePreprocessBadState(`tree node ${current.Node.ID} has no complete sentinel edge`);
      }
      g.AddNodeUnchecked(current.Node);
      g.AddNodeToContainer(container, current.Node);
      addIncidentEdgeUnchecked(edge.From, edge);
      addIncidentEdgeUnchecked(edge.To, edge);
      g.Edges.push(edge);
      guard.Step();
    }

    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
}

export function isIsolatedTreeGuarded(g, node, guard) {
  if (node == null) {
    throw treePreprocessBadState('tree preprocessing encountered a nil tree sentinel');
  }
  if (node.IsContainer()) {
    return false;
  }
  const roots = g.Trees.get(node) ?? [];
  for (const edge of node.Edges) {
    guard.Step();
    let isToTree = false;
    for (const root of roots) {
      guard.Step();
      if (root != null && edge === root.SentinelEdge) {
        isToTree = true;
        break;
      }
    }
    if (!isToTree) {
      return false;
    }
  }
  return true;
}

// buildNodeToTreeGuarded: the trees package copy is identical (messages,
// guard order) to the shared structural-access.js port, which is reused.
export { buildNodeToTreeGuarded } from '../graph/structural-access.js';
