// Slice 46 — public surface of the hierarchy package port.
// Pinned reference: internal/hierarchy (exported API).
//
// The engine calls assign(ctx, g, null, candidates(g)), then
// place(ctx, g, null, rng), then removeIsolatedMemberships(g).
// Deliberately not re-exported from src/index.js or src/placement/index.js.

export { candidates, Candidates } from './eligibility.js';
export { assign, Assign, removeIsolatedMemberships, RemoveIsolatedMemberships } from './discovery.js';
export { place, Place } from './placement.js';
export { placeCompound, PlaceCompound } from './compound.js';
export { isHorizontal, IsHorizontal } from './orientation.js';
export { rankDAG, rankDAGWithLimit, RankResult } from './rank.js';
