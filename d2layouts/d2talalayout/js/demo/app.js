// TALA JS showcase. Everything drawn here comes from the real public API:
// the page builds ELK JSON, calls layout(), and renders the returned geometry.
import { layout } from '../src/index.js';

const label = (text, width, height = 16) => ({ text, width, height });

const examples = {
  "Layout engine showcase": {
    id: "root",
    layoutOptions: { "elk.direction": "DOWN" },
    children: [
      { id: "input", width: 120, height: 56, labels: [{ id: "input-label", ...label("ELK JSON", 58) }] },
      {
        id: "placement",
        width: 300,
        height: 220,
        labels: [{ id: "placement-label", ...label("Placement", 66, 18) }],
        children: [
          { id: "hierarchy", width: 112, height: 50, labels: [label("Hierarchy", 62)] },
          { id: "trees", width: 112, height: 50, labels: [label("Trees", 36)] },
          { id: "packing", width: 112, height: 50, labels: [label("Packing", 50)] }
        ],
        edges: [
          { id: "hierarchy-packing", sources: ["hierarchy"], targets: ["packing"] },
          { id: "trees-packing", sources: ["trees"], targets: ["packing"] }
        ]
      },
      {
        id: "routing",
        width: 260,
        height: 160,
        labels: [{ id: "routing-label", ...label("Routing", 52, 18) }],
        children: [
          { id: "ovg", width: 120, height: 50, labels: [label("Visibility graph", 98)] },
          { id: "search", width: 112, height: 50, labels: [label("Route search", 80)] }
        ],
        edges: [{ id: "ovg-search", sources: ["ovg"], targets: ["search"] }]
      },
      { id: "labels", width: 112, height: 50, labels: [label("Labels", 42)] },
      { id: "quality", width: 112, height: 50, labels: [label("Quality", 46)] },
      { id: "multiseed", width: 120, height: 50, labels: [label("Multi-seed", 66)] },
      { id: "output", width: 120, height: 56, labels: [{ id: "output-label", ...label("ELK output", 68) }] }
    ],
    edges: [
      { id: "input-hierarchy", sources: ["input"], targets: ["hierarchy"] },
      { id: "input-trees", sources: ["input"], targets: ["trees"] },
      { id: "packing-ovg", sources: ["packing"], targets: ["ovg"], labels: [{ id: "placed-label", ...label("placed", 40, 14) }] },
      { id: "packing-labels", sources: ["packing"], targets: ["labels"] },
      { id: "search-quality", sources: ["search"], targets: ["quality"] },
      { id: "labels-quality", sources: ["labels"], targets: ["quality"] },
      { id: "quality-multiseed", sources: ["quality"], targets: ["multiseed"] },
      { id: "multiseed-output", sources: ["multiseed"], targets: ["output"], labels: [{ id: "best-label", ...label("best", 30, 14) }] }
    ]
  },
  "Simple chain": {
    id: "root",
    layoutOptions: { "elk.direction": "RIGHT" },
    children: [
      { id: "api", width: 120, height: 64, labels: [{ id: "api-label", text: "API", width: 28, height: 18 }] },
      { id: "engine", width: 150, height: 72, labels: [{ id: "engine-label", text: "TALA Engine", width: 78, height: 18 }] },
      { id: "result", width: 120, height: 64, labels: [{ id: "result-label", text: "ELK JSON", width: 58, height: 18 }] }
    ],
    edges: [
      { id: "e1", sources: ["api"], targets: ["engine"] },
      { id: "e2", sources: ["engine"], targets: ["result"], labels: [{ id: "edge-label", text: "layout()", width: 50, height: 16 }] }
    ]
  },
  "Nested containers": {
    id: "root",
    layoutOptions: { "elk.direction": "RIGHT" },
    children: [
      {
        id: "frontend",
        width: 330,
        height: 250,
        labels: [{ id: "frontend-label", text: "Browser", width: 54, height: 18 }],
        children: [
          { id: "editor", width: 110, height: 60, labels: [{ text: "JSON editor", width: 70, height: 16 }] },
          { id: "preview", width: 110, height: 60, labels: [{ text: "SVG preview", width: 74, height: 16 }] }
        ],
        edges: [
          { id: "inner", sources: ["editor"], targets: ["preview"] }
        ]
      },
      {
        id: "core",
        width: 210,
        height: 180,
        labels: [{ id: "core-label", text: "TALA JS", width: 52, height: 18 }],
        children: [
          { id: "routing", width: 100, height: 54, labels: [{ text: "Routing", width: 48, height: 16 }] },
          { id: "quality", width: 100, height: 54, labels: [{ text: "Quality", width: 46, height: 16 }] }
        ],
        edges: [
          { id: "core-edge", sources: ["routing"], targets: ["quality"] }
        ]
      }
    ],
    edges: [
      { id: "outer", sources: ["frontend"], targets: ["core"], labels: [{ text: "ELK JSON", width: 54, height: 16 }] }
    ]
  },
  "Branching graph": {
    id: "root",
    layoutOptions: { "elk.direction": "DOWN" },
    children: [
      { id: "input", width: 120, height: 58, labels: [{ text: "Input graph", width: 66, height: 16 }] },
      { id: "placement", width: 130, height: 58, labels: [{ text: "Placement", width: 62, height: 16 }] },
      { id: "routing", width: 130, height: 58, labels: [{ text: "Routing", width: 48, height: 16 }] },
      { id: "labels", width: 130, height: 58, labels: [{ text: "Labels", width: 42, height: 16 }] },
      { id: "quality", width: 130, height: 58, labels: [{ text: "Quality", width: 46, height: 16 }] },
      { id: "output", width: 120, height: 58, labels: [{ text: "Best result", width: 68, height: 16 }] }
    ],
    edges: [
      { id: "a", sources: ["input"], targets: ["placement"] },
      { id: "b", sources: ["placement"], targets: ["routing"] },
      { id: "c", sources: ["placement"], targets: ["labels"] },
      { id: "d", sources: ["routing"], targets: ["quality"] },
      { id: "e", sources: ["labels"], targets: ["quality"] },
      { id: "f", sources: ["quality"], targets: ["output"] }
    ]
  }
};

