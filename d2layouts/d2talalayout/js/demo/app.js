import { layout } from '../src/index.js';

const examples = {
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
const resetButton = $("resetButton");
const copyButton = $("copyButton");
const svg = $("graphSvg");
const outputJson = $("outputJson");
const previewView = $("previewView");
const emptyPreview = $("emptyPreview");
const errorPanel = $("errorPanel");
const inputState = $("inputState");

let selectedExample = Object.keys(examples)[0];
let lastOutput = null;

for (const name of Object.keys(examples)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  exampleSelect.append(option);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function loadExample(name) {
  selectedExample = name;
  editor.value = pretty(examples[name]);
  directionSelect.value = "";
  lastOutput = null;
  clearError();
  resetStats();
  clearPreview();
  setState("Ready", "");
}

function setState(text, className) {
  inputState.textContent = text;
  inputState.className = "status-chip" + (className ? " " + className : "");
}

function clearError() {
  errorPanel.classList.add("hidden");
  errorPanel.textContent = "";
}

function showError(error) {
  errorPanel.textContent = error instanceof Error ? error.stack || error.message : String(error);
  errorPanel.classList.remove("hidden");
}

function resetStats() {
  $("statNodes").textContent = "–";
  $("statEdges").textContent = "–";
  $("statBends").textContent = "–";
  $("statTime").textContent = "–";
}

function clearPreview() {
  svg.replaceChildren();
  emptyPreview.classList.remove("hidden");
  outputJson.textContent = "";
}

function ownerOffset(graph, parentX = 0, parentY = 0) {
  return { x: parentX, y: parentY, graph };
}

function collectLayout(graph, parentX = 0, parentY = 0, result = { nodes: [], edges: [], labels: [] }) {
  const children = Array.isArray(graph.children) ? graph.children : [];
  for (const node of children) {
    const x = parentX + Number(node.x || 0);
    const y = parentY + Number(node.y || 0);
    const width = Number(node.width || 0);
    const height = Number(node.height || 0);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    result.nodes.push({ ...node, absX: x, absY: y, width, height, hasChildren });

    if (Array.isArray(node.labels)) {
      for (const label of node.labels) {
        result.labels.push({
          kind: "node",
          text: label.text || label.id || "",
          x: x + Number(label.x || 0) + Number(label.width || 0) / 2,
          y: y + Number(label.y || 0) + Number(label.height || 0) / 2
        });
      }
    }
    collectLayout(node, x, y, result);
  }

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
        polylines.push(pts.map((p) => ({
          x: parentX + Number(p.x || 0),
          y: parentY + Number(p.y || 0)
        })));
      }
    }
    result.edges.push({ ...edge, polylines, ownerX: parentX, ownerY: parentY });

    if (Array.isArray(edge.labels)) {
      for (const label of edge.labels) {
        result.labels.push({
          kind: "edge",
          text: label.text || label.id || "",
          x: parentX + Number(label.x || 0) + Number(label.width || 0) / 2,
          y: parentY + Number(label.y || 0) + Number(label.height || 0) / 2
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
    markerWidth: 7,
    markerHeight: 7,
    refX: 6,
    refY: 3.5,
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.append(svgElement("path", { d: "M0,0 L7,3.5 L0,7 z", fill: "#7d87a0" }));
  defs.append(marker);
  svg.append(defs);

  for (const edge of model.edges) {
    for (const points of edge.polylines) {
      const polyline = svgElement("polyline", {
        class: "edge-path",
        points: points.map((p) => `${p.x},${p.y}`).join(" "),
        "marker-end": "url(#arrow)"
      });
      svg.append(polyline);
    }
  }

  for (const node of model.nodes) {
    const rect = svgElement("rect", {
      class: node.hasChildren ? "node container-node" : "node",
      x: node.absX,
      y: node.absY,
      width: Math.max(node.width, 1),
      height: Math.max(node.height, 1),
      rx: node.hasChildren ? 12 : 8
    });
    svg.append(rect);

    if (!Array.isArray(node.labels) || node.labels.length === 0) {
      const text = svgElement("text", {
        class: "node-id",
        x: node.absX + node.width / 2,
        y: node.absY + node.height / 2,
        "text-anchor": "middle"
      });
      text.textContent = node.id || "";
      svg.append(text);
    }
  }

  for (const label of model.labels) {
    const text = svgElement("text", {
      class: label.kind === "edge" ? "edge-label" : "node-label",
      x: label.x,
      y: label.y,
      "text-anchor": "middle"
    });
    text.textContent = label.text;
    svg.append(text);
  }

  const bounds = [];
  for (const node of model.nodes) {
    bounds.push([node.absX, node.absY], [node.absX + node.width, node.absY + node.height]);
  }
  for (const edge of model.edges) {
    for (const line of edge.polylines) {
      for (const p of line) bounds.push([p.x, p.y]);
    }
  }

  if (bounds.length) {
    const xs = bounds.map((p) => p[0]);
    const ys = bounds.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const margin = 50;
    svg.setAttribute("viewBox", `${minX - margin} ${minY - margin} ${Math.max(1, maxX - minX + margin * 2)} ${Math.max(1, maxY - minY + margin * 2)}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  emptyPreview.classList.toggle("hidden", model.nodes.length > 0 || model.edges.length > 0);
  const bendCount = model.edges.reduce((sum, edge) =>
    sum + edge.polylines.reduce((s, line) => s + Math.max(0, line.length - 2), 0), 0);

  $("statNodes").textContent = String(model.nodes.length);
  $("statEdges").textContent = String(model.edges.length);
  $("statBends").textContent = String(bendCount);
}

async function run() {
  clearError();
  setState("Running…", "running");
  runButton.disabled = true;

  try {
    const graph = JSON.parse(editor.value);
    const direction = directionSelect.value;
    if (direction) {
      graph.layoutOptions = { ...(graph.layoutOptions || {}), "elk.direction": direction };
    }

    const seedText = seedInput.value.trim();
    if (!/^[+-]?\d+$/.test(seedText)) throw new Error("Seed must be an integer.");
    const seed = Number(seedText);
    const seedOption = Number.isSafeInteger(seed) ? seed : seedText;

    const started = performance.now();
    const output = await layout(graph, { seed: seedOption });
    const elapsed = performance.now() - started;

    lastOutput = output;
    outputJson.textContent = pretty(output);
    renderGraph(output);
    $("statTime").textContent = elapsed < 1000 ? `${elapsed.toFixed(0)} ms` : `${(elapsed / 1000).toFixed(2)} s`;
    setState("Success", "success");
  } catch (error) {
    setState("Error", "error");
    showError(error);
  } finally {
    runButton.disabled = false;
  }
}

exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
resetButton.addEventListener("click", () => loadExample(selectedExample));
runButton.addEventListener("click", run);

copyButton.addEventListener("click", async () => {
  if (!lastOutput) return;
  await navigator.clipboard.writeText(pretty(lastOutput));
  const original = copyButton.textContent;
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = original; }, 900);
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

editor.addEventListener("input", () => {
  setState("Edited", "");
});

loadExample(selectedExample);
