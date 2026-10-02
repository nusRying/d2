import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node, nodeDebugID } from '../../src/graph/node.js';
import { Cluster, clusterDebugID, ClusterArrangement } from '../../src/graph/cluster.js';
import { Sequence, sequenceDebugID } from '../../src/graph/sequence.js';
import { Graph } from '../../src/graph/graph.js';

describe('DebugID Direct Semantics', () => {
  // 1. node debugID() and DebugID() parity
  it('1. node debugID() and DebugID() parity', () => {
    const n = new Node(101);
    assert.equal(n.debugID(), '101');
    assert.equal(n.DebugID(), '101');
    assert.equal(n.debugID(), n.DebugID());
  });

  // 2. cluster debugID() and DebugID()
  it('2. cluster debugID() and DebugID()', () => {
    const c = new Cluster();
    c.Nodes = [new Node(1)];
    c.Arrangement = 'Row';
    assert.equal(c.debugID(), '[1]; Arrangement: Row');
    assert.equal(c.DebugID(), '[1]; Arrangement: Row');
    assert.equal(c.debugID(), c.DebugID());
  });

  // 3. sequence debugID() and DebugID()
  it('3. sequence debugID() and DebugID()', () => {
    const s = new Sequence();
    s.Nodes = [new Node(2)];
    assert.equal(s.debugID(), '[2]');
    assert.equal(s.DebugID(), '[2]');
    assert.equal(s.debugID(), s.DebugID());
  });

  // 4. nodeDebugID(null) === "nil"
  it('4. nodeDebugID(null) === "nil"', () => {
    assert.equal(nodeDebugID(null), 'nil');
    assert.equal(nodeDebugID(undefined), 'nil');
  });

  // 5. D2ID precedence
  it('5. D2ID precedence over cluster, sequence, and numeric ID', () => {
    const g = new Graph();
    const n = new Node(999);
    n.D2ID = 'custom-d2-id';
    n.Graph = g;
    n.SetClusterVessel(true);

    const c = new Cluster();
    c.Vessel = n;
    c.Nodes = [new Node(1)];
    g.Clusters.set(n, c);

    const s = new Sequence();
    s.Vessel = n;
    s.Nodes = [new Node(2)];
    g.Sequences.set(n, s);

    assert.equal(n.DebugID(), 'custom-d2-id');
  });

  // 6. empty-string D2ID preserved
  it('6. empty-string D2ID preserved without fallback to numeric ID', () => {
    const n = new Node(555);
    n.D2ID = '';
    assert.equal(n.DebugID(), '');
    assert.notEqual(n.DebugID(), '555');
  });

  // 7. cluster-vessel precedence over sequence
  it('7. cluster-vessel precedence over sequence', () => {
    const g = new Graph();
    const n = new Node(77);
    n.Graph = g;
    n.SetClusterVessel(true);

    const c = new Cluster();
    c.Vessel = n;
    c.Nodes = [new Node(771)];
    c.Arrangement = 'Column';
    g.Clusters.set(n, c);

    const s = new Sequence();
    s.Vessel = n;
    s.Nodes = [new Node(772)];
    g.Sequences.set(n, s);

    assert.equal(n.DebugID(), 'Cluster vessel of: [771]; Arrangement: Column');
  });

  // 8. cluster vessel with null Graph naturally fails
  it('8. cluster vessel with null Graph naturally fails with TypeError', () => {
    const n = new Node(88);
    n.SetClusterVessel(true);
    n.Graph = null;
    assert.throws(() => n.DebugID(), TypeError);
  });

  // 9. cluster vessel missing graph map entry naturally fails
  it('9. cluster vessel missing graph map entry naturally fails with TypeError', () => {
    const g = new Graph();
    const n = new Node(99);
    n.Graph = g;
    n.SetClusterVessel(true);
    // Not added to g.Clusters
    assert.throws(() => n.DebugID(), TypeError);
  });

  // 10. sequence detection uses Graph.Sequences membership, NOT node.Sequence
  it('10. sequence detection uses Graph.Sequences membership, NOT node.Sequence', () => {
    const g = new Graph();
    const n = new Node(100);
    n.Graph = g;
    // Set node.Sequence on the node, but do NOT add to g.Sequences
    const dummySeq = new Sequence();
    dummySeq.Nodes = [new Node(9999)];
    n.Sequence = dummySeq;

    // Must fall back to numeric ID because Graph.Sequences does NOT contain n
    assert.equal(n.DebugID(), '100');

    // Now add to g.Sequences with an actual sequence
    const realSeq = new Sequence();
    realSeq.Nodes = [new Node(1234)];
    g.Sequences.set(n, realSeq);

    // Now it recognizes it as sequence vessel
    assert.equal(n.DebugID(), 'Sequence vessel of: [1234]');
  });

  // 11. non-member of non-empty Sequences map falls back ID
  it('11. non-member of non-empty Sequences map falls back to numeric ID', () => {
    const g = new Graph();
    const member = new Node(1);
    member.Graph = g;
    const s = new Sequence();
    s.Nodes = [new Node(10)];
    g.Sequences.set(member, s);

    const nonMember = new Node(2);
    nonMember.Graph = g;
    assert.equal(nonMember.DebugID(), '2');
  });

  // 12. canonical signed-int64 formatting
  it('12. canonical signed-int64 formatting for extreme values', () => {
    const max = new Node(BigInt('9223372036854775807'));
    assert.equal(max.DebugID(), '9223372036854775807');

    const min = new Node(BigInt('-9223372036854775808'));
    assert.equal(min.DebugID(), '-9223372036854775808');

    const zero = new Node(0);
    assert.equal(zero.DebugID(), '0');

    const neg = new Node(-1);
    assert.equal(neg.DebugID(), '-1');
  });

  // 13. cluster member source order preserved
  it('13. cluster member source order preserved without sorting', () => {
    const c = new Cluster();
    c.Nodes = [new Node(50), new Node(10), new Node(30)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), '[50, 10, 30]; Arrangement: Row');
  });

  // 14. sequence member source order preserved
  it('14. sequence member source order preserved without sorting', () => {
    const s = new Sequence();
    s.Nodes = [new Node(50), new Node(10), new Node(30)];
    assert.equal(s.DebugID(), '[50, 10, 30]');
  });

  // 15. cluster nil member produces "nil"
  it('15. cluster nil member produces "nil" via nodeDebugID', () => {
    const c = new Cluster();
    c.Nodes = [new Node(1), null, undefined, new Node(2)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), '[1, nil, nil, 2]; Arrangement: Row');
  });

  // 16. sequence nil member produces "nil"
  it('16. sequence nil member produces "nil" via nodeDebugID', () => {
    const s = new Sequence();
    s.Nodes = [new Node(1), null, undefined, new Node(2)];
    assert.equal(s.DebugID(), '[1, nil, nil, 2]');
  });

  // 17. empty cluster exact formatting
  it('17. empty cluster exact formatting with space after colon', () => {
    const c1 = new Cluster();
    c1.Nodes = [];
    c1.Arrangement = '';
    assert.equal(c1.DebugID(), '[]; Arrangement: ');

    const c2 = new Cluster();
    c2.Nodes = [];
    c2.Arrangement = 'Row';
    assert.equal(c2.DebugID(), '[]; Arrangement: Row');
  });

  // 18. empty sequence exact formatting
  it('18. empty sequence exact formatting', () => {
    const s = new Sequence();
    s.Nodes = [];
    assert.equal(s.DebugID(), '[]');
  });

  // 19. Arrangement included exactly in cluster output
  it('19. Arrangement included exactly in cluster output', () => {
    const c = new Cluster();
    c.Nodes = [new Node(4)];
    c.Arrangement = 'CustomArrangement';
    assert.equal(c.DebugID(), '[4]; Arrangement: CustomArrangement');
  });

  // 20. no input arrays are sorted/mutated
  it('20. no input arrays or node states are sorted or mutated', () => {
    const n1 = new Node(30);
    const n2 = new Node(10);
    const originalNodes = [n1, n2];
    const c = new Cluster();
    c.Nodes = originalNodes;
    c.Arrangement = 'Row';

    const out = c.DebugID();
    assert.equal(out, '[30, 10]; Arrangement: Row');
    assert.equal(c.Nodes[0], n1);
    assert.equal(c.Nodes[1], n2);
    assert.equal(c.Nodes.length, 2);
  });
});
