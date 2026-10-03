import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NodeEdgeLength, EdgeLengthOptions } from '../../src/placementcost/edge-length.js';
import { NewNodeEdgeLengthScorer as NodeEdgeLengthScorer } from '../../src/placementcost/edge-length-scorer.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';

class CountingContext {
  constructor(cancelAt) {
    this.cancelAt = cancelAt;
    this.count = 0;
  }
  Err() {
    this.count++;
    if (this.cancelAt > 0 && this.count >= this.cancelAt) {
      return new Error('context canceled');
    }
    return null;
  }
}

describe('NodeEdgeLengthScorer Checkpoints', () => {
  it('scorer direct vs prepared cancellation parity', () => {
    // Topologically exactly what go_node_placement_cost_oracle_test.go uses
    const cancelPoints = [1, 5, 60, 64, 65, 100];
    
    for (const cancelAt of cancelPoints) {
      const g = new Graph();
      const src = new Node(1n, 60, 40);
      src.TopLeft = new Point(100, 100);
      const tgt = new Node(2n, 60, 40);
      tgt.TopLeft = new Point(200, 100);
      g.addNodeUnchecked(src);
      g.addNodeUnchecked(tgt);
      g.Connect(src, tgt);

      const opts = new EdgeLengthOptions();

      const ctxDirect = new CountingContext(cancelAt);
      let errDirect = null;
      let scoreDirect = 0;
      try {
        scoreDirect = NodeEdgeLength(ctxDirect, src, opts);
      } catch (e) {
        errDirect = e.message;
      }

      const ctxPrepared = new CountingContext(cancelAt);
      let errPrepared = null;
      let scorePrepared = 0;
      
      try {
        const scorer = NodeEdgeLengthScorer(src, opts);
        try {
          scorePrepared = scorer.Score(ctxPrepared);
        } catch (e) {
          errPrepared = e.message;
        } finally {
          scorer.Close();
        }
      } catch (e) {
        errPrepared = e.message;
      }

      assert.equal(errPrepared, errDirect, `cancelAt ${cancelAt}: errors should match`);
      if (!errDirect) {
        assert.ok(Math.abs(scorePrepared - scoreDirect) < 1e-9, `cancelAt ${cancelAt}: scores should match`);
      }
      
      // The number of Err calls should be very similar.
      assert.equal(ctxPrepared.count, ctxDirect.count, `cancelAt ${cancelAt}: Err calls should match exactly`);
    }
  });
});
