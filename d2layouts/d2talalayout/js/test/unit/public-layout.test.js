// Slice 50 — public ELK-JSON layout(): end-to-end behavior through the
// package root.
import { describe, it as bunIt, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

import * as root from '../../src/index.js';
import { layout } from '../../src/index.js';
import { elkToTalaGraph } from '../../src/elk/adapter.js';

const it = (name, fn) => bunIt(name, fn, 300_000);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

function finitePoint(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function allNodes(graph) {
  const out = [];
  const stack = [...(graph.children ?? [])];
  while (stack.length > 0) {
    const node = stack.shift();
    out.push(node);
    stack.push(...(node.children ?? []));
  }
  return out;
}

function allEdges(graph) {
  const out = [...(graph.edges ?? [])];
  for (const node of allNodes(graph)) out.push(...(node.edges ?? []));
  return out;
}

function expectRouted(output) {
  for (const node of allNodes(output)) {
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
    expect(node.width > 0 && node.height > 0).toBe(true);
  }
  for (const edge of allEdges(output)) {
    expect(edge.sections).toHaveLength(1);
    const [section] = edge.sections;
    expect(finitePoint(section.startPoint)).toBe(true);
    expect(finitePoint(section.endPoint)).toBe(true);
    for (const bend of section.bendPoints ?? []) expect(finitePoint(bend)).toBe(true);
  }
}

const TWO_NODES = {
  id: 'root',
  children: [
    { id: 'a', width: 100, height: 50 },
    { id: 'b', width: 100, height: 50 },
  ],
  edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }],
};

