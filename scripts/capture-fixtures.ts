// Live: captures small real snapshots (public city data) into test/fixtures/ for test/fixtures.test.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/server/config.js';
import { createFetchJson } from '../src/server/http/fetchJson.js';
import { arcgisQueryNear } from '../src/server/sources/arcgis.js';
import { socrataQueryAll } from '../src/server/sources/socrata.js';
import * as N from '../src/server/data/normalize.js';

const cfg = loadConfig({ OWNER_LOGIN: 'x', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'fixtures' }, 'config');
const fj = createFetchJson({ userAgent: cfg.cityUserAgent });
const d = cfg.datasets;
const WEST_LOOP: [number, number] = [-87.6470, 41.8845];
const WILSON: [number, number] = [-87.6656, 41.9654]; // ~1400 W Wilson Ave (permit zone 1130)
mkdirSync('test/fixtures', { recursive: true });
const save = (name: string, rows: unknown[]) => { writeFileSync(`test/fixtures/${name}.json`, JSON.stringify(rows)); console.log(`${name}: ${rows.length}`); };

save('payBlocks.westloop', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.payBlocks, WEST_LOOP, 600)).map(N.normPayBlock));
save('payBoxes.westloop', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.payBoxes, WEST_LOOP, 600)).map(N.normPayBox));
save('parcels.wilson', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.parcels, WILSON, 150, { outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE' })).map(N.normParcel).filter(Boolean));
save('permitZones.wilson', (await socrataQueryAll(fj, d.socrataBase, d.socrata.permitZones, { where: "status = 'ACTIVE' AND street_name = 'WILSON'" })).map(N.normPermitZone).filter(Boolean));
save('sweepZones.ward47', (await socrataQueryAll(fj, d.socrataBase, d.socrata.sweepZones, { where: "ward = '47'" })).map(N.normSweepZone).filter(Boolean));
save('sweepSchedule.ward47', (await socrataQueryAll(fj, d.socrataBase, d.socrata.sweepSchedule, { where: "ward = '47'" })).map(N.normSweepRow));
