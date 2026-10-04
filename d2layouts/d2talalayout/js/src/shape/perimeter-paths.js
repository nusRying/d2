// Pinned lib/shape perimeter path constructors; SVG geometry only.
import { PathContext } from "./perimeter.js";
const HEAD_RADIUS_FACTOR=0.22, BODY_TOP_FACTOR=0.8, CORNER_RADIUS_FACTOR=0.175;
const docPathBottom=16.3, docPathHeight=18.925, parallelWedgeWidth=26, STEP_WEDGE_WIDTH=35, storedDataWedgeWidth=15;
function getTipWidth(box) {return box.Width<60?box.Width/2:30;}
function getTipHeight(box) {return box.Height<90?box.Height/2:45;}
function getArcHeight(box) {return box.Height<48?box.Height/2:24;}
function getArcWidth(box) {return box.Width<48?box.Width/2:24;}
function getTopDimensions(box) {
 let width=box.Width*0.5;if(box.Width>=100)width=Math.min(150,Math.max(50,width));
 return [width,Math.min(55,box.Height*0.2)];
}

export function bodyPath(box) {
	let width = box.Width
	let height = box.Height

	let pc = new PathContext(box.TopLeft, 1, 1)

	let headRadius = width * HEAD_RADIUS_FACTOR
	let headCenterY = headRadius
	let bodyTop = headCenterY + headRadius*BODY_TOP_FACTOR
	let bodyWidth = width
	let bodyHeight = height - bodyTop
	let bodyLeft = 0


	let cornerRadius = Math.min(width*CORNER_RADIUS_FACTOR, bodyHeight*0.25)

	pc.StartAt(pc.Absolute(bodyLeft, bodyTop+cornerRadius))

	pc.C(true, 0, -4*(Math.sqrt(2)-1)/3*cornerRadius, 4*(Math.sqrt(2)-1)/3*cornerRadius, -cornerRadius, cornerRadius, -cornerRadius)
	pc.H(true, bodyWidth-2*cornerRadius)
	pc.C(true, 4*(Math.sqrt(2)-1)/3*cornerRadius, 0, cornerRadius, 4*(Math.sqrt(2)-1)/3*cornerRadius, cornerRadius, cornerRadius)
	pc.V(true, bodyHeight-2*cornerRadius)
	pc.C(true, 0, 4*(Math.sqrt(2)-1)/3*cornerRadius, -4*(Math.sqrt(2)-1)/3*cornerRadius, cornerRadius, -cornerRadius, cornerRadius)
	pc.H(true, -(bodyWidth - 2*cornerRadius))
	pc.C(true, -4*(Math.sqrt(2)-1)/3*cornerRadius, 0, -cornerRadius, -4*(Math.sqrt(2)-1)/3*cornerRadius, -cornerRadius, -cornerRadius)
	pc.Z()

	return pc
}

export function calloutPath(box) {
	let tipWidth = getTipWidth(box)
	let tipHeight = getTipHeight(box)
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(0, 0))
	pc.V(true, box.Height-tipHeight)
	pc.H(true, box.Width/2.0)
	pc.V(true, tipHeight)
	pc.L(true, tipWidth, -tipHeight)
	pc.H(true, box.Width/2.0-tipWidth)
	pc.V(true, -(box.Height - tipHeight))
	pc.H(true, -box.Width)
	pc.Z()
	return pc
}

export function cloudPath(box) {
	let pc = new PathContext(box.TopLeft, box.Width/834, box.Height/523)

	pc.StartAt(pc.Absolute(137.833, 182.833))
	pc.C(true, 0, 5.556, -5.556, 11.111, -11.111, 11.111)
	pc.C(true, -70.833, 6.944, -126.389, 77.778, -126.389, 163.889)
	pc.C(true, 0, 91.667, 62.5, 165.278, 141.667, 165.278)
	pc.H(true, 537.5)
	pc.C(true, 84.723, 0, 154.167, -79.167, 154.167, -175)
	pc.C(true, 0, -91.667, -63.89, -168.056, -144.444, -173.611)
	pc.C(true, -5.556, 0, -11.111, -4.167, -12.5, -11.111)
	pc.C(true, -18.056, -93.055, -101.39, -162.5, -198.611, -162.5)
	pc.C(true, -63.889, 0, -120.834, 29.167, -156.944, 75)
	pc.C(true, -4.167, 5.556, -11.111, 6.945, -15.278, 5.556)
	pc.C(true, -13.889, -5.556, -29.166, -8.333, -45.833, -8.333)
	pc.C(false, 196.167, 71.722, 143.389, 120.333, 137.833, 182.833)
	pc.Z()
	return pc
}

