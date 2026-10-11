import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { openStore } from '../../src/server/db/store.js';
import { DataCache } from '../../src/server/data/cache.js';
import type { AppDeps, Services } from '../../src/server/services.js';

export const OWNER = 'owner@example.com';
export const asUser = (login: string, name = login) => ({ 'tailscale-user-login': login, 'tailscale-user-name': name });

export const stubServices = (): Services => ({
  geocode: async () => [{ label: '730 W Randolph St, Chicago', lat: 41.8845, lon: -87.647 }],
  parcelsNear: async () => [],
  plows: async () => [],
  refreshNow: async () => ({ ok: [], failed: [] }),
  sendTestPush: async () => {},
});

export async function makeTestApp(overrides: Partial<AppDeps> = {}, env: Record<string, string> = {}) {
  const cfg = loadConfig({ OWNER_LOGIN: OWNER, ALLOWED_LOGINS: 'bro@example.com', PUBLIC_BASE_URL: 'https://chicago.tail1234.ts.net', NOMINATIM_CONTACT: 'owner@example.com', ...env }, 'config');
  const store = openStore(':memory:');
  const deps: AppDeps = { cfg, store, cache: new DataCache(store), services: stubServices(), nowLocal: () => '2026-10-11T12:00:00', webRoot: null, ...overrides };
  const app = await buildApp(deps);
  return { app, deps };
}
