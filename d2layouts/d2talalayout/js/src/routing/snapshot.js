// Slice 47 — exact pointer, slice, and edge snapshots for route rollback.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/snapshot.go
//
// Go's pointerSnapshot[T] keeps the pointer and a copy of *pointer; restore
// writes the copy back through the same pointer. In JS the "pointer" is the
// object reference and the value is a shallow copy of its own enumerable
// fields, so restore reinstates every field of the same object.
//
// JS arrays have no spare capacity, so exactSliceSnapshot records exactly
// `length` elements (the same convention as graph/graph-state.js).
//
// Go pointers to scalars (Edge.D2ID *string, Edge.FromTableColumnIndex *int)
// are plain values on JS edges; restoring the edge's own fields restores them.

function ownFields(object) {
  const fields = {};
  for (const key of Object.keys(object)) {
    fields[key] = object[key];
  }
  return fields;
}

// *pointer = value: remove fields the struct did not have, then assign.
function assignFields(object, fields) {
  for (const key of Object.keys(object)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      delete object[key];
    }
  }
  Object.assign(object, fields);
}

/** pointerSnapshot[T]. */
export class PointerSnapshot {
  constructor(pointer = null, value = null) {
    this.pointer = pointer;
    this.value = value;
  }

  restore() {
    if (this.pointer == null) {
      return null;
    }
    assignFields(this.pointer, this.value);
    return this.pointer;
  }
}

/** snapshotPointer: a nil pointer snapshots to the zero snapshot. */
export function snapshotPointer(pointer) {
  if (pointer == null || typeof pointer !== 'object') {
    return new PointerSnapshot();
  }
  return new PointerSnapshot(pointer, ownFields(pointer));
}

/** exactSliceSnapshot[S, V]: the original array object and its contents. */
export class ExactSliceSnapshot {
  constructor(original = null, backing = []) {
    this.original = original;
    this.backing = backing;
  }

  restore() {
    if (this.original == null) {
      return null;
    }
    this.original.length = this.backing.length;
    for (let i = 0; i < this.backing.length; i++) {
      this.original[i] = this.backing[i];
    }
    return this.original;
  }
}

/**
 * edgeSnapshot: the whole edge value plus exact identities and contents of
 * its route array, every route point, and its labels. Edge.Style is a value
 * struct in Go, so its fields are captured as well.
 */
export class EdgeSnapshot {
  constructor({ value, style, points, pointValues, label, sourceArrowheadLabel, targetArrowheadLabel }) {
    this.value = value;
    this.style = style;
    this.points = points;
    this.pointValues = pointValues;
    this.label = label;
    this.sourceArrowheadLabel = sourceArrowheadLabel;
    this.targetArrowheadLabel = targetArrowheadLabel;
  }

  restore(edge) {
    this.label.restore();
    this.sourceArrowheadLabel.restore();
    this.targetArrowheadLabel.restore();
    for (const point of this.pointValues) {
      point.restore();
    }
    const originalPoints = this.points.restore();
    this.style.restore();

    // *edge = snapshot.value
    assignFields(edge, this.value);
    edge.Points = originalPoints;
    edge.Label = this.label.pointer;
    edge.SourceArrowheadLabel = this.sourceArrowheadLabel.pointer;
    edge.TargetArrowheadLabel = this.targetArrowheadLabel.pointer;
  }
}

/**
 * snapshotEdge builds an EdgeSnapshot. `backing` and `pointValues` are
 * supplied by the caller, which charges one unit of work per point.
 */
export function newEdgeSnapshot(edge, backing, pointValues) {
  return new EdgeSnapshot({
    value: ownFields(edge),
    style: snapshotPointer(edge.Style),
    points: new ExactSliceSnapshot(edge.Points, backing),
    pointValues,
    label: snapshotPointer(edge.Label),
    sourceArrowheadLabel: snapshotPointer(edge.SourceArrowheadLabel),
    targetArrowheadLabel: snapshotPointer(edge.TargetArrowheadLabel),
  });
}