export function cylinderOuterPath(box) {
	let arcHeight = getArcHeight(box)
	let multiplier = 0.45
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(0, arcHeight))
	pc.C(false, 0, 0, box.Width*multiplier, 0, box.Width/2, 0)
	pc.C(false, box.Width-box.Width*multiplier, 0, box.Width, 0, box.Width, arcHeight)
	pc.V(true, box.Height-arcHeight*2)
	pc.C(false, box.Width, box.Height, box.Width-box.Width*multiplier, box.Height, box.Width/2, box.Height)
	pc.C(false, box.Width*multiplier, box.Height, 0, box.Height, 0, box.Height-arcHeight)
	pc.V(true, -(box.Height - arcHeight*2))
	pc.Z()
	return pc
}

export function diamondPath(box) {
	let pc = new PathContext(box.TopLeft, box.Width/77, box.Height/76.9)
	pc.StartAt(pc.Absolute(38.5, 76.9))
	pc.C(true, -0.3, 0, -0.5, -0.1, -0.7, -0.3)
	pc.L(false, 0.3, 39.2)
	pc.C(true, -0.4, -0.4, -0.4, -1, 0, -1.4)
	pc.L(false, 37.8, 0.3)
	pc.C(true, 0.4, -0.4, 1, -0.4, 1.4, 0)
	pc.L(true, 37.5, 37.5)
	pc.C(true, 0.4, 0.4, 0.4, 1, 0, 1.4)
	pc.L(false, 39.2, 76.6)
	pc.C(false, 39, 76.8, 38.8, 76.9, 38.5, 76.9)
	pc.Z()
	return pc
}

export function documentPath(box) {
	let pc = new PathContext(box.TopLeft, box.Width, box.Height)
	pc.StartAt(pc.Absolute(0, docPathBottom/docPathHeight))
	pc.L(false, 0, 0)
	pc.L(false, 1, 0)
	pc.L(false, 1, docPathBottom/docPathHeight)
	pc.C(false, 5/6.0, 12.8/docPathHeight, 2/3.0, 12.8/docPathHeight, 1/2.0, docPathBottom/docPathHeight)
	pc.C(false, 1/3.0, 19.8/docPathHeight, 1/6.0, 19.8/docPathHeight, 0, docPathBottom/docPathHeight)
	pc.Z()
	return pc
}

export function hexagonPath(box) {
	let halfYFactor = 43.6 / 87.3
	let pc = new PathContext(box.TopLeft, box.Width, box.Height)
	pc.StartAt(pc.Absolute(0.25, 0))
	pc.L(false, 0, halfYFactor)
	pc.L(false, 0.25, 1)
	pc.L(false, 0.75, 1)
	pc.L(false, 1, halfYFactor)
	pc.L(false, 0.75, 0)
	pc.Z()
	return pc
}

export function packagePath(box) {
	const [topWidth, topHeight] = getTopDimensions(box)

	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(0, 0))
	pc.L(false, topWidth, 0)
	pc.L(false, topWidth, topHeight)
	pc.L(false, box.Width, topHeight)
	pc.L(false, box.Width, box.Height)
	pc.L(false, 0, box.Height)
	pc.Z()
	return pc
}

export function pageOuterPath(box) {

	let pc = new PathContext(box.TopLeft, 1., 1.)
	pc.StartAt(pc.Absolute(0.5, 0))
	pc.H(false, box.Width-20.8164)
	pc.C(false, box.Width-19.6456, 0.0, box.Width-18.521, 0.456297, box.Width-17.6811, 1.27202)
	pc.L(false, box.Width-1.3647, 17.12)
	pc.C(false, box.Width-0.4923, 17.9674, box.Width, 19.1318, box.Width, 20.348)
	pc.V(false, box.Height-0.5)
	pc.C(false, box.Width, box.Height-0.2239, box.Width-0.2239, box.Height, box.Width-0.5, box.Height)

	pc.H(false, 0.499999)
	pc.C(false, 0.223857, box.Height, 0, box.Height-0.2239, 0, box.Height-0.5)
	pc.V(false, 0.499999)
	pc.C(false, 0, 0.223857, 0.223857, 0, 0.5, 0)
	pc.Z()
	return pc
}

