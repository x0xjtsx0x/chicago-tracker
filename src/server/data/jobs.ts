import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import { arcgisQueryAll } from '../sources/arcgis.js';
import { socrataQueryAll } from '../sources/socrata.js';
import * as N from './normalize.js';
import type { DatasetJob } from './refresh.js';
import type { PermitDataset } from '../../shared/types.js';
import { addDays } from '../util/chicagoTime.js';

export function buildDatasetJobs(cfg: AppConfig, fetchJson: FetchJson, today: string): DatasetJob[] {
  const d = cfg.datasets;
  const arc = (layer: number) => arcgisQueryAll(fetchJson, d.arcgisBase, layer);
  const soc = (id: string, q: { where?: string; select?: string } = {}) =>
    socrataQueryAll(fetchJson, d.socrataBase, id, q, { appToken: cfg.socrataAppToken });
  const list = <T>(rows: T[]) => ({ rows, count: rows.length });
  const permitJob = (name: DatasetJob['name'], id: string, ds: PermitDataset): DatasetJob => ({
    name, run: async () => list((await soc(id, { where: N.permitWindowWhere(today) })).map((r) => N.normPermit(r, ds))),
  });
  return [
    { name: 'payBlocks', run: async () => list((await arc(d.layers.payBlocks)).map(N.normPayBlock)) },
    { name: 'payBoxes', run: async () => list((await arc(d.layers.payBoxes)).map(N.normPayBox)) },
    { name: 'cbd', run: async () => { const mp = N.normCbd(await arc(d.layers.cbd)); return { rows: mp, count: mp ? 1 : 0 }; } },
    { name: 'snowRoutes', run: async () => list((await arc(d.layers.snowRoutes)).map(N.normSnowRoute)) },
    { name: 'sweepSchedule', run: async () => list((await soc(d.socrata.sweepSchedule)).map(N.normSweepRow)) },
    { name: 'sweepZones', run: async () => list((await soc(d.socrata.sweepZones)).map(N.normSweepZone).filter((z) => z !== null)) },
    { name: 'permitZones', run: async () => list((await soc(d.socrata.permitZones, { where: "status = 'ACTIVE'" })).map(N.normPermitZone).filter((z) => z !== null)) },
    permitJob('permitsClosures', d.socrata.permitsClosures, 'closures'),
    permitJob('permitsCurrent', d.socrata.permitsCurrent, 'current'),
    permitJob('permitsBlockParty', d.socrata.permitsBlockParty, 'blockparty'),
    permitJob('permitsFilming', d.socrata.permitsFilming, 'filming'),
    { name: 'specialEvents', run: async () => list((await soc(d.socrata.specialEvents, { where: `date >= '${addDays(today, -1)}T00:00:00'` })).map(N.normEvent)) },
  ];
}
