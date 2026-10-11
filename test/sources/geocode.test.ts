import { describe, it, expect, vi } from 'vitest';
import { parseChicagoAddress, createGeocoder } from '../../src/server/sources/nominatim.js';
import { loadConfig } from '../../src/server/config.js';
import { openStore } from '../../src/server/db/store.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x.ts.net', NOMINATIM_CONTACT: 'me@example.com' }, 'config');

describe('parseChicagoAddress', () => {
  it('handles lowercase, city/state/zip and unit suffixes', () => {
    expect(parseChicagoAddress('1200 w randolph st, chicago il 60607')).toEqual({ num: 1200, dir: 'W', name: 'RANDOLPH', type: 'ST' });
    expect(parseChicagoAddress('2550 N. Clark St. Apt 2')).toEqual({ num: 2550, dir: 'N', name: 'CLARK', type: 'ST' });
    expect(parseChicagoAddress('400 S Martin Luther King Jr Dr #5')).toEqual({ num: 400, dir: 'S', name: 'MARTIN LUTHER KING JR', type: 'DR' });
    expect(parseChicagoAddress('11 E Huron')).toEqual({ num: 11, dir: 'E', name: 'HURON', type: null });
    expect(parseChicagoAddress('Wrigley Field')).toBeNull();
  });
});

describe('createGeocoder', () => {
  it('queries Nominatim bounded to Chicago, caches, and throttles', async () => {
    const fetchJson = vi.fn().mockResolvedValue([{ display_name: 'Wrigley Field, Chicago', lat: '41.948', lon: '-87.655' }]);
    const sleeps: number[] = [];
    let t = 0;
    const g = createGeocoder({ fetchJson, cfg, store: openStore(':memory:'), nowLocal: () => 'n', sleep: async (ms) => { sleeps.push(ms); t += ms; }, clock: () => t });
    expect(await g('Wrigley Field')).toEqual([{ label: 'Wrigley Field, Chicago', lat: 41.948, lon: -87.655 }]);
    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.hostname).toBe('nominatim.openstreetmap.org');
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('-87.9401,42.0230,-87.5240,41.6445');
    expect(fetchJson.mock.calls[0][1].headers['User-Agent']).toContain('me@example.com');
    await g('wrigley field');            // cached (case-insensitive) → no new call
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await g('Soldier Field');            // second live call must wait ≥ 1.1 s
    expect(sleeps.some((ms) => ms >= 1000)).toBe(true);
  });
  it('falls back to the parcel layer when Nominatim finds nothing', async () => {
    const fetchJson = vi.fn(async (u: string) => {
      if (u.includes('nominatim')) return [];
      const where = new URL(u).searchParams.get('where')!;
      // `= 'X' AND` trips the city WAF (HTTP 403); only the IN ('X') form is accepted.
      expect(where).toBe("L_ADDR <= 1200 AND H_ADDR >= 1200 AND PRE_DIR IN ('W') AND ST_NAME IN ('RANDOLPH') AND ST_TYPE IN ('ST')");
      expect(where).not.toMatch(/'\s+(AND|OR)\b/i);
      return { features: [{ attributes: { L_ADDR: 1200, H_ADDR: 1200, PRE_DIR: 'W', ST_NAME: 'RANDOLPH', ST_TYPE: 'ST' }, geometry: { rings: [[[-87.66, 41.88], [-87.658, 41.88], [-87.658, 41.882], [-87.66, 41.882], [-87.66, 41.88]]] } }] };
    });
    const g = createGeocoder({ fetchJson, cfg, store: openStore(':memory:'), nowLocal: () => 'n', sleep: async () => {}, clock: () => 0 });
    const r = await g('1200 W Randolph St');
    expect(r[0].label).toBe('1200 W RANDOLPH ST');
    expect(r[0].lat).toBeCloseTo(41.881, 3);
  });
});
