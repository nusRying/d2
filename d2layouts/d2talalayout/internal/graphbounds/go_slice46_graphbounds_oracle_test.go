package graphbounds

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 46 graphbounds oracle. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-graphbounds-reference.json; otherwise it
// recomputes every value and asserts the committed fixture is byte-identical.

const s46gbLocation = "Slice46GraphBounds"

// s46gbF encodes float64 values JSON-safely: NaN, +/-Inf and negative zero
// are emitted as strings so JS can reconstruct the exact IEEE value.
type s46gbF float64

func (f s46gbF) MarshalJSON() ([]byte, error) {
	v := float64(f)
	switch {
	case math.IsNaN(v):
		return []byte(`"NaN"`), nil
	case math.IsInf(v, 1):
		return []byte(`"+Inf"`), nil
	case math.IsInf(v, -1):
		return []byte(`"-Inf"`), nil
	case v == 0 && math.Signbit(v):
		return []byte(`"-0"`), nil
	}
	return []byte(strconv.FormatFloat(v, 'g', -1, 64)), nil
}

type s46gbLabelSpec struct {
	W   float64 `json:"w"`
	H   float64 `json:"h"`
	Pos int     `json:"pos"`
}

type s46gbOffsetSpec struct {
	O int     `json:"o"`
	V float64 `json:"v"`
}

type s46gbNodeSpec struct {
	ID          int64             `json:"id"`
	W           float64           `json:"w"`
	H           float64           `json:"h"`
	Placed      bool              `json:"placed"`
	X           float64           `json:"x"`
	Y           float64           `json:"y"`
	Shape       string            `json:"shape"`
	Container   int64             `json:"container,omitempty"`
	Fixed       bool              `json:"fixed,omitempty"`
	FX          float64           `json:"fx,omitempty"`
	FY          float64           `json:"fy,omitempty"`
	Label       *s46gbLabelSpec   `json:"label,omitempty"`
	Icon        *int              `json:"icon,omitempty"`
	Is3D        bool              `json:"is3d,omitempty"`
	Multiple    bool              `json:"multiple,omitempty"`
	LoopOffsets []s46gbOffsetSpec `json:"loopOffsets,omitempty"`
	// ForceContainer rewires node.Container after construction (used to
	// build ancestry cycles that AddNodeToContainer cannot express).
	ForceContainer int64 `json:"forceContainer,omitempty"`
}

type s46gbSpec struct {
	Nodes []s46gbNodeSpec `json:"nodes"`
}

func (spec s46gbSpec) build() (*layoutgraph.Graph, map[int64]*layoutgraph.Node) {
	g := layoutgraph.NewGraph()
	nodes := make(map[int64]*layoutgraph.Node, len(spec.Nodes))
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(ns.ID, ns.W, ns.H)
		n.SetShape(ns.Shape)
		if ns.Placed {
			n.TopLeft = geo.NewPoint(ns.X, ns.Y)
		}
		if ns.Fixed {
			n.FixedTopLeft = geo.NewPoint(ns.FX, ns.FY)
		}
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Width: ns.Label.W, Height: ns.Label.H, Position: label.Position(ns.Label.Pos)}
		}
		if ns.Icon != nil {
			n.Icon = &layoutgraph.Icon{Position: label.Position(*ns.Icon)}
		}
		n.Is3D = ns.Is3D
		n.IsMultiple = ns.Multiple
		if len(ns.LoopOffsets) > 0 {
			n.LoopOffsets = make(map[geo.Orientation]float64)
			for _, o := range ns.LoopOffsets {
				n.LoopOffsets[geo.Orientation(o.O)] = o.V
			}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		nodes[ns.ID] = n
	}
	for _, ns := range spec.Nodes {
		if ns.ForceContainer != 0 {
			nodes[ns.ID].Container = nodes[ns.ForceContainer]
		}
	}
	return g, nodes
}

type s46gbResult struct {
	Box  []s46gbF `json:"box"`
	Used int64    `json:"used"`
	Err  string   `json:"err"`
}

type s46gbLimitProbe struct {
	Limit int64    `json:"limit"`
	Box   []s46gbF `json:"box"`
	Used  int64    `json:"used"`
	Err   string   `json:"err"`
}

type s46gbCancelProbe struct {
	CancelAt int      `json:"cancelAt"`
	Box      []s46gbF `json:"box"`
	Used     int64    `json:"used"`
	Err      string   `json:"err"`
	Canceled bool     `json:"canceled"`
}

