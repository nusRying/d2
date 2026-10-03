import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_TOPOLOGY_REFERENCES,
} from "../limits/constants.js";
import {
  OptimizationResourceLimitError,
  MAX_UINT64,
} from "../limits/optimization.js";
import { sortNodesByID } from "../graph/node.js";
import { snapshotPointer, restoreNodePositions } from "./types.js";

/**
 * optimizerIsDescendantOf performs an iterative walk to verify ancestry.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerIsDescendantOf
 */
export function optimizerIsDescendantOf(descendant, ancestor, guard) {
  const seen = new Set();
  let current = descendant;
  while (true) {
    guard.Step();
    if (current === ancestor) {
      return true;
    }
    if (current == null) {
      return ancestor == null;
    }
    if (seen.has(current)) {
      throw new Error(
        `TALA ${guard.Location()} found a cycle in node ancestry at ${current.DebugID ? current.DebugID() : current.debugID()}`
      );
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${guard.Location()} ancestry exceeds node limit ${MAX_ENGINE_NODES}`
      );
    }
    seen.add(current);
    if (current.Container != null) {
      current = current.Container;
    } else if (current.Cluster != null && current.Cluster.Vessel != null) {
      current = current.Cluster.Vessel;
    } else if (current.Sequence != null && current.Sequence.Vessel != null) {
      current = current.Sequence.Vessel;
    } else {
      current = null;
    }
  }
}

/**
 * optimizerTreeRoot walks up the tree hierarchy to find the root.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerTreeRoot
 */
export function optimizerTreeRoot(tree, guard) {
  const seen = new Set();
  while (tree != null && tree.Parent != null) {
    guard.Step();
    if (seen.has(tree)) {
      throw new Error(`TALA ${guard.Location()} found a cycle in tree ancestry`);
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${guard.Location()} tree ancestry exceeds node limit ${MAX_ENGINE_NODES}`
      );
    }
    seen.add(tree);
    tree = tree.Parent;
  }
  return tree;
}

/**
 * optimizerFixedOrigin looks up the first fixed-origin node in container.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerFixedOrigin
 */
export function optimizerFixedOrigin(g, container, guard) {
  if (g == null) {
    throw new Error(`TALA ${guard.Location()} fixed-origin lookup requires a graph`);
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(
      `TALA ${guard.Location()} fixed-origin node count exceeds limit ${MAX_ENGINE_NODES}`
    );
  }
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null) {
      continue;
    }
    const owning = typeof node.OwningContainer === "function" ? node.OwningContainer() : node.owningContainer();
    if (owning !== container) {
      continue;
    }
    const origin = typeof node.FixedOrigin === "function" ? node.FixedOrigin() : node.fixedOrigin();
    if (origin != null) {
      return origin;
    }
  }
  return null;
}

/**
 * optimizerOrderedNears validates and sorts node.Nears by ID.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerOrderedNears
 */
export function optimizerOrderedNears(node, guard) {
  if (node == null) {
    throw new Error(`TALA ${guard.Location()} cannot order nears for a nil node`);
  }
  if (node.Nears.size > MAX_ENGINE_NODES) {
    throw new Error(`TALA ${guard.Location()} near count exceeds limit ${MAX_ENGINE_NODES}`);
  }
  const nears = [];
  for (const near of node.Nears) {
    guard.Step();
    if (near == null) {
      throw new Error(
        `TALA ${guard.Location()} found a nil near on ${node.DebugID ? node.DebugID() : node.debugID()}`
      );
    }
    nears.push(near);
  }
  guard.AddSort(nears.length);
  sortNodesByID(nears);
  return nears;
}

/**
 * appendBoundedOptimizerNodes bounds node references.
 *
 * Pinned reference: internal/placement/optimization_guard.go appendBoundedOptimizerNodes
 */
export function appendBoundedOptimizerNodes(dst, src, guard) {
  if (BigInt(dst.length) > BigInt(MAX_TOPOLOGY_REFERENCES) - BigInt(src.length)) {
    throw new Error(
      `TALA ${guard.Location()} optimizer node references exceed limit ${MAX_TOPOLOGY_REFERENCES}`
    );
  }
  return dst.concat(src);
}

/**
 * appendOptimizerTreeNears collects nears from a tree.
 *
 * Pinned reference: internal/placement/optimization_guard.go appendOptimizerTreeNears
 */
