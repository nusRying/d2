import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { checkScoringCancellation } from '../../src/placementcost/geometry.js';
import { NodeEdgeLength } from '../../src/placementcost/edge-length.js';
import { NewNodeEdgeLengthScorer as NodeEdgeLengthScorer } from '../../src/placementcost/edge-length-scorer.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';

describe('Direct Context Error Tests', () => {
  const g = new Graph();
  const src = new Node(1n, 60, 40);
  src.TopLeft = new Point(100, 100);
  const tgt = new Node(2n, 60, 40);
  tgt.TopLeft = new Point(200, 100);
  g.addNodeUnchecked(src);
  g.addNodeUnchecked(tgt);
  g.Connect(src, tgt);

  const testCases = [
    { name: 'context canceled', err: new Error('context canceled'), expected: 'EdgeLength: context canceled' },
    { name: 'context deadline exceeded', err: new Error('context deadline exceeded'), expected: 'EdgeLength: context deadline exceeded' },
    { name: 'oracle custom context error', err: new Error('oracle custom context error'), expected: 'EdgeLength: oracle custom context error' },
  ];

  for (const tc of testCases) {
    it(`NodeEdgeLength - ${tc.name}`, () => {
      const ctx = { Err: () => tc.err };
      let caught = null;
      try { NodeEdgeLength(ctx, src, {}); } catch (e) { caught = e.message; }
      assert.equal(caught, tc.expected);
    });

    it(`NodeEdgeLengthScorer - ${tc.name}`, () => {
      const ctx = { Err: () => tc.err };
      let caught = null;
      try {
        const scorer = NodeEdgeLengthScorer(src, {});
        try { scorer.Score(ctx); } catch (e) { caught = e.message; }
      } catch (e) { caught = e.message; }
      assert.equal(caught, tc.expected);
    });
  }

  it('null context -> TypeError', () => {
    assert.throws(() => NodeEdgeLength(null, src, {}), TypeError);
    assert.throws(() => checkScoringCancellation(null), TypeError);
  });

  it('{} context -> TypeError', () => {
    assert.throws(() => NodeEdgeLength({}, src, {}), TypeError);
    assert.throws(() => checkScoringCancellation({}), TypeError);
  });
});
