// Slice 47 — layoutgraph helpers the routing OVG substrate needs that the
// shared JS graph port does not expose yet. Free functions; shared files are
// not edited.
//
// Pinned references (d2layouts/d2talalayout/internal/layoutgraph):
//   geometry_policy.go — MinPortClearance, MinRouteNodeClearance, TreeParentSpacing
//   routing_access.go  — Node.ContainsPointOnBox (isPointOnNode),
//                        Node.IsPointNear (isPointNear)
//   node.go            — isPointNear, isPointOnNode
//   hierarchy_access.go — Edge.IsLoop (nil-safe isLoop)

export { MIN_PORT_CLEARANCE } from '../hierarchy/constants.js';
export { TREE_PARENT_SPACING } from '../trees/geometry.js';

/** layoutgraph.MinRouteNodeClearance (geometry_policy.go). */
export const MIN_ROUTE_NODE_CLEARANCE = 20.0;

/** Node.IsPointNear: the point lies within the node box padded by MinRouteNodeClearance. */
export function nodeIsPointNear(node, point) {
  return (((node.TopLeft.X - MIN_ROUTE_NODE_CLEARANCE) <= point.X) &&
    ((node.TopLeft.X + node.Width + MIN_ROUTE_NODE_CLEARANCE) >= point.X)) &&
    (((node.TopLeft.Y - MIN_ROUTE_NODE_CLEARANCE) <= point.Y) &&
      ((node.TopLeft.Y + node.Height + MIN_ROUTE_NODE_CLEARANCE) >= point.Y));
}

/** Node.ContainsPointOnBox: the closed node box contains the point. */
export function nodeContainsPointOnBox(node, point) {
  return ((node.TopLeft.X <= point.X) && ((node.TopLeft.X + node.Width) >= point.X)) &&
    ((node.TopLeft.Y <= point.Y) && ((node.TopLeft.Y + node.Height) >= point.Y));
}

/** Edge.IsLoop: nil-safe. */
export function edgeIsLoop(edge) {
  return edge != null && edge.From === edge.To;
}
