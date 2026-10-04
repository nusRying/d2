// Slice 50 — the public ELK-JSON layout entry point.
//
// Pinned reference: d2layouts/d2talalayout/layout.go (Layout). The public
// contract is ELK-compatible JSON (ADR-001): the D2 adapter/patch layer is
// replaced by elkToTalaGraph / talaToElkGraph. The input object is never
// mutated and a new plain JSON-serializable ELK object is returned.

import { elkToTalaGraph, talaToElkGraph } from '../elk/adapter.js';
import { abortSignalWorkContext, backgroundWorkContext, getContextError } from '../limits/work-context.js';
import { CompoundCandidate } from '../engine/compound-candidate.js';
import { PreserveCompoundRoutes } from '../engine/compound-routes.js';
import { CancelChildContext, contextHasNoDone } from '../engine/pipeline.js';
import { layoutPlan } from './options.js';
import { newSeedInput } from './seed.js';
import { considerSeedCandidate, isPanicLike, refineSeedResult, runLocalSeeds } from './coordinator.js';
import { evaluateSeedResult } from './result.js';
import { validateCompletedGraph } from './result-validation.js';

export const INTERNAL_INVARIANT_LAYOUT_MESSAGE = 'TALA layout failed due to an internal invariant';

function contextFromOptions(options) {
  const signal = options != null && typeof options === 'object' ? options.signal : undefined;
  if (signal === undefined || signal === null) {
    return backgroundWorkContext();
  }
  if (typeof signal !== 'object' || typeof signal.aborted !== 'boolean') {
    throw new Error('TALA layout option "signal" must be an AbortSignal');
  }
  return abortSignalWorkContext(signal);
}

/**
 * layoutWithContext performs the complete layout for an explicit WorkContext
 * (internal tests); the public API is the async `layout`.
 */
export async function layoutWithContext(ctx, elkGraph, options) {
  let err = getContextError(ctx);
  if (err != null) throw err;
  if (elkGraph == null || typeof elkGraph !== 'object') {
    throw new Error('tala requires an ELK graph object');
  }
  const { seeds, concurrency } = layoutPlan(options);
  const graph = elkToTalaGraph(elkGraph);
  const input = newSeedInput(ctx, graph);

  let workCtx = ctx;
  let child = null;
  if (contextHasNoDone(ctx)) {
    child = new CancelChildContext(ctx);
    workCtx = child;
  }
  try {
    let best = await runLocalSeeds(workCtx, input, seeds, concurrency);
    const ordinary = best;
    best = considerSeedCandidate(workCtx, best, () => {
      const candidate = CompoundCandidate(workCtx, best.graph);
      if (candidate === best.graph) return best;
      return evaluateSeedResult(workCtx, input, candidate);
    });
    if (best.graph !== ordinary.graph) {
      const selected = best;
      best = refineSeedResult(workCtx, selected, () => {
        const candidate = PreserveCompoundRoutes(workCtx, ordinary.graph, selected.graph);
        return evaluateSeedResult(workCtx, input, candidate);
      });
    }
    validateCompletedGraph(workCtx, best.graph);
    err = getContextError(workCtx);
    if (err != null) throw new Error(`TALA layout canceled before apply: ${err.message}`, { cause: err });
    const output = talaToElkGraph(best.graph);
    err = getContextError(workCtx);
    if (err != null) throw new Error(`TALA layout canceled before apply: ${err.message}`, { cause: err });
    return output;
  } finally {
    if (child != null) child.cancel();
  }
}

/**
 * layout lays out an ELK-compatible JSON graph and resolves to a NEW
 * ELK-compatible JSON graph.
 *
 * @param {object} elkGraph ELK JSON graph (not mutated)
 * @param {{seed?: number|bigint|string, seeds?: Array<number|bigint|string>, maxConcurrency?: number, signal?: AbortSignal}} [options]
 */
export async function layout(elkGraph, options = {}) {
  try {
    const ctx = contextFromOptions(options);
    return await layoutWithContext(ctx, elkGraph, options ?? {});
  } catch (err) {
    if (isPanicLike(err)) {
      throw new Error(INTERNAL_INVARIANT_LAYOUT_MESSAGE, { cause: err });
    }
    throw err;
  }
}
