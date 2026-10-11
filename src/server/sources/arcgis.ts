import type { FetchJson } from '../http/fetchJson.js';
import type { LngLat } from '../../shared/types.js';

export interface ArcFeature {
  attributes: Record<string, any>;
  geometry?: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] };
}

function check(r: any): ArcFeature[] {
  if (r?.error) throw new Error(`ArcGIS error ${r.error.code}: ${r.error.message}`);
  return (r?.features ?? []) as ArcFeature[];
}

export async function arcgisQueryAll(
  fetchJson: FetchJson, base: string, layerId: number, params: Record<string, string> = {}, pageSize = 1000,
): Promise<ArcFeature[]> {
  const out: ArcFeature[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      where: '1=1', outFields: '*', returnGeometry: 'true', orderByFields: 'OBJECTID', f: 'json',
      ...params, outSR: '4326', resultOffset: String(offset), resultRecordCount: String(pageSize),
    });
    const r = await fetchJson(`${base}/${layerId}/query?${q}`);
    const feats = check(r);
    out.push(...feats);
    if (feats.length < pageSize && !r.exceededTransferLimit) break;
    if (feats.length === 0) break;
  }
  return out;
}

export async function arcgisQueryOnce(
  fetchJson: FetchJson, base: string, layerId: number, params: Record<string, string> = {},
): Promise<ArcFeature[]> {
  const q = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', f: 'json', ...params, outSR: '4326' });
  return check(await fetchJson(`${base}/${layerId}/query?${q}`));
}

export function arcgisQueryNear(
  fetchJson: FetchJson, base: string, layerId: number, center: LngLat, radiusM: number, params: Record<string, string> = {},
): Promise<ArcFeature[]> {
  return arcgisQueryAll(fetchJson, base, layerId, {
    geometry: JSON.stringify({ x: center[0], y: center[1], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    distance: String(Math.round(radiusM)), units: 'esriSRUnit_Meter', ...params,
  });
}
