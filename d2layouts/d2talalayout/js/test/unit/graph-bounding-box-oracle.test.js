import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { Edge, NO_ARROWHEAD } from '../../src/graph/edge.js';
import { Graph } from '../../src/graph/graph.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-graph-bounding-box-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

function parseCoord(val) {
  if (val === 'Infinity') return Infinity;
  if (val === '-Infinity') return -Infinity;
  if (val === 'NaN') return NaN;
  return val;
}

function verifyBounds(actualTL, actualBR, expectedScenario) {
  if (!expectedScenario.success) {
    assert.fail('Expected scenario to fail with panic');
  }
  if (expectedScenario.tl == null) {
    assert.equal(actualTL, null);
    assert.equal(actualBR, null);
    return;
  }
  assert.ok(actualTL != null, 'actualTL must not be null');
  assert.ok(actualBR != null, 'actualBR must not be null');

  const expTLX = parseCoord(expectedScenario.tl.x);
  const expTLY = parseCoord(expectedScenario.tl.y);
  const expBRX = parseCoord(expectedScenario.br.x);
  const expBRY = parseCoord(expectedScenario.br.y);

  assert.equal(actualTL.X, expTLX, 'TL.X mismatch');
  assert.equal(actualTL.Y, expTLY, 'TL.Y mismatch');
  assert.equal(actualBR.X, expBRX, 'BR.X mismatch');
  assert.equal(actualBR.Y, expBRY, 'BR.Y mismatch');
}

