# Slice 29: Proximity Common-Uncle Sibling Discovery (`CommonUncleSiblings`)

## Objective
Implement `proximity.commonUncleSiblings` and its PascalCase alias `CommonUncleSiblings` in `src/proximity/common-uncle.js`, matching Go TALA semantics for discovering groups of sibling nodes that share a common external connection target ("uncle") and returning the result as a fresh `Map`.

## Scope
- `commonUncleSiblings(graph)` → `Map<Node, Node[]>`
- `CommonUncleSiblings` (PascalCase alias)
- Module exports in `src/proximity/common-uncle.js` and `src/proximity/index.js`
- Traversal via `graph.ContainerRDFSOrderUnbounded(null)` (matches Go's unbounded `ContainerRDFSOrder(nil)`)
- Per-container `uncleToCousins` map reset after each container
- Persistent `orderedUncles` array — NOT reset per container
- Raw `.Container` field comparison for uncle eligibility (not `OwningContainer()`)
- Cousin deduplication per uncle via `.includes(node)` check
- Largest-group-wins assignment with strict-less-than tie-breaking
- Returns fresh `Map` — does NOT mutate `graph.CommonUncleSiblings`
- No WorkGuard, no context, no validation, no GraphState — pure read operation

## Progress
- [x] Implement JS `commonUncleSiblings` and `CommonUncleSiblings` in `src/proximity/common-uncle.js`.
- [x] Export `commonUncleSiblings` and `CommonUncleSiblings` from `src/proximity/index.js`.
- [x] Create Go Oracle script for all 16 scenarios (`go_common_uncle_siblings_oracle.go`).
- [x] Generate reference fixture `go-common-uncle-siblings-reference.json` (16 scenarios).
- [x] Create oracle replay test `common-uncle-siblings-oracle.test.js` (16 pass).
- [x] Create direct unit tests `common-uncle-siblings.test.js` (4 pass).
- [x] Pass all targeted tests (20 pass across 2 files).
- [x] Pass full JS regression suite (1371 pass, 0 fail, 60 files).

## Artifacts
- `docs/ADR-030-COMMON-UNCLE-SIBLINGS.md`
- `docs/SLICE-29-PROGRESS.md`
- `src/proximity/common-uncle.js`
- `src/proximity/index.js` (updated)
- `test/reference/go_common_uncle_siblings_oracle.go`
- `test/fixtures/go-common-uncle-siblings-reference.json`
- `test/unit/common-uncle-siblings-oracle.test.js`
- `test/unit/common-uncle-siblings.test.js`
