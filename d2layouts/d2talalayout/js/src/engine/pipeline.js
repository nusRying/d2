// Slice 50 — the TALA layout pipeline.
//
// Pinned reference: d2layouts/d2talalayout/internal/engine/pipeline.go
//
// The engine is synchronous CPU code. Go runs a single pipeline on one
// goroutine as well; only seed attempts run concurrently in Go (see
// src/layout/coordinator.js), so no concurrency is emulated here.

import { Clone } from '../graph/clone.js';
import { MAX_GRAPH_SIZE } from '../limits/constants.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { WorkContext, getContextError } from '../limits/work-context.js';
import { GoRand } from '../random/go-math-rand.js';
import { LabelPosition } from '../graph/label-position.js';
import { IsUnlocked } from '../labeling/label-position-ops.js';
import { Validate } from '../graph/topology-preflight.js';

import { prescale } from '../placement/prescale.js';
import { addSequences } from '../grouping/sequences-mutation.js';
import { addClusters } from '../grouping/clusters-orchestration.js';
import { cleanup, resetClusters } from '../grouping/lifecycle.js';
import { addHubs } from '../proximity/hubs.js';
import { candidates, assign, place as placeHierarchy, removeIsolatedMemberships } from '../hierarchy/index.js';
import { preprocess as preprocessTrees } from '../trees/index.js';
import { prepare, place as placeNodes } from '../placement/structural-placement.js';
import { normalizeGaps, transposeAll } from '../placement/placement-stages.js';
import { optimizeClusters } from '../placement/cluster-optimization.js';
import { align, swap } from '../placement/stage-wrappers.js';
import { balanceSymmetry } from '../placement/symmetry.js';
import { equidistance } from '../placement/equidistance.js';
import { dejitter } from '../placement/dejitter.js';
import { normalize, pad } from '../placement/stage-geometry.js';
import { pack } from '../packing/binpack.js';
import { GraphRouteOptions, RouteGraph, RouteGraphWithWorkLimit } from '../routing/graph-stage.js';
import { Crosshatch, ReorderDuplicates, StraightEdgesFallback } from '../routing/coordinator.js';
import { SimplifyEdgeRoutes } from '../routing/edge-simplify.js';
import { SwapAllEdgePorts } from '../routing/swap-ports.js';
import { BalanceEdgeSegments, FixClusterEdgeBranching } from '../routing/postprocess.js';
import { TraceEdgesToShapeBorder } from '../routing/trace.js';
import { NudgeEdgeChannels } from '../routing/nudge-channels.js';
import { ShortcutEdgeRoutes } from '../routing/shortcut-routes.js';
import { NewOVG } from '../routing/ovg.js';
import { goFormatFloat } from '../routing/layoutgraph-route-support.js';
import { Place as placeLabels } from '../labeling/placement.js';

export const MAX_PIPELINE_GRAPH_SIZE = MAX_GRAPH_SIZE;

function wrapContextError(prefix, err) {
  return new Error(`${prefix}: ${err.message ?? String(err)}`, { cause: err });
}

function invariantError(message) {
  return new Error(`layout invariant violated: ${message}`);
}

/** LayoutOptions configures one deterministic layout attempt (Seed: signed int64). */
export class LayoutOptions {
  constructor({ Seed = 0n } = {}) {
    this.Seed = BigInt(Seed);
  }
}

/**
 * CancelChildContext models Go `context.WithCancel(parent)` for a parent
 * whose Done channel is nil: the child has its own Done/Err (it cannot observe
 * the parent's Err, exactly as in Go) while values such as the request
 * transaction guard are inherited.
 */
export class CancelChildContext extends WorkContext {
  constructor(parent) {
    super({ isCancelled: () => this._canceled, doneAvailable: true });
    this._parent = parent;
    this._canceled = false;
    this._err = null;
    this._transactionWorkGuard = parent?._transactionWorkGuard ?? null;
  }

  cancel() {
    if (!this._canceled) {
      this._canceled = true;
      this._err = new Error('context canceled');
    }
  }

  isCancelled() {
    return this._canceled;
  }

  Err() {
    return this._err;
  }
}

/** Go `ctx.Done() == nil`. */
export function contextHasNoDone(ctx) {
  return !(ctx != null && ctx.doneAvailable === true);
}

export class RoutingSnapshot {
  constructor(ovg, graph) {
    this.ovg = ovg;
    this.graph = graph;
  }
}

