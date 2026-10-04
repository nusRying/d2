// Slice 46 — CombineSubgraphs.
// Pinned reference: d2layouts/d2talalayout/internal/packing/combine.go
//
// Errors are thrown; on any error or exception the deferred Go rollback is
// reproduced with try/finally (node positions with TopLeft identity, node
// Graph ownership, and complete edge records with route-array identity).

import { Point } from '../geometry/point.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_EDGES, MAX_ENGINE_NODES, MAX_ENGINE_WORK_UNITS, MAX_ROUTE_POINTS } from '../limits/constants.js';
import { newGraph } from '../graph/graph.js';
import { Validate } from '../graph/topology-preflight.js';
import { copyEntitiesFrom } from '../graph/structural-access.js';
import { validateSubgraphCombination } from './combine-topology.js';
import { restoreCombineNodePositions, snapshotCombineNodePositions } from './combine-snapshot.js';
import { snapshotPoint, snapshotPointer } from './snapshot.js';
import { SUBGRAPH_PADDING, SUBGRAPH_SQUARE_DAMPENER } from './guard.js';
import { CONTAINER_PADDING, goID, goMax, goPow2, goSortSlice } from './go-support.js';

const TOPOLOGY_IDENTITY_FIELDS = [
  'Containers', 'Clusters', 'Trees', 'NodeToTree', 'Hubs', 'Sequences', 'Directions', 'CommonUncleSiblings',
];

/**
 * Go keys validated graph-owned topology by the identities of eight maps
 * (reflect.ValueOf(map).Pointer(); a nil map is 0). JS keys a trie of Maps by
 * the same eight references (null for a nil map).
 */
class TopologyIdentitySet {
  constructor() {
    this._root = new Map();
  }

  _path(graph, create) {
    let level = this._root;
    for (let i = 0; i < TOPOLOGY_IDENTITY_FIELDS.length; i++) {
      const key = graph[TOPOLOGY_IDENTITY_FIELDS[i]] ?? null;
      let next = level.get(key);
      if (next === undefined) {
        if (!create) return false;
        next = i === TOPOLOGY_IDENTITY_FIELDS.length - 1 ? true : new Map();
        level.set(key, next);
      }
      level = next;
    }
    return true;
  }

  has(graph) {
    return this._path(graph, false);
  }

  add(graph) {
    this._path(graph, true);
  }
}

// Shallow struct snapshot of an EdgeStyle value (Go copies the struct; the
// StyleScalar pointees are shared, exactly as in the Go snapshot).
function captureStyle(style) {
  if (style == null) return null;
  return { pointer: style, fields: { ...style } };
}

function restoreStyle(snapshot) {
  if (snapshot == null) return null;
  const target = snapshot.pointer;
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot.fields, key)) delete target[key];
  }
  Object.assign(target, snapshot.fields);
  return target;
}

/** captureCombineEdge (combine.go combineEdgeSnapshot). */
function captureCombineEdge(edge) {
  const points = edge.Points;
  return {
    value: { ...edge },
    style: captureStyle(edge.Style),
    points,
    pointsBacking: points == null ? null : points.slice(),
    pointValues: (points ?? []).map((point) => snapshotPoint(point)),
    label: snapshotPointer(edge.Label),
    sourceArrowheadLabel: snapshotPointer(edge.SourceArrowheadLabel),
    targetArrowheadLabel: snapshotPointer(edge.TargetArrowheadLabel),
  };
}

function restoreCombineEdge(snapshot, edge) {
  snapshot.label.restore();
  snapshot.sourceArrowheadLabel.restore();
  snapshot.targetArrowheadLabel.restore();
  for (const point of snapshot.pointValues) {
    point.restore();
  }
  if (snapshot.points != null) {
    snapshot.points.length = snapshot.pointsBacking.length;
    for (let i = 0; i < snapshot.pointsBacking.length; i++) {
      snapshot.points[i] = snapshot.pointsBacking[i];
    }
  }
  for (const key of Object.keys(edge)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot.value, key)) delete edge[key];
  }
  Object.assign(edge, snapshot.value);
  edge.Style = restoreStyle(snapshot.style);
  edge.Points = snapshot.points;
  edge.Label = snapshot.label.pointer;
  edge.SourceArrowheadLabel = snapshot.sourceArrowheadLabel.pointer;
  edge.TargetArrowheadLabel = snapshot.targetArrowheadLabel.pointer;
}

// Graph.Area (quality_api.go → graph.go area): unrounded bounds area.
function graphArea(graph) {
  if (graph.Nodes.length === 0) {
    return 0;
  }
  const [topLeft, bottomRight] = graph.boundingBox(false);
  return Math.abs(topLeft.X - bottomRight.X) * Math.abs(topLeft.Y - bottomRight.Y);
}

// geo.Box.Overlaps
function boxOverlaps(b1, b2) {
  return (b1.TopLeft.X < (b2.TopLeft.X + b2.Width)) && ((b1.TopLeft.X + b1.Width) > b2.TopLeft.X) &&
    (b1.TopLeft.Y < (b2.TopLeft.Y + b2.Height)) && ((b1.TopLeft.Y + b1.Height) > b2.TopLeft.Y);
}

