import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Point } from "../../src/geometry/point.js";
import { HerdAssignment } from "../../src/graph/herd-assignment.js";
import { cleanup } from "../../src/grouping/lifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-cleanup-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("Slice 27 — Grouping Cleanup Oracle Replay", () => {
  for (const [scenarioName, sc] of Object.entries(reference.scenarios)) {
    it(`replays ${scenarioName}`, () => {
      const g = new Graph();
      let tracked = [];

      if (scenarioName === "empty_graph") {
        // g is empty
      } else if (scenarioName === "ordinary_nodes_only") {
        const n1 = new Node(1, 10, 10);
        n1.Graph = g;
        n1.HerdAssignment = new HerdAssignment();
        const n2 = new Node(2, 20, 20);
        n2.Graph = g;
        g.Nodes = [n1, n2];
        tracked = [n1, n2];
      } else if (scenarioName === "one_simple_cluster") {
        const parent = new Node(10, 100, 100);
        parent.Graph = g;
        parent.isContainer = true;
        const vessel = new Node(1, 40, 40);
        vessel.Graph = g;
        vessel.Container = parent;
        vessel.isClusterVessel = true;
        const member = new Node(2, 20, 20);
        member.Graph = g;
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [member],
          Graph: g,
          Container: parent,
        });
        g.Clusters.set(vessel, c);
        g.Nodes = [parent, vessel];
        g.Containers.set(parent, [vessel]);
        tracked = [parent, vessel, member];
      } else if (scenarioName === "cluster_geometry_arrangement") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        vessel.TopLeft = new Point(100, 100);
        vessel.isClusterVessel = true;
        const m1 = new Node(2, 20, 20);
        m1.Graph = g;
        m1.TopLeft = new Point(0, 0);
        const m2 = new Node(3, 30, 30);
        m2.Graph = g;
        m2.TopLeft = new Point(0, 0);
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [m1, m2],
          Graph: g,
          Arrangement: ClusterArrangement.Row,
          Padding: 5,
        });
        g.Clusters.set(vessel, c);
        g.Nodes = [vessel];
        tracked = [vessel, m1, m2];
      } else if (scenarioName === "one_simple_sequence") {
        const sVessel = new Node(1, 30, 30);
        sVessel.Graph = g;
        const sStep = new Node(2, 20, 20);
        sStep.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [sStep];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);
        g.Nodes = [sVessel];
        tracked = [sVessel, sStep];
      } else if (scenarioName === "cluster_and_sequence_together") {
        const cVessel = new Node(20, 40, 40);
        cVessel.Graph = g;
        cVessel.isClusterVessel = true;
        const cMember = new Node(21, 20, 20);
        cMember.Graph = g;
        const c = new Cluster({ Vessel: cVessel, Nodes: [cMember], Graph: g });
        g.Clusters.set(cVessel, c);

        const sVessel = new Node(10, 30, 30);
        sVessel.Graph = g;
        const sStep = new Node(11, 20, 20);
        sStep.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [sStep];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);

        const ord = new Node(1, 10, 10);
        ord.Graph = g;
        g.Nodes = [ord, cVessel, sVessel];
        tracked = [ord, cVessel, cMember, sVessel, sStep];
      } else if (scenarioName === "multiple_clusters_inserted_out_of_order") {
        const v30 = new Node(30, 10, 10);
        v30.Graph = g;
        const m31 = new Node(31, 10, 10);
        m31.Graph = g;
        const c30 = new Cluster({ Vessel: v30, Nodes: [m31], Graph: g });

        const v10 = new Node(10, 10, 10);
        v10.Graph = g;
        const m11 = new Node(11, 10, 10);
        m11.Graph = g;
        const c10 = new Cluster({ Vessel: v10, Nodes: [m11], Graph: g });

        const v20 = new Node(20, 10, 10);
        v20.Graph = g;
        const m21 = new Node(21, 10, 10);
        m21.Graph = g;
        const c20 = new Cluster({ Vessel: v20, Nodes: [m21], Graph: g });

        // Insert out of order
        g.Clusters.set(v30, c30);
        g.Clusters.set(v10, c10);
        g.Clusters.set(v20, c20);
        g.Nodes = [v30, v10, v20];
        tracked = [v10, v20, v30, m11, m21, m31];
      } else if (scenarioName === "multiple_sequences_inserted_out_of_order") {
        const s30 = new Node(30, 10, 10);
        s30.Graph = g;
        const step31 = new Node(31, 10, 10);
        step31.Graph = g;
        const seq30 = new Sequence();
        seq30.Vessel = s30;
        seq30.Nodes = [step31];
        seq30.Graph = g;

        const s10 = new Node(10, 10, 10);
        s10.Graph = g;
        const step11 = new Node(11, 10, 10);
        step11.Graph = g;
        const seq10 = new Sequence();
        seq10.Vessel = s10;
        seq10.Nodes = [step11];
        seq10.Graph = g;

        const s20 = new Node(20, 10, 10);
        s20.Graph = g;
        const step21 = new Node(21, 10, 10);
        step21.Graph = g;
        const seq20 = new Sequence();
        seq20.Vessel = s20;
        seq20.Nodes = [step21];
        seq20.Graph = g;

        // Insert out of order
        g.Sequences.set(s30, seq30);
        g.Sequences.set(s10, seq10);
        g.Sequences.set(s20, seq20);
        g.Nodes = [s30, s10, s20];
        tracked = [s10, s20, s30, step11, step21, step31];
      } else if (scenarioName === "member_order") {
        const cVessel = new Node(1, 10, 10);
        cVessel.Graph = g;
        const m3 = new Node(3, 10, 10);
        m3.Graph = g;
        const m2 = new Node(2, 10, 10);
        m2.Graph = g;
        const m5 = new Node(5, 10, 10);
        m5.Graph = g;
        const c = new Cluster({ Vessel: cVessel, Nodes: [m3, m2, m5], Graph: g });
        g.Clusters.set(cVessel, c);

        const sVessel = new Node(10, 10, 10);
        sVessel.Graph = g;
        const st13 = new Node(13, 10, 10);
        st13.Graph = g;
        const st12 = new Node(12, 10, 10);
        st12.Graph = g;
        const st15 = new Node(15, 10, 10);
        st15.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [st13, st12, st15];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);

        g.Nodes = [cVessel, sVessel];
        tracked = [cVessel, sVessel, m3, m2, m5, st13, st12, st15];
      } else if (scenarioName === "existing_container_siblings") {
        const container = new Node(100, 100, 100);
        container.Graph = g;
        container.isContainer = true;
        const sib1 = new Node(101, 10, 10);
        sib1.Graph = g;
        sib1.Container = container;
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        vessel.Container = container;
        vessel.isClusterVessel = true;
        const sib2 = new Node(102, 10, 10);
        sib2.Graph = g;
        sib2.Container = container;

        const m1 = new Node(2, 10, 10);
        m1.Graph = g;
        const m2 = new Node(3, 10, 10);
        m2.Graph = g;
        const c = new Cluster({ Vessel: vessel, Nodes: [m1, m2], Container: container, Graph: g });
        g.Clusters.set(vessel, c);

        g.Nodes = [container, sib1, vessel, sib2];
        g.Containers.set(container, [sib1, vessel, sib2]);
        tracked = [container, sib1, vessel, sib2, m1, m2];
      } else if (scenarioName === "root_container_nil_container") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        vessel.isClusterVessel = true;
        const m = new Node(2, 10, 10);
        m.Graph = g;
        const c = new Cluster({ Vessel: vessel, Nodes: [m], Container: null, Graph: g });
        g.Clusters.set(vessel, c);

        const sVessel = new Node(3, 10, 10);
        sVessel.Graph = g;
        const step = new Node(4, 10, 10);
        step.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [step];
        seq.Container = null;
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);

        g.Nodes = [vessel, sVessel];
        g.Containers.set(null, [vessel, sVessel]);
        tracked = [vessel, m, sVessel, step];
      } else if (scenarioName === "cluster_edge_abduction_from_restoration") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const origFrom = new Node(2, 10, 10);
        origFrom.Graph = g;
        const dest = new Node(3, 10, 10);
        dest.Graph = g;
        g.Nodes = [vessel, origFrom, dest];

        const e = g.connect(vessel, dest);
        const abduction = {
          Edge: e,
          OriginallyFrom: origFrom,
        };
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [origFrom],
          Graph: g,
          EdgeAbductions: [abduction],
        });
        g.Clusters.set(vessel, c);
        tracked = [vessel, origFrom, dest];
      } else if (scenarioName === "cluster_edge_abduction_to_restoration") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const src = new Node(2, 10, 10);
        src.Graph = g;
        const origTo = new Node(3, 10, 10);
        origTo.Graph = g;
        g.Nodes = [vessel, src, origTo];

        const e = g.connect(src, vessel);
        const abduction = {
          Edge: e,
          OriginallyTo: origTo,
        };
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [origTo],
          Graph: g,
          EdgeAbductions: [abduction],
        });
        g.Clusters.set(vessel, c);
        tracked = [vessel, src, origTo];
      } else if (scenarioName === "cluster_edge_abduction_both_endpoints") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const vessel2 = new Node(2, 10, 10);
        vessel2.Graph = g;
        const origFrom = new Node(3, 10, 10);
        origFrom.Graph = g;
        const origTo = new Node(4, 10, 10);
        origTo.Graph = g;
        g.Nodes = [vessel, vessel2];

        const e = g.connect(vessel, vessel2);
        const abduction = {
          Edge: e,
          OriginallyFrom: origFrom,
          OriginallyTo: origTo,
        };
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [origFrom, origTo],
          Graph: g,
          EdgeAbductions: [abduction],
        });
        g.Clusters.set(vessel, c);
        tracked = [vessel, vessel2, origFrom, origTo];
      } else if (scenarioName === "sequence_edge_abduction_equivalents") {
        const sVessel = new Node(1, 10, 10);
        sVessel.Graph = g;
        const origFrom = new Node(2, 10, 10);
        origFrom.Graph = g;
        const dest = new Node(3, 10, 10);
        dest.Graph = g;
        g.Nodes = [sVessel, dest];

        const e = g.connect(sVessel, dest);
        const abduction = {
          Edge: e,
          OriginallyFrom: origFrom,
        };
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [origFrom];
        seq.Graph = g;
        seq.EdgeAbductions = [abduction];
        g.Sequences.set(sVessel, seq);
        tracked = [sVessel, origFrom, dest];
      } else if (scenarioName === "cluster_near_transfer") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const m1 = new Node(2, 10, 10);
        m1.Graph = g;
        const m2 = new Node(3, 10, 10);
        m2.Graph = g;
        const near30 = new Node(30, 10, 10);
        near30.Graph = g;
        const near10 = new Node(10, 10, 10);
        near10.Graph = g;
        const near20 = new Node(20, 10, 10);
        near20.Graph = g;

        vessel.addNear(near30);
        vessel.addNear(near10);
        vessel.addNear(near20);

        const c = new Cluster({ Vessel: vessel, Nodes: [m1, m2], Graph: g });
        g.Clusters.set(vessel, c);
        g.Nodes = [vessel, near10, near20, near30];
        tracked = [vessel, m1, m2, near10, near20, near30];
      } else if (scenarioName === "sequence_near_transfer") {
        const sVessel = new Node(1, 10, 10);
        sVessel.Graph = g;
        const step1 = new Node(2, 10, 10);
        step1.Graph = g;
        const step2 = new Node(3, 10, 10);
        step2.Graph = g;
        const near20 = new Node(20, 10, 10);
        near20.Graph = g;
        const near10 = new Node(10, 10, 10);
        near10.Graph = g;

        sVessel.addNear(near20);
        sVessel.addNear(near10);

        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [step1, step2];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);
        g.Nodes = [sVessel, near10, near20];
        tracked = [sVessel, step1, step2, near10, near20];
      } else if (scenarioName === "herd_assignment_clearing") {
        const ord = new Node(1, 10, 10);
        ord.Graph = g;
        ord.HerdAssignment = new HerdAssignment();

        const cVessel = new Node(4, 10, 10);
        cVessel.Graph = g;
        cVessel.HerdAssignment = new HerdAssignment();
        const cMember = new Node(2, 10, 10);
        cMember.Graph = g;
        cMember.HerdAssignment = new HerdAssignment();
        const c = new Cluster({ Vessel: cVessel, Nodes: [cMember], Graph: g });
        g.Clusters.set(cVessel, c);

        const sVessel = new Node(5, 10, 10);
        sVessel.Graph = g;
        sVessel.HerdAssignment = new HerdAssignment();
        const sStep = new Node(3, 10, 10);
        sStep.Graph = g;
        sStep.HerdAssignment = new HerdAssignment();
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [sStep];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);

        g.Nodes = [ord, cVessel, sVessel];
        tracked = [ord, cMember, sStep, cVessel, sVessel];
      } else if (scenarioName === "nil_cluster_nodes") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const c = new Cluster({ Vessel: vessel, Nodes: null, Graph: g });
        g.Clusters.set(vessel, c);
        g.Nodes = [vessel];
        tracked = [vessel];
      } else if (scenarioName === "nil_sequence_nodes") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const seq = new Sequence();
        seq.Vessel = vessel;
        seq.Nodes = null;
        seq.Graph = g;
        g.Sequences.set(vessel, seq);
        g.Nodes = [vessel];
        tracked = [vessel];
      } else if (scenarioName === "nil_cluster_map_value") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        g.Clusters.set(vessel, null);
        g.Nodes = [vessel];
        tracked = [vessel];
      } else if (scenarioName === "nil_sequence_map_value") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        g.Sequences.set(vessel, null);
        g.Nodes = [vessel];
        tracked = [vessel];
      } else if (scenarioName === "nil_edge_abduction_entry") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        const c = new Cluster({
          Vessel: vessel,
          Nodes: [],
          Graph: g,
          EdgeAbductions: [null],
        });
        g.Clusters.set(vessel, c);
        g.Nodes = [vessel];
        tracked = [vessel];
      } else if (scenarioName === "duplicate_vessel_occurrence") {
        const parent = new Node(10, 100, 100);
        parent.Graph = g;
        parent.isContainer = true;
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        vessel.Container = parent;
        const m = new Node(2, 10, 10);
        m.Graph = g;
        const c = new Cluster({ Vessel: vessel, Nodes: [m], Container: parent, Graph: g });
        g.Clusters.set(vessel, c);

        g.Nodes = [parent, vessel, m, vessel];
        g.Containers.set(parent, [vessel, m, vessel]);
        tracked = [parent, vessel, m];
      } else if (scenarioName === "repeated_cleanup_call") {
        const cVessel = new Node(1, 10, 10);
        cVessel.Graph = g;
        const cMember = new Node(2, 10, 10);
        cMember.Graph = g;
        const c = new Cluster({ Vessel: cVessel, Nodes: [cMember], Graph: g });
        g.Clusters.set(cVessel, c);

        const sVessel = new Node(3, 10, 10);
        sVessel.Graph = g;
        const sStep = new Node(4, 10, 10);
        sStep.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [sStep];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);

        g.Nodes = [cVessel, sVessel];
        tracked = [cVessel, cMember, sVessel, sStep];
      }

      // Execute cleanup
      let threw = false;
      let thrownError = null;

      try {
        if (scenarioName === "repeated_cleanup_call") {
          cleanup(g);
          cleanup(g);
        } else {
          cleanup(g);
        }
      } catch (e) {
        threw = true;
        thrownError = e;
      }

      if (sc.panicked) {
        expect(threw).toBe(true);
        return;
      }

      expect(threw).toBe(false);

      // Verify Graph.Nodes
      const actualNodes = g.Nodes.map((n) => (n != null ? String(n.ID) : "null"));
      expect(actualNodes).toEqual(sc.nodes);

      // Verify Graph.Containers
      const actualContainers = {};
      for (const [c, children] of g.Containers.entries()) {
        const key = c != null ? String(c.ID) : "null";
        actualContainers[key] = (children || []).map((ch) => (ch != null ? String(ch.ID) : "null"));
      }
      expect(actualContainers).toEqual(sc.containers);

      // Verify Clusters retained keys
      const actualClusterKeys = {};
      for (const k of g.Clusters.keys()) {
        const key = k != null ? String(k.ID) : "null";
        actualClusterKeys[key] = true;
      }
      expect(actualClusterKeys).toEqual(sc.clusters);

      // Verify Sequences retained keys
      const actualSequenceKeys = {};
      for (const k of g.Sequences.keys()) {
        const key = k != null ? String(k.ID) : "null";
        actualSequenceKeys[key] = true;
      }
      expect(actualSequenceKeys).toEqual(sc.sequences);

      // Verify Edges
      const actualEdges = (g.Edges || []).map((e) => ({
        id: String(e.ID),
        from: e.From != null ? String(e.From.ID) : "null",
        to: e.To != null ? String(e.To.ID) : "null",
      }));
      expect(actualEdges).toEqual(sc.edges);

      // Verify Tracked Nodes
      const nodesInGraph = new Set(g.Nodes);
      for (const n of tracked) {
        if (n == null) continue;
        const nID = String(n.ID);
        const expected = sc.trackedNodes[nID];
        expect(expected).toBeDefined();

        expect(n.Graph !== null).toBe(expected.inGraph);
        expect(nodesInGraph.has(n)).toBe(expected.inGraphNodes);
        expect(n.Container != null ? String(n.Container.ID) : null).toBe(expected.container);

        const nears = n.orderedNears().map((x) => String(x.ID));
        expect(nears).toEqual(expected.nears);

        const edges = (n.Edges || []).map((e) => String(e.ID)).sort();
        expect(edges).toEqual(expected.edges);

        expect(n.HerdAssignment !== null).toBe(expected.hasHerdAssignment);
        expect(n.Width).toBe(expected.width);
        expect(n.Height).toBe(expected.height);

        if (expected.topLeft) {
          expect(n.TopLeft).not.toBeNull();
          expect(n.TopLeft.X).toBe(expected.topLeft.x);
          expect(n.TopLeft.Y).toBe(expected.topLeft.y);
        }
      }
    });
  }
});
