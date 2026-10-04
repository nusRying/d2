import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { d2FNV32, allocateD2EntityIDs, firstD2SpillEntityID, compareGoStringsUTF8 } from "../../src/graph/entity-id.js";

import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

test("EntityID allocation parity with Go oracle", () => {
  const fixturePath = join(__dirname, "..", "fixtures", "go-entity-id-reference.json");
  const fixtureData = JSON.parse(readFileSync(fixturePath, "utf8"));

  for (const [testName, oracleData] of Object.entries(fixtureData.cases)) {
    // 1. Verify FNV32
    for (const [id, expectedHash] of Object.entries(oracleData.hash_oracle)) {
      expect(d2FNV32(id)).toBe(expectedHash);
    }

    // 2. Verify Allocation
    const identities = Object.keys(oracleData.hash_oracle).map(id => ({
      entity: id,
      absID: id
    }));

    const allocated = allocateD2EntityIDs(identities);

    for (const [id, expectedId] of Object.entries(oracleData.allocated_oracle)) {
      expect(allocated.get(id)).toBe(BigInt(expectedId));
    }

    // 3. Verify UTF-8 Comparison
    if (oracleData.comparisons) {
      for (const comp of oracleData.comparisons) {
        expect(compareGoStringsUTF8(comp.a, comp.b)).toBe(comp.result);
      }
    }
  }
});

test("Prove UTF-8 vs UTF-16 comparator difference (U+E000 vs U+10000)", () => {
  const ue000 = "\uE000";
  const u10000 = "\u{10000}";

  // In naive JS UTF-16 string comparison:
  // "\uE000" has code unit 0xE000
  // "\u{10000}" is encoded in UTF-16 as surrogate pair 0xD800 0xDC00
  // Since 0xE000 > 0xD800, naive JS evaluates ue000 > u10000
  expect(ue000 > u10000).toBe(true);
  expect(ue000 < u10000).toBe(false);

  // In Go UTF-8 byte ordering:
  // U+E000 encodes to bytes 0xEE, 0x80, 0x80
  // U+10000 encodes to bytes 0xF0, 0x90, 0x80, 0x80
  // Since 0xEE < 0xF0, Go byte ordering evaluates U+E000 < U+10000
  expect(compareGoStringsUTF8(ue000, u10000)).toBe(-1);
  expect(compareGoStringsUTF8(u10000, ue000)).toBe(1);
  expect(compareGoStringsUTF8(ue000, ue000)).toBe(0);
});

test("FNV collision and deterministic spill assignment invariant", () => {
  const strA = "lKWF05zzXT";
  const strB = "bls2q7BifE";

  // Verified FNV collision
  const hashA = d2FNV32(strA);
  const hashB = d2FNV32(strB);
  expect(hashA).toBe(3524517778);
  expect(hashB).toBe(3524517778);
  expect(hashA).toBe(hashB);

  // Allocation order 1: [strA, strB]
  const alloc1 = allocateD2EntityIDs([
    { entity: strA, absID: strA },
    { entity: strB, absID: strB },
  ]);

  // Allocation order 2: [strB, strA] (reversed input)
  const alloc2 = allocateD2EntityIDs([
    { entity: strB, absID: strB },
    { entity: strA, absID: strA },
  ]);

  // Spill base is 1 << 32 = 4294967296n
  expect(firstD2SpillEntityID).toBe(4294967296n);

  // Deterministic assignment sorted by absID (bls2q7BifE < lKWF05zzXT)
  expect(alloc1.get(strB)).toBe(4294967296n);
  expect(alloc1.get(strA)).toBe(4294967297n);

  expect(alloc2.get(strB)).toBe(4294967296n);
  expect(alloc2.get(strA)).toBe(4294967297n);
});
