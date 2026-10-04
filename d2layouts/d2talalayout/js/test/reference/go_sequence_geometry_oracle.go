//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

type SequenceGeometryOracleOutput struct {
	Metadata map[string]interface{} `json:"metadata"`
	Cases    map[string]interface{} `json:"cases"`
}

type PointOutput struct {
	X                   float64 `json:"x"`
	Y                   float64 `json:"y"`
	XIsPositiveInfinity bool    `json:"xIsPositiveInfinity,omitempty"`
	YIsPositiveInfinity bool    `json:"yIsPositiveInfinity,omitempty"`
}

func toPointOutput(p *geo.Point) *PointOutput {
	if p == nil {
		return nil
	}
	out := &PointOutput{}
	if math.IsInf(p.X, 1) {
		out.XIsPositiveInfinity = true
		out.X = 0
	} else {
		out.X = p.X
	}
	if math.IsInf(p.Y, 1) {
		out.YIsPositiveInfinity = true
		out.Y = 0
	} else {
		out.Y = p.Y
	}
	return out
}

func idStr(n *layoutgraph.Node) string {
	if n == nil {
		return ""
	}
	return strconv.FormatInt(int64(n.ID), 10)
}

func safeRun(fn func()) (panicked bool, msg string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			msg = fmt.Sprintf("%v", r)
		}
	}()
	fn()
	return false, ""
}

