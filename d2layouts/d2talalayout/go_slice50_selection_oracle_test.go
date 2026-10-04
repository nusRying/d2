package d2talalayout

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
)

// Slice 50 seed-selection oracle. With TALA_SLICE50_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice50-selection-reference.json; otherwise it recomputes
// every value and asserts the committed fixture byte for byte.

// s50Float encodes float64 values JSON cannot represent.
type s50Float float64

func (f s50Float) MarshalJSON() ([]byte, error) {
	v := float64(f)
	switch {
	case math.IsNaN(v):
		return []byte(`"NaN"`), nil
	case math.IsInf(v, 1):
		return []byte(`"+Inf"`), nil
	case math.IsInf(v, -1):
		return []byte(`"-Inf"`), nil
	}
	return json.Marshal(v)
}

type s50NormalizeCase struct {
	Input  []string `json:"input"`
	Output []string `json:"output,omitempty"`
	Error  string   `json:"error"`
}

type s50Score struct {
	Penalty s50Float `json:"penalty"`
	Area    s50Float `json:"area"`
}

type s50CompareCase struct {
	Left    s50Score `json:"left"`
	Right   s50Score `json:"right"`
	Compare int      `json:"compare"`
}

type s50AttemptSpec struct {
	Score *s50Score `json:"score,omitempty"`
	Error string    `json:"error,omitempty"`
}

type s50CoordinateCase struct {
	Name        string           `json:"name"`
	Seeds       []string         `json:"seeds"`
	Attempts    []s50AttemptSpec `json:"attempts"`
	Concurrency int              `json:"concurrency"`
	Canceled    bool             `json:"canceled,omitempty"`
	Winner      int              `json:"winner"`
	Error       string           `json:"error"`
}

type s50CandidateCase struct {
	Name      string   `json:"name"`
	Mode      string   `json:"mode"`
	Incumbent s50Score `json:"incumbent"`
	Candidate s50Score `json:"candidate"`
	Selected  string   `json:"selected"`
	Error     string   `json:"error"`
	Refine    bool     `json:"refine,omitempty"`
}

type s50SelectionOracle struct {
	Normalize  []s50NormalizeCase  `json:"normalize"`
	Compare    []s50CompareCase    `json:"compare"`
	Coordinate []s50CoordinateCase `json:"coordinate"`
	Candidate  []s50CandidateCase  `json:"candidate"`
}

func s50Strings(values []int64) []string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = fmt.Sprint(v)
	}
	return out
}

func s50ErrString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func s50SeedResult(score s50Score) seedResult {
	return seedResult{graph: layoutgraph.NewGraph(), score: layoutScore{penalty: float64(score.Penalty), area: float64(score.Area)}}
}

func s50NormalizeCases() []s50NormalizeCase {
	inputs := [][]int64{
		nil,
		{1},
		{3, 1, 2},
		{2, 2, 1, 2, 1},
		{math.MinInt64, math.MaxInt64, 0, -1},
	}
	many := make([]int64, 64)
	for i := range many {
		many[i] = int64(i % 16)
	}
	inputs = append(inputs, many)
	tooMany := make([]int64, 65)
	inputs = append(inputs, tooMany)
	unique17 := make([]int64, 17)
	for i := range unique17 {
		unique17[i] = int64(i)
	}
	inputs = append(inputs, unique17)
	var out []s50NormalizeCase
	for _, input := range inputs {
		normalized, err := normalizeSeeds(input)
		c := s50NormalizeCase{Input: s50Strings(input), Error: s50ErrString(err)}
		if err == nil {
			c.Output = s50Strings(normalized)
		}
		out = append(out, c)
	}
	return out
}

