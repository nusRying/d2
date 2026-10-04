// Exact bounded bend reduction: internal/routing/shortcut_routes.go.
import { Point } from '../geometry/point.js';
import { getContextError } from '../limits/work-context.js';
import { Inspect } from '../quality/inspection.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { NodeLabelTopLeft, IconSize, IsImage } from '../labeling/labeling-access.js';
import { runAtomicRouteStage, captureRouteMutations } from './route-stage.js';
import { MAX_ROUTE_STAGE_WORK_UNITS, errorIs, errRouteStageWorkLimit } from './route-guards.js';
import { sameRouteDirection, orthogonalSegmentEntersNode } from './edge-simplify.js';
import { changedRouteIsClear } from './port-interior-balance.js';
import { channelInventoryIsClosed, channelCoordinate } from './nudge-channels.js';
import { isLabelPositionSet } from './layoutgraph-route-support.js';
export const maxShortcutInput=256, maxShortcutRoute=32, shortcutEpsilon=1e-6;
const spacing=40;
const equal=(a,b)=>a.X===b.X&&a.Y===b.Y;
export function ShortcutEdgeRoutes(ctx,g) {
  try { shortcutRoutesWithLimit(ctx,g,MAX_ROUTE_STAGE_WORK_UNITS); }
  catch(e) { if(!errorIs(e,errRouteStageWorkLimit))throw e; }
}
export function shortcutInputTooLarge(g) {
  if(g==null)return false;
  if(g.Nodes.length>maxShortcutInput||g.Edges.length>maxShortcutInput)return true;
  let remaining=maxShortcutInput;for(const e of g.Edges)if(e!=null){if(e.Points.length>remaining)return true;remaining-=e.Points.length;}return false;
}
export function shortcutRoutesWithLimit(ctx,g,limit) {
  if(ctx!=null&&g!=null){const err=getContextError(ctx);if(err!=null)throw err;if(shortcutInputTooLarge(g)){const err=getContextError(ctx);if(err!=null)throw err;return;}}
  runAtomicRouteStage(ctx,'ShortcutEdgeRoutes',g,null,limit,guard=>shortcutRoutesGuarded(g,guard));
}
export function shortcutRoutesGuarded(g,guard) {
  let boxes=[],labelsReady=false,inventoryChecked=false;
  for(const e of g.Edges) {
    guard.step();
    if(e.IsInvisible||e.IsCurve||e.isLoop()||g.NodeToTree.has(e.From)||g.NodeToTree.has(e.To)||e.Label!=null||e.SourceArrowheadLabel!=null||e.TargetArrowheadLabel!=null||e.Points.length<5||e.Points.length>maxShortcutRoute||!shortcutOrthogonal(e.Points))continue;
    let unsupported=false;for(const other of g.Edges){guard.step();unsupported=unsupported||other.IsCurve||!shortcutOrthogonal(other.Points);}if(unsupported)return;
    if(!labelsReady){boxes=shortcutLabelBoxes(g,guard);labelsReady=true;}
    let best=e.Points,bestLength=shortcutLength(best),bestBends=shortcutBends(best);const beforeBends=bestBends;
    for(let start=0;start+3<e.Points.length;start++)for(let end=start+3;end<e.Points.length;end++)for(const horizontal of [true,false]) {
      guard.add(e.Points.length);const candidate=shortcutCandidate(e.Points,start,end,horizontal),length=shortcutLength(candidate),bends=shortcutBends(candidate);
      if(bends>=beforeBends||bends>bestBends||length>shortcutLength(e.Points)+shortcutEpsilon||(bends===bestBends&&length>=bestLength-shortcutEpsilon))continue;
      if(shortcutCandidateSafe(g,e,candidate,boxes,guard)){best=candidate;bestLength=length;bestBends=bends;}
    }
    if(bestBends===beforeBends)continue;
    if(!inventoryChecked){const snapshot=captureRouteMutations(g,null,guard);if(!channelInventoryIsClosed(g,snapshot,guard))return;inventoryChecked=true;}
    const before=Inspect(guard.ctx,g),original=e.Points;e.Points=best;const after=Inspect(guard.ctx,g);
    if(after.RouteObstructions>before.RouteObstructions||after.Crossings>before.Crossings||after.TextOcclusions>before.TextOcclusions||after.RouteLength>before.RouteLength+shortcutEpsilon)e.Points=original;
  }
}
export function shortcutOrthogonal(points) {
  for(let i=0;i<points.length;i++) {
    const p=points[i];if(p==null||!Number.isFinite(p.X)||!Number.isFinite(p.Y))return false;
    if(i>0&&(equal(p,points[i-1])||(p.X!==points[i-1].X&&p.Y!==points[i-1].Y)))return false;
    if(i>1&&!sameRouteDirection(points[i-2],points[i-1],points[i-1],p)&&(points[i-2].X===p.X||points[i-2].Y===p.Y))return false;
  }return points.length>=2;
}
export function shortcutLength(points) {let length=0;for(let i=1;i<points.length;i++)length+=Math.abs(points[i].X-points[i-1].X)+Math.abs(points[i].Y-points[i-1].Y);return length;}
export function shortcutBends(points) {let bends=0;for(let i=2;i<points.length;i++){const a=points[i-2],b=points[i-1],c=points[i];if((b.X-a.X)*(c.Y-b.Y)!==(b.Y-a.Y)*(c.X-b.X))bends++;}return bends;}
export function shortcutCandidate(points,start,end,horizontal) {
  const elbow=horizontal?new Point(points[end].X,points[start].Y):new Point(points[start].X,points[end].Y),raw=[...points.slice(0,start+1),elbow,...points.slice(end)],result=[];
  for(const p of raw){if(result.length>0&&equal(result.at(-1),p))continue;while(result.length>=2&&sameRouteDirection(result.at(-2),result.at(-1),result.at(-1),p))result.pop();result.push(p);}return result;
}
export function shortcutCandidateSafe(g,e,points,labels,guard) {
  if(!shortcutOrthogonal(points)||shortcutBends(points)>=shortcutBends(e.Points)||shortcutLength(points)>shortcutLength(e.Points)+shortcutEpsilon)return false;
  const candidate=Object.assign(Object.create(Object.getPrototypeOf(e)),e,{Points:points});
  if(!changedRouteIsClear(g,candidate,e.Points,true,guard))return false;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],length=Math.abs(b.X-a.X)+Math.abs(b.Y-a.Y);let minimum=spacing,unchanged=false;
    for(let j=1;j<e.Points.length;j++){guard.step();unchanged=unchanged||(equal(a,e.Points[j-1])&&equal(b,e.Points[j]));}
    if(i===1)minimum=Math.min(minimum,shortcutLength(e.Points.slice(0,2)));
    if(i===points.length-1)minimum=Math.min(minimum,shortcutLength(e.Points.slice(-2)));
    if(!unchanged&&length+shortcutEpsilon<minimum)return false;
    for(let j=i+2;j<points.length;j++){guard.step();if(shortcutSegmentsMeet(a,b,points[j-1],points[j]))return false;}
    if(unchanged)continue;
    for(const box of labels){guard.step();if(orthogonalSegmentEntersNode(box,a,b))return false;}
    if(!shortcutWallClearance(g,e.Points,a,b,guard)||!shortcutParallelClearance(g,e,a,b,guard))return false;
  }
  for(const other of g.Edges)if(other!==e&&!shortcutContactsPreserved(e.Points,points,other.Points,guard))return false;
  return true;
}
export function shortcutContactsPreserved(before,after,other,guard) {
  for(let i=1;i<after.length;i++)for(let j=1;j<other.length;j++) {
    guard.step();const a=after[i-1],b=after[i],c=other[j-1],d=other[j];if(!shortcutSegmentsMeet(a,b,c,d))continue;
    if((a.X===b.X)!==(c.X===d.X)) {
      const p=a.Y===b.Y?new Point(c.X,a.Y):new Point(a.X,c.Y);let covered=false;
      for(let k=1;k<before.length;k++){guard.step();covered=covered||shortcutPointOnSegment(p,before[k-1],before[k]);}
      const [oldH,oldV]=shortcutThroughRays(before,p,guard),[newH,newV]=shortcutThroughRays(after,p,guard),[otherH,otherV]=shortcutThroughRays(other,p,guard);
      const newCrossing=(newH&&otherV)||(newV&&otherH),oldCrossing=(oldH&&otherV)||(oldV&&otherH);
      if(!covered||(newCrossing&&!oldCrossing))return false;continue;
    }
    const horizontal=a.Y===b.Y,position=horizontal?a.Y:a.X,lo=Math.max(Math.min(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal)),Math.min(channelCoordinate(c,horizontal),channelCoordinate(d,horizontal))),hi=Math.min(Math.max(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal)),Math.max(channelCoordinate(c,horizontal),channelCoordinate(d,horizontal)));
    let cursor=lo;
    for(;;) {
      let next=cursor,containsPoint=false;
      for(let k=1;k<before.length;k++) {
        guard.step();const u=before[k-1],v=before[k];if((horizontal&&(u.Y!==position||v.Y!==position))||(!horizontal&&(u.X!==position||v.X!==position)))continue;
        const left=Math.min(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal)),right=Math.max(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal));
        if(left<=cursor+shortcutEpsilon&&right>=cursor-shortcutEpsilon){containsPoint=true;next=Math.max(next,right);}
      }
      if(containsPoint&&next>=hi-shortcutEpsilon)break;
      if(next<=cursor+shortcutEpsilon)return false;cursor=next;
    }
  }return true;
}
export function shortcutPointOnSegment(p,a,b) {
  return ((a.X===b.X&&p.X===a.X)||(a.Y===b.Y&&p.Y===a.Y))&&p.X>=Math.min(a.X,b.X)-shortcutEpsilon&&p.X<=Math.max(a.X,b.X)+shortcutEpsilon&&p.Y>=Math.min(a.Y,b.Y)-shortcutEpsilon&&p.Y<=Math.max(a.Y,b.Y)+shortcutEpsilon;
}
export function shortcutSegmentsMeet(a,b,c,d) {return Math.max(Math.min(a.X,b.X),Math.min(c.X,d.X))<=Math.min(Math.max(a.X,b.X),Math.max(c.X,d.X))&&Math.max(Math.min(a.Y,b.Y),Math.min(c.Y,d.Y))<=Math.min(Math.max(a.Y,b.Y),Math.max(c.Y,d.Y));}
export function shortcutThroughRays(points,p,guard) {
  let left=false,right=false,above=false,below=false;
  for(let i=1;i<points.length;i++){guard.step();const a=points[i-1],b=points[i];if(!shortcutPointOnSegment(p,a,b))continue;if(a.Y===b.Y){left=left||Math.min(a.X,b.X)<p.X;right=right||Math.max(a.X,b.X)>p.X;}else{above=above||Math.min(a.Y,b.Y)<p.Y;below=below||Math.max(a.Y,b.Y)>p.Y;}}
  return [left&&right,above&&below];
}
export function shortcutWallClearance(g,before,a,b,guard) {
  const horizontal=a.Y===b.Y,position=channelCoordinate(a,!horizontal),lo=Math.min(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal)),hi=Math.max(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal));
  for(const n of g.Nodes) {
    guard.step();const nlo=channelCoordinate(n.TopLeft,horizontal),nhi=nlo+(horizontal?n.Width:n.Height),wall=horizontal?n.TopLeft.Y:n.TopLeft.X,walls=[wall,wall+(horizontal?n.Height:n.Width)];
    if(Math.min(hi,nhi)-Math.max(lo,nlo)<=shortcutEpsilon)continue;
    for(const wall of walls) {
      const gap=Math.abs(position-wall);if(gap>=spacing-shortcutEpsilon)continue;let minimum=spacing;
      for(let j=1;j<before.length;j++){guard.step();const u=before[j-1],v=before[j],oldPosition=channelCoordinate(u,!horizontal);if(oldPosition!==channelCoordinate(v,!horizontal)||(oldPosition-wall)*(position-wall)<0)continue;const oldLo=Math.min(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal)),oldHi=Math.max(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal));if(Math.min(oldHi,nhi)-Math.max(oldLo,nlo)>shortcutEpsilon)minimum=Math.min(minimum,Math.abs(oldPosition-wall));}
      if(gap+shortcutEpsilon<minimum)return false;
    }
  }return true;
}
export function shortcutParallelClearance(g,e,a,b,guard) {
  const horizontal=a.Y===b.Y,position=channelCoordinate(a,!horizontal),lo=Math.min(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal)),hi=Math.max(channelCoordinate(a,horizontal),channelCoordinate(b,horizontal));
  for(const other of g.Edges) {
    if(other===e)continue;
    for(let j=1;j<other.Points.length;j++) {
      guard.step();const c=other.Points[j-1],d=other.Points[j],wall=channelCoordinate(c,!horizontal);if(wall!==channelCoordinate(d,!horizontal))continue;
      const otherLo=Math.min(channelCoordinate(c,horizontal),channelCoordinate(d,horizontal)),otherHi=Math.max(channelCoordinate(c,horizontal),channelCoordinate(d,horizontal));if(Math.min(hi,otherHi)-Math.max(lo,otherLo)<=shortcutEpsilon)continue;
      const gap=Math.abs(position-wall);if(gap<=shortcutEpsilon||gap>=spacing-shortcutEpsilon)continue;let minimum=spacing;
      for(let k=1;k<e.Points.length;k++) {
        guard.step();const u=e.Points[k-1],v=e.Points[k],oldPosition=channelCoordinate(u,!horizontal);if(oldPosition!==channelCoordinate(v,!horizontal))continue;
        const oldLo=Math.min(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal)),oldHi=Math.max(channelCoordinate(u,horizontal),channelCoordinate(v,horizontal)),oldGap=Math.abs(oldPosition-wall);
        if(oldGap>shortcutEpsilon&&Math.min(oldHi,otherHi)-Math.max(oldLo,otherLo)>shortcutEpsilon)minimum=Math.min(minimum,oldGap);
      }if(gap+shortcutEpsilon<minimum)return false;
    }
  }return true;
}
export function shortcutLabelBoxes(g,guard) {
  const boxes=[];
  for(const n of g.Nodes){guard.add(1+4*g.Nodes.length);if(n.IsInvisible)continue;
    if(n.Label!=null&&isLabelPositionSet(n.Label.Position))boxes.push({TopLeft:NodeLabelTopLeft(n,n.Label.Position,n.Label.Width,n.Label.Height),Width:n.Label.Width,Height:n.Label.Height});
    if(n.Icon!=null&&!IsImage(n)){const size=IconSize(n,n.Icon.Position);boxes.push({TopLeft:NodeLabelTopLeft(n,n.Icon.Position,size,size),Width:size,Height:size});}
  }
  for(const e of g.Edges){guard.add(1+3*e.Points.length);if(e.IsInvisible||e.Points.length<2)continue;
    if(e.Label!=null&&isLabelPositionSet(e.Label.Position))boxes.push({TopLeft:e.LabelTopLeft(e.Label.Position,e.Label.Width,e.Label.Height),Width:e.Label.Width,Height:e.Label.Height});
    if(e.SourceArrowheadLabel!=null)boxes.push(PositionArrowheadLabel(e,false,e.Points).Box);
    if(e.TargetArrowheadLabel!=null)boxes.push(PositionArrowheadLabel(e,true,e.Points).Box);
  }return boxes;
}
