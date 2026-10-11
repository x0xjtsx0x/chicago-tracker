import { describe, it, expect, vi } from 'vitest';
import { normalizePlate, mapTowed, mapRelocated } from '../../src/server/domain/vehicles.js';
import { checkVehicles } from '../../src/server/jobs/vehicleJob.js';
import { openStore } from '../../src/server/db/store.js';
import { loadConfig } from '../../src/server/config.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('vehicles', () => {
  it('normalizes plates', () => {
    expect(normalizePlate(' abc-12 3 ')).toBe('ABC123');
  });
  it('maps towed and relocated rows', () => {
    expect(mapTowed({ tow_date: '2026-10-11T00:00:00.000', make: 'HOND', color: 'WHI', plate: 'X', state: 'IL', towed_to_address: '701 N. Sacramento', tow_facility_phone: '(773) 265-7605', inventory_number: '7172331' }))
      .toEqual({ kind: 'towed', key: 'tow:7172331', date: '2026-10-11', details: 'HOND WHI — inventory #7172331', address: '701 N. Sacramento', phone: '(773) 265-7605' });
    expect(mapRelocated({ relocated_date: '2026-10-10T00:00:00.000', relocated_reason: 'Street Cleaning', service_request_number: 'SR9', relocated_from_address_number: '1400', relocated_from_street_direction: 'W', relocated_from_street_name: 'WILSON', relocated_from_suffix: 'AVE', relocated_to_address_number: '1500', relocated_to_direction: 'W', relocated_to_street_name: 'WILSON', relocated_to_suffix: 'AVE' }))
      .toEqual({ kind: 'relocated', key: 'reloc:SR9', date: '2026-10-10', details: 'Street Cleaning — moved from 1400 W WILSON AVE', address: '1500 W WILSON AVE', phone: null });
  });
  it('job records matches, and records failures without claiming ok', async () => {
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    const v = store.createVehicle(u.id, { plate: 'ABC123', state: 'IL', nickname: 'Car' });
    const fetchJson = vi.fn(async (url: string) => {
      const where = new URL(url).searchParams.get('$where')!;
      expect(where).toContain("plate = 'ABC123' AND state = 'IL'");
      return url.includes(cfg.datasets.socrata.towed) ? [{ tow_date: '2026-10-11T00:00:00.000', inventory_number: '1', towed_to_address: 'lot', tow_facility_phone: 'p' }] : [];
    });
    await checkVehicles({ fetchJson, cfg, store, nowLocal: () => '2026-10-11T10:00:00' });
    expect(store.getVehicleStatus(v.id)).toMatchObject({ ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:1' }] });
    await checkVehicles({ fetchJson: async () => { throw new Error('down'); }, cfg, store, nowLocal: () => '2026-10-11T10:30:00' });
    expect(store.getVehicleStatus(v.id)).toMatchObject({ ok: false, error: 'down', checkedAt: '2026-10-11T10:30:00' });
  });
});
