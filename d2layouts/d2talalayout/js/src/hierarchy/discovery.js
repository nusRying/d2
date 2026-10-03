// Pinned reference: internal/hierarchy/discovery.go
//
// Go map iteration notes (JS uses Map/Set insertion order):
// - Hierarchy.Levels() iteration in Assign, isValid, is1N1 and
//   minimumWorkflowExtentFits only feeds order-independent results (set
//   deletion, maxima, membership and boolean classification).
// - findCycleEdges ranges over node/edge sets. Its resulting cycle-edge set is
//   order independent (sink/source pruning reaches a unique closure, and the
//   max-diff selection is a total order on (diff, edge count, ID)), but the
//   number of FindCycleEdges work steps, and therefore its stride-64
//   cancellation polls, depends on Go's randomized order. JS uses insertion
//   order; parity scenarios keep that guard below one polling stride.

import { Validate } from '../graph/topology-preflight.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { newGraphStateSnapshot } from '../graph/graph-state.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_WORK_UNITS, MAX_GRAPH_SIZE } from '../limits/constants.js';
import { newGraph } from '../graph/graph.js';
import { Node } from '../graph/node.js';
import { NO_ARROWHEAD } from '../graph/edge.js';
import { newHierarchy } from '../graph/hierarchy.js';
import {
  SplitOptions,
  NodeGraphOwnershipJournal,
  abductEdges,
  copyEntitiesFrom,
  hierarchyRankWeight,
  replaceEdgesUnchecked,
  restoreEdgeAbductions,
  setGraphReference,
  setHierarchyRankWeight,
  splitSubgraphsTracked,
} from '../graph/structural-access.js';
import { rankDAG } from './rank.js';
import { isHorizontal } from './orientation.js';
import {
  countHierarchyStructuralEdges,
  isHierarchyStructuralEdge,
  isSink,
  isSource,
} from './structural.js';
import {
  CROSSING_SPACING,
  MAX_AUTOMATIC_WORKFLOW_EDGES,
  MAX_AUTOMATIC_WORKFLOW_NODES,
  MIN_HIERARCHY_LEVELS,
  MIN_PORT_CLEARANCE,
} from './constants.js';

export { isHierarchyStructuralEdge, countHierarchyStructuralEdges };

const TRIANGLE_ARROWHEAD = 'triangle';

function containerChildren(g, root) {
  return g.Containers.get(root ?? null) ?? [];
}

function levelOf(levels, node) {
  return levels.get(node) ?? 0;
}

/**
 * Assign identifies hierarchical structures within the subgraphs of g and
 * atomically replaces the derived membership of every node g owns.
 */
export function assign(ctx, g, root, hierarchicalNodes) {
  Validate(ctx, 'AssignNodeHierarchy', g);
  const [txCtx, guard] = ensureTransactionWorkGuard(ctx, 'AssignNodeHierarchyTransactions');
  const state = newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, guard);
  let complete = false;
  try {
    const owned = state.ownedNodes(g, guard);
    const seenHierarchies = new Set();
    for (const node of owned) {
      guard.Step();
      if (node.Hierarchy != null) {
        seenHierarchies.add(node.Hierarchy);
      }
    }
    for (const hierarchy of seenHierarchies) {
      const levels = hierarchy.Levels();
      for (const node of levels.keys()) {
        guard.Step();
        if (owned.has(node)) {
          levels.delete(node);
        }
      }
    }
    for (const node of owned) {
      guard.Step();
      node.Hierarchy = null;
    }
    assignContainer(txCtx, g, root ?? null, hierarchicalNodes);
    guard.Finish();
    complete = true;
  } finally {
    if (!complete) {
      state.rollback(g);
    }
  }
}

export const Assign = assign;

/**
 * RemoveIsolatedMemberships removes leaf nodes that inherited a container's
 * hierarchy but have no edges of their own.
 */
export function removeIsolatedMemberships(g) {
  for (const node of g.Nodes) {
    if (node.Hierarchy != null && node.Edges.length === 0 && !node.IsContainer()) {
      node.Hierarchy.Levels().delete(node);
      node.Hierarchy = null;
    }
  }
}

