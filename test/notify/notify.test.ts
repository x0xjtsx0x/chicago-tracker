import { describe, it, expect, vi } from 'vitest';
import { publishNtfy, NTFY_PRIORITY, type PlannedPush } from '../../src/server/notify/ntfy.js';
import { planPushes, inQuietHours, filterDeliverable, pushLabel, type PlanInput } from '../../src/server/notify/planner.js';
import { runNotifier } from '../../src/server/notify/runner.js';
import { DEFAULT_NOTIFY_PREFS, type Place, type WatchItem } from '../../src/shared/types.js';
import { openStore } from '../../src/server/db/store.js';
import { DataCache } from '../../src/server/data/cache.js';
import { loadConfig } from '../../src/server/config.js';

const home: Place = { id: 1, userId: 1, kind: 'home', label: 'Home', address: 'x', lat: 41.88, lon: -87.647, radiusM: 300, zones: ['3204'] };

describe('publishNtfy', () => {
  it('uses JSON publishing so emoji/em-dash titles are safe, with an explicit priority mapping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await publishNtfy(fetchImpl as any, { url: 'https://ntfy.example.com', token: 'tk' }, 'ct-abc', { title: '🚨 Your car was towed', message: 'm', priority: 'urgent', click: 'https://x/#/home', tags: ['rotating_light'] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://ntfy.example.com/');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tk');
    expect(init.headers.Title).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ topic: 'ct-abc', title: '🚨 Your car was towed', message: 'm', priority: 5, click: 'https://x/#/home', tags: ['rotating_light'] });
  });
  it('maps every ntfy level and sends no Authorization header without a token', async () => {
    expect(NTFY_PRIORITY).toEqual({ min: 1, low: 2, default: 3, high: 4, urgent: 5 });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await publishNtfy(fetchImpl as any, { url: 'https://ntfy.sh/', token: null }, 't', { title: 't', message: 'm', priority: 'low' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://ntfy.sh/');
    expect('Authorization' in init.headers).toBe(false);
    expect(JSON.parse(init.body).priority).toBe(2);
  });
  it('refuses to pass through an unknown priority', async () => {
    const fetchImpl = vi.fn();
    await expect(publishNtfy(fetchImpl as any, { url: 'https://n', token: null }, 't', { title: 't', message: 'm', priority: 4 as any })).rejects.toThrow(/unknown ntfy priority/);
    await expect(publishNtfy(fetchImpl as any, { url: 'https://n', token: null }, 't', { title: 't', message: 'm', priority: 'toString' as any })).rejects.toThrow(/unknown ntfy priority/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('throws on non-2xx', async () => {
    await expect(publishNtfy((async () => new Response('no', { status: 403 })) as any, { url: 'https://n', token: null }, 't', { title: 't', message: 'm', priority: 'default' })).rejects.toThrow('ntfy HTTP 403');
  });
});

describe('planner', () => {
  const base = { baseUrl: 'https://x', homes: [home], isSweeping: (ws: string, d: string) => ws === '3204' && d === '2026-10-14', vehicles: [], winter: [], newWork: [] };
  it('sweeping tomorrow only at/after 19:00', () => {
    expect(planPushes({ ...base, nowLocal: '2026-10-13T18:59:00' }).filter((p) => p.category === 'sweeping')).toHaveLength(0);
    const p = planPushes({ ...base, nowLocal: '2026-10-13T19:00:00' }).find((x) => x.category === 'sweeping')!;
    expect(p).toMatchObject({ key: 'sweep:3204:2026-10-14', priority: 'default' });
    expect(p.title).toBe('🧹 Street cleaning tomorrow — Home');
  });
  it('vehicle matches are urgent, one per match key, and name the tow lot', () => {
    const v = { id: 1, userId: 1, plate: 'AB123', state: 'IL', nickname: 'Civic' };
    const st = { vehicleId: 1, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed' as const, key: 'tow:9', date: '2026-10-11', details: 'd', address: '701 N Sacramento', phone: 'p' }] };
    const p = planPushes({ ...base, nowLocal: '2026-10-11T03:00:00', vehicles: [{ vehicle: v, status: st }] });
    expect(p).toEqual([expect.objectContaining({ key: 'tow:9', category: 'vehicle', priority: 'urgent', title: '🚨 Your car was towed' })]);
    expect(p[0].message).toContain('701 N Sacramento');
  });
  it('winter alerts filtered to winter events; possible ban uses ban key', () => {
    const status = { placeId: 1, label: 'Home', onSnowRoute: true, possibleBan: true, snowNext24hIn: 3, checkedAt: 't', error: null, alerts: [{ id: 'a', event: 'Winter Storm Warning', headline: 'h', severity: 'Severe', ends: null }, { id: 'b', event: 'Flood Watch', headline: 'f', severity: 'Minor', ends: null }] };
    const p = planPushes({ ...base, nowLocal: '2026-12-01T10:00:00', winter: [{ place: home, status, banKey: 'snowban:1:2026-12-01' }] });
    expect(p.map((x) => x.key).sort()).toEqual(['nws:a', 'snowban:1:2026-12-01']);
    expect(p.every((x) => x.priority === 'high')).toBe(true);
  });
  it('work digest at/after 18:00 bundles items and marks each', () => {
    const item = { id: 'g1', kind: 'permit' as const, dataset: 'current' as const, title: 'Gas main', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: '730 W RANDOLPH', description: '', distanceM: 10, utility: 'peoplesgas' as const, point: null };
    const p = planPushes({ ...base, nowLocal: '2026-10-11T18:00:00', newWork: [item] }).find((x) => x.category === 'work')!;
    expect(p).toMatchObject({ key: 'digest:2026-10-11', priority: 'low', alsoMark: ['work:g1'] });
  });
  it('quiet hours wrap midnight; urgent bypasses; disabled categories and sent keys filtered', () => {
    expect(inQuietHours('23:00', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
    const pushes: PlannedPush[] = [
      { key: 'a', category: 'vehicle', priority: 'urgent', title: '', message: '' },
      { key: 'b', category: 'winter', priority: 'high', title: '', message: '' },
      { key: 'c', category: 'sweeping', priority: 'default', title: '', message: '' },
    ];
    expect(filterDeliverable(pushes, DEFAULT_NOTIFY_PREFS, '2026-10-11T23:30:00', () => false).map((p) => p.key)).toEqual(['a']);
    const prefs = { ...DEFAULT_NOTIFY_PREFS, enabled: { ...DEFAULT_NOTIFY_PREFS.enabled, winter: false } };
    expect(filterDeliverable(pushes, prefs, '2026-10-11T12:00:00', (k) => k === 'c').map((p) => p.key)).toEqual(['a']);
  });
});

describe('push privacy (payloads go through a public third party)', () => {
  const PLATE = 'ZQ9876', NICK = 'Bluebird';
  const HOME_ADDR = '4321 W Example Ave, Chicago, IL 60600';
  const FORBIDDEN = [PLATE, NICK, HOME_ADDR, '4321 W EXAMPLE', '4321', 'EXAMPLE AVE', '4325 W EXAMPLE'];
  const myHome: Place = { ...home, address: HOME_ADDR };
  const allCategories = (h: Place): PlanInput => ({
    nowLocal: '2026-12-01T19:30:00', baseUrl: 'https://chicago.tail1234.ts.net', homes: [h],
    isSweeping: (ws, d) => ws === '3204' && d === '2026-12-02',
    vehicles: [{
      vehicle: { id: 1, userId: 1, plate: PLATE, state: 'IL', nickname: NICK },
      status: { vehicleId: 1, checkedAt: 't', ok: true, error: null, matches: [
        { kind: 'towed', key: 'tow:1', date: '2026-12-01', details: `HOND WHI — inventory #1 plate ${PLATE}`, address: '701 N Sacramento Blvd', phone: '(312) 555-0100' },
        { kind: 'relocated', key: 'reloc:SR1', date: '2026-12-01', details: 'Street Cleaning — moved from 4321 W EXAMPLE AVE', address: '4325 W EXAMPLE AVE', phone: null },
      ] },
    }],
    winter: [{ place: h, banKey: 'snowban:1:2026-12-01', status: { placeId: 1, label: h.label, onSnowRoute: true, possibleBan: true, snowNext24hIn: 3, checkedAt: 't', error: null, alerts: [{ id: 'w1', event: 'Winter Storm Warning', headline: 'Winter Storm Warning until Wed 6AM CST', severity: 'Severe', ends: null }] } }],
    newWork: [{ id: 'g1', kind: 'permit', dataset: 'current', title: 'Opening in the Public Way', start: '2026-12-02T00:00:00', end: '2026-12-09T00:00:00', location: '4321 W EXAMPLE AVE', description: '', distanceM: 5, utility: 'peoplesgas', point: null } satisfies WatchItem],
  });

  async function serialized(pushes: PlannedPush[]): Promise<string> {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    for (const p of pushes) await publishNtfy(fetchImpl as any, { url: 'https://ntfy.sh', token: null }, 'ct-topic', p);
    return fetchImpl.mock.calls.map(([url, init]: any[]) => JSON.stringify({ url, headers: init.headers, body: init.body })).join('\n');
  }

  it('no plate, nickname or home/relocation address in any category', async () => {
    const pushes = planPushes(allCategories(myHome));
    expect(new Set(pushes.map((p) => p.category))).toEqual(new Set(['vehicle', 'sweeping', 'winter', 'snowban', 'work']));
    const wire = (await serialized(pushes)).toUpperCase();
    for (const f of FORBIDDEN) expect(wire).not.toContain(f.toUpperCase());
    expect(wire).toContain('701 N SACRAMENTO BLVD'); // the public tow lot is allowed
    expect(wire).toContain('🧹 STREET CLEANING TOMORROW — HOME');
  });
  it('a place label that repeats its own house number is replaced with a generic label', async () => {
    const labelled = { ...myHome, label: '4321 W Example' };
    expect(pushLabel(labelled)).toBe('your home street');
    expect(pushLabel(myHome)).toBe('Home');
    const wire = (await serialized(planPushes(allCategories(labelled)))).toUpperCase();
    for (const f of FORBIDDEN) expect(wire).not.toContain(f.toUpperCase());
  });
});

describe('runNotifier', () => {
  it('seeds existing work silently, sends new pushes once, records ntfy failure', async () => {
    const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c', NTFY_URL: 'https://n' }, 'config');
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    store.createPlace(u.id, { ...home, zones: [] });
    store.saveDataset('permitsCurrent', [{ id: 'g1', dataset: 'current', appType: 'Opening', workType: 'Gas', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: 'x', streetClosure: null, detail: null, comments: null, meterBagging: false, applicant: 'Peoples Gas*', point: [-87.6471, 41.8801] }], 1, 't');
    const v = store.createVehicle(u.id, { plate: 'AB123', state: 'IL', nickname: 'Civic' });
    store.setVehicleStatus({ vehicleId: v.id, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:9', date: '2026-10-11', details: 'd', address: 'lot', phone: null }] });
    const cache = new DataCache(store);
    const sent: string[] = [];
    const publish = async (_t: string, p: any) => { sent.push(p.key); };
    const r1 = await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T18:30:00', publish, sleep: async () => {} });
    expect(sent).toEqual(['tow:9']);           // g1 was seeded, not sent
    expect(r1).toEqual({ sent: 1, failed: 0 });
    await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T18:45:00', publish, sleep: async () => {} });
    expect(sent).toEqual(['tow:9']);           // no duplicates
    store.setVehicleStatus({ vehicleId: v.id, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:10', date: '2026-10-11', details: 'd', address: 'lot', phone: null }] });
    const r3 = await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T19:00:00', publish: async () => { throw new Error('ntfy HTTP 500'); }, sleep: async () => {} });
    expect(r3.failed).toBe(1);
    expect(store.kvGet<string>('ntfy:lastError')?.value).toContain('ntfy HTTP 500');
    expect(store.wasNotified(u.id, 'tow:10')).toBe(false);
  });
  it('does nothing when push is disabled (empty NTFY_URL)', async () => {
    const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c', NTFY_URL: '' }, 'config');
    const store = openStore(':memory:');
    expect(await runNotifier({ cfg, store, cache: new DataCache(store), nowLocal: () => 't', publish: async () => { throw new Error('should not publish'); } })).toEqual({ sent: 0, failed: 0 });
  });
});
