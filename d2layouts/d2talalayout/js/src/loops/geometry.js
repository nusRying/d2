// Pinned Go: internal/loops/geometry.go.

/** nonNilEquals reports whether both points exist and are value-equal (Go ==). */
export function nonNilEquals(first, second) {
  return first != null && second != null && first.X === second.X && first.Y === second.Y;
}