export const RemoveIsolatedMemberships = removeIsolatedMemberships;

// Go `assign`: recursive over container depth, which Validate bounds.
export function assignContainer(ctx, g, root, hierarchicalNodes) {
  let force;
  if (root == null) {
    force = g.IsRootHierarchy;
  } else {
    force = root.ForceHierarchy;
  }

  const hierarchyGraph = newGraph();
  copyEntitiesFrom(hierarchyGraph, g);
  for (const node of containerChildren(g, root)) {
    hierarchyGraph.AddNodeUnchecked(node);
  }
  const edgeAbductions = abductEdges(g, root, hierarchyGraph);
  let edgesRestored = false;
  let splitOwnership = new NodeGraphOwnershipJournal();
  try {
    for (const child of containerChildren(g, root)) {
      // if this container can't be in a hierarchy, it may have one inside it
      if (!hierarchicalNodes.has(child) && child.IsContainer()) {
        assignContainer(ctx, g, child, hierarchicalNodes);
      }
    }

    // does not consider Nears when splitting the subgraph
    let subgraphs;
    [subgraphs, splitOwnership] = splitSubgraphsTracked(ctx, hierarchyGraph, new SplitOptions(), null);
    for (const subgraph of subgraphs) {
      const hierarchy = build(ctx, subgraph, force, hierarchicalNodes, edgeAbductions);
      if (hierarchy == null) {
        continue;
      }
      const levels = hierarchy.Levels();
      for (const node of subgraph.Nodes) {
        node.Hierarchy = hierarchy;
        for (const descendant of g.allDescendantNodes(node, false)) {
          levels.set(descendant, levelOf(levels, node));
          descendant.Hierarchy = hierarchy;
        }
      }
    }
    restoreEdgeAbductions(g, edgeAbductions);
    edgesRestored = true;

    // remove Nears of nodes in hierarchies
    if (root == null) {
      for (const node of g.Nodes) {
        const nears = node.Nears;
        node.Nears = new Set();
        if (node.Hierarchy == null) {
          for (const near of nears) {
            if (near.Hierarchy == null) {
              node.addNear(near);
            }
          }
        }
      }
    }
  } finally {
    if (!edgesRestored) {
      restoreEdgeAbductions(g, edgeAbductions);
    }
    // Edge reachability can include nodes outside hierarchyGraph.Nodes. Restore
    // those exact owners before retaining the assignment stage's existing owner
    // state for nodes in g.
    splitOwnership.Restore();
    setGraphReference(g.Nodes, g);
  }
}

/**
 * build assigns a hierarchy level to each node in g given that all nodes can
 * be in a hierarchy. Returns null when g is not a hierarchy.
 */
export function build(ctx, g, force, hierarchicalNodes, edgeAbductions) {
  if (g.Nodes.length <= 1) {
    return null;
  }
  let sourceCount = 0;
  let sinkCount = 0;
  let allNodesAreTable = true;
  for (const node of g.Nodes) {
    if (!hierarchicalNodes.has(node)) {
      return null;
    }
    allNodesAreTable = allNodesAreTable && node.isTable();

    // `if/else if` to ensure source and sink are different nodes
    if (isSource(node)) {
      sourceCount++;
    } else if (isSink(node)) {
      sinkCount++;
    }
  }

  if (!force && (allNodesAreTable || sourceCount === 0 || sinkCount === 0)) {
    return null;
  }

  const hierarchy = newHierarchy();
  const dag = makeSimpleDAG(ctx, g);
  const ranks = rankDAG(ctx, dag);
  hierarchy.ReplaceLevels(mapDAGToGraphLevels(g, ranks.nodeToLevel));
  hierarchy.LevelCount = ranks.levelCount;
  if (force || isValid(hierarchy, g, edgeAbductions, sourceCount, sinkCount)) {
    return hierarchy;
  }
  return null;
}

