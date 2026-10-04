// Slice 46 — packing pointer snapshots.
// Pinned reference: d2layouts/d2talalayout/internal/packing/snapshot.go
//
// Go's pointerSnapshot[T] records a pointer and a copy of its pointee;
// restore() writes the copy back through the same pointer and returns it, so
// object identity is preserved exactly. JS objects are references, so the
// snapshot captures the object's own enumerable fields shallowly (a Go struct
// value copy) and writes them back in place.

export class PointerSnapshot {
  constructor(pointer, value) {
    this.pointer = pointer;
    this.value = value;
  }

  restore() {
    if (this.pointer == null) {
      return null;
    }
    const target = this.pointer;
    for (const key of Object.keys(target)) {
      if (!Object.prototype.hasOwnProperty.call(this.value, key)) {
        delete target[key];
      }
    }
    Object.assign(target, this.value);
    return target;
  }
}

/** snapshotPointer (snapshot.go). The zero snapshot keeps a zero value. */
export function snapshotPointer(pointer, zeroValue = null) {
  if (pointer == null) {
    return new PointerSnapshot(null, zeroValue);
  }
  return new PointerSnapshot(pointer, { ...pointer });
}

/** snapshotPointer specialized to *geo.Point (zero value {X: 0, Y: 0}). */
export function snapshotPoint(point) {
  return snapshotPointer(point, { X: 0, Y: 0 });
}
