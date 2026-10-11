import { describe, it, expect, vi } from 'vitest';
import { normalizePlate, mapTowed, mapRelocated, classifyMatches } from '../../src/server/domain/vehicles.js';
import { checkVehicle, checkVehicles } from '../../src/server/jobs/vehicleJob.js';
import { openStore } from '../../src/server/db/store.js';
import { loadConfig } from '../../src/server/config.js';
import type { VehicleMatch } from '../../src/shared/types.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('vehicles', () => {
  it('normalizes plates', () => {
    expect(normalizePlate(' abc-12 3 ')).toBe('ABC123');
  });
  it('maps towed and relocated rows (keeping make, colour and the recorded state)', () => {
    expect(mapTowed({ tow_date: '2026-10-11T00:00:00.000', make: 'HOND', color: 'WHI', plate: 'X', state: 'IL', towed_to_address: '701 N. Sacramento', tow_facility_phone: '(773) 265-7605', inventory_number: '7172331' }))
      .toEqual({ kind: 'towed', key: 'tow:7172331', date: '2026-10-11', details: 'HOND WHI — inventory #7172331', address: '701 N. Sacramento', phone: '(773) 265-7605', make: 'HOND', color: 'WHI', recordState: 'IL' });
    expect(mapRelocated({ relocated_date: '2026-10-10T00:00:00.000', relocated_reason: 'Street Cleaning', service_request_number: 'SR9', make: 'Toyota', color: 'Gray', relocated_from_address_number: '1400', relocated_from_street_direction: 'W', relocated_from_street_name: 'WILSON', relocated_from_suffix: 'AVE', relocated_to_address_number: '1500', relocated_to_direction: 'W', relocated_to_street_name: 'WILSON', relocated_to_suffix: 'AVE' }))
      .toEqual({ kind: 'relocated', key: 'reloc:SR9', date: '2026-10-10', details: 'Street Cleaning — moved from 1400 W WILSON AVE', address: '1500 W WILSON AVE', phone: null, make: 'Toyota', color: 'Gray', recordState: null });
  });

  const m = (key: string, date: string, recordState: string | null): VehicleMatch =>
    ({ kind: 'towed', key, date, details: '', address: 'lot', phone: null, recordState });
  it('classifies records: exact, no-state "possible", older history, and other-state hints', () => {
    const r = classifyMatches({ state: 'IL' }, [
      m('a', '2026-10-10', 'IL'), m('b', '2026-10-09', null), m('c', '2026-10-08', 'NONE'),
      m('d', '2026-09-01', 'IL'), m('e', '2026-10-10', 'IN'),
    ], '2026-09-27');
    expect(r.matches.map((x) => [x.key, x.confidence])).toEqual([['a', 'exact'], ['b', 'possible'], ['c', 'possible']]);
    expect(r.older!.map((x) => x.key)).toEqual(['d']);
    expect(r.otherState!.map((x) => x.key)).toEqual(['e']);
  });
  it('Nebraska matches the legacy NB code the tow dataset uses; Canadian provinces match CN', () => {
    expect(classifyMatches({ state: 'NE' }, [m('a', '2026-10-10', 'NB')], '2026-10-01').matches).toHaveLength(1);
    expect(classifyMatches({ state: 'ON' }, [m('a', '2026-10-10', 'CN')], '2026-10-01').matches).toHaveLength(1);
    expect(classifyMatches({ state: 'IL' }, [m('a', '2026-10-10', 'NB')], '2026-10-01').otherState).toHaveLength(1);
  });

  it('job searches by plate in any state, records what it searched, and records failures without claiming ok', async () => {
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    const v = store.createVehicle(u.id, { plate: 'ABC123', state: 'IL', nickname: 'Car' });
    const fetchJson = vi.fn(async (url: string) => {
      const where = new URL(url).searchParams.get('$where')!;
      expect(where).toBe("plate = 'ABC123'");
      return url.includes(cfg.datasets.socrata.towed)
        ? [{ tow_date: '2026-10-11T00:00:00.000', inventory_number: '1', towed_to_address: 'lot', tow_facility_phone: 'p', state: 'IL' },
          { tow_date: '2026-10-05T00:00:00.000', inventory_number: '2', towed_to_address: 'lot', state: 'WI' }]
        : [];
    });
    await checkVehicles({ fetchJson, cfg, store, nowLocal: () => '2026-10-11T10:00:00' });
    const s = store.getVehicleStatus(v.id)!;
    expect(s).toMatchObject({ ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:1', confidence: 'exact' }], otherState: [{ key: 'tow:2', recordState: 'WI' }] });
    expect(s.search).toMatchObject({ plate: 'ABC123', state: 'IL', stateCodes: ['IL'], alertSince: '2026-09-27', datasetWindowDays: 90 });
    expect(s.search!.datasets.map((d) => d.id)).toEqual([cfg.datasets.socrata.towed, cfg.datasets.socrata.relocated]);
    const failed = await checkVehicle({ fetchJson: async () => { throw new Error('down'); }, cfg, store, nowLocal: () => '2026-10-11T10:30:00' }, v);
    expect(failed).toMatchObject({ ok: false, error: 'down', checkedAt: '2026-10-11T10:30:00' });
    expect(store.getVehicleStatus(v.id)).toMatchObject({ ok: false, error: 'down', matches: [{ key: 'tow:1' }] });
  });
});
