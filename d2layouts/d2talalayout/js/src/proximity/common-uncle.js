export function commonUncleSiblings(graph) {
  let uncleToCousins = new Map()
  const common = new Map()
  const orderedUncles = []

  for (const container of graph.ContainerRDFSOrderUnbounded(null)) {
    const children = graph.Containers.get(container) ?? []

    for (const node of children) {
      const edges = node.Edges ?? []
      for (const edge of edges) {
        const adjacent = node.Adjacent(edge)
        if (adjacent.Container === container.Container) {
          if (!uncleToCousins.has(adjacent)) {
            orderedUncles.push(adjacent)
            uncleToCousins.set(adjacent, [])
          }
          const cousins = uncleToCousins.get(adjacent)
          if (!cousins.includes(node)) {
            cousins.push(node)
          }
        }
      }
    }

    for (const uncle of orderedUncles) {
      const siblings = uncleToCousins.get(uncle)
      if (!siblings || siblings.length < 2) {
        continue
      }

      for (const sibling of siblings) {
        const existing = common.get(sibling)
        if (!existing || existing.length < siblings.length) {
          common.set(sibling, siblings)
        }
      }
    }

    uncleToCousins = new Map()
  }

  return common
}

export const CommonUncleSiblings = commonUncleSiblings
