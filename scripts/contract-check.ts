// Live check that every source still has the fields we depend on. Exits 1 on schema drift.
// Also prints the facts the deployer records (SUNDAY_HOURS, PAY_ZONE, streetclosure values).
import { loadConfig } from '../src/server/config.js';
import { createFetchJson } from '../src/server/http/fetchJson.js';

const cfg = loadConfig({ OWNER_LOGIN: 'x', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: process.env.NOMINATIM_CONTACT ?? 'contract-check' }, 'config');
const fj = createFetchJson({ userAgent: cfg.cityUserAgent });
const d = cfg.datasets;
let failed = false;
const need = (what: string, have: string[], want: string[]) => {
  const missing = want.filter((w) => !have.includes(w));
  console.log(`${missing.length ? '✗' : '✓'} ${what}${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  if (missing.length) failed = true;
};

const SOCRATA: [keyof typeof d.socrata, string[]][] = [
  ['sweepSchedule', ['ward_section_concatenated', 'month_number', 'dates']],
  ['sweepZones', ['the_geom', 'ward', 'section']],
  ['permitsClosures', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'streetclosure', 'parkingmeterpostingorbagging', 'latitude', 'longitude', 'primarycontactlast']],
  ['permitsCurrent', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude', 'primarycontactlast']],
  ['permitsBlockParty', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude']],
  ['permitsFilming', ['applicationnumber', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude']],
  ['specialEvents', ['date', 'venue_address', 'event_type', 'event_details', 'location']],
  ['permitZones', ['status', 'zone', 'odd_even', 'address_range_low', 'address_range_high', 'street_direction', 'street_name', 'street_type']],
  ['towed', ['tow_date', 'plate', 'state', 'towed_to_address', 'tow_facility_phone', 'inventory_number']],
  ['relocated', ['relocated_date', 'plate', 'state', 'relocated_reason', 'relocated_to_street_name', 'service_request_number']],
  ['requests311', ['sr_number', 'sr_type', 'status', 'created_date', 'duplicate', 'latitude', 'longitude', 'location']],
  ['snowRoutes', ['the_geom', 'on_street', 'restrict_t']],
];
for (const [k, fields] of SOCRATA) {
  const v = await fj(`https://data.cityofchicago.org/api/views/${d.socrata[k]}.json`);
  need(`socrata ${k} (${d.socrata[k]}) "${v.name}" updated ${new Date(v.rowsUpdatedAt * 1000).toISOString().slice(0, 10)}`, v.columns.map((c: any) => c.fieldName), fields);
}
const LAYERS: [keyof typeof d.layers, string[]][] = [
  ['payBlocks', ['BLOCK_ID', 'STREET_NAME', 'BLOCK_START', 'BLOCK_END', 'NUM_SPACES', 'HOUR_LIMIT', 'PAY_AREA', 'SUNDAY_HOURS']],
  ['payBoxes', ['TERMINAL_ID', 'STREET_NAME', 'HOUR_LIMIT', 'PAY_AREA']],
  ['cbd', ['NAME']], ['snowplows', ['ASSET_NAME', 'ASSET_TYPE', 'POSTING_TIME']],
  ['parcels', ['L_ADDR', 'H_ADDR', 'PRE_DIR', 'ST_NAME', 'ST_TYPE']],
];
for (const [k, fields] of LAYERS) {
  const l = await fj(`${d.arcgisBase}/${d.layers[k]}?f=json`);
  need(`arcgis ${k} (${d.layers[k]}) "${l.name}"`, l.fields.map((f: any) => f.name), fields);
}

console.log('\n--- Facts to record in config/datasets.json / deploy notes ---');
const stat = async (layer: number, field: string) =>
  (await fj(`${d.arcgisBase}/${layer}/query?where=1%3D1&returnGeometry=false&groupByFieldsForStatistics=${field}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]))}&f=json`))
    .features.map((f: any) => `${f.attributes[field]}=${f.attributes.n ?? f.attributes.N}`).join(', ');
console.log(`SUNDAY_HOURS distribution: ${await stat(d.layers.payBlocks, 'SUNDAY_HOURS')}`);
console.log(`PAY_ZONE distribution: ${await stat(d.layers.payBlocks, 'PAY_ZONE')}`);
const sc = await fj(`${d.socrataBase}/${d.socrata.permitsClosures}.json?$select=streetclosure,count(*)&$group=streetclosure&$order=count(*) DESC`);
console.log(`streetclosure values: ${sc.map((r: any) => `${r.streetclosure ?? '(null)'}=${r.count}`).join(', ')}`);
console.log(`current closureRedPattern: /${d.closureRedPattern}/i — adjust so only values that block curb parking match.`);
process.exit(failed ? 1 : 0);
