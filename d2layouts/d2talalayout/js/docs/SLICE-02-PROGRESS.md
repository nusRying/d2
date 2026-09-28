# Slice 02 Progress Document

## Goal
Implement exact deterministic parity with:
```go
rand.New(rand.NewSource(seed))
```
for the RNG behavior required by current TALA.

## D2 Reference Base
```text
01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
```

## Go Toolchain
```text
go version go1.27.0 windows/amd64
GOVERSION: go1.27.0
```
GOROOT and GOTOOLCHAIN values captured during verification match standard Go 1.27.0 installation paths on Windows.

## Reference Source Studied
```text
Go standard library go1.27.0
src/math/rand/rng.go
src/math/rand/rand.go
```

## Production TALA RNG Usage
Current production requirements:
```text
Int63()
Int63n()
Float64()
```
`Uint64()` is implemented as part of the underlying Go-compatible source behavior.
This does not port the whole Go `math/rand` API, only the subset required by TALA.

## Implementation
- Go-compatible 607-entry RNG state
- Go seed normalization
- BigInt 64-bit arithmetic
- `Int63`
- `Int63n`
- rejection sampling
- `Float64`
- independent instances
- signed-int64 seed safety
- safe Number validation

## Oracle
Canonical oracle:
```text
test/reference/go_rand_oracle.go
```

Static fixture:
```text
test/fixtures/go-math-rand-reference.json
```

Canonical regeneration command:
```powershell
& "C:\Program Files\Go\bin\go.exe" run test\reference\go_rand_oracle.go test\fixtures\go-math-rand-reference.json
```
Normal Bun tests consume the static fixture and do not invoke Go.

## Seeds Covered
```text
0
1
-1
42
2147483647
2147483648
-2147483648
9223372036854775807
-9223372036854775808
```

## Parity Evidence
Tests cover:
- exact `Int63` sequences
- IEEE-754 bit-for-bit `Float64`
- `Int63n`
- mixed-call state progression
- independent streams

## Rejection Sampling Proof
```text
seed: 1
bound: 4611686018427387905
source draws: 4
value: 4037200794235010051
next value: 3916589616287113937
```
Matching the next value proves state consumption remained aligned after the rejected source draws.

## Input Safety
- Number seeds must satisfy `Number.isSafeInteger`
- BigInt seeds must fit signed int64
- Int63n bounds must be `1..MaxInt64`
- unsafe Numbers, fractions, NaN, Infinity and out-of-range BigInts are rejected

## Full Regression Suite
```text
22 pass
0 fail
554 expect() calls
Ran 22 tests across 2 files. [269.00ms]
```
This includes both:
- Slice 01 ELK adapter tests
- Slice 02 RNG tests

## Oracle Reproducibility
```text
SHA256:
999F962573E25A169003C54976149E0781FAADFBB068ED5B3DBA0AEEDD64DDB9
```
Two independently generated oracle files produced the identical hash.

## Performance Sanity Check
```text
Environment: Bun v1.3.14, Windows
100,000 Int63: 20.35 ms
100,000 Float64: 21.26 ms
```
This was only a sanity check, not a performance target.

## Math.random Audit
```text
0 occurrences in d2layouts/d2talalayout/js/src
```

## Licensing / Provenance
Portions of `go-math-rand.js` are derived from:
```text
Go standard library math/rand
go1.27.0
Copyright 2009 The Go Authors
BSD-style license
```
Attribution is recorded in:
```text
THIRD_PARTY_NOTICES.txt
```
The TALA JS project itself remains part of the MPL-2.0 D2 repository.

## Problems Encountered / Review Findings
1. Initial implementation established Go sequence parity.
2. Review found unsafe Number seed conversion and missing int64 bounds.
3. Review requested explicit rejection-path evidence.
4. Review identified missing Go source attribution.
5. Review required full regression testing, oracle reproducibility and benchmark evidence.
6. These were corrected in `8fb050c2853958d4550064c0905442aaaff32155`.
7. Documentation closure followed in `8b97f12f150d6ca6f09ea95dcf13f282e415d724`.
8. This final commit fixes the accidentally omitted Slice 02 progress file.

## Result
Slice 02 is complete and ready for reviewer acceptance.

## Commit History
```text
7714ac961cddd5fda9467b50b3c5cf2885182479
— initial deterministic Go RNG implementation

8fb050c2853958d4550064c0905442aaaff32155
— RNG contract, rejection proof, provenance and verification hardening

8b97f12f150d6ca6f09ea95dcf13f282e415d724
— documentation closure for ADR/migration/Slice 01 record
```
