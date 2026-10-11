import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/server/config.js';

const base = { OWNER_LOGIN: 'me@example.com', PUBLIC_BASE_URL: 'https://chicago.tail1234.ts.net', NOMINATIM_CONTACT: 'me@example.com' };

describe('loadConfig', () => {
  it('loads defaults and json config', () => {
    const c = loadConfig(base, 'config');
    expect(c.port).toBe(8787);
    expect(c.host).toBe('127.0.0.1');
    expect(c.allowedLogins).toEqual(['me@example.com']);
    expect(c.singleUserLogin).toBeNull();
    expect(c.datasets.layers.payBlocks).toBe(58);
    expect(c.rates.neighborhood.hourly).toBe(2.5);
    expect(c.utilities.tags.length).toBeGreaterThan(0);
    expect(c.excluded311).toContain('311 INFORMATION ONLY CALL');
    expect(c.nwsUserAgent).toContain('me@example.com');
  });
  it('city sources get a contact-free User-Agent (the city CDN 403s UAs with an email in them)', () => {
    const c = loadConfig(base, 'config');
    expect(c.cityUserAgent).toBe('chicago-tracker/0.1');
    expect(c.cityUserAgent).not.toMatch(/[@()]/);
    expect(loadConfig({ ...base, CITY_USER_AGENT: 'ct/2' }, 'config').cityUserAgent).toBe('ct/2');
  });
  it('HOST overrides the listen address', () => {
    expect(loadConfig({ ...base, HOST: '0.0.0.0' }, 'config').host).toBe('0.0.0.0');
  });
  it('ntfy defaults to public ntfy.sh with no token; empty NTFY_URL disables push', () => {
    const c = loadConfig(base, 'config');
    expect(c.ntfyUrl).toBe('https://ntfy.sh');
    expect(c.ntfyToken).toBeNull();
    expect(loadConfig({ ...base, NTFY_URL: 'https://ntfy.example.com/', NTFY_TOKEN: 'tk' }, 'config')).toMatchObject({ ntfyUrl: 'https://ntfy.example.com', ntfyToken: 'tk' });
    expect(loadConfig({ ...base, NTFY_URL: '' }, 'config').ntfyUrl).toBeNull();
  });
  it('parses ALLOWED_LOGINS and always includes owner', () => {
    const c = loadConfig({ ...base, ALLOWED_LOGINS: 'bro@example.com, other@example.com ' }, 'config');
    expect(c.allowedLogins.sort()).toEqual(['bro@example.com', 'me@example.com', 'other@example.com']);
  });
  it('the single-user login is always allowed', () => {
    const c = loadConfig({ ...base, SINGLE_USER_LOGIN: ' solo@example.com ' }, 'config');
    expect(c.singleUserLogin).toBe('solo@example.com');
    expect(c.allowedLogins).toContain('solo@example.com');
  });
  it('throws a clear error on missing required vars', () => {
    expect(() => loadConfig({}, 'config')).toThrow(/OWNER_LOGIN/);
  });
});
