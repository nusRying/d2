package layoutgraph

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

// Slice 44 transaction oracle. With TALA_SLICE44_ORACLE=1 the test rewrites
// js/test/fixtures/go-transaction-reference.json from pinned Go behavior.
// Otherwise it recomputes every value and asserts the committed fixture still
// matches, so ordinary `go test` never mutates the checkout.

type txnOracleBox struct {
	ID     uint64  `json:"id"`
	Placed bool    `json:"placed"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
}

func txnOracleBoxes(nodes ...*Node) []txnOracleBox {
	out := make([]txnOracleBox, 0, len(nodes))
	for _, node := range nodes {
		box := txnOracleBox{ID: uint64(node.ID), W: node.Width, H: node.Height}
		if node.TopLeft != nil {
			box.Placed = true
			box.X = node.TopLeft.X
			box.Y = node.TopLeft.Y
		}
		out = append(out, box)
	}
	return out
}

// txnCountingContext returns context.Canceled from the cancelAt-th Err call
// onward. cancelAt == 0 never cancels.
type txnCountingContext struct {
	context.Context
	calls    int
	cancelAt int
}

func (ctx *txnCountingContext) Err() error {
	ctx.calls++
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

func txnErrorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// containerScenario: one container (the only Containers key) holding two
// connected nodes, plus a distant top-level node. Two operations: the second
// observes container geometry produced by the first operation's reposition.
type txnContainerScenario struct {
	g        *Graph
	outer    *Node
	a        *Node
	b        *Node
	far      *Node
	opCalls  int
	observed []float64
}

func newTxnContainerScenario() *txnContainerScenario {
	g := NewGraph()
	g.CellSize = 10
	outer := NewNode(1, 300, 300)
	outer.TopLeft = geo.NewPoint(0, 0)
	a := NewNode(2, 40, 40)
	a.TopLeft = geo.NewPoint(60, 60)
	b := NewNode(3, 40, 40)
	b.TopLeft = geo.NewPoint(200, 60)
	far := NewNode(4, 40, 40)
	far.TopLeft = geo.NewPoint(1000, 1000)
	g.AddNodeUnchecked(outer)
	g.AddNewNodeToContainer(outer, a)
	g.AddNewNodeToContainer(outer, b)
	g.AddNodeUnchecked(far)
	g.Connect(a, b)
	g.Connect(b, far)
	outer.wrapChildren()
	return &txnContainerScenario{g: g, outer: outer, a: a, b: b, far: far}
}

func (s *txnContainerScenario) nodes() []*Node { return []*Node{s.outer, s.a, s.b, s.far} }

func (s *txnContainerScenario) addOps(txn *Transaction) {
	txn.AddOp(func() error {
		s.opCalls++
		s.a.MoveWithChildren(0, 50)
		return nil
	})
	txn.AddOp(func() error {
		s.opCalls++
		s.observed = append(s.observed, s.outer.TopLeft.X, s.outer.TopLeft.Y, s.outer.Width, s.outer.Height)
		s.b.MoveWithChildren(-20, 0)
		return nil
	})
}

// clusterScenario: an active cluster whose members are synchronized by
// Commit after every operation, even without AffectContainers.
type txnClusterScenario struct {
	g        *Graph
	vessel   *Node
	m1       *Node
	m2       *Node
	other    *Node
	observed []float64
}

func newTxnClusterScenario() *txnClusterScenario {
	g := NewGraph()
	g.CellSize = 10
	vessel := NewNode(10, 0, 0)
	vessel.TopLeft = geo.NewPoint(0, 0)
	vessel.isClusterVessel = true
	m1 := NewNode(11, 40, 20)
	m2 := NewNode(12, 60, 20)
	cluster := &Cluster{
		Vessel: vessel, Nodes: []*Node{m1, m2}, Graph: g,
		Arrangement: Column, DesiredArrangement: Column, Padding: 20,
	}
	m1.Cluster = cluster
	m2.Cluster = cluster
	m1.Graph = g
	m2.Graph = g
	g.AddNodeUnchecked(vessel)
	g.Clusters[vessel] = cluster
	other := NewNode(13, 40, 40)
	other.TopLeft = geo.NewPoint(500, 0)
	g.AddNodeUnchecked(other)
	cluster.SyncGeometry()
	return &txnClusterScenario{g: g, vessel: vessel, m1: m1, m2: m2, other: other}
}

func (s *txnClusterScenario) nodes() []*Node { return []*Node{s.vessel, s.m1, s.m2, s.other} }

func (s *txnClusterScenario) addOps(txn *Transaction) {
	txn.AddOp(func() error {
		s.vessel.TopLeft.X += 100
		return nil
	})
	txn.AddOp(func() error {
		s.observed = append(s.observed, s.m1.TopLeft.X, s.m1.TopLeft.Y, s.m2.TopLeft.X, s.m2.TopLeft.Y)
		return nil
	})
}

type txnSweepNode struct {
	ID          uint64             `json:"id"`
	W           float64            `json:"w"`
	H           float64            `json:"h"`
	Placed      bool               `json:"placed"`
	X           float64            `json:"x"`
	Y           float64            `json:"y"`
	Margin      [4]float64         `json:"margin"` // top, right, bottom, left
	LoopOffsets map[string]float64 `json:"loopOffsets,omitempty"`
	Table       bool               `json:"table"`
}

type txnSweepEdge struct {
	From      uint64 `json:"from"`
	To        uint64 `json:"to"`
	MinWidth  int    `json:"minWidth"`
	MinHeight int    `json:"minHeight"`
	ToOwns    bool   `json:"toOwns"`
}

type txnSweepCase struct {
	Seed  int64          `json:"seed"`
	Nodes []txnSweepNode `json:"nodes"`
	Edges []txnSweepEdge `json:"edges"`
	Near  []string       `json:"near"`
	Exact []string       `json:"exact"`
	Used  int64          `json:"used"`
}

func sortedPairIDs(overlaps map[*Node]map[*Node]struct{}) []string {
	pairs := overlapPairIDs(overlaps)
	out := make([]string, 0, len(pairs))
	for pair := range pairs {
		out = append(out, pair)
	}
	sort.Strings(out)
	return out
}

func buildTxnSweepCase(seed int64) txnSweepCase {
	rng := rand.New(rand.NewSource(seed))
	g := NewGraph()
	out := txnSweepCase{Seed: seed}
	nodeCount := 4 + rng.Intn(29)
	for i := 0; i < nodeCount; i++ {
		node := NewNode(EntityID(i+1), float64(1+rng.Intn(600)), float64(1+rng.Intn(600)))
		record := txnSweepNode{ID: uint64(i + 1), W: node.Width, H: node.Height}
		if rng.Intn(8) != 0 {
			node.TopLeft = geo.NewPoint(float64(rng.Intn(12_000)-2_000), float64(rng.Intn(12_000)-2_000))
			record.Placed = true
			record.X = node.TopLeft.X
			record.Y = node.TopLeft.Y
		}
		node.margin = Spacing{
			top:    float64(rng.Intn(2_001)),
			bottom: float64(rng.Intn(2_001)),
			left:   float64(rng.Intn(2_001)),
			right:  float64(rng.Intn(2_001)),
		}
		record.Margin = [4]float64{node.margin.top, node.margin.right, node.margin.bottom, node.margin.left}
		if i%5 == 0 {
			top := float64(501 + rng.Intn(2_000))
			right := float64(501 + rng.Intn(2_000))
			node.LoopOffsets = map[geo.Orientation]float64{geo.Top: top, geo.Right: right}
			record.LoopOffsets = map[string]float64{"Top": top, "Right": right}
		}
		if i%7 == 0 {
			node.shapeType = tableType
			record.Table = true
		}
		g.AddNodeUnchecked(node)
		out.Nodes = append(out.Nodes, record)
	}
	for i := 0; i < nodeCount*2; i++ {
		from := g.Nodes[rng.Intn(nodeCount)]
		to := g.Nodes[rng.Intn(nodeCount)]
		if from == to {
			continue
		}
		edge := NewEdge(from, to)
		edge.MinWidth = 501 + rng.Intn(3_000)
		edge.MinHeight = 501 + rng.Intn(3_000)
		g.Edges = append(g.Edges, edge)
		from.Edges = append(from.Edges, edge)
		toOwns := rng.Intn(3) != 0
		if toOwns {
			to.Edges = append(to.Edges, edge)
		}
		out.Edges = append(out.Edges, txnSweepEdge{
			From: uint64(from.ID), To: uint64(to.ID),
			MinWidth: edge.MinWidth, MinHeight: edge.MinHeight, ToOwns: toOwns,
		})
	}
	guard, err := limits.NewWorkGuard(context.Background(), "TransactionSweepOracle", maxTransactionWorkUnits)
	if err != nil {
		panic(err)
	}
	near, exact, err := buildTransactionOverlaps(g, guard)
	if err != nil {
		panic(err)
	}
	out.Near = sortedPairIDs(near)
	out.Exact = sortedPairIDs(exact)
	out.Used = guard.Used()
	return out
}

type txnCancelProbe struct {
	CancelAt int            `json:"cancelAt"`
	Error    string         `json:"error"`
	Canceled bool           `json:"canceled"`
	OpCalls  int            `json:"opCalls"`
	Used     int64          `json:"used"`
	Boxes    []txnOracleBox `json:"boxes"`
}

type transactionOracleData struct {
	SegmentsCross []struct {
		Name     string `json:"name"`
		Expected bool   `json:"expected"`
	} `json:"segmentsCross"`

	ContainerCommit struct {
		Initial          []txnOracleBox `json:"initial"`
		Final            []txnOracleBox `json:"final"`
		Observed         []float64      `json:"observed"`
		UsedAfterCreate  int64          `json:"usedAfterCreate"`
		UsedAfterCommit  int64          `json:"usedAfterCommit"`
		UsedAfterRefresh int64          `json:"usedAfterRefresh"`
		CtxErrCalls      int            `json:"ctxErrCalls"`
	} `json:"containerCommit"`

	ClusterSync struct {
		Initial         []txnOracleBox `json:"initial"`
		Observed        []float64      `json:"observed"`
		Final           []txnOracleBox `json:"final"`
		UsedAfterCreate int64          `json:"usedAfterCreate"`
		UsedAfterCommit int64          `json:"usedAfterCommit"`
	} `json:"clusterSync"`

	ContainerCancelProbes []txnCancelProbe `json:"containerCancelProbes"`

	WorkBoundary struct {
		W     int64          `json:"w"`
		Error string         `json:"error"`
		Used  int64          `json:"used"`
		Boxes []txnOracleBox `json:"boxes"`
	} `json:"workBoundary"`

	Rejection struct {
		Error       string         `json:"error"`
		IsRejection bool           `json:"isRejection"`
		Used        int64          `json:"used"`
		Boxes       []txnOracleBox `json:"boxes"`
	} `json:"rejection"`

	SharedGuard struct {
		AfterFirstCreate  int64 `json:"afterFirstCreate"`
		AfterFirstCommit  int64 `json:"afterFirstCommit"`
		AfterSecondCreate int64 `json:"afterSecondCreate"`
		AfterSecondCommit int64 `json:"afterSecondCommit"`
		AfterClone        int64 `json:"afterClone"`
		AfterCloneCommit  int64 `json:"afterCloneCommit"`
		AfterCostCapture  int64 `json:"afterCostCapture"`
	} `json:"sharedGuard"`

	UpdateState struct {
		AdvancedX        float64 `json:"advancedX"`
		AdvancedError    string  `json:"advancedError"`
		LimitError       string  `json:"limitError"`
		LimitUsed        int64   `json:"limitUsed"`
		RestoredX        float64 `json:"restoredX"`
		RestoredY        float64 `json:"restoredY"`
		RestoredIdentity bool    `json:"restoredIdentity"`
	} `json:"updateState"`

	Sweep                     []txnSweepCase `json:"sweep"`
	DuplicateReferenceNear    []string       `json:"duplicateReferenceNear"`
	DuplicateReferenceExact   []string       `json:"duplicateReferenceExact"`
	DuplicateReferenceUsed    int64          `json:"duplicateReferenceUsed"`
	ReferenceLimit39Error     string         `json:"referenceLimit39Error"`
	ReferenceLimit40NearPairs int            `json:"referenceLimit40NearPairs"`
	ReferenceLimit40Used      int64          `json:"referenceLimit40Used"`
	SparseMaximumUsed         int64          `json:"sparseMaximumUsed"`
	DedupMembershipCount      int            `json:"dedupMembershipCount"`
	DedupMembershipUsed       int64          `json:"dedupMembershipUsed"`
	ConstructorCanceled       bool           `json:"constructorCanceled"`
	ConstructorCancelError    string         `json:"constructorCancelError"`
	LongDistanceBaseline      int64          `json:"longDistanceBaseline"`
	LongDistanceWithNeighbor  int64          `json:"longDistanceWithNeighbor"`
	LongDistanceLimitError    string         `json:"longDistanceLimitError"`
	CandidateErrors           struct {
		Invalid      string `json:"invalid"`
		NonImproving string `json:"nonImproving"`
	} `json:"candidateErrors"`
}

func mustTxnGuard(t *testing.T, limit int64) *limits.WorkGuard {
	t.Helper()
	guard, err := limits.NewWorkGuard(context.Background(), "Slice44TransactionOracle", limit)
	if err != nil {
		t.Fatal(err)
	}
	return guard
}

func TestGenerateTransactionOracle(t *testing.T) {
	var oracle transactionOracleData
	bg := context.Background()

	addSegment := func(name string, value bool) {
		oracle.SegmentsCross = append(oracle.SegmentsCross, struct {
			Name     string `json:"name"`
			Expected bool   `json:"expected"`
		}{Name: name, Expected: value})
	}
	addSegment("intersecting_diagonals", SegmentsCross(geo.NewPoint(0, 0), geo.NewPoint(100, 100), geo.NewPoint(0, 100), geo.NewPoint(100, 0)))
	addSegment("parallel_horizontal", SegmentsCross(geo.NewPoint(0, 0), geo.NewPoint(100, 0), geo.NewPoint(0, 50), geo.NewPoint(100, 50)))

	oracle.CandidateErrors.Invalid = ErrInvalidCandidate.Error()
	oracle.CandidateErrors.NonImproving = ErrNonImprovingCandidate.Error()

	// Successful multi-op commit with per-op reposition and synchronization.
	{
		s := newTxnContainerScenario()
		oracle.ContainerCommit.Initial = txnOracleBoxes(s.nodes()...)
		guard := mustTxnGuard(t, limits.MaxTransactionWorkUnits)
		ctx := &txnCountingContext{Context: bg}
		txn, err := s.g.newRequestTransactionWithGuard(ctx, guard, TransactionOptions{AffectContainers: true})
		if err != nil {
			t.Fatal(err)
		}
		oracle.ContainerCommit.UsedAfterCreate = guard.Used()
		ctx.calls = 0
		s.addOps(txn)
		if err := txn.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		oracle.ContainerCommit.CtxErrCalls = ctx.calls
		oracle.ContainerCommit.UsedAfterCommit = guard.Used()
		oracle.ContainerCommit.Observed = s.observed
		oracle.ContainerCommit.Final = txnOracleBoxes(s.nodes()...)
		txn.Clear()
		if err := txn.UpdateState(); err != nil {
			t.Fatal(err)
		}
		oracle.ContainerCommit.UsedAfterRefresh = guard.Used()
	}

	// Cluster members observed by the second op after the first op's sync.
	{
		s := newTxnClusterScenario()
		oracle.ClusterSync.Initial = txnOracleBoxes(s.nodes()...)
		guard := mustTxnGuard(t, limits.MaxTransactionWorkUnits)
		txn, err := s.g.newRequestTransactionWithGuard(bg, guard, TransactionOptions{})
		if err != nil {
			t.Fatal(err)
		}
		oracle.ClusterSync.UsedAfterCreate = guard.Used()
		s.addOps(txn)
		if err := txn.Commit(bg); err != nil {
			t.Fatal(err)
		}
		oracle.ClusterSync.UsedAfterCommit = guard.Used()
		oracle.ClusterSync.Observed = s.observed
		oracle.ClusterSync.Final = txnOracleBoxes(s.nodes()...)
	}

	// Cancel at every context checkpoint of the successful container commit.
	for cancelAt := 1; cancelAt <= oracle.ContainerCommit.CtxErrCalls; cancelAt++ {
		s := newTxnContainerScenario()
		guard := mustTxnGuard(t, limits.MaxTransactionWorkUnits)
		ctx := &txnCountingContext{Context: bg}
		txn, err := s.g.newRequestTransactionWithGuard(ctx, guard, TransactionOptions{AffectContainers: true})
		if err != nil {
			t.Fatal(err)
		}
		ctx.calls = 0
		ctx.cancelAt = cancelAt
		s.addOps(txn)
		err = txn.Commit(ctx)
		oracle.ContainerCancelProbes = append(oracle.ContainerCancelProbes, txnCancelProbe{
			CancelAt: cancelAt,
			Error:    txnErrorString(err),
			Canceled: errors.Is(err, context.Canceled),
			OpCalls:  s.opCalls,
			Used:     guard.Used(),
			Boxes:    txnOracleBoxes(s.nodes()...),
		})
	}

	// Exact W / W-1 boundary through the request-scoped transaction guard.
	{
		measure := func(limit int64) (*txnContainerScenario, *limits.WorkGuard, error) {
			s := newTxnContainerScenario()
			guard := mustTxnGuard(t, limit)
			ctx := ContextWithTransactionWorkGuard(bg, guard)
			txn, err := s.g.NewRequestTransaction(ctx, TransactionOptions{AffectContainers: true})
			if err != nil {
				return s, guard, err
			}
			s.addOps(txn)
			return s, guard, txn.Commit(ctx)
		}
		_, guard, err := measure(limits.MaxTransactionWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		w := guard.Used()
		if _, guard, err = measure(w); err != nil || guard.Used() != w {
			t.Fatalf("limit W failed: %v used=%d", err, guard.Used())
		}
		s, guard, err := measure(w - 1)
		if err == nil {
			t.Fatal("limit W-1 succeeded")
		}
		oracle.WorkBoundary.W = w
		oracle.WorkBoundary.Error = err.Error()
		oracle.WorkBoundary.Used = guard.Used()
		oracle.WorkBoundary.Boxes = txnOracleBoxes(s.nodes()...)
	}

	// Candidate rejection by post-state overlap; graph restored.
	{
		s := newTxnContainerScenario()
		guard := mustTxnGuard(t, limits.MaxTransactionWorkUnits)
		txn, err := s.g.newRequestTransactionWithGuard(bg, guard, TransactionOptions{})
		if err != nil {
			t.Fatal(err)
		}
		txn.AddOp(func() error {
			s.far.MoveAbsWithChildren(s.b.TopLeft.X, s.b.TopLeft.Y)
			return nil
		})
		err = txn.Commit(bg)
		oracle.Rejection.Error = txnErrorString(err)
		oracle.Rejection.IsRejection = IsCandidateRejection(err)
		oracle.Rejection.Used = guard.Used()
		oracle.Rejection.Boxes = txnOracleBoxes(s.nodes()...)
	}

	// Several transactions, a clone, and a placement-cost capture share one
	// request guard.
	{
		s := newTxnContainerScenario()
		s.g.StoreEdgeLengthCost(1, 2)
		s.g.StoreEdgeLengthCost(3, 4)
		guard := mustTxnGuard(t, limits.MaxTransactionWorkUnits)
		ctx := ContextWithTransactionWorkGuard(bg, guard)
		first, err := s.g.NewRequestTransaction(ctx, TransactionOptions{AffectContainers: true})
		if err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterFirstCreate = guard.Used()
		s.addOps(first)
		if err := first.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterFirstCommit = guard.Used()
		second, err := s.g.NewRequestTransaction(ctx, TransactionOptions{})
		if err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterSecondCreate = guard.Used()
		second.AddOp(func() error {
			s.far.MoveWithChildren(10, 0)
			return nil
		})
		if err := second.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterSecondCommit = guard.Used()
		clone, err := second.CloneGeometryContext()
		if err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterClone = guard.Used()
		clone.Clear()
		clone.AddOp(func() error {
			s.far.MoveWithChildren(0, 10)
			return nil
		})
		if err := clone.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterCloneCommit = guard.Used()
		if err := clone.CapturePlacementCosts("Slice44TransactionOracle"); err != nil {
			t.Fatal(err)
		}
		oracle.SharedGuard.AfterCostCapture = guard.Used()
	}

	// TestTransactionUpdateStateAdvancesRollbackPoint
	{
		g := NewGraph()
		n := NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(1, 2)
		g.AddNewNodeToContainer(nil, n)
		txn := mustNewTransaction(t, g, TransactionOptions{})
		txn.AddOp(func() error { n.TopLeft.X = 10; return nil })
		if err := txn.Commit(bg); err != nil {
			t.Fatal(err)
		}
		txn.Clear()
		if err := txn.UpdateState(); err != nil {
			t.Fatal(err)
		}
		txn.AddOp(func() error { n.TopLeft.X = 100; return errors.New("reject") })
		oracle.UpdateState.AdvancedError = txnErrorString(txn.Commit(bg))
		oracle.UpdateState.AdvancedX = n.TopLeft.X
	}

	// TestTransactionUpdateStateLimitRollsBackAcceptedMutation
	{
		g := NewGraph()
		node := NewNode(1, 10, 10)
		originalTopLeft := geo.NewPoint(1, 2)
		node.TopLeft = originalTopLeft
		g.AddNodeUnchecked(node)
		txn, err := g.newTransactionContext(bg, nil)
		if err != nil {
			t.Fatal(err)
		}
		txn.AddOp(func() error { node.TopLeft = geo.NewPoint(100, 200); return nil })
		if err := txn.Commit(bg); err != nil {
			t.Fatal(err)
		}
		txn.Clear()
		lowLimit, err := limits.NewWorkGuard(bg, "TransactionUpdateStateTest", 1)
		if err != nil {
			t.Fatal(err)
		}
		if err := lowLimit.Step(); err != nil {
			t.Fatal(err)
		}
		txn.guard = lowLimit
		oracle.UpdateState.LimitError = txnErrorString(txn.UpdateState())
		oracle.UpdateState.LimitUsed = lowLimit.Used()
		oracle.UpdateState.RestoredX = node.TopLeft.X
		oracle.UpdateState.RestoredY = node.TopLeft.Y
		oracle.UpdateState.RestoredIdentity = node.TopLeft == originalTopLeft
	}

	// TestTransactionSweepMatchesLegacyAllPairs (exported graphs).
	for seed := int64(0); seed < 40; seed++ {
		oracle.Sweep = append(oracle.Sweep, buildTxnSweepCase(seed))
	}

	// TestTransactionSweepMatchesLegacyWithDuplicateTopLevelReference
	{
		g := NewGraph()
		first := NewNode(1, 100, 100)
		first.TopLeft = geo.NewPoint(0, 0)
		second := NewNode(2, 100, 100)
		second.TopLeft = geo.NewPoint(50, 50)
		third := NewNode(3, 25, 25)
		third.TopLeft = geo.NewPoint(1_000, 1_000)
		g.AddNodeUnchecked(first)
		g.AddNodeUnchecked(second)
		g.AddNodeUnchecked(first)
		g.AddNodeUnchecked(third)
		guard := mustTxnGuard(t, maxTransactionWorkUnits)
		near, exact, err := buildTransactionOverlaps(g, guard)
		if err != nil {
			t.Fatal(err)
		}
		oracle.DuplicateReferenceNear = sortedPairIDs(near)
		oracle.DuplicateReferenceExact = sortedPairIDs(exact)
		oracle.DuplicateReferenceUsed = guard.Used()
	}

	// TestTransactionSweepReferenceLimitIsAggregate
	{
		build := func() *Graph {
			g := NewGraph()
			for i := 0; i < 5; i++ {
				node := NewNode(EntityID(i+1), 10, 10)
				node.TopLeft = geo.NewPoint(0, 0)
				g.AddNodeUnchecked(node)
			}
			return g
		}
		_, _, err := buildTransactionOverlapsWithReferenceLimit(build(), mustTxnGuard(t, 1_000), 39)
		oracle.ReferenceLimit39Error = txnErrorString(err)
		guard := mustTxnGuard(t, 1_000)
		near, _, err := buildTransactionOverlapsWithReferenceLimit(build(), guard, 40)
		if err != nil {
			t.Fatal(err)
		}
		oracle.ReferenceLimit40NearPairs = len(overlapPairIDs(near))
		oracle.ReferenceLimit40Used = guard.Used()
	}

	// TestTransactionSupportsSparseMaximumNodeCount
	{
		g := NewGraph()
		for i := 0; i < maxEngineNodes; i++ {
			node := NewNode(EntityID(i+1), 10, 10)
			node.TopLeft = geo.NewPoint(float64(i*1_000), float64((i%17)*1_000))
			g.AddNodeUnchecked(node)
		}
		guard := mustTxnGuard(t, maxTransactionWorkUnits)
		txn, err := g.newTransactionContext(bg, guard)
		if err != nil || len(txn.PriorGraphState.existingOverlaps) != 0 {
			t.Fatalf("sparse maximum: %v", err)
		}
		oracle.SparseMaximumUsed = guard.Used()
	}

	// TestTransactionDeduplicatesClusterAndSequenceMembership
	{
		g := NewGraph()
		for i := 0; i < 4_000; i++ {
			node := NewNode(EntityID(i+1), 10, 10)
			node.TopLeft = geo.NewPoint(float64(i*1_000), 0)
			g.AddNodeUnchecked(node)
		}
		g.Clusters[g.Nodes[0]] = &Cluster{Vessel: g.Nodes[0], Nodes: g.Nodes, Graph: g}
		g.Sequences[g.Nodes[1]] = &Sequence{Vessel: g.Nodes[1], Nodes: g.Nodes, Graph: g}
		guard := mustTxnGuard(t, maxTransactionWorkUnits)
		txn, err := g.newTransactionContext(bg, guard)
		if err != nil {
			t.Fatal(err)
		}
		oracle.DedupMembershipCount = len(txn.PriorGraphState.nodeGeometry)
		oracle.DedupMembershipUsed = guard.Used()
	}

	// TestTransactionConstructorPreservesCancellationIdentity
	{
		ctx, cancel := context.WithCancel(bg)
		cancel()
		_, err := NewGraph().newTransactionContext(ctx, nil)
		oracle.ConstructorCanceled = errors.Is(err, context.Canceled)
		oracle.ConstructorCancelError = txnErrorString(err)
	}

	// TestGraphStateChargesLongDistanceNeighborOnce
	{
		graph := NewGraph()
		from := NewNode(1, 10, 10)
		to := NewNode(2, 10, 10)
		graph.AddNodeUnchecked(from)
		graph.AddNodeUnchecked(to)
		measure := func(limit int64) (int64, error) {
			guard := mustTxnGuard(t, limit)
			state := NewGraphStateSnapshot(GraphStateSnapshotOptions{CaptureTopology: true})
			err := state.UpdateWithWorkGuard(graph, guard)
			return guard.Used(), err
		}
		baseline, err := measure(limits.MaxEngineWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		from.LongDistanceNeighborRequirements = map[*Node]LongDistanceNeighborRequirements{
			to: {EdgeCount: 3, MaxWidth: 100, MaxHeight: 200},
		}
		withNeighbor, err := measure(limits.MaxEngineWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		_, err = measure(withNeighbor - 1)
		oracle.LongDistanceBaseline = baseline
		oracle.LongDistanceWithNeighbor = withNeighbor
		oracle.LongDistanceLimitError = txnErrorString(err)
	}

	writeOrAssertSlice44Fixture(t, "go-transaction-reference.json", oracle)
}

// writeOrAssertSlice44Fixture rewrites the fixture only behind the explicit
// generation gate; otherwise it asserts byte-for-byte agreement.
func writeOrAssertSlice44Fixture(t *testing.T, name string, oracle any) {
	t.Helper()
	encoded, err := json.MarshalIndent(oracle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", name)
	if os.Getenv("TALA_SLICE44_ORACLE") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, encoded) {
		t.Fatalf("%s is stale; regenerate with TALA_SLICE44_ORACLE=1 (%s)", name, fmt.Sprintf("%d vs %d bytes", len(committed), len(encoded)))
	}
}