type s46gbSet struct {
	Name  string      `json:"name"`
	IDs   []int64     `json:"ids"`
	Bound s46gbResult `json:"bound"`
	Fixed s46gbResult `json:"fixed"`
}

type s46gbNodeResult struct {
	ID      int64       `json:"id"`
	WithAll s46gbResult `json:"withAll"`
	WithNil s46gbResult `json:"withNil"`
}

type s46gbCase struct {
	Name    string             `json:"name"`
	Spec    s46gbSpec          `json:"spec"`
	Nodes   []s46gbNodeResult  `json:"nodes"`
	Sets    []s46gbSet         `json:"sets"`
	Limits  []s46gbLimitProbe  `json:"limits,omitempty"`
	Cancels []s46gbCancelProbe `json:"cancels,omitempty"`
}

type s46gbOracle struct {
	Location string      `json:"location"`
	Cases    []s46gbCase `json:"cases"`
}

type s46gbCountingContext struct {
	context.Context
	calls    int
	cancelAt int
}

func (ctx *s46gbCountingContext) Err() error {
	ctx.calls++
	if ctx.cancelAt > 0 && ctx.calls >= ctx.cancelAt {
		return context.Canceled
	}
	return nil
}

func s46gbErr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func s46gbBox(tl, br *geo.Point) []s46gbF {
	if tl == nil || br == nil {
		return nil
	}
	return []s46gbF{s46gbF(tl.X), s46gbF(tl.Y), s46gbF(br.X), s46gbF(br.Y)}
}

func s46gbGuard(ctx context.Context, limit int64) (*limits.WorkGuard, error) {
	return limits.NewWorkGuard(ctx, s46gbLocation, limit)
}

type s46gbOp func(guard WorkStepper) (*geo.Point, *geo.Point, error)

func s46gbRun(ctx context.Context, limit int64, op s46gbOp) ([]s46gbF, int64, string) {
	guard, err := s46gbGuard(ctx, limit)
	if err != nil {
		return nil, 0, s46gbErr(err)
	}
	tl, br, err := op(guard)
	if err != nil {
		return nil, guard.Used(), s46gbErr(err)
	}
	return s46gbBox(tl, br), guard.Used(), ""
}

const s46gbBigLimit = 1_000_000_000

func s46gbResultOf(op s46gbOp) s46gbResult {
	box, used, errText := s46gbRun(context.Background(), s46gbBigLimit, op)
	return s46gbResult{Box: box, Used: used, Err: errText}
}

func s46gbEvaluate(name string, spec s46gbSpec, sweep bool) s46gbCase {
	c := s46gbCase{Name: name, Spec: spec}
	g, _ := spec.build()
	nodes := layoutgraph.Nodes(g.Nodes)
	for _, node := range g.Nodes {
		node := node
		c.Nodes = append(c.Nodes, s46gbNodeResult{
			ID: node.ID,
			WithAll: s46gbResultOf(func(guard WorkStepper) (*geo.Point, *geo.Point, error) {
				return NodeBoundingBox(node, nodes, guard)
			}),
			WithNil: s46gbResultOf(func(guard WorkStepper) (*geo.Point, *geo.Point, error) {
				return NodeBoundingBox(node, nil, guard)
			}),
		})
	}
	addSet := func(setName string, set layoutgraph.Nodes) {
		ids := make([]int64, 0, len(set))
		for _, n := range set {
			ids = append(ids, n.ID)
		}
		c.Sets = append(c.Sets, s46gbSet{
			Name: setName,
			IDs:  ids,
			Bound: s46gbResultOf(func(guard WorkStepper) (*geo.Point, *geo.Point, error) {
				return BoundingBox(set, guard)
			}),
			Fixed: s46gbResultOf(func(guard WorkStepper) (*geo.Point, *geo.Point, error) {
				return FixedBoundingBox(set, guard)
			}),
		})
	}
	addSet("all", nodes)
	if root, ok := g.Containers[nil]; ok {
		addSet("root", root)
	}
	for _, node := range g.Nodes {
		if children, ok := g.Containers[node]; ok {
			addSet(fmt.Sprintf("container:%d", node.ID), children)
		}
	}

	if sweep {
		fixedAll := func(guard WorkStepper) (*geo.Point, *geo.Point, error) {
			return FixedBoundingBox(nodes, guard)
		}
		full := s46gbResultOf(fixedAll)
		var probeLimits []int64
		if full.Used <= 400 {
			for limit := int64(0); limit <= full.Used; limit++ {
				probeLimits = append(probeLimits, limit)
			}
		} else {
			probeLimits = []int64{0, 1, 63, 64, 65, full.Used / 3, full.Used / 2, full.Used - 1, full.Used}
		}
		for _, limit := range probeLimits {
			box, used, errText := s46gbRun(context.Background(), limit, fixedAll)
			c.Limits = append(c.Limits, s46gbLimitProbe{Limit: limit, Box: box, Used: used, Err: errText})
		}
		count := &s46gbCountingContext{Context: context.Background()}
		s46gbRun(count, s46gbBigLimit, fixedAll)
		for cancelAt := 1; cancelAt <= count.calls; cancelAt++ {
			ctx := &s46gbCountingContext{Context: context.Background(), cancelAt: cancelAt}
			guard, err := s46gbGuard(ctx, s46gbBigLimit)
			probe := s46gbCancelProbe{CancelAt: cancelAt}
			if err != nil {
				probe.Err = s46gbErr(err)
				probe.Canceled = isCanceled(err)
			} else {
				tl, br, err := fixedAll(guard)
				probe.Used = guard.Used()
				if err != nil {
					probe.Err = s46gbErr(err)
					probe.Canceled = isCanceled(err)
				} else {
					probe.Box = s46gbBox(tl, br)
				}
			}
			c.Cancels = append(c.Cancels, probe)
		}
	}
	return c
}

