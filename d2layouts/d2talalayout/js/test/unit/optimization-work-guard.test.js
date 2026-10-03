import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  OptimizationWorkGuard,
  OptimizationResourceLimitError,
  isOptimizationResourceLimitError,
  shuffle,
  Shuffle,
  shuffleIndex,
} from '../../src/limits/optimization.js';
import {
  MAX_OPTIMIZATION_WORK_UNITS,
  OPTIMIZATION_CONTEXT_CHECK_STRIDE,
} from '../../src/limits/constants.js';
import { GoRand } from '../../src/random/go-math-rand.js';

class CountingContext {
  constructor(cancelAt = 0) {
    this.cancelAt = cancelAt;
    this.count = 0;
  }

  isCancelled() {
    this.count++;
    return this.cancelAt > 0 && this.count >= this.cancelAt;
  }
}

const bg = { isCancelled: () => false };

describe('Slice 42 — OptimizationWorkGuard', () => {
  it('requires a non-null context', () => {
    assert.throws(
      () => new OptimizationWorkGuard(null, 'test', 10n),
      (err) => {
        assert(err.message.includes('TALA test requires a context'));
        return true;
      }
    );
  });

  it('enforces W-1, exact W, and W+1 limits', () => {
    // W - 1
    const guard1 = new OptimizationWorkGuard(bg, 'test', 10n);
    guard1.add(9n);
    assert.strictEqual(guard1.used, 9n);

    // exact W
    const guard2 = new OptimizationWorkGuard(bg, 'test', 10n);
    guard2.add(10n);
    assert.strictEqual(guard2.used, 10n);

    // W + 1 exceeds limit
    const guard3 = new OptimizationWorkGuard(bg, 'test', 10n);
    assert.throws(
      () => guard3.add(11n),
      (err) => {
        assert(isOptimizationResourceLimitError(err));
        assert(err.message.includes('TALA test work exceeds limit 10'));
        return true;
      }
    );
  });

  it('add(0) retains exact used count without extra increments', () => {
    const guard = new OptimizationWorkGuard(bg, 'test', 10n);
    guard.add(5n);
    assert.strictEqual(guard.used, 5n);
    guard.add(0n);
    assert.strictEqual(guard.used, 5n);
  });

  it('polls context cancellation every 64 steps', () => {
    // cancelAt = 2: check 1 in constructor, check 2 after 64 steps
    const ctx = new CountingContext(2);
    const guard = new OptimizationWorkGuard(ctx, 'test', MAX_OPTIMIZATION_WORK_UNITS);
    assert.strictEqual(ctx.count, 1);

    // first 63 steps should not trigger poll
    for (let i = 0; i < 63; i++) {
      guard.step();
    }
    assert.strictEqual(ctx.count, 1);

    // 64th step should trigger poll and throw
    assert.throws(
      () => guard.step(),
      (err) => {
        assert(err.message.includes('test: context canceled'));
        return true;
      }
    );
    assert.strictEqual(ctx.count, 2);
  });

  it('catches arithmetic overflow when adding past 2^64-1', () => {
    const maxUint64 = 0xffffffffffffffffn;
    const guard = new OptimizationWorkGuard(bg, 'testGuard', maxUint64);
    guard.used = maxUint64;

    assert.throws(
      () => guard.step(),
      (err) => {
        assert(isOptimizationResourceLimitError(err));
        assert(err.message.includes('testGuard work arithmetic overflow'));
        return true;
      }
    );
  });

  it('charges exact n log2 n comparisons for AddSort', () => {
    const guard = new OptimizationWorkGuard(bg, 'test', MAX_OPTIMIZATION_WORK_UNITS);
    guard.addSort(0);
    assert.strictEqual(guard.used, 0n);
    guard.addSort(1);
    assert.strictEqual(guard.used, 0n);
    guard.addSort(2);
    assert.strictEqual(guard.used, 2n);
    guard.addSort(3);
    assert.strictEqual(guard.used, 8n); // 2 + 6 = 8
    guard.addSort(4);
    assert.strictEqual(guard.used, 16n); // 8 + 8 = 16
  });

  it('performs Fisher-Yates shuffle deterministically with GoRand', () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const rnd = new GoRand(991n);
    const guard = new OptimizationWorkGuard(bg, 'shuffle', MAX_OPTIMIZATION_WORK_UNITS);

    shuffle(arr, rnd, guard);
    assert.strictEqual(guard.used, 9n); // 9 swaps for 10 elements
    // Verify permutation matches Go oracle
    assert.deepStrictEqual(arr, [5, 1, 2, 8, 4, 0, 3, 6, 9, 7]);
    assert.strictEqual(rnd.Int63(), 8041617062267906751n);
  });

  it('re-draws upon Lemire bias in shuffleIndex', () => {
    const n = 1_431_655_766;
    const threshold = Number(((-BigInt(n)) & 0xffffffffn) % BigInt(n));
    let seed = 0n;
    let draws = 0;
    let want = 0;

    for (; seed < 100n; seed++) {
      const random = new GoRand(seed);
      draws = 0;
      for (;;) {
        draws++;
        const product = BigInt(random.Uint32()) * BigInt(n);
        if (Number(product & 0xffffffffn) >= threshold) {
          want = Number(product >> 32n);
          break;
        }
      }
      if (draws > 1) {
        break;
      }
    }

    assert(draws > 1, 'must find a rejected draw seed');
    const guard = new OptimizationWorkGuard(bg, 'shuffle', MAX_OPTIMIZATION_WORK_UNITS);
    const chosen = shuffleIndex(new GoRand(seed), n, guard);
    assert.strictEqual(chosen, want);
    assert.strictEqual(Number(guard.used), draws);
  });
});
