import { MAX_ENGINE_NODES, MAX_ENGINE_EDGES } from '../limits/constants.js';

export class GraphStateSnapshotOptions {
  constructor({ CaptureTopology = false, CaptureEdgeRoutes = false } = {}) {
    this.CaptureTopology = Boolean(CaptureTopology);
    this.CaptureEdgeRoutes = Boolean(CaptureEdgeRoutes);
  }
}

export function captureExactSlice(array) {
  if (array == null) return null;
  const values = new Array(array.length);
  for (let i = 0; i < array.length; i++) {
    values[i] = array[i];
  }
  return {
    original: array,
    values,
    restore() {
      if (this.original == null) return null;
      this.original.length = this.values.length;
      for (let i = 0; i < this.values.length; i++) {
        this.original[i] = this.values[i];
      }
      return this.original;
    }
  };
}

export function captureEdgeStyle(style) {
  if (style == null) return null;
  return {
    original: style,
    fields: { ...style },
    restore() {
      if (this.original == null) return null;
      for (const key of Object.keys(this.original)) {
        if (!(key in this.fields)) {
          delete this.original[key];
        }
      }
      Object.assign(this.original, this.fields);
      return this.original;
    }
  };
}

export function captureExactSliceMap(map) {
  if (map == null) return null;
  const values = new Map();
  for (const [key, items] of map.entries()) {
    values.set(key, captureExactSlice(items));
  }
  return {
    original: map,
    values,
    restore() {
      if (this.original == null) return null;
      this.original.clear();
      for (const [key, snap] of this.values.entries()) {
        this.original.set(key, snap ? snap.restore() : null);
      }
      return this.original;
    }
  };
}

export function cloneMapContents(map) {
  if (map == null || map.size === 0) return null;
  return new Map(map);
}

export function restoreMap(original, snapshot) {
  if (original == null) return null;
  original.clear();
  if (snapshot != null) {
    for (const [k, v] of snapshot.entries()) {
      original.set(k, v);
    }
  }
  return original;
}

export function cloneSetContents(set) {
  if (set == null || set.size === 0) return null;
  return new Set(set);
}

export function restoreSet(original, snapshot) {
  if (original == null) return null;
  original.clear();
  if (snapshot != null) {
    for (const item of snapshot) {
      original.add(item);
    }
  }
  return original;
}

export function cloneRequirementsMap(map) {
  if (map == null || map.size === 0) return null;
  const cloned = new Map();
  for (const [node, req] of map.entries()) {
    cloned.set(node, req ? req.copy() : null);
  }
  return cloned;
}

export function restoreRequirementsMap(original, snapshot) {
  if (original == null) return null;
  original.clear();
  if (snapshot != null) {
    for (const [node, req] of snapshot.entries()) {
      original.set(node, req ? req.copy() : null);
    }
  }
  return original;
}

export function snapshotPoint(point) {
  if (point == null) return null;
  return {
    pointer: point,
    x: point.X,
    y: point.Y,
    restore() {
      if (this.pointer == null) return null;
      this.pointer.X = this.x;
      this.pointer.Y = this.y;
      return this.pointer;
    }
  };
}

export function snapshotLabel(lbl) {
  if (lbl == null) return null;
  return {
    pointer: lbl,
    text: lbl.Text,
    position: lbl.Position,
    width: lbl.Width,
    height: lbl.Height,
    positionFixed: lbl.PositionFixed ? lbl.PositionFixed() : Boolean(lbl._positionFixed),
    restore() {
      if (this.pointer == null) return null;
      this.pointer.Text = this.text;
      this.pointer.Position = this.position;
      this.pointer.Width = this.width;
      this.pointer.Height = this.height;
      this.pointer._positionFixed = this.positionFixed;
      return this.pointer;
    }
  };
}

export function snapshotIcon(icon) {
  if (icon == null) return null;
  return {
    pointer: icon,
    position: icon.Position,
    positionFixed: icon.PositionFixed ? icon.PositionFixed() : Boolean(icon._positionFixed),
    restore() {
      if (this.pointer == null) return null;
      this.pointer.Position = this.position;
      this.pointer._positionFixed = this.positionFixed;
      return this.pointer;
    }
  };
}

