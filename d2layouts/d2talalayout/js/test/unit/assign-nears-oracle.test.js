import { expect, describe, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  Graph,
  Node,
  EdgeAbduction,
  Sequence,
  Cluster,
  Hierarchy,
  BackgroundWorkContext,
  PollingWorkContext,
} from '../../src/internal.js'
import { AssignNears } from '../../src/proximity/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const oracleFile = join(__dirname, '../fixtures/go-assign-nears-reference.json')
const oracle = JSON.parse(readFileSync(oracleFile, 'utf8'))

function checkOracle(name, setup) {
  const goRes = oracle.scenarios[name]
  expect(goRes).toBeDefined()

  const { context, graph, root, abductions, trackedNodes } = setup()

  const originalMaps = new Map()
  for (const n of trackedNodes) {
    originalMaps.set(n, n.Nears)
  }

  let jsErr = null
  try {
    AssignNears(context, graph, root, abductions)
  } catch (err) {
    jsErr = err
  }

  if (goRes.success) {
    expect(jsErr).toBeNull()
  } else {
    expect(jsErr).not.toBeNull()
    if (goRes.errorMessage) {
      if (goRes.errorMessage.includes('context canceled')) {
        expect(jsErr.message).toContain('context canceled')
      } else if (goRes.errorMessage.includes('nil edge abduction')) {
        expect(jsErr.message).toContain('nil edge abduction while assigning nears')
      }
    }
  }

  for (const [nodeIdStr, expectedState] of Object.entries(goRes.nodes || {})) {
    const node = trackedNodes.find(n => String(n.ID) === nodeIdStr)
    expect(node).toBeDefined()

    const actualNears = node.Nears ? Array.from(node.Nears).map(n => String(n.ID)).sort() : []
    const expectedNears = [...expectedState.nears].sort()
    expect(actualNears).toEqual(expectedNears)

    const replaced = node.Nears !== originalMaps.get(node)
    expect(replaced).toBe(expectedState.replaced)
  }
}

