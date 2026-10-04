// Slice 47 — OVG edge set (Go ovgEdgeSet).
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_edge_set.go
//
// Keeps vertical and horizontal OVG edges bucketed by their axis coordinate,
// each bucket sorted by the edge's minimum coordinate, plus the sorted list of
// occupied axes. Entries are OVGEdge VALUE copies, as in Go.
//
// Representation:
//   horizontalEdges / verticalEdges — GoFloatMap<float64, OVGEdge[]>
//   horizontals / verticals         — sorted number[]
//   edges                           — OVGEdgeValueSet (Go map[OVGEdge]struct{}:
//                                     key = From pointer, To pointer, Distance
//                                     compared with ==, NaN never equal)
// Methods returning a Go error throw it instead; guards are Go workBudget
// objects (step/add/check that throw).

import { chargeSkippedRouteWork } from './route-guards.js';
import { intersects } from './geometry.js';
import { GoFloatMap, goSearch, goSearchFloat64s } from './ovg-go-support.js';

/** Go map[OVGEdge]struct{} with struct-value key equality. */
export class OVGEdgeValueSet {
  constructor() {
    this._byFrom = new Map();
    this._values = [];
  }

  get size() {
    return this._values.length;
  }

  has(edge) {
    const byTo = this._byFrom.get(edge.From);
    if (byTo === undefined) return false;
    const distances = byTo.get(edge.To);
    return distances !== undefined && distances.has(edge.Distance);
  }

  /** Inserts a value copy (no-op when an equal key exists). */
  add(edge) {
    if (this.has(edge)) return;
    let byTo = this._byFrom.get(edge.From);
    if (byTo === undefined) {
      byTo = new Map();
      this._byFrom.set(edge.From, byTo);
    }
    let distances = byTo.get(edge.To);
    if (distances === undefined) {
      distances = new GoFloatMap();
      byTo.set(edge.To, distances);
    }
    distances.set(edge.Distance, true);
    this._values.push(edge.copy());
  }

  /** Stored keys in insertion order (Go iteration order is unspecified). */
  values() {
    return this._values.values();
  }

  [Symbol.iterator]() {
    return this.values();
  }
}

export class OVGEdgeSet {
  constructor() {
    this.horizontalEdges = new GoFloatMap();
    this.verticalEdges = new GoFloatMap();
    this.horizontals = [];
    this.verticals = [];
    this.edges = new OVGEdgeValueSet();
  }

  /** insertSortedFloat64 inserts val into the sorted slice unless present. */
  insertSortedFloat64(slice, val) {
    const i = goSearchFloat64s(slice, val);
    if (i < slice.length && slice[i] === val) {
      return;
    }
    slice.splice(i, 0, val);
  }

  /** insertSortedEdge keeps edges ordered by their minimum coordinate. */
  insertSortedEdge(edges, edge, isVertical) {
    const getMinCoord = (e) => {
      if (isVertical) {
        if (e.From.Y < e.To.Y) {
          return e.From.Y;
        }
        return e.To.Y;
      }
      if (e.From.X < e.To.X) {
        return e.From.X;
      }
      return e.To.X;
    };

    const edgeMinCoord = getMinCoord(edge);
    const i = goSearch(edges.length, (j) => getMinCoord(edges[j]) >= edgeMinCoord);
    edges.splice(i, 0, edge);
  }

  add(edge) {
    if (this.edges.has(edge)) {
      return;
    }
    this.edges.add(edge);

    if (edge.isVertical()) {
      if (!this.verticalEdges.has(edge.From.X)) {
        this.verticalEdges.set(edge.From.X, []);
        this.insertSortedFloat64(this.verticals, edge.From.X);
      }
      const edges = this.verticalEdges.get(edge.From.X) ?? [];
      this.insertSortedEdge(edges, edge.copy(), true);
      this.verticalEdges.set(edge.From.X, edges);
    } else if (edge.isHorizontal()) {
      if (!this.horizontalEdges.has(edge.From.Y)) {
        this.horizontalEdges.set(edge.From.Y, []);
        this.insertSortedFloat64(this.horizontals, edge.From.Y);
      }
      const edges = this.horizontalEdges.get(edge.From.Y) ?? [];
      this.insertSortedEdge(edges, edge.copy(), false);
      this.horizontalEdges.set(edge.From.Y, edges);
    }
  }

  /**
   * addGuarded reserves every sorted-slice shift before mutating the set; the
   * duplicate lookup is accounted too, and a guard failure leaves the set
   * unchanged.
   */
  addGuarded(edge, guard) {
    guard.step();
    if (this.edges.has(edge)) {
      return;
    }
    if (edge.isVertical()) {
      if (!this.verticalEdges.has(edge.From.X)) {
        guard.add(this.verticals.length + 1);
      }
      guard.add((this.verticalEdges.get(edge.From.X)?.length ?? 0) + 1);
    } else if (edge.isHorizontal()) {
      if (!this.horizontalEdges.has(edge.From.Y)) {
        guard.add(this.horizontals.length + 1);
      }
      guard.add((this.horizontalEdges.get(edge.From.Y)?.length ?? 0) + 1);
    }
    this.add(edge);
    guard.check();
  }