function captureNode(node) {
  return {
    originalBox: node.Box,
    value: {
      ID: node.ID,
      D2ID: node.D2ID,
      Graph: node.Graph,
      FontSize: node.FontSize,
      ForceHierarchy: node.ForceHierarchy,
      Container: node.Container,
      Cluster: node.Cluster,
      Sequence: node.Sequence,
      HerdAssignment: node.HerdAssignment,
      Hierarchy: node.Hierarchy,
      DesiredWidth: node.DesiredWidth,
      DesiredHeight: node.DesiredHeight,
      isContainer: node.isContainer,
      isClusterVessel: node.isClusterVessel,
      Is3D: node.Is3D,
      IsMultiple: node.IsMultiple,
      IsInvisible: node.IsInvisible,
      _shapeType: node._shapeType,
      _numColumns: node._numColumns,
      width: node.Width,
      height: node.Height,
    },
    topLeft: snapshotPoint(node.TopLeft),
    fixedTopLeft: snapshotPoint(node.FixedTopLeft),
    label: snapshotLabel(node.Label),
    icon: snapshotIcon(node.Icon),
    edges: captureExactSlice(node.Edges),
    originalNears: node.Nears,
    nears: cloneSetContents(node.Nears),
    originalLoopOffsets: node.LoopOffsets,
    loopOffsets: cloneMapContents(node.LoopOffsets),
    originalRequirements: node.LongDistanceNeighborRequirements,
    longDistanceNeighborRequirements: cloneRequirementsMap(node.LongDistanceNeighborRequirements),

    restore(n) {
      if (this.originalBox) {
        n.Box = this.originalBox;
      }
      if (this.topLeft) {
        n.TopLeft = this.topLeft.restore();
      } else {
        n.TopLeft = null;
      }
      if (this.fixedTopLeft) {
        n.FixedTopLeft = this.fixedTopLeft.restore();
      } else {
        n.FixedTopLeft = null;
      }
      if (this.label) {
        n.Label = this.label.restore();
      } else {
        n.Label = null;
      }
      if (this.icon) {
        n.Icon = this.icon.restore();
      } else {
        n.Icon = null;
      }

      n.ID = this.value.ID;
      n.D2ID = this.value.D2ID;
      n.Graph = this.value.Graph;
      n.FontSize = this.value.FontSize;
      n.ForceHierarchy = this.value.ForceHierarchy;
      n.Container = this.value.Container;
      n.Cluster = this.value.Cluster;
      n.Sequence = this.value.Sequence;
      n.HerdAssignment = this.value.HerdAssignment;
      n.Hierarchy = this.value.Hierarchy;
      n.DesiredWidth = this.value.DesiredWidth;
      n.DesiredHeight = this.value.DesiredHeight;
      n.isContainer = this.value.isContainer;
      n.isClusterVessel = this.value.isClusterVessel;
      n.Is3D = this.value.Is3D;
      n.IsMultiple = this.value.IsMultiple;
      n.IsInvisible = this.value.IsInvisible;
      n._shapeType = this.value._shapeType;
      n._numColumns = this.value._numColumns;
      n.Width = this.value.width;
      n.Height = this.value.height;

      n.Edges = this.edges ? this.edges.restore() : null;
      n.Nears = restoreSet(this.originalNears, this.nears);
      n.LoopOffsets = restoreMap(this.originalLoopOffsets, this.loopOffsets);
      n.LongDistanceNeighborRequirements = restoreRequirementsMap(
        this.originalRequirements,
        this.longDistanceNeighborRequirements
      );
    }
  };
}