/** newRoutingSnapshot clones the OVG (via its JSON form) and the graph together. */
export function newRoutingSnapshot(ctx, ovg, graph) {
  const ovgCopy = NewOVG(null);
  ovgCopy.UnmarshalJSON(ovg.MarshalJSON());
  const graphCopy = Clone(ctx, graph);
  return new RoutingSnapshot(ovgCopy, graphCopy);
}

class RoutingSnapshotObserver {
  constructor(pipeline, ctx) {
    this.pipeline = pipeline;
    this.ctx = ctx;
    this.started = false;
  }

  SubgraphRouted(ovg) {
    if (!this.started) {
      this.pipeline.snapshots = null;
      this.started = true;
    }
    let snapshot;
    try {
      snapshot = newRoutingSnapshot(this.ctx, ovg, this.pipeline.graph);
    } catch (err) {
      throw wrapContextError('copy edge-routing snapshot', err);
    }
    if (this.pipeline.snapshots == null) this.pipeline.snapshots = [];
    this.pipeline.snapshots.push(snapshot);
  }
}

/** PipelineStage {name, run(pipeline, ctx)}. */
export class PipelineStage {
  constructor(name, run) {
    this.name = name;
    this.run = run;
  }
}

export class Pipeline {
  constructor(graph, seed, storeSnapshots) {
    this.graph = graph;
    this.seed = BigInt(seed);
    // Two independent generators from the same seed (pinned newPipeline).
    this.hierarchyPlacementRandom = new GoRand(this.seed);
    this.random = new GoRand(this.seed);
    this.stages = null;
    this.storeSnapshots = Boolean(storeSnapshots);
    this.snapshots = null;
    this.forceReroute = false;
    this.edgeRoutingComplete = false;
    this.alignAxesNeeded = true;
  }

  stagePlan() {
    return this.stages ?? DEFAULT_PIPELINE_STAGES;
  }

  prescaleStage() {
    prescale(this.graph);
  }

  preprocessSequenceStage(ctx) {
    addSequences(ctx, this.graph, this.random);
  }

  preprocessStage() {
    prepare(this.graph);
  }

  preprocessTreesStage(ctx) {
    preprocessTrees(ctx, this.graph);
  }

  preprocessHierarchies(ctx) {
    assign(ctx, this.graph, null, candidates(this.graph));
    placeHierarchy(ctx, this.graph, null, this.hierarchyPlacementRandom);
    removeIsolatedMemberships(this.graph);
  }

  preprocessClusters(ctx) {
    addClusters(ctx, this.graph, this.seed, this.random);
  }

  preprocessHubs(ctx) {
    addHubs(ctx, this.graph);
  }

  nodePlacementStage(ctx) {
    placeNodes(ctx, this.graph, this.seed);
  }

  swapNodesStage(ctx) {
    swap(ctx, this.graph);
  }

  transposeStage(ctx) {
    transposeAll(ctx, this.graph);
  }

  alignAxes(ctx) {
    if (!this.alignAxesNeeded) return;
    // Pinned: cleared before Align runs.
    this.alignAxesNeeded = false;
    align(ctx, this.graph);
  }

  gapNormalizationStage(ctx) {
    // Go assigns the returned bool even when the stage returns an error
    // (false on error); a throw leaves the field unassigned in JS, which is
    // unobservable because the pipeline aborts.
    this.alignAxesNeeded = normalizeGaps(ctx, this.graph);
  }

  optimizeClustersStage(ctx) {
    this.graph.ComputeCellSize();
    this.alignAxesNeeded = optimizeClusters(ctx, this.graph);
  }

  balanceSymmetryStage(ctx) {
    balanceSymmetry(ctx, this.graph);
  }

  equidistanceStage(ctx) {
    this.graph.ComputeCellSize();
    this.alignAxesNeeded = equidistance(ctx, this.graph);
  }

  binPack(ctx) {
    pack(ctx, this.graph, null);
  }

  cleanupGroupsStage() {
    cleanup(this.graph);
  }

  rescaleStage() {
    this.graph.ComputeCellSize();
    pad(this.graph);
  }

  edgeRoutingStage(ctx) {
    this.runGraphRouting(ctx, null);
  }

  crosshatchStage(ctx) {
    Crosshatch(ctx, this.graph);
  }

  dejitterStage(ctx) {
    this.forceReroute = dejitter(ctx, this.graph);
  }

  simplifyEdgeRoutes(ctx) {
    SimplifyEdgeRoutes(ctx, this.graph);
  }

  swapEdgePorts(ctx) {
    SwapAllEdgePorts(ctx, this.graph);
  }

  straightEdgesFallback(ctx) {
    StraightEdgesFallback(ctx, this.graph);
  }

