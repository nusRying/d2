package limits

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

type OptimizationOracleReferenceJSON struct {
	ShuffleScenarios []OptimizationShuffleScenarioJSON `json:"shuffleScenarios"`
}

type OptimizationShuffleScenarioJSON struct {
	Name       string `json:"name"`
	Count      int    `json:"count,omitempty"`
	Seed       int64  `json:"seed,string"`
	Result     []int  `json:"result,omitempty"`
	NextInt63  int64  `json:"nextInt63,string"`
	Used       uint64 `json:"used,string"`
	IsRejected bool   `json:"isRejected,omitempty"`
	N          int32  `json:"n,omitempty"`
	Draws      uint64 `json:"draws,string,omitempty"`
	Chosen     int32  `json:"chosen,omitempty"`
}

func TestGenerateOptimizationOracleReference(t *testing.T) {
	fixture := OptimizationOracleReferenceJSON{}

	for _, count := range []int{0, 1, 2, 3, 10, 127, 1024} {
		values := make([]int, count)
		for i := range values {
			values[i] = i
		}
		rnd := rand.New(rand.NewSource(991))
		guard, err := NewOptimizationWorkGuard(context.Background(), "shuffle", MaxOptimizationWorkUnits)
		if err != nil {
			t.Fatal(err)
		}
		if err := Shuffle(values, rnd, guard); err != nil {
			t.Fatal(err)
		}
		fixture.ShuffleScenarios = append(fixture.ShuffleScenarios, OptimizationShuffleScenarioJSON{
			Name:      fmt.Sprintf("shuffle_count_%d", count),
			Count:     count,
			Seed:      991,
			Result:    values,
			NextInt63: rnd.Int63(),
			Used:      guard.Used(),
		})
	}

	// Rejected draw scenario exercising unexported shuffleIndex directly
	n := int32(1_431_655_766)
	threshold := uint32(-n) % uint32(n)
	var seed int64
	var want int32
	var draws uint64
	for ; seed < 100; seed++ {
		random := rand.New(rand.NewSource(seed))
		draws = 0
		for {
			draws++
			product := uint64(random.Uint32()) * uint64(n)
			if uint32(product) >= threshold {
				want = int32(product >> 32)
				break
			}
		}
		if draws > 1 {
			break
		}
	}
	guard, err := NewOptimizationWorkGuard(context.Background(), "shuffle", MaxOptimizationWorkUnits)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := shuffleIndex(rand.New(rand.NewSource(seed)), n, guard)
	if err != nil {
		t.Fatal(err)
	}
	fixture.ShuffleScenarios = append(fixture.ShuffleScenarios, OptimizationShuffleScenarioJSON{
		Name:       "shuffle_rejected_draw",
		IsRejected: true,
		Seed:       seed,
		N:          n,
		Draws:      draws,
		Chosen:     idx,
		Used:       guard.Used(),
		NextInt63:  int64(want),
	})

	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join("..", "..", "js", "test", "fixtures", "go-optimization-reference.json")
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("Wrote %d bytes to %s", len(data), outPath)
}
