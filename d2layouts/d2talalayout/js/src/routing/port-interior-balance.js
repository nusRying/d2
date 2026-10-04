// Pinned port_interior_balance.go: conservative fixed-port interior balancing.
import { Inspect } from '../quality/inspection.js';
import { captureRouteMutations } from './route-stage.js';
import { hasFixedBalancingPorts, balanceRegularEdgesGuarded } from './postprocess-balance.js';
import { sameRouteDirection, lineIntersectsUnrelatedNode } from './edge-simplify.js';
export { hasFixedBalancingPorts };
export function balancePortInteriorsGuarded(g, guard) {
 const selected=[], locked=[];
 for (const e of g.Edges) {
  guard.step();
  if (hasFixedBalancingPorts(e) && !e.IsCurve && !e.isLoop() && !g.NodeToTree.has(e.From) && !g.NodeToTree.has(e.To) && e.Points.length>=6) selected.push(e);
  else locked.push(e);
 }
 if (!selected.length) return;
 const beforeMetrics=Inspect(guard.ctx,g);
 const snapshot=captureRouteMutations(g,null,guard);
 const before=copyRoutePoints(selected,guard);
 balanceRegularEdgesGuarded(g,locked,selected,guard);
 for (const e of selected) {
  if (!changedRouteIsClear(g,e,before.get(e),true,guard)) { snapshot.restore(); return; }
 }
 const afterMetrics=Inspect(guard.ctx,g);
 if (afterMetrics.RouteObstructions>beforeMetrics.RouteObstructions || afterMetrics.Crossings>beforeMetrics.Crossings || afterMetrics.TextOcclusions>beforeMetrics.TextOcclusions || afterMetrics.RouteLength>beforeMetrics.RouteLength*1.1) snapshot.restore();
}
export function copyRoutePoints(edges,guard) {
 const result=new Map();
 for (const e of edges) { guard.add(e.Points.length+1); result.set(e,e.Points.map(p=>p.Copy())); }
 return result;
}
const equal=(a,b)=>a.X===b.X && a.Y===b.Y;
export function changedRouteIsClear(g,e,before,fixedPorts,guard) {
 const points=e.Points;
 if (points.length<2 || before.length<2) return false;
 if (fixedPorts && (!equal(points[0],before[0]) || !equal(points.at(-1),before.at(-1)) || !sameRouteDirection(before[0],before[1],points[0],points[1]) || !sameRouteDirection(before.at(-2),before.at(-1),points.at(-2),points.at(-1)))) return false;
 for (let i=1;i<points.length;i++) {
  const a=points[i-1],b=points[i]; let unchanged=false;
  for (let j=1;j<before.length;j++) { guard.step(); if (equal(a,before[j-1]) && equal(b,before[j])) { unchanged=true; break; } }
  if (unchanged) continue;
  if (a.X!==b.X && a.Y!==b.Y) return false;
  if (lineIntersectsUnrelatedNode(g,e,a,b,guard)) return false;
 }
 return true;
}
