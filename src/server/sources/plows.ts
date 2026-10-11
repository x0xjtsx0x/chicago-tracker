import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { BBox, Plow } from '../../shared/types.js';
import { arcgisQueryAll } from './arcgis.js';
import { toChicagoLocal } from '../util/chicagoTime.js';

/** Live plow positions (layer 38), fetched on demand and cached for 2 minutes. Not mirrored. */
export function createPlowFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; nowMs?: () => number }) {
  const nowMs = d.nowMs ?? (() => Date.now());
  let memo: { at: number; key: string; plows: Plow[] } | null = null;
  return async (bbox: BBox): Promise<Plow[]> => {
    const key = bbox.map((n) => n.toFixed(3)).join(',');
    if (memo && memo.key === key && nowMs() - memo.at < 120_000) return memo.plows;
    const feats = await arcgisQueryAll(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.snowplows, {
      geometry: JSON.stringify({ xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ASSET_NAME,ASSET_TYPE,POSTING_TIME',
    });
    const now = nowMs();
    const plows = feats
      .filter((f) => typeof f.attributes.POSTING_TIME === 'number' && now - f.attributes.POSTING_TIME <= 2 * 3600e3)
      .map((f) => ({
        name: String(f.attributes.ASSET_NAME), type: String(f.attributes.ASSET_TYPE),
        postedLocal: toChicagoLocal(new Date(f.attributes.POSTING_TIME)),
        minutesAgo: Math.round((now - f.attributes.POSTING_TIME) / 60_000),
        point: [Number(f.geometry?.x), Number(f.geometry?.y)] as [number, number],
      }));
    memo = { at: now, key, plows };
    return plows;
  };
}
