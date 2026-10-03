package placement

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type PointJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type SizelessOracleFixture struct {
	OptimizationWorkGuard    []WorkGuardScenarioJSON    `json:"optimizationWorkGuard"`
	OptimizationShuffle      []ShuffleScenarioJSON      `json:"optimizationShuffle"`
	PlacementCostSnapshot    []CostSnapshotScenarioJSON `json:"placementCostSnapshot"`
	PointerSnapshots         []PointerScenarioJSON      `json:"pointerSnapshots"`
	OptimizerAdjacents       []AdjacentsScenarioJSON    `json:"optimizerAdjacents"`
	OptimizerMedian          []MedianScenarioJSON       `json:"optimizerMedian"`
	OptimizerDescendants     []DescendantsScenarioJSON  `json:"optimizerDescendants"`
	OptimizerMove            []MoveScenarioJSON         `json:"optimizerMove"`
	OptimizerSwap            []SwapScenarioJSON         `json:"optimizerSwap"`
	CandidateMovement        []CandMoveScenarioJSON     `json:"candidateMovement"`
	SizelessSetup            []SetupScenarioJSON        `json:"sizelessSetup"`
	MedianPoint              []MedianPointScenarioJSON  `json:"medianPoint"`
	ClosestDistance          []DistanceScenarioJSON     `json:"closestDistance"`
	PlacementPoints          []PointsScenarioJSON       `json:"placementPoints"`
	MoveNodeToBest           []MoveToBestScenarioJSON   `json:"moveNodeToBest"`
	SwapCandidates           []SwapCandScenarioJSON     `json:"swapCandidates"`
	BestSwap                 []BestSwapScenarioJSON     `json:"bestSwap"`
	SizelessOptimize         []OptimizeScenarioJSON     `json:"sizelessOptimize"`
	InitializationCandidates []InitCandScenarioJSON     `json:"initializationCandidates"`
	InitializeNodes          []InitNodesScenarioJSON              `json:"initializeNodes"`
	Atomicity                []AtomicityScenarioJSON              `json:"atomicity"`
	MalformedReachability    []MalformedReachabilityScenarioJSON  `json:"malformedReachability"`
}

type MalformedReachabilityScenarioJSON struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	PanicsInGo bool   `json:"panicsInGo"`
}

type WorkGuardScenarioJSON struct {
	Name          string `json:"name"`
	Limit         uint64 `json:"limit,string"`
	Action        string `json:"action"`
	Amount        uint64 `json:"amount,string,omitempty"`
	A             uint64 `json:"a,string,omitempty"`
	B             uint64 `json:"b,string,omitempty"`
	SortLength    int    `json:"sortLength,omitempty"`
	CancelAt      int    `json:"cancelAt,omitempty"`
	ExpectedUsed  uint64 `json:"expectedUsed,string"`
	ExpectedError string `json:"expectedError,omitempty"`
}

type ShuffleScenarioJSON struct {
	Name       string   `json:"name"`
	Count      int      `json:"count"`
	Seed       int64    `json:"seed,string"`
	Result     []int    `json:"result"`
	NextInt63  int64    `json:"nextInt63,string"`
	Used       uint64   `json:"used,string"`
	IsRejected bool     `json:"isRejected,omitempty"`
	N          int32    `json:"n,omitempty"`
	Draws      uint64   `json:"draws,string,omitempty"`
	Chosen     int32    `json:"chosen,omitempty"`
}

type CostSnapshotScenarioJSON struct {
	Name            string             `json:"name"`
	InitialCache    map[string]float64 `json:"initialCache,omitempty"`
	CrossingCost    float64            `json:"crossingCost"`
	TurnCost        float64            `json:"turnCost"`
	NonCenterPort   float64            `json:"nonCenterPort"`
	MutateBefore    bool               `json:"mutateBefore"`
	DisabledCache   bool               `json:"disabledCache,omitempty"`
	RestoredCache   map[string]float64 `json:"restoredCache,omitempty"`
	RestoredCrossing float64           `json:"restoredCrossing"`
	RestoredTurn    float64            `json:"restoredTurn"`
	RestoredPort    float64            `json:"restoredPort"`
}

type PointerScenarioJSON struct {
	Name        string     `json:"name"`
	Initial     *PointJSON `json:"initial,omitempty"`
	MutatedX    float64    `json:"mutatedX"`
	MutatedY    float64    `json:"mutatedY"`
	Restored    *PointJSON `json:"restored,omitempty"`
}

type AdjacentsScenarioJSON struct {
	Name        string   `json:"name"`
	NodeID      string   `json:"nodeId"`
	AdjacentIDs []string `json:"adjacentIds"`
}

