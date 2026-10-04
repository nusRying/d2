/**
 * Tree geometry kernels: level layout, spacing, label positioning, and the
 * orientation transforms (swap/flip) used to lay out every side as Bottom.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/trees/geometry.go
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *
 * Conventions: Go (value, error) returns become a returned value or a thrown
 * Error; WorkGuard Step/Check/Finish throw and are called in pinned Go order
 * and count. Explicit stacks/queues replace recursion. Go maps keyed by level
 * become Maps whose missing keys read as Go zero values.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { goRound } from '../geometry/math.js';
import { Orientation, isHorizontal } from '../geometry/orientation.js';
import { LabelPosition } from '../graph/label-position.js';
import { invariantError, mirroredLabelPosition } from './layoutgraph-support.js';
import { treePreprocessBadState } from './preprocess-helpers.js';

/** layoutgraph.TreeParentSpacing (geometry_policy.go). */
export const TREE_PARENT_SPACING = 100.0;
/** layoutgraph.MinArrowheadClearance (geometry_policy.go). */
export const MIN_ARROWHEAD_CLEARANCE = 20.0;

export const SIBLING_SPACING = 50.0;
export const DIRECTION_PENALTY = 2 * TREE_PARENT_SPACING;

/**
 * levelsByDepth returns Map<level, Tree[]> for levels 0..n-1 (breadth-first).
 */
export function levelsByDepth(t, guard) {
  if (t == null) {
    throw treePreprocessBadState('tree placement cannot traverse a nil tree');
  }
  const queue = [{ tree: t, level: 0 }];
  const seen = new Set();
  const treeLevels = new Map();
  for (let index = 0; index < queue.length; index++) {
    guard.Step();
    const current = queue[index];
    if (current.tree == null || current.tree.Node == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current.tree)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current.tree);
    let level = treeLevels.get(current.level);
    if (level === undefined) {
      level = [];
      treeLevels.set(current.level, level);
    }
    level.push(current.tree);
    for (const child of current.tree.Children) {
      guard.Step();
      queue.push({ tree: child, level: current.level + 1 });
    }
  }
  return treeLevels;
}

function levelAt(treeLevels, level) {
  return treeLevels.get(level) ?? [];
}

export function shiftSubtreeHorizontally(t, delta, guard) {
  offsetSubtree(t, delta, 0, guard);
}

export function spacingToChildren(t, guard) {
  let maxLabelSize = 0.0;
  for (const c of t.Children) {
    guard.Step();
    if (c == null || c.SentinelEdge == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete child edge');
    }
    let labelSize = c.SentinelEdge.MinHeight;
    if (t.Orientation === Orientation.Left || t.Orientation === Orientation.Right) {
      labelSize = c.SentinelEdge.MinWidth;
    }
    maxLabelSize = Math.max(maxLabelSize, labelSize);
  }
  if (maxLabelSize === 0) {
    return TREE_PARENT_SPACING;
  }
  const labelSpacingWithArrowheads = maxLabelSize + 2 * MIN_ARROWHEAD_CLEARANCE;
  if (t.Children.length === 1) {
    return Math.max(TREE_PARENT_SPACING, labelSpacingWithArrowheads);
  }
  return TREE_PARENT_SPACING / 2 + Math.max(TREE_PARENT_SPACING / 2, labelSpacingWithArrowheads);
}

