import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import type { GeoResult } from '../../shared/types.js';
import { arcgisQueryOnce } from './arcgis.js';
import { normParcel } from '../data/normalize.js';
import { soqlStr } from './socrata.js';

const TYPES = 'ST|AVE|BLVD|RD|DR|PL|CT|PKWY|TER|LN|WAY|HWY|SQ|PLZ|CIR|ROW|EXPY';
const VIEWBOX = '-87.9401,42.0230,-87.5240,41.6445';

export function parseChicagoAddress(q: string): { num: number; dir: string; name: string; type: string | null } | null {
  let s = q.toUpperCase().split(',')[0];
  s = s.replace(/\./g, '').replace(/\s+(APT|UNIT|STE|SUITE|FL)\s*\S+.*$/, '').replace(/\s*#\s*\S+.*$/, '');
  s = s.replace(/\s+CHICAGO\b.*$/, '').replace(/\s+/g, ' ').trim();
  const m = s.match(new RegExp(`^(\\d+)\\s+([NSEW])\\s+(.+?)(?:\\s+(${TYPES}))?$`));
  if (!m) return null;
  return { num: Number(m[1]), dir: m[2], name: m[3].trim(), type: m[4] ?? null };
}

export function createGeocoder(d: {
  fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string;
  sleep?: (ms: number) => Promise<void>; clock?: () => number;
}) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = d.clock ?? (() => Date.now());
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();

  // Nominatim usage policy: at most 1 request per second. Requests are serialized through `chain`.
  const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + 1100 - clock();
      if (wait > 0) await sleep(wait);
      last = clock();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };

  async function nominatim(q: string): Promise<GeoResult[]> {
    const p = new URLSearchParams({ q, format: 'jsonv2', limit: '5', viewbox: VIEWBOX, bounded: '1', countrycodes: 'us' });
    const rows = await throttled(() => d.fetchJson(`https://nominatim.openstreetmap.org/search?${p}`, {
      headers: { 'User-Agent': `chicago-tracker/0.1 (${d.cfg.nominatimContact})` },
    }));
    return (rows as any[]).map((r) => ({ label: String(r.display_name), lat: Number(r.lat), lon: Number(r.lon) }));
  }

  async function parcel(q: string): Promise<GeoResult[]> {
    const a = parseChicagoAddress(q);
    if (!a) return [];
    const where = [`L_ADDR <= ${a.num}`, `H_ADDR >= ${a.num}`, `PRE_DIR = ${soqlStr(a.dir)}`, `ST_NAME = ${soqlStr(a.name)}`, ...(a.type ? [`ST_TYPE = ${soqlStr(a.type)}`] : [])].join(' AND ');
    const feats = await arcgisQueryOnce(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.parcels, { where, outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE', resultRecordCount: '1' });
    const p = feats.map(normParcel).find((x) => x !== null);
    return p ? [{ label: [a.num, a.dir, a.name, a.type].filter(Boolean).join(' '), lat: p.centroid[1], lon: p.centroid[0] }] : [];
  }

  return async function geocode(q: string): Promise<GeoResult[]> {
    const key = `geocode:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const hit = d.store.kvGet<GeoResult[]>(key);
    if (hit) return hit.value;
    let res: GeoResult[] = [];
    try { res = await nominatim(q); } catch { res = []; }
    if (!res.length) { try { res = await parcel(q); } catch { res = []; } }
    if (res.length) d.store.kvSet(key, res, d.nowLocal());
    return res;
  };
}