/**
 * isValid prefers compact hierarchies with a dominant edge direction. Fully
 * directed branched workflows retain their reading order even when they are
 * too tall for the usual compactness heuristic.
 */
export function isValid(h, g, edgeAbductions, sourceCount, sinkCount) {
  if (h.LevelCount < MIN_HIERARCHY_LEVELS) {
    return false;
  }
  const unique = new Set();
  for (const node of h.Levels().keys()) {
    unique.add(node);
    for (const descendant of g.allDescendantNodes(node, false)) {
      unique.add(descendant);
    }
  }
  const aspectRatio = unique.size / (h.LevelCount * h.LevelCount);
  const tooTall = aspectRatio < 0.5;
  const tooWide = aspectRatio > 2.0;

  const [forwardEdges, backOrNeutralEdges] = countEdgeDirection(h, g);
  const edgesFlowInOneDirection = forwardEdges >= 1.5 * backOrNeutralEdges;
  const allEdgesForward = backOrNeutralEdges === 0;
  let branchedWorkflow = g.Nodes.length > h.LevelCount && sourceCount === 1 && sinkCount === 1 && allEdgesForward &&
    unique.size <= MAX_AUTOMATIC_WORKFLOW_NODES && forwardEdges + backOrNeutralEdges <= MAX_AUTOMATIC_WORKFLOW_EDGES;
  if (tooTall && branchedWorkflow && !minimumWorkflowExtentFits(h, g)) {
    branchedWorkflow = false;
  }

  // we want to avoid nodes with many edges, as they would create a lot of noisy routes
  const nEdgesAbductions = new Map();
  for (const ea of edgeAbductions ?? []) {
    if (!isHierarchyStructuralEdge(ea.Edge)) {
      continue;
    }
    if (ea.OriginallyFrom != null) {
      nEdgesAbductions.set(ea.CurrentFrom, (nEdgesAbductions.get(ea.CurrentFrom) ?? 0) + 1);
    }
    if (ea.OriginallyTo != null) {
      nEdgesAbductions.set(ea.CurrentTo, (nEdgesAbductions.get(ea.CurrentTo) ?? 0) + 1);
    }
  }
  const maxEdges = Math.trunc(2 * Math.ceil(Math.sqrt(unique.size)));
  let hasDenselyConnectedNode = false;
  for (const node of unique) {
    const edgeCount = countHierarchyStructuralEdges(node) - (nEdgesAbductions.get(node) ?? 0);
    if (edgeCount > maxEdges) {
      hasDenselyConnectedNode = true;
      break;
    }
  }

  return !tooWide && (!tooTall || branchedWorkflow) && edgesFlowInOneDirection && !hasDenselyConnectedNode && !is1N1(h, edgeAbductions);
}

/**
 * minimumWorkflowExtentFits screens current rank dimensions with the minimum
 * placement gaps for the bounded workflow exception.
 */
export function minimumWorkflowExtentFits(h, g) {
  const horizontal = isHorizontal(g.Nodes);
  const levelSize = new Array(h.LevelCount).fill(0);
  for (const [node, level] of h.Levels()) {
    let size = node.Height;
    if (horizontal) {
      size = node.Width;
    }
    levelSize[level] = Math.max(levelSize[level], size);
  }
  let extent = (h.LevelCount - 1) * (CROSSING_SPACING + 2 * MIN_PORT_CLEARANCE);
  for (const size of levelSize) {
    extent += Math.ceil(size);
  }
  return extent <= MAX_GRAPH_SIZE;
}

/** countEdgeDirection → [forward, backOrNeutral]. */
export function countEdgeDirection(h, g) {
  let forward = 0;
  let structural = 0;
  const levels = h.Levels();
  for (const e of g.Edges) {
    if (!isHierarchyStructuralEdge(e)) {
      continue;
    }
    structural++;
    if (!e.isDirected()) {
      continue;
    }
    const [from, to] = e.directedEndpoints();
    if (levelOf(levels, to) > levelOf(levels, from)) {
      forward += 1;
    }
  }
  return [forward, structural - forward];
}