const $ = (id) => document.getElementById(id);
const editor = $("jsonEditor");
const exampleSelect = $("exampleSelect");
const seedInput = $("seedInput");
const directionSelect = $("directionSelect");
const runButton = $("runButton");
const formatButton = $("formatButton");
const resetButton = $("resetButton");
const copyButton = $("copyButton");
const fitButton = $("fitButton");
const bendToggle = $("bendToggle");
const svg = $("graphSvg");
const outputJson = $("outputJson");
const previewView = $("previewView");
const emptyPreview = $("emptyPreview");
const errorPanel = $("errorPanel");
const errorText = $("errorText");
const inputState = $("inputState");
const preservedBadge = $("preservedBadge");

let selectedExample = Object.keys(examples)[0];
let lastOutput = null;
let fittedViewBox = null;

for (const name of Object.keys(examples)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  exampleSelect.append(option);
}

const pretty = (value) => JSON.stringify(value, null, 2);

// ── Editor state ────────────────────────────────────────────────────────────

/** Converts a JSON.parse error into "line L, column C" when the engine reports a position. */
function parseErrorLocation(error, text) {
  const lineCol = /line (\d+) column (\d+)/i.exec(error.message);
  if (lineCol) return `line ${lineCol[1]}, column ${lineCol[2]}`;
  const position = /position (\d+)/i.exec(error.message);
  if (!position) return "";
  const before = text.slice(0, Number(position[1]));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `line ${line}, column ${column}`;
}

