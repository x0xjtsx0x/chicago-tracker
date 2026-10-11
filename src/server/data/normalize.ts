import type { ArcFeature } from '../sources/arcgis.js';
import type {
  LngLat, MultiPolygonCoords, Parcel, PayBlock, PayBox, Permit, PermitDataset, PermitZoneRow,
  Request311, SnowRoute, SpecialEvent, SweepRow, SweepZone,
} from '../../shared/types.js';
import { bboxOf, centroidOfRing } from '../domain/geo.js';
import { addDays, normalizeSocrataTs } from '../util/chicagoTime.js';

export const pad2 = (s: string | number): string => String(s).trim().padStart(2, '0');
const dot = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '.' || String(v).trim() === '' ? null : String(v).trim());
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();
function latLon(lat: unknown, lon: unknown): LngLat | null {
  const a = Number(lat), b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0 ? [b, a] : null;
}

export function normPayBlock(f: ArcFeature): PayBlock {
  const a = f.attributes;
  const paths = (f.geometry?.paths ?? []) as LngLat[][];
  return {
    blockId: String(a.BLOCK_ID), street: String(a.STREET_NAME ?? ''), from: num(a.BLOCK_START), to: num(a.BLOCK_END),
    parity: String(a.PARITY ?? ''), spaces: num(a.NUM_SPACES), hourLimit: dot(a.HOUR_LIMIT), payZone: num(a.PAY_ZONE),
    payArea: num(a.PAY_AREA), sundayHours: dot(a.SUNDAY_HOURS), paths, bbox: bboxOf(paths.flat()),
  };
}

export function normPayBox(f: ArcFeature): PayBox {
  const a = f.attributes;
  return {
    terminalId: num(a.TERMINAL_ID), street: String(a.STREET_NAME ?? ''), from: num(a.BLOCK_START), to: num(a.BLOCK_END),
    addr: num(a.PAYBOX_ADDR), spaces: num(a.NUM_SPACES), hourLimit: dot(a.HOUR_LIMIT), payZone: num(a.PAY_ZONE),
    payArea: num(a.PAY_AREA), point: [num(f.geometry?.x), num(f.geometry?.y)],
  };
}

export function normCbd(fs: ArcFeature[]): MultiPolygonCoords | null {
  const rings = fs.flatMap((f) => (f.geometry?.rings ?? []) as LngLat[][]);
  return rings.length ? [rings] : null;
}

export function normSnowRoute(f: ArcFeature): SnowRoute {
  const paths = (f.geometry?.paths ?? []) as LngLat[][];
  return { id: String(f.attributes.SNOW_RTE ?? f.attributes.OBJECTID), paths, bbox: bboxOf(paths.flat()) };
}

export function normParcel(f: ArcFeature): Parcel | null {
  const ring = f.geometry?.rings?.[0] as LngLat[] | undefined;
  const a = f.attributes;
  if (!ring?.length || !a.ST_NAME) return null;
  return { low: num(a.L_ADDR), high: num(a.H_ADDR || a.L_ADDR), dir: up(a.PRE_DIR), name: up(a.ST_NAME), type: up(a.ST_TYPE), centroid: centroidOfRing(ring) };
}

export function normSweepZone(row: any): SweepZone | null {
  const g = row.the_geom;
  if (!g?.coordinates) return null;
  const polygon: MultiPolygonCoords = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const wardSection = row.ward && row.section ? pad2(row.ward) + pad2(row.section) : String(row.ward_section ?? '').trim();
  return { wardSection, ward: pad2(row.ward ?? wardSection.slice(0, 2)), section: pad2(row.section ?? wardSection.slice(2)), polygon, bbox: bboxOf(polygon.flat(2)) };
}

