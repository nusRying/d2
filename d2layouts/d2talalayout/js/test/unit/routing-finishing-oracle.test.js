import { expect, test } from 'bun:test';
import fixture from '../fixtures/go-slice48-routing-finishing-reference.json';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Cluster } from '../../src/graph/cluster.js';
import { Label } from '../../src/graph/label.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { Inspect } from '../../src/quality/inspection.js';
import { simplifyEdgeRoutesWithLimit } from '../../src/routing/edge-simplify.js';
import { swapAllEdgePortsWithWorkLimit } from '../../src/routing/swap-ports.js';
import { StraightEdgesFallback, ReorderDuplicates, crosshatchWithWorkLimit } from '../../src/routing/coordinator.js';
import { balanceEdgeSegmentsWithLimit, fixClusterEdgeBranchingWithLimit } from '../../src/routing/postprocess.js';
import { traceEdgesToShapeBorderWithWorkLimit } from '../../src/routing/trace.js';
import { nudgeChannelsWithLimit } from '../../src/routing/nudge-channels.js';
import { shortcutRoutesWithLimit } from '../../src/routing/shortcut-routes.js';
const bg=backgroundWorkContext();
const stages={SimplifyEdgeRoutes:simplifyEdgeRoutesWithLimit,SwapAllEdgePorts:swapAllEdgePortsWithWorkLimit,
  StraightEdgesFallback,ReorderDuplicates,Crosshatch:crosshatchWithWorkLimit,BalanceEdgeSegments:balanceEdgeSegmentsWithLimit,
  FixClusterEdgeBranching:fixClusterEdgeBranchingWithLimit,TraceEdgesToShapeBorder:traceEdgesToShapeBorderWithWorkLimit,
  NudgeEdgeChannels:nudgeChannelsWithLimit,ShortcutEdgeRoutes:shortcutRoutesWithLimit,Inspect};
function build(c) {
  const g=new Graph(),nodes=new Map();
  for(const s of c.nodes){const n=new Node(BigInt(s.id),s.w,s.h);n.TopLeft=new Point(s.x,s.y);if(s.shape)n.SetShape(s.shape);g.AddNode(n);nodes.set(s.id,n);}
  for(const s of c.nodes)if(s.container){const n=nodes.get(s.id),parent=nodes.get(s.container);n.Container=parent;g.AddNodeToContainer(parent,n);}
  for(const s of c.edges){const e=g.Connect(nodes.get(s.from),nodes.get(s.to));e.Points=s.points.map(p=>new Point(p.x,p.y));if(s.label)e.Label=new Label(s.label,40,20);}
  if(c.cluster){const vessel=new Node(100n,500,100);vessel.TopLeft=g.Nodes[0].TopLeft.Copy();const ns=c.cluster.map(id=>nodes.get(id));const cluster=new Cluster({Vessel:vessel,Nodes:ns,Arrangement:'Row',DesiredArrangement:'Row',Graph:g});g.Clusters.set(vessel,cluster);for(const n of ns)n.Cluster=cluster;
    if(c.stage==='Crosshatch')for(const e of g.Edges)cluster.EdgeAbductions.push(new EdgeAbduction({Edge:e,OriginallyFrom:e.From,CurrentFrom:e.From,CurrentTo:e.To}));
  }
  return g;
}
const routes=g=>g.Edges.map(e=>e.Points.map(p=>({x:p.X,y:p.Y})));
function metrics(actual,want){for(const k of Object.keys(want)){if(['Crossings','Detour','RouteLength'].includes(k))expect(actual[k]).toBeCloseTo(want[k],10);else expect(actual[k]).toBe(want[k]);}}
for(const c of fixture.cases){
  test(`pinned Go ${c.stage}/${c.name} routes and inspection`,()=>{
    const g=build(c);expect(routes(g)).toEqual(c.before);metrics(Inspect(bg,g),c.metrics_before);
    stages[c.stage](bg,g,c.work??50000000);expect(routes(g)).toEqual(c.after);metrics(Inspect(bg,g),c.metrics_after);
  });
  if(c.work)test(`pinned Go ${c.stage}/${c.name} W=${c.work} and W-1 exact rollback`,()=>{
    const g=build(c),costs=g.RoutingCosts();
    const state=g.Edges.map(e=>({e,array:e.Points,refs:[...e.Points],values:e.Points.map(p=>[p.X,p.Y]),curve:e.IsCurve,label:e.Label,percentage:e.LabelPercentage}));
    let err;try{stages[c.stage](bg,g,c.work-1);}catch(e){err=e;}expect(err).toBeDefined();expect(err.message).toContain('work exceeds');
    expect(g.RoutingCosts()).toEqual(costs);
    for(const s of state){expect(s.e.Points).toBe(s.array);expect(s.e.IsCurve).toBe(s.curve);expect(s.e.Label).toBe(s.label);expect(s.e.LabelPercentage).toBe(s.percentage);s.refs.forEach((p,i)=>{expect(s.e.Points[i]).toBe(p);expect([p.X,p.Y]).toEqual(s.values[i]);});}
    stages[c.stage](bg,g,c.work);expect(routes(g)).toEqual(c.after);
  });
}