export function layoutTree(t, guard) {
  const treeLevels = levelsByDepth(t, guard);
  const levelCount = treeLevels.size;

  // 1. The level height is the tallest node's at each level
  const levelHeights = new Map();
  for (let level = 0; level < levelCount; level++) {
    let levelHeight = 0.0;
    for (const levelNode of levelAt(treeLevels, level)) {
      guard.Step();
      levelHeight = Math.max(levelHeight, levelNode.Node.Height);
    }
    levelHeights.set(level, levelHeight);
  }
  // 1.1. Edge labels may require additional spacing, so spacing for the level is based on the largest label
  const levelSpacings = new Map();
  for (let level = 0; level < levelCount - 1; level++) {
    for (const levelNode of levelAt(treeLevels, level)) {
      guard.Step();
      const spacing = spacingToChildren(levelNode, guard);
      levelSpacings.set(level + 1, Math.max(levelSpacings.get(level + 1) ?? 0, spacing));
    }
  }

  // 2. On each level, center all nodes to the center y value for that level
  let levelBottom = 0.0;
  for (let level = 1; level < levelCount; level++) {
    const levelTop = levelBottom + (levelSpacings.get(level) ?? 0);
    const levelHeight = levelHeights.get(level) ?? 0;
    for (const levelNode of levelAt(treeLevels, level)) {
      guard.Step();
      const centerOffset = goRound((levelHeight - levelNode.Node.Height) / 2);
      moveTreeNodeAbsWithChildren(levelNode.Node, levelNode.Node.TopLeft.X, levelTop + centerOffset, guard);
    }
    levelBottom = levelTop + levelHeight;
  }

  // 3. Position all level nodes x values on each level, going bottom up by level
  for (let level = levelCount - 1; level > 0; level--) {
    // nextPosition moves along the x axis as we position each level node on this level
    let nextPosition = 0.0;
    for (const levelNode of levelAt(treeLevels, level)) {
      guard.Step();
      if (levelNode.Children.length === 0) {
        // 3a. Simply set position according to nextPosition value
        moveTreeNodeAbsWithChildren(levelNode.Node, nextPosition, levelNode.Node.TopLeft.Y, guard);
      } else {
        const nextLevel = levelAt(treeLevels, level + 1);
        let lastChildPosition = nextLevel.length;
        for (let i = lastChildPosition - 1; i >= 0; i--) {
          guard.Step();
          if (nextLevel[i].Parent === levelNode) {
            lastChildPosition = i;
            break;
          }
        }
        const shiftSubsequentLevelNodes = (dx) => {
          for (let i = lastChildPosition + 1; i < nextLevel.length; i++) {
            guard.Step();
            shiftSubtreeHorizontally(nextLevel[i], dx, guard);
          }
        };

        // 3b 1. Space children evenly on the level below
        const spacingBefore = totalChildrenSpacing(levelNode, guard);
        spaceChildrenEvenly(levelNode, guard);
        const spacingAfter = totalChildrenSpacing(levelNode, guard);
        const totalShift = spacingAfter - spacingBefore;
        // 3b 1a. if this shifts the children we also need to shift their subsequent level nodes
        if (totalShift > 0) {
          shiftSubsequentLevelNodes(totalShift);
        }
        // 3b 2. Center over children
        const siblingCenter = childrenCenterX(levelNode, guard);
        moveTreeNodeAbsWithChildren(
          levelNode.Node,
          goRound(siblingCenter - levelNode.Node.Width / 2),
          levelNode.Node.TopLeft.Y,
          guard,
        );

        // 3b 3. if after centering, this node's position is less than the desired spacing,
        // shift its whole subtree to reach the desired spacing (keeping the centering intact)
        const positionDiff = nextPosition - levelNode.Node.TopLeft.X;
        if (positionDiff > 0) {
          shiftSubtreeHorizontally(levelNode, positionDiff, guard);
          shiftSubsequentLevelNodes(positionDiff);
        }
      }

      // 3c. the next position on this level is siblingSpacing past the end of this level node
      nextPosition = levelNode.Node.TopLeft.X + levelNode.Node.Width + SIBLING_SPACING;
    }
  }
  guard.Finish();
}

export function validateBottomOrientation(t, guard) {
  const stack = [t];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null || current.Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current);
    if (current.Parent != null) {
      if (current.Parent.Node == null || current.Parent.Node.TopLeft == null) {
        throw treePreprocessBadState('tree placement encountered an incomplete parent');
      }
      if (current.Node.TopLeft.Y < current.Parent.Node.TopLeft.Y + current.Parent.Node.Height) {
        throw invariantError(`tree node ${current.Node.ID} is not in Bottom orientation`);
      }
    }
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
  guard.Check();
}

