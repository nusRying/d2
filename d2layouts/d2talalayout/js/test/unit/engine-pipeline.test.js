// Slice 50 — engine pipeline orchestration (internal/engine/pipeline.go).
import { describe, it as bunIt, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { WorkContext, backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  CancelChildContext,
  DEFAULT_PIPELINE_STAGES,
  Layout,
  LayoutOptions,
  PipelineStage,
  newPipeline,
  runLayout,
} from '../../src/engine/pipeline.js';

const it = (name, fn) => bunIt(name, fn, 300_000);
const bg = backgroundWorkContext();

function chain(n = 3) {
  const g = new Graph();
  const nodes = [];
  for (let i = 1; i <= n; i++) {
    const node = new Node(BigInt(i), 100, 50);
    g.AddNewNodeToContainer(null, node);
    nodes.push(node);
  }
  for (let i = 1; i < n; i++) {
    const e = g.Connect(nodes[i - 1], nodes[i]);
    e.ID = BigInt(100 + i);
  }
  return g;
}

function pinnedStageNames() {
  // Parse the authoritative Go stage table.
  const source = readFileSync(new URL('../../../internal/engine/pipeline.go', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('var defaultPipelineStages'), source.indexOf('func (p *pipeline) stagePlan'));
  return [...table.matchAll(/\{name: "([A-Za-z]+)"/g)].map((m) => m[1]);
}

function cancelAfter(calls) {
  let count = 0;
  let canceled = false;
  return new WorkContext({
    isCancelled: () => {
      count++;
      if (count >= calls) canceled = true;
      return canceled;
    },
    doneAvailable: true,
  });
}

describe('Slice 50 — pipeline plan', () => {
  it('matches the pinned 37-stage order exactly', () => {
    const names = DEFAULT_PIPELINE_STAGES.map((s) => s.name);
    expect(names).toHaveLength(37);
    expect(names).toEqual(pinnedStageNames());
    expect(names.filter((n) => n === 'AlignAxes')).toHaveLength(4);
    expect(names.filter((n) => n === 'BinPack')).toHaveLength(2);
    expect(names.filter((n) => n === 'EdgeRouting')).toHaveLength(2);
  });

  it('creates two independent GoRand streams from the same seed', () => {
    const p = newPipeline(chain(), 7n, false);
    expect(p.random).not.toBe(p.hierarchyPlacementRandom);
    const a = p.random.Int63();
    expect(p.hierarchyPlacementRandom.Int63()).toBe(a);
    expect(p.alignAxesNeeded).toBe(true);
  });

  it('alignAxes clears the flag before aligning', () => {
    const p = newPipeline(chain(), 1n, false);
    p.graph.ComputeCellSize();
    p.alignAxesNeeded = false;
    p.alignAxes(bg);
    expect(p.alignAxesNeeded).toBe(false);
  });
});

describe('Slice 50 — pipeline execution', () => {
  it('runs every stage in order and resets route state before Prescale', () => {
    const g = chain();
    const stale = g.Edges[0];
    stale.Points = [new Point(1, 1), new Point(2, 2)];
    stale.IsCurve = true;
    stale.LabelPercentage = 0.7;
    stale.Label = new Label('l', 10, 10);
    stale.Label.Position = LabelPosition.UnlockedTop ?? stale.Label.Position;
    const fixedEdge = g.Edges[1];
    fixedEdge.Label = new Label('f', 10, 10);
    fixedEdge.Label.Position = LabelPosition.InsideMiddleCenter;
    fixedEdge.Label.FixPosition();
    fixedEdge.LabelPercentage = 0.3;

    const p = newPipeline(g, 1n, false);
    const seen = [];
    let observed = null;
    p.stages = DEFAULT_PIPELINE_STAGES.map((stage, index) => new PipelineStage(stage.name, (pipeline, ctx) => {
      if (index === 0) {
        observed = { points: stale.Points.length, curve: stale.IsCurve, pct: stale.LabelPercentage, fixedPct: fixedEdge.LabelPercentage };
      }
      seen.push(stage.name);
      stage.run(pipeline, ctx);
    }));
    p.runAllStages(bg);
    expect(seen).toEqual(DEFAULT_PIPELINE_STAGES.map((s) => s.name));
    expect(observed).toEqual({ points: 0, curve: false, pct: 0, fixedPct: 0.3 });
    expect(p.edgeRoutingComplete).toBe(true);
    for (const edge of g.Edges) expect(edge.Points.length).toBeGreaterThanOrEqual(2);
  });

  it('cancellation before a stage stops the pipeline with the stage name', () => {
    // The shared transaction guard polls first (pinned EnsureTransactionWorkGuard).
    expect(() => newPipeline(chain(), 1n, false).runAllStages(cancelAfter(1))).toThrow('AutolayoutTransactions: context canceled');
    expect(() => newPipeline(chain(), 1n, false).runAllStages(cancelAfter(2))).toThrow('Prescale: context canceled');
  });

  it('post-stage cancellation is detected', () => {
    let canceled = false;
    const ctx = new WorkContext({ isCancelled: () => canceled, doneAvailable: true });
    const p = newPipeline(chain(), 1n, false);
    p.stages = [new PipelineStage('Probe', () => { canceled = true; })];
    expect(() => p.runAllStages(ctx)).toThrow('Probe: context canceled');
  });

  it('rejects graphs larger than the pinned size after a stage', () => {
    const g = chain(2);
    g.Nodes[0].TopLeft = new Point(0, 0);
    g.Nodes[1].TopLeft = new Point(40000, 0);
    const p = newPipeline(g, 1n, false);
    p.stages = [new PipelineStage('Huge', () => {})];
    expect(() => p.runAllStages(bg)).toThrow('layout invariant violated: Dimensions w:40100, h:50 reached after stage Huge');
  });

  it('routing failure restores edgeRoutingComplete and snapshots', () => {
    const g = chain();
    const p = newPipeline(g, 1n, false);
    p.edgeRoutingComplete = false;
    const sentinel = [];
    p.snapshots = sentinel;
    // Edges without placed nodes make RouteGraph fail validation.
    expect(() => p.runGraphRouting(bg, null)).toThrow();
    expect(p.edgeRoutingComplete).toBe(false);
    expect(p.snapshots).toBe(sentinel);
  });
});

describe('Slice 50 — engine.Layout', () => {
  it('requires a context and graph, and never mutates the input', () => {
    expect(() => Layout(null, chain())).toThrow('TALA Autolayout requires a context');
    expect(() => Layout(bg, null)).toThrow('TALA Autolayout requires a graph');
    const input = chain();
    const before = JSON.stringify(input.Nodes.map((n) => [String(n.ID), n.TopLeft, n.Width, n.Height]));
    const out = Layout(bg, input, new LayoutOptions({ Seed: 1n }));
    expect(out).not.toBe(input);
    expect(JSON.stringify(input.Nodes.map((n) => [String(n.ID), n.TopLeft, n.Width, n.Height]))).toBe(before);
    for (const n of out.Nodes) expect(n.TopLeft).not.toBeNull();
  });

  it('pre-cancellation fails with the Autolayout prefix', () => {
    const ctx = cancelAfter(1);
    expect(() => Layout(ctx, chain())).toThrow('Autolayout: context canceled');
  });

  it('an empty graph returns a new empty graph and runLayout returns null', () => {
    const out = Layout(bg, new Graph());
    expect(out.Nodes).toHaveLength(0);
    expect(runLayout(bg, new Graph(), new LayoutOptions())).toBeNull();
  });

  it('an empty nested container lays out', () => {
    const g = new Graph();
    const container = new Node(1n, 0, 0);
    g.AddNewNodeToContainer(null, container);
    const inner = new Node(2n, 0, 0);
    g.AddNewNodeToContainer(container, inner);
    inner.Width = 80;
    inner.Height = 40;
    const out = Layout(bg, g, new LayoutOptions({ Seed: 1n }));
    for (const n of out.Nodes) expect(Number.isFinite(n.TopLeft.X)).toBe(true);
  });

  it('a nested layout can run twice from the same input', () => {
    const g = new Graph();
    const container = new Node(1n, 0, 0);
    g.AddNewNodeToContainer(null, container);
    const a = new Node(2n, 80, 40);
    const b = new Node(3n, 80, 40);
    g.AddNewNodeToContainer(container, a);
    g.AddNewNodeToContainer(container, b);
    g.AddNewNodeToContainer(null, new Node(4n, 100, 50));
    g.Connect(a, b).ID = 10n;
    g.Connect(g.Nodes[3], a).ID = 11n;
    const first = Layout(bg, g, new LayoutOptions({ Seed: 1n }));
    const second = Layout(bg, g, new LayoutOptions({ Seed: 1n }));
    const geom = (out) => JSON.stringify(out.Nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height]));
    expect(geom(second)).toBe(geom(first));
  });

  it('a no-Done context is wrapped like Go context.WithCancel', () => {
    let errCalls = 0;
    const counting = { Err() { errCalls++; return null; } };
    const child = new CancelChildContext(counting);
    expect(child.Err()).toBeNull();
    expect(errCalls).toBe(0);
    child.cancel();
    expect(child.Err().message).toBe('context canceled');
  });
});