describe('Graph and Edge BoundingBox Go Oracle Replay', () => {
  describe('Graph BoundingBox Scenarios (A - Q)', () => {
    it('A_empty_graph', () => {
      const g = new Graph();
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.A_empty_graph);
    });

    it('B_one_placed_node', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(10, 20);
      g.Nodes.push(n);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.B_one_placed_node);
    });

    it('C_multiple_placed_nodes', () => {
      const g = new Graph();
      const n1 = new Node(1n, 100, 50);
      n1.TopLeft = new Point(10, 20);
      const n2 = new Node(2n, 60, 40);
      n2.TopLeft = new Point(200, 150);
      g.Nodes.push(n1, n2);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.C_multiple_placed_nodes);
    });

    it('D_fractional_node_dimensions', () => {
      const g = new Graph();
      const n = new Node(1n, 100.4, 50.6);
      n.TopLeft = new Point(10.2, 20.7);
      g.Nodes.push(n);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.D_fractional_node_dimensions);
    });

    it('E_negative_coordinates', () => {
      const g = new Graph();
      const n1 = new Node(1n, 50, 50);
      n1.TopLeft = new Point(-100, -80);
      const n2 = new Node(2n, 50, 50);
      n2.TopLeft = new Point(10, 10);
      g.Nodes.push(n1, n2);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.E_negative_coordinates);
    });

    it('F_fixed_origin_adjustment', () => {
      const g = new Graph();
      const root = new Node(0n, 500, 500);
      root.TopLeft = new Point(0, 0);
      const n1 = new Node(1n, 100, 100);
      n1.TopLeft = new Point(50, 50);
      n1.FixedTopLeft = new Point(25, 30);
      n1.Container = root;
      g.Containers.set(root, [n1]);
      g.Nodes.push(n1);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.F_fixed_origin_adjustment);
    });

    it('G_one_unplaced_node', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      g.Nodes.push(n);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.G_one_unplaced_node);
    });

    it('H_placed_plus_unplaced_node', () => {
      const g = new Graph();
      const n1 = new Node(1n, 100, 50);
      n1.TopLeft = new Point(10, 20);
      const n2 = new Node(2n, 60, 40);
      g.Nodes.push(n1, n2);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.H_placed_plus_unplaced_node);
    });

    it('I_no_nodes_finite_edge', () => {
      const g = new Graph();
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 100)];
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.I_no_nodes_finite_edge);
    });

    it('J_node_edge_no_points', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(10, 20);
      g.Nodes.push(n);
      const e = new Edge(n, n);
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.J_node_edge_no_points);
    });

    it('K_edge_extends_left_top', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(100, 100);
      g.Nodes.push(n);
      const e = new Edge(n, n);
      e.Points = [new Point(50, 40), new Point(100, 100)];
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.K_edge_extends_left_top);
    });

    it('L_edge_extends_right_bottom', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(100, 100);
      g.Nodes.push(n);
      const e = new Edge(n, n);
      e.Points = [new Point(100, 100), new Point(350, 400)];
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.L_edge_extends_right_bottom);
    });

    it('M_fractional_edge_points_rounding', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(0, 0);
      g.Nodes.push(n);
      const e = new Edge(n, n);
      e.Points = [new Point(-10.4, -10.6), new Point(150.4, 150.6)];
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.M_fractional_edge_points_rounding);
    });

    it('N_negative_half_edge_point_rounding', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(0, 0);
      g.Nodes.push(n);
      const e = new Edge(n, n);
      e.Points = [new Point(-0.5, -1.5), new Point(100, 50)];
      g.Edges.push(e);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.N_negative_half_edge_point_rounding);
    });

    it('O_multiple_edges_order_independent', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(0, 0);
      g.Nodes.push(n);
      const e1 = new Edge(n, n);
      e1.Points = [new Point(20, 20), new Point(150, 80)];
      const e2 = new Edge(n, n);
      e2.Points = [new Point(-50, -30), new Point(200, 300)];
      g.Edges.push(e1, e2);
      const [tl, br] = g.BoundingBox();
      verifyBounds(tl, br, reference.graphScenarios.O_multiple_edges_order_independent);
    });

    it('P_null_edge_panic', () => {
      const g = new Graph();
      const n = new Node(1n, 100, 50);
      n.TopLeft = new Point(0, 0);
      g.Nodes.push(n);
      g.Edges.push(null);
      assert.throws(() => {
        g.BoundingBox();
      });
    });

    it('Q_null_node_panic', () => {
      const g = new Graph();
      g.Nodes.push(null);
      assert.throws(() => {
        g.BoundingBox();
      });
    });
  });

  describe('Edge BoundingBox Scenarios (R - BD)', () => {
    it('R_edge_zero_points', () => {
      const e = new Edge(null, null);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.R_edge_zero_points);
    });

    it('S_edge_one_point', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(42, 99)];
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.S_edge_one_point);
    });

    it('T_edge_two_point_route', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(10, 20), new Point(100, 200)];
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.T_edge_two_point_route);
    });

    it('U_edge_multi_segment_route', () => {
      const e = new Edge(null, null);
      e.Points = [
        new Point(10, 10),
        new Point(50, 10),
        new Point(50, 80),
        new Point(120, 80),
      ];
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.U_edge_multi_segment_route);
    });

    it('V_raw_fractional_point_rounding', () => {
      const e = new Edge(null, null);
      e.Points = [
        new Point(0.4, 0.6),
        new Point(99.5, 99.4),
      ];
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.V_raw_fractional_point_rounding);
    });

    it('W_main_label_unset', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.Label = new Label('', 200, 100);
      e.Label.Position = LabelPosition.Unset;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.W_main_label_unset);
    });

    it('X_main_label_InsideMiddleLeft', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.InsideMiddleLeft;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.X_main_label_InsideMiddleLeft);
    });

    it('Y_main_label_InsideMiddleCenter', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.InsideMiddleCenter;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.Y_main_label_InsideMiddleCenter);
    });

    it('Z_main_label_InsideMiddleRight', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.InsideMiddleRight;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.Z_main_label_InsideMiddleRight);
    });

    it('AA_main_label_OutsideTopLeft', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideTopLeft;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AA_main_label_OutsideTopLeft);
    });

    it('AB_main_label_OutsideTopCenter', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideTopCenter;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AB_main_label_OutsideTopCenter);
    });

    it('AC_main_label_OutsideTopRight', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideTopRight;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AC_main_label_OutsideTopRight);
    });

    it('AD_main_label_OutsideBottomLeft', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideBottomLeft;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AD_main_label_OutsideBottomLeft);
    });

    it('AE_main_label_OutsideBottomCenter', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideBottomCenter;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AE_main_label_OutsideBottomCenter);
    });

    it('AF_main_label_OutsideBottomRight', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.OutsideBottomRight;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AF_main_label_OutsideBottomRight);
    });

    it('AG_main_label_UnlockedTop', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 0.3;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedTop;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AG_main_label_UnlockedTop);
    });

    it('AH_main_label_UnlockedMiddle', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 0.3;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedMiddle;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AH_main_label_UnlockedMiddle);
    });

    it('AI_main_label_UnlockedBottom', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 0.3;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedBottom;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AI_main_label_UnlockedBottom);
    });

    it('AJ_non_edge_label_position', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.InsideTopLeft;
      assert.throws(() => {
        e.BoundingBox();
      });
    });

    it('AK_label_percentage_zero', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 0.0;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedMiddle;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AK_label_percentage_zero);
    });

    it('AL_label_percentage_half', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 0.5;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedMiddle;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AL_label_percentage_half);
    });

    it('AM_label_percentage_extrapolation_positive', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = 1.5;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedMiddle;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AM_label_percentage_extrapolation_positive);
    });

    it('AN_label_percentage_extrapolation_negative', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 100), new Point(100, 100)];
      e.LabelPercentage = -0.5;
      e.Label = new Label('', 40, 20);
      e.Label.Position = LabelPosition.UnlockedMiddle;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AN_label_percentage_extrapolation_negative);
    });

    it('AO_duplicate_zero_length_route_segment', () => {
      const e = new Edge(null, null);
      e.Points = [
        new Point(10, 10),
        new Point(10, 10),
        new Point(100, 10),
      ];
      e.Label = new Label('', 20, 10);
      e.Label.Position = LabelPosition.InsideMiddleCenter;
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AO_duplicate_zero_length_route_segment);
    });

    it('AP_source_label_no_arrowheads', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AP_source_label_no_arrowheads);
    });

    it('AQ_target_label_no_arrowheads', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.TargetArrowheadLabel = new Label('dst', 40, 14);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AQ_target_label_no_arrowheads);
    });

    it('AR_source_triangle_arrow', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AR_source_triangle_arrow);
    });

    it('AS_target_triangle_arrow', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.TargetArrowhead = 'triangle';
      e.TargetArrowheadLabel = new Label('dst', 40, 14);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AS_target_triangle_arrow);
    });

    it('AT_target_label_source_arrow_fallback', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'triangle';
      e.TargetArrowhead = NO_ARROWHEAD;
      e.TargetArrowheadLabel = new Label('dst', 40, 14);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AT_target_label_source_arrow_fallback);
    });

    it('AU_fractional_label_dimensions_truncation', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30.9, 12.9);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AU_fractional_label_dimensions_truncation);
    });

    it('AV_horizontal_route_arrowhead_label', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(50, 50), new Point(200, 50)];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AV_horizontal_route_arrowhead_label);
    });

    it('AW_vertical_route_arrowhead_label', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(50, 50), new Point(50, 250)];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AW_vertical_route_arrowhead_label);
    });

    it('AX_diagonal_route_arrowhead_label', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(50, 50), new Point(200, 200)];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AX_diagonal_route_arrowhead_label);
    });

    it('AY_multisegment_source_endpoint', () => {
      const e = new Edge(null, null);
      e.Points = [
        new Point(0, 0),
        new Point(0, 50),
        new Point(100, 50),
      ];
      e.SourceArrowhead = 'triangle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AY_multisegment_source_endpoint);
    });

    it('AZ_multisegment_target_endpoint', () => {
      const e = new Edge(null, null);
      e.Points = [
        new Point(0, 0),
        new Point(0, 50),
        new Point(100, 50),
      ];
      e.TargetArrowhead = 'triangle';
      e.TargetArrowheadLabel = new Label('dst', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.AZ_multisegment_target_endpoint);
    });

    it('BA_line_arrowhead', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'line';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.BA_line_arrowhead);
    });

    it('BB_diamond_arrowhead', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'diamond';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.BB_diamond_arrowhead);
    });

    it('BC_filled_circle_arrowhead', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'filled-circle';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.BC_filled_circle_arrowhead);
    });

    it('BD_crowfoot_arrowhead', () => {
      const e = new Edge(null, null);
      e.Points = [new Point(0, 0), new Point(100, 0)];
      e.SourceArrowhead = 'cf-many';
      e.SourceArrowheadLabel = new Label('src', 30, 12);
      const [tl, br] = e.BoundingBox();
      verifyBounds(tl, br, reference.edgeScenarios.BD_crowfoot_arrowhead);
    });
  });
});
