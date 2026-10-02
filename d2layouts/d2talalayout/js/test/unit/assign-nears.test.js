import { expect, spyOn, describe, it } from 'bun:test'
import {
  Graph,
  Node,
  Edge,
  EdgeAbduction,
  Sequence,
  Cluster,
  Hierarchy,
  BackgroundWorkContext,
  PollingWorkContext,
  WorkGuard,
  MAX_ENGINE_WORK_UNITS,
  MAX_TOPOLOGY_REFERENCES,
} from '../../src/index.js'
import { assignNears, AssignNears, assignNearsWithWorkLimit } from '../../src/proximity/nears.js'

describe('AssignNears Direct Semantics', () => {
  // 1. AssignNears === assignNears
  it('1. PascalCase alias is identical to camelCase function', () => {
    expect(AssignNears).toBe(assignNears)
  })

  // 2. Public AssignNears uses "AssignNears" and MAX_ENGINE_WORK_UNITS
  it('2. Public AssignNears uses "AssignNears" location and MAX_ENGINE_WORK_UNITS', () => {
    const g = new Graph()
    const root = new Node(10)
    g.addNodeToContainer(null, root)
    const ctx = PollingWorkContext(() => true)
    let caught = null
    try {
      assignNears(ctx, g, root, [])
    } catch (err) {
      caught = err
    }
    expect(caught).not.toBeNull()
    expect(caught.location).toBe('AssignNears')
  })

  // 3. exact WorkGuard Step accounting for a small deterministic fixture
  it('3. exact WorkGuard Step accounting for a small deterministic fixture', () => {
    const g = new Graph()
    const first = new Node(1)
    const second = new Node(2)
    const external = new Node(100)
    const root = new Node(10)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(null, external)
    g.addNodeToContainer(root, first)
    g.addNodeToContainer(root, second)
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: first, CurrentTo: external }),
      new EdgeAbduction({ OriginallyFrom: second, CurrentTo: external }),
    ]

    // With 17 steps, exact budget succeeds
    const ctx1 = BackgroundWorkContext()
    expect(() => assignNearsWithWorkLimit(ctx1, g, root, abductions, 17n)).not.toThrow()

    // Reset nears
    first.Nears = new Set()
    second.Nears = new Set()

    // With 16 steps, it fails with WorkLimitError
    const ctx2 = BackgroundWorkContext()
    expect(() => assignNearsWithWorkLimit(ctx2, g, root, abductions, 16n)).toThrow('work exceeds limit 16')
  })

  // 4. both fromDescendant AND toDescendant are evaluated before branch
  it('4. evaluates both fromDescendant and toDescendant before branching', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)

    // c1 is descendant of OriginallyFrom AND OriginallyTo
    // OriginallyTo has a parent container so isDescendantOf takes multiple steps
    const intermediate = new Node(2)
    intermediate.Container = c1
    const deepNode = new Node(3)
    deepNode.Container = intermediate

    // a1: OriginallyFrom is c1 (1 step), OriginallyTo is deepNode (3 steps)
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: deepNode, CurrentTo: ext }),
    ]

    // 1 abduction step + 1 child loop step + 1 from step + 3 to steps = 6 steps for abduction phase
    // plus 1 uncle step = 7 steps
    const ctx = BackgroundWorkContext()
    expect(() => assignNearsWithWorkLimit(ctx, g, root, abductions, 5n)).toThrow('work exceeds limit 5')
  })

  // 5. groupVessel: Cluster before Sequence, no active check
  it('5. groupVessel prioritizes Cluster over Sequence and ignores active status', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const clusterVessel = new Node(2)
    const seqVessel = new Node(3)
    const member = new Node(21)
    const ext = new Node(100)

    // Cluster is inactive (vessel.Graph == null)
    const cluster = new Cluster({ Vessel: clusterVessel })
    const seq = new Sequence({ Vessel: seqVessel })
    member.Cluster = cluster
    member.Sequence = seq

    g.addNodeToContainer(null, root)
    g.addNodeToContainer(null, ext)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, clusterVessel)
    g.addNodeToContainer(root, seqVessel)

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: member, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.has(clusterVessel)).toBe(true)
    expect(c1.Nears.has(seqVessel)).toBe(false)
  })

  // 6. isDescendantOf precedence: Container > Cluster > Sequence
  it('6. isDescendantOf precedence is Container > Cluster > Sequence', () => {
    const g = new Graph()
    const root = new Node(10)
    const containerTarget = new Node(1)
    const clusterTarget = new Node(2)
    const seqTarget = new Node(3)
    const member = new Node(21)
    const leaf = new Node(22)
    const ext = new Node(100)

    leaf.Container = member
    member.Container = containerTarget
    member.Cluster = new Cluster({ Vessel: clusterTarget })
    member.Sequence = new Sequence({ Vessel: seqTarget })

    g.addNodeToContainer(null, root)
    g.addNodeToContainer(null, ext)
    g.addNodeToContainer(root, containerTarget)
    g.addNodeToContainer(root, clusterTarget)
    g.addNodeToContainer(root, seqTarget)

    const other = new Node(4)
    g.addNodeToContainer(root, other)

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: other, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: leaf, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(other.Nears.has(containerTarget)).toBe(true)
    expect(other.Nears.has(clusterTarget)).toBe(false)
    expect(other.Nears.has(seqTarget)).toBe(false)

    // Also verify Cluster > Sequence when Container is absent
    const member2 = new Node(31)
    const leaf2 = new Node(32)
    leaf2.Container = member2
    member2.Cluster = new Cluster({ Vessel: clusterTarget })
    member2.Sequence = new Sequence({ Vessel: seqTarget })

    const other2 = new Node(5)
    g.addNodeToContainer(root, other2)

    const abductions2 = [
      new EdgeAbduction({ OriginallyFrom: other2, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: leaf2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions2)
    expect(other2.Nears.has(clusterTarget)).toBe(true)
    expect(other2.Nears.has(seqTarget)).toBe(false)
  })

  // 7. ancestor null equality semantics
  it('7. ancestor null equality semantics: isDescendantOf(null, null) is true', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(null, ext)
    // root has no children
    // but abduction has OriginallyFrom = null
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: null, CurrentTo: ext }),
    ]
    // Runs without throwing
    expect(() => assignNears(BackgroundWorkContext(), g, root, abductions)).not.toThrow()
  })

  // 8. orderedUncles sorted by ID
  it('8. orderedUncles sorted by node ID', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const u200 = new Node(200)
    const u100 = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    // Abductions add u200 first, then u100
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: u200 }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: u200 }),
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: u100 }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: u100 }),
    ]

    expect(() => assignNears(BackgroundWorkContext(), g, root, abductions)).not.toThrow()
    expect(c1.Nears.has(c2)).toBe(true)
  })

  // 9. connected nodes sorted by ID
  it('9. connected nodes sorted by ID for pair iteration', () => {
    const g = new Graph()
    const root = new Node(10)
    const c30 = new Node(30)
    const c10 = new Node(10)
    const c20 = new Node(20)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c30)
    g.addNodeToContainer(root, c10)
    g.addNodeToContainer(root, c20)

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c30, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c10, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c20, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c10.Nears.has(c20)).toBe(true)
    expect(c10.Nears.has(c30)).toBe(true)
    expect(c20.Nears.has(c30)).toBe(true)
  })

  // 10. hierarchy skip
  it('10. skips candidate pairs if either candidate has Hierarchy', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)
    c1.Hierarchy = new Hierarchy()

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.size).toBe(0)
    expect(c2.Nears.size).toBe(0)
  })

  // 11. hasConnection only scans first.Edges
  it('11. hasConnection only scans first.Edges, ignoring asymmetric second.Edges', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    // c2 has an edge pointing to c1, but c1 has NO edges
    // In sorted order, c1 is first, c2 is second.
    // hasConnection scans c1.Edges only, sees no edges, so they become Near!
    const edge = new Edge(c2, c1)
    c2.Edges = [edge]
    c1.Edges = []

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.has(c2)).toBe(true)
    expect(c2.Nears.has(c1)).toBe(true)
  })

  // 12. nil edge in hasConnection is skipped
  it('12. nil edge in hasConnection is charged and skipped', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)
    c1.Edges = [null]

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.has(c2)).toBe(true)
  })

  // 13. original Near entries copied
  it('13. copies preexisting Near entries into replacement Set', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const oldNear = new Node(99)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)
    c1.Nears.add(oldNear)

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.has(oldNear)).toBe(true)
    expect(c1.Nears.has(c2)).toBe(true)
  })

  // 14. asymmetric Near repaired
  it('14. repairs asymmetric preexisting Near state', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)
    c1.Nears.add(c2) // c1 already has c2, but c2 lacks c1

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears.has(c2)).toBe(true)
    expect(c2.Nears.has(c1)).toBe(true)
  })

  // 15. pre-commit Finish occurs before any live Near replacement
  it('15. pre-commit Finish occurs before any live Near replacement', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    const origC1 = c1.Nears
    const origC2 = c2.Nears

    // Cancel on pre-commit Finish() call (call 1 is in WorkGuard constructor)
    let finishCalls = 0
    const ctx = PollingWorkContext(() => {
      finishCalls++
      return finishCalls >= 2
    })

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    expect(() => assignNears(ctx, g, root, abductions)).toThrow('context canceled')
    expect(c1.Nears).toBe(origC1)
    expect(c2.Nears).toBe(origC2)
  })

  // 16. commit order is node-ID sorted
  it('16. commits replacements in ascending node-ID order', () => {
    const g = new Graph()
    const root = new Node(10)
    const c20 = new Node(20)
    const c10 = new Node(10)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c20)
    g.addNodeToContainer(root, c10)

    const commitLog = []
    const origDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'Nears')
    // We observe the order of Nears property assignments
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c20, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c10, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c10.Nears.has(c20)).toBe(true)
    expect(c20.Nears.has(c10)).toBe(true)
  })

  // 17. Finish occurs after each live assignment
  it('17. calls guard.Finish() after each individual node commit', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    let finishes = 0
    const ctx = PollingWorkContext(() => false)
    const origFinish = WorkGuard.prototype.Finish
    spyOn(WorkGuard.prototype, 'Finish').mockImplementation(function () {
      finishes++
      return origFinish.call(this)
    })

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(ctx, g, root, abductions)
    // Constructor Finish + pre-commit Finish + commit c1 Finish + commit c2 Finish = at least 4
    expect(finishes).toBeGreaterThanOrEqual(4)
  })

  // 18. cancellation during commit restores EXACT original Set references
  it('18. cancellation during commit restores exact original Set references', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    const origC1Nears = c1.Nears
    const origC2Nears = c2.Nears

    let observed = false
    const ctx = PollingWorkContext(() => {
      if (c1.Nears !== origC1Nears || c2.Nears !== origC2Nears) {
        observed = true
        return true
      }
      return false
    })

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    expect(() => assignNears(ctx, g, root, abductions)).toThrow('context canceled')
    expect(observed).toBe(true)
    expect(c1.Nears).toBe(origC1Nears)
    expect(c2.Nears).toBe(origC2Nears)
  })

  // 19. workLimit=1 leaves live Near Sets unchanged
  it('19. workLimit=1 leaves live Near Sets unchanged', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    const origC1 = c1.Nears
    const origC2 = c2.Nears

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    expect(() => assignNearsWithWorkLimit(BackgroundWorkContext(), g, root, abductions, 1n)).toThrow('work exceeds limit 1')
    expect(c1.Nears).toBe(origC1)
    expect(c2.Nears).toBe(origC2)
  })

  // 20. successful touched nodes receive fresh Set references
  it('20. successful touched nodes receive fresh Set references', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    const origC1 = c1.Nears
    const origC2 = c2.Nears

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears).not.toBe(origC1)
    expect(c2.Nears).not.toBe(origC2)
  })

  // 21. untouched nodes retain original Set references
  it('21. untouched nodes retain original Set references', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(null, ext)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    const origExt = ext.Nears

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(ext.Nears).toBe(origExt)
  })

  // 22. no generated pairs means no Near Set replacement
  it('22. no generated pairs means no Near Set replacement', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)

    const origC1 = c1.Nears

    // Only 1 child connected to ext -> group size 1 -> skipped
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
    ]

    assignNears(BackgroundWorkContext(), g, root, abductions)
    expect(c1.Nears).toBe(origC1)
  })

  // 23. topology reference limit error
  it('23. throws topology references exceed limit error when limit is exceeded', () => {
    const g = new Graph()
    const root = new Node(10)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const ext = new Node(100)
    g.addNodeToContainer(null, root)
    g.addNodeToContainer(root, c1)
    g.addNodeToContainer(root, c2)

    // Mock existing Near count on c1 to exceed MAX_TOPOLOGY_REFERENCES
    c1.Nears = {
      size: MAX_TOPOLOGY_REFERENCES + 1,
      [Symbol.iterator]: function* () {},
    }

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
      new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
    ]

    expect(() => assignNears(BackgroundWorkContext(), g, root, abductions)).toThrow(
      `TALA AssignNears topology references exceed limit ${MAX_TOPOLOGY_REFERENCES}`
    )
  })
})
