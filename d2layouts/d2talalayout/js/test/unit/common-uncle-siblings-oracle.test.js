import { expect, describe, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { Graph, Node, Edge } from '../../src/index.js'
import { CommonUncleSiblings } from '../../src/proximity/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const oracleFile = join(__dirname, '../fixtures/go-common-uncle-siblings-reference.json')
const oracle = JSON.parse(readFileSync(oracleFile, 'utf8'))

function checkOracle(name, setup) {
  const goRes = oracle.scenarios[name]
  
  let graph
  try {
    graph = setup()
  } catch (err) {
    if (!goRes.panic) throw err
    return
  }

  let jsRes
  let jsErr = null
  try {
    jsRes = CommonUncleSiblings(graph)
  } catch (err) {
    jsErr = err
  }

  if (goRes.panic) {
    expect(jsErr).not.toBeNull()
    return
  }

  expect(jsErr).toBeNull()

  const jsCommonMap = {}
  if (jsRes) {
    for (const [node, siblings] of jsRes.entries()) {
      jsCommonMap[node.ID] = siblings.map(s => s.ID)
    }
  }

  const goCommonMap = goRes.common || {}

  // Compare sorted keys to ensure same nodes are tracked
  expect(Object.keys(jsCommonMap).sort()).toEqual(Object.keys(goCommonMap).sort())

  // Compare actual arrays directly without sorting to verify sibling list order parity
  for (const key of Object.keys(goCommonMap)) {
    expect(jsCommonMap[key]).toEqual(goCommonMap[key])
  }
}

describe('CommonUncleSiblings Oracle Replay', () => {
  it('A_empty_graph', () => {
    checkOracle('A_empty_graph', () => new Graph())
  })

  it('B_canonical_largest_group', () => {
    checkOracle('B_canonical_largest_group', () => {
      const g = new Graph()
      const container = new Node('10')
      const uncle = new Node('100')
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
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      c3.Edges = [new Edge(c3, uncle)]
      return g
    })
  })

  it('C_one_child', () => {
    checkOracle('C_one_child', () => {
      const g = new Graph()
      const container = new Node('10')
      const uncle = new Node('100')
      const c1 = new Node('1')
      c1.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      c1.Edges = [new Edge(c1, uncle)]
      return g
    })
  })

  it('D_two_siblings', () => {
    checkOracle('D_two_siblings', () => {
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
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      return g
    })
  })

  it('E_child_order', () => {
    checkOracle('E_child_order', () => {
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
      return g
    })
  })

  it('F_parallel_edges', () => {
    checkOracle('F_parallel_edges', () => {
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
      c1.Edges = [new Edge(c1, uncle), new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      return g
    })
  })

  it('G_different_uncles', () => {
    checkOracle('G_different_uncles', () => {
      const g = new Graph()
      const container = new Node('10')
      const uncle1 = new Node('101')
      const uncle2 = new Node('102')
      const c1 = new Node('1')
      const c2 = new Node('2')
      const c3 = new Node('3')
      const c4 = new Node('4')
      c1.Container = container; c2.Container = container; c3.Container = container; c4.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      g.addNodeToContainer(container, c3)
      g.addNodeToContainer(container, c4)
      c1.Edges = [new Edge(c1, uncle1)]
      c2.Edges = [new Edge(c2, uncle1)]
      c3.Edges = [new Edge(c3, uncle2)]
      c4.Edges = [new Edge(c4, uncle2)]
      return g
    })
  })

  it('H_larger_group_wins', () => {
    checkOracle('H_larger_group_wins', () => {
      const g = new Graph()
      const container = new Node('10')
      const uncle2 = new Node('102')
      const uncle3 = new Node('103')
      const c1 = new Node('1')
      const c2 = new Node('2')
      const c3 = new Node('3')
      const c4 = new Node('4')
      c1.Container = container; c2.Container = container; c3.Container = container; c4.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      g.addNodeToContainer(container, c3)
      g.addNodeToContainer(container, c4)
      
      c1.Edges = [new Edge(c1, uncle2), new Edge(c1, uncle3)]
      c2.Edges = [new Edge(c2, uncle2)]
      c3.Edges = [new Edge(c3, uncle3)]
      c4.Edges = [new Edge(c4, uncle3)]
      return g
    })
  })

  it('I_equal_size_tie', () => {
    checkOracle('I_equal_size_tie', () => {
      const g = new Graph()
      const container = new Node('10')
      const uncle1 = new Node('101')
      const uncle2 = new Node('102')
      const c1 = new Node('1')
      const c2 = new Node('2')
      const c3 = new Node('3')
      c1.Container = container; c2.Container = container; c3.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      g.addNodeToContainer(container, c3)
      
      c1.Edges = [new Edge(c1, uncle1), new Edge(c1, uncle2)]
      c2.Edges = [new Edge(c2, uncle1)]
      c3.Edges = [new Edge(c3, uncle2)]
      return g
    })
  })

  it('J_raw_vs_owning', () => {
    checkOracle('J_raw_vs_owning', () => {
      const g = new Graph()
      const container = new Node('10')
      const seqVessel = new Node('99')
      seqVessel.Container = null
      const uncle = new Node('100')
      uncle.Container = seqVessel
      
      const c1 = new Node('1')
      const c2 = new Node('2')
      c1.Container = container; c2.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      return g
    })
  })

  it('K_root_level', () => {
    checkOracle('K_root_level', () => {
      const g = new Graph()
      const container = new Node('10')
      container.Container = null
      const uncle = new Node('100')
      uncle.Container = null
      const c1 = new Node('1')
      const c2 = new Node('2')
      c1.Container = container; c2.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      return g
    })
  })

  it('L_nested_containers', () => {
    checkOracle('L_nested_containers', () => {
      const g = new Graph()
      const c1 = new Node('10')
      c1.Container = null
      const c2 = new Node('20')
      c2.Container = c1
      const uncle = new Node('100')
      uncle.Container = c1
      
      const child1 = new Node('1')
      const child2 = new Node('2')
      child1.Container = c2; child2.Container = c2
      
      g.addNodeToContainer(null, c1)
      g.addNodeToContainer(c1, c2)
      g.addNodeToContainer(c1, uncle)
      g.addNodeToContainer(c2, child1)
      g.addNodeToContainer(c2, child2)
      
      child1.Edges = [new Edge(child1, uncle)]
      child2.Edges = [new Edge(child2, uncle)]
      return g
    })
  })

  it('M_same_uncle_different_containers', () => {
    checkOracle('M_same_uncle_different_containers', () => {
      const g = new Graph()
      const cont1 = new Node('10')
      const cont2 = new Node('20')
      const uncle = new Node('100')
      
      const c1 = new Node('1'); c1.Container = cont1
      const c2 = new Node('2'); c2.Container = cont1
      const c3 = new Node('3'); c3.Container = cont2
      const c4 = new Node('4'); c4.Container = cont2
      
      g.addNodeToContainer(null, cont1)
      g.addNodeToContainer(cont1, c1)
      g.addNodeToContainer(cont1, c2)
      g.addNodeToContainer(null, cont2)
      g.addNodeToContainer(cont2, c3)
      g.addNodeToContainer(cont2, c4)
      
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      c3.Edges = [new Edge(c3, uncle)]
      c4.Edges = [new Edge(c4, uncle)]
      return g
    })
  })

  it('O_nil_edge_slice', () => {
    checkOracle('O_nil_edge_slice', () => {
      const g = new Graph()
      const container = new Node('10')
      const c1 = new Node('1'); c1.Container = container
      const c2 = new Node('2'); c2.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      g.addNodeToContainer(container, c2)
      c1.Edges = null
      c2.Edges = null
      return g
    })
  })

  it('Q_nil_edge', () => {
    checkOracle('Q_nil_edge', () => {
      const g = new Graph()
      const container = new Node('10')
      const c1 = new Node('1'); c1.Container = container
      g.addNodeToContainer(null, container)
      g.addNodeToContainer(container, c1)
      c1.Edges = [null]
      return g
    })
  })
  
  it('R_preexisting_common', () => {
    checkOracle('R_preexisting_common', () => {
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
      c1.Edges = [new Edge(c1, uncle)]
      c2.Edges = [new Edge(c2, uncle)]
      
      g.CommonUncleSiblings = new Map()
      return g
    })
  })
})
