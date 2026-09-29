export const firstD2SpillEntityID = 0x100000000n; // 1 << 32

/**
 * Compares two strings using Go's byte-wise UTF-8 comparison.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareGoStringsUTF8(a, b) {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  
  const minLen = Math.min(bytesA.length, bytesB.length);
  for (let i = 0; i < minLen; i++) {
    if (bytesA[i] !== bytesB[i]) {
      return bytesA[i] < bytesB[i] ? -1 : 1;
    }
  }
  return bytesA.length < bytesB.length ? -1 : bytesA.length > bytesB.length ? 1 : 0;
}

/**
 * Computes the 32-bit FNV-1a hash of a string, exactly matching Go's hash/fnv.New32a().
 *
 * @param {string} id
 * @returns {number} The unsigned 32-bit integer hash
 */
export function d2FNV32(id) {
  let hash = 0x811c9dc5;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(id);
  
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // Math.imul preserves 32-bit integer multiplication semantics
    hash = Math.imul(hash, 0x01000193);
  }
  
  // Convert to unsigned 32-bit integer
  return hash >>> 0;
}

/**
 * @typedef {Object} D2EntityIdentity
 * @property {any} entity
 * @property {string} absID
 */

/**
 * Allocates numeric EntityIDs for a slice of identities.
 * Matches `allocateD2EntityIDs` in d2talalayout/adapter.go
 *
 * @param {D2EntityIdentity[]} identities
 * @returns {Map<any, BigInt>}
 */
export function allocateD2EntityIDs(identities) {
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
