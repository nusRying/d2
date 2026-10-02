import { expect, describe, it } from 'bun:test'
import { Node } from '../../src/index.js'
import { Orientation } from '../../src/geometry/orientation.js'
import { canUseBothSides, CanUseBothSides } from '../../src/proximity/index.js'

describe('CanUseBothSides Direct Unit Tests', () => {
  // 1. PascalCase alias identity
  it('1. exposes canUseBothSides and CanUseBothSides as identical function', () => {
    expect(CanUseBothSides).toBe(canUseBothSides)
    expect(typeof canUseBothSides).toBe('function')
  })

  // 2. Top wide behavior
  it('2. returns true for Orientation.Top when node is wide (Width >= 2 * Height)', () => {
    const node = new Node(1, 40, 15)
    expect(canUseBothSides(node, Orientation.Top)).toBe(true)
  })

  // 3. Bottom wide behavior
  it('3. returns true for Orientation.Bottom when node is wide (Width >= 2 * Height)', () => {
    const node = new Node(1, 40, 15)
    expect(canUseBothSides(node, Orientation.Bottom)).toBe(true)
  })

  // 4. Left tall behavior
  it('4. returns true for Orientation.Left when node is tall (Height >= 2 * Width)', () => {
    const node = new Node(1, 15, 40)
    expect(canUseBothSides(node, Orientation.Left)).toBe(true)
  })

  // 5. Right tall behavior
  it('5. returns true for Orientation.Right when node is tall (Height >= 2 * Width)', () => {
    const node = new Node(1, 15, 40)
    expect(canUseBothSides(node, Orientation.Right)).toBe(true)
  })

  // 6. wide does not imply Left/Right
  it('6. wide node returns false for Left and Right', () => {
    const node = new Node(1, 40, 10)
    expect(canUseBothSides(node, Orientation.Left)).toBe(false)
    expect(canUseBothSides(node, Orientation.Right)).toBe(false)
  })

  // 7. tall does not imply Top/Bottom
  it('7. tall node returns false for Top and Bottom', () => {
    const node = new Node(1, 10, 40)
    expect(canUseBothSides(node, Orientation.Top)).toBe(false)
    expect(canUseBothSides(node, Orientation.Bottom)).toBe(false)
  })

  // 8. exact 2:1 threshold inclusive
  it('8. exactly 2:1 ratio (Width == 2 * Height) is inclusive and counts as wide', () => {
    const node = new Node(1, 20, 10)
    expect(canUseBothSides(node, Orientation.Top)).toBe(true)
    expect(canUseBothSides(node, Orientation.Bottom)).toBe(true)
    expect(canUseBothSides(node, Orientation.Left)).toBe(false)
    expect(canUseBothSides(node, Orientation.Right)).toBe(false)
  })

  // 9. exact 1:2 threshold inclusive
  it('9. exactly 1:2 ratio (Height == 2 * Width) is inclusive and counts as tall', () => {
    const node = new Node(1, 10, 20)
    expect(canUseBothSides(node, Orientation.Top)).toBe(false)
    expect(canUseBothSides(node, Orientation.Bottom)).toBe(false)
    expect(canUseBothSides(node, Orientation.Left)).toBe(true)
    expect(canUseBothSides(node, Orientation.Right)).toBe(true)
  })

  // 10. diagonal orientations false
  it('10. diagonal orientations (TopLeft, TopRight, BottomLeft, BottomRight) return false', () => {
    const wide = new Node(1, 100, 10)
    const tall = new Node(2, 10, 100)

    for (const diag of [
      Orientation.TopLeft,
      Orientation.TopRight,
      Orientation.BottomLeft,
      Orientation.BottomRight,
    ]) {
      expect(canUseBothSides(wide, diag)).toBe(false)
      expect(canUseBothSides(tall, diag)).toBe(false)
    }
  })

  // 11. NONE false
  it('11. Orientation.NONE returns false regardless of aspect ratio', () => {
    const wide = new Node(1, 100, 10)
    const tall = new Node(2, 10, 100)
    const square = new Node(3, 50, 50)
    expect(canUseBothSides(wide, Orientation.NONE)).toBe(false)
    expect(canUseBothSides(tall, Orientation.NONE)).toBe(false)
    expect(canUseBothSides(square, Orientation.NONE)).toBe(false)
  })

  // 12. zero-by-zero oddity
  it('12. preserves zero-by-zero 0 >= 0 arithmetic (true for cardinals, false for non-cardinals)', () => {
    const zero = new Node(1, 0, 0)
    expect(canUseBothSides(zero, Orientation.Top)).toBe(true)
    expect(canUseBothSides(zero, Orientation.Bottom)).toBe(true)
    expect(canUseBothSides(zero, Orientation.Left)).toBe(true)
    expect(canUseBothSides(zero, Orientation.Right)).toBe(true)
    expect(canUseBothSides(zero, Orientation.TopLeft)).toBe(false)
    expect(canUseBothSides(zero, Orientation.NONE)).toBe(false)
  })

  // 13. function does not mutate dimensions
  it('13. does not mutate node dimensions or any node state', () => {
    const node = new Node(1, 30, 15)
    const w = node.Width
    const h = node.Height
    const top = canUseBothSides(node, Orientation.Top)
    expect(top).toBe(true)
    expect(node.Width).toBe(w)
    expect(node.Height).toBe(h)
  })

  // 14. nil node natural failure
  it('14. naturally throws TypeError when node is null or undefined without custom validation', () => {
    expect(() => canUseBothSides(null, Orientation.Top)).toThrow(TypeError)
    expect(() => canUseBothSides(undefined, Orientation.Top)).toThrow(TypeError)
  })

  // 15. fractional values are not rounded
  it('15. performs exact IEEE-754 floating-point comparison without rounding or tolerance', () => {
    const nodeJustUnder = new Node(1, 19.999999, 10)
    expect(canUseBothSides(nodeJustUnder, Orientation.Top)).toBe(false)

    const nodeJustOver = new Node(2, 20.000001, 10)
    expect(canUseBothSides(nodeJustOver, Orientation.Top)).toBe(true)

    const nodeExactFractional = new Node(3, 2.5, 1.25)
    expect(canUseBothSides(nodeExactFractional, Orientation.Top)).toBe(true)
    expect(canUseBothSides(nodeExactFractional, Orientation.Bottom)).toBe(true)
    expect(canUseBothSides(nodeExactFractional, Orientation.Left)).toBe(false)
    expect(canUseBothSides(nodeExactFractional, Orientation.Right)).toBe(false)
  })
})