func s50CompareCases() []s50CompareCase {
	nan, inf := math.NaN(), math.Inf(1)
	pairs := [][2]s50Score{
		{{1, 10}, {2, 1}},
		{{2, 1}, {1, 10}},
		{{1, 10}, {1, 11}},
		{{1, 10}, {1, 10}},
		{{1, s50Float(math.Nextafter(10, 11))}, {1, 10}},
		{{1, 10}, {s50Float(math.Nextafter(1, 2)), 10}},
		{{1.0000000001, 0}, {1, 0}},
		{{s50Float(nan), 1}, {5, 1}},
		{{5, 1}, {s50Float(inf), 1}},
		{{s50Float(nan), 1}, {s50Float(inf), 1}},
		{{1, -1}, {1, 5}},
		{{1, s50Float(nan)}, {1, s50Float(inf)}},
		{{1, 5}, {1, s50Float(nan)}},
		{{-0.0, 0}, {0, 0}},
	}
	var out []s50CompareCase
	for _, p := range pairs {
		left := layoutScore{penalty: float64(p[0].Penalty), area: float64(p[0].Area)}
		right := layoutScore{penalty: float64(p[1].Penalty), area: float64(p[1].Area)}
		out = append(out, s50CompareCase{Left: p[0], Right: p[1], Compare: left.compare(right)})
	}
	return out
}

func s50CoordinateCases(t *testing.T) []s50CoordinateCase {
	score := func(p, a float64) *s50Score { return &s50Score{Penalty: s50Float(p), Area: s50Float(a)} }
	specs := []s50CoordinateCase{
		{Name: "distinct-best-middle", Seeds: []string{"1", "2", "3"}, Attempts: []s50AttemptSpec{{Score: score(3, 1)}, {Score: score(1, 9)}, {Score: score(2, 1)}}},
		{Name: "near-unequal-penalties", Seeds: []string{"1", "2", "3"}, Attempts: []s50AttemptSpec{{Score: score(1.0000000001, 1)}, {Score: score(1, 1)}, {Score: score(1.0000000002, 1)}}},
		{Name: "adjacent-float-penalties", Seeds: []string{"1", "2", "3"}, Attempts: []s50AttemptSpec{{Score: score(1, 1)}, {Score: score(math.Nextafter(1, 2), 1)}, {Score: score(math.Nextafter(1, 2), 0)}}},
		{Name: "penalty-tie-different-areas", Seeds: []string{"1", "2", "3"}, Attempts: []s50AttemptSpec{{Score: score(4, 10)}, {Score: score(4, 5)}, {Score: score(4, 7)}}},
		{Name: "exact-total-tie-later-wins", Seeds: []string{"1", "2", "3"}, Attempts: []s50AttemptSpec{{Score: score(4, 5)}, {Score: score(4, 5)}, {Score: score(4, 5)}}},
		{Name: "partial-failure", Seeds: []string{"7", "8", "9"}, Attempts: []s50AttemptSpec{{Error: "boom one"}, {Score: score(2, 2)}, {Error: "boom three"}}},
		{Name: "all-failures", Seeds: []string{"5", "-6", "9223372036854775807"}, Attempts: []s50AttemptSpec{{Error: "first failure"}, {Error: "second failure"}, {Error: "third failure"}}},
		{Name: "canceled-after-success", Seeds: []string{"1", "2"}, Attempts: []s50AttemptSpec{{Score: score(1, 1)}, {Score: score(2, 2)}}, Canceled: true},
		{Name: "single-seed", Seeds: []string{"42"}, Attempts: []s50AttemptSpec{{Score: score(0, 0)}}},
	}
	var out []s50CoordinateCase
	for _, spec := range specs {
		for _, concurrency := range []int{1, 2, 3} {
			c := spec
			c.Concurrency = concurrency
			seeds := make([]int64, len(c.Seeds))
			for i, s := range c.Seeds {
				fmt.Sscan(s, &seeds[i])
			}
			results := make([]seedResult, len(c.Attempts))
			for i, a := range c.Attempts {
				if a.Score != nil {
					results[i] = s50SeedResult(*a.Score)
				}
			}
			ctx := context.Background()
			if c.Canceled {
				canceled, cancel := context.WithCancel(ctx)
				cancel()
				ctx = canceled
			}
			best, err := coordinateLocalSeeds(ctx, seeds, concurrency, func(index int, seed int64) localSeedAttempt {
				attempt := localSeedAttempt{index: index, seed: seed}
				if c.Attempts[index].Error != "" {
					attempt.err = errors.New(c.Attempts[index].Error)
				} else {
					attempt.result = results[index]
				}
				return attempt
			})
			c.Winner = -1
			c.Error = s50ErrString(err)
			if err == nil {
				for i := range results {
					if results[i].graph != nil && results[i].graph == best.graph {
						c.Winner = i
					}
				}
				if c.Winner < 0 {
					t.Fatalf("%s: winner not identified", c.Name)
				}
			}
			out = append(out, c)
		}
	}
	return out
}

