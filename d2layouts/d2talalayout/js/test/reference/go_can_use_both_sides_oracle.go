//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
	"github.com/d2lang/d2/lib/geo"
)

type CanUseBothSidesResult struct {
	Success        bool    `json:"success"`
	Panic          string  `json:"panic,omitempty"`
	Width          float64 `json:"width"`
	Height         float64 `json:"height"`
	Orientation    string  `json:"orientation"`
	OrientationInt int     `json:"orientationInt"`
	Result         bool    `json:"result"`
}

type Output struct {
	Scenarios map[string]CanUseBothSidesResult `json:"scenarios"`
}

func orientationName(o geo.Orientation) string {
	switch o {
	case geo.TopLeft:
		return "TopLeft"
	case geo.TopRight:
		return "TopRight"
	case geo.BottomLeft:
		return "BottomLeft"
	case geo.BottomRight:
		return "BottomRight"
	case geo.Top:
		return "Top"
	case geo.Right:
		return "Right"
	case geo.Bottom:
		return "Bottom"
	case geo.Left:
		return "Left"
	case geo.NONE:
		return "NONE"
	default:
		return fmt.Sprintf("Unknown(%d)", int(o))
	}
}

func main() {
	out := Output{
		Scenarios: make(map[string]CanUseBothSidesResult),
	}

	runScenario := func(name string, setup func() (*layoutgraph.Node, geo.Orientation)) {
		defer func() {
			if r := recover(); r != nil {
				out.Scenarios[name] = CanUseBothSidesResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()

		node, orientation := setup()
		res := proximity.CanUseBothSides(node, orientation)

		w := 0.0
		h := 0.0
		if node != nil {
			w = node.Width
			h = node.Height
		}

		out.Scenarios[name] = CanUseBothSidesResult{
			Success:        true,
			Width:          w,
			Height:         h,
			Orientation:    orientationName(orientation),
			OrientationInt: int(orientation),
			Result:         res,
		}
	}

	newNode := func(w, h float64) *layoutgraph.Node {
		n := layoutgraph.NewNode(1, w, h)
		n.Width = w
		n.Height = h
		return n
	}

	// A. normal wide + Top (30 x 10)
	runScenario("A_normal_wide_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(30, 10), geo.Top
	})

	// B. normal wide + Bottom (30 x 10)
	runScenario("B_normal_wide_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(30, 10), geo.Bottom
	})

	// C. normal wide + Left (30 x 10)
	runScenario("C_normal_wide_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(30, 10), geo.Left
	})

	// D. normal wide + Right (30 x 10)
	runScenario("D_normal_wide_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(30, 10), geo.Right
	})

	// E. normal tall + Left (10 x 30)
	runScenario("E_normal_tall_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 30), geo.Left
	})

	// F. normal tall + Right (10 x 30)
	runScenario("F_normal_tall_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 30), geo.Right
	})

	// G. normal tall + Top (10 x 30)
	runScenario("G_normal_tall_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 30), geo.Top
	})

	// H. normal tall + Bottom (10 x 30)
	runScenario("H_normal_tall_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 30), geo.Bottom
	})

	// I. square (10 x 10) - 4 cardinal orientations
	runScenario("I_square_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 10), geo.Top
	})
	runScenario("I_square_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 10), geo.Bottom
	})
	runScenario("I_square_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 10), geo.Left
	})
	runScenario("I_square_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 10), geo.Right
	})

	// J. exact wide boundary (20 x 10) - 4 cardinal orientations
	runScenario("J_exact_wide_boundary_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(20, 10), geo.Top
	})
	runScenario("J_exact_wide_boundary_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(20, 10), geo.Bottom
	})
	runScenario("J_exact_wide_boundary_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(20, 10), geo.Left
	})
	runScenario("J_exact_wide_boundary_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(20, 10), geo.Right
	})

	// K. exact tall boundary (10 x 20) - 4 cardinal orientations
	runScenario("K_exact_tall_boundary_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 20), geo.Top
	})
	runScenario("K_exact_tall_boundary_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 20), geo.Bottom
	})
	runScenario("K_exact_tall_boundary_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 20), geo.Left
	})
	runScenario("K_exact_tall_boundary_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 20), geo.Right
	})

	// L. just under wide boundary (19.999999 x 10) Top
	runScenario("L_just_under_wide_boundary_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(19.999999, 10), geo.Top
	})

	// M. just over wide boundary (20.000001 x 10) Top
	runScenario("M_just_over_wide_boundary_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(20.000001, 10), geo.Top
	})

	// N. just under tall boundary (10 x 19.999999) Left
	runScenario("N_just_under_tall_boundary_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 19.999999), geo.Left
	})

	// O. just over tall boundary (10 x 20.000001) Left
	runScenario("O_just_over_tall_boundary_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 20.000001), geo.Left
	})

	// P. zero x zero (0 x 0) - all 4 cardinal orientations
	runScenario("P_zero_zero_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 0), geo.Top
	})
	runScenario("P_zero_zero_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 0), geo.Bottom
	})
	runScenario("P_zero_zero_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 0), geo.Left
	})
	runScenario("P_zero_zero_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 0), geo.Right
	})

	// Q. positive width / zero height (10 x 0) - all 4 cardinal orientations
	runScenario("Q_positive_width_zero_height_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 0), geo.Top
	})
	runScenario("Q_positive_width_zero_height_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 0), geo.Bottom
	})
	runScenario("Q_positive_width_zero_height_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 0), geo.Left
	})
	runScenario("Q_positive_width_zero_height_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 0), geo.Right
	})

	// R. zero width / positive height (0 x 10) - all 4 cardinal orientations
	runScenario("R_zero_width_positive_height_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 10), geo.Top
	})
	runScenario("R_zero_width_positive_height_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 10), geo.Bottom
	})
	runScenario("R_zero_width_positive_height_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 10), geo.Left
	})
	runScenario("R_zero_width_positive_height_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(0, 10), geo.Right
	})

	// S. negative width and height case 1 (-10 x -5) - all 4 cardinal orientations
	runScenario("S_negative_case1_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-10, -5), geo.Top
	})
	runScenario("S_negative_case1_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-10, -5), geo.Bottom
	})
	runScenario("S_negative_case1_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-10, -5), geo.Left
	})
	runScenario("S_negative_case1_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-10, -5), geo.Right
	})

	// T. negative width and height case 2 (-5 x -10) - all 4 cardinal orientations
	runScenario("T_negative_case2_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, -10), geo.Top
	})
	runScenario("T_negative_case2_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, -10), geo.Bottom
	})
	runScenario("T_negative_case2_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, -10), geo.Left
	})
	runScenario("T_negative_case2_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, -10), geo.Right
	})

	// U. mixed sign (10 x -5) - all 4 cardinal orientations
	runScenario("U_mixed_sign_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, -5), geo.Top
	})
	runScenario("U_mixed_sign_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, -5), geo.Bottom
	})
	runScenario("U_mixed_sign_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, -5), geo.Left
	})
	runScenario("U_mixed_sign_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, -5), geo.Right
	})

	// V. mixed sign reverse (-5 x 10) - all 4 cardinal orientations
	runScenario("V_mixed_sign_reverse_top", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, 10), geo.Top
	})
	runScenario("V_mixed_sign_reverse_bottom", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, 10), geo.Bottom
	})
	runScenario("V_mixed_sign_reverse_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, 10), geo.Left
	})
	runScenario("V_mixed_sign_reverse_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(-5, 10), geo.Right
	})

	// W. fractional wide threshold (2.5 x 1.25) Top
	runScenario("W_fractional_wide_threshold", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(2.5, 1.25), geo.Top
	})

	// X. fractional tall threshold (1.25 x 2.5) Left
	runScenario("X_fractional_tall_threshold", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(1.25, 2.5), geo.Left
	})

	// Y. TopLeft
	runScenario("Y_top_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(100, 10), geo.TopLeft
	})

	// Z. TopRight
	runScenario("Z_top_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(100, 10), geo.TopRight
	})

	// AA. BottomLeft
	runScenario("AA_bottom_left", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 100), geo.BottomLeft
	})

	// AB. BottomRight
	runScenario("AB_bottom_right", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(10, 100), geo.BottomRight
	})

	// AC. NONE
	runScenario("AC_none", func() (*layoutgraph.Node, geo.Orientation) {
		return newNode(100, 10), geo.NONE
	})

	// AD. nil node
	runScenario("AD_nil_node", func() (*layoutgraph.Node, geo.Orientation) {
		return nil, geo.Top
	})

	outBytes, _ := json.MarshalIndent(out, "", "  ")

	targetPath := "go-can-use-both-sides-reference.json"
	targetDir := filepath.Join(".", "test", "fixtures")
	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		targetDir = filepath.Join("d2layouts", "d2talalayout", "js", "test", "fixtures")
	}
	dest := filepath.Join(targetDir, targetPath)
	err := os.WriteFile(dest, outBytes, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error writing fixture: %v\n", err)
		os.Exit(1)
	}

	keys := make([]string, 0, len(out.Scenarios))
	for k := range out.Scenarios {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("Successfully generated %d scenarios into %s\n", len(keys), dest)
	for _, k := range keys {
		s := out.Scenarios[k]
		if s.Panic != "" {
			fmt.Printf("  %s: panic (%s)\n", k, s.Panic)
		} else {
			fmt.Printf("  %s: result = %v\n", k, s.Result)
		}
	}
}
