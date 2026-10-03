// Slice 46 focused unit tests for graphbounds, loops, the label model and the
// nodeshape subset. Expected values mirror pinned Go unit tests
// (internal/loops/loops_test.go, internal/graphbounds/bounds_test.go) or are
// structural invariants; numeric parity is covered by the *-oracle tests.
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import * as graphbounds from '../../src/graphbounds/index.js';
import * as loops from '../../src/loops/index.js';
import * as model from '../../src/labeling/model.js';
import { LabelTier, shapeLabelPositionPreferences, shapeIsRectangular } from '../../src/shape/label-preferences.js';
import { SHAPE_TYPES, goTruncateDecimals, shapePortIndices } from '../../src/shape/ports.js';
import { tableColumnPortValue, tablePortIndex } from '../../src/shape/table-ports.js';

const guard = (limit = 1_000_000) => new WorkGuard(backgroundWorkContext(), 'Slice46Unit', limit);

describe('slice 46 exports', () => {
  it('exposes the required names', () => {
    for (const name of ['computeOffsets', 'updateOffsets', 'route', 'ComputeOffsets', 'UpdateOffsets', 'Route', 'edgesInOrder']) {
      expect(typeof loops[name]).toBe('function');
    }
    for (const name of ['nodeBoundingBox', 'boundingBox', 'fixedBoundingBox', 'NodeBoundingBox', 'BoundingBox', 'FixedBoundingBox']) {
      expect(typeof graphbounds[name]).toBe('function');
    }
    expect(typeof model.initialize).toBe('function');
    expect(model.Initialize).toBe(model.initialize);
  });

  it('new production modules are browser-safe', () => {
    const roots = ['graphbounds', 'loops', 'labeling'].map((d) => join(import.meta.dir, '..', '..', 'src', d));
    const files = roots.flatMap((root) => readdirSync(root).map((f) => join(root, f)));
    files.push(
      join(import.meta.dir, '..', '..', 'src', 'shape', 'ports.js'),
      join(import.meta.dir, '..', '..', 'src', 'shape', 'label-preferences.js'),
      join(import.meta.dir, '..', '..', 'src', 'shape', 'table-ports.js'),
      join(import.meta.dir, '..', '..', 'src', 'geometry', 'bezier.js'),
    );
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/from ['"]node:|require\(|\bprocess\.|\bBuffer\b|Math\.random/);
    }
  });
});

describe('graphbounds edge cases', () => {
  it('empty node set yields Go infinite sentinel bounds and only Finish work', () => {
    const g = guard();
    const [tl, br] = graphbounds.boundingBox([], g);
    expect([tl.X, tl.Y, br.X, br.Y]).toEqual([-Infinity, -Infinity, Infinity, Infinity]);
    expect(g.Used()).toBe(0n);
  });

  it('unplaced node throws the Go invariant message after charging one step', () => {
    const g = guard();
    expect(() => graphbounds.nodeBoundingBox(new Node(1n, 5, 5), [], g))
      .toThrow('layout invariant violated: BinPack bounding box contains an unplaced node');
    expect(g.Used()).toBe(1n);
  });

  it('null allNodes ignores outside labels and icons', () => {
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(0, 0);
    n.Label = new Label('', 100, 100);
    n.Label.Position = LabelPosition.OutsideLeftMiddle;
    n.Icon = new Icon(LabelPosition.OutsideTopLeft);
    const [tl, br] = graphbounds.nodeBoundingBox(n, null, guard());
    expect([tl.X, tl.Y, br.X, br.Y]).toEqual([0, 0, 10, 10]);
  });

  it('work limit exhaustion throws the Go limit message', () => {
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(0, 0);
    expect(() => graphbounds.boundingBox([n], guard(0))).toThrow('TALA Slice46Unit work exceeds limit 0');
  });
});

