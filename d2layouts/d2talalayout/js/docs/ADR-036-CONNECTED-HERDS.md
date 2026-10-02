# ADR-036: Connected Herd Components (`connectedHerds`) (Slice 35)

## Status
Implemented — awaiting Slice 35 review

## Context
In TALA's proximity pipeline, `proximity.connectedHerds(ctx, herdOrder, herds)` joins uncle groups that share at least one node into connected components, retaining deterministic source order.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
type herdComponent struct {
	nodes  []*layoutgraph.Node
	uncles []*layoutgraph.Node
}

// connectedHerds joins groups that share a node, retaining deterministic order.
func connectedHerds(
	ctx context.Context,
	herdOrder []*layoutgraph.Node,
	herds map[*layoutgraph.Node][]*layoutgraph.Node,
) ([]herdComponent, error) {
	byNode := make(map[*layoutgraph.Node][]*layoutgraph.Node)

	for _, uncle := range herdOrder {
		for _, node := range herds[uncle] {
			byNode[node] = append(byNode[node], uncle)
		}
	}

	seenUncles := make(map[*layoutgraph.Node]bool)
	seenNodes := make(map[*layoutgraph.Node]bool)

	var components []herdComponent

	for _, uncle := range herdOrder {
		if seenUncles[uncle] {
			continue
		}

		component := herdComponent{
			uncles: []*layoutgraph.Node{uncle},
		}

		seenUncles[uncle] = true

		for i := 0; i < len(component.uncles); i++ {
			if err := ctx.Err(); err != nil {
				return nil, fmt.Errorf("AssignHerds: %w", err)
			}

			for _, node := range herds[component.uncles[i]] {
				if seenNodes[node] {
					continue
				}

				seenNodes[node] = true
				component.nodes = append(component.nodes, node)

				for _, related := range byNode[node] {
					if !seenUncles[related] {
						seenUncles[related] = true
						component.uncles =
							append(component.uncles, related)
					}
				}
			}
		}

		components = append(components, component)
	}

	return components, nil
}
```

## Decisions

1. **Module Export Boundary & Package-Private Parity**:
   Because `connectedHerds` is unexported in Go, it is exported at the module level in `src/proximity/herding.js` for unit testing and internal proximity calls (such as the upcoming `AssignHerds`), but:
   - It is NOT exported from `src/proximity/index.js`.
   - It has NO PascalCase alias `ConnectedHerds`.
   - It is NOT exported from root `src/index.js`.

2. **Return Shape and Go Nil-Slice Semantics**:
   - `var components []herdComponent`: If no components are created (e.g. empty or nil `herdOrder`), Go returns `nil`. In JS, `connectedHerds` returns `null` (not `[]`).
   - `component.nodes`: Starts as `nil` in Go. In JS, `component.nodes` remains `null` if zero nodes are appended to the component. Only upon appending the first node is `component.nodes` initialized to `[]`.
   - `component.uncles`: In Go, `uncles: []*layoutgraph.Node{uncle}` is initialized with the seed uncle. In JS, `component.uncles = [uncle]`.

3. **Two-Phase Algorithm**:
   - **Phase 1 (`byNode` mapping)**:
     Constructs `byNode: Map<Node, Node[]>`. For each uncle in `herdOrder`, appends the uncle to `byNode[node]` for each node in `herds.get(uncle)`.
     Crucially, Phase 1 performs NO deduplication, NO sorting, and NO cancellation polling.
   - **Phase 2 (Component Expansion)**:
     Iterates through `herdOrder`. If the uncle is already in global `seenUncles`, it is skipped without polling cancellation.
     For each new seed uncle, a component is created and expanded via a FIFO queue (`for (let i = 0; i < component.uncles.length; i++)`).

4. **Global Sets (`seenUncles` and `seenNodes`)**:
   - Both `seenUncles` and `seenNodes` are initialized once at the start of Phase 2 and are shared globally across all components.
   - A node added to one component is never added to another component.
   - An uncle discovered or expanded is never re-expanded or used as an outer loop seed.

5. **Cancellation Check Timing & Placement**:
   - Cancellation is polled via `checkAssignHerdsCancellation(context)` EXACTLY once at the beginning of each uncle expansion:
     ```js
     for (let i = 0; i < component.uncles.length; i++) {
       checkAssignHerdsCancellation(context);
       ...
     }
     ```
   - No check is made on function entry.
   - No check is made during Phase 1 (`byNode` build).
   - If `herdOrder` is empty or `null`, zero context checks occur, and even an aborted or cancelled context succeeds with `null`.
   - If `context` is `null`/`undefined` and `herdOrder` is non-empty, the first uncle expansion naturally fails with `TypeError`.

6. **FIFO / BFS Expansion**:
   - Uncle expansion uses the `component.uncles` array itself as the work queue.
   - When a node reveals related uncles in `byNode[node]`, any unseen uncle is marked seen and pushed to `component.uncles`.
   - This ensures BFS/FIFO ordering rather than DFS/stack ordering.

7. **Nil Uncles and Nil Nodes Support**:
   - In Go, `nil` pointers are valid map keys and slice elements.
   - In JS, `null` uncle seeds and `null` node elements are supported as valid `Map` keys and `Set` members.
   - If multiple uncles contain `null` in their herds, `null` acts as a connecting node and unites the uncles into a single component, matching Go pointer-equality semantics.

8. **Zero Input Mutation**:
   - `connectedHerds` does not mutate `herdOrder`, `herds`, node objects, or any internal properties.
   - No workguards, transaction managers, or sorting are used.

9. **In-Package Go Oracle Bridge**:
   - Because `connectedHerds` is unexported, an external oracle cannot call it.
   - A bridge template is stored at `test/reference/go_connected_herds_oracle_test.go` with `package proximity`.
   - Fixture generation temporarily copies this test into `internal/proximity/connected_herds_oracle_test.go`, executes `go test`, writes `test/fixtures/go-connected-herds-reference.json`, and immediately deletes the temporary test file.
   - Zero changes remain in `d2layouts/d2talalayout/internal/proximity/`.