  balanceEdgeSegments(ctx) {
    BalanceEdgeSegments(ctx, this.graph);
  }

  fixClusterEdgeBranching(ctx) {
    FixClusterEdgeBranching(ctx, this.graph);
  }

  traceEdgesToShapeBorder(ctx) {
    TraceEdgesToShapeBorder(ctx, this.graph);
  }

  reorderDuplicates(ctx) {
    ReorderDuplicates(ctx, this.graph);
  }

  placeLabels(ctx) {
    placeLabels(ctx, this.graph);
  }

  nudgeEdgeChannels(ctx) {
    NudgeEdgeChannels(ctx, this.graph);
  }

  shortcutEdgeRoutes(ctx) {
    ShortcutEdgeRoutes(ctx, this.graph);
  }

  normalizeStage() {
    normalize(this.graph);
  }

  /** RouteCompletionObserver. */
  RoutingCompleted() {
    this.edgeRoutingComplete = true;
  }

  /** Default SubgraphRouteObserver: no snapshots are retained. */
  SubgraphRouted() {
    this.snapshots = null;
  }

  routeObserver(ctx) {
    if (!this.storeSnapshots) return this;
    return new RoutingSnapshotObserver(this, ctx);
  }

  /**
   * runGraphRouting restores snapshots and edgeRoutingComplete on any error
   * or throw; on success edgeRoutingComplete takes RouteGraph's result.
   */
  runGraphRouting(ctx, workLimit) {
    if (this.graph == null) {
      throw new Error('TALA EdgeRouting requires a graph');
    }
    const originalSnapshots = this.snapshots;
    const originalRoutingComplete = this.edgeRoutingComplete;
    let succeeded = false;
    try {
      const options = new GraphRouteOptions({
        ForceReroute: this.forceReroute,
        RoutesPreviouslyCompleted: this.edgeRoutingComplete,
        Observer: this.routeObserver(ctx),
        CompletionObserver: this,
      });
      const routingComplete = workLimit == null
        ? RouteGraph(ctx, this.graph, options)
        : RouteGraphWithWorkLimit(ctx, this.graph, options, workLimit);
      this.edgeRoutingComplete = routingComplete;
      succeeded = true;
    } finally {
      if (!succeeded) {
        this.snapshots = originalSnapshots;
        this.edgeRoutingComplete = originalRoutingComplete;
      }
    }
  }

  /** resetFullLayoutRouteState invalidates stale routes and route-derived state. */
  resetFullLayoutRouteState() {
    for (const edge of this.graph.Edges) {
      if (edge == null) continue;
      edge.Points = [];
      if (edge.Label == null || !edge.Label.PositionFixed()) {
        edge.LabelPercentage = 0;
        if (edge.Label != null && IsUnlocked(edge.Label.Position)) {
          edge.Label.Position = LabelPosition.Unset;
        }
      }
      edge.IsCurve = false;
    }
    this.graph.ResetPlacementCosts();
  }

  /** runAllStages executes the stage plan with a shared transaction guard. */
  runAllStages(ctx) {
    const [stageCtx] = ensureTransactionWorkGuard(ctx, 'AutolayoutTransactions');
    const stages = this.stagePlan();
    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
      const stage = stages[stageIndex];
      let err = getContextError(stageCtx);
      if (err != null) throw wrapContextError(stage.name, err);
      if (stageIndex === 0) {
        resetClusters(this.graph);
        this.resetFullLayoutRouteState();
      }
      stage.run(this, stageCtx);
      err = getContextError(stageCtx);
      if (err != null) throw wrapContextError(stage.name, err);

      const [tl, br] = this.graph.BoundingBox();
      if (tl != null && br != null) {
        const width = br.X - tl.X;
        const height = br.Y - tl.Y;
        if (width > MAX_PIPELINE_GRAPH_SIZE || height > MAX_PIPELINE_GRAPH_SIZE) {
          throw invariantError(`Dimensions w:${goFormatFloat(width)}, h:${goFormatFloat(height)} reached after stage ${stage.name}`);
        }
      }
    }
  }
}

function stage(name, method) {
  return new PipelineStage(name, (pipeline, ctx) => pipeline[method](ctx));
}

