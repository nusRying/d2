import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_ENGINE_ROUTE_POINTS,
  MAX_ENGINE_TREE_DEPTH,
  MAX_GRAPH_SIZE,
  MAX_ENGINE_WORK_UNITS,
  MAX_TRANSACTION_WORK_UNITS,
  MAX_TRANSACTION_OVERLAP_REFERENCES,
  MAX_BIN_PACK_WORK_UNITS,
  MAX_PLACE_TREES_WORK_UNITS,
  MAX_LABEL_PLACEMENT_WORK_UNITS,
  NewWorkGuard,
  backgroundWorkContext,
  abortSignalWorkContext,
  pollingWorkContext,
  isWorkCanceledError,
  isWorkLimitError,
} from "../../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = join(__dirname, "../fixtures/go-work-guard-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("Slice 08 WorkGuard Go Oracle Parity", () => {
  it("verifies public constants match Go reference exactly", () => {
    const c = reference.constants;
    expect(MAX_ENGINE_NODES).toBe(c.MaxEngineNodes);
    expect(MAX_ENGINE_EDGES).toBe(c.MaxEngineEdges);
    expect(MAX_ENGINE_ROUTE_POINTS).toBe(c.MaxEngineRoutePoints);
    expect(MAX_ENGINE_TREE_DEPTH).toBe(c.MaxEngineTreeDepth);
    expect(MAX_GRAPH_SIZE).toBe(c.MaxGraphSize);

    expect(MAX_ENGINE_WORK_UNITS).toBe(BigInt(c.MaxEngineWorkUnits));
    expect(MAX_TRANSACTION_WORK_UNITS).toBe(BigInt(c.MaxTransactionWorkUnits));
    expect(MAX_TRANSACTION_OVERLAP_REFERENCES).toBe(BigInt(c.MaxTransactionOverlapReferences));
    expect(MAX_BIN_PACK_WORK_UNITS).toBe(BigInt(c.MaxBinPackWorkUnits));
    expect(MAX_PLACE_TREES_WORK_UNITS).toBe(BigInt(c.MaxPlaceTreesWorkUnits));
    expect(MAX_LABEL_PLACEMENT_WORK_UNITS).toBe(BigInt(c.MaxLabelPlacementWorkUnits));
  });

  describe("Replays Go WorkGuard Scenarios", () => {
    it("null_context", () => {
      const expected = reference.scenarios.null_context;
      let caughtErr = null;
      let used = 0n;
      try {
        const g = NewWorkGuard(null, "nullContext", 100);
        used = g.Used();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(false);
      expect(isWorkLimitError(caughtErr)).toBe(false);
      expect(used).toBe(BigInt(expected.used));
    });

    it("negative_initial_limit", () => {
      const expected = reference.scenarios.negative_initial_limit;
      let caughtErr = null;
      let used = 0n;
      try {
        const g = NewWorkGuard(backgroundWorkContext(), "negativeLimit", -1);
        used = g.Used();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(false);
      expect(isWorkLimitError(caughtErr)).toBe(false);
      expect(used).toBe(BigInt(expected.used));
    });

    it("zero_limit_first_step", () => {
      const expected = reference.scenarios.zero_limit_first_step;
      const g = NewWorkGuard(backgroundWorkContext(), "zeroLimit", 0);
      let caughtErr = null;
      try {
        g.Step();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(isWorkCanceledError(caughtErr)).toBe(false);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("limit_two_three_steps", () => {
      const expected = reference.scenarios.limit_two_three_steps;
      const g = NewWorkGuard(backgroundWorkContext(), "limitTwo", 2);
      g.Step();
      g.Step();
      let caughtErr = null;
      try {
        g.Step();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("already_canceled_constructor", () => {
      const expected = reference.scenarios.already_canceled_constructor;
      const controller = new AbortController();
      controller.abort();
      let caughtErr = null;
      let used = 0n;
      try {
        const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "alreadyCanceled", 100);
        used = g.Used();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(used).toBe(BigInt(expected.used));
    });

    it("standard_context_step_cancellation_at_1024", () => {
      const expected = reference.scenarios.standard_context_step_cancellation_at_1024;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "stdStride1024", 2000);
      for (let i = 0; i < 1023; i++) {
        g.Step();
      }
      controller.abort();
      let caughtErr = null;
      try {
        g.Step();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("nil_done_context_step_cancellation_at_64", () => {
      const expected = reference.scenarios.nil_done_context_step_cancellation_at_64;
      let canceled = false;
      const g = NewWorkGuard(pollingWorkContext(() => canceled), "nilDoneStride64", 200);
      for (let i = 0; i < 63; i++) {
        g.Step();
      }
      canceled = true;
      let caughtErr = null;
      try {
        g.Step();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("check_immediate_cancellation", () => {
      const expected = reference.scenarios.check_immediate_cancellation;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "checkImmediate", 100);
      g.Step();
      controller.abort();
      let caughtErr = null;
      try {
        g.Check();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("finish_immediate_cancellation", () => {
      const expected = reference.scenarios.finish_immediate_cancellation;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "finishImmediate", 100);
      g.Step();
      controller.abort();
      let caughtErr = null;
      try {
        g.Finish();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_negative", () => {
      const expected = reference.scenarios.add_negative;
      const g = NewWorkGuard(backgroundWorkContext(), "addNegative", 100);
      g.Step();
      let caughtErr = null;
      try {
        g.Add(-1);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(false);
      expect(isWorkLimitError(caughtErr)).toBe(false);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_accepted_without_crossing_boundary", () => {
      const expected = reference.scenarios.add_accepted_without_crossing_boundary;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "addAcceptedNoCross", 2000);
      g.Step();
      controller.abort();
      g.Add(100);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_accepted_crossing_cancellation_boundary", () => {
      const expected = reference.scenarios.add_accepted_crossing_cancellation_boundary;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "addAcceptedCross", 2000);
      g.Step();
      controller.abort();
      let caughtErr = null;
      try {
        g.Add(1024);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_overflow_crossing_boundary_cancellation_precedence", () => {
      const expected = reference.scenarios.add_overflow_crossing_boundary_cancellation_precedence;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "overflowCancelPrecedence", 1024);
      g.Step();
      controller.abort();
      let caughtErr = null;
      try {
        g.Add(1024);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_overflow_without_accepted_boundary_work_limit_precedence", () => {
      const expected = reference.scenarios.add_overflow_without_accepted_boundary_work_limit_precedence;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "overflowWorkLimitPrecedence", 1023);
      g.Add(1);
      controller.abort();
      let caughtErr = null;
      try {
        g.Add(1023);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(isWorkCanceledError(caughtErr)).toBe(false);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_huge_math_max_int64_charge", () => {
      const expected = reference.scenarios.add_huge_math_max_int64_charge;
      const g = NewWorkGuard(backgroundWorkContext(), "hugeChargeSmallLimit", 100);
      g.Step();
      let caughtErr = null;
      try {
        g.Add(9223372036854775807n);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_huge_math_max_int64_with_max_limit", () => {
      const expected = reference.scenarios.add_huge_math_max_int64_with_max_limit;
      const g = NewWorkGuard(backgroundWorkContext(), "hugeChargeMaxLimit", 9223372036854775807n);
      g.Step();
      let caughtErr = null;
      try {
        g.Add(9223372036854775807n);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_0_canceled_at_exact_boundary", () => {
      const expected = reference.scenarios.add_0_canceled_at_exact_boundary;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "addZeroBoundary", 10000);
      controller.abort();
      let caughtErr = null;
      try {
        g.Add(0);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("add_0_canceled_away_from_boundary", () => {
      const expected = reference.scenarios.add_0_canceled_away_from_boundary;
      const controller = new AbortController();
      const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "addZeroAway", 10000);
      g.Step();
      controller.abort();
      g.Add(0);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("set_limit_lower_without_reset", () => {
      const expected = reference.scenarios.set_limit_lower_without_reset;
      const g = NewWorkGuard(backgroundWorkContext(), "setLimitLower", 10);
      g.Step();
      g.Step();
      g.Step();
      g.SetLimit(2);
      let caughtErr = null;
      try {
        g.Step();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkLimitError(caughtErr)).toBe(true);
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("set_limit_raise_without_reset", () => {
      const expected = reference.scenarios.set_limit_raise_without_reset;
      const g = NewWorkGuard(backgroundWorkContext(), "setLimitRaise", 2);
      g.Step();
      g.Step();
      g.SetLimit(10);
      g.Step();
      expect(g.Used()).toBe(BigInt(expected.used));
    });

    it("empty_location_canceled", () => {
      const expected = reference.scenarios.empty_location_canceled;
      const controller = new AbortController();
      controller.abort();
      let caughtErr = null;
      let used = 0n;
      try {
        const g = NewWorkGuard(abortSignalWorkContext(controller.signal), "", 10);
        used = g.Used();
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).not.toBeNull();
      expect(caughtErr.message).toBe(expected.message);
      expect(isWorkCanceledError(caughtErr)).toBe(true);
      expect(used).toBe(BigInt(expected.used));
    });
  });
});
