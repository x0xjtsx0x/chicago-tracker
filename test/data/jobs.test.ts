import { describe, it, expect } from 'vitest';
import { buildDatasetJobs } from '../../src/server/data/jobs.js';
import { loadConfig } from '../../src/server/config.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('buildDatasetJobs', () => {
  it('defines all 12 mirrored datasets, and permit jobs are always date-filtered', async () => {
    const urls: string[] = [];
    const jobs = buildDatasetJobs(cfg, async (u: string) => { urls.push(u); return []; }, '2026-10-11');
    expect(jobs.map((j) => j.name).sort()).toEqual(['cbd', 'payBlocks', 'payBoxes', 'permitZones', 'permitsBlockParty', 'permitsClosures', 'permitsCurrent', 'permitsFilming', 'snowRoutes', 'specialEvents', 'sweepSchedule', 'sweepZones']);
    for (const name of ['permitsClosures', 'permitsCurrent', 'permitsBlockParty', 'permitsFilming']) {
      urls.length = 0;
      const job = jobs.find((j) => j.name === name)!;
      await job.run();
      const p = new URL(urls[0]).searchParams;
      expect(p.get('$where')).toContain("applicationenddate >= '2026-10-10T00:00:00'");
      // Only the columns normPermit reads (the Current-and-Future set is ~50k rows × ~45 columns).
      const select = p.get('$select')!.split(',');
      expect(select).toContain('applicationstartdate');
      expect(select).toContain('parkingmeterpostingorbagging');
      expect(select).not.toContain('totalfees');
      expect(select.includes('uniquekey')).toBe(name !== 'permitsFilming'); // filming permits have no uniquekey column
      // Date-windowed queries legitimately return 0 rows (block parties in winter), so no row-count guard.
      expect(job.guard).toBe('windowed');
    }
    expect(jobs.find((j) => j.name === 'specialEvents')!.guard).toBe('windowed');
    for (const name of ['payBlocks', 'sweepSchedule', 'permitZones', 'snowRoutes']) expect(jobs.find((j) => j.name === name)!.guard).toBeUndefined();
  });
});
