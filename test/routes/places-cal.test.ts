import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

const zone = (ws: string, x0: number, x1: number) => ({ wardSection: ws, ward: ws.slice(0, 2), section: ws.slice(2), bbox: [x0, 41.88, x1, 41.89], polygon: [[[[x0, 41.88], [x1, 41.88], [x1, 41.89], [x0, 41.89], [x0, 41.88]]]] });

async function seeded() {
  const t = await makeTestApp();
  t.deps.store.saveDataset('sweepZones', [zone('2701', -87.650, -87.647), zone('2702', -87.647, -87.640)], 2, 't');
  t.deps.store.saveDataset('sweepSchedule', [{ wardSection: '2701', month: 10, days: [14] }, { wardSection: '2702', month: 10, days: [20] }], 2, 't');
  t.deps.cache.reload();
  return t;
}

describe('places + sweeping + calendar', () => {
  it('creating a home on a zone boundary returns both candidates and assigns none', async () => {
    const { app } = await seeded();
    const r = await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: '730 W Randolph' } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.place.zones).toEqual([]);
    expect(body.candidates.map((c: any) => c.wardSection).sort()).toEqual(['2701', '2702']);
  });
  it('confirming zones then reading sweeping + ics', async () => {
    const { app } = await seeded();
    const created = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: 'x' } })).json();
    const id = created.place.id;
    const bad = await app.inject({ method: 'PATCH', url: `/api/places/${id}`, headers: asUser(OWNER), payload: { zones: ['nope'] } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'PATCH', url: `/api/places/${id}`, headers: asUser(OWNER), payload: { zones: ['2701', '2702'] } });
    const sw = (await app.inject({ method: 'GET', url: `/api/places/${id}/sweeping`, headers: asUser(OWNER) })).json();
    expect(sw.status).toBe('active');
    expect(sw.upcoming.map((u: any) => u.date)).toEqual(['2026-10-14', '2026-10-20']);
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER) })).json();
    const path = new URL(me.calUrl.replace('webcal:', 'https:')).pathname;
    const ics = await app.inject({ method: 'GET', url: path });
    expect(ics.statusCode).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('UID:2701-2026-10-14@chicago-tracker');
  });
  it('unknown calendar token is 404 and other users cannot touch my places', async () => {
    const { app } = await seeded();
    expect((await app.inject({ method: 'GET', url: '/cal/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaa.ics' })).statusCode).toBe(404);
    const id = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'watch', label: 'Work', address: 'x' } })).json().place.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/places/${id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/places', headers: asUser('bro@example.com') })).json()).toEqual([]);
  });
  it('422 when an address cannot be geocoded; 400 on bad kind', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), geocode: async () => [] } });
    expect((await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'x', address: 'nowhere' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'boat', label: 'x', address: 'y' } })).statusCode).toBe(400);
  });
});
