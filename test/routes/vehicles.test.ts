import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';
import type { Vehicle, VehicleStatus } from '../../src/shared/types.js';

const post = (app: any, payload: object, who = OWNER) => app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(who), payload });

describe('/api/vehicles', () => {
  it('validates, limits to 3, isolates users, and triggers a check', async () => {
    let checks = 0;
    const t = await makeTestApp();
    t.deps.services.checkVehicle = async (v) => { checks++; return { vehicleId: v.id, checkedAt: 't', ok: true, matches: [], error: null }; };
    const { app } = t;
    expect((await post(app, { plate: '!!', state: 'IL' })).statusCode).toBe(400);
    expect((await post(app, { plate: 'AB123', state: 'Illinois' })).statusCode).toBe(400);
    expect((await post(app, { plate: 'AB123', state: 'ZZ' })).statusCode).toBe(400); // two letters but not a state
    const ok = await post(app, { plate: 'ab-123', state: 'il', nickname: 'Civic', make: 'honda', color: 'white' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ plate: 'AB123', state: 'IL', nickname: 'Civic', make: 'honda', color: 'white' });
    expect(checks).toBe(1);
    for (const p of ['B1', 'C1']) await post(app, { plate: p, state: 'IL' });
    expect((await post(app, { plate: 'D1', state: 'IL' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/vehicles', headers: asUser('bro@example.com') })).json()).toEqual([]);
    const list = (await app.inject({ method: 'GET', url: '/api/vehicles/status', headers: asUser(OWNER) })).json();
    expect(list).toHaveLength(3);
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser(OWNER) })).statusCode).toBe(204);
  });

  it('rejects unknown make/colour and duplicate plate+state (on create and on edit)', async () => {
    const { app } = await makeTestApp();
    expect((await post(app, { plate: 'ABC1234', state: 'IL', make: 'batmobile' })).statusCode).toBe(400);
    expect((await post(app, { plate: 'ABC1234', state: 'IL', color: 'plaid' })).statusCode).toBe(400);
    const a = (await post(app, { plate: 'ABC1234', state: 'IL' })).json();
    const dup = await post(app, { plate: 'abc 1234', state: 'IL' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toContain('IL · ABC1234');
    expect((await post(app, { plate: 'ABC1234', state: 'WI' })).statusCode).toBe(201); // same plate, other state is a different car
    const b = (await post(app, { plate: 'XYZ1', state: 'IL' })).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/vehicles/${b.id}`, headers: asUser(OWNER), payload: { plate: 'ABC1234' } })).statusCode).toBe(409);
    const edited = await app.inject({ method: 'PATCH', url: `/api/vehicles/${a.id}`, headers: asUser(OWNER), payload: { nickname: 'Blue one', make: 'toyota', color: 'blue' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ plate: 'ABC1234', nickname: 'Blue one', make: 'toyota', color: 'blue' });
    expect((await app.inject({ method: 'PATCH', url: `/api/vehicles/${a.id}`, headers: asUser('bro@example.com'), payload: { nickname: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/vehicles/${a.id}`, headers: asUser(OWNER), payload: { state: 'QQ' } })).statusCode).toBe(400);
  });

  it('POST /:id/check runs a live lookup, returns what was searched and a make/colour cross-check', async () => {
    const t = await makeTestApp();
    let calls = 0;
    t.deps.services.checkVehicle = async (v: Vehicle) => {
      calls++;
      const s: VehicleStatus = {
        vehicleId: v.id, checkedAt: '2026-10-11T12:00:00', ok: true, error: null,
        search: { plate: v.plate, state: v.state, stateCodes: [v.state], datasets: [{ id: 'ygr5-vcbg', name: 'Towed Vehicles' }], alertSince: '2026-09-27', datasetWindowDays: 90 },
        matches: [{ kind: 'towed', key: 'tow:1', date: '2026-10-10', details: '', address: 'lot', phone: null, make: 'TOYT', color: 'WHI', recordState: 'IL', confidence: 'exact' }],
        older: [], otherState: [],
      };
      t.deps.store.setVehicleStatus(s);
      return s;
    };
    const { app } = t;
    const v = (await post(app, { plate: 'ABC1234', state: 'IL', make: 'honda', color: 'black' })).json();
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${v.id}/check`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    const r = await app.inject({ method: 'POST', url: `/api/vehicles/${v.id}/check`, headers: asUser(OWNER) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status.search).toMatchObject({ plate: 'ABC1234', state: 'IL', alertSince: '2026-09-27' });
    expect(body.status.matches[0].crossCheck).toMatchObject({ verdict: 'mismatch', recordText: 'WHITE TOYOTA' });
    // Within the cooldown, a repeat tap returns the stored result instead of hitting the city again.
    const again = (await app.inject({ method: 'POST', url: `/api/vehicles/${v.id}/check`, headers: asUser(OWNER) })).json();
    expect(again.cooldown).toBe(true);
    expect(calls).toBe(1); // the save's background lookup was joined by the first Check now
    // Without the CSRF proof header the mutating check route is refused.
    expect((await app.inject({ method: 'POST', url: `/api/vehicles/${v.id}/check`, headers: { 'tailscale-user-login': OWNER } })).statusCode).toBe(403);
  });
});