export function parallelogramPath(box) {
	let wedgeWidth = parallelWedgeWidth


	if (box.Width <= wedgeWidth) {
		wedgeWidth = box.Width / 2.0
	}
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(wedgeWidth, 0))
	pc.L(false, box.Width, 0)
	pc.L(false, box.Width-wedgeWidth, box.Height)
	pc.L(false, 0, box.Height)
	pc.L(false, 0, box.Height)
	pc.Z()
	return pc
}

export function personPath(box) {
	let pc = new PathContext(box.TopLeft, box.Width/68.3, box.Height/77.4)


	pc.StartAt(pc.Absolute(68.3, 77.4))
	pc.H(false, 0)
	pc.V(true, -1.1)
	pc.C(true, 0, -13.2, 7.5, -25.1, 19.3, -30.8)
	pc.C(false, 12.8, 40.9, 8.9, 33.4, 8.9, 25.2)
	pc.C(false, 8.9, 11.3, 20.2, 0, 34.1, 0)




	pc.C(true, 13.9, 0, 25.2, 11.3, 25.2, 25.2)

	pc.C(true, 0, 8.2, -3.8, 15.6, -10.4, 20.4)
	pc.C(true, 11.8, 5.7, 19.3, 17.6, 19.3, 30.8)
	pc.V(true, 1)
	pc.H(false, 68.3)
	pc.Z()
	return pc
}

export function queueOuterPath(box) {
	let arcWidth = getArcWidth(box)
	let multiplier = 0.45
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(arcWidth, 0))
	pc.H(true, box.Width-2*arcWidth)
	pc.C(false, box.Width, 0, box.Width, box.Height*multiplier, box.Width, box.Height/2.0)
	pc.C(false, box.Width, box.Height-box.Height*multiplier, box.Width, box.Height, box.Width-arcWidth, box.Height)
	pc.H(true, -1*(box.Width-2*arcWidth))
	pc.C(false, 0, box.Height, 0, box.Height-box.Height*multiplier, 0, box.Height/2.0)
	pc.C(false, 0, box.Height*multiplier, 0, 0, arcWidth, 0)
	pc.Z()
	return pc
}

export function stepPath(box) {
	let wedgeWidth = STEP_WEDGE_WIDTH
	if (box.Width <= wedgeWidth) {
		wedgeWidth = box.Width / 2.0
	}
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(0, 0))
	pc.L(false, box.Width-wedgeWidth, 0)
	pc.L(false, box.Width, box.Height/2)
	pc.L(false, box.Width-wedgeWidth, box.Height)
	pc.L(false, 0, box.Height)
	pc.L(false, wedgeWidth, box.Height/2)
	pc.Z()
	return pc
}

export function storedDataPath(box) {
	let wedgeWidth = storedDataWedgeWidth
	let multiplier = 0.27
	if (box.Width < wedgeWidth*2) {
		wedgeWidth = box.Width / 2.0
	}
	let pc = new PathContext(box.TopLeft, 1, 1)
	pc.StartAt(pc.Absolute(wedgeWidth, 0))
	pc.H(true, box.Width-wedgeWidth)
	pc.C(false, box.Width-wedgeWidth*multiplier, 0, box.Width-wedgeWidth, box.Height*multiplier, box.Width-wedgeWidth, box.Height/2.0)
	pc.C(false, box.Width-wedgeWidth, box.Height-box.Height*multiplier, box.Width-wedgeWidth*multiplier, box.Height, box.Width, box.Height)
	pc.H(true, -(box.Width - wedgeWidth))
	pc.C(false, wedgeWidth-wedgeWidth*multiplier, box.Height, 0, box.Height-box.Height*multiplier, 0, box.Height/2.0)
	pc.C(false, 0, box.Height*multiplier, wedgeWidth-wedgeWidth*multiplier, 0, wedgeWidth, 0)
	pc.Z()
	return pc
}
