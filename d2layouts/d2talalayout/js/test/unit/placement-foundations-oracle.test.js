import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LayoutAxis,
  axisValid,
  axisIsHorizontal,
  oppositeAxis,
  axisForArrangement,
  TraversalDirection,
  directionValid,
  directionIsForward,
  oppositeDirection,
} from '../../src/placement/axis.js';
import {
  validateCellSize,
  validateGridAlignment,
  validatePlacedNodes,
} from '../../src/placement/validation.js';
import { initializeByGraphDistance } from '../../src/placement/stress-initialize.js';
import { normalize, pad } from '../../src/placement/stage-geometry.js';
import { clusterExternalConnectedNodes } from '../../src/placement/cluster-connections.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Point } from '../../src/geometry/point.js';
import { WorkCanceledError } from '../../src/limits/work-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(
  __dirname,
  '..',
  'fixtures',
  'go-placement-foundations-reference.json'
);
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

class CountingContext {
  constructor(cancelAt = 0) {
    this.cancelAt = cancelAt;
    this.checks = 0;
  }

  isCancelled() {
    this.checks++;
    if (this.cancelAt > 0 && this.checks >= this.cancelAt) {
      return true;
    }
    return false;
  }
}

function stressTestGraph(n, connected) {
  const g = new Graph();
  for (let i = 0; i < n; i++) {
    g.addNode(new Node(BigInt(i), 100, 50));
  }
  if (connected) {
    for (let i = 1; i < n; i++) {
      const e = new Edge(g.Nodes[i - 1], g.Nodes[i]);
      g.AddEdge(e);
      g.Nodes[i - 1].Edges.push(e);
      g.Nodes[i].Edges.push(e);
    }
  }
  return g;
}

