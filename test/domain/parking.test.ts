import { describe, it, expect } from 'vitest';
import { buildParking, sundayReason } from '../../src/server/domain/parking.js';
import { buildSweepIndex } from '../../src/server/domain/sweeping.js';
import { loadConfig } from '../../src/server/config.js';
import type { DataSnapshot } from '../../src/server/data/cache.js';
import type { PayBlock, Permit } from '../../src/shared/types.js';

const { rates, datasets } = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
const center: [number, number] = [-87.6870, 41.9220]; // neighborhood

const block = (id: string, dx: number, extra: Partial<PayBlock> = {}): PayBlock => {
  const paths: [number, number][][] = [[[center[0] + dx, center[1] - 0.0005], [center[0] + dx, center[1] + 0.0005]]];
  return { blockId: id, street: 'N TEST AVE', from: 2000, to: 2050, parity: 'E', spaces: 6, hourLimit: '2', payZone: 1, payArea: 101, sundayHours: 'N', paths, bbox: [center[0] + dx, center[1] - 0.0005, center[0] + dx, center[1] + 0.0005], ...extra };
};
const permit = (p: Partial<Permit>): Permit => ({ id: 'p', dataset: 'closures', appType: '', workType: 'Opening', start: '2026-10-01T00:00:00', end: '2026-10-30T23:59:59', location: 'x', streetClosure: 'Full', detail: null, comments: null, meterBagging: false, applicant: 'X', point: [center[0] + 0.001, center[1]], ...p });

const snap = (over: Partial<DataSnapshot> = {}): DataSnapshot => ({
  payBlocks: [block('near', 0.0005), block('far', 0.003), block('closed', 0.001), block('outside', 0.05)],
  payBoxes: [], cbd: null, snowRoutes: [], sweepSchedule: [], permitZones: [], events: [],
  sweepZones: [{ wardSection: '0101', ward: '01', section: '01', bbox: [center[0] + 0.0002, center[1] - 0.01, center[0] + 0.0008, center[1] + 0.01], polygon: [[[[center[0] + 0.0002, center[1] - 0.01], [center[0] + 0.0008, center[1] - 0.01], [center[0] + 0.0008, center[1] + 0.01], [center[0] + 0.0002, center[1] + 0.01], [center[0] + 0.0002, center[1] - 0.01]]]] }],
  permits: [permit({})],
  ...over,
});
const idx = buildSweepIndex([{ wardSection: '0101', month: 10, days: [12] }], 2026);
const run = (at: string, s = snap(), extra: Partial<Parameters<typeof buildParking>[0]> = {}) =>
  buildParking({ snap: s, center, radiusM: 400, at, rates, closureRedPattern: datasets.closureRedPattern, sweepIdx: idx, permitZones: [], warnings: [], dataAsOf: {}, ...extra });