export function appendOptimizerTreeNears(nears, tree, guard) {
  if (tree == null) {
    return nears;
  }
  const stack = [tree];
  const seen = new Set([tree]);
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    if (current == null) {
      throw new Error(`TALA ${guard.Location()} found a nil tree node`);
    }
    if (current.Node == null) {
      throw new Error(`TALA ${guard.Location()} found a tree entry without a node`);
    }
    const ordered = optimizerOrderedNears(current.Node, guard);
    nears = appendBoundedOptimizerNodes(nears, ordered, guard);
    if (current.Children) {
      if (current.Children.length > MAX_ENGINE_NODES) {
        throw new Error(
          `TALA ${guard.Location()} tree child references exceed limit ${MAX_ENGINE_NODES}`
        );
      }
      for (let i = current.Children.length - 1; i >= 0; i--) {
        guard.Step();
        const child = current.Children[i];
        if (child == null) {
          throw new Error(`TALA ${guard.Location()} found a nil tree child`);
        }
        if (seen.has(child)) {
          throw new Error(`TALA ${guard.Location()} found a cycle or shared child in a tree`);
        }
        if (seen.size >= MAX_ENGINE_NODES) {
          throw new Error(`TALA ${guard.Location()} tree exceeds node limit ${MAX_ENGINE_NODES}`);
        }
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return nears;
}

/**
 * optimizerAdjacents finds placement neighbors using strict optimizer precedence.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerAdjacents
 */
export function optimizerAdjacents(node, edgeAbductions, guard) {
  if (node == null || node.Graph == null) {
    throw new Error(`TALA ${guard.Location()} adjacency lookup requires a node with a graph`);
  }
  const abductionsLen = edgeAbductions ? edgeAbductions.length : 0;
  if (node.Edges.length > MAX_ENGINE_EDGES || abductionsLen > MAX_ENGINE_EDGES) {
    throw new Error(`TALA ${guard.Location()} adjacency inputs exceed edge limit ${MAX_ENGINE_EDGES}`);
  }
  const adjacents = [];
  const usedEdgeAbductions = new Array(abductionsLen).fill(false);

  for (const edge of node.Edges) {
    guard.Step();
    if (edge == null || (edge.From !== node && edge.To !== node)) {
      throw new Error(
        `TALA ${guard.Location()} found a malformed incident edge on ${node.DebugID ? node.DebugID() : node.debugID()}`
      );
    }
    const adjacentNode = node.Adjacent(edge);
    if (adjacentNode == null || adjacentNode.TopLeft == null) {
      continue;
    }
    let addNode = adjacentNode;
    if (edgeAbductions) {
      for (let i = 0; i < edgeAbductions.length; i++) {
        guard.Step();
        const edgeAbduction = edgeAbductions[i];
        if (edgeAbduction == null) {
          throw new Error(`TALA ${guard.Location()} found a nil edge abduction`);
        }
        if (usedEdgeAbductions[i]) {
          continue;
        }
        if (
          edgeAbduction.CurrentFrom === node &&
          edgeAbduction.CurrentTo === adjacentNode &&
          edgeAbduction.OriginallyTo != null
        ) {
          usedEdgeAbductions[i] = true;
          addNode = edgeAbduction.OriginallyTo;
          break;
        }
        if (
          edgeAbduction.CurrentFrom === adjacentNode &&
          edgeAbduction.CurrentTo === node &&
          edgeAbduction.OriginallyFrom != null
        ) {
          usedEdgeAbductions[i] = true;
          addNode = edgeAbduction.OriginallyFrom;
          break;
        }
      }
    }
    adjacents.push(addNode);
  }
  if (adjacents.length !== 0) {
    return adjacents;
  }

  const orderedNears = optimizerOrderedNears(node, guard);
  for (let near of orderedNears) {
    if (
      near.Cluster &&
      (typeof near.Cluster.IsActive === "function"
        ? near.Cluster.IsActive()
        : near.Cluster.isActive())
    ) {
      near = near.Cluster.Vessel;
    } else if (
      near.Sequence &&
      (typeof near.Sequence.IsActive === "function"
        ? near.Sequence.IsActive()
        : near.Sequence.isActive())
    ) {
      near = near.Sequence.Vessel;
    }
    if (node.Graph.NodeToTree && node.Graph.NodeToTree.has(near)) {
      const tree = node.Graph.NodeToTree.get(near);
      const root = optimizerTreeRoot(tree, guard);
      if (root == null || root.SentinelNode() == null) {
        throw new Error(`TALA ${guard.Location()} found a tree without a sentinel`);
      }
      near = root.SentinelNode();
    }
    if (near == null || near.TopLeft == null) {
      continue;
    }
    const isDescendant = optimizerIsDescendantOf(near, node.Container, guard);
    if (isDescendant) {
      adjacents.push(near);
    }
  }
  if (adjacents.length !== 0) {
    return adjacents;
  }

  let nears = [];
  if (node.IsClusterVessel && node.IsClusterVessel()) {
    const cluster = node.Graph.Clusters.get(node);
    if (cluster == null) {
      throw new Error(`TALA ${guard.Location()} found a cluster vessel without a cluster`);
    }
    for (const clusterNode of cluster.Nodes) {
      guard.Step();
      const ordered = optimizerOrderedNears(clusterNode, guard);
      nears = appendBoundedOptimizerNodes(nears, ordered, guard);
    }
  }
  if (node.Graph.Sequences && node.Graph.Sequences.has(node)) {
    const sequence = node.Graph.Sequences.get(node);
    if (sequence != null && sequence.Nodes) {
      for (const sequenceNode of sequence.Nodes) {
        guard.Step();
        const ordered = optimizerOrderedNears(sequenceNode, guard);
        nears = appendBoundedOptimizerNodes(nears, ordered, guard);
      }
    }
  }
  const trees = node.Graph.Trees ? node.Graph.Trees.get(node) || [] : [];
  if (trees.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA ${guard.Location()} tree roots exceed node limit ${MAX_ENGINE_NODES}`);
  }
  for (const tree of trees) {
    nears = appendOptimizerTreeNears(nears, tree, guard);
  }
  for (const near of nears) {
    guard.Step();
    let addNode = near;
    if (
      near.Cluster &&
      (typeof near.Cluster.IsActive === "function"
        ? near.Cluster.IsActive()
        : near.Cluster.isActive())
    ) {
      addNode = near.Cluster.Vessel;
    } else if (
      near.Sequence &&
      (typeof near.Sequence.IsActive === "function"
        ? near.Sequence.IsActive()
        : near.Sequence.isActive())
    ) {
      addNode = near.Sequence.Vessel;
    }
    if (node.Graph.NodeToTree && node.Graph.NodeToTree.has(addNode)) {
      const tree = node.Graph.NodeToTree.get(addNode);
      const root = optimizerTreeRoot(tree, guard);
      if (root == null || root.SentinelNode() == null) {
        throw new Error(`TALA ${guard.Location()} found a tree without a sentinel`);
      }
      addNode = root.SentinelNode();
    }
    if (addNode != null && addNode.TopLeft != null) {
      adjacents.push(addNode);
    }
  }
  return adjacents;
}

/**
 * optimizerMedian computes the coordinate median of node positions under work limits.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerMedian
 */
export function optimizerMedian(nodes, includeSizes, guard) {
  if (nodes.length === 0) {
    throw new Error(
      `TALA ${guard.Location()} cannot compute a median without positioned neighbors`
    );
  }
  if (BigInt(nodes.length) > BigInt(MAX_TOPOLOGY_REFERENCES)) {
    throw new Error(
      `TALA ${guard.Location()} median inputs exceed limit ${MAX_TOPOLOGY_REFERENCES}`
    );
  }
  if (nodes.length === 1) {
    const node = nodes[0];
    guard.Step();
    if (node == null || node.TopLeft == null) {
      throw new Error(
        `TALA ${guard.Location()} cannot compute a median with an unpositioned neighbor`
      );
    }
    guard.AddSort(1);
    guard.AddSort(1);
    if (includeSizes) {
      const cellSize = node.Graph.CellSize;
      if (cellSize <= 0 || !Number.isFinite(cellSize)) {
        throw new Error(`TALA ${guard.Location()} requires a finite positive cell size`);
      }
      return [
        (node.TopLeft.X + node.Width / 2) / cellSize,
        (node.TopLeft.Y + node.Height / 2) / cellSize,
      ];
    }
    return [node.TopLeft.X + 0.5, node.TopLeft.Y + 0.5];
  }

  const orderedByX = new Array(nodes.length);
  const orderedByY = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    guard.Step();
    const node = nodes[i];
    if (node == null || node.TopLeft == null) {
      throw new Error(
        `TALA ${guard.Location()} cannot compute a median with an unpositioned neighbor`
      );
    }
    orderedByX[i] = node;
    orderedByY[i] = node;
  }
  guard.AddSort(nodes.length);
  orderedByX.sort((iNode, jNode) => {
    let iX = iNode.TopLeft.X;
    let jX = jNode.TopLeft.X;
    if (includeSizes) {
      iX += iNode.Width / 2;
      jX += jNode.Width / 2;
    }
    if (iX === jX) {
      return iNode.ID < jNode.ID ? -1 : iNode.ID > jNode.ID ? 1 : 0;
    }
    return iX < jX ? -1 : 1;
  });

  guard.AddSort(nodes.length);
  orderedByY.sort((iNode, jNode) => {
    let iY = iNode.TopLeft.Y;
    let jY = jNode.TopLeft.Y;
    if (includeSizes) {
      iY += iNode.Height / 2;
      jY += jNode.Height / 2;
    }
    if (iY === jY) {
      return iNode.ID < jNode.ID ? -1 : iNode.ID > jNode.ID ? 1 : 0;
    }
    return iY < jY ? -1 : 1;
  });

  const middle = Math.floor(nodes.length / 2);
  let medianX, medianY;
  if (includeSizes) {
    medianX = orderedByX[middle].TopLeft.X + orderedByX[middle].Width / 2;
    medianY = orderedByY[middle].TopLeft.Y + orderedByY[middle].Height / 2;
    if (nodes.length % 2 === 0) {
      medianX =
        (medianX +
          orderedByX[middle - 1].TopLeft.X +
          orderedByX[middle - 1].Width / 2) /
        2;
      medianY =
        (medianY +
          orderedByY[middle - 1].TopLeft.Y +
          orderedByY[middle - 1].Height / 2) /
        2;
    }
    const cellSize = nodes[0].Graph.CellSize;
    if (cellSize <= 0 || !Number.isFinite(cellSize)) {
      throw new Error(`TALA ${guard.Location()} requires a finite positive cell size`);
    }
    medianX /= cellSize;
    medianY /= cellSize;
  } else {
    medianX = orderedByX[middle].TopLeft.X + 0.5;
    medianY = orderedByY[middle].TopLeft.Y + 0.5;
    if (nodes.length % 2 === 0) {
      medianX = (medianX + orderedByX[middle - 1].TopLeft.X) / 2;
      medianY = (medianY + orderedByY[middle - 1].TopLeft.Y) / 2;
    }
  }
  return [medianX, medianY];
}

/**
 * optimizerMedianToNeighbors calculates median coordinates to incident placement neighbors.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerMedianToNeighbors
 */
export function optimizerMedianToNeighbors(node, includeSizes, edgeAbductions, guard) {
  const adjacents = optimizerAdjacents(node, edgeAbductions, guard);
  return optimizerMedian(adjacents, includeSizes, guard);
}

/**
 * chargeOptimizerScoring charges the work units for candidate edge length evaluation.
 *
 * Pinned reference: internal/placement/optimization_guard.go chargeOptimizerScoring
 */
export function chargeOptimizerScoring(node, edgeAbductions, includeSymmetry, guard) {
  if (node == null || node.Graph == null) {
    throw new Error(`TALA ${guard.Location()} scoring requires a node with a graph`);
  }
  const edges = BigInt(node.Edges.length + 1);
  let searchSpace = BigInt(
    node.Graph.Nodes.length + (edgeAbductions ? edgeAbductions.length : 0) + 1
  );
  if (includeSymmetry) {
    if (MAX_UINT64 - searchSpace < edges) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: ${guard.Location()} scoring work arithmetic overflow`
      );
    }
    searchSpace += edges;
  }
  return guard.AddProduct(edges, searchSpace);
}

