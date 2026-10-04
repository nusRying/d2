//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type PointDTO struct {
	X string `json:"x"`
	Y string `json:"y"`
}

type VesselStateDTO struct {
	TopLeft *PointDTO `json:"topLeft"`
	Width   string    `json:"width"`
	Height  string    `json:"height"`
}

type MemberStateDTO struct {
	Index        int       `json:"index"`
	IsNil        bool      `json:"isNil"`
	ID           string    `json:"id,omitempty"`
	TopLeft      *PointDTO `json:"topLeft,omitempty"`
	FixedTopLeft *PointDTO `json:"fixedTopLeft,omitempty"`
	Width        string    `json:"width,omitempty"`
	Height       string    `json:"height,omitempty"`
}

type DescendantStateDTO struct {
	ID           string    `json:"id"`
	TopLeft      *PointDTO `json:"topLeft,omitempty"`
	FixedTopLeft *PointDTO `json:"fixedTopLeft,omitempty"`
	Width        string    `json:"width"`
	Height       string    `json:"height"`
}

type ScenarioResult struct {
	Name              string                        `json:"name"`
	Operation         string                        `json:"operation"`
	Panicked          bool                          `json:"panicked"`
	PanicMessage      string                        `json:"panicMessage,omitempty"`
	Arrangement       string                        `json:"arrangement"`
	Padding           float64                       `json:"padding"`
	FixedSize         bool                          `json:"fixedSize"`
	VesselBefore      *VesselStateDTO               `json:"vesselBefore"`
	VesselAfter       *VesselStateDTO               `json:"vesselAfter"`
	MembersBefore     []MemberStateDTO              `json:"membersBefore"`
	MembersAfter      []MemberStateDTO              `json:"membersAfter"`
	DescendantsBefore map[string]DescendantStateDTO `json:"descendantsBefore,omitempty"`
	DescendantsAfter  map[string]DescendantStateDTO `json:"descendantsAfter,omitempty"`
}