function parseEditor() {
  try {
    return { value: JSON.parse(editor.value), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function updateValidity() {
  const { error } = parseEditor();
  if (error) {
    const where = parseErrorLocation(error, editor.value);
    setChip(`Invalid JSON${where ? " · " + where : ""}`, "error");
  } else {
    setChip("Valid JSON", "valid");
  }
  return !error;
}

function setChip(text, className) {
  inputState.textContent = text;
  inputState.className = "status-chip" + (className ? " " + className : "");
}

function setStatus(text, className = "") {
  const el = $("statStatus");
  el.textContent = text;
  el.parentElement.className = "stat-status" + (className ? " " + className : "");
}

function loadExample(name) {
  selectedExample = name;
  exampleSelect.value = name;
  editor.value = pretty(examples[name]);
  directionSelect.value = "";
  lastOutput = null;
  clearError();
  resetStats();
  clearPreview();
  updateValidity();
}

function formatEditor() {
  const { value, error } = parseEditor();
  if (error) {
    showError(error, "Invalid JSON");
    updateValidity();
    return;
  }
  editor.value = pretty(value);
  clearError();
  updateValidity();
}

// ── Errors and stats ────────────────────────────────────────────────────────

function clearError() {
  errorPanel.classList.add("hidden");
  errorText.textContent = "";
}

/** Shows the thrown error's message and its cause chain (not a stack trace). */
function showError(error, title = "Layout failed") {
  const lines = [];
  let current = error;
  for (let depth = 0; current != null && depth < 6; depth++) {
    const message = current instanceof Error ? `${current.name}: ${current.message}` : String(current);
    lines.push(depth === 0 ? message : `caused by ${message}`);
    current = current instanceof Error ? current.cause : null;
  }
  if (error instanceof SyntaxError && !/line \d+/i.test(error.message)) {
    const where = parseErrorLocation(error, editor.value);
    if (where) lines.push(`at ${where} of the input`);
  }
  errorPanel.querySelector(".error-title").textContent = title;
  errorText.textContent = lines.join("\n");
  errorPanel.classList.remove("hidden");
}

function resetStats() {
  setStatus("Ready");
  for (const id of ["statSeed", "statNodes", "statEdges", "statBends", "statTime"]) $(id).textContent = "–";
  preservedBadge.classList.add("hidden");
}

function clearPreview() {
  svg.replaceChildren();
  svg.removeAttribute("viewBox");
  fittedViewBox = null;
  emptyPreview.classList.remove("hidden");
  outputJson.textContent = "";
}

// ── Rendering (geometry is read from the returned ELK JSON only) ────────────

function collectLayout(graph, parentX = 0, parentY = 0, result = { nodes: [], edges: [], labels: [] }) {
  const children = Array.isArray(graph.children) ? graph.children : [];
  for (const node of children) {
    const x = parentX + Number(node.x || 0);
    const y = parentY + Number(node.y || 0);
    const width = Number(node.width || 0);
    const height = Number(node.height || 0);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    result.nodes.push({ id: node.id, labels: node.labels, absX: x, absY: y, width, height, hasChildren });

    if (Array.isArray(node.labels)) {
      for (const lbl of node.labels) {
        result.labels.push({
          kind: hasChildren ? "container" : "node",
          text: lbl.text || lbl.id || "",
          x: x + Number(lbl.x || 0) + Number(lbl.width || 0) / 2,
          y: y + Number(lbl.y || 0) + Number(lbl.height || 0) / 2
        });
      }
    }
    collectLayout(node, x, y, result);
  }

  // Edge sections are relative to the node that owns the edge (ELK convention).
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  for (const edge of edges) {
    const sections = Array.isArray(edge.sections) ? edge.sections : [];
    const polylines = [];
    for (const section of sections) {
      const pts = [];
      if (section.startPoint) pts.push(section.startPoint);
      if (Array.isArray(section.bendPoints)) pts.push(...section.bendPoints);
      if (section.endPoint) pts.push(section.endPoint);
      if (pts.length >= 2) {
        polylines.push(pts.map((p) => ({ x: parentX + Number(p.x || 0), y: parentY + Number(p.y || 0) })));
      }
    }
    result.edges.push({ id: edge.id, polylines });

    if (Array.isArray(edge.labels)) {
      for (const lbl of edge.labels) {
        if (lbl.x == null || lbl.y == null) continue;
        result.labels.push({
          kind: "edge",
          text: lbl.text || lbl.id || "",
          x: parentX + Number(lbl.x) + Number(lbl.width || 0) / 2,
          y: parentY + Number(lbl.y) + Number(lbl.height || 0) / 2
        });
      }
    }
  }
  return result;
}

function svgElement(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function renderGraph(graph) {
  const model = collectLayout(graph);
  svg.replaceChildren();

  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: "arrow",
    markerWidth: 8,
    markerHeight: 8,
    refX: 7,
    refY: 4,
    orient: "auto",
    markerUnits: "userSpaceOnUse"
  });
  marker.append(svgElement("path", { d: "M0,0 L8,4 L0,8 z", class: "arrow-head" }));
  defs.append(marker);
  svg.append(defs);

  // Containers first (back), then edges, then leaf nodes, then labels on top.
  const containers = model.nodes.filter((n) => n.hasChildren);
  const leaves = model.nodes.filter((n) => !n.hasChildren);
  const drawNode = (node) => {
    const group = svgElement("g", { class: node.hasChildren ? "node-group container" : "node-group" });
    const title = svgElement("title");
    title.textContent = `${node.id}  x=${node.absX} y=${node.absY}  ${node.width}×${node.height}`;
    group.append(title);
    group.append(svgElement("rect", {
      class: node.hasChildren ? "node container-node" : "node",
      x: node.absX,
      y: node.absY,
      width: Math.max(node.width, 1),
      height: Math.max(node.height, 1),
      rx: node.hasChildren ? 10 : 7
    }));
    if (!Array.isArray(node.labels) || node.labels.length === 0) {
      const text = svgElement("text", {
        class: "node-id",
        x: node.absX + node.width / 2,
        y: node.absY + node.height / 2,
        "text-anchor": "middle"
      });
      text.textContent = node.id || "";
      group.append(text);
    }
    svg.append(group);
  };
  containers.forEach(drawNode);

  let bendCount = 0;
  for (const edge of model.edges) {
    for (const points of edge.polylines) {
      const group = svgElement("g", { class: "edge-group" });
      const title = svgElement("title");
      title.textContent = `${edge.id}: ${points.map((p) => `(${p.x}, ${p.y})`).join(" → ")}`;
      group.append(title);
      const pointList = points.map((p) => `${p.x},${p.y}`).join(" ");
      group.append(svgElement("polyline", { class: "edge-hit", points: pointList }));
      group.append(svgElement("polyline", { class: "edge-path", points: pointList, "marker-end": "url(#arrow)" }));
      for (const bend of points.slice(1, -1)) {
        bendCount++;
        group.append(svgElement("circle", { class: "bend-point", cx: bend.x, cy: bend.y, r: 3 }));
      }
      svg.append(group);
    }
  }

  leaves.forEach(drawNode);

  for (const lbl of model.labels) {
    const text = svgElement("text", {
      class: `${lbl.kind}-label`,
      x: lbl.x,
      y: lbl.y,
      "text-anchor": "middle"
    });
    text.textContent = lbl.text;
    svg.append(text);
  }

  const xs = [];
  const ys = [];
  for (const node of model.nodes) {
    xs.push(node.absX, node.absX + node.width);
    ys.push(node.absY, node.absY + node.height);
  }
  for (const edge of model.edges) {
    for (const line of edge.polylines) {
      for (const p of line) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
  }
  if (xs.length) {
    const margin = 48;
    const minX = Math.min(...xs) - margin;
    const minY = Math.min(...ys) - margin;
    fittedViewBox = {
      x: minX,
      y: minY,
      w: Math.max(1, Math.max(...xs) + margin - minX),
      h: Math.max(1, Math.max(...ys) + margin - minY)
    };
    applyViewBox(fittedViewBox);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  emptyPreview.classList.toggle("hidden", model.nodes.length > 0 || model.edges.length > 0);
  $("statNodes").textContent = String(model.nodes.length);
  $("statEdges").textContent = String(model.edges.length);
  $("statBends").textContent = String(bendCount);
}

// ── View box: fit, wheel zoom, drag pan (view only; geometry is untouched) ──

function currentViewBox() {
  const vb = svg.viewBox.baseVal;
  return vb && vb.width ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : null;
}

function applyViewBox(vb) {
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function clientToSvg(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
}

svg.addEventListener("wheel", (event) => {
  const vb = currentViewBox();
  if (!vb || !fittedViewBox) return;
  event.preventDefault();
  const factor = Math.exp(Math.sign(event.deltaY) * 0.12);
  const minW = fittedViewBox.w / 12;
  const maxW = fittedViewBox.w * 4;
  const nextW = Math.min(maxW, Math.max(minW, vb.w * factor));
  const scale = nextW / vb.w;
  const anchor = clientToSvg(event);
  applyViewBox({
    x: anchor.x - (anchor.x - vb.x) * scale,
    y: anchor.y - (anchor.y - vb.y) * scale,
    w: vb.w * scale,
    h: vb.h * scale
  });
}, { passive: false });

let drag = null;
svg.addEventListener("pointerdown", (event) => {
  const vb = currentViewBox();
  if (!vb || event.button !== 0) return;
  drag = { start: clientToSvg(event), vb };
  svg.setPointerCapture(event.pointerId);
  svg.classList.add("panning");
});
svg.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const now = clientToSvg(event);
  const vb = currentViewBox();
  applyViewBox({ x: vb.x - (now.x - drag.start.x), y: vb.y - (now.y - drag.start.y), w: vb.w, h: vb.h });
});
const endDrag = () => {
  drag = null;
  svg.classList.remove("panning");
};
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

fitButton.addEventListener("click", () => {
  if (fittedViewBox) applyViewBox(fittedViewBox);
});

bendToggle.addEventListener("change", () => {
  svg.classList.toggle("hide-bends", !bendToggle.checked);
});

// ── Run ─────────────────────────────────────────────────────────────────────

/** Integer text becomes a Number when safe; anything else is passed through so TALA reports it. */
function seedOption(text) {
  const trimmed = text.trim();
  if (/^[+-]?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isSafeInteger(value) ? value : trimmed;
  }
  return trimmed === "" ? undefined : trimmed;
}

async function run() {
  clearError();
  const { value: graph, error: parseError } = parseEditor();
  if (parseError) {
    updateValidity();
    setStatus("Invalid JSON", "error");
    showError(parseError, "Invalid JSON");
    return;
  }

  const direction = directionSelect.value;
  if (direction && graph && typeof graph === "object") {
    graph.layoutOptions = { ...(graph.layoutOptions || {}), "elk.direction": direction };
  }
  const seed = seedOption(seedInput.value);

  setStatus("Running…", "running");
  runButton.disabled = true;
  // Yield once so the browser can paint the running state before the
  // synchronous engine starts (setTimeout also fires in background tabs).
  await new Promise((resolve) => setTimeout(resolve, 30));

  try {
    const original = structuredClone(graph);
    const started = performance.now();
    const output = await layout(graph, { seed });
    const elapsed = performance.now() - started;

    lastOutput = output;
    outputJson.textContent = pretty(output);
    renderGraph(output);
    $("statSeed").textContent = seed === undefined ? "1, 2, 3" : String(seed);
    $("statTime").textContent = elapsed < 1000 ? `${elapsed.toFixed(0)} ms` : `${(elapsed / 1000).toFixed(2)} s`;
    setStatus("Layout complete", "success");
    let preserved = false;
    try {
      preserved = JSON.stringify(original) === JSON.stringify(graph) && output !== graph;
    } catch {
      preserved = false;
    }
    preservedBadge.classList.toggle("hidden", !preserved);
  } catch (error) {
    setStatus("Error", "error");
    showError(error);
  } finally {
    runButton.disabled = false;
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

exampleSelect.addEventListener("change", () => {
  loadExample(exampleSelect.value);
  run();
});
resetButton.addEventListener("click", () => loadExample(selectedExample));
formatButton.addEventListener("click", formatEditor);
runButton.addEventListener("click", run);

copyButton.addEventListener("click", async () => {
  if (!lastOutput) return;
  const original = copyButton.textContent;
  try {
    await navigator.clipboard.writeText(pretty(lastOutput));
    copyButton.textContent = "Copied";
  } catch {
    copyButton.textContent = "Copy blocked";
  }
  setTimeout(() => { copyButton.textContent = original; }, 1100);
});

for (const button of document.querySelectorAll(".view-button")) {
  button.addEventListener("click", () => {
    for (const peer of document.querySelectorAll(".view-button")) peer.classList.remove("active");
    button.classList.add("active");
    const showJson = button.dataset.view === "json";
    previewView.classList.toggle("hidden", showJson);
    outputJson.classList.toggle("hidden", !showJson);
  });
}

editor.addEventListener("input", updateValidity);

editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const { selectionStart, selectionEnd } = editor;
    editor.setRangeText("  ", selectionStart, selectionEnd, "end");
    updateValidity();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (!runButton.disabled) run();
  }
});

if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
  runButton.querySelector("kbd").textContent = "⌘ ↵";
}

loadExample(selectedExample);
run();
