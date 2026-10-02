import { WorkCanceledError } from "../limits/work-guard.js";
import {
  Orientation,
  orientationToString,
  isHorizontal,
  isVertical,
  getOpposite,
} from "../geometry/orientation.js";
import { HerdAssignment } from "../graph/herd-assignment.js";
import { sortNodesByID } from "../graph/node.js";
import { ClusterArrangement } from "../graph/cluster.js";

/**
 * GroupSheep groups root's children by their external uncle and records the
 * cousin connections that define each group.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} graph
 * @param {import("../graph/node.js").Node} root
 * @param {Array<import("../graph/edge-abduction.js").EdgeAbduction>} abductions
 * @returns {{ byUncle: Map<import("../graph/node.js").Node, import("../graph/node.js").Node[]>, toCousin: Map<import("../graph/node.js").Node, Map<import("../graph/node.js").Node, import("../graph/node.js").Node[]>> }}
 */
export function groupSheep(context, graph, root, abductions) {
  const byUncle = new Map();
  const toCousin = new Map();
  const sourceAbductions = abductions ?? [];
  const used = new Array(sourceAbductions.length).fill(false);
  const children = graph.Containers?.get(root) ?? [];

  for (const node of children) {
    checkAssignHerdsCancellation(context);

    for (let i = 0; i < sourceAbductions.length; i++) {
      checkAssignHerdsCancellation(context);

      if (used[i]) {
        continue;
      }

      const abduction = sourceAbductions[i];
      if (abduction == null) {
        throw new Error(
          "layout invariant violated: herding has a nil edge abduction"
        );
      }

      const from = groupVessel(abduction.OriginallyFrom);
      const to = groupVessel(abduction.OriginallyTo);
      let cousin = null;
      let current = null;

      if (abduction.OriginallyTo != null && (from === node || descendantOf(from, node))) {
        if (abduction.CurrentTo != null && !abduction.CurrentTo.isContainer) {
          continue;
        }
        if (to == null || to.OwningContainer() == null) {
          continue;
        }
        cousin = to;
        current = abduction.CurrentTo;
      } else if (abduction.OriginallyFrom != null && (to === node || descendantOf(to, node))) {
        if (abduction.CurrentFrom != null && !abduction.CurrentFrom.isContainer) {
          continue;
        }
        if (from == null || from.OwningContainer() == null) {
          continue;
        }
        cousin = from;
        current = abduction.CurrentFrom;
      }

      if (cousin == null) {
        continue;
      }

      used[i] = true;

      while (cousin.OwningContainer() !== current) {
        if (cousin.Cluster != null) {
          cousin = cousin.Cluster.Vessel;
        } else if (cousin.Sequence != null) {
          cousin = cousin.Sequence.Vessel;
        } else {
          cousin = cousin.OwningContainer();
        }
      }

      const uncle = cousin.OwningContainer();
      if (uncle == null || !uncle.isContainer) {
        continue;
      }

      if (!toCousin.has(uncle)) {
        toCousin.set(uncle, new Map());
      }
      const uncleCousins = toCousin.get(uncle);
      if (!uncleCousins.has(node)) {
        uncleCousins.set(node, []);
        if (!byUncle.has(uncle)) {
          byUncle.set(uncle, []);
        }
        byUncle.get(uncle).push(node);
      }
      uncleCousins.get(node).push(cousin);
    }
  }

  return {
    byUncle,
    toCousin,
  };
}

export const GroupSheep = groupSheep;

function checkAssignHerdsCancellation(context) {
  const isCancelled =
    typeof context.isCancelled === "function"
      ? context.isCancelled()
      : Boolean(context.aborted);
  if (isCancelled) {
    throw new WorkCanceledError("AssignHerds");
  }
}

function groupVessel(node) {
  if (node == null) {
    return null;
  }
  if (node.Cluster != null) {
    return node.Cluster.Vessel;
  }
  if (node.Sequence != null) {
    return node.Sequence.Vessel;
  }
  return node;
}

function descendantOf(node, ancestor) {
  while (node != null) {
    if (node === ancestor) {
      return true;
    }
    if (node.Container != null) {
      node = node.Container;
    } else if (node.Cluster != null) {
      node = node.Cluster.Vessel;
    } else if (node.Sequence != null) {
      node = node.Sequence.Vessel;
    } else {
      node = null;
    }
  }
  return ancestor == null;
}

/**
 * CanUseBothSides reports whether node is long enough perpendicular to
 * orientation to host herd members on both parallel sides.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {import("../graph/node.js").Node} node
 * @param {number} orientation
 * @returns {boolean}
 */
