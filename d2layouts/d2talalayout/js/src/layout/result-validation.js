// Port of top-level result_validate.go (and maxResultCoordinate from
// limits.go).
//
// Pinned Go authority: d2layouts/d2talalayout/result_validate.go.
//
// JS conventions: Go `error` returns become thrown Errors; Go
// `fmt.Errorf("...: %w", err)` becomes `new Error("...: " + err.message,
// { cause: err })`; `ctx.Err()` checks throw the context's own error value.
// Go map iteration over missing-edge IDs is randomized; JS reports the first
// missing ID in input-edge order. When exactly one ID is missing the message
// is identical.
import { SequenceDefiningEdges } from "../grouping/sequences-analysis.js";
import { normalizeLabelPosition, LabelPosition } from "../graph/label-position.js";
import { talaFontSizes } from "../placement/prescale.js";
import { goFormatFloat } from "../routing/layoutgraph-route-support.js";
import { getContextError } from "../limits/work-context.js";

/** maxResultCoordinate (limits.go). */
export const maxResultCoordinate = 1_000_000_000;

/** d2fonts.FontSizes: the layout output font-size domain. */
const RESULT_FONT_SIZES = Object.freeze(talaFontSizes());

const EDGE_STYLE_FIELDS = Object.freeze([
  "Opacity",
  "Stroke",
  "Fill",
  "FillPattern",
  "StrokeWidth",
  "StrokeDash",
  "BorderRadius",
  "Shadow",
  "ThreeDee",
  "Multiple",
  "Font",
  "FontSize",
  "FontColor",
  "Animated",
  "Bold",
  "Italic",
  "Underline",
  "Filled",
  "DoubleBorder",
  "TextTransform",
]);

function checkContext(ctx) {
  const err = getContextError(ctx);
  if (err != null) {
    throw err;
  }
}

function wrap(prefix, err) {
  return new Error(`${prefix}: ${err.message}`, { cause: err });
}

/** Go %q for the plain strings carried by shape types. */
function goQuote(value) {
  const text = String(value ?? "");
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    switch (ch) {
      case '"': out += '\\"'; continue;
      case "\\": out += "\\\\"; continue;
      case "\n": out += "\\n"; continue;
      case "\t": out += "\\t"; continue;
      case "\r": out += "\\r"; continue;
      case "\x07": out += "\\a"; continue;
      case "\b": out += "\\b"; continue;
      case "\f": out += "\\f"; continue;
      case "\v": out += "\\v"; continue;
      default:
        break;
    }
    if (code < 0x20 || code === 0x7f) {
      out += "\\x" + code.toString(16).padStart(2, "0");
    } else {
      out += ch;
    }
  }
  return out + '"';
}

function labelPosition(position) {
  return normalizeLabelPosition(position);
}

/**
 * validateLayoutResultTopology binds a completed workspace to its immutable
 * input while allowing sequence-defining edges to be consumed by the
 * layoutgraph. Returns the Set of sequence-defining edge IDs.
 */
export function validateLayoutResultTopology(ctx, expected, actual) {
  const sequenceEdges = SequenceDefiningEdges(ctx, expected);
  validateTopology(ctx, expected, actual, sequenceEdges);
  return sequenceEdges;
}

function allowedHas(allowedMissingEdges, id) {
  return allowedMissingEdges != null && allowedMissingEdges.has(id);
}

