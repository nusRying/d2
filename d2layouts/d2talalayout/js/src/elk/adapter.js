import { Graph } from "../graph/graph.js";
import { Node } from "../graph/node.js";
import { Label } from "../graph/label.js";
import { Point } from "../geometry/point.js";
import { Orientation } from "../geometry/orientation.js";
import { LabelPosition, normalizeLabelPosition } from "../graph/label-position.js";
import { allocateD2EntityIDs } from "../graph/entity-id.js";
import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_ENGINE_ROUTE_POINTS,
  MAX_ENGINE_TREE_DEPTH,
} from "../limits/constants.js";

/**
 * ELK public adapter (ADR-001).
 *
 * The public contract is ELK-compatible JSON. The D2-specific Go adapter
 * (adapter.go / patch.go) is not ported literally; only its safety
 * principles are kept (adapter_validate.go, limits.go): inputs are bounded
 * before expensive work, every traversal whose depth is input-controlled is
 * iterative, the caller's object is never mutated, and the output only
 * rewrites layout-owned fields.
 */

// ELK direction option keys, in precedence order.
export const ELK_DIRECTION_KEYS = Object.freeze(["elk.direction", "org.eclipse.elk.direction"]);

// Go adapter.go parseDirection: up->Top, down->Bottom, left->Left, right->Right.
const DIRECTION_TO_ORIENTATION = Object.freeze({
  UP: Orientation.Top,
  DOWN: Orientation.Bottom,
  LEFT: Orientation.Left,
  RIGHT: Orientation.Right,
});

/**
 * parseElkDirection maps an ELK direction string (case-insensitive) to a TALA
 * Orientation. Unknown, missing, or non-string values return Orientation.NONE.
 */
export function parseElkDirection(value) {
  if (typeof value !== "string") return Orientation.NONE;
  const o = DIRECTION_TO_ORIENTATION[value.trim().toUpperCase()];
  return o === undefined ? Orientation.NONE : o;
}

function readElkDirection(elkElement) {
  const options = elkElement.layoutOptions;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    return Orientation.NONE;
  }
  for (const key of ELK_DIRECTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return parseElkDirection(options[key]);
    }
  }
  return Orientation.NONE;
}

function validateArray(arr, name, context) {
  if (arr !== undefined && arr !== null && !Array.isArray(arr)) {
    throw new Error(`Invalid ELK graph: ${name} must be an array on ${context}`);
  }
  return arr || [];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDimension(value, field, context) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ELK ${context}: ${field} must be a finite non-negative number`);
  }
  return value;
}

function readCoordinate(value, field, context) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ELK ${context}: ${field} must be a finite number`);
  }
  return value;
}

function readLabel(owner, kind, ownerId) {
  const labels = validateArray(owner.labels, "labels", `${kind} "${ownerId}"`);
  if (labels.length === 0) return null;
  if (labels.length > 1) {
    throw new Error(`TALA ELK adapter supports at most one ${kind} label per ${kind}`);
  }
  const elkLabel = labels[0];
  if (!isPlainObject(elkLabel)) {
    throw new Error(`Invalid ELK label on ${kind} "${ownerId}": must be an object`);
  }
  const context = `label on ${kind} "${ownerId}"`;
  const width = readDimension(elkLabel.width, "width", context);
  const height = readDimension(elkLabel.height, "height", context);
  const text = typeof elkLabel.text === "string" ? elkLabel.text : "";
  // Position deliberately stays Unset: label placement is layout-owned.
  return new Label(text, width, height);
}

function countSectionPoints(sections, edgeId) {
  let count = 0;
  for (const section of sections) {
    if (!isPlainObject(section)) {
      throw new Error(`Invalid ELK edge "${edgeId}": section must be an object`);
    }
    if (section.startPoint !== undefined) count++;
    if (section.endPoint !== undefined) count++;
    count += validateArray(section.bendPoints, "bendPoints", `edge "${edgeId}"`).length;
  }
  return count;
}

/**
 * scanElkGraph walks the ELK tree iteratively (pre-order, children in input
 * order), validating shape and enforcing engine bounds before any engine
 * object is allocated. It returns nodes (with their parent and depth) and
 * edges in the same order the recursive collector historically produced.
 */
