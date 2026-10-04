import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as placementIndex from '../../src/placement/index.js';
import * as rootIndex from '../../src/internal.js';
import { SizelessOptimizer, newSizelessOptimizer } from '../../src/placement/sizeless-optimizer.js';
import { initializeNodes, nodeCandidatePositions } from '../../src/placement/initialize.js';
import {
  optimizerMoveNodeAbs,
  optimizerSwapPositions,
  withOptimizerPositionsSwapped,
  optimizerMedian,
  optimizerAdjacents,
  optimizerDescendants,
  optimizerDoesOverlap,
  optimizerIsOccupied,
  optimizerCanMove,
} from '../../src/placement/optimizer-support.js';
import { captureOptimizerCandidateMovement } from '../../src/placement/candidate-movement.js';
import { compaction, candidateMoves, visibilityEdges } from '../../src/placement/compaction.js';
import { moveNodeToBest } from '../../src/placement/moves.js';
import { transpose, rotateAround } from '../../src/placement/transpose.js';
import {
  alignConnectedNodes,
  alignVessel,
  optimizeCluster,
  optimizeClusters,
} from '../../src/placement/cluster-optimization.js';
import {
  gapNormalization,
  reduceGapToNeighbors,
  isBetween,
  nearestBetween,
  nearestConnectedAhead,
} from '../../src/placement/gap-reduction.js';
import {
  SizedOptimizer,
  newSizedOptimizer,
  iterPlacementsAroundPoint,
  withHubSpokesSuppressed,
} from '../../src/placement/sized-optimizer.js';
import { normalizeGaps, transposeAll } from '../../src/placement/placement-stages.js';
import { chargeOptimizerTranspose } from '../../src/placement/optimizer-support.js';
import { alignAxes, alignmentDeltas, tryMove, attemptShift } from '../../src/placement/alignment.js';
import {
  DirectionCounts,
  edgeDirectionCounts,
  compareDirectionCounts,
  containerEdgeDirections,
  hasFixedDescendant,
  mirrorAxes,
  direct,
} from '../../src/placement/direct.js';
import { swapPositions, smartSwapPositions, swapOptimize } from '../../src/placement/swap.js';
import { equidistance, Equidistance, equidistanceNodeGuarded } from '../../src/placement/equidistance.js';
import { dejitter, Dejitter } from '../../src/placement/dejitter.js';
import { balanceSymmetry, BalanceSymmetry, isSimple } from '../../src/placement/symmetry.js';
import { align, Align, swap, Swap } from '../../src/placement/stage-wrappers.js';
import { nodesCenter } from '../../src/placement/stage-support.js';
import { place, Place, prepare, Prepare, placeNodes, placeNodesOrthogonally } from '../../src/placement/structural-placement.js';
import {
  orientationContext, orientSourceInterior, interiorFlow, orientationFootprintSize, orientationFitsContainer,
} from '../../src/placement/container-orientation.js';
import { joinDistancedClusters } from '../../src/grouping/join.js';
import {
  OptimizerSpatialIndex,
  indexedCanMove,
  indexedIsOccupied,
  indexedDoesOverlap,
} from '../../src/placement/optimizer-spatial-index.js';

