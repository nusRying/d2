import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { d2FNV32, allocateD2EntityIDs, firstD2SpillEntityID } from "../../src/graph/entity-id.js";

import { fileURLToPath } from "url";
import { dirname } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

test("EntityID allocation parity with Go oracle", () => {
  const fixturePath = join(__dirname, "..", "reference", "entity_id_fixture.json");
  const fixtureData = JSON.parse(readFileSync(fixturePath, "utf8"));
  
  for (const [testName, oracleData] of Object.entries(fixtureData)) {
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
      // expectedId in oracle is a number, but because it could be large we should compare as BigInt
      expect(allocated.get(id)).toBe(BigInt(expectedId));
    }
  }
});
