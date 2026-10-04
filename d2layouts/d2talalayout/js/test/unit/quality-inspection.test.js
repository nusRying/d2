import { expect, test } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { Inspect, inspectWithLimit } from '../../src/quality/inspection.js';
import { segmentEntersBox } from '../../src/quality/inspection-geometry.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { WorkContext } from '../../src/limits/work-context.js';
import { countNonSharedCrossings } from '../../src/quality/crossings.js';
import { newWorkGuard } from '../../src/limits/work-guard.js';

const ctx = backgroundWorkContext();
function drawing() {
  const g = new Graph();
  for (const [id,x,y] of [[1,0,0],[2,100,0],[3,45,45],[4,45,-55]]) {
    const n = new Node(BigInt(id),10,10); n.TopLeft = new Point(x,y); g.AddNode(n);
  }
  const a=g.connect(g.Nodes[0],g.Nodes[1]); a.Points=[new Point(10,5),new Point(100,5)];
  const b=g.connect(g.Nodes[2],g.Nodes[3]); b.Points=[new Point(50,45),new Point(50,-45)];
  return g;
}
test('Inspect measures normalized length and nonshared crossings without changing routes',()=>{
  const g=drawing(), routes=g.Edges.map(e=>e.Points);
  expect(Inspect(ctx,g)).toEqual({NodeOverlaps:0,RouteObstructions:0,TextOcclusions:0,Crossings:1,Detour:0,RouteLength:18});
  g.Edges.forEach((e,i)=>expect(e.Points).toBe(routes[i]));
});
test('Inspect exact work boundary rejects W-1 and remains read only',()=>{
  const g=drawing(), result=inspectWithLimit(ctx,g,100000);
  expect(inspectWithLimit(ctx,g,result.workUsed).metrics).toEqual(result.metrics);
  expect(()=>inspectWithLimit(ctx,g,result.workUsed-1n)).toThrow('work exceeds limit');
});
test('open slab ignores borders and point segments and detects diagonal interiors',()=>{
  const box={TopLeft:new Point(0,0),Width:10,Height:10};
  expect(segmentEntersBox(box,new Point(-5,0),new Point(15,0))).toBe(false);
  expect(segmentEntersBox(box,new Point(5,5),new Point(5,5))).toBe(false);
  expect(segmentEntersBox(box,new Point(-5,-5),new Point(15,15))).toBe(true);
});
test('Inspect counts unrelated node overlap and one obstruction per route and node',()=>{
  const g=drawing();
  const obstacle=new Node(5n,20,20);obstacle.TopLeft=new Point(40,0);g.AddNode(obstacle);
  const duplicate=new Node(6n,20,20);duplicate.TopLeft=new Point(45,0);g.AddNode(duplicate);
  const metrics=Inspect(ctx,g);
  expect(metrics.NodeOverlaps).toBe(1);
  expect(metrics.RouteObstructions).toBe(4);
  g.Edges[0].IsCurve=true;
  expect(Inspect(ctx,g).RouteObstructions).toBe(2);
});
test('Inspect ignores invisible routes and intentional container containment',()=>{
  const g=drawing();g.Edges[1].IsInvisible=true;
  const vessel=new Node(5n,200,200);vessel.TopLeft=new Point(-60,-60);g.AddNode(vessel);
  for(const node of g.Nodes.slice(0,4))g.addNodeToContainer(vessel,node);
  const metrics=Inspect(ctx,g);
  expect(metrics.Crossings).toBe(0);expect(metrics.RouteLength).toBe(9);
  expect(metrics.NodeOverlaps).toBe(0);expect(metrics.RouteObstructions).toBe(0);
});
test('Inspect node text excludes owner coverage but counts an unrelated crossing route',()=>{
  const g=drawing();
  const node=new Node(5n,40,40);node.TopLeft=new Point(30,-15);g.AddNode(node);
  node.Label=new Label('text',20,20);node.Label.Position=LabelPosition.InsideMiddleCenter;
  expect(Inspect(ctx,g).TextOcclusions).toBe(2);
  g.Edges[0].IsCurve=true;
  expect(Inspect(ctx,g).TextOcclusions).toBe(1);
});
test('crossings exclude collinear overlap and shared bend ends',()=>{
  const edge=points=>({Points:points.map(([x,y])=>new Point(x,y))});
  const a=edge([[0,0],[10,0]]),b=edge([[5,0],[15,0]]),c=edge([[5,0],[5,5]]);
  expect(countNonSharedCrossings([a,b],newWorkGuard(ctx,'Inspect',100))).toBe(0);
  expect(countNonSharedCrossings([a,c],newWorkGuard(ctx,'Inspect',100))).toBe(0);
});
test('Inspect rejects nil graph and cancellation before doing inspection work',()=>{
  expect(()=>Inspect(ctx,null)).toThrow('cannot evaluate a nil graph');
  const canceled=new WorkContext({isCancelled:()=>true,doneAvailable:true});
  expect(()=>Inspect(canceled,drawing())).toThrow('context canceled');
});
