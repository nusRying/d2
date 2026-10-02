import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node } from '../../src/graph/node.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import {
  placeChildrenOrder,
  PlaceChildrenOrder,
} from '../../src/placement/node-placement.js';
import { WorkCanceledError } from '../../src/limits/work-guard.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Context that never cancels. */
function liveCtx() {
  return { isCancelled: () => false };
}

/** Context already cancelled at creation. */
function deadCtx() {
  return { isCancelled: () => true };
}

/** Context that cancels on the Nth isCancelled() call. */
function cancelAtCtx(n) {
  let count = 0;
  return {
    isCancelled() {
      count++;
      return count >= n;
    },
  };
}

/** Make N isolated nodes */
function makeNodes(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push(new Node(BigInt(i + 1), 10, 10));
  }
  return nodes;
}

/** Build a chain A → B → C → ... */
function makeChain(nodes) {
  const abs = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    abs.push(new EdgeAbduction({ CurrentFrom: nodes[i], CurrentTo: nodes[i + 1] }));
  }
  return abs;
}

// ===========================================================================
// 1. REVIEW-GATE TESTS
// ===========================================================================

describe('PlaceChildrenOrder review gates', () => {
  it('PlaceChildrenOrder === placeChildrenOrder (alias parity)', () => {
    assert.strictEqual(
      PlaceChildrenOrder,
      placeChildrenOrder,
      'PlaceChildrenOrder must be the same function reference as placeChildrenOrder'
    );
  });

  it('placeChildrenOrder exported from placement barrel', async () => {
    const placement = await import('../../src/placement/index.js');
    assert.strictEqual(typeof placement.placeChildrenOrder, 'function');
    assert.strictEqual(typeof placement.PlaceChildrenOrder, 'function');
    assert.strictEqual(
      placement.PlaceChildrenOrder,
      placement.placeChildrenOrder
    );
  });

  it('placeChildrenOrder exported from root barrel', async () => {
    const root = await import('../../src/index.js');
    assert.strictEqual(typeof root.placeChildrenOrder, 'function');
    assert.strictEqual(typeof root.PlaceChildrenOrder, 'function');
  });

  it('entry cancellation throws WorkCanceledError before any work', () => {
    const ctx = deadCtx();
    assert.throws(
      () => placeChildrenOrder(ctx, [new Node(1n, 10, 10)], []),
      (err) => {
        assert.ok(err instanceof WorkCanceledError);
        assert.match(err.message, /context canceled/);
        return true;
      }
    );
  });

  it('WorkCanceledError is instance of Error', () => {
    const err = new WorkCanceledError('test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof WorkCanceledError);
  });
});

// ===========================================================================
// 2. BASIC RETURN VALUE TESTS
// ===========================================================================

describe('PlaceChildrenOrder basic returns', () => {
  it('null nodes and null abductions returns empty array', () => {
    const result = placeChildrenOrder(liveCtx(), null, null);
    assert.deepEqual(result, []);
  });

  it('undefined nodes and undefined abductions returns empty array', () => {
    const result = placeChildrenOrder(liveCtx(), undefined, undefined);
    assert.deepEqual(result, []);
  });

  it('empty nodes returns empty array', () => {
    const result = placeChildrenOrder(liveCtx(), [], []);
    assert.deepEqual(result, []);
  });

  it('result is a new array (not the input)', () => {
    const nodes = makeNodes(3);
    const result = placeChildrenOrder(liveCtx(), nodes, []);
    assert.notStrictEqual(result, nodes);
  });

  it('result array is always Array', () => {
    const result = placeChildrenOrder(liveCtx(), null, null);
    assert.ok(Array.isArray(result));
  });

  it('result length equals input node count', () => {
    const nodes = makeNodes(5);
    const result = placeChildrenOrder(liveCtx(), nodes, []);
    assert.equal(result.length, 5);
  });

  it('result contains same node references as input', () => {
    const nodes = makeNodes(3);
    const result = placeChildrenOrder(liveCtx(), nodes, []);
    for (const n of nodes) {
      assert.ok(result.includes(n));
    }
  });
});

// ===========================================================================
// 3. ISOLATED NODE ORDERING
// ===========================================================================

describe('PlaceChildrenOrder isolated nodes', () => {
  it('single isolated node', () => {
    const [a] = makeNodes(1);
    const result = placeChildrenOrder(liveCtx(), [a], []);
    assert.deepEqual(result, [a]);
  });

  it('multiple isolated nodes preserve source order', () => {
    const nodes = makeNodes(5);
    const result = placeChildrenOrder(liveCtx(), nodes, []);
    assert.deepEqual(result, nodes);
  });

  it('isolated nodes emitted before connected components', () => {
    const [a, b, c] = makeNodes(3);
    const abs = [new EdgeAbduction({ CurrentFrom: b, CurrentTo: c })];
    const result = placeChildrenOrder(liveCtx(), [a, b, c], abs);
    assert.strictEqual(result[0], a, 'isolated a should be first');
    assert.ok(result.includes(b));
    assert.ok(result.includes(c));
  });
});

// ===========================================================================
// 4. CONNECTED COMPONENT ORDERING
// ===========================================================================

describe('PlaceChildrenOrder connected components', () => {
  it('two-node connected pair', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
    assert.ok(result.includes(a));
    assert.ok(result.includes(b));
  });

  it('chain preserves BFS order from least-degree start', () => {
    const [a, b, c] = makeNodes(3);
    const abs = makeChain([a, b, c]);
    const result = placeChildrenOrder(liveCtx(), [a, b, c], abs);
    // a and c have degree 1 (least); a is first in source order → start=a
    assert.strictEqual(result[0], a);
    assert.strictEqual(result[1], b);
    assert.strictEqual(result[2], c);
  });

  it('four-node chain BFS traversal', () => {
    const [a, b, c, d] = makeNodes(4);
    const abs = [
      new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: c, CurrentTo: d }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b, c, d], abs);
    assert.strictEqual(result[0], a);
  });

  it('star graph: leaves enqueued in abduction scan order', () => {
    const [center, l1, l2, l3] = makeNodes(4);
    const abs = [
      new EdgeAbduction({ CurrentFrom: center, CurrentTo: l1 }),
      new EdgeAbduction({ CurrentFrom: center, CurrentTo: l2 }),
      new EdgeAbduction({ CurrentFrom: center, CurrentTo: l3 }),
    ];
    const result = placeChildrenOrder(liveCtx(), [center, l1, l2, l3], abs);
    // l1, l2, l3 have degree 1; l1 is first in source → start=l1
    assert.strictEqual(result[0], l1);
  });

  it('multiple connected components processed by least degree', () => {
    const [a, b, c, d, e] = makeNodes(5);
    // triangle: a-b-c-a  (degree 2 each)
    // edge: d-e          (degree 1 each)
    const abs = [
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      new EdgeAbduction({ CurrentFrom: c, CurrentTo: a }),
      new EdgeAbduction({ CurrentFrom: d, CurrentTo: e }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b, c, d, e], abs);
    // d-e component has lower min-degree (1) → processed first
    assert.ok(result.indexOf(d) < result.indexOf(a));
  });

  it('cycle with all equal degrees: first in source order starts', () => {
    const [a, b, c] = makeNodes(3);
    const abs = [
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      new EdgeAbduction({ CurrentFrom: c, CurrentTo: a }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b, c], abs);
    assert.strictEqual(result[0], a, 'degree tie → first in source order');
  });

  it('reversed abduction direction: same connectivity', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: b, CurrentTo: a })];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
  });
});