func s50CandidateCases() []s50CandidateCase {
	specs := []s50CandidateCase{
		{Name: "candidate-error-keeps-incumbent", Mode: "error", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}},
		{Name: "candidate-panic-keeps-incumbent", Mode: "panic", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}},
		{Name: "candidate-worse-keeps-incumbent", Mode: "ok", Incumbent: s50Score{5, 5}, Candidate: s50Score{6, 1}},
		{Name: "candidate-tie-keeps-incumbent", Mode: "ok", Incumbent: s50Score{5, 5}, Candidate: s50Score{5, 5}},
		{Name: "candidate-better-wins", Mode: "ok", Incumbent: s50Score{5, 5}, Candidate: s50Score{5, 4}},
		{Name: "candidate-cancellation-error-propagates", Mode: "canceled-error", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}},
		{Name: "context-canceled-wins-after-success", Mode: "ok-then-cancel", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}},
		{Name: "context-canceled-wins-after-panic", Mode: "panic-then-cancel", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}},
		{Name: "refine-error-keeps-incumbent", Mode: "error", Incumbent: s50Score{5, 5}, Candidate: s50Score{9, 9}, Refine: true},
		{Name: "refine-accepts-worse-success", Mode: "ok", Incumbent: s50Score{5, 5}, Candidate: s50Score{9, 9}, Refine: true},
		{Name: "refine-panic-keeps-incumbent", Mode: "panic", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}, Refine: true},
		{Name: "refine-cancellation-propagates", Mode: "canceled-error", Incumbent: s50Score{5, 5}, Candidate: s50Score{1, 1}, Refine: true},
	}
	var out []s50CandidateCase
	for _, c := range specs {
		ctx, cancel := context.WithCancel(context.Background())
		incumbent := s50SeedResult(c.Incumbent)
		candidate := s50SeedResult(c.Candidate)
		build := func() (seedResult, error) {
			switch c.Mode {
			case "error":
				return seedResult{}, errors.New("candidate failed")
			case "panic":
				panic("candidate panic")
			case "canceled-error":
				return seedResult{}, fmt.Errorf("CompoundRoutes: %w", context.Canceled)
			case "ok-then-cancel":
				cancel()
				return candidate, nil
			case "panic-then-cancel":
				cancel()
				panic("candidate panic")
			}
			return candidate, nil
		}
		var selected seedResult
		var err error
		if c.Refine {
			selected, err = refineSeedResult(ctx, incumbent, build)
		} else {
			selected, err = considerSeedCandidate(ctx, incumbent, build)
		}
		cancel()
		c.Error = s50ErrString(err)
		switch selected.graph {
		case incumbent.graph:
			c.Selected = "incumbent"
		case candidate.graph:
			c.Selected = "candidate"
		default:
			c.Selected = "none"
		}
		out = append(out, c)
	}
	return out
}

func TestSlice50SelectionOracle(t *testing.T) {
	oracle := s50SelectionOracle{
		Normalize:  s50NormalizeCases(),
		Compare:    s50CompareCases(),
		Coordinate: s50CoordinateCases(t),
		Candidate:  s50CandidateCases(),
	}
	encoded, err := json.Marshal(oracle)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("js", "test", "fixtures", "go-slice50-selection-reference.json")
	if os.Getenv("TALA_SLICE50_ORACLE") == "1" {
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
		t.Fatalf("go-slice50-selection-reference.json is stale; regenerate with TALA_SLICE50_ORACLE=1")
	}
}
