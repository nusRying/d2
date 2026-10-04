import { Box } from '../geometry/box.js';
import { LabelPosition, normalizeLabelPosition } from '../graph/label-position.js';
import { IsOutside } from '../labeling/label-position-ops.js';
import { NodeLabelTopLeft, IconSize, IsImage } from '../labeling/labeling-access.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { nodeIsRectangular } from '../shape/label-preferences.js';
import { chargeEvaluationWork, evaluationIsDescendantOf } from './evaluation-guard.js';
import { boxesOverlapWithPadding, boxCovers, endpointAncestor, segmentEntersBox } from './inspection-geometry.js';
const isSet=p=>normalizeLabelPosition(p)!==LabelPosition.Unset;
export function labelBox(edge) {const l=edge.Label;return new Box(edge.LabelTopLeft(l.Position,l.Width,l.Height),l.Width,l.Height);}
export function measureLabels(g,score,guard) {
  guard.step();const labels=[];
  const append=(box,node,edge)=>{if(box.Width>0&&box.Height>0)labels.push({box,node,edge});};
  for(const node of g.Nodes) {
    guard.step();if(node.IsInvisible)continue;
    if(node.Label!=null&&isSet(node.Label.Position)) {
      const l=node.Label;if(IsOutside(l.Position))chargeEvaluationWork(guard,4*g.Nodes.length);
      append(new Box(NodeLabelTopLeft(node,l.Position,l.Width,l.Height),l.Width,l.Height),node,null);
    }
    if(node.Icon!=null&&!IsImage(node)) {
      const p=node.Icon.Position;if(IsOutside(p))chargeEvaluationWork(guard,4*g.Nodes.length);
      const size=IconSize(node,p);append(new Box(NodeLabelTopLeft(node,p,size,size),size,size),node,null);
    }
  }
  const visible=[];
  for(const edge of g.Edges) {
    guard.step();if(edge.IsInvisible)continue;visible.push(edge);
    if(edge.Points.length<2)continue;
    if(edge.Label!=null&&isSet(edge.Label.Position)) {chargeEvaluationWork(guard,edge.Points.length);append(labelBox(edge),null,edge);}
    if(edge.SourceArrowheadLabel!=null) {chargeEvaluationWork(guard,edge.Points.length);append(PositionArrowheadLabel(edge,false,edge.Points).Box,null,edge);}
    if(edge.TargetArrowheadLabel!=null) {chargeEvaluationWork(guard,edge.Points.length);append(PositionArrowheadLabel(edge,true,edge.Points).Box,null,edge);}
  }
  for(let i=0;i<labels.length;i++) {
    const placed=labels[i];guard.step();
    for(let j=0;j<i;j++) {guard.step();if(boxesOverlapWithPadding(placed.box,labels[j].box,0))score.TextOcclusions++;}
    for(const node of g.Nodes) {
      guard.step();if(node.IsInvisible||!nodeIsRectangular(node)||!boxesOverlapWithPadding(placed.box,node.Box,0))continue;
      const ancestor=placed.node!=null?evaluationIsDescendantOf(placed.node,node,guard):endpointAncestor(placed.edge,node,guard)&&node!==placed.edge.From&&node!==placed.edge.To;
      if(ancestor&&boxCovers(node.Box,placed.box))continue;
      score.TextOcclusions++;
    }
    for(const edge of visible) {
      guard.step();if(edge===placed.edge||edge.IsCurve)continue;
      let overlap=false;
      for(let j=1;j<edge.Points.length;j++) {guard.step();if(segmentEntersBox(placed.box,edge.Points[j-1],edge.Points[j])) {overlap=true;break;}}
      if(overlap)score.TextOcclusions++;
    }
  }
}
