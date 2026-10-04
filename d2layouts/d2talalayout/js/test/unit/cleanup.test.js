import { describe, it, expect, spyOn } from "bun:test";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { HerdAssignment } from "../../src/graph/herd-assignment.js";
import { cleanup, Cleanup } from "../../src/grouping/lifecycle.js";
import { cleanup as indexCleanup, Cleanup as IndexCleanup } from "../../src/grouping/index.js";

describe("Slice 27 — Grouping Cleanup Direct Unit Tests", () => {
  describe("API Surface and Exports", () => {
    it("exports cleanup and Cleanup from grouping lifecycle and index", () => {
      expect(typeof cleanup).toBe("function");
      expect(typeof Cleanup).toBe("function");
      expect(Cleanup).toBe(cleanup);

      expect(typeof indexCleanup).toBe("function");
      expect(typeof IndexCleanup).toBe("function");
      expect(IndexCleanup).toBe(cleanup);
    });
  });

  describe("Call Ordering Instrumentation", () => {
    it("proves cluster cleanup step ordering", () => {
      const g = new Graph();
      const parent = new Node(100, 100, 100);
      parent.Graph = g;
      parent.isContainer = true;

      const vessel = new Node(1, 40, 40);
      vessel.Graph = g;
      vessel.Container = parent;
      vessel.isClusterVessel = true;

      const member = new Node(2, 20, 20);
      member.Graph = g;

      const other = new Node(3, 10, 10);
      other.Graph = g;
      vessel.addNear(other);

      const dest = new Node(4, 10, 10);
      dest.Graph = g;
      const e = g.connect(vessel, dest);
      const abduction = { Edge: e, OriginallyFrom: member };

      const c = new Cluster({
        Vessel: vessel,
        Nodes: [member],
        Graph: g,
        Container: parent,
        EdgeAbductions: [abduction],
      });
      g.Clusters.set(vessel, c);
      g.Nodes = [parent, vessel, other, dest];
      g.Containers.set(parent, [vessel]);

      const events = [];

      // Instrument ArrangeClusterNodes
      const origArrange = c.ArrangeClusterNodes.bind(c);
      c.ArrangeClusterNodes = () => {
        events.push("ArrangeClusterNodes");
        return origArrange();
      };

      // Instrument AddNewNodeToContainer
      const origAddNewNode = g.AddNewNodeToContainer.bind(g);
      g.AddNewNodeToContainer = (cnt, node) => {
        events.push(`AddNewNodeToContainer:${node.ID}`);
        return origAddNewNode(cnt, node);
      };

      // Instrument Edge.Reconnect
      const origReconnect = e.Reconnect.bind(e);
      e.Reconnect = (target, isTo) => {
        events.push(`Reconnect:${target.ID}:${isTo}`);
        return origReconnect(target, isTo);
      };

      // Instrument AddNear on Near node
      const origAddNear = other.AddNear.bind(other);
      other.AddNear = (target) => {
        events.push(`AddNear:${target.ID}`);
        return origAddNear(target);
      };

      // Instrument removeNode
      const origRemoveNode = g.removeNode.bind(g);
      g.removeNode = (n) => {
        events.push(`RemoveNode:${n.ID}`);
        return origRemoveNode(n);
      };

      cleanup(g);

      // Verify sequence of operations
      expect(events).toEqual([
        "ArrangeClusterNodes",
        "AddNewNodeToContainer:2",
        "Reconnect:2:false",
        "AddNear:2",
        "RemoveNode:1",
      ]);

      // Post-condition: vessel detached
      expect(vessel.Graph).toBeNull();
      expect(vessel.Container).toBeNull();
      expect(g.Containers.get(parent)).toEqual([member]);
    });

    it("proves sequence cleanup step ordering", () => {
      const g = new Graph();
      const parent = new Node(100, 100, 100);
      parent.Graph = g;
      parent.isContainer = true;

      const vessel = new Node(1, 40, 40);
      vessel.Graph = g;
      vessel.Container = parent;

      const step = new Node(2, 20, 20);
      step.Graph = g;

      const other = new Node(3, 10, 10);
      other.Graph = g;
      vessel.addNear(other);

      const dest = new Node(4, 10, 10);
      dest.Graph = g;
      const e = g.connect(vessel, dest);
      const abduction = { Edge: e, OriginallyFrom: step };

      const seq = new Sequence();
      seq.Vessel = vessel;
      seq.Nodes = [step];
      seq.Graph = g;
      seq.Container = parent;
      seq.EdgeAbductions = [abduction];

      g.Sequences.set(vessel, seq);
      g.Nodes = [parent, vessel, other, dest];
      g.Containers.set(parent, [vessel]);

      const events = [];

      const origArrange = seq.ArrangeSteps.bind(seq);
      seq.ArrangeSteps = () => {
        events.push("ArrangeSteps");
        return origArrange();
      };

      const origAddNewNode = g.AddNewNodeToContainer.bind(g);
      g.AddNewNodeToContainer = (cnt, node) => {
        events.push(`AddNewNodeToContainer:${node.ID}`);
        return origAddNewNode(cnt, node);
      };

      const origReconnect = e.Reconnect.bind(e);
      e.Reconnect = (target, isTo) => {
        events.push(`Reconnect:${target.ID}:${isTo}`);
        return origReconnect(target, isTo);
      };

      const origAddNear = other.AddNear.bind(other);
      other.AddNear = (target) => {
        events.push(`AddNear:${target.ID}`);
        return origAddNear(target);
      };

      const origRemoveNode = g.removeNode.bind(g);
      g.removeNode = (n) => {
        events.push(`RemoveNode:${n.ID}`);
        return origRemoveNode(n);
      };

      cleanup(g);

      expect(events).toEqual([
        "ArrangeSteps",
        "AddNewNodeToContainer:2",
        "Reconnect:2:false",
        "AddNear:2",
        "RemoveNode:1",
      ]);

      expect(vessel.Graph).toBeNull();
      expect(vessel.Container).toBeNull();
      expect(g.Containers.get(parent)).toEqual([step]);
    });

    it("proves ALL clusters finish before any sequence cleanup begins", () => {
      const g = new Graph();

      const cVessel = new Node(20, 10, 10);
      cVessel.Graph = g;
      cVessel.isClusterVessel = true;
      const cMember = new Node(21, 10, 10);
      cMember.Graph = g;
      const c = new Cluster({ Vessel: cVessel, Nodes: [cMember], Graph: g });

      const sVessel = new Node(10, 10, 10);
      sVessel.Graph = g;
      const sStep = new Node(11, 10, 10);
      sStep.Graph = g;
      const seq = new Sequence();
      seq.Vessel = sVessel;
      seq.Nodes = [sStep];
      seq.Graph = g;

      // Deliberately insert sequence into graph BEFORE cluster
      g.Sequences.set(sVessel, seq);
      g.Clusters.set(cVessel, c);
      g.Nodes = [cVessel, sVessel];

      const phases = [];

      const origCArrange = c.ArrangeClusterNodes.bind(c);
      c.ArrangeClusterNodes = () => {
        phases.push("cluster:start");
        origCArrange();
        phases.push("cluster:end");
      };

      const origSArrange = seq.ArrangeSteps.bind(seq);
      seq.ArrangeSteps = () => {
        phases.push("sequence:start");
        origSArrange();
        phases.push("sequence:end");
      };

      cleanup(g);

      expect(phases).toEqual([
        "cluster:start",
        "cluster:end",
        "sequence:start",
        "sequence:end",
      ]);
    });
  });

  describe("Sorting and Determinism", () => {
    it("processes clusters in ClusterOrder (ID sorted) regardless of map insertion order", () => {
      const g = new Graph();
      const v90 = new Node(90, 10, 10);
      v90.Graph = g;
      const m91 = new Node(91, 10, 10);
      m91.Graph = g;

      const v10 = new Node(10, 10, 10);
      v10.Graph = g;
      const m11 = new Node(11, 10, 10);
      m11.Graph = g;

      const v50 = new Node(50, 10, 10);
      v50.Graph = g;
      const m51 = new Node(51, 10, 10);
      m51.Graph = g;

      // Insert in reverse order: 90, 50, 10
      g.Clusters.set(v90, new Cluster({ Vessel: v90, Nodes: [m91], Graph: g }));
      g.Clusters.set(v50, new Cluster({ Vessel: v50, Nodes: [m51], Graph: g }));
      g.Clusters.set(v10, new Cluster({ Vessel: v10, Nodes: [m11], Graph: g }));
      g.Nodes = [v90, v50, v10];

      cleanup(g);

      // Members must be appended in order of sorted cluster ID: 10, 50, 90 -> 11, 51, 91
      expect(g.Nodes.map((n) => n.ID)).toEqual([11, 51, 91]);
    });

    it("processes sequences in SequenceOrder (ID sorted) regardless of map insertion order", () => {
      const g = new Graph();
      const s90 = new Node(90, 10, 10);
      s90.Graph = g;
      const st91 = new Node(91, 10, 10);
      st91.Graph = g;
      const seq90 = new Sequence();
      seq90.Vessel = s90;
      seq90.Nodes = [st91];
      seq90.Graph = g;

      const s10 = new Node(10, 10, 10);
      s10.Graph = g;
      const st11 = new Node(11, 10, 10);
      st11.Graph = g;
      const seq10 = new Sequence();
      seq10.Vessel = s10;
      seq10.Nodes = [st11];
      seq10.Graph = g;

      // Insert in reverse order: 90, 10
      g.Sequences.set(s90, seq90);
      g.Sequences.set(s10, seq10);
      g.Nodes = [s90, s10];

      cleanup(g);

      // Steps must be appended in order of sorted sequence ID: 10, 90 -> 11, 91
      expect(g.Nodes.map((n) => n.ID)).toEqual([11, 91]);
    });

    it("processes near transfers in OrderedNears order", () => {
      const g = new Graph();
      const vessel = new Node(1, 10, 10);
      vessel.Graph = g;
      const member = new Node(2, 10, 10);
      member.Graph = g;

      const near30 = new Node(30, 10, 10);
      near30.Graph = g;
      const near10 = new Node(10, 10, 10);
      near10.Graph = g;

      // Insert near30 before near10
      vessel.addNear(near30);
      vessel.addNear(near10);

      const c = new Cluster({ Vessel: vessel, Nodes: [member], Graph: g });
      g.Clusters.set(vessel, c);
      g.Nodes = [vessel, near10, near30];

      const nearOrder = [];
      const origOrderedNears = vessel.orderedNears.bind(vessel);
      vessel.orderedNears = () => {
        const res = origOrderedNears();
        nearOrder.push(...res.map((n) => n.ID));
        return res;
      };

      cleanup(g);

      expect(nearOrder).toEqual([10, 30]);
    });
  });

  describe("HerdAssignment Clearing Distinction", () => {
    it("clears HerdAssignment on surviving nodes in graph.Nodes but retains on detached vessels", () => {
      const g = new Graph();
      const ord = new Node(1, 10, 10);
      ord.Graph = g;
      ord.HerdAssignment = new HerdAssignment();

      const cVessel = new Node(2, 10, 10);
      cVessel.Graph = g;
      cVessel.HerdAssignment = new HerdAssignment();
      const cMember = new Node(3, 10, 10);
      cMember.Graph = g;
      cMember.HerdAssignment = new HerdAssignment();
      const c = new Cluster({ Vessel: cVessel, Nodes: [cMember], Graph: g });
      g.Clusters.set(cVessel, c);

      g.Nodes = [ord, cVessel];

      cleanup(g);

      // ord and cMember survive in g.Nodes -> HerdAssignment cleared
      expect(ord.HerdAssignment).toBeNull();
      expect(cMember.HerdAssignment).toBeNull();

      // cVessel was retired from g.Nodes -> HerdAssignment retained
      expect(cVessel.HerdAssignment).not.toBeNull();
    });
  });
});