export function positionEdgeLabels(t, guard) {
  if (t == null) {
    throw treePreprocessBadState('tree placement cannot label a nil tree');
  }
  const stack = [{ tree: t, emit: false }];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const task = stack.pop();
    const current = task.tree;
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete label tree');
    }
    if (!task.emit) {
      if (seen.has(current)) {
        throw treePreprocessBadState('tree placement encountered a repeated tree node');
      }
      seen.add(current);
      stack.push({ tree: current, emit: true });
      for (let i = current.Children.length - 1; i >= 0; i--) {
        guard.Step();
        stack.push({ tree: current.Children[i], emit: false });
      }
      continue;
    }

    const edge = current.SentinelEdge;
    if (edge == null) {
      throw treePreprocessBadState(`tree node ${current.Node.ID} has no sentinel edge for label placement`);
    }
    if (edge.Label == null) {
      continue;
    }
    let labelSize = edge.MinHeight;
    if (isHorizontal(current.Orientation)) {
      labelSize = edge.MinWidth;
    }
    if (labelSize !== 0) {
      if (current.Parent == null || current.Parent.Node == null) {
        throw treePreprocessBadState(`tree node ${current.Node.ID} has no parent for label placement`);
      }
      if (current.Parent.Children.length === 1) {
        edge.Label.Position = LabelPosition.UnlockedMiddle;
        edge.LabelPercentage = 0.5;
      } else {
        const childNode = current.Node;
        const parentNode = current.Parent.Node;
        const dx = childNode.Center().X - parentNode.Center().X;
        const dy = childNode.TopLeft.Y - (parentNode.TopLeft.Y + parentNode.Height);
        const totalLength = Math.abs(dx) + dy;
        const childSegmentLength = dy - TREE_PARENT_SPACING / 2;

        // LabelPercentage = distance from edge.From along edge / total edge distance
        let distanceAlongEdge = childSegmentLength / 2;
        const isChildToParent = edge.From === childNode;
        if (!isChildToParent) {
          distanceAlongEdge = totalLength - childSegmentLength / 2;
        }
        edge.LabelPercentage = distanceAlongEdge / totalLength;
        // if the child is to the left, to be on the outside we want the label on the relative bottom position
        if (dx < 0) {
          edge.Label.Position = LabelPosition.UnlockedBottom;
        } else {
          edge.Label.Position = LabelPosition.UnlockedTop;
        }
        // if the edge is in the other direction we need to mirror to get the same position
        if (isChildToParent) {
          edge.Label.Position = mirroredLabelPosition(edge.Label.Position);
        }
        if (isHorizontal(current.Orientation)) {
          // mirroring is needed due to the effects of invertOrientationToBottom on a horizontal orientation
          edge.Label.Position = mirroredLabelPosition(edge.Label.Position);
        }
      }
    }
    guard.Finish();
  }
}

/** childrenCenterX averages the children's centers. */
export function childrenCenterX(t, guard) {
  if (t.Children.length === 0) {
    throw treePreprocessBadState('tree placement cannot center a leaf');
  }
  let centerX = 0.0;
  for (const child of t.Children) {
    guard.Step();
    if (child == null || child.Node == null || child.Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete child');
    }
    centerX += child.Node.TopLeft.X + child.Node.Width / 2;
  }
  centerX /= t.Children.length;
  return centerX;
}

