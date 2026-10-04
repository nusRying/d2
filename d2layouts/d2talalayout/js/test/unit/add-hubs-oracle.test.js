import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster } from "../../src/graph/cluster.js";
import { backgroundWorkContext, abortSignalWorkContext } from "../../src/limits/work-context.js";
import { addHubs } from "../../src/proximity/hubs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-add-hubs-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("Slice 28 — Proximity AddHubs Oracle Replay", () => {
  for (const [scenarioName, sc] of Object.entries(reference.scenarios)) {
    it(`replays ${scenarioName}`, () => {
      const g = new Graph();
      let ctx = backgroundWorkContext();
      let oldHubKey = null;

      if (scenarioName === "empty_graph") {
        // empty graph
      } else if (scenarioName === "canonical_hub") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const connected = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);
        for (const n of [hub, spoke, connected, other]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, connected);
        g.Connect(connected, other);
      } else if (scenarioName === "leaf_spokes_only") {
        const hub = new Node(1, 10, 10);
        const s1 = new Node(2, 10, 10);
        const s2 = new Node(3, 10, 10);
        for (const n of [hub, s1, s2]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, s1);
        g.Connect(hub, s2);
      } else if (scenarioName === "non_leaf_connections_only") {
        const hub = new Node(1, 10, 10);
        const c1 = new Node(2, 10, 10);
        const c2 = new Node(3, 10, 10);
        const o1 = new Node(4, 10, 10);
        const o2 = new Node(5, 10, 10);
        for (const n of [hub, c1, c2, o1, o2]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, c1);
        g.Connect(hub, c2);
        g.Connect(c1, o1);
        g.Connect(c2, o2);
      } else if (scenarioName === "minimal_valid_hub") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const connected = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);
        for (const n of [hub, spoke, connected, other]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, connected);
        g.Connect(connected, other);
      } else if (scenarioName === "multiple_spokes") {
        const hub = new Node(1, 10, 10);
        const s1 = new Node(2, 10, 10);
        const s2 = new Node(3, 10, 10);
        const s3 = new Node(4, 10, 10);
        const c1 = new Node(5, 10, 10);
        const o1 = new Node(6, 10, 10);
        for (const n of [hub, s1, s2, s3, c1, o1]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, s1);
        g.Connect(hub, s2);
        g.Connect(hub, s3);
        g.Connect(hub, c1);
        g.Connect(c1, o1);
      } else if (scenarioName === "spoke_order_differs_from_id") {
        const hub = new Node(1, 10, 10);
        const s30 = new Node(30, 10, 10);
        const c = new Node(2, 10, 10);
        const other = new Node(3, 10, 10);
        const s10 = new Node(10, 10, 10);
        const s20 = new Node(20, 10, 10);
        for (const n of [hub, s30, c, other, s10, s20]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, s30);
        g.Connect(hub, c);
        g.Connect(c, other);
        g.Connect(hub, s10);
        g.Connect(hub, s20);
      } else if (scenarioName === "edge_to_different_direct_container") {
        const cntA = new Node(10, 100, 100);
        cntA.isContainer = true;
        const cntB = new Node(20, 100, 100);
        cntB.isContainer = true;
        const hub = new Node(1, 10, 10);
        const spokeInB = new Node(2, 10, 10);
        for (const n of [cntA, cntB]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.AddNewNodeToContainer(cntA, hub);
        g.AddNewNodeToContainer(cntB, spokeInB);
        g.Connect(hub, spokeInB);
      } else if (scenarioName === "cross_container_leaf_plus_same_container_non_leaf") {
        const cntA = new Node(10, 100, 100);
        cntA.isContainer = true;
        const cntB = new Node(20, 100, 100);
        cntB.isContainer = true;
        const hub = new Node(1, 10, 10);
        const connectedInA = new Node(2, 10, 10);
        const otherInA = new Node(3, 10, 10);
        const leafInB = new Node(4, 10, 10);

        g.AddNewNodeToContainer(null, cntA);
        g.AddNewNodeToContainer(null, cntB);
        g.AddNewNodeToContainer(cntA, hub);
        g.AddNewNodeToContainer(cntA, connectedInA);
        g.AddNewNodeToContainer(cntA, otherInA);
        g.AddNewNodeToContainer(cntB, leafInB);

        g.Connect(hub, connectedInA);
        g.Connect(connectedInA, otherInA);
        g.Connect(hub, leafInB);
      } else if (scenarioName === "same_container_leaf_plus_cross_container_non_leaf") {
        const cntA = new Node(10, 100, 100);
        cntA.isContainer = true;
        const cntB = new Node(20, 100, 100);
        cntB.isContainer = true;
        const hub = new Node(1, 10, 10);
        const leafInA = new Node(2, 10, 10);
        const connInB = new Node(3, 10, 10);
        const otherInB = new Node(4, 10, 10);

        g.AddNewNodeToContainer(null, cntA);
        g.AddNewNodeToContainer(null, cntB);
        g.AddNewNodeToContainer(cntA, hub);
        g.AddNewNodeToContainer(cntA, leafInA);
        g.AddNewNodeToContainer(cntB, connInB);
        g.AddNewNodeToContainer(cntB, otherInB);

        g.Connect(hub, leafInA);
        g.Connect(hub, connInB);
        g.Connect(connInB, otherInB);
      } else if (scenarioName === "root_level_nodes") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const connected = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);
        for (const n of [hub, spoke, connected, other]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, connected);
        g.Connect(connected, other);
      } else if (scenarioName === "active_grouping_owning_container") {
        const parent = new Node(100, 200, 200);
        parent.isContainer = true;
        g.AddNewNodeToContainer(null, parent);

        const vessel = new Node(10, 50, 50);
        vessel.isClusterVessel = true;
        g.AddNewNodeToContainer(parent, vessel);

        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const conn = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);

        const c = new Cluster({
          Vessel: vessel,
          Nodes: [hub, spoke],
          Graph: g,
        });
        g.Clusters.set(vessel, c);
        hub.Cluster = c;
        spoke.Cluster = c;

        g.AddNewNodeToContainer(parent, conn);
        g.AddNewNodeToContainer(parent, other);
        g.Nodes.push(hub, spoke);

        g.Connect(hub, spoke);
        g.Connect(hub, conn);
        g.Connect(conn, other);
      } else if (scenarioName === "parallel_multiple_incident_edges") {
        const hub = new Node(1, 10, 10);
        const candidate = new Node(2, 10, 10);
        for (const n of [hub, candidate]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, candidate);
        g.Connect(hub, candidate);
      } else if (scenarioName === "self_loop") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        for (const n of [hub, spoke]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, hub);
      } else if (scenarioName === "existing_non_empty_hubs_replaced") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const conn = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);
        const oldDummy = new Node(99, 10, 10);
        for (const n of [hub, spoke, conn, other, oldDummy]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, conn);
        g.Connect(conn, other);

        g.Hubs.set(oldDummy, [spoke]);
        oldHubKey = oldDummy;
      } else if (scenarioName === "successful_empty_result_replaces_old_map") {
        const n1 = new Node(1, 10, 10);
        g.AddNewNodeToContainer(null, n1);
        g.Hubs.set(n1, [n1]);
        oldHubKey = n1;
      } else if (scenarioName === "pre_cancelled_context") {
        const hub = new Node(1, 10, 10);
        const spoke = new Node(2, 10, 10);
        const conn = new Node(3, 10, 10);
        const other = new Node(4, 10, 10);
        for (const n of [hub, spoke, conn, other]) {
          g.AddNewNodeToContainer(null, n);
        }
        g.Connect(hub, spoke);
        g.Connect(hub, conn);
        g.Connect(conn, other);

        g.Hubs.set(hub, [spoke]);
        oldHubKey = hub;

        const controller = new AbortController();
        controller.abort();
        ctx = abortSignalWorkContext(controller.signal);
      } else if (scenarioName === "mid_operation_cancellation") {
        for (let i = 0; i < 130; i++) {
          const node = new Node(i + 1, 10, 10);
          g.AddNodeUnchecked(node);
        }
        g.Hubs.set(g.Nodes[0], [g.Nodes[1]]);
        oldHubKey = g.Nodes[0];

        let remaining = 1;
        ctx = {
          isCancelled: () => {
            if (remaining <= 0) return true;
            remaining--;
            return false;
          },
        };
      } else if (scenarioName === "validation_failure_atomicity") {
        const n1 = new Node(1, 10, 10);
        const n2 = new Node(2, 10, 10);
        g.Nodes = [n1, n2];
        n1.Container = n2;
        n2.Container = n1;
        n1.isContainer = true;
        n2.isContainer = true;

        g.Hubs.set(n1, [n2]);
        oldHubKey = n1;
      } else if (scenarioName === "nil_graph_nodes") {
        g.Nodes = null;
      } else if (scenarioName === "nil_node_edges") {
        const node = new Node(1, 10, 10);
        g.AddNodeUnchecked(node);
        node.Edges = null;
        g.Hubs.set(node, [node]);
        oldHubKey = node;
      }

      const oldHubsRef = g.Hubs;

      if (sc.success) {
        expect(() => addHubs(ctx, g)).not.toThrow();

        // Check map reference replacement
        if (!sc.sameHubsMap) {
          expect(g.Hubs).not.toBe(oldHubsRef);
        } else {
          expect(g.Hubs).toBe(oldHubsRef);
        }

        // Check discovered hubs count
        expect(g.Hubs.size).toBe(sc.hubs.length);

        // Check each expected hub and its spokes
        for (const expectedHub of sc.hubs) {
          const hubNode = (g.Nodes || []).find((n) => n && String(n.ID) === expectedHub.hubId);
          expect(hubNode).toBeDefined();
          const discoveredSpokes = g.Hubs.get(hubNode);
          expect(discoveredSpokes).toBeDefined();
          const spokeIds = discoveredSpokes.map((s) => String(s.ID));
          expect(spokeIds).toEqual(expectedHub.spokes);
        }
      } else {
        expect(() => addHubs(ctx, g)).toThrow();
        // Failure preserves exact old Map reference
        expect(g.Hubs).toBe(oldHubsRef);
        if (sc.oldHubPreserved && oldHubKey) {
          expect(g.Hubs.has(oldHubKey)).toBe(true);
          expect(g.Hubs.get(oldHubKey).length).toBeGreaterThan(0);
        }
      }
    });
  }
});
