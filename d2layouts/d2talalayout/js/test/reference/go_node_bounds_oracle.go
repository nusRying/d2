package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

type PointDTO struct {
	X interface{} `json:"x"`
	Y interface{} `json:"y"`
}

type ModifierAdjustmentsDTO struct {
	Dx float64 `json:"dx"`
	Dy float64 `json:"dy"`
}

type ScenarioResult struct {
	TopLeft             *PointDTO               `json:"topLeft"`
	BottomRight         *PointDTO               `json:"bottomRight"`
	FixedOrigin         *PointDTO               `json:"fixedOrigin,omitempty"`
	ModifierAdjustments *ModifierAdjustmentsDTO `json:"modifierAdjustments,omitempty"`
	LabelTopLeft        *PointDTO               `json:"labelTopLeft,omitempty"`
	IconTopLeft         *PointDTO               `json:"iconTopLeft,omitempty"`
	Leftmost            *bool                   `json:"leftmost,omitempty"`
	Topmost             *bool                   `json:"topmost,omitempty"`
	Rightmost           *bool                   `json:"rightmost,omitempty"`
	Bottommost          *bool                   `json:"bottommost,omitempty"`
}

func boolPtr(b bool) *bool {
	return &b
}

type OracleOutput struct {
	Metadata  map[string]interface{}    `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

func formatFloat(v float64) interface{} {
	if math.IsInf(v, 1) {
		return "+Inf"
	}
	if math.IsInf(v, -1) {
		return "-Inf"
	}
	if math.IsNaN(v) {
		return "NaN"
	}
	if v == 0 && math.Signbit(v) {
		return "-0"
	}
	return v
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{
		X: formatFloat(pt.X),
		Y: formatFloat(pt.Y),
	}
}

func main() {
	out := OracleOutput{
		Metadata: map[string]interface{}{
			"d2BaseCommit": "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"goVersion":    runtime.Version(),
			"goOS":         runtime.GOOS,
			"goArch":       runtime.GOARCH,
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. empty_nodes
	{
		nodes := layoutgraph.Nodes{}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["empty_nodes"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 2. simple_rounded_bounds
	{
		n := layoutgraph.NewNode(1, 30.4, 40.8)
		n.TopLeft = geo.NewPoint(10.2, 20.3)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["simple_rounded_bounds"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 3. negative_half_rounding
	{
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(-10.5, -20.5)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["negative_half_rounding"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 4. fractional_dimensions
	{
		n1 := layoutgraph.NewNode(1, 45.75, 55.25)
		n1.TopLeft = geo.NewPoint(12.35, 23.45)
		n2 := layoutgraph.NewNode(2, 60.15, 70.85)
		n2.TopLeft = geo.NewPoint(100.1, 150.9)
		nodes := layoutgraph.Nodes{n1, n2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fractional_dimensions"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 5. negative_dimensions
	{
		n := layoutgraph.NewNode(1, -15.5, -25.5)
		n.TopLeft = geo.NewPoint(100, 200)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["negative_dimensions"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 6. loop_offsets
	{
		n := layoutgraph.NewNode(1, 50, 40)
		n.TopLeft = geo.NewPoint(100, 200)
		n.LoopOffsets = map[geo.Orientation]float64{
			geo.Left:   12,
			geo.Top:    14,
			geo.Right:  16,
			geo.Bottom: 18,
		}
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["loop_offsets"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 7. modifier_3d_square
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 60)
		n.Is3D = true
		n.SetShape("Square")
		dx, dy := n.ModifierElementAdjustments()
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["modifier_3d_square"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			ModifierAdjustments: &ModifierAdjustmentsDTO{
				Dx: dx,
				Dy: dy,
			},
		}
	}

	// 8. modifier_3d_hexagon
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 60)
		n.Is3D = true
		n.SetShape("Hexagon")
		dx, dy := n.ModifierElementAdjustments()
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["modifier_3d_hexagon"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			ModifierAdjustments: &ModifierAdjustmentsDTO{
				Dx: dx,
				Dy: dy,
			},
		}
	}

	// 9. modifier_multiple
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 60)
		n.IsMultiple = true
		dx, dy := n.ModifierElementAdjustments()
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["modifier_multiple"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			ModifierAdjustments: &ModifierAdjustmentsDTO{
				Dx: dx,
				Dy: dy,
			},
		}
	}

	// 10. modifier_3d_beats_multiple
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 60)
		n.Is3D = true
		n.IsMultiple = true
		n.SetShape("Square")
		dx, dy := n.ModifierElementAdjustments()
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["modifier_3d_beats_multiple"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			ModifierAdjustments: &ModifierAdjustmentsDTO{
				Dx: dx,
				Dy: dy,
			},
		}
	}

	// 11. modifier_plus_loop_offsets
	{
		n := layoutgraph.NewNode(1, 50.5, 20.5)
		n.TopLeft = geo.NewPoint(100, 200)
		n.Is3D = true
		n.LoopOffsets = map[geo.Orientation]float64{
			geo.Left:   3,
			geo.Top:    4,
			geo.Right:  5,
			geo.Bottom: 6,
		}
		dx, dy := n.ModifierElementAdjustments()
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["modifier_plus_loop_offsets"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			ModifierAdjustments: &ModifierAdjustmentsDTO{
				Dx: dx,
				Dy: dy,
			},
		}
	}

	// 12. outside_label_boundary
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 50)
		n.Label = &layoutgraph.Label{
			Position: label.OutsideTopLeft,
			Width:    40,
			Height:   20,
		}
		labelTL := n.LabelTopLeft(n.Label.Position, n.Label.Width, n.Label.Height)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["outside_label_boundary"] = ScenarioResult{
			TopLeft:      pointToDTO(tl),
			BottomRight:  pointToDTO(br),
			LabelTopLeft: pointToDTO(labelTL),
		}
	}

	// 13. outside_label_nonboundary
	{
		// n1 is target with OutsideTopLeft label at (50, 50)
		// n2 is positioned further top-left at (10, 10), so n1 is NOT Leftmost or Topmost!
		n1 := layoutgraph.NewNode(1, 100, 80)
		n1.TopLeft = geo.NewPoint(50, 50)
		n1.Label = &layoutgraph.Label{
			Position: label.OutsideTopLeft,
			Width:    40,
			Height:   20,
		}
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		labelTL := n1.LabelTopLeft(n1.Label.Position, n1.Label.Width, n1.Label.Height)
		nodes := layoutgraph.Nodes{n1, n2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["outside_label_nonboundary"] = ScenarioResult{
			TopLeft:      pointToDTO(tl),
			BottomRight:  pointToDTO(br),
			LabelTopLeft: pointToDTO(labelTL),
		}
	}

	// 14. outside_icon
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 50)
		n.SetShape("Square")
		n.Icon = &layoutgraph.Icon{
			Position: label.OutsideRightTop,
		}
		iconTL := n.LabelTopLeft(n.Icon.Position, 64, 64)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["outside_icon"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
			IconTopLeft: pointToDTO(iconTL),
		}
	}

	// 15. image_icon_excluded
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(50, 50)
		n.SetShape("Image")
		n.Icon = &layoutgraph.Icon{
			Position: label.OutsideRightTop,
		}
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["image_icon_excluded"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 16. combined_label_modifier_loop
	{
		n1 := layoutgraph.NewNode(1, 80.5, 60.5)
		n1.TopLeft = geo.NewPoint(100.25, 150.75)
		n1.Is3D = true
		n1.LoopOffsets = map[geo.Orientation]float64{
			geo.Left:   8,
			geo.Top:    10,
			geo.Right:  12,
			geo.Bottom: 14,
		}
		n1.Label = &layoutgraph.Label{
			Position: label.OutsideTopRight,
			Width:    35,
			Height:   15,
		}
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(50, 50)
		labelTL := n1.LabelTopLeft(n1.Label.Position, n1.Label.Width, n1.Label.Height)
		nodes := layoutgraph.Nodes{n1, n2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["combined_label_modifier_loop"] = ScenarioResult{
			TopLeft:      pointToDTO(tl),
			BottomRight:  pointToDTO(br),
			LabelTopLeft: pointToDTO(labelTL),
		}
	}

	// 17. fixed_origin_root
	{
		n := layoutgraph.NewNode(1, 100, 80)
		n.TopLeft = geo.NewPoint(120, 150)
		n.FixedTopLeft = geo.NewPoint(20, 50)
		nodes := layoutgraph.Nodes{n}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fixed_origin_root"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 18. fixed_origin_nested
	{
		g := layoutgraph.NewGraph()
		container := g.AddNode(layoutgraph.NewNode(10, 300, 300))
		container.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, container)

		child := g.AddNode(layoutgraph.NewNode(1, 80, 60))
		child.TopLeft = geo.NewPoint(100, 120)
		child.FixedTopLeft = geo.NewPoint(15, 25)
		g.AddNewNodeToContainer(container, child)

		nodes := layoutgraph.Nodes{child}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fixed_origin_nested"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 19. fixed_origin_first_wins
	{
		g := layoutgraph.NewGraph()
		container := g.AddNode(layoutgraph.NewNode(10, 400, 400))
		g.AddNewNodeToContainer(nil, container)

		child1 := g.AddNode(layoutgraph.NewNode(1, 80, 60))
		child1.TopLeft = geo.NewPoint(100, 120)
		child1.FixedTopLeft = geo.NewPoint(10, 20)
		g.AddNewNodeToContainer(container, child1)

		child2 := g.AddNode(layoutgraph.NewNode(2, 80, 60))
		child2.TopLeft = geo.NewPoint(200, 220)
		child2.FixedTopLeft = geo.NewPoint(30, 40)
		g.AddNewNodeToContainer(container, child2)

		nodes := layoutgraph.Nodes{child1, child2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fixed_origin_first_wins"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 20. fixed_origin_active_cluster
	{
		g := layoutgraph.NewGraph()
		parentContainer := g.AddNode(layoutgraph.NewNode(100, 500, 500))
		g.AddNewNodeToContainer(nil, parentContainer)

		vessel := g.AddNode(layoutgraph.NewNode(10, 200, 200))
		vessel.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(parentContainer, vessel)
		vessel.SetClusterVessel(true)

		member := layoutgraph.NewNode(1, 60, 40)
		member.TopLeft = geo.NewPoint(70, 80)
		member.FixedTopLeft = geo.NewPoint(10, 15)
		// Raw member.Container is set to a dummy node, but cluster vessel belongs to parentContainer
		dummyContainer := layoutgraph.NewNode(999, 100, 100)
		member.Container = dummyContainer

		cluster := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{member},
			Container: parentContainer,
		}
		member.Cluster = cluster
		g.Clusters[vessel] = cluster

		nodes := layoutgraph.Nodes{member}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fixed_origin_active_cluster"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 21. fixed_origin_active_sequence
	{
		g := layoutgraph.NewGraph()
		parentContainer := g.AddNode(layoutgraph.NewNode(200, 500, 500))
		g.AddNewNodeToContainer(nil, parentContainer)

		vessel := g.AddNode(layoutgraph.NewNode(20, 200, 200))
		vessel.TopLeft = geo.NewPoint(40, 40)
		g.AddNewNodeToContainer(parentContainer, vessel)

		step := layoutgraph.NewNode(1, 50, 30)
		step.TopLeft = geo.NewPoint(60, 70)
		step.FixedTopLeft = geo.NewPoint(5, 10)
		// Raw step.Container differs from vessel.Container
		dummyContainer := layoutgraph.NewNode(888, 100, 100)
		step.Container = dummyContainer

		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{step},
			Container: parentContainer,
		}
		step.Sequence = seq
		g.Sequences[vessel] = seq

		nodes := layoutgraph.Nodes{step}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["fixed_origin_active_sequence"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 22. partial_null_with_fixed_origin
	{
		n1 := layoutgraph.NewNode(1, 100, 100)
		n1.TopLeft = nil
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(100, 200)
		n2.FixedTopLeft = geo.NewPoint(25, 35)

		nodes := layoutgraph.Nodes{n1, n2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["partial_null_with_fixed_origin"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 23. boundary_axes_sibling_comparisons
	{
		// Target at (50, 50) size (100, 100)
		// Test OutsideBottomRight label:
		// Right trigger: labelTL.X > br.X
		// Bottom trigger: labelTL.Y > br.Y
		nRightBottom := layoutgraph.NewNode(1, 100, 100)
		nRightBottom.TopLeft = geo.NewPoint(50, 50)
		nRightBottom.Label = &layoutgraph.Label{
			Position: label.OutsideBottomRight,
			Width:    30,
			Height:   20,
		}
		nodesRightBottomBoundary := layoutgraph.Nodes{nRightBottom}
		tl1, br1 := nodesRightBottomBoundary.FixedBoundingBox()
		out.Scenarios["outside_label_bottom_right_boundary"] = ScenarioResult{
			TopLeft:     pointToDTO(tl1),
			BottomRight: pointToDTO(br1),
		}

		// Add peer extending right and bottom beyond nRightBottom so nRightBottom is NOT Rightmost or Bottommost
		peerRB := layoutgraph.NewNode(2, 200, 200)
		peerRB.TopLeft = geo.NewPoint(100, 100)
		nodesRightBottomNonBoundary := layoutgraph.Nodes{nRightBottom, peerRB}
		tl2, br2 := nodesRightBottomNonBoundary.FixedBoundingBox()
		out.Scenarios["outside_label_bottom_right_nonboundary"] = ScenarioResult{
			TopLeft:     pointToDTO(tl2),
			BottomRight: pointToDTO(br2),
		}
	}

	// 24. tied_extremes
	{
		n1 := layoutgraph.NewNode(1, 50, 50)
		n1.TopLeft = geo.NewPoint(10, 20)
		n1.Label = &layoutgraph.Label{
			Position: label.OutsideLeftTop,
			Width:    20,
			Height:   10,
		}
		// n2 has identical TopLeft.X (10) so tied for Leftmost
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 100)
		nodes := layoutgraph.Nodes{n1, n2}
		tl, br := nodes.FixedBoundingBox()
		out.Scenarios["tied_extremes"] = ScenarioResult{
			TopLeft:     pointToDTO(tl),
			BottomRight: pointToDTO(br),
		}
	}

	// 25. nil_peer_top_left
	{
		target := layoutgraph.NewNode(1, 50, 50)
		target.TopLeft = geo.NewPoint(30, 40)

		nilPeer := layoutgraph.NewNode(2, 50, 50)
		nilPeer.TopLeft = nil

		otherPeer := layoutgraph.NewNode(3, 50, 50)
		otherPeer.TopLeft = geo.NewPoint(100, 100)

		nodes := layoutgraph.Nodes{target, nilPeer, otherPeer}

		lm := nodes.Leftmost(target)
		tm := nodes.Topmost(target)
		rm := nodes.Rightmost(target)
		bm := nodes.Bottommost(target)

		out.Scenarios["nil_peer_top_left"] = ScenarioResult{
			Leftmost:   boolPtr(lm),
			Topmost:    boolPtr(tm),
			Rightmost:  boolPtr(rm),
			Bottommost: boolPtr(bm),
		}
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	fixturePath := "js/test/fixtures/go-node-bounds-reference.json"
	if _, err := os.Stat("d2layouts/d2talalayout"); err == nil {
		fixturePath = "d2layouts/d2talalayout/" + fixturePath
	}
	if err := os.WriteFile(fixturePath, data, 0644); err != nil {
		panic(err)
	}

	hash := sha256.Sum256(data)
	fmt.Printf("Wrote %d bytes to %s\n", len(data), fixturePath)
	fmt.Printf("SHA256: %s\n", hex.EncodeToString(hash[:]))
}
