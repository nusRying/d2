import { validateEngineGraph } from "../graph/topology-preflight.js";
import { WorkGuard } from "../limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS } from "../limits/constants.js";

/**
 * addHubs discovers nodes that have both a leaf spoke and another connection
 * within the same containing layout group.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/hubs.go
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} graph
 */
export function addHubs(context, graph) {
  validateEngineGraph(context, "AddHubs", graph);

  const guard = new WorkGuard(context, "AddHubs", MAX_ENGINE_WORK_UNITS);

  const hubs = new Map();

  for (const node of graph.Nodes ?? []) {
    guard.Step();
    let hasConnected = false;
    const spokes = [];

    for (const edge of node.Edges ?? []) {
      guard.Step();
      const adjacent = node.Adjacent(edge);
      if (adjacent.OwningContainer() !== node.OwningContainer()) {
        continue;
      }
      const adjEdgeCount = adjacent.Edges != null ? adjacent.Edges.length : 0;
      if (adjEdgeCount === 1) {
        spokes.push(adjacent);
      } else {
        hasConnected = true;
      }
    }

    if (hasConnected && spokes.length > 0) {
      hubs.set(node, spokes);
    }
  }

  guard.Finish();

  graph.Hubs = hubs;
}

/**
 * Pinned PascalCase alias.
 */
export const AddHubs = addHubs;