type OracleOutput struct {
	Metadata  map[string]string         `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

func numberClass(v float64) string {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 1):
		return "+Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	default:
		return strconv.FormatFloat(v, 'g', -1, 64)
	}
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{
		X: numberClass(pt.X),
		Y: numberClass(pt.Y),
	}
}

func captureVessel(v *layoutgraph.Node) *VesselStateDTO {
	if v == nil {
		return nil
	}
	return &VesselStateDTO{
		TopLeft: pointToDTO(v.TopLeft),
		Width:   numberClass(v.Width),
		Height:  numberClass(v.Height),
	}
}

func captureMembers(nodes []*layoutgraph.Node) []MemberStateDTO {
	res := make([]MemberStateDTO, len(nodes))
	for i, n := range nodes {
		if n == nil {
			res[i] = MemberStateDTO{
				Index: i,
				IsNil: true,
			}
		} else {
			dto := MemberStateDTO{
				Index:   i,
				IsNil:   false,
				ID:      fmt.Sprintf("%v", n.ID),
				TopLeft: pointToDTO(n.TopLeft),
				Width:   numberClass(n.Width),
				Height:  numberClass(n.Height),
			}
			if n.FixedTopLeft != nil {
				dto.FixedTopLeft = pointToDTO(n.FixedTopLeft)
			}
			res[i] = dto
		}
	}
	return res
}

func captureDescendants(desc []*layoutgraph.Node) map[string]DescendantStateDTO {
	if len(desc) == 0 {
		return nil
	}
	res := make(map[string]DescendantStateDTO)
	for _, n := range desc {
		if n != nil {
			id := fmt.Sprintf("%v", n.ID)
			dto := DescendantStateDTO{
				ID:      id,
				TopLeft: pointToDTO(n.TopLeft),
				Width:   numberClass(n.Width),
				Height:  numberClass(n.Height),
			}
			if n.FixedTopLeft != nil {
				dto.FixedTopLeft = pointToDTO(n.FixedTopLeft)
			}
			res[id] = dto
		}
	}
	return res
}

func runSafe(fn func()) (panicked bool, panicMsg string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			panicMsg = fmt.Sprintf("%v", r)
		}
	}()
	fn()
	return false, ""
}

func main() {
	out := OracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion": runtime.Version(),
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"slice":            "Slice 24 — Cluster Arrangement & SyncGeometry",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. arrange_nil_vessel_panics
	{
		n1 := layoutgraph.NewNode(1, 40, 40)
		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      nil,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["arrange_nil_vessel_panics"] = ScenarioResult{
			Name:          "arrange_nil_vessel_panics",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 2. vessel_unplaced_nil_member_noop
	{
		v := layoutgraph.NewNode(100, 100, 100)
		v.TopLeft = nil // unplaced
		nodes := []*layoutgraph.Node{nil}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["vessel_unplaced_nil_member_noop"] = ScenarioResult{
			Name:          "vessel_unplaced_nil_member_noop",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 3. row_basic
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 40, 60)
		n1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, n1)

		n2 := layoutgraph.NewNode(2, 80, 40)
		n2.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, n2)

		nodes := []*layoutgraph.Node{n1, n2}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["row_basic"] = ScenarioResult{
			Name:          "row_basic",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 4. column_basic
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 100, 400)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 60, 40)
		n1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, n1)

		n2 := layoutgraph.NewNode(2, 40, 80)
		n2.TopLeft = geo.NewPoint(20, 20)
		g.AddNewNodeToContainer(nil, n2)

		nodes := []*layoutgraph.Node{n1, n2}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Column,
			Padding:     15,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["column_basic"] = ScenarioResult{
			Name:          "column_basic",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 5. row_positive_half_round
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 50)
		v.TopLeft = geo.NewPoint(100, 100) // vesselCenter = 125

		n1 := layoutgraph.NewNode(1, 40, 41)
		n1.TopLeft = geo.NewPoint(10, 104) // center = 104 + 20.5 = 124.5; diff = +0.5 -> round to +1
		g.AddNewNodeToContainer(nil, n1)

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["row_positive_half_round"] = ScenarioResult{
			Name:          "row_positive_half_round",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 6. column_negative_half_round
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 50, 300)
		v.TopLeft = geo.NewPoint(100, 100) // vesselCenter = 125

		n1 := layoutgraph.NewNode(1, 41, 40)
		n1.TopLeft = geo.NewPoint(105, 10) // center = 105 + 20.5 = 125.5; diff = -0.5 -> round to -1
		g.AddNewNodeToContainer(nil, n1)

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Column,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["column_negative_half_round"] = ScenarioResult{
			Name:          "column_negative_half_round",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 7. row_fractional_padding
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100.25, 200)

		n1 := layoutgraph.NewNode(1, 30.5, 40)
		n1.TopLeft = geo.NewPoint(10.125, 50)
		g.AddNewNodeToContainer(nil, n1)

		n2 := layoutgraph.NewNode(2, 20.25, 40)
		n2.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, n2)

		nodes := []*layoutgraph.Node{n1, n2}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     7.5,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["row_fractional_padding"] = ScenarioResult{
			Name:          "row_fractional_padding",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 8. negative_padding
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, n1)

		n2 := layoutgraph.NewNode(2, 50, 40)
		n2.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, n2)

		nodes := []*layoutgraph.Node{n1, n2}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     -10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["negative_padding"] = ScenarioResult{
			Name:          "negative_padding",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 9. row_positioned_container_with_descendant
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		parent := layoutgraph.NewNode(1, 100, 80)
		parent.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, parent)

		child := layoutgraph.NewNode(2, 40, 30)
		child.TopLeft = geo.NewPoint(20, 20)
		g.AddNewNodeToContainer(parent, child)

		descendants := []*layoutgraph.Node{child}
		dBefore := captureDescendants(descendants)

		nodes := []*layoutgraph.Node{parent}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)
		dAfter := captureDescendants(descendants)

		out.Scenarios["row_positioned_container_with_descendant"] = ScenarioResult{
			Name:              "row_positioned_container_with_descendant",
			Operation:         "ArrangeClusterNodes",
			Panicked:          panicked,
			PanicMessage:      panicMsg,
			Arrangement:       string(c.Arrangement),
			Padding:           c.Padding,
			FixedSize:         c.FixedSize,
			VesselBefore:      vBefore,
			VesselAfter:       vAfter,
			MembersBefore:     mBefore,
			MembersAfter:      mAfter,
			DescendantsBefore: dBefore,
			DescendantsAfter:  dAfter,
		}
	}

	// 10. row_unplaced_container_member
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		parent := layoutgraph.NewNode(1, 120, 80)
		parent.TopLeft = nil // unplaced container member!
		g.AddNewNodeToContainer(nil, parent)

		child := layoutgraph.NewNode(2, 40, 30)
		child.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(parent, child)

		descendants := []*layoutgraph.Node{child}
		dBefore := captureDescendants(descendants)

		nodes := []*layoutgraph.Node{parent}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)
		dAfter := captureDescendants(descendants)

		out.Scenarios["row_unplaced_container_member"] = ScenarioResult{
			Name:              "row_unplaced_container_member",
			Operation:         "ArrangeClusterNodes",
			Panicked:          panicked,
			PanicMessage:      panicMsg,
			Arrangement:       string(c.Arrangement),
			Padding:           c.Padding,
			FixedSize:         c.FixedSize,
			VesselBefore:      vBefore,
			VesselAfter:       vAfter,
			MembersBefore:     mBefore,
			MembersAfter:      mAfter,
			DescendantsBefore: dBefore,
			DescendantsAfter:  dAfter,
		}
	}

	// 11. unplaced_plain_node
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = nil // unplaced plain node
		g.AddNewNodeToContainer(nil, n1)

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["unplaced_plain_node"] = ScenarioResult{
			Name:          "unplaced_plain_node",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 12. unknown_arrangement_noop
	{
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(10, 10)

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: "Diagonal",
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["unknown_arrangement_noop"] = ScenarioResult{
			Name:          "unknown_arrangement_noop",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 13. duplicate_member_occurrence
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, n1)

		nodes := []*layoutgraph.Node{n1, n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["duplicate_member_occurrence"] = ScenarioResult{
			Name:          "duplicate_member_occurrence",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 14. nil_member_panics
	{
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		nodes := []*layoutgraph.Node{nil}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["nil_member_panics"] = ScenarioResult{
			Name:          "nil_member_panics",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 15. second_nil_member_partial_mutation
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, n1)

		nodes := []*layoutgraph.Node{n1, nil}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["second_nil_member_partial_mutation"] = ScenarioResult{
			Name:          "second_nil_member_partial_mutation",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 16. detached_member_nonzero_partial_move
	{
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(0, 0)
		n1.Graph = nil // detached

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["detached_member_nonzero_partial_move"] = ScenarioResult{
			Name:          "detached_member_nonzero_partial_move",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 17. detached_member_zero_delta_succeeds
	{
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		// Row vesselCenter = 200 + 50 = 250
		// dy = round(250 - (230 + 20)) = 0
		// dx = 100 - 100 = 0
		n1 := layoutgraph.NewNode(1, 50, 40)
		n1.TopLeft = geo.NewPoint(100, 230)
		n1.Graph = nil // detached

		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["detached_member_zero_delta_succeeds"] = ScenarioResult{
			Name:          "detached_member_zero_delta_succeeds",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 18. arrange_idempotent
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		n1 := layoutgraph.NewNode(1, 40, 60)
		n1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, n1)

		n2 := layoutgraph.NewNode(2, 80, 40)
		n2.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, n2)

		nodes := []*layoutgraph.Node{n1, n2}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		c.ArrangeClusterNodes()

		// Call again to verify idempotence
		c.ArrangeClusterNodes()

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["arrange_idempotent"] = ScenarioResult{
			Name:          "arrange_idempotent",
			Operation:     "ArrangeClusterNodes",
			Panicked:      false,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 19. non_monotonic_member_order
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 300, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		nz := layoutgraph.NewNode(99, 30, 40)
		nz.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, nz)

		na := layoutgraph.NewNode(1, 40, 40)
		na.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, na)

		nm := layoutgraph.NewNode(50, 50, 40)
		nm.TopLeft = geo.NewPoint(0, 0)
		g.AddNewNodeToContainer(nil, nm)

		nodes := []*layoutgraph.Node{nz, na, nm}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.ArrangeClusterNodes()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["non_monotonic_member_order"] = ScenarioResult{
			Name:          "non_monotonic_member_order",
			Operation:     "ArrangeClusterNodes",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 20. sync_nil_vessel_panics
	{
		n1 := layoutgraph.NewNode(1, 40, 40)
		nodes := []*layoutgraph.Node{n1}
		c := &layoutgraph.Cluster{
			Vessel:      nil,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_nil_vessel_panics"] = ScenarioResult{
			Name:          "sync_nil_vessel_panics",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 21. sync_row_normalizes_sizes
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 50, 20)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_row_normalizes_sizes"] = ScenarioResult{
			Name:          "sync_row_normalizes_sizes",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 22. sync_column_normalizes_sizes
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 40, 30)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 20, 60)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Column,
			Padding:     15,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_column_normalizes_sizes"] = ScenarioResult{
			Name:          "sync_column_normalizes_sizes",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 23. sync_fixed_size_heterogeneous_row
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 50, 20)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   true,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_fixed_size_heterogeneous_row"] = ScenarioResult{
			Name:          "sync_fixed_size_heterogeneous_row",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 24. sync_fixed_size_heterogeneous_column
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 40, 30)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 20, 60)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Column,
			Padding:     10,
			FixedSize:   true,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_fixed_size_heterogeneous_column"] = ScenarioResult{
			Name:          "sync_fixed_size_heterogeneous_column",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 25. sync_unplaced_vessel_resizes_only
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = nil // unplaced

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 50, 20)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_unplaced_vessel_resizes_only"] = ScenarioResult{
			Name:          "sync_unplaced_vessel_resizes_only",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 26. sync_empty_row
	{
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nodes := []*layoutgraph.Node{}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_empty_row"] = ScenarioResult{
			Name:          "sync_empty_row",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 27. sync_empty_column
	{
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nodes := []*layoutgraph.Node{}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Column,
			Padding:     10,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_empty_column"] = ScenarioResult{
			Name:          "sync_empty_column",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 28. sync_unknown_arrangement
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(100, 999, 888)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, nA)

		nB := layoutgraph.NewNode(2, 50, 20)
		nB.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(nil, nB)

		nodes := []*layoutgraph.Node{nA, nB}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: "Grid",
			Padding:     10,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_unknown_arrangement"] = ScenarioResult{
			Name:          "sync_unknown_arrangement",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 29. sync_nil_member_panics_before_resize_mutation
	{
		v := layoutgraph.NewNode(100, 100, 100)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)

		nodes := []*layoutgraph.Node{nA, nil}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_nil_member_panics_before_resize_mutation"] = ScenarioResult{
			Name:          "sync_nil_member_panics_before_resize_mutation",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	// 30. sync_resize_then_arrange_partial_failure
	{
		v := layoutgraph.NewNode(100, 0, 0)
		v.TopLeft = geo.NewPoint(100, 200)

		nA := layoutgraph.NewNode(1, 30, 40)
		nA.TopLeft = geo.NewPoint(10, 10)
		nA.Graph = nil // detached: translate root succeeds, allDescendantNodes panics!

		nodes := []*layoutgraph.Node{nA}
		c := &layoutgraph.Cluster{
			Vessel:      v,
			Nodes:       nodes,
			Arrangement: layoutgraph.Row,
			Padding:     10,
			FixedSize:   false,
		}

		vBefore := captureVessel(c.Vessel)
		mBefore := captureMembers(c.Nodes)

		panicked, panicMsg := runSafe(func() {
			c.SyncGeometry()
		})

		vAfter := captureVessel(c.Vessel)
		mAfter := captureMembers(c.Nodes)

		out.Scenarios["sync_resize_then_arrange_partial_failure"] = ScenarioResult{
			Name:          "sync_resize_then_arrange_partial_failure",
			Operation:     "SyncGeometry",
			Panicked:      panicked,
			PanicMessage:  panicMsg,
			Arrangement:   string(c.Arrangement),
			Padding:       c.Padding,
			FixedSize:     c.FixedSize,
			VesselBefore:  vBefore,
			VesselAfter:   vAfter,
			MembersBefore: mBefore,
			MembersAfter:  mAfter,
		}
	}

	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	targetPath := "test/fixtures/go-cluster-geometry-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else {
		// If running from d2 root vs js directory
		if _, err := os.Stat("d2layouts/d2talalayout/js"); err == nil {
			targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-cluster-geometry-reference.json"
		}
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir error: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
