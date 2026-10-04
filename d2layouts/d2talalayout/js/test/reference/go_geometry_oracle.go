//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"runtime"

	"github.com/d2lang/d2/lib/geo"
)

type InputObj struct {
	X1        float64 `json:"x1"`
	Y1        float64 `json:"y1"`
	X2        float64 `json:"x2"`
	Y2        float64 `json:"y2"`
	X3        float64 `json:"x3"`
	Y3        float64 `json:"y3"`
	X4        float64 `json:"x4"`
	Y4        float64 `json:"y4"`
	RandFloat float64 `json:"randFloat"`
	RandBool  bool    `json:"randBool"`
}

type PointObj struct {
	X interface{} `json:"x"`
	Y interface{} `json:"y"`
}

type BoundsObj struct {
	Floor interface{} `json:"floor"`
	Ceil  interface{} `json:"ceil"`
}

type TestCase struct {
	Input                  InputObj      `json:"input"`
	MathEuclideanDistance  interface{}   `json:"math_euclidean_distance"`
	MathPrecisionCompare   int           `json:"math_precision_compare"`
	MathTruncateDecimals   interface{}   `json:"math_truncate_decimals"`
	MathSign               int           `json:"math_sign"`
	VectorAdd              []interface{} `json:"vector_add"`
	VectorLength           interface{}   `json:"vector_length"`
	VectorRadians          interface{}   `json:"vector_radians"`
	PointDistanceToLine    interface{}   `json:"point_distance_to_line"`
	PointIntersectionPoint *PointObj     `json:"point_intersection_point"`
	PointInterpolate       *PointObj     `json:"point_interpolate"`
	PointTruncateFloat32   *PointObj     `json:"point_truncate_float32"`
	PointCompare           int           `json:"point_compare"`
	SegmentGetBounds       BoundsObj     `json:"segment_get_bounds"`
	SegmentOverlaps        bool          `json:"segment_overlaps"`
	BoxContains            bool          `json:"box_contains"`
	BoxOverlaps            bool          `json:"box_overlaps"`
	BoxIntersects          bool          `json:"box_intersects"`
}

type Result struct {
	Cases []TestCase `json:"cases"`
}

func encodeFloat64(f float64) interface{} {
	if math.IsNaN(f) {
		return map[string]string{"kind": "nan"}
	}
	if math.IsInf(f, 1) {
		return map[string]string{"kind": "posInf"}
	}
	if math.IsInf(f, -1) {
		return map[string]string{"kind": "negInf"}
	}
	if f == 0 && math.Signbit(f) {
		return map[string]string{"kind": "negZero"}
	}
	// Also encode bit pattern to allow strict parity checks
	bits := math.Float64bits(f)
	hexStr := fmt.Sprintf("%016x", bits)
	return map[string]interface{}{"value": f, "bits": hexStr}
}

func toPointObj(p *geo.Point) *PointObj {
	if p == nil {
		return nil
	}
	return &PointObj{X: encodeFloat64(p.X), Y: encodeFloat64(p.Y)}
}

func toPointObjArray(ps geo.Points) []interface{} {
	var arr []interface{}
	for _, p := range ps {
		arr = append(arr, toPointObj(p))
	}
	return arr
}

func testTruncateDecimals() []map[string]interface{} {
	inputs := []float64{
		math.Copysign(0, -1), // -0
		-0.0001,
		-0.0009,
		-0.001,
		-1.2349,
		0,
		0.0001,
		0.0009,
		0.001,
		1.2349,
	}
	res := []map[string]interface{}{}
	for _, v := range inputs {
		res = append(res, map[string]interface{}{
			"input":  encodeFloat64(v),
			"output": encodeFloat64(geo.TruncateDecimals(v)),
		})
	}
	return res
}

