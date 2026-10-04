import { expect, test } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Cluster } from '../../src/graph/cluster.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { StraightEdgesFallback, ReorderDuplicates, Crosshatch, crosshatchWithWorkLimit } from '../../src/routing/coordinator.js';
const bg=backgroundWorkContext();
function drawing() {
 const g=new Graph(),a=new Node(1n,40,40),b=new Node(2n,40,40);a.TopLeft=new Point(0,0);b.TopLeft=new Point(200,0);g.AddNode(a);g.AddNode(b);
 const e=g.connect(a,b);e.Points=[[40,20],[80,20],[80,100],[160,100],[160,20],[200,20]].map(([x,y])=>new Point(x,y));return [g,e,a];
}
test('public straight fallback reduces a detour',()=>{const [g,e]=drawing();StraightEdgesFallback(bg,g);expect(e.Points).toEqual([new Point(40,20),new Point(200,20)]);});
test('crosshatch converts external edges sharing a cluster port',()=>{
 const [g,e,a]=drawing(),other=g.connect(a,e.To);other.Points=e.Points.map(p=>p.Copy());
 const vessel=new Node(3n,80,80);vessel.TopLeft=new Point(0,0);g.AddNode(vessel);
 const c=new Cluster({Vessel:vessel,Nodes:[a]});c.EdgeAbductions=[{Edge:e},{Edge:other}];g.Clusters.set(vessel,c);
 g.addNodeToContainer(vessel,a);
 Crosshatch(bg,g);expect(e.Points.length).toBe(2);expect(other.Points.length).toBe(2);
});
test('public duplicate stage accepts valid routes and crosshatch preserves identity on failure',()=>{
 const [g,e]=drawing(),before=e.Points;ReorderDuplicates(bg,g);expect(e.Points).toBe(before);
 expect(()=>crosshatchWithWorkLimit(bg,g,1)).toThrow('work limit');expect(e.Points).toBe(before);
});
test('legacy finishing boundaries require a context before mutating routes',()=>{
 const [g,e]=drawing(),before=e.Points;
 expect(()=>StraightEdgesFallback(null,g)).toThrow();
 expect(()=>ReorderDuplicates(null,g)).toThrow();
 expect(e.Points).toBe(before);
});
