import { expect, spyOn, describe, it } from 'bun:test'
import { Graph, Node, Edge } from '../../src/index.js'
import { Sequence } from '../../src/graph/sequence.js'
import { commonUncleSiblings, CommonUncleSiblings } from '../../src/proximity/index.js'

describe('CommonUncleSiblings JS Direct Tests', () => {
  // 1. PascalCase alias
  it('1. PascalCase alias is identical to camelCase function', () => {
    expect(CommonUncleSiblings).toBe(commonUncleSiblings)
  })

  // 2. ContainerRDFSOrderUnbounded(null) is used
  it('2. uses graph.ContainerRDFSOrderUnbounded(null) for container traversal', () => {
    const g = new Graph()
    const spy = spyOn(g, 'ContainerRDFSOrderUnbounded')
    commonUncleSiblings(g)
    expect(spy).toHaveBeenCalledWith(null)
  })

  // 3. RAW `.Container` is used, not OwningContainer
  it('3. uses RAW .Container and rejects uncle whose OwningContainer matches but raw .Container differs', () => {
    const g = new Graph()
    const parent = new Node('parent')
    const innerContainer = new Node('inner')
    innerContainer.Container = parent
    const child1 = new Node('c1')
    const child2 = new Node('c2')
    child1.Container = innerContainer
    child2.Container = innerContainer

    const vessel = new Node('vessel')
    vessel.Container = parent
    vessel.Graph = g

    const seq = new Sequence({
      Vessel: vessel,
      Graph: g,
    })
    const uncle = new Node('uncle')
    uncle.Sequence = seq
    uncle.Container = null // raw .Container is null
    seq.Nodes = [uncle]

    g.addNodeToContainer(null, parent)
    g.addNodeToContainer(parent, innerContainer)
    g.addNodeToContainer(innerContainer, child1)
    g.addNodeToContainer(innerContainer, child2)

    child1.Edges = [new Edge(child1, uncle)]
    child2.Edges = [new Edge(child2, uncle)]

    // Invariant check: OwningContainer matches parent, but raw Container is null
    expect(uncle.OwningContainer()).toBe(parent)
    expect(innerContainer.Container).toBe(parent)
    expect(uncle.Container).toBeNull()
    expect(uncle.Container).not.toBe(innerContainer.Container)

    const res = commonUncleSiblings(g)
    // CommonUncleSiblings uses raw .Container, so uncle is not accepted as uncle of innerContainer
    expect(res.size).toBe(0)
  })

  // 4. child source order is preserved
  it('4. preserves child source order in sibling array', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle = new Node('100')
    const c30 = new Node('30')
    const c10 = new Node('10')
    const c20 = new Node('20')
    c30.Container = container
    c10.Container = container
    c20.Container = container

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c30)
    g.addNodeToContainer(container, c10)
    g.addNodeToContainer(container, c20)

    c30.Edges = [new Edge(c30, uncle)]
    c10.Edges = [new Edge(c10, uncle)]
    c20.Edges = [new Edge(c20, uncle)]

    const res = commonUncleSiblings(g)
    expect(res.get(c30)).toEqual([c30, c10, c20])
    expect(res.get(c10)).toEqual([c30, c10, c20])
    expect(res.get(c20)).toEqual([c30, c10, c20])
  })

  // 5. parallel edges deduplicate a child
  it('5. deduplicates child when multiple parallel edges connect to same uncle', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle = new Node('100')
    const c1 = new Node('1')
    const c2 = new Node('2')
    c1.Container = container
    c2.Container = container

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)

    c1.Edges = [new Edge(c1, uncle), new Edge(c1, uncle), new Edge(c1, uncle)]
    c2.Edges = [new Edge(c2, uncle)]

    const res = commonUncleSiblings(g)
    const sibs = res.get(c1)
    expect(sibs).toBeDefined()
    expect(sibs.length).toBe(2)
    expect(sibs).toEqual([c1, c2])
  })

  // 6. 2-member then 3-member group → 3-member group wins
  it('6. selects larger 3-member group over earlier 2-member group', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle2 = new Node('uncle2')
    const uncle3 = new Node('uncle3')
    const c1 = new Node('1')
    const c2 = new Node('2')
    const c3 = new Node('3')
    const c4 = new Node('4')
    c1.Container = container
    c2.Container = container
    c3.Container = container
    c4.Container = container

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)
    g.addNodeToContainer(container, c3)
    g.addNodeToContainer(container, c4)

    // c1 is in uncle2 group (size 2: c1, c2) AND uncle3 group (size 3: c1, c3, c4)
    // uncle2 is processed first because c1 has edge to uncle2 first
    c1.Edges = [new Edge(c1, uncle2), new Edge(c1, uncle3)]
    c2.Edges = [new Edge(c2, uncle2)]
    c3.Edges = [new Edge(c3, uncle3)]
    c4.Edges = [new Edge(c4, uncle3)]

    const res = commonUncleSiblings(g)
    expect(res.get(c1).length).toBe(3)
    expect(res.get(c1)).toEqual([c1, c3, c4])
    expect(res.get(c3)).toEqual([c1, c3, c4])
    expect(res.get(c4)).toEqual([c1, c3, c4])
    expect(res.get(c2)).toEqual([c1, c2])
  })

  // 7. equal-size later group does NOT replace first
  it('7. preserves first group when equal-size later group is encountered', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle1 = new Node('uncle1')
    const uncle2 = new Node('uncle2')
    const c1 = new Node('1')
    const c2 = new Node('2')
    const c3 = new Node('3')
    c1.Container = container
    c2.Container = container
    c3.Container = container

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)
    g.addNodeToContainer(container, c3)

    // c1 connects to uncle1 (size 2: c1, c2) and uncle2 (size 2: c1, c3)
    c1.Edges = [new Edge(c1, uncle1), new Edge(c1, uncle2)]
    c2.Edges = [new Edge(c2, uncle1)]
    c3.Edges = [new Edge(c3, uncle2)]

    const res = commonUncleSiblings(g)
    // Strict comparison `len(existing) < len(siblings)` means first group [c1, c2] remains for c1
    expect(res.get(c1).length).toBe(2)
    expect(res.get(c1)).toEqual([c1, c2])
    expect(res.get(c2)).toEqual([c1, c2])
    expect(res.get(c3)).toEqual([c1, c3])
  })

  // 8. same winning group shares the same Array identity
  it('8. shares the same Array reference identity across all members of a winning group', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle = new Node('100')
    const c1 = new Node('1')
    const c2 = new Node('2')
    const c3 = new Node('3')

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)
    g.addNodeToContainer(container, c3)

    c1.Edges = [new Edge(c1, uncle)]
    c2.Edges = [new Edge(c2, uncle)]
    c3.Edges = [new Edge(c3, uncle)]

    const res = commonUncleSiblings(g)
    const arr1 = res.get(c1)
    const arr2 = res.get(c2)
    const arr3 = res.get(c3)
    expect(arr1).toBe(arr2)
    expect(arr2).toBe(arr3)
  })

  // 9. graph.CommonUncleSiblings is not mutated
  it('9. does not mutate graph.CommonUncleSiblings field', () => {
    const g = new Graph()
    const preMap = new Map()
    g.CommonUncleSiblings = preMap

    const container = new Node('10')
    const uncle = new Node('100')
    const c1 = new Node('1')
    const c2 = new Node('2')

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)

    c1.Edges = [new Edge(c1, uncle)]
    c2.Edges = [new Edge(c2, uncle)]

    commonUncleSiblings(g)
    expect(g.CommonUncleSiblings).toBe(preMap)
    expect(preMap.size).toBe(0)
  })

  // 10. repeated calls return fresh Maps
  it('10. returns fresh Map instances on repeated calls without reusing internal maps', () => {
    const g = new Graph()
    const container = new Node('10')
    const uncle = new Node('100')
    const c1 = new Node('1')
    const c2 = new Node('2')

    g.addNodeToContainer(null, container)
    g.addNodeToContainer(container, c1)
    g.addNodeToContainer(container, c2)

    c1.Edges = [new Edge(c1, uncle)]
    c2.Edges = [new Edge(c2, uncle)]

    const res1 = commonUncleSiblings(g)
    const res2 = commonUncleSiblings(g)

    expect(res1).not.toBe(res2)
    expect(res1.size).toBe(res2.size)
    expect(res1.get(c1)).not.toBe(res2.get(c1)) // fresh array instances
    expect(res1.get(c1)).toEqual(res2.get(c1))
  })
})
