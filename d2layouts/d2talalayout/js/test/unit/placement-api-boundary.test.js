import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as placementIndex from '../../src/placement/index.js';
import * as rootIndex from '../../src/index.js';
import { SizelessOptimizer, newSizelessOptimizer } from '../../src/placement/sizeless-optimizer.js';
import { initializeNodes, nodeCandidatePositions } from '../../src/placement/initialize.js';
import {
  optimizerMoveNodeAbs,
  optimizerSwapPositions,
  withOptimizerPositionsSwapped,
  optimizerMedian,
  optimizerAdjacents,
  optimizerDescendants,
} from '../../src/placement/optimizer-support.js';
import { captureOptimizerCandidateMovement } from '../../src/placement/candidate-movement.js';
import { compaction, candidateMoves, visibilityEdges } from '../../src/placement/compaction.js';
import { moveNodeToBest } from '../../src/placement/moves.js';

describe('Slices 42–43 — Placement Optimizer API Boundary', () => {
  it('does not export internal placement optimizer functions in placement index or root index', () => {
    const forbidden = [
      'SizelessOptimizer',
      'newSizelessOptimizer',
      'NewSizelessOptimizer',
      'initializeNodes',
      'InitializeNodes',
      'nodeCandidatePositions',
      'NodeCandidatePositions',
      'optimizerMoveNodeAbs',
      'optimizerSwapPositions',
      'withOptimizerPositionsSwapped',
      'captureOptimizerCandidateMovement',
      'optimizerMedian',
      'optimizerAdjacents',
      'optimizerDescendants',
      'COMPACTION_FACTOR',
      'PointerSnapshot',
      'moveNodeToBest',
      'visibilityEdges',
      'candidateMoves',
      'compaction',
    ];

    for (const name of forbidden) {
      assert.strictEqual(placementIndex[name], undefined, `${name} should not be in placement/index.js`);
      assert.strictEqual(rootIndex[name], undefined, `${name} should not be in root index.js`);
    }
  });

  it('allows direct imports of placement optimizer functions', () => {
    assert.strictEqual(typeof SizelessOptimizer, 'function');
    assert.strictEqual(typeof newSizelessOptimizer, 'function');
    assert.strictEqual(typeof initializeNodes, 'function');
    assert.strictEqual(typeof nodeCandidatePositions, 'function');
    assert.strictEqual(typeof optimizerMoveNodeAbs, 'function');
    assert.strictEqual(typeof optimizerSwapPositions, 'function');
    assert.strictEqual(typeof withOptimizerPositionsSwapped, 'function');
    assert.strictEqual(typeof captureOptimizerCandidateMovement, 'function');
    assert.strictEqual(typeof optimizerMedian, 'function');
    assert.strictEqual(typeof optimizerAdjacents, 'function');
    assert.strictEqual(typeof optimizerDescendants, 'function');
    assert.strictEqual(typeof compaction, 'function');
    assert.strictEqual(typeof candidateMoves, 'function');
    assert.strictEqual(typeof visibilityEdges, 'function');
    assert.strictEqual(typeof moveNodeToBest, 'function');
  });
});
