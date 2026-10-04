import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_TOPOLOGY_REFERENCES,
  MAX_ROUTE_POINTS,
  MAX_TOPOLOGY_DEPTH,
  MAX_ENGINE_WORK_UNITS,
  MAX_PREFLIGHT_WORK,
} from "../limits/constants.js";
import { WorkGuard } from "../limits/work-guard.js";

/**
 * Validates node parent relations (container parent, effective container parent, ancestry parent)
 * using an iterative state machine with cycle and depth bounds.
 *
 * @param {WorkGuard} guard
 * @param {Set<import('./node.js').Node>} nodes
 * @param {string} relation
 * @param {(node: import('./node.js').Node) => import('./node.js').Node | null} parentOf
 */
export function validateNodeParentRelation(guard, nodes, relation, parentOf) {
  const state = new Map(); // 0: unvisited, 1: visiting, 2: complete
  const depths = new Map();
  const path = [];

  for (const node of nodes) {
    if (state.get(node) === 2) {
      continue;
    }
    path.length = 0;
    let current = node;
    while (current != null && (state.get(current) || 0) === 0) {
      guard.Step();
      state.set(current, 1);
      path.push(current);
      current = parentOf(current);
    }
    if (current != null && state.get(current) === 1) {
      const idStr = current.ID != null ? current.ID.toString() : "0";
      throw new Error(`TALA engine ${relation} cycle detected at node ${idStr}`);
    }
    let depth = 0;
    if (current != null) {
      depth = depths.get(current) || 0;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      depth++;
      if (depth > MAX_TOPOLOGY_DEPTH) {
        throw new Error(`TALA engine ${relation} depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
      }
      depths.set(p, depth);
      state.set(p, 2);
    }
  }
}

/**
 * ancestryParent returns the immediate ancestor parent matching the precedence used by
 * isDescendantOf: Container -> Cluster.Vessel -> Sequence.Vessel -> null.
 *
 * Does not check active status, separating structural ancestry from layout activity.
 *
 * @param {import('./node.js').Node | null} node
 * @returns {import('./node.js').Node | null}
 */
export function ancestryParent(node) {
  if (node == null) {
    return null;
  }
  if (node.Container != null) {
    return node.Container;
  }
  if (node.Cluster != null) {
    return node.Cluster.Vessel || null;
  }
  if (node.Sequence != null) {
    return node.Sequence.Vessel || null;
  }
  return null;
}

/**
 * validateEngineGraph performs a bounded, iterative walk of every runtime topology
 * reference before layout code allocates snapshots or starts work.
 *
 * @param {any} context
 * @param {string} location
 * @param {import('./graph.js').Graph} graph
 */
export function validateEngineGraph(context, location, graph) {
  if (graph == null) {
    throw new Error("TALA engine requires a graph");
  }

  const guard = new WorkGuard(context, location, MAX_ENGINE_WORK_UNITS);
  guard.SetLimit(MAX_PREFLIGHT_WORK);

  let referenceCount = 0;
  let routePointCount = 0;

  function addReference(kind) {
    if (referenceCount >= MAX_TOPOLOGY_REFERENCES) {
      throw new Error(
        `TALA engine topology references exceed limit ${MAX_TOPOLOGY_REFERENCES} while visiting ${kind}`
      );
    }
    referenceCount++;
    guard.Step();
  }

  function accountSpareCapacity(kind, collection) {
    // In JavaScript, Arrays have length but no representable backing-array capacity.
    // Spare capacity is always 0, referenceCount is unchanged.
    // Preserves the cancellation check boundary matching Go.
    guard.Check();
  }

  function structuralNil(kind) {
    throw new Error(`TALA engine topology contains nil ${kind}`);
  }

  const nodes = new Set();
  const edges = new Set();
  const clusters = new Set();
  const sequences = new Set();
  const trees = new Set();
  const abductions = new Set();
  const herds = new Set();
  const hierarchies = new Set();

  const nodeQueue = [];
  const edgeQueue = [];
  const clusterQueue = [];
  const sequenceQueue = [];
  const treeQueue = [];
  const abductionQueue = [];
  const herdQueue = [];
  const hierarchyQueue = [];

  function queueNode(node, required, kind) {
    if (node == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (nodes.has(node)) {
      return;
    }
    if (nodes.size >= MAX_ENGINE_NODES) {
      throw new Error(`TALA engine unique node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    nodes.add(node);
    nodeQueue.push(node);
  }

  function queueEdge(edge, required, kind) {
    if (edge == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (edges.has(edge)) {
      return;
    }
    if (edges.size >= MAX_ENGINE_EDGES) {
      throw new Error(`TALA engine unique edge count exceeds limit ${MAX_ENGINE_EDGES}`);
    }
    edges.add(edge);
    edgeQueue.push(edge);
  }

  function queueCluster(cluster, required, kind) {
    if (cluster == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!clusters.has(cluster)) {
      clusters.add(cluster);
      clusterQueue.push(cluster);
    }
  }

  function queueSequence(sequence, required, kind) {
    if (sequence == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!sequences.has(sequence)) {
      sequences.add(sequence);
      sequenceQueue.push(sequence);
    }
  }

  function queueTree(tree, required, kind) {
    if (tree == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!trees.has(tree)) {
      trees.add(tree);
      treeQueue.push(tree);
    }
  }

  function queueAbduction(abduction, required, kind) {
    if (abduction == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!abductions.has(abduction)) {
      abductions.add(abduction);
      abductionQueue.push(abduction);
    }
  }

  function queueHerd(herd, required, kind) {
    if (herd == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!herds.has(herd)) {
      herds.add(herd);
      herdQueue.push(herd);
    }
  }

  function queueHierarchy(hierarchy, required, kind) {
    if (hierarchy == null) {
      if (required) {
        structuralNil(kind);
      }
      return;
    }
    addReference(kind);
    if (!hierarchies.has(hierarchy)) {
      hierarchies.add(hierarchy);
      hierarchyQueue.push(hierarchy);
    }
  }

  accountSpareCapacity("graph nodes", graph.Nodes);
  if (graph.Nodes != null) {
    for (let i = 0; i < graph.Nodes.length; i++) {
      const node = graph.Nodes[i];
      if (node == null) {
        throw new Error(`graph node at index ${i} is nil`);
      }
      queueNode(node, true, "graph node");
    }
  }

  accountSpareCapacity("graph edges", graph.Edges);
  if (graph.Edges != null) {
    for (let i = 0; i < graph.Edges.length; i++) {
      const edge = graph.Edges[i];
      if (edge == null) {
        throw new Error(`graph edge at index ${i} is nil`);
      }
      if (edge.From == null || edge.To == null) {
        const idStr = edge.ID != null ? edge.ID.toString() : "0";
        throw new Error(`graph edge ${idStr} has unplaced or missing endpoints`);
      }
      queueEdge(edge, true, "graph edge");
    }
  }

  if (graph.Containers != null) {
    for (const [container, children] of graph.Containers.entries()) {
      queueNode(container, false, "container key");
      accountSpareCapacity("container children", children);
      if (children != null) {
        for (const child of children) {
          queueNode(child, true, "container child");
        }
      }
    }
  }

  if (graph.Clusters != null) {
    for (const [vessel, cluster] of graph.Clusters.entries()) {
      queueNode(vessel, true, "cluster vessel key");
      queueCluster(cluster, true, "cluster record");
    }
  }

  if (graph.Sequences != null) {
    for (const [vessel, sequence] of graph.Sequences.entries()) {
      queueNode(vessel, true, "sequence vessel key");
      queueSequence(sequence, true, "sequence record");
    }
  }

  if (graph.Trees != null) {
    for (const [root, roots] of graph.Trees.entries()) {
      // Root-sentinel trees are intentionally keyed by nil/null.
      queueNode(root, false, "tree root key");
      accountSpareCapacity("tree roots", roots);
      if (roots != null) {
        for (const tree of roots) {
          queueTree(tree, true, "tree root");
        }
      }
    }
  }

  if (graph.NodeToTree != null) {
    for (const [node, tree] of graph.NodeToTree.entries()) {
      queueNode(node, true, "node-to-tree key");
      queueTree(tree, true, "node-to-tree value");
    }
  }

  if (graph.Hubs != null) {
    for (const [hub, spokes] of graph.Hubs.entries()) {
      queueNode(hub, true, "hub key");
      accountSpareCapacity("hub spokes", spokes);
      if (spokes != null) {
        for (const spoke of spokes) {
          queueNode(spoke, true, "hub spoke");
        }
      }
    }
  }

  if (graph.Directions != null) {
    for (const node of graph.Directions.keys()) {
      queueNode(node, false, "direction key");
    }
  }

  if (graph.CommonUncleSiblings != null) {
    for (const [node, siblings] of graph.CommonUncleSiblings.entries()) {
      queueNode(node, true, "common-sibling key");
      accountSpareCapacity("common siblings", siblings);
      if (siblings != null) {
        for (const sibling of siblings) {
          queueNode(sibling, true, "common sibling");
        }
      }
    }
  }

  let nodeIndex = 0;
  let edgeIndex = 0;
  let clusterIndex = 0;
  let sequenceIndex = 0;
  let treeIndex = 0;
  let abductionIndex = 0;
  let herdIndex = 0;
  let hierarchyIndex = 0;

  while (
    nodeIndex < nodeQueue.length ||
    edgeIndex < edgeQueue.length ||
    clusterIndex < clusterQueue.length ||
    sequenceIndex < sequenceQueue.length ||
    treeIndex < treeQueue.length ||
    abductionIndex < abductionQueue.length ||
    herdIndex < herdQueue.length ||
    hierarchyIndex < hierarchyQueue.length
  ) {
    if (nodeIndex < nodeQueue.length) {
      const node = nodeQueue[nodeIndex++];
      queueNode(node.Container, false, "node container");
      accountSpareCapacity("node edges", node.Edges);
      if (node.Edges != null) {
        for (const edge of node.Edges) {
          queueEdge(edge, true, "node edge");
        }
      }
      if (node.Nears != null) {
        const nears = node.Nears instanceof Map ? node.Nears.keys() : node.Nears;
        for (const near of nears) {
          queueNode(near, true, "near node");
        }
      }
      if (node.LongDistanceNeighborRequirements != null) {
        const neighbors =
          node.LongDistanceNeighborRequirements instanceof Map
            ? node.LongDistanceNeighborRequirements.keys()
            : node.LongDistanceNeighborRequirements;
        for (const neighbor of neighbors) {
          queueNode(neighbor, true, "long-distance neighbor requirement key");
        }
      }
      queueCluster(node.Cluster, false, "node cluster");
      queueSequence(node.Sequence, false, "node sequence");
      queueHerd(node.HerdAssignment, false, "node herd assignment");
      queueHierarchy(node.Hierarchy, false, "node hierarchy");
    } else if (edgeIndex < edgeQueue.length) {
      const edge = edgeQueue[edgeIndex++];
      queueNode(edge.From, true, "edge source");
      queueNode(edge.To, true, "edge target");
      const pointCount = edge.Points != null ? edge.Points.length : 0;
      if (pointCount > MAX_ROUTE_POINTS - routePointCount) {
        throw new Error(
          `TALA engine route point count exceeds limit ${MAX_ROUTE_POINTS}`
        );
      }
      routePointCount += pointCount;
      if (edge.Points != null) {
        for (const point of edge.Points) {
          if (point == null) {
            structuralNil("edge route point");
          }
          guard.Step();
        }
      }
    } else if (clusterIndex < clusterQueue.length) {
      const cluster = clusterQueue[clusterIndex++];
      queueNode(cluster.Vessel, true, "cluster vessel");
      queueNode(cluster.Container, false, "cluster container");
      accountSpareCapacity("cluster nodes", cluster.Nodes);
      if (cluster.Nodes != null) {
        for (const node of cluster.Nodes) {
          queueNode(node, true, "cluster node");
        }
      }
      accountSpareCapacity("cluster edge abductions", cluster.EdgeAbductions);
      if (cluster.EdgeAbductions != null) {
        for (const abduction of cluster.EdgeAbductions) {
          queueAbduction(abduction, true, "cluster edge abduction");
        }
      }
    } else if (sequenceIndex < sequenceQueue.length) {
      const sequence = sequenceQueue[sequenceIndex++];
      queueNode(sequence.Vessel, true, "sequence vessel");
      queueNode(sequence.Container, false, "sequence container");
      accountSpareCapacity("sequence nodes", sequence.Nodes);
      if (sequence.Nodes != null) {
        for (const node of sequence.Nodes) {
          queueNode(node, true, "sequence node");
        }
      }
      accountSpareCapacity("sequence edge abductions", sequence.EdgeAbductions);
      if (sequence.EdgeAbductions != null) {
        for (const abduction of sequence.EdgeAbductions) {
          queueAbduction(abduction, true, "sequence edge abduction");
        }
      }
    } else if (treeIndex < treeQueue.length) {
      const tree = treeQueue[treeIndex++];
      queueNode(tree.Node, true, "tree node");
      queueTree(tree.Parent, false, "tree parent");
      queueEdge(tree.SentinelEdge, false, "tree sentinel edge");
      accountSpareCapacity("tree children", tree.Children);
      if (tree.Children != null) {
        for (const child of tree.Children) {
          queueTree(child, true, "tree child");
        }
      }
    } else if (abductionIndex < abductionQueue.length) {
      const abduction = abductionQueue[abductionIndex++];
      queueEdge(abduction.Edge, true, "abducted edge");
      queueNode(abduction.OriginallyFrom, false, "abduction original source");
      queueNode(abduction.OriginallyTo, false, "abduction original target");
      queueNode(abduction.CurrentFrom, false, "abduction current source");
      queueNode(abduction.CurrentTo, false, "abduction current target");
    } else if (herdIndex < herdQueue.length) {
      const herd = herdQueue[herdIndex++];
      if (herd.oppositeSidePaired != null) {
        const entries =
          herd.oppositeSidePaired instanceof Map
            ? herd.oppositeSidePaired.keys()
            : herd.oppositeSidePaired;
        for (const node of entries) {
          queueNode(node, true, "opposite-side herd node");
        }
      }
      if (herd.sameSidePaired != null) {
        const entries =
          herd.sameSidePaired instanceof Map
            ? herd.sameSidePaired.keys()
            : herd.sameSidePaired;
        for (const node of entries) {
          queueNode(node, true, "same-side herd node");
        }
      }
    } else if (hierarchyIndex < hierarchyQueue.length) {
      const hierarchy = hierarchyQueue[hierarchyIndex++];
      const rawLevels = hierarchy.levels != null ? hierarchy.levels : hierarchy.level;
      if (rawLevels != null) {
        const levelNodes = rawLevels instanceof Map ? rawLevels.keys() : rawLevels;
        for (const node of levelNodes) {
          queueNode(node, true, "hierarchy level node");
        }
      }
    }
  }

  // Validate parent chains independently of declared container map
  validateNodeParentRelation(guard, nodes, "container parent", (node) => node.Container);

  // Active clusters and sequences override Node.Container in effective container
  validateNodeParentRelation(guard, nodes, "effective container parent", (node) => {
    return typeof node.container === "function" ? node.container() : node.OwningContainer();
  });

  // Ancestry parent validation
  validateNodeParentRelation(guard, nodes, "ancestry parent", ancestryParent);

  // Descendant graph validation (union of containers, active cluster, and active sequence)
  function descendantChildren(node) {
    const children = [];
    if (node == null || node.isContainer) {
      const containerChildren = graph.Containers ? graph.Containers.get(node) : null;
      if (containerChildren != null) {
        for (const child of containerChildren) {
          children.push(child);
        }
      }
    }
    if (node != null && node.isClusterVessel) {
      const cluster = graph.Clusters ? graph.Clusters.get(node) : null;
      if (cluster == null) {
        const idStr = node.ID != null ? node.ID.toString() : "0";
        throw new Error(`TALA engine cluster vessel ${idStr} has no cluster record`);
      }
      if (cluster.Nodes != null) {
        for (const child of cluster.Nodes) {
          children.push(child);
        }
      }
    }
    if (graph.Sequences != null && graph.Sequences.has(node)) {
      const sequence = graph.Sequences.get(node);
      if (sequence == null) {
        structuralNil("sequence record");
      }
      if (sequence.Nodes != null) {
        for (const child of sequence.Nodes) {
          children.push(child);
        }
      }
    }
    return children;
  }

  const descendantColor = new Map();
  const descendantHeight = new Map();
  const descendantStarts = [];
  if (graph.Containers != null && graph.Containers.has(null)) {
    descendantStarts.push(null);
  }
  for (const node of nodes) {
    if (node != null) {
      descendantStarts.push(node);
    }
  }

  for (const start of descendantStarts) {
    if ((descendantColor.get(start) || 0) !== 0) {
      continue;
    }
    const startChildren = descendantChildren(start);
    descendantColor.set(start, 1);
    const stack = [{ node: start, children: startChildren, index: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.children.length) {
        const ownHeight = frame.node === null ? 0 : 1;
        let height = ownHeight;
        for (const child of frame.children) {
          const childHeight = ownHeight + (descendantHeight.get(child) || 0);
          if (childHeight > height) {
            height = childHeight;
          }
        }
        if (height > MAX_TOPOLOGY_DEPTH) {
          throw new Error(`TALA engine descendant depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
        }
        descendantHeight.set(frame.node, height);
        descendantColor.set(frame.node, 2);
        stack.pop();
        continue;
      }

      const child = frame.children[frame.index];
      frame.index++;
      guard.Step();

      const color = descendantColor.get(child) || 0;
      switch (color) {
        case 1: {
          const idStr = child && child.ID != null ? child.ID.toString() : "0";
          throw new Error(`TALA engine descendant cycle detected at node ${idStr}`);
        }
        case 0: {
          const childChildren = descendantChildren(child);
          descendantColor.set(child, 1);
          stack.push({ node: child, children: childChildren, index: 0 });
          break;
        }
      }
    }
  }

  // Tree child cycle / depth validation
  const treeColor = new Map();
  const treeHeight = new Map();
  for (const start of trees) {
    if ((treeColor.get(start) || 0) !== 0) {
      continue;
    }
    treeColor.set(start, 1);
    const stack = [{ tree: start, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = frame.tree.Children || [];
      if (frame.index >= children.length) {
        let height = 1;
        for (const child of children) {
          const childHeight = (treeHeight.get(child) || 0) + 1;
          if (childHeight > height) {
            height = childHeight;
          }
        }
        if (height > MAX_TOPOLOGY_DEPTH) {
          throw new Error(`TALA engine tree depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
        }
        treeHeight.set(frame.tree, height);
        treeColor.set(frame.tree, 2);
        stack.pop();
        continue;
      }
      const child = children[frame.index];
      frame.index++;
      guard.Step();
      const color = treeColor.get(child) || 0;
      switch (color) {
        case 1:
          throw new Error("TALA engine tree child cycle detected");
        case 0:
          treeColor.set(child, 1);
          stack.push({ tree: child, index: 0 });
          break;
      }
    }
  }

  // Tree parent cycle / depth validation
  const parentState = new Map();
  const parentDepth = new Map();
  for (const start of trees) {
    if (parentState.get(start) === 2) {
      continue;
    }
    const path = [];
    let current = start;
    while (current != null && (parentState.get(current) || 0) === 0) {
      guard.Step();
      parentState.set(current, 1);
      path.push(current);
      current = current.Parent;
    }
    if (current != null && parentState.get(current) === 1) {
      throw new Error("TALA engine tree parent cycle detected");
    }
    let depth = 0;
    if (current != null) {
      depth = parentDepth.get(current) || 0;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      depth++;
      if (depth > MAX_TOPOLOGY_DEPTH) {
        throw new Error(`TALA engine tree depth exceeds limit ${MAX_TOPOLOGY_DEPTH}`);
      }
      parentDepth.set(p, depth);
      parentState.set(p, 2);
    }
  }

  // Tree ownership forest validation
  const ownedTrees = new Map();
  const treeByNode = new Map();
  if (graph.Trees != null) {
    for (const roots of graph.Trees.values()) {
      if (roots == null) continue;
      for (const root of roots) {
        const stack = [{ tree: root, parent: null }];
        while (stack.length > 0) {
          const frame = stack.pop();
          guard.Step();
          if (ownedTrees.has(frame.tree)) {
            const owner = ownedTrees.get(frame.tree);
            if (frame.parent == null) {
              throw new Error("TALA engine tree is listed as more than one root");
            }
            if (owner === frame.parent) {
              throw new Error("TALA engine tree is repeated under one parent");
            }
            throw new Error("TALA engine tree is shared by multiple parents");
          }
          ownedTrees.set(frame.tree, frame.parent);
          if (treeByNode.has(frame.tree.Node)) {
            const existing = treeByNode.get(frame.tree.Node);
            if (existing !== frame.tree) {
              const idStr =
                frame.tree.Node && frame.tree.Node.ID != null
                  ? frame.tree.Node.ID.toString()
                  : "0";
              throw new Error(`TALA engine node ${idStr} is owned by multiple trees`);
            }
          }
          treeByNode.set(frame.tree.Node, frame.tree);

          const children = frame.tree.Children || [];
          for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child.Parent !== frame.tree) {
              throw new Error("TALA engine tree child has an inconsistent parent");
            }
            stack.push({ tree: child, parent: frame.tree });
          }
        }
      }
    }
  }

  // Placement-only wrapper parent check
  if (graph.Trees != null) {
    for (const roots of graph.Trees.values()) {
      if (roots == null) continue;
      for (const root of roots) {
        if (root.Parent == null) {
          continue;
        }
        if (ownedTrees.has(root.Parent)) {
          throw new Error("TALA engine tree root also has an installed parent");
        }
        let occurrences = 0;
        const parentChildren = root.Parent.Children || [];
        for (const child of parentChildren) {
          guard.Step();
          if (child === root) {
            occurrences++;
          }
        }
        if (occurrences !== 1) {
          throw new Error("TALA engine tree root has an inconsistent placement parent");
        }
      }
    }
  }

  // NodeToTree inverse checks
  if (graph.NodeToTree != null) {
    for (const [node, tree] of graph.NodeToTree.entries()) {
      if (tree.Node !== node) {
        throw new Error("TALA engine node-to-tree alias does not match the tree node");
      }
      if (ownedTrees.size > 0) {
        if (!ownedTrees.has(tree)) {
          throw new Error(
            "TALA engine node-to-tree alias references a tree outside the installed forest"
          );
        }
      }
    }

    if (graph.NodeToTree.size > 0 && ownedTrees.size > 0) {
      if (graph.NodeToTree.size !== treeByNode.size) {
        throw new Error("TALA engine node-to-tree aliases do not cover the installed forest");
      }
      for (const [node, tree] of treeByNode.entries()) {
        if (graph.NodeToTree.get(node) !== tree) {
          throw new Error("TALA engine node-to-tree aliases do not match the installed forest");
        }
      }
    }
  }

  guard.Finish();
}

/**
 * validateGraph is an alias for validateEngineGraph.
 */
export function validateGraph(context, operation, graph) {
  return validateEngineGraph(context, operation, graph);
}

/**
 * Validate validates the engine topology of graph before pipeline stages execute.
 * Throws an Error on validation failure, returns normally on success.
 *
 * Pinned reference: layoutgraph.Validate (hierarchy_access.go)
 *
 * @param {any} context
 * @param {string} operation
 * @param {import('./graph.js').Graph} graph
 */
export function Validate(context, operation, graph) {
  return validateEngineGraph(context, operation, graph);
}