  intersectsWithGuarded(edge, guard) {
    return this.intersectsWithChecked(edge, guard);
  }

  /** guard may be null (unaccounted query). */
  intersectsWithChecked(edge, guard) {
    const step = guard == null ? () => {} : () => guard.step();
    if (edge.isHorizontal()) {
      let minX = edge.From.X;
      let maxX = edge.To.X;
      if (maxX < minX) {
        [minX, maxX] = [maxX, minX];
      }

      // check for overlaps
      for (const e of this.horizontalEdges.get(edge.From.Y) ?? []) {
        step();
        if (e.From.X < e.To.X) {
          if (maxX <= e.From.X) {
            // ordered by minX: no following edge starts before this one
            break;
          }
          if (e.To.X <= minX) {
            continue;
          }
        } else {
          if (maxX <= e.To.X) {
            break;
          }
          if (e.From.X <= minX) {
            continue;
          }
        }
        if (!edge.sharePoints(e)) {
          return true;
        }
      }

      const y = edge.From.Y;
      // The axes are sorted: charge the skipped prefix, then begin geometry
      // checks at the first line that can cross this segment.
      const verticals = this.verticals;
      const start = goSearch(verticals.length, (i) => !(verticals[i] < minX));
      chargeSkippedRouteWork(guard, start);
      // check for crossings
      for (let index = start; index < verticals.length; index++) {
        const lineCoordinate = verticals[index];
        step();
        if (lineCoordinate < minX) {
          continue;
        }
        if (maxX < lineCoordinate) {
          break;
        }
        for (const e of this.verticalEdges.get(lineCoordinate) ?? []) {
          step();
          if (e.From.Y < e.To.Y) {
            if (y < e.From.Y) {
              break;
            }
            if (e.To.Y < y) {
              continue;
            }
          } else {
            if (y < e.To.Y) {
              break;
            }
            if (e.From.Y < y) {
              continue;
            }
          }
          if (!edge.sharePoints(e)) {
            return true;
          }
        }
      }
    } else if (edge.isVertical()) {
      let minY = edge.From.Y;
      let maxY = edge.To.Y;
      if (maxY < minY) {
        [minY, maxY] = [maxY, minY];
      }
      // check for overlaps
      for (const e of this.verticalEdges.get(edge.From.X) ?? []) {
        step();
        if (e.From.Y < e.To.Y) {
          if (maxY <= e.From.Y) {
            // ordered by minY: no following edge starts before this one
            break;
          }
          if (e.To.Y <= minY) {
            continue;
          }
        } else {
          if (maxY <= e.To.Y) {
            break;
          }
          if (e.From.Y <= minY) {
            continue;
          }
        }
        if (!edge.sharePoints(e)) {
          return true;
        }
      }

      const x = edge.From.X;
      const horizontals = this.horizontals;
      const start = goSearch(horizontals.length, (i) => !(horizontals[i] < minY));
      chargeSkippedRouteWork(guard, start);
      for (let index = start; index < horizontals.length; index++) {
        const lineCoordinate = horizontals[index];
        step();
        if (lineCoordinate < minY) {
          continue;
        }
        if (maxY < lineCoordinate) {
          break;
        }
        for (const e of this.horizontalEdges.get(lineCoordinate) ?? []) {
          step();
          if (e.From.X < e.To.X) {
            if (x < e.From.X) {
              break;
            }
            if (e.To.X < x) {
              continue;
            }
          } else {
            if (x < e.To.X) {
              break;
            }
            if (e.From.X < x) {
              continue;
            }
          }
          if (!edge.sharePoints(e)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  overlappingEdgesGuarded(edge, guard) {
    return this.overlappingEdgesChecked(edge, guard);
  }

  /**
   * Returns OVGEdge value copies overlapping `edge` (Go nil → []). guard may
   * be null.
   */
  overlappingEdgesChecked(edge, guard) {
    const overlapping = [];
    let maybeOverlap = null;
    if (edge.isVertical()) {
      maybeOverlap = this.verticalEdges.get(edge.From.X);
    } else if (edge.isHorizontal()) {
      maybeOverlap = this.horizontalEdges.get(edge.From.Y);
    }

    for (const e of maybeOverlap ?? []) {
      if (guard != null) {
        guard.step();
      }
      if (intersects(edge.From.Point, edge.To.Point, e.From.Point, e.To.Point)) {
        overlapping.push(e.copy());
      }
    }
    return overlapping;
  }
}

export function newOvgEdgeSet() {
  return new OVGEdgeSet();
}
