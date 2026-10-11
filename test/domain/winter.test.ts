import { describe, it, expect } from 'vitest';
import { onSnowRoute, parseAlerts, parseIsoDurationMs, snowNext24hMm, WINTER_EVENT_RE, BAN_THRESHOLD_MM } from '../../src/server/domain/winter.js';
import { createPlowFetcher } from '../../src/server/sources/plows.js';
import { loadConfig } from '../../src/server/config.js';

describe('winter', () => {
  it('snow route membership within 25 m', () => {
    const routes = [{ id: '1', paths: [[[-87.65, 41.90], [-87.65, 41.91]]] as [number, number][][], bbox: [-87.65, 41.90, -87.65, 41.91] as [number, number, number, number] }];
    expect(onSnowRoute(routes, [-87.6501, 41.905])).toBe(true);
    expect(onSnowRoute(routes, [-87.6510, 41.905])).toBe(false);
  });
  it('parses NWS alerts', () => {
    const a = parseAlerts({ features: [{ properties: { id: 'urn:1', event: 'Winter Storm Warning', headline: 'WSW until Tue', severity: 'Severe', ends: '2026-12-02T06:00:00-06:00' } }] });
    expect(a).toEqual([{ id: 'urn:1', event: 'Winter Storm Warning', headline: 'WSW until Tue', severity: 'Severe', ends: '2026-12-02T06:00:00-06:00' }]);
    expect(WINTER_EVENT_RE.test('Winter Storm Warning')).toBe(true);
    expect(WINTER_EVENT_RE.test('Flood Watch')).toBe(false);
  });
  it('durations', () => {
    expect(parseIsoDurationMs('PT6H')).toBe(6 * 3600e3);
    expect(parseIsoDurationMs('P1DT3H')).toBe(27 * 3600e3);
    expect(parseIsoDurationMs('PT30M')).toBe(30 * 60e3);
  });
  it('sums snowfall over the next 24h, prorating partial overlaps', () => {
    const now = Date.parse('2026-12-01T12:00:00Z');
    const vals = [
      { validTime: '2026-12-01T06:00:00+00:00/PT12H', value: 20 }, // half overlaps → 10
      { validTime: '2026-12-01T18:00:00+00:00/PT6H', value: 30 },  // fully inside → 30
      { validTime: '2026-12-02T12:00:00+00:00/PT6H', value: 99 },  // starts at window end → 0
      { validTime: '2026-12-02T00:00:00+00:00/PT6H', value: null }, // null → 0
    ];
    expect(snowNext24hMm(vals, now)).toBeCloseTo(40, 5);
    expect(BAN_THRESHOLD_MM).toBe(50.8);
  });
});

describe('createPlowFetcher', () => {
  it('keeps plows posted in the last 2h, with minutes since update, and caches for 2 min', async () => {
    const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
    const now = Date.parse('2026-12-01T12:00:00Z');
    let t = now, calls = 0;
    const fetchJson = async () => {
      calls++;
      return { features: [
        { attributes: { ASSET_NAME: 'S1', ASSET_TYPE: 'PLOW', POSTING_TIME: now - 5 * 60e3 }, geometry: { x: -87.6, y: 41.8 } },
        { attributes: { ASSET_NAME: 'S2', ASSET_TYPE: 'SALT', POSTING_TIME: now - 3 * 3600e3 }, geometry: { x: -87.6, y: 41.8 } },
      ] };
    };
    const plows = createPlowFetcher({ fetchJson, cfg, nowMs: () => t });
    const r = await plows([-87.7, 41.8, -87.6, 41.9]);
    expect(r).toEqual([{ name: 'S1', type: 'PLOW', postedLocal: '2026-12-01T05:55:00', minutesAgo: 5, point: [-87.6, 41.8] }]);
    await plows([-87.7, 41.8, -87.6, 41.9]);
    expect(calls).toBe(1);
    t += 121_000;
    await plows([-87.7, 41.8, -87.6, 41.9]);
    expect(calls).toBe(2);
  });
});
