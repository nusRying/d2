package labeling

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/nodeshape"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

// Slice 46 label-model oracle: nodeshape label preferences, IsRectangular,
// table column ports, and labeling.Initialize with its default placement
// model. With TALA_SLICE46_ORACLE=1 the test rewrites
// js/test/fixtures/go-slice46-label-model-reference.json; otherwise it
// recomputes every value and asserts the committed fixture is byte-identical.
//
// Go returns label preferences as maps; their iteration order is random, so
// the oracle records sorted membership only.

type s46mF float64

func (f s46mF) MarshalJSON() ([]byte, error) {
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

var s46mShapes = []string{
	"", "Callout", "Circle", "Cloud", "Cylinder", "Diamond", "Document", "Hexagon",
	"Image", "Oval", "Package", "Page", "Parallelogram", "Person", "C4Person", "Queue",
	"RealSquare", "Square", "Step", "StoredData", "Text", "Class", "Table", "Code",
}

const s46mMaxPosition = int(label.UnlockedBottom)

// ── Shape preferences ───────────────────────────────────────────────────────

type s46mShapeCase struct {
	Shape             string   `json:"shape"`
	IsRectangular     bool     `json:"isRectangular"`
	Tiers             [][]int  `json:"tiers"`
	UnknownTiers      [][]int  `json:"unknownTiers"`
	Preferences       []int    `json:"preferences"`
	ContainerPrefs    []int    `json:"containerPreferences"`
	Tranches          [][]int  `json:"tranches"`
	ContainerTranches [][]int  `json:"containerTranches"`
	Compare           []string `json:"compare"`
}

func s46mSortedKeys(m map[label.Position]struct{}) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, int(k))
	}
	sort.Ints(out)
	return out
}

func s46mInts(positions []label.Position) []int {
	out := make([]int, 0, len(positions))
	for _, p := range positions {
		out = append(out, int(p))
	}
	return out
}

func s46mTranches(tranches [][]label.Position) [][]int {
	out := make([][]int, 0, len(tranches))
	for _, tranche := range tranches {
		out = append(out, s46mInts(tranche))
	}
	return out
}

func s46mShapeCaseOf(shape string) s46mShapeCase {
	g := layoutgraph.NewGraph()
	node := layoutgraph.NewNode(1, 100, 60)
	node.SetShape(shape)
	g.AddNewNodeToContainer(nil, node)
	container := layoutgraph.NewNode(2, 300, 200)
	container.SetShape(shape)
	g.AddNewNodeToContainer(nil, container)
	g.AddNewNodeToContainer(container, layoutgraph.NewNode(3, 10, 10))

	c := s46mShapeCase{Shape: shape, IsRectangular: node.Shape.IsRectangular()}
	for _, tier := range []nodeshape.LabelTier{nodeshape.Good, nodeshape.OK, nodeshape.Unideal, nodeshape.Bad} {
		c.Tiers = append(c.Tiers, s46mSortedKeys(node.Shape.LabelPositionPreferences(tier)))
	}
	for _, tier := range []nodeshape.LabelTier{-1, 4, 100} {
		c.UnknownTiers = append(c.UnknownTiers, s46mSortedKeys(node.Shape.LabelPositionPreferences(tier)))
	}
	c.Preferences = s46mInts(labelPositionPreferences(node))
	c.ContainerPrefs = s46mInts(labelPositionPreferences(container))
	c.Tranches = s46mTranches(labelPositionPreferenceTranches(node))
	c.ContainerTranches = s46mTranches(labelPositionPreferenceTranches(container))
	for first := 0; first <= s46mMaxPosition; first++ {
		row := make([]byte, 0, s46mMaxPosition+1)
		for second := 0; second <= s46mMaxPosition; second++ {
			switch compareLabelPositions(node, label.Position(first), label.Position(second)) {
			case 1:
				row = append(row, '+')
			case -1:
				row = append(row, '-')
			case 0:
				row = append(row, '0')
			default:
				panic("unexpected compareLabelPositions result")
			}
		}
		c.Compare = append(c.Compare, string(row))
	}
	return c
}

// ── Table ports ─────────────────────────────────────────────────────────────

type s46mTablePortProbe struct {
	Shape       string   `json:"shape"`
	NumColumns  int      `json:"numColumns"`
	W           s46mF    `json:"w"`
	H           s46mF    `json:"h"`
	X           s46mF    `json:"x"`
	Y           s46mF    `json:"y"`
	Orientation int      `json:"orientation"`
	Column      int      `json:"column"`
	ValueOK     bool     `json:"valueOk"`
	Value       [2]s46mF `json:"value"`
	ValuePanic  string   `json:"valuePanic"`
	IndexOK     bool     `json:"indexOk"`
	Index       int      `json:"index"`
	IndexPanic  string   `json:"indexPanic"`
}