/** The pinned 37-stage plan (pipeline.go defaultPipelineStages). */
export const DEFAULT_PIPELINE_STAGES = Object.freeze([
  stage('Prescale', 'prescaleStage'),
  stage('PreprocessSequences', 'preprocessSequenceStage'),
  stage('Preprocess', 'preprocessStage'),
  stage('PreprocessTrees', 'preprocessTreesStage'),
  stage('PreprocessHierarchies', 'preprocessHierarchies'),
  stage('PreprocessClusters', 'preprocessClusters'),
  stage('PreprocessHubs', 'preprocessHubs'),
  stage('NodePlacement', 'nodePlacementStage'),
  stage('SwapStuff', 'swapNodesStage'),
  stage('Transpose', 'transposeStage'),
  stage('AlignAxes', 'alignAxes'),
  stage('GapNormalization', 'gapNormalizationStage'),
  stage('AlignAxes', 'alignAxes'),
  stage('OptimizeClusters', 'optimizeClustersStage'),
  stage('AlignAxes', 'alignAxes'),
  stage('BalanceSymmetry', 'balanceSymmetryStage'),
  stage('Equidistance', 'equidistanceStage'),
  stage('AlignAxes', 'alignAxes'),
  stage('BinPack', 'binPack'),
  stage('CleanupStuff', 'cleanupGroupsStage'),
  stage('Rescale', 'rescaleStage'),
  stage('EdgeRouting', 'edgeRoutingStage'),
  stage('Crosshatch', 'crosshatchStage'),
  stage('Dejitter', 'dejitterStage'),
  stage('EdgeRouting', 'edgeRoutingStage'),
  stage('SimplifyEdgeRoutes', 'simplifyEdgeRoutes'),
  stage('SwapEdgePorts', 'swapEdgePorts'),
  stage('StraightEdgesFallback', 'straightEdgesFallback'),
  stage('BalanceEdgeSegments', 'balanceEdgeSegments'),
  stage('FixClusterEdgeBranching', 'fixClusterEdgeBranching'),
  stage('TraceEdgesToShapeBorder', 'traceEdgesToShapeBorder'),
  stage('ReorderDuplicates', 'reorderDuplicates'),
  stage('BinPack', 'binPack'),
  stage('PlaceLabels', 'placeLabels'),
  stage('NudgeEdgeChannels', 'nudgeEdgeChannels'),
  stage('ShortcutEdgeRoutes', 'shortcutEdgeRoutes'),
  stage('Normalize', 'normalizeStage'),
]);

/** newPipeline initializes one deterministic layout pipeline. */
export function newPipeline(graph, seed, storeSnapshots = false) {
  return new Pipeline(graph, seed, storeSnapshots);
}

/** pipelineInstrumentation (stage timing is not part of the JS port). */
export class PipelineInstrumentation {
  constructor({ storeSnapshots = false } = {}) {
    this.storeSnapshots = storeSnapshots;
  }
}

/** runLayout runs the pipeline in place; returns null for an empty graph. */
export function runLayout(ctx, graph, options, instrumentation = new PipelineInstrumentation(), validate = false) {
  if (ctx == null) {
    throw new Error('TALA Autolayout requires a context');
  }
  const err = getContextError(ctx);
  if (err != null) throw wrapContextError('Autolayout', err);
  if (graph == null) {
    throw new Error('TALA Autolayout requires a graph');
  }
  if (validate) {
    Validate(ctx, 'Autolayout', graph);
  }
  if (graph.Nodes.length === 0) {
    return null;
  }
  let workCtx = ctx;
  let child = null;
  if (contextHasNoDone(ctx)) {
    child = new CancelChildContext(ctx);
    workCtx = child;
  }
  try {
    const pipeline = newPipeline(graph, options.Seed, instrumentation.storeSnapshots);
    pipeline.runAllStages(workCtx);
    return pipeline;
  } finally {
    if (child != null) child.cancel();
  }
}

/**
 * Layout returns one complete deterministic layout in a NEW graph; the input
 * graph is never mutated.
 */
export function Layout(ctx, graph, options = new LayoutOptions()) {
  if (ctx == null) {
    throw new Error('TALA Autolayout requires a context');
  }
  let err = getContextError(ctx);
  if (err != null) throw wrapContextError('Autolayout', err);
  if (graph == null) {
    throw new Error('TALA Autolayout requires a graph');
  }
  let workspace;
  try {
    workspace = Clone(ctx, graph);
  } catch (cloneErr) {
    const contextErr = getContextError(ctx);
    if (contextErr != null) throw wrapContextError('Autolayout', contextErr);
    throw cloneErr;
  }
  runLayout(ctx, workspace, options instanceof LayoutOptions ? options : new LayoutOptions(options), new PipelineInstrumentation(), false);
  err = getContextError(ctx);
  if (err != null) throw wrapContextError('Autolayout', err);
  return workspace;
}

export const layoutGraph = Layout;