export function normSweepRow(row: any): SweepRow {
  const ws = String(row.ward_section_concatenated ?? (pad2(row.ward) + pad2(row.section)));
  const days = String(row.dates ?? '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);
  return { wardSection: ws, month: num(row.month_number), days };
}

export function normPermitZone(row: any): PermitZoneRow | null {
  if (up(row.status) !== 'ACTIVE') return null;
  const oe = up(row.odd_even);
  return {
    zone: String(row.zone), oddEven: oe === 'O' || oe === 'E' ? oe : 'B',
    low: num(row.address_range_low), high: num(row.address_range_high),
    dir: up(row.street_direction), name: up(row.street_name), type: up(row.street_type),
  };
}

export function normPermit(row: any, dataset: PermitDataset): Permit {
  const from = row.streetnumberfrom, to = row.streetnumberto;
  const num_ = from && to && from !== to ? `${from}-${to}` : from ?? '';
  const location = [num_, row.direction, row.streetname, row.suffix].filter(Boolean).join(' ') || String(row.applicationname ?? '');
  return {
    // Most CDOT permit datasets have a per-row uniquekey. Filming permits (c2az-nhru) don't: one
    // applicationnumber spans several street segments, so the id is application + segment.
    id: row.uniquekey !== undefined && row.uniquekey !== null
      ? String(row.uniquekey)
      : `${row.applicationnumber}:${from ?? ''}-${to ?? ''}:${row.direction ?? ''}:${row.streetname ?? ''}`,
    dataset,
    appType: String(row.applicationdescription ?? row.applicationtype ?? ''),
    workType: String(row.worktypedescription ?? row.worktype ?? ''),
    start: normalizeSocrataTs(row.applicationstartdate), end: normalizeSocrataTs(row.applicationenddate),
    location, streetClosure: row.streetclosure ?? null, detail: row.detail ?? null, comments: row.comments ?? null,
    meterBagging: up(row.parkingmeterpostingorbagging) === 'Y',
    applicant: String(row.primarycontactlast ?? row.applicationname ?? ''),
    point: latLon(row.latitude, row.longitude),
  };
}

export function normEvent(row: any): SpecialEvent {
  const c = row.location?.coordinates;
  const date = normalizeSocrataTs(row.date).slice(0, 10);
  return {
    id: `${date}|${row.venue_address ?? ''}|${row.event_details ?? ''}`, date,
    venueAddress: String(row.venue_address ?? row.venue ?? ''), type: String(row.event_type ?? ''),
    details: String(row.event_details ?? ''), startTime: String(row.start_time ?? ''),
    point: Array.isArray(c) ? latLon(c[1], c[0]) : null,
  };
}

export function norm311(row: any): Request311 {
  return {
    id: String(row.sr_number), type: String(row.sr_type ?? ''), status: String(row.status ?? ''),
    created: normalizeSocrataTs(row.created_date), closed: normalizeSocrataTs(row.closed_date) || null,
    address: String(row.street_address ?? ''), point: latLon(row.latitude, row.longitude),
    duplicate: row.duplicate === true || String(row.duplicate).toLowerCase() === 'true',
  };
}

const PERMIT_COLUMNS = [
  'applicationnumber', 'streetnumberfrom', 'streetnumberto', 'direction', 'streetname', 'suffix', 'applicationname',
  'applicationdescription', 'applicationtype', 'worktypedescription', 'worktype', 'applicationstartdate', 'applicationenddate',
  'streetclosure', 'detail', 'comments', 'parkingmeterpostingorbagging', 'primarycontactlast', 'latitude', 'longitude',
];
/** `$select` list for a CDOT permit dataset: exactly the columns normPermit reads. */
export const permitSelect = (dataset: PermitDataset): string =>
  (dataset === 'filming' ? PERMIT_COLUMNS : ['uniquekey', ...PERMIT_COLUMNS]).join(',');

export function permitWindowWhere(today: string, daysAhead = 60): string {
  return `applicationenddate >= '${addDays(today, -1)}T00:00:00' AND applicationstartdate <= '${addDays(today, daysAhead)}T23:59:59'`;
}