type MedianScenarioJSON struct {
	Name         string      `json:"name"`
	IncludeSizes bool        `json:"includeSizes"`
	Points       []PointJSON `json:"points"`
	Dimensions   []PointJSON `json:"dimensions,omitempty"`
	CellSize     float64     `json:"cellSize"`
	MedianX      float64     `json:"medianX"`
	MedianY      float64     `json:"medianY"`
	Error        string      `json:"error,omitempty"`
}

type DescendantsScenarioJSON struct {
	Name           string   `json:"name"`
	RootID         string   `json:"rootId"`
	DescendantIDs  []string `json:"descendantIds"`
}

type MoveScenarioJSON struct {
	Name          string                `json:"name"`
	NodeID        string                `json:"nodeId"`
	TargetX       float64               `json:"targetX"`
	TargetY       float64               `json:"targetY"`
	NodePositions map[string]*PointJSON `json:"nodePositions"`
}

type SwapScenarioJSON struct {
	Name          string                `json:"name"`
	NodeAID       string                `json:"nodeAId"`
	NodeBID       string                `json:"nodeBId"`
	NodePositions map[string]*PointJSON `json:"nodePositions"`
}

type CandMoveScenarioJSON struct {
	Name           string                `json:"name"`
	NodeID         string                `json:"nodeId"`
	DescendantWork uint64                `json:"descendantWork,string"`
	TargetX        float64               `json:"targetX"`
	TargetY        float64               `json:"targetY"`
	NodePositions  map[string]*PointJSON `json:"nodePositions"`
}

type SetupScenarioJSON struct {
	Name             string   `json:"name"`
	OptimizableNodes []string `json:"optimizableNodes"`
	ExcludedNodes    []string `json:"excludedNodes"`
	Error            string   `json:"error,omitempty"`
}

type MedianPointScenarioJSON struct {
	Name    string    `json:"name"`
	NodeID  string    `json:"nodeId"`
	Temp    float64   `json:"temp"`
	Seed    int64     `json:"seed"`
	MedianP PointJSON `json:"medianPoint"`
}

type DistanceScenarioJSON struct {
	Name     string     `json:"name"`
	NodeID   string     `json:"nodeId"`
	MedianP  PointJSON  `json:"medianPoint"`
	Distance float64    `json:"distance"`
	Error    string     `json:"error,omitempty"`
}

type PointsScenarioJSON struct {
	Name     string      `json:"name"`
	NodeID   string      `json:"nodeId"`
	MedianP  PointJSON   `json:"medianPoint"`
	Distance float64     `json:"distance"`
	Points   []PointJSON `json:"points"`
}

type MoveToBestScenarioJSON struct {
	Name          string                `json:"name"`
	NodeID        string                `json:"nodeId"`
	Points        []PointJSON           `json:"points"`
	Moved         bool                  `json:"moved"`
	FinalPosition PointJSON             `json:"finalPosition"`
	AllPositions  map[string]*PointJSON `json:"allPositions"`
}

type SwapCandScenarioJSON struct {
	Name         string   `json:"name"`
	NodeID       string   `json:"nodeId"`
	CandidateIDs []string `json:"candidateIds"`
}

type BestSwapScenarioJSON struct {
	Name         string `json:"name"`
	NodeID       string `json:"nodeId"`
	BestSwapID   string `json:"bestSwapId,omitempty"`
	HasCandidate bool   `json:"hasCandidate"`
}

type OptimizeScenarioJSON struct {
	Name          string                `json:"name"`
	Temp          float64               `json:"temp"`
	Seed          int64                 `json:"seed"`
	FinalPositions map[string]*PointJSON `json:"finalPositions"`
}

type InitCandScenarioJSON struct {
	Name              string      `json:"name"`
	NodeID            string      `json:"nodeId"`
	IsMajorityTarget  bool        `json:"isMajorityTarget"`
	Positions         []PointJSON `json:"positions"`
}

type InitNodesScenarioJSON struct {
	Name          string                `json:"name"`
	FinalPositions map[string]*PointJSON `json:"finalPositions"`
}

type AtomicityScenarioJSON struct {
	Name          string                `json:"name"`
	RestoredNodes map[string]*PointJSON `json:"restoredNodes"`
}

type countingContext struct {
	context.Context
	count    int
	cancelAt int
}