describe('Slice 50 — package root', () => {
  it('exposes only the public ELK layout API', () => {
    expect(Object.keys(root).sort()).toEqual(['defaultOptions', 'layout']);
    expect(typeof layout).toBe('function');
    expect(layout(structuredClone(TWO_NODES), { seed: 1 })).toBeInstanceOf(Promise);
  });

  it('lays out the README example from the root import', async () => {
    const input = structuredClone(TWO_NODES);
    const before = structuredClone(input);
    const output = await layout(input, { seed: 1 });
    expect(input).toEqual(before);
    expect(output).not.toBe(input);
    expect(output.children).not.toBe(input.children);
    expectRouted(output);
    expect(output.edges[0].sections[0].startPoint).toEqual({ x: 100, y: 25 });
    expect(output.edges[0].sections[0].endPoint).toEqual({ x: 200, y: 25 });
    expect(() => JSON.parse(JSON.stringify(output))).not.toThrow();
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it('defaultOptions returns a fresh object each call', () => {
    const a = root.defaultOptions();
    const b = root.defaultOptions();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.seeds).not.toBe(b.seeds);
    expect(a.seeds).toEqual([1, 2, 3]);
    a.seeds.push(99);
    expect(root.defaultOptions().seeds).toEqual([1, 2, 3]);
  });
});

describe('Slice 50 — public layout scenarios', () => {
  it('empty graph', async () => {
    const input = { id: 'root', children: [] };
    const output = await layout(input, { seed: 1 });
    expect(output).toEqual({ id: 'root', children: [] });
    expect(input).toEqual({ id: 'root', children: [] });
  });

  it('single node', async () => {
    const output = await layout({ id: 'root', children: [{ id: 'a', width: 80, height: 40 }] }, { seed: 1 });
    expect(output.children[0]).toEqual({ id: 'a', width: 80, height: 40, x: 0, y: 0 });
  });

  it('simple 3-node chain', async () => {
    const output = await layout(fixture('simple-chain.json'), { seed: 1 });
    expectRouted(output);
  });

  it('nested container with inner and outer edges uses owner-relative sections', async () => {
    const input = {
      id: 'root',
      children: [
        {
          id: 'group',
          children: [
            { id: 'a', width: 80, height: 40 },
            { id: 'b', width: 80, height: 40 },
          ],
          edges: [{ id: 'inner', sources: ['a'], targets: ['b'] }],
        },
        { id: 'c', width: 100, height: 50 },
      ],
      edges: [{ id: 'outer', sources: ['c'], targets: ['a'] }],
    };
    const output = await layout(input, { seed: 1 });
    expectRouted(output);
    const group = output.children.find((n) => n.id === 'group');
    const a = group.children.find((n) => n.id === 'a');
    const b = group.children.find((n) => n.id === 'b');
    const inner = group.edges[0].sections[0];
    // The inner route is relative to the group: its endpoints lie on the
    // borders of a and b in group coordinates.
    const onBorder = (p, n) => p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height &&
      (p.x === n.x || p.x === n.x + n.width || p.y === n.y || p.y === n.y + n.height);
    expect(onBorder(inner.startPoint, a)).toBe(true);
    expect(onBorder(inner.endPoint, b)).toBe(true);
    // The internal (absolute) route equals the relative one plus the group offset.
    const internal = elkToTalaGraph(output);
    const internalA = internal.Nodes.find((n) => n.D2ID === 'a' || n.elkData?.id === 'a');
    expect(internalA.TopLeft.X).toBe(group.x + a.x);
    expect(internalA.TopLeft.Y).toBe(group.y + a.y);
  });

  it('self-loop', async () => {
    const output = await layout({
      id: 'root',
      children: [{ id: 'a', width: 100, height: 50 }, { id: 'b', width: 100, height: 50 }],
      edges: [{ id: 'loop', sources: ['a'], targets: ['a'] }, { id: 'e', sources: ['a'], targets: ['b'] }],
    }, { seed: 1 });
    expectRouted(output);
    expect(output.edges[0].sections[0].bendPoints.length).toBeGreaterThan(0);
  });

  it('node and edge labels are positioned by the labeling engine', async () => {
    const output = await layout({
      id: 'root',
      children: [
        { id: 'a', width: 100, height: 50, labels: [{ id: 'la', text: 'A', width: 20, height: 12, custom: 1 }] },
        { id: 'b', width: 100, height: 50 },
      ],
      edges: [{ id: 'e', sources: ['a'], targets: ['b'], labels: [{ id: 'le', text: 'edge', width: 30, height: 12 }] }],
    }, { seed: 1 });
    const nodeLabel = output.children[0].labels[0];
    const edgeLabel = output.edges[0].labels[0];
    expect(Number.isFinite(nodeLabel.x) && Number.isFinite(nodeLabel.y)).toBe(true);
    expect(Number.isFinite(edgeLabel.x) && Number.isFinite(edgeLabel.y)).toBe(true);
    expect(nodeLabel).toMatchObject({ id: 'la', text: 'A', custom: 1, width: 20, height: 12 });
    expect(edgeLabel).toMatchObject({ id: 'le', text: 'edge' });
  });

  it('stale incoming sections are replaced by the computed route', async () => {
    const input = structuredClone(TWO_NODES);
    input.edges[0].sections = [{ id: 's0', startPoint: { x: 999, y: 999 }, endPoint: { x: -5, y: -5 }, bendPoints: [{ x: 1, y: 1 }] }];
    const before = structuredClone(input);
    const output = await layout(input, { seed: 1 });
    expect(input).toEqual(before);
    expect(output.edges[0].sections).toEqual([{ id: 's0', startPoint: { x: 100, y: 25 }, bendPoints: [], endPoint: { x: 200, y: 25 } }]);
  });

  it('elk.direction RIGHT and DOWN change the flow axis', async () => {
    const chain = (direction) => ({
      id: 'root',
      layoutOptions: { 'elk.direction': direction },
      children: ['a', 'b', 'c'].map((id) => ({ id, width: 100, height: 50 })),
      edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }, { id: 'e2', sources: ['b'], targets: ['c'] }],
    });
    const right = await layout(chain('RIGHT'), { seed: 1 });
    const down = await layout(chain('down'), { seed: 1 });
    expect(right.children.map((n) => [n.x, n.y])).toEqual([[0, 0], [200, 0], [400, 0]]);
    expect(down.children.map((n) => [n.x, n.y])).toEqual([[0, 0], [0, 200], [0, 400]]);
    expect(right.layoutOptions).toEqual({ 'elk.direction': 'RIGHT' });
  });

  it('preserves port endpoint ids and custom metadata', async () => {
    const ports = fixture('ports.json');
    for (const node of ports.children) {
      node.width = 120;
      node.height = 60;
    }
    const portsOut = await layout(ports, { seed: 1 });
    expect(portsOut.children[0].ports).toEqual(ports.children[0].ports);
    const inputEdges = allEdges(ports);
    const outputEdges = allEdges(portsOut);
    expect(outputEdges.map((e) => [e.id, e.sources, e.targets])).toEqual(inputEdges.map((e) => [e.id, e.sources, e.targets]));

    const metadata = fixture('metadata-preservation.json');
    const before = structuredClone(metadata);
    const out = await layout(metadata, { seed: 1 });
    expect(metadata).toEqual(before);
    const strip = (value) => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === 'object') {
        const copy = {};
        for (const [key, v] of Object.entries(value)) {
          if (['x', 'y', 'width', 'height', 'sections'].includes(key)) continue;
          copy[key] = strip(v);
        }
        return copy;
      }
      return value;
    };
    expect(strip(out)).toEqual(strip(before));
  });

  it('round-trips its own output', async () => {
    const output = await layout(structuredClone(TWO_NODES), { seed: 1 });
    const again = await layout(output, { seed: 1 });
    expect(again.children).toEqual(output.children);
    expect(again.edges[0].sections).toEqual(output.edges[0].sections);
  });

  it('lays out a ~50-node / 75-edge graph with finite output', async () => {
    let x = 1;
    const rnd = () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
    const children = [];
    const edges = [];
    for (let i = 0; i < 50; i++) children.push({ id: `n${i}`, width: 60 + Math.floor(rnd() * 60), height: 40 });
    const seen = new Set();
    while (edges.length < 75) {
      const a = Math.floor(rnd() * 50);
      const b = Math.floor(rnd() * 50);
      if (a === b || seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      edges.push({ id: `e${edges.length}`, sources: [`n${a}`], targets: [`n${b}`] });
    }
    const output = await layout({ id: 'root', children, edges }, { seed: 1 });
    expectRouted(output);
  });
});