// ===========================================================================
// 5. EXTERNAL / NULL ENDPOINT HANDLING
// ===========================================================================

describe('PlaceChildrenOrder external endpoints', () => {
  it('external-only endpoint does not create connection', () => {
    const [a, b] = makeNodes(2);
    const ext = new Node(99n, 10, 10);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: ext })];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    // Both a and b remain isolated → source order preserved
    assert.deepEqual(result, [a, b]);
  });

  it('null CurrentFrom ignored', () => {
    const [a] = makeNodes(1);
    const abs = [new EdgeAbduction({ CurrentFrom: null, CurrentTo: a })];
    const result = placeChildrenOrder(liveCtx(), [a], abs);
    assert.deepEqual(result, [a]);
  });

  it('null CurrentTo ignored', () => {
    const [a] = makeNodes(1);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: null })];
    const result = placeChildrenOrder(liveCtx(), [a], abs);
    assert.deepEqual(result, [a]);
  });

  it('both endpoints null ignored', () => {
    const [a] = makeNodes(1);
    const abs = [new EdgeAbduction({ CurrentFrom: null, CurrentTo: null })];
    const result = placeChildrenOrder(liveCtx(), [a], abs);
    assert.deepEqual(result, [a]);
  });
});

// ===========================================================================
// 6. SELF-LOOP HANDLING
// ===========================================================================

