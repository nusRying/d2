import { LabelPosition as P, normalizeLabelPosition } from '../graph/label-position.js';
import { LabelTier, LABEL_TIERS, nodeLabelPositionPreferences } from '../shape/label-preferences.js';

// Pinned Go: internal/labeling/model.go — only Initialize and the default
// label-position preference model it needs. Label placement (Place, guard
// accounting, refinement) lives in placement.go/guard.go and is not ported
// here.

/** The order of preferred edge-label positions. */
export const EDGE_LABEL_PREFERENCE_ORDER = Object.freeze([
  P.OutsideTopCenter,
  P.OutsideBottomCenter,
  P.OutsideTopLeft,
  P.OutsideTopRight,
  P.OutsideBottomLeft,
  P.OutsideBottomRight,
  P.InsideMiddleCenter,
  P.InsideMiddleLeft,
  P.InsideMiddleRight,
]);

export const NODE_LABEL_POSITION_ORDER = Object.freeze([
  P.InsideMiddleCenter,
  P.InsideTopCenter,
  P.InsideBottomCenter,
  P.InsideMiddleLeft,
  P.InsideMiddleRight,
  P.InsideTopLeft,
  P.InsideTopRight,
  P.InsideBottomLeft,
  P.InsideBottomRight,
  P.OutsideTopCenter,
  P.OutsideBottomCenter,
  P.OutsideLeftMiddle,
  P.OutsideRightMiddle,
  P.OutsideTopLeft,
  P.OutsideTopRight,
  P.OutsideBottomLeft,
  P.OutsideBottomRight,
  P.OutsideLeftTop,
  P.OutsideLeftBottom,
  P.OutsideRightTop,
  P.OutsideRightBottom,
]);

export const CONTAINER_LABEL_POSITION_ORDER = Object.freeze([
  P.InsideTopCenter,
  P.OutsideTopCenter,
  P.InsideBottomCenter,
  P.OutsideBottomCenter,
  P.OutsideTopLeft,
  P.OutsideTopRight,
  P.OutsideBottomLeft,
  P.OutsideBottomRight,
  P.OutsideLeftMiddle,
  P.OutsideRightMiddle,
  P.OutsideLeftTop,
  P.OutsideLeftBottom,
  P.OutsideRightTop,
  P.OutsideRightBottom,
  P.InsideTopLeft,
  P.InsideTopRight,
  P.InsideBottomLeft,
  P.InsideBottomRight,
  P.InsideMiddleLeft,
  P.InsideMiddleRight,
  P.InsideMiddleCenter,
]);

function isUnset(position) {
  return normalizeLabelPosition(position) === P.Unset;
}

/**
 * initialize reserves each explicit/default node-label and icon position
 * before placement begins.
 */
export function initialize(graph) {
  for (const node of graph.Nodes) {
    setDefaultLabelPlacement(node);
    if (node.Icon != null && !isUnset(node.Icon.Position)) {
      node.Icon.FixPosition();
    }
  }
}

/**
 * setDefaultLabelPlacement assigns the most preferred position to an unset
 * node label, and fixes an explicitly positioned one.
 */
export function setDefaultLabelPlacement(node) {
  if (node.Label == null) {
    return;
  }
  if (isUnset(node.Label.Position)) {
    const preferences = labelPositionPreferences(node);
    if (preferences.length === 0) {
      // Go indexes [0] of an empty slice and panics.
      throw new RangeError("index out of range [0] with length 0");
    }
    node.Label.Position = preferences[0];
  } else {
    node.Label.FixPosition();
  }
}

/**
 * compareLabelPositions returns 1 when first is in a better tier than second,
 * -1 when worse, and 0 when tied. A position's score is the index+1 of the
 * last tier containing it (-1 when in none).
 */
export function compareLabelPositions(node, first, second) {
  const score = (position) => {
    let result = -1;
    LABEL_TIERS.forEach((tier, index) => {
      if (nodeLabelPositionPreferences(node, tier).has(position)) {
        result = index + 1;
      }
    });
    return result;
  };
  const firstScore = score(first);
  const secondScore = score(second);
  if (firstScore < secondScore) {
    return 1;
  }
  if (firstScore > secondScore) {
    return -1;
  }
  return 0;
}

/** labelPositionPreferences flattens the preference tranches in tier order. */
export function labelPositionPreferences(node) {
  const preferences = [];
  for (const tranche of labelPositionPreferenceTranches(node)) {
    preferences.push(...tranche);
  }
  return preferences;
}

/**
 * labelPositionPreferenceTranches returns, per tier (Good, OK, Unideal, Bad),
 * the shape-allowed positions in the node or container base order. Go returns
 * nil for an empty tranche; JS returns an empty array.
 */
export function labelPositionPreferenceTranches(node) {
  const baseOrder = node.IsContainer() ? CONTAINER_LABEL_POSITION_ORDER : NODE_LABEL_POSITION_ORDER;
  const tranches = [];
  for (const tier of [LabelTier.Good, LabelTier.OK, LabelTier.Unideal, LabelTier.Bad]) {
    const allowed = nodeLabelPositionPreferences(node, tier);
    const tranche = [];
    for (const position of baseOrder) {
      if (allowed.has(position)) {
        tranche.push(position);
      }
    }
    tranches.push(tranche);
  }
  return tranches;
}

export const Initialize = initialize;