/**
 * CombineSubgraphs arranges laid-out subgraphs and returns a combined graph
 * view that shares the master graph's topology.
 *
 * Go: func CombineSubgraphs(ctx, masterGraph, graphs, ancestorObstacles) (*layoutgraph.Graph, error)
 */
export function combineSubgraphs(ctx, masterGraph, graphs, ancestorObstacles) {
  if (masterGraph == null) {
    throw new Error('TALA CombineSubgraphs requires a master graph');
  }
  Validate(ctx, 'CombineSubgraphs', masterGraph);
  graphs = graphs ?? [];
  if (graphs.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA CombineSubgraphs subgraph count ${graphs.length} exceeds limit ${MAX_ENGINE_NODES}`);
  }
  // Identical map identities mean identical graph-owned topology, so that
  // expensive portion only needs one full preflight. Node-owned topology is
  // validated for every graph below as one distinct-record union.
  const validatedGraphOwnedTopologies = new TopologyIdentitySet();
  validatedGraphOwnedTopologies.add(masterGraph);
  const allGraphs = [masterGraph];
  for (const graph of graphs) {
    if (graph == null) {
      throw new Error('TALA CombineSubgraphs received a nil subgraph');
    }
    if (!validatedGraphOwnedTopologies.has(graph)) {
      Validate(ctx, 'CombineSubgraphs', graph);
      validatedGraphOwnedTopologies.add(graph);
    }
    allGraphs.push(graph);
  }
  validateSubgraphCombination(ctx, allGraphs);

  const guard = new WorkGuard(ctx, 'CombineSubgraphs', MAX_ENGINE_WORK_UNITS);
  const allNodes = [];
  const uniqueNodes = new Set();
  const edgeSnapshots = new Map();
  let routePointCapacity = 0;
  const collectGraph = (graph) => {
    for (const node of graph.Nodes ?? []) {
      guard.Step();
      if (node == null) {
        throw new Error('TALA CombineSubgraphs contains a nil node');
      }
      if (!uniqueNodes.has(node)) {
        uniqueNodes.add(node);
        if (uniqueNodes.size > MAX_ENGINE_NODES) {
          throw new Error(`TALA CombineSubgraphs unique node count exceeds limit ${MAX_ENGINE_NODES}`);
        }
        allNodes.push(node);
      }
    }
    for (const edge of graph.Edges ?? []) {
      guard.Step();
      if (edge == null) {
        throw new Error('TALA CombineSubgraphs contains a nil edge');
      }
      if (edge.From == null || edge.To == null) {
        throw new Error(`TALA CombineSubgraphs edge ${goID(edge.ID)} has missing endpoints`);
      }
      if (!edgeSnapshots.has(edge)) {
        if (edgeSnapshots.size >= MAX_ENGINE_EDGES) {
          throw new Error(`TALA CombineSubgraphs unique edge count exceeds limit ${MAX_ENGINE_EDGES}`);
        }
        const capacity = (edge.Points ?? []).length;
        if (capacity > MAX_ROUTE_POINTS - routePointCapacity) {
          throw new Error(`TALA CombineSubgraphs route point count exceeds limit ${MAX_ROUTE_POINTS}`);
        }
        routePointCapacity += capacity;
        for (const point of edge.Points ?? []) {
          guard.Step();
          if (point == null) {
            throw new Error(`TALA CombineSubgraphs edge ${goID(edge.ID)} contains a nil route point`);
          }
        }
        edgeSnapshots.set(edge, captureCombineEdge(edge));
      }
    }
  };
  collectGraph(masterGraph);
  for (const graph of graphs) {
    collectGraph(graph);
  }
  const nodeSnapshots = snapshotCombineNodePositions(ctx, allNodes);
  const nodeGraphReferences = new Map();
  for (const snapshot of nodeSnapshots) {
    nodeGraphReferences.set(snapshot.node, snapshot.node.Graph);
  }
  let complete = false;
  try {
    const combined = combineGuarded(masterGraph, graphs, ancestorObstacles ?? [], guard);
    complete = true;
    return combined;
  } finally {
    if (!complete) {
      restoreCombineNodePositions(nodeSnapshots);
      for (const [node, graph] of nodeGraphReferences) {
        node.Graph = graph;
      }
      for (const [edge, snapshot] of edgeSnapshots) {
        restoreCombineEdge(snapshot, edge);
      }
    }
  }
}

export const CombineSubgraphs = combineSubgraphs;

function combineGuarded(masterGraph, graphs, ancestorObstacles, guard) {
  const combined = newGraph();
  copyEntitiesFrom(combined, masterGraph);
  if (graphs.length === 0) {
    return combined;
  }

  const combinedBR = new Point(-Infinity, -Infinity);
  let candidatePoints = [];

  // first subgraph (contains all fixed nodes) is always placed at 0,0
  const firstGraph = graphs[0];
  if (firstGraph.hasFixedNode()) {
    graphs = graphs.slice(1);
    const [, graphBR] = firstGraph.BoundingBox();

    for (const n of firstGraph.Nodes) {
      guard.Step();
      combined.addNodeUnchecked(n);
      for (const child of masterGraph.allDescendantNodes(n, true)) {
        guard.Step();
        combined.addNodeUnchecked(child);
      }
    }
    for (const edge of firstGraph.Edges) {
      guard.Step();
      combined.AddEdge(edge);
    }

    combinedBR.X = goMax(combinedBR.X, graphBR.X);
    combinedBR.Y = goMax(combinedBR.Y, graphBR.Y);

    candidatePoints.push(
      new Point(graphBR.X, 0),
      new Point(graphBR.X, graphBR.Y),
      new Point(0, graphBR.Y),
      new Point(graphBR.X + SUBGRAPH_PADDING, 0),
      new Point(graphBR.X + SUBGRAPH_PADDING, graphBR.Y),
      new Point(0, graphBR.Y + SUBGRAPH_PADDING),
    );
  }

  // Go sort.Slice is unstable; ties between equal areas follow pdqsort exactly.
  const sortedByArea = graphs.slice();
  goSortSlice(sortedByArea, (a, b) => graphArea(a) > graphArea(b));
  guard.Finish();

  for (const graph of sortedByArea) {
    guard.Step();
    const [graphTL, graphBR] = graph.BoundingBox();

    let minCost = Infinity;
    let minOverlaps = Number.MAX_SAFE_INTEGER;
    // place the first graph at (0,0) so that combined's top left is always there
    let minCandidatePoint = new Point(0, 0);
    let minCandidatePointIndex = 0;

    for (let i = 0; i < candidatePoints.length; i++) {
      const candidatePoint = candidatePoints[i];
      guard.Step();
      // points relative to graph top left would now be relative to the candidate point
      const offsetX = candidatePoint.X - graphTL.X;
      const offsetY = candidatePoint.Y - graphTL.Y;

      let collides = false;
      let ancestorOverlaps = 0;
      for (const node of graph.Nodes) {
        guard.Step();
        node.moveWithChildren(offsetX, offsetY);
        for (const otherNode of combined.Nodes) {
          guard.Step();
          if (node.doesOverlap(otherNode)) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          for (const o of ancestorObstacles) {
            guard.Step();
            if (o.TopLeft.X === -CONTAINER_PADDING && o.TopLeft.Y === -CONTAINER_PADDING) {
              continue;
            }
            if (boxOverlaps(node.Box, o)) {
              ancestorOverlaps++;
            }
          }
        }
        node.moveWithChildren(-offsetX, -offsetY);
        if (collides) {
          break;
        }
      }
      if (collides) {
        continue;
      }
      if (ancestorOverlaps > minOverlaps) {
        continue;
      }

      const newWidth = goMax(combinedBR.X, candidatePoint.X + (graphBR.X - graphTL.X));
      const newHeight = goMax(combinedBR.Y, candidatePoint.Y + (graphBR.Y - graphTL.Y));
      // Heuristic: area plus dampened squared deviation from a square.
      const cost = newWidth * newHeight + goPow2(newWidth - newHeight) * SUBGRAPH_SQUARE_DAMPENER;

      if (ancestorOverlaps < minOverlaps || (ancestorOverlaps === minOverlaps && cost < minCost)) {
        minOverlaps = ancestorOverlaps;
        minCost = cost;
        minCandidatePoint = candidatePoint;
        minCandidatePointIndex = i;
      }
    }

    if (candidatePoints.length > 0) {
      // Remove the candidate point used (swap-with-last, as Go does)
      candidatePoints[minCandidatePointIndex] = candidatePoints[candidatePoints.length - 1];
      candidatePoints[candidatePoints.length - 1] = null;
      candidatePoints.length -= 1;
    }

    const offsetX = minCandidatePoint.X - graphTL.X;
    const offsetY = minCandidatePoint.Y - graphTL.Y;

    for (const n of graph.Nodes) {
      guard.Step();
      n.moveWithChildren(offsetX, offsetY);
      combined.addNodeUnchecked(n);
      for (const child of masterGraph.allDescendantNodes(n, true)) {
        guard.Step();
        combined.addNodeUnchecked(child);
      }
    }
    for (const edge of graph.Edges) {
      guard.Step();
      for (const point of edge.Points ?? []) {
        guard.Step();
        point.X += offsetX;
        point.Y += offsetY;
      }
      combined.AddEdge(edge);
    }

    graphTL.X += offsetX;
    graphTL.Y += offsetY;
    graphBR.X += offsetX;
    graphBR.Y += offsetY;

    combinedBR.X = goMax(combinedBR.X, graphBR.X);
    combinedBR.Y = goMax(combinedBR.Y, graphBR.Y);

    candidatePoints.push(
      new Point(graphBR.X, graphTL.Y),
      new Point(graphBR.X, graphBR.Y),
      new Point(graphTL.X, graphBR.Y),
      new Point(graphBR.X + SUBGRAPH_PADDING, graphTL.Y),
      new Point(graphBR.X + SUBGRAPH_PADDING, graphBR.Y),
      new Point(graphTL.X, graphBR.Y + SUBGRAPH_PADDING),
    );
  }

  guard.Finish();
  return combined;
}
