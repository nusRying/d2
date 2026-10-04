// Exact pinned crossings.go scan and endpoint rules.
export function orientation(p,q,r) { return (q.Y-p.Y)*(r.X-p.X)-(q.X-p.X)*(r.Y-p.Y); }
export function equalSigns(a,b) { return a>0&&b>0 || a===0&&b===0 || a<0&&b<0; }
export function nonParallelIntersection(a,b,c,d) {
  if(equalSigns(orientation(a,b,c),orientation(a,b,d))) return false;
  return !equalSigns(orientation(c,d,a),orientation(c,d,b));
}
export function isNonSharedCrossing(edge,other,i,j) {
  const a=edge.Points[i],b=edge.Points[i+1],c=other.Points[j],d=other.Points[j+1];
  if(!nonParallelIntersection(a,b,c,d)) return false;
  if(a.X===b.X&&(a.X===c.X||a.X===d.X)) return false;
  if(a.Y===b.Y&&(a.Y===c.Y||a.Y===d.Y)) return false;
  return true;
}
export function countEdgeCrossings(edge,other,guard) {
  let count=0;
  for(let i=0;i<edge.Points.length-1;i++) {
    guard.step();
    for(let j=0;j<other.Points.length-1;j++) { guard.step(); if(isNonSharedCrossing(edge,other,i,j)) count++; }
  }
  return count;
}
export function countNonSharedCrossings(edges,guard) {
  let count=0;
  for(let i=0;i<edges.length;i++) {
    guard.step();
    for(let j=i+1;j<edges.length;j++) {guard.step(); count+=countEdgeCrossings(edges[i],edges[j],guard);}
  }
  return count;
}
