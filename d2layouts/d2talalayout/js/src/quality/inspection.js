import { ValidatePositionedGraphSelection } from '../labeling/positioned-validation.js';
import { newWorkGuard } from '../limits/work-guard.js';
import { maxEvaluationWorkUnits } from './evaluation-guard.js';
import { countNonSharedCrossings } from './crossings.js';
import { measureGeometry } from './inspection-geometry.js';
import { measureLabels } from './inspection-labels.js';
export class Metrics {
  constructor() {this.NodeOverlaps=0;this.RouteObstructions=0;this.TextOcclusions=0;this.Crossings=0;this.Detour=0;this.RouteLength=0;}
}
export function Inspect(ctx,graph) {return inspectWithLimit(ctx,graph,maxEvaluationWorkUnits).metrics;}
export function inspectWithLimit(ctx,graph,workLimit) {
  if(graph==null)throw new Error('cannot evaluate a nil graph');
  ValidatePositionedGraphSelection(ctx,'Inspect',graph,null);
  const guard=newWorkGuard(ctx,'Inspect',workLimit), score=new Metrics();
  let scale=0,count=0;
  for(const node of graph.Nodes) {guard.step();if(!node.IsContainer()&&!node.IsInvisible) {scale+=(node.Width+node.Height)/2;count++;}}
  scale=Math.max(1,scale/Math.max(1,count));
  const visible=[];
  for(const edge of graph.Edges) {
    guard.step();if(edge.IsInvisible)continue;visible.push(edge);
    let length=0;
    for(let i=1;i<edge.Points.length;i++) {guard.step();const a=edge.Points[i-1],b=edge.Points[i];length+=Math.hypot(b.X-a.X,b.Y-a.Y);}
    score.RouteLength+=length/scale;
    if(edge.Points.length<2||edge.isLoop())continue;
    const first=edge.Points[0],last=edge.Points.at(-1),direct=Math.abs(last.X-first.X)+Math.abs(last.Y-first.Y);
    score.Detour+=Math.max(0,length-direct)/Math.max(scale,direct);
  }
  score.Crossings=countNonSharedCrossings(visible,guard);
  measureGeometry(graph,score,guard);measureLabels(graph,score,guard);
  if(!Number.isFinite(score.RouteLength)||!Number.isFinite(score.Detour))throw new Error('TALA Inspect produced non-finite geometry');
  guard.finish();return {metrics:score,workUsed:guard.Used()};
}
