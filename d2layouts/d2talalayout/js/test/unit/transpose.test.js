// Slice 44 — transpose. Ports internal/placement/transpose_test.go and adds
// shared-budget, cancellation, and rollback checks. Exhaustive parity lives in
// slice44-oracle.test.js.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Hierarchy } from '../../src/graph/hierarchy.js';
import { isDiagonal } from '../../src/geometry/orientation.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { rotateAround, transpose } from '../../src/placement/transpose.js';

const bg = backgroundWorkContext();

function placed(g, id, x, y, w = 40, h = 40) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.addNewNodeToContainer(null, n);
  return n;
}

// Hub with three spokes plus a two-node tail (pinned Go: transposes the tail).
function hubGraph() {
  const g = new Graph();
  g.CellSize = 10;
  const hub = placed(g, 1, 200, 200);
  const right = placed(g, 2, 400, 200);
  const down = placed(g, 3, 200, 400);
  const left = placed(g, 4, 0, 200);
  const tailHead = placed(g, 5, 400, 350);
  const tail = placed(g, 6, 400, 500);
  g.connect(hub, right);
  g.connect(hub, down);
  g.connect(hub, left);
  g.connect(right, tailHead);
  g.connect(tailHead, tail);
  return { g, tail, nodes: [hub, right, down, left, tailHead, tail] };
}

function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

describe('Slice 44 — transpose guards (pinned Go tests)', () => {
  it('rejects a diagonal second neighbor (TestTransposeRejectsDiagonalSecondNeighbor)', () => {
    const g = new Graph();
    g.CellSize = 10;
    const center = placed(g, 1, 0, 0, 10, 10);
    const orthogonal = placed(g, 2, 30, 0, 10, 10);
    const diagonal = placed(g, 3, 30, 30, 10, 10);
    placed(g, 4, 0, 30, 10, 10);
    g.connect(center, orthogonal);
    g.connect(center, diagonal);
    g.connect(orthogonal, g.Nodes[3]);
    expect(isDiagonal(center.orientation(diagonal))).toBe(true);
    expect(transpose(bg, g, center, null)).toBe(false);
    expect([center.TopLeft.X, center.TopLeft.Y]).toEqual([0, 0]);
  });

  it('rejects fixed, hierarchy, tree, and three-edge nodes before any work', () => {
    const { g, nodes } = hubGraph();
    const guard = new WorkGuard(bg, 'TransposeGuards', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    expect(transpose(ctx, g, nodes[0], null)).toBe(false); // three edges
    nodes[5].FixedTopLeft = new Point(0, 0);
    expect(transpose(ctx, g, nodes[5], null)).toBe(false);
    nodes[5].FixedTopLeft = null;
    nodes[5].Hierarchy = new Hierarchy();
    expect(transpose(ctx, g, nodes[5], null)).toBe(false);
    nodes[5].Hierarchy = null;
    g.NodeToTree.set(nodes[5], {});
    expect(transpose(ctx, g, nodes[5], null)).toBe(false);
    expect(Number(guard.Used())).toBe(0);
  });

  it('rotates around the center node and keeps the TopLeft pointer', () => {
    const g = new Graph();
    g.CellSize = 10;
    const center = placed(g, 1, 50, 50, 20, 20);
    const orbit = placed(g, 2, 50, 100, 20, 20);
    const pointer = orbit.TopLeft;
    rotateAround(orbit, g, center, 1, false);
    expect(orbit.TopLeft).toBe(pointer);
    expect([orbit.TopLeft.X, orbit.TopLeft.Y]).toEqual([0, 50]);
  });
});

describe('Slice 44 — transpose shared transaction budget and rollback', () => {
  it('commits the best rotation through transactions charged to the caller guard', () => {
    const { g, tail } = hubGraph();
    const guard = new WorkGuard(bg, 'TransposeShared', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const guards = new Set();
    const original = g.newRequestTransaction.bind(g);
    g.newRequestTransaction = (txCtx, options) => {
      const created = original(txCtx, options);
      guards.add(created[0].guard);
      expect(created[0].options.AffectContainers).toBe(true);
      return created;
    };
    const pointer = tail.TopLeft;
    const changed = transpose(ctx, g, tail, null);
    expect([...guards]).toEqual([guard]);
    expect(Number(guard.Used())).toBeGreaterThan(0);
    if (changed) expect(tail.TopLeft).toBe(pointer);
  });

  it('rolls back a committed trial when cancellation hits scoring', () => {
    const { g, tail, nodes } = hubGraph();
    const before = nodes.map((n) => [n.TopLeft, n.TopLeft.X, n.TopLeft.Y]);
    const original = [tail.TopLeft.X, tail.TopLeft.Y];
    const canceled = new Error('context canceled');
    let observed = false;
    const ctx = {
      Err() {
        const moved = tail.TopLeft.X !== original[0] || tail.TopLeft.Y !== original[1];
        if (moved && new Error().stack.includes('at edgeLength ')) {
          observed = true;
          return canceled;
        }
        return null;
      },
    };
    const result = capture(() => transpose(ctx, g, tail, null));
    expect(observed).toBe(true);
    let found = false;
    for (let e = result.err; e != null; e = e.cause) found ||= e === canceled;
    expect(found).toBe(true);
    nodes.forEach((n, i) => {
      expect(n.TopLeft).toBe(before[i][0]);
      expect([n.TopLeft.X, n.TopLeft.Y]).toEqual([before[i][1], before[i][2]]);
    });
  });

  it('rolls back and rethrows a panic raised after a rotation mutation', () => {
    const { g, tail, nodes } = hubGraph();
    const before = nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y]);
    const original = [tail.TopLeft.X, tail.TopLeft.Y];
    const sentinel = { name: 'transpose panic' };
    const ctx = {
      Err() {
        if (tail.TopLeft.X !== original[0] || tail.TopLeft.Y !== original[1]) throw sentinel;
        return null;
      },
    };
    const result = capture(() => transpose(ctx, g, tail, null));
    expect(result.err).toBe(sentinel);
    expect(nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y])).toEqual(before);
  });
});
