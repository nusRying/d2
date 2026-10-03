// Slice 46 — CombineSubgraphs position snapshots.
// Pinned reference: d2layouts/d2talalayout/internal/packing/combine_snapshot.go

import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_NODES, MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { snapshotPoint } from './snapshot.js';

/** restoreCombineNodePositions */
export function restoreCombineNodePositions(snapshots) {
  for (const snapshot of snapshots) {
    snapshot.node.TopLeft = snapshot.topLeft.restore();
  }
}

/**
 * snapshotCombineNodePositions captures every position that CombineSubgraphs
 * can translate while preserving each point's exact identity (breadth-first
 * over containers, clusters and sequences, never recursive).
 */
export function snapshotCombineNodePositions(ctx, nodes) {
  const guard = new WorkGuard(ctx, 'CombineSubgraphs', MAX_ENGINE_WORK_UNITS);
  const seen = new Set();
  const snapshots = [];
  const queue = [];
  const enqueue = (node, graph) => {
    if (node == null) {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error(`TALA CombineSubgraphs unique node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    guard.Step();
    seen.add(node);
    snapshots.push({ node, topLeft: snapshotPoint(node.TopLeft) });
    queue.push({ node, graph });
  };
  for (const node of nodes) {
    if (node != null) {
      enqueue(node, node.Graph);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.graph == null) {
      continue;
    }
    const node = current.node;
    if (node.isContainer) {
      for (const child of current.graph.Containers?.get(node) ?? []) {
        enqueue(child, current.graph);
      }
    }
    if (node.isClusterVessel) {
      const cluster = current.graph.Clusters?.get(node) ?? null;
      if (cluster != null) {
        for (const child of cluster.Nodes ?? []) {
          enqueue(child, current.graph);
        }
      }
    }
    const sequence = current.graph.Sequences?.get(node) ?? null;
    if (sequence != null) {
      for (const child of sequence.Nodes ?? []) {
        enqueue(child, current.graph);
      }
    }
  }
  guard.Finish();
  return snapshots;
}
