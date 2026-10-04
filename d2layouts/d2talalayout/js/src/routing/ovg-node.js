// Slice 47 — OVG nodes.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_node.go
//
// Representation notes:
//   - Go embeds *geo.Point; OVGNode keeps the same shared `Point` object and
//     exposes X/Y accessors that read and write through it (mutating
//     `node.Point.X` and `node.X` are the same operation, as in Go).
//   - `Edges` is always an array (Go's nil slice → []).
//   - `IsNearPort` is null until flagged (Go nil map), then a Set of owners.
//   - `portOwnersByNode` is null until the first port owner (Go nil map), then
//     a Map<layoutgraph.Node, OVGPortMetadata>. portOwners() returns a shared
//     empty Map for nil so callers can iterate and read `.size`; it must not be
//     mutated. Map iteration is insertion order (Go's is unspecified).
//   - portDirectionSet is a uint16 bitmask Number. Its Go methods are free
//     functions: portDirectionSetHas, portDirectionSetAny,
//     portDirectionSetTransformed.
//   - OVGPortMetadata is a Go value type; reads return copies.

import { Orientation } from '../geometry/orientation.js';
import { euclideanDistance } from '../geometry/math.js';

const EMPTY_PORT_OWNERS = new Map();

/** ovgPortMetadata (value type). */
export class OVGPortMetadata {
  constructor(directions = 0, isCenterPort = false) {
    this.directions = directions;
    this.isCenterPort = isCenterPort;
  }

  copy() {
    return new OVGPortMetadata(this.directions, this.isCenterPort);
  }
}

/** newPortDirectionSet: one bit per orientation; invalid orientations are empty. */
export function newPortDirectionSet(direction) {
  if (!(direction >= Orientation.TopLeft) || direction > Orientation.NONE) {
    return 0;
  }
  return 1 << direction;
}

/** portDirectionSet.has */
export function portDirectionSetHas(directions, direction) {
  return (directions & newPortDirectionSet(direction)) !== 0;
}

/**
 * portDirectionSet.any reports whether predicate accepts at least one
 * represented direction. Empty metadata is unrestricted and behaves like NONE.
 */
export function portDirectionSetAny(directions, predicate) {
  if (directions === 0) {
    return predicate(Orientation.NONE);
  }
  for (let direction = Orientation.TopLeft; direction <= Orientation.NONE; direction++) {
    if (portDirectionSetHas(directions, direction) && predicate(direction)) {
      return true;
    }
  }
  return false;
}

/** portDirectionSet.transformed */
export function portDirectionSetTransformed(directions, transform) {
  let transformed = 0;
  portDirectionSetAny(directions, (direction) => {
    transformed |= newPortDirectionSet(transform(direction));
    return false;
  });
  return transformed;
}

export class OVGNode {
  constructor(point = null) {
    this.Point = point;
    this.Edges = [];
    this.IsNearPort = null;
    this.portOwnersByNode = null;
    this.Container = null;
    this.Index = 0;
    this.IsNodeCenter = false;
    this.IsTunnel = false;
  }

  get X() {
    return this.Point.X;
  }

  set X(value) {
    this.Point.X = value;
  }

  get Y() {
    return this.Point.Y;
  }

  set Y(value) {
    this.Point.Y = value;
  }

  ensurePortOwners() {
    if (this.portOwnersByNode == null) {
      this.portOwnersByNode = new Map();
    }
  }

  addPortMetadata(owner, added) {
    if (owner == null) {
      return;
    }
    this.ensurePortOwners();
    const metadata = this.portOwnersByNode.get(owner);
    const directions = (metadata === undefined ? 0 : metadata.directions) | added.directions;
    const isCenterPort = (metadata === undefined ? false : metadata.isCenterPort) || added.isCenterPort;
    this.portOwnersByNode.set(owner, new OVGPortMetadata(directions, isCenterPort));
  }

  addPortOwner(owner, direction, isCenterPort) {
    this.addPortMetadata(owner, new OVGPortMetadata(newPortDirectionSet(direction), isCenterPort));
  }

  setCenterPort(owner) {
    const [metadata, ok] = this.portMetadataFor(owner);
    if (!ok) {
      return;
    }
    metadata.isCenterPort = true;
    this.addPortMetadata(owner, metadata);
  }

  /** → [OVGPortMetadata copy (zero value when absent), ok] */
  portMetadataFor(owner) {
    const metadata = this.portOwnersByNode == null ? undefined : this.portOwnersByNode.get(owner);
    if (metadata === undefined) {
      return [new OVGPortMetadata(), false];
    }
    return [metadata.copy(), true];
  }

  isPort() {
    return this.portOwnersByNode != null && this.portOwnersByNode.size > 0;
  }

  isPortOf(owner) {
    return this.portOwnersByNode != null && this.portOwnersByNode.has(owner);
  }

  /** → [portDirectionSet, ok] */
  portDirectionsFor(owner) {
    const [metadata, ok] = this.portMetadataFor(owner);
    return [metadata.directions, ok];
  }

