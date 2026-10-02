# ADR-040: Placement Child Ordering (`PlaceChildrenOrder`) (Slice 39)

## Status
Implemented — awaiting Slice 39 review

## Context
During container layout in TALA's placement stage, container children must be placed in a deterministic topological and component-connected order so that subsequent orthogonal layout and cluster sizing operate predictably.

Pinned reference:
- `d2layouts/d2talalayout/internal/placement/node_placement.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
func PlaceChildrenOrder(ctx context.Context, nodes []*layoutgraph.Node, edgeAbductions []*layoutgraph.EdgeAbduction) ([]*layoutgraph.Node, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
	}
	expected := make(map[*layoutgraph.Node]struct{}, len(nodes))
	connected := make(map[*layoutgraph.Node]map[*layoutgraph.Node]struct{}, len(nodes))
	for _, node := range nodes {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
		}
		if node == nil {
			return nil, invariant.New("container has a nil child")
		}
		if _, duplicate := expected[node]; duplicate {
			return nil, invariant.Errorf("container has duplicate child %s", node.DebugID())
		}
		expected[node] = struct{}{}
		connected[node] = make(map[*layoutgraph.Node]struct{})
	}
	for _, edgeAbduction := range edgeAbductions {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
		}
		if edgeAbduction == nil {
			return nil, invariant.New("child ordering has a nil edge abduction")
		}
		from := edgeAbduction.CurrentFrom
		to := edgeAbduction.CurrentTo
		if _, ok := expected[from]; ok {
			if _, adjacent := expected[to]; adjacent {
				connected[from][to] = struct{}{}
			}
		}
		if _, ok := expected[to]; ok {
			if _, adjacent := expected[from]; adjacent {
				connected[to][from] = struct{}{}
			}
		}
	}

	ordered := make([]*layoutgraph.Node, 0, len(nodes))
	orderedSet := make(map[*layoutgraph.Node]struct{}, len(nodes))
	appendNode := func(node *layoutgraph.Node) {
		ordered = append(ordered, node)
		orderedSet[node] = struct{}{}
		delete(connected, node)
	}
	for _, node := range nodes {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
		}
		if len(connected[node]) == 0 {
			appendNode(node)
		}
	}

	for len(ordered) < len(nodes) {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
		}
		leastDegree := len(nodes) + 1
		var start *layoutgraph.Node
		for _, node := range nodes {
			adjacent, pending := connected[node]
			if pending && len(adjacent) < leastDegree {
				leastDegree = len(adjacent)
				start = node
			}
		}
		if start == nil {
			return nil, invariant.New("could not order all container children")
		}

		visited := make(map[*layoutgraph.Node]struct{})
		queue := []*layoutgraph.Node{start}
		for len(queue) > 0 {
			if err := ctx.Err(); err != nil {
				return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
			}
			current := queue[0]
			queue = queue[1:]
			if _, seen := visited[current]; seen {
				continue
			}
			visited[current] = struct{}{}
			if _, alreadyOrdered := orderedSet[current]; alreadyOrdered {
				continue
			}
			appendNode(current)
			for _, edgeAbduction := range edgeAbductions {
				var adjacent *layoutgraph.Node
				if edgeAbduction.CurrentFrom == current {
					adjacent = edgeAbduction.CurrentTo
				} else if edgeAbduction.CurrentTo == current {
					adjacent = edgeAbduction.CurrentFrom
				}
				if _, ok := expected[adjacent]; ok {
					queue = append(queue, adjacent)
				}
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("PlaceChildrenOrder: %w", err)
	}
	return ordered, nil
}
```

## Decisions & Parity Rules
1. **Direct Context Cancellation Semantics**: Cancellation checks poll `ctx.isCancelled()` / `ctx.aborted` directly via `checkPlaceChildrenOrderCancellation(context)` matching Go's `ctx.Err()`. When canceled, throws `WorkCanceledError("PlaceChildrenOrder")` with message `"PlaceChildrenOrder: context canceled"`.
2. **Cancellation Check Placement**: Cancellation is polled at 7 distinct locations:
   - Function entry before any data structure allocations.
   - Inside each iteration of `nodes` validation scan (preceding nil/duplicate checks).
   - Inside each iteration of `edgeAbductions` validation scan (preceding nil check).
   - Inside each iteration of the isolated nodes scan.
   - At the top of each connected component outer loop (`while (ordered.length < sourceNodes.length)`).
   - For every popped queue item in the BFS loop (including duplicate/stale entries).
   - Post-loop completion check right before returning `ordered`.
3. **Nil Slices & Null Input Handling**: When `nodes` or `edgeAbductions` is `null` or `undefined`, it defaults to `[]`. A successful empty call returns a fresh `[]` (not `null` or `undefined`).
4. **Isolated Nodes Emitted First**: Nodes with 0 connections to other container children in `expected` are emitted first, preserving their relative source order in `nodes`.
5. **Component Starting Node Selection**: For connected components, the starting node is the node with the minimum degree (number of remaining connected neighbors in `expected`). In case of degree ties, the first node encountered in the source `nodes` array order is chosen.
6. **BFS Queue and Traversal**:
   - Traversal scans the raw `edgeAbductions` list (not pre-built adjacency lists), preserving original abduction order.
   - Both forward (`CurrentFrom === current`) and reverse (`CurrentTo === current`) directions are traversed.
   - Duplicate queue entries are allowed and safely skipped via `visited` and `orderedSet` guards.
   - Duplicate queue entries still poll context cancellation on dequeue.
7. **Identity-Based Membership**: `expected`, `connected`, `visited`, and `orderedSet` operate strictly on object reference equality (`Set`/`Map`), not `node.ID`.
8. **Invariant Violations**:
   - `node == null`: throws `"layout invariant violated: container has a nil child"`.
   - duplicate child reference: throws `"layout invariant violated: container has duplicate child <DebugID>"`.
   - `edgeAbduction == null`: throws `"layout invariant violated: child ordering has a nil edge abduction"`.
   - unresolvable ordering: throws `"layout invariant violated: could not order all container children"`.
9. **Exports & Barrel Structure**:
   - Implemented and exported directly from `src/placement/node-placement.js` (`placeChildrenOrder` and alias `PlaceChildrenOrder`).
   - NOT re-exported from `src/placement/index.js`.
   - NOT exposed from root `src/index.js`.
   - This avoids widening the public package API before placement orchestration is migrated.

## Verification
- Real Go oracle program: `test/reference/go_place_children_order_oracle.go` covering 45 scenarios (A–AS).
- Generated oracle fixtures: `test/fixtures/go-place-children-order-reference.json`.
- Oracle replay test: `test/unit/place-children-order-oracle.test.js` (45/45 PASS).
- Direct unit tests: `test/unit/place-children-order.test.js` (57/57 PASS).
- Go regression packages: `github.com/d2lang/d2/d2layouts/d2talalayout/internal/placement` (PASS).
