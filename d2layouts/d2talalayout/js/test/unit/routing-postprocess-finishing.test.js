import { expect, test } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { BalanceEdgeSegments, FixClusterEdgeBranching, balanceEdgeSegmentsWithLimit } from '../../src/routing/postprocess.js';
import { changedRouteIsClear, copyRoutePoints } from '../../src/routing/port-interior-balance.js';
import { newRouteWorkGuard } from '../../src/routing/route-guards.js';
const bg = backgroundWorkContext();
function graph() {
 const g = new Graph(); const a = new Node(1n,20,20); const b = new Node(2n,20,20);
 a.TopLeft = new Point(0,0); b.TopLeft = new Point(100,0); g.addNewNodeToContainer(null,a); g.addNewNodeToContainer(null,b);
 const e = g.connect(a,b); e.Points = [new Point(20,10),new Point(100,10)]; return {g,e};
}
test('public balancing and cluster wrappers preserve straight routes', () => {
 const {g,e}=graph(); BalanceEdgeSegments(bg,g); FixClusterEdgeBranching(bg,g);
 expect(e.Points.map(p=>[p.X,p.Y])).toEqual([[20,10],[100,10]]);
});
test('balancing exhaustion preserves original route and point identities', () => {
 const {g,e}=graph(); const points=e.Points; const first=points[0];
 expect(()=>balanceEdgeSegmentsWithLimit(bg,g,1)).toThrow();
 expect(e.Points).toBe(points); expect(e.Points[0]).toBe(first);
});
test('fixed approaches reject changed endpoint and diagonal new segments', () => {
 const {g,e}=graph(); const guard=newRouteWorkGuard(bg,'test',10000);
 const before=copyRoutePoints([e],guard).get(e); e.Points[0].Y=11;
 expect(changedRouteIsClear(g,e,before,true,guard)).toBe(false);
 expect(changedRouteIsClear(g,e,before,false,guard)).toBe(false);
});
import { makeLoopRoute } from '../../src/routing/coordinator.js';
import { NewOVGNode } from '../../src/routing/ovg-node.js';
test('loop route retains center and route point identities while copying ports', () => {
 const {g,e}=graph(); e.To=e.From;
 const center=NewOVGNode(new Point(10,10));
 const r=makeLoopRoute(e,{Centers:new Map([[e.From,center]])});
 expect(r.OVGNodes[0]).toBe(center);expect(r.OVGNodes.at(-1)).toBe(center);
 expect(r.OVGNodes[1].Point).toBe(e.Points[0]);
 expect(r.FromPort).not.toBe(e.Points[0]);expect(r.FromPort.X).toBe(20);
});
test('balancing recenters a vertical route within node sides', () => {
 const {g,e}=graph(); e.From.Width=e.From.Height=e.To.Width=e.To.Height=1000;
 e.To.TopLeft=new Point(0,2000); e.Points=[new Point(1,1000),new Point(1,2000)];
 BalanceEdgeSegments(bg,g);expect(e.Points.map(p=>[p.X,p.Y])).toEqual([[500,1000],[500,2000]]);
});
test('diamond fixed port interior pass preserves approaches and moves corridor', () => {
 const {g,e}=graph(); e.From.Width=e.From.Height=e.To.Width=e.To.Height=100;
 e.To.TopLeft=new Point(300,0);e.From.SetShape('Diamond');e.To.SetShape('Diamond');
 const input=[[100,50],[130,50],[130,200],[220,200],[220,300],[270,300],[270,50],[300,50]];
 e.Points=input.map(([x,y])=>new Point(x,y));BalanceEdgeSegments(bg,g);
 const output=e.Points.map(p=>[p.X,p.Y]);
 expect(output[0]).toEqual(input[0]);expect(output[1]).toEqual(input[1]);
 expect(output.at(-2)).toEqual(input.at(-2));expect(output.at(-1)).toEqual(input.at(-1));
 expect(output).not.toEqual(input);
});
import { shapeTraceToShapeBorder } from '../../src/routing/trace.js';
test('shape tracing intersects Circle and Diamond rendered borders', () => {
 const {e}=graph(); e.From.Width=e.From.Height=100;e.From.SetShape('Circle');
 expect(shapeTraceToShapeBorder(e.From,new Point(100,25),new Point(200,25))).toEqual(new Point(93,25));
 e.From.SetShape('Diamond');expect(shapeTraceToShapeBorder(e.From,new Point(100,25),new Point(200,25))).toEqual(new Point(76,25));
});
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { fixClusterEdgeBranchingWithLimit } from '../../src/routing/postprocess.js';
function balanceBoundaryGraph() {
 const {g,e}=graph();e.From.Width=e.From.Height=e.To.Width=e.To.Height=1000;
 e.To.TopLeft=new Point(0,2000);e.Points=[new Point(1,1000),new Point(1,2000)];return {g,e};
}
function branchingBoundaryGraph() {
 const g=new Graph();const nodes=[new Node(1n,10,10),new Node(2n,10,10),new Node(3n,10,10)];
 nodes.forEach((n,i)=>{n.TopLeft=new Point(10000+i*1000,10000+i*1000);g.addNewNodeToContainer(null,n);});
 const vessel=new Node(4n,10,10);vessel.TopLeft=new Point(11000,11000);vessel.Graph=g;
 const cluster=new Cluster({Vessel:vessel,Nodes:nodes.slice(1),Arrangement:ClusterArrangement.Row,DesiredArrangement:ClusterArrangement.Row,Graph:g});
 nodes[1].Cluster=cluster;nodes[2].Cluster=cluster;g.Clusters.set(vessel,cluster);
 const e=g.connect(nodes[0],nodes[1]),other=g.connect(nodes[0],nodes[2]);
 e.Points=[[0,0],[0,-10],[-100,-10],[-100,100]].map(([x,y])=>new Point(x,y));
 other.Points=[[0,0],[0,10],[100,10],[100,-5]].map(([x,y])=>new Point(x,y));
 return {g,e};
}
for(const [name,build,run,W] of [['BalanceEdgeSegments',balanceBoundaryGraph,balanceEdgeSegmentsWithLimit,55],['FixClusterEdgeBranching',branchingBoundaryGraph,fixClusterEdgeBranchingWithLimit,202]]) {
 test(`${name} pinned Go W succeeds and W-1 restores every original point`,()=>{
  const {g,e}=build();run(bg,g,W);
  const failed=build(),points=failed.e.Points,values=points.map(p=>[p.X,p.Y]),identities=points.slice();
  expect(()=>run(bg,failed.g,W-1)).toThrow();expect(failed.e.Points).toBe(points);
  identities.forEach((p,i)=>expect(failed.e.Points[i]).toBe(p));expect(points.map(p=>[p.X,p.Y])).toEqual(values);
 });
}
