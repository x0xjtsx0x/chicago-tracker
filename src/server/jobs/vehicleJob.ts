import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import { socrataQueryAll, soqlStr } from '../sources/socrata.js';
import { mapRelocated, mapTowed } from '../domain/vehicles.js';
import { addDays, datePart } from '../util/chicagoTime.js';

/** Queries only the saved plates (never mirrors the datasets). A failed check is recorded as ok=false, never as "not towed". */
export async function checkVehicles(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void> {
  const now = d.nowLocal();
  const since = `${addDays(datePart(now), -14)}T00:00:00`;
  const s = d.cfg.datasets.socrata;
  for (const v of d.store.listAllVehicles()) {
    const who = `plate = ${soqlStr(v.plate)} AND state = ${soqlStr(v.state)}`;
    try {
      const [towed, reloc] = await Promise.all([
        socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, s.towed, { where: `${who} AND tow_date >= '${since}'` }, { appToken: d.cfg.socrataAppToken }),
        socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, s.relocated, { where: `${who} AND relocated_date >= '${since}'` }, { appToken: d.cfg.socrataAppToken }),
      ]);
      d.store.setVehicleStatus({ vehicleId: v.id, checkedAt: now, ok: true, matches: [...towed.map(mapTowed), ...reloc.map(mapRelocated)], error: null });
    } catch (e) {
      const prev = d.store.getVehicleStatus(v.id);
      d.store.setVehicleStatus({ vehicleId: v.id, checkedAt: now, ok: false, matches: prev?.matches ?? [], error: (e as Error).message });
    }
  }
}
