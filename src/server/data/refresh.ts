import type { Store } from '../db/store.js';

export type DatasetName =
  | 'payBlocks' | 'payBoxes' | 'cbd' | 'snowRoutes' | 'sweepSchedule' | 'sweepZones' | 'permitZones'
  | 'permitsClosures' | 'permitsCurrent' | 'permitsBlockParty' | 'permitsFilming' | 'specialEvents';

export interface DatasetJob { name: DatasetName; run: () => Promise<{ rows: unknown; count: number }> }

export async function refreshAll(store: Store, jobs: DatasetJob[], nowLocal: string) {
  const ok: DatasetName[] = [];
  const failed: { name: DatasetName; error: string }[] = [];
  for (const job of jobs) {
    try {
      const { rows, count } = await job.run();
      const prev = store.getDatasetMeta(job.name)?.rowCount ?? 0;
      if (count === 0 || (prev > 0 && count < prev * 0.5)) {
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
