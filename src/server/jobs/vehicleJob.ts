import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import type { Vehicle, VehicleStatus } from '../../shared/types.js';
import { socrataQueryAll, soqlStr } from '../sources/socrata.js';
import { classifyMatches, describeSearch, mapRelocated, mapTowed } from '../domain/vehicles.js';
import { addDays, datePart } from '../util/chicagoTime.js';

type Deps = { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string };

/** Alerts cover the last 14 days (spec §4.7); older rows in the ~90-day datasets are history only. */
export const ALERT_DAYS = 14;

/**
 * Look one plate up in both city datasets and store the result. The query is by plate only (any
 * state), so a record filed under a different state, or with no state at all, is surfaced instead
 * of silently producing a false "not towed". A failed check is recorded as ok=false, never as "not towed".
 */
export async function checkVehicle(d: Deps, v: Vehicle): Promise<VehicleStatus> {
  const now = d.nowLocal();
  const alertSince = addDays(datePart(now), -ALERT_DAYS);
  const s = d.cfg.datasets.socrata;
  const search = describeSearch(v, s, alertSince);
  const where = `plate = ${soqlStr(v.plate)}`;
  const q = (id: string, order: string) =>
    socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, id, { where, order }, { appToken: d.cfg.socrataAppToken, pageSize: 200 });
  let status: VehicleStatus;
  try {
    const [towed, reloc] = await Promise.all([q(s.towed, 'tow_date DESC'), q(s.relocated, 'relocated_date DESC')]);
    status = { vehicleId: v.id, checkedAt: now, ok: true, error: null, search, ...classifyMatches(v, [...towed.map(mapTowed), ...reloc.map(mapRelocated)], alertSince) };
  } catch (e) {
    const prev = d.store.getVehicleStatus(v.id);
    status = { vehicleId: v.id, checkedAt: now, ok: false, matches: prev?.matches ?? [], older: prev?.older ?? [], otherState: prev?.otherState ?? [], error: (e as Error).message, search };
  }
  d.store.setVehicleStatus(status);
  return status;
}

/** Queries only the saved plates (never mirrors the datasets). */
export async function checkVehicles(d: Deps): Promise<void> {
  for (const v of d.store.listAllVehicles()) await checkVehicle(d, v);
}