describe('AssignNears Oracle Replay', () => {
  it('A_empty_abductions', () => {
    checkOracle('A_empty_abductions', () => {
      const g = new Graph()
      const root = new Node(10)
      const c1 = new Node(1)
      c1.Container = root
      const c2 = new Node(2)
      c2.Container = root
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions: [],
        trackedNodes: [c1, c2, ext],
      }
    })
  })

  it('B_canonical_upstream', () => {
    checkOracle('B_canonical_upstream', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const external = new Node(100)
      const root = new Node(10)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, external)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      g.connect(first, external)
      g.connect(second, external)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: external }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: external }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second, external],
      }
    })
  })

  it('C_three_siblings', () => {
    checkOracle('C_three_siblings', () => {
      const g = new Graph()
      const c1 = new Node(1)
      const c2 = new Node(2)
      const c3 = new Node(3)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      g.addNodeToContainer(root, c3)
      g.connect(c1, ext)
      g.connect(c2, ext)
      g.connect(c3, ext)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: c3, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2, c3],
      }
    })
  })

  it('D_duplicate_abductions', () => {
    checkOracle('D_duplicate_abductions', () => {
      const g = new Graph()
      const c1 = new Node(1)
      const c2 = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      g.connect(c1, ext)
      g.connect(c2, ext)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2],
      }
    })
  })

  it('E_different_uncles', () => {
    checkOracle('E_different_uncles', () => {
      const g = new Graph()
      const c1 = new Node(1)
      const c2 = new Node(2)
      const c3 = new Node(3)
      const c4 = new Node(4)
      const root = new Node(10)
      const u1 = new Node(101)
      const u2 = new Node(102)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, u1)
      g.addNodeToContainer(null, u2)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      g.addNodeToContainer(root, c3)
      g.addNodeToContainer(root, c4)
      g.connect(c1, u1)
      g.connect(c2, u1)
      g.connect(c3, u2)
      g.connect(c4, u2)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: u1 }),
        new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: u1 }),
        new EdgeAbduction({ OriginallyFrom: c3, CurrentTo: u2 }),
        new EdgeAbduction({ OriginallyFrom: c4, CurrentTo: u2 }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2, c3, c4],
      }
    })
  })

  it('F_nested_descendants', () => {
    checkOracle('F_nested_descendants', () => {
      const g = new Graph()
      const first = new Node(1)
      const nestedFirst = new Node(21)
      const nestedSecond = new Node(22)
      const nestedContainer = new Node(2)
      const root = new Node(10)
      const external = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, external)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, nestedContainer)
      g.addNodeToContainer(nestedContainer, nestedFirst)
      g.addNodeToContainer(nestedContainer, nestedSecond)
      g.connect(first, external)
      g.connect(nestedFirst, external)
      g.connect(nestedSecond, external)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: external }),
        new EdgeAbduction({ OriginallyFrom: nestedFirst, CurrentTo: external }),
        new EdgeAbduction({ OriginallyFrom: nestedSecond, CurrentTo: external }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, nestedContainer, nestedFirst, nestedSecond],
      }
    })
  })

  it('G_nested_cluster_vessel', () => {
    checkOracle('G_nested_cluster_vessel', () => {
      const g = new Graph()
      const first = new Node(1)
      const clusterVessel = new Node(2)
      const member = new Node(21)
      const root = new Node(10)
      const ext = new Node(100)
      const cluster = new Cluster({ Vessel: clusterVessel })
      member.Cluster = cluster
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, clusterVessel)
      g.connect(first, ext)
      g.connect(member, ext)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: member, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, clusterVessel, member],
      }
    })
  })

  it('H_nested_sequence_vessel', () => {
    checkOracle('H_nested_sequence_vessel', () => {
      const g = new Graph()
      const first = new Node(1)
      const seqVessel = new Node(2)
      const member = new Node(21)
      const root = new Node(10)
      const ext = new Node(100)
      const seq = new Sequence({ Vessel: seqVessel })
      member.Sequence = seq
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, seqVessel)
      g.connect(first, ext)
      g.connect(member, ext)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: member, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, seqVessel, member],
      }
    })
  })

  it('I_cluster_precedence_over_sequence', () => {
    checkOracle('I_cluster_precedence_over_sequence', () => {
      const g = new Graph()
      const other = new Node(1)
      const clusterVessel = new Node(2)
      const seqVessel = new Node(3)
      const member = new Node(21)
      const root = new Node(10)
      const ext = new Node(100)
      const cluster = new Cluster({ Vessel: clusterVessel })
      const seq = new Sequence({ Vessel: seqVessel })
      member.Cluster = cluster
      member.Sequence = seq
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, other)
      g.addNodeToContainer(root, clusterVessel)
      g.addNodeToContainer(root, seqVessel)
      g.connect(other, ext)
      g.connect(member, ext)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: other, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: member, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [other, clusterVessel, seqVessel],
      }
    })
  })

  it('J_from_and_to_both_descendants', () => {
    checkOracle('J_from_and_to_both_descendants', () => {
      const g = new Graph()
      const c1 = new Node(1)
      const c2 = new Node(2)
      const root = new Node(10)
      const uncleFrom = new Node(101)
      const uncleTo = new Node(102)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(nilOrNull(uncleFrom), uncleFrom)
      g.addNodeToContainer(nilOrNull(uncleTo), uncleTo)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: c1, OriginallyTo: c1, CurrentFrom: uncleFrom, CurrentTo: uncleTo }),
        new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: uncleTo }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2],
      }
    })
  })

  it('K_no_matching_direct_child', () => {
    checkOracle('K_no_matching_direct_child', () => {
      const g = new Graph()
      const root = new Node(10)
      const otherRoot = new Node(20)
      const c1 = new Node(1)
      const c2 = new Node(2)
      const otherChild = new Node(21)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, otherRoot)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      g.addNodeToContainer(otherRoot, otherChild)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: otherChild, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2],
      }
    })
  })

  it('L_nil_uncle', () => {
    checkOracle('L_nil_uncle', () => {
      const g = new Graph()
      const root = new Node(10)
      const c1 = new Node(1)
      const c2 = new Node(2)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(root, c1)
      g.addNodeToContainer(root, c2)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: c1, CurrentTo: null }),
        new EdgeAbduction({ OriginallyFrom: c2, CurrentTo: null }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [c1, c2],
      }
    })
  })

  it('M_hierarchy_on_first', () => {
    checkOracle('M_hierarchy_on_first', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      first.Hierarchy = new Hierarchy()
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('N_hierarchy_on_second', () => {
    checkOracle('N_hierarchy_on_second', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      second.Hierarchy = new Hierarchy()
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('O_existing_direct_edge', () => {
    checkOracle('O_existing_direct_edge', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      g.connect(first, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('P_nil_edge_in_edges', () => {
    checkOracle('P_nil_edge_in_edges', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      first.Edges = [null]
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('Q_existing_near_preservation', () => {
    checkOracle('Q_existing_near_preservation', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const oldNear = new Node(99)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(nilOrNull(root), root)
      g.addNodeToContainer(nilOrNull(ext), ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      first.Nears.add(oldNear)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second, oldNear],
      }
    })
  })

  it('R_already_symmetric_near', () => {
    checkOracle('R_already_symmetric_near', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      first.Nears.add(second)
      second.Nears.add(first)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('S_asymmetric_existing_near', () => {
    checkOracle('S_asymmetric_existing_near', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      first.Nears.add(second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('T_nil_near_map', () => {
    checkOracle('T_nil_near_map', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      first.Nears = null
      second.Nears = null
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('U_precanceled_context', () => {
    checkOracle('U_precanceled_context', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      const ctx = PollingWorkContext(() => true)
      return {
        context: ctx,
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('V_cancellation_during_discovery', () => {
    checkOracle('V_cancellation_during_discovery', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      let steps = 0
      const ctx = PollingWorkContext(() => {
        steps++
        return steps >= 2
      })
      return {
        context: ctx,
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('W_cancellation_after_commit', () => {
    checkOracle('W_cancellation_after_commit', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      let observed = false
      const ctx = PollingWorkContext(() => {
        if ((first.Nears && first.Nears.size > 0) || (second.Nears && second.Nears.size > 0)) {
          observed = true
          return true
        }
        return false
      })
      return {
        context: ctx,
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('Z_unrelated_external_node', () => {
    checkOracle('Z_unrelated_external_node', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      const marker = new Node(999)
      ext.Nears.add(marker)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(null, ext)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
        new EdgeAbduction({ OriginallyFrom: second, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second, ext],
      }
    })
  })

  it('AA_nil_abduction_error', () => {
    checkOracle('AA_nil_abduction_error', () => {
      const g = new Graph()
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      g.addNodeToContainer(null, root)
      g.addNodeToContainer(root, first)
      g.addNodeToContainer(root, second)
      const abductions = [null]
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })

  it('AB_nil_graph_nonempty_abduction', () => {
    checkOracle('AB_nil_graph_nonempty_abduction', () => {
      const first = new Node(1)
      const second = new Node(2)
      const root = new Node(10)
      const ext = new Node(100)
      const abductions = [
        new EdgeAbduction({ OriginallyFrom: first, CurrentTo: ext }),
      ]
      return {
        context: BackgroundWorkContext(),
        graph: null,
        root,
        abductions,
        trackedNodes: [first, second],
      }
    })
  })
})

function nilOrNull(node) {
  return null
}