func s46mRecover(fn func()) (message string) {
	defer func() {
		if r := recover(); r != nil {
			message = fmt.Sprint(r)
		}
	}()
	fn()
	return ""
}

func s46mTableProbes() []s46mTablePortProbe {
	type geometry struct{ w, h, x, y float64 }
	geometries := []geometry{{240, 150, 11, 13}, {99.5, 41.3, -20.25, 7.75}, {0, 0, 0, 0}}
	var out []s46mTablePortProbe
	shapes := []string{"Table", "", "Circle"}
	for _, shape := range shapes {
		maxColumns := 7
		if shape != "Table" {
			maxColumns = 1
		}
		for numColumns := 0; numColumns <= maxColumns; numColumns++ {
			for _, gm := range geometries {
				node := layoutgraph.NewNode(1, gm.w, gm.h)
				node.SetShape(shape)
				node.SetNumColumns(numColumns)
				node.TopLeft = geo.NewPoint(gm.x, gm.y)
				for o := geo.TopLeft; o <= geo.NONE; o++ {
					for column := -1; column <= numColumns+1; column++ {
						probe := s46mTablePortProbe{
							Shape: shape, NumColumns: numColumns, W: s46mF(gm.w), H: s46mF(gm.h), X: s46mF(gm.x), Y: s46mF(gm.y),
							Orientation: int(o), Column: column,
						}
						probe.ValuePanic = s46mRecover(func() {
							value, ok := nodeshape.TableColumnPortValue(node.Shape, o, column)
							probe.ValueOK = ok
							probe.Value = [2]s46mF{s46mF(value.X), s46mF(value.Y)}
						})
						probe.IndexPanic = s46mRecover(func() {
							index, ok := nodeshape.TablePortIndex(node.Shape, o, column)
							probe.IndexOK = ok
							probe.Index = index
						})
						out = append(out, probe)
					}
				}
			}
		}
	}
	return out
}

// ── Initialize ──────────────────────────────────────────────────────────────

type s46mLabelSpec struct {
	W   float64 `json:"w"`
	H   float64 `json:"h"`
	Pos int     `json:"pos"`
}

type s46mNodeSpec struct {
	ID        int64          `json:"id"`
	Shape     string         `json:"shape"`
	Container int64          `json:"container,omitempty"`
	Label     *s46mLabelSpec `json:"label,omitempty"`
	Icon      *int           `json:"icon,omitempty"`
}

type s46mSpec struct {
	Nodes []s46mNodeSpec `json:"nodes"`
}

type s46mNodeState struct {
	ID          int64 `json:"id"`
	HasLabel    bool  `json:"hasLabel"`
	LabelPos    int   `json:"labelPos"`
	LabelFixed  bool  `json:"labelFixed"`
	HasIcon     bool  `json:"hasIcon"`
	IconPos     int   `json:"iconPos"`
	IconFixed   bool  `json:"iconFixed"`
	IsContainer bool  `json:"isContainer"`
}

type s46mInitCase struct {
	Name   string          `json:"name"`
	Spec   s46mSpec        `json:"spec"`
	States []s46mNodeState `json:"states"`
}

func (spec s46mSpec) build() *layoutgraph.Graph {
	g := layoutgraph.NewGraph()
	nodes := make(map[int64]*layoutgraph.Node, len(spec.Nodes))
	for _, ns := range spec.Nodes {
		n := layoutgraph.NewNode(ns.ID, 100, 50)
		n.SetShape(ns.Shape)
		if ns.Label != nil {
			n.Label = &layoutgraph.Label{Width: ns.Label.W, Height: ns.Label.H, Position: label.Position(ns.Label.Pos)}
		}
		if ns.Icon != nil {
			n.Icon = &layoutgraph.Icon{Position: label.Position(*ns.Icon)}
		}
		var container *layoutgraph.Node
		if ns.Container != 0 {
			container = nodes[ns.Container]
		}
		g.AddNewNodeToContainer(container, n)
		nodes[ns.ID] = n
	}
	return g
}

