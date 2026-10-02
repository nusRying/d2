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
  BackgroundWorkContext,
  PollingWorkContext,
} from '../../src/index.js'
import { GroupSheep } from '../../src/proximity/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const oracleFile = join(__dirname, '../fixtures/go-group-sheep-reference.json')
const oracle = JSON.parse(readFileSync(oracleFile, 'utf8'))

function checkOracle(name, setup) {
  const goRes = oracle.scenarios[name]
  expect(goRes).toBeDefined()

  const { context, graph, root, abductions } = setup()

  let jsErr = null
  let result = null
  try {
    result = GroupSheep(context, graph, root, abductions)
  } catch (err) {
    jsErr = err
  }

  if (goRes.success) {
    expect(jsErr).toBeNull()
    expect(result).toBeDefined()
    expect(result.byUncle).toBeInstanceOf(Map)
    expect(result.toCousin).toBeInstanceOf(Map)

    const actualByUncle = {}
    for (const [uncle, nodes] of result.byUncle.entries()) {
      actualByUncle[String(uncle.ID)] = nodes.map(n => String(n.ID))
    }
    expect(actualByUncle).toEqual(goRes.byUncle || {})

    const actualToCousin = {}
    for (const [uncle, nodeMap] of result.toCousin.entries()) {
      actualToCousin[String(uncle.ID)] = {}
      for (const [node, cousins] of nodeMap.entries()) {
        actualToCousin[String(uncle.ID)][String(node.ID)] = cousins.map(c => String(c.ID))
      }
    }
    expect(actualToCousin).toEqual(goRes.toCousin || {})
  } else {
    expect(jsErr).not.toBeNull()
    if (goRes.errorMessage) {
      if (goRes.errorMessage.includes('context canceled')) {
        expect(jsErr.message).toContain('AssignHerds: context canceled')
      } else if (goRes.errorMessage.includes('nil edge abduction')) {
        expect(jsErr.message).toContain('herding has a nil edge abduction')
      }
    }
  }
}