export function canUseBothSides(node, orientation) {
  const isWide = node.Width >= 2 * node.Height;
  const isTall = node.Height >= 2 * node.Width;

  return (
    (
      orientation === Orientation.Top ||
      orientation === Orientation.Bottom
    ) && isWide
  ) || (
    (
      orientation === Orientation.Left ||
      orientation === Orientation.Right
    ) && isTall
  );
}

export const CanUseBothSides = canUseBothSides;

/**
 * ApplyVirally propagates each known herd orientation through its ordered groups.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {any} context
 * @param {Array<import("../graph/node.js").Node>} herdOrder
 * @param {Map<import("../graph/node.js").Node, Array<import("../graph/node.js").Node>>} herds
 */
export function applyVirally(context, herdOrder, herds) {
  const orderedHerds = herdOrder ?? [];

  for (;;) {
    checkAssignHerdsCancellation(context);

    let end = true;

    for (const uncle of orderedHerds) {
      checkAssignHerdsCancellation(context);

      const nodes =
        herds == null
          ? []
          : (herds.get ? (herds.get(uncle) ?? []) : (herds[uncle] ?? []));

      let assignment = null;

      for (const node of nodes) {
        if (
          node.HerdAssignment != null &&
          node.HerdAssignment.Orientation !== Orientation.NONE
        ) {
          assignment = node.HerdAssignment;
          break;
        }
      }

      if (assignment != null) {
        for (const node of nodes) {
          if (node.HerdAssignment == null) {
            end = false;
            node.HerdAssignment = assignment.Copy();
          } else if (
            node.HerdAssignment.Orientation !== Orientation.NONE &&
            node.HerdAssignment.Orientation !== assignment.Orientation
          ) {
            throw new Error(
              "layout invariant violated: node " +
                node.DebugID() +
                " has herd orientation " +
                orientationToString(node.HerdAssignment.Orientation) +
                "; expected " +
                orientationToString(assignment.Orientation)
            );
          }
        }
      }
    }

    if (end) {
      return;
    }
  }
}

export const ApplyVirally = applyVirally;

function herdNodes(herds, uncle) {
  if (herds == null) {
    return [];
  }
  return herds.get(uncle) ?? [];
}

/**
 * connectedHerds joins groups that share a node, retaining deterministic order.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {any} context
 * @param {Array<import("../graph/node.js").Node>} herdOrder
 * @param {Map<import("../graph/node.js").Node, Array<import("../graph/node.js").Node>>} herds
 * @returns {Array<{ nodes: Array<import("../graph/node.js").Node>|null, uncles: Array<import("../graph/node.js").Node> }>|null}
 */
export function connectedHerds(context, herdOrder, herds) {
  const order = herdOrder ?? [];

  const byNode = new Map();

  for (const uncle of order) {
    const nodes = herdNodes(herds, uncle);

    for (const node of nodes) {
      let related = byNode.get(node);
      if (related == null) {
        related = [];
        byNode.set(node, related);
      }
      related.push(uncle);
    }
  }

  const seenUncles = new Set();
  const seenNodes = new Set();

  let components = null;

  for (const uncle of order) {
    if (seenUncles.has(uncle)) {
      continue;
    }

    const component = {
      nodes: null,
      uncles: [uncle],
    };

    seenUncles.add(uncle);

    for (let i = 0; i < component.uncles.length; i++) {
      checkAssignHerdsCancellation(context);

      const nodes = herdNodes(herds, component.uncles[i]);

      for (const node of nodes) {
        if (seenNodes.has(node)) {
          continue;
        }

        seenNodes.add(node);

        if (component.nodes == null) {
          component.nodes = [];
        }
        component.nodes.push(node);

        const relatedUncles = byNode.get(node) ?? [];
        for (const related of relatedUncles) {
          if (!seenUncles.has(related)) {
            seenUncles.add(related);
            component.uncles.push(related);
          }
        }
      }
    }

    if (components == null) {
      components = [];
    }
    components.push(component);
  }

  return components;
}

/**
 * assignHerds chooses a shared container side for siblings whose external
 * cousins should remain mutually accessible during placement.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {any} context
 * @param {import("../graph/graph.js").Graph} graph
 * @param {import("../graph/node.js").Node} root
 * @param {Array<import("../graph/edge-abduction.js").EdgeAbduction>} abductions
 */
