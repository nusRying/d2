import { Orientation } from '../geometry/orientation.js';

/**
 * Tree represents a rooted tree structure in layoutgraph.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/tree.go
 */
export class Tree {
  Node = null;
  Parent = null;
  Children = [];
  SentinelEdge = null;
  Orientation = Orientation.NONE;

  constructor(node = null) {
    this.Node = node;
    this.Parent = null;
    this.Children = [];
    this.SentinelEdge = null;
    this.Orientation = Orientation.NONE;
  }

  /**
   * isSentinelEdgeSource returns true when the tree's node is the source of SentinelEdge.
   */
  isSentinelEdgeSource() {
    return this.SentinelEdge != null && this.SentinelEdge.From === this.Node;
  }

  IsSentinelEdgeSource() {
    return this.isSentinelEdgeSource();
  }

  /**
   * sentinelNode returns the other endpoint of SentinelEdge.
   * If SentinelEdge.From === tree.Node, returns SentinelEdge.To, otherwise SentinelEdge.From.
   * Do not infer direction from edge arrows.
   */
  sentinelNode() {
    if (this.SentinelEdge == null) {
      return null;
    }
    if (this.isSentinelEdgeSource()) {
      return this.SentinelEdge.To;
    }
    return this.SentinelEdge.From;
  }

  SentinelNode() {
    return this.sentinelNode();
  }
}

export function newTree(node) {
  return new Tree(node);
}

export function NewTree(node) {
  return new Tree(node);
}
