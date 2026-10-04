// @syntroper/tala-js — public package surface (ADR-001, ADR-051).
//
// The supported API is the ELK-JSON layout boundary. Internal graph,
// placement, routing, labeling, quality and engine modules are not part of
// the package contract (tests import them by file path).

export { layout } from './layout/public-layout.js';
export { defaultOptions } from './layout/options.js';