describe('PlaceChildrenOrder self-loops', () => {
  it('self-loop creates a connection (node not isolated)', () => {
    const [a] = makeNodes(1);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: a })];
    const result = placeChildrenOrder(liveCtx(), [a], abs);
    // Self-loop → degree ≥ 1, goes through component BFS path
    assert.deepEqual(result, [a]);
  });

  it('self-loop plus isolated: isolated emitted first', () => {
    const [loop, iso] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: loop, CurrentTo: loop })];
    const result = placeChildrenOrder(liveCtx(), [loop, iso], abs);
    assert.strictEqual(result[0], iso);
    assert.strictEqual(result[1], loop);
  });
});

// ===========================================================================
// 7. DUPLICATE ABDUCTIONS
// ===========================================================================

describe('PlaceChildrenOrder duplicate abductions', () => {
  it('duplicate abductions: degree uses Set so duplicates are idempotent', () => {
    const [a, b] = makeNodes(2);
    const abs = [
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
  });

  it('BFS enqueues duplicates from repeated abductions', () => {
    const [a, b] = makeNodes(2);
    const abs = [
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
  });
});

// ===========================================================================
// 8. IDENTITY-BASED MEMBERSHIP (not ID-based)
// ===========================================================================

describe('PlaceChildrenOrder identity semantics', () => {
  it('distinct Node objects with same ID are different children', () => {
    const a1 = new Node(5n, 10, 10);
    const a2 = new Node(5n, 10, 10);
    const result = placeChildrenOrder(liveCtx(), [a1, a2], []);
    assert.equal(result.length, 2);
    assert.ok(result.includes(a1));
    assert.ok(result.includes(a2));
  });

  it('scrambled IDs: output follows source order not ID sort', () => {
    const n99 = new Node(99n, 10, 10);
    const n10 = new Node(10n, 10, 10);
    const n50 = new Node(50n, 10, 10);
    const n1 = new Node(1n, 10, 10);
    const result = placeChildrenOrder(liveCtx(), [n99, n10, n50, n1], []);
    assert.deepEqual(result, [n99, n10, n50, n1]);
  });
});

// ===========================================================================
// 9. INVARIANT VIOLATION TESTS
// ===========================================================================

describe('PlaceChildrenOrder invariant violations', () => {
  it('null child throws invariant error', () => {
    const [a] = makeNodes(1);
    assert.throws(
      () => placeChildrenOrder(liveCtx(), [a, null], []),
      (err) => {
        assert.match(err.message, /nil child/);
        return true;
      }
    );
  });

  it('duplicate child throws invariant error', () => {
    const [a] = makeNodes(1);
    assert.throws(
      () => placeChildrenOrder(liveCtx(), [a, a], []),
      (err) => {
        assert.match(err.message, /duplicate child/);
        return true;
      }
    );
  });

  it('null edge abduction throws invariant error', () => {
    const [a] = makeNodes(1);
    assert.throws(
      () => placeChildrenOrder(liveCtx(), [a], [null]),
      (err) => {
        assert.match(err.message, /nil edge abduction/);
        return true;
      }
    );
  });
});

// ===========================================================================
// 10. CANCELLATION TIMING TESTS
// ===========================================================================

describe('PlaceChildrenOrder cancellation timing', () => {
  it('cancellation at entry (check 1)', () => {
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(1), makeNodes(1), []),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation during node validation scan', () => {
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(2), makeNodes(2), []),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation wins over nil child error', () => {
    // On check 2 (in node loop for null), cancellation fires first
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(2), [null], null),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation during abduction validation scan', () => {
    const [a] = makeNodes(1);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: a })];
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(3), [a], abs),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation wins over nil abduction error', () => {
    const [a] = makeNodes(1);
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(3), [a], [null]),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation during isolated node scan', () => {
    const [a] = makeNodes(1);
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(3), [a], []),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation at outer component loop', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(6), [a, b], abs),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation on first BFS queue item', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(7), [a, b], abs),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation on later BFS queue item', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(8), [a, b], abs),
      (err) => err instanceof WorkCanceledError
    );
  });

  it('cancellation at final post-ordering check', () => {
    const [a, b] = makeNodes(2);
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    assert.throws(
      () => placeChildrenOrder(cancelAtCtx(10), [a, b], abs),
      (err) => err instanceof WorkCanceledError
    );
  });
});

// ===========================================================================
// 11. INPUT IMMUTABILITY
// ===========================================================================