function scanElkGraph(elkGraph) {
  const seenNodeIds = new Set();
  const seenEdgeIds = new Set();
  const nodes = []; // { elk, parent (elk|null) }
  const edges = []; // { elk, owner (elk|null) }
  let edgeCount = 0;
  let routePoints = 0;

  function collectEdges(list, owner) {
    edgeCount += list.length;
    if (edgeCount > MAX_ENGINE_EDGES) {
      throw new Error(`Invalid ELK graph: edge count exceeds the limit of ${MAX_ENGINE_EDGES}`);
    }
    for (const edge of list) {
      if (!isPlainObject(edge) || typeof edge.id !== "string" || edge.id === "") {
        throw new Error("Invalid ELK edge: missing id");
      }
      if (seenEdgeIds.has(edge.id)) {
        throw new Error(`Invalid ELK graph: duplicate edge id "${edge.id}"`);
      }
      seenEdgeIds.add(edge.id);
      const sections = validateArray(edge.sections, "sections", `edge "${edge.id}"`);
      routePoints += countSectionPoints(sections, edge.id);
      if (routePoints > MAX_ENGINE_ROUTE_POINTS) {
        throw new Error(
          `Invalid ELK graph: route point count exceeds the limit of ${MAX_ENGINE_ROUTE_POINTS}`,
        );
      }
      edges.push({ elk: edge, owner });
    }
  }

  const rootChildren = validateArray(elkGraph.children, "children", "root graph");
  const rootEdges = validateArray(elkGraph.edges, "edges", "root graph");
  if (rootChildren.length > MAX_ENGINE_NODES) {
    throw new Error(`Invalid ELK graph: node count exceeds the limit of ${MAX_ENGINE_NODES}`);
  }

  // Explicit stack; entries pushed in reverse so pops follow input order.
  const stack = [];
  for (let i = rootChildren.length - 1; i >= 0; i--) {
    stack.push({ elk: rootChildren[i], parent: null, depth: 1 });
  }
  while (stack.length > 0) {
    const { elk, parent, depth } = stack.pop();
    if (!isPlainObject(elk) || typeof elk.id !== "string" || elk.id === "") {
      throw new Error("Invalid ELK node: missing id");
    }
    if (depth > MAX_ENGINE_TREE_DEPTH) {
      throw new Error(
        `Invalid ELK graph: nesting depth exceeds the limit of ${MAX_ENGINE_TREE_DEPTH} at node "${elk.id}"`,
      );
    }
    if (seenNodeIds.has(elk.id)) {
      throw new Error(`Invalid ELK graph: duplicate node id "${elk.id}"`);
    }
    seenNodeIds.add(elk.id);
    nodes.push({ elk, parent });
    if (nodes.length + stack.length > MAX_ENGINE_NODES) {
      throw new Error(`Invalid ELK graph: node count exceeds the limit of ${MAX_ENGINE_NODES}`);
    }

    collectEdges(validateArray(elk.edges, "edges", `node "${elk.id}"`), elk);

    const children = validateArray(elk.children, "children", `node "${elk.id}"`);
    if (nodes.length + stack.length + children.length > MAX_ENGINE_NODES) {
      throw new Error(`Invalid ELK graph: node count exceeds the limit of ${MAX_ENGINE_NODES}`);
    }
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ elk: children[i], parent: elk, depth: depth + 1 });
    }
  }

  collectEdges(rootEdges, null);
  return { nodes, edges };
}

/**
 * elkToTalaGraph converts an ELK JSON payload into a TALA structural Graph model.
 * It allocates stable EntityIDs and maps ELK's relative coordinates into absolute coordinates.
 */