function captureEdge(edge) {
  const pointValues = edge.Points ? new Array(edge.Points.length) : [];
  if (edge.Points) {
    for (let i = 0; i < edge.Points.length; i++) {
      pointValues[i] = snapshotPoint(edge.Points[i]);
    }
  }
  return {
    value: {
      ID: edge.ID,
      D2ID: edge.D2ID,
      From: edge.From,
      To: edge.To,
      MinWidth: edge.MinWidth,
      MinHeight: edge.MinHeight,
      SourceArrowhead: edge.SourceArrowhead,
      TargetArrowhead: edge.TargetArrowhead,
      LabelPercentage: edge.LabelPercentage,
      FromTableColumnIndex: edge.FromTableColumnIndex,
      ToTableColumnIndex: edge.ToTableColumnIndex,
      IsInvisible: edge.IsInvisible,
      sourceEndpointId: edge.sourceEndpointId,
      targetEndpointId: edge.targetEndpointId,
      route: edge.route,
      elkData: edge.elkData,
    },
    style: captureEdgeStyle(edge.Style),
    points: captureExactSlice(edge.Points),
    pointValues,
    label: snapshotLabel(edge.Label),
    sourceArrowheadLabel: snapshotLabel(edge.SourceArrowheadLabel),
    targetArrowheadLabel: snapshotLabel(edge.TargetArrowheadLabel),

    restore(e) {
      if (this.label) {
        e.Label = this.label.restore();
      } else {
        e.Label = null;
      }
      if (this.sourceArrowheadLabel) {
        e.SourceArrowheadLabel = this.sourceArrowheadLabel.restore();
      } else {
        e.SourceArrowheadLabel = null;
      }
      if (this.targetArrowheadLabel) {
        e.TargetArrowheadLabel = this.targetArrowheadLabel.restore();
      } else {
        e.TargetArrowheadLabel = null;
      }

      for (let i = 0; i < this.pointValues.length; i++) {
        if (this.pointValues[i]) {
          this.pointValues[i].restore();
        }
      }
      const originalPoints = this.points ? this.points.restore() : null;

      e.ID = this.value.ID;
      e.D2ID = this.value.D2ID;
      e.From = this.value.From;
      e.To = this.value.To;
      e.MinWidth = this.value.MinWidth;
      e.MinHeight = this.value.MinHeight;
      e.SourceArrowhead = this.value.SourceArrowhead;
      e.TargetArrowhead = this.value.TargetArrowhead;
      e.LabelPercentage = this.value.LabelPercentage;
      e.FromTableColumnIndex = this.value.FromTableColumnIndex;
      e.ToTableColumnIndex = this.value.ToTableColumnIndex;
      e.IsInvisible = this.value.IsInvisible;
      e.Style = this.style ? this.style.restore() : null;
      e.sourceEndpointId = this.value.sourceEndpointId;
      e.targetEndpointId = this.value.targetEndpointId;
      e.route = this.value.route;
      e.elkData = this.value.elkData;

      e.Points = originalPoints;
    }
  };
}

function captureCluster(cluster) {
  return {
    value: {
      Vessel: cluster.Vessel,
      Arrangement: cluster.Arrangement,
      DesiredArrangement: cluster.DesiredArrangement,
      Graph: cluster.Graph,
      Padding: cluster.Padding,
      FixedSize: cluster.FixedSize,
      Container: cluster.Container,
    },
    nodes: captureExactSlice(cluster.Nodes),
    edgeAbductions: captureExactSlice(cluster.EdgeAbductions),

    restore(c) {
      c.Vessel = this.value.Vessel;
      c.Arrangement = this.value.Arrangement;
      c.DesiredArrangement = this.value.DesiredArrangement;
      c.Graph = this.value.Graph;
      c.Padding = this.value.Padding;
      c.FixedSize = this.value.FixedSize;
      c.Container = this.value.Container;
      c.Nodes = this.nodes ? this.nodes.restore() : null;
      c.EdgeAbductions = this.edgeAbductions ? this.edgeAbductions.restore() : null;
    }
  };
}

function captureSequence(sequence) {
  return {
    value: {
      Vessel: sequence.Vessel,
      Graph: sequence.Graph,
      Container: sequence.Container,
    },
    nodes: captureExactSlice(sequence.Nodes),
    edgeAbductions: captureExactSlice(sequence.EdgeAbductions),

    restore(s) {
      s.Vessel = this.value.Vessel;
      s.Graph = this.value.Graph;
      s.Container = this.value.Container;
      s.Nodes = this.nodes ? this.nodes.restore() : null;
      s.EdgeAbductions = this.edgeAbductions ? this.edgeAbductions.restore() : null;
    }
  };
}

function captureTree(tree) {
  return {
    value: {
      Node: tree.Node,
      Parent: tree.Parent,
      SentinelEdge: tree.SentinelEdge,
      Orientation: tree.Orientation,
    },
    children: captureExactSlice(tree.Children),

    restore(t) {
      t.Node = this.value.Node;
      t.Parent = this.value.Parent;
      t.SentinelEdge = this.value.SentinelEdge;
      t.Orientation = this.value.Orientation;
      t.Children = this.children ? this.children.restore() : null;
    }
  };
}

function captureEdgeAbduction(abduction) {
  return {
    Edge: abduction.Edge,
    OriginallyFrom: abduction.OriginallyFrom,
    OriginallyTo: abduction.OriginallyTo,
    CurrentFrom: abduction.CurrentFrom,
    CurrentTo: abduction.CurrentTo,

    restore(a) {
      a.Edge = this.Edge;
      a.OriginallyFrom = this.OriginallyFrom;
      a.OriginallyTo = this.OriginallyTo;
      a.CurrentFrom = this.CurrentFrom;
      a.CurrentTo = this.CurrentTo;
    }
  };
}

