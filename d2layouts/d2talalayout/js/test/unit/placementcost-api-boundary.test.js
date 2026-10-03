import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as placementCostIndex from '../../src/placementcost/index.js';
import * as rootIndex from '../../src/index.js';
import { NodeEdgeLength } from '../../src/placementcost/edge-length.js';
import { AxisScore } from '../../src/placementcost/axis.js';
import { NodeEdgeLengthScorer } from '../../src/placementcost/edge-length-scorer.js';
import { clusterExactlyTwoExternalConnectedNodes } from '../../src/placementcost/cluster.js';
import { flowContinuityCost } from '../../src/placementcost/flow-continuity.js';

describe('Slice 41 — API Boundary', () => {
  it('does not export internal placementcost kernel functions in placementcost index or root index', () => {
    const forbidden = [
      'NodeEdgeLength',
      'NodesEdgeLength',
      'NodeSymmetry',
      'AxisScore',
      'NodeEdgeLengthScorer',
      'NewNodeEdgeLengthScorer',
      'EdgeLengthOptions',
      'clusterExactlyTwoExternalConnectedNodes',
      'flowContinuityCost'
    ];

    for (const name of forbidden) {
      assert.strictEqual(placementCostIndex[name], undefined, `${name} should not be in placementcost/index.js`);
      assert.strictEqual(rootIndex[name], undefined, `${name} should not be in root index.js`);
    }
  });

  it('allows direct imports of placementcost kernel functions', () => {
    assert.strictEqual(typeof NodeEdgeLength, 'function');
    assert.strictEqual(typeof AxisScore, 'function');
    assert.strictEqual(typeof NodeEdgeLengthScorer, 'function');
    assert.strictEqual(typeof clusterExactlyTwoExternalConnectedNodes, 'function');
    assert.strictEqual(typeof flowContinuityCost, 'function');
  });
});
