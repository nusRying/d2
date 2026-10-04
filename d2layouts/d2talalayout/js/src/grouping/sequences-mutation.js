import { Node } from "../graph/node.js";
import { Sequence } from "../graph/sequence.js";
import { EdgeAbduction } from "../graph/edge-abduction.js";
import { STEP_WEDGE_WIDTH } from "../shape/constants.js";
import { Validate } from "../graph/topology-preflight.js";
import { WorkGuard } from "../limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS } from "../limits/constants.js";
import { newGraphStateSnapshot, restoreGraphState } from "../graph/graph-state.js";
import {
  identifySequences,
  isValidRememberedSequence,
  nextAvailableNodeID,
} from "./sequences-analysis.js";

/**
 * clearRememberedSequenceMembership clears node.Sequence links on sequence steps
 * that still point to the specified inactive remembered sequence.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/sequences.go
 */
export function clearRememberedSequenceMembership(sequence, guard) {
  if (sequence == null) {
    return;
  }
  if (!sequence.Nodes) {
    return;
  }
  for (const node of sequence.Nodes) {
    guard.Step();
    if (node != null && node.Sequence === sequence) {
      node.Sequence = null;
    }
  }
}

/**
 * buildSequence constructs a Sequence object, normalizes step dimensions,
 * removes defining edges between consecutive steps, abducts external edges,
 * and calculates the vessel geometry.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/sequences.go
 */
export function buildSequence(steps, graph, container, id) {
  let maxHeight = 0.0;
  for (const node of steps) {
    if (node.Width <= STEP_WEDGE_WIDTH) {
      node.Width = 2 * STEP_WEDGE_WIDTH;
    }
    maxHeight = Math.max(maxHeight, node.Height);
  }
  for (const node of steps) {
    node.Height = maxHeight;
  }
  for (let i = 1; i < steps.length; i++) {
    const edge = steps[i - 1].connectionTo(steps[i]);
    if (edge != null) {
      graph.disconnect(edge);
    }
  }

  const vesselID = typeof id === "bigint" ? id : BigInt(id);
  const vessel = new Node(vesselID, 0, 0);
  const sequence = new Sequence({
    Vessel: vessel,
    Nodes: steps,
    Graph: graph,
    Container: container,
  });

  sequence.syncGeometry();
  abductSequenceEdges(sequence);
  sequence.placeVessel();

  return sequence;
}

/**
 * abductSequenceEdges reconnects external edges targeting sequence members
 * to the sequence vessel and records EdgeAbduction entries.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/sequences.go
 */
export function abductSequenceEdges(sequence) {
  const isStep = new Set();
  if (sequence.Nodes) {
    for (const node of sequence.Nodes) {
      isStep.add(node);
    }
  }

  const abductions = [];
  if (sequence.Graph && sequence.Graph.Edges) {
    for (const edge of sequence.Graph.Edges) {
      const fromIsStep = isStep.has(edge.From);
      const toIsStep = isStep.has(edge.To);
      if (fromIsStep && toIsStep) {
        continue;
      }
      if (fromIsStep) {
        abductions.push(new EdgeAbduction({
          Edge: edge,
          OriginallyFrom: edge.From,
          CurrentFrom: sequence.Vessel,
          CurrentTo: edge.To,
        }));
        edge.reconnect(sequence.Vessel, false);
      }
      if (toIsStep) {
        abductions.push(new EdgeAbduction({
          Edge: edge,
          OriginallyTo: edge.To,
          CurrentTo: sequence.Vessel,
          CurrentFrom: edge.From,
        }));
        edge.reconnect(sequence.Vessel, true);
      }
    }
  }

  sequence.EdgeAbductions = abductions;
}

/**
 * addSequence installs a constructed sequence into graph topology.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/sequences.go
 */
export function addSequence(graph, sequence) {
  graph.addNewNodeToContainer(sequence.Container, sequence.Vessel);
  for (const node of sequence.Nodes) {
    node.Sequence = sequence;
  }

  const updatedContainerNodes = [];
  const containerNodes = graph.Containers.get(sequence.Container);
  if (containerNodes) {
    for (const child of containerNodes) {
      if (child.Sequence !== sequence) {
        updatedContainerNodes.push(child);
      }
    }
  }
  graph.Containers.set(sequence.Container, updatedContainerNodes);

  for (const node of sequence.Nodes) {
    graph.removeNode(node);
    node.Container = null;
  }

  graph.Sequences.set(sequence.Vessel, sequence);
}

/**
 * addSequences replaces each discovered step run with a temporary sequence vessel.
 * Execution is transactional: if failure or cancellation occurs after snapshot capture,
 * the entire graph state is rolled back.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/grouping/sequences.go
 */
