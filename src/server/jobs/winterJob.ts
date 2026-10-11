import type { Store } from '../db/store.js';
import type { DataCache } from '../data/cache.js';
import type { WinterStatus } from '../../shared/types.js';
import type { createNws } from '../sources/nws.js';
import { BAN_THRESHOLD_MM, onSnowRoute } from '../domain/winter.js';
import { datePart } from '../util/chicagoTime.js';

export async function refreshWinter(d: {
  nws: ReturnType<typeof createNws>; store: Store; cache: DataCache;
  nowLocal: () => string; nowMs: () => number; includeSnowfall: boolean;
}): Promise<void> {
  const now = d.nowLocal();
  for (const p of d.store.listAllPlaces().filter((x) => x.kind === 'home')) {
    const prev = d.store.kvGet<WinterStatus>(`winter:${p.id}`)?.value;
    const status: WinterStatus = {
      placeId: p.id, label: p.label, onSnowRoute: onSnowRoute(d.cache.snap.snowRoutes, [p.lon, p.lat]),
      alerts: prev?.alerts ?? [], possibleBan: false, snowNext24hIn: prev?.snowNext24hIn ?? null, checkedAt: now, error: null,
    };
    try {
      status.alerts = await d.nws.alerts(p.lat, p.lon);
      if (d.includeSnowfall) status.snowNext24hIn = Math.round((await d.nws.snowfallMm(p.lat, p.lon, d.nowMs())) / 25.4 * 10) / 10;
    } catch (e) {
      status.error = (e as Error).message;
    }
    status.possibleBan = status.onSnowRoute && (status.snowNext24hIn ?? 0) * 25.4 >= BAN_THRESHOLD_MM;
    // `snowban:<id>` marks one storm; its `since` date is part of the push dedupe key, so a new storm pushes again.
    if (status.possibleBan) {
      if (!d.store.kvGet(`snowban:${p.id}`)) d.store.kvSet(`snowban:${p.id}`, { since: datePart(now) }, now);
    } else if (!status.error) {
      d.store.kvDelete(`snowban:${p.id}`);
    }
    d.store.kvSet(`winter:${p.id}`, status, now);
  }
}
