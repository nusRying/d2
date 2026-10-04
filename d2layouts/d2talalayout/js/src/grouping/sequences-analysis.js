import { Validate } from "../graph/topology-preflight.js";
import { WorkGuard } from "../limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS, INT64_MIN, INT64_MAX } from "../limits/constants.js";

/**
 * identifySequences discovers contiguous runs of connected Step nodes.
 *
 * Pinned reference: internal/grouping/sequences.go::identifySequences
 *
 * Mapping convention:
 * Go nil [][]*Node -> JS null (when <= 1 candidate step).
 * Callers should safely handle `sequences ?? []`.
 *
 * @param {import('../graph/graph.js').Graph} graph
 * @param {Array<import('../graph/node.js').Node> | null | undefined} nodes
 * @param {WorkGuard} guard
 * @returns {Array<Array<import('../graph/node.js').Node>> | null}
 */
export function identifySequences(graph, nodes, guard) {
  const activeNodes = new Set();
  if (Array.isArray(graph?.Nodes)) {
    for (const node of graph.Nodes) {
      guard.Step();
      activeNodes.add(node);
    }
  }

  const stepNodes = [];
  const candidateNodes = nodes ?? [];
  for (const node of candidateNodes) {
    guard.Step();
    if (!node || !activeNodes.has(node) || Boolean(node.isContainer)) {
      continue;
    }
    if (node.Sequence != null && !node.Sequence.isActive()) {
      continue;
    }
    if (node.FixedTopLeft != null || !node.isSequenceStep()) {
      continue;
    }
    stepNodes.push(node);
  }

  if (stepNodes.length <= 1) {
    return null;
  }

  const sequences = [];
  let steps = [stepNodes[0]];
  for (let i = 1; i < stepNodes.length; i++) {
    guard.Step();
    const previous = stepNodes[i - 1];
    const current = stepNodes[i];
    let connected = false;
    for (const edge of previous.Edges) {
      guard.Step();
      if (previous.Adjacent(edge) === current) {
        connected = true;
        break;
      }
    }
    if (connected) {
      steps.push(current);
    } else {
      if (steps.length > 1) {
        sequences.push(steps);
      }
      steps = [current];
    }
  }
  if (steps.length > 1) {
    sequences.push(steps);
  }
  return sequences.length > 0 ? sequences : null;
}

/**
 * SequenceDefiningEdges returns the IDs of edges consumed when step nodes are
 * replaced by sequence vessels.
 *
 * Pinned reference: internal/grouping/sequences.go::SequenceDefiningEdges
 *
 * @param {any} context
 * @param {import('../graph/graph.js').Graph} graph
 * @returns {Set<any>} Set of defining edge IDs
 */
export function SequenceDefiningEdges(context, graph) {
  Validate(context, "GetSequenceDefiningEdges", graph);
  const guard = new WorkGuard(context, "GetSequenceDefiningEdges", MAX_ENGINE_WORK_UNITS);

  const containerOrder = graph.ContainerRDFSOrder(null, guard);
  containerOrder.push(null);

  const sequenceEdges = new Set();
  for (const container of containerOrder) {
    guard.Step();
    const children = graph.Containers?.get(container);
    const sequences = identifySequences(graph, children, guard);
    if (sequences) {
      for (const steps of sequences) {
        for (let i = 1; i < steps.length; i++) {
          let connection = null;
          for (const edge of steps[i - 1].Edges) {
            guard.Step();
            if (
              (edge.From === steps[i - 1] && edge.To === steps[i]) ||
              (edge.To === steps[i - 1] && edge.From === steps[i])
            ) {
              connection = edge;
              break;
            }
          }
          if (connection === null) {
            const prevId = steps[i - 1].ID != null ? steps[i - 1].ID.toString() : "0";
            const currId = steps[i].ID != null ? steps[i].ID.toString() : "0";
            throw new Error(`TALA sequence steps ${prevId} and ${currId} have no defining edge`);
          }
          sequenceEdges.add(connection.ID);
        }
      }
    }
  }

  guard.Finish();
  return sequenceEdges;
}

/**
 * isValidRememberedSequence validates whether an inactive remembered sequence
 * remains structurally valid for reconstruction.
 *
 * Pinned reference: internal/grouping/sequences.go::isValidRememberedSequence
 *
 * @param {import('../graph/graph.js').Graph} graph
 * @param {import('../graph/node.js').Node} vessel
 * @param {import('../graph/sequence.js').Sequence} sequence
 * @param {Set<import('../graph/node.js').Node> | Map<import('../graph/node.js').Node, any>} activeNodes
 * @param {WorkGuard} guard
 * @returns {boolean}
 */
