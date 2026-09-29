/**
 * Limits and topology ceilings for the TALA layout engine.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/limits/work.go
 */

// MaxEngineNodes is the largest node count the engine processes in one attempt.
export const MAX_ENGINE_NODES = 10_000;

// MaxEngineEdges is the largest edge count the engine processes in one attempt.
export const MAX_ENGINE_EDGES = 50_000;

// MaxEngineRoutePoints bounds aggregate route storage throughout the engine.
export const MAX_ENGINE_ROUTE_POINTS = 1_000_000;
export const MAX_ROUTE_POINTS = MAX_ENGINE_ROUTE_POINTS;

// MaxEngineTreeDepth bounds recursive topology throughout the engine.
export const MAX_ENGINE_TREE_DEPTH = 256;
export const MAX_TOPOLOGY_DEPTH = MAX_ENGINE_TREE_DEPTH;

// MaxTopologyReferences bounds visited runtime references during preflight validation.
export const MAX_TOPOLOGY_REFERENCES = 1_000_000;

// MaxPreflightWork bounds work units spent during preflight validation.
export const MAX_PREFLIGHT_WORK = 8_000_000n;

// MaxGraphSize is the maximum supported width or height at a pipeline stage boundary.
export const MAX_GRAPH_SIZE = 30_000;

// Signed 64-bit integer range boundaries
export const INT64_MIN = -9223372036854775808n;
export const INT64_MAX = 9223372036854775807n;

// Internal polling strides and entity scaling (represented as BigInt)
export const CONTEXT_CHECK_STRIDE = 64n;
export const CANCELLABLE_CONTEXT_CHECK_STRIDE = 1024n;
export const WORK_UNITS_PER_ENTITY = 1024n;

// MaxEngineWorkUnits is the default aggregate work budget for a graph.
// (10_000 + 50_000) * 1024 = 61_440_000n
export const MAX_ENGINE_WORK_UNITS =
  BigInt(MAX_ENGINE_NODES + MAX_ENGINE_EDGES) * WORK_UNITS_PER_ENTITY;

// MaxTransactionWorkUnits allows a complete layout transaction to compare
// many nearby placements without resetting the ordinary engine budget for every candidate.
export const MAX_TRANSACTION_WORK_UNITS = 1_000_000_000n;

// MaxTransactionOverlapReferences bounds retained existing-overlap references.
export const MAX_TRANSACTION_OVERLAP_REFERENCES = 4_000_000n;

// MaxBinPackWorkUnits spans the complete recursive bin-packing operation.
export const MAX_BIN_PACK_WORK_UNITS = 1_000_000_000n;

// MaxPlaceTreesWorkUnits is calibrated for candidate and obstacle work performed by tree placement.
export const MAX_PLACE_TREES_WORK_UNITS = 68_000_000n;

// MaxLabelPlacementWorkUnits bounds the quadratic overlap and candidate search
// performed while positioning labels and icons.
export const MAX_LABEL_PLACEMENT_WORK_UNITS = 50_000_000n;
