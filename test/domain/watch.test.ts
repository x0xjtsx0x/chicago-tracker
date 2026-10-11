import { describe, it, expect } from 'vitest';
import { utilityTag } from '../../src/server/domain/utilityTag.js';
import { buildWatch, group311, newWorkCandidates } from '../../src/server/domain/watch.js';
import { refresh311 } from '../../src/server/jobs/requests311Job.js';
import { openStore } from '../../src/server/db/store.js';
import { loadConfig } from '../../src/server/config.js';
import type { DataSnapshot } from '../../src/server/data/cache.js';
import type { Permit, Place, Request311 } from '../../src/shared/types.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
const { utilities } = cfg;
const place: Place = { id: 7, userId: 1, kind: 'watch', label: 'Work', address: 'x', lat: 41.9, lon: -87.65, radiusM: 300 , zones: [] };
const P = (o: Partial<Permit>): Permit => ({ id: 'p', dataset: 'current', appType: 'DOT Public Way Opening', workType: 'Opening in the Public Way', start: '2026-10-12T00:00:00', end: '2026-10-20T23:59:59', location: '100 W X ST', streetClosure: null, detail: 'dig', comments: null, meterBagging: false, applicant: 'X', point: [-87.6501, 41.9001], ...o });
const snap = (permits: Permit[]): DataSnapshot => ({ payBlocks: [], payBoxes: [], cbd: null, snowRoutes: [], sweepSchedule: [], sweepZones: [], permitZones: [], permits, events: [{ id: 'e1', date: '2026-10-15', venueAddress: 'x', type: 'Festival', details: 'Fest', startTime: '10', point: [-87.6502, 41.9002] }] });

describe('utilityTag', () => {
  it('classifies applicants case-insensitively', () => {
    expect(utilityTag({ applicant: 'ComED North*' }, utilities)).toBe('comed');
    expect(utilityTag({ applicant: 'Peoples Gas*' }, utilities)).toBe('peoplesgas');
    expect(utilityTag({ applicant: 'DWM*' }, utilities)).toBe('water');
    expect(utilityTag({ applicant: 'AT&T (SBC IL)*' }, utilities)).toBe('telecom');
    expect(utilityTag({ applicant: 'SEVEN-D CONSTRUCTION' }, utilities)).toBeNull();
  });
});

describe('buildWatch', () => {
  it('dedupes by permit id across datasets, filters by window and radius, tags utilities', () => {
    const r = buildWatch({
      snap: snap([P({ id: 'a', applicant: 'Peoples Gas*' }), P({ id: 'a', dataset: 'closures' }), P({ id: 'old', start: '2018-01-01T00:00:00', end: '2018-02-01T00:00:00' }), P({ id: 'far', point: [-87.70, 41.9] }), P({ id: 'later', start: '2026-12-01T00:00:00', end: '2026-12-02T00:00:00' })]),
      place, today: '2026-10-11', days: 14, utilities, requests: [], excluded311: [], sweeping: [], dataAsOf: {},
    });
    expect(r.items.map((i) => i.id)).toEqual(['a', 'e1']);
    expect(r.items[0]).toMatchObject({ kind: 'permit', utility: 'peoplesgas' });
    expect(r.items[1]).toMatchObject({ kind: 'event', dataset: 'event', title: 'Festival: Fest' });
  });
  it('groups 311 requests, excluding duplicates, excluded types and far ones', () => {
    const q = (o: Partial<Request311>): Request311 => ({ id: 'r', type: 'Pothole in Street Complaint', status: 'Open', created: '2026-10-05T10:00:00', closed: null, address: 'x', point: [-87.6501, 41.9001], duplicate: false, ...o });
    const g = group311([q({ id: '1' }), q({ id: '2' }), q({ id: '3', duplicate: true }), q({ id: '4', type: '311 INFORMATION ONLY CALL' }), q({ id: '5', type: 'Street Light Out Complaint' }), q({ id: '6', point: [-87.7, 41.9] })], [place.lon, place.lat], 300, ['311 INFORMATION ONLY CALL']);
    expect(g.map((x) => [x.type, x.count])).toEqual([['Pothole in Street Complaint', 2], ['Street Light Out Complaint', 1]]);
  });
  it('newWorkCandidates keeps only utility-tagged or full-closure permits', () => {
    const s = snap([P({ id: 'gas', applicant: 'Peoples Gas*' }), P({ id: 'full', streetClosure: 'Full' }), P({ id: 'plain' })]);
    expect(newWorkCandidates(s, place, '2026-10-11', utilities).map((i) => i.id).sort()).toEqual(['full', 'gas']);
  });
});

describe('refresh311', () => {
  it('queries within the place radius over the last 30 days and stores per place; records errors', async () => {
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    const p = store.createPlace(u.id, { kind: 'watch', label: 'Work', address: 'x', lat: 41.9, lon: -87.65, radiusM: 300, zones: [] });
    let where = '';
    await refresh311({ fetchJson: async (url: string) => { where = new URL(url).searchParams.get('$where')!; return [{ sr_number: 'SR1', sr_type: 'Pothole', created_date: '2026-10-05T00:00:00.000', latitude: '41.9', longitude: '-87.65' }]; }, cfg, store, nowLocal: () => '2026-10-11T10:00:00' });
    expect(where).toBe("within_circle(location, 41.9, -87.65, 300) AND created_date >= '2026-09-11T00:00:00'");
    expect(store.kvGet<Request311[]>(`311:${p.id}`)?.value[0]).toMatchObject({ id: 'SR1', created: '2026-10-05T00:00:00' });
    await refresh311({ fetchJson: async () => { throw new Error('down'); }, cfg, store, nowLocal: () => '2026-10-11T10:30:00' });
    expect(store.kvGet<string>(`311err:${p.id}`)?.value).toBe('down');
    expect(store.kvGet<Request311[]>(`311:${p.id}`)?.value).toHaveLength(1);
  });
});
