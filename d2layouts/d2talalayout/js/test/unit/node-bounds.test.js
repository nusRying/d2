import { describe, expect, test } from 'bun:test';
import { Node } from '../../src/graph/node.js';
import { Graph } from '../../src/graph/graph.js';
import { Box } from '../../src/geometry/box.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import {
  LABEL_PADDING,
  LabelPosition,
  normalizeLabelPosition,
  isOutsideLabelPosition,
  getPointOnBox,
} from '../../src/graph/label-position.js';
import {
  nodesLeftmost,
  nodesTopmost,
  nodesRightmost,
  nodesBottommost,
  nodesBoundingBox,
  nodesBounds,
  nodesSubgraphContainer,
  nodesFixedOrigin,
  nodesFixedBounds,
  FixedBoundingBox,
} from '../../src/graph/node-bounds.js';

describe('Slice 18 - Node Bounds & Fixed-Origin Unit Tests', () => {
  describe('Label Position & GetPointOnBox Primitives', () => {
    test('LABEL_PADDING constant is 5', () => {
      expect(LABEL_PADDING).toBe(5);
    });

    test('isOutsideLabelPosition identifies numeric and string positions correctly', () => {
      expect(isOutsideLabelPosition(null)).toBe(false);
      expect(isOutsideLabelPosition(undefined)).toBe(false);
      expect(isOutsideLabelPosition(0)).toBe(false);
      expect(isOutsideLabelPosition(1)).toBe(true);
      expect(isOutsideLabelPosition(12)).toBe(true);
      expect(isOutsideLabelPosition(13)).toBe(false);

      expect(isOutsideLabelPosition('OUTSIDE_TOP_LEFT')).toBe(true);
      expect(isOutsideLabelPosition('outside_bottom_right')).toBe(true);
      expect(isOutsideLabelPosition('INSIDE_MIDDLE_CENTER')).toBe(false);
      expect(isOutsideLabelPosition('BORDER_TOP_LEFT')).toBe(false);
      expect(isOutsideLabelPosition('UNSET')).toBe(false);

      expect(isOutsideLabelPosition({ IsOutside: () => true })).toBe(true);
      expect(isOutsideLabelPosition({ IsOutside: () => false })).toBe(false);
    });

    test('normalizeLabelPosition maps strings and numbers', () => {
      expect(normalizeLabelPosition(1)).toBe(LabelPosition.OutsideTopLeft);
      expect(normalizeLabelPosition('OUTSIDE_TOP_LEFT')).toBe(LabelPosition.OutsideTopLeft);
      expect(normalizeLabelPosition('inside_middle_center')).toBe(LabelPosition.InsideMiddleCenter);
      expect(normalizeLabelPosition('BORDER_BOTTOM_RIGHT')).toBe(LabelPosition.BorderBottomRight);
      expect(normalizeLabelPosition('unknown_foo')).toBe(LabelPosition.Unset);
      expect(normalizeLabelPosition(null)).toBe(LabelPosition.Unset);
      expect(normalizeLabelPosition({ Position: 'OUTSIDE_TOP_CENTER' })).toBe(LabelPosition.OutsideTopCenter);
    });

    test('GetPointOnBox unknown/unset leaves point at box.TopLeft.copy()', () => {
      const b = new Box(new Point(100, 200), 50, 40);
      const pUnset = getPointOnBox(LabelPosition.Unset, b, 5, 20, 10);
      expect(pUnset.X).toBe(100);
      expect(pUnset.Y).toBe(200);
      expect(pUnset).not.toBe(b.TopLeft); // new object

      const pUnknown = getPointOnBox('INVALID_POSITION', b, 5, 20, 10);
      expect(pUnknown.X).toBe(100);
      expect(pUnknown.Y).toBe(200);
    });

    test('GetPointOnBox computes all 12 outside positions accurately', () => {
      const b = new Box(new Point(100, 200), 60, 40); // center: (130, 220)
      const w = 20;
      const h = 10;
      const pad = 5;

      // 1. OutsideTopLeft: p.X -= 5 -> 95, p.Y -= 5 + 10 -> 185
      const p1 = getPointOnBox(LabelPosition.OutsideTopLeft, b, pad, w, h);
      expect(p1.X).toBe(95);
      expect(p1.Y).toBe(185);

      // 2. OutsideTopCenter: p.X = 130 - 10 = 120, p.Y = 200 - 15 = 185
      const p2 = getPointOnBox(LabelPosition.OutsideTopCenter, b, pad, w, h);
      expect(p2.X).toBe(120);
      expect(p2.Y).toBe(185);

      // 3. OutsideTopRight: p.X = 100 + 60 - 20 - 5 = 135, p.Y = 185
      const p3 = getPointOnBox(LabelPosition.OutsideTopRight, b, pad, w, h);
      expect(p3.X).toBe(135);
      expect(p3.Y).toBe(185);

      // 4. OutsideLeftTop: p.X = 100 - 5 - 20 = 75, p.Y = 200 + 5 = 205
      const p4 = getPointOnBox(LabelPosition.OutsideLeftTop, b, pad, w, h);
      expect(p4.X).toBe(75);
      expect(p4.Y).toBe(205);

      // 5. OutsideLeftMiddle: p.X = 75, p.Y = 220 - 5 = 215
      const p5 = getPointOnBox(LabelPosition.OutsideLeftMiddle, b, pad, w, h);
      expect(p5.X).toBe(75);
      expect(p5.Y).toBe(215);

      // 6. OutsideLeftBottom: p.X = 75, p.Y = 200 + 40 - 10 - 5 = 225
      const p6 = getPointOnBox(LabelPosition.OutsideLeftBottom, b, pad, w, h);
      expect(p6.X).toBe(75);
      expect(p6.Y).toBe(225);

      // 7. OutsideRightTop: p.X = 100 + 60 + 5 = 165, p.Y = 205
      const p7 = getPointOnBox(LabelPosition.OutsideRightTop, b, pad, w, h);
      expect(p7.X).toBe(165);
      expect(p7.Y).toBe(205);

      // 8. OutsideRightMiddle: p.X = 165, p.Y = 215
      const p8 = getPointOnBox(LabelPosition.OutsideRightMiddle, b, pad, w, h);
      expect(p8.X).toBe(165);
      expect(p8.Y).toBe(215);

      // 9. OutsideRightBottom: p.X = 165, p.Y = 225
      const p9 = getPointOnBox(LabelPosition.OutsideRightBottom, b, pad, w, h);
      expect(p9.X).toBe(165);
      expect(p9.Y).toBe(225);

      // 10. OutsideBottomLeft: p.X = 100 + 5 = 105, p.Y = 200 + 40 + 5 = 245
      const p10 = getPointOnBox(LabelPosition.OutsideBottomLeft, b, pad, w, h);
      expect(p10.X).toBe(105);
      expect(p10.Y).toBe(245);

      // 11. OutsideBottomCenter: p.X = 130 - 10 = 120, p.Y = 245
      const p11 = getPointOnBox(LabelPosition.OutsideBottomCenter, b, pad, w, h);
      expect(p11.X).toBe(120);
      expect(p11.Y).toBe(245);

      // 12. OutsideBottomRight: p.X = 100 + 60 - 20 - 5 = 135, p.Y = 245
      const p12 = getPointOnBox(LabelPosition.OutsideBottomRight, b, pad, w, h);
      expect(p12.X).toBe(135);
      expect(p12.Y).toBe(245);
    });

    test('GetPointOnBox supports inside and border positions', () => {
      const b = new Box(new Point(100, 200), 60, 40);
      const pad = 5;
      const w = 20;
      const h = 10;

      // InsideMiddleCenter: center - w/2, center - h/2 -> (130 - 10, 220 - 5) = (120, 215)
      const pInside = getPointOnBox('INSIDE_MIDDLE_CENTER', b, pad, w, h);
      expect(pInside.X).toBe(120);
      expect(pInside.Y).toBe(215);

      // BorderTopCenter: center - w/2, TopLeft.Y - h/2 -> (120, 200 - 5) = (120, 195)
      const pBorder = getPointOnBox('BORDER_TOP_CENTER', b, pad, w, h);
      expect(pBorder.X).toBe(120);
      expect(pBorder.Y).toBe(195);
    });
  });

  describe('Node modifierElementAdjustments', () => {
    test('3D normal node gives [15, 15]', () => {
      const n = new Node(1, 100, 100);
      n.Is3D = true;
      expect(n.modifierElementAdjustments()).toEqual([15, 15]);
      expect(n.ModifierElementAdjustments()).toEqual([15, 15]);
    });

    test('3D Hexagon node gives [15, 7.5]', () => {
      const n = new Node(1, 100, 100);
      n.Is3D = true;
      n.SetShape("Hexagon");
      expect(n.modifierElementAdjustments()).toEqual([15, 7.5]);
      expect(n.ModifierElementAdjustments()).toEqual([15, 7.5]);
    });

    test('Multiple node gives [10, 10]', () => {
      const n = new Node(1, 100, 100);
      n.IsMultiple = true;
      expect(n.modifierElementAdjustments()).toEqual([10, 10]);
    });

    test('3D takes precedence over Multiple', () => {
      const n = new Node(1, 100, 100);
      n.Is3D = true;
      n.IsMultiple = true;
      expect(n.modifierElementAdjustments()).toEqual([15, 15]);

      n.SetShape("Hexagon");
      expect(n.modifierElementAdjustments()).toEqual([15, 7.5]);
    });

    test('default raw shape "" is not treated as Hexagon', () => {
      const n = new Node(1, 100, 100);
      n.Is3D = true;
      expect(n.modifierElementAdjustments()).toEqual([15, 15]);
    });
  });

  describe('Node boundingBoxValues & bounds', () => {
    test('throws naturally when TopLeft is null', () => {
      const n = new Node(1, 50, 50);
      n.TopLeft = null;
      expect(() => n.boundingBoxValues(null, true)).toThrow(TypeError);
    });

    test('rounds br with Go goRound semantics when roundDimensions is true', () => {
      const n = new Node(1, 10, 10);
      n.TopLeft = new Point(-10.5, -20.5);
      const [tl, br] = n.boundingBoxValues(null, true);
      expect(tl.X).toBe(-10.5);
      expect(tl.Y).toBe(-20.5);
      expect(br.X).toBe(-1);  // -10.5 + 10 = -0.5 -> rounds to -1 in Go
      expect(br.Y).toBe(-11); // -20.5 + 10 = -10.5 -> rounds to -11 in Go
    });

    test('unrounded leaves br exact', () => {
      const n = new Node(1, 10.4, 20.6);
      n.TopLeft = new Point(1.1, 2.2);
      const [tl, br] = n.boundingBoxValues(null, false);
      expect(tl.X).toBe(1.1);
      expect(tl.Y).toBe(2.2);
      expect(br.X).toBeCloseTo(11.5, 6);
      expect(br.Y).toBeCloseTo(22.8, 6);
    });

    test('asymmetric modifier adjustment: tl.Y -= dy, br.X += dx', () => {
      const n = new Node(1, 100, 100);
      n.TopLeft = new Point(50, 50);
      n.Is3D = true; // dx = 15, dy = 15
      const [tl, br] = n.boundingBoxValues(null, true);
      expect(tl.X).toBe(50); // NOT moved
      expect(tl.Y).toBe(35); // 50 - 15
      expect(br.X).toBe(165); // 150 + 15
      expect(br.Y).toBe(150); // NOT extended
    });

    test('loop offsets applied symmetrically to all four edges', () => {
      const n = new Node(1, 100, 100);
      n.TopLeft = new Point(50, 50);
      n.LoopOffsets = new Map([
        [Orientation.Left, 5],
        [Orientation.Top, 10],
        [Orientation.Right, 15],
        [Orientation.Bottom, 20],
      ]);
      const [tl, br] = n.boundingBoxValues(null, true);
      expect(tl.X).toBe(45);  // 50 - 5
      expect(tl.Y).toBe(40);  // 50 - 10
      expect(br.X).toBe(165); // 150 + 15
      expect(br.Y).toBe(170); // 150 + 20
    });

    test('loop offsets tolerates plain object keys and missing keys', () => {
      const n = new Node(1, 100, 100);
      n.TopLeft = new Point(50, 50);
      n.LoopOffsets = { Left: 5, bottom: 10 };
      const [tl, br] = n.boundingBoxValues(null, true);
      expect(tl.X).toBe(45);
      expect(tl.Y).toBe(50);
      expect(br.X).toBe(150);
      expect(br.Y).toBe(160);
    });

    test('ordering regression: round br -> modifiers -> loop offsets', () => {
      const n = new Node(1, 50.5, 20.5);
      n.TopLeft = new Point(100, 200);
      n.Is3D = true;
      n.LoopOffsets = new Map([
        [Orientation.Left, 3],
        [Orientation.Top, 4],
        [Orientation.Right, 5],
        [Orientation.Bottom, 6],
      ]);
      const [tl, br] = n.boundingBoxValues(null, true);
      // tl: 100 - 3 = 97; 200 - 15 - 4 = 181
      // br: round(150.5) = 151 + 15 + 5 = 171; round(220.5) = 221 + 6 = 227
      expect(tl.X).toBe(97);
      expect(tl.Y).toBe(181);
      expect(br.X).toBe(171);
      expect(br.Y).toBe(227);
    });

    test('outside labels are ignored if allNodes is null', () => {
      const n = new Node(1, 100, 100);
      n.TopLeft = new Point(50, 50);
      n.Label = {
        Position: LabelPosition.OutsideTopLeft,
        Width: 40,
        Height: 20,
      };
      // When allNodes is null, label adjustment does not run
      const [tl, br] = n.boundingBoxValues(null, true);
      expect(tl.X).toBe(50);
      expect(tl.Y).toBe(50);
      expect(br.X).toBe(150);
      expect(br.Y).toBe(150);
    });

    test('outside icons are ignored if shape is Image or allNodes is null', () => {
      const n1 = new Node(1, 100, 100);
      n1.TopLeft = new Point(50, 50);
      n1.SetShape("Image");
      n1.Icon = { Position: LabelPosition.OutsideRightTop };
      const [tl1, br1] = n1.boundingBoxValues([n1], true);
      expect(tl1.X).toBe(50);
      expect(br1.X).toBe(150); // NOT expanded

      const n2 = new Node(2, 100, 100);
      n2.TopLeft = new Point(50, 50);
      n2.SetShape("Square");
      n2.Icon = { Position: LabelPosition.OutsideRightTop };
      const [tl2, br2] = n2.boundingBoxValues(null, true); // allNodes == null
      expect(br2.X).toBe(150); // NOT expanded
    });
  });

  describe('Node-Set Extremal Helpers', () => {
    test('skips self identity and skips peers with null TopLeft', () => {
      const target = new Node(1, 50, 50);
      target.TopLeft = new Point(20, 20);

      const nullPeer = new Node(2, 50, 50);
      nullPeer.TopLeft = null;

      const rightPeer = new Node(3, 50, 50);
      rightPeer.TopLeft = new Point(100, 100);

      const nodes = [nullPeer, target, rightPeer];

      expect(nodesLeftmost(nodes, target)).toBe(true);
      expect(nodesTopmost(nodes, target)).toBe(true);
      expect(nodesRightmost(nodes, target)).toBe(false);
      expect(nodesBottommost(nodes, target)).toBe(false);
    });

    test('tied extremes: equality does not disqualify target', () => {
      const a = new Node(1, 50, 50);
      a.TopLeft = new Point(10, 10);
      const b = new Node(2, 50, 50);
      b.TopLeft = new Point(10, 10); // same top-left and right edge

      const nodes = [a, b];
      expect(nodesLeftmost(nodes, a)).toBe(true);
      expect(nodesLeftmost(nodes, b)).toBe(true);
      expect(nodesTopmost(nodes, a)).toBe(true);
      expect(nodesTopmost(nodes, b)).toBe(true);
      expect(nodesRightmost(nodes, a)).toBe(true);
      expect(nodesRightmost(nodes, b)).toBe(true);
      expect(nodesBottommost(nodes, a)).toBe(true);
      expect(nodesBottommost(nodes, b)).toBe(true);
    });
  });

  describe('Node-Set BoundingBox & Bounds', () => {
    test('empty array returns infinities', () => {
      const [tl, br] = nodesBoundingBox([], true);
      expect(tl.X).toBe(-Infinity);
      expect(tl.Y).toBe(-Infinity);
      expect(br.X).toBe(Infinity);
      expect(br.Y).toBe(Infinity);
    });

    test('any node with null TopLeft returns [null, null] immediately', () => {
      const n1 = new Node(1, 50, 50);
      n1.TopLeft = new Point(10, 10);
      const n2 = new Node(2, 50, 50);
      n2.TopLeft = null;

      const res = nodesBounds([n1, n2]);
      expect(res[0]).toBeNull();
      expect(res[1]).toBeNull();
    });

    test('duplicates processed repeatedly without deduplication', () => {
      const n = new Node(1, 50, 50);
      n.TopLeft = new Point(10, 20);
      const [tl, br] = nodesBounds([n, n]);
      expect(tl.X).toBe(10);
      expect(tl.Y).toBe(20);
      expect(br.X).toBe(60);
      expect(br.Y).toBe(70);
    });
  });

  describe('Fixed Origin & Container Level', () => {
    test('node.fixedOrigin returns TopLeft - FixedTopLeft', () => {
      const n = new Node(1, 50, 50);
      n.TopLeft = new Point(100, 200);
      n.FixedTopLeft = new Point(10, 20);

      const origin = n.fixedOrigin();
      expect(origin.X).toBe(90);
      expect(origin.Y).toBe(180);
      expect(n.FixedOrigin().equals(origin)).toBe(true);
    });

    test('node.fixedOrigin returns null if either point is null', () => {
      const n = new Node(1, 50, 50);
      expect(n.fixedOrigin()).toBeNull();
      n.TopLeft = new Point(10, 10);
      expect(n.fixedOrigin()).toBeNull();
      n.TopLeft = null;
      n.FixedTopLeft = new Point(10, 10);
      expect(n.fixedOrigin()).toBeNull();
    });

    test('node.containerLevel counts owningContainer chain', () => {
      const root = new Node(1, 100, 100);
      const mid = new Node(2, 50, 50);
      mid.Container = root;
      const leaf = new Node(3, 20, 20);
      leaf.Container = mid;

      expect(root.containerLevel()).toBe(1);
      expect(mid.containerLevel()).toBe(2);
      expect(leaf.containerLevel()).toBe(3);
      expect(leaf.ContainerLevel()).toBe(3);
    });

    test('nodesSubgraphContainer returns container of least nested node', () => {
      const root = new Node(1, 200, 200);
      const c1 = new Node(2, 100, 100);
      c1.Container = root;
      const c2 = new Node(3, 100, 100);
      c2.Container = c1;

      const leaf1 = new Node(4, 20, 20);
      leaf1.Container = c1; // level 2
      const leaf2 = new Node(5, 20, 20);
      leaf2.Container = c2; // level 3

      expect(nodesSubgraphContainer([leaf1, leaf2])).toBe(c1);
    });

    test('nodesSubgraphContainer returns null immediately if any node has null owning container', () => {
      const rootContainer = new Node(1, 100, 100);
      const inContainer = new Node(2, 20, 20);
      inContainer.Container = rootContainer;
      const atRoot = new Node(3, 20, 20);
      atRoot.Container = null;

      expect(nodesSubgraphContainer([inContainer, atRoot])).toBeNull();
      expect(nodesSubgraphContainer([atRoot, inContainer])).toBeNull();
    });

    test('nodesFixedOrigin returns first eligible matching fixed node origin', () => {
      const c = new Node(10, 200, 200);
      const n1 = new Node(1, 50, 50);
      n1.Container = c;
      n1.TopLeft = new Point(100, 100);
      n1.FixedTopLeft = new Point(10, 20); // origin: (90, 80)

      const n2 = new Node(2, 50, 50);
      n2.Container = c;
      n2.TopLeft = new Point(200, 200);
      n2.FixedTopLeft = new Point(30, 40); // origin: (170, 160)

      expect(nodesFixedOrigin([n1, n2]).X).toBe(90);
      expect(nodesFixedOrigin([n2, n1]).X).toBe(170);
    });
  });

  describe('FixedBoundingBox & nodesFixedBounds', () => {
    test('FixedBoundingBox replaces tl with fixedOrigin without altering br', () => {
      const n = new Node(1, 60, 40);
      n.TopLeft = new Point(100, 100);
      n.FixedTopLeft = new Point(10, 15);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(90);  // 100 - 10
      expect(tl.Y).toBe(85);  // 100 - 15
      expect(br.X).toBe(160); // 100 + 60 (br is NOT translated!)
      expect(br.Y).toBe(140); // 100 + 40
    });

    test('Node bounds vs Fixed bounds: node bounds uses actual current TopLeft', () => {
      const n = new Node(1, 60, 40);
      n.TopLeft = new Point(100, 100);
      n.FixedTopLeft = new Point(10, 15);

      const [nodeTL, nodeBR] = n.bounds([n]);
      expect(nodeTL.X).toBe(100);
      expect(nodeTL.Y).toBe(100);
      expect(nodeBR.X).toBe(160);
      expect(nodeBR.Y).toBe(140);

      const [setTL, setBR] = FixedBoundingBox([n]);
      expect(setTL.X).toBe(90);
      expect(setTL.Y).toBe(85);
      expect(setBR.X).toBe(160);
      expect(setBR.Y).toBe(140);

      // Node TopLeft is unchanged
      expect(n.TopLeft.X).toBe(100);
      expect(n.TopLeft.Y).toBe(100);
    });

    test('FixedBoundingBox does not mutate input array', () => {
      const n1 = new Node(1, 20, 20);
      n1.TopLeft = new Point(10, 10);
      const n2 = new Node(2, 30, 30);
      n2.TopLeft = new Point(40, 40);

      const arr = [n1, n2];
      FixedBoundingBox(arr);

      expect(arr.length).toBe(2);
      expect(arr[0]).toBe(n1);
      expect(arr[1]).toBe(n2);
    });
  });

  describe('Read-Only Immutability & Identity Guarantees', () => {
    test('bounds calculations preserve object identities and values', () => {
      const n = new Node(1, 50.5, 40.5);
      const originalTL = new Point(100.25, 200.75);
      const originalFixed = new Point(10, 20);
      n.TopLeft = originalTL;
      n.FixedTopLeft = originalFixed;
      n.Is3D = true;
      n.LoopOffsets = new Map([[Orientation.Left, 4], [Orientation.Top, 6]]);
      n.Label = { Position: LabelPosition.OutsideTopLeft, Width: 30, Height: 15 };
      n.Icon = { Position: LabelPosition.OutsideRightBottom };

      const [tl, br] = FixedBoundingBox([n]);

      // Assert original identities preserved
      expect(n.TopLeft).toBe(originalTL);
      expect(n.FixedTopLeft).toBe(originalFixed);
      expect(n.TopLeft.X).toBe(100.25);
      expect(n.TopLeft.Y).toBe(200.75);
      expect(n.FixedTopLeft.X).toBe(10);
      expect(n.FixedTopLeft.Y).toBe(20);
      expect(n.Width).toBe(50.5);
      expect(n.Height).toBe(40.5);

      // Returned points are fresh instances
      expect(tl).not.toBe(originalTL);
      expect(tl).not.toBe(originalFixed);
      expect(br).not.toBe(originalTL);
      expect(br).not.toBe(originalFixed);
    });
  });
});
