import { nodeIsRectangular } from '../shape/label-preferences.js';
import { boxesOverlapWithPadding } from '../labeling/labeling-access.js';
import { evaluationIsDescendantOf } from './evaluation-guard.js';
export { boxesOverlapWithPadding };
export function boxCovers(outer,inner) {
  return inner.TopLeft.X>=outer.TopLeft.X&&inner.TopLeft.Y>=outer.TopLeft.Y&&inner.TopLeft.X+inner.Width<=outer.TopLeft.X+outer.Width&&inner.TopLeft.Y+inner.Height<=outer.TopLeft.Y+outer.Height;
}
export function relatedNodes(a,b,guard) {return evaluationIsDescendantOf(a,b,guard)||evaluationIsDescendantOf(b,a,guard);}
export function endpointAncestor(edge,node,guard) {return evaluationIsDescendantOf(edge.From,node,guard)||evaluationIsDescendantOf(edge.To,node,guard);}
export function segmentEntersBox(box,a,b) {
  if(box.Width<=0||box.Height<=0||a.X===b.X&&a.Y===b.Y) return false;
  let low=0,high=1;
  for(const [start,delta,min,max] of [[a.X,b.X-a.X,box.TopLeft.X,box.TopLeft.X+box.Width],[a.Y,b.Y-a.Y,box.TopLeft.Y,box.TopLeft.Y+box.Height]]) {
    if(delta===0) {if(start<=min||start>=max)return false; continue;}
    let first=(min-start)/delta,last=(max-start)/delta;
    if(first>last)[first,last]=[last,first];
    low=Math.max(low,first);high=Math.min(high,last);
    if(low>=high)return false;
  }
  return low<high;
}
export function measureGeometry(g,score,guard) {
  for(let n=0;n<g.Nodes.length;n++) {
    const node=g.Nodes[n];guard.step();
    if(node.IsInvisible||!nodeIsRectangular(node))continue;
    for(let j=n+1;j<g.Nodes.length;j++) {
      const other=g.Nodes[j];guard.step();
      if(other.IsInvisible||!nodeIsRectangular(other)||!boxesOverlapWithPadding(node.Box,other.Box,0))continue;
      if(!relatedNodes(node,other,guard))score.NodeOverlaps++;
    }
    for(const edge of g.Edges) {
      guard.step();if(edge.IsInvisible||edge.IsCurve)continue;
      const ancestor=endpointAncestor(edge,node,guard);
      if(ancestor&&edge.From!==node&&edge.To!==node)continue;
      for(let i=1;i<edge.Points.length;i++) {
        guard.step();
        if(i===1&&edge.From===node||i===edge.Points.length-1&&edge.To===node)continue;
        if(segmentEntersBox(node.Box,edge.Points[i-1],edge.Points[i])) {score.RouteObstructions++;break;}
      }
    }
  }
}
