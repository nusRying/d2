# ADR 001: Use ELK-compatible JSON as the public JavaScript input/output contract

## Context
We are migrating the D2 TALA layout engine from Go to JavaScript. We need a stable, public-facing data format for the layout engine to consume (the input graph) and produce (the laid-out graph with geometry).

## Decision
We will use ELK-compatible JSON as the public JavaScript input and output contract. The JavaScript implementation will not expose its internal TALA graph objects as the long-term public contract.

## Alternatives considered
- Exposing the internal TALA graph objects directly to consumers.
- Inventing a new, proprietary JSON schema specific to TALA.

## Why this approach was selected
ELK JSON is a standardized, well-understood format for graph layout that D2 already integrates with (e.g., via `d2elklayout`). Using ELK JSON provides a clear boundary, makes the package easier to consume by external tools, and allows us to change the internal graph representation without breaking the public API. It also aligns with the goals of making the package suitable for a broader ecosystem.

## Consequences
- The engine must implement robust converters (`elkToTalaGraph` and `talaToElkGraph`).
- Unknown ELK properties must be carefully preserved during the round trip since the internal representation won't natively understand all of them.
- External callers must parse/serialize to ELK format, which is slightly more overhead but provides safety and decoupling.
