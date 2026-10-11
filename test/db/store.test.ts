import { describe, it, expect, beforeEach } from 'vitest';
import { openStore, type Store } from '../../src/server/db/store.js';

let s: Store;
beforeEach(() => { s = openStore(':memory:'); });

describe('store', () => {
  it('upserts users with a long random cal token, a high-entropy ntfy topic and default prefs', () => {
    const u = s.upsertUser('me@x', 'Me');
    expect(u.calToken.length).toBeGreaterThanOrEqual(32);
    expect(u.ntfyTopic).toMatch(/^ct-[a-z2-7]{26,}$/);
    expect(u.navApp).toBe('apple');
    expect(u.notifyPrefs.enabled.vehicle).toBe(true);
    expect(s.upsertUser('me@x', 'Me Again').id).toBe(u.id);
    expect(s.getUserByCalToken(u.calToken)?.id).toBe(u.id);
  });
  it('rotating the cal token invalidates the old one', () => {
    const u = s.upsertUser('me@x', 'Me');
    const t = s.rotateCalToken(u.id);
    expect(t).not.toBe(u.calToken);
    expect(s.getUserByCalToken(u.calToken)).toBeNull();
  });
  it('isolates places between users', () => {
    const a = s.upsertUser('a@x', 'A'); const b = s.upsertUser('b@x', 'B');
    const p = s.createPlace(a.id, { kind: 'home', label: 'Home', address: '1 N State', lat: 41.88, lon: -87.62, radiusM: 300, zones: ['0101'] });
    expect(s.listPlaces(a.id)).toHaveLength(1);
    expect(s.listPlaces(b.id)).toHaveLength(0);
    expect(s.getPlace(b.id, p.id)).toBeNull();
    expect(s.updatePlace(b.id, p.id, { label: 'x' })).toBeNull();
    expect(s.deletePlace(b.id, p.id)).toBe(false);
    expect(s.updatePlace(a.id, p.id, { zones: ['0101', '0102'] })?.zones).toEqual(['0101', '0102']);
  });
  it('vehicles + status, deleted with the vehicle', () => {
    const a = s.upsertUser('a@x', 'A');
    const v = s.createVehicle(a.id, { plate: 'ABC123', state: 'IL', nickname: 'Car' });
    s.setVehicleStatus({ vehicleId: v.id, checkedAt: '2026-10-11T10:00:00', ok: true, matches: [], error: null });
    expect(s.getVehicleStatus(v.id)?.ok).toBe(true);
    expect(s.deleteVehicle(a.id, v.id)).toBe(true);
    expect(s.getVehicleStatus(v.id)).toBeNull();
  });
  it('datasets, kv, notifications', () => {
    s.saveDataset('payBlocks', [{ a: 1 }], 1, '2026-10-11T03:30:00');
    expect(s.loadDataset<any[]>('payBlocks')).toEqual([{ a: 1 }]);
    expect(s.getDatasetMeta('payBlocks')).toMatchObject({ rowCount: 1, status: 'ok', error: null });
    s.markDatasetError('payBlocks', 'boom');
    expect(s.getDatasetMeta('payBlocks')).toMatchObject({ rowCount: 1, status: 'error', error: 'boom' });
    expect(s.loadDataset<any[]>('payBlocks')).toEqual([{ a: 1 }]);
    s.kvSet('k', { x: 1 }, 't'); expect(s.kvGet<{ x: number }>('k')?.value.x).toBe(1);
    s.kvDelete('k'); expect(s.kvGet('k')).toBeNull();
    const u = s.upsertUser('a@x', 'A');
    expect(s.wasNotified(u.id, 'k1')).toBe(false);
    s.markNotified(u.id, 'k1', 't'); expect(s.wasNotified(u.id, 'k1')).toBe(true);
  });
});
