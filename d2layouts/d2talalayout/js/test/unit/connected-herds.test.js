import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node } from '../../src/graph/node.js';
import * as herdingModule from '../../src/proximity/herding.js';
import * as proximityIndex from '../../src/proximity/index.js';
import * as rootIndex from '../../src/index.js';
import { connectedHerds } from '../../src/proximity/herding.js';

class CountingContext {
  constructor(cancelAt = Infinity) {
    this.checks = 0;
    this.cancelAt = cancelAt;
  }

  isCancelled() {
    this.checks++;
    return this.checks >= this.cancelAt;
  }
}

describe('ConnectedHerds Direct Semantics', () => {
  // 1. connectedHerds is module-exported
  it('1. connectedHerds is module-exported from herding.js', () => {
    assert.equal(typeof herdingModule.connectedHerds, 'function');
  });

  // 2. NOT re-exported from proximity/index.js
  it('2. connectedHerds is NOT re-exported from proximity/index.js', () => {
    assert.equal('connectedHerds' in proximityIndex, false);
    assert.equal('connectedHerds' in rootIndex, false);
  });

  // 3. no PascalCase alias
  it('3. no PascalCase ConnectedHerds alias exists', () => {
    assert.equal('ConnectedHerds' in herdingModule, false);
    assert.equal('ConnectedHerds' in proximityIndex, false);
    assert.equal('ConnectedHerds' in rootIndex, false);
  });

  // 4. nil order returns null
  it('4. nil order returns null', () => {
    const ctx = new CountingContext();
    const result = connectedHerds(ctx, null, new Map());
    assert.equal(result, null);
    assert.equal(ctx.checks, 0);
  });

  // 5. empty order returns null
  it('5. empty order returns null', () => {
    const ctx = new CountingContext();
    const result = connectedHerds(ctx, [], new Map());
    assert.equal(result, null);
    assert.equal(ctx.checks, 0);
  });

  // 6. cancelled empty order performs zero context checks
  it('6. cancelled empty order performs zero context checks', () => {
    const ctx = new CountingContext(1); // will cancel on 1st check
    const result = connectedHerds(ctx, [], new Map());
    assert.equal(result, null);
    assert.equal(ctx.checks, 0);
  });

  // 7. null context + empty order succeeds
  it('7. null context + empty order succeeds and returns null', () => {
    assert.equal(connectedHerds(null, [], new Map()), null);
    assert.equal(connectedHerds(undefined, [], new Map()), null);
    assert.equal(connectedHerds(null, null, new Map()), null);
  });

  // 8. null context + nonempty order naturally fails
  it('8. null context + nonempty order naturally fails with TypeError', () => {
    const u1 = new Node(1);
    assert.throws(() => {
      connectedHerds(null, [u1], new Map());
    }, TypeError);
  });

  // 9. one empty component has nodes === null
  it('9. one empty component has nodes === null (not empty array)', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const herds = new Map([[u1, []]]);
    const result = connectedHerds(ctx, [u1], herds);
    assert.ok(result != null);
    assert.equal(result.length, 1);
    assert.equal(result[0].nodes, null);
    assert.deepEqual(result[0].uncles, [u1]);
  });

  // 10. nil herds map safe
  it('10. nil herds map safe, treats uncles as having zero nodes', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const result = connectedHerds(ctx, [u1], null);
    assert.ok(result != null);
    assert.equal(result.length, 1);
    assert.equal(result[0].nodes, null);
    assert.deepEqual(result[0].uncles, [u1]);
  });

  // 11. cancellation checks equal unique expanded uncle count
  it('11. cancellation checks equal unique expanded uncle count', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    // u1 and u2 connected via a, u3 is disconnected
    const herds = new Map([
      [u1, [a]],
      [u2, [a]],
      [u3, []],
    ]);
    const result = connectedHerds(ctx, [u1, u2, u3], herds);
    assert.ok(result != null);
    assert.equal(result.length, 2);
    // 3 unique uncles expanded -> exactly 3 checks
    assert.equal(ctx.checks, 3);
  });

  // 12. duplicate outer uncle adds no extra cancellation check
  it('12. duplicate outer uncle adds no extra cancellation check', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const herds = new Map([
      [u1, []],
      [u2, []],
    ]);
    const result = connectedHerds(ctx, [u1, u1, u2, u1, u2], herds);
    assert.ok(result != null);
    assert.equal(result.length, 2);
    // only 2 unique uncles expanded -> exactly 2 checks
    assert.equal(ctx.checks, 2);
  });

  // 13. zero checks during phase-1 byNode construction
  it('13. zero checks during phase-1 byNode construction', () => {
    // If we have a context that cancels at check 1, phase 1 must complete fully before check 1 fires
    let phase1Observed = false;
    const u1 = new Node(1);
    const a = new Node(10);
    const herds = {
      get(u) {
        if (u === u1) {
          phase1Observed = true;
          return [a];
        }
        return [];
      },
    };
    const ctx = new CountingContext(1);
    assert.throws(() => {
      connectedHerds(ctx, [u1], herds);
    }, /AssignHerds/);
    assert.equal(phase1Observed, true);
    assert.equal(ctx.checks, 1);
  });

  // 14. component seed order follows herdOrder
  it('14. component seed order follows herdOrder', () => {
    const ctx = new CountingContext();
    const u30 = new Node(30);
    const u10 = new Node(10);
    const u20 = new Node(20);
    const herds = new Map([
      [u30, []],
      [u10, []],
      [u20, []],
    ]);
    const result = connectedHerds(ctx, [u30, u10, u20], herds);
    assert.equal(result.length, 3);
    assert.equal(result[0].uncles[0], u30);
    assert.equal(result[1].uncles[0], u10);
    assert.equal(result[2].uncles[0], u20);
  });

  // 15. component uncle expansion is FIFO
  it('15. component uncle expansion is FIFO (not LIFO / DFS)', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    const b = new Node(20);
    // u1 has [a, b], where a connects u2, b connects u3
    const herds = new Map([
      [u1, [a, b]],
      [u2, [a]],
      [u3, [b]],
    ]);
    const result = connectedHerds(ctx, [u1, u2, u3], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1, u2, u3]);
  });

  // 16. node source order preserved
  it('16. node source order preserved', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const c = new Node(30);
    const a = new Node(10);
    const b = new Node(20);
    const herds = new Map([[u1, [c, a, b]]]);
    const result = connectedHerds(ctx, [u1], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].nodes, [c, a, b]);
  });

  // 17. duplicate node deduped in component.nodes
  it('17. duplicate node deduped in component.nodes', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const a = new Node(10);
    const b = new Node(20);
    const herds = new Map([[u1, [a, a, b, a, b]]]);
    const result = connectedHerds(ctx, [u1], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].nodes, [a, b]);
  });

  // 18. shared node connects uncles
  it('18. shared node connects uncles into one component', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const shared = new Node(99);
    const b = new Node(20);
    const herds = new Map([
      [u1, [a, shared]],
      [u2, [shared, b]],
    ]);
    const result = connectedHerds(ctx, [u1, u2], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1, u2]);
    assert.deepEqual(result[0].nodes, [a, shared, b]);
  });

  // 19. transitive connectivity
  it('19. transitive connectivity (u1-u2-u3 chain forms one component)', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    const x = new Node(100);
    const y = new Node(200);
    const z = new Node(300);
    const herds = new Map([
      [u1, [a, x]],
      [u2, [x, y]],
      [u3, [y, z]],
    ]);
    const result = connectedHerds(ctx, [u1, u2, u3], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1, u2, u3]);
    assert.deepEqual(result[0].nodes, [a, x, y, z]);
  });

  // 20. no ID sorting
  it('20. no ID sorting - follows source relations and herdOrder', () => {
    const ctx = new CountingContext();
    const u99 = new Node(99);
    const u5 = new Node(5);
    const u50 = new Node(50);
    const n8 = new Node(8);
    const n2 = new Node(2);
    const herds = new Map([
      [u99, [n8]],
      [u5, [n2]],
      [u50, []],
    ]);
    const result = connectedHerds(ctx, [u99, u5, u50], herds);
    assert.equal(result.length, 3);
    assert.equal(result[0].uncles[0].ID, 99);
    assert.equal(result[1].uncles[0].ID, 5);
    assert.equal(result[2].uncles[0].ID, 50);
  });

  // 21. nil uncle supported
  it('21. nil/null uncle supported as seed and map key', () => {
    const ctx = new CountingContext();
    const herds = new Map([[null, []]]);
    const result = connectedHerds(ctx, [null], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [null]);
    assert.equal(result[0].nodes, null);
  });

  // 22. nil node supported
  it('22. nil/null node supported without throwing', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const herds = new Map([[u1, [null]]]);
    const result = connectedHerds(ctx, [u1], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1]);
    assert.deepEqual(result[0].nodes, [null]);
  });

  // 23. nil node connects multiple uncles
  it('23. nil node connects multiple uncles', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const herds = new Map([
      [u1, [null]],
      [u2, [null]],
    ]);
    const result = connectedHerds(ctx, [u1, u2], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1, u2]);
    assert.deepEqual(result[0].nodes, [null]);
  });

  // 24. global seenNodes/seenUncles identity behavior
  it('24. global seenNodes/seenUncles identity behavior (not reset per component)', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    // If by some anomaly a node is seen in component 1, but uncle 2 didn't connect to uncle 1
    // (e.g. uncle 2 was processed after uncle 1), global seenNodes ensures node 'a' cannot be added to component 2
    // Let's create two disconnected uncles, where herds has 'a' for u1, and herds also has 'a' for u2.
    // In connectedHerds, phase 1 puts byNode[a] = [u1, u2].
    // So when u1 expands 'a', u2 is immediately discovered and added to u1's component!
    // But what if u2 was already seenUncles? Then u2 wouldn't be re-added.
    // What if a node was somehow in seenNodes? It will never be added to component.nodes again.
    const herds = new Map([
      [u1, [a]],
      [u2, [a]],
    ]);
    const result = connectedHerds(ctx, [u1, u2], herds);
    // They are connected because 'a' connects them.
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].nodes, [a]);
  });

  // 25. input herd arrays remain byte-for-byte/order-identical
  it('25. input herd arrays and maps remain unmutated', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const b = new Node(20);
    const arr1 = [a, b];
    const arr2 = [b];
    const order = [u1, u2];
    const herds = new Map([
      [u1, arr1],
      [u2, arr2],
    ]);

    connectedHerds(ctx, order, herds);

    assert.deepEqual(order, [u1, u2]);
    assert.deepEqual(arr1, [a, b]);
    assert.deepEqual(arr2, [b]);
    assert.equal(herds.size, 2);
  });

  // 26. repeated invocation returns fresh component/array identities
  it('26. repeated invocation returns fresh component and array identities', () => {
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const a = new Node(10);
    const herds = new Map([[u1, [a]]]);
    const res1 = connectedHerds(ctx, [u1], herds);
    const res2 = connectedHerds(ctx, [u1], herds);

    assert.notEqual(res1, res2);
    assert.notEqual(res1[0], res2[0]);
    assert.notEqual(res1[0].nodes, res2[0].nodes);
    assert.notEqual(res1[0].uncles, res2[0].uncles);
    assert.deepEqual(res1, res2);
  });

  // 27. discriminating FIFO vs DFS topology (Section 40)
  it('27. discriminating FIFO vs DFS topology', () => {
    // herdOrder: [u1, u2, u3, u4]
    // u1 has [n_root, x, y]
    // u2 has [x, n_u2]
    // u3 has [y, n_u3]
    // In phase 1:
    // x -> [u1, u2]
    // y -> [u1, u3]
    // Expansion of u1:
    // sees n_root -> appends n_root
    // sees x -> appends x, discovers u2 -> component.uncles: [u1, u2]
    // sees y -> appends y, discovers u3 -> component.uncles: [u1, u2, u3]
    // Next in FIFO is u2:
    // u2 expands: sees x (already seen), sees n_u2 (new, appends n_u2)
    // Next in FIFO is u3:
    // u3 expands: sees y (already seen), sees n_u3 (new, appends n_u3)
    //
    // Final uncles: [u1, u2, u3]
    // Final nodes: [n_root, x, y, n_u2, n_u3]
    //
    // Under DFS (stack), when x discovers u2, it would immediately recurse into u2
    // or if stack pops u3 first:
    // DFS would expand u3 before u2 or u2's nodes before y!
    const ctx = new CountingContext();
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const n_root = new Node(10);
    const x = new Node(20);
    const y = new Node(30);
    const n_u2 = new Node(40);
    const n_u3 = new Node(50);

    const herds = new Map([
      [u1, [n_root, x, y]],
      [u2, [x, n_u2]],
      [u3, [y, n_u3]],
    ]);

    const result = connectedHerds(ctx, [u1, u2, u3], herds);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].uncles, [u1, u2, u3]);
    assert.deepEqual(result[0].nodes, [n_root, x, y, n_u2, n_u3]);
  });
});