/**
 * Pinned Go: internal/placement/optimization_guard.go maxOptimizerPlacementCandidates
 */
export const MAX_OPTIMIZER_PLACEMENT_CANDIDATES = 1_000_000;

/**
 * chargeOptimizerTranspose bounds transpose's independent reachability,
 * rotation, and scoring work under the optimizer's single operation budget.
 * Cheap eligibility checks avoid charging the worst case when transpose will
 * return immediately.
 *
 * Pinned reference: internal/placement/optimization_guard.go chargeOptimizerTranspose
 */
export function chargeOptimizerTranspose(g, node, edgeAbductions, guard) {
  if (g == null || node == null || node.Graph == null) {
    throw new Error(`TALA ${guard.Location()} transpose requires a node with a graph`);
  }
  const abductionCount = edgeAbductions == null ? 0 : edgeAbductions.length;
  if (g.Nodes.length > MAX_ENGINE_NODES || g.Edges.length > MAX_ENGINE_EDGES || abductionCount > MAX_ENGINE_EDGES) {
    throw new Error(`TALA ${guard.Location()} transpose inputs exceed engine limits`);
  }
  for (const abduction of edgeAbductions ?? []) {
    guard.Step();
    if (abduction == null) {
      throw new Error(`TALA ${guard.Location()} found a nil edge abduction`);
    }
  }
  if (node.Hierarchy != null || node.FixedTopLeft != null || node.Edges.length < 1 || node.Edges.length > 2) {
    return guard.Step();
  }
  if (g.NodeToTree.has(node) || g.isTreeSentinel(node)) {
    return guard.Step();
  }

  const nodes = BigInt(g.Nodes.length + 1);
  const edges = BigInt(g.Edges.length + 1);
  const abductions = BigInt(abductionCount + 1);
  // Reachability is performed several times while selecting a rotation side.
  for (let i = 0; i < 6; i++) {
    guard.Add(nodes + edges + abductions);
  }
  // At most four trial rotations and one committed rotation are scored.
  for (let i = 0; i < 5; i++) {
    if (edgeAbductions == null) {
      guard.AddProduct(nodes, edges);
      guard.AddProduct(edges, edges);
    } else {
      guard.AddProduct(BigInt(node.Edges.length + 1), nodes + abductions);
    }
  }
  // Rotating containers can translate descendants for each trial.
  for (let i = 0; i < 4; i++) {
    guard.AddProduct(nodes, nodes);
  }
}

