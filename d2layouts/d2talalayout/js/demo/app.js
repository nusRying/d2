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
  "Microservices Cloud Platform (26 nodes, 4 tiers)": {
    id: "root",
    layoutOptions: { "elk.direction": "RIGHT" },
    children: [
      { id: "dns", width: 120, height: 50, labels: [label("Cloudflare DNS", 90)] },
      { id: "cdn", width: 120, height: 50, labels: [label("Edge CDN", 60)] },
      {
        id: "ingress-tier",
        width: 320,
        height: 220,
        labels: [label("Ingress & Gateway Tier", 140, 18)],
        children: [
          { id: "waf", width: 110, height: 48, labels: [label("WAF Shield", 70)] },
          { id: "api-gw", width: 120, height: 54, labels: [label("API Gateway", 78)] },
          { id: "auth-srv", width: 120, height: 54, labels: [label("OAuth2 Auth", 80)] }
        ],
        edges: [
          { id: "waf-gw", sources: ["waf"], targets: ["api-gw"] },
          { id: "gw-auth", sources: ["api-gw"], targets: ["auth-srv"], labels: [label("verify", 36, 14)] }
        ]
      },
      {
        id: "service-mesh",
        width: 440,
        height: 300,
        labels: [label("Application Service Mesh", 160, 18)],
        children: [
          { id: "user-svc", width: 120, height: 52, labels: [label("User Service", 80)] },
          { id: "order-svc", width: 120, height: 52, labels: [label("Order Service", 84)] },
          { id: "pay-svc", width: 120, height: 52, labels: [label("Payment Service", 96)] },
          { id: "inv-svc", width: 120, height: 52, labels: [label("Inventory Service", 102)] },
          { id: "notify-svc", width: 120, height: 52, labels: [label("Notification Service", 120)] }
        ],
        edges: [
          { id: "order-user", sources: ["order-svc"], targets: ["user-svc"] },
          { id: "order-pay", sources: ["order-svc"], targets: ["pay-svc"], labels: [label("charge", 42, 14)] },
          { id: "order-inv", sources: ["order-svc"], targets: ["inv-svc"], labels: [label("reserve", 46, 14)] },
          { id: "order-notify", sources: ["order-svc"], targets: ["notify-svc"] }
        ]
      },
      {
        id: "async-tier",
        width: 320,
        height: 180,
        labels: [label("Event Streaming & Workers", 160, 18)],
        children: [
          { id: "kafka", width: 120, height: 54, labels: [label("Kafka Event Bus", 100)] },
          { id: "worker-email", width: 120, height: 48, labels: [label("Email Worker", 80)] },
          { id: "worker-audit", width: 120, height: 48, labels: [label("Audit Worker", 80)] }
        ],
        edges: [
          { id: "k-email", sources: ["kafka"], targets: ["worker-email"] },
          { id: "k-audit", sources: ["kafka"], targets: ["worker-audit"] }
        ]
      },
      {
        id: "data-tier",
        width: 360,
        height: 240,
        labels: [label("Persistence Tier", 100, 18)],
        children: [
          { id: "redis", width: 120, height: 50, labels: [label("Redis Cache", 76)] },
          { id: "pg-primary", width: 130, height: 54, labels: [label("Postgres Primary", 104)] },
          { id: "pg-replica", width: 130, height: 54, labels: [label("Postgres Replica", 104)] },
          { id: "s3-bucket", width: 120, height: 50, labels: [label("S3 Object Store", 94)] }
        ],
        edges: [
          { id: "pg-sync", sources: ["pg-primary"], targets: ["pg-replica"], labels: [label("wal sync", 52, 14)] }
        ]
      }
    ],
    edges: [
      { id: "dns-cdn", sources: ["dns"], targets: ["cdn"] },
      { id: "cdn-waf", sources: ["cdn"], targets: ["waf"] },
      { id: "gw-order", sources: ["api-gw"], targets: ["order-svc"] },
      { id: "gw-user", sources: ["api-gw"], targets: ["user-svc"] },
      { id: "user-redis", sources: ["user-svc"], targets: ["redis"] },
      { id: "user-pg", sources: ["user-svc"], targets: ["pg-replica"] },
      { id: "order-pg", sources: ["order-svc"], targets: ["pg-primary"] },
      { id: "pay-pg", sources: ["pay-svc"], targets: ["pg-primary"] },
      { id: "inv-pg", sources: ["inv-svc"], targets: ["pg-primary"] },
      { id: "order-kafka", sources: ["order-svc"], targets: ["kafka"], labels: [label("events", 40, 14)] },
      { id: "notify-s3", sources: ["notify-svc"], targets: ["s3-bucket"] }
    ]
  },
  "Kubernetes Cluster Hierarchy (22 nodes, 3 levels)": {
    id: "root",
    layoutOptions: { "elk.direction": "DOWN" },
    children: [
      { id: "ingress-ctrl", width: 140, height: 54, labels: [label("NGINX Ingress", 88)] },
      {
        id: "control-plane",
        width: 320,
        height: 200,
        labels: [label("Control Plane Nodes", 130, 18)],
        children: [
          { id: "api-server", width: 120, height: 50, labels: [label("kube-apiserver", 92)] },
          { id: "etcd", width: 100, height: 48, labels: [label("etcd v3", 50)] },
          { id: "sched", width: 120, height: 48, labels: [label("kube-scheduler", 98)] }
        ],
        edges: [
          { id: "api-etcd", sources: ["api-server"], targets: ["etcd"] },
          { id: "sched-api", sources: ["sched"], targets: ["api-server"] }
        ]
      },
      {
        id: "worker-pool-a",
        width: 340,
        height: 220,
        labels: [label("Worker Pool A (Compute)", 160, 18)],
        children: [
          { id: "kubelet-a", width: 100, height: 46, labels: [label("kubelet-a", 62)] },
          {
            id: "pod-web",
            width: 180,
            height: 120,
            labels: [label("Pod: web-front", 92, 16)],
            children: [
              { id: "c-web", width: 90, height: 40, labels: [label("web:v2", 48)] },
              { id: "c-mesh", width: 90, height: 40, labels: [label("envoy", 40)] }
            ],
            edges: [{ id: "mesh-web", sources: ["c-mesh"], targets: ["c-web"] }]
          }
        ],
        edges: [{ id: "k-pod-a", sources: ["kubelet-a"], targets: ["pod-web"] }]
      },
      {
        id: "worker-pool-b",
        width: 340,
        height: 220,
        labels: [label("Worker Pool B (Data)", 150, 18)],
        children: [
          { id: "kubelet-b", width: 100, height: 46, labels: [label("kubelet-b", 62)] },
          {
            id: "pod-db",
            width: 180,
            height: 120,
            labels: [label("Pod: stateful-db", 100, 16)],
            children: [
              { id: "c-db", width: 90, height: 40, labels: [label("mariadb", 52)] },
              { id: "c-backup", width: 90, height: 40, labels: [label("sidecar", 46)] }
            ],
            edges: [{ id: "db-backup", sources: ["c-db"], targets: ["c-backup"] }]
          }
        ],
        edges: [{ id: "k-pod-b", sources: ["kubelet-b"], targets: ["pod-db"] }]
      },
      { id: "pv-storage", width: 130, height: 50, labels: [label("CSI PersistentVol", 112)] }
    ],
    edges: [
      { id: "ing-web", sources: ["ingress-ctrl"], targets: ["c-mesh"], labels: [label("http traffic", 68, 14)] },
      { id: "api-k-a", sources: ["api-server"], targets: ["kubelet-a"] },
      { id: "api-k-b", sources: ["api-server"], targets: ["kubelet-b"] },
      { id: "web-db", sources: ["c-web"], targets: ["c-db"], labels: [label("sql query", 60, 14)] },
      { id: "db-pv", sources: ["c-db"], targets: ["pv-storage"], labels: [label("read/write", 62, 14)] }
    ]
  },
  "Compiler & Optimization Pipeline (18 nodes)": {
    id: "root",
    layoutOptions: { "elk.direction": "RIGHT" },
    children: [
      { id: "src-code", width: 110, height: 50, labels: [label("Source .src", 70)] },
      { id: "lexer", width: 100, height: 48, labels: [label("Lexer", 40)] },
      { id: "parser", width: 100, height: 48, labels: [label("Parser", 44)] },
      { id: "ast", width: 110, height: 50, labels: [label("Typed AST", 64)] },
      { id: "typecheck", width: 110, height: 48, labels: [label("Type Checker", 78)] },
      { id: "ir-gen", width: 110, height: 48, labels: [label("IR Lowering", 72)] },
      { id: "ssa", width: 110, height: 50, labels: [label("SSA Form", 60)] },
      { id: "dce", width: 110, height: 46, labels: [label("Dead Code Elim", 94)] },
      { id: "inline", width: 110, height: 46, labels: [label("Function Inline", 90)] },
      { id: "licm", width: 110, height: 46, labels: [label("Loop Invariant", 88)] },
      { id: "regalloc", width: 120, height: 50, labels: [label("Reg Allocation", 92)] },
      { id: "codegen", width: 110, height: 48, labels: [label("CodeGen", 54)] },
      { id: "asm-x86", width: 100, height: 46, labels: [label("x86-64 Asm", 68)] },
      { id: "asm-arm", width: 100, height: 46, labels: [label("ARM64 Asm", 68)] },
      { id: "wasm", width: 100, height: 46, labels: [label("Wasm Output", 76)] },
      { id: "linker", width: 100, height: 50, labels: [label("LLD Linker", 68)] },
      { id: "bin-native", width: 110, height: 50, labels: [label("Native Exec", 74)] },
      { id: "bin-wasm", width: 110, height: 50, labels: [label("WebAssembly", 80)] }
    ],
    edges: [
      { id: "e-lex", sources: ["src-code"], targets: ["lexer"] },
      { id: "e-parse", sources: ["lexer"], targets: ["parser"], labels: [label("tokens", 42, 14)] },
      { id: "e-ast", sources: ["parser"], targets: ["ast"] },
      { id: "e-check", sources: ["ast"], targets: ["typecheck"] },
      { id: "e-ir", sources: ["typecheck"], targets: ["ir-gen"] },
      { id: "e-ssa", sources: ["ir-gen"], targets: ["ssa"] },
      { id: "e-dce", sources: ["ssa"], targets: ["dce"] },
      { id: "e-inline", sources: ["dce"], targets: ["inline"] },
      { id: "e-licm", sources: ["inline"], targets: ["licm"] },
      { id: "e-reg", sources: ["licm"], targets: ["regalloc"] },
      { id: "e-gen", sources: ["regalloc"], targets: ["codegen"] },
      { id: "e-x86", sources: ["codegen"], targets: ["asm-x86"] },
      { id: "e-arm", sources: ["codegen"], targets: ["asm-arm"] },
      { id: "e-wasm", sources: ["codegen"], targets: ["wasm"] },
      { id: "e-link-x86", sources: ["asm-x86"], targets: ["linker"] },
      { id: "e-link-arm", sources: ["asm-arm"], targets: ["linker"] },
      { id: "e-bin", sources: ["linker"], targets: ["bin-native"] },
      { id: "e-wbin", sources: ["wasm"], targets: ["bin-wasm"] }
    ]
  },
  "E-Commerce Order State Machine (17 states, cycles)": {
    id: "root",
    layoutOptions: { "elk.direction": "DOWN" },
    children: [
      { id: "cart", width: 120, height: 50, labels: [label("Cart Open", 66)] },
      { id: "checkout", width: 120, height: 50, labels: [label("Checkout", 60)] },
      { id: "fraud-check", width: 130, height: 52, labels: [label("Fraud Analysis", 86)] },
      { id: "flagged", width: 120, height: 50, labels: [label("Manual Review", 86)] },
      { id: "inv-hold", width: 130, height: 50, labels: [label("Stock Reserved", 88)] },
      { id: "payment-auth", width: 130, height: 52, labels: [label("Payment Auth", 82)] },
      { id: "payment-failed", width: 120, height: 50, labels: [label("Payment Failed", 90)] },
      { id: "captured", width: 120, height: 50, labels: [label("Captured", 58)] },
      { id: "packing", width: 120, height: 50, labels: [label("Warehouse Pick", 94)] },
      { id: "shipped", width: 120, height: 50, labels: [label("In Transit", 62)] },
      { id: "out-for-del", width: 130, height: 50, labels: [label("Out for Delivery", 98)] },
      { id: "delivered", width: 120, height: 52, labels: [label("Delivered", 60)] },
      { id: "refund-req", width: 130, height: 50, labels: [label("Return Requested", 104)] },
      { id: "inspection", width: 120, height: 50, labels: [label("Inspecting Item", 94)] },
      { id: "refunded", width: 120, height: 52, labels: [label("Refund Closed", 86)] },
      { id: "cancelled", width: 120, height: 52, labels: [label("Order Cancelled", 96)] },
      { id: "completed", width: 120, height: 52, labels: [label("Order Completed", 100)] }
    ],
    edges: [
      { id: "e1", sources: ["cart"], targets: ["checkout"] },
      { id: "e2", sources: ["checkout"], targets: ["fraud-check"] },
      { id: "e3", sources: ["fraud-check"], targets: ["flagged"], labels: [label("suspicious", 64, 14)] },
      { id: "e4", sources: ["flagged"], targets: ["inv-hold"], labels: [label("approved", 56, 14)] },
      { id: "e5", sources: ["flagged"], targets: ["cancelled"], labels: [label("rejected", 52, 14)] },
      { id: "e6", sources: ["fraud-check"], targets: ["inv-hold"], labels: [label("pass", 32, 14)] },
      { id: "e7", sources: ["inv-hold"], targets: ["payment-auth"] },
      { id: "e8", sources: ["payment-auth"], targets: ["payment-failed"], labels: [label("decline", 44, 14)] },
      { id: "e9", sources: ["payment-failed"], targets: ["checkout"], labels: [label("retry card", 58, 14)] },
      { id: "e10", sources: ["payment-auth"], targets: ["captured"], labels: [label("success", 46, 14)] },
      { id: "e11", sources: ["captured"], targets: ["packing"] },
      { id: "e12", sources: ["packing"], targets: ["shipped"] },
      { id: "e13", sources: ["shipped"], targets: ["out-for-del"] },
      { id: "e14", sources: ["out-for-del"], targets: ["delivered"] },
      { id: "e15", sources: ["delivered"], targets: ["completed"], labels: [label("30 days", 48, 14)] },
      { id: "e16", sources: ["delivered"], targets: ["refund-req"], labels: [label("return", 40, 14)] },
      { id: "e17", sources: ["refund-req"], targets: ["inspection"] },
      { id: "e18", sources: ["inspection"], targets: ["refunded"], labels: [label("passed", 42, 14)] }
    ]
  },
  "Dense Network Topology (24 nodes, 32 edges)": {
    id: "root",
    layoutOptions: { "elk.direction": "RIGHT" },
    children: [
      { id: "core1", width: 100, height: 48, labels: [label("Core Router 1", 86)] },
      { id: "core2", width: 100, height: 48, labels: [label("Core Router 2", 86)] },
      { id: "dist1", width: 95, height: 46, labels: [label("Dist A1", 50)] },
      { id: "dist2", width: 95, height: 46, labels: [label("Dist A2", 50)] },
      { id: "dist3", width: 95, height: 46, labels: [label("Dist B1", 50)] },
      { id: "dist4", width: 95, height: 46, labels: [label("Dist B2", 50)] },
      { id: "leaf1", width: 85, height: 44, labels: [label("Leaf 1", 42)] },
      { id: "leaf2", width: 85, height: 44, labels: [label("Leaf 2", 42)] },
      { id: "leaf3", width: 85, height: 44, labels: [label("Leaf 3", 42)] },
      { id: "leaf4", width: 85, height: 44, labels: [label("Leaf 4", 42)] },
      { id: "leaf5", width: 85, height: 44, labels: [label("Leaf 5", 42)] },
      { id: "leaf6", width: 85, height: 44, labels: [label("Leaf 6", 42)] },
      { id: "srv1", width: 80, height: 40, labels: [label("Srv 01", 38)] },
      { id: "srv2", width: 80, height: 40, labels: [label("Srv 02", 38)] },
      { id: "srv3", width: 80, height: 40, labels: [label("Srv 03", 38)] },
      { id: "srv4", width: 80, height: 40, labels: [label("Srv 04", 38)] },
      { id: "srv5", width: 80, height: 40, labels: [label("Srv 05", 38)] },
      { id: "srv6", width: 80, height: 40, labels: [label("Srv 06", 38)] },
      { id: "srv7", width: 80, height: 40, labels: [label("Srv 07", 38)] },
      { id: "srv8", width: 80, height: 40, labels: [label("Srv 08", 38)] },
      { id: "srv9", width: 80, height: 40, labels: [label("Srv 09", 38)] },
      { id: "srv10", width: 80, height: 40, labels: [label("Srv 10", 42)] },
      { id: "srv11", width: 80, height: 40, labels: [label("Srv 11", 42)] },
      { id: "srv12", width: 80, height: 40, labels: [label("Srv 12", 42)] }
    ],
    edges: [
      { id: "c1-c2", sources: ["core1"], targets: ["core2"] },
      { id: "c1-d1", sources: ["core1"], targets: ["dist1"] },
      { id: "c1-d2", sources: ["core1"], targets: ["dist2"] },
      { id: "c2-d3", sources: ["core2"], targets: ["dist3"] },
      { id: "c2-d4", sources: ["core2"], targets: ["dist4"] },
      { id: "d1-l1", sources: ["dist1"], targets: ["leaf1"] },
      { id: "d1-l2", sources: ["dist1"], targets: ["leaf2"] },
      { id: "d2-l2", sources: ["dist2"], targets: ["leaf2"] },
      { id: "d2-l3", sources: ["dist2"], targets: ["leaf3"] },
      { id: "d3-l4", sources: ["dist3"], targets: ["leaf4"] },
      { id: "d3-l5", sources: ["dist3"], targets: ["leaf5"] },
      { id: "d4-l5", sources: ["dist4"], targets: ["leaf5"] },
      { id: "d4-l6", sources: ["dist4"], targets: ["leaf6"] },
      { id: "l1-s1", sources: ["leaf1"], targets: ["srv1"] },
      { id: "l1-s2", sources: ["leaf1"], targets: ["srv2"] },
      { id: "l2-s3", sources: ["leaf2"], targets: ["srv3"] },
      { id: "l2-s4", sources: ["leaf2"], targets: ["srv4"] },
      { id: "l3-s5", sources: ["leaf3"], targets: ["srv5"] },
      { id: "l3-s6", sources: ["leaf3"], targets: ["srv6"] },
      { id: "l4-s7", sources: ["leaf4"], targets: ["srv7"] },
      { id: "l4-s8", sources: ["leaf4"], targets: ["srv8"] },
      { id: "l5-s9", sources: ["leaf5"], targets: ["srv9"] },
      { id: "l5-s10", sources: ["leaf5"], targets: ["srv10"] },
      { id: "l6-s11", sources: ["leaf6"], targets: ["srv11"] },
      { id: "l6-s12", sources: ["leaf6"], targets: ["srv12"] }
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
