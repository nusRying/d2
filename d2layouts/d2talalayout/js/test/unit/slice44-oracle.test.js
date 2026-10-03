import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { rotateAround, transpose } from '../../src/placement/transpose.js';
import { isBetween } from '../../src/placement/gap-reduction.js';
import { OptimizerSpatialIndex } from '../../src/placement/optimizer-spatial-index.js';
import { OptimizationWorkGuard } from '../../src/limits/optimization.js';

describe('Slice 44 — Placement Substrates Go Oracle Replay', () => {
  const fixturePath = join(__dirname, '../fixtures/go-slice44-reference.json');
  let fixture;

  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch {
    fixture = null;
  }

  it('replays rotateAround positions', () => {
    if (!fixture) return;

    const g = new Graph();
    g.CellSize = 10;
    const centerNode = new Node(1n, 20, 20);
    centerNode.TopLeft = new Point(50, 50);
    g.addNode(centerNode);

    const orbitNode = new Node(2n, 20, 20);
    orbitNode.TopLeft = new Point(50, 100);
    g.addNode(orbitNode);

    rotateAround(orbitNode, g, centerNode, 1, false);
    expect(orbitNode.TopLeft.X).toBe(fixture.rotateAround.x1);
    expect(orbitNode.TopLeft.Y).toBe(fixture.rotateAround.y1);

    orbitNode.TopLeft = new Point(50, 100);
    rotateAround(orbitNode, g, centerNode, 2, false);
    expect(orbitNode.TopLeft.X).toBe(fixture.rotateAround.x2);
    expect(orbitNode.TopLeft.Y).toBe(fixture.rotateAround.y2);
  });

  it('replays transpose guard rejections', () => {
    if (!fixture) return;

    const g = new Graph();
    g.CellSize = 10;
    const fixedNode = new Node(3n, 20, 20);
    fixedNode.FixedTopLeft = new Point(0, 0);
    g.addNode(fixedNode);

    const res = transpose(backgroundWorkContext(), g, fixedNode, null);
    expect(!res).toBe(fixture.transpose.fixedRejected);

    const multiEdgeNode = new Node(4n, 20, 20);
    const n5 = new Node(5n, 20, 20);
    const n6 = new Node(6n, 20, 20);
    const n7 = new Node(7n, 20, 20);
    g.addNode(multiEdgeNode);
    g.addNode(n5);
    g.addNode(n6);
    g.addNode(n7);

    for (const other of [n5, n6, n7]) {
      const e = new Edge(g);
      e.From = multiEdgeNode;
      e.To = other;
      multiEdgeNode.Edges.push(e);
      other.Edges.push(e);
      g.Edges.push(e);
    }

    const res2 = transpose(backgroundWorkContext(), g, multiEdgeNode, null);
    expect(!res2).toBe(fixture.transpose.threeEdgesRejected);
  });

  it('replays gap reduction isBetween evaluations', () => {
    if (!fixture) return;

    const g = new Graph();
    const behind = new Node(8n, 20, 20);
    behind.TopLeft = new Point(0, 0);

    const ahead = new Node(9n, 20, 20);
    ahead.TopLeft = new Point(100, 0);

    const mid = new Node(10n, 20, 20);
    mid.TopLeft = new Point(50, 0);

    const outside = new Node(11n, 20, 20);
    outside.TopLeft = new Point(150, 0);

    g.addNode(behind);
    g.addNode(ahead);
    g.addNode(mid);
    g.addNode(outside);

    expect(isBetween(mid, behind, ahead, true, true)).toBe(fixture.gapReduction.isBetweenMid);
    expect(isBetween(outside, behind, ahead, true, true)).toBe(fixture.gapReduction.isBetweenOutside);
  });

  it('replays spatial index rebuild, occupancy, and query', () => {
    if (!fixture) return;

    const sg = new Graph();
    sg.CellSize = 10;
    for (let i = 0; i < 100; i++) {
      const sn = new Node(BigInt(i + 1), 20, 20);
      sn.TopLeft = new Point((i % 10) * 40, Math.floor(i / 10) * 40);
      sg.addNode(sn);
    }

    const sIndex = new OptimizerSpatialIndex();
    const guard = new OptimizationWorkGuard(backgroundWorkContext(), 'TestOracle', 10000000n);

    sIndex.rebuild(sg, guard);

    const [, occ] = sIndex.isOccupied(sg, new Point(0, 0), guard);
    expect(occ).toBe(fixture.spatialIndex.occupied);

    const cands = sIndex.query(0, 0, 50, 50, guard);
    expect(cands.length).toBe(fixture.spatialIndex.candidateCount);
  });
});
