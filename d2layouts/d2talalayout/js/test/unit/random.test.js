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
	
	// Should not throw
	const rng1 = new GoRand(0n);
	const rng2 = new GoRand(123456789);
	expect(rng1.Int63()).toBeTypeOf("bigint");
	expect(rng2.Int63()).toBeTypeOf("bigint");
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
	const rng1 = new GoRand(42n);
	const rng2 = new GoRand(42n);
	
	rng1.Int63();
	rng1.Int63();
	
	rng2.Int63();
	
	expect(rng1.Int63()).not.toBe(rng2.Int63());
});