export function elkToTalaGraph(elkGraph) {
  if (!elkGraph || typeof elkGraph !== "object" || Array.isArray(elkGraph)) {
    throw new Error("Invalid ELK graph: must be an object");
  }

  if (typeof elkGraph.id !== "string") {
    throw new Error("Invalid ELK graph: missing id");
  }

  // Bounds + structural validation before any expensive allocation.
  const scan = scanElkGraph(elkGraph);

  const graph = new Graph();
  graph.ID = elkGraph.id;
  graph.elkData = structuredClone(elkGraph);
  const endpoints = graph.endpoints;

  const nodeIDs = allocateD2EntityIDs(scan.nodes.map((n) => ({ entity: n.elk, absID: n.elk.id })));
  const edgeIDs = allocateD2EntityIDs(scan.edges.map((e) => ({ entity: e.elk, absID: e.elk.id })));

  const rootDirection = readElkDirection(elkGraph);
  if (rootDirection !== Orientation.NONE) {
    graph.Directions.set(null, rootDirection);
  }

  function registerEndpoint(id, entity) {
    if (endpoints.has(id)) {
      throw new Error(`Invalid ELK graph: duplicate endpoint id "${id}"`);
    }
    endpoints.set(id, entity);
  }

  // Pass 2: build hierarchy (pre-order, so parents exist before children).
  const elkToNode = new Map();
  for (const { elk: elkNode, parent } of scan.nodes) {
    const context = `node "${elkNode.id}"`;
    const width = readDimension(elkNode.width, "width", context);
    const height = readDimension(elkNode.height, "height", context);
    const relX = readCoordinate(elkNode.x, "x", context);
    const relY = readCoordinate(elkNode.y, "y", context);

    const containerNode = parent === null ? null : elkToNode.get(parent);
    const absX = containerNode === null ? 0 : containerNode.TopLeft.X;
    const absY = containerNode === null ? 0 : containerNode.TopLeft.Y;

    const node = new Node(nodeIDs.get(elkNode), width, height);
    node.D2ID = elkNode.id;
    node.elkData = structuredClone(elkNode);
    node.TopLeft = new Point(absX + relX, absY + relY);
    node.Label = readLabel(elkNode, "node", elkNode.id);

    elkToNode.set(elkNode, node);
    graph.addNewNodeToContainer(containerNode, node);
    graph.nodesByExternalId.set(node.D2ID, node);
    graph.nodesByEntityId.set(node.ID, node);

    const direction = readElkDirection(elkNode);
    if (direction !== Orientation.NONE) {
      graph.Directions.set(node, direction);
    }

    registerEndpoint(node.D2ID, { kind: "node", node });

    const ports = validateArray(elkNode.ports, "ports", context);
    for (const port of ports) {
      if (!isPlainObject(port) || typeof port.id !== "string" || port.id === "") {
        throw new Error(`Invalid ELK port: missing id on node "${node.D2ID}"`);
      }
      registerEndpoint(port.id, { kind: "port", node, port: structuredClone(port) });
    }
  }

  // Pass 3: build edges.
  for (const { elk: elkEdge } of scan.edges) {
    const sources = validateArray(elkEdge.sources, "sources", `edge "${elkEdge.id}"`);
    const targets = validateArray(elkEdge.targets, "targets", `edge "${elkEdge.id}"`);

    if (sources.length !== 1) throw new Error(`ELK hyperedges are not supported yet: edge "${elkEdge.id}" has ${sources.length} sources`);
    if (targets.length !== 1) throw new Error(`ELK hyperedges are not supported yet: edge "${elkEdge.id}" has ${targets.length} targets`);

    const sourceEndpointId = sources[0];
    const targetEndpointId = targets[0];

    if (typeof sourceEndpointId !== "string") {
      throw new Error(`Invalid ELK edge "${elkEdge.id}": source endpoint must be a string`);
    }
    if (typeof targetEndpointId !== "string") {
      throw new Error(`Invalid ELK edge "${elkEdge.id}": target endpoint must be a string`);
    }

    const sourceEndpoint = endpoints.get(sourceEndpointId);
    if (!sourceEndpoint) throw new Error(`Invalid ELK edge "${elkEdge.id}": source endpoint "${sourceEndpointId}" does not exist`);

    const targetEndpoint = endpoints.get(targetEndpointId);
    if (!targetEndpoint) throw new Error(`Invalid ELK edge "${elkEdge.id}": target endpoint "${targetEndpointId}" does not exist`);

    const label = readLabel(elkEdge, "edge", elkEdge.id);

    const edge = graph.connect(sourceEndpoint.node, targetEndpoint.node);
    edge.ID = edgeIDs.get(elkEdge);
    edge.D2ID = elkEdge.id;
    edge.sourceEndpointId = sourceEndpointId;
    edge.targetEndpointId = targetEndpointId;
    edge.elkData = structuredClone(elkEdge);
    edge.route = structuredClone(elkEdge.sections ?? []);
    edge.Label = label;

    graph.edgesByExternalId.set(edge.D2ID, edge);
    graph.edgesByEntityId.set(edge.ID, edge);
  }

  return graph;
}

function finiteOutput(value, what) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`TALA ELK adapter produced non-finite ${what}`);
  }
  return value;
}

function hasPosition(label) {
  return label != null && normalizeLabelPosition(label.Position) !== LabelPosition.Unset;
}

function singleElkLabel(elkElement) {
  return Array.isArray(elkElement.labels) && elkElement.labels.length === 1 && isPlainObject(elkElement.labels[0])
    ? elkElement.labels[0]
    : null;
}

function relativePoint(p, ox, oy, edgeId) {
  return {
    x: finiteOutput(p.X - ox, `route point for edge "${edgeId}"`),
    y: finiteOutput(p.Y - oy, `route point for edge "${edgeId}"`),
  };
}

