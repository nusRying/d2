package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
)

type Fixture struct {
	Seeds       []SeedRun       `json:"seeds"`
	Int63nTests []Int63nRun     `json:"int63nTests"`
	MixedRun    *MixedRunResult `json:"mixedRun"`
}

type SeedRun struct {
	Seed        string   `json:"seed"`
	Int63       []string `json:"int63"`
	Float64Bits []string `json:"float64Bits"`
}

type Int63nRun struct {
	Seed   string   `json:"seed"`
	Bounds []string `json:"bounds"`
	Values []string `json:"values"`
}

type MixedRunResult struct {
	Seed   string   `json:"seed"`
	Values []string `json:"values"`
	Types  []string `json:"types"`
}

func main() {
	seeds := []int64{0, 1, -1, 42, 2147483647, 2147483648, -2147483648, 9223372036854775807, -9223372036854775808}

	fixture := Fixture{}

	for _, s := range seeds {
		rng := rand.New(rand.NewSource(s))
		
		int63Vals := make([]string, 20)
		for i := 0; i < 20; i++ {
			int63Vals[i] = fmt.Sprintf("%d", rng.Int63())
		}
		
		rng2 := rand.New(rand.NewSource(s))
		float64Bits := make([]string, 20)
		for i := 0; i < 20; i++ {
			f := rng2.Float64()
			bits := math.Float64bits(f)
			float64Bits[i] = fmt.Sprintf("%016x", bits)
		}

		fixture.Seeds = append(fixture.Seeds, SeedRun{
			Seed:        fmt.Sprintf("%d", s),
			Int63:       int63Vals,
			Float64Bits: float64Bits,
		})
	}

	bounds := []int64{1, 2, 3, 10, 1024, 2147483647, 2147483648, 4611686018427387905, 9223372036854775807}
	
	for _, s := range seeds {
		rng := rand.New(rand.NewSource(s))
		vals := make([]string, len(bounds))
		boundsStrs := make([]string, len(bounds))
		for i, b := range bounds {
			vals[i] = fmt.Sprintf("%d", rng.Int63n(b))
			boundsStrs[i] = fmt.Sprintf("%d", b)
		}
		fixture.Int63nTests = append(fixture.Int63nTests, Int63nRun{
			Seed:   fmt.Sprintf("%d", s),
			Bounds: boundsStrs,
			Values: vals,
		})
	}

	mixedSeed := int64(123456789)
	mixedRng := rand.New(rand.NewSource(mixedSeed))
	mixedRun := MixedRunResult{
		Seed: fmt.Sprintf("%d", mixedSeed),
	}
	
	addMixed := func(typ string, val string) {
		mixedRun.Types = append(mixedRun.Types, typ)
		mixedRun.Values = append(mixedRun.Values, val)
	}
	
	addMixed("Int63", fmt.Sprintf("%d", mixedRng.Int63()))
	addMixed("Float64Bits", fmt.Sprintf("%016x", math.Float64bits(mixedRng.Float64())))
	addMixed("Int63n(10)", fmt.Sprintf("%d", mixedRng.Int63n(10)))
	addMixed("Int63", fmt.Sprintf("%d", mixedRng.Int63()))
	addMixed("Int63n(3)", fmt.Sprintf("%d", mixedRng.Int63n(3)))
	addMixed("Float64Bits", fmt.Sprintf("%016x", math.Float64bits(mixedRng.Float64())))
	addMixed("Int63n(4611686018427387905)", fmt.Sprintf("%d", mixedRng.Int63n(4611686018427387905)))
	addMixed("Int63", fmt.Sprintf("%d", mixedRng.Int63()))

	fixture.MixedRun = &mixedRun

	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		panic(err)
	}
	os.Stdout.Write(data)
}