describe('Slices 42–46 — Placement Optimizer API Boundary', () => {
  it('does not export internal placement optimizer functions in placement index or root index', () => {
    const forbidden = [
      // Slice 42-43
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
      'optimizerDoesOverlap',
      'optimizerIsOccupied',
      'optimizerCanMove',
      'COMPACTION_FACTOR',
      'PointerSnapshot',
      'moveNodeToBest',
      'visibilityEdges',
      'candidateMoves',
      'compaction',
      // Slice 44
      'Transaction',
      'TransactionOptions',
      'InvalidCandidateError',
      'NonImprovingCandidateError',
      'ErrInvalidCandidate',
      'ErrNonImprovingCandidate',
      'transpose',
      'Transpose',
      'rotateAround',
      'RotateAround',
      'alignConnectedNodes',
      'AlignConnectedNodes',
      'alignVessel',
      'AlignVessel',
      'optimizeCluster',
      'OptimizeCluster',
      'optimizeClusters',
      'OptimizeClusters',
      'gapNormalization',
      'GapNormalization',
      'reduceGapToNeighbors',
      'ReduceGapToNeighbors',
      'isBetween',
      'IsBetween',
      'nearestBetween',
      'NearestBetween',
      'nearestConnectedAhead',
      'NearestConnectedAhead',
      'OptimizerSpatialIndex',
      'indexedCanMove',
      'indexedIsOccupied',
      'indexedDoesOverlap',
      // Slice 45 sized optimizer internals
      'SizedOptimizer',
      'sizedOptimizer',
      'newSizedOptimizer',
      'NewSizedOptimizer',
      'iterPlacementsAroundPoint',
      'withHubSpokesSuppressed',
      'medianPointGuarded',
      'protrudingChildrenGuarded',
      'findClosestUnoccupiedDistanceGuarded',
      'findUnoccupiedGuarded',
      'isPointOccupiedGuarded',
      'fillPlacementPointsGuarded',
      'moveNodeToBestGuarded',
      'bestSwapCandidateGuarded',
      'syncHerdFencesGuarded',
      'chargeOptimizerTranspose',
      'MAX_OPTIMIZER_PLACEMENT_CANDIDATES',
      // Slice 45 stage wrappers stay internal until Place exists (Slice 46)
      'normalizeGaps',
      'NormalizeGaps',
      'transposeAll',
      'TransposeAll',
      // Slice 46 placement stages stay internal (structural placement wires them)
      'alignAxes',
      'alignmentDeltas',
      'tryMove',
      'attemptShift',
      'DirectionCounts',
      'edgeDirectionCounts',
      'compareDirectionCounts',
      'containerEdgeDirections',
      'hasFixedDescendant',
      'mirrorAxes',
      'direct',
      'swapPositions',
      'smartSwapPositions',
      'swapOptimize',
      'equidistance',
      'Equidistance',
      'equidistanceNodeGuarded',
      'dejitter',
      'Dejitter',
      'balanceSymmetry',
      'BalanceSymmetry',
      'isSimple',
      'align',
      'Align',
      'swap',
      'Swap',
      'containerAlignmentCost',
      'nonCenterPortCostValue',
      'nodesCenter',
      'place',
      'Place',
      'prepare',
      'Prepare',
      'placeNodes',
      'PlaceNodes',
      'placeNodesOrthogonally',
      'orientationContext',
      'orientSourceInterior',
      'interiorFlow',
      'orientationFootprintSize',
      'orientationFitsContainer',
      'joinDistancedClusters',
      'JoinDistancedClusters',
      'splitSubgraphsTracked',
      'snapshotNodeGraphOwnership',
      'abductEdges',
    ];

    for (const name of forbidden) {
      assert.strictEqual(placementIndex[name], undefined, `${name} should not be in placement/index.js`);
      assert.strictEqual(rootIndex[name], undefined, `${name} should not be in root index.js`);
    }
  });

  it('allows direct imports of placement optimizer and Slice 44 functions', () => {
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
    assert.strictEqual(typeof optimizerDoesOverlap, 'function');
    assert.strictEqual(typeof optimizerIsOccupied, 'function');
    assert.strictEqual(typeof optimizerCanMove, 'function');
    assert.strictEqual(typeof compaction, 'function');
    assert.strictEqual(typeof candidateMoves, 'function');
    assert.strictEqual(typeof visibilityEdges, 'function');
    assert.strictEqual(typeof moveNodeToBest, 'function');
    // Slice 44 direct imports
    assert.strictEqual(typeof transpose, 'function');
    assert.strictEqual(typeof rotateAround, 'function');
    assert.strictEqual(typeof alignConnectedNodes, 'function');
    assert.strictEqual(typeof alignVessel, 'function');
    assert.strictEqual(typeof optimizeCluster, 'function');
    assert.strictEqual(typeof optimizeClusters, 'function');
    assert.strictEqual(typeof gapNormalization, 'function');
    assert.strictEqual(typeof reduceGapToNeighbors, 'function');
    assert.strictEqual(typeof isBetween, 'function');
    assert.strictEqual(typeof nearestBetween, 'function');
    assert.strictEqual(typeof nearestConnectedAhead, 'function');
    assert.strictEqual(typeof OptimizerSpatialIndex, 'function');
    assert.strictEqual(typeof indexedCanMove, 'function');
    assert.strictEqual(typeof indexedIsOccupied, 'function');
    assert.strictEqual(typeof indexedDoesOverlap, 'function');
    // Slice 45 direct imports
    assert.strictEqual(typeof SizedOptimizer, 'function');
    assert.strictEqual(typeof newSizedOptimizer, 'function');
    assert.strictEqual(typeof iterPlacementsAroundPoint, 'function');
    assert.strictEqual(typeof withHubSpokesSuppressed, 'function');
    assert.strictEqual(typeof chargeOptimizerTranspose, 'function');
    assert.strictEqual(typeof normalizeGaps, 'function');
    assert.strictEqual(typeof transposeAll, 'function');
    // Slice 46 direct imports
    for (const fn of [
      alignAxes, alignmentDeltas, tryMove, attemptShift, DirectionCounts, edgeDirectionCounts,
      compareDirectionCounts, containerEdgeDirections, hasFixedDescendant, mirrorAxes, direct,
      swapPositions, smartSwapPositions, swapOptimize, equidistance, Equidistance,
      equidistanceNodeGuarded, dejitter, Dejitter, balanceSymmetry, BalanceSymmetry, isSimple,
      align, Align, swap, Swap, nodesCenter,
      place, Place, prepare, Prepare, placeNodes, placeNodesOrthogonally,
      orientationContext, orientSourceInterior, interiorFlow, orientationFootprintSize,
      orientationFitsContainer, joinDistancedClusters,
    ]) {
      assert.strictEqual(typeof fn, 'function');
    }
    for (const method of [
      'medianPointGuarded', 'protrudingChildrenGuarded', 'findClosestUnoccupiedDistanceGuarded',
      'findUnoccupiedGuarded', 'isPointOccupiedGuarded', 'fillPlacementPointsGuarded',
      'moveNodeToBestGuarded', 'bestSwapCandidateGuarded', 'syncHerdFencesGuarded',
      'optimize', 'optimizeWithLimit', 'optimizeGuarded',
    ]) {
      assert.strictEqual(typeof SizedOptimizer.prototype[method], 'function', method);
    }
  });
});
