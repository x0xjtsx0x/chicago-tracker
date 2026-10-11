import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';
import { resolveLogin } from '../../src/server/auth.js';
import { loadConfig } from '../../src/server/config.js';

describe('auth + /api/me', () => {
  it('401 without a tailscale identity', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });
  it('403 for a login not on the allow-list', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: asUser('stranger@x') })).statusCode).toBe(403);
  });
  it('creates the owner on first request and returns a webcal url', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER, 'Owner') });
    expect(r.statusCode).toBe(200);
    const me = r.json();
    expect(me).toMatchObject({ login: OWNER, isOwner: true, navApp: 'apple' });
    expect(me.calUrl).toMatch(/^webcal:\/\/chicago\.tail1234\.ts\.net\/cal\/[A-Za-z0-9_-]{32,}\.ics$/);
    expect(me.towSearchUrl).toBe('https://data.cityofchicago.org/d/ygr5-vcbg');
  });
  it('allowed second user is a separate, non-owner profile', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: asUser('bro@example.com') });
    expect(r.json()).toMatchObject({ login: 'bro@example.com', isOwner: false });
  });
  it('single-user mode maps header-less requests to the configured login', async () => {
    const { app } = await makeTestApp({}, { SINGLE_USER_LOGIN: OWNER });
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.json().login).toBe(OWNER);
  });
  it('single-user mode ignores forged Tailscale-User-* headers and never creates a second user', async () => {
    const { app, deps } = await makeTestApp({}, { SINGLE_USER_LOGIN: OWNER });
    const forged = await app.inject({ method: 'GET', url: '/api/me', headers: { 'Tailscale-User-Login': 'attacker@example.com', 'Tailscale-User-Name': 'Attacker' } });
    expect(forged.statusCode).toBe(200);
    expect(forged.json()).toMatchObject({ login: OWNER, name: OWNER, isOwner: true });
    // Even an allow-listed login in the header does not switch identity.
    const allowed = await app.inject({ method: 'GET', url: '/api/me', headers: asUser('bro@example.com') });
    expect(allowed.json().login).toBe(OWNER);
    const blank = await app.inject({ method: 'GET', url: '/api/me', headers: { 'tailscale-user-login': '' } });
    expect(blank.json().login).toBe(OWNER);
    expect(deps.store.listUsers().map((u) => u.login)).toEqual([OWNER]);
    expect(deps.store.getUserByLogin('attacker@example.com')).toBeNull();
  });
  it('resolveLogin: header mode reads headers; single-user mode ignores them', () => {
    const base = { OWNER_LOGIN: OWNER, PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' };
    const multi = loadConfig(base, 'config');
    expect(resolveLogin({ 'tailscale-user-login': 'a@example.com', 'tailscale-user-name': 'A' }, multi)).toEqual({ login: 'a@example.com', name: 'A' });
    expect(resolveLogin({}, multi)).toBeNull();
    const single = loadConfig({ ...base, SINGLE_USER_LOGIN: 'solo@example.com' }, 'config');
    expect(resolveLogin({ 'tailscale-user-login': 'attacker@example.com', 'tailscale-user-name': 'X' }, single)).toEqual({ login: 'solo@example.com', name: 'solo@example.com' });
  });
  it('percent-encoded paths cannot route to /api handlers around the auth check', async () => {
    const { app, deps } = await makeTestApp();
    for (const url of ['/%61pi/me', '/%61pi/status', '/%61pi/geocode?q=wrigley', '/%61%70%69/places']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: asUser('stranger@x') })).statusCode, url).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/%61pi/me', headers: asUser(OWNER) })).json().login).toBe(OWNER);
    expect(deps.store.listUsers().map((u) => u.login)).toEqual([OWNER]);
  });
  it('X-Forwarded-For is not trusted (trustProxy off)', async () => {
    const { app } = await makeTestApp();
    app.get('/__ip', async (req) => ({ ip: req.ip }));
    const r = await app.inject({ method: 'GET', url: '/__ip', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(r.json().ip).toBe('192.0.2.10');
  });
  it('PATCH navApp validates input', async () => {
    const { app } = await makeTestApp();
    const ok = await app.inject({ method: 'PATCH', url: '/api/me', headers: asUser(OWNER), payload: { navApp: 'waze' } });
    expect(ok.json().navApp).toBe('waze');
    const bad = await app.inject({ method: 'PATCH', url: '/api/me', headers: asUser(OWNER), payload: { navApp: 'bing' } });
    expect(bad.statusCode).toBe(400);
  });
  it('rotates the calendar token', async () => {
    const { app } = await makeTestApp();
    const a = (await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER) })).json().calUrl;
    const b = (await app.inject({ method: 'POST', url: '/api/me/cal-token', headers: asUser(OWNER) })).json().calUrl;
    expect(a).not.toBe(b);
  });
  it('healthz is public and sets security headers', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});
