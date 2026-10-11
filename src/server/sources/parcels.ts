import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import type { LngLat, Parcel } from '../../shared/types.js';
import { arcgisQueryNear } from './arcgis.js';
import { normParcel } from '../data/normalize.js';

const DAY_MS = 24 * 3600 * 1000;

export function createParcelFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string; nowMs?: () => number }) {
  const nowMs = d.nowMs ?? (() => Date.now());
  return async (center: LngLat, radiusM: number): Promise<Parcel[]> => {
    const key = `parcels:${center[0].toFixed(4)},${center[1].toFixed(4)},${Math.round(radiusM)}`;
    const hit = d.store.kvGet<{ ms: number; parcels: Parcel[] }>(key);
    if (hit && nowMs() - hit.value.ms < DAY_MS) return hit.value.parcels;
    const feats = await arcgisQueryNear(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.parcels, center, radiusM, {
      outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE',
    });
    const parcels = feats.map(normParcel).filter((p): p is Parcel => p !== null);
    d.store.kvSet(key, { ms: nowMs(), parcels }, d.nowLocal());
    return parcels;
  };
}