describe('PlaceChildrenOrder input immutability', () => {
  it('input nodes array is not mutated', () => {
    const nodes = makeNodes(3);
    const abs = makeChain(nodes);
    const copy = [...nodes];
    placeChildrenOrder(liveCtx(), nodes, abs);
    assert.deepEqual(nodes, copy);
  });

  it('input abductions array is not mutated', () => {
    const nodes = makeNodes(3);
    const abs = makeChain(nodes);
    const copy = [...abs];
    placeChildrenOrder(liveCtx(), nodes, abs);
    assert.deepEqual(abs, copy);
  });

  it('node objects are not mutated', () => {
    const [a, b] = makeNodes(2);
    const aEdgesBefore = a.Edges.length;
    const abs = [new EdgeAbduction({ CurrentFrom: a, CurrentTo: b })];
    placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(a.Edges.length, aEdgesBefore);
  });
});

// ===========================================================================
// 12. DETERMINISM
// ===========================================================================

describe('PlaceChildrenOrder determinism', () => {
  it('repeated invocations produce identical results', () => {
    const build = () => {
      const nodes = makeNodes(4);
      const abs = makeChain(nodes);
      return { nodes, abs };
    };

    const runs = [];
    for (let i = 0; i < 5; i++) {
      const { nodes, abs } = build();
      const result = placeChildrenOrder(liveCtx(), nodes, abs);
      runs.push(result.map((n) => n.ID));
    }

    for (let i = 1; i < runs.length; i++) {
      assert.deepEqual(runs[i], runs[0], `run ${i} differs from run 0`);
    }
  });
});

// ===========================================================================
// 13. AbortController CONTEXT SUPPORT
// ===========================================================================

describe('PlaceChildrenOrder AbortController context', () => {
  it('works with AbortController signal (not aborted)', () => {
    const ac = new AbortController();
    const result = placeChildrenOrder(ac.signal, makeNodes(3), []);
    assert.equal(result.length, 3);
  });

  it('throws WorkCanceledError with pre-aborted AbortController', () => {
    const ac = new AbortController();
    ac.abort();
    assert.throws(
      () => placeChildrenOrder(ac.signal, makeNodes(1), []),
      (err) => err instanceof WorkCanceledError
    );
  });
});

// ===========================================================================
// 14. METADATA FIELDS DO NOT AFFECT ORDERING
// ===========================================================================

describe('PlaceChildrenOrder metadata irrelevance', () => {
  it('OriginallyFrom/OriginallyTo do not affect connectivity', () => {
    const [a, b] = makeNodes(2);
    const dummy = new Node(99n, 10, 10);
    const abs = [
      new EdgeAbduction({
        CurrentFrom: a,
        CurrentTo: b,
        OriginallyFrom: dummy,
        OriginallyTo: dummy,
      }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
    assert.ok(result.includes(a));
    assert.ok(result.includes(b));
  });

  it('Edge field on abduction does not affect ordering', () => {
    const [a, b] = makeNodes(2);
    const abs = [
      new EdgeAbduction({
        CurrentFrom: a,
        CurrentTo: b,
        Edge: { ID: 42n },
      }),
    ];
    const result = placeChildrenOrder(liveCtx(), [a, b], abs);
    assert.equal(result.length, 2);
  });
});

// ===========================================================================
// 15. LARGER GRAPH STRESS
// ===========================================================================

describe('PlaceChildrenOrder larger graphs', () => {
  it('handles 100 isolated nodes', () => {
    const nodes = makeNodes(100);
    const result = placeChildrenOrder(liveCtx(), nodes, []);
    assert.equal(result.length, 100);
    assert.deepEqual(result, nodes);
  });

  it('handles 50-node chain', () => {
    const nodes = makeNodes(50);
    const abs = makeChain(nodes);
    const result = placeChildrenOrder(liveCtx(), nodes, abs);
    assert.equal(result.length, 50);
    assert.strictEqual(result[0], nodes[0]);
  });

  it('handles mixed: 10 isolated + 20-node chain', () => {
    const iso = makeNodes(10);
    const chain = [];
    for (let i = 0; i < 20; i++) {
      chain.push(new Node(BigInt(100 + i), 10, 10));
    }
    const abs = makeChain(chain);
    const all = [...iso, ...chain];
    const result = placeChildrenOrder(liveCtx(), all, abs);
    assert.equal(result.length, 30);
    // All isolated nodes should come before the chain
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(result[i], iso[i]);
    }
  });

  it('handles complete graph K5', () => {
    const nodes = makeNodes(5);
    const abs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        abs.push(new EdgeAbduction({ CurrentFrom: nodes[i], CurrentTo: nodes[j] }));
      }
    }
    const result = placeChildrenOrder(liveCtx(), nodes, abs);
    assert.equal(result.length, 5);
  });
});
