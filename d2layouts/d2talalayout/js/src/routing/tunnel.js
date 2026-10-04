// Slice 47 — tunnels between mutually visible nodes.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/tunnel.go
//
// Go multiple returns become arrays: tunnelRanges* → [ranges, visibleHorizontally]
// where `ranges` is null for Go's nil (not visible / blocked) and an array
// otherwise. buildTunnelsBetween/buildTunnels return arrays (Go nil → []).
// Errors are thrown. Graph map iteration (Clusters, NodeToTree) only builds
// sets, so its order is unobservable.

import { goMax, goMin } from '../geometry/go-math.js';
import { goRound } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { STEP_WEDGE_WIDTH } from '../shape/constants.js';
import { SEGMENT_SPACING_BUFFER } from './tuning.js';
import { OVGPortMetadata } from './ovg-node.js';

export class TunnelEntry {
  constructor(node = null, ovgNode = null) {
    this.Node = node;
    this.OVGNode = ovgNode;
  }
}

/**
 * NewTunnelEntry registers the owner as an unrestricted port of the entry
 * node so every production port uses the same per-owner metadata.
 */
export function NewTunnelEntry(node, ovgNode) {
  ovgNode.addPortMetadata(node, new OVGPortMetadata());
  return new TunnelEntry(node, ovgNode);
}

export class Tunnel {
  constructor(entryA = null, entryB = null) {
    this.EntryA = entryA;
    this.EntryB = entryB;
  }
}

export function NewTunnel(entryA, entryB) {
  return new Tunnel(entryA, entryB);
}

export class Range {
  constructor(start = 0, end = 0) {
    this.start = start;
    this.end = end;
  }

  length() {
    return this.end - this.start;
  }
}

/** → [ranges|null, visibleHorizontally] using an ovgBuildGuard. */
export function tunnelRangesBetween(g, nodeA, nodeB, filterOutShortTunnels, guard) {
  guard.check();
  return tunnelRangesBetweenChecked(g,
    nodeA,
    nodeB,
    filterOutShortTunnels,
    () => guard.step(),
    () => guard.check(),
    (descendant, ancestor) => guard.isDescendantOf(descendant, ancestor),
  );
}

/** → [ranges|null, visibleHorizontally] using a routeWorkGuard. */
export function tunnelRangesBetweenGuarded(g, nodeA, nodeB, filterOutShortTunnels, guard) {
  return tunnelRangesBetweenChecked(g,
    nodeA,
    nodeB,
    filterOutShortTunnels,
    () => guard.step(),
    () => guard.check(),
    (descendant, ancestor) => isDescendantOfWithRouteGuard(descendant, ancestor, guard),
  );
}

export function isDescendantOfWithRouteGuard(descendant, ancestor, guard) {
  for (let current = descendant; ;) {
    guard.step();
    if (ancestor === current) {
      return true;
    }
    if (current == null) {
      return false;
    }
    if (current.Container != null) {
      current = current.Container;
    } else if (current.Cluster != null) {
      current = current.Cluster.Vessel;
    } else if (current.Sequence != null) {
      current = current.Sequence.Vessel;
    } else {
      return ancestor == null;
    }
  }
}

/**
 * tunnelRangesBetweenChecked: step/check/isDescendant are callbacks that
 * throw the guard's error. → [ranges|null, visibleHorizontally]
 */
