import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

describe('/api/vehicles', () => {
  it('validates, limits to 3, isolates users, and triggers a check', async () => {
    let checks = 0;
    const t = await makeTestApp();
    t.deps.services.checkVehicles = async () => { checks++; };
    const { app } = t;
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: '!!', state: 'IL' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'AB123', state: 'Illinois' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'ab-123', state: 'IL', nickname: 'Civic' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ plate: 'AB123', state: 'IL', nickname: 'Civic' });
    expect(checks).toBe(1);
    for (const p of ['B1', 'C1']) await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: p, state: 'IL' } });
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'D1', state: 'IL' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/vehicles', headers: asUser('bro@example.com') })).json()).toEqual([]);
    const list = (await app.inject({ method: 'GET', url: '/api/vehicles/status', headers: asUser(OWNER) })).json();
    expect(list).toHaveLength(3);
    expect(list[0].status).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser(OWNER) })).statusCode).toBe(204);
  });
});