func isCanceled(err error) bool {
	return errors.Is(err, context.Canceled)
}

func s46gbIntPtr(v int) *int { return &v }

var s46gbOutsidePositions = []label.Position{
	label.OutsideTopLeft, label.OutsideTopCenter, label.OutsideTopRight,
	label.OutsideLeftTop, label.OutsideLeftMiddle, label.OutsideLeftBottom,
	label.OutsideRightTop, label.OutsideRightMiddle, label.OutsideRightBottom,
	label.OutsideBottomLeft, label.OutsideBottomCenter, label.OutsideBottomRight,
}

var s46gbShapes = []string{
	"", "Callout", "Circle", "Cloud", "Cylinder", "Diamond", "Document", "Hexagon",
	"Image", "Oval", "Package", "Page", "Parallelogram", "Person", "C4Person", "Queue",
	"RealSquare", "Square", "Step", "StoredData", "Text", "Class", "Table", "Code",
}

func s46gbHandcrafted() []struct {
	name  string
	spec  s46gbSpec
	sweep bool
} {
	type entry = struct {
		name  string
		spec  s46gbSpec
		sweep bool
	}
	var out []entry
	out = append(out, entry{"empty", s46gbSpec{}, true})
	out = append(out, entry{"single", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 100.4, H: 50.6, Placed: true, X: 10.25, Y: -3.5},
	}}, true})
	// Every outside label position on a middle node, flanked by neighbours so
	// both the extreme and non-extreme padding paths execute.
	for i, pos := range s46gbOutsidePositions {
		out = append(out, entry{fmt.Sprintf("label-%d", pos), s46gbSpec{Nodes: []s46gbNodeSpec{
			{ID: 1, W: 60, H: 40, Placed: true, X: 0, Y: 0},
			{ID: 2, W: 80, H: 30, Placed: true, X: 120, Y: 90, Label: &s46gbLabelSpec{W: 140.3, H: 21.7, Pos: int(pos)}},
			{ID: 3, W: 50, H: 50, Placed: true, X: 300, Y: 220},
		}}, i%4 == 0})
		out = append(out, entry{fmt.Sprintf("label-extreme-%d", pos), s46gbSpec{Nodes: []s46gbNodeSpec{
			{ID: 1, W: 80, H: 30, Placed: true, X: 0, Y: 0, Label: &s46gbLabelSpec{W: 140.3, H: 21.7, Pos: int(pos)}},
			{ID: 2, W: 30, H: 30, Placed: true, X: 40, Y: 10},
		}}, false})
	}
	// Labels: inside, unset and border positions never expand bounds.
	for _, pos := range []label.Position{label.Unset, label.InsideMiddleCenter, label.InsideTopLeft, label.BorderTopCenter, label.UnlockedTop} {
		out = append(out, entry{fmt.Sprintf("label-ignored-%d", pos), s46gbSpec{Nodes: []s46gbNodeSpec{
			{ID: 1, W: 80, H: 30, Placed: true, X: 5, Y: 5, Label: &s46gbLabelSpec{W: 200, H: 80, Pos: int(pos)}},
		}}, false})
	}
	// Icons at every outside position, inside, and on an image node.
	for i, pos := range s46gbOutsidePositions {
		shape := ""
		if i%3 == 1 {
			shape = "Image"
		}
		out = append(out, entry{fmt.Sprintf("icon-%d-%s", pos, shape), s46gbSpec{Nodes: []s46gbNodeSpec{
			{ID: 1, W: 70, H: 45, Placed: true, X: 20, Y: 30, Shape: shape, Icon: s46gbIntPtr(int(pos))},
			{ID: 2, W: 40, H: 40, Placed: true, X: 200, Y: 30},
		}}, false})
	}
	out = append(out, entry{"icon-inside", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 70, H: 45, Placed: true, X: 20, Y: 30, Icon: s46gbIntPtr(int(label.InsideTopLeft))},
	}}, false})
	out = append(out, entry{"icon-and-label", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 70, H: 45, Placed: true, X: 20, Y: 30, Icon: s46gbIntPtr(int(label.OutsideLeftTop)),
			Label: &s46gbLabelSpec{W: 30, H: 10, Pos: int(label.OutsideRightBottom)}},
		{ID: 2, W: 70, H: 45, Placed: true, X: -200, Y: 300},
	}}, true})
	// Modifiers and loop offsets.
	out = append(out, entry{"modifiers", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 70.5, H: 45.5, Placed: true, X: 0.5, Y: 0.5, Is3D: true},
		{ID: 2, W: 70, H: 45, Placed: true, X: 100, Y: 0, Is3D: true, Shape: "Hexagon"},
		{ID: 3, W: 70, H: 45, Placed: true, X: 200, Y: 0, Multiple: true},
		{ID: 4, W: 70, H: 45, Placed: true, X: 300, Y: 0, Multiple: true, Is3D: true},
	}}, true})
	out = append(out, entry{"loop-offsets", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 70, H: 45, Placed: true, X: 0, Y: 0, LoopOffsets: []s46gbOffsetSpec{
			{O: int(geo.Left), V: 12}, {O: int(geo.Right), V: 31}, {O: int(geo.Top), V: 7}, {O: int(geo.Bottom), V: 44},
			{O: int(geo.TopLeft), V: 12},
		}},
		{ID: 2, W: 70, H: 45, Placed: true, X: 200, Y: 0, LoopOffsets: []s46gbOffsetSpec{{O: int(geo.Top), V: 3.5}},
			Label: &s46gbLabelSpec{W: 50, H: 15, Pos: int(label.OutsideTopCenter)}},
	}}, true})
	// Fixed origins inside containers.
	out = append(out, entry{"fixed-root", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 50, H: 50, Placed: true, X: 10, Y: 10},
		{ID: 2, W: 50, H: 50, Placed: true, X: 100, Y: 70, Fixed: true, FX: 30, FY: 20},
	}}, true})
	out = append(out, entry{"fixed-nested", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 400, H: 400, Placed: true, X: 0, Y: 0},
		{ID: 2, W: 200, H: 200, Placed: true, X: 20, Y: 20, Container: 1},
		{ID: 3, W: 40, H: 40, Placed: true, X: 40, Y: 40, Container: 2, Fixed: true, FX: 5, FY: 6},
		{ID: 4, W: 40, H: 40, Placed: true, X: 260, Y: 60, Container: 1, Fixed: true, FX: 11, FY: 13},
		{ID: 5, W: 40, H: 40, Placed: true, X: 300, Y: 300, Container: 1},
	}}, true})
	out = append(out, entry{"unplaced", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 50, H: 50, Placed: true, X: 10, Y: 10},
		{ID: 2, W: 50, H: 50, Placed: false},
	}}, true})
	out = append(out, entry{"ancestry-cycle", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 30, H: 30, Placed: true, X: 20, Y: 20, ForceContainer: 2},
		{ID: 2, W: 30, H: 30, Placed: true, X: 60, Y: 20, ForceContainer: 1},
	}}, true})
	out = append(out, entry{"ancestry-cycle-deep", s46gbSpec{Nodes: []s46gbNodeSpec{
		{ID: 1, W: 300, H: 300, Placed: true, X: 0, Y: 0, ForceContainer: 3},
		{ID: 2, W: 100, H: 100, Placed: true, X: 10, Y: 10, Container: 1},
		{ID: 3, W: 30, H: 30, Placed: true, X: 20, Y: 20, Container: 2},
	}}, false})
	return out
}

