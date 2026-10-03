import { goHypot, goPow2 } from "../geometry/go-math.js";
import { Point } from "../geometry/point.js";
import { goRound } from "../geometry/math.js";
import { validateEngineGraph } from "../graph/topology-preflight.js";
import { WorkCanceledError } from "../limits/work-guard.js";
import { getContextError } from "../limits/work-context.js";

/**
 * Go: if err := ctx.Err(); err != nil { return false, err } — one ctx.Err()
 * call per check; the context error is returned unwrapped.
 *
 * @param {any} context
 */
function checkDirectCancellation(context) {
  if (context == null) return;
  if (typeof context.Err === "function") {
    const err = context.Err();
    if (err != null) throw err;
    return;
  }
  // Polling-only contexts have no Err identity to return; synthesize the
  // canonical cancellation error.
  if (getContextError(context) != null) {
    const error = new Error("context canceled");
    error.name = "AbortError";
    throw error;
  }
}

/**
 * initializeByGraphDistance is an experimental, bounded alternative starting arrangement.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/stress_initialize.go
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} g
 * @returns {boolean} true if applied, false if fell back
 */
export function initializeByGraphDistance(context, g) {
  validateEngineGraph(context, "GraphDistanceInitialization", g);

  const n = g.Nodes.length;
  const hasFixed =
    typeof g.hasFixedNode === "function" ? g.hasFixedNode() : g.HasFixedNode();

  if (n < 4 || n > 64 || g.Edges.length > 256 || hasFixed) {
    return false;
  }

  const index = new Map();
  for (let i = 0; i < n; i++) {
    index.set(g.Nodes[i], i);
  }

  const d = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    d[i][i] = 0;
  }

  for (const edge of g.Edges) {
    const i = index.get(edge.From);
    const j = index.get(edge.To);
    if (i !== undefined && j !== undefined && i !== j) {
      d[i][j] = 1;
      d[j][i] = 1;
    }
  }

  // Floyd-Warshall shortest paths with cancellation checked once per k iteration.
  for (let k = 0; k < n; k++) {
    checkDirectCancellation(context);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!Number.isFinite(d[i][j])) {
        return false;
      }
    }
  }

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    x[i] = Math.sqrt(n) * Math.cos(a);
    y[i] = Math.sqrt(n) * Math.sin(a);
  }

  // Pairwise relaxation of sum ((EuclideanDistance - graphDistance) / graphDistance)^2.
  for (let sweep = 0; sweep < 48; sweep++) {
    checkDirectCancellation(context);
    const eta = 0.7 * Math.pow(0.02 / 0.7, sweep / 47);
    for (let p = 0; p < n; p++) {
      const i = (p + sweep) % n;
      for (let q = p + 1; q < n; q++) {
        const j = (q + sweep) % n;
        let dx = x[i] - x[j];
        let dy = y[i] - y[j];
        let length = goHypot(dx, dy);
        if (length < 1e-9) {
          dx = 1e-6;
          dy = 1e-6;
          length = Math.SQRT2 * 1e-6;
        }
        const mu = Math.min(1, eta / (d[i][j] * d[i][j]));
        const amount = (0.5 * mu * (length - d[i][j])) / length;
        x[i] -= dx * amount;
        y[i] -= dy * amount;
        x[j] += dx * amount;
        y[j] += dy * amount;
      }
    }
  }

  // Stable sort descending by node.Edges.length, preserving original node order on ties.
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => g.Nodes[b].Edges.length - g.Nodes[a].Edges.length);

  const occupied = new Set();
  const points = new Array(n);

  for (const i of order) {
    checkDirectCancellation(context);
    const tx = x[i] * 2 + n;
    const ty = y[i] * 2 + n;
    const cx = goRound(tx);
    const cy = goRound(ty);
    let best = [cx, cy];
    let cost = Infinity;

    // n bounds the radius needed to find an unused integer cell.
    for (let radius = 0; radius <= n; radius++) {
      for (let xx = cx - radius; xx <= cx + radius; xx++) {
        for (let yy = cy - radius; yy <= cy + radius; yy++) {
          if (
            radius > 0 &&
            xx !== cx - radius &&
            xx !== cx + radius &&
            yy !== cy - radius &&
            yy !== cy + radius
          ) {
            continue;
          }
          const key = `${xx},${yy}`;
          if (occupied.has(key)) {
            continue;
          }
          const c = goPow2(xx - tx) + goPow2(yy - ty);
          if (c < cost) {
            best = [xx, yy];
            cost = c;
          }
        }
      }
      if (cost < Infinity) {
        break;
      }
    }

    occupied.add(`${best[0]},${best[1]}`);
    points[i] = new Point(best[0], best[1]);
  }

  // Final cancellation check before committing changes to nodes.
  checkDirectCancellation(context);

  for (let i = 0; i < n; i++) {
    g.Nodes[i].TopLeft = points[i];
  }

  return true;
}

export const InitializeByGraphDistance = initializeByGraphDistance;