describe('GroupSheep Oracle Replay', () => {
  it('A_empty_graph_empty_children', () => {
    checkOracle('A_empty_graph_empty_children', () => {
      const g = new Graph()
      const root = new Node(1)
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions: null,
      }
    })
  })

  it('B_upstream_canonical', () => {
    checkOracle('B_upstream_canonical', () => {
      const g = new Graph()
      const container = new Node(0)
      const a = new Node(1)
      const b = new Node(2)
      const c = new Node(3)
      const d = new Node(4)
      const e = new Node(5)

      const ab_cousin = new Node(6)
      const ab_uncle = new Node(60)
      ab_cousin.Container = ab_uncle

      const b_cousin = new Node(7)
      const b_uncle = new Node(70)
      b_cousin.Container = b_uncle

      const cd_cousin = new Node(8)
      const cd_uncle = new Node(80)
      cd_cousin.Container = cd_uncle

      const e_uncle = new Node(90)

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: a, OriginallyTo: ab_cousin, CurrentTo: ab_uncle }),
        new EdgeAbduction({ OriginallyFrom: b, OriginallyTo: ab_cousin, CurrentTo: ab_uncle }),
        new EdgeAbduction({ OriginallyFrom: b, OriginallyTo: b_cousin, CurrentTo: b_uncle }),
        new EdgeAbduction({ OriginallyFrom: c, OriginallyTo: cd_cousin, CurrentTo: cd_uncle }),
        new EdgeAbduction({ OriginallyFrom: d, OriginallyTo: cd_cousin, CurrentTo: cd_uncle }),
        new EdgeAbduction({ OriginallyFrom: e, OriginallyTo: e_uncle, CurrentTo: e_uncle }),
      ]

      g.Containers = new Map([
        [container, [a, b, c, d, e]],
        [ab_uncle, [ab_cousin]],
        [b_uncle, [b_cousin]],
        [cd_uncle, [cd_cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('C_upstream_nested_sheep', () => {
    checkOracle('C_upstream_nested_sheep', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      const grandChild = new Node(2)

      grandChild.Container = child
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: grandChild, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [child, [grandChild]],
        [uncle, [cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('D_upstream_cluster_sheep', () => {
    checkOracle('D_upstream_cluster_sheep', () => {
      const g = new Graph()
      const container = new Node(0)
      const normalChild = new Node(1)
      const clusterNodeA = new Node(2)
      const clusterNodeB = new Node(3)
      const vessel = new Node(4)

      const cluster = new Cluster({ Vessel: vessel, Nodes: [clusterNodeA, clusterNodeB] })
      clusterNodeA.Cluster = cluster
      clusterNodeB.Cluster = cluster
      vessel.isClusterVessel = true

      normalChild.Container = container
      vessel.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: clusterNodeA, OriginallyTo: cousin, CurrentTo: uncle }),
        new EdgeAbduction({ OriginallyFrom: normalChild, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [normalChild, vessel]],
        [uncle, [cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('E_sequence_sheep', () => {
    checkOracle('E_sequence_sheep', () => {
      const g = new Graph()
      const container = new Node(0)
      const seqStep = new Node(2)
      const vessel = new Node(4)

      const seq = new Sequence({ Vessel: vessel, Nodes: [seqStep] })
      seqStep.Sequence = seq

      seqStep.Container = container
      vessel.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: seqStep, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [vessel]],
        [uncle, [cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('F_cluster_and_sequence', () => {
    checkOracle('F_cluster_and_sequence', () => {
      const g = new Graph()
      const container = new Node(0)
      const node = new Node(2)
      const clusterVessel = new Node(4)
      const seqVessel = new Node(5)

      node.Cluster = new Cluster({ Vessel: clusterVessel, Nodes: [node] })
      node.Sequence = new Sequence({ Vessel: seqVessel, Nodes: [node] })

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: node, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [clusterVessel, seqVessel]],
        [uncle, [cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('G_reverse_direction', () => {
    checkOracle('G_reverse_direction', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: cousin, OriginallyTo: child, CurrentFrom: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('H_both_branches_qualify', () => {
    checkOracle('H_both_branches_qualify', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousinFwd = new Node(6)
      const uncleFwd = new Node(60)
      cousinFwd.Container = uncleFwd

      const cousinRev = new Node(7)
      const uncleRev = new Node(70)
      cousinRev.Container = uncleRev

      const abductions = [
        new EdgeAbduction({
          OriginallyFrom: child,
          OriginallyTo: cousinFwd,
          CurrentTo: uncleFwd,
          CurrentFrom: uncleRev,
        }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncleFwd, [cousinFwd]],
        [uncleRev, [cousinRev]],
      ])
      for (const cont of g.Containers.keys()) {
        cont.isContainer = true
      }

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('I_current_endpoint_non_container', () => {
    checkOracle('I_current_endpoint_non_container', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = false

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('J_current_endpoint_nil', () => {
    checkOracle('J_current_endpoint_nil', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: null }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('K_cousin_owning_container_nil', () => {
    checkOracle('K_cousin_owning_container_nil', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: null }),
      ]

      g.Containers = new Map([
        [container, [child]],
      ])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('L_final_uncle_nil', () => {
    checkOracle('L_final_uncle_nil', () => {
      const g = new Graph()
      const container = new Node(0)
      const child1 = new Node(1)
      const child2 = new Node(2)
      child1.Container = container
      child2.Container = container

      const topNode = new Node(60)
      const cousin = new Node(6)
      cousin.Container = topNode

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: null }),
        new EdgeAbduction({ OriginallyFrom: child2, OriginallyTo: cousin, CurrentTo: null }),
      ]

      g.Containers = new Map([
        [container, [child1, child2]],
        [topNode, [cousin]],
      ])
      container.isContainer = true
      topNode.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('M_final_uncle_non_container', () => {
    checkOracle('M_final_uncle_non_container', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const grandUncle = new Node(600)
      grandUncle.isContainer = false

      const uncle = new Node(60)
      uncle.Container = grandUncle
      uncle.isContainer = true

      const cousin = new Node(6)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: grandUncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
        [grandUncle, [uncle]],
      ])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('N_used_abduction_consumption', () => {
    checkOracle('N_used_abduction_consumption', () => {
      const g = new Graph()
      const container = new Node(0)
      const child1 = new Node(1)
      const child2 = new Node(2)
      child1.Container = container
      child2.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child1, child2]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('O_skipped_before_used', () => {
    checkOracle('O_skipped_before_used', () => {
      const g = new Graph()
      const container = new Node(0)
      const child1 = new Node(1)
      const child2 = new Node(2)
      child1.Container = container
      child2.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child2, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child1, child2]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('P_root_child_source_order', () => {
    checkOracle('P_root_child_source_order', () => {
      const g = new Graph()
      const container = new Node(0)
      const child20 = new Node(20)
      const child10 = new Node(10)
      child20.Container = container
      child10.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child20, OriginallyTo: cousin, CurrentTo: uncle }),
        new EdgeAbduction({ OriginallyFrom: child10, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child20, child10]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('Q_multiple_cousins_same_node', () => {
    checkOracle('Q_multiple_cousins_same_node', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin1 = new Node(6)
      const cousin2 = new Node(7)
      const uncle = new Node(60)
      cousin1.Container = uncle
      cousin2.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin1, CurrentTo: uncle }),
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin2, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin1, cousin2]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('R_duplicate_cousins', () => {
    checkOracle('R_duplicate_cousins', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('S_cluster_climb', () => {
    checkOracle('S_cluster_climb', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const grandUncle = new Node(600)
      grandUncle.isContainer = true

      const vessel = new Node(60)
      vessel.Container = grandUncle
      vessel.isContainer = true

      const cousinNode = new Node(6)
      cousinNode.Cluster = new Cluster({ Vessel: vessel, Nodes: [cousinNode] })
      const subUncle = new Node(50)
      subUncle.isContainer = true
      cousinNode.Container = subUncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousinNode, CurrentTo: grandUncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [grandUncle, [vessel]],
      ])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('T_sequence_climb', () => {
    checkOracle('T_sequence_climb', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const grandUncle = new Node(600)
      grandUncle.isContainer = true

      const vessel = new Node(60)
      vessel.Container = grandUncle
      vessel.isContainer = true

      const cousinNode = new Node(6)
      cousinNode.Sequence = new Sequence({ Vessel: vessel, Nodes: [cousinNode] })
      const subUncle = new Node(50)
      subUncle.isContainer = true
      cousinNode.Container = subUncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousinNode, CurrentTo: grandUncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [grandUncle, [vessel]],
      ])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('U_direct_owning_container_climb', () => {
    checkOracle('U_direct_owning_container_climb', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const grandUncle = new Node(600)
      grandUncle.isContainer = true

      const uncle = new Node(60)
      uncle.Container = grandUncle
      uncle.isContainer = true

      const cousin = new Node(6)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: grandUncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
        [grandUncle, [uncle]],
      ])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('V_nil_abduction_with_child', () => {
    checkOracle('V_nil_abduction_with_child', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      g.Containers = new Map([[container, [child]]])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions: [null],
      }
    })
  })

  it('W_nil_abduction_no_children', () => {
    checkOracle('W_nil_abduction_no_children', () => {
      const g = new Graph()
      const container = new Node(0)
      g.Containers = new Map([[container, []]])
      container.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions: [null],
      }
    })
  })

  it('X_precanceled_with_child', () => {
    checkOracle('X_precanceled_with_child', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      g.Containers = new Map([[container, [child]]])
      container.isContainer = true

      return {
        context: PollingWorkContext(() => true),
        graph: g,
        root: container,
        abductions: null,
      }
    })
  })

  it('Y_precanceled_no_children', () => {
    checkOracle('Y_precanceled_no_children', () => {
      const g = new Graph()
      const container = new Node(0)
      g.Containers = new Map([[container, []]])
      container.isContainer = true

      return {
        context: PollingWorkContext(() => true),
        graph: g,
        root: container,
        abductions: null,
      }
    })
  })

  it('Z_cancellation_during_abduction_scan', () => {
    checkOracle('Z_cancellation_during_abduction_scan', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      const cousin1 = new Node(6)
      const cousin2 = new Node(7)
      const uncle = new Node(60)
      cousin1.Container = uncle
      cousin2.Container = uncle

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin1, cousin2]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin1, CurrentTo: uncle }),
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin2, CurrentTo: uncle }),
      ]

      let count = 0
      const ctx = PollingWorkContext(() => {
        count++
        return count >= 3
      })

      return {
        context: ctx,
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('AA_cancellation_before_used', () => {
    checkOracle('AA_cancellation_before_used', () => {
      const g = new Graph()
      const container = new Node(0)
      const child1 = new Node(1)
      const child2 = new Node(2)
      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      g.Containers = new Map([
        [container, [child1, child2]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child1, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      let count = 0
      const ctx = PollingWorkContext(() => {
        count++
        return count >= 4
      })

      return {
        context: ctx,
        graph: g,
        root: container,
        abductions,
      }
    })
  })

  it('AB_nil_graph', () => {
    checkOracle('AB_nil_graph', () => {
      const root = new Node(1)
      return {
        context: BackgroundWorkContext(),
        graph: null,
        root,
        abductions: null,
      }
    })
  })

  it('AC_nil_containers', () => {
    checkOracle('AC_nil_containers', () => {
      const g = new Graph()
      g.Containers = null
      const root = new Node(1)
      return {
        context: BackgroundWorkContext(),
        graph: g,
        root,
        abductions: null,
      }
    })
  })

  it('AD_nil_root', () => {
    checkOracle('AD_nil_root', () => {
      const g = new Graph()
      const child = new Node(1)
      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      g.Containers = new Map([
        [null, [child]],
        [uncle, [cousin]],
      ])
      uncle.isContainer = true

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: null,
        abductions,
      }
    })
  })

  it('AE_repeated_call', () => {
    checkOracle('AE_repeated_call', () => {
      const g = new Graph()
      const container = new Node(0)
      const child = new Node(1)
      child.Container = container

      const cousin = new Node(6)
      const uncle = new Node(60)
      cousin.Container = uncle

      const abductions = [
        new EdgeAbduction({ OriginallyFrom: child, OriginallyTo: cousin, CurrentTo: uncle }),
      ]

      g.Containers = new Map([
        [container, [child]],
        [uncle, [cousin]],
      ])
      container.isContainer = true
      uncle.isContainer = true

      return {
        context: BackgroundWorkContext(),
        graph: g,
        root: container,
        abductions,
      }
    })
  })
})