func s46gbRandomSpec(rng *rand.Rand) s46gbSpec {
	var spec s46gbSpec
	count := 1 + rng.Intn(8)
	for i := 0; i < count; i++ {
		ns := s46gbNodeSpec{
			ID:     int64(i + 1),
			W:      float64(10+rng.Intn(150)) + float64(rng.Intn(4))*0.25,
			H:      float64(10+rng.Intn(120)) + float64(rng.Intn(4))*0.25,
			Placed: true,
			X:      float64(rng.Intn(600)-200) + float64(rng.Intn(4))*0.5,
			Y:      float64(rng.Intn(600)-200) + float64(rng.Intn(4))*0.5,
			Shape:  s46gbShapes[rng.Intn(len(s46gbShapes))],
		}
		if i > 0 && rng.Intn(3) == 0 {
			ns.Container = int64(1 + rng.Intn(i))
		}
		if rng.Intn(5) == 0 {
			ns.Fixed = true
			ns.FX = float64(rng.Intn(80))
			ns.FY = float64(rng.Intn(80))
		}
		if rng.Intn(3) != 0 {
			pos := label.Position(rng.Intn(int(label.InsideBottomRight) + 1))
			ns.Label = &s46gbLabelSpec{W: float64(5 + rng.Intn(150)), H: float64(5+rng.Intn(40)) + 0.5, Pos: int(pos)}
		}
		if rng.Intn(3) == 0 {
			ns.Icon = s46gbIntPtr(rng.Intn(int(label.InsideBottomRight) + 1))
		}
		ns.Is3D = rng.Intn(6) == 0
		ns.Multiple = rng.Intn(6) == 0
		if rng.Intn(4) == 0 {
			for _, o := range []geo.Orientation{geo.Left, geo.Right, geo.Top, geo.Bottom} {
				if rng.Intn(2) == 0 {
					ns.LoopOffsets = append(ns.LoopOffsets, s46gbOffsetSpec{O: int(o), V: float64(rng.Intn(60))})
				}
			}
		}
		spec.Nodes = append(spec.Nodes, ns)
	}
	return spec
}