describe('buildParking', () => {
  it('filters by radius, sorts green first then distance, attaches rate + nav point', () => {
    const r = run('2026-10-13T10:00:00');
    expect(r.blocks.map((b) => b.blockId)).toEqual(['near', 'far', 'closed']);
    expect(r.blocks[0]).toMatchObject({ status: 'green', rate: { tier: 'neighborhood', hourly: 2.5 } });
    expect(r.blocks[2]).toMatchObject({ status: 'red' });
    expect(r.blocks[2].flags[0]).toMatchObject({ code: 'CLOSED', severity: 'red' });
    expect(r.blocks[0].navPoint[1]).toBeCloseTo(center[1], 4);
  });
  it('SWEEPING only before 14:00 on the sweep date (Chicago-local `at`)', () => {
    expect(run('2026-10-12T08:00:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).toContain('SWEEPING');
    expect(run('2026-10-12T15:00:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).not.toContain('SWEEPING');
    // Late on the previous evening: no sweeping flag yet, even though UTC is already the 12th.
    expect(run('2026-10-11T23:30:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).not.toContain('SWEEPING');
  });
  it('sidewalk-only closures do not flag red; bagged meters do', () => {
    const s = snap({ permits: [permit({ streetClosure: 'Sidewalk' })] });
    expect(run('2026-10-13T10:00:00', s).blocks.find((b) => b.blockId === 'closed')!.status).toBe('green');
    const s2 = snap({ permits: [permit({ dataset: 'current', streetClosure: 'Sidewalk', meterBagging: true })] });
    expect(run('2026-10-13T10:00:00', s2).blocks.find((b) => b.blockId === 'closed')!.flags[0].code).toBe('METERS_BAGGED');
  });
  it('expired permits are ignored', () => {
    expect(run('2026-11-05T10:00:00').blocks.find((b) => b.blockId === 'closed')!.status).toBe('green');
  });
  it('events nearby are amber; Sunday adds info; snow route only Dec–Mar', () => {
    const s = snap({
      permits: [],
      events: [{ id: 'e', date: '2026-12-13', venueAddress: 'x', type: 'Parade', details: 'p', startTime: '10', point: [center[0] + 0.0005, center[1] + 0.0003] }],
      snowRoutes: [{ id: 'r', paths: [[[center[0] + 0.0005, center[1] - 0.01], [center[0] + 0.0005, center[1] + 0.01]]], bbox: [center[0] + 0.0005, center[1] - 0.01, center[0] + 0.0005, center[1] + 0.01] }],
    });
    const near = run('2026-12-13T10:00:00', s).blocks.find((b) => b.blockId === 'near')!; // 2026-12-13 is a Sunday
    expect(near.flags.map((f) => f.code).sort()).toEqual(['EVENT_NEARBY', 'SNOW_ROUTE', 'SUNDAY']);
    expect(near.status).toBe('amber');
    const oct = run('2026-10-14T10:00:00', s).blocks.find((b) => b.blockId === 'near')!;
    expect(oct.flags.map((f) => f.code)).not.toContain('SNOW_ROUTE');
  });
  it('hour limit falls back to a matching pay box', () => {
    const s = snap({ permits: [], payBlocks: [block('near', 0.0005, { hourLimit: null })], payBoxes: [{ terminalId: 1, street: 'N TEST AVE', from: 2000, to: 2050, addr: 2010, spaces: 6, hourLimit: '3', payZone: 1, payArea: 101, point: [center[0] + 0.0005, center[1]] }] });
    expect(run('2026-10-13T10:00:00', s).blocks[0].hourLimit).toBe('3');
  });
  it('closure pattern: Full, Curblane, Partial and Intermitte are red; Sidewalk is not', () => {
    for (const v of ['Full', 'Curblane', 'Partial', 'Intermitte']) {
      const r = run('2026-10-14T10:00:00', snap({ permits: [permit({ streetClosure: v })] }));
      expect(r.blocks[2].flags.map((f) => f.code), v).toContain('CLOSED');
    }
    const side = run('2026-10-14T10:00:00', snap({ permits: [permit({ streetClosure: 'Sidewalk' })] }));
    expect(side.blocks[2].flags.map((f) => f.code)).not.toContain('CLOSED');
  });
  it('Sunday flag wording follows SUNDAY_HOURS once verified, and stays generic otherwise', () => {
    expect(sundayReason('Y', true)).toMatch(/meters enforced/);
    expect(sundayReason('N', true)).toMatch(/free on this block/);
    expect(sundayReason(null, true)).toMatch(/possibly free/);
    expect(sundayReason('Y', false)).toMatch(/possibly free/);
    const s = snap({ permits: [], payBlocks: [block('y', 0.0004, { sundayHours: 'Y' }), block('n', 0.0006, { sundayHours: 'N' })] });
    const r = run('2026-12-13T10:00:00', s, { sundayHoursVerified: true }); // a Sunday
    expect(r.blocks.find((b) => b.blockId === 'y')!.flags.find((f) => f.code === 'SUNDAY')!.reason).toMatch(/meters enforced/);
    expect(r.blocks.find((b) => b.blockId === 'n')!.flags.find((f) => f.code === 'SUNDAY')!.reason).toMatch(/free on this block/);
    expect(datasets.sundayHoursVerified).toBe(true);
  });
});
