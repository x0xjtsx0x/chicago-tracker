import type { LngLat, SweepInfo, SweepRow, SweepZone } from '../../shared/types.js';
import type { DataSnapshot } from '../data/cache.js';
import { bboxNear, distToMultiPolygonM } from './geo.js';

export type SweepIndex = Map<string, string[]>;
const p2 = (n: number) => String(n).padStart(2, '0');

export function buildSweepIndex(rows: SweepRow[], year: number): SweepIndex {
  const idx: SweepIndex = new Map();
  for (const r of rows) {
    const list = idx.get(r.wardSection) ?? [];
    for (const d of r.days) list.push(`${year}-${p2(r.month)}-${p2(d)}`);
    idx.set(r.wardSection, list);
  }
  for (const [k, v] of idx) idx.set(k, [...new Set(v)].sort());
  return idx;
}

const memo = new WeakMap<DataSnapshot, { year: number; idx: SweepIndex }>();
export function sweepIndexFor(snap: DataSnapshot, year: number): SweepIndex {
  const m = memo.get(snap);
  if (m && m.year === year) return m.idx;
  const idx = buildSweepIndex(snap.sweepSchedule, year);
  memo.set(snap, { year, idx });
  return idx;
}

export const isSweepingOn = (idx: SweepIndex, ws: string, date: string): boolean => idx.get(ws)?.includes(date) ?? false;

export function sweepInfo(idx: SweepIndex, zones: string[], today: string, year: number, n = 10): SweepInfo {
  const all = zones.flatMap((ws) => (idx.get(ws) ?? []).map((date) => ({ date, wardSection: ws })));
  if (!all.length || Number(today.slice(0, 4)) > year) return { status: 'nodata', zones, upcoming: [] };
  const upcoming = all.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.wardSection.localeCompare(b.wardSection));
  return { status: upcoming.length ? 'active' : 'over', zones, upcoming: upcoming.slice(0, n) };
}

export function zoneCandidates(zones: SweepZone[], p: LngLat, radiusM = 40): SweepZone[] {
  return zones
    .filter((z) => bboxNear(z.bbox, p, radiusM))
    .map((z) => ({ z, d: distToMultiPolygonM(p, z.polygon) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.z);
}

export const zonesSweepingOn = (idx: SweepIndex, zones: SweepZone[], date: string): SweepZone[] =>
  zones.filter((z) => isSweepingOn(idx, z.wardSection, date));