func testGoRound() []map[string]interface{} {
	inputs := []float64{0, math.Copysign(0, -1), 0.1, -0.1, 0.49, -0.49, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5}
	res := []map[string]interface{}{}
	for _, v := range inputs {
		res = append(res, map[string]interface{}{
			"input":  encodeFloat64(v),
			"output": encodeFloat64(math.Round(v)),
		})
	}
	return res
}

func testMedian() []map[string]interface{} {
	res := []map[string]interface{}{}

	// Case 1: 1 point
	pts1 := geo.Points{geo.NewPoint(1, 1)}
	res = append(res, map[string]interface{}{"name": "1 point", "points": toPointObjArray(pts1), "output": toPointObj(pts1.GetMedian())})

	// Case 2: odd number of points
	pts2 := geo.Points{geo.NewPoint(0, 0), geo.NewPoint(10, 20), geo.NewPoint(5, 4)}
	res = append(res, map[string]interface{}{"name": "odd number", "points": toPointObjArray(pts2), "output": toPointObj(pts2.GetMedian())})

	// Case 3: even number of points
	pts3 := geo.Points{geo.NewPoint(0, 0), geo.NewPoint(10, 20), geo.NewPoint(5, 4), geo.NewPoint(2, 2)}
	res = append(res, map[string]interface{}{"name": "even number", "points": toPointObjArray(pts3), "output": toPointObj(pts3.GetMedian())})

	// Case 4: negative coordinates
	pts4 := geo.Points{geo.NewPoint(-5, -5), geo.NewPoint(-10, -20), geo.NewPoint(-1, -4)}
	res = append(res, map[string]interface{}{"name": "negative coords", "points": toPointObjArray(pts4), "output": toPointObj(pts4.GetMedian())})

	// Case 5: duplicate values
	pts5 := geo.Points{geo.NewPoint(5, 4), geo.NewPoint(10, 20), geo.NewPoint(5, 4)}
	res = append(res, map[string]interface{}{"name": "duplicates", "points": toPointObjArray(pts5), "output": toPointObj(pts5.GetMedian())})

	// Case 6: unsorted input (already covered by others, but explicit)
	pts6 := geo.Points{geo.NewPoint(100, 10), geo.NewPoint(1, 100), geo.NewPoint(50, 50)}
	res = append(res, map[string]interface{}{"name": "unsorted", "points": toPointObjArray(pts6), "output": toPointObj(pts6.GetMedian())})

	return res
}