export function addSequences(context, graph, random) {
  Validate(context, "AddSequences", graph);

  const guard = new WorkGuard(
    context,
    "AddSequences",
    MAX_ENGINE_WORK_UNITS
  );

  const state = newGraphStateSnapshot({
    CaptureTopology: true,
    CaptureEdgeRoutes: true,
  });

  state.updateWithWorkGuard(graph, guard);

  let complete = false;
  try {
    const remembered = new Map();
    const rememberedIDByFirstStep = new Map();
    const reservedNodeIDs = new Set();
    const activeNodes = new Set();

    for (const node of graph.Nodes) {
      guard.Step();
      activeNodes.add(node);
      reservedNodeIDs.add(BigInt(node.ID));
    }

    if (graph.Clusters) {
      for (const [vessel, cluster] of graph.Clusters.entries()) {
        guard.Step();
        if (vessel != null) {
          reservedNodeIDs.add(BigInt(vessel.ID));
        }
        if (cluster != null && cluster.Nodes) {
          for (const node of cluster.Nodes) {
            guard.Step();
            if (node != null) {
              reservedNodeIDs.add(BigInt(node.ID));
            }
          }
        }
      }
    }

    if (graph.Sequences) {
      for (const [vessel, sequence] of graph.Sequences.entries()) {
        guard.Step();
        if (vessel != null) {
          reservedNodeIDs.add(BigInt(vessel.ID));
        }
        if (sequence != null && sequence.Nodes) {
          for (const node of sequence.Nodes) {
            guard.Step();
            if (node != null) {
              reservedNodeIDs.add(BigInt(node.ID));
            }
          }
        }
      }
    }

    const vesselsInOrder = graph.sequenceOrder();
    for (const vessel of vesselsInOrder) {
      guard.Step();
      const sequence = graph.Sequences.get(vessel);
      const valid = isValidRememberedSequence(graph, vessel, sequence, activeNodes, guard);
      if (valid) {
        let containerList = remembered.get(sequence.Container);
        if (!containerList) {
          containerList = [];
          remembered.set(sequence.Container, containerList);
        }
        containerList.push(sequence.Nodes);
        rememberedIDByFirstStep.set(sequence.Nodes[0], BigInt(vessel.ID));
      } else {
        clearRememberedSequenceMembership(sequence, guard);
      }
    }

    // Replace the Map with a fresh Map matching Go map[*layoutgraph.Node]*layoutgraph.Sequence{}
    graph.Sequences = new Map();

    const containerOrder = graph.ContainerRDFSOrder(null, guard);
    const allContainers = [];
    for (const c of containerOrder) {
      allContainers.push(c);
    }
    allContainers.push(null);

    for (const container of allContainers) {
      guard.Step();
      const containerChildren = graph.Containers.get(container) || [];
      const freshGroups = identifySequences(graph, containerChildren, guard);
      const groups = [];
      if (freshGroups) {
        for (const g of freshGroups) {
          groups.push(g);
        }
      }
      const rememberedGroups = remembered.get(container);
      if (rememberedGroups) {
        for (const g of rememberedGroups) {
          groups.push(g);
        }
      }

      const containerIndex = new Map();
      for (let i = 0; i < containerChildren.length; i++) {
        guard.Step();
        containerIndex.set(containerChildren[i], i);
      }

      groups.sort((a, b) => {
        const idxA = containerIndex.get(a[0]) ?? 0;
        const idxB = containerIndex.get(b[0]) ?? 0;
        if (idxA < idxB) return -1;
        if (idxA > idxB) return 1;
        return 0;
      });

      const generatedIDs = new Array(groups.length);
      const slotByID = new Map();
      for (let i = 0; i < groups.length; i++) {
        guard.Step();
        const draw = typeof random.Int63 === "function" ? random.Int63() : random.int63();
        const idVal = BigInt(draw);
        generatedIDs[i] = idVal;
        slotByID.set(idVal, i);
      }

      const orderedGroups = new Array(groups.length);
      const usedGroups = new Array(groups.length).fill(false);
      for (let i = 0; i < groups.length; i++) {
        guard.Step();
        const steps = groups[i];
        if (rememberedIDByFirstStep.has(steps[0])) {
          const rememberedID = rememberedIDByFirstStep.get(steps[0]);
          if (slotByID.has(rememberedID)) {
            const slot = slotByID.get(rememberedID);
            if (orderedGroups[slot] === undefined) {
              orderedGroups[slot] = steps;
              usedGroups[i] = true;
            }
          }
        }
      }

      let nextGroup = 0;
      for (let i = 0; i < orderedGroups.length; i++) {
        guard.Step();
        if (orderedGroups[i] !== undefined) {
          continue;
        }
        while (nextGroup < groups.length && usedGroups[nextGroup]) {
          guard.Step();
          nextGroup++;
        }
        orderedGroups[i] = groups[nextGroup];
        usedGroups[nextGroup] = true;
      }

      for (let i = 0; i < orderedGroups.length; i++) {
        guard.Step();
        const steps = orderedGroups[i];
        let id = generatedIDs[i];
        if (rememberedIDByFirstStep.has(steps[0])) {
          id = rememberedIDByFirstStep.get(steps[0]);
        } else {
          id = nextAvailableNodeID(graph, id, reservedNodeIDs);
          reservedNodeIDs.add(id);
        }
        addSequence(graph, buildSequence(steps, graph, container, id));
      }
    }

    guard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      restoreGraphState(graph, state);
    }
  }
}

export const AddSequences = addSequences;
