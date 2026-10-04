import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { shapeGetDimensionsToFit } from '../../src/shape/inner-geometry.js';
import { LABEL_PADDING } from '../../src/graph/label-position.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, '../fixtures/go-shape-sizing-reference.json');
const reference = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('Slice 21 Shape Sizing & FitToBoundingBox Oracle Replay', () => {
  describe('GetDimensionsToFit reference replay', () => {
    for (const tc of reference.getDimensionsToFit) {
      it(`replays ${tc.name} (${tc.shape})`, () => {
        // Test via shape helper
        const helperDims = shapeGetDimensionsToFit(
          tc.shape,
          tc.width,
          tc.height,
          tc.paddingX,
          tc.paddingY
        );
        expect(helperDims[0]).toBe(tc.fitWidth);
        expect(helperDims[1]).toBe(tc.fitHeight);

        // Test via Node.getDimensionsToFit
        const node = new Node('test_node');
        node.setShape(tc.shape);
        const nodeDims = node.getDimensionsToFit(
          tc.width,
          tc.height,
          tc.paddingX,
          tc.paddingY
        );
        expect(nodeDims[0]).toBe(tc.fitWidth);
        expect(nodeDims[1]).toBe(tc.fitHeight);

        // Test via Node.GetDimensionsToFit PascalCase alias
        const aliasDims = node.GetDimensionsToFit(
          tc.width,
          tc.height,
          tc.paddingX,
          tc.paddingY
        );
        expect(aliasDims[0]).toBe(tc.fitWidth);
        expect(aliasDims[1]).toBe(tc.fitHeight);
      });
    }
  });

  describe('FitToBoundingBox reference replay', () => {
    for (const tc of reference.fitToBoundingBox) {
      it(`replays ${tc.name} (${tc.shape})`, () => {
        const node = new Node('box_node');
        node.setShape(tc.shape);
        node.Width = tc.beforeWidth;
        node.Height = tc.beforeHeight;

        if (tc.label) {
          node.Label = {
            Width: tc.label.width,
            Height: tc.label.height,
            Position: tc.label.position,
          };
        } else {
          node.Label = null;
        }

        node.DesiredWidth = tc.desiredWidth;
        node.DesiredHeight = tc.desiredHeight;

        if (!tc.hasTopLeft) {
          node.TopLeft = null;
        }

        const tl = tc.tl ? new Point(tc.tl.x, tc.tl.y) : null;
        const br = tc.br ? new Point(tc.br.x, tc.br.y) : null;
        const padding = {
          top: tc.padding.top,
          bottom: tc.padding.bottom,
          left: tc.padding.left,
          right: tc.padding.right,
        };

        if (tc.panicked) {
          expect(() => {
            node.fitToBoundingBox(tl, br, padding);
          }).toThrow();
          // Dimensions must remain unchanged before/after panic
          expect(node.Width).toBe(tc.beforeWidth);
          expect(node.Height).toBe(tc.beforeHeight);
          return;
        }

        const boxBefore = node.Box;
        const labelBefore = node.Label;

        node.fitToBoundingBox(tl, br, padding);

        expect(node.Width).toBe(tc.afterWidth);
        expect(node.Height).toBe(tc.afterHeight);

        // PascalCase alias check on a clone
        const nodeAlias = new Node('box_node_alias');
        nodeAlias.setShape(tc.shape);
        nodeAlias.Width = tc.beforeWidth;
        nodeAlias.Height = tc.beforeHeight;
        nodeAlias.Label = node.Label ? { ...node.Label } : null;
        nodeAlias.DesiredWidth = tc.desiredWidth;
        nodeAlias.DesiredHeight = tc.desiredHeight;
        if (!tc.hasTopLeft) {
          nodeAlias.TopLeft = null;
        }
        nodeAlias.FitToBoundingBox(tl, br, padding);
        expect(nodeAlias.Width).toBe(tc.afterWidth);
        expect(nodeAlias.Height).toBe(tc.afterHeight);

        // Object identity preservation
        expect(node.Box).toBe(boxBefore);
        expect(node.Label).toBe(labelBefore);
      });
    }
  });

  describe('Section 43 Semantic Assertions', () => {
    it('RealSquare output width == height', () => {
      const cases = reference.getDimensionsToFit.filter(
        (c) => c.shape === 'RealSquare'
      );
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.fitWidth).toBe(c.fitHeight);
      }
    });

    it('Circle output width == height', () => {
      const cases = reference.getDimensionsToFit.filter(
        (c) => c.shape === 'Circle'
      );
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.fitWidth).toBe(c.fitHeight);
      }
    });

    it('Queue adds fixed arc allowance of 72 to width (3 * DEFAULT_ARC_DEPTH)', () => {
      const smallQueue = reference.getDimensionsToFit.find(
        (c) => c.name === 'queue_small_content'
      );
      expect(smallQueue).toBeDefined();
      // width = 5, paddingX = 2 -> totalWidth = 3 * 24 + 5 + 2 = 79
      expect(smallQueue.fitWidth).toBe(72 + smallQueue.width + smallQueue.paddingX);
      expect(smallQueue.fitHeight).toBe(smallQueue.height + smallQueue.paddingY);
    });

    it('Cylinder adds fixed arc allowance of 72 to height (3 * DEFAULT_ARC_DEPTH)', () => {
      const smallCyl = reference.getDimensionsToFit.find(
        (c) => c.name === 'cylinder_small_content'
      );
      expect(smallCyl).toBeDefined();
      // height = 5, paddingY = 2 -> totalHeight = 5 + 2 + 72 = 79
      expect(smallCyl.fitWidth).toBe(smallCyl.width + smallCyl.paddingX);
      expect(smallCyl.fitHeight).toBe(72 + smallCyl.height + smallCyl.paddingY);
    });

    it('Unset label acts as not-outside and expands dimensions', () => {
      const unsetCase = reference.fitToBoundingBox.find(
        (c) => c.name === 'unset_label_expands'
      );
      expect(unsetCase).toBeDefined();
      expect(unsetCase.afterWidth).toBe(120);
      expect(unsetCase.afterHeight).toBe(90);
    });

    it('Outside label does not trigger label minimum', () => {
      const outsideCase = reference.fitToBoundingBox.find(
        (c) => c.name === 'outside_label_ignored'
      );
      expect(outsideCase).toBeDefined();
      expect(outsideCase.afterWidth).toBe(50);
      expect(outsideCase.afterHeight).toBe(50);
    });

    it('DesiredWidth non-null suppresses label minWidth', () => {
      const suppressCase = reference.fitToBoundingBox.find(
        (c) => c.name === 'desired_width_suppresses_label_min'
      );
      expect(suppressCase).toBeDefined();
      expect(suppressCase.afterWidth).toBe(60);
      expect(suppressCase.afterHeight).toBe(70);
    });

    it('DesiredWidth = 0 is still non-null (suppresses label minWidth)', () => {
      const zeroCase = reference.fitToBoundingBox.find(
        (c) => c.name === 'desired_width_zero_is_non_nil'
      );
      expect(zeroCase).toBeDefined();
      expect(zeroCase.afterWidth).toBe(50);
      expect(zeroCase.afterHeight).toBe(70);
    });

    it('nil tl / br panics before dimension mutation', () => {
      const nilTl = reference.fitToBoundingBox.find(
        (c) => c.name === 'nil_tl_panics'
      );
      const nilBr = reference.fitToBoundingBox.find(
        (c) => c.name === 'nil_br_panics'
      );
      expect(nilTl.panicked).toBe(true);
      expect(nilBr.panicked).toBe(true);
      expect(nilTl.beforeWidth).toBe(nilTl.afterWidth);
      expect(nilBr.beforeWidth).toBe(nilBr.afterWidth);
    });

    it('node.TopLeft = null does not stop sizing', () => {
      const nullTlNode = reference.fitToBoundingBox.find(
        (c) => c.name === 'null_node_top_left_still_succeeds'
      );
      expect(nullTlNode).toBeDefined();
      expect(nullTlNode.panicked).toBe(false);
      expect(nullTlNode.afterWidth).toBe(120);
      expect(nullTlNode.afterHeight).toBe(100);
    });
  });

  describe('Section 44 Oval float32 precision proof', () => {
    it('demonstrates float32 truncation differs from float64 and matches Go oracle', () => {
      const tc = reference.getDimensionsToFit.find(
        (c) => c.name === 'oval_float32_regression'
      );
      expect(tc).toBeDefined();

      const f64Theta = Math.atan2(tc.height, tc.width);
      const f32Theta = Math.fround(f64Theta);

      expect(f32Theta).not.toBe(f64Theta);

      // Compute counterfactual incorrect float64 implementation
      const paddedWidth64 = tc.width + tc.paddingX * Math.cos(f64Theta);
      const paddedHeight64 = tc.height + tc.paddingY * Math.sin(f64Theta);
      let totalWidth64 = Math.ceil(Math.SQRT2 * paddedWidth64);
      let totalHeight64 = Math.ceil(Math.SQRT2 * paddedHeight64);
      const arLimit = 3.0;
      if (totalWidth64 > arLimit * totalHeight64) {
        totalHeight64 = Math.round(totalWidth64 / arLimit);
      } else if (totalHeight64 > arLimit * totalWidth64) {
        totalWidth64 = Math.round(totalHeight64 / arLimit);
      }

      // Establish that counterfactual float64 final dimensions differ from the Go fixture
      expect(
        totalWidth64 !== tc.fitWidth || totalHeight64 !== tc.fitHeight
      ).toBe(true);

      // Verify that production implementation matches the Go fixture exactly
      const dims = shapeGetDimensionsToFit(
        tc.shape,
        tc.width,
        tc.height,
        tc.paddingX,
        tc.paddingY
      );
      expect(dims[0]).toBe(tc.fitWidth);
      expect(dims[1]).toBe(tc.fitHeight);
    });
  });
});