/** validateTopology (result_validate.go). Throws on mismatch. */
export function validateTopology(ctx, expected, actual, allowedMissingEdges) {
  if (expected == null || actual == null) {
    throw new Error("cannot compare nil graph topology");
  }
  if (expected.Nodes.length !== actual.Nodes.length) {
    throw new Error(`node count changed from ${expected.Nodes.length} to ${actual.Nodes.length}`);
  }
  const expectedNodes = new Set();
  for (const node of expected.Nodes) {
    checkContext(ctx);
    if (node == null) {
      throw new Error("input contains a nil node");
    }
    if (expectedNodes.has(node.ID)) {
      throw new Error(`input contains duplicate node ID ${node.ID}`);
    }
    expectedNodes.add(node.ID);
  }
  for (const node of actual.Nodes) {
    checkContext(ctx);
    if (!expectedNodes.has(node.ID)) {
      throw new Error(`result contains unexpected node ID ${node.ID}`);
    }
  }

  const expectedEdges = new Map();
  for (const edge of expected.Edges) {
    checkContext(ctx);
    if (edge == null || edge.From == null || edge.To == null) {
      throw new Error("input contains an edge with a nil endpoint");
    }
    if (expectedEdges.has(edge.ID)) {
      throw new Error(`input contains duplicate edge ID ${edge.ID}`);
    }
    expectedEdges.set(edge.ID, { from: edge.From.ID, to: edge.To.ID });
  }
  const actualEdges = new Set();
  for (const edge of actual.Edges) {
    checkContext(ctx);
    if (edge == null || edge.From == null || edge.To == null) {
      throw new Error("result contains an edge with a nil endpoint");
    }
    if (actualEdges.has(edge.ID)) {
      throw new Error(`result contains duplicate edge ID ${edge.ID}`);
    }
    actualEdges.add(edge.ID);
    const want = expectedEdges.get(edge.ID);
    if (want === undefined) {
      throw new Error(`result contains unexpected edge ID ${edge.ID}`);
    }
    if (edge.From.ID !== want.from || edge.To.ID !== want.to) {
      throw new Error(
        `edge ${edge.ID} endpoints changed from ${want.from}->${want.to} to ${edge.From.ID}->${edge.To.ID}`,
      );
    }
  }
  for (const id of expectedEdges.keys()) {
    checkContext(ctx);
    if (actualEdges.has(id)) continue;
    if (allowedHas(allowedMissingEdges, id)) continue;
    throw new Error(`result is missing edge ID ${id}`);
  }
}

/**
 * validateLayoutResultMetadata checks the immutable geometry semantics that a
 * completed layout attempt must preserve (result_validate.go).
 */
