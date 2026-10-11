import * as turf from '@turf/turf';
import type { BBox, LngLat, MultiPolygonCoords } from '../../shared/types.js';

const M = { units: 'meters' as const };

export const distM = (a: LngLat, b: LngLat): number => turf.distance(turf.point(a), turf.point(b), M);

export function distToPathsM(p: LngLat, paths: LngLat[][]): number {
  let best = Infinity;
  for (const path of paths) {
    if (path.length < 2) { if (path[0]) best = Math.min(best, distM(p, path[0])); continue; }
    best = Math.min(best, turf.pointToLineDistance(turf.point(p), turf.lineString(path), M));
  }
  return best;
}

export function nearestOnPaths(p: LngLat, paths: LngLat[][]): LngLat {
  const usable = paths.filter((x) => x.length >= 2);
  if (!usable.length) return paths[0]?.[0] ?? p;
  const n = turf.nearestPointOnLine(turf.multiLineString(usable), turf.point(p), M);
  return n.geometry.coordinates as LngLat;
}

export function midpointOfPaths(paths: LngLat[][]): LngLat {
  const usable = paths.filter((x) => x.length >= 2);
  if (!usable.length) return paths[0]?.[0] ?? [0, 0];
  const longest = usable.reduce((a, b) => (turf.length(turf.lineString(a)) >= turf.length(turf.lineString(b)) ? a : b));
  const line = turf.lineString(longest);
  return turf.along(line, turf.length(line) / 2).geometry.coordinates as LngLat;
}

export const inMultiPolygon = (p: LngLat, mp: MultiPolygonCoords): boolean =>
  turf.booleanPointInPolygon(turf.point(p), turf.multiPolygon(mp));

export function distToMultiPolygonM(p: LngLat, mp: MultiPolygonCoords): number {
  if (inMultiPolygon(p, mp)) return 0;
  let best = Infinity;
  for (const poly of mp) for (const ring of poly) if (ring.length >= 2) {
    best = Math.min(best, turf.pointToLineDistance(turf.point(p), turf.lineString(ring), M));
  }
  return best;
}

export function bboxOf(points: LngLat[]): BBox {
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

export function bboxNear(bb: BBox, p: LngLat, radiusM: number): boolean {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return p[0] >= bb[0] - dLon && p[0] <= bb[2] + dLon && p[1] >= bb[1] - dLat && p[1] <= bb[3] + dLat;
}

export function centroidOfRing(ring: LngLat[]): LngLat {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const sx = pts.reduce((s, q) => s + q[0], 0);
  const sy = pts.reduce((s, q) => s + q[1], 0);
  return [sx / pts.length, sy / pts.length];
}
