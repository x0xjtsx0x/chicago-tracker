import type { Store } from '../db/store.js';

export type DatasetName =
  | 'payBlocks' | 'payBoxes' | 'cbd' | 'snowRoutes' | 'sweepSchedule' | 'sweepZones' | 'permitZones'
  | 'permitsClosures' | 'permitsCurrent' | 'permitsBlockParty' | 'permitsFilming' | 'specialEvents';

/**
 * `guard: 'static'` (default) treats 0 rows or a >50% drop as a broken response and keeps the
 * previous copy. `guard: 'windowed'` is for date-windowed queries (permits, events) where 0 rows
 * is a legitimate answer: block parties have no rows in winter, special events have none at all,
 * and a seasonal taper is not a failure.
 */
export interface DatasetJob { name: DatasetName; guard?: 'static' | 'windowed'; run: () => Promise<{ rows: unknown; count: number }> }

export async function refreshAll(store: Store, jobs: DatasetJob[], nowLocal: string) {
  const ok: DatasetName[] = [];
  const failed: { name: DatasetName; error: string }[] = [];
  for (const job of jobs) {
    try {
      const { rows, count } = await job.run();
      const prev = store.getDatasetMeta(job.name)?.rowCount ?? 0;
      if (job.guard !== 'windowed' && (count === 0 || (prev > 0 && count < prev * 0.5))) {
        throw new Error(`suspicious row count ${count} (previous ${prev}); keeping previous data`);
      }
      store.saveDataset(job.name, rows, count, nowLocal);
      ok.push(job.name);
    } catch (e) {
      const error = (e as Error).message;
      store.markDatasetError(job.name, error);
      failed.push({ name: job.name, error });
    }
  }
  return { ok, failed };
}