/** is1N1 identifies one source, N parallel middle nodes, one sink. */
export function is1N1(h, edgeAbductions) {
  if (h.LevelCount !== 3) {
    return false;
  }
  const levels = h.Levels();
  const nodesByLevel = new Map();
  for (const [node, level] of levels) {
    let list = nodesByLevel.get(level);
    if (list == null) {
      list = [];
      nodesByLevel.set(level, list);
    }
    list.push(node);
  }
  const level0 = nodesByLevel.get(0) ?? [];
  const level1 = nodesByLevel.get(1) ?? [];
  const level2 = nodesByLevel.get(2) ?? [];
  if (level0.length !== 1 || level2.length !== 1) {
    return false;
  }

  let sourceEdgeAbduction = null;
  let sinkEdgeAbduction = null;
  for (const ea of edgeAbductions ?? []) {
    if (!isHierarchyStructuralEdge(ea.Edge)) {
      continue;
    }
    if (ea.CurrentFrom === level0[0]) {
      if (sourceEdgeAbduction != null) {
        if (ea.OriginallyFrom !== sourceEdgeAbduction.OriginallyFrom) {
          return false;
        }
      } else {
        sourceEdgeAbduction = ea;
      }
    }
    if (ea.CurrentTo === level0[0]) {
      if (sourceEdgeAbduction != null) {
        if (ea.OriginallyTo !== sourceEdgeAbduction.OriginallyTo) {
          return false;
        }
      } else {
        sourceEdgeAbduction = ea;
      }
    }

    if (ea.CurrentFrom === level2[0]) {
      if (sinkEdgeAbduction != null) {
        if (ea.OriginallyFrom !== sinkEdgeAbduction.OriginallyFrom) {
          return false;
        }
      } else {
        sinkEdgeAbduction = ea;
      }
    }
    if (ea.CurrentTo === level2[0]) {
      if (sinkEdgeAbduction != null) {
        if (ea.OriginallyTo !== sinkEdgeAbduction.OriginallyTo) {
          return false;
        }
      } else {
        sinkEdgeAbduction = ea;
      }
    }
  }

  // all nodes on level 2 must be connected at least once above and once below
  for (const node of level1) {
    let hasEdgeAbove = false;
    let hasEdgeBelow = false;
    for (const e of node.Edges) {
      if (!isHierarchyStructuralEdge(e)) {
        continue;
      }
      const adj = node.adjacent(e);
      const level = levelOf(levels, adj);
      if (level === 0) {
        hasEdgeAbove = true;
      } else if (level === 2) {
        hasEdgeBelow = true;
      } else {
        return false;
      }
      if (hasEdgeAbove && hasEdgeBelow) {
        break;
      }
    }
    if (!hasEdgeAbove || !hasEdgeBelow) {
      return false;
    }
  }

  // the source (level=0) can't be connected to the sink (level=2)
  const source = level0[0];
  for (const e of source.Edges) {
    if (!isHierarchyStructuralEdge(e)) {
      continue;
    }
    const adj = source.adjacent(e);
    if (levelOf(levels, adj) !== 1) {
      return false;
    }
  }
  return true;
}

/**
 * makeSimpleDAG transforms the input into a DAG and removes duplicate edges.
 */