export function spaceChildrenEvenly(t, guard) {
  let maxSpacing = SIBLING_SPACING;

  const childrenSpacing = [0];
  // 1. Determine the maximum spacing between siblings
  for (let i = 1; i < t.Children.length; i++) {
    guard.Step();
    const s = t.Children[i].Node.TopLeft.X - (t.Children[i - 1].Node.TopLeft.X + t.Children[i - 1].Node.Width);
    maxSpacing = Math.max(maxSpacing, s);
    childrenSpacing.push(s);
  }

  // 1a. Check that spacing evenly doesn't require too much space
  for (let i = 1; i < t.Children.length; i++) {
    guard.Step();
    const shiftAmount = maxSpacing - childrenSpacing[i];
    if (shiftAmount === 0) {
      continue;
    }
    const before = spacingBefore(t, i, guard);
    if (before + shiftAmount > 10 * SIBLING_SPACING) {
      // spacing evenly would introduce too much excess space, so just keep the current spacing as-is
      return;
    }
    // the next child will have less space after shifting
    if (i + 1 < t.Children.length) {
      childrenSpacing[i + 1] -= shiftAmount;
    }
  }

  // 2. Space all siblings with the maximum spacing
  for (let i = 1; i < t.Children.length; i++) {
    guard.Step();
    const shiftAmount = maxSpacing - childrenSpacing[i];
    if (shiftAmount > 0) {
      shiftSubtreeHorizontally(t.Children[i], shiftAmount, guard);
    }
  }
}

export function totalChildrenSpacing(t, guard) {
  let spacing = 0.0;
  for (let i = 1; i < t.Children.length; i++) {
    guard.Step();
    spacing += t.Children[i].Node.TopLeft.X - (t.Children[i - 1].Node.TopLeft.X + t.Children[i - 1].Node.Width);
  }
  return spacing;
}

/**
 * spacingBefore returns the minimum space between child at childIndex and
 * childIndex-1 including all descendant levels.
 */
export function spacingBefore(t, childIndex, guard) {
  const rights = levelRights(t.Children[childIndex - 1], guard);
  const lefts = levelLefts(t.Children[childIndex], guard);

  let minSpace = lefts[0] - rights[0];
  for (let level = 1; level < lefts.length && level < rights.length; level++) {
    guard.Step();
    minSpace = Math.min(minSpace, lefts[level] - rights[level]);
  }
  return minSpace;
}

/** levelLefts returns the leftmost positions for each level of descendants. */
export function levelLefts(t, guard) {
  const levels = levelsByDepth(t, guard);
  const lefts = new Array(levels.size).fill(0);
  for (let level = 0; level < levels.size; level++) {
    const row = levelAt(levels, level);
    if (row.length === 0 || row[0].Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete level');
    }
    guard.Step();
    lefts[level] = row[0].Node.TopLeft.X;
  }
  return lefts;
}

export function levelRights(t, guard) {
  const levels = levelsByDepth(t, guard);
  const rights = new Array(levels.size).fill(0);
  for (let level = 0; level < levels.size; level++) {
    const row = levelAt(levels, level);
    if (row.length === 0) {
      throw treePreprocessBadState('tree placement encountered an empty level');
    }
    const last = row[row.length - 1];
    if (last.Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete level');
    }
    guard.Step();
    rights[level] = last.Node.TopLeft.X + last.Node.Width;
  }
  return rights;
}

export function centerAlignChildren(t, guard) {
  // 1. the x axis offset is computed so the root's children are centered with the root.
  const childrenCenter = childrenCenterX(t, guard);
  const xOffset = goRound((t.Node.TopLeft.X + t.Node.Width / 2) - childrenCenter);

  // 2. shift all children to be in alignment
  for (const child of t.Children) {
    guard.Step();
    offsetSubtree(child, xOffset, 0, guard);
  }
  guard.Finish();
}

/**
 * treePlacementDescendants is the guarded equivalent of
 * Graph.AllDescendantNodes for tree-placement movement. Push order mirrors
 * that helper so both traversals produce the same mutation order.
 */
