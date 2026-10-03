import { checkScoringCancellation } from './geometry.js';
import { EdgeLengthOptions, createEdgeScratch, prepareNodeEdgeLength, evaluateNodeEdgeLength } from './edge-length.js';

function wrapCountingContext(ctx, counter) {
  return {
    Err() {
      counter.count++;
      if (typeof ctx.Err === 'function') {
        return ctx.Err();
      }
      if (typeof ctx.err === 'function') {
        return ctx.err();
      }
      return null;
    },
    err() {
      counter.count++;
      if (typeof ctx.err === 'function') {
        return ctx.err();
      }
      if (typeof ctx.Err === 'function') {
        return ctx.Err();
      }
      return null;
    },
  };
}

/**
 * NodeEdgeLengthScorer reuses incident-edge topology during one candidate sweep.
 * Geometry is read from live nodes on every Score.
 * Pinned Go: placementcost.NodeEdgeLengthScorer
 */
export class NodeEdgeLengthScorer {
  constructor(node, options = {}) {
    this.node = node;
    this.options = options instanceof EdgeLengthOptions ? options : new EdgeLengthOptions(options);
    this.scratch = null;
    this.setup = null;
    this.prepChecks = 0;
  }

  score(ctx) {
    const cancelErr = checkScoringCancellation(ctx);
    if (cancelErr != null) {
      throw cancelErr;
    }
    if (this.node == null) {
      throw new Error("EdgeLength: scorer is closed");
    }
    if (this.scratch == null) {
      const s = createEdgeScratch();
      this.scratch = s;
      const counter = { count: 0 };
      const countingCtx = wrapCountingContext(ctx, counter);
      try {
        const setup = prepareNodeEdgeLength(countingCtx, this.node, this.options, s);
        this.setup = setup;
        this.prepChecks = counter.count;
      } catch (err) {
        this.scratch = null;
        throw err;
      }
    } else {
      for (let i = 0; i < this.prepChecks; i++) {
        const err = checkScoringCancellation(ctx);
        if (err != null) {
          throw err;
        }
      }
    }
    return evaluateNodeEdgeLength(ctx, this.node, this.options, this.scratch, this.setup);
  }

  Score(ctx) {
    return this.score(ctx);
  }

  close() {
    this.node = null;
    this.options = null;
    this.scratch = null;
    this.setup = null;
    this.prepChecks = 0;
  }

  Close() {
    this.close();
  }
}

export function newNodeEdgeLengthScorer(node, options = {}) {
  return new NodeEdgeLengthScorer(node, options);
}

export const NewNodeEdgeLengthScorer = newNodeEdgeLengthScorer;