export function validateLayoutResultMetadata(ctx, expected, actual, allowedMissingEdges) {
  if (expected == null || actual == null) {
    throw new Error("cannot compare nil graph metadata");
  }
  checkContext(ctx);
  if (Boolean(expected.IsRootHierarchy) !== Boolean(actual.IsRootHierarchy)) {
    throw new Error("root hierarchy metadata changed");
  }
  if (!sameDirectionMetadata(ctx, expected, actual)) {
    throw new Error("graph direction metadata changed");
  }

  const expectedNodes = new Map();
  for (const node of expected.Nodes) {
    checkContext(ctx);
    if (node == null) {
      throw new Error("input contains a nil node");
    }
    expectedNodes.set(node.ID, node);
  }
  for (const node of actual.Nodes) {
    checkContext(ctx);
    if (node == null) {
      throw new Error("result contains a nil node");
    }
    const input = expectedNodes.get(node.ID);
    if (input == null) {
      throw new Error(`result contains unexpected node ID ${node.ID}`);
    }
    if (input.shapeType() !== node.shapeType()) {
      throw new Error(
        `node ${node.ID} shape changed from ${goQuote(input.shapeType())} to ${goQuote(node.shapeType())}`,
      );
    }
    if ((input.Container == null) !== (node.Container == null) ||
      (input.Container != null && input.Container.ID !== node.Container.ID)) {
      throw new Error(`node ${node.ID} container ownership changed`);
    }
    if (input.numColumns() !== node.numColumns()) {
      throw new Error(
        `node ${node.ID} table column count changed from ${input.numColumns()} to ${node.numColumns()}`,
      );
    }
    if (Boolean(input.Is3D) !== Boolean(node.Is3D)) {
      throw new Error(`node ${node.ID} 3D outline metadata changed`);
    }
    if (Boolean(input.IsMultiple) !== Boolean(node.IsMultiple)) {
      throw new Error(`node ${node.ID} multiple outline metadata changed`);
    }
    if (Boolean(input.IsInvisible) !== Boolean(node.IsInvisible)) {
      throw new Error(`node ${node.ID} visibility metadata changed`);
    }
    if (!sameOptionalValue(input.FixedTopLeft, node.FixedTopLeft)) {
      throw new Error(`node ${node.ID} fixed position metadata changed`);
    }
    if (!sameOptionalValue(input.DesiredWidth, node.DesiredWidth) ||
      !sameOptionalValue(input.DesiredHeight, node.DesiredHeight)) {
      throw new Error(`node ${node.ID} desired-size metadata changed`);
    }
    if (Boolean(input.ForceHierarchy) !== Boolean(node.ForceHierarchy)) {
      throw new Error(`node ${node.ID} forced-hierarchy metadata changed`);
    }
    if (!sameLabelIdentity(input.Label, node.Label)) {
      throw new Error(`node ${node.ID} label identity changed`);
    }
    if (input.Label != null && labelPosition(input.Label.Position) !== LabelPosition.Unset &&
      labelPosition(input.Label.Position) !== labelPosition(node.Label.Position)) {
      throw new Error(`node ${node.ID} fixed label position changed`);
    }
    if ((input.Icon == null) !== (node.Icon == null)) {
      throw new Error(`node ${node.ID} icon presence changed`);
    }
    if (input.Icon != null && labelPosition(input.Icon.Position) !== LabelPosition.Unset &&
      labelPosition(input.Icon.Position) !== labelPosition(node.Icon.Position)) {
      throw new Error(`node ${node.ID} fixed icon position changed`);
    }
    if (!isValidResultFontSize(input.FontSize, node.FontSize)) {
      throw new Error(`node ${node.ID} font size is outside the layout output domain`);
    }
  }

  const expectedEdges = new Map();
  for (const edge of expected.Edges) {
    checkContext(ctx);
    if (edge == null) {
      throw new Error("input contains a nil edge");
    }
    expectedEdges.set(edge.ID, edge);
  }
  const actualEdges = new Set();
  for (const edge of actual.Edges) {
    checkContext(ctx);
    if (edge == null) {
      throw new Error("result contains a nil edge");
    }
    actualEdges.add(edge.ID);
    const input = expectedEdges.get(edge.ID);
    if (input == null) {
      throw new Error(`result contains unexpected edge ID ${edge.ID}`);
    }
    if (input.SourceArrowhead !== edge.SourceArrowhead || input.TargetArrowhead !== edge.TargetArrowhead) {
      throw new Error(`edge ${edge.ID} arrowhead metadata changed`);
    }
    if (!sameImmutableLabel(input.SourceArrowheadLabel, edge.SourceArrowheadLabel)) {
      throw new Error(`edge ${edge.ID} source arrowhead label metadata changed`);
    }
    if (!sameImmutableLabel(input.TargetArrowheadLabel, edge.TargetArrowheadLabel)) {
      throw new Error(`edge ${edge.ID} target arrowhead label metadata changed`);
    }
    if (input.MinWidth !== edge.MinWidth || input.MinHeight !== edge.MinHeight) {
      throw new Error(`edge ${edge.ID} minimum geometry changed`);
    }
    if (!sameOptionalValue(input.FromTableColumnIndex, edge.FromTableColumnIndex) ||
      !sameOptionalValue(input.ToTableColumnIndex, edge.ToTableColumnIndex)) {
      throw new Error(`edge ${edge.ID} table column attachment metadata changed`);
    }
    if (Boolean(input.IsInvisible) !== Boolean(edge.IsInvisible)) {
      throw new Error(`edge ${edge.ID} visibility metadata changed`);
    }
    if (!sameImmutableEdgeStyle(input.Style, edge.Style)) {
      throw new Error(`edge ${edge.ID} style metadata changed`);
    }
    if (!sameEdgeLabelMetadata(input.Label, edge.Label)) {
      throw new Error(`edge ${edge.ID} label identity or dimensions changed`);
    }
  }
  for (const id of expectedEdges.keys()) {
    checkContext(ctx);
    if (actualEdges.has(id)) continue;
    if (allowedHas(allowedMissingEdges, id)) continue;
    throw new Error(`result is missing edge ID ${id}`);
  }
}

/** sameLabelIdentity: nil-ness and Text only. */
export function sameLabelIdentity(expected, actual) {
  if (expected == null || actual == null) {
    return expected == null && actual == null;
  }
  return expected.Text === actual.Text;
}

