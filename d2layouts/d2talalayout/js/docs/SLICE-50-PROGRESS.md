# Slice 50 Progress — Engine, Public API and Final E2E Parity (final slice)

Status: **Implemented — awaiting review**

Base commit: `fe97885edce77c3a99dceb5a5454f4d52f008cd4` (Slice 49 approved)

Pinned Go: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-051 for the decisions summarized here. This is the final progress file of the migration.

## Implemented
- **Context-aware graph clone** in `src/graph/clone.js`: `Clone(ctx, source)` with the pinned guard placement.
- **Engine** in `src/engine/`:
  - `pipeline.js`: the 37-stage pipeline, two `GoRand` streams, route reset, the shared transaction guard, per-stage cancellation and size checks, the routing observer and its rollback, `runLayout` and `Layout`.
  - `compound-candidate.js`: `CompoundCandidate`, `compoundCrossAxisDetours`, `reroutePlaced`.
  - `compound-routes.js`: `PreserveCompoundRoutes`, `preserveCompoundInteriors`, `compoundRoot`, `compoundEnclosedRoute`.
- **Layout boundary** in `src/layout/`:
  - `result-validation.js`: completed-graph, topology and immutable-metadata checks.
  - `result.js`: `SeedResult`, `evaluateSeedResult`.
  - `options.js`: seed normalization, the layout plan and `defaultOptions`.
  - `seed.js`: `newSeedInput`, `runSeed`.
  - `coordinator.js`: deterministic multi-seed selection, optional candidates and refinement.
  - `public-layout.js`: the async `layout()`.
- **ELK adapter** (`src/elk/adapter.js`):
  - one managed label per node and edge;
  - `elk.direction`;
  - `edge.Points` written as owner-relative ELK sections, plus label output;
  - iterative bounds checks on nodes, edges, route points and depth;
  - output that is plain JSON.
- **Package and CI:**
  - The package is `@syntroper/tala-js`, with explicit `exports` and a root that exports only `layout` and `defaultOptions`. The former barrel moved to `src/internal.js` for tests.
  - Added `README.md`.
  - CI gains engine and top-level Go jobs and a browser package smoke job (root import, a small layout, and `bun build --target browser` with a bundle scan).

## Real-Go oracles
All three are generated only with `TALA_SLICE50_ORACLE=1`; ordinary `go test` verifies them and never writes.
- **Engine:** `internal/engine/go_slice50_engine_oracle_test.go` → `js/test/fixtures/go-slice50-engine-reference.json`, replayed by `js/test/unit/engine-e2e-oracle.test.js`.
  - It covers 14 graphs (from empty through multiple components) across 22 seed runs, and 4 compound cases (2 that change, a fixed graph that is skipped, and a container-free graph that is skipped).
  - The JS replay matches Go exactly: geometry, routes, labels, penalty and area.
- **Selection:** `go_slice50_selection_oracle_test.go` → `go-slice50-selection-reference.json`, replayed by `seed-selection-oracle.test.js`.
  - It covers normalizeSeeds, score comparison, coordinateLocalSeeds at concurrency 1–3 (the JS replay runs every completion order), and optional candidate and refinement outcomes.
- **Clone:** `internal/layoutgraph/go_slice50_clone_oracle_test.go` → `go-slice50-clone-reference.json`.

## Tests
- New JS tests:
  - `engine-e2e-oracle`, `engine-pipeline`, `compound-candidate`
  - `seed-selection-oracle`, `seed-result`, `result-validation`, `graph-clone-context`
  - `elk-adapter-final`
  - `public-layout`, `public-layout-options`, `public-layout-determinism`
- Full JS suite results are in the final report. The Slice 49 baseline was 5357 tests, 0 failures, 208,998 assertions, across 148 files.
- Go: engine, the top-level package, and all 15 internal package groups pass.
  - On a Windows checkout with `core.autocrlf=true`, the engine golden-file tests (`TestGraphs`, `TestBuildOVGFromGraph`) report whole-file CRLF diffs. CI runs on Linux checkouts, where they pass.

## Production file ledger

### Go engine production files
| Go file | JS port |
|---|---|
| `internal/engine/pipeline.go` | `src/engine/pipeline.js` |
| `internal/engine/compound_candidate.go` | `src/engine/compound-candidate.js` |
| `internal/engine/compound_routes.go` | `src/engine/compound-routes.js` |
| `internal/engine/doc.go` | (package doc only) |

Remaining unported engine production files: **NONE**.

### Top-level Go files
| Go file | JS |
|---|---|
| `layout.go` | `src/layout/options.js`, `coordinator.js`, `public-layout.js` |
| `result.go` | `src/layout/result.js` (score: `src/quality/score.js`) |
| `result_validate.go` | `src/layout/result-validation.js` |
| `seedgraph.go` | `src/layout/seed.js` |
| `limits.go` | `src/limits/constants.js`, `src/layout/result-validation.js` (maxResultCoordinate) |
| `adapter.go`, `patch.go`, `adapter_validate.go` | Not ported by design (ADR-001). The D2 object model is replaced by the ELK JSON boundary in `src/elk/adapter.js`, which applies the same safety principles: bounded topology, immutability, explicit errors. |
| `doc.go` | (package doc only) |

Remaining required public layout orchestration: **NONE**.

### Go internal packages
| Go package | Status |
|---|---|
| limits, layoutgraph, geometry (lib/geo subset), shape/nodeshape, placementcost, proximity, grouping, hierarchy, trees, placement, packing, routing, labeling (incl. labelgeom), quality, graphbounds, loops | Ported (Slices 1–49) |
| engine | Ported (Slice 50) |
| invariant | Mapped to JS error conventions (`layout invariant violated: …`) |
| graphjson | Not ported. It is the Go graph JSON codec for D2 tooling and goldens; the public JSON contract is ELK (ADR-001). |
| typedpool | Not needed. It is Go allocation pooling with no observable behavior. |

### JS source tree
| Directory | Files |
|---|---|
| `elk` | 1 |
| `engine` | 3 |
| `layout` | 6 |
| `graph` | 21 |
| `geometry` | 9 |
| `shape` | 9 |
| `limits` | 6 |
| `random` | 1 |
| `placementcost` | 11 |
| `placement` | 33 |
| `proximity` | 5 |
| `grouping` | 8 |
| `hierarchy` | 16 |
| `trees` | 7 |
| `packing` | 10 |
| `loops` | 4 |
| `graphbounds` | 2 |
| `routing` | 38 |
| `labeling` | 7 |
| `quality` | 8 |

Plus `index.js` (the public root) and `internal.js` (the test barrel).

## Migration ledger
The ledger in MIGRATION.md runs contiguously from Slice 01 to Slice 50, with the previously missing Slice 45 entry restored. Slices 01–49 are complete and Slice 50 is implemented, awaiting review. No migration slice remains after Slice 50.
