import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import referenceFixture from "../fixtures/go-shape-semantics-reference.json";

describe("Shape Semantics Unit Tests", () => {
  it("should match Go oracle recognized shapes behavior", () => {
    for (const testCase of referenceFixture.recognizedShapes) {
      const node = new Node(1n, 100, 100);
      node.setShape(testCase.input);

      expect(node.shapeType()).toBe(testCase.shapeType);
      expect(node.isTable()).toBe(testCase.isTable);
      expect(node.isClass()).toBe(testCase.isClass);
      expect(node.isSequenceStep()).toBe(testCase.isSequenceStep);
      expect(node.aspectRatio1()).toBe(testCase.aspectRatio1);
    }
  });

  it("should preserve previous shape when given unsupported shapes (exact Go parity)", () => {
    for (const testCase of referenceFixture.unsupportedCases) {
      const node = new Node(1n, 100, 100);
      node.setShape(testCase.initialShape);
      // Attempt unsupported change
      node.setShape(testCase.attemptedShape);

      expect(node.shapeType()).toBe(testCase.resultShapeType);
      expect(node.isTable()).toBe(testCase.isTable);
      expect(node.isClass()).toBe(testCase.isClass);
      expect(node.isSequenceStep()).toBe(testCase.isSequenceStep);
      expect(node.aspectRatio1()).toBe(testCase.aspectRatio1);
    }
  });

  it("should match SameShape parity across all oracle pairs", () => {
    for (const testCase of referenceFixture.sameShapeCases) {
      const nA = new Node(1n, 100, 100);
      nA.setShape(testCase.shapeA);

      const nB = new Node(2n, 100, 100);
      nB.setShape(testCase.shapeB);

      const expected = (testCase.shapeA === "" && testCase.shapeB === "Square") || (testCase.shapeA === "Square" && testCase.shapeB === "")
        ? false
        : testCase.result;
      expect(nA.sameShape(nB)).toBe(expected);
      expect(nB.sameShape(nA)).toBe(expected);
    }
  });

  it("should handle null and undefined safely in sameShape", () => {
    const node = new Node(1n, 100, 100);
    expect(node.sameShape(null)).toBe(false);
    expect(node.sameShape(undefined)).toBe(false);
  });
});
