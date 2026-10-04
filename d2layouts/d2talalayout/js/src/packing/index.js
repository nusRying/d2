// Slice 46 — packing package public API.
// Pinned reference: d2layouts/d2talalayout/internal/packing (Pack, CombineSubgraphs).
//
// Intentionally not re-exported from js/src/index.js or js/src/placement/index.js.
//
//   pack(ctx, g, root)                                   Go packing.Pack(ctx, g, root)
//   combineSubgraphs(ctx, g, subgraphs, ancestorObstacles) Go packing.CombineSubgraphs
//
// Go's third Pack parameter is the container node to pack (null = graph root),
// so the JS parameter keeps that meaning.

export { pack, Pack } from './binpack.js';
export { combineSubgraphs, CombineSubgraphs } from './combine.js';
