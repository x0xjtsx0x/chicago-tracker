import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildParking } from '../src/server/domain/parking.js';
import { matchPermitZones } from '../src/server/domain/permitZones.js';
import { buildSweepIndex, sweepInfo, zoneCandidates } from '../src/server/domain/sweeping.js';
import { loadConfig } from '../src/server/config.js';

const fx = (n: string) => JSON.parse(readFileSync(`test/fixtures/${n}.json`, 'utf8'));
const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

// Fixtures are captured live by `npm run capture-fixtures`. Without them this suite skips, so the
// rest of `npx vitest run` stays green on a checkout that has none.
describe.skipIf(!existsSync('test/fixtures/payBlocks.westloop.json'))('real-data fixtures', () => {
  it('West Loop parking returns blocks inside the radius with sane fields', () => {
    const r = buildParking({
      snap: { payBlocks: fx('payBlocks.westloop'), payBoxes: fx('payBoxes.westloop'), cbd: null, snowRoutes: [], sweepSchedule: [], sweepZones: [], permitZones: [], permits: [], events: [] },
      center: [-87.6470, 41.8845], radiusM: 400, at: '2026-10-13T10:00:00', rates: cfg.rates, closureRedPattern: cfg.datasets.closureRedPattern,
      sweepIdx: new Map(), permitZones: [], warnings: [], dataAsOf: {},
    });
    expect(r.blocks.length).toBeGreaterThan(5);
    for (const b of r.blocks) {
      expect(b.distanceM).toBeLessThanOrEqual(400);
      expect(b.payArea).toBeGreaterThan(0);
      expect(['loop', 'cbd', 'westloop', 'neighborhood']).toContain(b.rate.tier);
    }
    expect(r.blocks.filter((b) => b.hourLimit).length / r.blocks.length).toBeGreaterThan(0.8);
  });
  it('Wilson Ave parcels match at least one residential permit zone', () => {
    expect(matchPermitZones(fx('parcels.wilson'), fx('permitZones.wilson')).length).toBeGreaterThan(0);
  });
  it('a Ward 47 point resolves to a zone with dates', () => {
    const zones = fx('sweepZones.ward47');
    const idx = buildSweepIndex(fx('sweepSchedule.ward47'), cfg.datasets.sweepingYear);
    const c = zoneCandidates(zones, [-87.6890, 41.9660]);
    expect(c.length).toBeGreaterThan(0);
    expect(sweepInfo(idx, [c[0].wardSection], '2026-04-01', cfg.datasets.sweepingYear).upcoming.length).toBeGreaterThan(0);
  });
});