/**
 * optimizerDoesOverlap checks a sized candidate against positioned graph nodes.
 * Pinned Go: internal/placement/optimization_guard.go optimizerDoesOverlap
 */
export function optimizerDoesOverlap(node, point, exceptions, guard) {
  if (node == null || node.Graph == null || point == null) {
    throw new Error(`TALA ${guard.Location()} overlap check requires a node, graph, and point`);
  }
  const except = exceptions ?? [];
  if (node.Graph.Nodes.length > MAX_ENGINE_NODES || except.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA ${guard.Location()} overlap inputs exceed node limit ${MAX_ENGINE_NODES}`);
  }
  const right = point.X + node.Width;
  const bottom = point.Y + node.Height;
  for (const otherNode of node.Graph.Nodes) {
    guard.Step();
    if (otherNode == null) {
      throw new Error(`TALA ${guard.Location()} found a nil graph node`);
    }
    if (otherNode === node) continue;
    let excluded = false;
    for (const exception of except) {
      guard.Step();
      if (exception === otherNode) {
        excluded = true;
        break;
      }
    }
    if (excluded || otherNode.TopLeft == null) continue;

    const maxSafeDelta = 500;
    if (
      point.X > otherNode.TopLeft.X + otherNode.Width + maxSafeDelta ||
      point.X + node.Width + maxSafeDelta < otherNode.TopLeft.X ||
      point.Y > otherNode.TopLeft.Y + otherNode.Height + maxSafeDelta ||
      point.Y + node.Height + maxSafeDelta < otherNode.TopLeft.Y
    ) {
      continue;
    }
    guard.Add(BigInt(node.Edges.length));
    const delta = Number(node.DeltaTo(otherNode, point));
    if (
      point.X < otherNode.TopLeft.X + otherNode.Width + delta &&
      right + delta > otherNode.TopLeft.X &&
      point.Y < otherNode.TopLeft.Y + otherNode.Height + delta &&
      bottom + delta > otherNode.TopLeft.Y
    ) {
      return true;
    }
  }
  return false;
}

export function optimizerIsOccupied(g, point, guard) {
  if (g == null || point == null) {
    throw new Error(`TALA ${guard.Location()} occupancy check requires a graph and point`);
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA ${guard.Location()} occupancy node count exceeds limit ${MAX_ENGINE_NODES}`);
  }
  for (const node of g.Nodes) {
    guard.Step();
    if (node == null) {
      throw new Error(`TALA ${guard.Location()} found a nil graph node`);
    }
    if (
      node.TopLeft != null &&
      node.TopLeft.X === point.X &&
      node.TopLeft.Y === point.Y
    ) {
      return [node, true];
    }
  }
  return [null, false];
}