func (c *countingContext) Err() error {
	c.count++
	if c.cancelAt > 0 && c.count >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func addTestEdge(g *layoutgraph.Graph, from, to *layoutgraph.Node) *layoutgraph.Edge {
	e := layoutgraph.NewEdge(from, to)
	from.Edges = append(from.Edges, e)
	to.Edges = append(to.Edges, e)
	g.AddEdge(e)
	return e
}

func TestGenerateSizelessOptimizerOracleFixture(t *testing.T) {
	fixture := SizelessOracleFixture{}

	// ==========================================
	// 1. optimizationWorkGuard
	// ==========================================
	// Step, Add(0), limits W-1, W, W+1, overflow, AddProduct, AddSort
	{
		// W-1 / W / W+1
		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "testGuard", 10)
		_ = guard.Add(9)
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_w_minus_1", Limit: 10, Action: "add", Amount: 9, ExpectedUsed: 9,
		})

		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", 10)
		_ = guard.Add(10)
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_exact_w", Limit: 10, Action: "add", Amount: 10, ExpectedUsed: 10,
		})

		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", 10)
		err := guard.Add(11)
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_w_plus_1_exceeds", Limit: 10, Action: "add", Amount: 11, ExpectedUsed: 0, ExpectedError: errStr,
		})

		// Add(0) doesn't charge work
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", 10)
		_ = guard.Add(5)
		_ = guard.Add(0)
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_zero_retains_used", Limit: 10, Action: "add", Amount: 0, ExpectedUsed: 5,
		})

		// MaxUint64 overflow in Add
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", math.MaxUint64)
		_ = guard.Add(math.MaxUint64)
		err = guard.Step()
		errStr = ""
		if err != nil {
			errStr = err.Error()
		}
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_overflow", Limit: math.MaxUint64, Action: "step", ExpectedUsed: math.MaxUint64, ExpectedError: errStr,
		})

		// AddProduct overflow
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", math.MaxUint64)
		err = guard.AddProduct(math.MaxUint64, 2)
		errStr = ""
		if err != nil {
			errStr = err.Error()
		}
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "add_product_overflow", Limit: math.MaxUint64, Action: "addProduct", A: math.MaxUint64, B: 2, ExpectedUsed: 0, ExpectedError: errStr,
		})

		// AddSort counts: 0, 1, 2, 3, 4, 127, 128, 129, 1024
		for _, sortLen := range []int{0, 1, 2, 3, 4, 127, 128, 129, 1024} {
			guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "testGuard", limits.MaxOptimizationWorkUnits)
			_ = guard.AddSort(sortLen)
			fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
				Name: fmt.Sprintf("add_sort_%d", sortLen), Limit: limits.MaxOptimizationWorkUnits, Action: "addSort", SortLength: sortLen, ExpectedUsed: guard.Used(),
			})
		}

		// 64 stride cancellation boundary
		// 63->64 polls context, 64->65 does not poll
		cntCtx := &countingContext{Context: context.Background(), cancelAt: 2} // 1 in New, 2 on boundary
		guard, _ = limits.NewOptimizationWorkGuard(cntCtx, "testGuard", 100)
		_ = guard.Add(63) // 63 / 64 == 0
		err = guard.Step() // 64 / 64 == 1 => polls Err => cancelAt 2 triggers
		errStr = ""
		if err != nil {
			errStr = err.Error()
		}
		fixture.OptimizationWorkGuard = append(fixture.OptimizationWorkGuard, WorkGuardScenarioJSON{
			Name: "cancel_at_64_boundary", Limit: 100, Action: "step", CancelAt: 2, ExpectedUsed: 64, ExpectedError: errStr,
		})
	}

	// ==========================================
	// 2. optimizationShuffle
	// ==========================================
	{
		for _, count := range []int{0, 1, 2, 3, 10, 127, 1024} {
			values := make([]int, count)
			for i := range values {
				values[i] = i
			}
			rnd := rand.New(rand.NewSource(991))
			guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "shuffle", limits.MaxOptimizationWorkUnits)
			_ = limits.Shuffle(values, rnd, guard)
			fixture.OptimizationShuffle = append(fixture.OptimizationShuffle, ShuffleScenarioJSON{
				Name: fmt.Sprintf("shuffle_count_%d", count), Count: count, Seed: 991, Result: values, NextInt63: rnd.Int63(), Used: guard.Used(),
			})
		}
	}

	// ==========================================
	// 3. placementCostSnapshot
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		g.StoreEdgeLengthCost(12345, 42.5)
		g.StoreEdgeLengthCost(67890, 99.0)
		snap := g.SnapshotPlacementCosts()
		g.StoreEdgeLengthCost(12345, 999.0)
		g.StoreEdgeLengthCost(11111, 11.0)
		snap.Restore()

		c1, _ := g.LookupEdgeLengthCost(12345)
		c2, _ := g.LookupEdgeLengthCost(67890)
		_, ok3 := g.LookupEdgeLengthCost(11111)

		restoredMap := map[string]float64{
			"12345": c1,
			"67890": c2,
		}
		if ok3 {
			restoredMap["11111"] = 11.0
		}
		fixture.PlacementCostSnapshot = append(fixture.PlacementCostSnapshot, CostSnapshotScenarioJSON{
			Name: "cache_restore_identity_and_values",
			InitialCache: map[string]float64{"12345": 42.5, "67890": 99.0},
			MutateBefore: true,
			RestoredCache: restoredMap,
		})
	}

	// ==========================================
	// 4. pointerSnapshots
	// ==========================================
	{
		pt := geo.NewPoint(10, 20)
		snap := snapshotPointer(pt)
		pt.X = 100
		pt.Y = 200
		restoredPt := snap.restore()
		fixture.PointerSnapshots = append(fixture.PointerSnapshots, PointerScenarioJSON{
			Name: "pointer_restore_identity",
			Initial: &PointJSON{X: 10, Y: 20},
			MutatedX: 100, MutatedY: 200,
			Restored: &PointJSON{X: restoredPt.X, Y: restoredPt.Y},
		})

		snapNil := snapshotPointer[geo.Point](nil)
		restoredNil := snapNil.restore()
		fixture.PointerSnapshots = append(fixture.PointerSnapshots, PointerScenarioJSON{
			Name: "nil_pointer_restore",
			Initial: nil,
			Restored: func() *PointJSON {
				if restoredNil == nil {
					return nil
				}
				return &PointJSON{X: restoredNil.X, Y: restoredNil.Y}
			}(),
		})
	}

	// ==========================================
	// 5. optimizerMedian
	// ==========================================
	{
		// Singleton sizeless
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n1 := layoutgraph.NewNode(1, 20, 30)
		n1.TopLeft = geo.NewPoint(5, 7)
		n1.Graph = g
		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "median", limits.MaxOptimizationWorkUnits)
		mx, my, _ := optimizerMedian(layoutgraph.Nodes{n1}, false, guard)
		fixture.OptimizerMedian = append(fixture.OptimizerMedian, MedianScenarioJSON{
			Name: "singleton_sizeless", IncludeSizes: false, Points: []PointJSON{{X: 5, Y: 7}}, CellSize: 10, MedianX: mx, MedianY: my,
		})

		// Singleton sized
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "median", limits.MaxOptimizationWorkUnits)
		mx, my, _ = optimizerMedian(layoutgraph.Nodes{n1}, true, guard)
		fixture.OptimizerMedian = append(fixture.OptimizerMedian, MedianScenarioJSON{
			Name: "singleton_sized", IncludeSizes: true, Points: []PointJSON{{X: 5, Y: 7}}, Dimensions: []PointJSON{{X: 20, Y: 30}}, CellSize: 10, MedianX: mx, MedianY: my,
		})

		// 3 nodes (odd)
		n2 := layoutgraph.NewNode(2, 20, 30)
		n2.TopLeft = geo.NewPoint(1, 15)
		n2.Graph = g
		n3 := layoutgraph.NewNode(3, 20, 30)
		n3.TopLeft = geo.NewPoint(10, 2)
		n3.Graph = g
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "median", limits.MaxOptimizationWorkUnits)
		mx, my, _ = optimizerMedian(layoutgraph.Nodes{n1, n2, n3}, false, guard)
		fixture.OptimizerMedian = append(fixture.OptimizerMedian, MedianScenarioJSON{
			Name: "three_nodes_sizeless", IncludeSizes: false, Points: []PointJSON{{X: 5, Y: 7}, {X: 1, Y: 15}, {X: 10, Y: 2}}, CellSize: 10, MedianX: mx, MedianY: my,
		})

		// 4 nodes (even) with tie
		n4 := layoutgraph.NewNode(4, 20, 30)
		n4.TopLeft = geo.NewPoint(5, 7) // tie with n1
		n4.Graph = g
		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "median", limits.MaxOptimizationWorkUnits)
		mx, my, _ = optimizerMedian(layoutgraph.Nodes{n1, n2, n3, n4}, false, guard)
		fixture.OptimizerMedian = append(fixture.OptimizerMedian, MedianScenarioJSON{
			Name: "four_nodes_sizeless_tie", IncludeSizes: false, Points: []PointJSON{{X: 5, Y: 7}, {X: 1, Y: 15}, {X: 10, Y: 2}, {X: 5, Y: 7}}, CellSize: 10, MedianX: mx, MedianY: my,
		})
	}

	// ==========================================
	// 6. optimizerAdjacents
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		n3 := g.AddNode(layoutgraph.NewNode(3, 10, 10))
		n1.TopLeft = geo.NewPoint(0, 0)
		n2.TopLeft = geo.NewPoint(2, 0)
		n3.TopLeft = geo.NewPoint(0, 2)
		addTestEdge(g, n1, n2)
		addTestEdge(g, n1, n3)

		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "adj", limits.MaxOptimizationWorkUnits)
		adj, _ := optimizerAdjacents(n1, nil, guard)
		ids := make([]string, len(adj))
		for i, n := range adj {
			ids[i] = fmt.Sprintf("%d", n.ID)
		}
		fixture.OptimizerAdjacents = append(fixture.OptimizerAdjacents, AdjacentsScenarioJSON{
			Name: "incident_edges_adjacent", NodeID: "1", AdjacentIDs: ids,
		})
	}

	// ==========================================
	// 7. optimizerDescendants
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		c := g.AddNode(layoutgraph.NewNode(10, 100, 100))
		child1 := g.AddNode(layoutgraph.NewNode(11, 20, 20))
		child2 := g.AddNode(layoutgraph.NewNode(12, 20, 20))
		g.AddNodeToContainer(c, child1)
		g.AddNodeToContainer(c, child2)

		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "desc", limits.MaxOptimizationWorkUnits)
		desc, _ := optimizerDescendants(c, guard)
		ids := make([]string, len(desc))
		for i, n := range desc {
			ids[i] = fmt.Sprintf("%d", n.ID)
		}
		fixture.OptimizerDescendants = append(fixture.OptimizerDescendants, DescendantsScenarioJSON{
			Name: "container_children_descendants", RootID: "10", DescendantIDs: ids,
		})
	}

	// ==========================================
	// 8. optimizerMove & optimizerSwap
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		n1.TopLeft = geo.NewPoint(5, 5)
		n2.TopLeft = geo.NewPoint(15, 15)

		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "move", limits.MaxOptimizationWorkUnits)
		_ = optimizerMoveNodeAbs(n1, 20, 30, guard)
		fixture.OptimizerMove = append(fixture.OptimizerMove, MoveScenarioJSON{
			Name: "leaf_move_abs", NodeID: "1", TargetX: 20, TargetY: 30,
			NodePositions: map[string]*PointJSON{"1": {X: n1.TopLeft.X, Y: n1.TopLeft.Y}},
		})

		guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "swap", limits.MaxOptimizationWorkUnits)
		_ = optimizerSwapPositions(n1, n2, guard)
		fixture.OptimizerSwap = append(fixture.OptimizerSwap, SwapScenarioJSON{
			Name: "swap_two_nodes", NodeAID: "1", NodeBID: "2",
			NodePositions: map[string]*PointJSON{
				"1": {X: n1.TopLeft.X, Y: n1.TopLeft.Y},
				"2": {X: n2.TopLeft.X, Y: n2.TopLeft.Y},
			},
		})
	}

	// ==========================================
	// 9. candidateMovement
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		c := g.AddNode(layoutgraph.NewNode(10, 100, 100))
		c.TopLeft = geo.NewPoint(0, 0)
		ch := g.AddNode(layoutgraph.NewNode(11, 20, 20))
		ch.TopLeft = geo.NewPoint(5, 5)
		g.AddNodeToContainer(c, ch)

		guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "candMove", limits.MaxOptimizationWorkUnits)
		mov, _ := captureOptimizerCandidateMovement(c, guard)
		_ = mov.moveAbs(10, 20, guard)
		fixture.CandidateMovement = append(fixture.CandidateMovement, CandMoveScenarioJSON{
			Name: "container_candidate_movement", NodeID: "10", DescendantWork: mov.descendantWork, TargetX: 10, TargetY: 20,
			NodePositions: map[string]*PointJSON{
				"10": {X: c.TopLeft.X, Y: c.TopLeft.Y},
				"11": {X: ch.TopLeft.X, Y: ch.TopLeft.Y},
			},
		})
	}

	// ==========================================
	// 10. sizelessSetup & canOptimize
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		n3 := g.AddNode(layoutgraph.NewNode(3, 10, 10)) // fixed
		n3.FixedTopLeft = geo.NewPoint(100, 100)
		n4 := g.AddNode(layoutgraph.NewNode(4, 10, 10)) // isolated no edges/nears
		_ = n4
		n1.TopLeft = geo.NewPoint(0, 0)
		n2.TopLeft = geo.NewPoint(1, 1)
		addTestEdge(g, n1, n2)

		optim, _ := newSizelessOptimizer(context.Background(), g, rand.New(rand.NewSource(1)))
		optIds := make([]string, len(optim.nodes))
		for i, n := range optim.nodes {
			optIds[i] = fmt.Sprintf("%d", n.ID)
		}
		fixture.SizelessSetup = append(fixture.SizelessSetup, SetupScenarioJSON{
			Name: "setup_filters_fixed_and_isolated", OptimizableNodes: optIds, ExcludedNodes: []string{"3", "4"},
		})
	}

	// ==========================================
	// 11. medianPoint, closestDistance, placementPoints
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		n1.TopLeft = geo.NewPoint(0, 0)
		n2.TopLeft = geo.NewPoint(5, 5)
		addTestEdge(g, n1, n2)

		for _, seed := range []int64{1, 2, 42, 991} {
			rnd := rand.New(rand.NewSource(seed))
			optim, _ := newSizelessOptimizer(context.Background(), g, rnd)
			guard, _ := limits.NewOptimizationWorkGuard(context.Background(), "medPoint", limits.MaxOptimizationWorkUnits)
			mp, _ := optim.medianPointGuarded(n1, 1.0, guard)
			fixture.MedianPoint = append(fixture.MedianPoint, MedianPointScenarioJSON{
				Name: fmt.Sprintf("median_point_seed_%d", seed), NodeID: "1", Temp: 1.0, Seed: seed, MedianP: PointJSON{X: mp.X, Y: mp.Y},
			})

			guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "dist", limits.MaxOptimizationWorkUnits)
			d, _ := optim.findClosestUnoccupiedDistanceGuarded(n1, mp, guard)
			fixture.ClosestDistance = append(fixture.ClosestDistance, DistanceScenarioJSON{
				Name: fmt.Sprintf("closest_distance_seed_%d", seed), NodeID: "1", MedianP: PointJSON{X: mp.X, Y: mp.Y}, Distance: d,
			})

			guard, _ = limits.NewOptimizationWorkGuard(context.Background(), "pts", limits.MaxOptimizationWorkUnits)
			pts, _ := optim.placementPointsGuarded(n1, mp, d, guard)
			ptsJSON := make([]PointJSON, len(pts))
			for i, p := range pts {
				ptsJSON[i] = PointJSON{X: p.X, Y: p.Y}
			}
			fixture.PlacementPoints = append(fixture.PlacementPoints, PointsScenarioJSON{
				Name: fmt.Sprintf("placement_points_seed_%d", seed), NodeID: "1", MedianP: PointJSON{X: mp.X, Y: mp.Y}, Distance: d, Points: ptsJSON,
			})
		}
	}

	// ==========================================
	// 12. sizelessOptimize & seeded determinism
	// ==========================================
	{
		for _, seed := range []int64{1, 2, 42, 991} {
			g := layoutgraph.NewGraph()
			g.CellSize = 10
			n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
			n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
			n3 := g.AddNode(layoutgraph.NewNode(3, 10, 10))
			n1.TopLeft = geo.NewPoint(0, 0)
			n2.TopLeft = geo.NewPoint(1, 1)
			n3.TopLeft = geo.NewPoint(2, 2)
			addTestEdge(g, n1, n2)
			addTestEdge(g, n2, n3)

			rnd := rand.New(rand.NewSource(seed))
			optim, _ := newSizelessOptimizer(context.Background(), g, rnd)
			_ = optim.optimize(context.Background(), 1.0)

			finalPositions := map[string]*PointJSON{
				"1": {X: n1.TopLeft.X, Y: n1.TopLeft.Y},
				"2": {X: n2.TopLeft.X, Y: n2.TopLeft.Y},
				"3": {X: n3.TopLeft.X, Y: n3.TopLeft.Y},
			}
			fixture.SizelessOptimize = append(fixture.SizelessOptimize, OptimizeScenarioJSON{
				Name: fmt.Sprintf("optimize_3_nodes_seed_%d", seed), Temp: 1.0, Seed: seed, FinalPositions: finalPositions,
			})
		}
	}

	// ==========================================
	// 13. initializationCandidates & initializeNodes
	// ==========================================
	{
		// 2-node edge
		g2 := layoutgraph.NewGraph()
		g2.CellSize = 10
		g2n1 := g2.AddNode(layoutgraph.NewNode(1, 10, 10))
		g2n2 := g2.AddNode(layoutgraph.NewNode(2, 10, 10))
		addTestEdge(g2, g2n1, g2n2)
		_ = initializeNodes(context.Background(), g2)
		fixture.InitializeNodes = append(fixture.InitializeNodes, InitNodesScenarioJSON{
			Name: "init_2_node_edge", FinalPositions: map[string]*PointJSON{
				"1": {X: g2n1.TopLeft.X, Y: g2n1.TopLeft.Y},
				"2": {X: g2n2.TopLeft.X, Y: g2n2.TopLeft.Y},
			},
		})

		// 3-node path
		g3 := layoutgraph.NewGraph()
		g3.CellSize = 10
		g3n1 := g3.AddNode(layoutgraph.NewNode(1, 10, 10))
		g3n2 := g3.AddNode(layoutgraph.NewNode(2, 10, 10))
		g3n3 := g3.AddNode(layoutgraph.NewNode(3, 10, 10))
		addTestEdge(g3, g3n1, g3n2)
		addTestEdge(g3, g3n2, g3n3)
		_ = initializeNodes(context.Background(), g3)
		fixture.InitializeNodes = append(fixture.InitializeNodes, InitNodesScenarioJSON{
			Name: "init_3_node_path", FinalPositions: map[string]*PointJSON{
				"1": {X: g3n1.TopLeft.X, Y: g3n1.TopLeft.Y},
				"2": {X: g3n2.TopLeft.X, Y: g3n2.TopLeft.Y},
				"3": {X: g3n3.TopLeft.X, Y: g3n3.TopLeft.Y},
			},
		})

		// Star graph (1 center, 3 leaves)
		gStar := layoutgraph.NewGraph()
		gStar.CellSize = 10
		sc := gStar.AddNode(layoutgraph.NewNode(1, 10, 10))
		sl1 := gStar.AddNode(layoutgraph.NewNode(2, 10, 10))
		sl2 := gStar.AddNode(layoutgraph.NewNode(3, 10, 10))
		sl3 := gStar.AddNode(layoutgraph.NewNode(4, 10, 10))
		addTestEdge(gStar, sc, sl1)
		addTestEdge(gStar, sc, sl2)
		addTestEdge(gStar, sc, sl3)
		_ = initializeNodes(context.Background(), gStar)
		fixture.InitializeNodes = append(fixture.InitializeNodes, InitNodesScenarioJSON{
			Name: "init_star_graph", FinalPositions: map[string]*PointJSON{
				"1": {X: sc.TopLeft.X, Y: sc.TopLeft.Y},
				"2": {X: sl1.TopLeft.X, Y: sl1.TopLeft.Y},
				"3": {X: sl2.TopLeft.X, Y: sl2.TopLeft.Y},
				"4": {X: sl3.TopLeft.X, Y: sl3.TopLeft.Y},
			},
		})

		// Near cycle
		gNear := layoutgraph.NewGraph()
		gNear.CellSize = 10
		nn1 := gNear.AddNode(layoutgraph.NewNode(1, 10, 10))
		nn2 := gNear.AddNode(layoutgraph.NewNode(2, 10, 10))
		nn3 := gNear.AddNode(layoutgraph.NewNode(3, 10, 10))
		nn1.AddNear(nn2)
		nn2.AddNear(nn3)
		nn3.AddNear(nn1)
		_ = initializeNodes(context.Background(), gNear)
		fixture.InitializeNodes = append(fixture.InitializeNodes, InitNodesScenarioJSON{
			Name: "init_near_cycle", FinalPositions: map[string]*PointJSON{
				"1": {X: nn1.TopLeft.X, Y: nn1.TopLeft.Y},
				"2": {X: nn2.TopLeft.X, Y: nn2.TopLeft.Y},
				"3": {X: nn3.TopLeft.X, Y: nn3.TopLeft.Y},
			},
		})

		// Fixed pair
		gFix := layoutgraph.NewGraph()
		gFix.CellSize = 10
		fn1 := gFix.AddNode(layoutgraph.NewNode(1, 10, 10))
		fn1.FixedTopLeft = geo.NewPoint(30, 60)
		fn2 := gFix.AddNode(layoutgraph.NewNode(2, 10, 10))
		fn2.FixedTopLeft = geo.NewPoint(90, 120)
		fn3 := gFix.AddNode(layoutgraph.NewNode(3, 10, 10)) // unpositioned
		addTestEdge(gFix, fn1, fn3)
		addTestEdge(gFix, fn2, fn3)
		_ = initializeNodes(context.Background(), gFix)
		fixture.InitializeNodes = append(fixture.InitializeNodes, InitNodesScenarioJSON{
			Name: "init_fixed_pair", FinalPositions: map[string]*PointJSON{
				"1": {X: fn1.TopLeft.X, Y: fn1.TopLeft.Y},
				"2": {X: fn2.TopLeft.X, Y: fn2.TopLeft.Y},
				"3": {X: fn3.TopLeft.X, Y: fn3.TopLeft.Y},
			},
		})

		// Candidate positions order for majority target vs non-target
		gTgt := layoutgraph.NewGraph()
		gTgt.CellSize = 10
		tn1 := gTgt.AddNode(layoutgraph.NewNode(1, 10, 10))
		tn2 := gTgt.AddNode(layoutgraph.NewNode(2, 10, 10))
		tn1.TopLeft = geo.NewPoint(5, 5)
		// directed edge tn1 -> tn2 makes tn2 a majority target
		e := addTestEdge(gTgt, tn1, tn2)
		e.TargetArrowhead = "arrow"

		sizeless, _ := newSizelessOptimizer(context.Background(), gTgt, nil)
		candsTarget, _ := nodeCandidatePositions(context.Background(), tn2, gTgt, sizeless)
		candTargetJSON := make([]PointJSON, len(candsTarget))
		for i, p := range candsTarget {
			candTargetJSON[i] = PointJSON{X: p.X, Y: p.Y}
		}
		fixture.InitializationCandidates = append(fixture.InitializationCandidates, InitCandScenarioJSON{
			Name: "majority_target_descending_order", NodeID: "2", IsMajorityTarget: true, Positions: candTargetJSON,
		})

		tn2.TopLeft = geo.NewPoint(8, 8)
		tn1.TopLeft = nil
		candsSource, _ := nodeCandidatePositions(context.Background(), tn1, gTgt, sizeless)
		candSourceJSON := make([]PointJSON, len(candsSource))
		for i, p := range candsSource {
			candSourceJSON[i] = PointJSON{X: p.X, Y: p.Y}
		}
		fixture.InitializationCandidates = append(fixture.InitializationCandidates, InitCandScenarioJSON{
			Name: "source_node_ascending_order", NodeID: "1", IsMajorityTarget: false, Positions: candSourceJSON,
		})
	}

	// ==========================================
	// 14. atomicity
	// ==========================================
	{
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n1 := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		n2 := g.AddNode(layoutgraph.NewNode(2, 10, 10))
		n1.TopLeft = geo.NewPoint(3, 4)
		n2.TopLeft = geo.NewPoint(8, 9)
		addTestEdge(g, n1, n2)

		// simulate cancellation mid initializeNodes
		canceledCtx, cancel := context.WithCancel(context.Background())
		cancel()
		_ = initializeNodes(canceledCtx, g)

		fixture.Atomicity = append(fixture.Atomicity, AtomicityScenarioJSON{
			Name: "initialize_nodes_canceled_restores_positions",
			RestoredNodes: map[string]*PointJSON{
				"1": {X: n1.TopLeft.X, Y: n1.TopLeft.Y},
				"2": {X: n2.TopLeft.X, Y: n2.TopLeft.Y},
			},
		})
	}

	// ==========================================
	// 15. malformedReachability
	// ==========================================
	{
		// 1. nil adjacent endpoint
		g1 := layoutgraph.NewGraph()
		n1 := g1.AddNode(layoutgraph.NewNode(1, 10, 10))
		e1 := layoutgraph.NewEdge(n1, nil)
		n1.Edges = append(n1.Edges, e1)
		g1.AddEdge(e1)
		guard1, _ := limits.NewWorkGuard(context.Background(), "reach1", limits.MaxEngineWorkUnits)
		panics1 := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panics1 = true
				}
			}()
			_, _ = n1.AllReachableNodesContext(false, true, true, nil, guard1)
		}()
		fixture.MalformedReachability = append(fixture.MalformedReachability, MalformedReachabilityScenarioJSON{
			Name: "nil_adjacent_endpoint", Type: "edge", PanicsInGo: panics1,
		})

		// 2. cluster vessel missing cluster entry
		g2 := layoutgraph.NewGraph()
		n2 := g2.AddNode(layoutgraph.NewNode(2, 10, 10))
		n2.SetClusterVessel(true)
		guard2, _ := limits.NewWorkGuard(context.Background(), "reach2", limits.MaxEngineWorkUnits)
		panics2 := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panics2 = true
				}
			}()
			_, _ = n2.AllReachableNodesContext(false, true, true, nil, guard2)
		}()
		fixture.MalformedReachability = append(fixture.MalformedReachability, MalformedReachabilityScenarioJSON{
			Name: "cluster_vessel_missing_cluster", Type: "cluster", PanicsInGo: panics2,
		})

		// 3. tree missing node entry
		g3 := layoutgraph.NewGraph()
		n3 := g3.AddNode(layoutgraph.NewNode(3, 10, 10))
		if g3.NodeToTree == nil {
			g3.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		}
		g3.NodeToTree[n3] = &layoutgraph.Tree{Node: nil}
		guard3, _ := limits.NewWorkGuard(context.Background(), "reach3", limits.MaxEngineWorkUnits)
		panics3 := false
		func() {
			defer func() {
				if r := recover(); r != nil {
					panics3 = true
				}
			}()
			_, _ = n3.AllReachableNodesContext(false, true, true, nil, guard3)
		}()
		fixture.MalformedReachability = append(fixture.MalformedReachability, MalformedReachabilityScenarioJSON{
			Name: "tree_missing_node", Type: "tree", PanicsInGo: panics3,
		})
	}

	// Write fixture to JSON file
	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join("..", "..", "js", "test", "fixtures", "go-sizeless-optimizer-reference.json")
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("Wrote %d bytes to %s", len(data), outPath)
}