export function makeSimpleDAG(ctx, g) {
  const guard = new WorkGuard(ctx, 'MakeSimpleDAG', MAX_ENGINE_WORK_UNITS);
  const dag = newGraph();
  const connect = (from, to, rankWeight) => {
    const e = dag.Connect(from, to);
    e.SourceArrowhead = NO_ARROWHEAD;
    e.TargetArrowhead = TRIANGLE_ARROWHEAD;
    e.ID = BigInt(dag.Edges.length);
    setHierarchyRankWeight(e, rankWeight);
  };

  const idToNode = new Map();
  for (const n of g.Nodes) {
    guard.Step();
    const newN = dag.AddNodeUnchecked(new Node(n.ID, n.Width, n.Height));
    newN.D2ID = n.D2ID;
    idToNode.set(BigInt(n.ID), newN);
  }

  for (const e of g.Edges) {
    guard.Step();
    if (!isHierarchyStructuralEdge(e)) {
      continue;
    }
    if (e.isDirected()) {
      const [from, to] = e.directedEndpoints();
      connect(idToNode.get(BigInt(from.ID)), idToNode.get(BigInt(to.ID)), 1);
    } else {
      // An undirected or bidirectional edge expands to opposing arcs carrying
      // one authored unit of rank weight between them.
      connect(idToNode.get(BigInt(e.From.ID)), idToNode.get(BigInt(e.To.ID)), 1);
      connect(idToNode.get(BigInt(e.To.ID)), idToNode.get(BigInt(e.From.ID)), 0);
    }
  }

  const cycleEdges = findCycleEdges(ctx, dag);
  reverseEdges(ctx, cycleEdges);
  removeDuplicateEdges(ctx, dag);
  // Preserve preparation's work charge and cancellation checkpoints after
  // simplifying the graph.
  for (let i = 0; i < dag.Nodes.length; i++) {
    guard.Step();
  }
  guard.Finish();
  return dag;
}

function sizeOf(map, key) {
  const set = map.get(key);
  return set == null ? 0 : set.size;
}

/**
 * findCycleEdges implements Eades' feedback-arc-set heuristic and returns the
 * set of edges to reverse (Set in g.Edges order).
 */
export function findCycleEdges(ctx, g) {
  const guard = new WorkGuard(ctx, 'FindCycleEdges', MAX_ENGINE_WORK_UNITS);
  const incomingEdges = new Map();
  const outgoingEdges = new Map();
  const addEdgeToSet = (e, n, set) => {
    const nodeEdges = set.get(n);
    if (nodeEdges != null) {
      nodeEdges.add(e);
    } else {
      set.set(n, new Set([e]));
    }
  };

  const nodes = new Set();
  const edges = new Set();
  for (const e of g.Edges) {
    guard.Step();
    edges.add(e);
    nodes.add(e.From);
    nodes.add(e.To);
    if (e.isTargetedTo(e.From)) {
      addEdgeToSet(e, e.From, incomingEdges);
      addEdgeToSet(e, e.To, outgoingEdges);
    } else {
      addEdgeToSet(e, e.From, outgoingEdges);
      addEdgeToSet(e, e.To, incomingEdges);
    }
  }

  const nonCycleEdges = new Set();
  const pruneNode = (n) => {
    for (const e of incomingEdges.get(n) ?? []) {
      guard.Step();
      nonCycleEdges.add(e);
      const adj = n.adjacent(e);
      const adjEdges = outgoingEdges.get(adj);
      if (adjEdges != null) adjEdges.delete(e);
      if (sizeOf(outgoingEdges, adj) === 0 && sizeOf(incomingEdges, adj) === 0) {
        nodes.delete(adj);
        outgoingEdges.delete(adj);
        incomingEdges.delete(adj);
      }
    }
    for (const e of outgoingEdges.get(n) ?? []) {
      guard.Step();
      nonCycleEdges.add(e);
      const adj = n.adjacent(e);
      const adjEdges = incomingEdges.get(adj);
      if (adjEdges != null) adjEdges.delete(e);
      if (sizeOf(incomingEdges, adj) === 0 && sizeOf(outgoingEdges, adj) === 0) {
        nodes.delete(adj);
        outgoingEdges.delete(adj);
        incomingEdges.delete(adj);
      }
    }
    nodes.delete(n);
    incomingEdges.delete(n);
    outgoingEdges.delete(n);
  };

  while (nodes.size > 0) {
    guard.Step();
    for (;;) {
      // as we delete sinks we might be creating new sinks
      let foundSink = false;
      for (const n of nodes) {
        guard.Step();
        if (sizeOf(outgoingEdges, n) === 0) {
          foundSink = true;
          pruneNode(n);
        }
      }
      if (!foundSink) {
        break;
      }
    }

    for (;;) {
      let foundSource = false;
      for (const n of nodes) {
        guard.Step();
        if (sizeOf(incomingEdges, n) === 0) {
          foundSource = true;
          pruneNode(n);
        }
      }
      if (!foundSource) {
        break;
      }
    }

    if (nodes.size > 0) {
      let maxNode = null;
      let maxDiff = -Infinity;
      for (const node of nodes) {
        guard.Step();
        const diff = sizeOf(outgoingEdges, node) - sizeOf(incomingEdges, node);
        if (diff > maxDiff) {
          maxDiff = diff;
          maxNode = node;
        } else if (diff === maxDiff) {
          // prefer the node with more edges
          const nEdges = sizeOf(outgoingEdges, node) + sizeOf(incomingEdges, node);
          const nMaxEdges = sizeOf(outgoingEdges, maxNode) + sizeOf(incomingEdges, maxNode);
          if (nEdges > nMaxEdges) {
            maxDiff = diff;
            maxNode = node;
          } else if (sizeOf(incomingEdges, node) === sizeOf(incomingEdges, maxNode) && BigInt(node.ID) < BigInt(maxNode.ID)) {
            // if edge count is the same, prefer the smaller ID
            maxDiff = diff;
            maxNode = node;
          }
        }
      }
      const maxIncoming = incomingEdges.get(maxNode);
      for (const e of maxIncoming ?? []) {
        guard.Step();
        maxIncoming.delete(e);
        const adjOutgoing = outgoingEdges.get(maxNode.adjacent(e));
        if (adjOutgoing != null) adjOutgoing.delete(e);
      }
      pruneNode(maxNode);
    }
  }

  for (const e of nonCycleEdges) {
    guard.Step();
    edges.delete(e);
  }

  guard.Finish();
  return edges;
}

