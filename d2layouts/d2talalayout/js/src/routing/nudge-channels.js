// Exact bounded channel postpass: internal/routing/nudge_channels.go.
import { Point } from '../geometry/point.js';
import { Segment } from '../geometry/segment.js';
import { getContextError } from '../limits/work-context.js';
import { Inspect } from '../quality/inspection.js';
import { runAtomicRouteStage, captureRouteMutations, stableSortRouteValues } from './route-stage.js';
import { MAX_ROUTE_STAGE_WORK_UNITS, errorIs, errRouteStageWorkLimit } from './route-guards.js';
import { edgeSegmentsGuarded, nodeSegmentsGuarded, routeSegmentBounds, removeDuplicatePointsGuarded } from './balance-route-guard.js';
import { hasFixedBalancingPorts, isSpecialEdgeForBalancing, balanceCollinearOverlap } from './postprocess-balance.js';
import { edgeSegmentOwner, segmentOverlaps } from './layoutgraph-route-support.js';
import { copyRoutePoints, changedRouteIsClear } from './port-interior-balance.js';
import { isNonSharedCrossing } from './cost.js';
export const maxChannelSegments = 256;
export const channelEpsilon = 1e-6;
const spacing = 40;
const equal = (a,b) => a.X === b.X && a.Y === b.Y;
const copyEdge = e => Object.assign(Object.create(Object.getPrototypeOf(e)),e);
export class channelGroup {
  constructor(position=0) { this.segments=[]; this.position=position; this.lower=0; this.upper=0; this.fixed=false; this.nodeClearance=null; }
}
export class channelArc { constructor(from,to,separate) { Object.assign(this,{from,to,separate}); } }
export class channelProblem { constructor() { this.groups=[]; this.arcs=[]; } }
export function NudgeEdgeChannels(ctx,g) {
  try { nudgeChannelsWithLimit(ctx,g,MAX_ROUTE_STAGE_WORK_UNITS); }
  catch(e) { if (!errorIs(e,errRouteStageWorkLimit)) throw e; }
}
export function channelInputTooLarge(g) {
  if (g == null) return false;
  if (g.Nodes.length > maxChannelSegments || g.Edges.length > maxChannelSegments) return true;
  let remaining=maxChannelSegments;
  for (const e of g.Edges) { if(e == null) continue; if(e.Points.length>remaining) return true; remaining-=e.Points.length; }
  return false;
}
export function nudgeChannelsWithLimit(ctx,g,limit) {
  if(ctx != null && g != null) {
    const err=getContextError(ctx); if(err != null) throw err;
    if(channelInputTooLarge(g)) { const err=getContextError(ctx); if(err != null) throw err; return; }
  }
  runAtomicRouteStage(ctx,'NudgeChannels',g,null,limit,guard=>nudgeChannelsGuarded(g,guard));
}
export function nudgeChannelsGuarded(g,guard) {
  for(const horizontal of [true,false]) {
    const problem=buildChannelProblem(g,horizontal,guard);
    if(problem.groups.length===0) continue;
    const snapshot=captureRouteMutations(g,null,guard);
    if(!channelInventoryIsClosed(g,snapshot,guard)) return;
    const beforePoints=copyRoutePoints(g.Edges,guard), before=Inspect(guard.ctx,g);
    if(!applyChannelProblem(g,problem,horizontal,guard)) continue;
    const after=Inspect(guard.ctx,g);
    if(after.RouteObstructions>before.RouteObstructions || after.Crossings>before.Crossings || after.TextOcclusions>before.TextOcclusions || after.RouteLength>before.RouteLength+channelEpsilon) { snapshot.restore(); continue; }
    for(const edge of g.Edges) {
      if(edge.Points.some((p,i)=>!equal(p,beforePoints.get(edge)[i]))) edge.Points=removeDuplicatePointsGuarded(edge.Points,guard);
    }
  }
}
export function channelInventoryIsClosed(g,snapshot,guard) {
  const nodes=new Set(),edges=new Set();
  for(const n of g.Nodes) { guard.step(); nodes.add(n); }
  for(const e of g.Edges) { guard.step(); edges.add(e); }
  for(const n of snapshot.nodes.keys()) { guard.step(); if(!nodes.has(n)) return false; }
  for(const e of snapshot.edges.keys()) { guard.step(); if(!edges.has(e)) return false; }
  return true;
}
export function channelCoordinate(p,horizontal) { return horizontal?p.X:p.Y; }
export function buildChannelProblem(g,horizontal,guard) {
  const result=new channelProblem(), segments=edgeSegmentsGuarded(g.Edges,!horizontal,guard), fixedPoints=new Set(g.Nodes.map(n=>n.TopLeft)), locked=new Map();
  for(const e of g.Edges) {
    guard.step(); if(e.Points.length<2) continue;
    fixedPoints.add(e.Points[0]); fixedPoints.add(e.Points.at(-1));
    locked.set(e,e.IsCurve || e.isLoop() || g.NodeToTree.has(e.From) || g.NodeToTree.has(e.To) || (isSpecialEdgeForBalancing(g,e) && !hasFixedBalancingPorts(e)));
    for(let i=1;i<e.Points.length;i++) { guard.step(); const a=e.Points[i-1],b=e.Points[i]; if((a.X!==b.X && a.Y!==b.Y)||equal(a,b)) locked.set(e,true); }
  }
  const parent=segments.map((_,i)=>i);
  const root=i=>{while(parent[i]!==i) {parent[i]=parent[parent[i]]; i=parent[i];}return i;};
  for(let i=0;i<segments.length;i++) for(let j=0;j<i;j++) {
    guard.step(); const s=segments[i],t=segments[j];
    if(channelCoordinate(s.Start,horizontal)===channelCoordinate(t.Start,horizontal) && segmentOverlaps(s,t,horizontal,spacing)) parent[root(i)]=root(j);
  }
  const byRoot=new Map(),groups=[];
  for(let i=0;i<segments.length;i++) {
    guard.step(); const s=segments[i],id=root(i); let group=byRoot.get(id);
    if(group==null) {group=new channelGroup(channelCoordinate(s.Start,horizontal));byRoot.set(id,group);groups.push(group);}
    group.segments.push(s);group.fixed=group.fixed || locked.get(edgeSegmentOwner(s)) || fixedPoints.has(s.Start)||fixedPoints.has(s.End);
    for(const n of g.Nodes) {guard.step();if(n.Width!==1||n.Height!==1)continue;for(const p of [s.Start,s.End]) if((p.X===n.TopLeft.X||p.X===n.TopLeft.X+1)&&(p.Y===n.TopLeft.Y||p.Y===n.TopLeft.Y+1))group.fixed=true;}
  }
  const fixed=nodeSegmentsGuarded(g.Nodes,!horizontal,guard), nodeWalls=fixed.slice();
  for(const group of groups) {
    if(group.fixed)continue;const clearance={start:-Infinity,end:Infinity};
    for(const s of group.segments) {const [lower,upper]=routeSegmentBounds(s,nodeWalls,spacing,guard);
      if(lower!==-Infinity)clearance.start=Math.max(clearance.start,lower+Math.min(group.position-lower,spacing));
      if(upper!==Infinity)clearance.end=Math.min(clearance.end,upper-Math.min(upper-group.position,spacing));
    } group.nodeClearance=clearance;
  }
  const appendFixed=group=>{for(const s of group.segments)fixed.push(s);};
  for(const group of groups)if(group.fixed)appendFixed(group);
  for(let pass=0;pass<2;pass++)for(const group of groups) {
    if(group.fixed)continue;group.lower=-Infinity;group.upper=Infinity;
    for(const s of group.segments) {const [lo,hi]=routeSegmentBounds(s,fixed,spacing,guard);group.lower=Math.max(group.lower,lo);group.upper=Math.min(group.upper,hi);}
    if(!Number.isFinite(group.lower)||!Number.isFinite(group.upper)||group.lower>group.position||group.upper<group.position||group.lower>=group.upper){group.fixed=true;appendFixed(group);}
  }
  result.groups=groups.filter(group=>!group.fixed);
  stableSortRouteValues(result.groups,(a,b)=>a.position<b.position,guard);
  for(let i=0;i<result.groups.length;i++)for(let j=i+1;j<result.groups.length;j++) {
    const a=result.groups[i],b=result.groups[j],owner=edgeSegmentOwner(a.segments[0]);let linked=false,sameOwner=true;
    for(const s of a.segments)sameOwner=sameOwner&&edgeSegmentOwner(s)===owner;
    for(const s of b.segments)sameOwner=sameOwner&&edgeSegmentOwner(s)===owner;
    for(const s of a.segments)for(const t of b.segments){guard.step();linked=linked||segmentOverlaps(s,t,horizontal,sameOwner?0:spacing);}
    if(linked)result.arcs.push(new channelArc(i,j,!sameOwner));
  }
  return result;
}
export function solveChannelGap(p,gap,guard) {
  guard.add(p.groups.length*2);
  const lo=p.groups.map(g=>Math.max(g.lower+gap,g.nodeClearance?.start??-Infinity)),hi=p.groups.map(g=>Math.min(g.upper-gap,g.nodeClearance?.end??Infinity));
  for(const a of p.arcs){guard.step();lo[a.to]=Math.max(lo[a.to],lo[a.from]+(a.separate?gap:0));}
  for(let i=p.arcs.length-1;i>=0;i--){guard.step();const a=p.arcs[i];hi[a.from]=Math.min(hi[a.from],hi[a.to]-(a.separate?gap:0));}
  if(lo.some((x,i)=>x>hi[i]))return [null,null,false];
  return [lo,hi,true];
}
export function channelGap(p,positions) {
  let gap=Infinity;
  p.groups.forEach((g,i)=>{gap=Math.min(gap,positions[i]-g.lower,g.upper-positions[i]);});
  for(const a of p.arcs)if(a.separate)gap=Math.min(gap,positions[a.to]-positions[a.from]);
  return gap;
}
export function applyChannelProblem(g,p,horizontal,guard) {
  const parent=p.groups.map((_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const arc of p.arcs)parent[root(arc.to)]=root(arc.from);
  const components=new Map();for(let i=0;i<p.groups.length;i++){const id=root(i);if(!components.has(id))components.set(id,[]);components.get(id).push(i);}
  let changed=false;
  for(const component of components.values()) {
    const local=new channelProblem(),indices=new Map();for(const i of component){indices.set(i,local.groups.length);local.groups.push(p.groups[i]);}
    for(const a of p.arcs)if(indices.has(a.from))local.arcs.push(new channelArc(indices.get(a.from),indices.get(a.to),a.separate));
    const positions=local.groups.map(g=>g.position),oldGap=Math.max(0,channelGap(local,positions));let left=oldGap,right=Infinity;
    for(const group of local.groups)right=Math.min(right,(group.upper-group.lower)/2);
    for(let iteration=0;iteration<32&&right-left>channelEpsilon;iteration++){const mid=(left+right)/2;const [,,feasible]=solveChannelGap(local,mid,guard);if(feasible)left=mid;else right=mid;}
    let bestLength=channelWireLength(g,null,guard),bestGap=oldGap,best=null;
    for(const gap of [oldGap,left]) {
      const [earliest,latest,feasible]=solveChannelGap(local,gap,guard);if(!feasible)continue;
      for(const fraction of [0,1,0.5]) {
        const candidate=positions.map((_,i)=>earliest[i]*(1-fraction)+latest[i]*fraction),[proposal,compatible]=channelPointProposal(local,candidate,horizontal,guard);
        if(!compatible)continue;const length=channelWireLength(g,proposal,guard),actualGap=channelGap(local,candidate);
        if(length>bestLength+channelEpsilon||(Math.abs(length-bestLength)<=channelEpsilon&&actualGap<bestGap+1))continue;
        if(!channelProposalSafe(g,proposal,guard))continue;
        best=proposal;bestLength=length;bestGap=actualGap;
      }
    }
    if(best!=null){for(const [original,candidate] of best){guard.step();original.X=candidate.X;original.Y=candidate.Y;}changed=true;}
  }
  return changed;
}
export function channelPointProposal(p,positions,horizontal,guard) {
  const proposal=new Map();
  for(let i=0;i<p.groups.length;i++)for(const s of p.groups[i].segments)for(const point of [s.Start,s.End]) {
    guard.step();const candidate=new Point(point.X,point.Y);if(horizontal)candidate.X=positions[i];else candidate.Y=positions[i];
    const old=proposal.get(point);if(old!=null&&!equal(old,candidate))return [null,false];proposal.set(point,candidate);
  }
  return [proposal,true];
}
export function channelWireLength(g,proposal,guard) {
  let length=0;for(const e of g.Edges)for(let i=1;i<e.Points.length;i++){guard.step();const a=proposal?.get(e.Points[i-1])??e.Points[i-1],b=proposal?.get(e.Points[i])??e.Points[i];length+=Math.hypot(b.X-a.X,b.Y-a.Y);}return length;
}
export function channelProposalSafe(g,proposal,guard) {
  const candidates=[],changed=[];
  for(let index=0;index<g.Edges.length;index++) {
    const e=g.Edges[index],candidate=copyEdge(e);candidate.Points=e.Points.slice();changed[index]=false;
    e.Points.forEach((point,i)=>{guard.step();const p=proposal.get(point);if(p!=null){candidate.Points[i]=p;changed[index]=changed[index]||!equal(p,point);}});
    candidates[index]=candidate;if(!changed[index])continue;if(e.IsCurve)return false;
    if(!changedRouteIsClear(g,candidate,e.Points,true,guard))return false;
    let beforeLength=0,afterLength=0;const nonzero=[];
    for(let i=0;i<candidate.Points.length;i++) {
      guard.step();const point=candidate.Points[i];if(!Number.isFinite(point.X)||!Number.isFinite(point.Y))return false;
      if(i>0){const old=e.Points[i-1],previous=candidate.Points[i-1],before=Math.hypot(e.Points[i].X-old.X,e.Points[i].Y-old.Y),after=Math.hypot(point.X-previous.X,point.Y-previous.Y);beforeLength+=before;afterLength+=after;if(after>channelEpsilon&&after+channelEpsilon<Math.min(before,spacing))return false;}
      if(nonzero.length===0||!equal(nonzero.at(-1),point))nonzero.push(point);
    }
    if(afterLength>beforeLength+channelEpsilon)return false;
    for(let i=2;i<nonzero.length;i++){const [a,b,c]=nonzero.slice(i-2,i+1);if((b.X-a.X)*(c.X-b.X)+(b.Y-a.Y)*(c.Y-b.Y)<0)return false;}
    for(let i=0;i+1<nonzero.length;i++)for(let j=i+2;j+1<nonzero.length;j++){guard.step();if(new Segment(nonzero[i],nonzero[i+1]).intersects(new Segment(nonzero[j],nonzero[j+1])))return false;}
  }
  for(let i=0;i<g.Edges.length;i++)for(let j=i+1;j<g.Edges.length;j++) {
    if(!changed[i]&&!changed[j])continue;const e=g.Edges[i],other=g.Edges[j];if(e.IsCurve||other.IsCurve)return false;let before=0,after=0;
    for(let a=0;a+1<e.Points.length;a++)for(let b=0;b+1<other.Points.length;b++) {
      guard.step();if(isNonSharedCrossing(e,other,a,b))before++;if(isNonSharedCrossing(candidates[i],candidates[j],a,b))after++;
      const old=balanceCollinearOverlap(e.Points[a],e.Points[a+1],other.Points[b],other.Points[b+1]),next=balanceCollinearOverlap(candidates[i].Points[a],candidates[i].Points[a+1],candidates[j].Points[b],candidates[j].Points[b+1]);if(old===0&&next>0)return false;
      const oldContact=new Segment(e.Points[a],e.Points[a+1]).intersects(new Segment(other.Points[b],other.Points[b+1])),newContact=new Segment(candidates[i].Points[a],candidates[i].Points[a+1]).intersects(new Segment(candidates[j].Points[b],candidates[j].Points[b+1]));if(!oldContact&&newContact)return false;
    }if(after>before)return false;
  }return true;
}
