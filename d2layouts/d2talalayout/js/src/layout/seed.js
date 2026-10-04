// Slice 50 — seed inputs and single-seed execution.
//
// Pinned reference: d2layouts/d2talalayout/seedgraph.go. The JS public
// contract is ELK JSON (ADR-001), so the seed input is the already-translated
// internal graph; there are no D2 bindings.

import { getContextError } from '../limits/work-context.js';
import { Layout, LayoutOptions } from '../engine/pipeline.js';

export class SeedInput {
  constructor(graph) {
    this.graph = graph;
  }
}

/**
 * newSeedInput establishes the immutable seed input. Every attempt clones it
 * inside engine.Layout, so one input serves all configured seeds.
 */
export function newSeedInput(ctx, graph) {
  const err = getContextError(ctx);
  if (err != null) throw err;
  return new SeedInput(graph);
}

/** runSeed runs one deterministic engine layout for `seed` (signed int64 BigInt). */
export function runSeed(ctx, input, seed) {
  if (input == null || input.graph == null) {
    throw new Error('TALA seed graph is empty');
  }
  const err = getContextError(ctx);
  if (err != null) throw err;
  return Layout(ctx, input.graph, new LayoutOptions({ Seed: seed }));
}
