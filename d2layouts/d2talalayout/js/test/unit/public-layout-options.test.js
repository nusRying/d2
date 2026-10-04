// Slice 50 — public options, cancellation and error boundary.
import { describe, it as bunIt, expect } from 'bun:test';

import { layout } from '../../src/index.js';
import { layoutPlan, toInt64Seed } from '../../src/layout/options.js';

const it = (name, fn) => bunIt(name, fn, 300_000);
const GRAPH = () => ({
  id: 'root',
  children: [{ id: 'a', width: 100, height: 50 }, { id: 'b', width: 100, height: 50 }],
  edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }],
});

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected rejection');
}

describe('Slice 50 — seed options', () => {
  it('normalizes seeds: numbers, BigInt and integer strings; dedupes in first-occurrence order', () => {
    expect(layoutPlan({ seeds: [3, 1n, '3', -2], maxConcurrency: 1 })).toEqual({ seeds: [3n, 1n, -2n], concurrency: 1 });
    expect(layoutPlan({ seed: '9223372036854775807' }).seeds).toEqual([9223372036854775807n]);
    expect(layoutPlan({ seed: -9223372036854775808n }).seeds).toEqual([-9223372036854775808n]);
    expect(layoutPlan({}).seeds).toEqual([1n, 2n, 3n]);
  });

  it('rejects invalid seeds', () => {
    for (const bad of [1.5, NaN, Infinity, 2 ** 53, '1.0', 'abc', 9223372036854775808n, null, {}]) {
      expect(() => toInt64Seed(bad, 0)).toThrow('must be a signed 64-bit integer');
    }
  });

  it('enforces entry and unique limits', async () => {
    expect((await rejection(layout(GRAPH(), { seeds: [] }))).message).toBe('tala requires at least one seed');
    expect((await rejection(layout(GRAPH(), { seeds: new Array(65).fill(1) }))).message).toBe('tala accepts at most 64 seed entries');
    expect((await rejection(layout(GRAPH(), { seeds: Array.from({ length: 17 }, (_, i) => i) }))).message).toBe('tala supports at most 16 unique seeds');
  });

  it('validates maxConcurrency and clamps to the seed count', async () => {
    for (const bad of [-1, 17, 1.5]) {
      expect((await rejection(layout(GRAPH(), { seed: 1, maxConcurrency: bad }))).message)
        .toBe('tala MaxConcurrency must be between 1 and 16, or zero for the default');
    }
    expect(layoutPlan({ seeds: [1, 2], maxConcurrency: 16 }).concurrency).toBe(2);
    expect(layoutPlan({ seeds: [1, 2, 3, 4, 5], maxConcurrency: 0 }).concurrency).toBeGreaterThanOrEqual(1);
  });

  it('rejects both seed and seeds, unknown options and bad signals', async () => {
    expect((await rejection(layout(GRAPH(), { seed: 1, seeds: [1] }))).message).toBe('TALA layout options must not specify both seed and seeds');
    expect((await rejection(layout(GRAPH(), { sead: 1 }))).message).toBe('unknown TALA layout option "sead"');
    expect((await rejection(layout(GRAPH(), { signal: 'nope' }))).message).toBe('TALA layout option "signal" must be an AbortSignal');
  });
});

describe('Slice 50 — cancellation', () => {
  it('a pre-aborted signal fails before conversion or option validation', async () => {
    const controller = new AbortController();
    controller.abort();
    const input = GRAPH();
    const err = await rejection(layout(input, { signal: controller.signal, seeds: [] }));
    expect(err.message).toBe('context canceled');
    expect(input).toEqual(GRAPH());
  });

  it('a live signal does not affect the result', async () => {
    const controller = new AbortController();
    const withSignal = await layout(GRAPH(), { seed: 1, signal: controller.signal });
    const without = await layout(GRAPH(), { seed: 1 });
    expect(withSignal).toEqual(without);
  });
});

describe('Slice 50 — public error boundary', () => {
  it('reports validation errors unmasked', async () => {
    expect((await rejection(layout(null))).message).toBe('tala requires an ELK graph object');
    expect((await rejection(layout({ children: [] }))).message).toBe('Invalid ELK graph: missing id');
    const dup = { id: 'root', children: [{ id: 'a', width: 1, height: 1 }, { id: 'a', width: 1, height: 1 }] };
    expect((await rejection(layout(dup))).message).toContain('a');
    const unknown = { id: 'root', children: [{ id: 'a', width: 1, height: 1 }], edges: [{ id: 'e', sources: ['a'], targets: ['zz'] }] };
    expect((await rejection(layout(unknown))).message).toContain('zz');
    const hyper = { id: 'root', children: [{ id: 'a', width: 1, height: 1 }, { id: 'b', width: 1, height: 1 }], edges: [{ id: 'e', sources: ['a', 'b'], targets: ['a'] }] };
    expect((await rejection(layout(hyper))).message).toContain('hyperedges');
    const negative = { id: 'root', children: [{ id: 'a', width: -1, height: 1 }] };
    expect((await rejection(layout(negative))).message).toContain('finite non-negative');
  });

  it('rejects nesting deeper than 256 without overflowing the stack', async () => {
    const graph = { id: 'root', children: [] };
    let parent = graph;
    for (let i = 0; i < 300; i++) {
      const child = { id: `n${i}`, width: 10, height: 10, children: [] };
      parent.children.push(child);
      parent = child;
    }
    expect((await rejection(layout(graph))).message).toContain('nesting depth exceeds the limit of 256');
  });

  it('rejects node and edge count overflow', async () => {
    const nodes = { id: 'root', children: Array.from({ length: 10_001 }, (_, i) => ({ id: `n${i}`, width: 1, height: 1 })) };
    expect((await rejection(layout(nodes))).message).toContain('node count exceeds the limit of 10000');
    const edges = {
      id: 'root',
      children: [{ id: 'a', width: 1, height: 1 }],
      edges: Array.from({ length: 50_001 }, (_, i) => ({ id: `e${i}`, sources: ['a'], targets: ['a'] })),
    };
    expect((await rejection(layout(edges))).message).toContain('edge count exceeds the limit of 50000');
  });

  it('converts internal runtime faults to a stable public error', async () => {
    const signal = {};
    Object.defineProperty(signal, 'aborted', { get() { throw new TypeError('boom'); } });
    // `aborted` must look like a boolean for the shape check, then fault later.
    let calls = 0;
    const faulty = { get aborted() { calls++; if (calls > 1) throw new TypeError('internal fault'); return false; } };
    const err = await rejection(layout(GRAPH(), { seed: 1, signal: faulty }));
    expect(err.message).toBe('TALA layout failed due to an internal invariant');
    expect(err.cause).toBeInstanceOf(TypeError);
  });
});
