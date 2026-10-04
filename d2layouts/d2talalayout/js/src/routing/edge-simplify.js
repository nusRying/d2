// Pinned reference: internal/routing/edge_simplify.go.
import { Point } from '../geometry/point.js';
import { intersects } from './geometry.js';
import { runAtomicRouteStage } from './route-stage.js';
import { MAX_ROUTE_STAGE_WORK_UNITS } from './route-guards.js';

export function SimplifyEdgeRoutes(ctx, g) {
  return simplifyEdgeRoutesWithLimit(ctx, g, MAX_ROUTE_STAGE_WORK_UNITS);
}
export function simplifyEdgeRoutesWithLimit(ctx, g, workLimit) {
  return runAtomicRouteStage(ctx, 'SimplifyEdgeRoutes', g, null, workLimit, guard => {
    for (const edge of g.Edges) {
      guard.step();
      for (let changed = true; changed;) {
        const points = simplifyPoints(g, edge, guard);
        changed = points.length < edge.Points.length;
        if (changed) edge.Points = points;
      }
    }
  });
}
export const isHorizontalSegment = (a, b) => a.Y === b.Y;
export const isVerticalSegment = (a, b) => a.X === b.X;
export function sameRouteDirection(a, b, c, d) {
  return (b.X-a.X)*(d.X-c.X)+(b.Y-a.Y)*(d.Y-c.Y) > 0 &&
    (b.X-a.X)*(d.Y-c.Y) === (b.Y-a.Y)*(d.X-c.X);
}
export function findIntersectionPoint(a, b, c, d) {
  if (isHorizontalSegment(a,b) && isVerticalSegment(c,d)) return new Point(d.X,a.Y);
  if (isVerticalSegment(a,b) && isHorizontalSegment(c,d)) return new Point(a.X,d.Y);
  return null;
}
export function orthogonalSegmentEntersNode(n,a,b) {
  const l=n.TopLeft.X+1e-6, r=n.TopLeft.X+n.Width-1e-6;
  const t=n.TopLeft.Y+1e-6, bottom=n.TopLeft.Y+n.Height-1e-6;
  if (a.Y===b.Y) return t<a.Y && a.Y<bottom && Math.min(a.X,b.X)<r && Math.max(a.X,b.X)>l;
  if (a.X===b.X) return l<a.X && a.X<r && Math.min(a.Y,b.Y)<bottom && Math.max(a.Y,b.Y)>t;
  return true;
}
export function lineIntersectsUnrelatedNode(g,e,a,b,guard) {
  for (const n of g.Nodes) {
    guard.step();
    if (n.TopLeft==null || n.Width<=0 || n.Height<=0) continue;
    if (n!==e.From && n!==e.To && (e.From.IsDescendantOf(n)||e.To.IsDescendantOf(n))) continue;
    if (orthogonalSegmentEntersNode(n,a,b)) return true;
  }
  return false;
}
export function lineIntersectsOtherEdges(g,e,a,b,guard) {
  for (const other of g.Edges) {
    guard.step();
    if (other===e || other.Points.length<2) continue;
    for (let i=0;i<other.Points.length-1;i++) {
      guard.step();
      if (intersects(a,b,other.Points[i],other.Points[i+1])) return true;
    }
  }
  return false;
}
export function simplifyPoints(g,e,guard) {
  const ps=e.Points;
  if (ps.length<5) { guard.step(); return ps; }
  const result=[ps[0]];
  let i=0;
  const opposite=(a,b)=>a>0&&b<0 || a<0&&b>0;
  const same=(a,b)=>a>0&&b>0 || a<0&&b<0;
  for (;i<ps.length-4;) {
    guard.step();
    const [a,b,c,d,f]=ps.slice(i,i+5);
    const pattern=(isVerticalSegment(b,c)&&isVerticalSegment(d,f)&&opposite(c.Y-b.Y,f.Y-d.Y)&&
      isHorizontalSegment(a,b)&&isHorizontalSegment(c,d)&&same(b.X-a.X,d.X-c.X)) ||
      (isHorizontalSegment(b,c)&&isHorizontalSegment(d,f)&&opposite(c.X-b.X,f.X-d.X)&&
      isVerticalSegment(a,b)&&isVerticalSegment(c,d)&&same(b.Y-a.Y,d.Y-c.Y));
    let intersection=null, blocked=false;
    if (pattern) {
      intersection=findIntersectionPoint(a,b,d,f);
      blocked=intersection===null;
      if (intersection!==null) {
        if (i===0 && e.From.ContainsPoint(a,1) && !sameRouteDirection(a,b,a,intersection)) blocked=true;
        if (i+4===ps.length-1 && e.To.ContainsPoint(f,1) && !sameRouteDirection(d,f,intersection,f)) blocked=true;
        for (const [start,end] of [[a,intersection],[intersection,f]]) {
          const nodeBlocked=lineIntersectsUnrelatedNode(g,e,start,end,guard);
          blocked=blocked||nodeBlocked;
          const edgeBlocked=lineIntersectsOtherEdges(g,e,start,end,guard);
          blocked=blocked||edgeBlocked;
        }
      }
    }
    if (pattern&&!blocked) { result.push(intersection,f); i+=4; break; }
    result.push(b); i++;
  }
  for (let j=i+1;j<ps.length;j++) { guard.step(); result.push(ps[j]); }
  return result;
}
