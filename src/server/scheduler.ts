import { Cron } from 'croner';
import type { AppConfig } from './config.js';
import type { DatasetMeta } from '../shared/types.js';

export function needsStartupRefresh(meta: DatasetMeta | null, nowLocal: string): boolean {
  if (!meta?.fetchedAt) return true;
  return (Date.parse(`${nowLocal}Z`) - Date.parse(`${meta.fetchedAt}Z`)) / 3_600_000 > 24;
}

export const safely = (name: string, fn: () => Promise<unknown>, log: { error: (o: object, m: string) => void }) =>
  async (): Promise<void> => { try { await fn(); } catch (e) { log.error({ job: name, err: (e as Error).message }, `${name} failed`); } };

/** All schedules run in America/Chicago; `protect` skips a run while the previous one is still going. */
export function startScheduler(cfg: AppConfig, jobs: { nightly: () => Promise<void>; every15: () => Promise<void>; every30: () => Promise<void>; every3h: () => Promise<void> }): Cron[] {
  const opts = { timezone: 'America/Chicago', protect: true };
  return [
    new Cron(cfg.refreshCron, opts, jobs.nightly),
    new Cron('*/15 * * * *', opts, jobs.every15),
    new Cron('5,35 * * * *', opts, jobs.every30),
    new Cron('10 */3 * * *', opts, jobs.every3h),
  ];
}
