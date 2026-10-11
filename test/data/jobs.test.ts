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
      await jobs.find((j) => j.name === name)!.run();
      expect(new URL(urls[0]).searchParams.get('$where')).toContain("applicationenddate >= '2026-10-10T00:00:00'");
    }
  });
});