func s46mEvaluateInit(name string, spec s46mSpec) s46mInitCase {
	g := spec.build()
	Initialize(g)
	c := s46mInitCase{Name: name, Spec: spec}
	for _, n := range g.Nodes {
		state := s46mNodeState{ID: n.ID, IsContainer: n.IsContainer()}
		if n.Label != nil {
			state.HasLabel = true
			state.LabelPos = int(n.Label.Position)
			state.LabelFixed = n.Label.PositionFixed()
		}
		if n.Icon != nil {
			state.HasIcon = true
			state.IconPos = int(n.Icon.Position)
			state.IconFixed = n.Icon.PositionFixed()
		}
		c.States = append(c.States, state)
	}
	return c
}

func s46mIntPtr(v int) *int { return &v }

func s46mInitCases() []s46mInitCase {
	var out []s46mInitCase
	out = append(out, s46mEvaluateInit("empty", s46mSpec{}))
	// Every shape, as a leaf and as a container, with an unset label.
	var leaves, containers s46mSpec
	for i, shape := range s46mShapes {
		leaves.Nodes = append(leaves.Nodes, s46mNodeSpec{ID: int64(i + 1), Shape: shape, Label: &s46mLabelSpec{W: 30, H: 10}})
		id := int64(2*i + 1)
		containers.Nodes = append(containers.Nodes,
			s46mNodeSpec{ID: id, Shape: shape, Label: &s46mLabelSpec{W: 30, H: 10}},
			s46mNodeSpec{ID: id + 1, Container: id})
	}
	out = append(out, s46mEvaluateInit("leaves", leaves))
	out = append(out, s46mEvaluateInit("containers", containers))
	out = append(out, s46mEvaluateInit("explicit-and-icons", s46mSpec{Nodes: []s46mNodeSpec{
		{ID: 1, Label: &s46mLabelSpec{W: 30, H: 10, Pos: int(label.OutsideRightBottom)}},
		{ID: 2, Shape: "Person", Icon: s46mIntPtr(int(label.Unset))},
		{ID: 3, Shape: "Image", Icon: s46mIntPtr(int(label.OutsideTopLeft)), Label: &s46mLabelSpec{W: 3, H: 1}},
		{ID: 4, Shape: "Cloud", Icon: s46mIntPtr(int(label.InsideMiddleCenter)), Label: &s46mLabelSpec{W: 3, H: 1, Pos: int(label.BorderTopCenter)}},
		{ID: 5},
	}}))
	rng := rand.New(rand.NewSource(4600))
	for i := 0; i < 30; i++ {
		var spec s46mSpec
		count := 1 + rng.Intn(10)
		for j := 0; j < count; j++ {
			ns := s46mNodeSpec{ID: int64(j + 1), Shape: s46mShapes[rng.Intn(len(s46mShapes))]}
			if j > 0 && rng.Intn(3) == 0 {
				ns.Container = int64(1 + rng.Intn(j))
			}
			if rng.Intn(4) != 0 {
				pos := 0
				if rng.Intn(2) == 0 {
					pos = rng.Intn(s46mMaxPosition + 1)
				}
				ns.Label = &s46mLabelSpec{W: float64(rng.Intn(100)), H: float64(rng.Intn(30)), Pos: pos}
			}
			if rng.Intn(3) == 0 {
				pos := 0
				if rng.Intn(2) == 0 {
					pos = rng.Intn(s46mMaxPosition + 1)
				}
				ns.Icon = s46mIntPtr(pos)
			}
			spec.Nodes = append(spec.Nodes, ns)
		}
		out = append(out, s46mEvaluateInit(fmt.Sprintf("random-%d", i), spec))
	}
	return out
}

type s46mOracle struct {
	EdgeOrder      []int                `json:"edgeOrder"`
	NodeOrder      []int                `json:"nodeOrder"`
	ContainerOrder []int                `json:"containerOrder"`
	Shapes         []s46mShapeCase      `json:"shapes"`
	TablePorts     []s46mTablePortProbe `json:"tablePorts"`
	Inits          []s46mInitCase       `json:"inits"`
}

func TestSlice46LabelModelOracle(t *testing.T) {
	oracle := s46mOracle{
		EdgeOrder:      s46mInts(edgeLabelPreferenceOrder),
		NodeOrder:      s46mInts(nodeLabelPositionOrder),
		ContainerOrder: s46mInts(containerLabelPositionOrder),
		TablePorts:     s46mTableProbes(),
		Inits:          s46mInitCases(),
	}
	for _, shape := range s46mShapes {
		oracle.Shapes = append(oracle.Shapes, s46mShapeCaseOf(shape))
	}
	s46mWriteOrCompare(t, "go-slice46-label-model-reference.json", oracle)
}

func s46mWriteOrCompare(t *testing.T, name string, value any) {
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