export function tunnelRangesBetweenChecked(g, nodeA, nodeB, filterOutShortTunnels, step, check, isDescendant) {
  step();
  const visibleHorizontally = nodeA.VisibilityGraphCandidate(true, false, true, nodeB, 0);
  if (!visibleHorizontally) {
    step();
    const visibleVertically = nodeA.VisibilityGraphCandidate(false, false, true, nodeB, 0);
    if (!visibleVertically) {
      return [null, false];
    }
  }

  let ranges;
  {
    let start;
    let end;
    if (visibleHorizontally) {
      start = goMax(nodeA.TopLeft.Y, nodeB.TopLeft.Y);
      end = goMin(nodeA.TopLeft.Y + nodeA.Height, nodeB.TopLeft.Y + nodeB.Height);
    } else {
      let nodeARight = nodeA.TopLeft.X + nodeA.Width;
      let nodeBRight = nodeB.TopLeft.X + nodeB.Width;

      // sequence nodes have shorter Top/Bottom ranges (except the last one)
      if (nodeA.Sequence != null && nodeA.Sequence.Last() !== nodeA) {
        nodeARight -= STEP_WEDGE_WIDTH;
      }
      if (nodeB.Sequence != null && nodeB.Sequence.Last() !== nodeB) {
        nodeBRight -= STEP_WEDGE_WIDTH;
      }

      start = goMax(nodeA.TopLeft.X, nodeB.TopLeft.X);
      end = goMin(nodeARight, nodeBRight);
    }
    step();
    ranges = [new Range(start, end)];
  }

  for (const otherN of g.Nodes) {
    step();
    if (otherN === nodeA || otherN === nodeB) {
      continue;
    }
    const otherBelowA = isDescendant(otherN, nodeA);
    const aBelowOther = isDescendant(nodeA, otherN);
    const otherBelowB = isDescendant(otherN, nodeB);
    const bBelowOther = isDescendant(nodeB, otherN);
    if (otherBelowA || aBelowOther || otherBelowB || bBelowOther) {
      continue;
    }

    // IsBlocked assumes an order, so both orders are tested
    if (otherN.IsBlocked(nodeA, nodeB, true, visibleHorizontally) || otherN.IsBlocked(nodeB, nodeA, true, visibleHorizontally)) {
      return [null, false];
    }
    // Skip nodes that are not in between
    if (visibleHorizontally) {
      if (!((nodeA.TopLeft.X < otherN.TopLeft.X && otherN.TopLeft.X < nodeB.TopLeft.X) ||
        (nodeB.TopLeft.X < otherN.TopLeft.X && otherN.TopLeft.X < nodeA.TopLeft.X))) {
        continue;
      }
    } else if (!((nodeA.TopLeft.Y < otherN.TopLeft.Y && otherN.TopLeft.Y < nodeB.TopLeft.Y) ||
      (nodeB.TopLeft.Y < otherN.TopLeft.Y && otherN.TopLeft.Y < nodeA.TopLeft.Y))) {
      continue;
    }

    const newRanges = [];
    // A partial obstruction (a) deletes, (b) splits, (c) shortens, or (d)
    // keeps each range.
    for (const r of ranges) {
      step();
      if (visibleHorizontally) {
        // (a)
        if (otherN.TopLeft.Y <= r.start && (otherN.TopLeft.Y + otherN.Height) >= r.end) {
          continue;
        }
        // (b)
        if (otherN.TopLeft.Y > r.start && (otherN.TopLeft.Y + otherN.Height) < r.end) {
          newRanges.push(
            new Range(r.start, otherN.TopLeft.Y),
            new Range(otherN.TopLeft.Y + otherN.Height, r.end),
          );
          continue;
        }
        // (c) obscures start
        if (otherN.TopLeft.Y <= r.start && (otherN.TopLeft.Y + otherN.Height) < r.end && (otherN.TopLeft.Y + otherN.Height) > r.start) {
          newRanges.push(new Range(otherN.TopLeft.Y + otherN.Height, r.end));
          continue;
        }
        // (c) obscures end
        if (otherN.TopLeft.Y > r.start && (otherN.TopLeft.Y + otherN.Height) >= r.end && otherN.TopLeft.Y < r.end) {
          newRanges.push(new Range(r.start, otherN.TopLeft.Y));
          continue;
        }

        // (d)
        newRanges.push(r);
      } else {
        if (otherN.TopLeft.X <= r.start && (otherN.TopLeft.X + otherN.Width) >= r.end) {
          continue;
        }
        if (otherN.TopLeft.X > r.start && (otherN.TopLeft.X + otherN.Width) < r.end) {
          newRanges.push(
            new Range(r.start, otherN.TopLeft.X),
            new Range(otherN.TopLeft.X + otherN.Width, r.end),
          );
          continue;
        }
        if (otherN.TopLeft.X <= r.start && (otherN.TopLeft.X + otherN.Width) < r.end && (otherN.TopLeft.X + otherN.Width) > r.start) {
          newRanges.push(new Range(otherN.TopLeft.X + otherN.Width, r.end));
          continue;
        }
        if (otherN.TopLeft.X > r.start && (otherN.TopLeft.X + otherN.Width) >= r.end && otherN.TopLeft.X < r.end) {
          newRanges.push(new Range(r.start, otherN.TopLeft.X));
          continue;
        }
        newRanges.push(r);
      }
    }
    ranges = [];
    check();
    // Drop ranges too short for even one tunnel
    for (const s of newRanges) {
      step();
      if (!filterOutShortTunnels || s.length() >= SEGMENT_SPACING_BUFFER) {
        ranges.push(s);
      }
    }
  }

  return [ranges, visibleHorizontally];
}

