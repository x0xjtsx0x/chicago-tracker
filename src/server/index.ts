import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openStore } from './db/store.js';
import { DataCache } from './data/cache.js';
import { buildDatasetJobs } from './data/jobs.js';
import { refreshAll } from './data/refresh.js';
import { createFetchJson } from './http/fetchJson.js';
import { createGeocoder } from './sources/nominatim.js';
import { createParcelFetcher } from './sources/parcels.js';
import { createPlowFetcher } from './sources/plows.js';
import { createNws } from './sources/nws.js';
import { checkVehicles } from './jobs/vehicleJob.js';
import { refresh311 } from './jobs/requests311Job.js';
import { refreshWinter } from './jobs/winterJob.js';
import { publishNtfy } from './notify/ntfy.js';
import { runNotifier } from './notify/runner.js';
import { buildApp } from './app.js';
import { needsStartupRefresh, safely, startScheduler } from './scheduler.js';
import { chicagoNow, datePart } from './util/chicagoTime.js';
import type { Services } from './services.js';

async function main() {
  const cfg = loadConfig();
  mkdirSync(cfg.dataDir, { recursive: true });
  const store = openStore(join(cfg.dataDir, 'chicago-tracker.db'));
  const cache = new DataCache(store);
  const nowLocal = () => chicagoNow();
  const fetchJson = createFetchJson({ userAgent: cfg.nwsUserAgent });
  const nws = createNws(fetchJson, cfg.nwsUserAgent);
  const publish = (topic: string, p: Parameters<typeof publishNtfy>[3]) => publishNtfy(fetch, { url: cfg.ntfyUrl!, token: cfg.ntfyToken }, topic, p);

  const refreshNow = async () => {
    const r = await refreshAll(store, buildDatasetJobs(cfg, fetchJson, datePart(nowLocal())), nowLocal());
    cache.reload();
    return r;
  };
  const services: Services = {
    geocode: createGeocoder({ fetchJson, cfg, store, nowLocal }),
    parcelsNear: createParcelFetcher({ fetchJson, cfg, store, nowLocal }),
    plows: createPlowFetcher({ fetchJson, cfg }),
    refreshNow,
    checkVehicles: () => checkVehicles({ fetchJson, cfg, store, nowLocal }),
    sendTestPush: async (user) => {
      if (!cfg.ntfyUrl) throw new Error('Push is disabled (NTFY_URL is empty)');
      await publish(user.ntfyTopic, { title: '✅ Chicago Tracker test', message: 'Push notifications are working.', priority: 'default', click: `${cfg.publicBaseUrl}/#/settings` });
    },
  };

  const app = await buildApp({ cfg, store, cache, services, nowLocal });
  const log = app.log;
  const notify = () => runNotifier({ cfg, store, cache, nowLocal, publish });
  const winter = (includeSnowfall: boolean) => refreshWinter({ nws, store, cache, nowLocal, nowMs: () => Date.now(), includeSnowfall });

  startScheduler(cfg, {
    nightly: safely('nightly-refresh', async () => { const r = await refreshNow(); log.info({ ok: r.ok.length, failed: r.failed }, 'refresh done'); }, log),
    every15: safely('winter+notify', async () => { await winter(false); await notify(); }, log),
    every30: safely('vehicles+311', async () => { await services.checkVehicles(); await refresh311({ fetchJson, cfg, store, nowLocal }); }, log),
    every3h: safely('snowfall', () => winter(true), log),
  });

  await app.listen({ port: cfg.port, host: cfg.host });
  log.info({ mode: cfg.singleUserLogin ? 'single-user' : 'tailscale-headers' }, 'identity mode');
  if (needsStartupRefresh(store.getDatasetMeta('payBlocks'), nowLocal())) {
    void safely('startup-refresh', async () => { await refreshNow(); await winter(true); }, log)();
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); store.close(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