/**
 * reverseEdges exchanges from, to = to, from. Arrowheads don't change because
 * `a -> b` should become `b -> a`, not `b <- a`.
 */
export function reverseEdges(ctx, edges) {
  const guard = new WorkGuard(ctx, 'ReverseEdges', MAX_ENGINE_WORK_UNITS);
  for (let i = 0; i < edges.size; i++) {
    guard.Step();
  }
  guard.Finish();
  for (const e of edges) {
    const from = e.From;
    e.From = e.To;
    e.To = from;
  }
}

/**
 * removeDuplicateEdges combines multiple instances of the same edge
 * (from -> to), summing their hierarchy rank weights. Assumes directed edges.
 */
export function removeDuplicateEdges(ctx, g) {
  const guard = new WorkGuard(ctx, 'RemoveDuplicateEdges', MAX_ENGINE_WORK_UNITS);
  const edges = new Map();
  const uniqueEdges = [];
  const rankWeights = new Map();
  for (const e of g.Edges) {
    guard.Step();
    const fromEdges = edges.get(e.From);
    if (fromEdges != null) {
      const retained = fromEdges.get(e.To);
      if (retained != null) {
        rankWeights.set(retained, rankWeights.get(retained) + hierarchyRankWeight(e));
      } else {
        fromEdges.set(e.To, e);
        uniqueEdges.push(e);
        rankWeights.set(e, hierarchyRankWeight(e));
      }
    } else {
      edges.set(e.From, new Map([[e.To, e]]));
      uniqueEdges.push(e);
      rankWeights.set(e, hierarchyRankWeight(e));
    }
  }

  guard.Finish();
  for (const e of uniqueEdges) {
    setHierarchyRankWeight(e, rankWeights.get(e));
  }
  replaceEdgesUnchecked(g, uniqueEdges);
}

export function mapDAGToGraphLevels(g, dagNodeToLevel) {
  const idToNode = new Map();
  for (const n of g.Nodes) {
    idToNode.set(BigInt(n.ID), n);
  }
  const nodeToLevel = new Map();
  for (const [dagN, level] of dagNodeToLevel) {
    nodeToLevel.set(idToNode.get(BigInt(dagN.ID)) ?? null, level);
  }
  return nodeToLevel;
}