/** → Tunnel[] between nodeA and nodeB. */
export function buildTunnelsBetween(g, nodeA, nodeB, guard) {
  guard.check();
  const aBelowB = guard.isDescendantOf(nodeA, nodeB);
  const bBelowA = guard.isDescendantOf(nodeB, nodeA);
  if (aBelowB || bBelowA) {
    return [];
  }
  const [ranges, visibleHorizontally] = tunnelRangesBetween(g, nodeA, nodeB, true, guard);
  if (ranges == null) {
    return [];
  }

  let numEdgesToFit = 0.0;
  for (const otherE of nodeA.Edges) {
    guard.step();
    if (nodeA.Adjacent(otherE) === nodeB) {
      numEdgesToFit++;
    }
  }

  const tunnels = [];
  for (const r of ranges) {
    guard.step();
    if (visibleHorizontally) {
      const numTunnelsFit = goMin(Math.floor((r.end - r.start) / SEGMENT_SPACING_BUFFER), numEdgesToFit);

      for (let i = 1.0; i <= numTunnelsFit; i++) {
        guard.step();
        const val = goRound(r.start + i * (r.end - r.start) / (numTunnelsFit + 1));
        const nodeAEntry = guard.newDerivedNode(new Point(0, val));
        const nodeBEntry = guard.newDerivedNode(new Point(0, val));
        guard.step();
        const tunnel = NewTunnel(NewTunnelEntry(nodeA, nodeAEntry), NewTunnelEntry(nodeB, nodeBEntry));
        if (nodeA.TopLeft.X > nodeB.TopLeft.X) {
          tunnel.EntryA.OVGNode.Point.X = nodeA.TopLeft.X;
          tunnel.EntryB.OVGNode.Point.X = nodeB.TopLeft.X + nodeB.Width;
        } else {
          tunnel.EntryA.OVGNode.Point.X = nodeA.TopLeft.X + nodeA.Width;
          tunnel.EntryB.OVGNode.Point.X = nodeB.TopLeft.X;
        }
        tunnels.push(tunnel);
        numEdgesToFit--;
      }
    } else {
      const numTunnelsFit = goMin(Math.floor((r.end - r.start) / SEGMENT_SPACING_BUFFER), numEdgesToFit);

      for (let i = 1.0; i <= numTunnelsFit; i++) {
        guard.step();
        const val = goRound(r.start + i * (r.end - r.start) / (numTunnelsFit + 1));
        const nodeAEntry = guard.newDerivedNode(new Point(val, 0));
        const nodeBEntry = guard.newDerivedNode(new Point(val, 0));
        guard.step();
        const tunnel = NewTunnel(NewTunnelEntry(nodeA, nodeAEntry), NewTunnelEntry(nodeB, nodeBEntry));
        if (nodeA.TopLeft.Y > nodeB.TopLeft.Y) {
          tunnel.EntryA.OVGNode.Point.Y = nodeA.TopLeft.Y;
          tunnel.EntryB.OVGNode.Point.Y = nodeB.TopLeft.Y + nodeB.Height;
        } else {
          tunnel.EntryA.OVGNode.Point.Y = nodeA.TopLeft.Y + nodeA.Height;
          tunnel.EntryB.OVGNode.Point.Y = nodeB.TopLeft.Y;
        }
        tunnels.push(tunnel);
        numEdgesToFit--;
      }
    }
  }
  return tunnels;
}

/** → Tunnel[] for every connected pair of ordinary (non-tree, non-cluster, non-table) nodes. */
export function buildTunnels(g, guard) {
  guard.check();
  const out = [];
  const specialNodes = new Set();
  for (const c of g.Clusters?.values() ?? []) {
    guard.step();
    for (const cn of c.Nodes ?? []) {
      guard.step();
      specialNodes.add(cn);
    }
  }
  for (const n of g.NodeToTree?.keys() ?? []) {
    guard.step();
    specialNodes.add(n);
  }

  const searched = new Map();
  for (const n of g.Nodes) {
    guard.step();
    if (specialNodes.has(n)) {
      continue;
    }
    if (n.IsTable()) {
      // no tunnels for tables
      continue;
    }
    if (!searched.has(n)) {
      searched.set(n, new Map());
    }
    for (const e of n.Edges) {
      guard.step();
      const adj = n.Adjacent(e);
      if (adj === n) {
        continue;
      }
      if (specialNodes.has(adj)) {
        continue;
      }
      if (!searched.has(adj)) {
        searched.set(adj, new Map());
      }
      if (searched.get(n).has(adj)) {
        continue;
      }
      searched.get(n).set(adj, true);
      searched.get(adj).set(n, true);

      out.push(...buildTunnelsBetween(g, n, adj, guard));
    }
  }

  return out;
}
