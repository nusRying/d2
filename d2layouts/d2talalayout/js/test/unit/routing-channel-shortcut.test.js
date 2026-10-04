import { expect, test } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { NudgeEdgeChannels, nudgeChannelsWithLimit, channelPointProposal, solveChannelGap } from '../../src/routing/nudge-channels.js';
import { ShortcutEdgeRoutes, shortcutRoutesWithLimit, shortcutCandidate, shortcutOrthogonal, shortcutContactsPreserved, shortcutLabelBoxes } from '../../src/routing/shortcut-routes.js';
import { newRouteWorkGuard } from '../../src/routing/route-guards.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition } from '../../src/graph/label-position.js';
const bg = backgroundWorkContext();
const pts = a => a.map(([x,y]) => new Point(x,y));
function graph() {
  const g = new Graph();
  const a = new Node(1n, 40, 40), b = new Node(2n,40,40);
  a.TopLeft = new Point(0,0); b.TopLeft = new Point(300,0);
  g.AddNode(a); g.AddNode(b);
  const e = g.connect(a,b);
  e.Points = pts([[40,20],[100,20],[100,120],[240,120],[240,20],[300,20]]);
  return [g,e];
}
test('shortcut candidate removes bends while preserving endpoint references', () => {
  const p = pts([[0,0],[40,0],[40,80],[120,80],[120,0],[160,0]]);
  const c = shortcutCandidate(p,0,5,true);
  expect(c).toEqual([p[0],p[5]]);
  expect(c[0]).toBe(p[0]);
  // Go retains the newly allocated elbow when equal to the end.
  expect(c[1]).not.toBe(p[5]);
  expect(shortcutOrthogonal(pts([[0,0],[20,0],[10,0]]))).toBe(false);
});
test('shortcut rejects new through crossings at subdivided contacts', () => {
  const guard = newRouteWorkGuard(bg,'test',10000);
  expect(shortcutContactsPreserved(pts([[0,0],[0,40],[80,40]]),pts([[0,0],[40,0],[80,0]]),pts([[40,-20],[40,0],[40,20]]),guard)).toBe(false);
});
test('channel DAG computes feasible earliest/latest positions', () => {
  const p = { groups:[{lower:0,upper:100},{lower:0,upper:100}],arcs:[{from:0,to:1,separate:true}] };
  expect(solveChannelGap(p,20,newRouteWorkGuard(bg,'test',1000))).toEqual([[20,40],[60,80],true]);
});
test('channel point proposals reject conflicting aliases without moving points', () => {
  const shared = new Point(20,40), first = new Point(20,0), last = new Point(20,80);
  const problem = {groups:[{segments:[{Start:first,End:shared}]},{segments:[{Start:shared,End:last}]}]};
  expect(channelPointProposal(problem,[30,50],true,newRouteWorkGuard(bg,'test',100))).toEqual([null,false]);
  expect(shared).toEqual(new Point(20,40));
  const [proposal, compatible] = channelPointProposal(problem,[30,30],true,newRouteWorkGuard(bg,'test',100));
  expect(compatible).toBe(true);
  expect(proposal.get(shared)).toEqual(new Point(30,40));
  expect(shared).toEqual(new Point(20,40));
});
test('shortcut inventories positioned node text and icons using renderer geometry', () => {
  const [g] = graph();
  const n = g.Nodes[0];
  n.Label = new Label('text', 12, 8);
  n.Label.Position = LabelPosition.InsideMiddleCenter;
  n.Icon = { Position: LabelPosition.InsideMiddleCenter };
  const boxes = shortcutLabelBoxes(g, newRouteWorkGuard(bg, 'test', 10000));
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toEqual({TopLeft:new Point(14,16),Width:12,Height:8});
  expect(boxes[1]).toEqual({TopLeft:new Point(10,10),Width:20,Height:20});
  expect(() => ShortcutEdgeRoutes(bg, g)).not.toThrow();
});
test('shortcut omits image icons and invisible node labels', () => {
  const [g] = graph();
  g.Nodes[0].SetShape('Image');
  g.Nodes[0].Icon = { Position: LabelPosition.InsideMiddleCenter };
  g.Nodes[1].IsInvisible = true;
  g.Nodes[1].Label = new Label('hidden', 10, 10);
  g.Nodes[1].Label.Position = LabelPosition.InsideMiddleCenter;
  expect(shortcutLabelBoxes(g, newRouteWorkGuard(bg, 'test', 10000))).toHaveLength(0);
});
for (const [name, stage, limited] of [['nudge',NudgeEdgeChannels,nudgeChannelsWithLimit],['shortcut',ShortcutEdgeRoutes,shortcutRoutesWithLimit]]) {
  test(`${name} work exhaustion restores exact route identity`, () => {
    const [g,e] = graph(), original = e.Points, references = original.slice(), values = references.map(p=>[p.X,p.Y]);
    expect(()=>limited(bg,g,1)).toThrow('work limit');
    expect(e.Points).toBe(original);
    references.forEach((p,i)=>{expect(e.Points[i]).toBe(p);expect([p.X,p.Y]).toEqual(values[i]);});
    expect(()=>stage(bg,g)).not.toThrow();
  });
  test(`${name} oversized admission checks cancellation and propagates sentinel`, () => {
    const [g] = graph(); g.Nodes = new Array(257);
    const sentinel = {};
    expect(()=>stage({Err:()=>sentinel},g)).toThrow();
    try { stage({Err:()=>sentinel},g); } catch(e) { expect(e).toBe(sentinel); }
    expect(()=>stage(bg,g)).not.toThrow();
  });
}