describe('Placement Foundations Go Oracle Replay', () => {
  describe('Axis primitives', () => {
    for (const [name, exp] of Object.entries(reference.axis)) {
      it(name, () => {
        const val = Number(name.split('_')[1]);
        assert.equal(axisValid(val), exp.valid, `${name}: valid mismatch`);
        assert.equal(axisIsHorizontal(val), exp.isHorizontal, `${name}: isHorizontal mismatch`);
        assert.equal(oppositeAxis(val), exp.opposite, `${name}: opposite mismatch`);
      });
    }

    for (const [name, exp] of Object.entries(reference.axisArrangement)) {
      it(`arrangement_${name}`, () => {
        const arr = name === '<empty>' ? '' : name;
        assert.equal(axisForArrangement(arr), exp, `arrangement ${name} mismatch`);
      });
    }
  });

  describe('Direction primitives', () => {
    for (const [name, exp] of Object.entries(reference.direction)) {
      it(name, () => {
        const val = Number(name.split('_')[1]);
        assert.equal(directionValid(val), exp.valid, `${name}: valid mismatch`);
        assert.equal(directionIsForward(val), exp.isForward, `${name}: isForward mismatch`);
        assert.equal(oppositeDirection(val), exp.opposite, `${name}: opposite mismatch`);
      });
    }
  });

  describe('Fixed nodes graph access', () => {
    for (const [name, exp] of Object.entries(reference.fixedNodes)) {
      it(name, () => {
        let g;
        switch (name) {
          case 'empty_graph':
            g = new Graph();
            break;
          case 'none_fixed':
            g = new Graph();
            g.addNode(new Node(1n, 10, 10));
            g.addNode(new Node(2n, 10, 10));
            break;
          case 'mixed_fixed': {
            g = new Graph();
            const n1 = new Node(1n, 10, 10);
            const n2 = new Node(2n, 10, 10);
            const n3 = new Node(3n, 10, 10);
            n2.FixedTopLeft = new Point(50, 50);
            g.addNode(n1);
            g.addNode(n2);
            g.addNode(n3);
            break;
          }
          case 'all_fixed_order': {
            g = new Graph();
            const n3 = new Node(3n, 10, 10);
            n3.FixedTopLeft = new Point(10, 10);
            const n1 = new Node(1n, 10, 10);
            n1.FixedTopLeft = new Point(20, 20);
            g.addNode(n3);
            g.addNode(n1);
            break;
          }
          case 'distinct_same_id': {
            g = new Graph();
            const n1 = new Node(5n, 10, 10);
            const n2 = new Node(5n, 10, 10);
            n1.FixedTopLeft = new Point(10, 10);
            n2.FixedTopLeft = new Point(20, 20);
            g.addNode(n1);
            g.addNode(n2);
            break;
          }
          case 'null_node':
            g = new Graph();
            g.Nodes.push(null);
            break;
        }

        if (!exp.success) {
          assert.throws(() => {
            g.hasFixedNode();
          }, TypeError);
          return;
        }

        assert.equal(g.hasFixedNode(), exp.hasFixed);
        assert.equal(g.HasFixedNode(), exp.hasFixed);
        const fixed = g.fixedNodes();
        const fixedAliases = g.FixedNodes();
        assert.deepEqual(fixed, fixedAliases);
        const fixedIds = fixed.length > 0 ? fixed.map((n) => String(n.ID)) : null;
        assert.deepEqual(fixedIds, exp.fixed);
      });
    }
  });

  describe('validateCellSize', () => {
    for (const [name, exp] of Object.entries(reference.validateCellSize)) {
      it(name, () => {
        const g = new Graph();
        switch (name) {
          case 'valid_1': g.CellSize = 1; break;
          case 'valid_2': g.CellSize = 2; break;
          case 'valid_10': g.CellSize = 10; break;
          case 'valid_1000': g.CellSize = 1000; break;
          case 'invalid_0': g.CellSize = 0; break;
          case 'invalid_neg1': g.CellSize = -1; break;
          case 'invalid_half': g.CellSize = 0.5; break;
          case 'invalid_10_5': g.CellSize = 10.5; break;
          case 'invalid_nan': g.CellSize = NaN; break;
          case 'invalid_pos_inf': g.CellSize = Infinity; break;
          case 'invalid_neg_inf': g.CellSize = -Infinity; break;
        }

        if (exp.success) {
          assert.doesNotThrow(() => validateCellSize(g));
        } else {
          assert.throws(
            () => validateCellSize(g),
            (err) => {
              assert.equal(err.message, exp.error);
              return true;
            }
          );
        }
      });
    }
  });

  describe('validateGridAlignment', () => {
    for (const [name, exp] of Object.entries(reference.validateGridAlignment)) {
      it(name, () => {
        const g = new Graph();
        switch (name) {
          case 'invalid_cell_size_wins': {
            g.CellSize = 0;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(20, 30);
            g.addNode(n);
            break;
          }
          case 'valid_positive_aligned': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(20, 30);
            g.addNode(n);
            break;
          }
          case 'valid_negative_aligned': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(-20, -30);
            g.addNode(n);
            break;
          }
          case 'misaligned_x': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(21, 30);
            g.addNode(n);
            break;
          }
          case 'misaligned_y': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(20, 35);
            g.addNode(n);
            break;
          }
          case 'misaligned_fractional': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.TopLeft = new Point(20.5, 30);
            g.addNode(n);
            break;
          }
          case 'fixed_node_exempt_unpositioned': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.FixedTopLeft = new Point(23, 37);
            g.addNode(n);
            break;
          }
          case 'fixed_node_exempt_misaligned': {
            g.CellSize = 10;
            const n = new Node(1n, 10, 10);
            n.FixedTopLeft = new Point(23, 37);
            n.TopLeft = new Point(23, 37);
            g.addNode(n);
            break;
          }
          case 'nonfixed_unpositioned': {
            g.CellSize = 10;
            const n = new Node(42n, 10, 10);
            g.addNode(n);
            break;
          }
        }

        if (exp.success) {
          assert.doesNotThrow(() => validateGridAlignment(g));
        } else {
          assert.throws(
            () => validateGridAlignment(g),
            (err) => {
              assert.equal(err.message, exp.error);
              return true;
            }
          );
        }
      });
    }
  });

  describe('validatePlacedNodes', () => {
    for (const [name, exp] of Object.entries(reference.validatePlacedNodes)) {
      it(name, () => {
        let root = null;
        let nodes = [];
        switch (name) {
          case 'empty_nodes':
            break;
          case 'all_placed': {
            root = new Node(100n, 10, 10);
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(0, 0);
            const n2 = new Node(2n, 10, 10);
            n2.TopLeft = new Point(10, 10);
            nodes = [n1, n2];
            break;
          }
          case 'unplaced_with_root': {
            root = new Node(100n, 10, 10);
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(0, 0);
            const n2 = new Node(2n, 10, 10);
            nodes = [n1, n2];
            break;
          }
          case 'unplaced_with_nil_root': {
            const n1 = new Node(7n, 10, 10);
            nodes = [n1];
            break;
          }
          case 'first_unplaced_wins': {
            root = new Node(10n, 10, 10);
            const n1 = new Node(1n, 10, 10);
            const n2 = new Node(2n, 10, 10);
            nodes = [n1, n2];
            break;
          }
          case 'nil_node_in_slice': {
            root = new Node(10n, 10, 10);
            nodes = [null];
            break;
          }
        }

        if (exp.panic) {
          assert.throws(() => validatePlacedNodes(root, nodes), TypeError);
          return;
        }

        if (exp.success) {
          assert.doesNotThrow(() => validatePlacedNodes(root, nodes));
        } else {
          assert.throws(
            () => validatePlacedNodes(root, nodes),
            (err) => {
              assert.equal(err.message, exp.error);
              return true;
            }
          );
        }
      });
    }
  });

  describe('initializeByGraphDistance', () => {
    for (const [name, exp] of Object.entries(reference.graphDistance)) {
      it(name, () => {
        let g;
        let cancelAt = 0;
        switch (name) {
          case 'boundary_3_nodes':
            g = stressTestGraph(3, true);
            break;
          case 'boundary_4_nodes':
            g = stressTestGraph(4, true);
            break;
          case 'boundary_64_nodes':
            g = stressTestGraph(64, true);
            break;
          case 'boundary_65_nodes':
            g = stressTestGraph(65, true);
            break;
          case 'fixed_node_fallback':
            g = stressTestGraph(8, true);
            g.Nodes[2].FixedTopLeft = new Point(20, 30);
            break;
          case 'disconnected_fallback':
            g = stressTestGraph(8, false);
            break;
          case '12_node_path':
            g = stressTestGraph(12, true);
            break;
          case '5_node_star': {
            g = new Graph();
            for (let i = 0; i < 5; i++) {
              g.addNode(new Node(BigInt(i), 100, 50));
            }
            for (let i = 1; i < 5; i++) {
              const e = new Edge(g.Nodes[0], g.Nodes[i]);
              g.AddEdge(e);
              g.Nodes[0].Edges.push(e);
              g.Nodes[i].Edges.push(e);
            }
            break;
          }
          case '6_node_cycle': {
            g = new Graph();
            for (let i = 0; i < 6; i++) {
              g.addNode(new Node(BigInt(i), 100, 50));
            }
            for (let i = 0; i < 6; i++) {
              const e = new Edge(g.Nodes[i], g.Nodes[(i + 1) % 6]);
              g.AddEdge(e);
              g.Nodes[i].Edges.push(e);
              g.Nodes[(i + 1) % 6].Edges.push(e);
            }
            break;
          }
          case 'cancellation_at_floyd':
            g = stressTestGraph(6, true);
            cancelAt = 2;
            break;
          case 'cancellation_at_relaxation':
            g = stressTestGraph(6, true);
            cancelAt = 8;
            break;
          case 'cancellation_at_assignment':
            g = stressTestGraph(6, true);
            cancelAt = 56;
            break;
          case 'cancellation_at_final':
            g = stressTestGraph(6, true);
            cancelAt = 62;
            break;
        }

        const ctx = new CountingContext(cancelAt);

        if (!exp.success) {
          assert.throws(
            () => initializeByGraphDistance(ctx, g),
            (err) => err instanceof WorkCanceledError
          );
          return;
        }

        const applied = initializeByGraphDistance(ctx, g);
        assert.equal(applied, exp.applied, `${name}: applied mismatch`);

        if (exp.applied && exp.positions) {
          for (const node of g.Nodes) {
            const expPos = exp.positions[String(node.ID)];
            assert.ok(expPos, `Missing expected pos for node ${node.ID}`);
            assert.equal(node.TopLeft.X, expPos.x, `node ${node.ID} X mismatch`);
            assert.equal(node.TopLeft.Y, expPos.y, `node ${node.ID} Y mismatch`);
          }
        }
      });
    }
  });

  describe('Normalize', () => {
    for (const [name, exp] of Object.entries(reference.normalize)) {
      it(name, () => {
        let g;
        switch (name) {
          case 'node_minima': {
            g = new Graph();
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(20, 50);
            const n2 = new Node(2n, 10, 10);
            n2.TopLeft = new Point(40, 30);
            g.addNode(n1);
            g.addNode(n2);
            break;
          }
          case 'edge_minima_dominates': {
            g = new Graph();
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(20, 50);
            g.addNode(n1);
            const e = new Edge(n1, n1);
            e.Points = [new Point(5.2, 8.9), new Point(25, 60)];
            g.AddEdge(e);
            break;
          }
          case 'fixed_node_forced_1000': {
            g = new Graph();
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(1500, 1200);
            n1.FixedTopLeft = new Point(1500, 1200);
            g.addNode(n1);
            const e = new Edge(n1, n1);
            e.Points = [new Point(1500, 1200)];
            g.AddEdge(e);
            break;
          }
          case 'empty_graph':
            g = new Graph();
            break;
        }

        normalize(g);

        if (exp.nodes) {
          for (const node of g.Nodes) {
            const expPos = exp.nodes[String(node.ID)];
            assert.ok(expPos);
            assert.equal(node.TopLeft.X, expPos.x);
            assert.equal(node.TopLeft.Y, expPos.y);
          }
        }

        if (exp.edgePoints) {
          for (let i = 0; i < g.Edges.length; i++) {
            const edge = g.Edges[i];
            const expPoints = exp.edgePoints[i];
            assert.equal(edge.Points.length, expPoints.length);
            for (let j = 0; j < edge.Points.length; j++) {
              assert.equal(edge.Points[j].X, expPoints[j].x);
              assert.equal(edge.Points[j].Y, expPoints[j].y);
            }
          }
        }
      });
    }
  });

  describe('Pad', () => {
    for (const [name, exp] of Object.entries(reference.pad)) {
      it(name, () => {
        let g;
        switch (name) {
          case 'pad_nodes_only': {
            g = new Graph();
            const n1 = new Node(1n, 10, 10);
            n1.TopLeft = new Point(20, 50);
            g.addNode(n1);
            const e = new Edge(n1, n1);
            e.Points = [new Point(100, 200)];
            g.AddEdge(e);
            break;
          }
          case 'pad_empty':
            g = new Graph();
            break;
        }

        pad(g);

        if (exp.nodes) {
          for (const node of g.Nodes) {
            const expPos = exp.nodes[String(node.ID)];
            assert.ok(expPos);
            assert.equal(node.TopLeft.X, expPos.x);
            assert.equal(node.TopLeft.Y, expPos.y);
          }
        }

        if (exp.edgePoints) {
          for (let i = 0; i < g.Edges.length; i++) {
            const edge = g.Edges[i];
            const expPoints = exp.edgePoints[i];
            assert.equal(edge.Points.length, expPoints.length);
            for (let j = 0; j < edge.Points.length; j++) {
              assert.equal(edge.Points[j].X, expPoints[j].x);
              assert.equal(edge.Points[j].Y, expPoints[j].y);
            }
          }
        }
      });
    }
  });

  describe('clusterExternalConnectedNodes', () => {
    for (const [name, exp] of Object.entries(reference.clusterExternalConnection)) {
      it(name, () => {
        let cluster;
        switch (name) {
          case 'basic_both_cases': {
            const g = new Graph();
            const cNode = new Node(1n, 10, 10);
            g.addNode(cNode);
            cluster = new Cluster(cNode);
            cluster.Nodes = [cNode];

            const ext1 = new Node(101n, 10, 10);
            ext1.TopLeft = new Point(0, 0);
            g.addNode(ext1);

            const ext2 = new Node(102n, 10, 10);
            ext2.TopLeft = new Point(10, 10);
            g.addNode(ext2);

            const dummy = new Node(999n, 10, 10);
            cluster.EdgeAbductions = [
              new EdgeAbduction({ OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: ext1 }),
              new EdgeAbduction({ OriginallyFrom: dummy, OriginallyTo: null, CurrentTo: ext2 }),
            ];
            break;
          }
          case 'deduplication_first_seen_order': {
            const g = new Graph();
            const cNode = new Node(1n, 10, 10);
            g.addNode(cNode);
            cluster = new Cluster(cNode);
            cluster.Nodes = [cNode];

            const ext1 = new Node(101n, 10, 10);
            ext1.TopLeft = new Point(0, 0);
            g.addNode(ext1);

            const ext2 = new Node(102n, 10, 10);
            ext2.TopLeft = new Point(10, 10);
            g.addNode(ext2);

            const dummy = new Node(999n, 10, 10);
            cluster.EdgeAbductions = [
              new EdgeAbduction({ OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: ext2 }),
              new EdgeAbduction({ OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: ext1 }),
              new EdgeAbduction({ OriginallyFrom: dummy, OriginallyTo: null, CurrentTo: ext2 }),
            ];
            break;
          }
          case 'wrong_graph_ignored': {
            const g1 = new Graph();
            const g2 = new Graph();
            const cNode = new Node(1n, 10, 10);
            g1.addNode(cNode);
            cluster = new Cluster(cNode);
            cluster.Nodes = [cNode];

            const extWrong = new Node(101n, 10, 10);
            extWrong.TopLeft = new Point(0, 0);
            g2.addNode(extWrong);

            const dummy = new Node(999n, 10, 10);
            cluster.EdgeAbductions = [
              new EdgeAbduction({ OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: extWrong }),
            ];
            break;
          }
          case 'unpositioned_ignored': {
            const g = new Graph();
            const cNode = new Node(1n, 10, 10);
            g.addNode(cNode);
            cluster = new Cluster(cNode);
            cluster.Nodes = [cNode];

            const extUnpos = new Node(101n, 10, 10);
            g.addNode(extUnpos);

            const dummy = new Node(999n, 10, 10);
            cluster.EdgeAbductions = [
              new EdgeAbduction({ OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: extUnpos }),
            ];
            break;
          }
        }

        const nodes = clusterExternalConnectedNodes(cluster);
        const ids = nodes.length > 0 ? nodes.map((n) => String(n.ID)) : null;
        assert.deepEqual(ids, exp.external);
      });
    }
  });
});
