import { describe, it, expect } from 'vitest';
import { matchPermitZones, normStreetPart } from '../../src/server/domain/permitZones.js';
import { createParcelFetcher } from '../../src/server/sources/parcels.js';
import { loadConfig } from '../../src/server/config.js';
import { openStore } from '../../src/server/db/store.js';
import type { Parcel, PermitZoneRow } from '../../src/shared/types.js';

const parcel = (n: number, x: number, name = 'WILSON', type = 'AVE'): Parcel => ({ low: n, high: n, dir: 'W', name, type, centroid: [x, 41.965] });
const row: PermitZoneRow = { zone: '1130', oddEven: 'O', low: 1363, high: 1425, dir: 'W', name: 'WILSON', type: 'AVE' };

describe('permit zones', () => {
  it('normalizes street parts', () => {
    expect(normStreetPart(' st. ')).toBe('ST');
    expect(normStreetPart('Martin  Luther King Jr.')).toBe('MARTIN LUTHER KING JR');
  });
  it('matches by range + parity and groups into a line sorted by address', () => {
    const f = matchPermitZones([parcel(1401, -87.663), parcel(1365, -87.661), parcel(1400, -87.662), parcel(1501, -87.665)], [row]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ zone: '1130', parity: 'O', street: 'W WILSON AVE', label: 'Permit zone 1130 — residents only' });
    expect(f[0].line).toEqual([[-87.661, 41.965], [-87.663, 41.965]]);
  });
  it('B parity matches both sides; empty street_type on either side still matches', () => {
    const f = matchPermitZones([parcel(1400, -87.662, 'WILSON', ''), parcel(1401, -87.663)], [{ ...row, oddEven: 'B', type: '' }]);
    expect(f.map((x) => x.parity).sort()).toEqual(['E', 'O']);
  });
  it('different street type does not match', () => {
    expect(matchPermitZones([parcel(1401, -87.663, 'WILSON', 'ST')], [row])).toEqual([]);
  });
  it('ignores parcels with address 0', () => {
    expect(matchPermitZones([parcel(0, -87.663)], [{ ...row, low: 0 }])).toEqual([]);
  });
});

describe('createParcelFetcher', () => {
  it('queries the parcel layer near the point and caches for 24h', async () => {
    const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
    const urls: string[] = [];
    let now = 0;
    const fetchJson = async (u: string) => { urls.push(u); return { features: [{ attributes: { L_ADDR: 1401, H_ADDR: 1401, PRE_DIR: 'W', ST_NAME: 'WILSON', ST_TYPE: 'AVE' }, geometry: { rings: [[[0, 0], [2, 0], [2, 2], [0, 0]]] } }] }; };
    const near = createParcelFetcher({ fetchJson, cfg, store: openStore(':memory:'), nowLocal: () => 't', nowMs: () => now });
    expect(await near([-87.66, 41.965], 400)).toHaveLength(1);
    expect(new URL(urls[0]).pathname).toContain(`/${cfg.datasets.layers.parcels}/query`);
    await near([-87.66, 41.965], 400);
    expect(urls).toHaveLength(1);
    now = 25 * 3600 * 1000;
    await near([-87.66, 41.965], 400);
    expect(urls).toHaveLength(2);
  });
});
