import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Label } from "../../src/graph/label.js";
import { Point } from "../../src/geometry/point.js";
import { prescale, talaFontSizes } from "../../src/placement/prescale.js";
import { SideEdgeSpacing } from "../../src/placementcost/constants.js";
import referenceFixture from "../fixtures/go-prescale-reference.json";

describe("Prescale Go Parity Oracle Tests", () => {
  it("should match metadata and constants from Go reference", () => {
    expect(typeof referenceFixture.metadata.runtimeGoVersion).toBe("string");
    expect(referenceFixture.metadata.runtimeGoVersion.length).toBeGreaterThan(0);
    expect(typeof referenceFixture.metadata.runtimeGOOS).toBe("string");
    expect(referenceFixture.metadata.runtimeGOOS.length).toBeGreaterThan(0);
    expect(typeof referenceFixture.metadata.runtimeGOARCH).toBe("string");
    expect(referenceFixture.metadata.runtimeGOARCH.length).toBeGreaterThan(0);
    expect(referenceFixture.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(referenceFixture.metadata.referencePackage).toBe("github.com/d2lang/d2/d2layouts/d2talalayout/internal/placement");
    expect(SideEdgeSpacing).toBe(referenceFixture.metadata.sideEdgeSpacing);
    expect(talaFontSizes()).toEqual(referenceFixture.metadata.adapterFontSizes);
  });

  it("should match GenericNoEdges", () => {
    const expected = referenceFixture.cases.GenericNoEdges;
    const g = new Graph();
    const n = new Node(1, 100, 60);
    n.FontSize = 16;
    n.Label = new Label("", 50, 20);
    g.Nodes.push(n);

    prescale(g);

    expect(n.Width).toBe(expected.width);
    expect(n.Height).toBe(expected.height);
    expect(n.FontSize).toBe(expected.fontSize);
    expect(n.Label.Width).toBe(expected.label.width);
    expect(n.Label.Height).toBe(expected.label.height);
  });

  it("should match CircleNoEdges", () => {
    const expected = referenceFixture.cases.CircleNoEdges;
    const g = new Graph();
    const n = new Node(1, 40, 60);
    n.SetShape("Circle");
    n.FontSize = 16;
    g.Nodes.push(n);

    prescale(g);

    expect(n.Width).toBe(expected.width);
    expect(n.Height).toBe(expected.height);
    expect(n.FontSize).toBe(expected.fontSize);
    expect(n.Label).toBeNull();
  });

  it("should match RealSquareNoEdges", () => {
    const expected = referenceFixture.cases.RealSquareNoEdges;
    const g = new Graph();
    const n = new Node(1, 40, 80);
    n.SetShape("RealSquare");
    g.Nodes.push(n);

    prescale(g);

    expect(n.Width).toBe(expected.width);
    expect(n.Height).toBe(expected.height);
    expect(n.FontSize).toBeNull();
  });

  it("should match SquareAspectRatioCheck", () => {
    const expected = referenceFixture.cases.SquareAspectRatioCheck;
    const g = new Graph();
    const n = new Node(1, 40, 80);
    n.SetShape("Square");
    g.Nodes.push(n);

    prescale(g);

    expect(n.Width).toBe(expected.width);
    expect(n.Height).toBe(expected.height);
    expect(n.FontSize).toBeNull();
  });

  it("should match FixedCircleDenseEdges", () => {
    const expected = referenceFixture.cases.FixedCircleDenseEdges;
    const g = new Graph();
    const nA = new Node(1, 40, 60);
    nA.SetShape("Circle");
    nA.FixedTopLeft = new Point(10, 20);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 4; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match DesiredWidthSkip", () => {
    const expected = referenceFixture.cases.DesiredWidthSkip;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.DesiredWidth = 80;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 4; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match DesiredHeightSkip", () => {
    const expected = referenceFixture.cases.DesiredHeightSkip;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.DesiredHeight = 80;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 4; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match TableSkip", () => {
    const expected = referenceFixture.cases.TableSkip;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.SetShape("Table");
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 4; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match ClassSkip", () => {
    const expected = referenceFixture.cases.ClassSkip;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.SetShape("Class");
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 4; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match SingleNormalEdge", () => {
    const expected = referenceFixture.cases.SingleNormalEdge;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("", 30, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match TwoParallelEdges", () => {
    const expected = referenceFixture.cases.TwoParallelEdges;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("", 30, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match ThreeParallelEdges", () => {
    const expected = referenceFixture.cases.ThreeParallelEdges;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 3; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label).toBeNull();
  });

  it("should match FiveDistinctNeighbors", () => {
    const expected = referenceFixture.cases.FiveDistinctNeighbors;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    g.Nodes.push(nA);
    for (let i = 2; i <= 6; i++) {
      const nb = new Node(i, 100, 100);
      g.Nodes.push(nb);
      g.connect(nA, nb);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match MixedParallelGlobalDensity", () => {
    const expected = referenceFixture.cases.MixedParallelGlobalDensity;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    g.Nodes.push(nA);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nB);
    for (let i = 0; i < 3; i++) {
      g.connect(nA, nB);
    }
    for (let i = 3; i <= 6; i++) {
      const nb = new Node(i, 100, 100);
      g.Nodes.push(nb);
      g.connect(nA, nb);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
  });

  it("should match LargeNodeEarlyReturn", () => {
    const expected = referenceFixture.cases.LargeNodeEarlyReturn;
    const g = new Graph();
    const nA = new Node(1, 121, 121);
    nA.FontSize = 16;
    nA.Label = new Label("", 40, 20);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match ExactMinLengthEquality", () => {
    const expected = referenceFixture.cases.ExactMinLengthEquality;
    const g = new Graph();
    const nA = new Node(1, 120, 120);
    nA.FontSize = 16;
    nA.Label = new Label("", 40, 20);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match OneAxisOnlyGrowth", () => {
    const expected = referenceFixture.cases.OneAxisOnlyGrowth;
    const g = new Graph();
    const nA = new Node(1, 200, 80);
    nA.FontSize = 16;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label).toBeNull();
  });

  it("should match AspectRatio1EdgeGrowth", () => {
    const expected = referenceFixture.cases.AspectRatio1EdgeGrowth;
    const g = new Graph();
    const nA = new Node(1, 60, 40);
    nA.SetShape("Circle");
    nA.FontSize = 16;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    for (let i = 0; i < 3; i++) {
      g.connect(nA, nB);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
  });

  it("should match FontSizeNullLabelPresent", () => {
    const expected = referenceFixture.cases.FontSizeNullLabelPresent;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = null;
    nA.Label = new Label("", 40, 20);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBeNull();
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match FontSizePresentLabelNull", () => {
    const expected = referenceFixture.cases.FontSizePresentLabelNull;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = null;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label).toBeNull();
  });

  it("should match ExactSupportedFontRatio", () => {
    const expected = referenceFixture.cases.ExactSupportedFontRatio;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
  });

  it("should match FontOvershootCorrection", () => {
    const expected = referenceFixture.cases.FontOvershootCorrection;
    const g = new Graph();
    const w = 600.0 / 7.0;
    const nA = new Node(1, w, w);
    nA.FontSize = 16;
    nA.Label = new Label("", 40, 20);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match NearestTieFontCase", () => {
    const expected = referenceFixture.cases.NearestTieFontCase;
    const g = new Graph();
    const w = 120.0 / 1.125;
    const nA = new Node(1, w, w);
    nA.FontSize = 16;
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
  });

  it("should match FractionalLabelRounding", () => {
    const expected = referenceFixture.cases.FractionalLabelRounding;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("", 10.2, 5.1);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match ZeroDimension", () => {
    const expected = referenceFixture.cases.ZeroDimension;
    const g = new Graph();
    const nA = new Node(1, 0, 0);
    nA.FontSize = 16;
    nA.Label = new Label("", 10, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match SingleSelfLoopOnly", () => {
    const expected = referenceFixture.cases.SingleSelfLoopOnly;
    const g = new Graph();
    const nA = new Node(1, 20, 20);
    nA.FontSize = 16;
    nA.Label = new Label("", 10, 10);
    g.Nodes.push(nA);
    g.connect(nA, nA);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match MultipleSelfLoopsOnly", () => {
    const expected = referenceFixture.cases.MultipleSelfLoopsOnly;
    const g = new Graph();
    const nA = new Node(1, 20, 20);
    nA.FontSize = 16;
    nA.Label = new Label("", 10, 10);
    g.Nodes.push(nA);
    for (let i = 0; i < 3; i++) {
      g.connect(nA, nA);
    }

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match SelfLoopPlusNormalEdge", () => {
    const expected = referenceFixture.cases.SelfLoopPlusNormalEdge;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("", 30, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nA);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.width);
    expect(nA.Height).toBe(expected.height);
    expect(nA.FontSize).toBe(expected.fontSize);
    expect(nA.Label.Width).toBe(expected.label.width);
    expect(nA.Label.Height).toBe(expected.label.height);
  });

  it("should match Idempotence", () => {
    const expected = referenceFixture.cases.Idempotence;
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("", 30, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(expected.firstPass.width);
    expect(nA.Height).toBe(expected.firstPass.height);
    expect(nA.FontSize).toBe(expected.firstPass.fontSize);
    expect(nA.Label.Width).toBe(expected.firstPass.label.width);
    expect(nA.Label.Height).toBe(expected.firstPass.label.height);

    prescale(g);

    expect(nA.Width).toBe(expected.secondPass.width);
    expect(nA.Height).toBe(expected.secondPass.height);
    expect(nA.FontSize).toBe(expected.secondPass.fontSize);
    expect(nA.Label.Width).toBe(expected.label ? expected.secondPass.label.width : expected.secondPass.label.width);
    expect(nA.Label.Height).toBe(expected.secondPass.label.height);
  });
});
