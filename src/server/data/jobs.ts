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
  // Only the columns normPermit reads. The Current-and-Future dataset is ~50k rows in the 60-day
  // window and has ~45 columns; fetching them all is ~100 MB per nightly refresh on a small box.
  // Every column here exists in all four CDOT permit datasets (verified 2026-10-11) except
  // uniquekey, which filming permits lack, so it is requested only where it exists.
  const permitJob = (name: DatasetJob['name'], id: string, ds: PermitDataset): DatasetJob => ({
    name, guard: 'windowed',
    run: async () => list((await soc(id, { where: N.permitWindowWhere(today), select: N.permitSelect(ds) })).map((r) => N.normPermit(r, ds))),
  });
  return [
    { name: 'payBlocks', run: async () => list((await arc(d.layers.payBlocks)).map(N.normPayBlock)) },
    { name: 'payBoxes', run: async () => list((await arc(d.layers.payBoxes)).map(N.normPayBox)) },
    { name: 'cbd', run: async () => { const mp = N.normCbd(await arc(d.layers.cbd)); return { rows: mp, count: mp ? 1 : 0 }; } },
    // The 2-inch snow ban streets. docs/DATA-FACTS.md: the Socrata restriction dataset is the ban
    // list; ArcGIS layer 50 "Main Snow Routes" is the much larger plow-route network.
    { name: 'snowRoutes', run: async () => d.snowRouteSource.startsWith('socrata:')
      ? list((await soc(d.socrata.snowRoutes, { select: 'objectid,on_street,from_stree,to_street,restrict_t,the_geom', where: "restrict_t = '2 INCH'" })).map(N.normSnowRouteRow).filter((r) => r !== null))
      : list((await arc(d.layers.snowRoutes)).map(N.normSnowRoute)) },
    { name: 'sweepSchedule', run: async () => list((await soc(d.socrata.sweepSchedule)).map(N.normSweepRow)) },
    { name: 'sweepZones', run: async () => list((await soc(d.socrata.sweepZones)).map(N.normSweepZone).filter((z) => z !== null)) },
    { name: 'permitZones', run: async () => list((await soc(d.socrata.permitZones, { where: "status = 'ACTIVE'" })).map(N.normPermitZone).filter((z) => z !== null)) },
    permitJob('permitsClosures', d.socrata.permitsClosures, 'closures'),
    permitJob('permitsCurrent', d.socrata.permitsCurrent, 'current'),
    permitJob('permitsBlockParty', d.socrata.permitsBlockParty, 'blockparty'),
    permitJob('permitsFilming', d.socrata.permitsFilming, 'filming'),
    { name: 'specialEvents', guard: 'windowed', run: async () => list((await soc(d.socrata.specialEvents, { where: `date >= '${addDays(today, -1)}T00:00:00'` })).map(N.normEvent)) },
  ];
}