export function treePlacementDescendants(node, guard) {
  if (node == null || node.Graph == null) {
    throw treePreprocessBadState('tree placement cannot move a node without graph ownership');
  }
  const g = node.Graph;
  const seen = new Set([node]);
  const stack = [];
  const pushChildren = (parent) => {
    if (parent == null) {
      return;
    }
    const sequence = g.Sequences.get(parent);
    if (sequence != null) {
      const nodes = sequence.Nodes ?? [];
      for (let i = nodes.length - 1; i >= 0; i--) {
        guard.Step();
        stack.push(nodes[i]);
      }
    }
    if (parent.IsClusterVessel()) {
      const cluster = g.Clusters.get(parent);
      if (cluster != null) {
        const nodes = cluster.Nodes ?? [];
        for (let i = nodes.length - 1; i >= 0; i--) {
          guard.Step();
          stack.push(nodes[i]);
        }
      }
    }
    if (parent.IsContainer()) {
      const children = g.Containers.get(parent) ?? [];
      for (let i = children.length - 1; i >= 0; i--) {
        guard.Step();
        stack.push(children[i]);
      }
    }
  };
  pushChildren(node);
  const descendants = [];
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null) {
      throw treePreprocessBadState('tree placement encountered a nil graph descendant');
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    descendants.push(current);
    pushChildren(current);
  }
  return descendants;
}

export function moveTreeNodeWithChildren(node, dx, dy, guard) {
  if (node == null || node.TopLeft == null) {
    throw treePreprocessBadState('tree placement cannot move an incomplete node');
  }
  if (dx === 0 && dy === 0) {
    guard.Check();
    return;
  }
  const descendants = treePlacementDescendants(node, guard);
  guard.Step();
  node.Translate(dx, dy);
  guard.Finish();
  for (const descendant of descendants) {
    guard.Step();
    if (descendant.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered a descendant without a position');
    }
    descendant.Translate(dx, dy);
    guard.Finish();
  }
}

export function moveTreeNodeAbsWithChildren(node, x, y, guard) {
  if (node == null || node.TopLeft == null) {
    throw treePreprocessBadState('tree placement cannot move an incomplete node');
  }
  if (node.TopLeft.X === x && node.TopLeft.Y === y) {
    guard.Check();
    return;
  }
  moveTreeNodeWithChildren(node, x - node.TopLeft.X, y - node.TopLeft.Y, guard);
}

export function offsetSubtree(t, xOffset, yOffset, guard) {
  const stack = [t];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current);
    moveTreeNodeWithChildren(current.Node, xOffset, yOffset, guard);
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
  guard.Finish();
}

/**
 * swapDimensions swaps x/y and width/height of every tree node so a Right
 * layout can reuse the Bottom layout code.
 */
export function swapDimensions(t, guard) {
  const stack = [t];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null || current.Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current);
    moveTreeNodeAbsWithChildren(current.Node, current.Node.TopLeft.Y, current.Node.TopLeft.X, guard);
    const width = current.Node.Width;
    current.Node.Width = current.Node.Height;
    current.Node.Height = width;
    guard.Finish();
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
}

/** flip mirrors every tree node's top-left through the origin, accounting for size. */
export function flip(t, guard) {
  const stack = [t];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null || current.Node.TopLeft == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current);
    moveTreeNodeAbsWithChildren(
      current.Node,
      -(current.Node.TopLeft.X + current.Node.Width),
      -(current.Node.TopLeft.Y + current.Node.Height),
      guard,
    );
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
  guard.Finish();
}

export function setOrientation(t, o, guard) {
  const stack = [t];
  const seen = new Set();
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null || current.Node == null) {
      throw treePreprocessBadState('tree placement encountered an incomplete tree');
    }
    if (seen.has(current)) {
      throw treePreprocessBadState('tree placement encountered a repeated tree node');
    }
    seen.add(current);
    current.Orientation = o;
    guard.Finish();
    for (let i = current.Children.length - 1; i >= 0; i--) {
      guard.Step();
      stack.push(current.Children[i]);
    }
  }
}
