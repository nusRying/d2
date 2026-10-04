//go:build ignore

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
)

type OracleOutput struct {
	Metadata  map[string]interface{}    `json:"metadata"`
	Constants map[string]interface{}    `json:"constants"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type ScenarioResult struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Used    string `json:"used"`
}

type errOnlyCancelContext struct {
	context.Context
	canceled bool
}

func (ctx *errOnlyCancelContext) Err() error {
	if ctx.canceled {
		return context.Canceled
	}
	return nil
}

type mutableDoneContext struct {
	context.Context
	doneChan chan struct{}
	canceled bool
}

func (ctx *mutableDoneContext) Done() <-chan struct{} {
	return ctx.doneChan
}

func (ctx *mutableDoneContext) Err() error {
	if ctx.canceled {
		return context.Canceled
	}
	return nil
}

func classifyError(err error) string {
	if err == nil {
		return "none"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if strings.Contains(err.Error(), "work exceeds limit") {
		return "workLimit"
	}
	return "validation"
}

func errMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func main() {
	outPath := "test/fixtures/go-work-guard-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits",
		},
		Constants: map[string]interface{}{
			"MaxEngineNodes":                  limits.MaxEngineNodes,
			"MaxEngineEdges":                  limits.MaxEngineEdges,
			"MaxEngineRoutePoints":            limits.MaxEngineRoutePoints,
			"MaxEngineTreeDepth":              limits.MaxEngineTreeDepth,
			"MaxGraphSize":                    limits.MaxGraphSize,
			"MaxEngineWorkUnits":              strconv.FormatInt(limits.MaxEngineWorkUnits, 10),
			"MaxTransactionWorkUnits":         strconv.FormatInt(limits.MaxTransactionWorkUnits, 10),
			"MaxTransactionOverlapReferences": strconv.FormatInt(limits.MaxTransactionOverlapReferences, 10),
			"MaxBinPackWorkUnits":             strconv.FormatInt(limits.MaxBinPackWorkUnits, 10),
			"MaxPlaceTreesWorkUnits":          strconv.FormatInt(limits.MaxPlaceTreesWorkUnits, 10),
			"MaxLabelPlacementWorkUnits":      strconv.FormatInt(limits.MaxLabelPlacementWorkUnits, 10),
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. null context
	{
		g, err := limits.NewWorkGuard(nil, "nullContext", 100)
		used := "0"
		if g != nil {
			used = strconv.FormatInt(g.Used(), 10)
		}
		out.Scenarios["null_context"] = ScenarioResult{
			Kind:    classifyError(err),
			Message: errMessage(err),
			Used:    used,
		}
	}

	// 2. negative initial limit
	{
		g, err := limits.NewWorkGuard(context.Background(), "negativeLimit", -1)
		used := "0"
		if g != nil {
			used = strconv.FormatInt(g.Used(), 10)
		}
		out.Scenarios["negative_initial_limit"] = ScenarioResult{
			Kind:    classifyError(err),
			Message: errMessage(err),
			Used:    used,
		}
	}

	// 3. zero limit first Step
	{
		g, err := limits.NewWorkGuard(context.Background(), "zeroLimit", 0)
		if err != nil {
			panic(err)
		}
		stepErr := g.Step()
		out.Scenarios["zero_limit_first_step"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 4. limit=2 three Steps
	{
		g, err := limits.NewWorkGuard(context.Background(), "limitTwo", 2)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		_ = g.Step()
		stepErr := g.Step()
		out.Scenarios["limit_two_three_steps"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 5. already-canceled constructor
	{
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		g, err := limits.NewWorkGuard(ctx, "alreadyCanceled", 100)
		used := "0"
		if g != nil {
			used = strconv.FormatInt(g.Used(), 10)
		}
		out.Scenarios["already_canceled_constructor"] = ScenarioResult{
			Kind:    classifyError(err),
			Message: errMessage(err),
			Used:    used,
		}
	}

	// 6. standard context Step cancellation at 1024
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "stdStride1024", 2000)
		if err != nil {
			panic(err)
		}
		for i := 0; i < 1023; i++ {
			if sErr := g.Step(); sErr != nil {
				panic(sErr)
			}
		}
		cancel()
		stepErr := g.Step()
		out.Scenarios["standard_context_step_cancellation_at_1024"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 7. nil-Done context Step cancellation at 64
	{
		ctx := &errOnlyCancelContext{Context: context.Background()}
		g, err := limits.NewWorkGuard(ctx, "nilDoneStride64", 200)
		if err != nil {
			panic(err)
		}
		for i := 0; i < 63; i++ {
			if sErr := g.Step(); sErr != nil {
				panic(sErr)
			}
		}
		ctx.canceled = true
		stepErr := g.Step()
		out.Scenarios["nil_done_context_step_cancellation_at_64"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 8. Check immediate cancellation
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "checkImmediate", 100)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		chkErr := g.Check()
		out.Scenarios["check_immediate_cancellation"] = ScenarioResult{
			Kind:    classifyError(chkErr),
			Message: errMessage(chkErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 9. Finish immediate cancellation
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "finishImmediate", 100)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		finErr := g.Finish()
		out.Scenarios["finish_immediate_cancellation"] = ScenarioResult{
			Kind:    classifyError(finErr),
			Message: errMessage(finErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 10. Add negative
	{
		g, err := limits.NewWorkGuard(context.Background(), "addNegative", 100)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		addErr := g.Add(-1)
		out.Scenarios["add_negative"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 11. Add accepted without crossing boundary
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "addAcceptedNoCross", 2000)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		addErr := g.Add(100)
		out.Scenarios["add_accepted_without_crossing_boundary"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 12. Add accepted crossing cancellation boundary
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "addAcceptedCross", 2000)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		addErr := g.Add(1024)
		out.Scenarios["add_accepted_crossing_cancellation_boundary"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 13. Add overflow crossing boundary: cancellation precedence
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "overflowCancelPrecedence", 1024)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		addErr := g.Add(1024)
		out.Scenarios["add_overflow_crossing_boundary_cancellation_precedence"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 14. Add overflow without accepted boundary: work-limit precedence
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "overflowWorkLimitPrecedence", 1023)
		if err != nil {
			panic(err)
		}
		_ = g.Add(1)
		cancel()
		addErr := g.Add(1023)
		out.Scenarios["add_overflow_without_accepted_boundary_work_limit_precedence"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 15. Add huge math.MaxInt64 charge with small limit
	{
		g, err := limits.NewWorkGuard(context.Background(), "hugeChargeSmallLimit", 100)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		addErr := g.Add(math.MaxInt64)
		out.Scenarios["add_huge_math_max_int64_charge"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 15b. Add huge math.MaxInt64 charge with math.MaxInt64 limit
	{
		g, err := limits.NewWorkGuard(context.Background(), "hugeChargeMaxLimit", math.MaxInt64)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		addErr := g.Add(math.MaxInt64)
		out.Scenarios["add_huge_math_max_int64_with_max_limit"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 16. Add(0) canceled at exact boundary
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "addZeroBoundary", 10_000)
		if err != nil {
			panic(err)
		}
		cancel()
		addErr := g.Add(0)
		out.Scenarios["add_0_canceled_at_exact_boundary"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 17. Add(0) canceled away from boundary
	{
		ctx, cancel := context.WithCancel(context.Background())
		g, err := limits.NewWorkGuard(ctx, "addZeroAway", 10_000)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		cancel()
		addErr := g.Add(0)
		out.Scenarios["add_0_canceled_away_from_boundary"] = ScenarioResult{
			Kind:    classifyError(addErr),
			Message: errMessage(addErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 18. SetLimit lower without reset
	{
		g, err := limits.NewWorkGuard(context.Background(), "setLimitLower", 10)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		_ = g.Step()
		_ = g.Step()
		g.SetLimit(2)
		stepErr := g.Step()
		out.Scenarios["set_limit_lower_without_reset"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 19. SetLimit raise without reset
	{
		g, err := limits.NewWorkGuard(context.Background(), "setLimitRaise", 2)
		if err != nil {
			panic(err)
		}
		_ = g.Step()
		_ = g.Step()
		g.SetLimit(10)
		stepErr := g.Step()
		out.Scenarios["set_limit_raise_without_reset"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 20. Empty location
	{
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		g, err := limits.NewWorkGuard(ctx, "", 10)
		used := "0"
		if g != nil {
			used = strconv.FormatInt(g.Used(), 10)
		}
		out.Scenarios["empty_location_canceled"] = ScenarioResult{
			Kind:    classifyError(err),
			Message: errMessage(err),
			Used:    used,
		}
	}

	// 21. cached Done stride retained despite later Done change
	{
		mCtx := &mutableDoneContext{Context: context.Background(), doneChan: nil}
		g, err := limits.NewWorkGuard(mCtx, "cachedDoneStride", 200)
		if err != nil {
			panic(err)
		}
		mCtx.doneChan = make(chan struct{})
		for i := 0; i < 63; i++ {
			if sErr := g.Step(); sErr != nil {
				panic(sErr)
			}
		}
		mCtx.canceled = true
		stepErr := g.Step()
		out.Scenarios["cached_done_stride_retained"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 22. SetLimit negative
	{
		g, err := limits.NewWorkGuard(context.Background(), "setNegative", 10)
		if err != nil {
			panic(err)
		}
		g.SetLimit(-5)
		stepErr := g.Step()
		out.Scenarios["set_limit_negative"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	// 23. Step int64 wrap
	{
		g, err := limits.NewWorkGuard(context.Background(), "stepWrap", math.MaxInt64)
		if err != nil {
			panic(err)
		}
		_ = g.Add(math.MaxInt64)
		stepErr := g.Step()
		out.Scenarios["step_int64_wrap"] = ScenarioResult{
			Kind:    classifyError(stepErr),
			Message: errMessage(stepErr),
			Used:    strconv.FormatInt(g.Used(), 10),
		}
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Wrote oracle fixture to %s\n", outPath)
}