export function isValidRememberedSequence(graph, vessel, sequence, activeNodes, guard) {
  if (
    vessel == null ||
    sequence == null ||
    sequence.IsActive() ||
    sequence.Vessel !== vessel ||
    sequence.Graph !== graph ||
    !Array.isArray(sequence.Nodes) ||
    sequence.Nodes.length < 2
  ) {
    return false;
  }

  if (sequence.Container != null) {
    const isContainerActive = activeNodes?.has ? activeNodes.has(sequence.Container) : false;
    if (!isContainerActive) {
      return false;
    }
  }

  if (!graph.Containers || !graph.Containers.has(sequence.Container)) {
    return false;
  }

  const children = graph.Containers.get(sequence.Container);
  if (!Array.isArray(children)) {
    return false;
  }

  const childIndex = new Map();
  const duplicateChild = new Set();
  for (let i = 0; i < children.length; i++) {
    guard.Step();
    const child = children[i];
    if (childIndex.has(child)) {
      duplicateChild.add(child);
      continue;
    }
    childIndex.set(child, i);
  }

  const seen = new Set();
  let previousIndex = -1;
  for (const node of sequence.Nodes) {
    guard.Step();
    if (node == null) {
      return false;
    }
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);

    const isActive = activeNodes?.has ? activeNodes.has(node) : false;
    if (!isActive || node.Graph !== graph || !node.isSequenceStep() || node.FixedTopLeft != null) {
      return false;
    }
    if (node.Sequence !== sequence || node.Container !== sequence.Container) {
      return false;
    }
    if (!childIndex.has(node) || duplicateChild.has(node)) {
      return false;
    }
    const index = childIndex.get(node);
    if (previousIndex >= 0 && index !== previousIndex + 1) {
      return false;
    }
    previousIndex = index;
  }

  return true;
}

/**
 * hasNodeID checks if an ID is present in graph.Nodes, graph.Clusters,
 * graph.Sequences, or graph.Trees.
 *
 * Pinned reference: internal/grouping/sequences.go::hasNodeID
 *
 * @param {import('../graph/graph.js').Graph} graph
 * @param {number | bigint} id
 * @returns {boolean}
 */
export function hasNodeID(graph, id) {
  let targetID;
  if (typeof id === "bigint") {
    targetID = id;
  } else if (typeof id === "number") {
    if (!Number.isFinite(id) || !Number.isInteger(id) || !Number.isSafeInteger(id)) {
      return false;
    }
    targetID = BigInt(id);
  } else {
    try {
      targetID = BigInt(id);
    } catch {
      return false;
    }
  }

  if (targetID < INT64_MIN || targetID > INT64_MAX) {
    return false;
  }

  const hasID = (node) => {
    if (node == null || node.ID == null) return false;
    try {
      return BigInt(node.ID) === targetID;
    } catch {
      return false;
    }
  };

  if (Array.isArray(graph?.Nodes)) {
    for (const node of graph.Nodes) {
      if (hasID(node)) return true;
    }
  }

  if (graph?.Clusters) {
    for (const [vessel, cluster] of graph.Clusters) {
      if (hasID(vessel)) return true;
      if (cluster != null && Array.isArray(cluster.Nodes)) {
        for (const node of cluster.Nodes) {
          if (hasID(node)) return true;
        }
      }
    }
  }

  if (graph?.Sequences) {
    for (const [vessel, sequence] of graph.Sequences) {
      if (hasID(vessel)) return true;
      if (sequence != null && Array.isArray(sequence.Nodes)) {
        for (const node of sequence.Nodes) {
          if (hasID(node)) return true;
        }
      }
    }
  }

  if (graph?.Trees) {
    for (const [sentinel, roots] of graph.Trees) {
      if (hasID(sentinel)) return true;
      if (Array.isArray(roots)) {
        for (const root of roots) {
          if (!root) continue;
          const stack = [root];
          while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            if (hasID(current.Node)) return true;
            if (Array.isArray(current.Children)) {
              for (let i = current.Children.length - 1; i >= 0; i--) {
                const child = current.Children[i];
                if (child) {
                  stack.push(child);
                }
              }
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * nextAvailableNodeID finds the next free ID starting from candidate,
 * incrementing and wrapping at INT64_MAX to 0.
 *
 * Enforces signed int64 range [-9223372036854775808n, 9223372036854775807n]
 * and rejects unsafe Numbers or non-integers.
 *
 * Pinned reference: internal/grouping/sequences.go::nextAvailableNodeID
 *
 * @param {import('../graph/graph.js').Graph} graph
 * @param {number | bigint} candidate
 * @param {Set<number | bigint>} unavailable
 * @returns {bigint}
 */
export function nextAvailableNodeID(graph, candidate, unavailable) {
  let c;
  if (typeof candidate === "bigint") {
    c = candidate;
  } else if (typeof candidate === "number") {
    if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || !Number.isSafeInteger(candidate)) {
      throw new TypeError("nextAvailableNodeID candidate must be a safe integer or BigInt");
    }
    c = BigInt(candidate);
  } else {
    throw new TypeError("nextAvailableNodeID candidate must be a safe integer or BigInt");
  }

  if (c < INT64_MIN || c > INT64_MAX) {
    throw new TypeError("nextAvailableNodeID candidate must fit signed int64");
  }

  const isUnavailable = (idBigInt) => {
    if (!unavailable) return false;
    if (unavailable.has(idBigInt)) return true;
    if (
      idBigInt >= BigInt(Number.MIN_SAFE_INTEGER) &&
      idBigInt <= BigInt(Number.MAX_SAFE_INTEGER) &&
      unavailable.has(Number(idBigInt))
    ) {
      return true;
    }
    return false;
  };

  while (true) {
    if (!isUnavailable(c) && !hasNodeID(graph, c)) {
      return c;
    }
    if (c === INT64_MAX) {
      c = 0n;
    } else {
      c++;
    }
  }
}
