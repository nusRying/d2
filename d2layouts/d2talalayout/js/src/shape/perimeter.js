// Pinned lib/svg/path.go geometry context and lib/shape perimeter dispatch.
import { Point } from '../geometry/point.js';
import { Segment } from '../geometry/segment.js';
import { goRound } from '../geometry/math.js';
import { cubicIntersections, ellipseIntersections } from './perimeter-intersections.js';
import * as paths from './perimeter-paths.js';
const chop=value=>goRound(Math.fround(value*10000)/10000)||0;
export class PathContext {
 constructor(tl,sx,sy){this.TopLeft=tl.Copy();this.ScaleX=sx;this.ScaleY=sy;this.Path=[];}
 Relative(base,x,y){return new Point(chop(base.X+this.ScaleX*x),chop(base.Y+this.ScaleY*y));}
 Absolute(x,y){return this.Relative(this.TopLeft,x,y);}
 StartAt(p){this.Start=p;this.Current=p.Copy();}
 Z(){this.Path.push(new Segment(this.Current.Copy(),this.Start.Copy()));this.Current=this.Start.Copy();}
 L(relative,x,y){const end=relative?this.Relative(this.Current,x,y):this.Absolute(x,y);this.Path.push(new Segment(this.Current.Copy(),end));this.Current=end.Copy();}
 C(relative,x1,y1,x2,y2,x3,y3){
  const p=(x,y)=>relative?this.Relative(this.Current,x,y):this.Absolute(x,y);
  const points=[this.Current.Copy(),p(x1,y1),p(x2,y2),p(x3,y3)];
  this.Path.push({intersections:segment=>cubicIntersections(points,segment)});this.Current=points[3].Copy();
 }
 H(relative,x){const end=relative?this.Relative(this.Current,x,0):this.Absolute(x,0);if(!relative)end.Y=this.Current.Y;this.Path.push(new Segment(this.Current.Copy(),end.Copy()));this.Current=end.Copy();}
 V(relative,y){const end=relative?this.Relative(this.Current,0,y):this.Absolute(0,y);if(!relative)end.X=this.Current.X;this.Path.push(new Segment(this.Current.Copy(),end));this.Current=end.Copy();}
}
const pathFunctions={Callout:'calloutPath',Cloud:'cloudPath',Cylinder:'cylinderOuterPath',Diamond:'diamondPath',Document:'documentPath',Hexagon:'hexagonPath',Package:'packagePath',Page:'pageOuterPath',Parallelogram:'parallelogramPath',Person:'personPath',Queue:'queueOuterPath',Step:'stepPath',StoredData:'storedDataPath'};
export function shapePerimeter(node) {
 const type=node._shapeType??'';
 if(type==='Circle'||type==='Oval'){
  const center=new Point(node.TopLeft.X+node.Width/2,node.TopLeft.Y+node.Height/2);
  return [{intersections:segment=>ellipseIntersections(center,node.Width/2,node.Height/2,segment)}];
 }
 if(type==='C4Person') {
  const radius=node.Width*0.22,center=new Point(node.TopLeft.X+node.Width/2,node.TopLeft.Y+radius);
  return paths.bodyPath(node).Path.concat([{intersections:segment=>ellipseIntersections(center,radius,radius,segment)}]);
 }
 const pathFunction=pathFunctions[type];return pathFunction==null?[]:paths[pathFunction](node).Path;
}
