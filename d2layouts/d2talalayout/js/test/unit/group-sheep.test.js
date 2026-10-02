import { expect, describe, it, spyOn } from 'bun:test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import {
  Graph,
  Node,
  EdgeAbduction,
  Cluster,
  Sequence,
  BackgroundWorkContext,
  PollingWorkContext,
  WorkGuard,
  WorkCanceledError,
} from '../../src/index.js'
import { groupSheep, GroupSheep } from '../../src/proximity/index.js'

describe('GroupSheep Direct Semantics', () => {
  // 1. GroupSheep alias identity
  it('1. exposes groupSheep and GroupSheep as identical function', () => {
    expect(GroupSheep).toBe(groupSheep)
    expect(typeof groupSheep).toBe('function')
  })

  // 2. no WorkGuard construction
  it('2. does not construct or use WorkGuard', () => {
    let stepCalled = false
    const origStep = WorkGuard.prototype.Step
    const spy = spyOn(WorkGuard.prototype, 'Step').mockImplementation(function () {
      stepCalled = true
      return origStep.apply(this, arguments)
    })

    try {
      const g = new Graph()
      const root = new Node(0)
      const child = new Node(1)
      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle
      uncle.isContainer = true

      g.Containers = new Map([
        [root, [child]],
        [uncle, [cousin]],
      ])

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
      expect(res.byUncle).toBeInstanceOf(Map)
      expect(stepCalled).toBe(false)
    } finally {
      spy.mockRestore()
    }

    const source = readFileSync(
      fileURLToPath(new URL('../../src/proximity/herding.js', import.meta.url)),
      'utf8'
    )
    expect(source).not.toContain('new WorkGuard')
  })

  // 3. exact child cancellation check count
  it('3. checks cancellation exactly once per direct child when no abductions exist', () => {
    const g = new Graph()
    const root = new Node(0)
    const c1 = new Node(1)
    const c2 = new Node(2)
    const c3 = new Node(3)
    g.Containers = new Map([[root, [c1, c2, c3]]])

    let checks = 0
    const ctx = PollingWorkContext(() => {
      checks++
      return false
    })

    groupSheep(ctx, g, root, [])
    // 3 children, 0 abductions -> exactly 3 context cancellation checks
    expect(checks).toBe(3)
  })

  // 4. exact abduction cancellation check count
  it('4. checks cancellation for each child and for each abduction', () => {
    const g = new Graph()
    const root = new Node(0)
    const c1 = new Node(1)
    g.Containers = new Map([[root, [c1]]])

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: cousin, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: cousin, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    let checks = 0
    const ctx = PollingWorkContext(() => {
      checks++
      return false
    })

    groupSheep(ctx, g, root, abductions)
    // 1 child + 3 abductions = exactly 4 checks
    expect(checks).toBe(4)
  })

  // 5. cancellation occurs before used[i] skip
  it('5. cancellation check occurs before used[i] skip', () => {
    const g = new Graph()
    const root = new Node(0)
    const c1 = new Node(1)
    const c2 = new Node(2)
    g.Containers = new Map([[root, [c1, c2]]])

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    // Step 1: child 1
    // Step 2: abduction 0 (becomes used)
    // Step 3: child 2
    // Step 4: abduction 0 (already used!) -> cancellation check fires BEFORE used skip
    let count = 0
    const ctx = PollingWorkContext(() => {
      count++
      return count === 4
    })

    expect(() => groupSheep(ctx, g, root, abductions)).toThrow('AssignHerds: context canceled')
    expect(count).toBe(4)
  })

  // 6. groupVessel Cluster > Sequence
  it('6. groupVessel prioritizes Cluster over Sequence', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    const clusterVessel = new Node(4)
    const seqVessel = new Node(5)

    child.Cluster = new Cluster({ Vessel: clusterVessel, Nodes: [child] })
    child.Sequence = new Sequence({ Vessel: seqVessel, Nodes: [child] })
    clusterVessel.Container = root
    seqVessel.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [clusterVessel, seqVessel]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // clusterVessel is the one grouped under uncle, NOT seqVessel
    expect(res.byUncle.get(uncle)).toEqual([clusterVessel])
  })

  // 7. groupVessel ignores active state
  it('7. groupVessel resolves vessel even when Cluster is inactive', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    const vessel = new Node(4)
    vessel.Graph = null // Cluster is inactive!

    child.Cluster = new Cluster({ Vessel: vessel, Nodes: [child] })
    vessel.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [vessel]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // groupVessel still resolved to vessel
    expect(res.byUncle.get(uncle)).toEqual([vessel])
  })

  // 8. descendantOf precedence: Container > Cluster > Sequence
  it('8. descendantOf follows Container > Cluster > Sequence precedence', () => {
    const g = new Graph()
    const root = new Node(0)
    const containerAncestor = new Node(10)
    const clusterAncestor = new Node(20)
    const seqAncestor = new Node(30)

    const intermediate = new Node(2)
    intermediate.Container = containerAncestor
    intermediate.Cluster = new Cluster({ Vessel: clusterAncestor, Nodes: [intermediate] })
    intermediate.Sequence = new Sequence({ Vessel: seqAncestor, Nodes: [intermediate] })

    const grandChild = new Node(1)
    grandChild.Container = intermediate

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: grandChild, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [containerAncestor, clusterAncestor, seqAncestor]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // Container ancestor matched, cluster & seq were not followed because Container was present
    expect(res.byUncle.get(uncle)).toEqual([containerAncestor])
  })

  // 9. descendantOf(null ancestor semantics)
  it('9. descendantOf null ancestor semantics', () => {
    const g = new Graph()
    const child = new Node(1)
    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    // When root is null, graph.Containers[null] = [child]
    g.Containers = new Map([
      [null, [child]],
      [uncle, [cousin]],
    ])

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    const res = groupSheep(BackgroundWorkContext(), g, null, abductions)
    expect(res.byUncle.get(uncle)).toEqual([child])
  })

  // 10. forward branch precedence
  it('10. forward branch wins when both forward and reverse predicates qualify', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousinFwd = new Node(6)
    const uncleFwd = new Node(60)
    cousinFwd.Container = uncleFwd
    uncleFwd.isContainer = true

    const cousinRev = new Node(7)
    const uncleRev = new Node(70)
    cousinRev.Container = uncleRev
    uncleRev.isContainer = true

    const abductions = [
      new EdgeAbduction({
        OriginallyFrom: child,
        OriginallyTo: cousinFwd,
        CurrentTo: uncleFwd,
        CurrentFrom: uncleRev,
      }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncleFwd, [cousinFwd]],
      [uncleRev, [cousinRev]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.byUncle.has(uncleFwd)).toBe(true)
    expect(res.byUncle.has(uncleRev)).toBe(false)
  })

  // 11. CurrentTo non-container skip
  it('11. skips abduction when CurrentTo is non-container', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = false // NOT a container!

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.byUncle.size).toBe(0)
  })

  // 12. CurrentFrom non-container skip
  it('12. skips abduction in reverse branch when CurrentFrom is non-container', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = false // NOT a container!

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: cousin, OriginallyTo: child, CurrentFrom: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.byUncle.size).toBe(0)
  })

  // 13. OwningContainer used for cousin eligibility
  it('13. uses OwningContainer rather than raw Container for cousin eligibility', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const vessel = new Node(60)
    const uncle = new Node(600)
    vessel.Container = uncle
    uncle.isContainer = true

    // cousin has raw Container = null, but has an active Cluster whose vessel has Container = uncle
    const cousin = new Node(6)
    cousin.Container = null
    g.addNode(vessel)
    cousin.Cluster = new Cluster({ Vessel: vessel, Nodes: [cousin] })

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [vessel]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.byUncle.get(uncle)).toEqual([child])
  })

  // 14. used set before final uncle validation
  it('14. sets used=true before final uncle validation, permanently consuming abduction', () => {
    const g = new Graph()
    const root = new Node(0)
    const child1 = new Node(1)
    const child2 = new Node(2)
    child1.Container = root
    child2.Container = root

    const topNode = new Node(60)
    const cousin = new Node(6)
    cousin.Container = topNode

    // CurrentTo is nil, so climb finishes with cousin = topNode, then uncle = nil
    // This abduction is skipped after used[i] = true
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: null }),
    ]

    g.Containers = new Map([
      [root, [child1, child2]],
      [topNode, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // Abduction was consumed by child1, discarded, and never seen again
    expect(res.byUncle.size).toBe(0)
  })

  // 15. cousin climb: Cluster > Sequence > OwningContainer
  it('15. cousin climb follows Cluster > Sequence > OwningContainer precedence', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const grandUncle = new Node(600)
    grandUncle.isContainer = true

    const clusterVessel = new Node(60)
    clusterVessel.Container = grandUncle
    clusterVessel.isContainer = true

    const seqVessel = new Node(70)
    seqVessel.Container = grandUncle
    seqVessel.isContainer = true

    const cousin = new Node(6)
    cousin.Cluster = new Cluster({ Vessel: clusterVessel, Nodes: [cousin] })
    cousin.Sequence = new Sequence({ Vessel: seqVessel, Nodes: [cousin] })
    const subUncle = new Node(50)
    subUncle.isContainer = true
    cousin.Container = subUncle

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: grandUncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [grandUncle, [clusterVessel, seqVessel]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // Cousin climbed through Cluster to clusterVessel, ending at grandUncle
    expect(res.byUncle.get(grandUncle)).toEqual([child])
    expect(res.toCousin.get(grandUncle).get(child)).toEqual([clusterVessel])
  })

  // 16. byUncle node dedup
  it('16. deduplicates nodes within byUncle for the same uncle', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin1 = new Node(6)
    const cousin2 = new Node(7)
    const uncle = new Node(60)
    cousin1.Container = uncle
    cousin2.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin1, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin2, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin1, cousin2]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    // Child should appear exactly once in byUncle[uncle]
    expect(res.byUncle.get(uncle)).toEqual([child])
    // But toCousin should contain both cousins
    expect(res.toCousin.get(uncle).get(child)).toEqual([cousin1, cousin2])
  })

  // 17. cousin arrays allow duplicates
  it('17. preserves duplicate cousin entries in toCousin', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.toCousin.get(uncle).get(child)).toEqual([cousin, cousin])
    expect(res.toCousin.get(uncle).get(child).length).toBe(2)
  })

  // 18. child order preserved
  it('18. preserves root child source array order in byUncle', () => {
    const g = new Graph()
    const root = new Node(0)
    const c20 = new Node(20)
    const c10 = new Node(10)
    c20.Container = root
    c10.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: c20, OriginallyTo: cousin, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: c10, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    // Source order is c20, then c10
    g.Containers = new Map([
      [root, [c20, c10]],
      [uncle, [cousin]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.byUncle.get(uncle)).toEqual([c20, c10])
  })

  // 19. cousin abduction order preserved
  it('19. preserves abduction order in toCousin', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousinB = new Node(7)
    const cousinA = new Node(6)
    const uncle = new Node(60)
    cousinB.Container = uncle
    cousinA.Container = uncle
    uncle.isContainer = true

    // Staged cousinB first, then cousinA
    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousinB, CurrentTo: uncle }),
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousinA, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousinB, cousinA]],
    ])

    const res = groupSheep(BackgroundWorkContext(), g, root, abductions)
    expect(res.toCousin.get(uncle).get(child)).toEqual([cousinB, cousinA])
  })

  // 20. no graph/node mutation
  it('20. does not mutate graph or node state', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin]],
    ])

    const rootNearsBefore = new Set(root.Nears)
    const childNearsBefore = new Set(child.Nears)
    const childHerdBefore = child.HerdAssignment

    groupSheep(BackgroundWorkContext(), g, root, abductions)

    expect(child.HerdAssignment).toBe(childHerdBefore)
    expect(child.Nears).toEqual(childNearsBefore)
    expect(root.Nears).toEqual(rootNearsBefore)
  })

  // 21. fresh Maps on repeated calls
  it('21. returns fresh Map instances on repeated calls', () => {
    const g = new Graph()
    const root = new Node(0)
    const child = new Node(1)
    child.Container = root

    const cousin = new Node(6)
    const uncle = new Node(60)
    cousin.Container = uncle
    uncle.isContainer = true

    const abductions = [
      new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
    ]

    g.Containers = new Map([
      [root, [child]],
      [uncle, [cousin]],
    ])

    const res1 = groupSheep(BackgroundWorkContext(), g, root, abductions)
    const res2 = groupSheep(BackgroundWorkContext(), g, root, abductions)

    expect(res1.byUncle).not.toBe(res2.byUncle)
    expect(res1.toCousin).not.toBe(res2.toCousin)
    expect(res1.byUncle.get(uncle)).toEqual(res2.byUncle.get(uncle))
  })

  // 22. nil graph natural failure
  it('22. natural failure on nil graph', () => {
    const root = new Node(0)
    expect(() => groupSheep(BackgroundWorkContext(), null, root, [])).toThrow(TypeError)
  })

  // 23. nil Containers map safe
  it('23. safe empty maps when Containers is null/undefined', () => {
    const g = new Graph()
    g.Containers = null
    const root = new Node(0)
    const res = groupSheep(BackgroundWorkContext(), g, root, [])
    expect(res.byUncle.size).toBe(0)
    expect(res.toCousin.size).toBe(0)
  })
})
