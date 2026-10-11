import type { AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import type { DataCache } from '../data/cache.js';
import type { WinterStatus } from '../../shared/types.js';
import type { PlannedPush } from './ntfy.js';
import { filterDeliverable, planPushes } from './planner.js';
import { isSweepingOn, sweepIndexFor } from '../domain/sweeping.js';
import { newWorkCandidates } from '../domain/watch.js';
import { datePart } from '../util/chicagoTime.js';

export async function runNotifier(d: {
  cfg: AppConfig; store: Store; cache: DataCache; nowLocal: () => string;
  publish: (topic: string, p: PlannedPush) => Promise<void>; sleep?: (ms: number) => Promise<void>;
}): Promise<{ sent: number; failed: number }> {
  if (!d.cfg.ntfyUrl) return { sent: 0, failed: 0 };
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.nowLocal(), today = datePart(now);
  const idx = sweepIndexFor(d.cache.snap, d.cfg.datasets.sweepingYear);
  let sent = 0, failed = 0;

  for (const user of d.store.listUsers()) {
    const homes = d.store.listPlaces(user.id).filter((p) => p.kind === 'home');

    // The first run for a home marks existing work as seen, so only work that appears later is pushed.
    const newWork = homes.flatMap((h) => {
      const items = newWorkCandidates(d.cache.snap, h, today, d.cfg.utilities);
      const seedKey = `seeded:work:${h.id}`;
      if (!d.store.kvGet(seedKey)) {
        for (const w of items) d.store.markNotified(user.id, `work:${w.id}`, now);
        d.store.kvSet(seedKey, true, now);
        return [];
      }
      return items.filter((w) => !d.store.wasNotified(user.id, `work:${w.id}`));
    });
    const uniqueWork = [...new Map(newWork.map((w) => [w.id, w])).values()];

    const pushes = planPushes({
      nowLocal: now, baseUrl: d.cfg.publicBaseUrl, homes,
      isSweeping: (ws, date) => isSweepingOn(idx, ws, date),
      vehicles: d.store.listVehicles(user.id).map((v) => ({ vehicle: v, status: d.store.getVehicleStatus(v.id) })),
      winter: homes.map((h) => {
        const ban = d.store.kvGet<{ since: string }>(`snowban:${h.id}`)?.value;
        return { place: h, status: d.store.kvGet<WinterStatus>(`winter:${h.id}`)?.value ?? null, banKey: ban ? `snowban:${h.id}:${ban.since}` : null };
      }),
      newWork: uniqueWork,
    });

    for (const p of filterDeliverable(pushes, user.notifyPrefs, now, (k) => d.store.wasNotified(user.id, k))) {
      let ok = false, lastErr = '';
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt) await sleep(2000 * 2 ** (attempt - 1));
        try { await d.publish(user.ntfyTopic, p); ok = true; } catch (e) { lastErr = (e as Error).message; }
      }
      if (ok) {
        d.store.markNotified(user.id, p.key, now);
        for (const k of p.alsoMark ?? []) d.store.markNotified(user.id, k, now);
        d.store.kvDelete('ntfy:lastError');
        sent++;
      } else {
        d.store.kvSet('ntfy:lastError', `${now}: ${lastErr}`, now);
        failed++;
      }
    }
  }
  return { sent, failed };
}