/** sameEdgeLabelMetadata: Text, Width, Height. */
export function sameEdgeLabelMetadata(expected, actual) {
  if (expected == null || actual == null) {
    return expected == null && actual == null;
  }
  return expected.Text === actual.Text &&
    expected.Width === actual.Width &&
    expected.Height === actual.Height;
}

/** sameImmutableLabel: Text, Position, Width, Height. */
export function sameImmutableLabel(expected, actual) {
  if (expected == null || actual == null) {
    return expected == null && actual == null;
  }
  return expected.Text === actual.Text &&
    labelPosition(expected.Position) === labelPosition(actual.Position) &&
    expected.Width === actual.Width &&
    expected.Height === actual.Height;
}

function styleField(style, name) {
  if (style == null) return null;
  const value = style[name];
  return value == null ? null : value;
}

/**
 * sameImmutableEdgeStyle compares every EdgeStyle scalar pointer. A null JS
 * Style is Go's zero EdgeStyle (all fields nil).
 */
export function sameImmutableEdgeStyle(expected, actual) {
  for (const name of EDGE_STYLE_FIELDS) {
    if (!sameOptionalValue(styleField(expected, name), styleField(actual, name))) {
      return false;
    }
  }
  return true;
}

function sameDereferencedValue(expected, actual) {
  if (typeof expected === "object" && typeof actual === "object") {
    // geo.Point
    if ("X" in expected || "Y" in expected) {
      return expected.X === actual.X && expected.Y === actual.Y;
    }
    // StyleScalar{Value string}
    if ("Value" in expected || "Value" in actual) {
      return expected.Value === actual.Value;
    }
    return expected === actual;
  }
  return expected === actual;
}

/**
 * sameOptionalValue mirrors Go's generic pointer comparison: two nils are
 * equal, one nil is unequal, otherwise the pointees compare with ==.
 * JS null/undefined model nil.
 */
export function sameOptionalValue(expected, actual) {
  if (expected == null || actual == null) {
    return expected == null && actual == null;
  }
  return sameDereferencedValue(expected, actual);
}

/** isValidResultFontSize (result_validate.go). */
export function isValidResultFontSize(expected, actual) {
  if (expected == null || actual == null) {
    return expected == null && actual == null;
  }
  return actual === expected || RESULT_FONT_SIZES.includes(actual);
}

/**
 * sameDirectionMetadata compares graph directions under canonical keys (root
 * or node EntityID). Throws when a graph repeats a canonical key.
 */
export function sameDirectionMetadata(ctx, expected, actual) {
  const canonical = (graph) => {
    const directions = new Map();
    for (const [node, direction] of graph.Directions.entries()) {
      checkContext(ctx);
      const key = node == null ? "root" : `id:${node.ID}`;
      if (directions.has(key)) {
        throw new Error("graph direction metadata repeats a canonical key");
      }
      directions.set(key, direction);
    }
    return directions;
  };
  const expectedDirections = canonical(expected);
  const actualDirections = canonical(actual);
  if (expectedDirections.size !== actualDirections.size) {
    return false;
  }
  for (const [key, direction] of expectedDirections.entries()) {
    checkContext(ctx);
    if (!actualDirections.has(key) || actualDirections.get(key) !== direction) {
      return false;
    }
  }
  return true;
}

/** validateCompletedGraph (result_validate.go). */
export function validateCompletedGraph(ctx, graph) {
  if (graph == null) {
    throw new Error("graph is nil");
  }
  const nodes = new Set();
  const nodeIDs = new Set();
  graph.Nodes.forEach((node, index) => {
    checkContext(ctx);
    if (node == null) {
      throw new Error(`node ${index} is nil`);
    }
    if (nodes.has(node)) {
      throw new Error(`node ${node.ID} is repeated`);
    }
    nodes.add(node);
    if (nodeIDs.has(node.ID)) {
      throw new Error(`node ID ${node.ID} is duplicated`);
    }
    nodeIDs.add(node.ID);
    validateResultNode(node);
  });

  const edges = new Set();
  const edgeIDs = new Set();
  graph.Edges.forEach((edge, index) => {
    checkContext(ctx);
    if (edge == null) {
      throw new Error(`edge ${index} is nil`);
    }
    if (edges.has(edge)) {
      throw new Error(`edge ${edge.ID} is repeated`);
    }
    edges.add(edge);
    if (edgeIDs.has(edge.ID)) {
      throw new Error(`edge ID ${edge.ID} is duplicated`);
    }
    edgeIDs.add(edge.ID);
    if (edge.From == null || !nodes.has(edge.From)) {
      throw new Error(`edge ${edge.ID} has a source outside the result graph`);
    }
    if (edge.To == null || !nodes.has(edge.To)) {
      throw new Error(`edge ${edge.ID} has a destination outside the result graph`);
    }
    validateResultEdge(ctx, edge);
  });
}

