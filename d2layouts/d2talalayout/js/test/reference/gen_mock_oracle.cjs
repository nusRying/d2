const fs = require('fs');

const firstD2SpillEntityID = 0x100000000n;

function d2FNV32(id) {
  let hash = 0x811c9dc5;
  const buffer = Buffer.from(id, 'utf8');
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function allocateD2EntityIDs(identities) {
  const seenAbsIDs = new Set();
  const bucketSizes = new Map();
  const hashed = [];

  for (let i = 0; i < identities.length; i++) {
    const identity = identities[i];
    if (seenAbsIDs.has(identity.absID)) {
      throw new Error(`D2 ID "${identity.absID}" is repeated`);
    }
    seenAbsIDs.add(identity.absID);

    const hash = d2FNV32(identity.absID);
    hashed.push({ ...identity, hash });

    bucketSizes.set(hash, (bucketSizes.get(hash) || 0) + 1);
  }

  const allocated = new Map();
  const ambiguous = [];

  for (let i = 0; i < hashed.length; i++) {
    const identity = hashed[i];
    if (identity.hash !== 0 && bucketSizes.get(identity.hash) === 1) {
      allocated.set(identity.entity, BigInt(identity.hash));
    } else {
      ambiguous.push(identity);
    }
  }

  function compareGoStringsUTF8(a, b) {
    const bytesA = Buffer.from(a, 'utf8');
    const bytesB = Buffer.from(b, 'utf8');
    const minLen = Math.min(bytesA.length, bytesB.length);
    for (let i = 0; i < minLen; i++) {
      if (bytesA[i] !== bytesB[i]) {
        return bytesA[i] < bytesB[i] ? -1 : 1;
      }
    }
    return bytesA.length < bytesB.length ? -1 : bytesA.length > bytesB.length ? 1 : 0;
  }

  ambiguous.sort((a, b) => {
    if (a.hash !== b.hash) {
      return a.hash < b.hash ? -1 : 1;
    }
    return compareGoStringsUTF8(a.absID, b.absID);
  });

  for (let i = 0; i < ambiguous.length; i++) {
    const identity = ambiguous[i];
    allocated.set(identity.entity, firstD2SpillEntityID + BigInt(i));
  }

  return allocated;
}

const cases = [
  { Name: "simple", Input: ["a", "b", "c"] },
  { Name: "zero_hash", Input: [] },
  { Name: "complex_unicode", Input: ["hello", "world", "你好", "🌍", "a longer string with spaces"] },
  { Name: "collision_mock", Input: ["lKWF05zzXT", "bls2q7BifE"] },
  { Name: "collision_mock_reversed", Input: ["bls2q7BifE", "lKWF05zzXT"] },
  { Name: "many_nodes", Input: ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"] },
];

const outData = {
  metadata: {
    runtimeGoVersion: "go1.27.0",
    d2BaseCommit: "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
    referenceAlgorithm: "hash/fnv New32a + D2 allocateD2EntityIDs semantics"
  },
  cases: {}
};

for (const tc of cases) {
  const out = {
    hash_oracle: {},
    allocated_oracle: {}
  };

  const identities = tc.Input.map(id => ({ entity: id, absID: id }));
  
  for (const id of tc.Input) {
    out.hash_oracle[id] = d2FNV32(id);
  }

  const alloc = allocateD2EntityIDs(identities);

  for (const [k, v] of alloc) {
    out.allocated_oracle[k] = v.toString(10);
  }

  outData.cases[tc.Name] = out;
}

if (!fs.existsSync('../fixtures')) {
  fs.mkdirSync('../fixtures');
}
fs.writeFileSync('../fixtures/go-entity-id-reference.json', JSON.stringify(outData, null, 2));
