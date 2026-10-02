import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node } from '../../src/graph/node.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { applyVirally, ApplyVirally } from '../../src/proximity/herding.js';

class CountingContext {
  constructor(cancelAfter = Infinity) {
    this.checks = 0;
    this.cancelAfter = cancelAfter;
  }
  isCancelled() {
    this.checks++;
    return this.checks >= this.cancelAfter;
  }
}

describe('ApplyVirally Direct Semantics', () => {
  // 1. alias identity: ApplyVirally === applyVirally
  it('1. alias identity: ApplyVirally === applyVirally', () => {
    assert.equal(ApplyVirally, applyVirally);
  });

  // 2. empty order performs exactly one context check
  it('2. empty order performs exactly one context check', () => {
    const ctx = new CountingContext();
    applyVirally(ctx, [], new Map());
    assert.equal(ctx.checks, 1);
  });

  // 3. stable single group performs exactly: top check + uncle check (2 checks)
  it('3. stable single group performs exactly 2 checks', () => {
    const ctx = new CountingContext();
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const herds = new Map([[uncle, [a]]]);
    applyVirally(ctx, [uncle], herds);
    assert.equal(ctx.checks, 2);
  });

  // 4. one-copy single-group success performs exactly 4 checks (2 passes * 2 checks)
  it('4. one-copy single-group success performs exactly 4 checks', () => {
    const ctx = new CountingContext();
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3); // nil
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally(ctx, [uncle], herds);
    assert.equal(ctx.checks, 4);
    assert.ok(b.HerdAssignment != null);
  });

  // 5. no context checks per node
  it('5. no context checks per node (large group remains 2 checks when stable)', () => {
    const ctx = new CountingContext();
    const uncle = new Node(1);
    const nodes = [];
    for (let i = 0; i < 50; i++) {
      const n = new Node(i + 2);
      n.HerdAssignment = new HerdAssignment();
      n.HerdAssignment.Orientation = Orientation.Left;
      nodes.push(n);
    }
    const herds = new Map([[uncle, nodes]]);
    applyVirally(ctx, [uncle], herds);
    assert.equal(ctx.checks, 2);
  });

  // 6. first non-NONE source in node order wins
  it('6. first non-NONE source in node order wins', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Top;
    const b = new Node(3); // target
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.equal(b.HerdAssignment.Orientation, Orientation.Top);
  });

  // 7. NONE is not a source
  it('7. NONE is not a source', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.NONE;
    const b = new Node(3); // nil
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.equal(b.HerdAssignment, null);
  });

  // 8. NONE is not overwritten
  it('8. NONE is not overwritten when known assignment is propagated', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    const bAssign = new HerdAssignment();
    bAssign.Orientation = Orientation.NONE;
    b.HerdAssignment = bAssign;

    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.equal(b.HerdAssignment, bAssign);
    assert.equal(b.HerdAssignment.Orientation, Orientation.NONE);
  });

  // 9. nil assignment IS overwritten
  it('9. nil assignment IS overwritten', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Right;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.ok(b.HerdAssignment != null);
    assert.equal(b.HerdAssignment.Orientation, Orientation.Right);
  });

  // 10. same-orientation assignment object identity preserved
  it('10. same-orientation assignment object identity preserved', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Bottom;
    const b = new Node(3);
    const bAssign = new HerdAssignment();
    bAssign.Orientation = Orientation.Bottom;
    bAssign.Val = 999;
    b.HerdAssignment = bAssign;

    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.equal(b.HerdAssignment, bAssign);
    assert.equal(b.HerdAssignment.Val, 999);
  });

  // 11. copied assignment is a fresh object
  it('11. copied assignment is a fresh object', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);

    assert.notEqual(b.HerdAssignment, a.HerdAssignment);
  });

  // 12. copied sameSidePaired Set is fresh
  it('12. copied sameSidePaired Set is fresh', () => {
    const uncle = new Node(1);
    const paired = new Node(99);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    a.HerdAssignment.PairSameSide(paired);
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);

    assert.notEqual(b.HerdAssignment.sameSidePaired, a.HerdAssignment.sameSidePaired);
    assert.equal(b.HerdAssignment.sameSidePaired.has(paired), true);
  });

  // 13. copied oppositeSidePaired Set is fresh
  it('13. copied oppositeSidePaired Set is fresh', () => {
    const uncle = new Node(1);
    const opp = new Node(98);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    a.HerdAssignment.PairOppositeSide(opp);
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);

    assert.notEqual(b.HerdAssignment.oppositeSidePaired, a.HerdAssignment.oppositeSidePaired);
    assert.equal(b.HerdAssignment.oppositeSidePaired.has(opp), true);
  });

  // 14. two targets receive independent assignment objects/Sets
  it('14. two targets receive independent assignment objects and Sets', () => {
    const uncle = new Node(1);
    const paired = new Node(99);
    const opp = new Node(98);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    a.HerdAssignment.PairSameSide(paired);
    a.HerdAssignment.PairOppositeSide(opp);

    const b = new Node(3);
    const c = new Node(4);
    const herds = new Map([[uncle, [a, b, c]]]);
    applyVirally({}, [uncle], herds);

    assert.notEqual(b.HerdAssignment, c.HerdAssignment);
    assert.notEqual(b.HerdAssignment.sameSidePaired, c.HerdAssignment.sameSidePaired);
    assert.notEqual(b.HerdAssignment.oppositeSidePaired, c.HerdAssignment.oppositeSidePaired);
  });

  // 15. Val copied exactly
  it('15. Val copied exactly', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Top;
    a.HerdAssignment.Val = 3.1415926535;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    assert.equal(b.HerdAssignment.Val, 3.1415926535);
  });

  // 16. source assignment identity/state unchanged
  it('16. source assignment identity/state unchanged', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    const origAssign = new HerdAssignment();
    origAssign.Orientation = Orientation.Left;
    origAssign.Val = 42;
    a.HerdAssignment = origAssign;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);

    assert.equal(a.HerdAssignment, origAssign);
    assert.equal(origAssign.Orientation, Orientation.Left);
    assert.equal(origAssign.Val, 42);
  });

  // 17. exact invariant message
  it('17. exact invariant message format', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Right;
    const herds = new Map([[uncle, [a, b]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === 'layout invariant violated: node 3 has herd orientation Right; expected Left'
    );
  });

  // 18. conflict uses DebugID, including D2ID
  it('18. conflict uses DebugID including D2ID', () => {
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Bottom;
    const b = new Node(3);
    b.D2ID = 'special.conflicting.id';
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Top;
    const herds = new Map([[uncle, [a, b]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === 'layout invariant violated: node special.conflicting.id has herd orientation Top; expected Bottom'
    );
  });

  // 19. partial mutation remains after conflict
  it('19. partial mutation remains after conflict', () => {
    const uncle = new Node(1);
    const nilNode = new Node(10);
    const a = new Node(20);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(30);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Right;

    // nilNode is scanned first during propagation, so it gets Left before b triggers conflict
    const herds = new Map([[uncle, [nilNode, a, b]]]);
    assert.throws(() => applyVirally({}, [uncle], herds));

    assert.ok(nilNode.HerdAssignment != null, 'nilNode should retain partial mutation');
    assert.equal(nilNode.HerdAssignment.Orientation, Orientation.Left);
  });

  // 20. partial mutation remains after cancellation
  it('20. partial mutation remains after cancellation', () => {
    const u1 = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);

    const u2 = new Node(4);
    const c = new Node(5);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [c]],
    ]);

    // cancel check 3 (before u2)
    const ctx = new CountingContext(3);
    assert.throws(() => applyVirally(ctx, [u1, u2], herds));

    assert.ok(b.HerdAssignment != null, 'b should retain partial mutation from u1');
    assert.equal(b.HerdAssignment.Orientation, Orientation.Left);
  });

  // 21. reverse herd order requires extra pass
  it('21. reverse herd order requires extra pass', () => {
    const u1 = new Node(1);
    const u2 = new Node(2);

    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const c = new Node(30);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [b, c]],
    ]);

    // Pass 1: top(1), u2(2 - no source), u1(3 - a->b) -> end=false
    // Pass 2: top(4), u2(5 - b->c), u1(6 - stable) -> end=false
    // Pass 3: top(7), u2(8 - stable), u1(9 - stable) -> end=true -> returns!
    const ctx = new CountingContext();
    applyVirally(ctx, [u2, u1], herds);

    assert.equal(ctx.checks, 9);
    assert.equal(c.HerdAssignment.Orientation, Orientation.Left);
  });

  // 22. same-pass chaining when order allows it
  it('22. same-pass chaining when order allows it', () => {
    const u1 = new Node(1);
    const u2 = new Node(2);

    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const c = new Node(30);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [b, c]],
    ]);

    // Pass 1: top(1), u1(2 - a->b), u2(3 - b->c) -> end=false
    // Pass 2: top(4), u1(5 - stable), u2(6 - stable) -> end=true -> returns!
    const ctx = new CountingContext();
    applyVirally(ctx, [u1, u2], herds);

    assert.equal(ctx.checks, 6);
    assert.equal(c.HerdAssignment.Orientation, Orientation.Left);
  });

  // 23. nil node natural failure
  it('23. nil node natural failure', () => {
    const uncle = new Node(1);
    const herds = new Map([[uncle, [null]]]);
    assert.throws(() => applyVirally({}, [uncle], herds), TypeError);
  });

  // 24. nil context natural failure even with empty herdOrder
  it('24. nil context natural failure even with empty herdOrder', () => {
    assert.throws(() => applyVirally(null, [], new Map()), TypeError);
  });

  // 25. nil herds map safe
  it('25. nil herds map safe', () => {
    const uncle = new Node(1);
    assert.doesNotThrow(() => applyVirally({}, [uncle], null));
  });

  // 26. null uncle key supported
  it('26. null uncle key supported', () => {
    const a = new Node(1);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(2);
    const herds = new Map([[null, [a, b]]]);
    applyVirally({}, [null], herds);
    assert.equal(b.HerdAssignment.Orientation, Orientation.Left);
  });

  // 27. repeated stable call does not replace existing assignments
  it('27. repeated stable call does not replace existing assignments', () => {
    const uncle = new Node(1);
    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const herds = new Map([[uncle, [a, b]]]);

    applyVirally({}, [uncle], herds);
    const bAssign1 = b.HerdAssignment;
    applyVirally({}, [uncle], herds);
    const bAssign2 = b.HerdAssignment;

    assert.equal(bAssign1, bAssign2);
  });
});
