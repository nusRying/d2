package main

import (
	"fmt"
	"math"

	"github.com/d2lang/d2/lib/geo"
)

func main() {
	v := -0.0001
	res := geo.TruncateDecimals(v)
	fmt.Printf("TruncateDecimals(%v)\n", v)
	fmt.Printf("Result: %v\n", res)
	fmt.Printf("Signbit: %v\n", math.Signbit(res))
	fmt.Printf("Bits: %x\n", math.Float64bits(res))

	vec := geo.NewVector(0, 0)
	u := vec.Unit()
	fmt.Printf("\nVector{0,0}.Unit()\n")
	fmt.Printf("X: %v, IsNaN: %v, Bits: %x\n", u[0], math.IsNaN(u[0]), math.Float64bits(u[0]))
	fmt.Printf("Y: %v, IsNaN: %v, Bits: %x\n", u[1], math.IsNaN(u[1]), math.Float64bits(u[1]))
}
