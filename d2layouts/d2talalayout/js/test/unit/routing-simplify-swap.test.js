import { expect, test } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { simplifyEdgeRoutesWithLimit, simplifyPoints } from '../../src/routing/edge-simplify.js';
import { swapAllEdgePortsWithWorkLimit, swapEdgePortsGuarded } from '../../src/routing/swap-ports.js';
const bg=backgroundWorkContext();
const points=values=>values.map(([x,y])=>new Point(x,y));
function simple() {
  const g=new Graph(),a=new Node(1n,10,10),b=new Node(2n,10,10);
  a.TopLeft=new Point(-10,-5);b.TopLeft=new Point(40,-25);g.AddNode(a);g.AddNode(b);
  const e=new Edge(a,b);e.Points=points([[0,0],[10,0],[10,20],[40,20],[40,-20]]);g.AddEdge(e);a.addEdge(e);b.addEdge(e);
  return {g,e};
}
test('simplify removes detour and preserves surviving point identity',()=>{
  const {g,e}=simple(),first=e.Points[0],last=e.Points.at(-1);
  simplifyEdgeRoutesWithLimit(bg,g,10000);
  expect(e.Points.map(p=>[p.X,p.Y])).toEqual([[0,0],[40,0],[40,-20]]);
  expect(e.Points[0]).toBe(first);expect(e.Points.at(-1)).toBe(last);
});
test('both emitted legs are checked even when first is blocked',()=>{
  const {g,e}=simple(),obstacle=new Node(3n,10,10);obstacle.TopLeft=new Point(15,-5);g.AddNode(obstacle);
  let used=0;simplifyPoints(g,e,{step(){used++;}});
  expect(used).toBe(12);
  simplifyEdgeRoutesWithLimit(bg,g,10000);expect(e.Points.length).toBe(5);
});
for (const [name,stage] of [['simplify',simplifyEdgeRoutesWithLimit],['swap',swapAllEdgePortsWithWorkLimit]]) {
  test(`${name} exact W succeeds; W-1 restores original array and points`,()=>{
    let w=0;
    for (;w<2000;w++) { const {g}=simple();try{stage(bg,g,w);break;}catch(e){if(!e.message.includes('work exceeds'))throw e;} }
    expect(w).toBeLessThan(2000);
    const {g,e}=simple(),array=e.Points,refs=[...array],values=refs.map(p=>[p.X,p.Y]);
    expect(()=>stage(bg,g,w-1)).toThrow();expect(e.Points).toBe(array);
    refs.forEach((p,i)=>{expect(e.Points[i]).toBe(p);expect([p.X,p.Y]).toEqual(values[i]);});
    stage(bg,g,w);
  });
}
test('same-side crossing swaps departure coordinates with exact guarded count',()=>{
  const g=new Graph(),n=new Node(1n,10,10),a=new Node(2n,10,10),b=new Node(3n,10,10);
  n.TopLeft=new Point(0,0);a.TopLeft=new Point(100,100);b.TopLeft=new Point(100,-100);
  for(const x of [n,a,b])g.AddNode(x);
  const e=new Edge(n,a),f=new Edge(n,b);
  e.Points=points([[10,2],[30,2],[30,20]]);f.Points=points([[10,8],[40,8],[40,-20]]);
  g.AddEdge(e);g.AddEdge(f);n.addEdge(e);n.addEdge(f);a.addEdge(e);b.addEdge(f);let used=0;
  expect(swapEdgePortsGuarded(n,{step(){used++;},add(n){used+=n;}})).toBe(true);
  expect(e.Points[0].Y).toBe(8);expect(f.Points[0].Y).toBe(2);expect(used).toBe(14);
});