  hasPortDirection(owner, direction) {
    const [directions, ok] = this.portDirectionsFor(owner);
    return ok && portDirectionSetHas(directions, direction);
  }

  portDirectionsForObstacle(owner) {
    const [directions] = this.portDirectionsFor(owner);
    return directions;
  }

  setPortDirections(owner, directions) {
    const [metadata, ok] = this.portMetadataFor(owner);
    if (!ok) {
      return;
    }
    this.ensurePortOwners();
    metadata.directions = directions;
    this.portOwnersByNode.set(owner, metadata);
  }

  isCenterPortOf(owner) {
    const [metadata, ok] = this.portMetadataFor(owner);
    return ok && metadata.isCenterPort;
  }

  /** Map<Node, OVGPortMetadata>; a shared empty Map for Go's nil map. */
  portOwners() {
    return this.portOwnersByNode ?? EMPTY_PORT_OWNERS;
  }

  sharesPortOwner(other) {
    if (other == null) {
      return false;
    }
    for (const owner of this.portOwners().keys()) {
      if (other.isPortOf(owner)) {
        return true;
      }
    }
    return false;
  }

  addEdge(e) {
    this.Edges.push(e);
  }

  adjacent(e) {
    if (this === e.From) {
      return e.To;
    }
    return e.From;
  }

  Adjacent(edge) {
    return this.adjacent(edge);
  }

  /**
   * hasUnobstructedLineToPorts checks whether this OVG node has unobstructed
   * lines to ports of `numNodes` distinct graph nodes (or is not aligned with
   * any port). Throws the guard's error.
   */
  hasUnobstructedLineToPorts(ovg, portIndex, numNodes, guard) {
    guard.check();
    let distinctPortNodeCount = 0;

    const aligned = portIndex.alignedOwners(this.X, this.Y);
    const hasAlignedPort = aligned.byX.length > 0 || aligned.byY.length > 0;
    for (;;) {
      const [ownerIndex, ok] = aligned.next(guard);
      if (!ok) {
        break;
      }
      const gNode = portIndex.owners[ownerIndex];
      const portNodes = ovg.Ports.get(gNode) ?? [];
      for (const portNode of portNodes) {
        guard.step();
        if (portNode.X !== this.X && portNode.Y !== this.Y) {
          continue;
        }
        // Ports on a straight line through their own shape's edge and the
        // point are not candidates for an unobstructed path.
        if (portNode.X === this.X && ((portNode.X === gNode.TopLeft.X) || (portNode.X === gNode.TopLeft.X + gNode.Width))) {
          continue;
        }
        if (portNode.Y === this.Y && ((portNode.Y === gNode.TopLeft.Y) || (portNode.Y === gNode.TopLeft.Y + gNode.Height))) {
          continue;
        }

        let hasDirectLineToThisPort = true;
        let blockers = portIndex.horizontalBlockers.get(portNode.Y);
        if (portNode.X === this.X) {
          blockers = portIndex.verticalBlockers.get(portNode.X);
        }
        for (const otherGNode of blockers ?? []) {
          guard.step();
          if (gNode === otherGNode) {
            continue;
          }
          if (gNode.IsInvisible) {
            continue;
          }
          // nodes of the same sequence do not block each other
          if (gNode.Sequence != null && otherGNode.Sequence != null && gNode.Sequence === otherGNode.Sequence) {
            continue;
          }
          if (otherGNode.PassesThrough(portNode.Point, this.Point)) {
            hasDirectLineToThisPort = false;
            break;
          }
        }

        if (hasDirectLineToThisPort) {
          distinctPortNodeCount++;
          if (distinctPortNodeCount === numNodes) {
            return true;
          }
          break;
        }
      }
    }

    guard.check();
    return !hasAlignedPort;
  }

  distanceToBoundary(nodeB) {
    const x1 = this.Point.X;
    const y1 = this.Point.Y;

    const x2 = nodeB.TopLeft.X;
    const y2 = nodeB.TopLeft.Y;
    const x2b = nodeB.TopLeft.X + nodeB.Width;
    const y2b = nodeB.TopLeft.Y + nodeB.Height;

    const left = x2b < x1;
    const right = x1 < x2;
    const top = y2b < y1;
    const bottom = y1 < y2;

    if (top && left) {
      return euclideanDistance(x1, y1, x2b, y2b);
    } else if (left && bottom) {
      return euclideanDistance(x1, y1, x2b, y2);
    } else if (bottom && right) {
      return euclideanDistance(x1, y1, x2, y2);
    } else if (right && top) {
      return euclideanDistance(x1, y1, x2, y2b);
    } else if (left) {
      return x1 - x2b;
    } else if (right) {
      return x2 - x1;
    } else if (bottom) {
      return y2 - y1;
    } else if (top) {
      return y1 - y2b;
    }
    return 0;
  }
}

export function NewOVGNode(p) {
  return new OVGNode(p);
}
