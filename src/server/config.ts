import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LngLat, UtilityTag } from '../shared/types.js';

export interface DatasetsConfig {
  arcgisBase: string; socrataBase: string;
  layers: { payBlocks: number; payBoxes: number; cbd: number; snowRoutes: number; snowplows: number; parcels: number };
  socrata: {
    sweepSchedule: string; sweepZones: string; permitsClosures: string; permitsCurrent: string;
    permitsBlockParty: string; permitsFilming: string; specialEvents: string; permitZones: string;
    towed: string; relocated: string; requests311: string;
  };
  sweepingYear: number; snowRouteSource: string; closureRedPattern: string; sundayHoursVerified: boolean;
}
interface TierCfg { hourly: number; hoursText: string }
export interface RatesConfig {
  loop: TierCfg & { polygon: LngLat[][] };
  cbd: TierCfg & { fallbackPolygon: LngLat[][] };
  westloop: TierCfg & { polygon: LngLat[][] };
  neighborhood: TierCfg;
}
export interface UtilitiesConfig { tags: { tag: Exclude<UtilityTag, null>; patterns: string[] }[]; comedOutageUrl: string; }

export interface AppConfig {
  port: number; host: string; dataDir: string;
  ownerLogin: string; allowedLogins: string[]; singleUserLogin: string | null;
  publicBaseUrl: string; nominatimContact: string; socrataAppToken: string | null;
  ntfyUrl: string | null; ntfyToken: string | null; nwsUserAgent: string; refreshCron: string;
  datasets: DatasetsConfig; rates: RatesConfig; utilities: UtilitiesConfig; excluded311: string[];
}

const readJson = <T>(dir: string, file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;

export function loadConfig(env: Record<string, string | undefined> = process.env, configDir = 'config'): AppConfig {
  const missing = ['OWNER_LOGIN', 'PUBLIC_BASE_URL', 'NOMINATIM_CONTACT'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const owner = env.OWNER_LOGIN!.trim();
  const singleUserLogin = env.SINGLE_USER_LOGIN?.trim() || null;
  const allowed = new Set((env.ALLOWED_LOGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  allowed.add(owner);
  if (singleUserLogin) allowed.add(singleUserLogin);
  const contact = env.NOMINATIM_CONTACT!.trim();
  return {
    port: Number(env.PORT ?? 8787),
    // Loopback by default; the container sets HOST=0.0.0.0 and compose decides what is published.
    host: env.HOST?.trim() || '127.0.0.1',
    dataDir: env.DATA_DIR ?? './data',
    ownerLogin: owner,
    allowedLogins: [...allowed],
    singleUserLogin,
    publicBaseUrl: env.PUBLIC_BASE_URL!.replace(/\/$/, ''),
    nominatimContact: contact,
    socrataAppToken: env.SOCRATA_APP_TOKEN || null,
    // Public ntfy.sh by default (the random topic is the credential). An explicitly empty NTFY_URL disables push.
    ntfyUrl: (env.NTFY_URL ?? 'https://ntfy.sh').trim().replace(/\/$/, '') || null,
    ntfyToken: env.NTFY_TOKEN?.trim() || null,
    nwsUserAgent: env.NWS_USER_AGENT || `chicago-tracker (${contact})`,
    refreshCron: env.REFRESH_CRON || '30 3 * * *',
    datasets: readJson<DatasetsConfig>(configDir, 'datasets.json'),
    rates: readJson<RatesConfig>(configDir, 'rates.json'),
    utilities: readJson<UtilitiesConfig>(configDir, 'utilities.json'),
    excluded311: readJson<{ excludedTypes: string[] }>(configDir, '311.json').excludedTypes,
  };
}
