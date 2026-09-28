# Slice 01 Progress Document

## Goal
Establish the JavaScript migration foundation without porting actual TALA layout algorithms. Prove that we can perform a round trip from ELK JSON -> JS internal graph -> ELK JSON.

## Existing behavior studied
- Inspected the Go `d2talalayout` implementation.
- Read `ARCHITECTURE.md` and `README.md`.
- Understood that TALA uses an internal mutable graph during layout and copies it for seeds.
- D2 graph is only mutated on success. 
- Go random number generator determinism is based on `rand.NewSource`.

## Implementation approach
- JavaScript location: `d2layouts/d2talalayout/js`. This keeps it logically close to the existing Go code while following the `d2js/js` convention found in the repository.
- Built an npm/bun project using ES Modules.
- Created `Graph`, `Node`, and `Edge` classes with minimal properties (id, dimensions, positions, hierarchy, edge routing placeholders).
- Created `elkToTalaGraph` to parse nested structures and coordinates safely.
- Created `talaToElkGraph` to reconstruct the ELK JSON while preserving unknown fields.

## Files added/changed
- `package.json`
- `src/index.js`
- `src/graph/graph.js`
- `src/graph/node.js`
- `src/graph/edge.js`
- `src/graph/clone.js`
- `src/elk/adapter.js`
- `src/geometry/point.js`
- `src/geometry/rectangle.js`
- `test/fixtures/simple-chain.json`
- `test/fixtures/nested-container.json`
- `test/fixtures/metadata-preservation.json`
- `test/unit/adapter.test.js`
- `docs/MIGRATION.md`
- `docs/ADR-001-ELK-CONTRACT.md`
- `docs/SLICE-01-PROGRESS.md`

## Design decisions
- Used plain JavaScript (ESM) over TypeScript initially to reduce friction, as requested.
- Adopted `bun` for testing to mirror the existing `d2js/js` package conventions.
- Chose to preserve ELK metadata by attaching the original ELK node payload to the internal node object and cloning/patching it on output.

## Tests
Executed using `bun test`.
Results:
- ELK Adapter > should parse a simple chain graph (PASS)
- ELK Adapter > should parse nested containers (PASS)
- ELK Adapter > should handle empty or missing arrays gracefully (PASS)
- ELK Adapter > should reject malformed input (PASS)
- ELK Adapter > should preserve metadata during round-trip (PASS)
- ELK Adapter > should update geometry during round-trip (PASS)
- ELK Adapter > should not mutate the original input during clone and conversion (PASS)

7 pass, 0 fail.

## Problems encountered
- A minor pathing typo when initially creating the test fixtures.
- Incorrect use of `&&` in the test command string, which is not valid syntax in the host's version of PowerShell.

## Resolutions
- Corrected the fixture path and recreated the file.
- Used `;` instead of `&&` for sequencing commands in PowerShell.

## Current limitations
- No actual layout algorithms are implemented yet.
- Deterministic RNG parity is deferred to a future slice.

## Result
The ELK graph adapter safely converts an ELK input to our internal TALA JS graph representation and back, while safely cloning non-mutating input and preserving unknown metadata/layout options.

## Commit information
- Branch: `tala-js/slice-01-foundation`
- SHA: Pending initial commit
- Remote: `origin` (GitHub `Test-Task`)
