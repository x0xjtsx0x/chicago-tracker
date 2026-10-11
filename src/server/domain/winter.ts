import type { LngLat, NwsAlert, SnowRoute } from '../../shared/types.js';
import { bboxNear, distToPathsM } from './geo.js';

export const WINTER_EVENT_RE = /^(Winter Storm Warning|Winter Storm Watch|Blizzard Warning|Winter Weather Advisory|Ice Storm Warning|Extreme Cold Warning|Wind Chill Warning)$/;
export const BAN_THRESHOLD_MM = 50.8; // 2 inches

export const onSnowRoute = (routes: SnowRoute[], p: LngLat, maxM = 25): boolean =>
  routes.some((r) => bboxNear(r.bbox, p, maxM) && distToPathsM(p, r.paths) <= maxM);

export function parseAlerts(geojson: any): NwsAlert[] {
  return (geojson?.features ?? []).map((f: any) => ({
    id: String(f.properties?.id ?? f.id), event: String(f.properties?.event ?? ''),
    headline: String(f.properties?.headline ?? f.properties?.event ?? ''), severity: String(f.properties?.severity ?? ''),
    ends: f.properties?.ends ?? f.properties?.expires ?? null,
  }));
}

export function parseIsoDurationMs(s: string): number {
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return 0;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/** Sum NWS gridpoint snowfallAmount (mm) over [now, now + 24h], prorating intervals that only partly overlap. */
export function snowNext24hMm(values: { validTime: string; value: number | null }[], nowMs: number): number {
  const end = nowMs + 24 * 3600e3;
  let total = 0;
  for (const v of values) {
    if (!v.value) continue;
    const [start, dur] = v.validTime.split('/');
    const s = Date.parse(start), e = s + parseIsoDurationMs(dur ?? 'PT1H');
    const overlap = Math.max(0, Math.min(e, end) - Math.max(s, nowMs));
    if (overlap > 0 && e > s) total += v.value * (overlap / (e - s));
  }
  return total;
}
