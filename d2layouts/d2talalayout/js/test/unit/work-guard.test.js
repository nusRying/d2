import { describe, expect, it } from "bun:test";
import {
  WorkGuard,
  NewWorkGuard,
  newWorkGuard,
  backgroundWorkContext,
  abortSignalWorkContext,
  pollingWorkContext,
  isWorkCanceledError,
  isWorkLimitError,
  WorkLimitError,
  WorkCanceledError,
  MAX_ENGINE_WORK_UNITS,
  CONTEXT_CHECK_STRIDE,
  CANCELLABLE_CONTEXT_CHECK_STRIDE,
  Graph,
  Node,
  Sequence,
  Point,
} from "../../src/index.js";

describe("Slice 08 WorkGuard Unit Tests", () => {
  describe("Construction and validation", () => {
    it("rejects null or undefined context", () => {
      expect(() => new WorkGuard(null, "ctxTest", 10)).toThrow("TALA ctxTest requires a context");
      expect(() => NewWorkGuard(undefined, "ctxTest", 10)).toThrow("TALA ctxTest requires a context");
    });

    it("rejects malformed context objects", () => {
      expect(() => new WorkGuard({}, "ctxTest", 10)).toThrow("TALA ctxTest requires a context");
      expect(() => new WorkGuard({ isCancelled: "not a function" }, "ctxTest", 10)).toThrow(
        "TALA ctxTest requires a context"
      );
      expect(() => new WorkGuard("invalid", "ctxTest", 10)).toThrow("TALA ctxTest requires a context");
    });

    it("rejects invalid AbortSignal in abortSignalWorkContext", () => {
      expect(() => abortSignalWorkContext(null)).toThrow("abortSignalWorkContext requires an AbortSignal");
      expect(() => abortSignalWorkContext({})).toThrow("abortSignalWorkContext requires an AbortSignal");
    });

    it("auto-wraps bare AbortSignal if passed as context", () => {
      const controller = new AbortController();
      const guard = new WorkGuard(controller.signal, "autoWrap", 10);
      expect(guard.ctx.doneAvailable).toBe(true);
      expect(guard.ctx.isCancelled()).toBe(false);
    });

    it("rejects negative initial limit within int64 range during construction", () => {
      expect(() => new WorkGuard(backgroundWorkContext(), "negLimit", -1)).toThrow(
        "TALA negLimit work limit must not be negative"
      );
      expect(() => NewWorkGuard(backgroundWorkContext(), "negLimit", -10n)).toThrow(
        "TALA negLimit work limit must not be negative"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "negLimit", -9223372036854775808n)).toThrow(
        "TALA negLimit work limit must not be negative"
      );
    });

    it("rejects out-of-range BigInts exceeding signed int64 in constructor", () => {
      expect(() => new WorkGuard(backgroundWorkContext(), "overflowLimit", 9223372036854775808n)).toThrow(
        TypeError
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "overflowLimit", 9223372036854775808n)).toThrow(
        "TALA overflowLimit work limit must fit signed int64"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "underflowLimit", -9223372036854775809n)).toThrow(
        "TALA underflowLimit work limit must fit signed int64"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "hugeLimit", 2n ** 100n)).toThrow(
        "TALA hugeLimit work limit must fit signed int64"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "hugeLimit", -(2n ** 100n))).toThrow(
        "TALA hugeLimit work limit must fit signed int64"
      );
    });

    it("accepts maximum signed int64 limit in constructor", () => {
      const g = new WorkGuard(backgroundWorkContext(), "maxLimit", 9223372036854775807n);
      expect(g.limit).toBe(9223372036854775807n);
    });

    it("rejects fractional, NaN, Infinity, and unsafe integer limits", () => {
      expect(() => new WorkGuard(backgroundWorkContext(), "invalidLimit", 1.5)).toThrow(
        "TALA invalidLimit work limit must be a safe integer or BigInt"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "invalidLimit", NaN)).toThrow(
        "TALA invalidLimit work limit must be a safe integer or BigInt"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "invalidLimit", Infinity)).toThrow(
        "TALA invalidLimit work limit must be a safe integer or BigInt"
      );
      expect(() => new WorkGuard(backgroundWorkContext(), "invalidLimit", Number.MAX_SAFE_INTEGER + 10)).toThrow(
        "TALA invalidLimit work limit must be a safe integer or BigInt"
      );
    });

    it("accepts safe integer Numbers and BigInt limits", () => {
      const g1 = new WorkGuard(backgroundWorkContext(), "safeNum", 100);
      expect(g1.limit).toBe(100n);
      const g2 = new WorkGuard(backgroundWorkContext(), "bigInt", 100n);
      expect(g2.limit).toBe(100n);
    });

    it("immediately checks cancellation during construction via Finish()", () => {
      const controller = new AbortController();
      controller.abort();
      expect(() => new WorkGuard(abortSignalWorkContext(controller.signal), "preAborted", 10)).toThrow(
        "preAborted: context canceled"
      );
    });

    it("supports zero limit initial construction", () => {
      const g = new WorkGuard(backgroundWorkContext(), "zeroLimit", 0);
      expect(g.limit).toBe(0n);
      expect(g.Used()).toBe(0n);
    });
  });

  describe("Step accounting", () => {
    it("charges 1 work unit per step and tracks Used accurately", () => {
      const g = new WorkGuard(backgroundWorkContext(), "stepOp", 5);
      expect(g.Used()).toBe(0n);
      g.Step();
      expect(g.Used()).toBe(1n);
      g.Step();
      expect(g.Used()).toBe(2n);
      g.Step();
      expect(g.Used()).toBe(3n);
    });

    it("throws WorkLimitError on limit exceed and reflects rejected unit in Used", () => {
      const g = new WorkGuard(backgroundWorkContext(), "exceedOp", 2);
      g.Step(); // used 1
      g.Step(); // used 2
      let err = null;
      try {
        g.Step(); // used 3, limit 2
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkLimitError);
      expect(isWorkLimitError(err)).toBe(true);
      expect(err.message).toBe("TALA exceedOp work exceeds limit 2");
      expect(err.location).toBe("exceedOp");
      expect(err.limit).toBe(2n);
      expect(g.Used()).toBe(3n);
    });

    it("zero-limit guard rejects first Step and sets Used to 1", () => {
      const g = new WorkGuard(backgroundWorkContext(), "zeroStep", 0n);
      expect(() => g.Step()).toThrow("TALA zeroStep work exceeds limit 0");
      expect(g.Used()).toBe(1n);
    });
  });

  describe("Cancellation polling strides", () => {
    it("uses 1024 stride for cancellable AbortSignal context", () => {
      const controller = new AbortController();
      const g = new WorkGuard(abortSignalWorkContext(controller.signal), "stride1024", 2000);
      expect(g.pollingStride()).toBe(CANCELLABLE_CONTEXT_CHECK_STRIDE);
      expect(g.pollingStride()).toBe(1024n);

      for (let i = 0; i < 1023; i++) {
        g.Step();
      }
      expect(g.Used()).toBe(1023n);

      // Abort now: 1023 was not a polling stride boundary
      controller.abort();
      expect(g.Used()).toBe(1023n);

      // 1024th step reaches stride boundary and observes cancellation
      let err = null;
      try {
        g.Step();
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkCanceledError);
      expect(isWorkCanceledError(err)).toBe(true);
      expect(err.name).toBe("AbortError");
      expect(err.message).toBe("stride1024: context canceled");
      expect(g.Used()).toBe(1024n);
    });

    it("uses 64 stride for synthetic nil-Done polling context", () => {
      let isCanceled = false;
      const g = new WorkGuard(pollingWorkContext(() => isCanceled), "stride64", 200);
      expect(g.pollingStride()).toBe(CONTEXT_CHECK_STRIDE);
      expect(g.pollingStride()).toBe(64n);

      for (let i = 0; i < 63; i++) {
        g.Step();
      }
      expect(g.Used()).toBe(63n);

      isCanceled = true;

      // 64th step reaches 64-stride boundary and throws
      expect(() => g.Step()).toThrow("stride64: context canceled");
      expect(g.Used()).toBe(64n);
    });

    it("retains captured polling mode even if context doneAvailable changes after construction", () => {
      const ctx = { doneAvailable: false, isCancelled: () => false };
      const g = new WorkGuard(ctx, "retainMode", 1000);
      expect(g.pollingStride()).toBe(CONTEXT_CHECK_STRIDE);
      expect(g.pollingStride()).toBe(64n);

      // Mutating context after construction must not affect cached guard mode
      ctx.doneAvailable = true;
      expect(g.pollingStride()).toBe(CONTEXT_CHECK_STRIDE);
      expect(g.pollingStride()).toBe(64n);
    });
  });

  describe("Check and Finish", () => {
    it("Check observes cancellation immediately without charging work", () => {
      const controller = new AbortController();
      const g = new WorkGuard(abortSignalWorkContext(controller.signal), "checkImm", 100);
      g.Step();
      expect(g.Used()).toBe(1n);

      controller.abort();
      expect(() => g.Check()).toThrow("checkImm: context canceled");
      expect(g.Used()).toBe(1n);
    });

    it("Finish observes cancellation immediately without charging work", () => {
      const controller = new AbortController();
      const g = new WorkGuard(abortSignalWorkContext(controller.signal), "finishImm", 100);
      g.Step();
      g.Step();
      expect(g.Used()).toBe(2n);

      controller.abort();
      expect(() => g.Finish()).toThrow("finishImm: context canceled");
      expect(g.Used()).toBe(2n);
    });
  });

  describe("Add semantics", () => {
    it("rejects negative charge without modifying Used", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addNeg", 100);
      g.Step();
      expect(() => g.Add(-5)).toThrow("TALA addNeg work charge must not be negative");
      expect(() => g.Add(-9223372036854775808n)).toThrow("TALA addNeg work charge must not be negative");
      expect(g.Used()).toBe(1n);
    });

    it("rejects out-of-range BigInts exceeding signed int64 in Add", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addRange", 100);
      expect(() => g.Add(9223372036854775808n)).toThrow(TypeError);
      expect(() => g.Add(9223372036854775808n)).toThrow("TALA addRange work charge must fit signed int64");
      expect(() => g.Add(-9223372036854775809n)).toThrow("TALA addRange work charge must fit signed int64");
      expect(() => g.Add(2n ** 100n)).toThrow("TALA addRange work charge must fit signed int64");
      expect(() => g.Add(-(2n ** 100n))).toThrow("TALA addRange work charge must fit signed int64");
    });

    it("accepts maximum signed int64 charge in Add", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addMax", 9223372036854775807n);
      g.Add(9223372036854775807n);
      expect(g.Used()).toBe(9223372036854775807n);
    });

    it("rejects fractional or non-safe integer charges", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addInvalid", 100);
      expect(() => g.Add(2.5)).toThrow("TALA addInvalid work charge must be a safe integer or BigInt");
      expect(() => g.Add(NaN)).toThrow("TALA addInvalid work charge must be a safe integer or BigInt");
    });

    it("accepts valid charges within limits", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addValid", 100);
      g.Add(10);
      expect(g.Used()).toBe(10n);
      g.Add(25n);
      expect(g.Used()).toBe(35n);
    });

    it("overflowing Add sets Used to limit + 1n and throws WorkLimitError", () => {
      const g = new WorkGuard(backgroundWorkContext(), "addOverflow", 10);
      g.Step(); // used 1
      g.Step(); // used 2
      expect(() => g.Add(100)).toThrow("TALA addOverflow work exceeds limit 10");
      expect(g.Used()).toBe(11n); // limit + 1n
    });

    it("overflow Add crossing boundary prioritizes cancellation", () => {
      const controller = new AbortController();
      const g = new WorkGuard(abortSignalWorkContext(controller.signal), "crossPrecedence", 1024);
      g.Step(); // used 1
      controller.abort();

      // Add(1024) overflows limit 1024 (1 + 1024 > 1024).
      // Interval (1 to 1024) crosses boundary 1024, so cancellation is checked first.
      expect(() => g.Add(1024)).toThrow("crossPrecedence: context canceled");
      expect(g.Used()).toBe(1025n); // limit + 1n
    });

    it("overflow Add without crossing boundary reports work-limit error", () => {
      const controller = new AbortController();
      const g = new WorkGuard(abortSignalWorkContext(controller.signal), "noCrossPrecedence", 1023);
      g.Add(1); // used 1
      controller.abort();

      // limit 1023, previous 1. 1/1024 === 0, 1023/1024 === 0. No boundary crossed.
      expect(() => g.Add(1023)).toThrow("TALA noCrossPrecedence work exceeds limit 1023");
      expect(g.Used()).toBe(1024n); // limit + 1n
    });

    it("overflow Add crossing boundary preserves Err() error and exact observation count", () => {
      let errCalls = 0;
      let cancelCalls = 0;
      let currentError = null;
      const ctx = {
        Err() {
          errCalls++;
          return currentError;
        },
        isCancelled() {
          cancelCalls++;
          return false;
        },
      };

      const deadlineGuard = new WorkGuard(ctx, "overflowDeadline", 64n);
      expect(errCalls).toBe(1);
      expect(cancelCalls).toBe(0);
      deadlineGuard.Add(63n);
      expect(errCalls).toBe(1);

      currentError = new Error("context deadline exceeded");
      expect(() => deadlineGuard.Add(2n)).toThrow("overflowDeadline: context deadline exceeded");
      expect(deadlineGuard.Used()).toBe(65n);
      expect(errCalls).toBe(2);
      expect(cancelCalls).toBe(0);

      errCalls = 0;
      cancelCalls = 0;
      currentError = null;
      const customGuard = new WorkGuard(ctx, "overflowCustom", 64n);
      customGuard.Add(63n);
      currentError = new Error("oracle custom work error");
      expect(() => customGuard.Add(2n)).toThrow("overflowCustom: oracle custom work error");
      expect(customGuard.Used()).toBe(65n);
      expect(errCalls).toBe(2);
      expect(cancelCalls).toBe(0);
    });

    it("overflow Add without crossing boundary skips Err() and returns WorkLimitError", () => {
      let errCalls = 0;
      let first = true;
      const ctx = {
        Err() {
          errCalls++;
          if (first) {
            first = false;
            return null;
          }
          return new Error("must not be observed");
        },
        isCancelled() {
          throw new Error("isCancelled must not be queried");
        },
      };

      const guard = new WorkGuard(ctx, "overflowNoBoundary", 10n);
      expect(errCalls).toBe(1);
      expect(() => guard.Add(11n)).toThrow("TALA overflowNoBoundary work exceeds limit 10");
      expect(guard.Used()).toBe(11n);
      expect(errCalls).toBe(1);
    });

    it("Add(0) boundary behavior: polls at exact boundary, does not poll away from boundary", () => {
      const controller1 = new AbortController();
      const g1 = new WorkGuard(abortSignalWorkContext(controller1.signal), "zeroAtBoundary", 1000);
      controller1.abort();
      // At boundary 0 (0 % 1024 === 0)
      expect(() => g1.Add(0)).toThrow("zeroAtBoundary: context canceled");
      expect(g1.Used()).toBe(0n);

      const controller2 = new AbortController();
      const g2 = new WorkGuard(abortSignalWorkContext(controller2.signal), "zeroAwayBoundary", 1000);
      g2.Step(); // used 1 (1 % 1024 !== 0)
      controller2.abort();
      // Away from boundary: Add(0) should not check cancellation
      g2.Add(0);
      expect(g2.Used()).toBe(1n);
    });
  });

  describe("SetLimit semantics", () => {
    it("lowering limit does not reset Used and takes effect on subsequent operations", () => {
      const g = new WorkGuard(backgroundWorkContext(), "setLower", 10);
      g.Step();
      g.Step();
      g.Step();
      expect(g.Used()).toBe(3n);

      g.SetLimit(2);
      expect(g.Used()).toBe(3n);
      expect(g.limit).toBe(2n);

      // Next step fails because used (4) > limit (2)
      expect(() => g.Step()).toThrow("TALA setLower work exceeds limit 2");
      expect(g.Used()).toBe(4n);
    });

    it("raising limit allows further operations", () => {
      const g = new WorkGuard(backgroundWorkContext(), "setRaise", 2);
      g.Step();
      g.Step();
      expect(g.Used()).toBe(2n);

      g.SetLimit(10);
      g.Step();
      expect(g.Used()).toBe(3n);
    });

    it("accepts negative replacement limit without immediate check, matching Go", () => {
      const g = new WorkGuard(backgroundWorkContext(), "setNegative", 10);
      g.SetLimit(-5);
      expect(g.limit).toBe(-5n);
      expect(() => g.Step()).toThrow("TALA setNegative work exceeds limit -5");
    });

    it("accepts INT64_MIN and INT64_MAX in SetLimit", () => {
      const g = new WorkGuard(backgroundWorkContext(), "setBoundaries", 10);
      g.SetLimit(9223372036854775807n);
      expect(g.limit).toBe(9223372036854775807n);
      g.SetLimit(-9223372036854775808n);
      expect(g.limit).toBe(-9223372036854775808n);
    });

    it("rejects out-of-range BigInts exceeding signed int64 in SetLimit", () => {
      const g = new WorkGuard(backgroundWorkContext(), "setRange", 10);
      expect(() => g.SetLimit(9223372036854775808n)).toThrow(TypeError);
      expect(() => g.SetLimit(9223372036854775808n)).toThrow("TALA setRange work limit must fit signed int64");
      expect(() => g.SetLimit(-9223372036854775809n)).toThrow("TALA setRange work limit must fit signed int64");
      expect(() => g.SetLimit(2n ** 100n)).toThrow("TALA setRange work limit must fit signed int64");
      expect(() => g.SetLimit(-(2n ** 100n))).toThrow("TALA setRange work limit must fit signed int64");
    });
  });

  describe("Aliases and camelCase methods", () => {
    it("supports camelCase method invocations", () => {
      const g = newWorkGuard(backgroundWorkContext(), "aliasTest", 10);
      g.step();
      g.add(2);
      g.check();
      g.finish();
      expect(g.usedCount()).toBe(3n);
      expect(g.Used()).toBe(3n);
      g.setLimit(20);
      expect(g.limit).toBe(20n);
    });
  });

  describe("Sequence SharedWorkStepper integration", () => {
    it("syncs geometry for 2-step positioned sequence with exactly 5 work units", () => {
      const vessel = new Node(1n);
      vessel.TopLeft = new Point(10, 10);
      const step1 = new Node(2n, 40, 20);
      const step2 = new Node(3n, 60, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [step1, step2],
      });

      const guard = new WorkGuard(backgroundWorkContext(), "seqSync", 100);
      seq.SyncGeometryWithWork(guard);

      // 1 initial + 2 resize steps + 2 arrange steps = 5
      expect(guard.Used()).toBe(5n);
    });

    it("fails with WorkLimitError when limit is smaller than required sequence steps", () => {
      const vessel = new Node(1n);
      vessel.TopLeft = new Point(10, 10);
      const step1 = new Node(2n, 40, 20);
      const step2 = new Node(3n, 60, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [step1, step2],
      });

      // Limit 3: 1 initial step + 2 resize steps = 3. First arrange step (4th) should fail!
      const guard = new WorkGuard(backgroundWorkContext(), "seqExceed", 3);
      let caughtErr = null;
      try {
        seq.SyncGeometryWithWork(guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkLimitError);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(caughtErr.message).toBe("TALA seqExceed work exceeds limit 3");
      expect(guard.Used()).toBe(4n);
    });

    it("observes cancellation during sequence work accounting", () => {
      const vessel = new Node(1n);
      vessel.TopLeft = null; // null TopLeft triggers arrangeSteps finish
      const step1 = new Node(2n, 40, 20);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [step1],
      });

      const controller = new AbortController();
      const guard = new WorkGuard(abortSignalWorkContext(controller.signal), "seqCancel", 100);

      // Abort after guard created
      controller.abort();

      // arrangeStepsWithWork calls work.Finish() when TopLeft is null
      let caughtErr = null;
      try {
        seq.SyncGeometryWithWork(guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkCanceledError);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(caughtErr.message).toBe("seqCancel: context canceled");
    });
  });

  describe("Performance Sanity (Informational)", () => {
    it("runs 1,000,000 background Step calls efficiently", () => {
      const guard = new WorkGuard(backgroundWorkContext(), "perfStep", 1_000_000n);
      for (let i = 0; i < 1_000_000; i++) {
        guard.Step();
      }
      expect(guard.Used()).toBe(1_000_000n);
    });

    it("runs 100,000 Add(10) calls efficiently", () => {
      const guard = new WorkGuard(backgroundWorkContext(), "perfAdd", 1_000_000n);
      for (let i = 0; i < 100_000; i++) {
        guard.Add(10);
      }
      expect(guard.Used()).toBe(1_000_000n);
    });

    it("runs 100,000 Check calls efficiently", () => {
      const guard = new WorkGuard(backgroundWorkContext(), "perfCheck", 100);
      for (let i = 0; i < 100_000; i++) {
        guard.Check();
      }
      expect(guard.Used()).toBe(0n);
    });
  });
});
