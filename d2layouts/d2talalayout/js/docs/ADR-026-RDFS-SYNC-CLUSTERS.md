# ADR-026: RDFS Traversal Parity & Graph SyncClusters

## Status
Implemented — awaiting Slice 25 review

## Context
In D2's layout engine (specifically TALA), tree structures, cluster groups, sequence groups, and containers form a hierarchical layout topology. Two fundamental operations govern this hierarchy:
1. `Node.rdfsWalk(applyFunc)` / `Node.WalkRDFS(applyFunc)`: a post-order depth-first traversal of a node and its descendants across container children, cluster members, and sequence steps.
2. `Graph.syncClusters()` / `Graph.SyncClusters()`: traverses `Graph.Nodes` in source order via `rdfsWalk`, synchronizing every active cluster vessel in nested post-order via the outer graph's `Clusters` map.

In pinned Go TALA (`d2lang/d2@01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`), the implementations are defined in:
- `d2layouts/d2talalayout/internal/layoutgraph/node.go:2324-2342` (`rdfsWalk`)
- `d2layouts/d2talalayout/internal/layoutgraph/structure_api.go:80-82` (`WalkRDFS`)
- `d2layouts/d2talalayout/internal/layoutgraph/cluster.go:205-218` (`SyncClusters`)

```go
func (n *Node) rdfsWalk(applyFunc func(*Node)) {
	if n.isContainer {
		for _, childNode := range n.Graph.Containers[n] {
			childNode.rdfsWalk(applyFunc)
		}
	}

	if n.isClusterVessel {
		for _, cn := range n.Graph.Clusters[n].Nodes {
			cn.rdfsWalk(applyFunc)
		}
	} else if s, is := n.Graph.Sequences[n]; is {
		for _, step := range s.Nodes {
			step.rdfsWalk(applyFunc)
		}
	}

	applyFunc(n)
}

func (g *Graph) SyncClusters() {
	if len(g.Clusters) == 0 {
		return
	}

	sync := func(n *Node) {
		if n.isClusterVessel {
			g.Clusters[n].SyncGeometry()
		}
	}
	for _, n := range g.Nodes {
		n.rdfsWalk(sync)
	}
}
```

## Decisions & Invariants

### 1. RDFS Post-Order Traversal
- **Container children first**: If `n.isContainer` is true, iterate `n.Graph.Containers.get(n) ?? []` in source array order without sorting or reverse.
- **Cluster members or sequence steps second**:
  - If `n.isClusterVessel` is true, iterate `n.Graph.Clusters.get(n).Nodes` in source array order.
  - Else if `n.Graph.Sequences.get(n) !== undefined`, iterate `sequence.Nodes` in source array order.
- **Cluster branch overrides sequence branch**: If a node is marked `isClusterVessel == true` and also present in `Graph.Sequences`, sequence steps are skipped.
- **Callback last**: `applyFunc(this)` is invoked strictly after all descendants have been visited.

### 2. Natural Failure Parity
- **No defensive Graph-null checks**: Pinned Go dereferences `n.Graph` directly. If `n.Graph == null`, `rdfsWalk` throws naturally before invoking `applyFunc`.
- **Container missing key allowed**: If `isContainer` is true but `Containers` has no key, it safely evaluates to an empty array (matching Go's nil slice `range nil`), progressing to group checks and callback.
- **Missing cluster mapping for marked vessel fails**: If `isClusterVessel` is true and `Clusters` has no key or null, accessing `.Nodes` throws naturally.
- **Missing sequence key vs present-null distinction**:
  - Missing key: `this.Graph.Sequences.get(this)` is `undefined`, so `sequence !== undefined` is false and it skips cleanly.
  - Present with null value: `sequence` is `null` (`!== undefined`), so accessing `sequence.Nodes` throws naturally.
- **Nil children/members/steps fail before callback**: Any `null` reference encountered in container children, cluster members, or sequence steps fails immediately before the parent/vessel callback.

### 3. No Deduplication or Cycle Protection
- RDFS does not track a `visited` or `seen` Set.
- If a child reference appears multiple times (e.g. duplicate container children or shared aliases), it is visited multiple times.
- No artificial cycle detection or recursion truncation is added.

### 4. Graph.SyncClusters Semantics
- **Empty Clusters map early return**: If `!this.Clusters || this.Clusters.size === 0`, `SyncClusters` returns immediately without inspecting `this.Nodes` (even if `this.Nodes` contains malformed elements).
- **Source order traversal**: Iterates `this.Nodes` strictly in array order. No `ClusterOrder()`, no `clusterRDFSOrder()`, no sorting.
- **Vessel flag vs map membership**: The callback tests `if (node.isClusterVessel)`. Nodes in `Clusters` without `isClusterVessel == true` are not synchronized.
- **Outer graph cluster lookup**: Callback invokes `this.Clusters.get(node).SyncGeometry()` where `this` is the outer graph executing `SyncClusters()`. Traversal topology originates from `node.Graph`, but cluster resolution comes from the outer graph.
- **Nested cluster post-order**: Because `rdfsWalk` is post-order, inner cluster vessels are synchronized before outer cluster vessels, allowing outer clusters to dimension themselves from the stabilized inner vessel geometry.
- **Procedural and nontransactional**: No rollback, no state snapshot, no transaction abstraction. If traversal fails on a subsequent node, earlier cluster synchronizations remain committed.
- **Unmetered**: No `WorkGuard`, no step limits.

### 5. SyncSequences Reused Unchanged
- `Graph.SyncSequences()` already relies on `node.rdfsWalk(sync)` and continues to operate unchanged under the corrected `rdfsWalk`.
