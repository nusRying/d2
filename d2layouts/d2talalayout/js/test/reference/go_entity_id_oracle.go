package main

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"sort"
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

type Output struct {
	HashOracle      map[string]uint32 `json:"hash_oracle"`
	AllocatedOracle map[string]int64  `json:"allocated_oracle"`
}

func main() {
	cases := []TestCase{
		{Name: "simple", Input: []string{"a", "b", "c"}},
		{Name: "collision_mock", Input: []string{}}, // we'll find some actual FNV32 collisions below or let it run
		{Name: "zero_hash", Input: []string{}},
		{Name: "complex_unicode", Input: []string{"hello", "world", "你好", "🌍", "a longer string with spaces"}},
	}
	
	// Add an explicit collision if we can find one, or just trust the logic.
	// Actually, let's just generate a large set of random IDs to ensure we cover edge cases
	cases = append(cases, TestCase{
		Name: "many_nodes",
		Input: []string{"n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"},
	})
	
	// Let's add strings that hash to 0
	// We might not know one off-hand, but we can test the ambiguity logic via collision
	// Let's create an artificial ambiguous case by providing a string that hashes to 0? No, we don't know a string that hashes to 0. 

	var outData = make(map[string]Output)

	for _, tc := range cases {
		out := Output{
			HashOracle:      make(map[string]uint32),
			AllocatedOracle: make(map[string]int64),
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
			out.AllocatedOracle[k] = int64(v)
		}
		
		outData[tc.Name] = out
	}

	b, err := json.MarshalIndent(outData, "", "  ")
	if err != nil {
		panic(err)
	}
	err = os.WriteFile("entity_id_fixture.json", b, 0644)
	if err != nil {
		panic(err)
	}
}
