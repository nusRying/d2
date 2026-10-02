import { WorkGuard } from "../limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS, MAX_TOPOLOGY_REFERENCES } from "../limits/constants.js";
import { sortNodesByID } from "../graph/node.js";

/**
 * AssignNears marks otherwise unconnected siblings that share an external
 * neighbor so placement keeps them close together.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/nears.go
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} graph
 * @param {import("../graph/node.js").Node} root
 * @param {Array<import("../graph/edge-abduction.js").EdgeAbduction>} abductions
 */
export function assignNears(context, graph, root, abductions) {
  return assignNearsWithWorkLimit(
    context,
    graph,
    root,
    abductions,
    MAX_ENGINE_WORK_UNITS
  );
}

export const AssignNears = assignNears;

/**
 * Internal work-limited kernel for AssignNears.
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} graph
 * @param {import("../graph/node.js").Node} root
 * @param {Array<import("../graph/edge-abduction.js").EdgeAbduction>} abductions
 * @param {bigint|number} workLimit
 */
export function assignNearsWithWorkLimit(context, graph, root, abductions, workLimit) {
  const guard = new WorkGuard(context, "AssignNears", workLimit);

  const uncles = new Map();
  for (const abduction of abductions ?? []) {
    guard.Step();
    if (abduction == null) {
      throw new Error("nil edge abduction while assigning nears");
    }
    const originallyFrom = groupVessel(abduction.OriginallyFrom);
    const originallyTo = groupVessel(abduction.OriginallyTo);
    let uncle = null;
    let connected = null;
    const children = graph?.Containers?.get(root) ?? [];
    for (const node of children) {
      guard.Step();
      const fromDescendant = isDescendantOf(originallyFrom, node, guard);
      const toDescendant = isDescendantOf(originallyTo, node, guard);
      if (fromDescendant) {
        uncle = abduction.CurrentTo;
        connected = node;
        break;
      } else if (toDescendant) {
        uncle = abduction.CurrentFrom;
        connected = node;
        break;
      }
    }
    if (uncle != null && connected != null) {
      let group = uncles.get(uncle);
      if (group == null) {
        group = new Set();
        uncles.set(uncle, group);
      }
      group.add(connected);
    }
  }

  const orderedUncles = [];
  for (const uncle of uncles.keys()) {
    guard.Step();
    orderedUncles.push(uncle);
  }
  sortNodesByID(orderedUncles);

  const originalNears = new Map();
  const replacementNears = new Map();
  let nearReferences = 0;

  function mutableNears(node) {
    if (replacementNears.has(node)) {
      return replacementNears.get(node);
    }
    const existingCount = node.Nears?.size ?? 0;
    if (existingCount > MAX_TOPOLOGY_REFERENCES - nearReferences) {
      throw new Error(`TALA AssignNears topology references exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
    }
    nearReferences += existingCount;
    originalNears.set(node, node.Nears);
    const replacement = new Set();
    if (node.Nears != null) {
      for (const near of node.Nears) {
        guard.Step();
        replacement.add(near);
      }
    }
    replacementNears.set(node, replacement);
    return replacement;
  }

  function hasConnection(node, other) {
    const edges = node.Edges ?? [];
    for (const edge of edges) {
      guard.Step();
      if (edge != null && node.Adjacent(edge) === other) {
        return true;
      }
    }
    return false;
  }

  for (const uncle of orderedUncles) {
    const nodes = [];
    for (const node of uncles.get(uncle)) {
      guard.Step();
      nodes.push(node);
    }
    sortNodesByID(nodes);
    if (nodes.length === 1) {
      continue;
    }
    for (let i = 0; i < nodes.length; i++) {
      const first = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const second = nodes[j];
        guard.Step();
        if (first.Hierarchy != null || second.Hierarchy != null) {
          continue;
        }
        if (hasConnection(first, second)) {
          continue;
        }
        const firstNears = mutableNears(first);
        const secondNears = mutableNears(second);
        if (!firstNears.has(second)) {
          if (nearReferences >= MAX_TOPOLOGY_REFERENCES) {
            throw new Error(`TALA AssignNears topology references exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
          }
          firstNears.add(second);
          nearReferences++;
        }
        if (!secondNears.has(first)) {
          if (nearReferences >= MAX_TOPOLOGY_REFERENCES) {
            throw new Error(`TALA AssignNears topology references exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
          }
          secondNears.add(first);
          nearReferences++;
        }
      }
    }
  }

  guard.Finish();

  let complete = false;
  try {
    const commitOrder = Array.from(replacementNears.keys());
    sortNodesByID(commitOrder);
    for (const node of commitOrder) {
      node.Nears = replacementNears.get(node);
      guard.Finish();
    }
    complete = true;
  } finally {
    if (!complete) {
      for (const [node, original] of originalNears.entries()) {
        node.Nears = original;
      }
    }
  }
}

function groupVessel(node) {
  if (node == null) {
    return null;
  }
  if (node.Cluster != null) {
    return node.Cluster.Vessel;
  }
  if (node.Sequence != null) {
    return node.Sequence.Vessel;
  }
  return node;
}

function isDescendantOf(descendant, ancestor, guard) {
  for (;;) {
    guard.Step();
    if (descendant === ancestor) {
      return true;
    }
    if (descendant == null) {
      return false;
    }
    if (descendant.Container != null) {
      descendant = descendant.Container;
    } else if (descendant.Cluster != null) {
      descendant = descendant.Cluster.Vessel;
    } else if (descendant.Sequence != null) {
      descendant = descendant.Sequence.Vessel;
    } else {
      descendant = null;
    }
  }
}