func main() {
	outPath := "test/fixtures/go-sequence-geometry-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := SequenceGeometryOracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph",
			"stepWedgeWidth":   shape.STEP_WEDGE_WIDTH,
		},
		Cases: make(map[string]interface{}),
	}

	// 1. SequenceAdvance cases
	{
		testWidths := []float64{-1, 0, 10, 35, 36, 70, 100, -10, 17.5, 35.0, 50, 120}
		advanceCases := make([]map[string]interface{}, 0, len(testWidths))
		for _, w := range testWidths {
			adv := layoutgraph.SequenceAdvance(w)
			advanceCases = append(advanceCases, map[string]interface{}{
				"width":   w,
				"advance": adv,
			})
		}
		out.Cases["SequenceAdvance"] = advanceCases
	}

	// 2. SyncGeometry cases
	{
		syncCases := make(map[string]interface{})

		// Case A: Three wide steps
		{
			vessel := layoutgraph.NewNode(1, 10, 10)
			s1 := layoutgraph.NewNode(2, 100, 50)
			s2 := layoutgraph.NewNode(3, 100, 60)
			s3 := layoutgraph.NewNode(4, 100, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.SyncGeometry()
			syncCases["ThreeWideSteps"] = map[string]interface{}{
				"vesselWidth":   vessel.Width,
				"vesselHeight":  vessel.Height,
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
				"stepTopLefts": []*PointOutput{
					toPointOutput(s1.TopLeft),
					toPointOutput(s2.TopLeft),
					toPointOutput(s3.TopLeft),
				},
			}
		}

		// Case B: Two narrow steps (<= STEP_WEDGE_WIDTH)
		{
			vessel := layoutgraph.NewNode(10, 10, 10)
			s1 := layoutgraph.NewNode(11, 10, 30)
			s2 := layoutgraph.NewNode(12, 20, 25)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.SyncGeometry()
			syncCases["TwoNarrowSteps"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
			}
		}

		// Case C: Mixed narrow and wide
		{
			vessel := layoutgraph.NewNode(20, 10, 10)
			s1 := layoutgraph.NewNode(21, 10, 40)
			s2 := layoutgraph.NewNode(22, 50, 20)
			s3 := layoutgraph.NewNode(23, 25, 60)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.SyncGeometry()
			syncCases["MixedNarrowAndWide"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
			}
		}

		// Case D: Negative dimensions
		{
			vessel := layoutgraph.NewNode(30, 10, 10)
			s1 := layoutgraph.NewNode(31, -10, -5)
			s2 := layoutgraph.NewNode(32, 50, 30)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.SyncGeometry()
			syncCases["NegativeDimensions"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
			}
		}

		// Case E: Different heights
		{
			vessel := layoutgraph.NewNode(40, 10, 10)
			s1 := layoutgraph.NewNode(41, 50, 10)
			s2 := layoutgraph.NewNode(42, 50, 100)
			s3 := layoutgraph.NewNode(43, 50, 50)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.SyncGeometry()
			syncCases["DifferentHeights"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
			}
		}

		// Case F: Empty sequence
		{
			vessel := layoutgraph.NewNode(50, 99, 99)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{},
			}
			seq.SyncGeometry()
			syncCases["EmptySequence"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
			}
		}

		// Case G: Vessel without TopLeft
		{
			vessel := layoutgraph.NewNode(60, 10, 10)
			s1 := layoutgraph.NewNode(61, 50, 30)
			s2 := layoutgraph.NewNode(62, 60, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.SyncGeometry()
			syncCases["VesselWithoutTopLeft"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
				"s1TopLeft":     toPointOutput(s1.TopLeft),
				"s2TopLeft":     toPointOutput(s2.TopLeft),
			}
		}

		// Case H: Positioned vessel
		{
			vessel := layoutgraph.NewNode(70, 10, 10)
			vessel.TopLeft = geo.NewPoint(200, 300)
			s1 := layoutgraph.NewNode(71, 50, 30)
			s2 := layoutgraph.NewNode(72, 60, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.SyncGeometry()
			syncCases["PositionedVessel"] = map[string]interface{}{
				"vesselWidth":   vessel.Width,
				"vesselHeight":  vessel.Height,
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
				"s1TopLeft":     toPointOutput(s1.TopLeft),
				"s2TopLeft":     toPointOutput(s2.TopLeft),
			}
		}

		// Case I: Nil step failure
		{
			vessel := layoutgraph.NewNode(80, 10, 10)
			s1 := layoutgraph.NewNode(81, 50, 30)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, nil},
			}
			panicked, msg := safeRun(func() {
				seq.SyncGeometry()
			})
			syncCases["NilStepFailure"] = map[string]interface{}{
				"panicked": panicked,
				"message":  msg,
			}
		}

		// Case J: Missing vessel failure
		{
			s1 := layoutgraph.NewNode(91, 50, 30)
			seq := &layoutgraph.Sequence{
				Vessel: nil,
				Nodes:  []*layoutgraph.Node{s1},
			}
			panicked, msg := safeRun(func() {
				seq.SyncGeometry()
			})
			syncCases["MissingVesselFailure"] = map[string]interface{}{
				"panicked": panicked,
				"message":  msg,
			}
		}

		out.Cases["SyncGeometry"] = syncCases
	}

	// 3. ArrangeSteps cases
	{
		arrangeCases := make(map[string]interface{})

		// Unpositioned vessel
		{
			vessel := layoutgraph.NewNode(100, 100, 100)
			s1 := layoutgraph.NewNode(101, 50, 50)
			s2 := layoutgraph.NewNode(102, 60, 60)
			s1.TopLeft = geo.NewPoint(10, 20)
			s2.TopLeft = geo.NewPoint(30, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.ArrangeSteps()
			arrangeCases["UnpositionedVessel"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
				"s2TopLeft": toPointOutput(s2.TopLeft),
			}
		}

		// One step
		{
			vessel := layoutgraph.NewNode(110, 100, 100)
			vessel.TopLeft = geo.NewPoint(10, 20)
			s1 := layoutgraph.NewNode(111, 50, 50)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1},
			}
			seq.ArrangeSteps()
			arrangeCases["OneStep"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
			}
		}

		// Multiple steps wide
		{
			vessel := layoutgraph.NewNode(120, 200, 100)
			vessel.TopLeft = geo.NewPoint(50, 60)
			s1 := layoutgraph.NewNode(121, 100, 50)
			s2 := layoutgraph.NewNode(122, 100, 50)
			s3 := layoutgraph.NewNode(123, 100, 50)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.ArrangeSteps()
			arrangeCases["MultipleSteps"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
				"s2TopLeft": toPointOutput(s2.TopLeft),
				"s3TopLeft": toPointOutput(s3.TopLeft),
			}
		}

		// Narrow widths
		{
			vessel := layoutgraph.NewNode(130, 50, 50)
			vessel.TopLeft = geo.NewPoint(100, 200)
			s1 := layoutgraph.NewNode(131, 10, 30)
			s2 := layoutgraph.NewNode(132, 20, 30)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.ArrangeSteps()
			arrangeCases["NarrowWidths"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
				"s2TopLeft": toPointOutput(s2.TopLeft),
			}
		}

		// Wide widths
		{
			vessel := layoutgraph.NewNode(140, 200, 50)
			vessel.TopLeft = geo.NewPoint(100, 200)
			s1 := layoutgraph.NewNode(141, 70, 40)
			s2 := layoutgraph.NewNode(142, 80, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.ArrangeSteps()
			arrangeCases["WideWidths"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
				"s2TopLeft": toPointOutput(s2.TopLeft),
			}
		}

		// Negative width
		{
			vessel := layoutgraph.NewNode(150, 100, 50)
			vessel.TopLeft = geo.NewPoint(100, 200)
			s1 := layoutgraph.NewNode(151, -10, 40)
			s2 := layoutgraph.NewNode(152, 50, 40)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.ArrangeSteps()
			arrangeCases["NegativeWidth"] = map[string]interface{}{
				"s1TopLeft": toPointOutput(s1.TopLeft),
				"s2TopLeft": toPointOutput(s2.TopLeft),
			}
		}

		out.Cases["ArrangeSteps"] = arrangeCases
	}

	// 4. PlaceVessel cases
	{
		placeCases := make(map[string]interface{})

		// All steps positioned
		{
			vessel := layoutgraph.NewNode(200, 100, 100)
			s1 := layoutgraph.NewNode(201, 50, 50)
			s2 := layoutgraph.NewNode(202, 50, 50)
			s3 := layoutgraph.NewNode(203, 50, 50)
			s1.TopLeft = geo.NewPoint(100, 50)
			s2.TopLeft = geo.NewPoint(200, 80)
			s3.TopLeft = geo.NewPoint(150, 30)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.PlaceVessel()
			placeCases["AllStepsPositioned"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
			}
		}

		// Independent minima
		{
			vessel := layoutgraph.NewNode(210, 100, 100)
			s1 := layoutgraph.NewNode(211, 50, 50)
			s2 := layoutgraph.NewNode(212, 50, 50)
			s3 := layoutgraph.NewNode(213, 50, 50)
			s1.TopLeft = geo.NewPoint(100, 20)
			s2.TopLeft = geo.NewPoint(50, 80)
			s3.TopLeft = geo.NewPoint(70, 10)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2, s3},
			}
			seq.PlaceVessel()
			placeCases["IndependentMinima"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
			}
		}

		// One missing TopLeft
		{
			vessel := layoutgraph.NewNode(220, 100, 100)
			s1 := layoutgraph.NewNode(221, 50, 50)
			s2 := layoutgraph.NewNode(222, 50, 50)
			s1.TopLeft = geo.NewPoint(10, 20)
			s2.TopLeft = nil
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.PlaceVessel()
			placeCases["OneMissingTopLeft"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
			}
		}

		// Existing Vessel.TopLeft + missing step
		{
			vessel := layoutgraph.NewNode(230, 100, 100)
			vessel.TopLeft = geo.NewPoint(999, 999)
			s1 := layoutgraph.NewNode(231, 50, 50)
			s2 := layoutgraph.NewNode(232, 50, 50)
			s1.TopLeft = geo.NewPoint(10, 20)
			s2.TopLeft = nil
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
			}
			seq.PlaceVessel()
			placeCases["ExistingTopLeftMissingStep"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
			}
		}

		// Empty nodes infinity
		{
			vessel := layoutgraph.NewNode(240, 100, 100)
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{},
			}
			seq.PlaceVessel()
			placeCases["EmptyNodesInfinity"] = map[string]interface{}{
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
			}
		}

		out.Cases["PlaceVessel"] = placeCases
	}

	// 5. AbductedNodeByEdge cases
	{
		vessel := layoutgraph.NewNode(300, 100, 100)
		nodeA := layoutgraph.NewNode(301, 50, 50)
		nodeB := layoutgraph.NewNode(302, 50, 50)
		e1 := &layoutgraph.Edge{ID: 1}
		e2 := &layoutgraph.Edge{ID: 2}
		e3 := &layoutgraph.Edge{ID: 3}
		e4 := &layoutgraph.Edge{ID: 4}
		e5 := &layoutgraph.Edge{ID: 5}

		ea1 := &layoutgraph.EdgeAbduction{
			Edge:           e1,
			CurrentFrom:    vessel,
			CurrentTo:      nodeB,
			OriginallyFrom: nodeA,
			OriginallyTo:   nodeB,
		}
		ea2 := &layoutgraph.EdgeAbduction{
			Edge:           e2,
			CurrentFrom:    nodeA,
			CurrentTo:      vessel,
			OriginallyFrom: nodeA,
			OriginallyTo:   nodeB,
		}
		ea3 := &layoutgraph.EdgeAbduction{
			Edge:           e3,
			CurrentFrom:    vessel,
			CurrentTo:      vessel,
			OriginallyFrom: nodeA,
			OriginallyTo:   nodeB,
		}
		ea4 := &layoutgraph.EdgeAbduction{
			Edge:           e4,
			CurrentFrom:    nodeA,
			CurrentTo:      nodeB,
			OriginallyFrom: nodeA,
			OriginallyTo:   nodeB,
		}

		seq := &layoutgraph.Sequence{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{nodeA, nodeB},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{ea1, ea2, ea3, ea4},
		}

		abductCases := map[string]interface{}{
			"CurrentFromVessel":       idStr(seq.AbductedNodeByEdge(e1)),
			"CurrentToVessel":         idStr(seq.AbductedNodeByEdge(e2)),
			"BothVesselPrecedence":    idStr(seq.AbductedNodeByEdge(e3)),
			"DifferentEdgeObject":     idStr(seq.AbductedNodeByEdge(e5)),
			"NoCurrentVesselEndpoint": idStr(seq.AbductedNodeByEdge(e4)),
		}
		out.Cases["AbductedNodeByEdge"] = abductCases
	}

	// 6. SyncSequences cases
	{
		syncSeqCases := make(map[string]interface{})

		// Case A: No sequences
		{
			g := layoutgraph.NewGraph()
			n1 := layoutgraph.NewNode(401, 100, 100)
			g.AddNodeUnchecked(n1)
			g.SyncSequences()
			syncSeqCases["NoSequences"] = map[string]interface{}{
				"node1Width": n1.Width,
			}
		}

		// Case B: Top level sequence vessel
		{
			g := layoutgraph.NewGraph()
			vessel := layoutgraph.NewNode(410, 10, 10)
			vessel.TopLeft = geo.NewPoint(500, 500)
			s1 := layoutgraph.NewNode(411, 60, 40)
			s2 := layoutgraph.NewNode(412, 80, 50)
			vessel.Graph = g
			s1.Graph = g
			s2.Graph = g
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
				Graph:  g,
			}
			g.AddNodeUnchecked(vessel)
			g.Sequences[vessel] = seq
			g.SyncSequences()
			syncSeqCases["TopLevelSequenceVessel"] = map[string]interface{}{
				"vesselWidth":   vessel.Width,
				"vesselHeight":  vessel.Height,
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
				"s1TopLeft":     toPointOutput(s1.TopLeft),
				"s2TopLeft":     toPointOutput(s2.TopLeft),
			}
		}

		// Case C: Nested sequence vessel
		{
			g := layoutgraph.NewGraph()
			container := layoutgraph.NewNode(420, 200, 200)
			vessel := layoutgraph.NewNode(421, 10, 10)
			vessel.TopLeft = geo.NewPoint(1000, 1000)
			s1 := layoutgraph.NewNode(422, 50, 30)
			s2 := layoutgraph.NewNode(423, 70, 40)
			seq := &layoutgraph.Sequence{
				Vessel:    vessel,
				Nodes:     []*layoutgraph.Node{s1, s2},
				Graph:     g,
				Container: container,
			}
			container.Graph = g
			vessel.Graph = g
			s1.Graph = g
			s2.Graph = g
			g.AddNewNodeToContainer(nil, container)
			g.AddNodeToContainer(container, vessel)
			g.Sequences[vessel] = seq

			g.SyncSequences()
			syncSeqCases["NestedSequenceVessel"] = map[string]interface{}{
				"vesselWidth":   vessel.Width,
				"vesselHeight":  vessel.Height,
				"vesselTopLeft": toPointOutput(vessel.TopLeft),
				"s1TopLeft":     toPointOutput(s1.TopLeft),
				"s2TopLeft":     toPointOutput(s2.TopLeft),
			}
		}

		// Case D: Unreachable sequence-map entry
		{
			g := layoutgraph.NewGraph()
			n1 := layoutgraph.NewNode(430, 100, 100)
			g.AddNodeUnchecked(n1)

			vessel := layoutgraph.NewNode(431, 10, 10)
			vessel.TopLeft = geo.NewPoint(500, 500)
			s1 := layoutgraph.NewNode(432, 60, 40)
			s2 := layoutgraph.NewNode(433, 80, 50)
			vessel.Graph = g
			s1.Graph = g
			s2.Graph = g
			seq := &layoutgraph.Sequence{
				Vessel: vessel,
				Nodes:  []*layoutgraph.Node{s1, s2},
				Graph:  g,
			}
			// Vessel is in Sequences map, but NOT in g.Nodes or any container!
			g.Sequences[vessel] = seq

			g.SyncSequences()
			syncSeqCases["UnreachableSequenceMapEntry"] = map[string]interface{}{
				"vesselWidth":  vessel.Width,
				"vesselHeight": vessel.Height,
				"s1TopLeft":    toPointOutput(s1.TopLeft),
				"s2TopLeft":    toPointOutput(s2.TopLeft),
			}
		}

		// Case E: Two reachable sequences
		{
			g := layoutgraph.NewGraph()
			v1 := layoutgraph.NewNode(440, 10, 10)
			v1.TopLeft = geo.NewPoint(100, 100)
			v1_s1 := layoutgraph.NewNode(441, 50, 30)
			v1_s2 := layoutgraph.NewNode(442, 50, 30)
			v1.Graph = g
			v1_s1.Graph = g
			v1_s2.Graph = g
			seq1 := &layoutgraph.Sequence{
				Vessel: v1,
				Nodes:  []*layoutgraph.Node{v1_s1, v1_s2},
				Graph:  g,
			}

			v2 := layoutgraph.NewNode(450, 10, 10)
			v2.TopLeft = geo.NewPoint(300, 300)
			v2_s1 := layoutgraph.NewNode(451, 80, 60)
			v2_s2 := layoutgraph.NewNode(452, 90, 70)
			v2.Graph = g
			v2_s1.Graph = g
			v2_s2.Graph = g
			seq2 := &layoutgraph.Sequence{
				Vessel: v2,
				Nodes:  []*layoutgraph.Node{v2_s1, v2_s2},
				Graph:  g,
			}

			g.AddNodeUnchecked(v1)
			g.AddNodeUnchecked(v2)
			g.Sequences[v1] = seq1
			g.Sequences[v2] = seq2

			g.SyncSequences()
			syncSeqCases["TwoReachableSequences"] = map[string]interface{}{
				"v1Width":      v1.Width,
				"v1Height":     v1.Height,
				"v1_s1TopLeft": toPointOutput(v1_s1.TopLeft),
				"v1_s2TopLeft": toPointOutput(v1_s2.TopLeft),
				"v2Width":      v2.Width,
				"v2Height":     v2.Height,
				"v2_s1TopLeft": toPointOutput(v2_s1.TopLeft),
				"v2_s2TopLeft": toPointOutput(v2_s2.TopLeft),
			}
		}

		out.Cases["SyncSequences"] = syncSeqCases
	}

	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(outPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write file error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully generated %s\n", outPath)
}
