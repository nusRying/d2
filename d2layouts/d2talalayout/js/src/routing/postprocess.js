// Pinned postprocess.go stage entry points and cluster branching core.
import { runAtomicRouteStage } from './route-stage.js';
import { MAX_ROUTE_STAGE_WORK_UNITS } from './route-guards.js';
import { edgeIDValue } from './layoutgraph-route-support.js';
import { isSpecialEdgeForBalancing, balanceRegularEdgesGuarded } from './postprocess-balance.js';
import { balancePortInteriorsGuarded } from './port-interior-balance.js';
import { estimateRouteCostGuarded, routeIntersectsNodeGuarded } from './cluster-route-guard.js';
import { ClusterArrangement } from '../graph/cluster.js';
export function BalanceEdgeSegments(ctx,g) { return balanceEdgeSegmentsWithLimit(ctx,g,MAX_ROUTE_STAGE_WORK_UNITS); }
export function balanceEdgeSegmentsWithLimit(ctx,g,workLimit) {
 return runAtomicRouteStage(ctx,'BalanceEdgeSegments',g,null,workLimit,guard=>balanceEdgeSegmentsGuarded(g,guard));
}
export function balanceEdgeSegmentsGuarded(g,guard) {
 const special=[],regular=[];
 for (const e of g.Edges) {
  guard.step();
  if (e.Points.length<2) throw new Error(`TALA BalanceEdgeSegments edge ${edgeIDValue(e)} has an incomplete route`);
  (isSpecialEdgeForBalancing(g,e)?special:regular).push(e);
 }
 balanceRegularEdgesGuarded(g,special,regular,guard);
 balancePortInteriorsGuarded(g,guard);
}
export function FixClusterEdgeBranching(ctx,g) { return fixClusterEdgeBranchingWithLimit(ctx,g,MAX_ROUTE_STAGE_WORK_UNITS); }
export function fixClusterEdgeBranchingWithLimit(ctx,g,workLimit) {
 return runAtomicRouteStage(ctx,'FixClusterEdgeBranching',g,null,workLimit,guard=>fixClusterEdgeBranchingGuarded(g,guard));
}
export function fixClusterEdgeBranchingGuarded(g,guard) {
 for (const n of g.Nodes) {
  guard.step(); if (n.Edges.length<=1 || n.Cluster!=null) continue;
  const isFrom=new Map(),clusterEdges=new Map();
  for (const e of n.Edges) {
   guard.step(); if(e.Points.length!==4) continue;
   const adj=n.Adjacent(e),cluster=adj.Cluster;
   if(cluster==null || cluster.DesiredArrangement!==cluster.Arrangement) continue;
   isFrom.set(cluster,e.From===n);
   if(!clusterEdges.has(cluster)) clusterEdges.set(cluster,[e]); else clusterEdges.get(cluster).push(e);
  }
  for (const [cluster,edges] of clusterEdges) {
   guard.step(); let back=false,front=false;
   const axis=cluster.Arrangement===ClusterArrangement.Row?'X':'Y';
   const from=isFrom.get(cluster);
   for(const e of edges) {
    guard.step(); const source=e.Points[from?0:3][axis],target=e.Points[from?3:0][axis];
    if(target<source) back=true; if(target>source) front=true;
   }
   if(!back || !front) continue;
   const originalP1=new Map(),originalP2=new Map(),potential=[];
   for(const e of edges) { guard.step(); potential.push(e.Points[from?1:2]); originalP1.set(e,e.Points[1].Copy()); originalP2.set(e,e.Points[2].Copy()); }
   let bestPoint=null,bestCost=0;
   const restore=()=>{for(const e of edges) {guard.step(); e.Points[1]=originalP1.get(e).Copy();e.Points[2]=originalP2.get(e).Copy();}};
   const move=(e,p)=>{
    const index=from?1:2,other=from?2:1;
    e.Points[index]=p.Copy();
    const coordinate=cluster.Arrangement===ClusterArrangement.Row?'Y':'X'; e.Points[other][coordinate]=p[coordinate];
   };
   outer: for(const p of potential) {
    guard.step(); restore(); let cost=0;
    for(const e of edges) {
     guard.step(); const originalCost=estimateRouteCostGuarded(g.Edges,e,guard);
     if(e.Points[from?1:2]===p) {cost+=originalCost;continue;}
     move(e,p);
     if(routeIntersectsNodeGuarded(g.Nodes,e,guard)) continue outer;
     const newCost=estimateRouteCostGuarded(g.Edges,e,guard);cost+=newCost;
     if(newCost>originalCost) continue outer;
    }
    if(bestPoint==null || cost<bestCost) {bestPoint=p;bestCost=cost;}
   }
   restore();
   if(bestPoint!=null) for(const e of edges) {guard.step();move(e,bestPoint);}
  }
 }
 guard.finish();
}
