// Pinned references:
//   internal/hierarchy/placement.go  (crossingSpacing, parentSpacing,
//                                     siblingDummySpacing, siblingSpacing)
//   internal/hierarchy/discovery.go  (minHierarchyLevels, maxAutomaticWorkflow*)
//   internal/hierarchy/crossing.go   (crossingComparisonPrecision)
//   internal/hierarchy/compound.go   (maxCompoundBlocks, maxCompoundInterfaces)
//   internal/layoutgraph/geometry_policy.go (ContainerPadding, MinPortClearance)

export const CROSSING_SPACING = 50.0;
export const PARENT_SPACING = 300.0;
export const SIBLING_DUMMY_SPACING = 50.0;
export const SIBLING_SPACING = 60.0;

export const MIN_HIERARCHY_LEVELS = 3;
export const MAX_AUTOMATIC_WORKFLOW_NODES = 128;
export const MAX_AUTOMATIC_WORKFLOW_EDGES = 256;

export const CROSSING_COMPARISON_PRECISION = 0.0001;

export const MAX_COMPOUND_BLOCKS = 64;
export const MAX_COMPOUND_INTERFACES = 256;

// layoutgraph.ContainerPadding and layoutgraph.MinPortClearance.
export const LAYOUTGRAPH_CONTAINER_PADDING = 60;
export const MIN_PORT_CLEARANCE = 20.0;
