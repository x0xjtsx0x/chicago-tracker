import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

const blk = { blockId: 'B1', street: 'W RANDOLPH ST', from: 724, to: 740, parity: 'N', spaces: 14, hourLimit: '2', payZone: 4, payArea: 257, sundayHours: 'N', paths: [[[-87.6475, 41.8845], [-87.6465, 41.8845]]], bbox: [-87.6475, 41.8845, -87.6465, 41.8845] };

describe('/api/parking', () => {
  it('returns blocks near the destination with Chicago-local default `at`', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-13T09:15:00' });
    deps.store.saveDataset('payBlocks', [blk], 1, '2026-10-13T03:30:00'); deps.cache.reload();
    const r = await app.inject({ method: 'GET', url: '/api/parking?lat=41.8846&lon=-87.6470', headers: asUser(OWNER) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.at).toBe('2026-10-13T09:15:00');
    expect(body.radiusM).toBe(400);
    // 730 W Randolph is east of Halsted (800 W), so it falls in the CBD tier.
    expect(body.blocks[0]).toMatchObject({ blockId: 'B1', payArea: 257, rate: { tier: 'cbd' } });
    expect(body.dataAsOf.payBlocks).toBe('2026-10-13T03:30:00');
  });
  it('validates coordinates, clamps radius, validates `at`', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=40&lon=-74', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&radius=99999', headers: asUser(OWNER) })).json().radiusM).toBe(1500);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&at=tomorrow', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&at=2026-10-14T18:00', headers: asUser(OWNER) })).json().at).toBe('2026-10-14T18:00:00');
  });
  it('degrades gracefully when the parcel lookup fails', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), parcelsNear: async () => { throw new Error('arcgis down'); } } });
    const body = (await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64', headers: asUser(OWNER) })).json();
    expect(body.permitZones).toEqual([]);
    expect(body.warnings).toContain('Permit-zone info unavailable');
  });
});

describe('/api/status and admin refresh', () => {
  it('lists dataset meta and stale names (>48h)', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-13T12:00:00' });
    deps.store.saveDataset('payBlocks', [1], 1, '2026-10-13T03:30:00');
    deps.store.saveDataset('specialEvents', [1], 1, '2026-10-01T03:30:00');
    const s = (await app.inject({ method: 'GET', url: '/api/status', headers: asUser(OWNER) })).json();
    expect(s.datasets.map((d: any) => d.name).sort()).toEqual(['payBlocks', 'specialEvents']);
    expect(s.stale).toEqual(['specialEvents']);
  });
  it('refresh is owner-only', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'POST', url: '/api/admin/refresh', headers: asUser('bro@example.com') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/refresh', headers: asUser(OWNER) })).statusCode).toBe(200);
  });
});