function captureHerd(herd) {
  return {
    Orientation: herd.Orientation,
    Val: herd.Val,
    originalOpposite: herd.oppositeSidePaired,
    originalSame: herd.sameSidePaired,
    oppositeSidePaired: cloneSetContents(herd.oppositeSidePaired),
    sameSidePaired: cloneSetContents(herd.sameSidePaired),

    restore(h) {
      h.Orientation = this.Orientation;
      h.Val = this.Val;
      restoreSet(this.originalOpposite, this.oppositeSidePaired);
      restoreSet(this.originalSame, this.sameSidePaired);
      h.oppositeSidePaired = this.originalOpposite;
      h.sameSidePaired = this.originalSame;
    }
  };
}

function captureHierarchy(hierarchy) {
  const levelsMap = hierarchy.levels;
  return {
    LevelCount: hierarchy.LevelCount,
    originalLevels: levelsMap,
    level: cloneMapContents(levelsMap),

    restore(h) {
      h.LevelCount = this.LevelCount;
      if (this.originalLevels == null) {
        if (h.ReplaceLevels) {
          h.ReplaceLevels(null);
        } else {
          h.levels = null;
        }
      } else {
        const restored = restoreMap(this.originalLevels, this.level);
        if (h.ReplaceLevels) {
          h.ReplaceLevels(restored);
        } else {
          h.levels = restored;
        }
      }
    }
  };
}

function captureGraph(graph) {
  return {
    isRootHierarchy: graph.IsRootHierarchy,
    nodes: captureExactSlice(graph.Nodes),
    edges: captureExactSlice(graph.Edges),
    cellSize: graph.CellSize,
    containers: captureExactSliceMap(graph.Containers),
    clustersRef: graph.Clusters,
    clusters: cloneMapContents(graph.Clusters),
    trees: captureExactSliceMap(graph.Trees),
    nodeToTreeRef: graph.NodeToTree,
    nodeToTree: cloneMapContents(graph.NodeToTree),
    hubs: captureExactSliceMap(graph.Hubs),
    sequencesRef: graph.Sequences,
    sequences: cloneMapContents(graph.Sequences),
    directionsRef: graph.Directions,
    directions: cloneMapContents(graph.Directions),
    commonSiblings: captureExactSliceMap(graph.CommonUncleSiblings),

    restore(g) {
      g.IsRootHierarchy = this.isRootHierarchy;
      g.Nodes = this.nodes ? this.nodes.restore() : null;
      g.Edges = this.edges ? this.edges.restore() : null;
      g.CellSize = this.cellSize;
      g.Containers = this.containers ? this.containers.restore() : null;
      g.Clusters = restoreMap(this.clustersRef, this.clusters);
      g.Trees = this.trees ? this.trees.restore() : null;
      g.NodeToTree = restoreMap(this.nodeToTreeRef, this.nodeToTree);
      g.Hubs = this.hubs ? this.hubs.restore() : null;
      g.Sequences = restoreMap(this.sequencesRef, this.sequences);
      g.Directions = restoreMap(this.directionsRef, this.directions);
      g.CommonUncleSiblings = this.commonSiblings ? this.commonSiblings.restore() : null;
    }
  };
}

