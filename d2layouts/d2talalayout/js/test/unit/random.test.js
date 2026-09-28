import { expect, test } from "bun:test";
import { GoRand } from "../../src/random/go-math-rand.js";
import fixtures from "../fixtures/go-math-rand-reference.json" with { type: "json" };

function float64ToHex(f) {
	const buffer = new ArrayBuffer(8);
	const view = new DataView(buffer);
	view.setFloat64(0, f, false); // big-endian to match Go's fmt.Sprintf("%016x", bits)
	let hex = "";
	for (let i = 0; i < 8; i++) {
		hex += view.getUint8(i).toString(16).padStart(2, "0");
	}
	return hex;
}

test("GoRand constructor validation", () => {
	expect(() => new GoRand("string")).toThrow();
	expect(() => new GoRand(null)).toThrow();
	expect(() => new GoRand()).toThrow();
	
	// Unsafe numbers
	expect(() => new GoRand(Number.MAX_SAFE_INTEGER + 1)).toThrow();
	expect(() => new GoRand(1.5)).toThrow();
	expect(() => new GoRand(NaN)).toThrow();
	expect(() => new GoRand(Infinity)).toThrow();

	// Out of bounds bigints
	expect(() => new GoRand(9223372036854775808n)).toThrow();
	expect(() => new GoRand(-9223372036854775809n)).toThrow();

	// Should not throw
	expect(() => new GoRand(0)).not.toThrow();
	expect(() => new GoRand(42)).not.toThrow();
	expect(() => new GoRand(42n)).not.toThrow();
	expect(() => new GoRand(9223372036854775807n)).not.toThrow();
	expect(() => new GoRand(-9223372036854775808n)).not.toThrow();
});

test("GoRand Int63 parity", () => {
	for (const seedRun of fixtures.seeds) {
		const seed = BigInt(seedRun.seed);
		const rng = new GoRand(seed);
		
		for (let i = 0; i < seedRun.int63.length; i++) {
			const expected = BigInt(seedRun.int63[i]);
			const actual = rng.Int63();
			expect(actual).toBe(expected);
		}
	}
});

test("GoRand Float64 parity", () => {
	for (const seedRun of fixtures.seeds) {
		const seed = BigInt(seedRun.seed);
		const rng = new GoRand(seed);
		
		for (let i = 0; i < seedRun.float64Bits.length; i++) {
			const expectedHex = seedRun.float64Bits[i];
			const f = rng.Float64();
			const actualHex = float64ToHex(f);
			expect(actualHex).toBe(expectedHex);
		}
	}
});

test("GoRand Int63n parity", () => {
	for (const run of fixtures.int63nTests) {
		const seed = BigInt(run.seed);
		const rng = new GoRand(seed);
		
		for (let i = 0; i < run.bounds.length; i++) {
			const bound = BigInt(run.bounds[i]);
			const expected = BigInt(run.values[i]);
			const actual = rng.Int63n(bound);
			expect(actual).toBe(expected);
		}
	}
});

test("GoRand Int63n bounds validation", () => {
	const rng = new GoRand(42n);

	// Invalid BigInt values
	expect(() => rng.Int63n(0n)).toThrow();
	expect(() => rng.Int63n(-1n)).toThrow();
	expect(() => rng.Int63n(9223372036854775808n)).toThrow();

	// Invalid Number values
	expect(() => rng.Int63n(0)).toThrow();
	expect(() => rng.Int63n(-1)).toThrow();
	expect(() => rng.Int63n(1.5)).toThrow();
	expect(() => rng.Int63n(NaN)).toThrow();
	expect(() => rng.Int63n(Infinity)).toThrow();
	expect(() => rng.Int63n(Number.MAX_SAFE_INTEGER + 1)).toThrow();
});

test("GoRand mixed type progression", () => {
	const run = fixtures.mixedRun;
	const seed = BigInt(run.seed);
	const rng = new GoRand(seed);
	
	for (let i = 0; i < run.types.length; i++) {
		const typ = run.types[i];
		const expectedStr = run.values[i];
		
		if (typ === "Int63") {
			const expected = BigInt(expectedStr);
			expect(rng.Int63()).toBe(expected);
		} else if (typ === "Float64Bits") {
			const f = rng.Float64();
			expect(float64ToHex(f)).toBe(expectedStr);
		} else if (typ.startsWith("Int63n(")) {
			// Extract bound
			const match = typ.match(/Int63n\((.+)\)/);
			const bound = BigInt(match[1]);
			const expected = BigInt(expectedStr);
			expect(rng.Int63n(bound)).toBe(expected);
		}
	}
});

test("GoRand independence of multiple instances", () => {
	const general = new GoRand(42n);
	const hierarchy = new GoRand(42n);
	
	// Prove identical consumption gives identical values
	expect(general.Int63()).toBe(hierarchy.Int63());
	expect(general.Float64()).toBe(hierarchy.Float64());
	
	// Advance one stream extra
	general.Int63();
	
	// Prove the other stream's next value is still the expected Go sequence value (different from the first stream's current value)
	expect(general.Int63()).not.toBe(hierarchy.Int63());
});

test("GoRand Int63n rejection sampling proof", () => {
	const run = fixtures.rejectionProof;
	const seed = BigInt(run.seed);
	const bound = BigInt(run.bound);
	const expectedDraws = run.sourceDraws;
	
	let drawCount = 0;
	
	const rng = new GoRand(seed);
	// Overwrite Int63 locally on this instance to count draws
	const originalInt63 = rng.Int63.bind(rng);
	rng.Int63 = function() {
		drawCount++;
		return originalInt63();
	};

	const actual = rng.Int63n(bound);
	
	expect(actual).toBe(BigInt(run.value));
	expect(drawCount).toBe(expectedDraws);

	// Ensure subsequent state matches
	expect(rng.Int63()).toBe(BigInt(run.nextValue));
});
