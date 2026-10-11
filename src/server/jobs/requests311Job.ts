import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import { socrataQueryAll } from '../sources/socrata.js';
import { norm311 } from '../data/normalize.js';
import { addDays, datePart } from '../util/chicagoTime.js';

export async function refresh311(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void> {
  const since = `${addDays(datePart(d.nowLocal()), -30)}T00:00:00`;
  for (const p of d.store.listAllPlaces()) {
    try {
      const rows = await socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, d.cfg.datasets.socrata.requests311, {
        select: 'sr_number,sr_type,status,created_date,closed_date,street_address,duplicate,latitude,longitude',
        where: `within_circle(location, ${p.lat}, ${p.lon}, ${p.radiusM}) AND created_date >= '${since}'`,
        order: 'created_date DESC',
      }, { appToken: d.cfg.socrataAppToken, pageSize: 1000 });
      d.store.kvSet(`311:${p.id}`, rows.map(norm311), d.nowLocal());
    } catch (e) {
      d.store.kvSet(`311err:${p.id}`, (e as Error).message, d.nowLocal());
    }
  }
}
