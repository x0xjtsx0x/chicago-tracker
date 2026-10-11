import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';
import { refreshWinter } from '../../src/server/jobs/winterJob.js';

async function snowRouteHome() {
  const t = await makeTestApp({ nowLocal: () => '2026-12-01T12:00:00' });
  t.deps.store.saveDataset('snowRoutes', [{ id: '1', paths: [[[-87.6470, 41.88], [-87.6470, 41.89]]], bbox: [-87.647, 41.88, -87.647, 41.89] }], 1, 't');
  t.deps.cache.reload();
  const placeId = (await t.app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: 'x' } })).json().place.id;
  return { ...t, placeId };
}

describe('winter job + routes', () => {
  it('flags a possible ban on a snow-route home at ≥ 2 in, and clears it after', async () => {
    const { app, deps, placeId } = await snowRouteHome();
    let snowMm = 60;
    const nws = { alerts: async () => [{ id: 'a1', event: 'Winter Storm Warning', headline: 'h', severity: 'Severe', ends: null }], snowfallMm: async () => snowMm };
    await refreshWinter({ nws, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: true });
    const w = (await app.inject({ method: 'GET', url: '/api/winter', headers: asUser(OWNER) })).json();
    expect(w[0]).toMatchObject({ placeId, onSnowRoute: true, possibleBan: true, snowNext24hIn: 2.4 });
    expect(deps.store.kvGet<{ since: string }>(`snowban:${placeId}`)?.value.since).toBe('2026-12-01');
    snowMm = 10;
    await refreshWinter({ nws, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: true });
    expect(deps.store.kvGet(`snowban:${placeId}`)).toBeNull();
  });
  it('possible-ban threshold: 1.9 in no, 2.0 in yes, 2.1 in yes', async () => {
    const { deps, placeId } = await snowRouteHome();
    for (const [inches, expected] of [[1.9, false], [2.0, true], [2.1, true]] as const) {
      const nws = { alerts: async () => [], snowfallMm: async () => inches * 25.4 };
      await refreshWinter({ nws, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: true });
      expect(deps.store.kvGet<any>(`winter:${placeId}`)?.value).toMatchObject({ snowNext24hIn: inches, possibleBan: expected });
    }
  });
  it('a failed NWS check is recorded and keeps the previous alerts', async () => {
    const { deps, placeId } = await snowRouteHome();
    await refreshWinter({ nws: { alerts: async () => [{ id: 'a1', event: 'Winter Storm Warning', headline: 'h', severity: 'Severe', ends: null }], snowfallMm: async () => 0 }, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: false });
    await refreshWinter({ nws: { alerts: async () => { throw new Error('nws down'); }, snowfallMm: async () => 0 }, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: false });
    expect(deps.store.kvGet<any>(`winter:${placeId}`)?.value).toMatchObject({ error: 'nws down', alerts: [{ id: 'a1' }] });
  });
  it('plows endpoint validates bbox', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), plows: async () => [{ name: 'S1', type: 'PLOW', postedLocal: 't', minutesAgo: 3, point: [-87.6, 41.8] }] } });
    expect((await app.inject({ method: 'GET', url: '/api/plows?bbox=oops', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/plows?bbox=-87.7,41.8,-87.6,41.9', headers: asUser(OWNER) })).json()).toHaveLength(1);
  });
});
