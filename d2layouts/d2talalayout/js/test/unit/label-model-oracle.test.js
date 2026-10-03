// Slice 46 — replay of internal/labeling/go_slice46_label_model_oracle_test.go.
// nodeshape label preferences, IsRectangular, table column ports and
// labeling.Initialize; every expected value comes from pinned Go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import {
  LabelTier,
  shapeLabelPositionPreferences,
  nodeIsRectangular,
} from '../../src/shape/label-preferences.js';
import { tableColumnPortValue, tablePortIndex } from '../../src/shape/table-ports.js';
import {
  EDGE_LABEL_PREFERENCE_ORDER,
  NODE_LABEL_POSITION_ORDER,
  CONTAINER_LABEL_POSITION_ORDER,
  initialize,
  compareLabelPositions,
  labelPositionPreferences,
  labelPositionPreferenceTranches,
} from '../../src/labeling/model.js';
import { loadFixture, num, enc, capture } from './slice46-fixtures.js';

const fixture = loadFixture('go-slice46-label-model-reference.json');
const MAX_POSITION = 36;

describe('label model Go oracle (slice 46)', () => {
  it('base position orders', () => {
    expect([...EDGE_LABEL_PREFERENCE_ORDER]).toEqual(fixture.edgeOrder);
    expect([...NODE_LABEL_POSITION_ORDER]).toEqual(fixture.nodeOrder);
    expect([...CONTAINER_LABEL_POSITION_ORDER]).toEqual(fixture.containerOrder);
  });

  for (const sc of fixture.shapes) {
    it(`shape ${JSON.stringify(sc.shape)} preferences, tranches and comparisons`, () => {
      const g = new Graph();
      const node = new Node(1n, 100, 60);
      node.setShape(sc.shape);
      g.addNewNodeToContainer(null, node);
      const container = new Node(2n, 300, 200);
      container.setShape(sc.shape);
      g.addNewNodeToContainer(null, container);
      g.addNewNodeToContainer(container, new Node(3n, 10, 10));

      const sorted = (set) => [...set].sort((a, b) => a - b);
      const compare = [];
      for (let first = 0; first <= MAX_POSITION; first++) {
        let row = '';
        for (let second = 0; second <= MAX_POSITION; second++) {
          const r = compareLabelPositions(node, first, second);
          row += r === 1 ? '+' : r === -1 ? '-' : r === 0 ? '0' : '?';
        }
        compare.push(row);
      }
      const got = {
        shape: sc.shape,
        isRectangular: nodeIsRectangular(node),
        tiers: [LabelTier.Good, LabelTier.OK, LabelTier.Unideal, LabelTier.Bad]
          .map((tier) => sorted(shapeLabelPositionPreferences(sc.shape, tier))),
        unknownTiers: [-1, 4, 100].map((tier) => sorted(shapeLabelPositionPreferences(sc.shape, tier))),
        preferences: labelPositionPreferences(node),
        containerPreferences: labelPositionPreferences(container),
        tranches: labelPositionPreferenceTranches(node),
        containerTranches: labelPositionPreferenceTranches(container),
        compare,
      };
      expect(got).toEqual(sc);
    });
  }

  it('table column ports and indices', () => {
    expect(fixture.tablePorts.length).toBeGreaterThan(1000);
    const got = fixture.tablePorts.map((probe) => {
      const node = new Node(1n, num(probe.w), num(probe.h));
      node.setShape(probe.shape);
      node.setNumColumns(probe.numColumns);
      node.TopLeft = new Point(num(probe.x), num(probe.y));
      const out = {
        ...probe,
        valueOk: false,
        value: [0, 0],
        valuePanic: '',
        indexOk: false,
        index: 0,
        indexPanic: '',
      };
      const v = capture(() => tableColumnPortValue(node, probe.orientation, probe.column));
      if (v.err != null) {
        out.valuePanic = v.err.message;
      } else {
        const [point, ok] = v.value;
        out.valueOk = ok;
        out.value = [enc(point.X), enc(point.Y)];
      }
      const ix = capture(() => tablePortIndex(node, probe.orientation, probe.column));
      if (ix.err != null) {
        out.indexPanic = ix.err.message;
      } else {
        [out.index, out.indexOk] = ix.value;
      }
      return out;
    });
    expect(got).toEqual(fixture.tablePorts);
  });

  for (const ic of fixture.inits) {
    it(`Initialize ${ic.name}`, () => {
      const g = new Graph();
      const nodes = new Map();
      for (const ns of ic.spec.nodes ?? []) {
        const n = new Node(BigInt(ns.id), 100, 50);
        n.setShape(ns.shape);
        if (ns.label != null) {
          n.Label = new Label('', ns.label.w, ns.label.h);
          n.Label.Position = ns.label.pos;
        }
        if (ns.icon != null) n.Icon = new Icon(ns.icon);
        g.addNewNodeToContainer(ns.container ? nodes.get(ns.container) : null, n);
        nodes.set(ns.id, n);
      }
      initialize(g);
      const states = g.Nodes.map((n) => ({
        id: Number(n.ID),
        hasLabel: n.Label != null,
        labelPos: n.Label != null ? n.Label.Position : 0,
        labelFixed: n.Label != null ? n.Label.PositionFixed() : false,
        hasIcon: n.Icon != null,
        iconPos: n.Icon != null ? n.Icon.Position : 0,
        iconFixed: n.Icon != null ? n.Icon.PositionFixed() : false,
        isContainer: n.IsContainer(),
      }));
      expect(states).toEqual(ic.states ?? []);
    });
  }

  it('orientation constants match Go geo.Orientation numbering used by the fixture', () => {
    // Fixture orientations are Go ints; the JS enum must share the numbering.
    expect([Orientation.TopLeft, Orientation.Left, Orientation.Right, Orientation.NONE]).toEqual([0, 7, 5, 8]);
  });
});