func testOrientationToString() []map[string]interface{} {
	inputs := []geo.Orientation{
		geo.TopLeft,
		geo.TopRight,
		geo.BottomLeft,
		geo.BottomRight,
		geo.Top,
		geo.Right,
		geo.Bottom,
		geo.Left,
		geo.NONE,
	}
	res := []map[string]interface{}{}
	for _, o := range inputs {
		res = append(res, map[string]interface{}{
			"value":  int(o),
			"string": o.ToString(),
		})
	}
	return res
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Missing output file")
		os.Exit(1)
	}
	outFile := os.Args[1]

	rnd := rand.New(rand.NewSource(1)) // Fixed seed

	generateFloat := func() float64 {
		// mix in some negatives, integers, and fractions
		f := rnd.Float64() * 1000
		if rnd.Intn(2) == 0 {
			f = -f
		}
		if rnd.Intn(4) == 0 {
			f = math.Round(f)
		}
		return f
	}

	res := &Result{
		Cases: []TestCase{},
	}

	for i := 0; i < 200; i++ {
		x1, y1 := generateFloat(), generateFloat()
		x2, y2 := generateFloat(), generateFloat()
		x3, y3 := generateFloat(), generateFloat()
		x4, y4 := generateFloat(), generateFloat()
		randFloat := rnd.Float64()
		randBool := rnd.Intn(2) == 0

		tc := TestCase{
			Input: InputObj{
				X1: x1, Y1: y1,
				X2: x2, Y2: y2,
				X3: x3, Y3: y3,
				X4: x4, Y4: y4,
				RandFloat: randFloat,
				RandBool:  randBool,
			},
		}

		tc.MathEuclideanDistance = encodeFloat64(geo.EuclideanDistance(x1, y1, x2, y2))
		tc.MathPrecisionCompare = geo.PrecisionCompare(x1, x2, math.Abs(y1))
		tc.MathTruncateDecimals = encodeFloat64(geo.TruncateDecimals(x1))
		tc.MathSign = geo.Sign(x1)

		v1 := geo.NewVector(x1, y1)
		v2 := geo.NewVector(x2, y2)
		tc.VectorAdd = []interface{}{encodeFloat64(v1.Add(v2)[0]), encodeFloat64(v1.Add(v2)[1])}
		tc.VectorLength = encodeFloat64(v1.Length())
		tc.VectorRadians = encodeFloat64(v1.Radians())

		p1 := geo.NewPoint(x1, y1)
		p2 := geo.NewPoint(x2, y2)
		p3 := geo.NewPoint(x3, y3)
		p4 := geo.NewPoint(x4, y4)

		tc.PointDistanceToLine = encodeFloat64(p1.DistanceToLine(p2, p3))
		tc.PointIntersectionPoint = toPointObj(geo.IntersectionPoint(p1, p2, p3, p4))
		tc.PointInterpolate = toPointObj(p1.Interpolate(p2, randFloat))

		pc := p1.Copy()
		pc.TruncateFloat32()
		tc.PointTruncateFloat32 = toPointObj(pc)
		tc.PointCompare = p1.Compare(p2)

		s1 := geo.NewSegment(p1, p2)
		s2 := geo.NewSegment(p3, p4)

		s3 := geo.NewSegment(geo.NewPoint(x1, y1), geo.NewPoint(x1, y2)) // vertical
		s4 := geo.NewSegment(geo.NewPoint(x3, y1), geo.NewPoint(x3, y3)) // vertical
		floor, ceil := s3.GetBounds([]*geo.Segment{s4}, math.Abs(x4))
		tc.SegmentGetBounds = BoundsObj{Floor: encodeFloat64(floor), Ceil: encodeFloat64(ceil)}
		tc.SegmentOverlaps = s1.Overlaps(*s2, randBool, math.Abs(x1))

		b1 := geo.NewBox(p1, math.Abs(x2), math.Abs(y2))
		b2 := geo.NewBox(p3, math.Abs(x4), math.Abs(y4))

		tc.BoxContains = b1.Contains(p4)
		tc.BoxOverlaps = b1.Overlaps(*b2)
		tc.BoxIntersects = b1.Intersects(*s1, math.Abs(x3))

		res.Cases = append(res.Cases, tc)
	}

	// Add special numeric cases
	specialValues := []float64{
		0.0,
		math.Copysign(0.0, -1.0), // -0
		math.Inf(1),
		math.Inf(-1),
		math.NaN(),
		0.1,
		1.0 / 3.0,
	}

	specialRes := map[string]interface{}{}
	for i, v := range specialValues {
		key := fmt.Sprintf("trunc32_%d", i)
		p := geo.NewPoint(v, v)
		p.TruncateFloat32()
		specialRes[key] = []interface{}{encodeFloat64(p.X), encodeFloat64(p.Y)}
	}

	for i, v := range specialValues {
		key := fmt.Sprintf("radians_%d", i)
		vec := geo.NewVector(v, 1.0)
		specialRes[key] = encodeFloat64(vec.Radians())
	}

	// Output
	out := map[string]interface{}{
		"metadata": map[string]string{
			"runtimeGoVersion": runtime.Version(),
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/lib/geo",
		},
		"random":           res,
		"special":          specialRes,
		"truncateDecimals": testTruncateDecimals(),
		"goRound":          testGoRound(),
		"median":           testMedian(),
		"orientation":      testOrientationToString(),
	}

	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Println("JSON Error:", err)
		os.Exit(1)
	}
	err = os.WriteFile(outFile, bytes, 0644)
	if err != nil {
		fmt.Println("Write Error:", err)
		os.Exit(1)
	}
}