function writeEdge(elkEdge, edge, ox, oy) {
  const points = Array.isArray(edge.Points) ? edge.Points : [];
  if (points.length >= 2) {
    const section = {};
    const original = Array.isArray(elkEdge.sections) ? elkEdge.sections[0] : undefined;
    if (isPlainObject(original) && original.id !== undefined) {
      section.id = original.id;
    }
    section.startPoint = relativePoint(points[0], ox, oy, elkEdge.id);
    section.bendPoints = [];
    for (let i = 1; i < points.length - 1; i++) {
      section.bendPoints.push(relativePoint(points[i], ox, oy, elkEdge.id));
    }
    section.endPoint = relativePoint(points[points.length - 1], ox, oy, elkEdge.id);
    elkEdge.sections = [section];

    const elkLabel = singleElkLabel(elkEdge);
    if (elkLabel !== null && hasPosition(edge.Label)) {
      const tl = edge.labelTopLeft(edge.Label.Position, edge.Label.Width, edge.Label.Height);
      if (tl != null) {
        const what = `label geometry for edge "${elkEdge.id}"`;
        elkLabel.x = finiteOutput(tl.X - ox, what);
        elkLabel.y = finiteOutput(tl.Y - oy, what);
      }
    }
  } else if (edge.route && edge.route.length > 0) {
    elkEdge.sections = structuredClone(edge.route);
  }

  const elkLabel = singleElkLabel(elkEdge);
  if (elkLabel !== null && edge.Label != null) {
    const what = `label geometry for edge "${elkEdge.id}"`;
    elkLabel.width = finiteOutput(edge.Label.Width, what);
    elkLabel.height = finiteOutput(edge.Label.Height, what);
  }
}

function writeNode(elkNode, node, parentAbsX, parentAbsY) {
  const what = `geometry for node "${elkNode.id}"`;
  elkNode.width = finiteOutput(node.Width, what);
  elkNode.height = finiteOutput(node.Height, what);
  const tl = node.TopLeft;
  elkNode.x = tl ? finiteOutput(tl.X - parentAbsX, what) : 0;
  elkNode.y = tl ? finiteOutput(tl.Y - parentAbsY, what) : 0;

  const elkLabel = singleElkLabel(elkNode);
  if (elkLabel !== null && node.Label != null) {
    const lwhat = `label geometry for node "${elkNode.id}"`;
    if (tl && hasPosition(node.Label)) {
      const ltl = node.labelTopLeft(node.Label.Position, node.Label.Width, node.Label.Height);
      elkLabel.x = finiteOutput(ltl.X - tl.X, lwhat);
      elkLabel.y = finiteOutput(ltl.Y - tl.Y, lwhat);
    }
    elkLabel.width = finiteOutput(node.Label.Width, lwhat);
    elkLabel.height = finiteOutput(node.Label.Height, lwhat);
  }
}

/**
 * talaToElkGraph writes engine geometry back onto a deep copy of the original
 * ELK payload. Only layout-owned fields are rewritten: node x/y/width/height,
 * the managed label's x/y/width/height, and edge sections. Coordinates are
 * converted from absolute engine space to ELK owner-relative space.
 */
export function talaToElkGraph(graph) {
  if (!graph || typeof graph !== "object" || !isPlainObject(graph.elkData)) {
    throw new Error("Invalid TALA graph: missing ELK source data");
  }
  const output = structuredClone(graph.elkData);

  // Iterative walk: { elk, absX, absY } where abs is the owner's absolute offset.
  const stack = [{ elk: output, absX: 0, absY: 0, isRoot: true }];
  while (stack.length > 0) {
    const { elk, absX, absY, isRoot } = stack.pop();

    let ownAbsX = absX;
    let ownAbsY = absY;
    if (!isRoot) {
      const node = graph.nodesByExternalId.get(elk.id);
      if (node) {
        writeNode(elk, node, absX, absY);
      }
      ownAbsX = absX + (typeof elk.x === "number" ? elk.x : 0);
      ownAbsY = absY + (typeof elk.y === "number" ? elk.y : 0);
    }

    if (Array.isArray(elk.edges)) {
      for (const elkEdge of elk.edges) {
        if (!isPlainObject(elkEdge)) continue;
        const edge = graph.edgesByExternalId.get(elkEdge.id);
        if (edge) writeEdge(elkEdge, edge, ownAbsX, ownAbsY);
      }
    }

    if (Array.isArray(elk.children)) {
      for (let i = elk.children.length - 1; i >= 0; i--) {
        const child = elk.children[i];
        if (isPlainObject(child)) {
          stack.push({ elk: child, absX: ownAbsX, absY: ownAbsY, isRoot: false });
        }
      }
    }
  }

  return output;
}