describe('loops edge cases', () => {
  // Ports of internal/loops/loops_test.go.
  it('edgesInOrder preserves equal label order and does not mutate input', () => {
    const node = new Node(1n, 10, 10);
    const labeled = (w, h) => {
      const e = new Edge(node, node);
      e.Label = new Label('', w, h);
      return e;
    };
    const firstEqual = labeled(10, 10);
    const larger = labeled(20, 10);
    const secondEqual = labeled(20, 5);
    const smaller = labeled(5, 10);
    const input = [firstEqual, larger, secondEqual, smaller];
    const got = loops.edgesInOrder(input);
    expect(got).toEqual([smaller, firstEqual, secondEqual, larger]);
    expect(got[0]).toBe(smaller);
    expect(input[1]).toBe(larger);
  });

  it('edgesInOrder preserves one-sided arrow order', () => {
    const node = new Node(1n, 10, 10);
    const targetOnly = new Edge(node, node);
    targetOnly.TargetArrowhead = 'triangle';
    const sourceOnly = new Edge(node, node);
    sourceOnly.SourceArrowhead = 'triangle';
    const plain = new Edge(node, node);
    const got = loops.edgesInOrder([targetOnly, plain, sourceOnly]);
    expect(got[0]).toBe(targetOnly);
    expect(got[1]).toBe(sourceOnly);
    expect(got[2]).toBe(plain);
  });

  it('edgesInOrder keeps a NaN label area tied with a finite one', () => {
    const node = new Node(1n, 10, 10);
    const nonFinite = new Edge(node, node);
    nonFinite.Label = new Label('', NaN, 10);
    const finite = new Edge(node, node);
    finite.Label = new Label('', 10, 10);
    const got = loops.edgesInOrder([nonFinite, finite]);
    expect(got[0]).toBe(nonFinite);
    expect(got[1]).toBe(finite);
  });

  it('updateOffsets restores a nil TopLeft, clears loop routes, and leaves empty offsets without loops', () => {
    const g = new Graph();
    const a = new Node(1n, 100, 60);
    const b = new Node(2n, 100, 60);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const loop = g.connect(a, a);
    loop.TargetArrowhead = 'triangle';
    loop.Label = new Label('', 20, 10);
    g.connect(a, b);
    loops.computeOffsets(g);
    expect(a.TopLeft).toBeNull();
    expect(loop.Points).toEqual([]);
    expect(loop.Label.Position).toBe(LabelPosition.OutsideTopCenter);
    expect(a.LoopOffsets.size).toBe(8);
    expect(b.LoopOffsets).toBeInstanceOf(Map);
    expect(b.LoopOffsets.size).toBe(0);
    // Diagonals are the max of their two sides.
    const o = a.LoopOffsets;
    expect(o.get(Orientation.TopRight)).toBe(Math.max(o.get(Orientation.Top), o.get(Orientation.Right)));
    expect(o.get(Orientation.BottomLeft)).toBe(Math.max(o.get(Orientation.Bottom), o.get(Orientation.Left)));
  });

  it('route shares a port pair across loops with the same arrowheads', () => {
    const g = new Graph();
    const a = new Node(1n, 100, 60);
    a.TopLeft = new Point(0, 0);
    g.addNewNodeToContainer(null, a);
    const e1 = g.connect(a, a);
    const e2 = g.connect(a, a);
    const routed = loops.route(a);
    expect(routed).toEqual([e1, e2]);
    expect(e1.Points.length).toBe(5);
    expect(e2.Points[0]).toBe(e1.Points[0]);
    expect(e2.Points[4]).toBe(e1.Points[4]);
  });

  it('route throws when every port pair is taken by other arrowhead kinds (Go nil deref panic)', () => {
    const g = new Graph();
    const a = new Node(1n, 100, 60);
    a.TopLeft = new Point(0, 0);
    g.addNewNodeToContainer(null, a);
    for (const head of ['triangle', 'arrow', 'diamond', 'circle']) {
      g.connect(a, a).TargetArrowhead = head;
    }
    g.connect(a, a);
    expect(() => loops.route(a)).toThrow();
  });
});

describe('nodeshape subset edge cases', () => {
  it('every shape has a non-empty Good tier and Bad/unknown tiers are sets', () => {
    for (const shape of SHAPE_TYPES) {
      expect(shapeLabelPositionPreferences(shape, LabelTier.Good).size).toBeGreaterThan(0);
      expect(shapeLabelPositionPreferences(shape, 7).size).toBe(0);
      expect(typeof shapeIsRectangular(shape)).toBe('boolean');
      expect(shapePortIndices(shape, Orientation.NONE)).toEqual([]);
    }
    expect(() => shapeLabelPositionPreferences('Bogus', LabelTier.Good)).toThrow();
  });

  it('goTruncateDecimals follows Go amd64 conversion for NaN and infinities', () => {
    expect(goTruncateDecimals(NaN)).toBe(-9223372036854775.808);
    expect(goTruncateDecimals(Infinity)).toBe(-9223372036854775.808);
    expect(Object.is(goTruncateDecimals(-0.0001), 0)).toBe(true);
    expect(goTruncateDecimals(0.12345)).toBe(0.123);
  });

  it('table column ports throw the Go panic message out of range', () => {
    const n = new Node(1n, 100, 100);
    n.TopLeft = new Point(0, 0);
    n.setShape('Table');
    n.setNumColumns(2);
    expect(() => tableColumnPortValue(n, Orientation.Left, 2)).toThrow('table column port index out of range');
    expect(() => tablePortIndex(n, Orientation.Left, -1)).toThrow('table column port index out of range');
    expect(tablePortIndex(n, Orientation.Right, 1)).toEqual([9, true]);
    const square = new Node(2n, 10, 10);
    square.setNumColumns(3);
    expect(tableColumnPortValue(square, Orientation.Left, 9)[1]).toBe(false);
  });
});

describe('label model edge cases', () => {
  it('initialize fixes explicit positions, defaults unset labels, and fixes set icons only', () => {
    const g = new Graph();
    const a = new Node(1n, 10, 10);
    a.Label = new Label('', 5, 5);
    const b = new Node(2n, 10, 10);
    b.Label = new Label('', 5, 5);
    b.Label.Position = LabelPosition.OutsideLeftTop;
    b.Icon = new Icon(null);
    const c = new Node(3n, 10, 10);
    c.Icon = new Icon(LabelPosition.InsideTopLeft);
    for (const n of [a, b, c]) g.addNewNodeToContainer(null, n);
    model.initialize(g);
    expect(a.Label.Position).toBe(model.labelPositionPreferences(a)[0]);
    expect(a.Label.PositionFixed()).toBe(false);
    expect(b.Label.Position).toBe(LabelPosition.OutsideLeftTop);
    expect(b.Label.PositionFixed()).toBe(true);
    expect(b.Icon.PositionFixed()).toBe(false);
    expect(c.Icon.PositionFixed()).toBe(true);
  });
});
