//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"runtime"
	"sort"
	"strconv"
)

type EntityID int64

const firstD2SpillEntityID EntityID = 1 << 32

func d2FNV32(id string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	return hash.Sum32()
}

type d2EntityIdentity struct {
	entity string
	absID  string
}

type hashedD2EntityIdentity struct {
	d2EntityIdentity
	hash uint32
}

func allocateD2EntityIDs(identities []d2EntityIdentity) (map[string]EntityID, error) {
	hashed := make([]hashedD2EntityIdentity, len(identities))
	bucketSizes := make(map[uint32]int, len(identities))
	seenAbsIDs := make(map[string]struct{}, len(identities))

	for i, identity := range identities {
		if _, duplicate := seenAbsIDs[identity.absID]; duplicate {
			return nil, fmt.Errorf("D2 ID %q is repeated", identity.absID)
		}
		seenAbsIDs[identity.absID] = struct{}{}
		hash := d2FNV32(identity.absID)
		hashed[i] = hashedD2EntityIdentity{d2EntityIdentity: identity, hash: hash}
		bucketSizes[hash]++
	}

	allocated := make(map[string]EntityID, len(identities))
	ambiguous := make([]hashedD2EntityIdentity, 0)

	for _, identity := range hashed {
		if identity.hash != 0 && bucketSizes[identity.hash] == 1 {
			allocated[identity.entity] = EntityID(identity.hash)
			continue
		}
		ambiguous = append(ambiguous, identity)
	}

	sort.Slice(ambiguous, func(i, j int) bool {
		a := ambiguous[i]
		b := ambiguous[j]
		if a.hash != b.hash {
			return a.hash < b.hash
		}
		return a.absID < b.absID
	})

	for i, identity := range ambiguous {
		allocated[identity.entity] = firstD2SpillEntityID + EntityID(i)
	}
	return allocated, nil
}

type TestCase struct {
	Name  string   `json:"name"`
	Input []string `json:"input"`
}

type ComparisonCase struct {
	A      string `json:"a"`
	B      string `json:"b"`
	Result int    `json:"result"`
}

type Output struct {
	HashOracle      map[string]uint32 `json:"hash_oracle"`
	AllocatedOracle map[string]string `json:"allocated_oracle"`
	Comparisons     []ComparisonCase  `json:"comparisons,omitempty"`
}

type RootOutput struct {
	Metadata map[string]string `json:"metadata"`
	Cases    map[string]Output `json:"cases"`
}

func main() {
	cases := []TestCase{
		{Name: "simple", Input: []string{"a", "b", "c"}},
		{Name: "zero_hash", Input: []string{}},
		{Name: "complex_unicode", Input: []string{"hello", "world", "你好", "🌍", "a longer string with spaces"}},
		{Name: "collision_mock", Input: []string{"lKWF05zzXT", "bls2q7BifE"}},
		{Name: "collision_mock_reversed", Input: []string{"bls2q7BifE", "lKWF05zzXT"}},
		{Name: "many_nodes", Input: []string{"n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"}},
		{Name: "utf8_ordering", Input: []string{"\uE000", "\U00010000"}},
		{Name: "utf8_ordering_reversed", Input: []string{"\U00010000", "\uE000"}},
	}

	outData := RootOutput{
		Metadata: map[string]string{
			"runtimeGoVersion":   runtime.Version(),
			"d2BaseCommit":       "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referenceAlgorithm": "hash/fnv New32a + D2 allocateD2EntityIDs semantics",
		},
		Cases: make(map[string]Output),
	}

	for _, tc := range cases {
		out := Output{
			HashOracle:      make(map[string]uint32),
			AllocatedOracle: make(map[string]string),
		}

		identities := make([]d2EntityIdentity, len(tc.Input))
		for i, id := range tc.Input {
			out.HashOracle[id] = d2FNV32(id)
			identities[i] = d2EntityIdentity{entity: id, absID: id}
		}

		alloc, err := allocateD2EntityIDs(identities)
		if err != nil {
			panic(err)
		}

		for k, v := range alloc {
			out.AllocatedOracle[k] = strconv.FormatInt(int64(v), 10)
		}

		if len(tc.Input) == 2 {
			a, b := tc.Input[0], tc.Input[1]
			res := 0
			if a < b {
				res = -1
			} else if a > b {
				res = 1
			}
			out.Comparisons = append(out.Comparisons, ComparisonCase{
				A:      a,
				B:      b,
				Result: res,
			})
		}

		outData.Cases[tc.Name] = out
	}

	b, err := json.MarshalIndent(outData, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "../fixtures/go-entity-id-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	err = os.WriteFile(outFile, b, 0644)
	if err != nil {
		panic(err)
	}
}
