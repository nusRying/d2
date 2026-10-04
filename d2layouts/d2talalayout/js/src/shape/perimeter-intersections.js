// Exact lib/geo/bezier.go and ellipse.go intersection kernels used by tracing.
import { Point } from '../geometry/point.js';
import { goSortSlice } from '../packing/go-support.js';
const precision=0.0001;
const compare=(a,b)=>Math.abs(a-b)<precision?0:a<b?-1:1;
function sortSpecial(a) {
 for (;;) {let flip=false;for(let i=0;i<a.length-1;i++) {
  const nextNonnegative=compare(a[i+1],0)>=0;
  if((nextNonnegative && compare(a[i],a[i+1])>0)||(compare(a[i],0)<0 && nextNonnegative)) {flip=true;[a[i],a[i+1]]=[a[i+1],a[i]];}
 }if(!flip) return a;}
}
function cubicRoots(p) {
 if(compare(p[0],0)===0) {
  if(compare(p[1],0)===0) {const t=[-(p[3]/p[2]),-1,-1];if(compare(t[0],0)<0||compare(t[0],1)>0)t[0]=-1;return sortSpecial(t);}
  let dq=Math.pow(p[2],2)-4*p[1]*p[3];
  if(compare(dq,0)>=0) {dq=Math.sqrt(dq);const t=[-((dq+p[2])/(2*p[1])),((dq-p[2])/(2*p[1])),-1];if(compare(t[0],0)<0||compare(t[0],1)>0)t[0]=-1;return sortSpecial(t);}
 }
 const A=p[1]/p[0],B=p[2]/p[0],C=p[3]/p[0];
 const Q=(3*B-Math.pow(A,2))/9,R=(9*A*B-27*C-2*Math.pow(A,3))/54,D=Math.pow(Q,3)+Math.pow(R,2);
 const t=[0,0,0];
 if(compare(D,0)>=0) {
  const sign=x=>x<0?-1:1;
  const S=sign(R+Math.sqrt(D))*Math.pow(Math.abs(R+Math.sqrt(D)),1/3),T=sign(R-Math.sqrt(D))*Math.pow(Math.abs(R-Math.sqrt(D)),1/3);
  t[0]=-A/3+(S+T);t[1]=-A/3-(S+T)/2;t[2]=-A/3-(S+T)/2;
  const im=Math.abs(Math.sqrt(3)*(S-T)/2);if(compare(im,0)!==0){t[1]=-1;t[2]=-1;}
 } else {
  const th=Math.acos(R/Math.sqrt(-Math.pow(Q,3)));
  t[0]=2*Math.sqrt(-Q)*Math.cos(th/3)-A/3;t[1]=2*Math.sqrt(-Q)*Math.cos((th+2*Math.PI)/3)-A/3;t[2]=2*Math.sqrt(-Q)*Math.cos((th+4*Math.PI)/3)-A/3;
 }
 for(let i=0;i<3;i++)if(compare(t[i],0)<0||compare(t[i],1)>0)t[i]=-1;
 return sortSpecial(t);
}
const coeff=p=>[-p[0]+3*p[1]+-3*p[2]+p[3],3*p[0]-6*p[1]+3*p[2],-3*p[0]+3*p[1],p[0]];
export function cubicIntersections(points,segment) {
 const bx=coeff(points.map(p=>p.X)),by=coeff(points.map(p=>p.Y));
 const lx=[segment.Start.X,segment.End.X],ly=[segment.Start.Y,segment.End.Y];
 const A=ly[1]-ly[0],B=lx[0]-lx[1],C=lx[0]*(ly[0]-ly[1])+ly[0]*(lx[1]-lx[0]);
 const p=[A*bx[0]+B*by[0],A*bx[1]+B*by[1],A*bx[2]+B*by[2],A*bx[3]+B*by[3]+C];
 const out=[];
 for(const t of cubicRoots(p)) {
  const point=new Point(bx[0]*t*t*t+bx[1]*t*t+bx[2]*t+bx[3],by[0]*t*t*t+by[1]*t*t+by[2]*t+by[3]);
  const s=lx[1]-lx[0]!==0?(point.X-lx[0])/(lx[1]-lx[0]):(point.Y-ly[0])/(ly[1]-ly[0]);
  if(!(compare(t,0)<0||compare(t,1)>0||compare(s,0)<0||compare(s,1)>0))out.push(point);
 }
 return out;
}
export function ellipseIntersections(center,a,b,segment) {
 if(a<=0||b<=0)return [];
 const a2=a*a,b2=b*b,x1=segment.Start.X-center.X,y1=segment.Start.Y-center.Y,x2=segment.End.X-center.X,y2=segment.End.Y-center.Y,out=[];
 if(x1===x2) {
  const first=new Point(x1,b*Math.sqrt(a2-x1*x1)/a),second=first.Copy();second.Y*=-1;
  const on=p=>{const values=[p.Y,y1,y2];goSortSlice(values,(a,b)=>a<b);return values[1]===p.Y;};
  if(on(first))out.push(first);if(second.Y!==0&&on(second))out.push(second);
 } else {
  const m=(y2-y1)/(x2-x1),c=y1-m*x1,denom=a2*m*m+b2,root=Math.sqrt(a2*b2*(denom-c*c));
  const first=new Point((-m*c*a2+root)/denom,(c*b2+m*root)/denom),second=new Point((-m*c*a2-root)/denom,(c*b2-m*root)/denom);
  const on=p=>compare(p.distanceToLine(new Point(x1,y1),new Point(x2,y2)),0)===0;
  if(on(first))out.push(first);if(!first.equals(second)&&on(second))out.push(second);
 }
 for(const p of out){p.X+=center.X;p.Y+=center.Y;}return out;
}
