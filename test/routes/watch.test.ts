import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

describe('/api/watch/:placeId', () => {
  it('returns items, 311 groups and data-as-of for my place only', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-11T12:00:00' });
    const id = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'watch', label: 'Work', address: 'x' } })).json().place.id;
    deps.store.saveDataset('permitsCurrent', [{ id: 'g1', dataset: 'current', appType: 'Opening', workType: 'Gas main', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: '730 W RANDOLPH', streetClosure: null, detail: null, comments: null, meterBagging: false, applicant: 'Peoples Gas*', point: [-87.6471, 41.8846] }], 1, '2026-10-11T03:30:00');
    deps.cache.reload();
    deps.store.kvSet(`311:${id}`, [{ id: 'SR1', type: 'Pothole in Street Complaint', status: 'Open', created: '2026-10-05T00:00:00', closed: null, address: 'x', point: [-87.647, 41.8845], duplicate: false }], 't');
    const r = (await app.inject({ method: 'GET', url: `/api/watch/${id}`, headers: asUser(OWNER) })).json();
    expect(r.items[0]).toMatchObject({ id: 'g1', utility: 'peoplesgas' });
    expect(r.requests311[0]).toMatchObject({ type: 'Pothole in Street Complaint', count: 1 });
    expect(r.dataAsOf.permitsCurrent).toBe('2026-10-11T03:30:00');
    expect((await app.inject({ method: 'GET', url: `/api/watch/${id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
  });
});
