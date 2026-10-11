import { describe, it, expect } from 'vitest';
import { buildSweepIndex, isSweepingOn, sweepInfo, zoneCandidates, zonesSweepingOn } from '../../src/server/domain/sweeping.js';
import type { SweepZone } from '../../src/shared/types.js';

const rows = [
  { wardSection: '3204', month: 10, days: [14, 15] },
  { wardSection: '3204', month: 11, days: [3] },
  { wardSection: '3205', month: 10, days: [20] },
];
// Two zones sharing a boundary at lon -87.68 (the middle of a street).
const zW: SweepZone = { wardSection: '3204', ward: '32', section: '04', bbox: [-87.69, 41.91, -87.68, 41.92], polygon: [[[[-87.69, 41.91], [-87.68, 41.91], [-87.68, 41.92], [-87.69, 41.92], [-87.69, 41.91]]]] };
const zE: SweepZone = { wardSection: '3205', ward: '32', section: '05', bbox: [-87.68, 41.91, -87.67, 41.92], polygon: [[[[-87.68, 41.91], [-87.67, 41.91], [-87.67, 41.92], [-87.68, 41.92], [-87.68, 41.91]]]] };

describe('sweeping', () => {
  const idx = buildSweepIndex(rows, 2026);
  it('expands dates', () => {
    expect(idx.get('3204')).toEqual(['2026-10-14', '2026-10-15', '2026-11-03']);
    expect(isSweepingOn(idx, '3204', '2026-10-15')).toBe(true);
    expect(isSweepingOn(idx, '3204', '2026-10-16')).toBe(false);
  });
  it('sweepInfo merges zones and reports season state', () => {
    const a = sweepInfo(idx, ['3204', '3205'], '2026-10-15', 2026);
    expect(a.status).toBe('active');
    expect(a.upcoming.map((u) => u.date)).toEqual(['2026-10-15', '2026-10-20', '2026-11-03']);
    expect(sweepInfo(idx, ['3204'], '2026-12-01', 2026)).toMatchObject({ status: 'over', upcoming: [] });
    expect(sweepInfo(idx, ['3204'], '2027-01-10', 2026).status).toBe('nodata');
    expect(sweepInfo(idx, ['9999'], '2026-10-01', 2026).status).toBe('nodata');
    expect(sweepInfo(new Map(), [], '2026-10-01', 2026).status).toBe('nodata');
  });
  it('boundary street returns both zones, containing zone first', () => {
    const c = zoneCandidates([zE, zW], [-87.6801, 41.915]);
    expect(c.map((z) => z.wardSection)).toEqual(['3204', '3205']);
    expect(zoneCandidates([zE, zW], [-87.685, 41.915]).map((z) => z.wardSection)).toEqual(['3204']);
  });
  it('zones sweeping on a date', () => {
    expect(zonesSweepingOn(idx, [zW, zE], '2026-10-20').map((z) => z.wardSection)).toEqual(['3205']);
  });
});
