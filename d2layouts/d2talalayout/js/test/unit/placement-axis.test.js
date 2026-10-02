import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LayoutAxis,
  axisValid,
  axisIsHorizontal,
  oppositeAxis,
  axisForArrangement,
  TraversalDirection,
  directionValid,
  directionIsForward,
  oppositeDirection,
} from '../../src/placement/axis.js';
import * as placementIndex from '../../src/placement/index.js';
import * as rootIndex from '../../src/index.js';
import { ClusterArrangement } from '../../src/graph/cluster.js';

describe('Placement Axis and Direction Primitives', () => {
  it('LayoutAxis is frozen with correct integer values', () => {
    assert.ok(Object.isFrozen(LayoutAxis));
    assert.equal(LayoutAxis.Invalid, 0);
    assert.equal(LayoutAxis.Horizontal, 1);
    assert.equal(LayoutAxis.Vertical, 2);
  });

  it('TraversalDirection is frozen with correct integer values', () => {
    assert.ok(Object.isFrozen(TraversalDirection));
    assert.equal(TraversalDirection.Invalid, 0);
    assert.equal(TraversalDirection.Forward, 1);
    assert.equal(TraversalDirection.Backward, 2);
  });

  it('axisValid validates horizontal and vertical only', () => {
    assert.equal(axisValid(LayoutAxis.Invalid), false);
    assert.equal(axisValid(LayoutAxis.Horizontal), true);
    assert.equal(axisValid(LayoutAxis.Vertical), true);
    assert.equal(axisValid(3), false);
    assert.equal(axisValid(-1), false);
  });

  it('axisIsHorizontal returns true only for Horizontal', () => {
    assert.equal(axisIsHorizontal(LayoutAxis.Horizontal), true);
    assert.equal(axisIsHorizontal(LayoutAxis.Vertical), false);
    assert.equal(axisIsHorizontal(LayoutAxis.Invalid), false);
  });

  it('oppositeAxis flips between horizontal and vertical, invalid/unknown remains invalid', () => {
    assert.equal(oppositeAxis(LayoutAxis.Horizontal), LayoutAxis.Vertical);
    assert.equal(oppositeAxis(LayoutAxis.Vertical), LayoutAxis.Horizontal);
    assert.equal(oppositeAxis(LayoutAxis.Invalid), LayoutAxis.Invalid);
    assert.equal(oppositeAxis(999), LayoutAxis.Invalid);
  });

  it('axisForArrangement returns Horizontal for Column, Vertical for everything else', () => {
    assert.equal(axisForArrangement(ClusterArrangement.Column), LayoutAxis.Horizontal);
    assert.equal(axisForArrangement('Column'), LayoutAxis.Horizontal);
    assert.equal(axisForArrangement(ClusterArrangement.Row), LayoutAxis.Vertical);
    assert.equal(axisForArrangement('Row'), LayoutAxis.Vertical);
    assert.equal(axisForArrangement(''), LayoutAxis.Vertical);
    assert.equal(axisForArrangement(null), LayoutAxis.Vertical);
    assert.equal(axisForArrangement(undefined), LayoutAxis.Vertical);
    assert.equal(axisForArrangement('unknown'), LayoutAxis.Vertical);
  });

  it('directionValid validates forward and backward only', () => {
    assert.equal(directionValid(TraversalDirection.Invalid), false);
    assert.equal(directionValid(TraversalDirection.Forward), true);
    assert.equal(directionValid(TraversalDirection.Backward), true);
    assert.equal(directionValid(3), false);
  });

  it('directionIsForward returns true only for Forward', () => {
    assert.equal(directionIsForward(TraversalDirection.Forward), true);
    assert.equal(directionIsForward(TraversalDirection.Backward), false);
    assert.equal(directionIsForward(TraversalDirection.Invalid), false);
  });

  it('oppositeDirection flips between forward and backward, invalid/unknown remains invalid', () => {
    assert.equal(oppositeDirection(TraversalDirection.Forward), TraversalDirection.Backward);
    assert.equal(oppositeDirection(TraversalDirection.Backward), TraversalDirection.Forward);
    assert.equal(oppositeDirection(TraversalDirection.Invalid), TraversalDirection.Invalid);
    assert.equal(oppositeDirection(999), TraversalDirection.Invalid);
  });

  it('axis and direction primitives are absent from placement and root barrels', () => {
    assert.equal('LayoutAxis' in placementIndex, false);
    assert.equal('axisValid' in placementIndex, false);
    assert.equal('oppositeAxis' in placementIndex, false);
    assert.equal('TraversalDirection' in placementIndex, false);
    assert.equal('directionValid' in placementIndex, false);

    assert.equal('LayoutAxis' in rootIndex, false);
    assert.equal('axisValid' in rootIndex, false);
    assert.equal('oppositeAxis' in rootIndex, false);
    assert.equal('TraversalDirection' in rootIndex, false);
    assert.equal('directionValid' in rootIndex, false);
  });
});
