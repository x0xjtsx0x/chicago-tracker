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

import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { describe as d2, it as i2, expect as e2 } from 'vitest';
import { openStore as open2 } from '../../src/server/db/store.js';

d2('store migration (pre-UI-overhaul database)', () => {
  i2('adds vehicle make/color and vehicle_status.extra to an existing DB without losing rows', () => {
    const file = pjoin(mkdtempSync(pjoin(tmpdir(), 'ct-mig-')), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, cal_token TEXT NOT NULL UNIQUE, nav_app TEXT NOT NULL DEFAULT 'apple', ntfy_topic TEXT NOT NULL, notify_prefs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE vehicles (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, plate TEXT NOT NULL, state TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '');
      CREATE TABLE vehicle_status (vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, matches TEXT NOT NULL, error TEXT);
      INSERT INTO users (id, login, name, cal_token, ntfy_topic, notify_prefs) VALUES (1, 'o', 'o', 'tok', 'topic', '{}');
      INSERT INTO vehicles (id, user_id, plate, state, nickname) VALUES (1, 1, 'ABC1234', 'IL', 'Car');
      INSERT INTO vehicle_status VALUES (1, '2026-10-01T10:00:00', 1, '[]', NULL);`);
    old.close();
    const s = open2(file);
    e2(s.listVehicles(1)).toEqual([{ id: 1, userId: 1, plate: 'ABC1234', state: 'IL', nickname: 'Car', make: '', color: '' }]);
    e2(s.getVehicleStatus(1)).toMatchObject({ ok: true, matches: [], search: null, older: [], otherState: [] });
    s.close();
    open2(file).close(); // idempotent on a second start
  });
});
