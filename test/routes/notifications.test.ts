import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

const LONG_TOPIC = 'my-private-topic-k3j9x2m7q4';

describe('/api/me/notifications', () => {
  it('reads, validates and updates topic + prefs', async () => {
    const { app } = await makeTestApp();
    const g = (await app.inject({ method: 'GET', url: '/api/me/notifications', headers: asUser(OWNER) })).json();
    expect(g.topic).toMatch(/^ct-[a-z2-7]{26,}$/);
    expect(g.prefs.enabled.vehicle).toBe(true);
    expect(g).toMatchObject({ configured: true, ntfyUrl: 'https://ntfy.sh' });
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'a b' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { prefs: { quietStart: '25:00' } } })).statusCode).toBe(400);
    const p = (await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: LONG_TOPIC, prefs: { enabled: { work: false }, quietStart: '23:00' } } })).json();
    expect(p).toMatchObject({ topic: LONG_TOPIC, prefs: { quietStart: '23:00', quietEnd: '07:00', enabled: { work: false, vehicle: true } } });
  });
  it('rejects user-chosen topics shorter than 24 characters with a clear error', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'my-topic-123' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/at least 24 characters/);
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'a'.repeat(23) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'a'.repeat(24) } })).statusCode).toBe(200);
  });
  it('test push reports failure as 502', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), sendTestPush: async () => { throw new Error('ntfy HTTP 401'); } } });
    const r = await app.inject({ method: 'POST', url: '/api/me/notifications/test', headers: asUser(OWNER) });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain('401');
  });
});
