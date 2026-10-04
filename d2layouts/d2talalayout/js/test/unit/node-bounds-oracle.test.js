import { describe, expect, test } from 'bun:test';
import fixture from '../fixtures/go-node-bounds-reference.json';
import { Node } from '../../src/graph/node.js';
import { Graph } from '../../src/graph/graph.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { LabelPosition, getPointOnBox } from '../../src/graph/label-position.js';
import {
  nodesBoundingBox,
  nodesBounds,
  nodesFixedOrigin,
  nodesFixedBounds,
  FixedBoundingBox,
  nodesLeftmost,
  nodesTopmost,
  nodesRightmost,
  nodesBottommost,
} from '../../src/graph/node-bounds.js';

function parseDTOValue(v) {
  if (v === "+Inf") return Infinity;
  if (v === "-Inf") return -Infinity;
  if (v === "NaN") return NaN;
  if (v === "-0") return -0;
  return v;
}

function parseDTOPoint(dto) {
  if (!dto) return null;
  return new Point(parseDTOValue(dto.x), parseDTOValue(dto.y));
}

describe('Slice 18 - Real-Go Node Bounds & Fixed-Origin Oracle Parity', () => {
  // 1. Fixture Contract Assertions (Section 33)
  describe('Fixture Contract Semantic Assertions', () => {
    test('empty_nodes: tl = (-Inf, -Inf), br = (+Inf, +Inf)', () => {
      const s = fixture.scenarios.empty_nodes;
      expect(s.topLeft.x).toBe('-Inf');
      expect(s.topLeft.y).toBe('-Inf');
      expect(s.bottomRight.x).toBe('+Inf');
      expect(s.bottomRight.y).toBe('+Inf');
    });

    test('modifier_3d_hexagon: dx = 15, dy = 7.5', () => {
      const s = fixture.scenarios.modifier_3d_hexagon;
      expect(s.modifierAdjustments.dx).toBe(15);
      expect(s.modifierAdjustments.dy).toBe(7.5);
    });

    test('modifier_3d_beats_multiple: dx = 15, dy = 15 for non-Hexagon', () => {
      const s = fixture.scenarios.modifier_3d_beats_multiple;
      expect(s.modifierAdjustments.dx).toBe(15);
      expect(s.modifierAdjustments.dy).toBe(15);
    });

    test('image_icon_excluded: matches raw box dimensions without icon expansion', () => {
      const s = fixture.scenarios.image_icon_excluded;
      expect(s.topLeft.x).toBe(50);
      expect(s.topLeft.y).toBe(50);
      expect(s.bottomRight.x).toBe(150); // 50 + 100
      expect(s.bottomRight.y).toBe(130); // 50 + 80
    });

    test('fixed_origin_first_wins: tl equals first eligible fixed origin', () => {
      const s = fixture.scenarios.fixed_origin_first_wins;
      // child1: tl = (100, 120), fixed = (10, 20) -> (90, 100)
      expect(s.topLeft.x).toBe(90);
      expect(s.topLeft.y).toBe(100);
    });

    test('partial_null_with_fixed_origin: tl is non-null Point, br is null', () => {
      const s = fixture.scenarios.partial_null_with_fixed_origin;
      expect(s.topLeft).not.toBeNull();
      expect(s.topLeft.x).toBe(75);
      expect(s.topLeft.y).toBe(165);
      expect(s.bottomRight).toBeNull();
    });

    test('nil_peer_top_left: fixture records true for leftmost/topmost, false for rightmost/bottommost', () => {
      const s = fixture.scenarios.nil_peer_top_left;
      expect(s.leftmost).toBe(true);
      expect(s.topmost).toBe(true);
      expect(s.rightmost).toBe(false);
      expect(s.bottommost).toBe(false);
    });
  });

  // 2. Oracle Replay Assertions (Section 32)
  describe('Go Oracle Scenario Replays in JS', () => {
    test('empty_nodes', () => {
      const [tl, br] = FixedBoundingBox([]);
      const ref = fixture.scenarios.empty_nodes;
      expect(tl.X).toBe(-Infinity);
      expect(tl.Y).toBe(-Infinity);
      expect(br.X).toBe(Infinity);
      expect(br.Y).toBe(Infinity);
    });

    test('simple_rounded_bounds', () => {
      const n = new Node(1, 30.4, 40.8);
      n.TopLeft = new Point(10.2, 20.3);
      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.simple_rounded_bounds;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('negative_half_rounding', () => {
      const n = new Node(1, 10, 10);
      n.TopLeft = new Point(-10.5, -20.5);
      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.negative_half_rounding;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fractional_dimensions', () => {
      const n1 = new Node(1, 45.75, 55.25);
      n1.TopLeft = new Point(12.35, 23.45);
      const n2 = new Node(2, 60.15, 70.85);
      n2.TopLeft = new Point(100.1, 150.9);
      const [tl, br] = FixedBoundingBox([n1, n2]);
      const ref = fixture.scenarios.fractional_dimensions;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('negative_dimensions', () => {
      const n = new Node(1, -15.5, -25.5);
      n.TopLeft = new Point(100, 200);
      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.negative_dimensions;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('loop_offsets', () => {
      const n = new Node(1, 50, 40);
      n.TopLeft = new Point(100, 200);
      n.LoopOffsets = new Map([
        [Orientation.Left, 12],
        [Orientation.Top, 14],
        [Orientation.Right, 16],
        [Orientation.Bottom, 18],
      ]);
      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.loop_offsets;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('modifier_3d_square', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 60);
      n.Is3D = true;
      n.SetShape("Square");
      const [dx, dy] = n.ModifierElementAdjustments();
      const ref = fixture.scenarios.modifier_3d_square;
      expect(dx).toBe(ref.modifierAdjustments.dx);
      expect(dy).toBe(ref.modifierAdjustments.dy);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('modifier_3d_hexagon', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 60);
      n.Is3D = true;
      n.SetShape("Hexagon");
      const [dx, dy] = n.ModifierElementAdjustments();
      const ref = fixture.scenarios.modifier_3d_hexagon;
      expect(dx).toBe(ref.modifierAdjustments.dx);
      expect(dy).toBe(ref.modifierAdjustments.dy);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('modifier_multiple', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 60);
      n.IsMultiple = true;
      const [dx, dy] = n.ModifierElementAdjustments();
      const ref = fixture.scenarios.modifier_multiple;
      expect(dx).toBe(ref.modifierAdjustments.dx);
      expect(dy).toBe(ref.modifierAdjustments.dy);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('modifier_3d_beats_multiple', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 60);
      n.Is3D = true;
      n.IsMultiple = true;
      n.SetShape("Square");
      const [dx, dy] = n.ModifierElementAdjustments();
      const ref = fixture.scenarios.modifier_3d_beats_multiple;
      expect(dx).toBe(ref.modifierAdjustments.dx);
      expect(dy).toBe(ref.modifierAdjustments.dy);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('modifier_plus_loop_offsets', () => {
      const n = new Node(1, 50.5, 20.5);
      n.TopLeft = new Point(100, 200);
      n.Is3D = true;
      n.LoopOffsets = new Map([
        [Orientation.Left, 3],
        [Orientation.Top, 4],
        [Orientation.Right, 5],
        [Orientation.Bottom, 6],
      ]);
      const [dx, dy] = n.ModifierElementAdjustments();
      const ref = fixture.scenarios.modifier_plus_loop_offsets;
      expect(dx).toBe(ref.modifierAdjustments.dx);
      expect(dy).toBe(ref.modifierAdjustments.dy);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('outside_label_boundary', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 50);
      n.Label = {
        Position: LabelPosition.OutsideTopLeft,
        Width: 40,
        Height: 20,
      };
      const labelTL = getPointOnBox(n.Label.Position, n.Box, 5, n.Label.Width, n.Label.Height);
      const ref = fixture.scenarios.outside_label_boundary;
      expect(labelTL.X).toBe(ref.labelTopLeft.x);
      expect(labelTL.Y).toBe(ref.labelTopLeft.y);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('outside_label_nonboundary', () => {
      const n1 = new Node(1, 100, 80);
      n1.TopLeft = new Point(50, 50);
      n1.Label = {
        Position: LabelPosition.OutsideTopLeft,
        Width: 40,
        Height: 20,
      };
      const n2 = new Node(2, 50, 50);
      n2.TopLeft = new Point(10, 10);

      const labelTL = getPointOnBox(n1.Label.Position, n1.Box, 5, n1.Label.Width, n1.Label.Height);
      const ref = fixture.scenarios.outside_label_nonboundary;
      expect(labelTL.X).toBe(ref.labelTopLeft.x);
      expect(labelTL.Y).toBe(ref.labelTopLeft.y);

      const [tl, br] = FixedBoundingBox([n1, n2]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('outside_icon', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 50);
      n.SetShape("Square");
      n.Icon = {
        Position: LabelPosition.OutsideRightTop,
      };
      const iconTL = getPointOnBox(n.Icon.Position, n.Box, 5, 64, 64);
      const ref = fixture.scenarios.outside_icon;
      expect(iconTL.X).toBe(ref.iconTopLeft.x);
      expect(iconTL.Y).toBe(ref.iconTopLeft.y);

      const [tl, br] = FixedBoundingBox([n]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('image_icon_excluded', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(50, 50);
      n.SetShape("Image");
      n.Icon = {
        Position: LabelPosition.OutsideRightTop,
      };
      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.image_icon_excluded;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('combined_label_modifier_loop', () => {
      const n1 = new Node(1, 80.5, 60.5);
      n1.TopLeft = new Point(100.25, 150.75);
      n1.Is3D = true;
      n1.LoopOffsets = new Map([
        [Orientation.Left, 8],
        [Orientation.Top, 10],
        [Orientation.Right, 12],
        [Orientation.Bottom, 14],
      ]);
      n1.Label = {
        Position: LabelPosition.OutsideTopRight,
        Width: 35,
        Height: 15,
      };
      const n2 = new Node(2, 50, 50);
      n2.TopLeft = new Point(50, 50);

      const labelTL = getPointOnBox(n1.Label.Position, n1.Box, 5, n1.Label.Width, n1.Label.Height);
      const ref = fixture.scenarios.combined_label_modifier_loop;
      expect(labelTL.X).toBe(ref.labelTopLeft.x);
      expect(labelTL.Y).toBe(ref.labelTopLeft.y);

      const [tl, br] = FixedBoundingBox([n1, n2]);
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fixed_origin_root', () => {
      const n = new Node(1, 100, 80);
      n.TopLeft = new Point(120, 150);
      n.FixedTopLeft = new Point(20, 50);

      const [tl, br] = FixedBoundingBox([n]);
      const ref = fixture.scenarios.fixed_origin_root;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fixed_origin_nested', () => {
      const g = new Graph();
      const container = g.AddNode(new Node(10, 300, 300));
      container.TopLeft = new Point(0, 0);
      g.AddNewNodeToContainer(null, container);

      const child = g.AddNode(new Node(1, 80, 60));
      child.TopLeft = new Point(100, 120);
      child.FixedTopLeft = new Point(15, 25);
      g.AddNewNodeToContainer(container, child);

      const [tl, br] = FixedBoundingBox([child]);
      const ref = fixture.scenarios.fixed_origin_nested;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fixed_origin_first_wins', () => {
      const g = new Graph();
      const container = g.AddNode(new Node(10, 400, 400));
      g.AddNewNodeToContainer(null, container);

      const child1 = g.AddNode(new Node(1, 80, 60));
      child1.TopLeft = new Point(100, 120);
      child1.FixedTopLeft = new Point(10, 20);
      g.AddNewNodeToContainer(container, child1);

      const child2 = g.AddNode(new Node(2, 80, 60));
      child2.TopLeft = new Point(200, 220);
      child2.FixedTopLeft = new Point(30, 40);
      g.AddNewNodeToContainer(container, child2);

      const [tl, br] = FixedBoundingBox([child1, child2]);
      const ref = fixture.scenarios.fixed_origin_first_wins;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fixed_origin_active_cluster', () => {
      const g = new Graph();
      const parentContainer = g.AddNode(new Node(100, 500, 500));
      g.AddNewNodeToContainer(null, parentContainer);

      const vessel = g.AddNode(new Node(10, 200, 200));
      vessel.TopLeft = new Point(50, 50);
      g.AddNewNodeToContainer(parentContainer, vessel);
      vessel.setClusterVessel(true);

      const member = new Node(1, 60, 40);
      member.TopLeft = new Point(70, 80);
      member.FixedTopLeft = new Point(10, 15);
      const dummyContainer = new Node(999, 100, 100);
      member.Container = dummyContainer;

      const cluster = {
        Vessel: vessel,
        Nodes: [member],
        Container: parentContainer,
        isActive() {
          return vessel.Graph != null;
        },
      };
      member.Cluster = cluster;
      g.Clusters.set(vessel, cluster);

      const [tl, br] = FixedBoundingBox([member]);
      const ref = fixture.scenarios.fixed_origin_active_cluster;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('fixed_origin_active_sequence', () => {
      const g = new Graph();
      const parentContainer = g.AddNode(new Node(200, 500, 500));
      g.AddNewNodeToContainer(null, parentContainer);

      const vessel = g.AddNode(new Node(20, 200, 200));
      vessel.TopLeft = new Point(40, 40);
      g.AddNewNodeToContainer(parentContainer, vessel);

      const step = new Node(1, 50, 30);
      step.TopLeft = new Point(60, 70);
      step.FixedTopLeft = new Point(5, 10);
      const dummyContainer = new Node(888, 100, 100);
      step.Container = dummyContainer;

      const seq = {
        Vessel: vessel,
        Nodes: [step],
        Container: parentContainer,
        isActive() {
          return vessel.Graph != null;
        },
      };
      step.Sequence = seq;
      g.Sequences.set(vessel, seq);

      const [tl, br] = FixedBoundingBox([step]);
      const ref = fixture.scenarios.fixed_origin_active_sequence;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('partial_null_with_fixed_origin', () => {
      const n1 = new Node(1, 100, 100);
      n1.TopLeft = null;
      const n2 = new Node(2, 50, 50);
      n2.TopLeft = new Point(100, 200);
      n2.FixedTopLeft = new Point(25, 35);

      const [tl, br] = FixedBoundingBox([n1, n2]);
      const ref = fixture.scenarios.partial_null_with_fixed_origin;
      expect(tl).not.toBeNull();
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br).toBeNull();
    });

    test('outside_label_bottom_right_boundary and nonboundary', () => {
      const nRB = new Node(1, 100, 100);
      nRB.TopLeft = new Point(50, 50);
      nRB.Label = {
        Position: LabelPosition.OutsideBottomRight,
        Width: 30,
        Height: 20,
      };

      const [tl1, br1] = FixedBoundingBox([nRB]);
      const ref1 = fixture.scenarios.outside_label_bottom_right_boundary;
      expect(tl1.X).toBe(ref1.topLeft.x);
      expect(tl1.Y).toBe(ref1.topLeft.y);
      expect(br1.X).toBe(ref1.bottomRight.x);
      expect(br1.Y).toBe(ref1.bottomRight.y);

      const peerRB = new Node(2, 200, 200);
      peerRB.TopLeft = new Point(100, 100);
      const [tl2, br2] = FixedBoundingBox([nRB, peerRB]);
      const ref2 = fixture.scenarios.outside_label_bottom_right_nonboundary;
      expect(tl2.X).toBe(ref2.topLeft.x);
      expect(tl2.Y).toBe(ref2.topLeft.y);
      expect(br2.X).toBe(ref2.bottomRight.x);
      expect(br2.Y).toBe(ref2.bottomRight.y);
    });

    test('tied_extremes', () => {
      const n1 = new Node(1, 50, 50);
      n1.TopLeft = new Point(10, 20);
      n1.Label = {
        Position: LabelPosition.OutsideLeftTop,
        Width: 20,
        Height: 10,
      };
      const n2 = new Node(2, 50, 50);
      n2.TopLeft = new Point(10, 100);

      const [tl, br] = FixedBoundingBox([n1, n2]);
      const ref = fixture.scenarios.tied_extremes;
      expect(tl.X).toBe(ref.topLeft.x);
      expect(tl.Y).toBe(ref.topLeft.y);
      expect(br.X).toBe(ref.bottomRight.x);
      expect(br.Y).toBe(ref.bottomRight.y);
    });

    test('nil_peer_top_left: extremal helpers skip peer with null TopLeft', () => {
      const ref = fixture.scenarios.nil_peer_top_left;
      expect(ref.leftmost).toBe(true);
      expect(ref.topmost).toBe(true);
      expect(ref.rightmost).toBe(false);
      expect(ref.bottommost).toBe(false);

      const target = new Node(1, 50, 50);
      target.TopLeft = new Point(30, 40);

      const nilPeer = new Node(2, 50, 50);
      nilPeer.TopLeft = null;

      const otherPeer = new Node(3, 50, 50);
      otherPeer.TopLeft = new Point(100, 100);

      const nodes = [target, nilPeer, otherPeer];

      expect(nodesLeftmost(nodes, target)).toBe(ref.leftmost);
      expect(nodesTopmost(nodes, target)).toBe(ref.topmost);
      expect(nodesRightmost(nodes, target)).toBe(ref.rightmost);
      expect(nodesBottommost(nodes, target)).toBe(ref.bottommost);
    });
  });
});
