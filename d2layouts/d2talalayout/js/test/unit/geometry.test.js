import { describe, test, expect, beforeAll } from 'bun:test';
import * as geo from '../../src/geometry/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Geometry Parity', () => {
  let oracleData;

  beforeAll(() => {
    const p = path.resolve(__dirname, '../fixtures/go-geometry-reference.json');
    const content = fs.readFileSync(p, 'utf-8');
    oracleData = JSON.parse(content);
  });

  const decodeFloat = (v) => {
    if (typeof v === 'object') {
      if (v.kind === 'nan') return NaN;
      if (v.kind === 'posInf') return Infinity;
      if (v.kind === 'negInf') return -Infinity;
      if (v.kind === 'negZero') return -0;
      return v.value;
    }
    return v;
  };

  test('Math & Geometry Parity', () => {
    const cases = oracleData.random.cases;
    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i];
      const inp = tc.input;

      // 1. Math functions
      expect(geo.euclideanDistance(inp.x1, inp.y1, inp.x2, inp.y2)).toBe(decodeFloat(tc.math_euclidean_distance));
      expect(geo.precisionCompare(inp.x1, inp.x2, Math.abs(inp.y1))).toBe(tc.math_precision_compare);
      
      const truncActual = geo.truncateDecimals(inp.x1);
      const truncExpected = decodeFloat(tc.math_truncate_decimals);
      if (Object.is(truncExpected, -0)) {
        expect(Object.is(truncActual, -0)).toBe(true);
      } else {
        expect(truncActual).toBe(truncExpected);
      }
      
      expect(geo.sign(inp.x1)).toBe(tc.math_sign);

      // 2. Vectors
      const v1 = new geo.Vector(inp.x1, inp.y1);
      const v2 = new geo.Vector(inp.x2, inp.y2);
      const vAdd = v1.add(v2);
      expect(vAdd.components[0]).toBe(decodeFloat(tc.vector_add[0]));
      expect(vAdd.components[1]).toBe(decodeFloat(tc.vector_add[1]));
      expect(v1.length()).toBe(decodeFloat(tc.vector_length));
      expect(v1.radians()).toBe(decodeFloat(tc.vector_radians));

      // 3. Points
      const p1 = new geo.Point(inp.x1, inp.y1);
      const p2 = new geo.Point(inp.x2, inp.y2);
      const p3 = new geo.Point(inp.x3, inp.y3);
      const p4 = new geo.Point(inp.x4, inp.y4);

      expect(p1.distanceToLine(p2, p3)).toBe(decodeFloat(tc.point_distance_to_line));
      
      const ip = geo.intersectionPoint(p1, p2, p3, p4);
      if (tc.point_intersection_point === null) {
        expect(ip).toBeNull();
      } else {
        expect(ip).not.toBeNull();
        expect(ip.X).toBe(decodeFloat(tc.point_intersection_point.x));
        expect(ip.Y).toBe(decodeFloat(tc.point_intersection_point.y));
      }

      const interp = p1.interpolate(p2, inp.randFloat);
      expect(interp.X).toBe(decodeFloat(tc.point_interpolate.x));
      expect(interp.Y).toBe(decodeFloat(tc.point_interpolate.y));

      const pc = p1.copy();
      pc.truncateFloat32();
      expect(pc.X).toBe(decodeFloat(tc.point_truncate_float32.x));
      expect(pc.Y).toBe(decodeFloat(tc.point_truncate_float32.y));

      expect(p1.compare(p2)).toBe(tc.point_compare);

      // 4. Segments
      const s1 = new geo.Segment(p1, p2);
      const s2 = new geo.Segment(p3, p4);
      const s3 = new geo.Segment(new geo.Point(inp.x1, inp.y1), new geo.Point(inp.x1, inp.y2));
      const s4 = new geo.Segment(new geo.Point(inp.x3, inp.y1), new geo.Point(inp.x3, inp.y3));
      const bounds = s3.getBounds([s4], Math.abs(inp.x4));
      expect(bounds[0]).toBe(decodeFloat(tc.segment_get_bounds.floor));
      expect(bounds[1]).toBe(decodeFloat(tc.segment_get_bounds.ceil));
      
      expect(s1.overlaps(s2, inp.randBool, Math.abs(inp.x1))).toBe(tc.segment_overlaps);

      // 5. Box
      const b1 = new geo.Box(p1, Math.abs(inp.x2), Math.abs(inp.y2));
      const b2 = new geo.Box(p3, Math.abs(inp.x4), Math.abs(inp.y4));

      expect(b1.contains(p4)).toBe(tc.box_contains);
      expect(b1.overlaps(b2)).toBe(tc.box_overlaps);
      expect(b1.intersects(s1, Math.abs(inp.x3))).toBe(tc.box_intersects);
    }
  });

  test('Special Numeric Cases', () => {
    const special = oracleData.special;
    for (const key of Object.keys(special)) {
      if (key.startsWith('trunc32_')) {
        // Find matching input value by finding index
        const idx = parseInt(key.split('_')[1], 10);
        const specialValues = [0.0, -0, Infinity, -Infinity, NaN, 0.1, 1.0/3.0];
        const v = specialValues[idx];
        const p = new geo.Point(v, v);
        p.truncateFloat32();
        
        const expectedX = decodeFloat(special[key][0]);
        const expectedY = decodeFloat(special[key][1]);
        
        if (Number.isNaN(expectedX)) {
          expect(Number.isNaN(p.X)).toBe(true);
        } else if (Object.is(expectedX, -0)) {
          expect(Object.is(p.X, -0)).toBe(true);
        } else {
          expect(p.X).toBe(expectedX);
        }
      } else if (key.startsWith('radians_')) {
        const idx = parseInt(key.split('_')[1], 10);
        const specialValues = [0.0, -0, Infinity, -Infinity, NaN, 0.1, 1.0/3.0];
        const v = specialValues[idx];
        const vec = new geo.Vector(v, 1.0);
        const rad = vec.radians();
        
        const expected = decodeFloat(special[key]);
        if (Number.isNaN(expected)) {
          expect(Number.isNaN(rad)).toBe(true);
        } else if (Object.is(expected, -0)) {
          expect(Object.is(rad, -0)).toBe(true);
        } else {
          expect(rad).toBe(expected);
        }
      }
    }
  });
});