func TestSlice46GraphBoundsOracle(t *testing.T) {
	oracle := s46gbOracle{Location: s46gbLocation}
	for _, entry := range s46gbHandcrafted() {
		oracle.Cases = append(oracle.Cases, s46gbEvaluate(entry.name, entry.spec, entry.sweep))
	}
	rng := rand.New(rand.NewSource(46))
	{
		// A larger labelled graph so extremity scans cross the 64-unit
		// context-check stride several times.
		var spec s46gbSpec
		for i := 0; i < 24; i++ {
			pos := s46gbOutsidePositions[rng.Intn(len(s46gbOutsidePositions))]
			spec.Nodes = append(spec.Nodes, s46gbNodeSpec{
				ID: int64(i + 1), W: float64(20 + rng.Intn(60)), H: float64(20 + rng.Intn(60)), Placed: true,
				X: float64(rng.Intn(1000)), Y: float64(rng.Intn(1000)),
				Label: &s46gbLabelSpec{W: float64(40 + rng.Intn(200)), H: float64(10 + rng.Intn(80)), Pos: int(pos)},
			})
		}
		oracle.Cases = append(oracle.Cases, s46gbEvaluate("large-labelled", spec, true))
	}
	for i := 0; i < 40; i++ {
		oracle.Cases = append(oracle.Cases, s46gbEvaluate(fmt.Sprintf("random-%d", i), s46gbRandomSpec(rng), i%8 == 0))
	}
	s46gbWriteOrCompare(t, "go-slice46-graphbounds-reference.json", oracle)
}

func s46gbWriteOrCompare(t *testing.T, name string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	path := filepath.Join("..", "..", "js", "test", "fixtures", name)
	if os.Getenv("TALA_SLICE46_ORACLE") == "1" {
		if err := os.WriteFile(path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	committed = bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n"))
	if !bytes.Equal(committed, encoded) {
		t.Fatalf("%s is stale; regenerate with TALA_SLICE46_ORACLE=1", name)
	}
}