function collectRuntimeObjectsContext(graph, guard, scope) {
  const nodes = new Set();
  const edges = new Set();
  const clusters = new Set();
  const sequences = new Set();
  const trees = new Set();
  const edgeAbductions = new Set();
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

  let captureErr = null;

  const charge = () => {
    if (captureErr != null) return false;
    try {
      const err = guard.Step();
      if (err) {
        captureErr = err;
        return false;
      }
      return true;
    } catch (e) {
      captureErr = e;
      return false;
    }
  };

  const addNode = (node) => {
    if (!charge()) return;
    if (node == null) return;
    if (nodes.has(node)) return;
    if (nodes.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} node snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    nodes.add(node);
    nodeQueue.push(node);
  };

  const addEdge = (edge) => {
    if (!charge()) return;
    if (edge == null) return;
    if (edges.has(edge)) return;
    if (edges.size >= MAX_ENGINE_EDGES) {
      captureErr = new Error(`TALA ${scope} edge snapshot exceeds limit ${MAX_ENGINE_EDGES}`);
      return;
    }
    edges.add(edge);
    edgeQueue.push(edge);
  };

  const addCluster = (cluster) => {
    if (!charge()) return;
    if (cluster == null) return;
    if (clusters.has(cluster)) return;
    if (clusters.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} cluster snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    clusters.add(cluster);
    clusterQueue.push(cluster);
  };

  const addSequence = (sequence) => {
    if (!charge()) return;
    if (sequence == null) return;
    if (sequences.has(sequence)) return;
    if (sequences.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} sequence snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    sequences.add(sequence);
    sequenceQueue.push(sequence);
  };

  const addTree = (tree) => {
    if (!charge()) return;
    if (tree == null) return;
    if (trees.has(tree)) return;
    if (trees.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} tree snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    trees.add(tree);
    treeQueue.push(tree);
  };

  const addEdgeAbduction = (abduction) => {
    if (!charge()) return;
    if (abduction == null) return;
    if (edgeAbductions.has(abduction)) return;
    if (edgeAbductions.size >= MAX_ENGINE_EDGES) {
      captureErr = new Error(`TALA ${scope} edge-abduction snapshot exceeds limit ${MAX_ENGINE_EDGES}`);
      return;
    }
    edgeAbductions.add(abduction);
    abductionQueue.push(abduction);
  };

  const addHerd = (herd) => {
    if (!charge()) return;
    if (herd == null) return;
    if (herds.has(herd)) return;
    if (herds.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} herd snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    herds.add(herd);
    herdQueue.push(herd);
  };

  const addHierarchy = (hierarchy) => {
    if (!charge()) return;
    if (hierarchy == null) return;
    if (hierarchies.has(hierarchy)) return;
    if (hierarchies.size >= MAX_ENGINE_NODES) {
      captureErr = new Error(`TALA ${scope} hierarchy snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      return;
    }
    hierarchies.add(hierarchy);
    hierarchyQueue.push(hierarchy);
  };

  // Seed traversal
  for (const node of graph.Nodes) {
    addNode(node);
  }
  for (const edge of graph.Edges) {
    addEdge(edge);
  }
  if (graph.Containers) {
    for (const [container, children] of graph.Containers.entries()) {
      addNode(container);
      if (children) {
        for (const child of children) {
          addNode(child);
        }
      }
    }
  }
  if (graph.Clusters) {
    for (const [vessel, cluster] of graph.Clusters.entries()) {
      addNode(vessel);
      addCluster(cluster);
    }
  }
  if (graph.Sequences) {
    for (const [vessel, sequence] of graph.Sequences.entries()) {
      addNode(vessel);
      addSequence(sequence);
    }
  }
  if (graph.Trees) {
    for (const [node, nodeTrees] of graph.Trees.entries()) {
      addNode(node);
      if (nodeTrees) {
        for (const tree of nodeTrees) {
          addTree(tree);
        }
      }
    }
  }
  if (graph.NodeToTree) {
    for (const [node, tree] of graph.NodeToTree.entries()) {
      addNode(node);
      addTree(tree);
    }
  }
  if (graph.Hubs) {
    for (const [hub, hubNodes] of graph.Hubs.entries()) {
      addNode(hub);
      if (hubNodes) {
        for (const node of hubNodes) {
          addNode(node);
        }
      }
    }
  }
  if (graph.CommonUncleSiblings) {
    for (const [node, siblings] of graph.CommonUncleSiblings.entries()) {
      addNode(node);
      if (siblings) {
        for (const sibling of siblings) {
          addNode(sibling);
        }
      }
    }
  }
  if (graph.Directions) {
    for (const node of graph.Directions.keys()) {
      addNode(node);
    }
  }

  if (captureErr != null) {
    return { error: captureErr };
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
    if (captureErr != null) {
      return { error: captureErr };
    }

    if (nodeIndex < nodeQueue.length) {
      const node = nodeQueue[nodeIndex++];
      addNode(node.Container);
      if (node.Nears) {
        for (const near of node.Nears) {
          addNode(near);
        }
      }
      if (node.LongDistanceNeighborRequirements) {
        for (const neighbor of node.LongDistanceNeighborRequirements.keys()) {
          addNode(neighbor);
        }
      }
      if (node.Edges) {
        for (const edge of node.Edges) {
          addEdge(edge);
        }
      }
      addCluster(node.Cluster);
      addSequence(node.Sequence);
      addHerd(node.HerdAssignment);
      addHierarchy(node.Hierarchy);
    } else if (edgeIndex < edgeQueue.length) {
      const edge = edgeQueue[edgeIndex++];
      addNode(edge.From);
      addNode(edge.To);
    } else if (clusterIndex < clusterQueue.length) {
      const cluster = clusterQueue[clusterIndex++];
      addNode(cluster.Vessel);
      addNode(cluster.Container);
      if (cluster.Nodes) {
        for (const node of cluster.Nodes) {
          addNode(node);
        }
      }
      if (cluster.EdgeAbductions) {
        for (const abduction of cluster.EdgeAbductions) {
          addEdgeAbduction(abduction);
        }
      }
    } else if (sequenceIndex < sequenceQueue.length) {
      const sequence = sequenceQueue[sequenceIndex++];
      addNode(sequence.Vessel);
      addNode(sequence.Container);
      if (sequence.Nodes) {
        for (const node of sequence.Nodes) {
          addNode(node);
        }
      }
      if (sequence.EdgeAbductions) {
        for (const abduction of sequence.EdgeAbductions) {
          addEdgeAbduction(abduction);
        }
      }
    } else if (treeIndex < treeQueue.length) {
      const tree = treeQueue[treeIndex++];
      addNode(tree.Node);
      addEdge(tree.SentinelEdge);
      addTree(tree.Parent);
      if (tree.Children) {
        for (const child of tree.Children) {
          addTree(child);
        }
      }
    } else if (abductionIndex < abductionQueue.length) {
      const abduction = abductionQueue[abductionIndex++];
      addEdge(abduction.Edge);
      addNode(abduction.OriginallyFrom);
      addNode(abduction.OriginallyTo);
      addNode(abduction.CurrentFrom);
      addNode(abduction.CurrentTo);
    } else if (herdIndex < herdQueue.length) {
      const herd = herdQueue[herdIndex++];
      if (herd.oppositeSidePaired) {
        for (const node of herd.oppositeSidePaired) {
          addNode(node);
        }
      }
      if (herd.sameSidePaired) {
        for (const node of herd.sameSidePaired) {
          addNode(node);
        }
      }
    } else if (hierarchyIndex < hierarchyQueue.length) {
      const hierarchy = hierarchyQueue[hierarchyIndex++];
      const levels = hierarchy.levels;
      if (levels) {
        for (const node of levels.keys()) {
          addNode(node);
        }
      }
    }
  }

  if (captureErr != null) {
    return { error: captureErr };
  }

  return {
    nodes,
    edges,
    clusters,
    sequences,
    trees,
    edgeAbductions,
    herds,
    hierarchies,
  };
}

export class GraphState {
  constructor(options = {}) {
    this.captureTopology = Boolean(options.CaptureTopology);
    this.captureEdgeRoutes = Boolean(options.CaptureEdgeRoutes);

    this.nodeGeometry = new Map();
    this.originalNodes = [];
    this.originalNodesRef = null;
    this.hasFixedTopLeft = false;

    this.clusterArrangements = new Map();
    this.clusterDesired = new Map();
    this.clusterPaddings = new Map();
    this.edgeGeometry = null;
    this.treeOrientations = new Map();

    this.graph = null;
    this.nodes = new Map();
    this.edges = new Map();
    this.clusters = new Map();
    this.sequences = new Map();
    this.trees = new Map();
    this.edgeAbductions = new Map();
    this.herds = new Map();
    this.hierarchies = new Map();
  }

  updateWithWorkGuard(g, guard) {
    if (g == null) {
      throw new Error("TALA transaction graph is nil");
    }
    if (guard == null) {
      throw new Error("TALA transaction requires a work guard");
    }
    if (g.Nodes.length > MAX_ENGINE_NODES) {
      throw new Error(`TALA transaction node count exceeds limit ${MAX_ENGINE_NODES}`);
    }
    if (g.Edges.length > MAX_ENGINE_EDGES) {
      throw new Error(`TALA transaction edge count exceeds limit ${MAX_ENGINE_EDGES}`);
    }

    const collections = [
      { name: "container", count: g.Containers ? g.Containers.size : 0 },
      { name: "cluster", count: g.Clusters ? g.Clusters.size : 0 },
      { name: "sequence", count: g.Sequences ? g.Sequences.size : 0 },
      { name: "tree", count: g.Trees ? g.Trees.size : 0 },
      { name: "node-tree", count: g.NodeToTree ? g.NodeToTree.size : 0 },
      { name: "hub", count: g.Hubs ? g.Hubs.size : 0 },
      { name: "direction", count: g.Directions ? g.Directions.size : 0 },
      { name: "sibling", count: g.CommonUncleSiblings ? g.CommonUncleSiblings.size : 0 },
    ];
    for (const { name, count } of collections) {
      if (count > MAX_ENGINE_NODES + 1) {
        throw new Error(`TALA transaction ${name} map exceeds limit ${MAX_ENGINE_NODES + 1}`);
      }
    }

    // Reset state for new capture
    this.nodeGeometry = new Map();
    this.hasFixedTopLeft = false;
    this.clusterArrangements = new Map();
    this.clusterDesired = new Map();
    this.clusterPaddings = new Map();
    this.edgeGeometry = null;
    this.treeOrientations = new Map();

    this.originalNodesRef = g.Nodes;
    this.originalNodes = Array.from(g.Nodes);

    const recordNode = (n) => {
      if (n == null) return false;
      if (this.nodeGeometry.has(n)) return false;
      if (this.nodeGeometry.size >= MAX_ENGINE_NODES) {
        throw new Error(`TALA transaction unique node snapshot exceeds limit ${MAX_ENGINE_NODES}`);
      }
      guard.Step();
      this.nodeGeometry.set(n, {
        box: n.Box,
        topLeft: snapshotPoint(n.TopLeft),
        width: n.Width,
        height: n.Height,
      });
      this.hasFixedTopLeft = this.hasFixedTopLeft || (n.FixedTopLeft != null);
      return true;
    };

    const recordDescendants = (root) => {
      const queue = [root];
      while (queue.length > 0) {
        const node = queue.pop();
        const recorded = recordNode(node);
        if (!recorded) continue;
        const children = g.Containers ? g.Containers.get(node) : null;
        if (children) {
          for (let i = 0; i < children.length; i++) {
            guard.Step();
            queue.push(children[i]);
          }
        }
      }
    };

    for (const n of g.Nodes) {
      recordDescendants(n);
    }

    if (g.Containers) {
      for (const [container, children] of g.Containers.entries()) {
        guard.Step();
        recordDescendants(container);
        if (children) {
          for (const child of children) {
            recordDescendants(child);
          }
        }
      }
    }

    if (g.Clusters) {
      for (const [vessel, c] of g.Clusters.entries()) {
        guard.Step();
        if (c == null) continue;
        this.clusterArrangements.set(c, c.Arrangement);
        this.clusterDesired.set(c, c.DesiredArrangement);
        this.clusterPaddings.set(c, c.Padding);
        recordDescendants(c.Vessel);
        recordDescendants(c.Container);
        if (c.Nodes) {
          for (const n of c.Nodes) {
            recordDescendants(n);
          }
        }
      }
    }

    if (g.Sequences) {
      for (const [vessel, s] of g.Sequences.entries()) {
        guard.Step();
        if (s == null) continue;
        recordDescendants(s.Vessel);
        recordDescendants(s.Container);
        if (s.Nodes) {
          for (const n of s.Nodes) {
            recordDescendants(n);
          }
        }
      }
    }

    if (this.captureTopology) {
      this._captureRuntimeStateContext(g, guard);
    } else {
      this._captureGeometryStateContext(g, guard);
    }

    guard.Finish();
    return null;
  }

  UpdateWithWorkGuard(g, guard) {
    return this.updateWithWorkGuard(g, guard);
  }

  _captureGeometryStateContext(graph, guard) {
    if (this.captureEdgeRoutes) {
      const edges = new Set();
      for (const edge of graph.Edges) {
        guard.Step();
        if (edge == null) {
          throw new Error("TALA geometry snapshot contains a nil edge");
        }
        edges.add(edge);
      }
      for (const node of this.nodeGeometry.keys()) {
        guard.Step();
        if (node.Edges) {
          for (const edge of node.Edges) {
            guard.Step();
            if (edge != null) {
              edges.add(edge);
            }
          }
        }
      }
      this.edgeGeometry = new Map();
      for (const edge of edges) {
        guard.Step();
        if (edge.Points) {
          for (let i = 0; i < edge.Points.length; i++) {
            guard.Step();
          }
        }
        this.edgeGeometry.set(edge, captureEdge(edge));
      }
    } else {
      this.edgeGeometry = null;
    }

    this.treeOrientations = new Map();
    if (graph.NodeToTree) {
      for (const [node, tree] of graph.NodeToTree.entries()) {
        guard.Step();
        if (tree != null) {
          this.treeOrientations.set(tree, tree.Orientation);
        }
      }
    }
    guard.Finish();
  }

  _captureRuntimeStateContext(graph, guard) {
    const result = collectRuntimeObjectsContext(graph, guard, "transaction runtime");
    if (result.error) {
      throw result.error;
    }

    const { nodes, edges, clusters, sequences, trees, edgeAbductions, herds, hierarchies } = result;

    guard.Step();
    this.graph = captureGraph(graph);

    this.nodes = new Map();
    for (const node of nodes) {
      guard.Step();
      this.nodes.set(node, captureNode(node));
    }

    this.edges = new Map();
    for (const edge of edges) {
      guard.Step();
      if (edge.Points) {
        for (let i = 0; i < edge.Points.length; i++) {
          guard.Step();
        }
      }
      this.edges.set(edge, captureEdge(edge));
    }

    this.clusters = new Map();
    for (const cluster of clusters) {
      guard.Step();
      this.clusters.set(cluster, captureCluster(cluster));
    }

    this.sequences = new Map();
    for (const sequence of sequences) {
      guard.Step();
      this.sequences.set(sequence, captureSequence(sequence));
    }

    this.trees = new Map();
    for (const tree of trees) {
      guard.Step();
      this.trees.set(tree, captureTree(tree));
    }

    this.edgeAbductions = new Map();
    for (const abduction of edgeAbductions) {
      guard.Step();
      this.edgeAbductions.set(abduction, captureEdgeAbduction(abduction));
    }

    this.herds = new Map();
    for (const herd of herds) {
      guard.Step();
      this.herds.set(herd, captureHerd(herd));
    }

    this.hierarchies = new Map();
    for (const hierarchy of hierarchies) {
      guard.Step();
      this.hierarchies.set(hierarchy, captureHierarchy(hierarchy));
    }

    guard.Finish();
  }

  ownedNodes(g, guard) {
    const owned = new Set();
    for (const node of g.Nodes) {
      guard.Step();
      owned.add(node);
    }
    for (const node of this.nodes.keys()) {
      guard.Step();
      if (node.Graph === g) {
        owned.add(node);
      }
    }
    return owned;
  }

  OwnedNodes(g, guard) {
    return this.ownedNodes(g, guard);
  }

  rollback(graph) {
    if (this.captureTopology) {
      // 1. restore Graph-level snapshot
      this.graph.restore(graph);

      // 2. restore Clusters
      for (const [cluster, snapshot] of this.clusters.entries()) {
        snapshot.restore(cluster);
      }

      // 3. restore Sequences
      for (const [sequence, snapshot] of this.sequences.entries()) {
        snapshot.restore(sequence);
      }

      // 4. restore Trees
      for (const [tree, snapshot] of this.trees.entries()) {
        snapshot.restore(tree);
      }

      // 5. restore EdgeAbductions
      for (const [abduction, snapshot] of this.edgeAbductions.entries()) {
        snapshot.restore(abduction);
      }

      // 6. restore HerdAssignments
      for (const [herd, snapshot] of this.herds.entries()) {
        snapshot.restore(herd);
      }

      // 7. restore Hierarchies
      for (const [hierarchy, snapshot] of this.hierarchies.entries()) {
        snapshot.restore(hierarchy);
      }

      // 8. restore Edges
      for (const [edge, snapshot] of this.edges.entries()) {
        snapshot.restore(edge);
      }

      // 9. restore Nodes
      for (const [node, snapshot] of this.nodes.entries()) {
        snapshot.restore(node);
      }
      return;
    }

    // Geometry-only rollback
    for (const [node, geometry] of this.nodeGeometry.entries()) {
      if (geometry.box) {
        node.Box = geometry.box;
      }
      node.TopLeft = geometry.topLeft ? geometry.topLeft.restore() : null;
      node.Width = geometry.width;
      node.Height = geometry.height;
    }

    for (const [cluster, arrangement] of this.clusterArrangements.entries()) {
      cluster.Arrangement = arrangement;
      cluster.DesiredArrangement = this.clusterDesired.get(cluster);
      cluster.Padding = this.clusterPaddings.get(cluster);
    }

    if (this.edgeGeometry) {
      for (const [edge, snapshot] of this.edgeGeometry.entries()) {
        snapshot.restore(edge);
      }
    }

    for (const [tree, orientation] of this.treeOrientations.entries()) {
      tree.Orientation = orientation;
    }

    if (this.originalNodesRef && this.originalNodes) {
      this.originalNodesRef.length = this.originalNodes.length;
      for (let i = 0; i < this.originalNodes.length; i++) {
        this.originalNodesRef[i] = this.originalNodes[i];
      }
      graph.Nodes = this.originalNodesRef;
    }
  }

  Rollback(graph) {
    this.rollback(graph);
  }
}

export function newGraphStateSnapshot(options = {}) {
  const opts = options instanceof GraphStateSnapshotOptions
    ? options
    : new GraphStateSnapshotOptions(options);
  return new GraphState(opts);
}

export const NewGraphStateSnapshot = newGraphStateSnapshot;

export function restoreGraphState(graph, state) {
  if (state == null) {
    throw new Error("cannot restore a nil graph state");
  }
  if (graph == null) {
    throw new Error("cannot restore to a nil graph");
  }
  state.rollback(graph);
}

export const RestoreGraphState = restoreGraphState;
