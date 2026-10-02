import { expect, spyOn, describe, it } from 'bun:test'
import { Graph, Node, Edge } from '../../src/index.js'
import { commonUncleSiblings, CommonUncleSiblings } from '../../src/proximity/index.js'

describe('CommonUncleSiblings JS Direct Tests', () => {
  it('PascalCase alias is correct', () => {
    expect(CommonUncleSiblings).toBe(commonUncleSiblings)
  })

  it('uses graph.ContainerRDFSOrderUnbounded(null) for traversal', () => {
    const g = new Graph()
    const spy = spyOn(g, 'ContainerRDFSOrderUnbounded')
    commonUncleSiblings(g)
    expect(spy).toHaveBeenCalledWith(null)
  })

  it('preserves array identity for same winning group', () => {
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

    const res = commonUncleSiblings(g)
    expect(Array.isArray(res.get(c1))).toBe(true)
    expect(res.get(c1)).toBe(res.get(c2))
  })

  it('does not mutate graph.CommonUncleSiblings and returns fresh Map', () => {
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

    const res1 = commonUncleSiblings(g)
    expect(res1).not.toBe(preMap)
    expect(g.CommonUncleSiblings).toBe(preMap)

    const res2 = commonUncleSiblings(g)
    expect(res1).not.toBe(res2)
  })
})
