import type { FetchJson } from '../http/fetchJson.js';
import type { NwsAlert } from '../../shared/types.js';
import { parseAlerts, snowNext24hMm } from '../domain/winter.js';

export function createNws(fetchJson: FetchJson, userAgent: string) {
  const headers = { 'User-Agent': userAgent, Accept: 'application/geo+json' };
  const gridUrl = new Map<string, string>();
  const key = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return {
    async alerts(lat: number, lon: number): Promise<NwsAlert[]> {
      return parseAlerts(await fetchJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers }));
    },
    async snowfallMm(lat: number, lon: number, nowMs: number): Promise<number> {
      let url = gridUrl.get(key(lat, lon));
      if (!url) {
        const pt = await fetchJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers });
        url = String(pt.properties.forecastGridData);
        gridUrl.set(key(lat, lon), url);
      }
      const grid = await fetchJson(url, { headers });
      return snowNext24hMm(grid.properties?.snowfallAmount?.values ?? [], nowMs);
    },
  };
}
