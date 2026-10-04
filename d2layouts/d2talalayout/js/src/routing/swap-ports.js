// Pinned reference: internal/routing/swap_ports.go.
import { Point, intersectionPoint } from '../geometry/point.js';
import { Orientation as O, isVertical } from '../geometry/orientation.js';
import { segmentIntersectsBox } from './geometry.js';
import { tunnelRangesBetweenGuarded } from './tunnel.js';
import { PATH_NODE_PROXIMITY_FLOOR as floor } from './tuning.js';
import { runAtomicRouteStage, stableSortRouteValues } from './route-stage.js';
import { MAX_ROUTE_STAGE_WORK_UNITS } from './route-guards.js';
const key=p=>`${p.X===0?0:p.X},${p.Y===0?0:p.Y}`;
export function SwapAllEdgePorts(ctx,g) { return swapAllEdgePortsWithWorkLimit(ctx,g,MAX_ROUTE_STAGE_WORK_UNITS); }
export function swapAllEdgePortsWithWorkLimit(ctx,g,limit) {
  return runAtomicRouteStage(ctx,'SwapEdgePorts',g,null,limit,guard=>{
    for (const n of g.Nodes) { guard.step(); swapEdgePortsGuarded(n,guard); }
  });
}
export function pointsAt(e,n) {
  return e.From===n ? e.Points.slice(0,3) : [e.Points.at(-1),e.Points.at(-2),e.Points.at(-3)];
}
export function swapCoordinate(p,q,o) { const k=isVertical(o)?'X':'Y'; [p[k],q[k]]=[q[k],p[k]]; }
export function swapPoints(a,b) { [a.X,b.X]=[b.X,a.X]; [a.Y,b.Y]=[b.Y,a.Y]; }
export function swapEdgePortsGuarded(n,guard) {
  const orientations=new Map(), ports=new Map();
  for (const e of n.Edges) {
    guard.step();
    if (e.isLoop()||e.Points.length<3||e.HasTableColumn()||e.HasLargeArrowheadLabel()) continue;
    const [a,b]=pointsAt(e,n), o=a.X<b.X?O.Right:a.X>b.X?O.Left:a.Y<b.Y?O.Bottom:O.Top;
    if (!orientations.has(o)) orientations.set(o,[]);
    orientations.get(o).push(e);
    if (!ports.has(key(a))) ports.set(key(a),[]);
    ports.get(key(a)).push(e);
  }
  const same=swapEdgesOnSameSide(n,orientations,ports,guard);
  const adjacent=swapEdgesOnAdjacentSides(n,orientations,ports,guard);
  return adjacent||same;
}
export function canSwapPorts(a,b,n,ports) {
  const [p]=pointsAt(a,n),[q]=pointsAt(b,n);
  if (ports.get(key(p))?.length===1 && ports.get(key(q))?.length===1) return true;
  return (a.From===n?a.SourceArrowhead:a.TargetArrowhead)===(b.From===n?b.SourceArrowhead:b.TargetArrowhead);
}
export function edgesIntersect(a,b,n,o) {
  const [p1,p2,p3]=pointsAt(a,n),[q1,q2,q3]=pointsAt(b,n);
  switch(o) {
    case O.Left: return q2.X<p2.X&&p3.Y>q1.Y || p2.X<q2.X&&q3.Y<p1.Y;
    case O.Right:return p2.X>q2.X&&q3.Y<p1.Y || q2.X>p2.X&&p3.Y>q1.Y;
    case O.Bottom:return p2.Y>q2.Y&&q3.X<p1.X || q2.Y>p2.Y&&p3.X>q1.X;
    case O.Top:return p2.Y<q2.Y&&q3.X<p1.X || q2.Y<p2.Y&&p3.X>q1.X;
    default:return false;
  }
}
export function doesNotPassThroughNodesGuarded(g,ns,p1,p2,q1,q2,guard) {
  outer: for (const node of g.Nodes) {
    guard.step();
    for (const n of ns) { guard.step(); if (node===n||n.IsDescendantOf(node)) continue outer; }
    const pad=2*floor;
    const box={TopLeft:new Point(node.TopLeft.X-pad,node.TopLeft.Y-pad),Width:node.Width+2*pad,Height:node.Height+2*pad};
    if (segmentIntersectsBox(p1,p2,box)||segmentIntersectsBox(q1,q2,box)) return false;
  }
  return true;
}
export function swapEdgesOnSameSide(n,orientations,ports,guard) {
  let swapped=false;
  for (const [o,edges] of orientations) {
    guard.step();
    const k=isVertical(o)?'X':'Y';
    stableSortRouteValues(edges,(a,b)=>{const [p,,r]=pointsAt(a,n),[q,,s]=pointsAt(b,n);return p[k]===q[k]?r[k]<s[k]:p[k]<q[k];},guard);
    for (let i=0;i<edges.length-1;i++) {
      guard.step();
      if (!edgesIntersect(edges[i],edges[i+1],n,o)||!canSwapPorts(edges[i],edges[i+1],n,ports)) continue;
      const [p1,p2]=pointsAt(edges[i],n),[q1,q2]=pointsAt(edges[i+1],n);
      swapCoordinate(p1,q1,o); swapCoordinate(p2,q2,o);
      if (doesNotPassThroughNodesGuarded(n.Graph,[n],p1,p2,q1,q2,guard)) {
        [edges[i],edges[i+1]]=[edges[i+1],edges[i]]; swapped=true;
      } else { swapCoordinate(p1,q1,o); swapCoordinate(p2,q2,o); }
    }
  }
  return swapped;
}
export function occupiedPortsGuarded(n,guard) {
  const ports=new Set();
  for (const e of n.Edges) {guard.step();ports.add(key(e.From===n?e.sourcePort():e.targetPort()));}
  return ports;
}
export function makeStraightLineGuarded(g,e,occupied,guard) {
  const from=e.sourcePort(),to=e.targetPort();
  const [ranges,horizontal]=tunnelRangesBetweenGuarded(g,e.From,e.To,false,guard);
  for (const r of ranges??[]) {
    guard.step();
    for (let v=r.start+floor;v<=r.end-floor;v+=floor) {
      guard.step();
      const a=horizontal?new Point(from.X,v):new Point(v,from.Y);
      const b=horizontal?new Point(to.X,v):new Point(v,to.Y);
      if (occupied.has(key(a))||occupied.has(key(b))) continue;
      e.Points=[a,b];return true;
    }
  }
  return false;
}
export function isUShaped(ps) {
  if (ps.length!==4) return false;
  const sign=x=>x<0?-1:x>0?1:0;
  if (ps[0].X===ps[1].X) return sign(ps[0].Y-ps[1].Y)===sign(ps[3].Y-ps[2].Y)&&ps[1].Y===ps[2].Y;
  return sign(ps[0].X-ps[1].X)===sign(ps[3].X-ps[2].X)&&ps[1].X===ps[2].X;
}
export const isSShaped=ps=>ps.length===4&&!isUShaped(ps);
export function isLShaped(ps) {
  if (ps.length!==3) return false;
  const vertical=ps[0].X===ps[1].X,horizontal=ps[1].Y===ps[2].Y;
  return vertical&&horizontal || !vertical&&!horizontal;
}
export const isEdgeUShaped=e=>isUShaped(e.Points);
export const isEdgeSShaped=e=>isSShaped(e.Points);
export const isEdgeLShaped=e=>isLShaped(e.Points);
export function sToLShapedBendPoint(ps) {return ps[0].X===ps[1].X?new Point(ps[1].X,ps[3].Y):new Point(ps[3].X,ps[1].Y);}
export function copyEdgePointsGuarded(e,guard) { return e.Points.map(p=>{guard.step();return p.Copy();}); }
export function insertEdgePointGuarded(e,p,index,guard) {
  if (index<0||index>e.Points.length) throw new Error(`TALA ${guard.location} route insertion index ${index} is out of bounds`);
  const ps=[];
  for (let i=0;i<e.Points.length;i++) { guard.step();if(i===index)ps.push(p);ps.push(e.Points[i]); }
  if (index===e.Points.length) ps.push(p);
  e.Points=ps;
}
export function removeEdgePointsGuarded(e,guard,...indices) {
  if (e.Points.length<indices.length) throw new Error(`TALA ${guard.location} route removal count exceeds route length`);
  const ps=[];
  outer:for (let i=0;i<e.Points.length;i++) {
    guard.step();for(const index of indices){guard.step();if(i===index)continue outer;}ps.push(e.Points[i]);
  }
  e.Points=ps;
}
export function refineEdgeGuarded(g,e,guard) {
  guard.step();
  if (e.isLoop()||e.Points.length<=2||e.IsBetweenTableColumns()||(e.From.Graph.NodeToTree.has(e.From)||e.To.Graph.NodeToTree.has(e.To))) return false;
  const ports=occupiedPortsGuarded(e.From,guard),to=occupiedPortsGuarded(e.To,guard);
  for (const p of to) {guard.step();ports.add(p);}
  if (isEdgeSShaped(e)||isEdgeLShaped(e)) return makeStraightLineGuarded(g,e,ports,guard);
  if (isEdgeUShaped(e)) return false;
  if (isSShaped(e.Points.slice(0,4))) {
    const p=sToLShapedBendPoint(e.Points.slice(0,4));
    if (doesNotPassThroughNodesGuarded(g,[e.From,e.To],e.Points[0],p,p,e.Points[3],guard)) {
      removeEdgePointsGuarded(e,guard,1,2,3);insertEdgePointGuarded(e,p,1,guard);return true;
    }
  }
  return false;
}
export function swapEdgesOnAdjacentSides(n,orientations,ports,guard) {
  let swapped=false;
  const vertical=[...(orientations.get(O.Top)??[]),...(orientations.get(O.Bottom)??[])];
  const horizontal=[...(orientations.get(O.Left)??[]),...(orientations.get(O.Right)??[])];
  for (const a of vertical) {
    guard.step();
    for (const b of horizontal) {
      guard.step();if(a.Points.length<=2)break;if(b.Points.length<=2)continue;
      if(!canSwapPorts(a,b,n,ports))continue;
      const [a1,a2,a3]=pointsAt(a,n),[b1,b2,b3]=pointsAt(b,n);
      const intersection=intersectionPoint(a2,a3,b2,b3);if(intersection===null)continue;
      const savedA=copyEdgePointsGuarded(a,guard),savedB=copyEdgePointsGuarded(b,guard);
      swapPoints(a1,b1);swapPoints(a2,b2);
      for (const [edge,second] of [[a,a2],[b,b2]]) {
        const p=intersection.Copy();
        insertEdgePointGuarded(edge,p,edge.From===n?2:edge.Points.length-2,guard);
        if(p.X===second.X){p.X+=floor/2;second.X+=floor/2;}else{p.Y-=floor/2;second.Y-=floor/2;}
      }
      const improvedA=refineEdgeGuarded(n.Graph,a,guard),improvedB=refineEdgeGuarded(n.Graph,b,guard);
      if(!improvedA&&!improvedB){a.Points=savedA;b.Points=savedB;}else swapped=true;
    }
  }
  return swapped;
}
