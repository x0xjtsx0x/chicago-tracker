import Database from 'better-sqlite3';
import { DEFAULT_NOTIFY_PREFS, type DatasetMeta, type NavApp, type NotifyPrefs, type Place, type User, type Vehicle, type VehicleStatus } from '../../shared/types.js';
import { randomToken, randomTopic } from '../util/random.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  cal_token TEXT NOT NULL UNIQUE, nav_app TEXT NOT NULL DEFAULT 'apple',
  ntfy_topic TEXT NOT NULL, notify_prefs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('home','watch')), label TEXT NOT NULL, address TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, radius_m INTEGER NOT NULL, zones TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate TEXT NOT NULL, state TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS vehicle_status (
  vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL, ok INTEGER NOT NULL, matches TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS datasets (
  name TEXT PRIMARY KEY, data TEXT, fetched_at TEXT, row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok', error TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications_sent (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key));
`;

export type Store = ReturnType<typeof openStore>;

/**
 * Additive, idempotent column migrations for databases created by an earlier version. Each step
 * checks the live schema first, so running it on every start (and on a fresh DB) is safe.
 */
function migrate(db: Database.Database): void {
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const v = cols('vehicles');
  // 2026-10 (UI overhaul): make/colour let the app cross-check a tow record against the owner's car.
  if (!v.has('make')) db.exec("ALTER TABLE vehicles ADD COLUMN make TEXT NOT NULL DEFAULT ''");
  if (!v.has('color')) db.exec("ALTER TABLE vehicles ADD COLUMN color TEXT NOT NULL DEFAULT ''");
  // What the last check searched, plus older and other-state records (JSON).
  if (!cols('vehicle_status').has('extra')) db.exec('ALTER TABLE vehicle_status ADD COLUMN extra TEXT');
}

export function openStore(file: string) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);

  const toUser = (r: any): User => ({
    id: r.id, login: r.login, name: r.name, calToken: r.cal_token, navApp: r.nav_app as NavApp,
    ntfyTopic: r.ntfy_topic, notifyPrefs: { ...DEFAULT_NOTIFY_PREFS, ...JSON.parse(r.notify_prefs) },
  });
  const toPlace = (r: any): Place => ({
    id: r.id, userId: r.user_id, kind: r.kind, label: r.label, address: r.address,
    lat: r.lat, lon: r.lon, radiusM: r.radius_m, zones: JSON.parse(r.zones),
  });
  const toVehicle = (r: any): Vehicle => ({ id: r.id, userId: r.user_id, plate: r.plate, state: r.state, nickname: r.nickname, make: r.make ?? '', color: r.color ?? '' });
  const toMeta = (r: any): DatasetMeta => ({ name: r.name, fetchedAt: r.fetched_at, rowCount: r.row_count, status: r.status, error: r.error });

  const store = {
    upsertUser(login: string, name: string): User {
      const existing = db.prepare('SELECT * FROM users WHERE login = ?').get(login) as any;
      if (existing) {
        // Called on every authenticated request: only write when the name actually changed.
        if (existing.name !== name) db.prepare('UPDATE users SET name = ? WHERE login = ?').run(name, login);
        return toUser({ ...existing, name });
      }
      const info = db.prepare('INSERT INTO users (login, name, cal_token, ntfy_topic, notify_prefs) VALUES (?,?,?,?,?)')
        .run(login, name, randomToken(24), randomTopic(), JSON.stringify(DEFAULT_NOTIFY_PREFS));
      return store.getUser(Number(info.lastInsertRowid))!;
    },
    getUser(id: number): User | null { const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id); return r ? toUser(r) : null; },
    getUserByLogin(login: string): User | null { const r = db.prepare('SELECT * FROM users WHERE login = ?').get(login); return r ? toUser(r) : null; },
    getUserByCalToken(token: string): User | null { const r = db.prepare('SELECT * FROM users WHERE cal_token = ?').get(token); return r ? toUser(r) : null; },
    listUsers(): User[] { return db.prepare('SELECT * FROM users ORDER BY id').all().map(toUser); },
    updateUser(id: number, patch: { navApp?: NavApp; ntfyTopic?: string; notifyPrefs?: NotifyPrefs }): User {
      if (patch.navApp) db.prepare('UPDATE users SET nav_app = ? WHERE id = ?').run(patch.navApp, id);
      if (patch.ntfyTopic) db.prepare('UPDATE users SET ntfy_topic = ? WHERE id = ?').run(patch.ntfyTopic, id);
      if (patch.notifyPrefs) db.prepare('UPDATE users SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(patch.notifyPrefs), id);
      return store.getUser(id)!;
    },
    rotateCalToken(id: number): string {
      const t = randomToken(24);
      db.prepare('UPDATE users SET cal_token = ? WHERE id = ?').run(t, id);
      return t;
    },
    listPlaces(userId: number): Place[] { return db.prepare('SELECT * FROM places WHERE user_id = ? ORDER BY kind, id').all(userId).map(toPlace); },
    listAllPlaces(): Place[] { return db.prepare('SELECT * FROM places ORDER BY id').all().map(toPlace); },
    getPlace(userId: number, id: number): Place | null {
      const r = db.prepare('SELECT * FROM places WHERE user_id = ? AND id = ?').get(userId, id); return r ? toPlace(r) : null;
    },
    createPlace(userId: number, p: Omit<Place, 'id' | 'userId'>): Place {
      const info = db.prepare('INSERT INTO places (user_id, kind, label, address, lat, lon, radius_m, zones) VALUES (?,?,?,?,?,?,?,?)')
        .run(userId, p.kind, p.label, p.address, p.lat, p.lon, p.radiusM, JSON.stringify(p.zones));
      return store.getPlace(userId, Number(info.lastInsertRowid))!;
    },
    updatePlace(userId: number, id: number, patch: Partial<Pick<Place, 'label' | 'radiusM' | 'zones'>>): Place | null {
      const cur = store.getPlace(userId, id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      db.prepare('UPDATE places SET label = ?, radius_m = ?, zones = ? WHERE id = ? AND user_id = ?')
        .run(next.label, next.radiusM, JSON.stringify(next.zones), id, userId);
      return store.getPlace(userId, id);
    },
    deletePlace(userId: number, id: number): boolean { return db.prepare('DELETE FROM places WHERE user_id = ? AND id = ?').run(userId, id).changes > 0; },
    listVehicles(userId: number): Vehicle[] { return db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY id').all(userId).map(toVehicle); },
    listAllVehicles(): Vehicle[] { return db.prepare('SELECT * FROM vehicles ORDER BY id').all().map(toVehicle); },
    getVehicle(userId: number, id: number): Vehicle | null {
      const r = db.prepare('SELECT * FROM vehicles WHERE user_id = ? AND id = ?').get(userId, id); return r ? toVehicle(r) : null;
    },
    createVehicle(userId: number, v: Omit<Vehicle, 'id' | 'userId' | 'make' | 'color'> & Partial<Pick<Vehicle, 'make' | 'color'>>): Vehicle {
      const info = db.prepare('INSERT INTO vehicles (user_id, plate, state, nickname, make, color) VALUES (?,?,?,?,?,?)')
        .run(userId, v.plate, v.state, v.nickname, v.make ?? '', v.color ?? '');
      return toVehicle(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(info.lastInsertRowid)));
    },
    /** Scoped by user_id like every other user-data query. Changing plate or state discards the old check result. */
    updateVehicle(userId: number, id: number, patch: Partial<Pick<Vehicle, 'plate' | 'state' | 'nickname' | 'make' | 'color'>>): Vehicle | null {
      const cur = store.getVehicle(userId, id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      db.prepare('UPDATE vehicles SET plate = ?, state = ?, nickname = ?, make = ?, color = ? WHERE id = ? AND user_id = ?')
        .run(next.plate, next.state, next.nickname, next.make, next.color, id, userId);
      if (next.plate !== cur.plate || next.state !== cur.state) db.prepare('DELETE FROM vehicle_status WHERE vehicle_id = ?').run(id);
      return store.getVehicle(userId, id);
    },
    deleteVehicle(userId: number, id: number): boolean { return db.prepare('DELETE FROM vehicles WHERE user_id = ? AND id = ?').run(userId, id).changes > 0; },
    setVehicleStatus(s: VehicleStatus): void {
      const extra = JSON.stringify({ search: s.search ?? null, older: s.older ?? [], otherState: s.otherState ?? [] });
      db.prepare('INSERT INTO vehicle_status (vehicle_id, checked_at, ok, matches, error, extra) VALUES (?,?,?,?,?,?) ON CONFLICT(vehicle_id) DO UPDATE SET checked_at=excluded.checked_at, ok=excluded.ok, matches=excluded.matches, error=excluded.error, extra=excluded.extra')
        .run(s.vehicleId, s.checkedAt, s.ok ? 1 : 0, JSON.stringify(s.matches), s.error, extra);
    },
    getVehicleStatus(vehicleId: number): VehicleStatus | null {
      const r: any = db.prepare('SELECT * FROM vehicle_status WHERE vehicle_id = ?').get(vehicleId);
      if (!r) return null;
      const extra = r.extra ? JSON.parse(r.extra) : {};
      return { vehicleId, checkedAt: r.checked_at, ok: !!r.ok, matches: JSON.parse(r.matches), error: r.error, search: extra.search ?? null, older: extra.older ?? [], otherState: extra.otherState ?? [] };
    },
    saveDataset(name: string, rows: unknown, rowCount: number, fetchedAt: string): void {
      db.prepare("INSERT INTO datasets (name, data, fetched_at, row_count, status, error) VALUES (?,?,?,?,'ok',NULL) ON CONFLICT(name) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at, row_count=excluded.row_count, status='ok', error=NULL")
        .run(name, JSON.stringify(rows), fetchedAt, rowCount);
    },
    loadDataset<T>(name: string): T | null {
      const r: any = db.prepare('SELECT data FROM datasets WHERE name = ?').get(name);
      return r?.data ? (JSON.parse(r.data) as T) : null;
    },
    getDatasetMeta(name: string): DatasetMeta | null {
      const r = db.prepare('SELECT name, fetched_at, row_count, status, error FROM datasets WHERE name = ?').get(name); return r ? toMeta(r) : null;
    },
    listDatasetMeta(): DatasetMeta[] { return db.prepare('SELECT name, fetched_at, row_count, status, error FROM datasets ORDER BY name').all().map(toMeta); },
    markDatasetError(name: string, error: string): void {
      db.prepare("INSERT INTO datasets (name, status, error) VALUES (?, 'error', ?) ON CONFLICT(name) DO UPDATE SET status='error', error=excluded.error").run(name, error);
    },
    kvGet<T>(key: string): { value: T; updatedAt: string } | null {
      const r: any = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key);
      return r ? { value: JSON.parse(r.value) as T, updatedAt: r.updated_at } : null;
    },
    kvSet(key: string, value: unknown, updatedAt: string): void {
      db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, JSON.stringify(value), updatedAt);
    },
    kvDelete(key: string): void { db.prepare('DELETE FROM kv WHERE key = ?').run(key); },
    wasNotified(userId: number, key: string): boolean { return !!db.prepare('SELECT 1 FROM notifications_sent WHERE user_id = ? AND key = ?').get(userId, key); },
    markNotified(userId: number, key: string, sentAt: string): void {
      db.prepare('INSERT OR IGNORE INTO notifications_sent (user_id, key, sent_at) VALUES (?,?,?)').run(userId, key, sentAt);
    },
    close(): void { db.close(); },
  };
  return store;
}
