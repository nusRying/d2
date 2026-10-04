# @syntroper/tala-js

A browser-safe JavaScript port of the TALA graph layout engine. The public
API takes and returns **ELK-compatible JSON** (see
[docs/ADR-001-ELK-CONTRACT.md](docs/ADR-001-ELK-CONTRACT.md)).

```js
import { layout } from "@syntroper/tala-js";

const result = await layout(
  {
    id: "root",
    children: [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 }
    ],
    edges: [
      { id: "e1", sources: ["a"], targets: ["b"] }
    ]
  },
  { seed: 1 }
);

// result.children[i].x / .y are set; result.edges[0].sections holds the route.
```

## Contract

- **Input / output:** an ELK JSON graph (`id`, `children`, `edges`, optional
  `ports`, `labels`, `layoutOptions`). `layout` resolves to a **new** plain
  JSON object; the input is never mutated. Node `x`/`y` are relative to the
  parent node, as in ELK. Each routed edge gets exactly one section
  (`startPoint`, `bendPoints`, `endPoint`) in coordinates relative to the
  node that owns the edge (`edges` array it appears in).
- **Preserved:** ids, `layoutOptions`, ports and port-referencing
  `sources`/`targets`, label ids/text and any unknown/custom properties. Only
  layout-owned fields (node geometry, the managed label's geometry and edge
  sections) are written.
- **Edges:** each ELK edge is directed from its source to its target (like a
  D2 `a -> b` connection), so `elk.direction` steers the flow of the layout.
- **Labels:** at most **one** layout-managed label per node and per edge
  (`labels[0]`); more than one is rejected with an explicit error.
- **Direction:** `layoutOptions["elk.direction"]` (`UP`, `DOWN`, `LEFT`,
  `RIGHT`, case-insensitive) on the root or a container.
- **Limits:** at most 10,000 nodes, 50,000 edges, 1,000,000 input route points
  and nesting depth 256; larger inputs are rejected before layout.

## Options

| option | meaning |
|---|---|
| `seed` | One deterministic seed (safe-integer `number`, `bigint`, or integer string; signed 64-bit). |
| `seeds` | Several seeds; each runs once and the best-scoring layout wins (an exact score tie goes to the later seed). Default `[1, 2, 3]`. At most 64 entries / 16 unique. |
| `maxConcurrency` | 1–16 (0 or omitted = default). Accepted for API parity; the engine runs attempts sequentially in one thread. |
| `signal` | An `AbortSignal`. A signal that is already aborted when `layout` is called is honored immediately (before any work). See *Cancellation* below. |

`seed` and `seeds` are mutually exclusive; unknown options are rejected.
`defaultOptions()` returns a fresh copy of the defaults.

## Cancellation

- A signal already aborted before `layout` begins is honored immediately: the
  promise rejects with a cancellation error before any conversion or layout
  work.
- The engine runs synchronously on the calling JavaScript thread; the package
  uses no Workers.
- An `AbortSignal` aborted later by a timer or other event-loop callback cannot
  preempt a layout that is already executing: that callback cannot run until
  the synchronous layout returns control to the event loop. Such an abort is
  therefore not observed mid-run.
- Applications that need responsive cancellation during long layouts should
  host the package in their own Worker (or similar isolated execution
  boundary) and terminate or ignore that worker to cancel.

The same input and seed always produce the same output. The library has no
runtime dependencies and uses no Node.js APIs; it runs in browsers and in
Node/Bun/Deno.

## Development

```bash
bun test
```

Real-Go parity fixtures are regenerated from the Go sources with the
`TALA_SLICE<n>_ORACLE=1` environment variables; ordinary `go test` only
verifies them.