/** validateResultNode (result_validate.go). */
export function validateResultNode(node) {
  if (node == null) {
    throw new Error("node is nil");
  }
  if (node.TopLeft == null) {
    throw new Error(`node ${node.ID} has no position`);
  }
  const prefixed = (fn) => {
    try {
      fn();
    } catch (err) {
      throw wrap(`node ${node.ID}`, err);
    }
  };
  prefixed(() => validateResultCoordinate("node x", node.TopLeft.X));
  prefixed(() => validateResultCoordinate("node y", node.TopLeft.Y));
  prefixed(() => validateResultDimension("node width", node.Width, false));
  prefixed(() => validateResultDimension("node height", node.Height, false));
  if (!isFiniteResultNumber(node.TopLeft.X + node.Width) || !isFiniteResultNumber(node.TopLeft.Y + node.Height)) {
    throw new Error(`node ${node.ID} bounds overflow`);
  }
  if (node.Label != null) {
    prefixed(() => validateResultDimension("node label width", node.Label.Width, true));
    prefixed(() => validateResultDimension("node label height", node.Label.Height, true));
  }
}

/** validateResultEdge (result_validate.go); polls ctx every 256 points. */
export function validateResultEdge(ctx, edge) {
  if (edge == null) {
    throw new Error("edge is nil");
  }
  const points = edge.Points ?? [];
  if (points.length < 2) {
    throw new Error(`edge ${edge.ID} has an incomplete route`);
  }
  for (let index = 0; index < points.length; index++) {
    if (index % 256 === 0) {
      checkContext(ctx);
    }
    const point = points[index];
    if (point == null) {
      throw new Error(`edge ${edge.ID} route point ${index} is nil`);
    }
    try {
      validateResultCoordinate("route x", point.X);
      validateResultCoordinate("route y", point.Y);
    } catch (err) {
      throw wrap(`edge ${edge.ID} point ${index}`, err);
    }
  }
  if (!isFiniteResultNumber(edge.LabelPercentage) || edge.LabelPercentage < 0 || edge.LabelPercentage > 1) {
    throw new Error(`edge ${edge.ID} has invalid label percentage ${goFormatFloat(edge.LabelPercentage)}`);
  }
  const labels = [
    { name: "label", label: edge.Label },
    { name: "source arrowhead label", label: edge.SourceArrowheadLabel },
    { name: "target arrowhead label", label: edge.TargetArrowheadLabel },
  ];
  for (const item of labels) {
    if (item.label == null) continue;
    try {
      validateResultDimension(`${item.name} width`, item.label.Width, true);
      validateResultDimension(`${item.name} height`, item.label.Height, true);
    } catch (err) {
      throw wrap(`edge ${edge.ID}`, err);
    }
  }
}

/** validateResultCoordinate (result_validate.go). */
export function validateResultCoordinate(name, value) {
  if (!isFiniteResultNumber(value) || Math.abs(value) > maxResultCoordinate) {
    throw new Error(`${name} is outside the finite supported range: ${goFormatFloat(value)}`);
  }
}

/** validateResultDimension (result_validate.go). */
export function validateResultDimension(name, value, zeroAllowed) {
  if (!isFiniteResultNumber(value) || value < 0 || (!zeroAllowed && value === 0) || value > maxResultCoordinate) {
    throw new Error(`${name} is outside the supported range: ${goFormatFloat(value)}`);
  }
}

/** isFiniteResultNumber: neither NaN nor ±Inf. */
export function isFiniteResultNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
