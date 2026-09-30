import { describe, expect, test } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge, NO_ARROWHEAD } from "../../src/graph/edge.js";
import {
  ClusterEdgeSignature,
  ClusterDiscoveryIndex,
  buildClusterDiscoveryIndex,
  clusterIsDescendantOfGuarded,
  clusterHasLeakyEdgeGuarded,
  clusterIncidentEdges,
} from "../../src/grouping/cluster-discovery.js";
import { GoRand } from "../../src/random/go-math-rand.js";
import {
  WorkGuard,
  WorkLimitError,
  WorkCanceledError,
} from "../../src/limits/work-guard.js";
import {
  WorkContext,
  backgroundWorkContext,
} from "../../src/limits/work-context.js";
import fixture from "../fixtures/go-cluster-discovery-reference.json" with { type: "json" };

function newUnlimitedGuard(name = "test", limit = 10_000_000n) {
  return new WorkGuard(backgroundWorkContext(), name, typeof limit === "bigint" ? limit : BigInt(limit));
}

describe("Cluster Discovery Go Oracle Replay", () => {
  // -------------------------------------------------------------------------
  // Metadata verification
  // -------------------------------------------------------------------------
  test("fixture metadata matches pinned contract", () => {
    expect(fixture.metadata.d2PinnedSha).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(fixture.metadata.oracleBuildTag).toBe("tala_cluster_discovery_oracle");
    expect(fixture.metadata.runtimeGoos).toBeDefined();
    expect(fixture.metadata.runtimeGoarch).toBeDefined();
    expect(fixture.metadata.goVersion).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Arrowhead and Edge Classification (Section 7)
  // -------------------------------------------------------------------------
  test("arrowhead and edge classification matches Go oracle", () => {
    const cases = fixture.scenarios.arrowheadAndEdgeClassification;
    for (const c of cases) {
      const edge = new Edge(new Node(1), new Node(2));
      edge.SourceArrowhead = c.source;
      edge.TargetArrowhead = c.target;

      expect(edge.HasSourceArrow()).toBe(c.hasSourceArrow);
      expect(edge.HasTargetArrow()).toBe(c.hasTargetArrow);
      expect(edge.IsDirected()).toBe(c.isDirected);
      expect(edge.IsBidirectional()).toBe(c.isBidirectional);
      expect(edge.IsUndirected()).toBe(c.isUndirected);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Node.Adjacent Oracle (Section 8)
  // -------------------------------------------------------------------------
  test("Node.adjacent matches Go oracle including malformed fallback", () => {
    const oracle = fixture.scenarios.nodeAdjacent;
    const from = new Node(1);
    const to = new Node(2);
    const loopNode = new Node(3);
    const unrelated = new Node(4);

    const edge = new Edge(from, to);
    edge.ID = 100;
    const loopEdge = new Edge(loopNode, loopNode);
    loopEdge.ID = 200;

    expect(String(from.adjacent(edge).ID)).toBe(oracle.nodeIsFrom);
    expect(String(to.adjacent(edge).ID)).toBe(oracle.nodeIsTo);
    expect(String(loopNode.adjacent(loopEdge).ID)).toBe(oracle.nodeIsLoop);
    // Malformed fallback returns edge.From per Go implementation
    expect(String(unrelated.adjacent(edge).ID)).toBe(oracle.nodeIsUnrelated);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Signature and Directed-Count Quirk (Section 9)
  // -------------------------------------------------------------------------
  test("ClusterEdgeSignature counts and matching match Go oracle", () => {
    const s = fixture.scenarios.edgeSignatures;

    // Verify empty
    const sigEmpty = new ClusterEdgeSignature();
    expect(sigEmpty.from).toBe(s.empty.from);
    expect(sigEmpty.to).toBe(s.empty.to);
    expect(sigEmpty.directed).toBe(s.empty.directed);
    expect(sigEmpty.bidirectional).toBe(s.empty.bidirectional);
    expect(sigEmpty.undirected).toBe(s.empty.undirected);
    expect([...sigEmpty.fromArrowheads].sort()).toEqual(s.empty.fromArrowheads);
    expect([...sigEmpty.toArrowheads].sort()).toEqual(s.empty.toArrowheads);

    // Verify single undirected
    const n1 = new Node(1);
    const n2 = new Node(2);
    const eUndir = new Edge(n1, n2);
    eUndir.SourceArrowhead = "";
    eUndir.TargetArrowhead = "";
    const sigUndir = new ClusterEdgeSignature();
    sigUndir.add(n1, eUndir);
    expect(sigUndir.from).toBe(s.singleUndirected.from);
    expect(sigUndir.undirected).toBe(s.singleUndirected.undirected);
    expect([...sigUndir.fromArrowheads].sort()).toEqual(s.singleUndirected.fromArrowheads);

    // Verify single directed
    const eDir = new Edge(n1, n2);
    eDir.SourceArrowhead = "";
    eDir.TargetArrowhead = "triangle";
    const sigDir = new ClusterEdgeSignature();
    sigDir.add(n1, eDir);
    expect(sigDir.from).toBe(s.singleDirected.from);
    expect(sigDir.directed).toBe(s.singleDirected.directed);
    expect([...sigDir.toArrowheads].sort()).toEqual(s.singleDirected.toArrowheads);

    // Verify single bidirectional
    const eBidir = new Edge(n1, n2);
    eBidir.SourceArrowhead = "triangle";
    eBidir.TargetArrowhead = "triangle";
    const sigBidir = new ClusterEdgeSignature();
    sigBidir.add(n1, eBidir);
    expect(sigBidir.bidirectional).toBe(s.singleBidir.bidirectional);

    // Verify matching booleans
    expect(sigEmpty.matches(sigEmpty)).toBe(s.matching.empty_vs_empty);
    expect(sigUndir.matches(sigUndir)).toBe(s.matching.undir_vs_undir);
    expect(sigUndir.matches(sigDir)).toBe(s.matching.undir_vs_dir);
    expect(sigUndir.matches(sigBidir)).toBe(s.matching.undir_vs_bidir);
  });

  test("ClusterEdgeSignature directed-count quirk matches Go oracle", () => {
    const s = fixture.scenarios.edgeSignatures;

    // Node A with 2 directed edges: A->B (source="triangle", target="") and B->A (source="", target="triangle")
    const n1 = new Node(1);
    const n2 = new Node(2);
    const eAtoB = new Edge(n1, n2);
    eAtoB.SourceArrowhead = "triangle";
    eAtoB.TargetArrowhead = "";
    const eBtoA = new Edge(n2, n1);
    eBtoA.SourceArrowhead = "";
    eBtoA.TargetArrowhead = "triangle";

    const sigA = new ClusterEdgeSignature();
    sigA.add(n1, eAtoB);
    sigA.add(n1, eBtoA);

    expect(sigA.from).toBe(s.quirkSigA.from); // 1
    expect(sigA.to).toBe(s.quirkSigA.to);     // 1
    expect(sigA.directed).toBe(s.quirkSigA.directed); // 2
    expect(sigA.bidirectional).toBe(0);
    expect(sigA.undirected).toBe(0);

    // Node C with 1 directed loop: C->C with source="triangle", target=""
    const n3 = new Node(3);
    const eLoop = new Edge(n3, n3);
    eLoop.SourceArrowhead = "triangle";
    eLoop.TargetArrowhead = "";

    const sigC = new ClusterEdgeSignature();
    sigC.add(n3, eLoop);

    expect(sigC.from).toBe(s.quirkSigC.from); // 1
    expect(sigC.to).toBe(s.quirkSigC.to);     // 1
    expect(sigC.directed).toBe(s.quirkSigC.directed); // 1
    expect(sigC.bidirectional).toBe(0);
    expect(sigC.undirected).toBe(0);

    // Go quirk: matches() does NOT check directed count!
    // Both have arrowTypeCount() === 1, same from/to/bidir/undir, and same arrowhead sets!
    expect(sigA.matches(sigC)).toBe(s.quirkMatches);
    expect(sigA.matches(sigC)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Sequence Neighbor Recovery (Section 10)
  // -------------------------------------------------------------------------
  test("sequence neighbor recovery and WorkGuard deltas match Go oracle", () => {
    const s = fixture.scenarios.sequenceNeighborRecovery;

    const g = new Graph();
    const first = new Node(1, 10, 10);
    const second = new Node(2, 10, 10);
    const step = new Node(3, 10, 10);
    const vessel = new Node(4, 10, 10);
    const other = new Node(5, 10, 10);

    for (const n of [first, second, step, vessel, other]) {
      n.Graph = g;
    }
    g.addNewNodeToContainer(null, first);
    g.addNewNodeToContainer(null, second);
    g.addNewNodeToContainer(null, other);

    const edge = g.connect(first, vessel);
    edge.ID = 100;
    second.Edges.push(edge); // malformed observer

    const edgeOther = g.connect(other, vessel);
    edgeOther.ID = 101;

    const edgeUncached = g.connect(first, other);
    edgeUncached.ID = 102;

    const sequence = {
      Vessel: vessel,
      Nodes: [step],
      Graph: g,
      EdgeAbductions: [
        { Edge: edge, CurrentFrom: first, CurrentTo: vessel },
        { Edge: edge, OriginallyTo: step, CurrentFrom: first, CurrentTo: vessel },
        { Edge: edgeOther, OriginallyFrom: step, CurrentFrom: vessel, CurrentTo: other },
      ],
    };
    g.Sequences.set(vessel, sequence);

    const guard = newUnlimitedGuard("seq recovery");
    const index = buildClusterDiscoveryIndex(g, null, guard);

    const firstNeighbors = index.infos.get(first).neighbors.map(n => n ? String(n.ID) : "");
    const secondNeighbors = index.infos.get(second).neighbors.map(n => n ? String(n.ID) : "");
    expect(firstNeighbors).toEqual(s.firstNeighbors);
    expect(secondNeighbors).toEqual(s.secondNeighbors);

    // WorkGuard caching deltas on sequenceOriginal
    const gFresh = new Graph();
    const guard1 = newUnlimitedGuard("seq delta");
    const indexFresh = buildClusterDiscoveryIndex(gFresh, null, guard1);

    const usedBefore1 = guard1.Used();
    const orig1 = indexFresh.sequenceOriginal(sequence, edge, guard1);
    const usedAfter1 = guard1.Used();
    expect(Number(usedAfter1 - usedBefore1)).toBe(s.deltaFirstLookup);
    expect(orig1 ? String(orig1.ID) : "").toBe(s.orig1);

    // Second lookup for same sequence uses cached map: delta must be exactly 0
    const usedBefore2 = guard1.Used();
    const orig2 = indexFresh.sequenceOriginal(sequence, edge, guard1);
    const usedAfter2 = guard1.Used();
    expect(Number(usedAfter2 - usedBefore2)).toBe(s.deltaSecondLookup);
    expect(Number(usedAfter2 - usedBefore2)).toBe(0);
    expect(orig2 ? String(orig2.ID) : "").toBe(s.orig2);

    // Cached null lookup
    const usedBeforeNull = guard1.Used();
    const origNull = indexFresh.sequenceOriginal(sequence, edgeUncached, guard1);
    const usedAfterNull = guard1.Used();
    expect(Number(usedAfterNull - usedBeforeNull)).toBe(s.deltaNullLookup);
    expect(origNull).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Legacy/Index Parity Corpus Seeds 0..99 (Section 11)
  // -------------------------------------------------------------------------
  test("legacy/index parity corpus seeds 0..99 match Go oracle", () => {
    const arrowheads = ["", NO_ARROWHEAD, "triangle", "diamond"];

    for (const seedData of fixture.scenarios.legacyCorpus) {
      const seed = seedData.seed;
      const rng = new GoRand(seed);
      const g = new Graph();

      for (let i = 0; i < 12; i++) {
        const node = new Node(i + 1, 10 + i, 20 + i);
        node.Box.X = i * 50;
        node.Box.Y = (i % 3) * 50;
        g.addNewNodeToContainer(null, node);
      }

      for (let i = 0; i < 40; i++) {
        const fromIdx = rng.Intn(g.Nodes.length);
        const toIdx = rng.Intn(g.Nodes.length);
        const from = g.Nodes[fromIdx];
        const to = g.Nodes[toIdx];
        const edge = g.connect(from, to);
        edge.ID = 1000 + i;

        const srcAHIdx = rng.Intn(arrowheads.length);
        const tgtAHIdx = rng.Intn(arrowheads.length);
        edge.SourceArrowhead = arrowheads[srcAHIdx];
        edge.TargetArrowhead = arrowheads[tgtAHIdx];

        if (from !== to && rng.Intn(4) === 0) {
          // Asymmetric observer removal matching Go test
          const idx = to.Edges.indexOf(edge);
          if (idx !== -1) {
            to.Edges.splice(idx, 1);
          }
        }
        if (rng.Intn(9) === 0) {
          edge.FromTableColumnIndex = i;
        }
      }

      const guard = newUnlimitedGuard("corpus seed " + seed);
      const index = buildClusterDiscoveryIndex(g, null, guard);

      const rootChildren = g.Containers.get(null) || [];
      for (const node of rootChildren) {
        const expected = seedData.nodes[String(node.ID)];
        const info = index.infos.get(node);

        expect(info).toBeDefined();
        // Neighbors
        const gotNeighbors = info.neighbors.map(n => String(n.ID));
        expect(gotNeighbors).toEqual(expected.neighbors);

        // Signature counts
        expect(info.edgeSignature.from).toBe(expected.edgeSignature.from);
        expect(info.edgeSignature.to).toBe(expected.edgeSignature.to);
        expect(info.edgeSignature.directed).toBe(expected.edgeSignature.directed);
        expect(info.edgeSignature.bidirectional).toBe(expected.edgeSignature.bidirectional);
        expect(info.edgeSignature.undirected).toBe(expected.edgeSignature.undirected);

        // Arrowhead sets
        const fromAH = [...info.edgeSignature.fromArrowheads].sort();
        const toAH = [...info.edgeSignature.toArrowheads].sort();
        expect(fromAH).toEqual(expected.edgeSignature.fromArrowheads);
        expect(toAH).toEqual(expected.edgeSignature.toArrowheads);

        // Classification flags
        expect(info.toTableColumn).toBe(expected.toTableColumn);
        expect(info.noClustering).toBe(expected.noClustering);
        expect(info.estimatedWidth).toBe(expected.estimatedWidth);
        expect(info.estimatedHeight).toBe(expected.estimatedHeight);
      }

      // Pairwise signature matches
      for (const first of rootChildren) {
        for (const second of rootChildren) {
          const key = `${first.ID}_${second.ID}`;
          const expectedMatch = seedData.matches[key];
          const gotMatch = index.infos.get(first).edgeSignature.matches(index.infos.get(second).edgeSignature);
          expect(gotMatch).toBe(expectedMatch);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Leaky-Container Oracle (Section 12)
  // -------------------------------------------------------------------------
  test("leaky container detection matches Go oracle", () => {
    const s = fixture.scenarios.leakyContainer;

    for (const leaky of [false, true]) {
      const caseKey = leaky ? "leaky_true" : "leaky_false";
      const expected = s[caseKey];

      const g = new Graph();
      const container = new Node(1, 100, 100);
      const child = new Node(2, 10, 10);
      const external = new Node(3, 10, 10);
      g.addNewNodeToContainer(null, container);
      g.addNewNodeToContainer(container, child);

      if (leaky) {
        g.addNewNodeToContainer(null, external);
        const e = g.connect(child, external);
        e.ID = 10;
      } else {
        const e = g.connect(container, child);
        e.ID = 10;
      }

      const guardLeaky = newUnlimitedGuard("leaky standalone");
      const isLeaky = clusterHasLeakyEdgeGuarded(g, container, guardLeaky);
      expect(isLeaky).toBe(expected.isLeaky);
      expect(Number(guardLeaky.Used())).toBe(expected.leakyStandaloneUsed);

      const guardBuild = newUnlimitedGuard("leaky build");
      const index = buildClusterDiscoveryIndex(g, [container], guardBuild);
      expect(index.infos.get(container).noClustering).toBe(expected.noClustering);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 7: RefreshAfterClusterAbduction Oracle (Section 13)
  // -------------------------------------------------------------------------
  test("refreshAfterClusterAbduction matches Go oracle", () => {
    const s = fixture.scenarios.refreshAfterClusterAbduction;

    const g = new Graph();
    const first = new Node(1, 10, 10);
    const second = new Node(2, 10, 10);
    const external = new Node(3, 10, 10);
    const other = new Node(4, 10, 10);
    const malformedObserver = new Node(5, 10, 10);

    for (const n of [first, second, external, other, malformedObserver]) {
      g.addNewNodeToContainer(null, n);
    }

    const firstEdge = g.connect(first, external);
    firstEdge.ID = 100;
    malformedObserver.Edges.push(firstEdge);

    const e2 = g.connect(external, other);
    e2.ID = 101;
    const e3 = g.connect(second, external);
    e3.ID = 102;

    const guard = newUnlimitedGuard("refresh abduction");
    const index = buildClusterDiscoveryIndex(g, null, guard);

    expect(index.infos.get(external).neighbors.map(n => String(n.ID))).toEqual(s.initialExternalNeighbors);
    expect(index.infos.get(malformedObserver).neighbors.map(n => String(n.ID))).toEqual(s.initialMalformedNeighbors);

    const cluster = {
      Nodes: [first, second],
      Graph: g,
      Arrangement: 0,
    };
    const vessel = new Node(100, 50, 50);
    vessel.isClusterVessel = true;
    cluster.Vessel = vessel;
    first.Cluster = cluster;
    second.Cluster = cluster;
    g.Clusters.set(vessel, cluster);

    const incidentEdges = clusterIncidentEdges(cluster, index.infos, index.edgeOrder, guard);
    expect(incidentEdges.map(e => String(e.ID))).toEqual(s.incidentEdgeIDs);

    // Simulate abduction reconnect in test setup
    for (const edge of incidentEdges) {
      if (edge.From.Cluster === cluster) {
        edge.reconnect(cluster.Vessel, false);
      }
      if (edge.To.Cluster === cluster) {
        edge.reconnect(cluster.Vessel, true);
      }
    }

    const usedBeforeRefresh = guard.Used();
    index.refreshAfterClusterAbduction(g, cluster, incidentEdges, guard);
    const usedAfterRefresh = guard.Used();

    expect(index.infos.get(external).neighbors.map(n => String(n.ID))).toEqual(s.postExternalNeighbors);
    expect(index.infos.get(malformedObserver).neighbors.map(n => String(n.ID))).toEqual(s.postMalformedNeighbors);
    expect(index.infos.has(vessel)).toBe(s.vesselHasInfo);
    expect(Number(usedAfterRefresh - usedBeforeRefresh)).toBe(s.refreshUsedDelta);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: ClusterIncidentEdges Oracle (Section 14)
  // -------------------------------------------------------------------------
  test("clusterIncidentEdges matches Go oracle and preserves graph-edge order", () => {
    const s = fixture.scenarios.clusterIncidentEdges;

    const g = new Graph();
    const n1 = new Node(1, 10, 10);
    const n2 = new Node(2, 10, 10);
    const n3 = new Node(3, 10, 10);
    const ext = new Node(4, 10, 10);
    g.addNewNodeToContainer(null, n1);
    g.addNewNodeToContainer(null, n2);
    g.addNewNodeToContainer(null, n3);
    g.addNewNodeToContainer(null, ext);

    const e1 = g.connect(n1, ext);
    e1.ID = 10;
    const e2 = g.connect(n1, n2);
    e2.ID = 11;
    const e3 = g.connect(n2, ext);
    e3.ID = 12;
    const eLoop = g.connect(n1, n1);
    eLoop.ID = 13;
    const eParallel = g.connect(n2, ext);
    eParallel.ID = 14;

    const guard = newUnlimitedGuard("incident oracle");
    const index = buildClusterDiscoveryIndex(g, null, guard);

    // Empty cluster
    const cEmpty = { Nodes: [], Graph: g };
    expect(clusterIncidentEdges(cEmpty, index.infos, index.edgeOrder, guard).map(e => String(e.ID))).toEqual(s.emptyCluster);

    // One member empty
    const cOneEmpty = { Nodes: [n3], Graph: g };
    expect(clusterIncidentEdges(cOneEmpty, index.infos, index.edgeOrder, guard).map(e => String(e.ID))).toEqual(s.oneMemberEmpty);

    // Members edges
    const cMembers = { Nodes: [n1, n2], Graph: g };
    expect(clusterIncidentEdges(cMembers, index.infos, index.edgeOrder, guard).map(e => String(e.ID))).toEqual(s.membersEdges);

    // Duplicate members
    const cDup = { Nodes: [n1, n1, n2], Graph: g };
    expect(clusterIncidentEdges(cDup, index.infos, index.edgeOrder, guard).map(e => String(e.ID))).toEqual(s.duplicateMembers);

    // Reversed node edges preserves graph-edge order
    n1.Edges.reverse();
    expect(clusterIncidentEdges(cMembers, index.infos, index.edgeOrder, guard).map(e => String(e.ID))).toEqual(s.reversedNodeEdges);
    n1.Edges.reverse();

    // Missing member info throws exact error
    const unindexedNode = new Node(999, 10, 10);
    const cMissing = { Nodes: [unindexedNode], Graph: g };
    expect(() => clusterIncidentEdges(cMissing, index.infos, index.edgeOrder, guard)).toThrow(s.missingMemberErrMsg);
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Exact WorkGuard Parity and Low-Limit Tests (Section 15)
  // -------------------------------------------------------------------------
  test("exact WorkGuard Used counts match Go oracle", () => {
    const wg = fixture.scenarios.exactWorkGuard;

    // clusterIsDescendantOfGuarded
    {
      const g = new Graph();
      const root = new Node(1, 100, 100);
      const mid = new Node(2, 50, 50);
      const leaf = new Node(3, 10, 10);
      const unrelated = new Node(4, 10, 10);

      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, mid);
      g.addNewNodeToContainer(mid, leaf);
      g.addNewNodeToContainer(null, unrelated);

      const measureDescendant = (d, a) => {
        const gd = newUnlimitedGuard("desc");
        clusterIsDescendantOfGuarded(d, a, gd);
        return Number(gd.Used());
      };

      expect(measureDescendant(leaf, leaf)).toBe(wg.descendant_self);
      expect(measureDescendant(null, null)).toBe(wg.descendant_null_null);
      expect(measureDescendant(null, root)).toBe(wg.descendant_null_non_null);
      expect(measureDescendant(mid, root)).toBe(wg.descendant_parent);
      expect(measureDescendant(leaf, root)).toBe(wg.descendant_nested);
      expect(measureDescendant(unrelated, root)).toBe(wg.descendant_unrelated);

      // Cycle
      const c1 = new Node(10);
      const c2 = new Node(11);
      c1.Container = c2;
      c2.Container = c1;
      const gdCycle = newUnlimitedGuard("cycle");
      expect(() => clusterIsDescendantOfGuarded(c1, root, gdCycle)).toThrow("TALA AddClusters found a cycle in node ancestry");
      expect(Number(gdCycle.Used())).toBe(wg.descendant_cycle);
    }

    // AllDescendantNodesWithWorkGuard
    {
      const measureAllDesc = (setup, includeClusters) => {
        const g = new Graph();
        const target = setup(g);
        const gd = newUnlimitedGuard("all desc");
        g.allDescendantNodesWithWorkGuard(target, includeClusters, gd);
        return Number(gd.Used());
      };

      expect(measureAllDesc(g => {
        const n = new Node(1);
        g.addNewNodeToContainer(null, n);
        return n;
      }, true)).toBe(wg.allDesc_empty);

      expect(measureAllDesc(g => {
        const root = new Node(1);
        const c1 = new Node(2);
        const c2 = new Node(3);
        g.addNewNodeToContainer(null, root);
        g.addNewNodeToContainer(root, c1);
        g.addNewNodeToContainer(c1, c2);
        return root;
      }, true)).toBe(wg.allDesc_nested_container);
    }

    // clusterIncidentEdges
    {
      const measureIncident = (edgeCount) => {
        const g = new Graph();
        const n1 = new Node(1);
        g.addNewNodeToContainer(null, n1);
        for (let i = 0; i < edgeCount; i++) {
          const ext = new Node(10 + i);
          g.addNewNodeToContainer(null, ext);
          g.connect(n1, ext);
        }
        const gdInit = newUnlimitedGuard("init");
        const index = buildClusterDiscoveryIndex(g, null, gdInit);
        const cluster = { Nodes: [n1], Graph: g };
        const gdIncident = newUnlimitedGuard("incident");
        clusterIncidentEdges(cluster, index.infos, index.edgeOrder, gdIncident);
        return Number(gdIncident.Used());
      };

      expect(measureIncident(0)).toBe(wg.clusterIncidentEdges_empty);
      expect(measureIncident(1)).toBe(wg.clusterIncidentEdges_1_edge);
      expect(measureIncident(2)).toBe(wg.clusterIncidentEdges_2_edges);
      expect(measureIncident(4)).toBe(wg.clusterIncidentEdges_4_edges);
    }
  });

  test("WorkGuard low-limit boundary tests: limit=exact succeeds, limit=exact-1 fails", () => {
    const wg = fixture.scenarios.exactWorkGuard;

    // Test descendant boundary
    const root = new Node(1);
    const mid = new Node(2);
    const leaf = new Node(3);
    root.isContainer = true;
    mid.isContainer = true;
    mid.Container = root;
    leaf.Container = mid;

    const exactDesc = BigInt(wg.descendant_nested);
    // Exactly at budget -> succeeds
    const guardSuccess = new WorkGuard(backgroundWorkContext(), "desc success", exactDesc);
    expect(clusterIsDescendantOfGuarded(leaf, root, guardSuccess)).toBe(true);

    // One below budget -> fails with WorkLimitError
    const guardFail = new WorkGuard(backgroundWorkContext(), "desc fail", exactDesc - 1n);
    expect(() => clusterIsDescendantOfGuarded(leaf, root, guardFail)).toThrow(WorkLimitError);

    // Test clusterIncidentEdges boundary
    const g = new Graph();
    const n1 = new Node(1);
    const n2 = new Node(2);
    g.addNewNodeToContainer(null, n1);
    g.addNewNodeToContainer(null, n2);
    g.connect(n1, n2);
    const initGuard = newUnlimitedGuard("init");
    const index = buildClusterDiscoveryIndex(g, null, initGuard);
    const cluster = { Nodes: [n1], Graph: g };

    const exactIncident = BigInt(wg.clusterIncidentEdges_1_edge);
    const gIncidentPass = new WorkGuard(backgroundWorkContext(), "incident pass", exactIncident);
    expect(clusterIncidentEdges(cluster, index.infos, index.edgeOrder, gIncidentPass)).toBeDefined();

    const gIncidentFail = new WorkGuard(backgroundWorkContext(), "incident fail", exactIncident - 1n);
    expect(() => clusterIncidentEdges(cluster, index.infos, index.edgeOrder, gIncidentFail)).toThrow(WorkLimitError);
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Mid-Operation Cancellation (Section 16)
  // -------------------------------------------------------------------------
  test("genuine mid-operation cancellation throws WorkCanceledError and preserves graph topology", () => {
    // 1. AllDescendantNodesWithWorkGuard
    {
      const g = new Graph();
      const root = new Node(1);
      const c1 = new Node(2);
      const c2 = new Node(3);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, c1);
      g.addNewNodeToContainer(c1, c2);

      let steps = 0;
      const ctx = new WorkContext({
        isCancelled: () => {
          steps++;
          return steps >= 2; // cancel mid-operation
        },
      });
      const guard = new WorkGuard(ctx, "cancel desc", 10_000n);

      expect(() => g.allDescendantNodesWithWorkGuard(root, true, guard)).toThrow(WorkCanceledError);
      // Graph topology untouched
      expect(g.Nodes.length).toBe(3);
      expect(root.Container).toBeNull();
      expect(c1.Container).toBe(root);
      expect(c2.Container).toBe(c1);
    }

    // 2. buildClusterDiscoveryIndex mid-operation cancellation
    {
      const g = new Graph();
      for (let i = 0; i < 5; i++) {
        g.addNewNodeToContainer(null, new Node(i + 1));
      }
      g.connect(g.Nodes[0], g.Nodes[1]);
      g.connect(g.Nodes[1], g.Nodes[2]);

      let steps = 0;
      const ctx = new WorkContext({
        isCancelled: () => {
          steps++;
          return steps >= 4; // cancels during build
        },
      });
      const guard = new WorkGuard(ctx, "cancel build", 10_000n);

      expect(() => buildClusterDiscoveryIndex(g, null, guard)).toThrow(WorkCanceledError);
      expect(g.Nodes.length).toBe(5);
      expect(g.Edges.length).toBe(2);
    }

    // 3. clusterIncidentEdges mid-operation cancellation
    {
      const g = new Graph();
      const n1 = new Node(1);
      const n2 = new Node(2);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.connect(n1, n2);

      const initGuard = newUnlimitedGuard("init");
      const index = buildClusterDiscoveryIndex(g, null, initGuard);
      const cluster = { Nodes: [n1], Graph: g };

      let steps = 0;
      const ctx = new WorkContext({
        isCancelled: () => {
          steps++;
          return steps >= 2;
        },
      });
      const cancelGuard = new WorkGuard(ctx, "cancel incident", 10_000n);

      expect(() => clusterIncidentEdges(cluster, index.infos, index.edgeOrder, cancelGuard)).toThrow(WorkCanceledError);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Graph Read-Only / Exact Alias Test (Section 17)
  // -------------------------------------------------------------------------
  test("buildClusterDiscoveryIndex guarantees read-only graph topology across success and failure", () => {
    const g = new Graph();
    const root = new Node(1, 100, 100);
    const child = new Node(2, 50, 50);
    g.addNewNodeToContainer(null, root);
    g.addNewNodeToContainer(root, child);
    const edge = g.connect(root, child);

    // Capture exact references before discovery
    const nodesRef = g.Nodes;
    const edgesRef = g.Edges;
    const containersRef = g.Containers;
    const clustersRef = g.Clusters;
    const sequencesRef = g.Sequences;
    const treesRef = g.Trees;
    const rootChildrenRef = g.Containers.get(root);
    const rootEdgesRef = root.Edges;
    const childEdgesRef = child.Edges;
    const rootContainerRef = root.Container;
    const childContainerRef = child.Container;
    const rootGraphRef = root.Graph;
    const childGraphRef = child.Graph;
    const rootBoxRef = root.Box;
    const edgeFromRef = edge.From;
    const edgeToRef = edge.To;

    // Successful discovery
    const guardSuccess = newUnlimitedGuard("readonly success");
    const index = buildClusterDiscoveryIndex(g, [root], guardSuccess);
    expect(index).toBeDefined();

    // Verify all references and contents are unchanged by identity and value
    expect(g.Nodes).toBe(nodesRef);
    expect(g.Edges).toBe(edgesRef);
    expect(g.Containers).toBe(containersRef);
    expect(g.Clusters).toBe(clustersRef);
    expect(g.Sequences).toBe(sequencesRef);
    expect(g.Trees).toBe(treesRef);
    expect(g.Containers.get(root)).toBe(rootChildrenRef);
    expect(root.Edges).toBe(rootEdgesRef);
    expect(child.Edges).toBe(childEdgesRef);
    expect(root.Container).toBe(rootContainerRef);
    expect(child.Container).toBe(childContainerRef);
    expect(root.Graph).toBe(rootGraphRef);
    expect(child.Graph).toBe(childGraphRef);
    expect(root.Box).toBe(rootBoxRef);
    expect(edge.From).toBe(edgeFromRef);
    expect(edge.To).toBe(edgeToRef);

    // Cancelled discovery
    let cancelSteps = 0;
    const ctx = new WorkContext({
      isCancelled: () => {
        cancelSteps++;
        return cancelSteps >= 2;
      },
    });
    const cancelGuard = new WorkGuard(ctx, "readonly cancel", 1000n);
    expect(() => buildClusterDiscoveryIndex(g, [root], cancelGuard)).toThrow(WorkCanceledError);

    // Verify graph is still completely unchanged
    expect(g.Nodes).toBe(nodesRef);
    expect(g.Edges).toBe(edgesRef);
    expect(root.Edges).toBe(rootEdgesRef);
    expect(child.Edges).toBe(childEdgesRef);
  });

  // -------------------------------------------------------------------------
  // Scenario 12: Full Descendant Traversal Oracle (Section 18)
  // -------------------------------------------------------------------------
  test("Graph.allDescendantNodesWithWorkGuard matches Go oracle exactly", () => {
    const cases = fixture.scenarios.descendantTraversal;

    // Plain containers
    {
      const expected = cases.plain_containers;
      const g = new Graph();
      const root = new Node(1);
      const c1 = new Node(2);
      const c2 = new Node(3);
      const n1 = new Node(4);
      const n2 = new Node(5);
      const n3 = new Node(6);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, c1);
      g.addNewNodeToContainer(root, c2);
      g.addNewNodeToContainer(c1, n1);
      g.addNewNodeToContainer(c1, n2);
      g.addNewNodeToContainer(c2, n3);

      const gd = newUnlimitedGuard("plain desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, true, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }

    // Nested containers
    {
      const expected = cases.nested_containers;
      const g = new Graph();
      const root = new Node(1);
      const c1 = new Node(2);
      const c2 = new Node(3);
      const n1 = new Node(4);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, c1);
      g.addNewNodeToContainer(c1, c2);
      g.addNewNodeToContainer(c2, n1);

      const gd = newUnlimitedGuard("nested desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, true, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }

    // Cluster vessel: include=true vs false
    for (const inc of [true, false]) {
      const caseKey = inc ? "cluster_vessel_include_true" : "cluster_vessel_include_false";
      const expected = cases[caseKey];

      const g = new Graph();
      const root = new Node(1);
      const m1 = new Node(2);
      const m2 = new Node(3);
      const cluster = { Nodes: [m1, m2], Graph: g };
      const vessel = new Node(100);
      vessel.isClusterVessel = true;
      cluster.Vessel = vessel;
      g.Clusters.set(vessel, cluster);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, vessel);

      const gd = newUnlimitedGuard("cluster vessel desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, inc, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }

    // Sequence vessel: include=true vs false
    for (const inc of [true, false]) {
      const caseKey = inc ? "sequence_vessel_include_true" : "sequence_vessel_include_false";
      const expected = cases[caseKey];

      const g = new Graph();
      const root = new Node(1);
      const vessel = new Node(2);
      const sm1 = new Node(3);
      const sm2 = new Node(4);
      const seq = { Vessel: vessel, Nodes: [sm1, sm2], Graph: g };
      g.Sequences.set(vessel, seq);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, vessel);

      const gd = newUnlimitedGuard("seq vessel desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, inc, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }

    // Mixed topology
    {
      const expected = cases.mixed_topology_include_true;
      const g = new Graph();
      const root = new Node(1);
      const child = new Node(2);
      const cm1 = new Node(3);
      const cluster = { Nodes: [cm1], Graph: g };
      const cv = new Node(100);
      cv.isClusterVessel = true;
      cluster.Vessel = cv;
      g.Clusters.set(cv, cluster);

      const sv = new Node(4);
      const sm1 = new Node(5);
      const seq = { Vessel: sv, Nodes: [sm1], Graph: g };
      g.Sequences.set(sv, seq);

      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, child);
      g.addNewNodeToContainer(root, cv);
      g.addNewNodeToContainer(root, sv);

      const gd = newUnlimitedGuard("mixed desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, true, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }

    // Duplicate references & seen suppression
    {
      const expected = cases.duplicate_references;
      const g = new Graph();
      const root = new Node(1);
      const child = new Node(2);
      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, child);
      g.Containers.get(root).push(child); // duplicate reference

      const gd = newUnlimitedGuard("dup desc");
      const descendants = g.allDescendantNodesWithWorkGuard(root, true, gd);
      expect(descendants.map(n => String(n.ID))).toEqual(expected.descendants);
      expect(Number(gd.Used())).toBe(expected.guardUsed);
    }
  });
});