export function optimizerCanMove(node, point, includeSizes, guard) {
  if (node == null || node.Graph == null || point == null) {
    throw new Error(`TALA ${guard.Location()} movement check requires a node, graph, and point`);
  }
  if (
    node.TopLeft != null &&
    node.TopLeft.X === point.X &&
    node.TopLeft.Y === point.Y
  ) {
    return true;
  }
  const [, occupied] = optimizerIsOccupied(node.Graph, point, guard);
  if (occupied || !includeSizes) {
    return !occupied;
  }
  return !optimizerDoesOverlap(node, point, null, guard);
}

/**
 * optimizerDescendants collects all hierarchy descendants in stable reverse-push DFS order.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerDescendants
 */
export function optimizerDescendants(node, guard) {
  if (node == null || node.Graph == null) {
    throw new Error(`TALA ${guard.Location()} movement requires a node with a graph`);
  }
  const g = node.Graph;
  const seen = new Set([node]);
  const stack = [];

  const push = (child) => {
    guard.Step();
    if (child == null) {
      throw new Error(`TALA ${guard.Location()} found a nil descendant`);
    }
    if (seen.has(child)) {
      return;
    }
    if (seen.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${guard.Location()} descendant count exceeds limit ${MAX_ENGINE_NODES}`
      );
    }
    seen.add(child);
    stack.push(child);
  };

  const pushChildren = (parent) => {
    if (g.Sequences && g.Sequences.has(parent)) {
      const sequence = g.Sequences.get(parent);
      if (sequence != null && sequence.Nodes) {
        if (sequence.Nodes.length > MAX_ENGINE_NODES) {
          throw new Error(
            `TALA ${guard.Location()} sequence child references exceed node limit ${MAX_ENGINE_NODES}`
          );
        }
        for (let i = sequence.Nodes.length - 1; i >= 0; i--) {
          push(sequence.Nodes[i]);
        }
      }
    }
    if (
      parent != null &&
      (typeof parent.IsClusterVessel === "function"
        ? parent.IsClusterVessel()
        : Boolean(parent.isClusterVessel))
    ) {
      if (g.Clusters) {
        const cluster = g.Clusters.get(parent);
        if (cluster != null && cluster.Nodes) {
          if (cluster.Nodes.length > MAX_ENGINE_NODES) {
            throw new Error(
              `TALA ${guard.Location()} cluster child references exceed node limit ${MAX_ENGINE_NODES}`
            );
          }
          for (let i = cluster.Nodes.length - 1; i >= 0; i--) {
            push(cluster.Nodes[i]);
          }
        }
      }
    }
    if (
      parent == null ||
      (typeof parent.IsContainer === "function"
        ? parent.IsContainer()
        : Boolean(parent.isContainer))
    ) {
      const children = g.Containers ? g.Containers.get(parent) || [] : [];
      if (children.length > MAX_ENGINE_NODES) {
        throw new Error(
          `TALA ${guard.Location()} container child references exceed node limit ${MAX_ENGINE_NODES}`
        );
      }
      for (let i = children.length - 1; i >= 0; i--) {
        push(children[i]);
      }
    }
  };

  pushChildren(node);
  const descendants = [];
  while (stack.length > 0) {
    guard.Step();
    const current = stack.pop();
    descendants.push(current);
    pushChildren(current);
  }
  return descendants;
}

/**
 * optimizerMoveNodeAbs moves a node and its descendants to absolute coordinates.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerMoveNodeAbs
 */
export function optimizerMoveNodeAbs(node, x, y, guard) {
  if (node == null || node.TopLeft == null) {
    throw new Error(`TALA ${guard.Location()} cannot move an unpositioned node`);
  }
  if (node.TopLeft.X === x && node.TopLeft.Y === y) {
    guard.Step();
    return;
  }
  const isCont =
    typeof node.IsContainer === "function"
      ? node.IsContainer()
      : Boolean(node.isContainer);
  const isVessel =
    typeof node.IsClusterVessel === "function"
      ? node.IsClusterVessel()
      : Boolean(node.isClusterVessel);
  const hasSeq = node.Graph && node.Graph.Sequences && node.Graph.Sequences.has(node);

  if (node.Graph != null && !isCont && !isVessel && !hasSeq) {
    node.Translate(x - node.TopLeft.X, y - node.TopLeft.Y);
    return;
  }

  const descendants = optimizerDescendants(node, guard);
  const snapshots = [{ node, topLeft: snapshotPointer(node.TopLeft) }];
  for (const child of descendants) {
    guard.Step();
    if (child.TopLeft == null) {
      throw new Error(`TALA ${guard.Location()} cannot move an unpositioned descendant`);
    }
    snapshots.push({ node: child, topLeft: snapshotPointer(child.TopLeft) });
  }

  let complete = false;
  try {
    const dx = x - node.TopLeft.X;
    const dy = y - node.TopLeft.Y;
    node.Translate(dx, dy);
    for (const child of descendants) {
      guard.Step();
      child.Translate(dx, dy);
    }
    complete = true;
  } finally {
    if (!complete) {
      restoreNodePositions(snapshots);
    }
  }
}

/**
 * captureOptimizerNodePositions snapshots node positions for rollback.
 *
 * Pinned reference: internal/placement/optimization_guard.go captureOptimizerNodePositions
 */
export function captureOptimizerNodePositions(nodes, guard) {
  if (nodes.length <= 2) {
    let leaves = true;
    for (const node of nodes) {
      if (node == null) {
        throw new Error(`TALA ${guard.Location()} found a nil node`);
      }
      const isCont =
        typeof node.IsContainer === "function"
          ? node.IsContainer()
          : Boolean(node.isContainer);
      const isVessel =
        typeof node.IsClusterVessel === "function"
          ? node.IsClusterVessel()
          : Boolean(node.isClusterVessel);
      const hasSeq =
        node.Graph && node.Graph.Sequences && node.Graph.Sequences.has(node);
      if (node.Graph == null || isCont || isVessel || hasSeq) {
        leaves = false;
        break;
      }
    }
    if (leaves) {
      const snapshots = [];
      for (const node of nodes) {
        let duplicate = false;
        for (const snapshot of snapshots) {
          if (snapshot.node === node) {
            duplicate = true;
            break;
          }
        }
        if (duplicate) {
          continue;
        }
        guard.Step();
        snapshots.push({ node, topLeft: snapshotPointer(node.TopLeft) });
      }
      return snapshots;
    }
  }

  if (nodes.length === 1) {
    const descendants = optimizerDescendants(nodes[0], guard);
    const snapshots = new Array(descendants.length + 1);
    for (let i = 0; i < snapshots.length; i++) {
      guard.Step();
      const node = i === 0 ? nodes[0] : descendants[i - 1];
      snapshots[i] = { node, topLeft: snapshotPointer(node.TopLeft) };
    }
    return snapshots;
  }

  const seen = new Set();
  const snapshots = [];
  for (const node of nodes) {
    if (node == null) {
      throw new Error(`TALA ${guard.Location()} found a nil node`);
    }
    const all = [node].concat(optimizerDescendants(node, guard));
    for (const current of all) {
      if (seen.has(current)) {
        continue;
      }
      if (seen.size >= MAX_ENGINE_NODES) {
        throw new Error(
          `TALA ${guard.Location()} position snapshot exceeds node limit ${MAX_ENGINE_NODES}`
        );
      }
      guard.Step();
      seen.add(current);
      snapshots.push({ node: current, topLeft: snapshotPointer(current.TopLeft) });
    }
  }
  return snapshots;
}

/**
 * optimizerSwapPositions swaps coordinates between two nodes atomically.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerSwapPositions
 */
export function optimizerSwapPositions(nodeA, nodeB, guard) {
  if (
    nodeA == null ||
    nodeB == null ||
    nodeA.TopLeft == null ||
    nodeB.TopLeft == null
  ) {
    throw new Error(`TALA ${guard.Location()} cannot swap unpositioned nodes`);
  }
  const snapshots = captureOptimizerNodePositions([nodeA, nodeB], guard);
  let complete = false;
  try {
    const ax = nodeA.TopLeft.X;
    const ay = nodeA.TopLeft.Y;
    optimizerMoveNodeAbs(nodeA, nodeB.TopLeft.X, nodeB.TopLeft.Y, guard);
    optimizerMoveNodeAbs(nodeB, ax, ay, guard);
    complete = true;
  } finally {
    if (!complete) {
      restoreNodePositions(snapshots);
    }
  }
}

/**
 * withOptimizerPositionsSwapped speculatively swaps positions for a callback,
 * always restoring positions afterward.
 *
 * Pinned reference: internal/placement/optimization_guard.go withOptimizerPositionsSwapped
 */
export function withOptimizerPositionsSwapped(nodeA, nodeB, guard, fn) {
  const before = guard.Used();
  const snapshots = captureOptimizerNodePositions([nodeA, nodeB], guard);
  const captureWork = guard.Used() - before;
  try {
    if (
      nodeA == null ||
      nodeB == null ||
      nodeA.TopLeft == null ||
      nodeB.TopLeft == null
    ) {
      throw new Error(`TALA ${guard.Location()} cannot swap unpositioned nodes`);
    }
    for (let i = 0n; i < captureWork; i++) {
      guard.Step();
    }
    const ax = nodeA.TopLeft.X;
    const ay = nodeA.TopLeft.Y;
    optimizerMoveNodeAbs(nodeA, nodeB.TopLeft.X, nodeB.TopLeft.Y, guard);
    optimizerMoveNodeAbs(nodeB, ax, ay, guard);
    return fn();
  } finally {
    restoreNodePositions(snapshots);
  }
}

/**
 * OptimizerMutationSnapshot holds the complete rollback state for an optimizer mutation.
 *
 * Pinned reference: internal/placement/optimization_guard.go optimizerMutationSnapshot
 */
export class OptimizerMutationSnapshot {
  constructor() {
    this.nodes = [];
    this.clusters = [];
    this.herds = [];
    this.costSnapshot = null;

    this.seenNodes = new Set();
    this.seenClusters = new Set();
    this.seenHerds = new Set();
  }

  release() {
    this.nodes.length = 0;
    this.clusters.length = 0;
    this.herds.length = 0;
    this.costSnapshot = null;
    this.seenNodes.clear();
    this.seenClusters.clear();
    this.seenHerds.clear();
  }

  restore() {
    for (const nodeSnapshot of this.nodes) {
      nodeSnapshot.node.TopLeft = nodeSnapshot.topLeft.restore();
      nodeSnapshot.node.Width = nodeSnapshot.width;
      nodeSnapshot.node.Height = nodeSnapshot.height;
    }
    for (const clusterSnapshot of this.clusters) {
      clusterSnapshot.cluster.Arrangement = clusterSnapshot.arrangement;
      clusterSnapshot.cluster.DesiredArrangement = clusterSnapshot.desired;
      clusterSnapshot.cluster.Padding = clusterSnapshot.padding;
    }
    for (const herdSnapshot of this.herds) {
      Object.assign(herdSnapshot.herd, herdSnapshot.value);
    }
    if (this.costSnapshot) {
      this.costSnapshot.Restore();
    }
  }
}

/**
 * captureOptimizerMutationStateInto records mutation snapshot into the provided object.
 *
 * Pinned reference: internal/placement/optimization_guard.go captureOptimizerMutationStateInto
 */
export function captureOptimizerMutationStateInto(g, guard, snapshot) {
  snapshot.release();
  if (g == null) {
    throw new Error(`TALA ${guard.Location()} requires a graph`);
  }
  if (g.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(
      `TALA ${guard.Location()} snapshot node count exceeds limit ${MAX_ENGINE_NODES}`
    );
  }
  const contLen = g.Containers ? g.Containers.size : 0;
  const clustLen = g.Clusters ? g.Clusters.size : 0;
  const seqLen = g.Sequences ? g.Sequences.size : 0;
  if (
    contLen > MAX_ENGINE_NODES + 1 ||
    clustLen > MAX_ENGINE_NODES ||
    seqLen > MAX_ENGINE_NODES
  ) {
    throw new Error(
      `TALA ${guard.Location()} optimizer topology maps exceed node limit ${MAX_ENGINE_NODES}`
    );
  }
  const cacheEntries = g.EdgeLengthCacheEntries ? g.EdgeLengthCacheEntries() : 0;
  if (BigInt(cacheEntries) > BigInt(MAX_TOPOLOGY_REFERENCES)) {
    throw new Error(
      `TALA ${guard.Location()} edge-length cache entries exceed limit ${MAX_TOPOLOGY_REFERENCES}`
    );
  }
  for (let i = 0; i < cacheEntries; i++) {
    guard.Step();
  }
  const costSnapshot = g.SnapshotPlacementCosts();
  guard.Finish();
  snapshot.costSnapshot = costSnapshot;

  const seenNodes = snapshot.seenNodes;
  const enqueue = (node) => {
    guard.Step();
    if (node == null) {
      throw new Error(`TALA ${guard.Location()} found a nil graph node`);
    }
    if (seenNodes.has(node)) {
      return;
    }
    if (seenNodes.size >= MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${guard.Location()} snapshot node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    }
    seenNodes.add(node);
    snapshot.nodes.push({
      node,
      topLeft: snapshotPointer(node.TopLeft),
      width: node.Width,
      height: node.Height,
    });
  };

  for (const node of g.Nodes) {
    enqueue(node);
  }

  for (let i = 0; i < snapshot.nodes.length; i++) {
    const node = snapshot.nodes[i].node;
    const containers = g.Containers ? g.Containers.get(node) || [] : [];
    if (containers.length > MAX_ENGINE_NODES) {
      throw new Error(
        `TALA ${guard.Location()} container child references exceed node limit ${MAX_ENGINE_NODES}`
      );
    }
    for (const child of containers) {
      enqueue(child);
    }
    if (g.Clusters) {
      const cluster = g.Clusters.get(node);
      if (cluster != null && cluster.Nodes) {
        if (cluster.Nodes.length > MAX_ENGINE_NODES) {
          throw new Error(
            `TALA ${guard.Location()} cluster child references exceed node limit ${MAX_ENGINE_NODES}`
          );
        }
        for (const child of cluster.Nodes) {
          enqueue(child);
        }
      }
    }
    if (g.Sequences) {
      const sequence = g.Sequences.get(node);
      if (sequence != null && sequence.Nodes) {
        if (sequence.Nodes.length > MAX_ENGINE_NODES) {
          throw new Error(
            `TALA ${guard.Location()} sequence child references exceed node limit ${MAX_ENGINE_NODES}`
          );
        }
        for (const child of sequence.Nodes) {
          enqueue(child);
        }
      }
    }
  }

  const seenClusters = snapshot.seenClusters;
  if (g.Clusters) {
    for (const cluster of g.Clusters.values()) {
      guard.Step();
      if (cluster == null) {
        continue;
      }
      if (seenClusters.has(cluster)) {
        continue;
      }
      seenClusters.add(cluster);
      snapshot.clusters.push({
        cluster,
        arrangement: cluster.Arrangement,
        desired: cluster.DesiredArrangement,
        padding: cluster.Padding,
      });
    }
  }

  const seenHerds = snapshot.seenHerds;
  for (const nodeSnapshot of snapshot.nodes) {
    guard.Step();
    const herd = nodeSnapshot.node.HerdAssignment;
    if (herd == null) {
      continue;
    }
    if (seenHerds.has(herd)) {
      continue;
    }
    seenHerds.add(herd);
    snapshot.herds.push({ herd, value: { ...herd } });
  }

  return snapshot;
}

export function captureOptimizerMutationState(g, guard) {
  return captureOptimizerMutationStateInto(g, guard, new OptimizerMutationSnapshot());
}
