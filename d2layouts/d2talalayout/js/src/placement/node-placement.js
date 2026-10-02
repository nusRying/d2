import { WorkCanceledError } from "../limits/work-guard.js";

/**
 * checkPlaceChildrenOrderCancellation checks context cancellation using direct
 * ctx.Err() semantics.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/node_placement.go
 *
 * @param {any} context
 */
function checkPlaceChildrenOrderCancellation(context) {
  const isCancelled =
    typeof context.isCancelled === "function"
      ? context.isCancelled()
      : Boolean(context.aborted);

  if (isCancelled) {
    throw new WorkCanceledError("PlaceChildrenOrder");
  }
}

/**
 * placeChildrenOrder determines deterministic child layout ordering.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/node_placement.go
 *
 * @param {any} context
 * @param {Array<import("../graph/node.js").Node>} [nodes]
 * @param {Array<import("../graph/edge-abduction.js").EdgeAbduction>} [edgeAbductions]
 * @returns {Array<import("../graph/node.js").Node>}
 */
export function placeChildrenOrder(context, nodes, edgeAbductions) {
  checkPlaceChildrenOrderCancellation(context);

  const sourceNodes = nodes ?? [];
  const abductions = edgeAbductions ?? [];

  const expected = new Set();
  const connected = new Map();

  for (const node of sourceNodes) {
    checkPlaceChildrenOrderCancellation(context);

    if (node == null) {
      throw new Error(
        "layout invariant violated: container has a nil child"
      );
    }

    if (expected.has(node)) {
      throw new Error(
        `layout invariant violated: container has duplicate child ${node.DebugID()}`
      );
    }

    expected.add(node);
    connected.set(node, new Set());
  }

  for (const edgeAbduction of abductions) {
    checkPlaceChildrenOrderCancellation(context);

    if (edgeAbduction == null) {
      throw new Error(
        "layout invariant violated: child ordering has a nil edge abduction"
      );
    }

    const from = edgeAbduction.CurrentFrom;
    const to = edgeAbduction.CurrentTo;

    if (expected.has(from) && expected.has(to)) {
      connected.get(from).add(to);
    }

    if (expected.has(to) && expected.has(from)) {
      connected.get(to).add(from);
    }
  }

  const ordered = [];
  const orderedSet = new Set();

  const appendNode = (node) => {
    ordered.push(node);
    orderedSet.add(node);
    connected.delete(node);
  };

  for (const node of sourceNodes) {
    checkPlaceChildrenOrderCancellation(context);

    if (connected.get(node).size === 0) {
      appendNode(node);
    }
  }

  while (ordered.length < sourceNodes.length) {
    checkPlaceChildrenOrderCancellation(context);

    let leastDegree = sourceNodes.length + 1;
    let start = null;

    for (const node of sourceNodes) {
      if (!connected.has(node)) {
        continue;
      }

      const adjacent = connected.get(node);
      if (adjacent.size < leastDegree) {
        leastDegree = adjacent.size;
        start = node;
      }
    }

    if (start == null) {
      throw new Error(
        "layout invariant violated: could not order all container children"
      );
    }

    const visited = new Set();
    const queue = [start];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      checkPlaceChildrenOrderCancellation(context);

      const current = queue[queueIndex++];

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      if (orderedSet.has(current)) {
        continue;
      }

      appendNode(current);

      for (const edgeAbduction of abductions) {
        let adjacent = null;

        if (edgeAbduction.CurrentFrom === current) {
          adjacent = edgeAbduction.CurrentTo;
        } else if (edgeAbduction.CurrentTo === current) {
          adjacent = edgeAbduction.CurrentFrom;
        }

        if (expected.has(adjacent)) {
          queue.push(adjacent);
        }
      }
    }
  }

  checkPlaceChildrenOrderCancellation(context);

  return ordered;
}

export const PlaceChildrenOrder = placeChildrenOrder;
