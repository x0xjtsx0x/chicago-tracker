import { describe, it, expect } from 'vitest';
import { distM, distToPathsM, nearestOnPaths, midpointOfPaths, inMultiPolygon, distToMultiPolygonM, bboxOf, bboxNear, centroidOfRing } from '../../src/server/domain/geo.js';
import type { LngLat, MultiPolygonCoords } from '../../src/shared/types.js';

const square: MultiPolygonCoords = [[[[-87.65, 41.88], [-87.64, 41.88], [-87.64, 41.89], [-87.65, 41.89], [-87.65, 41.88]]]];

describe('geo', () => {
  it('distM ~ 111 m per 0.001 deg latitude', () => {
    expect(distM([-87.65, 41.88], [-87.65, 41.881])).toBeGreaterThan(105);
    expect(distM([-87.65, 41.88], [-87.65, 41.881])).toBeLessThan(115);
  });
  it('distance to a line and nearest point', () => {
    const paths: LngLat[][] = [[[-87.65, 41.88], [-87.64, 41.88]]];
    const p: LngLat = [-87.645, 41.8805];
    expect(distToPathsM(p, paths)).toBeGreaterThan(50);
    expect(distToPathsM(p, paths)).toBeLessThan(60);
    const n = nearestOnPaths(p, paths);
    expect(n[1]).toBeCloseTo(41.88, 5);
    expect(n[0]).toBeCloseTo(-87.645, 4);
  });
  it('midpoint of the longest path', () => {
    expect(midpointOfPaths([[[-87.65, 41.88], [-87.64, 41.88]]])[0]).toBeCloseTo(-87.645, 4);
  });
  it('point in multipolygon and distance outside', () => {
    expect(inMultiPolygon([-87.645, 41.885], square)).toBe(true);
    expect(inMultiPolygon([-87.66, 41.885], square)).toBe(false);
    expect(distToMultiPolygonM([-87.645, 41.885], square)).toBe(0);
    const d = distToMultiPolygonM([-87.6503, 41.885], square);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(30);
  });
  it('bbox helpers', () => {
    const b = bboxOf([[-87.65, 41.88], [-87.64, 41.89]]);
    expect(b).toEqual([-87.65, 41.88, -87.64, 41.89]);
    expect(bboxNear(b, [-87.655, 41.885], 500)).toBe(true);
    expect(bboxNear(b, [-87.70, 41.885], 500)).toBe(false);
  });
  it('centroid of ring ignores closing point', () => {
    expect(centroidOfRing([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([1, 1]);
  });
});
