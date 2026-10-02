import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Point } from "../../src/geometry/point.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-sync-nested-geometry-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

function parseNumberClass(s) {
  if (s == null) return null;
  if (s === "NaN") return NaN;
  if (s === "+Inf" || s === "+Infinity" || s === "Infinity") return Infinity;
  if (s === "-Inf" || s === "-Infinity") return -Infinity;
  return parseFloat(s);
}

function expectNumMatch(actual, expectedStr) {
  const expected = parseNumberClass(expectedStr);
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(actual)).toBe(true);
  } else {
    expect(actual).toBe(expected);
  }
}

function assertNodeGeometry(actualNode, expectedDTO) {
  if (!expectedDTO) return;
  expectNumMatch(actualNode.Width, expectedDTO.width);
  expectNumMatch(actualNode.Height, expectedDTO.height);
  if (expectedDTO.topLeft) {
    expectNumMatch(actualNode.TopLeft.X, expectedDTO.topLeft.x);
    expectNumMatch(actualNode.TopLeft.Y, expectedDTO.topLeft.y);
  } else {
    expect(actualNode.TopLeft).toBeNull();
  }
}

describe("Slice 26 — SyncNestedGeometry Oracle Replay", () => {
  for (const [scenarioName, sc] of Object.entries(reference.scenarios)) {
    it(`replays ${scenarioName}`, () => {
      const g = new Graph();
      let allNodes = [];

      // Reconstruct state based on the scenario
      if (scenarioName === "empty_graph") {
        g.Nodes = [];
      } else if (scenarioName === "ordinary_node") {
        const n = new Node(1, 10, 10);
        n.Graph = g;
        g.Nodes = [n];
        allNodes = [n];
      } else if (scenarioName === "container_only_node") {
        const root = new Node(1, 10, 10);
        root.Graph = g;
        g.Nodes = [root];
        root.isContainer = true;
        const child = new Node(2, 20, 20);
        child.Graph = g;
        child.TopLeft = new Point(10, 10);
        g.Containers.set(root, [child]);
        allNodes = [root, child];
      } else if (scenarioName === "cluster_vessel_only_node") {
        const vessel = new Node(1, 10, 10);
        vessel.Graph = g;
        g.Nodes = [vessel];
        vessel.isClusterVessel = true;
        const member = new Node(2, 20, 20);
        member.Graph = g;
        const c = new Cluster();
        c.Vessel = vessel;
        c.Nodes = [member];
        c.Graph = g;
        g.Clusters.set(vessel, c);
        allNodes = [vessel, member];
      } else if (scenarioName === "sequence_only_node") {
        const sVessel = new Node(1, 10, 10);
        sVessel.Graph = g;
        g.Nodes = [sVessel];
        const sStep = new Node(2, 30, 30);
        sStep.Graph = g;
        const seq = new Sequence();
        seq.Vessel = sVessel;
        seq.Nodes = [sStep];
        seq.Graph = g;
        g.Sequences.set(sVessel, seq);
        allNodes = [sVessel, sStep];
      } else if (scenarioName === "cluster_containing_container_member") {
        const vessel2 = new Node(1, 10, 10);
        vessel2.Graph = g;
        g.Nodes = [vessel2];
        vessel2.isClusterVessel = true;
        const containerMember = new Node(2, 50, 50);
        containerMember.Graph = g;
        containerMember.isContainer = true;
        const c2 = new Cluster();
        c2.Vessel = vessel2;
        c2.Nodes = [containerMember];
        c2.Graph = g;
        g.Clusters.set(vessel2, c2);
        const grandchild = new Node(3, 10, 10);
        grandchild.Graph = g;
        grandchild.TopLeft = new Point(5, 5);
        const greatGrandchild = new Node(4, 10, 10);
        greatGrandchild.Graph = g;
        greatGrandchild.TopLeft = new Point(5, 5);
        grandchild.isContainer = true;
        g.Containers.set(containerMember, [grandchild]);
        g.Containers.set(grandchild, [greatGrandchild]);
        allNodes = [vessel2, containerMember, grandchild, greatGrandchild];
      } else if (scenarioName === "multiple_cluster_container_members") {
        const vessel3 = new Node(1, 10, 10);
        vessel3.Graph = g;
        g.Nodes = [vessel3];
        vessel3.isClusterVessel = true;
        const cm1 = new Node(2, 10, 10);
        cm1.Graph = g;
        cm1.isContainer = true;
        const gc1 = new Node(3, 10, 10);
        gc1.Graph = g;
        gc1.TopLeft = new Point(1, 1);
        g.Containers.set(cm1, [gc1]);
        const cm2 = new Node(4, 20, 20);
        cm2.Graph = g;
        cm2.isContainer = true;
        const gc2 = new Node(5, 10, 10);
        gc2.Graph = g;
        gc2.TopLeft = new Point(1, 1);
        g.Containers.set(cm2, [gc2]);
        const c3 = new Cluster();
        c3.Vessel = vessel3;
        c3.Nodes = [cm1, cm2];
        c3.Graph = g;
        g.Clusters.set(vessel3, c3);
        allNodes = [vessel3, cm1, gc1, cm2, gc2];
      } else if (scenarioName === "multiple_graph_nodes_source_order") {
        const n1 = new Node(1, 20, 20);
        n1.Graph = g;
        n1.isContainer = true;
        const ch1 = new Node(11, 10, 10);
        ch1.Graph = g;
        ch1.TopLeft = new Point(10, 10);
        g.Containers.set(n1, [ch1]);
        const n2 = new Node(2, 20, 20);
        n2.Graph = g;
        n2.isClusterVessel = true;
        const ch2 = new Node(12, 10, 10);
        ch2.Graph = g;
        const c4 = new Cluster();
        c4.Vessel = n2;
        c4.Nodes = [ch2];
        c4.Graph = g;
        g.Clusters.set(n2, c4);
        g.Nodes = [n2, n1];
        allNodes = [n1, ch1, n2, ch2];
      } else if (scenarioName === "multi_role_node") {
        const mr = new Node(1, 10, 10);
        mr.Graph = g;
        g.Nodes = [mr];
        mr.isContainer = true;
        mr.isClusterVessel = true;
        const ch3 = new Node(2, 20, 20);
        ch3.Graph = g;
        ch3.TopLeft = new Point(10, 10);
        g.Containers.set(mr, [ch3]);
        const cm3 = new Node(3, 20, 20);
        cm3.Graph = g;
        const cmCl = new Cluster();
        cmCl.Vessel = mr;
        cmCl.Nodes = [cm3];
        cmCl.Graph = g;
        g.Clusters.set(mr, cmCl);
        const st = new Node(4, 30, 30);
        st.Graph = g;
        const sq = new Sequence();
        sq.Vessel = mr;
        sq.Nodes = [st];
        sq.Graph = g;
        g.Sequences.set(mr, sq);
        allNodes = [mr, ch3, cm3, st];
      } else if (scenarioName === "missing_sequence_key") {
        const noSeq = new Node(1, 10, 10);
        noSeq.Graph = g;
        g.Nodes = [noSeq];
        allNodes = [noSeq];
      } else if (scenarioName === "present_sequence_key_nil_value") {
        const nilSeqVessel = new Node(1, 10, 10);
        nilSeqVessel.Graph = g;
        g.Nodes = [nilSeqVessel];
        g.Sequences.set(nilSeqVessel, null);
        allNodes = [nilSeqVessel];
      } else if (scenarioName === "cluster_vessel_missing_cluster_entry") {
        const misVessel = new Node(1, 10, 10);
        misVessel.Graph = g;
        g.Nodes = [misVessel];
        misVessel.isClusterVessel = true;
        allNodes = [misVessel];
      } else if (scenarioName === "container_missing_child_list_key") {
        const misCont = new Node(1, 10, 10);
        misCont.Graph = g;
        g.Nodes = [misCont];
        misCont.isContainer = true;
        allNodes = [misCont];
      } else if (scenarioName === "nil_node_in_graph_nodes") {
        g.Nodes = [null];
      } else {
        throw new Error(`Unknown scenario: ${scenarioName}`);
      }

      let panicked = false;
      try {
        g.SyncNestedGeometry();
      } catch (e) {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);

      if (!panicked && sc.nodesAfter) {
        for (const node of allNodes) {
          if (!node) continue;
          const expected = sc.nodesAfter[String(node.ID)];
          assertNodeGeometry(node, expected);
        }
      }
    });
  }
});