export function assignHerds(context, graph, root, abductions) {
  checkAssignHerdsCancellation(context);

  const { byUncle: grouped, toCousin: cousins } = groupSheep(
    context,
    graph,
    root,
    abductions
  );

  const uncleOrder = [];

  for (const [uncle, nodes] of grouped) {
    if (nodes.length <= 1) {
      grouped.delete(uncle);
      cousins.delete(uncle);
    } else {
      uncleOrder.push(uncle);
    }
  }

  sortNodesByID(uncleOrder);

  const components = connectedHerds(context, uncleOrder, grouped);

  let unbiasedSide = 0;

  for (const component of components ?? []) {
    let sides = [
      Orientation.Top,
      Orientation.Right,
      Orientation.Bottom,
      Orientation.Left,
    ];

    let preferred = Orientation.NONE;

    for (const uncle of component.uncles) {
      checkAssignHerdsCancellation(context);

      const children = graph.Containers?.get(uncle) ?? [];

      if (children.length === 0) {
        throw new Error(
          "layout invariant violated: herding uncle " +
            uncle.DebugID() +
            " has no children"
        );
      }

      if (children[0].TopLeft == null) {
        continue;
      }

      const nodes = grouped.get(uncle) ?? [];
      const uncleCousins = cousins.get(uncle);

      for (const node of nodes) {
        for (const cousin of (uncleCousins?.get(node) ?? [])) {
          const assignment = cousin.HerdAssignment;

          if (assignment == null) {
            continue;
          }

          const orientation = assignment.Orientation;

          if (!isHorizontal(orientation) && !isVertical(orientation)) {
            throw new Error(
              "layout invariant violated: cousin " +
                cousin.DebugID() +
                " has an invalid herd orientation"
            );
          }

          const bothSides = canUseBothSides(uncle, orientation);
          const opposite = getOpposite(orientation);

          sides = sides.filter(
            (side) =>
              side === opposite || (bothSides && side === orientation)
          );

          if (preferred === Orientation.NONE) {
            preferred = opposite;

            if (
              bothSides &&
              assignment.SameSidePairCount() <
                assignment.OppositeSidePairCount()
            ) {
              preferred = orientation;
            }
          }
        }
      }
    }

    if (sides.length === 0) {
      for (const node of component.nodes ?? []) {
        node.HerdAssignment = null;
      }
      continue;
    }

    if (preferred === Orientation.NONE) {
      preferred = sides[unbiasedSide % sides.length];
      unbiasedSide++;
    } else if (!sides.includes(preferred)) {
      preferred = sides[0];
    }

    for (const node of component.nodes ?? []) {
      node.HerdAssignment = new HerdAssignment();
      node.HerdAssignment.Orientation = preferred;
    }

    for (const uncle of component.uncles) {
      const children = graph.Containers?.get(uncle) ?? [];

      if (children[0].TopLeft == null) {
        continue;
      }

      for (const node of (grouped.get(uncle) ?? [])) {
        for (const cousin of (cousins.get(uncle)?.get(node) ?? [])) {
          if (cousin.HerdAssignment == null) {
            continue;
          }

          if (preferred === cousin.HerdAssignment.Orientation) {
            node.HerdAssignment.PairSameSide(uncle);
            cousin.HerdAssignment.PairSameSide(uncle);
          } else {
            node.HerdAssignment.PairOppositeSide(uncle);
            cousin.HerdAssignment.PairOppositeSide(uncle);
          }
        }
      }
    }
  }

  applyVirally(context, uncleOrder, grouped);

  for (const uncle of uncleOrder) {
    for (const node of (grouped.get(uncle) ?? [])) {
      if (node.HerdAssignment != null && node.isClusterVessel) {
        const cluster = graph.Clusters.get(node);

        if (
          (node.HerdAssignment.Orientation === Orientation.Top ||
            node.HerdAssignment.Orientation === Orientation.Bottom) &&
          cluster.Arrangement === ClusterArrangement.Column
        ) {
          cluster.Arrangement = ClusterArrangement.Row;
        } else if (
          (node.HerdAssignment.Orientation === Orientation.Left ||
            node.HerdAssignment.Orientation === Orientation.Right) &&
          cluster.Arrangement === ClusterArrangement.Row
        ) {
          cluster.Arrangement = ClusterArrangement.Column;
        }
      }
    }
  }
}

export const AssignHerds = assignHerds;

/**
 * syncHerdFences updates the coordinate constraint for every assigned herd to
 * the current graph boundary.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/proximity/herding.go
 *
 * @param {import("../graph/graph.js").Graph} graph
 */
export function syncHerdFences(graph) {
  const [topLeft, bottomRight] = graph.BoundingBox();

  for (const node of graph.Nodes) {
    if (node.HerdAssignment == null || node.FixedTopLeft != null) {
      continue;
    }

    switch (node.HerdAssignment.Orientation) {
      case Orientation.Top:
        node.HerdAssignment.Val = topLeft.Y;
        break;

      case Orientation.Bottom:
        node.HerdAssignment.Val = bottomRight.Y;
        break;

      case Orientation.Left:
        node.HerdAssignment.Val = topLeft.X;
        break;

      case Orientation.Right:
        node.HerdAssignment.Val = bottomRight.X;
        break;
    }
  }
}

export const SyncHerdFences = syncHerdFences;
