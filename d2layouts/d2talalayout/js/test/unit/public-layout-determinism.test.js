// Slice 50 — determinism of the public API and the multi-seed path.
import { describe, it as bunIt, expect } from 'bun:test';

import { layout } from '../../src/index.js';
import { elkToTalaGraph } from '../../src/elk/adapter.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { newSeedInput } from '../../src/layout/seed.js';
import { runLocalSeed } from '../../src/layout/coordinator.js';

const it = (name, fn) => bunIt(name, fn, 300_000);
const GRAPH = () => ({
  id: 'root',
  children: [
    { id: 'a', width: 100, height: 50 },
    { id: 'b', width: 80, height: 40 },
    { id: 'c', width: 80, height: 40 },
    { id: 'd', width: 120, height: 60 },
  ],
  edges: [
    { id: 'e1', sources: ['a'], targets: ['b'] },
    { id: 'e2', sources: ['a'], targets: ['c'] },
    { id: 'e3', sources: ['b'], targets: ['d'] },
    { id: 'e4', sources: ['c'], targets: ['d'] },
  ],
});

describe('Slice 50 — determinism', () => {
  it('the same input and seed produce identical output across 5 runs', async () => {
    const outputs = [];
    for (let i = 0; i < 5; i++) outputs.push(JSON.stringify(await layout(GRAPH(), { seed: 1 })));
    expect(new Set(outputs).size).toBe(1);
  });

  it('the multi-seed winner is deterministic and is one of the configured seeds', async () => {
    const first = JSON.stringify(await layout(GRAPH(), { seeds: [1, 2, 3] }));
    const second = JSON.stringify(await layout(GRAPH(), { seeds: [1, 2, 3], maxConcurrency: 1 }));
    expect(first).toBe(second);
    const ctx = backgroundWorkContext();
    const input = newSeedInput(ctx, elkToTalaGraph(GRAPH()));
    const attempts = [1n, 2n, 3n].map((seed, index) => runLocalSeed(ctx, input, index, seed));
    for (const attempt of attempts) expect(attempt.error).toBeNull();
    // Selection: lowest score; exact ties go to the later index.
    let best = 0;
    for (let i = 1; i < attempts.length; i++) {
      const cmp = attempts[i].result.score.Compare(attempts[best].result.score);
      if (cmp < 0 || cmp === 0) best = i;
    }
    const single = JSON.stringify(await layout(GRAPH(), { seed: [1, 2, 3][best] }));
    expect(first).toBe(single);
  });

  it('seed input is reused without mutation across attempts', () => {
    const ctx = backgroundWorkContext();
    const graph = elkToTalaGraph(GRAPH());
    const input = newSeedInput(ctx, graph);
    const snapshot = () => JSON.stringify(graph.Nodes.map((n) => [String(n.ID), n.TopLeft?.X, n.TopLeft?.Y, n.Width, n.Height]));
    const before = snapshot();
    const a = runLocalSeed(ctx, input, 0, 1n);
    const b = runLocalSeed(ctx, input, 1, 1n);
    expect(snapshot()).toBe(before);
    expect(a.result.score.Compare(b.result.score)).toBe(0);
  });
});
