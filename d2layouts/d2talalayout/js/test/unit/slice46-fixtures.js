// Shared helpers for the Slice 46 Go-oracle replays. They only rebuild the
// Go-exported graph specs and decode Go's JSON-safe float encoding; every
// expected value is read from the fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Point } from '../../src/geometry/point.js';

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8'));
}

/** num decodes Go's JSON-safe floats ("NaN", "+Inf", "-Inf", "-0"). */
export function num(value) {
  if (typeof value === 'number') return value;
  switch (value) {
    case 'NaN': return NaN;
    case '+Inf': return Infinity;
    case '-Inf': return -Infinity;
    case '-0': return -0;
    default: throw new Error(`unexpected encoded float ${JSON.stringify(value)}`);
  }
}

export function nums(values) {
  return values == null ? null : values.map(num);
}

/** Encodes a JS float like the Go oracle so -0/NaN/Inf compare exactly. */
export function enc(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  if (Object.is(value, -0)) return '-0';
  return value;
}

export function encAll(values) {
  return values == null ? null : values.map(enc);
}

/**
 * buildSpec rebuilds a Go-exported graph spec. Supported node fields: id, w, h,
 * placed, x, y, shape, numColumns, container, fixed/fx/fy, label {w,h,pos},
 * icon, is3d, multiple, loopOffsets [{o,v}], forceContainer. Edge fields:
 * from, to, src, dst, label {w,h,pos}.
 */
export function buildSpec(spec) {
  const g = new Graph();
  const nodes = new Map();
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), num(ns.w), num(ns.h));
    n.setShape(ns.shape ?? '');
    if (ns.numColumns) n.setNumColumns(ns.numColumns);
    if (ns.placed) n.TopLeft = new Point(num(ns.x), num(ns.y));
    if (ns.fixed) n.FixedTopLeft = new Point(num(ns.fx ?? 0), num(ns.fy ?? 0));
    if (ns.label != null) {
      n.Label = new Label('', num(ns.label.w), num(ns.label.h));
      n.Label.Position = ns.label.pos;
    }
    if (ns.icon != null) n.Icon = new Icon(ns.icon);
    n.Is3D = Boolean(ns.is3d);
    n.IsMultiple = Boolean(ns.multiple);
    if (ns.loopOffsets != null && ns.loopOffsets.length > 0) {
      n.LoopOffsets = new Map();
      for (const o of ns.loopOffsets) n.LoopOffsets.set(o.o, num(o.v));
    }
    const container = ns.container ? nodes.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    nodes.set(ns.id, n);
  }
  for (const ns of spec.nodes ?? []) {
    if (ns.forceContainer) nodes.get(ns.id).Container = nodes.get(ns.forceContainer);
  }
  const edges = [];
  for (const es of spec.edges ?? []) {
    const e = g.connect(nodes.get(es.from), nodes.get(es.to));
    if (es.src) e.SourceArrowhead = es.src;
    if (es.dst) e.TargetArrowhead = es.dst;
    if (es.label != null) {
      e.Label = new Label('', num(es.label.w), num(es.label.h));
      e.Label.Position = es.label.pos;
    }
    edges.push(e);
  }
  return { g, nodes, edges };
}

export function countingContext(cancelAt = 0) {
  const canceled = new Error('context canceled');
  return {
    calls: 0,
    cancelAt,
    Err() {
      this.calls++;
      return this.cancelAt > 0 && this.calls >= this.cancelAt ? canceled : null;
    },
  };
}

export function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}
