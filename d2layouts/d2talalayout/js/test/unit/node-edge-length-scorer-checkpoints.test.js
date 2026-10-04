import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NodeEdgeLength, EdgeLengthOptions } from '../../src/placementcost/edge-length.js';
import { NewNodeEdgeLengthScorer as NodeEdgeLengthScorer } from '../../src/placementcost/edge-length-scorer.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Cluster } from '../../src/graph/cluster.js';

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
  it('preserves every cancellation checkpoint across 129 edges and abductions', () => {
    // 1. Build a realistic 129-edge fixture equivalent to Go's newScorerFixture(129, true)
    const g = new Graph();
    const src = new Node(1n, 60, 40);
    src.TopLeft = new Point(100, 100);
    const tgt = new Node(2n, 60, 40);
    tgt.TopLeft = new Point(200, 100);
    g.addNodeUnchecked(src);
    g.addNodeUnchecked(tgt);

    const abductions = [];
    const ext = new Node(3n, 50, 50);
    ext.TopLeft = new Point(0, 0);
    g.addNodeUnchecked(ext);

    for (let i = 0; i < 129; i++) {
      const e = g.Connect(src, tgt);
      e.Label = { Text: "a very very very long main label", Width: 200, Height: 20 };
      e.TargetArrowhead = 'arrow';
      abductions.push(new EdgeAbduction({ OriginallyFrom: src, OriginallyTo: tgt, CurrentFrom: ext, CurrentTo: tgt }));
    }

    const opts = new EdgeLengthOptions({
      IncludeNodeSizes: true,
      PenalizeDirection: true,
      EnforceMinimumGap: true,
      EdgeAbductions: abductions
    });

    // 2. Measure direct check count with uncancelled context (cancelAt = 0)
    const directCtx = new CountingContext(0);
    const expectedScore = NodeEdgeLength(directCtx, src, opts);
    const checks = directCtx.count;

    assert.ok(checks > 64, `Test must cross 64-iteration polling boundary (got ${checks} checks)`);

    // 3. First Scorer Evaluation (Lazy Preparation)
    const scorer = NodeEdgeLengthScorer(src, opts);
    const firstCtx = new CountingContext(0);
    const firstScore = scorer.Score(firstCtx);

    assert.equal(firstScore, expectedScore, 'First lazy score must equal direct score exactly');
    assert.equal(firstCtx.count, checks, 'First lazy context checks must match direct checks exactly');

    // 4. Test Every Cancellation Checkpoint reusing the ALREADY PREPARED scorer
    for (let cancelAt = 1; cancelAt <= checks + 1; cancelAt++) {
      const origCtx = new CountingContext(cancelAt);
      let directErr = null;
      let directScore = 0;
      try { directScore = NodeEdgeLength(origCtx, src, opts); } catch (e) { directErr = e.message; }

      const prepCtx = new CountingContext(cancelAt);
      let prepErr = null;
      let prepScore = 0;
      try { prepScore = scorer.Score(prepCtx); } catch (e) { prepErr = e.message; }

      // 5. Exact Equality
      assert.equal(prepErr, directErr, `cancelAt ${cancelAt}: errors should match exact`);
      if (!directErr) {
        assert.equal(prepScore, directScore, `cancelAt ${cancelAt}: scores should match exact`);
      }
      assert.equal(prepCtx.count, origCtx.count, `cancelAt ${cancelAt}: Err calls should match exact`);
    }

    // 6. Close scorer
    scorer.Close();
  });

  it('TestNodeEdgeLengthScorerCanceledPreparationCanRetry', () => {
    const g = new Graph();
    const src = new Node(1n, 60, 40);
    src.TopLeft = new Point(100, 100);
    const tgt = new Node(2n, 60, 40);
    tgt.TopLeft = new Point(200, 100);
    g.addNodeUnchecked(src);
    g.addNodeUnchecked(tgt);
    for (let i = 0; i < 5; i++) g.Connect(src, tgt);

    const opts = new EdgeLengthOptions();
    const directCtx = new CountingContext(0);
    const directScore = NodeEdgeLength(directCtx, src, opts);
    const checks = directCtx.count;
    assert.ok(checks > 1, 'Need at least >1 checks to cancel during prep');

    const scorer = NodeEdgeLengthScorer(src, opts);

    // Cancel during preparation
    const cancelCtx = new CountingContext(1);
    let caught = null;
    try { scorer.Score(cancelCtx); } catch (e) { caught = e.message; }
    assert.equal(caught, 'EdgeLength: context canceled', 'Scorer should bubble up cancellation');

    // Retry with uncancelled
    const retryCtx = new CountingContext(0);
    const retryScore = scorer.Score(retryCtx);

    assert.equal(retryScore, directScore, 'Score after retry should match direct score');
    assert.equal(retryCtx.count, checks, 'Context counts after retry should match direct counts');

    scorer.Close();
  });
});
