import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OptimizationWorkGuard,
  OptimizationResourceLimitError,
  isOptimizationResourceLimitError,
  shuffle,
  Shuffle,
  shuffleIndex,
} from '../../src/limits/optimization.js';
import { WorkLimitError } from '../../src/limits/work-guard.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const optimizationFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'go-optimization-reference.json'),
    'utf8'
  )
);


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

  it('replays all Go-generated shuffle scenarios exactly', () => {
    for (const scenario of optimizationFixture.shuffleScenarios) {
      if (scenario.isRejected) {
        continue;
      }
      const count = scenario.count ?? 0;
      const values = Array.from({ length: count }, (_, index) => index);
      const rnd = new GoRand(BigInt(scenario.seed));
      const guard = new OptimizationWorkGuard(
        bg,
        'shuffle',
        MAX_OPTIMIZATION_WORK_UNITS
      );

      shuffle(values, rnd, guard);

      assert.deepStrictEqual(
        values,
        scenario.result ?? [],
        `${scenario.name} permutation mismatch`
      );
      assert.strictEqual(
        guard.Used(),
        BigInt(scenario.used),
        `${scenario.name} used mismatch`
      );
      assert.strictEqual(
        rnd.Int63(),
        BigInt(scenario.nextInt63),
        `${scenario.name} next Int63 mismatch`
      );
    }
  });

  it('replays the Go-generated rejected shuffle draw exactly', () => {
    const scenario = optimizationFixture.shuffleScenarios.find(
      (candidate) => candidate.isRejected
    );
    assert.notStrictEqual(scenario, undefined);

    const guard = new OptimizationWorkGuard(
      bg,
      'shuffle',
      MAX_OPTIMIZATION_WORK_UNITS
    );
    const chosen = shuffleIndex(
      new GoRand(BigInt(scenario.seed)),
      scenario.n,
      guard
    );

    assert.strictEqual(chosen, scenario.chosen);
    assert.strictEqual(guard.Used(), BigInt(scenario.used));
    assert.strictEqual(Number(guard.Used()), Number(scenario.draws));
  });

  it('performs exact Err() polling count and ignores isCancelled() when Err() exists', () => {
    let errCalls = 0;
    let cancelCalls = 0;
    const dualContext = {
      Err() {
        errCalls++;
        return null;
      },
      isCancelled() {
        cancelCalls++;
        return false;
      },
    };

    // constructor -> exactly 1 Err() call, 0 isCancelled calls
    const guard = new OptimizationWorkGuard(dualContext, 'strideTest', MAX_OPTIMIZATION_WORK_UNITS);
    assert.strictEqual(errCalls, 1);
    assert.strictEqual(cancelCalls, 0);

    // Add(0) -> exactly 1 additional Err() call
    guard.add(0n);
    assert.strictEqual(errCalls, 2);
    assert.strictEqual(cancelCalls, 0);

    // 63 accepted Step calls after constructor -> no extra poll
    for (let i = 0; i < 63; i++) {
      guard.step();
    }
    assert.strictEqual(errCalls, 2);
    assert.strictEqual(cancelCalls, 0);

    // 64th boundary -> exactly 1 poll
    guard.step();
    assert.strictEqual(errCalls, 3);
    assert.strictEqual(cancelCalls, 0);

    // Finish() -> exactly 1 poll
    guard.finish();
    assert.strictEqual(errCalls, 4);
    assert.strictEqual(cancelCalls, 0);
  });

  it('rejected-limit boundary preserves Err() precedence and observation count', () => {
    let errCalls = 0;
    let cancelCalls = 0;
    let currentError = null;
    const dualContext = {
      Err() {
        errCalls++;
        return currentError;
      },
      isCancelled() {
        cancelCalls++;
        return false;
      },
    };

    // Constructor polls once.
    const deadlineGuard = new OptimizationWorkGuard(dualContext, 'overflowDeadline', 64n);
    assert.strictEqual(errCalls, 1);
    assert.strictEqual(cancelCalls, 0);

    // Move to used=63 without another poll.
    deadlineGuard.Add(63n);
    assert.strictEqual(errCalls, 1);
    assert.strictEqual(deadlineGuard.Used(), 63n);

    currentError = new Error('context deadline exceeded');
    assert.throws(
      () => deadlineGuard.Add(2n),
      (err) => {
        assert.strictEqual(err.message, 'overflowDeadline: context deadline exceeded');
        return true;
      }
    );
    assert.strictEqual(deadlineGuard.Used(), 65n);
    assert.strictEqual(errCalls, 2);
    assert.strictEqual(cancelCalls, 0);

    // Custom error has the same precedence on a crossed rejected boundary.
    errCalls = 0;
    currentError = null;
    const customGuard = new OptimizationWorkGuard(dualContext, 'overflowCustom', 64n);
    customGuard.Add(63n);
    currentError = new Error('oracle custom work error');
    assert.throws(
      () => customGuard.Add(2n),
      (err) => {
        assert.strictEqual(err.message, 'overflowCustom: oracle custom work error');
        return true;
      }
    );
    assert.strictEqual(customGuard.Used(), 65n);
    assert.strictEqual(errCalls, 2);
    assert.strictEqual(cancelCalls, 0);
  });

  it('rejected-limit charge without a crossed poll boundary returns WorkLimitError without Err polling', () => {
    let errCalls = 0;
    const ctx = {
      Err() {
        errCalls++;
        return new Error('must not be observed');
      },
      isCancelled() {
        throw new Error('isCancelled must not be queried');
      },
    };

    // Constructor must succeed, so clear the first Err result after counting it.
    let first = true;
    ctx.Err = () => {
      errCalls++;
      if (first) {
        first = false;
        return null;
      }
      return new Error('must not be observed');
    };

    const guard = new OptimizationWorkGuard(ctx, 'overflowNoBoundary', 100n);
    assert.strictEqual(errCalls, 1);

    // Rejected charge from used=0 to first-rejected=101 does not satisfy
    // previous/stride != limit/stride, so Go returns the work-limit error directly.
    assert.throws(
      () => guard.Add(101n),
      (err) => {
        assert(err instanceof WorkLimitError);
        assert.strictEqual(err.message, 'TALA overflowNoBoundary work exceeds limit 100');
        return true;
      }
    );
    assert.strictEqual(guard.Used(), 101n);
    assert.strictEqual(errCalls, 1);
  });

  it('preserves exact context error messages across boundaries', () => {
    // 1. Constructor: canceled, deadline exceeded, custom error
    assert.throws(
      () => new OptimizationWorkGuard({ Err: () => new Error('context canceled') }, 'locConst'),
      (err) => {
        assert.strictEqual(err.message, 'locConst: context canceled');
        return true;
      }
    );
    assert.throws(
      () => new OptimizationWorkGuard({ Err: () => new Error('context deadline exceeded') }, 'locConst'),
      (err) => {
        assert.strictEqual(err.message, 'locConst: context deadline exceeded');
        return true;
      }
    );
    assert.throws(
      () => new OptimizationWorkGuard({ Err: () => new Error('oracle custom optimization error') }, 'locConst'),
      (err) => {
        assert.strictEqual(err.message, 'locConst: oracle custom optimization error');
        return true;
      }
    );

    // 2. Add(0): deadline, custom
    let activeErr = null;
    const dynamicCtx = { Err: () => activeErr };
    const guardAdd = new OptimizationWorkGuard(dynamicCtx, 'locAdd');
    activeErr = new Error('context deadline exceeded');
    assert.throws(
      () => guardAdd.add(0n),
      (err) => {
        assert.strictEqual(err.message, 'locAdd: context deadline exceeded');
        return true;
      }
    );
    activeErr = new Error('oracle custom optimization error');
    assert.throws(
      () => guardAdd.add(0n),
      (err) => {
        assert.strictEqual(err.message, 'locAdd: oracle custom optimization error');
        return true;
      }
    );

    // 3. 64-boundary: deadline, custom
    activeErr = null;
    const guardStride = new OptimizationWorkGuard(dynamicCtx, 'locStride');
    for (let i = 0; i < 63; i++) {
      guardStride.step();
    }
    activeErr = new Error('context deadline exceeded');
    assert.throws(
      () => guardStride.step(),
      (err) => {
        assert.strictEqual(err.message, 'locStride: context deadline exceeded');
        return true;
      }
    );

    activeErr = null;
    const guardStrideCustom = new OptimizationWorkGuard(dynamicCtx, 'locStrideCustom');
    for (let i = 0; i < 63; i++) {
      guardStrideCustom.step();
    }
    activeErr = new Error('oracle custom optimization error');
    assert.throws(
      () => guardStrideCustom.step(),
      (err) => {
        assert.strictEqual(err.message, 'locStrideCustom: oracle custom optimization error');
        return true;
      }
    );

    // 4. Finish: deadline, custom
    activeErr = null;
    const guardFinish = new OptimizationWorkGuard(dynamicCtx, 'locFinish');
    activeErr = new Error('context deadline exceeded');
    assert.throws(
      () => guardFinish.finish(),
      (err) => {
        assert.strictEqual(err.message, 'locFinish: context deadline exceeded');
        return true;
      }
    );

    activeErr = null;
    const guardFinishCustom = new OptimizationWorkGuard(dynamicCtx, 'locFinishCustom');
    activeErr = new Error('oracle custom optimization error');
    assert.throws(
      () => guardFinishCustom.finish(),
      (err) => {
        assert.strictEqual(err.message, 'locFinishCustom: oracle custom optimization error');
        return true;
      }
    );
  });
});
