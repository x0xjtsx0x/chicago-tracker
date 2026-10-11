# Chicago Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tailnet-only personal web app (PWA) for Chicago street-sweeping reminders (calendar feed), metered street-parking search on a map, nearby street-work/311/event watch, tow/relocation checks, winter alerts, and ntfy push notifications.

**Architecture:** One Node.js + TypeScript container: a Fastify API that mirrors City of Chicago open data (ArcGIS MapServer + Socrata) into SQLite, holds it in memory for spatial queries with turf, and serves a Vite-built vanilla-TS + Leaflet web app. Identity comes from `tailscale serve` headers. Push goes to ntfy using JSON publishing.

**Tech Stack:** Node 24 LTS, TypeScript 5 (ESM, NodeNext), Fastify 5, @fastify/static, better-sqlite3, @turf/turf 7, croner, Vitest 3, Vite 6, Leaflet 1.9.

**Spec:** `docs/superpowers/specs/2026-10-11-chicago-tracker-design.md`. Read it fully before Task 1. Section references like (§4.5) point into it.

## Global Constraints

- **Homelab security defaults take precedence** over anything in this plan that conflicts with them (spec §9).
- **Tailnet only.** No LAN/WAN host port. **Never enable Tailscale Funnel.** Publish the container port on `127.0.0.1` only and expose it with `tailscale serve` (or the homelab's tailnet-only proxy, which must strip client-supplied `Tailscale-User-*` headers).
- **Always pass `outSR=4326`** to ArcGIS queries. ArcGIS max record count is 2000; page with `resultOffset`/`resultRecordCount`.
- **Every CDOT permit query is date-filtered**: `applicationenddate >= windowStart AND applicationstartdate <= windowEnd`. Stale rows marked `Open` exist.
- **Socrata timestamps are floating America/Chicago local times** (`2026-10-11T00:00:00.000`, no zone). All "now/today" comparisons use Chicago-local naive strings from `src/server/util/chicagoTime.ts`, never UTC dates. The container runs in UTC.
- Rates are always presented as approximate (`≈ $2.50/hr`).
- **Never log license plates or full street addresses** at info level. `fetchJson` errors redact query strings.
- Calendar token ≥ 128 bits of randomness. Users only ever see their own places and vehicles (every store query filters by `user_id`).
- ntfy is published with **JSON publishing** (POST to the base URL with a JSON body), never title headers. Titles contain emoji and em dashes, which are not valid in HTTP headers.
- Nominatim: ≤ 1 request/second, descriptive User-Agent with contact from config, Chicago viewbox, `bounded=1`, cached.
- Dataset IDs and layer IDs live in `config/datasets.json`, never hardcoded in code.
- Tests never call live services. Network access is injected (`fetchImpl` / `FetchJson`) everywhere.

## Review Focus

1. **Late-night date rollover.** At 23:30 Chicago it is already "tomorrow" in UTC. "Today" for sweeping flags, the permit window and "sweeping tomorrow" must come from Chicago time. Pinned by the `chicagoNow` test in Task 1 and the late-night `SWEEPING` test in Task 13.
2. **Push titles with emoji / em dashes.** These would throw if sent as HTTP headers. Pinned by the JSON-body assertion in Task 18.
3. **Street-name variants in permit-zone matching** (`ST.` vs `ST`, empty `street_type`, extra whitespace, lowercase). Matching must normalize. Pinned by the normalization test in Task 12.
4. **Address search with extras** (`"1200 w randolph st, chicago il 60607"`, `"Apt 2"`). The parcel fallback parser must still extract number, direction and street. Pinned by the parser test in Task 10.
5. **Off-season / missing year.** From December to March, and when the next year's sweeping data isn't loaded, Home must say "season over / no data", and the `.ics` must still be valid with zero events. Pinned by tests in Tasks 7 and 8.

---

## File Structure

```
package.json, package-lock.json, tsconfig.json, tsconfig.web.json, vitest.config.ts, vite.config.ts
.gitignore, .dockerignore, Dockerfile, deploy/compose.yaml, deploy/HOMELAB.md
config/datasets.json      dataset + layer IDs, sweeping year, closure pattern
config/rates.json         rate tiers + polygons
config/utilities.json     utility tag patterns, ComEd outage URL
config/311.json           excluded 311 types
src/shared/types.ts       all domain types shared by server + web
src/shared/deeplinks.ts   Apple/Google/Waze URLs
src/server/
  index.ts                process entry: config → store → cache → app → scheduler
  app.ts                  buildApp(deps): Fastify instance, security headers, static, routes
  config.ts               loadConfig(env, dir)
  auth.ts                 resolveLogin + Fastify preHandler
  scheduler.ts            croner jobs
  util/chicagoTime.ts     Chicago-local naive time helpers
  util/random.ts          token generation
  http/fetchJson.ts       fetch with UA, timeout, retry, redaction
  sources/arcgis.ts       arcgisQueryAll, arcgisQueryNear
  sources/socrata.ts      socrataQueryAll
  sources/nominatim.ts    geocoder (Nominatim + parcel fallback)
  sources/nws.ts          NWS alerts + snowfall
  data/normalize.ts       raw → typed records (one fn per dataset)
  data/jobs.ts            buildDatasetJobs(cfg, fetchJson, today)
  data/refresh.ts         refreshAll (row-count guards)
  data/cache.ts           DataCache (in-memory snapshot)
  db/store.ts             SQLite schema + repository functions
  domain/geo.ts           distances, PIP, bbox
  domain/sweeping.ts      dates, zone candidates
  domain/ics.ts           calendar feed
  domain/rates.ts         rate tier lookup
  domain/permitZones.ts   parcel ↔ permit-zone matching
  domain/parking.ts       buildParking
  domain/utilityTag.ts    classify permits
  domain/watch.ts         buildWatch + 311 grouping
  domain/vehicles.ts      plate normalize, match mapping
  domain/winter.ts        snow route, snowfall rule, alert filter
  notify/ntfy.ts          JSON publish client
  notify/planner.ts       planPushes, filterDeliverable
  notify/runner.ts        runNotifier (gathers state, seeds, delivers)
  jobs/vehicleJob.ts, jobs/requests311Job.ts, jobs/winterJob.ts
  routes/me.ts, places.ts, parking.ts, watch.ts, vehicles.ts, winter.ts, notifications.ts, status.ts, cal.ts
src/web/
  index.html, main.ts, api.ts, router.ts, styles.css, sw.js, manifest.webmanifest, icons/
  views/home.ts, views/park.ts, views/settings.ts
  components/sheet.ts
scripts/contract-check.ts, scripts/capture-fixtures.ts, scripts/smoke.sh
test/**/*.test.ts, test/fixtures/
```

---

## Phase A — Foundation

### Task 1: Project scaffold, shared types, Chicago time, config loader

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.web.json`, `vitest.config.ts`, `.gitignore`, `.dockerignore`
- Create: `config/datasets.json`, `config/rates.json`, `config/utilities.json`, `config/311.json`
- Create: `src/shared/types.ts`, `src/server/util/chicagoTime.ts`, `src/server/util/random.ts`, `src/server/config.ts`
- Test: `test/util/chicagoTime.test.ts`, `test/config.test.ts`

**Interfaces:**
- Produces: every type in `src/shared/types.ts`; `chicagoNow(d?) : string` (`YYYY-MM-DDTHH:mm:ss`), `toChicagoLocal(d: Date)`, `datePart(local)`, `timePart(local)` (`HH:mm`), `addDays(date, n)`, `weekday(date)` (0=Sun), `normalizeSocrataTs(s)`; `randomToken(bytes=24): string` (base64url); `loadConfig(env, configDir): AppConfig` plus the config interfaces.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "chicago-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "npm run build:server && npm run build:web",
    "build:server": "tsc -p tsconfig.json",
    "build:web": "vite build",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:web": "vite",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "contract-check": "tsx scripts/contract-check.ts",
    "capture-fixtures": "tsx scripts/capture-fixtures.ts"
  }
}
```

Then install exact current versions (the lockfile pins them):

```bash
npm install fastify@^5 @fastify/static@^8 better-sqlite3@^11 @turf/turf@^7 croner@^9 leaflet@^1.9.4
npm install -D typescript@^5 tsx@^4 vitest@^3 vite@^6 @types/node@^24 @types/better-sqlite3 @types/leaflet
```

- [ ] **Step 2: Create TypeScript and Vitest configs**

`tsconfig.json` (server + shared):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/server/**/*.ts", "src/shared/**/*.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src/web/**/*.ts", "src/shared/**/*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
```

`.gitignore`:
```
node_modules/
dist/
data/
*.db
.env
```

`.dockerignore`:
```
node_modules
dist
data
.git
test
docs
```

- [ ] **Step 3: Create config files**

`config/datasets.json`:
```json
{
  "arcgisBase": "https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/operational/MapServer",
  "socrataBase": "https://data.cityofchicago.org/resource",
  "layers": { "payBlocks": 58, "payBoxes": 40, "cbd": 115, "snowRoutes": 50, "snowplows": 38, "parcels": 1 },
  "socrata": {
    "sweepSchedule": "u5ai-3efk",
    "sweepZones": "2r7q-emq3",
    "permitsClosures": "jdis-5sry",
    "permitsCurrent": "hr8i-6s6s",
    "permitsBlockParty": "9zhy-9n5f",
    "permitsFilming": "c2az-nhru",
    "specialEvents": "xgse-8eg7",
    "permitZones": "u9xt-hiju",
    "towed": "ygr5-vcbg",
    "relocated": "5k2z-suxx",
    "requests311": "v6vf-nfxy"
  },
  "sweepingYear": 2026,
  "snowRouteSource": "arcgis:50 (UNVERIFIED as 2-inch ban streets — see spec §2.1)",
  "closureRedPattern": "full|curb|lane|partial|street",
  "sundayHoursVerified": false
}
```

`config/rates.json` (approximate polygons, `[lon, lat]`; first ring closes on itself):
```json
{
  "loop": { "hourly": 7.0, "hoursText": "8am–9pm ($3.50 overnight)", "polygon": [[[-87.6372,41.8757],[-87.6150,41.8757],[-87.6150,41.8868],[-87.6372,41.8868],[-87.6372,41.8757]]] },
  "cbd": { "hourly": 4.75, "hoursText": "8am–midnight", "fallbackPolygon": [[[-87.6474,41.8674],[-87.6000,41.8674],[-87.6000,41.9106],[-87.6474,41.9106],[-87.6474,41.8674]]] },
  "westloop": { "hourly": 4.75, "hoursText": "see posted sign", "polygon": [[[-87.6667,41.8750],[-87.6474,41.8750],[-87.6474,41.8912],[-87.6667,41.8912],[-87.6667,41.8750]]] },
  "neighborhood": { "hourly": 2.5, "hoursText": "8am–10pm (some free Sundays)" }
}
```

`config/utilities.json`:
```json
{
  "tags": [
    { "tag": "comed", "patterns": ["COMED", "COMMONWEALTH EDISON"] },
    { "tag": "peoplesgas", "patterns": ["PEOPLES GAS"] },
    { "tag": "water", "patterns": ["DWM", "WATER MANAGEMENT"] },
    { "tag": "telecom", "patterns": ["AT&T", "SBC", "VERIZON", "COMCAST", "CROWN CASTLE", "T-MOBILE"] }
  ],
  "comedOutageUrl": "https://www.comed.com/outages"
}
```
(The implementer confirms the ComEd URL still works and updates it here if not.)

`config/311.json`:
```json
{ "excludedTypes": ["311 INFORMATION ONLY CALL"] }
```

- [ ] **Step 4: Create `src/shared/types.ts`**

```ts
export type LngLat = [number, number]; // [lon, lat]
export type BBox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat
export type MultiPolygonCoords = LngLat[][][]; // polygons → rings → points

export interface PayBlock {
  blockId: string; street: string; from: number; to: number; parity: string;
  spaces: number; hourLimit: string | null; payZone: number; payArea: number;
  sundayHours: string | null; paths: LngLat[][]; bbox: BBox;
}
export interface PayBox {
  terminalId: number; street: string; from: number; to: number; addr: number;
  spaces: number; hourLimit: string | null; payZone: number; payArea: number; point: LngLat;
}
export interface SweepZone { wardSection: string; ward: string; section: string; polygon: MultiPolygonCoords; bbox: BBox; }
export interface SweepRow { wardSection: string; month: number; days: number[]; }
export interface PermitZoneRow { zone: string; oddEven: 'O' | 'E' | 'B'; low: number; high: number; dir: string; name: string; type: string; }
export type PermitDataset = 'closures' | 'current' | 'blockparty' | 'filming';
export interface Permit {
  id: string; dataset: PermitDataset; appType: string; workType: string;
  start: string; end: string; // Chicago-local naive 'YYYY-MM-DDTHH:mm:ss'
  location: string; streetClosure: string | null; detail: string | null; comments: string | null;
  meterBagging: boolean; applicant: string; point: LngLat | null;
}
export interface SpecialEvent { id: string; date: string; venueAddress: string; type: string; details: string; startTime: string; point: LngLat | null; }
export interface SnowRoute { id: string; paths: LngLat[][]; bbox: BBox; }
export interface Parcel { low: number; high: number; dir: string; name: string; type: string; centroid: LngLat; }

export type RateTier = 'loop' | 'cbd' | 'westloop' | 'neighborhood';
export interface RateInfo { tier: RateTier; hourly: number; hoursText: string; approximate: true; }

export type FlagCode = 'SWEEPING' | 'CLOSED' | 'METERS_BAGGED' | 'EVENT_NEARBY' | 'SNOW_ROUTE' | 'SUNDAY';
export type Severity = 'red' | 'amber' | 'info';
export interface BlockFlag { code: FlagCode; severity: Severity; reason: string; }
export type BlockStatus = 'green' | Severity;
export interface ParkingBlock {
  blockId: string; street: string; from: number; to: number; parity: string;
  spaces: number; hourLimit: string | null; payArea: number; rate: RateInfo;
  distanceM: number; navPoint: LngLat; paths: LngLat[][]; flags: BlockFlag[]; status: BlockStatus;
}
export interface PermitZoneFeature { zone: string; street: string; parity: 'O' | 'E'; line: LngLat[]; label: string; }
export interface ParkingResult {
  center: LngLat; radiusM: number; at: string;
  blocks: ParkingBlock[]; boxes: PayBox[]; permitZones: PermitZoneFeature[];
  closures: Permit[]; events: SpecialEvent[]; warnings: string[];
  dataAsOf: Record<string, string | null>;
}

export type UtilityTag = 'comed' | 'peoplesgas' | 'water' | 'telecom' | null;
export interface WatchItem {
  id: string; kind: 'permit' | 'event'; dataset: PermitDataset | 'event'; title: string;
  start: string; end: string; location: string; description: string;
  distanceM: number; utility: UtilityTag; point: LngLat | null;
}
export interface Request311 { id: string; type: string; status: string; created: string; closed: string | null; address: string; point: LngLat | null; duplicate: boolean; }
export interface Request311Group { type: string; count: number; items: (Request311 & { distanceM: number })[]; }
export interface WatchResult { placeId: number; items: WatchItem[]; requests311: Request311Group[]; sweeping: string[]; dataAsOf: Record<string, string | null>; }

export interface VehicleMatch { kind: 'towed' | 'relocated'; key: string; date: string; details: string; address: string; phone: string | null; }
export interface NwsAlert { id: string; event: string; headline: string; severity: string; ends: string | null; }

export type NotifyCategory = 'vehicle' | 'sweeping' | 'winter' | 'snowban' | 'work';
export interface NotifyPrefs { enabled: Record<NotifyCategory, boolean>; quietStart: string; quietEnd: string; }
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: { vehicle: true, sweeping: true, winter: true, snowban: true, work: true },
  quietStart: '22:00', quietEnd: '07:00',
};
export type NavApp = 'apple' | 'google' | 'waze';
export interface GeoResult { label: string; lat: number; lon: number; }

export type PlaceKind = 'home' | 'watch';
export interface Place { id: number; userId: number; kind: PlaceKind; label: string; address: string; lat: number; lon: number; radiusM: number; zones: string[]; }
export interface User { id: number; login: string; name: string; calToken: string; navApp: NavApp; ntfyTopic: string; notifyPrefs: NotifyPrefs; }
export interface Vehicle { id: number; userId: number; plate: string; state: string; nickname: string; }
export interface VehicleStatus { vehicleId: number; checkedAt: string; ok: boolean; matches: VehicleMatch[]; error: string | null; }
export interface DatasetMeta { name: string; fetchedAt: string | null; rowCount: number; status: 'ok' | 'error'; error: string | null; }
export interface Plow { name: string; type: string; postedLocal: string; minutesAgo: number; point: LngLat; }
export interface WinterStatus {
  placeId: number; label: string; onSnowRoute: boolean; alerts: NwsAlert[];
  possibleBan: boolean; snowNext24hIn: number | null; checkedAt: string | null; error: string | null;
}
export type SweepSeason = 'active' | 'over' | 'nodata';
export interface SweepInfo { status: SweepSeason; zones: string[]; upcoming: { date: string; wardSection: string }[]; }
```

- [ ] **Step 5: Write the failing time test** — `test/util/chicagoTime.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { chicagoNow, datePart, timePart, addDays, weekday, normalizeSocrataTs, toChicagoLocal } from '../../src/server/util/chicagoTime.js';

describe('chicagoTime', () => {
  it('uses Chicago local date even when UTC has rolled over (CDT)', () => {
    // 2026-10-12T04:30Z == 2026-10-11 23:30 CDT
    expect(chicagoNow(new Date('2026-10-12T04:30:00Z'))).toBe('2026-10-11T23:30:00');
  });
  it('handles CST in winter', () => {
    expect(toChicagoLocal(new Date('2026-01-15T05:59:00Z'))).toBe('2026-01-14T23:59:00');
  });
  it('splits date and time', () => {
    expect(datePart('2026-10-11T23:30:00')).toBe('2026-10-11');
    expect(timePart('2026-10-11T07:05:00')).toBe('07:05');
  });
  it('adds days across month/year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weekday: 2026-10-11 is a Sunday', () => {
    expect(weekday('2026-10-11')).toBe(0);
  });
  it('normalizes socrata timestamps', () => {
    expect(normalizeSocrataTs('2018-08-01T00:00:00.000')).toBe('2018-08-01T00:00:00');
    expect(normalizeSocrataTs('2018-08-30T23:59:59.000')).toBe('2018-08-30T23:59:59');
    expect(normalizeSocrataTs(undefined)).toBe('');
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run test/util/chicagoTime.test.ts`
Expected: FAIL (cannot find module `chicagoTime.js`).

- [ ] **Step 7: Implement `src/server/util/chicagoTime.ts` and `src/server/util/random.ts`**

```ts
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Chicago wall-clock time as naive 'YYYY-MM-DDTHH:mm:ss'. */
export function toChicagoLocal(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const chicagoNow = (d: Date = new Date()): string => toChicagoLocal(d);
export const datePart = (local: string): string => local.slice(0, 10);
export const timePart = (local: string): string => local.slice(11, 16);
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday */
export const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
/** Socrata floating timestamp → naive 'YYYY-MM-DDTHH:mm:ss' ('' when missing). */
export function normalizeSocrataTs(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/\.\d+$/, '').replace(/Z$/, '').slice(0, 19);
}
```

`src/server/util/random.ts`:
```ts
import { randomBytes } from 'node:crypto';
/** base64url token; 24 bytes = 192 bits. */
export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');
```

- [ ] **Step 8: Run the test and verify it passes**

Run: `npx vitest run test/util/chicagoTime.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Write the failing config test** — `test/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/server/config.js';

const base = { OWNER_LOGIN: 'me@example.com', PUBLIC_BASE_URL: 'https://chicago.tail1234.ts.net', NOMINATIM_CONTACT: 'me@example.com' };

describe('loadConfig', () => {
  it('loads defaults and json config', () => {
    const c = loadConfig(base, 'config');
    expect(c.port).toBe(8787);
    expect(c.host).toBe('0.0.0.0');
    expect(c.allowedLogins).toEqual(['me@example.com']);
    expect(c.datasets.layers.payBlocks).toBe(58);
    expect(c.rates.neighborhood.hourly).toBe(2.5);
    expect(c.utilities.tags.length).toBeGreaterThan(0);
    expect(c.excluded311).toContain('311 INFORMATION ONLY CALL');
    expect(c.nwsUserAgent).toContain('me@example.com');
  });
  it('parses ALLOWED_LOGINS and always includes owner', () => {
    const c = loadConfig({ ...base, ALLOWED_LOGINS: 'bro@example.com, other@example.com ' }, 'config');
    expect(c.allowedLogins.sort()).toEqual(['bro@example.com', 'me@example.com', 'other@example.com']);
  });
  it('throws a clear error on missing required vars', () => {
    expect(() => loadConfig({}, 'config')).toThrow(/OWNER_LOGIN/);
  });
});
```

- [ ] **Step 10: Run it and verify it fails**

Run: `npx vitest run test/config.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 11: Implement `src/server/config.ts`**

```ts
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
  const allowed = new Set((env.ALLOWED_LOGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  allowed.add(owner);
  const contact = env.NOMINATIM_CONTACT!.trim();
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? './data',
    ownerLogin: owner,
    allowedLogins: [...allowed],
    singleUserLogin: env.SINGLE_USER_LOGIN?.trim() || null,
    publicBaseUrl: env.PUBLIC_BASE_URL!.replace(/\/$/, ''),
    nominatimContact: contact,
    socrataAppToken: env.SOCRATA_APP_TOKEN || null,
    ntfyUrl: env.NTFY_URL?.replace(/\/$/, '') || null,
    ntfyToken: env.NTFY_TOKEN || null,
    nwsUserAgent: env.NWS_USER_AGENT || `chicago-tracker (${contact})`,
    refreshCron: env.REFRESH_CRON || '30 3 * * *',
    datasets: readJson<DatasetsConfig>(configDir, 'datasets.json'),
    rates: readJson<RatesConfig>(configDir, 'rates.json'),
    utilities: readJson<UtilitiesConfig>(configDir, 'utilities.json'),
    excluded311: readJson<{ excludedTypes: string[] }>(configDir, '311.json').excludedTypes,
  };
}
```

Note: inside the container the app listens on `0.0.0.0`, and compose publishes it **only** on `127.0.0.1` (Task 24). That satisfies the spec's "bound to 127.0.0.1" requirement at the host level.

- [ ] **Step 12: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS (9 tests).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: scaffold project, shared types, Chicago time helpers, config loader"
```

---

### Task 2: Geo helpers

**Files:**
- Create: `src/server/domain/geo.ts`
- Test: `test/domain/geo.test.ts`

**Interfaces:**
- Consumes: `LngLat`, `BBox`, `MultiPolygonCoords` (Task 1)
- Produces:
  - `distM(a: LngLat, b: LngLat): number`
  - `distToPathsM(p: LngLat, paths: LngLat[][]): number`
  - `nearestOnPaths(p: LngLat, paths: LngLat[][]): LngLat`
  - `midpointOfPaths(paths: LngLat[][]): LngLat`
  - `inMultiPolygon(p: LngLat, mp: MultiPolygonCoords): boolean`
  - `distToMultiPolygonM(p: LngLat, mp: MultiPolygonCoords): number` (0 inside)
  - `bboxOf(points: LngLat[]): BBox`
  - `bboxNear(b: BBox, p: LngLat, radiusM: number): boolean`
  - `centroidOfRing(ring: LngLat[]): LngLat`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { distM, distToPathsM, nearestOnPaths, midpointOfPaths, inMultiPolygon, distToMultiPolygonM, bboxOf, bboxNear, centroidOfRing } from '../../src/server/domain/geo.js';
import type { LngLat, MultiPolygonCoords } from '../../src/shared/types.js';

const square: MultiPolygonCoords = [[[[-87.65, 41.88], [-87.64, 41.88], [-87.64, 41.89], [-87.65, 41.89], [-87.65, 41.88]]]];

describe('geo', () => {
  it('distM ~ 111 m per 0.001 deg latitude', () => {
    expect(distM([-87.65, 41.88], [-87.65, 41.881])).toBeGreaterThan(105);
    expect(distM([-87.65, 41.88], [-87.65, 41.881])).toBeLessThan(115);
  });
  it('distance to a line and nearest point', () => {
    const paths: LngLat[][] = [[[-87.65, 41.88], [-87.64, 41.88]]];
    const p: LngLat = [-87.645, 41.8805];
    expect(distToPathsM(p, paths)).toBeGreaterThan(50);
    expect(distToPathsM(p, paths)).toBeLessThan(60);
    const n = nearestOnPaths(p, paths);
    expect(n[1]).toBeCloseTo(41.88, 5);
    expect(n[0]).toBeCloseTo(-87.645, 4);
  });
  it('midpoint of the longest path', () => {
    expect(midpointOfPaths([[[-87.65, 41.88], [-87.64, 41.88]]])[0]).toBeCloseTo(-87.645, 4);
  });
  it('point in multipolygon and distance outside', () => {
    expect(inMultiPolygon([-87.645, 41.885], square)).toBe(true);
    expect(inMultiPolygon([-87.66, 41.885], square)).toBe(false);
    expect(distToMultiPolygonM([-87.645, 41.885], square)).toBe(0);
    const d = distToMultiPolygonM([-87.6503, 41.885], square);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(30);
  });
  it('bbox helpers', () => {
    const b = bboxOf([[-87.65, 41.88], [-87.64, 41.89]]);
    expect(b).toEqual([-87.65, 41.88, -87.64, 41.89]);
    expect(bboxNear(b, [-87.655, 41.885], 500)).toBe(true);
    expect(bboxNear(b, [-87.70, 41.885], 500)).toBe(false);
  });
  it('centroid of ring ignores closing point', () => {
    expect(centroidOfRing([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([1, 1]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/geo.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/server/domain/geo.ts`**

```ts
import * as turf from '@turf/turf';
import type { BBox, LngLat, MultiPolygonCoords } from '../../shared/types.js';

const M = { units: 'meters' as const };

export const distM = (a: LngLat, b: LngLat): number => turf.distance(turf.point(a), turf.point(b), M);

export function distToPathsM(p: LngLat, paths: LngLat[][]): number {
  let best = Infinity;
  for (const path of paths) {
    if (path.length < 2) { if (path[0]) best = Math.min(best, distM(p, path[0])); continue; }
    best = Math.min(best, turf.pointToLineDistance(turf.point(p), turf.lineString(path), M));
  }
  return best;
}

export function nearestOnPaths(p: LngLat, paths: LngLat[][]): LngLat {
  const usable = paths.filter((x) => x.length >= 2);
  if (!usable.length) return paths[0]?.[0] ?? p;
  const n = turf.nearestPointOnLine(turf.multiLineString(usable), turf.point(p), M);
  return n.geometry.coordinates as LngLat;
}

export function midpointOfPaths(paths: LngLat[][]): LngLat {
  const usable = paths.filter((x) => x.length >= 2);
  if (!usable.length) return paths[0]?.[0] ?? [0, 0];
  const longest = usable.reduce((a, b) => (turf.length(turf.lineString(a)) >= turf.length(turf.lineString(b)) ? a : b));
  const line = turf.lineString(longest);
  return turf.along(line, turf.length(line) / 2).geometry.coordinates as LngLat;
}

export const inMultiPolygon = (p: LngLat, mp: MultiPolygonCoords): boolean =>
  turf.booleanPointInPolygon(turf.point(p), turf.multiPolygon(mp));

export function distToMultiPolygonM(p: LngLat, mp: MultiPolygonCoords): number {
  if (inMultiPolygon(p, mp)) return 0;
  let best = Infinity;
  for (const poly of mp) for (const ring of poly) if (ring.length >= 2) {
    best = Math.min(best, turf.pointToLineDistance(turf.point(p), turf.lineString(ring), M));
  }
  return best;
}

export function bboxOf(points: LngLat[]): BBox {
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

export function bboxNear(bb: BBox, p: LngLat, radiusM: number): boolean {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return p[0] >= bb[0] - dLon && p[0] <= bb[2] + dLon && p[1] >= bb[1] - dLat && p[1] <= bb[3] + dLat;
}

export function centroidOfRing(ring: LngLat[]): LngLat {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const sx = pts.reduce((s, q) => s + q[0], 0);
  const sy = pts.reduce((s, q) => s + q[1], 0);
  return [sx / pts.length, sy / pts.length];
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/geo.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: geo helpers"
```

---

### Task 3: HTTP client, ArcGIS and Socrata query helpers

**Files:**
- Create: `src/server/http/fetchJson.ts`, `src/server/sources/arcgis.ts`, `src/server/sources/socrata.ts`
- Test: `test/sources/http.test.ts`

**Interfaces:**
- Produces:
  - `type FetchJson = (url: string, init?: { method?: string; headers?: Record<string,string>; body?: string }) => Promise<any>`
  - `createFetchJson(opts: { userAgent: string; timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): FetchJson`
  - `redactUrl(url: string): string` (origin + path only)
  - `interface ArcFeature { attributes: Record<string, any>; geometry?: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] } }`
  - `arcgisQueryAll(fetchJson, base, layerId, params?: Record<string,string>, pageSize = 1000): Promise<ArcFeature[]>`
  - `arcgisQueryNear(fetchJson, base, layerId, center: LngLat, radiusM: number, params?: Record<string,string>): Promise<ArcFeature[]>`
  - `arcgisQueryOnce(fetchJson, base, layerId, params?: Record<string,string>): Promise<ArcFeature[]>` (single request, no paging; for lookups)
  - `socrataQueryAll(fetchJson, base, id, q: { select?: string; where?: string; order?: string }, opts?: { pageSize?: number; appToken?: string | null }): Promise<any[]>`

- [ ] **Step 1: Write the failing test** — `test/sources/http.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFetchJson, redactUrl } from '../../src/server/http/fetchJson.js';
import { arcgisQueryAll, arcgisQueryNear, arcgisQueryOnce } from '../../src/server/sources/arcgis.js';
import { socrataQueryAll } from '../../src/server/sources/socrata.js';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchJson', () => {
  it('sends User-Agent and retries 5xx then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(503, {})).mockResolvedValueOnce(res(200, { ok: 1 }));
    const fj = createFetchJson({ userAgent: 'ua-test', fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(await fj('https://x.test/a?plate=ABC123')).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('ua-test');
  });
  it('does not retry 4xx and redacts the query string in the error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(400, {}));
    const fj = createFetchJson({ userAgent: 'u', fetchImpl: fetchImpl as any, sleep: async () => {} });
    await expect(fj('https://x.test/a?plate=ABC123')).rejects.toThrow('HTTP 400 for https://x.test/a');
    await expect(fj('https://x.test/a?plate=ABC123')).rejects.not.toThrow(/ABC123/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('redactUrl strips the query', () => {
    expect(redactUrl('https://h.test/p/q?x=1')).toBe('https://h.test/p/q');
  });
});

describe('arcgisQueryAll', () => {
  it('pages until a short page and always requests outSR=4326', async () => {
    const urls: string[] = [];
    const fj = async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('resultOffset'));
      const n = offset === 0 ? 2 : 1;
      return { features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: offset + i } })) };
    };
    const out = await arcgisQueryAll(fj, 'https://g.test/MapServer', 58, {}, 2);
    expect(out.map((f) => f.attributes.OBJECTID)).toEqual([0, 1, 2]);
    expect(urls.every((u) => new URL(u).searchParams.get('outSR') === '4326')).toBe(true);
    expect(urls[0]).toContain('/58/query?');
  });
  it('arcgisQueryOnce makes exactly one request', async () => {
    let n = 0;
    const out = await arcgisQueryOnce(async () => { n++; return { features: [{ attributes: { A: 1 } }], exceededTransferLimit: true }; }, 'https://g', 1, { resultRecordCount: '1' });
    expect(n).toBe(1);
    expect(out).toHaveLength(1);
  });
  it('throws on an ArcGIS error payload', async () => {
    await expect(arcgisQueryAll(async () => ({ error: { code: 400, message: 'bad' } }), 'https://g', 1)).rejects.toThrow('ArcGIS error 400: bad');
  });
  it('near query sends point geometry + meters distance', async () => {
    let seen = '';
    await arcgisQueryNear(async (u: string) => { seen = u; return { features: [] }; }, 'https://g', 1, [-87.6, 41.8], 250);
    const sp = new URL(seen).searchParams;
    expect(sp.get('geometryType')).toBe('esriGeometryPoint');
    expect(sp.get('inSR')).toBe('4326');
    expect(sp.get('distance')).toBe('250');
    expect(sp.get('units')).toBe('esriSRUnit_Meter');
  });
});

describe('socrataQueryAll', () => {
  it('pages with $limit/$offset and passes the app token header', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fj = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers });
      const off = Number(new URL(url).searchParams.get('$offset'));
      return off === 0 ? [{ a: 1 }, { a: 2 }] : [{ a: 3 }];
    };
    const rows = await socrataQueryAll(fj, 'https://d.test/resource', 'abcd-1234', { where: "x='1'" }, { pageSize: 2, appToken: 'tok' });
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(calls[0].url).toContain('/abcd-1234.json?');
    expect(new URL(calls[0].url).searchParams.get('$where')).toBe("x='1'");
    expect(new URL(calls[0].url).searchParams.get('$order')).toBe(':id');
    expect(calls[0].headers?.['X-App-Token']).toBe('tok');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/sources/http.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `src/server/http/fetchJson.ts`**

```ts
export type FetchJson = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function redactUrl(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '<invalid url>'; }
}

export function createFetchJson(opts: {
  userAgent: string; timeoutMs?: number; retries?: number;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>;
}): FetchJson {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 2;
  return async (url, init = {}) => {
    let lastErr: unknown = new Error(`request failed for ${redactUrl(url)}`);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const res = await f(url, {
          method: init.method ?? 'GET',
          body: init.body,
          headers: { 'User-Agent': opts.userAgent, Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
        if (res.status === 429 || res.status >= 500) { lastErr = new HttpError(res.status, `HTTP ${res.status} for ${redactUrl(url)}`); continue; }
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${redactUrl(url)}`);
        return await res.json();
      } catch (e) {
        if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
        lastErr = e instanceof HttpError ? e : new Error(`network error for ${redactUrl(url)}: ${(e as Error).message}`);
      }
    }
    throw lastErr;
  };
}
```

- [ ] **Step 4: Implement `src/server/sources/arcgis.ts`**

```ts
import type { FetchJson } from '../http/fetchJson.js';
import type { LngLat } from '../../shared/types.js';

export interface ArcFeature {
  attributes: Record<string, any>;
  geometry?: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] };
}

function check(r: any): ArcFeature[] {
  if (r?.error) throw new Error(`ArcGIS error ${r.error.code}: ${r.error.message}`);
  return (r?.features ?? []) as ArcFeature[];
}

export async function arcgisQueryAll(
  fetchJson: FetchJson, base: string, layerId: number, params: Record<string, string> = {}, pageSize = 1000,
): Promise<ArcFeature[]> {
  const out: ArcFeature[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      where: '1=1', outFields: '*', returnGeometry: 'true', orderByFields: 'OBJECTID', f: 'json',
      ...params, outSR: '4326', resultOffset: String(offset), resultRecordCount: String(pageSize),
    });
    const r = await fetchJson(`${base}/${layerId}/query?${q}`);
    const feats = check(r);
    out.push(...feats);
    if (feats.length < pageSize && !r.exceededTransferLimit) break;
    if (feats.length === 0) break;
  }
  return out;
}

export async function arcgisQueryOnce(
  fetchJson: FetchJson, base: string, layerId: number, params: Record<string, string> = {},
): Promise<ArcFeature[]> {
  const q = new URLSearchParams({ where: '1=1', outFields: '*', returnGeometry: 'true', f: 'json', ...params, outSR: '4326' });
  return check(await fetchJson(`${base}/${layerId}/query?${q}`));
}

export function arcgisQueryNear(
  fetchJson: FetchJson, base: string, layerId: number, center: LngLat, radiusM: number, params: Record<string, string> = {},
): Promise<ArcFeature[]> {
  return arcgisQueryAll(fetchJson, base, layerId, {
    geometry: JSON.stringify({ x: center[0], y: center[1], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    distance: String(Math.round(radiusM)), units: 'esriSRUnit_Meter', ...params,
  });
}
```

- [ ] **Step 5: Implement `src/server/sources/socrata.ts`**

```ts
import type { FetchJson } from '../http/fetchJson.js';

export async function socrataQueryAll(
  fetchJson: FetchJson, base: string, id: string,
  q: { select?: string; where?: string; order?: string },
  opts: { pageSize?: number; appToken?: string | null } = {},
): Promise<any[]> {
  const pageSize = opts.pageSize ?? 50_000;
  const headers: Record<string, string> = opts.appToken ? { 'X-App-Token': opts.appToken } : {};
  const out: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const p = new URLSearchParams({ $limit: String(pageSize), $offset: String(offset), $order: q.order ?? ':id' });
    if (q.select) p.set('$select', q.select);
    if (q.where) p.set('$where', q.where);
    const rows = await fetchJson(`${base}/${id}.json?${p}`, { headers });
    if (!Array.isArray(rows)) throw new Error(`Socrata ${id}: unexpected response`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Escape a value for a SoQL string literal. */
export const soqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run test/sources/http.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: fetchJson with retry/redaction, ArcGIS and Socrata paging helpers"
```

---

### Task 4: Normalizers for every city dataset

**Files:**
- Create: `src/server/data/normalize.ts`
- Test: `test/data/normalize.test.ts`

**Interfaces:**
- Consumes: `ArcFeature` (Task 3), geo `bboxOf`, `centroidOfRing` (Task 2), `normalizeSocrataTs`, `addDays` (Task 1)
- Produces:
  - `normPayBlock(f: ArcFeature): PayBlock`, `normPayBox(f: ArcFeature): PayBox`
  - `normCbd(fs: ArcFeature[]): MultiPolygonCoords | null`, `normSnowRoute(f: ArcFeature): SnowRoute`
  - `normParcel(f: ArcFeature): Parcel | null`
  - `normSweepZone(row: any): SweepZone | null`, `normSweepRow(row: any): SweepRow`
  - `normPermitZone(row: any): PermitZoneRow | null`
  - `normPermit(row: any, dataset: PermitDataset): Permit`, `normEvent(row: any): SpecialEvent`, `norm311(row: any): Request311`
  - `permitWindowWhere(today: string, daysAhead = 60): string`
  - `pad2(s: string | number): string`

- [ ] **Step 1: Write the failing test** — `test/data/normalize.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as N from '../../src/server/data/normalize.js';

describe('normalizers', () => {
  it('pay block: "." hour limit becomes null; paths + bbox', () => {
    const b = N.normPayBlock({
      attributes: { BLOCK_ID: 'B370603', STREET_NAME: 'S HOMAN AVE', BLOCK_START: 2553, BLOCK_END: 2555, PARITY: 'S', NUM_SPACES: 2, HOUR_LIMIT: '.', PAY_ZONE: 6, PAY_AREA: 370, SUNDAY_HOURS: 'N' },
      geometry: { paths: [[[-87.71, 41.84], [-87.71, 41.8405]]] },
    });
    expect(b).toMatchObject({ blockId: 'B370603', hourLimit: null, sundayHours: 'N', spaces: 2, payArea: 370 });
    expect(b.bbox).toEqual([-87.71, 41.84, -87.71, 41.8405]);
  });
  it('pay box point', () => {
    const x = N.normPayBox({ attributes: { TERMINAL_ID: 257413, STREET_NAME: 'W RANDOLPH ST', BLOCK_START: 724, BLOCK_END: 740, PAYBOX_ADDR: 730, NUM_SPACES: 14, HOUR_LIMIT: '2', PAY_ZONE: 4, PAY_AREA: 257 }, geometry: { x: -87.647, y: 41.8845 } });
    expect(x).toMatchObject({ terminalId: 257413, hourLimit: '2', point: [-87.647, 41.8845] });
  });
  it('sweep zone builds ward_section from ward + section', () => {
    const z = N.normSweepZone({ ward: '1', section: '3', the_geom: { type: 'MultiPolygon', coordinates: [[[[-87.7, 41.9], [-87.69, 41.9], [-87.69, 41.91], [-87.7, 41.9]]]] } });
    expect(z?.wardSection).toBe('0103');
    expect(z?.bbox[0]).toBe(-87.7);
    expect(N.normSweepZone({ ward: '1', section: '3' })).toBeNull();
  });
  it('sweep row parses date list', () => {
    expect(N.normSweepRow({ ward_section_concatenated: '0101', month_number: '6', dates: '26, 29' })).toEqual({ wardSection: '0101', month: 6, days: [26, 29] });
    expect(N.normSweepRow({ ward_section_concatenated: '0101', month_number: '6', dates: '' }).days).toEqual([]);
  });
  it('permit: timestamps normalized, bagging flag, point', () => {
    const p = N.normPermit({ uniquekey: '1', applicationtype: 'DOT_PWO', worktypedescription: 'Opening', applicationstartdate: '2026-10-01T00:00:00.000', applicationenddate: '2026-10-30T23:59:59.000', streetnumberfrom: '3950', streetnumberto: '3950', direction: 'W', streetname: 'ROSEMONT', suffix: 'AVE', streetclosure: 'Sidewalk', parkingmeterpostingorbagging: 'Y', primarycontactlast: 'Peoples Gas*', latitude: '41.99', longitude: '-87.72' }, 'current');
    expect(p).toMatchObject({ id: '1', dataset: 'current', start: '2026-10-01T00:00:00', end: '2026-10-30T23:59:59', meterBagging: true, applicant: 'Peoples Gas*', location: '3950 W ROSEMONT AVE', point: [-87.72, 41.99] });
    expect(N.normPermit({ uniquekey: '2', latitude: '0', longitude: '0' }, 'closures').point).toBeNull();
  });
  it('permit zone parses ranges and parity', () => {
    expect(N.normPermitZone({ status: 'ACTIVE', zone: '1130', odd_even: 'O', address_range_low: '1363', address_range_high: '1425', street_direction: 'W', street_name: 'Wilson ', street_type: 'AVE' }))
      .toEqual({ zone: '1130', oddEven: 'O', low: 1363, high: 1425, dir: 'W', name: 'WILSON', type: 'AVE' });
    expect(N.normPermitZone({ status: 'INACTIVE', zone: '1' })).toBeNull();
  });
  it('event and 311', () => {
    expect(N.normEvent({ date: '2026-06-28T00:00:00.000', venue_address: '11500 S LOOMIS', event_type: 'Block Party', event_details: 'Juneteenth', start_time: 'N/A', location: { type: 'Point', coordinates: [-87.65, 41.68] } }))
      .toMatchObject({ date: '2026-06-28', type: 'Block Party', point: [-87.65, 41.68] });
    expect(N.norm311({ sr_number: 'SR1', sr_type: 'Pothole in Street Complaint', status: 'Open', created_date: '2026-10-01T10:00:00.000', street_address: '1 N STATE ST', duplicate: true, latitude: '41.88', longitude: '-87.62' }))
      .toMatchObject({ id: 'SR1', duplicate: true, created: '2026-10-01T10:00:00', closed: null, point: [-87.62, 41.88] });
  });
  it('permit window where clause', () => {
    expect(N.permitWindowWhere('2026-10-11')).toBe("applicationenddate >= '2026-10-10T00:00:00' AND applicationstartdate <= '2026-12-10T23:59:59'");
  });
  it('parcel centroid', () => {
    expect(N.normParcel({ attributes: { L_ADDR: 706, H_ADDR: 706, PRE_DIR: 'W', ST_NAME: 'RANDOLPH', ST_TYPE: 'ST' }, geometry: { rings: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } }))
      .toEqual({ low: 706, high: 706, dir: 'W', name: 'RANDOLPH', type: 'ST', centroid: [1, 1] });
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/data/normalize.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/data/normalize.ts`**

```ts
import type { ArcFeature } from '../sources/arcgis.js';
import type {
  LngLat, MultiPolygonCoords, Parcel, PayBlock, PayBox, Permit, PermitDataset, PermitZoneRow,
  Request311, SnowRoute, SpecialEvent, SweepRow, SweepZone,
} from '../../shared/types.js';
import { bboxOf, centroidOfRing } from '../domain/geo.js';
import { addDays, normalizeSocrataTs } from '../util/chicagoTime.js';

export const pad2 = (s: string | number): string => String(s).trim().padStart(2, '0');
const dot = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '.' || String(v).trim() === '' ? null : String(v).trim());
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();
function latLon(lat: unknown, lon: unknown): LngLat | null {
  const a = Number(lat), b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0 ? [b, a] : null;
}

export function normPayBlock(f: ArcFeature): PayBlock {
  const a = f.attributes;
  const paths = (f.geometry?.paths ?? []) as LngLat[][];
  return {
    blockId: String(a.BLOCK_ID), street: String(a.STREET_NAME ?? ''), from: num(a.BLOCK_START), to: num(a.BLOCK_END),
    parity: String(a.PARITY ?? ''), spaces: num(a.NUM_SPACES), hourLimit: dot(a.HOUR_LIMIT), payZone: num(a.PAY_ZONE),
    payArea: num(a.PAY_AREA), sundayHours: dot(a.SUNDAY_HOURS), paths, bbox: bboxOf(paths.flat()),
  };
}

export function normPayBox(f: ArcFeature): PayBox {
  const a = f.attributes;
  return {
    terminalId: num(a.TERMINAL_ID), street: String(a.STREET_NAME ?? ''), from: num(a.BLOCK_START), to: num(a.BLOCK_END),
    addr: num(a.PAYBOX_ADDR), spaces: num(a.NUM_SPACES), hourLimit: dot(a.HOUR_LIMIT), payZone: num(a.PAY_ZONE),
    payArea: num(a.PAY_AREA), point: [num(f.geometry?.x), num(f.geometry?.y)],
  };
}

export function normCbd(fs: ArcFeature[]): MultiPolygonCoords | null {
  const rings = fs.flatMap((f) => (f.geometry?.rings ?? []) as LngLat[][]);
  return rings.length ? [rings] : null;
}

export function normSnowRoute(f: ArcFeature): SnowRoute {
  const paths = (f.geometry?.paths ?? []) as LngLat[][];
  return { id: String(f.attributes.SNOW_RTE ?? f.attributes.OBJECTID), paths, bbox: bboxOf(paths.flat()) };
}

export function normParcel(f: ArcFeature): Parcel | null {
  const ring = f.geometry?.rings?.[0] as LngLat[] | undefined;
  const a = f.attributes;
  if (!ring?.length || !a.ST_NAME) return null;
  return { low: num(a.L_ADDR), high: num(a.H_ADDR || a.L_ADDR), dir: up(a.PRE_DIR), name: up(a.ST_NAME), type: up(a.ST_TYPE), centroid: centroidOfRing(ring) };
}

export function normSweepZone(row: any): SweepZone | null {
  const g = row.the_geom;
  if (!g?.coordinates) return null;
  const polygon: MultiPolygonCoords = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const wardSection = row.ward && row.section ? pad2(row.ward) + pad2(row.section) : String(row.ward_section ?? '').trim();
  return { wardSection, ward: pad2(row.ward ?? wardSection.slice(0, 2)), section: pad2(row.section ?? wardSection.slice(2)), polygon, bbox: bboxOf(polygon.flat(2)) };
}

export function normSweepRow(row: any): SweepRow {
  const ws = String(row.ward_section_concatenated ?? (pad2(row.ward) + pad2(row.section)));
  const days = String(row.dates ?? '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);
  return { wardSection: ws, month: num(row.month_number), days };
}

export function normPermitZone(row: any): PermitZoneRow | null {
  if (up(row.status) !== 'ACTIVE') return null;
  const oe = up(row.odd_even);
  return {
    zone: String(row.zone), oddEven: oe === 'O' || oe === 'E' ? oe : 'B',
    low: num(row.address_range_low), high: num(row.address_range_high),
    dir: up(row.street_direction), name: up(row.street_name), type: up(row.street_type),
  };
}

export function normPermit(row: any, dataset: PermitDataset): Permit {
  const from = row.streetnumberfrom, to = row.streetnumberto;
  const num_ = from && to && from !== to ? `${from}-${to}` : from ?? '';
  const location = [num_, row.direction, row.streetname, row.suffix].filter(Boolean).join(' ') || String(row.applicationname ?? '');
  return {
    id: String(row.uniquekey), dataset,
    appType: String(row.applicationdescription ?? row.applicationtype ?? ''),
    workType: String(row.worktypedescription ?? row.worktype ?? ''),
    start: normalizeSocrataTs(row.applicationstartdate), end: normalizeSocrataTs(row.applicationenddate),
    location, streetClosure: row.streetclosure ?? null, detail: row.detail ?? null, comments: row.comments ?? null,
    meterBagging: up(row.parkingmeterpostingorbagging) === 'Y',
    applicant: String(row.primarycontactlast ?? row.applicationname ?? ''),
    point: latLon(row.latitude, row.longitude),
  };
}

export function normEvent(row: any): SpecialEvent {
  const c = row.location?.coordinates;
  const date = normalizeSocrataTs(row.date).slice(0, 10);
  return {
    id: `${date}|${row.venue_address ?? ''}|${row.event_details ?? ''}`, date,
    venueAddress: String(row.venue_address ?? row.venue ?? ''), type: String(row.event_type ?? ''),
    details: String(row.event_details ?? ''), startTime: String(row.start_time ?? ''),
    point: Array.isArray(c) ? latLon(c[1], c[0]) : null,
  };
}

export function norm311(row: any): Request311 {
  return {
    id: String(row.sr_number), type: String(row.sr_type ?? ''), status: String(row.status ?? ''),
    created: normalizeSocrataTs(row.created_date), closed: normalizeSocrataTs(row.closed_date) || null,
    address: String(row.street_address ?? ''), point: latLon(row.latitude, row.longitude),
    duplicate: row.duplicate === true || String(row.duplicate).toLowerCase() === 'true',
  };
}

export function permitWindowWhere(today: string, daysAhead = 60): string {
  return `applicationenddate >= '${addDays(today, -1)}T00:00:00' AND applicationstartdate <= '${addDays(today, daysAhead)}T23:59:59'`;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/data/normalize.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dataset normalizers"
```

---

### Task 5: SQLite store

**Files:**
- Create: `src/server/db/store.ts`
- Test: `test/db/store.test.ts`

**Interfaces:**
- Consumes: `User`, `Place`, `Vehicle`, `VehicleStatus`, `DatasetMeta`, `NotifyPrefs`, `DEFAULT_NOTIFY_PREFS`, `NavApp` (Task 1), `randomToken` (Task 1)
- Produces: `openStore(file: string): Store` where:

```ts
interface Store {
  upsertUser(login: string, name: string): User;
  getUser(id: number): User | null;
  getUserByLogin(login: string): User | null;
  getUserByCalToken(token: string): User | null;
  listUsers(): User[];
  updateUser(id: number, patch: { navApp?: NavApp; ntfyTopic?: string; notifyPrefs?: NotifyPrefs }): User;
  rotateCalToken(id: number): string;
  listPlaces(userId: number): Place[];
  listAllPlaces(): Place[];
  getPlace(userId: number, id: number): Place | null;
  createPlace(userId: number, p: Omit<Place, 'id' | 'userId'>): Place;
  updatePlace(userId: number, id: number, patch: Partial<Pick<Place, 'label' | 'radiusM' | 'zones'>>): Place | null;
  deletePlace(userId: number, id: number): boolean;
  listVehicles(userId: number): Vehicle[];
  listAllVehicles(): Vehicle[];
  createVehicle(userId: number, v: Omit<Vehicle, 'id' | 'userId'>): Vehicle;
  deleteVehicle(userId: number, id: number): boolean;
  setVehicleStatus(s: VehicleStatus): void;
  getVehicleStatus(vehicleId: number): VehicleStatus | null;
  saveDataset(name: string, rows: unknown, rowCount: number, fetchedAt: string): void;
  loadDataset<T>(name: string): T | null;
  getDatasetMeta(name: string): DatasetMeta | null;
  listDatasetMeta(): DatasetMeta[];
  markDatasetError(name: string, error: string): void;
  kvGet<T>(key: string): { value: T; updatedAt: string } | null;
  kvSet(key: string, value: unknown, updatedAt: string): void;
  kvDelete(key: string): void;
  wasNotified(userId: number, key: string): boolean;
  markNotified(userId: number, key: string, sentAt: string): void;
  close(): void;
}
```

- [ ] **Step 1: Write the failing test** — `test/db/store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openStore, type Store } from '../../src/server/db/store.js';

let s: Store;
beforeEach(() => { s = openStore(':memory:'); });

describe('store', () => {
  it('upserts users with a long random cal token and default prefs', () => {
    const u = s.upsertUser('me@x', 'Me');
    expect(u.calToken.length).toBeGreaterThanOrEqual(32);
    expect(u.ntfyTopic.length).toBeGreaterThanOrEqual(16);
    expect(u.navApp).toBe('apple');
    expect(u.notifyPrefs.enabled.vehicle).toBe(true);
    expect(s.upsertUser('me@x', 'Me Again').id).toBe(u.id);
    expect(s.getUserByCalToken(u.calToken)?.id).toBe(u.id);
  });
  it('rotating the cal token invalidates the old one', () => {
    const u = s.upsertUser('me@x', 'Me');
    const t = s.rotateCalToken(u.id);
    expect(t).not.toBe(u.calToken);
    expect(s.getUserByCalToken(u.calToken)).toBeNull();
  });
  it('isolates places between users', () => {
    const a = s.upsertUser('a@x', 'A'); const b = s.upsertUser('b@x', 'B');
    const p = s.createPlace(a.id, { kind: 'home', label: 'Home', address: '1 N State', lat: 41.88, lon: -87.62, radiusM: 300, zones: ['0101'] });
    expect(s.listPlaces(a.id)).toHaveLength(1);
    expect(s.listPlaces(b.id)).toHaveLength(0);
    expect(s.getPlace(b.id, p.id)).toBeNull();
    expect(s.updatePlace(b.id, p.id, { label: 'x' })).toBeNull();
    expect(s.deletePlace(b.id, p.id)).toBe(false);
    expect(s.updatePlace(a.id, p.id, { zones: ['0101', '0102'] })?.zones).toEqual(['0101', '0102']);
  });
  it('vehicles + status, deleted with the vehicle', () => {
    const a = s.upsertUser('a@x', 'A');
    const v = s.createVehicle(a.id, { plate: 'ABC123', state: 'IL', nickname: 'Car' });
    s.setVehicleStatus({ vehicleId: v.id, checkedAt: '2026-10-11T10:00:00', ok: true, matches: [], error: null });
    expect(s.getVehicleStatus(v.id)?.ok).toBe(true);
    expect(s.deleteVehicle(a.id, v.id)).toBe(true);
    expect(s.getVehicleStatus(v.id)).toBeNull();
  });
  it('datasets, kv, notifications', () => {
    s.saveDataset('payBlocks', [{ a: 1 }], 1, '2026-10-11T03:30:00');
    expect(s.loadDataset<any[]>('payBlocks')).toEqual([{ a: 1 }]);
    expect(s.getDatasetMeta('payBlocks')).toMatchObject({ rowCount: 1, status: 'ok', error: null });
    s.markDatasetError('payBlocks', 'boom');
    expect(s.getDatasetMeta('payBlocks')).toMatchObject({ rowCount: 1, status: 'error', error: 'boom' });
    expect(s.loadDataset<any[]>('payBlocks')).toEqual([{ a: 1 }]);
    s.kvSet('k', { x: 1 }, 't'); expect(s.kvGet<{ x: number }>('k')?.value.x).toBe(1);
    s.kvDelete('k'); expect(s.kvGet('k')).toBeNull();
    const u = s.upsertUser('a@x', 'A');
    expect(s.wasNotified(u.id, 'k1')).toBe(false);
    s.markNotified(u.id, 'k1', 't'); expect(s.wasNotified(u.id, 'k1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/db/store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/db/store.ts`**

```ts
import Database from 'better-sqlite3';
import { DEFAULT_NOTIFY_PREFS, type DatasetMeta, type NavApp, type NotifyPrefs, type Place, type User, type Vehicle, type VehicleStatus } from '../../shared/types.js';
import { randomToken } from '../util/random.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  cal_token TEXT NOT NULL UNIQUE, nav_app TEXT NOT NULL DEFAULT 'apple',
  ntfy_topic TEXT NOT NULL, notify_prefs TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('home','watch')), label TEXT NOT NULL, address TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, radius_m INTEGER NOT NULL, zones TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate TEXT NOT NULL, state TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS vehicle_status (
  vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL, ok INTEGER NOT NULL, matches TEXT NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS datasets (
  name TEXT PRIMARY KEY, data TEXT, fetched_at TEXT, row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok', error TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications_sent (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key));
`;

export type Store = ReturnType<typeof openStore>;

export function openStore(file: string) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const toUser = (r: any): User => ({
    id: r.id, login: r.login, name: r.name, calToken: r.cal_token, navApp: r.nav_app as NavApp,
    ntfyTopic: r.ntfy_topic, notifyPrefs: { ...DEFAULT_NOTIFY_PREFS, ...JSON.parse(r.notify_prefs) },
  });
  const toPlace = (r: any): Place => ({
    id: r.id, userId: r.user_id, kind: r.kind, label: r.label, address: r.address,
    lat: r.lat, lon: r.lon, radiusM: r.radius_m, zones: JSON.parse(r.zones),
  });
  const toVehicle = (r: any): Vehicle => ({ id: r.id, userId: r.user_id, plate: r.plate, state: r.state, nickname: r.nickname });
  const toMeta = (r: any): DatasetMeta => ({ name: r.name, fetchedAt: r.fetched_at, rowCount: r.row_count, status: r.status, error: r.error });

  const store = {
    upsertUser(login: string, name: string): User {
      const existing = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
      if (existing) {
        db.prepare('UPDATE users SET name = ? WHERE login = ?').run(name, login);
        return toUser({ ...(existing as object), name });
      }
      const info = db.prepare('INSERT INTO users (login, name, cal_token, ntfy_topic, notify_prefs) VALUES (?,?,?,?,?)')
        .run(login, name, randomToken(24), `ct-${randomToken(12)}`, JSON.stringify(DEFAULT_NOTIFY_PREFS));
      return store.getUser(Number(info.lastInsertRowid))!;
    },
    getUser(id: number): User | null { const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id); return r ? toUser(r) : null; },
    getUserByLogin(login: string): User | null { const r = db.prepare('SELECT * FROM users WHERE login = ?').get(login); return r ? toUser(r) : null; },
    getUserByCalToken(token: string): User | null { const r = db.prepare('SELECT * FROM users WHERE cal_token = ?').get(token); return r ? toUser(r) : null; },
    listUsers(): User[] { return db.prepare('SELECT * FROM users ORDER BY id').all().map(toUser); },
    updateUser(id: number, patch: { navApp?: NavApp; ntfyTopic?: string; notifyPrefs?: NotifyPrefs }): User {
      if (patch.navApp) db.prepare('UPDATE users SET nav_app = ? WHERE id = ?').run(patch.navApp, id);
      if (patch.ntfyTopic) db.prepare('UPDATE users SET ntfy_topic = ? WHERE id = ?').run(patch.ntfyTopic, id);
      if (patch.notifyPrefs) db.prepare('UPDATE users SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(patch.notifyPrefs), id);
      return store.getUser(id)!;
    },
    rotateCalToken(id: number): string {
      const t = randomToken(24);
      db.prepare('UPDATE users SET cal_token = ? WHERE id = ?').run(t, id);
      return t;
    },
    listPlaces(userId: number): Place[] { return db.prepare('SELECT * FROM places WHERE user_id = ? ORDER BY kind, id').all(userId).map(toPlace); },
    listAllPlaces(): Place[] { return db.prepare('SELECT * FROM places ORDER BY id').all().map(toPlace); },
    getPlace(userId: number, id: number): Place | null {
      const r = db.prepare('SELECT * FROM places WHERE user_id = ? AND id = ?').get(userId, id); return r ? toPlace(r) : null;
    },
    createPlace(userId: number, p: Omit<Place, 'id' | 'userId'>): Place {
      const info = db.prepare('INSERT INTO places (user_id, kind, label, address, lat, lon, radius_m, zones) VALUES (?,?,?,?,?,?,?,?)')
        .run(userId, p.kind, p.label, p.address, p.lat, p.lon, p.radiusM, JSON.stringify(p.zones));
      return store.getPlace(userId, Number(info.lastInsertRowid))!;
    },
    updatePlace(userId: number, id: number, patch: Partial<Pick<Place, 'label' | 'radiusM' | 'zones'>>): Place | null {
      const cur = store.getPlace(userId, id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      db.prepare('UPDATE places SET label = ?, radius_m = ?, zones = ? WHERE id = ? AND user_id = ?')
        .run(next.label, next.radiusM, JSON.stringify(next.zones), id, userId);
      return store.getPlace(userId, id);
    },
    deletePlace(userId: number, id: number): boolean { return db.prepare('DELETE FROM places WHERE user_id = ? AND id = ?').run(userId, id).changes > 0; },
    listVehicles(userId: number): Vehicle[] { return db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY id').all(userId).map(toVehicle); },
    listAllVehicles(): Vehicle[] { return db.prepare('SELECT * FROM vehicles ORDER BY id').all().map(toVehicle); },
    createVehicle(userId: number, v: Omit<Vehicle, 'id' | 'userId'>): Vehicle {
      const info = db.prepare('INSERT INTO vehicles (user_id, plate, state, nickname) VALUES (?,?,?,?)').run(userId, v.plate, v.state, v.nickname);
      return toVehicle(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(info.lastInsertRowid)));
    },
    deleteVehicle(userId: number, id: number): boolean { return db.prepare('DELETE FROM vehicles WHERE user_id = ? AND id = ?').run(userId, id).changes > 0; },
    setVehicleStatus(s: VehicleStatus): void {
      db.prepare('INSERT INTO vehicle_status (vehicle_id, checked_at, ok, matches, error) VALUES (?,?,?,?,?) ON CONFLICT(vehicle_id) DO UPDATE SET checked_at=excluded.checked_at, ok=excluded.ok, matches=excluded.matches, error=excluded.error')
        .run(s.vehicleId, s.checkedAt, s.ok ? 1 : 0, JSON.stringify(s.matches), s.error);
    },
    getVehicleStatus(vehicleId: number): VehicleStatus | null {
      const r: any = db.prepare('SELECT * FROM vehicle_status WHERE vehicle_id = ?').get(vehicleId);
      return r ? { vehicleId, checkedAt: r.checked_at, ok: !!r.ok, matches: JSON.parse(r.matches), error: r.error } : null;
    },
    saveDataset(name: string, rows: unknown, rowCount: number, fetchedAt: string): void {
      db.prepare("INSERT INTO datasets (name, data, fetched_at, row_count, status, error) VALUES (?,?,?,?,'ok',NULL) ON CONFLICT(name) DO UPDATE SET data=excluded.data, fetched_at=excluded.fetched_at, row_count=excluded.row_count, status='ok', error=NULL")
        .run(name, JSON.stringify(rows), fetchedAt, rowCount);
    },
    loadDataset<T>(name: string): T | null {
      const r: any = db.prepare('SELECT data FROM datasets WHERE name = ?').get(name);
      return r?.data ? (JSON.parse(r.data) as T) : null;
    },
    getDatasetMeta(name: string): DatasetMeta | null {
      const r = db.prepare('SELECT name, fetched_at, row_count, status, error FROM datasets WHERE name = ?').get(name); return r ? toMeta(r) : null;
    },
    listDatasetMeta(): DatasetMeta[] { return db.prepare('SELECT name, fetched_at, row_count, status, error FROM datasets ORDER BY name').all().map(toMeta); },
    markDatasetError(name: string, error: string): void {
      db.prepare("INSERT INTO datasets (name, status, error) VALUES (?, 'error', ?) ON CONFLICT(name) DO UPDATE SET status='error', error=excluded.error").run(name, error);
    },
    kvGet<T>(key: string): { value: T; updatedAt: string } | null {
      const r: any = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key);
      return r ? { value: JSON.parse(r.value) as T, updatedAt: r.updated_at } : null;
    },
    kvSet(key: string, value: unknown, updatedAt: string): void {
      db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, JSON.stringify(value), updatedAt);
    },
    kvDelete(key: string): void { db.prepare('DELETE FROM kv WHERE key = ?').run(key); },
    wasNotified(userId: number, key: string): boolean { return !!db.prepare('SELECT 1 FROM notifications_sent WHERE user_id = ? AND key = ?').get(userId, key); },
    markNotified(userId: number, key: string, sentAt: string): void {
      db.prepare('INSERT OR IGNORE INTO notifications_sent (user_id, key, sent_at) VALUES (?,?,?)').run(userId, key, sentAt);
    },
    close(): void { db.close(); },
  };
  return store;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/db/store.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: SQLite store with per-user isolation"
```

---

### Task 6: Dataset jobs, refresh with row-count guards, in-memory cache

**Files:**
- Create: `src/server/data/jobs.ts`, `src/server/data/refresh.ts`, `src/server/data/cache.ts`
- Test: `test/data/refresh.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `type DatasetName = 'payBlocks'|'payBoxes'|'cbd'|'snowRoutes'|'sweepSchedule'|'sweepZones'|'permitZones'|'permitsClosures'|'permitsCurrent'|'permitsBlockParty'|'permitsFilming'|'specialEvents'`
  - `interface DatasetJob { name: DatasetName; run: () => Promise<{ rows: unknown; count: number }> }`
  - `buildDatasetJobs(cfg: AppConfig, fetchJson: FetchJson, today: string): DatasetJob[]`
  - `refreshAll(store: Store, jobs: DatasetJob[], nowLocal: string): Promise<{ ok: DatasetName[]; failed: { name: DatasetName; error: string }[] }>`
  - `interface DataSnapshot { payBlocks: PayBlock[]; payBoxes: PayBox[]; cbd: MultiPolygonCoords | null; snowRoutes: SnowRoute[]; sweepSchedule: SweepRow[]; sweepZones: SweepZone[]; permitZones: PermitZoneRow[]; permits: Permit[]; events: SpecialEvent[] }`
  - `class DataCache { constructor(store: Store); snap: DataSnapshot; reload(): void; asOf(): Record<string, string | null> }`

- [ ] **Step 1: Write the failing test** — `test/data/refresh.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { openStore } from '../../src/server/db/store.js';
import { refreshAll, type DatasetJob } from '../../src/server/data/refresh.js';
import { DataCache } from '../../src/server/data/cache.js';

const job = (name: any, rows: unknown[] | Error): DatasetJob => ({
  name, run: async () => { if (rows instanceof Error) throw rows; return { rows, count: rows.length }; },
});

describe('refreshAll', () => {
  it('saves good datasets and isolates failures', async () => {
    const s = openStore(':memory:');
    const r = await refreshAll(s, [job('payBoxes', [{ a: 1 }, { a: 2 }]), job('payBlocks', new Error('down'))], '2026-10-11T03:30:00');
    expect(r.ok).toEqual(['payBoxes']);
    expect(r.failed[0]).toMatchObject({ name: 'payBlocks', error: 'down' });
    expect(s.getDatasetMeta('payBoxes')?.rowCount).toBe(2);
    expect(s.getDatasetMeta('payBlocks')?.status).toBe('error');
  });
  it('rejects zero rows and >50% drops, keeping the previous copy', async () => {
    const s = openStore(':memory:');
    await refreshAll(s, [job('payBoxes', Array.from({ length: 10 }, (_, i) => ({ i })))], 't1');
    const r1 = await refreshAll(s, [job('payBoxes', Array.from({ length: 4 }, (_, i) => ({ i })))], 't2');
    expect(r1.failed[0].error).toMatch(/suspicious row count 4 \(previous 10\)/);
    expect(s.loadDataset<any[]>('payBoxes')).toHaveLength(10);
    const r2 = await refreshAll(s, [job('payBoxes', [])], 't3');
    expect(r2.failed[0].error).toMatch(/suspicious row count 0/);
  });
});

describe('DataCache', () => {
  it('loads empty snapshot when nothing is stored, then reloads', async () => {
    const s = openStore(':memory:');
    const c = new DataCache(s);
    expect(c.snap.payBlocks).toEqual([]);
    expect(c.snap.cbd).toBeNull();
    await refreshAll(s, [job('permitsCurrent', [{ id: 'p1' }]), job('permitsClosures', [{ id: 'p2' }])], 't');
    c.reload();
    expect(c.snap.permits.map((p: any) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(c.asOf().permitsCurrent).toBe('t');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/data/refresh.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/data/refresh.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/server/data/jobs.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import { arcgisQueryAll } from '../sources/arcgis.js';
import { socrataQueryAll } from '../sources/socrata.js';
import * as N from './normalize.js';
import type { DatasetJob } from './refresh.js';
import type { PermitDataset } from '../../shared/types.js';
import { addDays } from '../util/chicagoTime.js';

export function buildDatasetJobs(cfg: AppConfig, fetchJson: FetchJson, today: string): DatasetJob[] {
  const d = cfg.datasets;
  const arc = (layer: number) => arcgisQueryAll(fetchJson, d.arcgisBase, layer);
  const soc = (id: string, q: { where?: string; select?: string } = {}) =>
    socrataQueryAll(fetchJson, d.socrataBase, id, q, { appToken: cfg.socrataAppToken });
  const list = <T>(rows: T[]) => ({ rows, count: rows.length });
  const permitJob = (name: DatasetJob['name'], id: string, ds: PermitDataset): DatasetJob => ({
    name, run: async () => list((await soc(id, { where: N.permitWindowWhere(today) })).map((r) => N.normPermit(r, ds))),
  });
  return [
    { name: 'payBlocks', run: async () => list((await arc(d.layers.payBlocks)).map(N.normPayBlock)) },
    { name: 'payBoxes', run: async () => list((await arc(d.layers.payBoxes)).map(N.normPayBox)) },
    { name: 'cbd', run: async () => { const mp = N.normCbd(await arc(d.layers.cbd)); return { rows: mp, count: mp ? 1 : 0 }; } },
    { name: 'snowRoutes', run: async () => list((await arc(d.layers.snowRoutes)).map(N.normSnowRoute)) },
    { name: 'sweepSchedule', run: async () => list((await soc(d.socrata.sweepSchedule)).map(N.normSweepRow)) },
    { name: 'sweepZones', run: async () => list((await soc(d.socrata.sweepZones)).map(N.normSweepZone).filter((z) => z !== null)) },
    { name: 'permitZones', run: async () => list((await soc(d.socrata.permitZones, { where: "status = 'ACTIVE'" })).map(N.normPermitZone).filter((z) => z !== null)) },
    permitJob('permitsClosures', d.socrata.permitsClosures, 'closures'),
    permitJob('permitsCurrent', d.socrata.permitsCurrent, 'current'),
    permitJob('permitsBlockParty', d.socrata.permitsBlockParty, 'blockparty'),
    permitJob('permitsFilming', d.socrata.permitsFilming, 'filming'),
    { name: 'specialEvents', run: async () => list((await soc(d.socrata.specialEvents, { where: `date >= '${addDays(today, -1)}T00:00:00'` })).map(N.normEvent)) },
  ];
}
```

Note: if `specialEvents` legitimately returns 0 future rows (the dataset was last refreshed in January), the guard marks it as an error and keeps the old copy. That is the intended "stale" signal. The UI shows its `fetchedAt` / error.

- [ ] **Step 5: Implement `src/server/data/cache.ts`**

```ts
import type { Store } from '../db/store.js';
import type { MultiPolygonCoords, PayBlock, PayBox, Permit, PermitZoneRow, SnowRoute, SpecialEvent, SweepRow, SweepZone } from '../../shared/types.js';

export interface DataSnapshot {
  payBlocks: PayBlock[]; payBoxes: PayBox[]; cbd: MultiPolygonCoords | null; snowRoutes: SnowRoute[];
  sweepSchedule: SweepRow[]; sweepZones: SweepZone[]; permitZones: PermitZoneRow[]; permits: Permit[]; events: SpecialEvent[];
}

const PERMIT_SETS = ['permitsClosures', 'permitsCurrent', 'permitsBlockParty', 'permitsFilming'] as const;

export class DataCache {
  snap: DataSnapshot;
  constructor(private store: Store) { this.snap = this.load(); }
  reload(): void { this.snap = this.load(); }
  private load(): DataSnapshot {
    const s = this.store;
    return {
      payBlocks: s.loadDataset<PayBlock[]>('payBlocks') ?? [],
      payBoxes: s.loadDataset<PayBox[]>('payBoxes') ?? [],
      cbd: s.loadDataset<MultiPolygonCoords>('cbd'),
      snowRoutes: s.loadDataset<SnowRoute[]>('snowRoutes') ?? [],
      sweepSchedule: s.loadDataset<SweepRow[]>('sweepSchedule') ?? [],
      sweepZones: s.loadDataset<SweepZone[]>('sweepZones') ?? [],
      permitZones: s.loadDataset<PermitZoneRow[]>('permitZones') ?? [],
      permits: PERMIT_SETS.flatMap((n) => s.loadDataset<Permit[]>(n) ?? []),
      events: s.loadDataset<SpecialEvent[]>('specialEvents') ?? [],
    };
  }
  asOf(): Record<string, string | null> {
    return Object.fromEntries(this.store.listDatasetMeta().map((m) => [m.name, m.fetchedAt]));
  }
}
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run`. Expected: PASS (all tests so far).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: dataset jobs, guarded refresh, in-memory cache"
```

---
## Phase B — Sweeping, calendar, API shell

### Task 7: Sweeping domain

**Files:**
- Create: `src/server/domain/sweeping.ts`
- Test: `test/domain/sweeping.test.ts`

**Interfaces:**
- Consumes: `SweepRow`, `SweepZone`, `SweepInfo`, `LngLat` (Task 1); geo `inMultiPolygon`, `distToMultiPolygonM`, `bboxNear` (Task 2); `DataSnapshot` (Task 6)
- Produces:
  - `type SweepIndex = Map<string, string[]>` (wardSection → sorted ISO dates)
  - `buildSweepIndex(rows: SweepRow[], year: number): SweepIndex`
  - `sweepIndexFor(snap: DataSnapshot, year: number): SweepIndex` (memoized per snapshot object)
  - `isSweepingOn(index: SweepIndex, wardSection: string, date: string): boolean`
  - `sweepInfo(index: SweepIndex, zones: string[], today: string, year: number, n = 10): SweepInfo`
  - `zoneCandidates(zones: SweepZone[], p: LngLat, radiusM = 40): SweepZone[]` (containing zone first, then by distance)
  - `zonesSweepingOn(index: SweepIndex, zones: SweepZone[], date: string): SweepZone[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildSweepIndex, isSweepingOn, sweepInfo, zoneCandidates, zonesSweepingOn } from '../../src/server/domain/sweeping.js';
import type { SweepZone } from '../../src/shared/types.js';

const rows = [
  { wardSection: '3204', month: 10, days: [14, 15] },
  { wardSection: '3204', month: 11, days: [3] },
  { wardSection: '3205', month: 10, days: [20] },
];
// Two zones sharing a boundary at lon -87.68 (the middle of a street).
const zW: SweepZone = { wardSection: '3204', ward: '32', section: '04', bbox: [-87.69, 41.91, -87.68, 41.92], polygon: [[[[-87.69, 41.91], [-87.68, 41.91], [-87.68, 41.92], [-87.69, 41.92], [-87.69, 41.91]]]] };
const zE: SweepZone = { wardSection: '3205', ward: '32', section: '05', bbox: [-87.68, 41.91, -87.67, 41.92], polygon: [[[[-87.68, 41.91], [-87.67, 41.91], [-87.67, 41.92], [-87.68, 41.92], [-87.68, 41.91]]]] };

describe('sweeping', () => {
  const idx = buildSweepIndex(rows, 2026);
  it('expands dates', () => {
    expect(idx.get('3204')).toEqual(['2026-10-14', '2026-10-15', '2026-11-03']);
    expect(isSweepingOn(idx, '3204', '2026-10-15')).toBe(true);
    expect(isSweepingOn(idx, '3204', '2026-10-16')).toBe(false);
  });
  it('sweepInfo merges zones and reports season state', () => {
    const a = sweepInfo(idx, ['3204', '3205'], '2026-10-15', 2026);
    expect(a.status).toBe('active');
    expect(a.upcoming.map((u) => u.date)).toEqual(['2026-10-15', '2026-10-20', '2026-11-03']);
    expect(sweepInfo(idx, ['3204'], '2026-12-01', 2026)).toMatchObject({ status: 'over', upcoming: [] });
    expect(sweepInfo(idx, ['3204'], '2027-01-10', 2026).status).toBe('nodata');
    expect(sweepInfo(idx, ['9999'], '2026-10-01', 2026).status).toBe('nodata');
    expect(sweepInfo(new Map(), [], '2026-10-01', 2026).status).toBe('nodata');
  });
  it('boundary street returns both zones, containing zone first', () => {
    const c = zoneCandidates([zE, zW], [-87.6801, 41.915]);
    expect(c.map((z) => z.wardSection)).toEqual(['3204', '3205']);
    expect(zoneCandidates([zE, zW], [-87.685, 41.915]).map((z) => z.wardSection)).toEqual(['3204']);
  });
  it('zones sweeping on a date', () => {
    expect(zonesSweepingOn(idx, [zW, zE], '2026-10-20').map((z) => z.wardSection)).toEqual(['3205']);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/sweeping.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/sweeping.ts`**

```ts
import type { LngLat, SweepInfo, SweepRow, SweepZone } from '../../shared/types.js';
import type { DataSnapshot } from '../data/cache.js';
import { bboxNear, distToMultiPolygonM } from './geo.js';

export type SweepIndex = Map<string, string[]>;
const p2 = (n: number) => String(n).padStart(2, '0');

export function buildSweepIndex(rows: SweepRow[], year: number): SweepIndex {
  const idx: SweepIndex = new Map();
  for (const r of rows) {
    const list = idx.get(r.wardSection) ?? [];
    for (const d of r.days) list.push(`${year}-${p2(r.month)}-${p2(d)}`);
    idx.set(r.wardSection, list);
  }
  for (const [k, v] of idx) idx.set(k, [...new Set(v)].sort());
  return idx;
}

const memo = new WeakMap<DataSnapshot, { year: number; idx: SweepIndex }>();
export function sweepIndexFor(snap: DataSnapshot, year: number): SweepIndex {
  const m = memo.get(snap);
  if (m && m.year === year) return m.idx;
  const idx = buildSweepIndex(snap.sweepSchedule, year);
  memo.set(snap, { year, idx });
  return idx;
}

export const isSweepingOn = (idx: SweepIndex, ws: string, date: string): boolean => idx.get(ws)?.includes(date) ?? false;

export function sweepInfo(idx: SweepIndex, zones: string[], today: string, year: number, n = 10): SweepInfo {
  const all = zones.flatMap((ws) => (idx.get(ws) ?? []).map((date) => ({ date, wardSection: ws })));
  if (!all.length || Number(today.slice(0, 4)) > year) return { status: 'nodata', zones, upcoming: [] };
  const upcoming = all.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.wardSection.localeCompare(b.wardSection));
  return { status: upcoming.length ? 'active' : 'over', zones, upcoming: upcoming.slice(0, n) };
}

export function zoneCandidates(zones: SweepZone[], p: LngLat, radiusM = 40): SweepZone[] {
  return zones
    .filter((z) => bboxNear(z.bbox, p, radiusM))
    .map((z) => ({ z, d: distToMultiPolygonM(p, z.polygon) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.z);
}

export const zonesSweepingOn = (idx: SweepIndex, zones: SweepZone[], date: string): SweepZone[] =>
  zones.filter((z) => isSweepingOn(idx, z.wardSection, date));
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/sweeping.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: sweeping schedule index, season status, zone candidates"
```

---

### Task 8: Calendar (.ics) generator

**Files:**
- Create: `src/server/domain/ics.ts`
- Test: `test/domain/ics.test.ts`

**Interfaces:**
- Consumes: `Place` (Task 1), `SweepIndex` (Task 7)
- Produces:
  - `interface IcsEvent { uid: string; date: string; summary: string; description: string }`
  - `buildIcs(calName: string, events: IcsEvent[], dtstampUtc: string): string` (CRLF lines, folded at 75 octets)
  - `sweepingEvents(homes: Place[], idx: SweepIndex): IcsEvent[]` (one event per ward-section+date; labels merged)
  - `icsEscape(s: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildIcs, sweepingEvents, icsEscape } from '../../src/server/domain/ics.js';
import { buildSweepIndex } from '../../src/server/domain/sweeping.js';
import type { Place } from '../../src/shared/types.js';

const home = (id: number, label: string, zones: string[]): Place => ({ id, userId: 1, kind: 'home', label, address: 'x', lat: 0, lon: 0, radiusM: 300, zones });

describe('ics', () => {
  const idx = buildSweepIndex([{ wardSection: '3204', month: 10, days: [14] }], 2026);
  it('builds a valid calendar with timezone, alarms and stable UIDs', () => {
    const ev = sweepingEvents([home(1, 'Home A', ['3204']), home(2, 'Home B', ['3204'])], idx);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Street cleaning — Home A, Home B (Ward 32 Sec 04)');
    const ics = buildIcs('Chicago street cleaning', ev, '20261011T120000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Chicago');
    expect(ics).toContain('UID:3204-2026-10-14@chicago-tracker');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261014T090000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261014T140000');
    expect(ics).toContain('TRIGGER:-PT14H');
    expect(ics).toContain('TRIGGER:-PT2H');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });
  it('is still valid with zero events (off-season)', () => {
    const ics = buildIcs('x', [], '20261211T120000Z');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });
  it('escapes text', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
  it('folds long lines on UTF-8 boundaries', () => {
    const ics = buildIcs('x', [{ uid: 'u', date: '2026-10-14', summary: '—'.repeat(60), description: 'd' }], '20261011T120000Z');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${'—'.repeat(60)}`);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/ics.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/ics.ts`**

```ts
import type { Place } from '../../shared/types.js';
import type { SweepIndex } from './sweeping.js';

export interface IcsEvent { uid: string; date: string; summary: string; description: string }

export const icsEscape = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > limit) { out.push(cur); cur = ''; limit = 74; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/Chicago',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildIcs(calName: string, events: IcsEvent[], dtstampUtc: string): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//chicago-tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`, 'X-WR-TIMEZONE:America/Chicago',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...VTIMEZONE,
  ];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstampUtc}`,
      `DTSTART;TZID=America/Chicago:${d}T090000`, `DTEND;TZID=America/Chicago:${d}T140000`,
      `SUMMARY:${icsEscape(e.summary)}`, `DESCRIPTION:${icsEscape(e.description)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Move your car — street cleaning tomorrow', 'TRIGGER:-PT14H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Street cleaning today 9am–2pm', 'TRIGGER:-PT2H', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function sweepingEvents(homes: Place[], idx: SweepIndex): IcsEvent[] {
  const byZone = new Map<string, string[]>();
  for (const h of homes) for (const ws of h.zones) byZone.set(ws, [...(byZone.get(ws) ?? []), h.label]);
  const events: IcsEvent[] = [];
  for (const [ws, labels] of byZone) {
    for (const date of idx.get(ws) ?? []) {
      events.push({
        uid: `${ws}-${date}@chicago-tracker`, date,
        summary: `Street cleaning — ${[...new Set(labels)].join(', ')} (Ward ${ws.slice(0, 2)} Sec ${ws.slice(2)})`,
        description: 'Typical posted window 9am–2pm. Check the temporary orange signs on your block.',
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/ics.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: RFC 5545 sweeping calendar generator"
```

---

### Task 9: Fastify app shell, Tailscale identity auth, security headers, /api/me

**Files:**
- Create: `src/server/services.ts`, `src/server/auth.ts`, `src/server/app.ts`, `src/server/routes/me.ts`, `test/helpers/testApp.ts`
- Test: `test/routes/auth-me.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 6.
- Produces:
  - `interface Services { geocode(q: string): Promise<GeoResult[]>; parcelsNear(center: LngLat, radiusM: number): Promise<Parcel[]>; plows(bbox: BBox): Promise<Plow[]>; refreshNow(): Promise<{ ok: string[]; failed: { name: string; error: string }[] }>; sendTestPush(user: User): Promise<void> }`
  - `interface AppDeps { cfg: AppConfig; store: Store; cache: DataCache; services: Services; nowLocal: () => string; webRoot?: string | null }`
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`
  - `resolveLogin(headers: Record<string, string | string[] | undefined>, cfg: AppConfig): { login: string; name: string } | null`
  - `isOwner(user: User, cfg: AppConfig): boolean`
  - `request.user: User` on every `/api/*` request
  - `calUrl(cfg: AppConfig, token: string): string` (`webcal://host/cal/<token>.ics`)
  - Test helper `makeTestApp(overrides?: Partial<AppDeps>): Promise<{ app: FastifyInstance; deps: AppDeps }>`; `asUser(login: string): Record<string,string>` header builder

- [ ] **Step 1: Create `src/server/services.ts`**

```ts
import type { BBox, GeoResult, LngLat, Parcel, Plow, User } from '../shared/types.js';
import type { AppConfig } from './config.js';
import type { Store } from './db/store.js';
import type { DataCache } from './data/cache.js';

export interface Services {
  geocode(q: string): Promise<GeoResult[]>;
  parcelsNear(center: LngLat, radiusM: number): Promise<Parcel[]>;
  plows(bbox: BBox): Promise<Plow[]>;
  refreshNow(): Promise<{ ok: string[]; failed: { name: string; error: string }[] }>;
  sendTestPush(user: User): Promise<void>;
}

export interface AppDeps {
  cfg: AppConfig; store: Store; cache: DataCache; services: Services;
  nowLocal: () => string; webRoot?: string | null;
}
```

- [ ] **Step 2: Create the test helper `test/helpers/testApp.ts`**

```ts
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { openStore } from '../../src/server/db/store.js';
import { DataCache } from '../../src/server/data/cache.js';
import type { AppDeps, Services } from '../../src/server/services.js';

export const OWNER = 'owner@example.com';
export const asUser = (login: string, name = login) => ({ 'tailscale-user-login': login, 'tailscale-user-name': name });

export const stubServices = (): Services => ({
  geocode: async () => [{ label: '730 W Randolph St, Chicago', lat: 41.8845, lon: -87.647 }],
  parcelsNear: async () => [],
  plows: async () => [],
  refreshNow: async () => ({ ok: [], failed: [] }),
  sendTestPush: async () => {},
});

export async function makeTestApp(overrides: Partial<AppDeps> = {}, env: Record<string, string> = {}) {
  const cfg = loadConfig({ OWNER_LOGIN: OWNER, ALLOWED_LOGINS: 'bro@example.com', PUBLIC_BASE_URL: 'https://chicago.tail1234.ts.net', NOMINATIM_CONTACT: 'owner@example.com', ...env }, 'config');
  const store = openStore(':memory:');
  const deps: AppDeps = { cfg, store, cache: new DataCache(store), services: stubServices(), nowLocal: () => '2026-10-11T12:00:00', webRoot: null, ...overrides };
  const app = await buildApp(deps);
  return { app, deps };
}
```

- [ ] **Step 3: Write the failing test** — `test/routes/auth-me.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

describe('auth + /api/me', () => {
  it('401 without a tailscale identity', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });
  it('403 for a login not on the allow-list', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: asUser('stranger@x') })).statusCode).toBe(403);
  });
  it('creates the owner on first request and returns a webcal url', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER, 'Owner') });
    expect(r.statusCode).toBe(200);
    const me = r.json();
    expect(me).toMatchObject({ login: OWNER, isOwner: true, navApp: 'apple' });
    expect(me.calUrl).toMatch(/^webcal:\/\/chicago\.tail1234\.ts\.net\/cal\/[A-Za-z0-9_-]{32,}\.ics$/);
  });
  it('allowed second user is a separate, non-owner profile', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: asUser('bro@example.com') });
    expect(r.json()).toMatchObject({ login: 'bro@example.com', isOwner: false });
  });
  it('single-user mode maps header-less requests to the configured login', async () => {
    const { app } = await makeTestApp({}, { SINGLE_USER_LOGIN: OWNER });
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.json().login).toBe(OWNER);
  });
  it('PATCH navApp validates input', async () => {
    const { app } = await makeTestApp();
    const ok = await app.inject({ method: 'PATCH', url: '/api/me', headers: asUser(OWNER), payload: { navApp: 'waze' } });
    expect(ok.json().navApp).toBe('waze');
    const bad = await app.inject({ method: 'PATCH', url: '/api/me', headers: asUser(OWNER), payload: { navApp: 'bing' } });
    expect(bad.statusCode).toBe(400);
  });
  it('rotates the calendar token', async () => {
    const { app } = await makeTestApp();
    const a = (await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER) })).json().calUrl;
    const b = (await app.inject({ method: 'POST', url: '/api/me/cal-token', headers: asUser(OWNER) })).json().calUrl;
    expect(a).not.toBe(b);
  });
  it('healthz is public and sets security headers', async () => {
    const { app } = await makeTestApp();
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});
```

- [ ] **Step 4: Run it and verify it fails**

Run: `npx vitest run test/routes/auth-me.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement `src/server/auth.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { AppDeps } from './services.js';
import type { User } from '../shared/types.js';

declare module 'fastify' { interface FastifyRequest { user: User } }

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function resolveLogin(headers: Record<string, string | string[] | undefined>, cfg: AppConfig): { login: string; name: string } | null {
  const login = first(headers['tailscale-user-login']);
  if (login) return { login, name: first(headers['tailscale-user-name']) ?? login };
  if (cfg.singleUserLogin) return { login: cfg.singleUserLogin, name: cfg.singleUserLogin };
  return null;
}

export const isOwner = (user: User, cfg: AppConfig): boolean => user.login === cfg.ownerLogin;

export function registerAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('user', null as unknown as User);
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const who = resolveLogin(req.headers, deps.cfg);
    if (!who) return reply.code(401).send({ error: 'No Tailscale identity on request' });
    if (!deps.cfg.allowedLogins.includes(who.login)) return reply.code(403).send({ error: 'Not allowed' });
    req.user = deps.store.upsertUser(who.login, who.name);
  });
}
```

- [ ] **Step 6: Implement `src/server/routes/me.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { AppConfig } from '../config.js';
import type { NavApp, User } from '../../shared/types.js';
import { isOwner } from '../auth.js';

export const calUrl = (cfg: AppConfig, token: string): string =>
  `${cfg.publicBaseUrl.replace(/^https?:/, 'webcal:')}/cal/${token}.ics`;

const NAV: NavApp[] = ['apple', 'google', 'waze'];

export function meView(deps: AppDeps, u: User) {
  return {
    login: u.login, name: u.name, isOwner: isOwner(u, deps.cfg), navApp: u.navApp,
    calUrl: calUrl(deps.cfg, u.calToken), ntfyTopic: u.ntfyTopic, notifyPrefs: u.notifyPrefs,
    ntfyConfigured: !!deps.cfg.ntfyUrl, ntfyUrl: deps.cfg.ntfyUrl, comedOutageUrl: deps.cfg.utilities.comedOutageUrl,
  };
}

export function registerMe(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/me', async (req) => meView(deps, req.user));
  app.patch<{ Body: { navApp?: string } }>('/api/me', async (req, reply) => {
    const nav = req.body?.navApp;
    if (nav !== undefined && !NAV.includes(nav as NavApp)) return reply.code(400).send({ error: 'navApp must be apple, google or waze' });
    return meView(deps, deps.store.updateUser(req.user.id, { navApp: nav as NavApp | undefined }));
  });
  app.post('/api/me/cal-token', async (req) => {
    deps.store.rotateCalToken(req.user.id);
    return meView(deps, deps.store.getUser(req.user.id)!);
  });
}
```

- [ ] **Step 7: Implement `src/server/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppDeps } from './services.js';
import { registerAuth } from './auth.js';
import { registerMe } from './routes/me.js';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Built-in request logging is disabled because it logs full URLs, and /api/geocode?q= and
  // /api/parking?lat=&lon= carry addresses and locations. Log route patterns only.
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, disableRequestLogging: true, trustProxy: true });
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ method: req.method, route: req.routeOptions.url ?? 'unmatched', status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true, ready: deps.cache.snap.payBlocks.length > 0 }));

  registerAuth(app, deps);
  registerMe(app, deps);
  // Later tasks add: registerPlaces, registerCal, registerParking, registerStatus,
  // registerWatch, registerVehicles, registerWinter, registerNotifications.

  const root = deps.webRoot === undefined ? resolve('dist/web') : deps.webRoot;
  if (root && existsSync(root)) {
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/cal/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
```

- [ ] **Step 8: Run it and verify it passes**

Run: `npx vitest run test/routes/auth-me.test.ts`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: Fastify app shell, tailscale identity auth, security headers, /api/me"
```

---

### Task 10: Geocoder, places, sweeping and calendar routes

**Files:**
- Create: `src/server/sources/nominatim.ts`, `src/server/routes/places.ts`, `src/server/routes/cal.ts`
- Modify: `src/server/app.ts` (register the new routes after `registerMe`)
- Test: `test/sources/geocode.test.ts`, `test/routes/places-cal.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 7, 8, 9.
- Produces:
  - `parseChicagoAddress(q: string): { num: number; dir: string; name: string; type: string | null } | null`
  - `createGeocoder(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string; sleep?: (ms: number) => Promise<void>; clock?: () => number }): (q: string) => Promise<GeoResult[]>`
  - Routes: `GET /api/geocode`, `GET|POST /api/places`, `PATCH|DELETE /api/places/:id`, `GET /api/places/:id/sweeping` (returns `SweepInfo & { candidates: { wardSection: string; next: string[] }[] }`), `GET /cal/:token.ics`
  - `registerPlaces(app, deps)`, `registerCal(app, deps)`

- [ ] **Step 1: Write the failing geocoder test** — `test/sources/geocode.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseChicagoAddress, createGeocoder } from '../../src/server/sources/nominatim.js';
import { loadConfig } from '../../src/server/config.js';
import { openStore } from '../../src/server/db/store.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x.ts.net', NOMINATIM_CONTACT: 'me@example.com' }, 'config');

describe('parseChicagoAddress', () => {
  it('handles lowercase, city/state/zip and unit suffixes', () => {
    expect(parseChicagoAddress('1200 w randolph st, chicago il 60607')).toEqual({ num: 1200, dir: 'W', name: 'RANDOLPH', type: 'ST' });
    expect(parseChicagoAddress('2550 N. Clark St. Apt 2')).toEqual({ num: 2550, dir: 'N', name: 'CLARK', type: 'ST' });
    expect(parseChicagoAddress('400 S Martin Luther King Jr Dr #5')).toEqual({ num: 400, dir: 'S', name: 'MARTIN LUTHER KING JR', type: 'DR' });
    expect(parseChicagoAddress('11 E Huron')).toEqual({ num: 11, dir: 'E', name: 'HURON', type: null });
    expect(parseChicagoAddress('Wrigley Field')).toBeNull();
  });
});

describe('createGeocoder', () => {
  it('queries Nominatim bounded to Chicago, caches, and throttles', async () => {
    const fetchJson = vi.fn().mockResolvedValue([{ display_name: 'Wrigley Field, Chicago', lat: '41.948', lon: '-87.655' }]);
    const sleeps: number[] = [];
    let t = 0;
    const g = createGeocoder({ fetchJson, cfg, store: openStore(':memory:'), nowLocal: () => 'n', sleep: async (ms) => { sleeps.push(ms); t += ms; }, clock: () => t });
    expect(await g('Wrigley Field')).toEqual([{ label: 'Wrigley Field, Chicago', lat: 41.948, lon: -87.655 }]);
    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.hostname).toBe('nominatim.openstreetmap.org');
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('viewbox')).toBe('-87.9401,42.0230,-87.5240,41.6445');
    await g('wrigley field');            // cached (case-insensitive) → no new call
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await g('Soldier Field');            // second live call must wait ≥ 1.1 s
    expect(sleeps.some((ms) => ms >= 1000)).toBe(true);
  });
  it('falls back to the parcel layer when Nominatim finds nothing', async () => {
    const fetchJson = vi.fn(async (u: string) => {
      if (u.includes('nominatim')) return [];
      expect(new URL(u).searchParams.get('where')).toContain("ST_NAME = 'RANDOLPH'");
      return { features: [{ attributes: { L_ADDR: 1200, H_ADDR: 1200, PRE_DIR: 'W', ST_NAME: 'RANDOLPH', ST_TYPE: 'ST' }, geometry: { rings: [[[-87.66, 41.88], [-87.658, 41.88], [-87.658, 41.882], [-87.66, 41.882], [-87.66, 41.88]]] } }] };
    });
    const g = createGeocoder({ fetchJson, cfg, store: openStore(':memory:'), nowLocal: () => 'n', sleep: async () => {}, clock: () => 0 });
    const r = await g('1200 W Randolph St');
    expect(r[0].label).toBe('1200 W RANDOLPH ST');
    expect(r[0].lat).toBeCloseTo(41.881, 3);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/sources/geocode.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/sources/nominatim.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import type { GeoResult } from '../../shared/types.js';
import { arcgisQueryOnce } from './arcgis.js';
import { normParcel } from '../data/normalize.js';
import { soqlStr } from './socrata.js';

const TYPES = 'ST|AVE|BLVD|RD|DR|PL|CT|PKWY|TER|LN|WAY|HWY|SQ|PLZ|CIR|ROW|EXPY';
const VIEWBOX = '-87.9401,42.0230,-87.5240,41.6445';

export function parseChicagoAddress(q: string): { num: number; dir: string; name: string; type: string | null } | null {
  let s = q.toUpperCase().split(',')[0];
  s = s.replace(/\./g, '').replace(/\s+(APT|UNIT|STE|SUITE|FL)\s*\S+.*$/, '').replace(/\s*#\s*\S+.*$/, '');
  s = s.replace(/\s+CHICAGO\b.*$/, '').replace(/\s+/g, ' ').trim();
  const m = s.match(new RegExp(`^(\\d+)\\s+([NSEW])\\s+(.+?)(?:\\s+(${TYPES}))?$`));
  if (!m) return null;
  return { num: Number(m[1]), dir: m[2], name: m[3].trim(), type: m[4] ?? null };
}

export function createGeocoder(d: {
  fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string;
  sleep?: (ms: number) => Promise<void>; clock?: () => number;
}) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = d.clock ?? (() => Date.now());
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();

  const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + 1100 - clock();
      if (wait > 0) await sleep(wait);
      last = clock();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };

  async function nominatim(q: string): Promise<GeoResult[]> {
    const p = new URLSearchParams({ q, format: 'jsonv2', limit: '5', viewbox: VIEWBOX, bounded: '1', countrycodes: 'us' });
    const rows = await throttled(() => d.fetchJson(`https://nominatim.openstreetmap.org/search?${p}`, {
      headers: { 'User-Agent': `chicago-tracker/0.1 (${d.cfg.nominatimContact})` },
    }));
    return (rows as any[]).map((r) => ({ label: String(r.display_name), lat: Number(r.lat), lon: Number(r.lon) }));
  }

  async function parcel(q: string): Promise<GeoResult[]> {
    const a = parseChicagoAddress(q);
    if (!a) return [];
    const where = [`L_ADDR <= ${a.num}`, `H_ADDR >= ${a.num}`, `PRE_DIR = ${soqlStr(a.dir)}`, `ST_NAME = ${soqlStr(a.name)}`, ...(a.type ? [`ST_TYPE = ${soqlStr(a.type)}`] : [])].join(' AND ');
    const feats = await arcgisQueryOnce(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.parcels, { where, outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE', resultRecordCount: '1' });
    const p = feats.map(normParcel).find((x) => x !== null);
    return p ? [{ label: [a.num, a.dir, a.name, a.type].filter(Boolean).join(' '), lat: p.centroid[1], lon: p.centroid[0] }] : [];
  }

  return async function geocode(q: string): Promise<GeoResult[]> {
    const key = `geocode:${q.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const hit = d.store.kvGet<GeoResult[]>(key);
    if (hit) return hit.value;
    let res: GeoResult[] = [];
    try { res = await nominatim(q); } catch { res = []; }
    if (!res.length) { try { res = await parcel(q); } catch { res = []; } }
    if (res.length) d.store.kvSet(key, res, d.nowLocal());
    return res;
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/sources/geocode.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing route test** — `test/routes/places-cal.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

const zone = (ws: string, x0: number, x1: number) => ({ wardSection: ws, ward: ws.slice(0, 2), section: ws.slice(2), bbox: [x0, 41.88, x1, 41.89], polygon: [[[[x0, 41.88], [x1, 41.88], [x1, 41.89], [x0, 41.89], [x0, 41.88]]]] });

async function seeded() {
  const t = await makeTestApp();
  t.deps.store.saveDataset('sweepZones', [zone('2701', -87.650, -87.647), zone('2702', -87.647, -87.640)], 2, 't');
  t.deps.store.saveDataset('sweepSchedule', [{ wardSection: '2701', month: 10, days: [14] }, { wardSection: '2702', month: 10, days: [20] }], 2, 't');
  t.deps.cache.reload();
  return t;
}

describe('places + sweeping + calendar', () => {
  it('creating a home on a zone boundary returns both candidates and assigns none', async () => {
    const { app } = await seeded();
    const r = await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: '730 W Randolph' } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.place.zones).toEqual([]);
    expect(body.candidates.map((c: any) => c.wardSection).sort()).toEqual(['2701', '2702']);
  });
  it('confirming zones then reading sweeping + ics', async () => {
    const { app } = await seeded();
    const created = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: 'x' } })).json();
    const id = created.place.id;
    const bad = await app.inject({ method: 'PATCH', url: `/api/places/${id}`, headers: asUser(OWNER), payload: { zones: ['nope'] } });
    expect(bad.statusCode).toBe(400);
    await app.inject({ method: 'PATCH', url: `/api/places/${id}`, headers: asUser(OWNER), payload: { zones: ['2701', '2702'] } });
    const sw = (await app.inject({ method: 'GET', url: `/api/places/${id}/sweeping`, headers: asUser(OWNER) })).json();
    expect(sw.status).toBe('active');
    expect(sw.upcoming.map((u: any) => u.date)).toEqual(['2026-10-14', '2026-10-20']);
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: asUser(OWNER) })).json();
    const path = new URL(me.calUrl.replace('webcal:', 'https:')).pathname;
    const ics = await app.inject({ method: 'GET', url: path });
    expect(ics.statusCode).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('UID:2701-2026-10-14@chicago-tracker');
  });
  it('unknown calendar token is 404 and other users cannot touch my places', async () => {
    const { app } = await seeded();
    expect((await app.inject({ method: 'GET', url: '/cal/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaa.ics' })).statusCode).toBe(404);
    const id = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'watch', label: 'Work', address: 'x' } })).json().place.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/places/${id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/places', headers: asUser('bro@example.com') })).json()).toEqual([]);
  });
  it('422 when an address cannot be geocoded; 400 on bad kind', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), geocode: async () => [] } });
    expect((await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'x', address: 'nowhere' } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'boat', label: 'x', address: 'y' } })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run test/routes/places-cal.test.ts`. Expected: FAIL (404s, routes missing).

- [ ] **Step 7: Implement `src/server/routes/places.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { PlaceKind } from '../../shared/types.js';
import { datePart } from '../util/chicagoTime.js';
import { sweepIndexFor, sweepInfo, zoneCandidates } from '../domain/sweeping.js';

const LIMITS: Record<PlaceKind, number> = { home: 5, watch: 10 };
const clampRadius = (r: unknown, def = 300) => Math.min(1000, Math.max(100, Number.isFinite(Number(r)) ? Number(r) : def));
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function registerPlaces(app: FastifyInstance, deps: AppDeps): void {
  const year = () => deps.cfg.datasets.sweepingYear;
  const idx = () => sweepIndexFor(deps.cache.snap, year());
  const candidatesFor = (lon: number, lat: number) => {
    const today = datePart(deps.nowLocal());
    return zoneCandidates(deps.cache.snap.sweepZones, [lon, lat]).map((z) => ({
      wardSection: z.wardSection,
      next: sweepInfo(idx(), [z.wardSection], today, year(), 3).upcoming.map((u) => u.date),
    }));
  };

  app.get<{ Querystring: { q?: string } }>('/api/geocode', async (req, reply) => {
    const q = str(req.query.q);
    if (q.length < 3) return reply.code(400).send({ error: 'q must be at least 3 characters' });
    return deps.services.geocode(q);
  });

  app.get('/api/places', async (req) => deps.store.listPlaces(req.user.id));

  app.post<{ Body: { kind?: string; label?: string; address?: string; radiusM?: number } }>('/api/places', async (req, reply) => {
    const kind = req.body?.kind as PlaceKind;
    if (kind !== 'home' && kind !== 'watch') return reply.code(400).send({ error: 'kind must be home or watch' });
    const label = str(req.body.label, 60), address = str(req.body.address);
    if (!label || !address) return reply.code(400).send({ error: 'label and address are required' });
    if (deps.store.listPlaces(req.user.id).filter((p) => p.kind === kind).length >= LIMITS[kind]) {
      return reply.code(409).send({ error: `At most ${LIMITS[kind]} ${kind} places` });
    }
    const [hit] = await deps.services.geocode(address);
    if (!hit) return reply.code(422).send({ error: "Couldn't find that address" });
    const candidates = kind === 'home' ? candidatesFor(hit.lon, hit.lat) : [];
    const place = deps.store.createPlace(req.user.id, {
      kind, label, address: hit.label, lat: hit.lat, lon: hit.lon, radiusM: clampRadius(req.body.radiusM),
      zones: candidates.length === 1 ? [candidates[0].wardSection] : [],
    });
    return reply.code(201).send({ place, candidates });
  });

  app.patch<{ Params: { id: string }; Body: { label?: string; radiusM?: number; zones?: unknown } }>('/api/places/:id', async (req, reply) => {
    const patch: { label?: string; radiusM?: number; zones?: string[] } = {};
    if (req.body?.label !== undefined) patch.label = str(req.body.label, 60);
    if (req.body?.radiusM !== undefined) patch.radiusM = clampRadius(req.body.radiusM);
    if (req.body?.zones !== undefined) {
      const z = req.body.zones;
      if (!Array.isArray(z) || z.length > 4 || !z.every((x) => typeof x === 'string' && /^\d{4}$/.test(x))) {
        return reply.code(400).send({ error: 'zones must be up to 4 ward-section codes like "3204"' });
      }
      patch.zones = [...new Set(z as string[])];
    }
    const p = deps.store.updatePlace(req.user.id, Number(req.params.id), patch);
    return p ?? reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/places/:id', async (req, reply) =>
    deps.store.deletePlace(req.user.id, Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }));

  app.get<{ Params: { id: string } }>('/api/places/:id/sweeping', async (req, reply) => {
    const p = deps.store.getPlace(req.user.id, Number(req.params.id));
    if (!p) return reply.code(404).send({ error: 'Not found' });
    const info = sweepInfo(idx(), p.zones, datePart(deps.nowLocal()), year());
    return { ...info, candidates: candidatesFor(p.lon, p.lat) };
  });
}
```

- [ ] **Step 8: Implement `src/server/routes/cal.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { buildIcs, sweepingEvents } from '../domain/ics.js';
import { sweepIndexFor } from '../domain/sweeping.js';

const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function registerCal(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { token: string } }>('/cal/:token', async (req, reply) => {
    const m = req.params.token.match(/^([A-Za-z0-9_-]{20,})\.ics$/);
    const user = m ? deps.store.getUserByCalToken(m[1]) : null;
    if (!user) return reply.code(404).send('Not found');
    const homes = deps.store.listPlaces(user.id).filter((p) => p.kind === 'home');
    const ics = buildIcs('Chicago street cleaning', sweepingEvents(homes, sweepIndexFor(deps.cache.snap, deps.cfg.datasets.sweepingYear)), utcStamp());
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Cache-Control', 'no-store').send(ics);
  });
}
```

- [ ] **Step 9: Register the routes in `src/server/app.ts`**

Add imports and calls right after `registerMe(app, deps);`:

```ts
import { registerPlaces } from './routes/places.js';
import { registerCal } from './routes/cal.js';
// ...
registerPlaces(app, deps);
registerCal(app, deps);
```

- [ ] **Step 10: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: geocoder, places with zone picker, sweeping info, calendar feed"
```

---

## Phase C — Parking map backend

### Task 11: Rate tiers

**Files:**
- Create: `src/server/domain/rates.ts`
- Test: `test/domain/rates.test.ts`

**Interfaces:**
- Consumes: `RatesConfig` (Task 1), `inMultiPolygon` (Task 2)
- Produces: `rateFor(p: LngLat, rates: RatesConfig, cbd: MultiPolygonCoords | null): RateInfo`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { rateFor } from '../../src/server/domain/rates.js';
import { loadConfig } from '../../src/server/config.js';

const { rates } = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('rateFor', () => {
  it('Loop', () => expect(rateFor([-87.6278, 41.8819], rates, null)).toMatchObject({ tier: 'loop', hourly: 7, approximate: true }));
  it('CBD via fallback polygon when the city layer is missing', () => expect(rateFor([-87.6298, 41.8995], rates, null).tier).toBe('cbd'));
  it('CBD via city layer takes precedence', () => {
    const cbd = [[[[-87.70, 41.95], [-87.69, 41.95], [-87.69, 41.96], [-87.70, 41.96], [-87.70, 41.95]]]] as any;
    expect(rateFor([-87.695, 41.955], rates, cbd).tier).toBe('cbd');
    expect(rateFor([-87.6298, 41.8995], rates, cbd).tier).toBe('neighborhood');
  });
  it('West Loop', () => expect(rateFor([-87.6560, 41.8840], rates, null).tier).toBe('westloop'));
  it('Neighborhood', () => expect(rateFor([-87.6870, 41.9220], rates, null)).toMatchObject({ tier: 'neighborhood', hourly: 2.5 }));
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/rates.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/rates.ts`**

```ts
import type { RatesConfig } from '../config.js';
import type { LngLat, MultiPolygonCoords, RateInfo, RateTier } from '../../shared/types.js';
import { inMultiPolygon } from './geo.js';

export function rateFor(p: LngLat, rates: RatesConfig, cbd: MultiPolygonCoords | null): RateInfo {
  const info = (tier: RateTier): RateInfo => ({ tier, hourly: rates[tier].hourly, hoursText: rates[tier].hoursText, approximate: true });
  if (inMultiPolygon(p, [rates.loop.polygon])) return info('loop');
  if (inMultiPolygon(p, cbd ?? [rates.cbd.fallbackPolygon])) return info('cbd');
  if (inMultiPolygon(p, [rates.westloop.polygon])) return info('westloop');
  return info('neighborhood');
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/rates.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: approximate meter rate tiers"
```

---

### Task 12: Permit-zone matching and parcel fetcher

**Files:**
- Create: `src/server/domain/permitZones.ts`, `src/server/sources/parcels.ts`
- Test: `test/domain/permitZones.test.ts`

**Interfaces:**
- Consumes: `Parcel`, `PermitZoneRow`, `PermitZoneFeature` (Task 1); `arcgisQueryNear` (Task 3); `normParcel` (Task 4); `Store.kvGet/kvSet` (Task 5)
- Produces:
  - `normStreetPart(s: string): string`
  - `matchPermitZones(parcels: Parcel[], rows: PermitZoneRow[]): PermitZoneFeature[]`
  - `createParcelFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): (center: LngLat, radiusM: number) => Promise<Parcel[]>` (24h cache)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { matchPermitZones, normStreetPart } from '../../src/server/domain/permitZones.js';
import type { Parcel, PermitZoneRow } from '../../src/shared/types.js';

const parcel = (n: number, x: number, name = 'WILSON', type = 'AVE'): Parcel => ({ low: n, high: n, dir: 'W', name, type, centroid: [x, 41.965] });
const row: PermitZoneRow = { zone: '1130', oddEven: 'O', low: 1363, high: 1425, dir: 'W', name: 'WILSON', type: 'AVE' };

describe('permit zones', () => {
  it('normalizes street parts', () => {
    expect(normStreetPart(' st. ')).toBe('ST');
    expect(normStreetPart('Martin  Luther King Jr.')).toBe('MARTIN LUTHER KING JR');
  });
  it('matches by range + parity and groups into a line sorted by address', () => {
    const f = matchPermitZones([parcel(1401, -87.663), parcel(1365, -87.661), parcel(1400, -87.662), parcel(1501, -87.665)], [row]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ zone: '1130', parity: 'O', street: 'W WILSON AVE', label: 'Permit zone 1130 — residents only' });
    expect(f[0].line).toEqual([[-87.661, 41.965], [-87.663, 41.965]]);
  });
  it('B parity matches both sides; empty street_type on either side still matches', () => {
    const f = matchPermitZones([parcel(1400, -87.662, 'WILSON', ''), parcel(1401, -87.663)], [{ ...row, oddEven: 'B', type: '' }]);
    expect(f.map((x) => x.parity).sort()).toEqual(['E', 'O']);
  });
  it('different street type does not match', () => {
    expect(matchPermitZones([parcel(1401, -87.663, 'WILSON', 'ST')], [row])).toEqual([]);
  });
  it('ignores parcels with address 0', () => {
    expect(matchPermitZones([parcel(0, -87.663)], [{ ...row, low: 0 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/permitZones.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/permitZones.ts`**

```ts
import type { LngLat, Parcel, PermitZoneFeature, PermitZoneRow } from '../../shared/types.js';

export const normStreetPart = (s: string): string => (s ?? '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

export function matchPermitZones(parcels: Parcel[], rows: PermitZoneRow[]): PermitZoneFeature[] {
  const byStreet = new Map<string, PermitZoneRow[]>();
  for (const r of rows) {
    const k = `${normStreetPart(r.dir)}|${normStreetPart(r.name)}`;
    byStreet.set(k, [...(byStreet.get(k) ?? []), r]);
  }
  const groups = new Map<string, { zone: string; street: string; parity: 'O' | 'E'; pts: { n: number; c: LngLat }[] }>();
  for (const p of parcels) {
    const n = p.low;
    if (!n) continue;
    const parity: 'O' | 'E' = n % 2 ? 'O' : 'E';
    const pType = normStreetPart(p.type);
    for (const r of byStreet.get(`${normStreetPart(p.dir)}|${normStreetPart(p.name)}`) ?? []) {
      const rType = normStreetPart(r.type);
      if (rType && pType && rType !== pType) continue;
      if (n < r.low || n > r.high) continue;
      if (r.oddEven !== 'B' && r.oddEven !== parity) continue;
      const street = [normStreetPart(p.dir), normStreetPart(p.name), pType || rType].filter(Boolean).join(' ');
      const key = `${r.zone}|${street}|${parity}`;
      const g = groups.get(key) ?? { zone: r.zone, street, parity, pts: [] };
      g.pts.push({ n, c: p.centroid });
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => ({
    zone: g.zone, street: g.street, parity: g.parity,
    line: g.pts.sort((a, b) => a.n - b.n).map((x) => x.c),
    label: `Permit zone ${g.zone} — residents only`,
  }));
}
```

- [ ] **Step 4: Implement `src/server/sources/parcels.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import type { LngLat, Parcel } from '../../shared/types.js';
import { arcgisQueryNear } from './arcgis.js';
import { normParcel } from '../data/normalize.js';

const DAY_MS = 24 * 3600 * 1000;

export function createParcelFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string; nowMs?: () => number }) {
  const nowMs = d.nowMs ?? (() => Date.now());
  return async (center: LngLat, radiusM: number): Promise<Parcel[]> => {
    const key = `parcels:${center[0].toFixed(4)},${center[1].toFixed(4)},${Math.round(radiusM)}`;
    const hit = d.store.kvGet<{ ms: number; parcels: Parcel[] }>(key);
    if (hit && nowMs() - hit.value.ms < DAY_MS) return hit.value.parcels;
    const feats = await arcgisQueryNear(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.parcels, center, radiusM, {
      outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE',
    });
    const parcels = feats.map(normParcel).filter((p): p is Parcel => p !== null);
    d.store.kvSet(key, { ms: nowMs(), parcels }, d.nowLocal());
    return parcels;
  };
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run test/domain/permitZones.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: residential permit-zone matching via parcel addresses"
```

---

### Task 13: Parking result builder with block flags

**Files:**
- Create: `src/server/domain/parking.ts`
- Test: `test/domain/parking.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 7, 11 and the shared types.
- Produces:

```ts
export interface ParkingInput {
  snap: DataSnapshot; center: LngLat; radiusM: number; at: string;
  rates: RatesConfig; closureRedPattern: string; sweepIdx: SweepIndex;
  permitZones: PermitZoneFeature[]; warnings: string[]; dataAsOf: Record<string, string | null>;
}
export function buildParking(inp: ParkingInput): ParkingResult;
export const STATUS_ORDER: Record<BlockStatus, number>; // green 0, info 1, amber 2, red 3
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildParking } from '../../src/server/domain/parking.js';
import { buildSweepIndex } from '../../src/server/domain/sweeping.js';
import { loadConfig } from '../../src/server/config.js';
import type { DataSnapshot } from '../../src/server/data/cache.js';
import type { PayBlock, Permit } from '../../src/shared/types.js';

const { rates, datasets } = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
const center: [number, number] = [-87.6870, 41.9220]; // neighborhood

const block = (id: string, dx: number, extra: Partial<PayBlock> = {}): PayBlock => {
  const paths: [number, number][][] = [[[center[0] + dx, center[1] - 0.0005], [center[0] + dx, center[1] + 0.0005]]];
  return { blockId: id, street: 'N TEST AVE', from: 2000, to: 2050, parity: 'E', spaces: 6, hourLimit: '2', payZone: 1, payArea: 101, sundayHours: 'N', paths, bbox: [center[0] + dx, center[1] - 0.0005, center[0] + dx, center[1] + 0.0005], ...extra };
};
const permit = (p: Partial<Permit>): Permit => ({ id: 'p', dataset: 'closures', appType: '', workType: 'Opening', start: '2026-10-01T00:00:00', end: '2026-10-30T23:59:59', location: 'x', streetClosure: 'Full', detail: null, comments: null, meterBagging: false, applicant: 'X', point: [center[0] + 0.001, center[1]], ...p });

const snap = (over: Partial<DataSnapshot> = {}): DataSnapshot => ({
  payBlocks: [block('near', 0.0005), block('far', 0.003), block('closed', 0.001), block('outside', 0.05)],
  payBoxes: [], cbd: null, snowRoutes: [], sweepSchedule: [], permitZones: [], events: [],
  sweepZones: [{ wardSection: '0101', ward: '01', section: '01', bbox: [center[0] + 0.0002, center[1] - 0.01, center[0] + 0.0008, center[1] + 0.01], polygon: [[[[center[0] + 0.0002, center[1] - 0.01], [center[0] + 0.0008, center[1] - 0.01], [center[0] + 0.0008, center[1] + 0.01], [center[0] + 0.0002, center[1] + 0.01], [center[0] + 0.0002, center[1] - 0.01]]]] }],
  permits: [permit({})],
  ...over,
});
const idx = buildSweepIndex([{ wardSection: '0101', month: 10, days: [12] }], 2026);
const run = (at: string, s = snap(), extra: Partial<Parameters<typeof buildParking>[0]> = {}) =>
  buildParking({ snap: s, center, radiusM: 400, at, rates, closureRedPattern: datasets.closureRedPattern, sweepIdx: idx, permitZones: [], warnings: [], dataAsOf: {}, ...extra });

describe('buildParking', () => {
  it('filters by radius, sorts green first then distance, attaches rate + nav point', () => {
    const r = run('2026-10-13T10:00:00');
    expect(r.blocks.map((b) => b.blockId)).toEqual(['near', 'far', 'closed']);
    expect(r.blocks[0]).toMatchObject({ status: 'green', rate: { tier: 'neighborhood', hourly: 2.5 } });
    expect(r.blocks[2]).toMatchObject({ status: 'red' });
    expect(r.blocks[2].flags[0]).toMatchObject({ code: 'CLOSED', severity: 'red' });
    expect(r.blocks[0].navPoint[1]).toBeCloseTo(center[1], 4);
  });
  it('SWEEPING only before 14:00 on the sweep date (Chicago-local `at`)', () => {
    expect(run('2026-10-12T08:00:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).toContain('SWEEPING');
    expect(run('2026-10-12T15:00:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).not.toContain('SWEEPING');
    // Late on the previous evening: no sweeping flag yet, even though UTC is already the 12th.
    expect(run('2026-10-11T23:30:00').blocks.find((b) => b.blockId === 'near')!.flags.map((f) => f.code)).not.toContain('SWEEPING');
  });
  it('sidewalk-only closures do not flag red; bagged meters do', () => {
    const s = snap({ permits: [permit({ streetClosure: 'Sidewalk' })] });
    expect(run('2026-10-13T10:00:00', s).blocks.find((b) => b.blockId === 'closed')!.status).toBe('green');
    const s2 = snap({ permits: [permit({ dataset: 'current', streetClosure: 'Sidewalk', meterBagging: true })] });
    expect(run('2026-10-13T10:00:00', s2).blocks.find((b) => b.blockId === 'closed')!.flags[0].code).toBe('METERS_BAGGED');
  });
  it('expired permits are ignored', () => {
    expect(run('2026-11-05T10:00:00').blocks.find((b) => b.blockId === 'closed')!.status).toBe('green');
  });
  it('events nearby are amber; Sunday adds info; snow route only Dec–Mar', () => {
    const s = snap({
      permits: [],
      events: [{ id: 'e', date: '2026-12-13', venueAddress: 'x', type: 'Parade', details: 'p', startTime: '10', point: [center[0] + 0.0005, center[1] + 0.0003] }],
      snowRoutes: [{ id: 'r', paths: [[[center[0] + 0.0005, center[1] - 0.01], [center[0] + 0.0005, center[1] + 0.01]]], bbox: [center[0] + 0.0005, center[1] - 0.01, center[0] + 0.0005, center[1] + 0.01] }],
    });
    const near = run('2026-12-13T10:00:00', s).blocks.find((b) => b.blockId === 'near')!; // 2026-12-13 is a Sunday
    expect(near.flags.map((f) => f.code).sort()).toEqual(['EVENT_NEARBY', 'SNOW_ROUTE', 'SUNDAY']);
    expect(near.status).toBe('amber');
    const oct = run('2026-10-14T10:00:00', s).blocks.find((b) => b.blockId === 'near')!;
    expect(oct.flags.map((f) => f.code)).not.toContain('SNOW_ROUTE');
  });
  it('hour limit falls back to a matching pay box', () => {
    const s = snap({ permits: [], payBlocks: [block('near', 0.0005, { hourLimit: null })], payBoxes: [{ terminalId: 1, street: 'N TEST AVE', from: 2000, to: 2050, addr: 2010, spaces: 6, hourLimit: '3', payZone: 1, payArea: 101, point: [center[0] + 0.0005, center[1]] }] });
    expect(run('2026-10-13T10:00:00', s).blocks[0].hourLimit).toBe('3');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/parking.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/parking.ts`**

```ts
import type { RatesConfig } from '../config.js';
import type { DataSnapshot } from '../data/cache.js';
import type { BlockFlag, BlockStatus, LngLat, ParkingBlock, ParkingResult, PayBlock, PayBox, PermitZoneFeature } from '../../shared/types.js';
import { bboxNear, distM, distToPathsM, inMultiPolygon, midpointOfPaths, nearestOnPaths } from './geo.js';
import { rateFor } from './rates.js';
import { type SweepIndex, zonesSweepingOn } from './sweeping.js';
import { datePart, timePart, weekday } from '../util/chicagoTime.js';

export interface ParkingInput {
  snap: DataSnapshot; center: LngLat; radiusM: number; at: string;
  rates: RatesConfig; closureRedPattern: string; sweepIdx: SweepIndex;
  permitZones: PermitZoneFeature[]; warnings: string[]; dataAsOf: Record<string, string | null>;
}

export const STATUS_ORDER: Record<BlockStatus, number> = { green: 0, info: 1, amber: 2, red: 3 };
const SEV_ORDER = { info: 1, amber: 2, red: 3 } as const;

function hourLimitFor(b: PayBlock, boxes: PayBox[], mid: LngLat): string | null {
  if (b.hourLimit) return b.hourLimit;
  const same = boxes.find((x) => x.payArea === b.payArea && x.street === b.street && x.from <= b.to && x.to >= b.from && x.hourLimit);
  if (same) return same.hourLimit;
  const near = boxes.filter((x) => x.hourLimit).map((x) => ({ x, d: distM(mid, x.point) })).filter((o) => o.d <= 60).sort((a, c) => a.d - c.d)[0];
  return near?.x.hourLimit ?? null;
}

export function buildParking(inp: ParkingInput): ParkingResult {
  const { snap, center, radiusM, at } = inp;
  const date = datePart(at), time = timePart(at), month = Number(date.slice(5, 7));
  const reach = radiusM + 150;
  const closureRe = new RegExp(inp.closureRedPattern, 'i');

  const active = snap.permits.filter((p) => p.point && p.start <= at && p.end >= at && distM(center, p.point) <= reach);
  const events = snap.events.filter((e) => e.date === date && e.point && distM(center, e.point) <= reach);
  const sweepingZones = time < '14:00' ? zonesSweepingOn(inp.sweepIdx, snap.sweepZones.filter((z) => bboxNear(z.bbox, center, reach)), date) : [];
  const boxes = snap.payBoxes.filter((x) => distM(center, x.point) <= radiusM);
  const winter = month === 12 || month <= 3;

  const blocks: ParkingBlock[] = [];
  for (const b of snap.payBlocks) {
    if (!bboxNear(b.bbox, center, radiusM)) continue;
    const distanceM = distToPathsM(center, b.paths);
    if (distanceM > radiusM) continue;
    const mid = midpointOfPaths(b.paths);
    const flags: BlockFlag[] = [];

    const z = sweepingZones.find((zz) => inMultiPolygon(mid, zz.polygon));
    if (z) flags.push({ code: 'SWEEPING', severity: 'red', reason: `Street cleaning today (Ward ${z.ward} Sec ${z.section}), typically 9am–2pm` });

    const closure = active.find((p) => p.dataset === 'closures' && p.streetClosure && closureRe.test(p.streetClosure) && distToPathsM(p.point!, b.paths) <= 30);
    if (closure) flags.push({ code: 'CLOSED', severity: 'red', reason: `${closure.streetClosure} closure — ${closure.workType || closure.appType} until ${closure.end.slice(0, 10)}` });

    const bag = active.find((p) => p.meterBagging && distToPathsM(p.point!, b.paths) <= 30);
    if (bag) flags.push({ code: 'METERS_BAGGED', severity: 'red', reason: `Meters may be bagged (permit ${bag.id}, until ${bag.end.slice(0, 10)})` });

    const ev = events.find((e) => distM(mid, e.point!) <= 150);
    const party = active.find((p) => p.dataset === 'blockparty' && distM(mid, p.point!) <= 150);
    if (ev) flags.push({ code: 'EVENT_NEARBY', severity: 'amber', reason: `${ev.type}: ${ev.details} (${ev.venueAddress})` });
    else if (party) flags.push({ code: 'EVENT_NEARBY', severity: 'amber', reason: `Block party nearby (${party.location})` });

    if (winter && snap.snowRoutes.some((r) => bboxNear(r.bbox, mid, 15) && distToPathsM(mid, r.paths) <= 15)) {
      flags.push({ code: 'SNOW_ROUTE', severity: 'amber', reason: 'Snow route — 2-inch snow parking ban may apply' });
    }
    if (weekday(date) === 0) flags.push({ code: 'SUNDAY', severity: 'info', reason: 'Sunday: possibly free — check the posted sign' });

    const status: BlockStatus = flags.reduce<BlockStatus>((s, f) => (SEV_ORDER[f.severity] > STATUS_ORDER[s] ? f.severity : s), 'green');
    blocks.push({
      blockId: b.blockId, street: b.street, from: b.from, to: b.to, parity: b.parity, spaces: b.spaces,
      hourLimit: hourLimitFor(b, snap.payBoxes, mid), payArea: b.payArea, rate: rateFor(mid, inp.rates, snap.cbd),
      distanceM: Math.round(distanceM), navPoint: nearestOnPaths(center, b.paths), paths: b.paths, flags, status,
    });
  }
  blocks.sort((a, c) => STATUS_ORDER[a.status] - STATUS_ORDER[c.status] || a.distanceM - c.distanceM);

  return {
    center, radiusM, at, blocks, boxes, permitZones: inp.permitZones,
    closures: active.filter((p) => p.dataset !== 'current'), events, warnings: inp.warnings, dataAsOf: inp.dataAsOf,
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/parking.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: parking result builder with sweeping/closure/bagging/event/snow/Sunday flags"
```

---

### Task 14: Parking, status and admin-refresh routes

**Files:**
- Create: `src/server/routes/parking.ts`, `src/server/routes/status.ts`
- Modify: `src/server/app.ts` (register both)
- Test: `test/routes/parking-status.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 12, 13.
- Produces: `GET /api/parking?lat&lon&radius&at` → `ParkingResult`; `GET /api/status` → `{ datasets: DatasetMeta[]; stale: string[]; pushFailing: string | null }`; `POST /api/admin/refresh` (owner only) → refresh report. Exports `registerParking(app, deps)`, `registerStatus(app, deps)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

const blk = { blockId: 'B1', street: 'W RANDOLPH ST', from: 724, to: 740, parity: 'N', spaces: 14, hourLimit: '2', payZone: 4, payArea: 257, sundayHours: 'N', paths: [[[-87.6475, 41.8845], [-87.6465, 41.8845]]], bbox: [-87.6475, 41.8845, -87.6465, 41.8845] };

describe('/api/parking', () => {
  it('returns blocks near the destination with Chicago-local default `at`', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-13T09:15:00' });
    deps.store.saveDataset('payBlocks', [blk], 1, '2026-10-13T03:30:00'); deps.cache.reload();
    const r = await app.inject({ method: 'GET', url: '/api/parking?lat=41.8846&lon=-87.6470', headers: asUser(OWNER) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.at).toBe('2026-10-13T09:15:00');
    expect(body.radiusM).toBe(400);
    // 730 W Randolph is east of Halsted (800 W), so it falls in the CBD tier.
    expect(body.blocks[0]).toMatchObject({ blockId: 'B1', payArea: 257, rate: { tier: 'cbd' } });
    expect(body.dataAsOf.payBlocks).toBe('2026-10-13T03:30:00');
  });
  it('validates coordinates, clamps radius, validates `at`', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=40&lon=-74', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&radius=99999', headers: asUser(OWNER) })).json().radiusM).toBe(1500);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&at=tomorrow', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64&at=2026-10-14T18:00', headers: asUser(OWNER) })).json().at).toBe('2026-10-14T18:00:00');
  });
  it('degrades gracefully when the parcel lookup fails', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), parcelsNear: async () => { throw new Error('arcgis down'); } } });
    const body = (await app.inject({ method: 'GET', url: '/api/parking?lat=41.88&lon=-87.64', headers: asUser(OWNER) })).json();
    expect(body.permitZones).toEqual([]);
    expect(body.warnings).toContain('Permit-zone info unavailable');
  });
});

describe('/api/status and admin refresh', () => {
  it('lists dataset meta and stale names (>48h)', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-13T12:00:00' });
    deps.store.saveDataset('payBlocks', [1], 1, '2026-10-13T03:30:00');
    deps.store.saveDataset('specialEvents', [1], 1, '2026-10-01T03:30:00');
    const s = (await app.inject({ method: 'GET', url: '/api/status', headers: asUser(OWNER) })).json();
    expect(s.datasets.map((d: any) => d.name).sort()).toEqual(['payBlocks', 'specialEvents']);
    expect(s.stale).toEqual(['specialEvents']);
  });
  it('refresh is owner-only', async () => {
    const { app } = await makeTestApp();
    expect((await app.inject({ method: 'POST', url: '/api/admin/refresh', headers: asUser('bro@example.com') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/refresh', headers: asUser(OWNER) })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/routes/parking-status.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/routes/parking.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { PermitZoneFeature } from '../../shared/types.js';
import { buildParking } from '../domain/parking.js';
import { matchPermitZones } from '../domain/permitZones.js';
import { sweepIndexFor } from '../domain/sweeping.js';

const CHI = { minLat: 41.62, maxLat: 42.03, minLon: -87.95, maxLon: -87.52 };
export const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function registerParking(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { lat?: string; lon?: string; radius?: string; at?: string } }>('/api/parking', async (req, reply) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!(lat >= CHI.minLat && lat <= CHI.maxLat && lon >= CHI.minLon && lon <= CHI.maxLon)) {
      return reply.code(400).send({ error: 'lat/lon must be inside Chicago' });
    }
    const radiusM = Math.min(1500, Math.max(100, Number(req.query.radius ?? 400) || 400));
    let at = req.query.at ?? deps.nowLocal();
    if (!AT_RE.test(at)) return reply.code(400).send({ error: 'at must be YYYY-MM-DDTHH:mm (Chicago local)' });
    if (at.length === 16) at += ':00';

    const warnings: string[] = [];
    let permitZones: PermitZoneFeature[] = [];
    try {
      permitZones = matchPermitZones(await deps.services.parcelsNear([lon, lat], radiusM), deps.cache.snap.permitZones);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'parcel lookup failed');
      warnings.push('Permit-zone info unavailable');
    }
    return buildParking({
      snap: deps.cache.snap, center: [lon, lat], radiusM, at, rates: deps.cfg.rates,
      closureRedPattern: deps.cfg.datasets.closureRedPattern,
      sweepIdx: sweepIndexFor(deps.cache.snap, deps.cfg.datasets.sweepingYear),
      permitZones, warnings, dataAsOf: deps.cache.asOf(),
    });
  });
}
```

- [ ] **Step 4: Implement `src/server/routes/status.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { isOwner } from '../auth.js';

const hoursBetween = (a: string, b: string) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 3_600_000;

export function registerStatus(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/status', async () => {
    const now = deps.nowLocal();
    const datasets = deps.store.listDatasetMeta();
    const stale = datasets.filter((d) => !d.fetchedAt || hoursBetween(d.fetchedAt, now) > 48).map((d) => d.name);
    const push = deps.store.kvGet<string>('ntfy:lastError');
    return { datasets, stale, pushFailing: push?.value ?? null };
  });
  app.post('/api/admin/refresh', async (req, reply) => {
    if (!isOwner(req.user, deps.cfg)) return reply.code(403).send({ error: 'Owner only' });
    const report = await deps.services.refreshNow();
    deps.cache.reload();
    return report;
  });
}
```

- [ ] **Step 5: Register both in `src/server/app.ts`**

```ts
import { registerParking } from './routes/parking.js';
import { registerStatus } from './routes/status.js';
// after registerCal(app, deps);
registerParking(app, deps);
registerStatus(app, deps);
```

- [ ] **Step 6: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: /api/parking, /api/status, owner-only refresh"
```

---
## Phase D — Watched addresses

### Task 15: Utility tagging, watch builder, 311 refresh, /api/watch

**Files:**
- Create: `src/server/domain/utilityTag.ts`, `src/server/domain/watch.ts`, `src/server/jobs/requests311Job.ts`, `src/server/routes/watch.ts`
- Modify: `src/server/app.ts` (register `registerWatch`)
- Test: `test/domain/watch.test.ts`, `test/routes/watch.test.ts`

**Interfaces:**
- Consumes: Tasks 1–9, 13 (`DataSnapshot`, store, geo, `sweepInfo`).
- Produces:
  - `utilityTag(p: Pick<Permit, 'applicant'>, cfg: UtilitiesConfig): UtilityTag`
  - `buildWatch(inp: { snap: DataSnapshot; place: Place; today: string; days: number; utilities: UtilitiesConfig; requests: Request311[]; excluded311: string[]; sweeping: string[]; dataAsOf: Record<string, string | null> }): WatchResult`
  - `group311(reqs: Request311[], center: LngLat, radiusM: number, excluded: string[]): Request311Group[]`
  - `newWorkCandidates(snap: DataSnapshot, place: Place, today: string, utilities: UtilitiesConfig): WatchItem[]` (utility-tagged or full-closure permits within the radius over the next 14 days)
  - `refresh311(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void>` (stores `kv['311:<placeId>'] = Request311[]`)
  - `GET /api/watch/:placeId?days=14` → `WatchResult`

- [ ] **Step 1: Write the failing domain test** — `test/domain/watch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { utilityTag } from '../../src/server/domain/utilityTag.js';
import { buildWatch, group311, newWorkCandidates } from '../../src/server/domain/watch.js';
import { loadConfig } from '../../src/server/config.js';
import type { DataSnapshot } from '../../src/server/data/cache.js';
import type { Permit, Place, Request311 } from '../../src/shared/types.js';

const { utilities } = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');
const place: Place = { id: 7, userId: 1, kind: 'watch', label: 'Work', address: 'x', lat: 41.9, lon: -87.65, radiusM: 300 , zones: [] };
const P = (o: Partial<Permit>): Permit => ({ id: 'p', dataset: 'current', appType: 'DOT Public Way Opening', workType: 'Opening in the Public Way', start: '2026-10-12T00:00:00', end: '2026-10-20T23:59:59', location: '100 W X ST', streetClosure: null, detail: 'dig', comments: null, meterBagging: false, applicant: 'X', point: [-87.6501, 41.9001], ...o });
const snap = (permits: Permit[]): DataSnapshot => ({ payBlocks: [], payBoxes: [], cbd: null, snowRoutes: [], sweepSchedule: [], sweepZones: [], permitZones: [], permits, events: [{ id: 'e1', date: '2026-10-15', venueAddress: 'x', type: 'Festival', details: 'Fest', startTime: '10', point: [-87.6502, 41.9002] }] });

describe('utilityTag', () => {
  it('classifies applicants case-insensitively', () => {
    expect(utilityTag({ applicant: 'ComED North*' }, utilities)).toBe('comed');
    expect(utilityTag({ applicant: 'Peoples Gas*' }, utilities)).toBe('peoplesgas');
    expect(utilityTag({ applicant: 'DWM*' }, utilities)).toBe('water');
    expect(utilityTag({ applicant: 'AT&T (SBC IL)*' }, utilities)).toBe('telecom');
    expect(utilityTag({ applicant: 'SEVEN-D CONSTRUCTION' }, utilities)).toBeNull();
  });
});

describe('buildWatch', () => {
  it('dedupes by permit id across datasets, filters by window and radius, tags utilities', () => {
    const r = buildWatch({
      snap: snap([P({ id: 'a', applicant: 'Peoples Gas*' }), P({ id: 'a', dataset: 'closures' }), P({ id: 'old', start: '2018-01-01T00:00:00', end: '2018-02-01T00:00:00' }), P({ id: 'far', point: [-87.70, 41.9] }), P({ id: 'later', start: '2026-12-01T00:00:00', end: '2026-12-02T00:00:00' })]),
      place, today: '2026-10-11', days: 14, utilities, requests: [], excluded311: [], sweeping: [], dataAsOf: {},
    });
    expect(r.items.map((i) => i.id)).toEqual(['a', 'e1']);
    expect(r.items[0]).toMatchObject({ kind: 'permit', utility: 'peoplesgas' });
    expect(r.items[1]).toMatchObject({ kind: 'event', dataset: 'event', title: 'Festival: Fest' });
  });
  it('groups 311 requests, excluding duplicates, excluded types and far ones', () => {
    const q = (o: Partial<Request311>): Request311 => ({ id: 'r', type: 'Pothole in Street Complaint', status: 'Open', created: '2026-10-05T10:00:00', closed: null, address: 'x', point: [-87.6501, 41.9001], duplicate: false, ...o });
    const g = group311([q({ id: '1' }), q({ id: '2' }), q({ id: '3', duplicate: true }), q({ id: '4', type: '311 INFORMATION ONLY CALL' }), q({ id: '5', type: 'Street Light Out Complaint' }), q({ id: '6', point: [-87.7, 41.9] })], [place.lon, place.lat], 300, ['311 INFORMATION ONLY CALL']);
    expect(g.map((x) => [x.type, x.count])).toEqual([['Pothole in Street Complaint', 2], ['Street Light Out Complaint', 1]]);
  });
  it('newWorkCandidates keeps only utility-tagged or full-closure permits', () => {
    const s = snap([P({ id: 'gas', applicant: 'Peoples Gas*' }), P({ id: 'full', streetClosure: 'Full' }), P({ id: 'plain' })]);
    expect(newWorkCandidates(s, place, '2026-10-11', utilities).map((i) => i.id).sort()).toEqual(['full', 'gas']);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/watch.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/utilityTag.ts`**

```ts
import type { UtilitiesConfig } from '../config.js';
import type { Permit, UtilityTag } from '../../shared/types.js';

export function utilityTag(p: Pick<Permit, 'applicant'>, cfg: UtilitiesConfig): UtilityTag {
  const a = (p.applicant ?? '').toUpperCase();
  for (const t of cfg.tags) if (t.patterns.some((pat) => a.includes(pat.toUpperCase()))) return t.tag;
  return null;
}
```

- [ ] **Step 4: Implement `src/server/domain/watch.ts`**

```ts
import type { UtilitiesConfig } from '../config.js';
import type { DataSnapshot } from '../data/cache.js';
import type { LngLat, Permit, Place, Request311, Request311Group, WatchItem, WatchResult } from '../../shared/types.js';
import { distM } from './geo.js';
import { utilityTag } from './utilityTag.js';
import { addDays } from '../util/chicagoTime.js';

function permitItem(p: Permit, center: LngLat, utilities: UtilitiesConfig): WatchItem {
  const closure = p.streetClosure ? ` (${p.streetClosure} closure)` : '';
  return {
    id: p.id, kind: 'permit', dataset: p.dataset, title: `${p.workType || p.appType}${closure}`,
    start: p.start, end: p.end, location: p.location,
    description: [p.detail, p.comments].filter(Boolean).join(' — ') || p.appType,
    distanceM: Math.round(distM(center, p.point!)), utility: utilityTag(p, utilities), point: p.point,
  };
}

function permitsInWindow(snap: DataSnapshot, place: Place, today: string, days: number): Permit[] {
  const center: LngLat = [place.lon, place.lat];
  const from = `${today}T00:00:00`, to = `${addDays(today, days)}T23:59:59`;
  const seen = new Set<string>();
  return snap.permits.filter((p) => {
    if (!p.point || p.end < from || p.start > to || distM(center, p.point) > place.radiusM || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export function group311(reqs: Request311[], center: LngLat, radiusM: number, excluded: string[]): Request311Group[] {
  const ex = new Set(excluded.map((s) => s.toUpperCase()));
  const groups = new Map<string, Request311Group>();
  for (const r of reqs) {
    if (r.duplicate || !r.point || ex.has(r.type.toUpperCase())) continue;
    const d = distM(center, r.point);
    if (d > radiusM) continue;
    const g = groups.get(r.type) ?? { type: r.type, count: 0, items: [] };
    g.count++; g.items.push({ ...r, distanceM: Math.round(d) });
    groups.set(r.type, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.created.localeCompare(a.created)) }));
}

export function buildWatch(inp: {
  snap: DataSnapshot; place: Place; today: string; days: number; utilities: UtilitiesConfig;
  requests: Request311[]; excluded311: string[]; sweeping: string[]; dataAsOf: Record<string, string | null>;
}): WatchResult {
  const center: LngLat = [inp.place.lon, inp.place.lat];
  const end = addDays(inp.today, inp.days);
  const permits = permitsInWindow(inp.snap, inp.place, inp.today, inp.days).map((p) => permitItem(p, center, inp.utilities));
  const events: WatchItem[] = inp.snap.events
    .filter((e) => e.point && e.date >= inp.today && e.date <= end && distM(center, e.point) <= inp.place.radiusM)
    .map((e) => ({
      id: e.id, kind: 'event', dataset: 'event', title: `${e.type}: ${e.details}`, start: `${e.date}T00:00:00`, end: `${e.date}T23:59:59`,
      location: e.venueAddress, description: e.startTime && e.startTime !== 'N/A' ? `Starts ${e.startTime}` : '',
      distanceM: Math.round(distM(center, e.point!)), utility: null, point: e.point,
    }));
  const items = [...permits, ...events].sort((a, b) => a.start.localeCompare(b.start) || a.distanceM - b.distanceM);
  return {
    placeId: inp.place.id, items, requests311: group311(inp.requests, center, inp.place.radiusM, inp.excluded311),
    sweeping: inp.sweeping, dataAsOf: inp.dataAsOf,
  };
}

export function newWorkCandidates(snap: DataSnapshot, place: Place, today: string, utilities: UtilitiesConfig): WatchItem[] {
  const center: LngLat = [place.lon, place.lat];
  return permitsInWindow(snap, place, today, 14)
    .filter((p) => utilityTag(p, utilities) !== null || /full/i.test(p.streetClosure ?? ''))
    .map((p) => permitItem(p, center, utilities));
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run test/domain/watch.test.ts`. Expected: PASS.

- [ ] **Step 6: Implement `src/server/jobs/requests311Job.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import { socrataQueryAll } from '../sources/socrata.js';
import { norm311 } from '../data/normalize.js';
import { addDays, datePart } from '../util/chicagoTime.js';

export async function refresh311(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void> {
  const since = `${addDays(datePart(d.nowLocal()), -30)}T00:00:00`;
  for (const p of d.store.listAllPlaces()) {
    try {
      const rows = await socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, d.cfg.datasets.socrata.requests311, {
        select: 'sr_number,sr_type,status,created_date,closed_date,street_address,duplicate,latitude,longitude',
        where: `within_circle(location, ${p.lat}, ${p.lon}, ${p.radiusM}) AND created_date >= '${since}'`,
        order: 'created_date DESC',
      }, { appToken: d.cfg.socrataAppToken, pageSize: 1000 });
      d.store.kvSet(`311:${p.id}`, rows.map(norm311), d.nowLocal());
    } catch (e) {
      d.store.kvSet(`311err:${p.id}`, (e as Error).message, d.nowLocal());
    }
  }
}
```

- [ ] **Step 7: Write the failing route test** — `test/routes/watch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

describe('/api/watch/:placeId', () => {
  it('returns items, 311 groups and data-as-of for my place only', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-10-11T12:00:00' });
    const id = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'watch', label: 'Work', address: 'x' } })).json().place.id;
    deps.store.saveDataset('permitsCurrent', [{ id: 'g1', dataset: 'current', appType: 'Opening', workType: 'Gas main', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: '730 W RANDOLPH', streetClosure: null, detail: null, comments: null, meterBagging: false, applicant: 'Peoples Gas*', point: [-87.6471, 41.8846] }], 1, '2026-10-11T03:30:00');
    deps.cache.reload();
    deps.store.kvSet(`311:${id}`, [{ id: 'SR1', type: 'Pothole in Street Complaint', status: 'Open', created: '2026-10-05T00:00:00', closed: null, address: 'x', point: [-87.647, 41.8845], duplicate: false }], 't');
    const r = (await app.inject({ method: 'GET', url: `/api/watch/${id}`, headers: asUser(OWNER) })).json();
    expect(r.items[0]).toMatchObject({ id: 'g1', utility: 'peoplesgas' });
    expect(r.requests311[0]).toMatchObject({ type: 'Pothole in Street Complaint', count: 1 });
    expect(r.dataAsOf.permitsCurrent).toBe('2026-10-11T03:30:00');
    expect((await app.inject({ method: 'GET', url: `/api/watch/${id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 8: Implement `src/server/routes/watch.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { Request311 } from '../../shared/types.js';
import { buildWatch } from '../domain/watch.js';
import { sweepIndexFor, sweepInfo } from '../domain/sweeping.js';
import { datePart } from '../util/chicagoTime.js';

export function registerWatch(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { placeId: string }; Querystring: { days?: string } }>('/api/watch/:placeId', async (req, reply) => {
    const place = deps.store.getPlace(req.user.id, Number(req.params.placeId));
    if (!place) return reply.code(404).send({ error: 'Not found' });
    const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14) || 14));
    const today = datePart(deps.nowLocal());
    const year = deps.cfg.datasets.sweepingYear;
    const r311 = deps.store.kvGet<Request311[]>(`311:${place.id}`);
    const sweeping = place.kind === 'home' ? sweepInfo(sweepIndexFor(deps.cache.snap, year), place.zones, today, year, 3).upcoming.map((u) => u.date) : [];
    return buildWatch({
      snap: deps.cache.snap, place, today, days, utilities: deps.cfg.utilities,
      requests: r311?.value ?? [], excluded311: deps.cfg.excluded311, sweeping,
      dataAsOf: { ...deps.cache.asOf(), requests311: r311?.updatedAt ?? null },
    });
  });
}
```

In `src/server/app.ts`:
```ts
import { registerWatch } from './routes/watch.js';
// after registerStatus(app, deps);
registerWatch(app, deps);
```

- [ ] **Step 9: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: watched addresses with utility tags, events and 311"
```

---

## Phase E — Vehicles, winter, push

### Task 16: Vehicle check (towed / relocated)

**Files:**
- Create: `src/server/domain/vehicles.ts`, `src/server/jobs/vehicleJob.ts`, `src/server/routes/vehicles.ts`
- Modify: `src/server/services.ts` (add `checkVehicles(): Promise<void>` to `Services`), `test/helpers/testApp.ts` (stub it), `src/server/app.ts` (register)
- Test: `test/domain/vehicles.test.ts`, `test/routes/vehicles.test.ts`

**Interfaces:**
- Produces:
  - `normalizePlate(s: string): string`; `PLATE_RE = /^[A-Z0-9]{2,8}$/`; `STATE_RE = /^[A-Z]{2}$/`
  - `mapTowed(row: any): VehicleMatch` (key `tow:<inventory_number>`)
  - `mapRelocated(row: any): VehicleMatch` (key `reloc:<service_request_number>`)
  - `checkVehicles(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void>`
  - `Services.checkVehicles(): Promise<void>`
  - Routes: `GET /api/vehicles` → `(Vehicle & { status: VehicleStatus | null })[]`; `POST /api/vehicles`; `DELETE /api/vehicles/:id`; `GET /api/vehicles/status` (same shape as GET list)

- [ ] **Step 1: Write the failing domain/job test** — `test/domain/vehicles.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { normalizePlate, mapTowed, mapRelocated } from '../../src/server/domain/vehicles.js';
import { checkVehicles } from '../../src/server/jobs/vehicleJob.js';
import { openStore } from '../../src/server/db/store.js';
import { loadConfig } from '../../src/server/config.js';

const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('vehicles', () => {
  it('normalizes plates', () => {
    expect(normalizePlate(' abc-12 3 ')).toBe('ABC123');
  });
  it('maps towed and relocated rows', () => {
    expect(mapTowed({ tow_date: '2026-10-11T00:00:00.000', make: 'HOND', color: 'WHI', plate: 'X', state: 'IL', towed_to_address: '701 N. Sacramento', tow_facility_phone: '(773) 265-7605', inventory_number: '7172331' }))
      .toEqual({ kind: 'towed', key: 'tow:7172331', date: '2026-10-11', details: 'HOND WHI — inventory #7172331', address: '701 N. Sacramento', phone: '(773) 265-7605' });
    expect(mapRelocated({ relocated_date: '2026-10-10T00:00:00.000', relocated_reason: 'Street Cleaning', service_request_number: 'SR9', relocated_from_address_number: '1400', relocated_from_street_direction: 'W', relocated_from_street_name: 'WILSON', relocated_from_suffix: 'AVE', relocated_to_address_number: '1500', relocated_to_direction: 'W', relocated_to_street_name: 'WILSON', relocated_to_suffix: 'AVE' }))
      .toEqual({ kind: 'relocated', key: 'reloc:SR9', date: '2026-10-10', details: 'Street Cleaning — moved from 1400 W WILSON AVE', address: '1500 W WILSON AVE', phone: null });
  });
  it('job records matches, and records failures without claiming ok', async () => {
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    const v = store.createVehicle(u.id, { plate: 'ABC123', state: 'IL', nickname: 'Car' });
    const fetchJson = vi.fn(async (url: string) => {
      const where = new URL(url).searchParams.get('$where')!;
      expect(where).toContain("plate = 'ABC123' AND state = 'IL'");
      return url.includes(cfg.datasets.socrata.towed) ? [{ tow_date: '2026-10-11T00:00:00.000', inventory_number: '1', towed_to_address: 'lot', tow_facility_phone: 'p' }] : [];
    });
    await checkVehicles({ fetchJson, cfg, store, nowLocal: () => '2026-10-11T10:00:00' });
    expect(store.getVehicleStatus(v.id)).toMatchObject({ ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:1' }] });
    await checkVehicles({ fetchJson: async () => { throw new Error('down'); }, cfg, store, nowLocal: () => '2026-10-11T10:30:00' });
    expect(store.getVehicleStatus(v.id)).toMatchObject({ ok: false, error: 'down', checkedAt: '2026-10-11T10:30:00' });
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/vehicles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/vehicles.ts`**

```ts
import type { VehicleMatch } from '../../shared/types.js';
import { normalizeSocrataTs } from '../util/chicagoTime.js';

export const normalizePlate = (s: string): string => (s ?? '').toUpperCase().replace(/[\s-]/g, '');
export const PLATE_RE = /^[A-Z0-9]{2,8}$/;
export const STATE_RE = /^[A-Z]{2}$/;
const join = (...xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join(' ');

export function mapTowed(r: any): VehicleMatch {
  return {
    kind: 'towed', key: `tow:${r.inventory_number}`, date: normalizeSocrataTs(r.tow_date).slice(0, 10),
    details: `${join(r.make, r.color)} — inventory #${r.inventory_number}`,
    address: String(r.towed_to_address ?? ''), phone: r.tow_facility_phone ?? null,
  };
}

export function mapRelocated(r: any): VehicleMatch {
  return {
    kind: 'relocated', key: `reloc:${r.service_request_number}`, date: normalizeSocrataTs(r.relocated_date).slice(0, 10),
    details: `${r.relocated_reason ?? 'Relocated'} — moved from ${join(r.relocated_from_address_number, r.relocated_from_street_direction, r.relocated_from_street_name, r.relocated_from_suffix)}`,
    address: join(r.relocated_to_address_number, r.relocated_to_direction, r.relocated_to_street_name, r.relocated_to_suffix),
    phone: null,
  };
}
```

- [ ] **Step 4: Implement `src/server/jobs/vehicleJob.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { Store } from '../db/store.js';
import { socrataQueryAll, soqlStr } from '../sources/socrata.js';
import { mapRelocated, mapTowed } from '../domain/vehicles.js';
import { addDays, datePart } from '../util/chicagoTime.js';

export async function checkVehicles(d: { fetchJson: FetchJson; cfg: AppConfig; store: Store; nowLocal: () => string }): Promise<void> {
  const now = d.nowLocal();
  const since = `${addDays(datePart(now), -14)}T00:00:00`;
  const s = d.cfg.datasets.socrata;
  for (const v of d.store.listAllVehicles()) {
    const who = `plate = ${soqlStr(v.plate)} AND state = ${soqlStr(v.state)}`;
    try {
      const [towed, reloc] = await Promise.all([
        socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, s.towed, { where: `${who} AND tow_date >= '${since}'` }, { appToken: d.cfg.socrataAppToken }),
        socrataQueryAll(d.fetchJson, d.cfg.datasets.socrataBase, s.relocated, { where: `${who} AND relocated_date >= '${since}'` }, { appToken: d.cfg.socrataAppToken }),
      ]);
      d.store.setVehicleStatus({ vehicleId: v.id, checkedAt: now, ok: true, matches: [...towed.map(mapTowed), ...reloc.map(mapRelocated)], error: null });
    } catch (e) {
      const prev = d.store.getVehicleStatus(v.id);
      d.store.setVehicleStatus({ vehicleId: v.id, checkedAt: now, ok: false, matches: prev?.matches ?? [], error: (e as Error).message });
    }
  }
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run test/domain/vehicles.test.ts`. Expected: PASS.

- [ ] **Step 6: Add `checkVehicles` to `Services` and the test stub**

In `src/server/services.ts`, add to the `Services` interface:
```ts
  checkVehicles(): Promise<void>;
```
In `test/helpers/testApp.ts` `stubServices()`, add:
```ts
  checkVehicles: async () => {},
```

- [ ] **Step 7: Write the failing route test** — `test/routes/vehicles.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

describe('/api/vehicles', () => {
  it('validates, limits to 3, isolates users, and triggers a check', async () => {
    let checks = 0;
    const t = await makeTestApp();
    t.deps.services.checkVehicles = async () => { checks++; };
    const { app } = t;
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: '!!', state: 'IL' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'AB123', state: 'Illinois' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'ab-123', state: 'IL', nickname: 'Civic' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ plate: 'AB123', state: 'IL', nickname: 'Civic' });
    expect(checks).toBe(1);
    for (const p of ['B1', 'C1']) await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: p, state: 'IL' } });
    expect((await app.inject({ method: 'POST', url: '/api/vehicles', headers: asUser(OWNER), payload: { plate: 'D1', state: 'IL' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/vehicles', headers: asUser('bro@example.com') })).json()).toEqual([]);
    const list = (await app.inject({ method: 'GET', url: '/api/vehicles/status', headers: asUser(OWNER) })).json();
    expect(list).toHaveLength(3);
    expect(list[0].status).toBeNull();
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser('bro@example.com') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/vehicles/${list[0].id}`, headers: asUser(OWNER) })).statusCode).toBe(204);
  });
});
```

Plates are normalized (`ab-123` → `AB123`) and the state is uppercased before validation, so lowercase input is accepted. Only malformed values are rejected.

- [ ] **Step 8: Implement `src/server/routes/vehicles.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { normalizePlate, PLATE_RE, STATE_RE } from '../domain/vehicles.js';

export function registerVehicles(app: FastifyInstance, deps: AppDeps): void {
  const list = (userId: number) => deps.store.listVehicles(userId).map((v) => ({ ...v, status: deps.store.getVehicleStatus(v.id) }));
  app.get('/api/vehicles', async (req) => list(req.user.id));
  app.get('/api/vehicles/status', async (req) => list(req.user.id));
  app.post<{ Body: { plate?: string; state?: string; nickname?: string } }>('/api/vehicles', async (req, reply) => {
    const plate = normalizePlate(String(req.body?.plate ?? ''));
    const state = String(req.body?.state ?? '').trim().toUpperCase();
    if (!PLATE_RE.test(plate) || !STATE_RE.test(state)) return reply.code(400).send({ error: 'plate must be 2–8 letters/digits; state a 2-letter code' });
    if (deps.store.listVehicles(req.user.id).length >= 3) return reply.code(409).send({ error: 'At most 3 vehicles' });
    const v = deps.store.createVehicle(req.user.id, { plate, state, nickname: String(req.body?.nickname ?? '').trim().slice(0, 30) });
    deps.services.checkVehicles().catch((e) => req.log.warn({ err: (e as Error).message }, 'vehicle check failed'));
    return reply.code(201).send(v);
  });
  app.delete<{ Params: { id: string } }>('/api/vehicles/:id', async (req, reply) =>
    deps.store.deleteVehicle(req.user.id, Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }));
}
```

In `src/server/app.ts`:
```ts
import { registerVehicles } from './routes/vehicles.js';
// after registerWatch(app, deps);
registerVehicles(app, deps);
```

- [ ] **Step 9: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: towed/relocated vehicle check"
```

---

### Task 17: Winter: snow routes, NWS alerts, snowfall rule, plows

**Files:**
- Create: `src/server/domain/winter.ts`, `src/server/sources/nws.ts`, `src/server/sources/plows.ts`, `src/server/jobs/winterJob.ts`, `src/server/routes/winter.ts`
- Modify: `src/server/app.ts` (register)
- Test: `test/domain/winter.test.ts`, `test/routes/winter.test.ts`

**Interfaces:**
- Produces:
  - `WINTER_EVENT_RE: RegExp`; `BAN_THRESHOLD_MM = 50.8`
  - `onSnowRoute(routes: SnowRoute[], p: LngLat, maxM = 25): boolean`
  - `parseAlerts(geojson: any): NwsAlert[]`
  - `parseIsoDurationMs(s: string): number`
  - `snowNext24hMm(values: { validTime: string; value: number | null }[], nowMs: number): number` (prorates partially overlapping intervals)
  - `createNws(fetchJson: FetchJson, userAgent: string): { alerts(lat: number, lon: number): Promise<NwsAlert[]>; snowfallMm(lat: number, lon: number, nowMs: number): Promise<number> }`
  - `createPlowFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; nowMs?: () => number }): (bbox: BBox) => Promise<Plow[]>`
  - `refreshWinter(d: { nws: ReturnType<typeof createNws>; store: Store; cache: DataCache; nowLocal: () => string; nowMs: () => number; includeSnowfall: boolean }): Promise<void>`. Writes `kv['winter:<placeId>'] = WinterStatus` and `kv['snowban:<placeId>'] = { since: date }` while a possible ban is active.
  - Routes: `GET /api/winter` → `WinterStatus[]` (user's homes); `GET /api/plows?bbox=minLon,minLat,maxLon,maxLat` → `Plow[]`

- [ ] **Step 1: Write the failing domain test** — `test/domain/winter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { onSnowRoute, parseAlerts, parseIsoDurationMs, snowNext24hMm, WINTER_EVENT_RE, BAN_THRESHOLD_MM } from '../../src/server/domain/winter.js';

describe('winter', () => {
  it('snow route membership within 25 m', () => {
    const routes = [{ id: '1', paths: [[[-87.65, 41.90], [-87.65, 41.91]]] as [number, number][][], bbox: [-87.65, 41.90, -87.65, 41.91] as [number, number, number, number] }];
    expect(onSnowRoute(routes, [-87.6501, 41.905])).toBe(true);
    expect(onSnowRoute(routes, [-87.6510, 41.905])).toBe(false);
  });
  it('parses NWS alerts', () => {
    const a = parseAlerts({ features: [{ properties: { id: 'urn:1', event: 'Winter Storm Warning', headline: 'WSW until Tue', severity: 'Severe', ends: '2026-12-02T06:00:00-06:00' } }] });
    expect(a).toEqual([{ id: 'urn:1', event: 'Winter Storm Warning', headline: 'WSW until Tue', severity: 'Severe', ends: '2026-12-02T06:00:00-06:00' }]);
    expect(WINTER_EVENT_RE.test('Winter Storm Warning')).toBe(true);
    expect(WINTER_EVENT_RE.test('Flood Watch')).toBe(false);
  });
  it('durations', () => {
    expect(parseIsoDurationMs('PT6H')).toBe(6 * 3600e3);
    expect(parseIsoDurationMs('P1DT3H')).toBe(27 * 3600e3);
    expect(parseIsoDurationMs('PT30M')).toBe(30 * 60e3);
  });
  it('sums snowfall over the next 24h, prorating partial overlaps', () => {
    const now = Date.parse('2026-12-01T12:00:00Z');
    const vals = [
      { validTime: '2026-12-01T06:00:00+00:00/PT12H', value: 20 }, // half overlaps → 10
      { validTime: '2026-12-01T18:00:00+00:00/PT6H', value: 30 },  // fully inside → 30
      { validTime: '2026-12-02T12:00:00+00:00/PT6H', value: 99 },  // starts at window end → 0
      { validTime: '2026-12-02T00:00:00+00:00/PT6H', value: null }, // null → 0
    ];
    expect(snowNext24hMm(vals, now)).toBeCloseTo(40, 5);
    expect(BAN_THRESHOLD_MM).toBe(50.8);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/domain/winter.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/domain/winter.ts`**

```ts
import type { LngLat, NwsAlert, SnowRoute } from '../../shared/types.js';
import { bboxNear, distToPathsM } from './geo.js';

export const WINTER_EVENT_RE = /^(Winter Storm Warning|Winter Storm Watch|Blizzard Warning|Winter Weather Advisory|Ice Storm Warning|Extreme Cold Warning|Wind Chill Warning)$/;
export const BAN_THRESHOLD_MM = 50.8; // 2 inches

export const onSnowRoute = (routes: SnowRoute[], p: LngLat, maxM = 25): boolean =>
  routes.some((r) => bboxNear(r.bbox, p, maxM) && distToPathsM(p, r.paths) <= maxM);

export function parseAlerts(geojson: any): NwsAlert[] {
  return (geojson?.features ?? []).map((f: any) => ({
    id: String(f.properties?.id ?? f.id), event: String(f.properties?.event ?? ''),
    headline: String(f.properties?.headline ?? f.properties?.event ?? ''), severity: String(f.properties?.severity ?? ''),
    ends: f.properties?.ends ?? f.properties?.expires ?? null,
  }));
}

export function parseIsoDurationMs(s: string): number {
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return 0;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

export function snowNext24hMm(values: { validTime: string; value: number | null }[], nowMs: number): number {
  const end = nowMs + 24 * 3600e3;
  let total = 0;
  for (const v of values) {
    if (!v.value) continue;
    const [start, dur] = v.validTime.split('/');
    const s = Date.parse(start), e = s + parseIsoDurationMs(dur ?? 'PT1H');
    const overlap = Math.max(0, Math.min(e, end) - Math.max(s, nowMs));
    if (overlap > 0 && e > s) total += v.value * (overlap / (e - s));
  }
  return total;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run test/domain/winter.test.ts`. Expected: PASS.

- [ ] **Step 5: Implement `src/server/sources/nws.ts`**

```ts
import type { FetchJson } from '../http/fetchJson.js';
import type { NwsAlert } from '../../shared/types.js';
import { parseAlerts, snowNext24hMm } from '../domain/winter.js';

export function createNws(fetchJson: FetchJson, userAgent: string) {
  const headers = { 'User-Agent': userAgent, Accept: 'application/geo+json' };
  const gridUrl = new Map<string, string>();
  const key = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return {
    async alerts(lat: number, lon: number): Promise<NwsAlert[]> {
      return parseAlerts(await fetchJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers }));
    },
    async snowfallMm(lat: number, lon: number, nowMs: number): Promise<number> {
      let url = gridUrl.get(key(lat, lon));
      if (!url) {
        const pt = await fetchJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers });
        url = String(pt.properties.forecastGridData);
        gridUrl.set(key(lat, lon), url);
      }
      const grid = await fetchJson(url, { headers });
      return snowNext24hMm(grid.properties?.snowfallAmount?.values ?? [], nowMs);
    },
  };
}
```

- [ ] **Step 6: Implement `src/server/sources/plows.ts`**

```ts
import type { AppConfig } from '../config.js';
import type { FetchJson } from '../http/fetchJson.js';
import type { BBox, Plow } from '../../shared/types.js';
import { arcgisQueryAll } from './arcgis.js';
import { toChicagoLocal } from '../util/chicagoTime.js';

export function createPlowFetcher(d: { fetchJson: FetchJson; cfg: AppConfig; nowMs?: () => number }) {
  const nowMs = d.nowMs ?? (() => Date.now());
  let memo: { at: number; key: string; plows: Plow[] } | null = null;
  return async (bbox: BBox): Promise<Plow[]> => {
    const key = bbox.map((n) => n.toFixed(3)).join(',');
    if (memo && memo.key === key && nowMs() - memo.at < 120_000) return memo.plows;
    const feats = await arcgisQueryAll(d.fetchJson, d.cfg.datasets.arcgisBase, d.cfg.datasets.layers.snowplows, {
      geometry: JSON.stringify({ xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ASSET_NAME,ASSET_TYPE,POSTING_TIME',
    });
    const now = nowMs();
    const plows = feats
      .filter((f) => typeof f.attributes.POSTING_TIME === 'number' && now - f.attributes.POSTING_TIME <= 2 * 3600e3)
      .map((f) => ({
        name: String(f.attributes.ASSET_NAME), type: String(f.attributes.ASSET_TYPE),
        postedLocal: toChicagoLocal(new Date(f.attributes.POSTING_TIME)),
        minutesAgo: Math.round((now - f.attributes.POSTING_TIME) / 60_000),
        point: [Number(f.geometry?.x), Number(f.geometry?.y)] as [number, number],
      }));
    memo = { at: now, key, plows };
    return plows;
  };
}
```

- [ ] **Step 7: Implement `src/server/jobs/winterJob.ts`**

```ts
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
    if (status.possibleBan) {
      if (!d.store.kvGet(`snowban:${p.id}`)) d.store.kvSet(`snowban:${p.id}`, { since: datePart(now) }, now);
    } else if (!status.error) {
      d.store.kvDelete(`snowban:${p.id}`);
    }
    d.store.kvSet(`winter:${p.id}`, status, now);
  }
}
```

- [ ] **Step 8: Write the failing route/job test** — `test/routes/winter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';
import { refreshWinter } from '../../src/server/jobs/winterJob.js';

describe('winter job + routes', () => {
  it('flags a possible ban on a snow-route home at ≥ 2 in, and clears it after', async () => {
    const { app, deps } = await makeTestApp({ nowLocal: () => '2026-12-01T12:00:00' });
    deps.store.saveDataset('snowRoutes', [{ id: '1', paths: [[[-87.6470, 41.88], [-87.6470, 41.89]]], bbox: [-87.647, 41.88, -87.647, 41.89] }], 1, 't');
    deps.cache.reload();
    const placeId = (await app.inject({ method: 'POST', url: '/api/places', headers: asUser(OWNER), payload: { kind: 'home', label: 'Home', address: 'x' } })).json().place.id;
    let snowMm = 60;
    const nws = { alerts: async () => [{ id: 'a1', event: 'Winter Storm Warning', headline: 'h', severity: 'Severe', ends: null }], snowfallMm: async () => snowMm };
    await refreshWinter({ nws, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: true });
    const w = (await app.inject({ method: 'GET', url: '/api/winter', headers: asUser(OWNER) })).json();
    expect(w[0]).toMatchObject({ placeId, onSnowRoute: true, possibleBan: true, snowNext24hIn: 2.4 });
    expect(deps.store.kvGet<{ since: string }>(`snowban:${placeId}`)?.value.since).toBe('2026-12-01');
    snowMm = 10;
    await refreshWinter({ nws, store: deps.store, cache: deps.cache, nowLocal: deps.nowLocal, nowMs: () => 0, includeSnowfall: true });
    expect(deps.store.kvGet(`snowban:${placeId}`)).toBeNull();
  });
  it('plows endpoint validates bbox', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), plows: async () => [{ name: 'S1', type: 'PLOW', postedLocal: 't', minutesAgo: 3, point: [-87.6, 41.8] }] } });
    expect((await app.inject({ method: 'GET', url: '/api/plows?bbox=oops', headers: asUser(OWNER) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/plows?bbox=-87.7,41.8,-87.6,41.9', headers: asUser(OWNER) })).json()).toHaveLength(1);
  });
});
```

- [ ] **Step 9: Implement `src/server/routes/winter.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { BBox, WinterStatus } from '../../shared/types.js';

export function registerWinter(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/winter', async (req) =>
    deps.store.listPlaces(req.user.id).filter((p) => p.kind === 'home').map((p) =>
      deps.store.kvGet<WinterStatus>(`winter:${p.id}`)?.value ??
      { placeId: p.id, label: p.label, onSnowRoute: false, alerts: [], possibleBan: false, snowNext24hIn: null, checkedAt: null, error: null }));
  app.get<{ Querystring: { bbox?: string } }>('/api/plows', async (req, reply) => {
    const b = String(req.query.bbox ?? '').split(',').map(Number);
    if (b.length !== 4 || b.some((n) => !Number.isFinite(n)) || b[0] >= b[2] || b[1] >= b[3] || b[2] - b[0] > 0.5 || b[3] - b[1] > 0.5) {
      return reply.code(400).send({ error: 'bbox=minLon,minLat,maxLon,maxLat (max 0.5° span)' });
    }
    return deps.services.plows(b as BBox);
  });
}
```

In `src/server/app.ts`:
```ts
import { registerWinter } from './routes/winter.js';
// after registerVehicles(app, deps);
registerWinter(app, deps);
```

- [ ] **Step 10: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: winter status (snow routes, NWS alerts, possible snow ban) and live plows"
```

---

### Task 18: Push notifications (planner, ntfy JSON client, runner, settings routes)

**Files:**
- Create: `src/server/notify/ntfy.ts`, `src/server/notify/planner.ts`, `src/server/notify/runner.ts`, `src/server/routes/notifications.ts`
- Modify: `src/server/app.ts` (register)
- Test: `test/notify/notify.test.ts`, `test/routes/notifications.test.ts`

**Interfaces:**
- Produces:

```ts
// ntfy.ts
export interface PlannedPush { key: string; category: NotifyCategory; priority: 1 | 2 | 3 | 4 | 5; title: string; message: string; click?: string; tags?: string[]; alsoMark?: string[] }
export function publishNtfy(fetchImpl: typeof fetch, server: { url: string; token: string | null }, topic: string, push: Pick<PlannedPush, 'title' | 'message' | 'priority' | 'click' | 'tags'>): Promise<void>
// planner.ts
export interface PlanInput {
  nowLocal: string; baseUrl: string; homes: Place[];
  isSweeping: (wardSection: string, date: string) => boolean;
  vehicles: { vehicle: Vehicle; status: VehicleStatus | null }[];
  winter: { place: Place; status: WinterStatus | null; banKey: string | null }[];
  newWork: WatchItem[];
}
export function planPushes(inp: PlanInput): PlannedPush[];
export function inQuietHours(hhmm: string, start: string, end: string): boolean;
export function filterDeliverable(pushes: PlannedPush[], prefs: NotifyPrefs, nowLocal: string, wasNotified: (key: string) => boolean): PlannedPush[];
// runner.ts
export function runNotifier(d: { cfg: AppConfig; store: Store; cache: DataCache; nowLocal: () => string; publish: (topic: string, p: PlannedPush) => Promise<void>; sleep?: (ms: number) => Promise<void> }): Promise<{ sent: number; failed: number }>;
```

- Routes: `GET /api/me/notifications` → `{ topic, prefs, configured, ntfyUrl }`; `PATCH /api/me/notifications` `{ topic?, prefs? }`; `POST /api/me/notifications/test`.

- [ ] **Step 1: Write the failing test** — `test/notify/notify.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { publishNtfy } from '../../src/server/notify/ntfy.js';
import { planPushes, inQuietHours, filterDeliverable } from '../../src/server/notify/planner.js';
import { runNotifier } from '../../src/server/notify/runner.js';
import { DEFAULT_NOTIFY_PREFS, type Place } from '../../src/shared/types.js';
import { openStore } from '../../src/server/db/store.js';
import { DataCache } from '../../src/server/data/cache.js';
import { loadConfig } from '../../src/server/config.js';

const home: Place = { id: 1, userId: 1, kind: 'home', label: 'Home', address: 'x', lat: 41.88, lon: -87.647, radiusM: 300, zones: ['3204'] };

describe('publishNtfy', () => {
  it('uses JSON publishing so emoji/em-dash titles are safe', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await publishNtfy(fetchImpl as any, { url: 'https://ntfy.tail.ts.net', token: 'tk' }, 'ct-abc', { title: '🚨 Car towed — Civic', message: 'm', priority: 5, click: 'https://x/#/home', tags: ['rotating_light'] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://ntfy.tail.ts.net/');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tk');
    expect(init.headers.Title).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ topic: 'ct-abc', title: '🚨 Car towed — Civic', message: 'm', priority: 5, click: 'https://x/#/home', tags: ['rotating_light'] });
  });
  it('throws on non-2xx', async () => {
    await expect(publishNtfy((async () => new Response('no', { status: 403 })) as any, { url: 'https://n', token: null }, 't', { title: 't', message: 'm', priority: 3 })).rejects.toThrow('ntfy HTTP 403');
  });
});

describe('planner', () => {
  const base = { baseUrl: 'https://x', homes: [home], isSweeping: (ws: string, d: string) => ws === '3204' && d === '2026-10-14', vehicles: [], winter: [], newWork: [] };
  it('sweeping tomorrow only at/after 19:00', () => {
    expect(planPushes({ ...base, nowLocal: '2026-10-13T18:59:00' }).filter((p) => p.category === 'sweeping')).toHaveLength(0);
    const p = planPushes({ ...base, nowLocal: '2026-10-13T19:00:00' }).find((x) => x.category === 'sweeping')!;
    expect(p).toMatchObject({ key: 'sweep:3204:2026-10-14', priority: 3 });
    expect(p.title).toContain('Home');
  });
  it('vehicle matches are urgent, one per match key', () => {
    const v = { id: 1, userId: 1, plate: 'AB123', state: 'IL', nickname: 'Civic' };
    const st = { vehicleId: 1, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed' as const, key: 'tow:9', date: '2026-10-11', details: 'd', address: '701 N Sacramento', phone: 'p' }] };
    const p = planPushes({ ...base, nowLocal: '2026-10-11T03:00:00', vehicles: [{ vehicle: v, status: st }] });
    expect(p).toEqual([expect.objectContaining({ key: 'tow:9', category: 'vehicle', priority: 5 })]);
  });
  it('winter alerts filtered to winter events; possible ban uses ban key', () => {
    const status = { placeId: 1, label: 'Home', onSnowRoute: true, possibleBan: true, snowNext24hIn: 3, checkedAt: 't', error: null, alerts: [{ id: 'a', event: 'Winter Storm Warning', headline: 'h', severity: 'Severe', ends: null }, { id: 'b', event: 'Flood Watch', headline: 'f', severity: 'Minor', ends: null }] };
    const p = planPushes({ ...base, nowLocal: '2026-12-01T10:00:00', winter: [{ place: home, status, banKey: 'snowban:1:2026-12-01' }] });
    expect(p.map((x) => x.key).sort()).toEqual(['nws:a', 'snowban:1:2026-12-01']);
  });
  it('work digest at/after 18:00 bundles items and marks each', () => {
    const item = { id: 'g1', kind: 'permit' as const, dataset: 'current' as const, title: 'Gas main', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: '730 W RANDOLPH', description: '', distanceM: 10, utility: 'peoplesgas' as const, point: null };
    const p = planPushes({ ...base, nowLocal: '2026-10-11T18:00:00', newWork: [item] }).find((x) => x.category === 'work')!;
    expect(p).toMatchObject({ key: 'digest:2026-10-11', priority: 2, alsoMark: ['work:g1'] });
  });
  it('quiet hours wrap midnight; urgent bypasses; disabled categories and sent keys filtered', () => {
    expect(inQuietHours('23:00', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
    const pushes = [
      { key: 'a', category: 'vehicle' as const, priority: 5 as const, title: '', message: '' },
      { key: 'b', category: 'winter' as const, priority: 4 as const, title: '', message: '' },
      { key: 'c', category: 'sweeping' as const, priority: 3 as const, title: '', message: '' },
    ];
    expect(filterDeliverable(pushes, DEFAULT_NOTIFY_PREFS, '2026-10-11T23:30:00', () => false).map((p) => p.key)).toEqual(['a']);
    const prefs = { ...DEFAULT_NOTIFY_PREFS, enabled: { ...DEFAULT_NOTIFY_PREFS.enabled, winter: false } };
    expect(filterDeliverable(pushes, prefs, '2026-10-11T12:00:00', (k) => k === 'c').map((p) => p.key)).toEqual(['a']);
  });
});

describe('runNotifier', () => {
  it('seeds existing work silently, sends new pushes once, records ntfy failure', async () => {
    const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c', NTFY_URL: 'https://n' }, 'config');
    const store = openStore(':memory:');
    const u = store.upsertUser('o', 'o');
    store.createPlace(u.id, { ...home, zones: [] });
    store.saveDataset('permitsCurrent', [{ id: 'g1', dataset: 'current', appType: 'Opening', workType: 'Gas', start: '2026-10-12T00:00:00', end: '2026-10-20T00:00:00', location: 'x', streetClosure: null, detail: null, comments: null, meterBagging: false, applicant: 'Peoples Gas*', point: [-87.6471, 41.8801] }], 1, 't');
    const v = store.createVehicle(u.id, { plate: 'AB123', state: 'IL', nickname: 'Civic' });
    store.setVehicleStatus({ vehicleId: v.id, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:9', date: '2026-10-11', details: 'd', address: 'lot', phone: null }] });
    const cache = new DataCache(store);
    const sent: string[] = [];
    const publish = async (_t: string, p: any) => { sent.push(p.key); };
    const r1 = await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T18:30:00', publish, sleep: async () => {} });
    expect(sent).toEqual(['tow:9']);           // g1 was seeded, not sent
    expect(r1).toEqual({ sent: 1, failed: 0 });
    await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T18:45:00', publish, sleep: async () => {} });
    expect(sent).toEqual(['tow:9']);           // no duplicates
    store.setVehicleStatus({ vehicleId: v.id, checkedAt: 't', ok: true, error: null, matches: [{ kind: 'towed', key: 'tow:10', date: '2026-10-11', details: 'd', address: 'lot', phone: null }] });
    const r3 = await runNotifier({ cfg, store, cache, nowLocal: () => '2026-10-11T19:00:00', publish: async () => { throw new Error('ntfy HTTP 500'); }, sleep: async () => {} });
    expect(r3.failed).toBe(1);
    expect(store.kvGet<string>('ntfy:lastError')?.value).toContain('ntfy HTTP 500');
    expect(store.wasNotified(u.id, 'tow:10')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/notify/notify.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/notify/ntfy.ts`**

```ts
import type { NotifyCategory } from '../../shared/types.js';

export interface PlannedPush {
  key: string; category: NotifyCategory; priority: 1 | 2 | 3 | 4 | 5;
  title: string; message: string; click?: string; tags?: string[]; alsoMark?: string[];
}

/** JSON publishing: POST to the server root with { topic, ... }. Never put titles in headers (non-ASCII). */
export async function publishNtfy(
  fetchImpl: typeof fetch, server: { url: string; token: string | null }, topic: string,
  push: Pick<PlannedPush, 'title' | 'message' | 'priority' | 'click' | 'tags'>,
): Promise<void> {
  const body: Record<string, unknown> = { topic, title: push.title, message: push.message, priority: push.priority };
  if (push.click) body.click = push.click;
  if (push.tags?.length) body.tags = push.tags;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;
  const res = await fetchImpl(`${server.url.replace(/\/$/, '')}/`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}
```

- [ ] **Step 4: Implement `src/server/notify/planner.ts`**

```ts
import type { NotifyPrefs, Place, Vehicle, VehicleStatus, WatchItem, WinterStatus } from '../../shared/types.js';
import type { PlannedPush } from './ntfy.js';
import { WINTER_EVENT_RE } from '../domain/winter.js';
import { addDays, datePart, timePart } from '../util/chicagoTime.js';

export interface PlanInput {
  nowLocal: string; baseUrl: string; homes: Place[];
  isSweeping: (wardSection: string, date: string) => boolean;
  vehicles: { vehicle: Vehicle; status: VehicleStatus | null }[];
  winter: { place: Place; status: WinterStatus | null; banKey: string | null }[];
  newWork: WatchItem[];
}

const UTIL_ICON: Record<string, string> = { comed: '⚡ ComEd', peoplesgas: '🔥 Peoples Gas', water: '💧 Water', telecom: '📡 Telecom' };

export function planPushes(inp: PlanInput): PlannedPush[] {
  const out: PlannedPush[] = [];
  const today = datePart(inp.nowLocal), time = timePart(inp.nowLocal);

  for (const { vehicle, status } of inp.vehicles) {
    for (const m of status?.matches ?? []) {
      const who = vehicle.nickname || vehicle.plate;
      out.push({
        key: m.key, category: 'vehicle', priority: 5, tags: ['rotating_light'], click: `${inp.baseUrl}/#/home`,
        title: m.kind === 'towed' ? `🚨 Car towed — ${who}` : `🚗 Car relocated — ${who}`,
        message: m.kind === 'towed' ? `${m.details}. Lot: ${m.address}${m.phone ? ` (${m.phone})` : ''}` : `${m.details}. Now at ${m.address}`,
      });
    }
  }

  if (time >= '19:00') {
    const tomorrow = addDays(today, 1);
    for (const h of inp.homes) for (const ws of h.zones) {
      if (!inp.isSweeping(ws, tomorrow)) continue;
      out.push({
        key: `sweep:${ws}:${tomorrow}`, category: 'sweeping', priority: 3, tags: ['broom'], click: `${inp.baseUrl}/#/home`,
        title: `🧹 Street cleaning tomorrow — ${h.label}`,
        message: `Ward ${ws.slice(0, 2)} Sec ${ws.slice(2)}, typically 9am–2pm. Move your car tonight.`,
      });
    }
  }

  for (const { place, status, banKey } of inp.winter) {
    for (const a of status?.alerts ?? []) {
      if (!WINTER_EVENT_RE.test(a.event)) continue;
      out.push({ key: `nws:${a.id}`, category: 'winter', priority: 4, tags: ['snowflake'], click: `${inp.baseUrl}/#/home`, title: `❄️ ${a.event} — ${place.label}`, message: a.headline });
    }
    if (status?.possibleBan && banKey) {
      out.push({
        key: banKey, category: 'snowban', priority: 4, tags: ['snowflake'], click: `${inp.baseUrl}/#/home`,
        title: `❄️ Possible 2-inch snow ban — ${place.label}`,
        message: `Forecast ~${status.snowNext24hIn} in. in the next 24h and your street is a snow route. Watch for the city's ban announcement.`,
      });
    }
  }

  if (time >= '18:00' && inp.newWork.length) {
    const lines = inp.newWork.slice(0, 5).map((w) => `${w.utility ? UTIL_ICON[w.utility] : '🚧'} — ${w.location} (${w.start.slice(5, 10)}–${w.end.slice(5, 10)})`);
    if (inp.newWork.length > 5) lines.push(`…and ${inp.newWork.length - 5} more`);
    out.push({
      key: `digest:${today}`, category: 'work', priority: 2, tags: ['construction'], click: `${inp.baseUrl}/#/home`,
      title: '🛠️ New street work near home', message: lines.join('\n'), alsoMark: inp.newWork.map((w) => `work:${w.id}`),
    });
  }
  return out;
}

export function inQuietHours(hhmm: string, start: string, end: string): boolean {
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

export function filterDeliverable(pushes: PlannedPush[], prefs: NotifyPrefs, nowLocal: string, wasNotified: (key: string) => boolean): PlannedPush[] {
  const quiet = inQuietHours(timePart(nowLocal), prefs.quietStart, prefs.quietEnd);
  return pushes.filter((p) => prefs.enabled[p.category] && !wasNotified(p.key) && (!quiet || p.priority === 5));
}
```

- [ ] **Step 5: Implement `src/server/notify/runner.ts`**

```ts
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
```

- [ ] **Step 6: Run it and verify it passes**

Run: `npx vitest run test/notify/notify.test.ts`. Expected: PASS.

- [ ] **Step 7: Write the failing route test** — `test/routes/notifications.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeTestApp, asUser, OWNER, stubServices } from '../helpers/testApp.js';

describe('/api/me/notifications', () => {
  it('reads, validates and updates topic + prefs', async () => {
    const { app } = await makeTestApp();
    const g = (await app.inject({ method: 'GET', url: '/api/me/notifications', headers: asUser(OWNER) })).json();
    expect(g.topic).toMatch(/^ct-/);
    expect(g.prefs.enabled.vehicle).toBe(true);
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'a b' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { prefs: { quietStart: '25:00' } } })).statusCode).toBe(400);
    const p = (await app.inject({ method: 'PATCH', url: '/api/me/notifications', headers: asUser(OWNER), payload: { topic: 'my-topic-123', prefs: { enabled: { work: false }, quietStart: '23:00' } } })).json();
    expect(p).toMatchObject({ topic: 'my-topic-123', prefs: { quietStart: '23:00', quietEnd: '07:00', enabled: { work: false, vehicle: true } } });
  });
  it('test push reports failure as 502', async () => {
    const { app } = await makeTestApp({ services: { ...stubServices(), sendTestPush: async () => { throw new Error('ntfy HTTP 401'); } } });
    const r = await app.inject({ method: 'POST', url: '/api/me/notifications/test', headers: asUser(OWNER) });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain('401');
  });
});
```

- [ ] **Step 8: Implement `src/server/routes/notifications.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { NotifyCategory, NotifyPrefs, User } from '../../shared/types.js';

const CATS: NotifyCategory[] = ['vehicle', 'sweeping', 'winter', 'snowban', 'work'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const view = (deps: AppDeps, u: User) => ({ topic: u.ntfyTopic, prefs: u.notifyPrefs, configured: !!deps.cfg.ntfyUrl, ntfyUrl: deps.cfg.ntfyUrl });

export function registerNotifications(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/me/notifications', async (req) => view(deps, req.user));
  app.patch<{ Body: { topic?: unknown; prefs?: any } }>('/api/me/notifications', async (req, reply) => {
    const patch: { ntfyTopic?: string; notifyPrefs?: NotifyPrefs } = {};
    if (req.body?.topic !== undefined) {
      if (typeof req.body.topic !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(req.body.topic)) return reply.code(400).send({ error: 'topic: 8–64 letters, digits, _ or -' });
      patch.ntfyTopic = req.body.topic;
    }
    if (req.body?.prefs !== undefined) {
      const cur = req.user.notifyPrefs, inp = req.body.prefs ?? {};
      const next: NotifyPrefs = { enabled: { ...cur.enabled }, quietStart: inp.quietStart ?? cur.quietStart, quietEnd: inp.quietEnd ?? cur.quietEnd };
      for (const c of CATS) if (inp.enabled?.[c] !== undefined) next.enabled[c] = !!inp.enabled[c];
      if (!HHMM.test(next.quietStart) || !HHMM.test(next.quietEnd)) return reply.code(400).send({ error: 'quiet hours must be HH:mm' });
      patch.notifyPrefs = next;
    }
    return view(deps, deps.store.updateUser(req.user.id, patch));
  });
  app.post('/api/me/notifications/test', async (req, reply) => {
    try { await deps.services.sendTestPush(req.user); return { ok: true }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
}
```

In `src/server/app.ts`:
```ts
import { registerNotifications } from './routes/notifications.js';
// after registerWinter(app, deps);
registerNotifications(app, deps);
```

- [ ] **Step 9: Run all tests and verify they pass**

Run: `npx vitest run`. Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: ntfy push notifications with dedupe, quiet hours, seeding and settings"
```

---

### Task 19: Server entry point, service wiring, scheduler

**Files:**
- Create: `src/server/scheduler.ts`, `src/server/index.ts`
- Test: `test/scheduler.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `needsStartupRefresh(meta: DatasetMeta | null, nowLocal: string): boolean` (true if missing or older than 24h)
  - `safely(name: string, fn: () => Promise<unknown>, log: { error: (o: object, m: string) => void }): () => Promise<void>`
  - `startScheduler(cfg: AppConfig, jobs: { nightly: () => Promise<void>; every15: () => Promise<void>; every30: () => Promise<void>; every3h: () => Promise<void> }): Cron[]`
  - The runnable server: `node dist/server/index.js`

- [ ] **Step 1: Write the failing test** — `test/scheduler.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { needsStartupRefresh, safely } from '../src/server/scheduler.js';

describe('scheduler helpers', () => {
  it('startup refresh when missing or older than 24h', () => {
    expect(needsStartupRefresh(null, '2026-10-11T12:00:00')).toBe(true);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-11T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(false);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-10T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(true);
  });
  it('safely swallows and logs job errors', async () => {
    const logged: string[] = [];
    await safely('job', async () => { throw new Error('x'); }, { error: (_o, m) => logged.push(m) })();
    expect(logged).toEqual(['job failed']);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run test/scheduler.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/server/scheduler.ts`**

```ts
import { Cron } from 'croner';
import type { AppConfig } from './config.js';
import type { DatasetMeta } from '../shared/types.js';

export function needsStartupRefresh(meta: DatasetMeta | null, nowLocal: string): boolean {
  if (!meta?.fetchedAt) return true;
  return (Date.parse(`${nowLocal}Z`) - Date.parse(`${meta.fetchedAt}Z`)) / 3_600_000 > 24;
}

export const safely = (name: string, fn: () => Promise<unknown>, log: { error: (o: object, m: string) => void }) =>
  async (): Promise<void> => { try { await fn(); } catch (e) { log.error({ job: name, err: (e as Error).message }, `${name} failed`); } };

export function startScheduler(cfg: AppConfig, jobs: { nightly: () => Promise<void>; every15: () => Promise<void>; every30: () => Promise<void>; every3h: () => Promise<void> }): Cron[] {
  const opts = { timezone: 'America/Chicago', protect: true };
  return [
    new Cron(cfg.refreshCron, opts, jobs.nightly),
    new Cron('*/15 * * * *', opts, jobs.every15),
    new Cron('5,35 * * * *', opts, jobs.every30),
    new Cron('10 */3 * * *', opts, jobs.every3h),
  ];
}
```

- [ ] **Step 4: Implement `src/server/index.ts`**

```ts
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
      if (!cfg.ntfyUrl) throw new Error('NTFY_URL is not configured');
      await publish(user.ntfyTopic, { title: '✅ Chicago Tracker test', message: 'Push notifications are working.', priority: 3, click: `${cfg.publicBaseUrl}/#/settings` });
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
  if (needsStartupRefresh(store.getDatasetMeta('payBlocks'), nowLocal())) {
    void safely('startup-refresh', async () => { await refreshNow(); await winter(true); }, log)();
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); store.close(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 6: Manual local smoke (network required, run once)**

```bash
OWNER_LOGIN=me@example.com SINGLE_USER_LOGIN=me@example.com PUBLIC_BASE_URL=http://localhost:8787 NOMINATIM_CONTACT=me@example.com DATA_DIR=./data npm run dev:server
# in another shell, after the startup refresh logs "refresh done" (1–3 min):
curl -s localhost:8787/healthz
curl -s localhost:8787/api/status | head -c 600
curl -s "localhost:8787/api/parking?lat=41.8845&lon=-87.6470" | head -c 600
```
Expected: `ready: true`. The status lists all 12 datasets with `status: "ok"`, or with a clear error for `specialEvents` if it has no future rows. Parking returns several blocks.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: server entry point, service wiring, scheduler"
```

---
## Phase F — Web app (mobile-first PWA)

**Web conventions (apply to Tasks 20–23):**
- Never set `innerHTML` with data from the API. City data is untrusted text. Build DOM with the `h()` helper, which uses `textContent`.
- All times shown are Chicago-local. Distances are shown in feet/miles (US user).
- Tap targets are at least 44 px. Light and dark mode via `prefers-color-scheme`.
- Views are verified by running the app and checking them at a phone viewport (390×844) and a desktop viewport. A step at the end of each view task lists exactly what to check.

### Task 20: Web shell: Vite, routing, API client, DOM helper, deep links, PWA

**Files:**
- Create: `vite.config.ts`, `src/web/index.html`, `src/web/main.ts`, `src/web/router.ts`, `src/web/api.ts`, `src/web/dom.ts`, `src/web/format.ts`, `src/web/styles.css`, `src/web/components/sheet.ts`, `src/web/public/manifest.webmanifest`, `src/web/public/sw.js`, `src/web/public/icon.svg`, `scripts/icons.mjs`
- Create: `src/shared/deeplinks.ts`
- Modify: `src/server/app.ts` (no change needed if `dist/web` exists. Verify only.)
- Test: `test/shared/deeplinks.test.ts`, `test/web/format.test.ts`

**Interfaces:**
- Produces:
  - `navUrl(app: NavApp, dest: LngLat | string): string` (shared)
  - `api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>`; `class ApiError extends Error { status: number }`
  - `h(tag: string, attrs?: Record<string, unknown> | null, ...children: (Node | string | null | undefined | false)[]): HTMLElement`; `clear(el: HTMLElement): void`
  - `fmtRate(r: RateInfo): string`, `fmtDistance(m: number): string`, `fmtDate(date: string): string`, `daysUntil(today: string, date: string): number`, `chicagoToday(d?: Date): string`, `chicagoNowLocal(d?: Date): string`, `STATUS_COLOR: Record<BlockStatus, string>`, `UTIL_LABEL: Record<'comed'|'peoplesgas'|'water'|'telecom', string>`, `isWinterMonth(date: string): boolean`
  - `openSheet(content: HTMLElement): void`, `closeSheet(): void`
  - Router: `#/home` (default), `#/park`, `#/settings`; each view exports `render<Name>(root: HTMLElement): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`test/shared/deeplinks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { navUrl } from '../../src/shared/deeplinks.js';

describe('navUrl', () => {
  it('coordinates', () => {
    expect(navUrl('apple', [-87.647, 41.8845])).toBe('https://maps.apple.com/?daddr=41.8845,-87.647&dirflg=d');
    expect(navUrl('google', [-87.647, 41.8845])).toBe('https://www.google.com/maps/dir/?api=1&destination=41.8845,-87.647&travelmode=driving');
    expect(navUrl('waze', [-87.647, 41.8845])).toBe('https://waze.com/ul?ll=41.8845,-87.647&navigate=yes');
  });
  it('address strings are encoded', () => {
    expect(navUrl('apple', '701 N. Sacramento, Chicago, IL')).toBe('https://maps.apple.com/?daddr=701%20N.%20Sacramento%2C%20Chicago%2C%20IL&dirflg=d');
    expect(navUrl('waze', '1 N State St, Chicago, IL')).toBe('https://waze.com/ul?q=1%20N%20State%20St%2C%20Chicago%2C%20IL&navigate=yes');
  });
});
```

`test/web/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fmtRate, fmtDistance, fmtDate, daysUntil, chicagoToday, isWinterMonth } from '../../src/web/format.js';

describe('format', () => {
  it('rate is approximate', () => expect(fmtRate({ tier: 'neighborhood', hourly: 2.5, hoursText: '', approximate: true })).toBe('≈ $2.50/hr'));
  it('distance in feet then miles', () => {
    expect(fmtDistance(30)).toBe('100 ft');
    expect(fmtDistance(400)).toBe('0.25 mi');
  });
  it('dates', () => {
    expect(fmtDate('2026-10-14')).toBe('Wed Oct 14');
    expect(daysUntil('2026-10-11', '2026-10-14')).toBe(3);
    expect(chicagoToday(new Date('2026-10-12T04:30:00Z'))).toBe('2026-10-11');
    expect(isWinterMonth('2026-12-01')).toBe(true);
    expect(isWinterMonth('2026-10-01')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run test/shared test/web`. Expected: FAIL.

- [ ] **Step 3: Implement `src/shared/deeplinks.ts`**

```ts
import type { LngLat, NavApp } from './types.js';

export function navUrl(app: NavApp, dest: LngLat | string): string {
  if (typeof dest === 'string') {
    const q = encodeURIComponent(dest);
    if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
    if (app === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`;
    return `https://maps.apple.com/?daddr=${q}&dirflg=d`;
  }
  const ll = `${dest[1]},${dest[0]}`;
  if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`;
  return `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
}
```

- [ ] **Step 4: Implement `src/web/format.ts`**

```ts
import type { BlockStatus, RateInfo } from '../shared/types.js';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function chicagoNowLocal(d: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const chicagoToday = (d: Date = new Date()): string => chicagoNowLocal(d).slice(0, 10);
export const fmtRate = (r: RateInfo): string => `≈ $${r.hourly.toFixed(2)}/hr`;
export function fmtDistance(m: number): string {
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.round(ft / 50) * 50 || 50} ft` : `${(m / 1609.344).toFixed(2)} mi`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const daysUntil = (today: string, date: string): number =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
export const isWinterMonth = (date: string): boolean => { const m = Number(date.slice(5, 7)); return m === 12 || m <= 3; };
export const STATUS_COLOR: Record<BlockStatus, string> = { green: '#1a9850', info: '#4575b4', amber: '#f39c12', red: '#d73027' };
export const UTIL_LABEL = { comed: '⚡ ComEd', peoplesgas: '🔥 Peoples Gas', water: '💧 Water', telecom: '📡 Telecom' } as const;
```

Check: `fmtDistance(30)` = 98.4 ft → round(98.4/50)=2 → 100 ft ✓. `fmtDistance(400)` = 1312 ft → 0.25 mi ✓.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run test/shared test/web`. Expected: PASS.

- [ ] **Step 6: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787', '/cal': 'http://localhost:8787' } },
});
```

- [ ] **Step 7: Create `src/web/dom.ts`, `src/web/api.ts`, `src/web/components/sheet.ts`**

`src/web/dom.ts`:
```ts
type Child = Node | string | number | null | undefined | false;
export function h(tag: string, attrs: Record<string, unknown> | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
export const clear = (el: HTMLElement): void => { while (el.firstChild) el.removeChild(el.firstChild); };
```

`src/web/api.ts`:
```ts
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
```

`src/web/components/sheet.ts`:
```ts
import { h } from '../dom.js';

let backdrop: HTMLElement | null = null;
export function closeSheet(): void { backdrop?.remove(); backdrop = null; }
export function openSheet(content: HTMLElement): void {
  closeSheet();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('button', { class: 'sheet-close', 'aria-label': 'Close', onclick: closeSheet }, '✕'), content);
  backdrop = h('div', { class: 'sheet-backdrop', onclick: (e: Event) => { if (e.target === backdrop) closeSheet(); } }, sheet);
  document.body.append(backdrop);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
```

- [ ] **Step 8: Create `src/web/index.html`, `src/web/router.ts`, `src/web/main.ts`**

`src/web/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b5394" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Chi Tracker" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>Chicago Tracker</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <nav class="tabs" aria-label="Main">
    <a href="#/home" data-route="home"><span aria-hidden="true">🏠</span>Home</a>
    <a href="#/park" data-route="park"><span aria-hidden="true">🅿️</span>Park</a>
    <a href="#/settings" data-route="settings"><span aria-hidden="true">⚙️</span>Settings</a>
  </nav>
  <main id="view" tabindex="-1"></main>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

`src/web/router.ts`:
```ts
import { clear, h } from './dom.js';

type View = (root: HTMLElement) => Promise<void>;
export function startRouter(root: HTMLElement, views: Record<string, View>, fallback = 'home'): void {
  const go = async () => {
    const name = location.hash.replace(/^#\//, '').split('?')[0] || fallback;
    const view = views[name] ?? views[fallback];
    document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === name ? 'page' : 'false'));
    clear(root);
    try { await view(root); } catch (e) {
      clear(root);
      root.append(h('div', { class: 'banner error' }, `Something went wrong: ${(e as Error).message}`));
    }
  };
  window.addEventListener('hashchange', go);
  void go();
}
```

`src/web/main.ts`:
```ts
import { startRouter } from './router.js';
import { renderHome } from './views/home.js';
import { renderPark } from './views/park.js';
import { renderSettings } from './views/settings.js';

startRouter(document.getElementById('view')!, { home: renderHome, park: renderPark, settings: renderSettings });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
```

Until Tasks 21–23 land, create stub views so the build works. Each later task replaces its stub:
```ts
// src/web/views/home.ts, park.ts, settings.ts (stub; replaced later)
import { h } from '../dom.js';
export async function renderHome(root: HTMLElement): Promise<void> { root.append(h('p', null, 'Home')); }
```
(Use `renderPark` / `renderSettings` as the export names in the other two files.)

- [ ] **Step 9: Create `src/web/styles.css`**

```css
:root {
  --bg: #f6f7f9; --card: #ffffff; --text: #1b1f24; --muted: #5d6673; --border: #dde1e6;
  --accent: #0b5394; --red: #d73027; --amber: #b86e00; --green: #1a7f45; --purple: #7b3fa0;
  --radius: 12px; --tabs-h: 64px; color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1216; --card: #181c22; --text: #e8ebef; --muted: #9aa4b1; --border: #2a3038; --accent: #5aa2e6; --amber: #f0a830; --green: #4cc17d; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { padding: 16px 16px calc(var(--tabs-h) + 24px + env(safe-area-inset-bottom)); max-width: 1100px; margin: 0 auto; outline: none; }
h1 { font-size: 1.4rem; margin: 4px 0 12px; } h2 { font-size: 1.1rem; margin: 0 0 8px; }
.muted { color: var(--muted); } .small { font-size: .85rem; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px; }
.card.red { border-left: 5px solid var(--red); } .card.amber { border-left: 5px solid var(--amber); } .card.green { border-left: 5px solid var(--green); }
.banner { padding: 10px 14px; border-radius: var(--radius); margin-bottom: 12px; background: #fff4d6; color: #5a4300; }
.banner.error { background: #fde2e1; color: #7a1712; }
@media (prefers-color-scheme: dark) { .banner { background: #3a2f10; color: #f5dc9a; } .banner.error { background: #3d1614; color: #f7b4ae; } }
button, .btn { min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; }
.btn.primary, button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input, select { min-height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); font: inherit; width: 100%; }
label { display: block; margin: 8px 0 4px; font-weight: 600; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; } .row > * { flex: 1 1 auto; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
.chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); font-size: .85rem; background: var(--card); min-height: 32px; }
.chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.big { font-size: 1.6rem; font-weight: 700; }
.list { list-style: none; margin: 0; padding: 0; } .list li { padding: 10px 0; border-bottom: 1px solid var(--border); }
.dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.map { height: 55vh; min-height: 320px; border-radius: var(--radius); border: 1px solid var(--border); margin: 8px 0 12px; }
.search-results { position: relative; z-index: 1000; } .search-results button { width: 100%; justify-content: flex-start; margin-top: 4px; text-align: left; }
.tabs { position: fixed; bottom: 0; left: 0; right: 0; height: calc(var(--tabs-h) + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom); display: flex; background: var(--card); border-top: 1px solid var(--border); z-index: 1100; }
.tabs a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--muted); text-decoration: none; font-size: .8rem; }
.tabs a span { font-size: 1.3rem; } .tabs a[aria-current="page"] { color: var(--accent); font-weight: 700; }
.sheet-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 2000; display: flex; align-items: flex-end; justify-content: center; }
.sheet { background: var(--card); color: var(--text); width: 100%; max-width: 560px; max-height: 80vh; overflow: auto; border-radius: 16px 16px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); position: relative; }
.sheet-close { position: absolute; top: 8px; right: 8px; min-width: 44px; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: .85rem; }
@media (min-width: 900px) {
  .tabs { top: 0; bottom: 0; right: auto; width: 96px; height: auto; flex-direction: column; justify-content: flex-start; padding-top: 16px; border-top: 0; border-right: 1px solid var(--border); }
  .tabs a { flex: 0 0 80px; }
  main { padding: 24px 24px 24px 120px; }
  .sheet-backdrop { align-items: center; } .sheet { border-radius: 16px; }
  .map { height: 70vh; }
}
```

- [ ] **Step 10: Create the PWA files**

`src/web/public/manifest.webmanifest`:
```json
{
  "name": "Chicago Tracker", "short_name": "Chi Tracker", "start_url": "/#/home", "scope": "/",
  "display": "standalone", "background_color": "#0b5394", "theme_color": "#0b5394",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

`src/web/public/sw.js` (caches the app shell only; never caches `/api` or `/cal`):
```js
const CACHE = 'ct-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return;
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
```

`src/web/public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0b5394"/><text x="256" y="330" font-family="Arial, Helvetica, sans-serif" font-size="240" font-weight="700" fill="#fff" text-anchor="middle">P</text><g fill="#e03a3e" transform="translate(256 120)"><path d="M0-48 11-14h36L18 7l11 34L0 20-29 41l11-34-29-21h36z"/></g></svg>
```

`scripts/icons.mjs`:
```js
import sharp from 'sharp';
for (const size of [192, 512]) {
  await sharp('src/web/public/icon.svg').resize(size, size).png().toFile(`src/web/public/icon-${size}.png`);
}
console.log('icons written');
```

Run:
```bash
npm install -D sharp
node scripts/icons.mjs
```
Expected: `icons written`; `icon-192.png` and `icon-512.png` exist (commit them).

- [ ] **Step 11: Build and verify**

Run: `npm run build:web && npx tsc -p tsconfig.web.json`
Expected: Vite writes `dist/web/index.html`, `dist/web/manifest.webmanifest`, `dist/web/sw.js`, the icons and hashed assets. Typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: web shell, router, API client, deep links, PWA manifest and service worker"
```

---

### Task 21: Home view

**Files:**
- Modify: `src/web/views/home.ts` (replace stub)

**Interfaces:**
- Consumes: `GET /api/me`, `/api/places`, `/api/places/:id/sweeping`, `/api/watch/:id`, `/api/vehicles/status`, `/api/winter`, `/api/status`; `h`, `api`, format helpers, `navUrl`.

- [ ] **Step 1: Implement `src/web/views/home.ts`**

```ts
import { api } from '../api.js';
import { clear, h } from '../dom.js';
import { chicagoToday, daysUntil, fmtDate, fmtDistance, isWinterMonth, UTIL_LABEL } from '../format.js';
import { navUrl } from '../../shared/deeplinks.js';
import type { DatasetMeta, NavApp, Place, SweepInfo, Vehicle, VehicleStatus, WatchResult, WinterStatus } from '../../shared/types.js';

interface Me { navApp: NavApp; comedOutageUrl: string; isOwner: boolean }
interface Status { datasets: DatasetMeta[]; stale: string[]; pushFailing: string | null }
type VehicleRow = Vehicle & { status: VehicleStatus | null };

export async function renderHome(root: HTMLElement): Promise<void> {
  root.append(h('p', { class: 'muted' }, 'Loading…'));
  const [me, places, vehicles, winter, status] = await Promise.all([
    api<Me>('/api/me'), api<Place[]>('/api/places'), api<VehicleRow[]>('/api/vehicles/status'),
    api<WinterStatus[]>('/api/winter'), api<Status>('/api/status'),
  ]);
  const homes = places.filter((p) => p.kind === 'home'), watches = places.filter((p) => p.kind === 'watch');
  const [sweeps, watchRes] = await Promise.all([
    Promise.all(homes.map((p) => api<SweepInfo>(`/api/places/${p.id}/sweeping`))),
    Promise.all(watches.map((p) => api<WatchResult>(`/api/watch/${p.id}`))),
  ]);
  const today = chicagoToday();
  clear(root);
  root.append(h('h1', null, 'Chicago Tracker'));

  // Banners
  if (status.stale.length) root.append(h('div', { class: 'banner' }, `City data is out of date for: ${status.stale.join(', ')}. Showing the last good copy.`));
  const errored = status.datasets.filter((d) => d.status === 'error');
  if (errored.length) root.append(h('div', { class: 'banner' }, `Last refresh failed for: ${errored.map((d) => d.name).join(', ')}.`));
  if (status.pushFailing) root.append(h('div', { class: 'banner error' }, `Push delivery failing — ${status.pushFailing}`));

  if (!places.length) {
    root.append(h('div', { class: 'card' }, h('h2', null, 'Get started'), h('p', null, 'Add your home streets and places to watch.'), h('a', { class: 'btn primary', href: '#/settings' }, 'Add places')));
  }

  // Vehicles
  for (const v of vehicles) root.append(vehicleCard(v, me.navApp));

  // Winter
  const anyAlerts = winter.some((w) => w.alerts.length || w.possibleBan);
  if (isWinterMonth(today) || anyAlerts) {
    for (const w of winter) {
      root.append(h('div', { class: `card ${w.possibleBan || w.alerts.length ? 'amber' : ''}` },
        h('h2', null, `❄️ Winter — ${w.label}`),
        h('p', null, w.onSnowRoute ? 'Your street is a snow route (2-inch ban may apply).' : 'Not on a main snow route.'),
        w.possibleBan ? h('p', null, h('strong', null, `Possible 2-inch snow ban: ~${w.snowNext24hIn} in. forecast in 24h.`)) : null,
        ...w.alerts.map((a) => h('p', null, h('strong', null, a.event), ` — ${a.headline}`)),
        h('p', { class: 'muted small' }, w.error ? `Last check failed (${w.checkedAt ?? 'never'})` : `Checked ${w.checkedAt?.slice(11, 16) ?? '—'}`)));
    }
  }

  // Home streets
  homes.forEach((p, i) => {
    const s = sweeps[i];
    const next = s.upcoming[0];
    const body: (HTMLElement | string)[] = [];
    if (!p.zones.length) body.push(h('p', null, 'Pick your sweeping zone in ', h('a', { href: '#/settings' }, 'Settings'), '.'));
    else if (s.status === 'nodata') body.push(h('p', null, 'No sweeping schedule loaded for this year yet.'));
    else if (s.status === 'over') body.push(h('p', null, 'Sweeping season over — resumes in April.'));
    else if (next) {
      const d = daysUntil(today, next.date);
      body.push(h('div', { class: 'big' }, d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d} days`),
        h('p', null, `Next sweep ${fmtDate(next.date)} · Ward ${next.wardSection.slice(0, 2)} Sec ${next.wardSection.slice(2)} · 9am–2pm`),
        h('p', { class: 'muted small' }, `Then: ${s.upcoming.slice(1, 4).map((u) => fmtDate(u.date)).join(', ') || '—'}`));
    }
    const cls = next && daysUntil(today, next.date) <= 1 ? 'red' : 'green';
    root.append(h('div', { class: `card ${p.zones.length ? cls : ''}` }, h('h2', null, `🧹 ${p.label}`), ...body));
  });

  // Watched places
  watches.forEach((p, i) => root.append(watchCard(p, watchRes[i])));

  root.append(h('p', { class: 'small' }, h('a', { href: me.comedOutageUrl, target: '_blank', rel: 'noopener' }, '⚡ ComEd outage map')));
}

function vehicleCard(v: VehicleRow, nav: NavApp): HTMLElement {
  const name = v.nickname || v.plate;
  const s = v.status;
  if (!s) return h('div', { class: 'card' }, h('h2', null, `🚗 ${name}`), h('p', { class: 'muted' }, 'Not checked yet.'));
  if (s.matches.length) {
    return h('div', { class: 'card red' }, h('h2', null, `🚨 ${name}`),
      ...s.matches.map((m) => h('div', null,
        h('p', null, h('strong', null, m.kind === 'towed' ? `Towed ${fmtDate(m.date)}` : `Relocated ${fmtDate(m.date)}`), ` — ${m.details}`),
        h('p', null, m.kind === 'towed' ? `Tow lot: ${m.address}` : `Now at: ${m.address}`, m.phone ? ` · ${m.phone}` : ''),
        h('a', { class: 'btn primary', href: navUrl(nav, `${m.address}, Chicago, IL`), target: '_blank', rel: 'noopener' }, 'Navigate'))),
      h('p', { class: 'muted small' }, 'City records can lag by a few hours.'));
  }
  if (!s.ok) return h('div', { class: 'card amber' }, h('h2', null, `🚗 ${name}`), h('p', null, `Last checked ${s.checkedAt.slice(11, 16)} — check failed.`));
  return h('div', { class: 'card green' }, h('h2', null, `🚗 ${name}`), h('p', null, `✅ Not in tow or relocation records (checked ${s.checkedAt.slice(11, 16)}).`));
}

function watchCard(p: Place, r: WatchResult): HTMLElement {
  const tags = [...new Set(r.items.map((i) => i.utility).filter((u): u is NonNullable<typeof u> => !!u))];
  const total311 = r.requests311.reduce((n, g) => n + g.count, 0);
  const detail = h('div', { hidden: true });
  let filter: string | null = null;
  const draw = () => {
    clear(detail);
    const chips = h('div', { class: 'chips' },
      h('button', { class: 'chip', 'aria-pressed': String(filter === null), onclick: () => { filter = null; draw(); } }, 'All'),
      ...tags.map((t) => h('button', { class: 'chip', 'aria-pressed': String(filter === t), onclick: () => { filter = t; draw(); } }, UTIL_LABEL[t])));
    const items = r.items.filter((i) => !filter || i.utility === filter);
    detail.append(chips, h('ul', { class: 'list' }, ...items.map((i) => h('li', null,
      h('strong', null, `${i.utility ? `${UTIL_LABEL[i.utility]} · ` : ''}${i.title}`),
      h('div', { class: 'small' }, `${i.location} · ${fmtDate(i.start.slice(0, 10))}${i.end.slice(0, 10) !== i.start.slice(0, 10) ? `–${fmtDate(i.end.slice(0, 10))}` : ''} · ${fmtDistance(i.distanceM)}`),
      i.description ? h('div', { class: 'muted small' }, i.description) : null))));
    if (!items.length) detail.append(h('p', { class: 'muted' }, 'Nothing scheduled in the next 14 days.'));
    if (r.requests311.length) {
      const d = h('details', null, h('summary', null, `311 requests (last 30 days): ${total311}`),
        h('ul', { class: 'list' }, ...r.requests311.map((g) => h('li', null, h('strong', null, `${g.type} — ${g.count}`),
          ...g.items.slice(0, 5).map((x) => h('div', { class: 'small' }, `${x.address} · ${x.status} · ${fmtDate(x.created.slice(0, 10))}`))))));
      detail.append(d);
    }
    detail.append(h('p', { class: 'muted small' }, `Permits as of ${r.dataAsOf.permitsCurrent ?? '—'} · Events as of ${r.dataAsOf.specialEvents ?? '—'}`));
  };
  draw();
  const toggle = h('button', { onclick: () => { detail.hidden = !detail.hidden; toggle.textContent = detail.hidden ? 'Show' : 'Hide'; } }, 'Show');
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h2', null, `📍 ${p.label}`), toggle),
    h('p', null, `${r.items.length} active item${r.items.length === 1 ? '' : 's'} · ${total311} 311 requests`),
    tags.length ? h('div', { class: 'chips' }, ...tags.map((t) => h('span', { class: 'chip' }, UTIL_LABEL[t]))) : null,
    detail);
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -p tsconfig.web.json && npm run build:web`. Expected: exit 0.

- [ ] **Step 3: Verify in the browser**

Start the server (see Task 19 Step 6) and the web dev server: `npm run dev:web`. Open `http://localhost:5173/#/home` at a 390×844 viewport, then a desktop viewport. Check:
- With no places: the "Get started" card links to Settings.
- After adding a home (Task 23, or `curl -X POST` to `/api/places`) with a confirmed zone: the countdown and next 3 dates appear. A sweep tomorrow or today makes the card red.
- A watched place shows its item count and utility chips. **Show** expands the list; the filter chips filter it; the 311 section expands.
- No horizontal scroll. Dark mode is legible (toggle the OS setting).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: home view (vehicles, winter, sweeping, watched places)"
```

---

### Task 22: Park view (map)

**Files:**
- Modify: `src/web/views/park.ts` (replace stub)

**Interfaces:**
- Consumes: `GET /api/me`, `/api/geocode`, `/api/parking`, `/api/plows`; Leaflet; `openSheet`; `navUrl`; format helpers.

- [ ] **Step 1: Implement `src/web/views/park.ts`**

```ts
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, ApiError } from '../api.js';
import { clear, h } from '../dom.js';
import { openSheet } from '../components/sheet.js';
import { chicagoNowLocal, chicagoToday, fmtDistance, fmtRate, isWinterMonth, STATUS_COLOR } from '../format.js';
import { navUrl } from '../../shared/deeplinks.js';
import type { GeoResult, LngLat, NavApp, ParkingBlock, ParkingResult, Plow } from '../../shared/types.js';

const LS_KEY = 'ct:lastDest';
const toLatLng = (p: LngLat): L.LatLngTuple => [p[1], p[0]];
let map: L.Map | null = null;

export async function renderPark(root: HTMLElement): Promise<void> {
  const me = await api<{ navApp: NavApp }>('/api/me');
  if (map) { map.remove(); map = null; }

  let dest: GeoResult | null = null;
  try { dest = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); } catch { dest = null; }
  let radius = 400;
  let at: string | null = null;

  const input = h('input', { type: 'search', placeholder: 'Where are you going?', autocomplete: 'off', 'aria-label': 'Destination' }) as HTMLInputElement;
  const results = h('div', { class: 'search-results' });
  const radiusSel = h('select', { 'aria-label': 'Radius' }, ...[200, 400, 800, 1200].map((r) => h('option', { value: String(r), selected: r === radius }, `${fmtDistance(r)} radius`))) as HTMLSelectElement;
  const whenSel = h('select', { 'aria-label': 'When' }, h('option', { value: 'now' }, 'Now'), h('option', { value: 'custom' }, 'Pick a time…')) as HTMLSelectElement;
  const whenInput = h('input', { type: 'datetime-local', hidden: true, 'aria-label': 'Arrival time' }) as HTMLInputElement;
  const plowToggle = h('button', { class: 'chip', 'aria-pressed': 'false', hidden: !isWinterMonth(chicagoToday()) }, '🚜 Snowplows');
  const status = h('p', { class: 'muted small' });
  const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': 'Parking map' });
  const list = h('ul', { class: 'list' });
  const legend = h('div', { class: 'legend' },
    ...([['green', 'No issues found'], ['info', 'Info'], ['amber', 'Caution'], ['red', 'Avoid']] as const).map(([k, t]) => h('span', null, h('span', { class: 'dot', style: `background:${STATUS_COLOR[k]}` }), t)),
    h('span', null, h('span', { class: 'dot', style: 'background:#7b3fa0' }), 'Permit zone'));

  root.append(h('h1', null, 'Street parking'),
    h('div', { class: 'row' }, input, h('button', { onclick: locate }, '📍 Near me')), results,
    h('div', { class: 'row' }, whenSel, whenInput, radiusSel, plowToggle), status, mapEl, legend, list);

  map = L.map(mapEl, { zoomControl: true }).setView([41.8819, -87.6278], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const main = L.layerGroup().addTo(map), boxes = L.layerGroup(), plows = L.layerGroup();
  map.on('zoomend', () => { if (map!.getZoom() >= 17) boxes.addTo(map!); else boxes.remove(); });

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { clear(results); return; }
    timer = window.setTimeout(async () => {
      const hits = await api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => []);
      clear(results);
      if (!hits.length) results.append(h('p', { class: 'muted small' }, "Couldn't find that address."));
      for (const g of hits) results.append(h('button', { onclick: () => choose(g) }, g.label));
    }, 400);
  });
  radiusSel.addEventListener('change', () => { radius = Number(radiusSel.value); void load(); });
  whenSel.addEventListener('change', () => {
    whenInput.hidden = whenSel.value !== 'custom';
    if (whenSel.value === 'now') { at = null; void load(); } else { whenInput.value = chicagoNowLocal(); }
  });
  whenInput.addEventListener('change', () => { at = whenInput.value || null; void load(); });
  plowToggle.addEventListener('click', async () => {
    const on = plowToggle.getAttribute('aria-pressed') !== 'true';
    plowToggle.setAttribute('aria-pressed', String(on));
    plows.clearLayers();
    if (!on) { plows.remove(); return; }
    const b = map!.getBounds();
    const list_ = await api<Plow[]>(`/api/plows?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(',')}`).catch(() => []);
    for (const p of list_) L.circleMarker(toLatLng(p.point), { radius: 6, color: '#333', fillColor: '#ffd400', fillOpacity: 1 }).bindTooltip(`${p.type} · ${p.minutesAgo} min ago`).addTo(plows);
    plows.addTo(map!);
    status.textContent = `${list_.length} plows reporting in view (last 2h).`;
  });

  function choose(g: GeoResult) {
    dest = g; input.value = g.label; clear(results);
    try { localStorage.setItem(LS_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
    void load();
  }
  function locate() {
    if (!navigator.geolocation) { status.textContent = 'Location not available.'; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { status.textContent = 'Location permission denied.'; }, { enableHighAccuracy: true, timeout: 10_000 });
  }

  async function load() {
    if (!dest) { status.textContent = 'Search for a destination to see nearby metered blocks.'; return; }
    status.textContent = 'Loading…';
    const q = new URLSearchParams({ lat: String(dest.lat), lon: String(dest.lon), radius: String(radius) });
    if (at) q.set('at', at);
    let r: ParkingResult;
    try { r = await api<ParkingResult>(`/api/parking?${q}`); } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : 'Could not load parking.'; return;
    }
    draw(r);
  }

  function draw(r: ParkingResult) {
    main.clearLayers(); boxes.clearLayers(); clear(list);
    const center = toLatLng(r.center);
    const circle = L.circle(center, { radius: r.radiusM, color: '#888', weight: 1, fill: false, dashArray: '4 4' }).addTo(main);
    L.circleMarker(center, { radius: 8, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(dest?.label ?? 'Destination').addTo(main);
    for (const z of r.permitZones) {
      const layer = z.line.length > 1
        ? L.polyline(z.line.map(toLatLng), { color: '#7b3fa0', weight: 5, dashArray: '6 6' })
        : L.circleMarker(toLatLng(z.line[0]), { radius: 6, color: '#7b3fa0' });
      layer.bindTooltip(z.label).addTo(main);
    }
    for (const c of r.closures) if (c.point) {
      L.circleMarker(toLatLng(c.point), { radius: 7, color: '#d73027', fillColor: '#d73027', fillOpacity: .5 })
        .bindPopup(h('div', null, h('strong', null, c.streetClosure ? `${c.streetClosure} closure` : c.appType), h('div', null, c.location), h('div', null, `${c.start.slice(0, 10)} → ${c.end.slice(0, 10)}`))).addTo(main);
    }
    for (const b of r.blocks) {
      L.polyline(b.paths.map((p) => p.map(toLatLng)), { color: STATUS_COLOR[b.status], weight: 8, opacity: .9 }).on('click', () => openBlock(b)).addTo(main);
    }
    for (const x of r.boxes) L.circleMarker(toLatLng(x.point), { radius: 4, color: '#444', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`Pay box · area ${x.payArea}`).addTo(boxes);
    map!.fitBounds(circle.getBounds(), { padding: [10, 10] });

    const when = r.at.slice(0, 16).replace('T', ' ');
    status.textContent = `${r.blocks.length} metered blocks within ${fmtDistance(r.radiusM)} · ${when}${r.warnings.length ? ` · ⚠️ ${r.warnings.join('; ')}` : ''} · data as of ${r.dataAsOf.payBlocks?.slice(0, 10) ?? '—'}`;
    if (!r.blocks.length) list.append(h('li', { class: 'muted' }, 'No metered blocks in range. Try a bigger radius.'));
    for (const b of r.blocks) {
      list.append(h('li', { onclick: () => openBlock(b), style: 'cursor:pointer' },
        h('span', { class: 'dot', style: `background:${STATUS_COLOR[b.status]}` }),
        h('strong', null, `${b.from}–${b.to} ${b.street}`),
        h('div', { class: 'small' }, `${fmtDistance(b.distanceM)} · ${b.spaces} spaces · ${b.hourLimit ? `${b.hourLimit} hr limit` : 'limit: see sign'} · ${fmtRate(b.rate)}`),
        b.flags.length ? h('div', { class: 'small muted' }, b.flags.map((f) => f.reason).join(' · ')) : null));
    }
  }

  function openBlock(b: ParkingBlock) {
    const copyArea = async () => { try { await navigator.clipboard.writeText(String(b.payArea)); } catch { /* clipboard unavailable */ } };
    openSheet(h('div', null,
      h('h2', null, `${b.from}–${b.to} ${b.street}`),
      h('p', null, `${b.spaces} spaces · ${b.hourLimit ? `${b.hourLimit} hr limit` : 'hour limit: see sign'} · ${fmtDistance(b.distanceM)} from destination`),
      h('p', null, `${fmtRate(b.rate)} · ${b.rate.hoursText} (approximate — check the meter)`),
      h('p', null, h('span', { class: 'big' }, `Pay area #${b.payArea}`), ' ', h('button', { onclick: copyArea }, 'Copy')),
      b.flags.length ? h('ul', { class: 'list' }, ...b.flags.map((f) => h('li', null, h('span', { class: 'dot', style: `background:${STATUS_COLOR[f.severity]}` }), f.reason))) : h('p', { class: 'muted' }, 'No issues found in city data. Always read the posted signs.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: navUrl(me.navApp, b.navPoint), target: '_blank', rel: 'noopener' }, '🧭 Navigate'),
        h('a', { class: 'btn', href: 'https://parkchicago.com', target: '_blank', rel: 'noopener', onclick: copyArea }, 'ParkChicago (area copied)'))));
  }

  if (dest) { input.value = dest.label; await load(); } else { status.textContent = 'Search for a destination to see nearby metered blocks.'; }
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -p tsconfig.web.json && npm run build:web`. Expected: exit 0.

- [ ] **Step 3: Verify in the browser** (server running with real data, from Task 19 Step 6)

At 390×844 and at desktop size:
- Search "730 W Randolph": suggestions appear; picking one draws the dashed radius circle and colored block lines, and lists blocks with best (green) first.
- Tapping a block or list row opens the sheet with spaces, limit, `≈ $` rate, pay area + Copy, flags with reasons, and Navigate. On an iPhone, **Navigate** opens Apple Maps with driving directions.
- Changing the radius re-queries. "Pick a time…" with a Sunday shows the `SUNDAY` info flag.
- Zoom to ≥ 17: pay-box dots appear. Below that they hide.
- A residential destination (e.g. "1400 W Wilson Ave") shows purple dashed permit-zone lines.
- Reloading the page restores the last destination. No horizontal scroll. The map tiles load (CSP allows `tile.openstreetmap.org`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: park view with Leaflet map, block sheet, navigate and pay-area copy"
```

---

### Task 23: Settings view (places, zone picker, vehicles, notifications, calendar, status)

**Files:**
- Modify: `src/web/views/settings.ts` (replace stub)

**Interfaces:**
- Consumes: `/api/me` (GET/PATCH), `/api/me/cal-token`, `/api/places` (GET/POST/PATCH/DELETE), `/api/places/:id/sweeping`, `/api/vehicles` (GET/POST/DELETE), `/api/me/notifications` (GET/PATCH), `/api/me/notifications/test`, `/api/status`, `/api/admin/refresh`.

- [ ] **Step 1: Implement `src/web/views/settings.ts`**

```ts
import { api, ApiError } from '../api.js';
import { clear, h } from '../dom.js';
import { fmtDate } from '../format.js';
import type { DatasetMeta, NavApp, NotifyCategory, NotifyPrefs, Place, SweepInfo, Vehicle } from '../../shared/types.js';

interface Me { login: string; isOwner: boolean; navApp: NavApp; calUrl: string }
interface Notif { topic: string; prefs: NotifyPrefs; configured: boolean; ntfyUrl: string | null }
type SweepWithCandidates = SweepInfo & { candidates: { wardSection: string; next: string[] }[] };

const CAT_LABEL: Record<NotifyCategory, string> = { vehicle: 'Car towed / relocated', sweeping: 'Sweeping tomorrow (7pm)', winter: 'Winter weather alerts', snowban: 'Possible snow ban', work: 'New work near home (6pm digest)' };

export async function renderSettings(root: HTMLElement): Promise<void> {
  const rerender = async () => { clear(root); await renderSettings(root); };
  const msg = h('p', { class: 'small', role: 'status' });
  const fail = (e: unknown) => { msg.textContent = e instanceof ApiError ? e.message : 'Something went wrong.'; };
  const [me, places, vehicles, notif, status] = await Promise.all([
    api<Me>('/api/me'), api<Place[]>('/api/places'), api<Vehicle[]>('/api/vehicles'),
    api<Notif>('/api/me/notifications'), api<{ datasets: DatasetMeta[]; stale: string[] }>('/api/status'),
  ]);
  root.append(h('h1', null, 'Settings'), msg);

  // Places
  const kindSel = h('select', { 'aria-label': 'Type' }, h('option', { value: 'home' }, 'Home street'), h('option', { value: 'watch' }, 'Watched place')) as HTMLSelectElement;
  const labelIn = h('input', { placeholder: 'Label (e.g. Home, Mom’s)', maxlength: 60 }) as HTMLInputElement;
  const addrIn = h('input', { placeholder: 'Address (e.g. 1400 W Wilson Ave)' }) as HTMLInputElement;
  const placeList = h('div');
  for (const p of places) placeList.append(await placeRow(p, rerender, fail));
  root.append(h('section', { class: 'card' }, h('h2', null, 'Places'), placeList,
    h('label', null, 'Add a place'), kindSel, labelIn, addrIn,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => {
      try { await api('/api/places', { method: 'POST', body: { kind: kindSel.value, label: labelIn.value, address: addrIn.value } }); await rerender(); } catch (e) { fail(e); }
    } }, 'Add'))));

  // Vehicles
  const plateIn = h('input', { placeholder: 'Plate', maxlength: 10 }) as HTMLInputElement;
  const stateIn = h('input', { placeholder: 'State', value: 'IL', maxlength: 2 }) as HTMLInputElement;
  const nickIn = h('input', { placeholder: 'Nickname (optional)', maxlength: 30 }) as HTMLInputElement;
  root.append(h('section', { class: 'card' }, h('h2', null, 'Vehicles (tow & relocation check)'),
    h('ul', { class: 'list' }, ...vehicles.map((v) => h('li', { class: 'row' }, h('span', null, `${v.nickname ? `${v.nickname} · ` : ''}${v.plate} (${v.state})`),
      h('button', { onclick: async () => { try { await api(`/api/vehicles/${v.id}`, { method: 'DELETE' }); await rerender(); } catch (e) { fail(e); } } }, 'Remove')))),
    vehicles.length < 3 ? h('div', null, h('div', { class: 'row' }, plateIn, stateIn), nickIn,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => {
        try { await api('/api/vehicles', { method: 'POST', body: { plate: plateIn.value, state: stateIn.value, nickname: nickIn.value } }); await rerender(); } catch (e) { fail(e); }
      } }, 'Add vehicle'))) : h('p', { class: 'muted small' }, 'Maximum of 3 vehicles.')));

  // Notifications
  const prefs = structuredClone(notif.prefs);
  const topicIn = h('input', { value: notif.topic, 'aria-label': 'ntfy topic' }) as HTMLInputElement;
  const qs = h('input', { type: 'time', value: prefs.quietStart, 'aria-label': 'Quiet hours start' }) as HTMLInputElement;
  const qe = h('input', { type: 'time', value: prefs.quietEnd, 'aria-label': 'Quiet hours end' }) as HTMLInputElement;
  root.append(h('section', { class: 'card' }, h('h2', null, 'Push notifications (ntfy)'),
    notif.configured ? null : h('div', { class: 'banner' }, 'ntfy is not configured on the server (NTFY_URL).'),
    h('p', { class: 'small' }, `In the ntfy iPhone app, add server ${notif.ntfyUrl ?? '(not set)'} and subscribe to this topic:`),
    topicIn,
    ...(Object.keys(CAT_LABEL) as NotifyCategory[]).map((c) => h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: prefs.enabled[c], style: 'width:auto', onchange: (e: Event) => { prefs.enabled[c] = (e.target as HTMLInputElement).checked; } }), CAT_LABEL[c])),
    h('label', null, 'Quiet hours (urgent tow alerts still come through)'), h('div', { class: 'row' }, qs, qe),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'primary', onclick: async () => {
        try { await api('/api/me/notifications', { method: 'PATCH', body: { topic: topicIn.value, prefs: { ...prefs, quietStart: qs.value, quietEnd: qe.value } } }); msg.textContent = 'Saved.'; } catch (e) { fail(e); }
      } }, 'Save'),
      h('button', { onclick: async () => { try { await api('/api/me/notifications/test', { method: 'POST' }); msg.textContent = 'Test push sent.'; } catch (e) { fail(e); } } }, 'Send test'))));

  // Calendar + navigation
  const navSel = h('select', { 'aria-label': 'Navigation app', onchange: async (e: Event) => {
    try { await api('/api/me', { method: 'PATCH', body: { navApp: (e.target as HTMLSelectElement).value } }); msg.textContent = 'Saved.'; } catch (err) { fail(err); }
  } }, ...(['apple', 'google', 'waze'] as const).map((n) => h('option', { value: n, selected: me.navApp === n }, { apple: 'Apple Maps', google: 'Google Maps', waze: 'Waze' }[n])));
  root.append(h('section', { class: 'card' }, h('h2', null, 'Street-cleaning calendar'),
    h('p', { class: 'small' }, 'On iPhone: tap Subscribe (or Settings → Calendar → Accounts → Add Subscribed Calendar and paste the link). Tailscale must be connected for it to refresh.'),
    h('input', { value: me.calUrl, readonly: true, 'aria-label': 'Calendar link' }),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('a', { class: 'btn primary', href: me.calUrl }, 'Subscribe'),
      h('button', { onclick: async () => { try { await navigator.clipboard.writeText(me.calUrl); msg.textContent = 'Copied.'; } catch { msg.textContent = 'Copy failed — select the text instead.'; } } }, 'Copy'),
      h('button', { onclick: async () => { try { await api('/api/me/cal-token', { method: 'POST' }); await rerender(); } catch (e) { fail(e); } } }, 'Regenerate link')),
    h('label', null, 'Navigate with'), navSel));

  // Data status
  root.append(h('section', { class: 'card' }, h('h2', null, 'City data'),
    h('ul', { class: 'list' }, ...status.datasets.map((d) => h('li', null, h('strong', null, d.name), ` · ${d.rowCount} rows · ${d.fetchedAt ?? 'never'}`,
      d.status === 'error' ? h('div', { class: 'small', style: 'color:var(--red)' }, d.error ?? 'error') : null))),
    me.isOwner ? h('button', { onclick: async () => { msg.textContent = 'Refreshing… (can take a few minutes)'; try { await api('/api/admin/refresh', { method: 'POST' }); await rerender(); } catch (e) { fail(e); } } }, 'Refresh now') : null));
}

async function placeRow(p: Place, rerender: () => Promise<void>, fail: (e: unknown) => void): Promise<HTMLElement> {
  const row = h('div', { class: 'card' }, h('div', { class: 'row' },
    h('div', null, h('strong', null, `${p.kind === 'home' ? '🏠' : '📍'} ${p.label}`), h('div', { class: 'small muted' }, p.address)),
    h('button', { onclick: async () => { try { await api(`/api/places/${p.id}`, { method: 'DELETE' }); await rerender(); } catch (e) { fail(e); } } }, 'Delete')));
  if (p.kind === 'watch') {
    const r = h('select', { 'aria-label': 'Watch radius', onchange: async (e: Event) => {
      try { await api(`/api/places/${p.id}`, { method: 'PATCH', body: { radiusM: Number((e.target as HTMLSelectElement).value) } }); } catch (err) { fail(err); }
    } }, ...[100, 300, 500, 1000].map((m) => h('option', { value: String(m), selected: p.radiusM === m }, `${m} m radius`)));
    row.append(r);
    return row;
  }
  const sw = await api<SweepWithCandidates>(`/api/places/${p.id}/sweeping`);
  const chosen = new Set(p.zones);
  if (!sw.candidates.length) { row.append(h('p', { class: 'small muted' }, 'No sweeping zone found near this address.')); return row; }
  row.append(h('p', { class: 'small' }, sw.candidates.length > 1 ? 'This address is near a zone boundary. Pick the side(s) you park on:' : 'Sweeping zone:'),
    ...sw.candidates.map((c) => h('label', { class: 'row' },
      h('input', { type: 'checkbox', style: 'width:auto', checked: chosen.has(c.wardSection), onchange: async (e: Event) => {
        if ((e.target as HTMLInputElement).checked) chosen.add(c.wardSection); else chosen.delete(c.wardSection);
        try { await api(`/api/places/${p.id}`, { method: 'PATCH', body: { zones: [...chosen] } }); } catch (err) { fail(err); }
      } }),
      `Ward ${c.wardSection.slice(0, 2)} Sec ${c.wardSection.slice(2)} — next ${c.next.map(fmtDate).join(', ') || 'none this season'}`)));
  return row;
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc -p tsconfig.web.json && npm run build:web`. Expected: exit 0.

- [ ] **Step 3: Verify in the browser** (phone and desktop viewports)
- Add a home whose address sits on a zone boundary: two checkboxes appear. Checking them persists (reload to confirm), and Home shows the merged dates.
- Add a watched place and change its radius; Home reflects it.
- Add a vehicle (invalid input shows the server error text); remove it.
- Notifications: Save persists (reload). **Send test** delivers to the iPhone ntfy app, or shows the server error.
- Calendar: **Subscribe** opens the iOS subscribe prompt. **Regenerate link** changes the URL, and the old URL returns 404.
- City data lists all datasets. The owner sees **Refresh now**; a second user does not.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: settings view (places + zone picker, vehicles, ntfy, calendar, data status)"
```

---

## Phase G — Verification against real data, and deployment

### Task 24: Contract check, real-data fixtures, fixture tests

**Files:**
- Create: `scripts/contract-check.ts`, `scripts/capture-fixtures.ts`, `test/fixtures/*.json` (generated), `test/fixtures.test.ts`

**Interfaces:**
- Consumes: sources, normalizers, domain functions.
- Produces: `npm run contract-check` (live; exits 1 on schema drift; prints facts the implementer must record), `npm run capture-fixtures` (live; writes fixtures), and the offline fixture test.

- [ ] **Step 1: Implement `scripts/contract-check.ts`**

```ts
import { loadConfig } from '../src/server/config.js';
import { createFetchJson } from '../src/server/http/fetchJson.js';

const cfg = loadConfig({ OWNER_LOGIN: 'x', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: process.env.NOMINATIM_CONTACT ?? 'contract-check' }, 'config');
const fj = createFetchJson({ userAgent: 'chicago-tracker contract-check' });
const d = cfg.datasets;
let failed = false;
const need = (what: string, have: string[], want: string[]) => {
  const missing = want.filter((w) => !have.includes(w));
  console.log(`${missing.length ? '✗' : '✓'} ${what}${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
  if (missing.length) failed = true;
};

const SOCRATA: [keyof typeof d.socrata, string[]][] = [
  ['sweepSchedule', ['ward_section_concatenated', 'month_number', 'dates']],
  ['sweepZones', ['the_geom', 'ward', 'section']],
  ['permitsClosures', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'streetclosure', 'parkingmeterpostingorbagging', 'latitude', 'longitude', 'primarycontactlast']],
  ['permitsCurrent', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude', 'primarycontactlast']],
  ['permitsBlockParty', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude']],
  ['permitsFilming', ['uniquekey', 'applicationstartdate', 'applicationenddate', 'latitude', 'longitude']],
  ['specialEvents', ['date', 'venue_address', 'event_type', 'event_details', 'location']],
  ['permitZones', ['status', 'zone', 'odd_even', 'address_range_low', 'address_range_high', 'street_direction', 'street_name', 'street_type']],
  ['towed', ['tow_date', 'plate', 'state', 'towed_to_address', 'tow_facility_phone', 'inventory_number']],
  ['relocated', ['relocated_date', 'plate', 'state', 'relocated_reason', 'relocated_to_street_name', 'service_request_number']],
  ['requests311', ['sr_number', 'sr_type', 'status', 'created_date', 'duplicate', 'latitude', 'longitude', 'location']],
];
for (const [k, fields] of SOCRATA) {
  const v = await fj(`https://data.cityofchicago.org/api/views/${d.socrata[k]}.json`);
  need(`socrata ${k} (${d.socrata[k]}) "${v.name}" updated ${new Date(v.rowsUpdatedAt * 1000).toISOString().slice(0, 10)}`, v.columns.map((c: any) => c.fieldName), fields);
}
const LAYERS: [keyof typeof d.layers, string[]][] = [
  ['payBlocks', ['BLOCK_ID', 'STREET_NAME', 'BLOCK_START', 'BLOCK_END', 'NUM_SPACES', 'HOUR_LIMIT', 'PAY_AREA', 'SUNDAY_HOURS']],
  ['payBoxes', ['TERMINAL_ID', 'STREET_NAME', 'HOUR_LIMIT', 'PAY_AREA']],
  ['cbd', ['NAME']], ['snowRoutes', ['SNOW_RTE']], ['snowplows', ['ASSET_NAME', 'ASSET_TYPE', 'POSTING_TIME']],
  ['parcels', ['L_ADDR', 'H_ADDR', 'PRE_DIR', 'ST_NAME', 'ST_TYPE']],
];
for (const [k, fields] of LAYERS) {
  const l = await fj(`${d.arcgisBase}/${d.layers[k]}?f=json`);
  need(`arcgis ${k} (${d.layers[k]}) "${l.name}"`, l.fields.map((f: any) => f.name), fields);
}

console.log('\n--- Facts to record in config/datasets.json / deploy notes ---');
const stat = async (layer: number, field: string) =>
  (await fj(`${d.arcgisBase}/${layer}/query?where=1%3D1&returnGeometry=false&groupByFieldsForStatistics=${field}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]))}&f=json`))
    .features.map((f: any) => `${f.attributes[field]}=${f.attributes.n}`).join(', ');
console.log(`SUNDAY_HOURS distribution: ${await stat(d.layers.payBlocks, 'SUNDAY_HOURS')}`);
console.log(`PAY_ZONE distribution: ${await stat(d.layers.payBlocks, 'PAY_ZONE')}`);
const sc = await fj(`${d.socrataBase}/${d.socrata.permitsClosures}.json?$select=streetclosure,count(*)&$group=streetclosure&$order=count(*) DESC`);
console.log(`streetclosure values: ${sc.map((r: any) => `${r.streetclosure ?? '(null)'}=${r.count}`).join(', ')}`);
console.log(`current closureRedPattern: /${d.closureRedPattern}/i — adjust so only values that block curb parking match.`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it and record the facts**

Run: `npm run contract-check`
Expected: every line ✓ and exit 0. Then:
1. Using the printed `streetclosure` values, edit `closureRedPattern` in `config/datasets.json` so that only curb, lane or full-street closures match (sidewalk-only must not match). Re-run `npx vitest run test/domain/parking.test.ts` to confirm the sidewalk test still passes.
2. Using the `SUNDAY_HOURS` distribution, open https://map.chicagometers.com/ and compare 2–3 blocks of each value against their posted Sunday rules. If `N` reliably means "free Sunday", set `"sundayHoursVerified": true` in `config/datasets.json` and note the meaning in `deploy/HOMELAB.md`. Otherwise leave it `false`; the UI keeps "check sign".
3. Compare layer 50 (Main Snow Routes) and dataset `nnn9-yqby` against the city's published 2-inch snow ban map. Record which source matches in `config/datasets.json` `snowRouteSource`. If `nnn9-yqby` matches better, add a normalizer and job for it (same `SnowRoute` shape) and point `snowRoutes` at it.
4. Visit the ComEd outage URL in `config/utilities.json`. Fix it if it redirects or 404s.

- [ ] **Step 3: Implement `scripts/capture-fixtures.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/server/config.js';
import { createFetchJson } from '../src/server/http/fetchJson.js';
import { arcgisQueryNear } from '../src/server/sources/arcgis.js';
import { socrataQueryAll } from '../src/server/sources/socrata.js';
import * as N from '../src/server/data/normalize.js';

const cfg = loadConfig({ OWNER_LOGIN: 'x', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'fixtures' }, 'config');
const fj = createFetchJson({ userAgent: 'chicago-tracker capture-fixtures' });
const d = cfg.datasets;
const WEST_LOOP: [number, number] = [-87.6470, 41.8845];
const WILSON: [number, number] = [-87.6627, 41.9652];
mkdirSync('test/fixtures', { recursive: true });
const save = (name: string, rows: unknown[]) => { writeFileSync(`test/fixtures/${name}.json`, JSON.stringify(rows)); console.log(`${name}: ${rows.length}`); };

save('payBlocks.westloop', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.payBlocks, WEST_LOOP, 600)).map(N.normPayBlock));
save('payBoxes.westloop', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.payBoxes, WEST_LOOP, 600)).map(N.normPayBox));
save('parcels.wilson', (await arcgisQueryNear(fj, d.arcgisBase, d.layers.parcels, WILSON, 150, { outFields: 'L_ADDR,H_ADDR,PRE_DIR,ST_NAME,ST_TYPE' })).map(N.normParcel).filter(Boolean));
save('permitZones.wilson', (await socrataQueryAll(fj, d.socrataBase, d.socrata.permitZones, { where: "status = 'ACTIVE' AND street_name = 'WILSON'" })).map(N.normPermitZone).filter(Boolean));
save('sweepZones.ward47', (await socrataQueryAll(fj, d.socrataBase, d.socrata.sweepZones, { where: "ward = '47'" })).map(N.normSweepZone).filter(Boolean));
save('sweepSchedule.ward47', (await socrataQueryAll(fj, d.socrataBase, d.socrata.sweepSchedule, { where: "ward = '47'" })).map(N.normSweepRow));
```

Run: `npm run capture-fixtures`
Expected: six lines with counts > 0. (If `ward` is numeric in a dataset, use `ward = 47` without quotes. Check the contract-check output.)

- [ ] **Step 4: Write the fixture test** — `test/fixtures.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildParking } from '../src/server/domain/parking.js';
import { matchPermitZones } from '../src/server/domain/permitZones.js';
import { buildSweepIndex, sweepInfo, zoneCandidates } from '../src/server/domain/sweeping.js';
import { loadConfig } from '../src/server/config.js';

const fx = (n: string) => JSON.parse(readFileSync(`test/fixtures/${n}.json`, 'utf8'));
const cfg = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('real-data fixtures', () => {
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
```

- [ ] **Step 5: Run the full suite offline**

Run: `npx vitest run`. Expected: PASS, including the fixture tests. If the Ward 47 point is outside every ward-47 zone, pick a point inside the first fixture zone's bbox and update the test.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: live contract check, captured real-data fixtures and fixture tests"
```

---

### Task 25: Container, tailnet-only deployment, smoke test, homelab notes

**Files:**
- Create: `Dockerfile`, `deploy/compose.yaml`, `deploy/chicago-tracker.env.example`, `deploy/HOMELAB.md`, `scripts/smoke.ts`

**Interfaces:**
- Produces: a running tailnet-only service at `https://<name>.<tailnet>.ts.net`.

> **Homelab defaults take precedence.** If the homelab has a standard compose layout, reverse proxy, Tailscale sidecar pattern, secret store, backup job, image scanner or monitoring, use it and adapt the files below. What must survive any adaptation: tailnet-only exposure, no Funnel, non-root, read-only root FS with only `/data` writable, dropped capabilities, `no-new-privileges`, secrets out of git, `/data` backed up, `/healthz` monitored.

- [ ] **Step 1: Create the `Dockerfile` and pin the base image digest**

Resolve the digest once and substitute it for `<DIGEST>` in both `FROM` lines:
```bash
docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'
```

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@<DIGEST> AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim@<DIGEST>
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
```

The build only needs `src/`, `config/` and the package files. `test/` and `docs/` stay excluded via `.dockerignore`.

- [ ] **Step 2: Create `deploy/compose.yaml` and the env example**

```yaml
services:
  chicago-tracker:
    build: ..
    image: chicago-tracker:local
    container_name: chicago-tracker
    restart: unless-stopped
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    user: "1000:1000"
    env_file: ./chicago-tracker.env
    volumes:
      - ./data:/data
    ports:
      - "127.0.0.1:8787:8787"   # loopback only — tailscale serve is the only way in
```

`deploy/chicago-tracker.env.example` (copy to `chicago-tracker.env`, which is git-ignored; or load from the homelab secret store):
```
OWNER_LOGIN=you@example.com
ALLOWED_LOGINS=
PUBLIC_BASE_URL=https://chicago.<tailnet>.ts.net
NOMINATIM_CONTACT=you@example.com
NWS_USER_AGENT=chicago-tracker (you@example.com)
SOCRATA_APP_TOKEN=
NTFY_URL=https://ntfy.<tailnet>.ts.net
NTFY_TOKEN=
REFRESH_CRON=30 3 * * *
```
Add `deploy/chicago-tracker.env` and `deploy/data/` to `.gitignore`.

Prepare the data dir: `mkdir -p deploy/data && sudo chown 1000:1000 deploy/data`.

- [ ] **Step 3: Build, start and publish on the tailnet**

```bash
cd deploy && docker compose up -d --build && docker compose ps
# Host-level tailscale (default). Use a dedicated hostname if the homelab does that, or the homelab's sidecar pattern.
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status
tailscale funnel status    # must show no funnel for this service
```
If port 443 on this node is already served, use `--https=8443` (and set `PUBLIC_BASE_URL` accordingly) or the homelab's per-service Tailscale sidecar (`TS_SERVE_CONFIG`) pattern.

- [ ] **Step 4: Create and run `scripts/smoke.ts` from a tailnet device**

```ts
const base = process.argv[2];
if (!base) { console.error('usage: npx tsx scripts/smoke.ts https://chicago.<tailnet>.ts.net'); process.exit(2); }
const j = async (p: string) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`); return r.json(); };
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) process.exitCode = 1; };

const health = await j('/healthz');
check('healthz ok + ready', health.ok === true && health.ready === true);
const me = await j('/api/me');
check(`identity resolved (${me.login})`, typeof me.login === 'string' && me.login.length > 0);
const status = await j('/api/status');
check(`datasets loaded (${status.datasets.length})`, status.datasets.length >= 11);
check(`no stale datasets (${status.stale.join(',') || 'none'})`, status.stale.filter((n: string) => n !== 'specialEvents').length === 0);
const park = await j('/api/parking?lat=41.8845&lon=-87.6470');
check(`West Loop parking blocks: ${park.blocks.length}`, park.blocks.length > 0);
const ics = await (await fetch(me.calUrl.replace(/^webcal:/, 'https:'))).text();
check('calendar parses', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
```

Run (on a tailnet device): `npx tsx scripts/smoke.ts https://chicago.<tailnet>.ts.net`
Expected: all ✓.

Then confirm the app is **not** reachable off-tailnet:
```bash
# From another LAN machine (not via Tailscale): must fail to connect
curl --max-time 5 http://<homelab-lan-ip>:8787/healthz && echo "EXPOSED — fix ports" || echo "not reachable on LAN ✓"
# From a phone with Tailscale OFF (cellular): https://chicago.<tailnet>.ts.net must not load.
```

- [ ] **Step 5: iPhone acceptance pass** (spec §12)
1. Open the tailnet URL in Safari → Share → **Add to Home Screen**. Open it from the home screen.
2. Settings: add both home streets, confirm zones, tap **Subscribe** on the calendar. Calendar shows 2026 dates with 7pm/7am alerts.
3. Park: search a West Loop address and tap a block. **Navigate** opens Apple Maps; with the phone connected to the car, directions appear on CarPlay.
4. Install the ntfy app, add the server (`NTFY_URL`), subscribe to your topic, tap **Send test**. The push arrives with the app backgrounded (see Step 6 about `upstream-base-url`).
5. If your brother is added: share the node or add him to the tailnet, add his login to `ALLOWED_LOGINS`, and restart. He sees an empty profile. Record whether node-sharing users get identity headers (`/api/me` from his device). If not, document the workaround (add him as a tailnet user).

- [ ] **Step 6: Write `deploy/HOMELAB.md`**

Write this file with the **actual values** chosen during deployment:
- Service name, hostname, tailnet URL, and how it is published (`tailscale serve` command or sidecar config). Confirmation that Funnel is off.
- Where the env/secrets live; how to rotate `NTFY_TOKEN` / `SOCRATA_APP_TOKEN`.
- Backup: path of `deploy/data/chicago-tracker.db` and the backup job that covers it. Restore = stop the container, copy the file back, start.
- Monitoring: `/healthz` check location.
- Update procedure: re-resolve the base image digest, `docker compose build --pull && docker compose up -d`, run `scripts/smoke.ts`.
- ntfy: which instance, whether `upstream-base-url: https://ntfy.sh` is enabled for iOS background delivery (this relays only a message-ID poll to ntfy.sh, not content), and why that is acceptable or not under homelab defaults.
- The facts recorded in Task 24 Step 2: `SUNDAY_HOURS` meaning, the snow-route source decision, the final `closureRedPattern`, the ComEd URL.
- Yearly chore: when the city publishes the next year's sweeping datasets (usually March–April), update `sweepSchedule`/`sweepZones` IDs and `sweepingYear` in `config/datasets.json`, rebuild, and refresh.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: container, tailnet-only deployment, smoke test, homelab notes"
```

---

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| §2 data sources & quirks | 3, 4, 6, 24 |
| §3 architecture, refresh cadence | 6, 19 |
| §4.1 sweeping zones (boundary streets) | 7, 10, 23 |
| §4.2 calendar feed | 8, 10, 23 |
| §4.3 permit zones | 12, 14, 22 |
| §4.4 rate tiers | 11 |
| §4.5 parking result + flags | 13, 14, 22 |
| §4.6 watched places + 311 | 15, 21 |
| §4.7 vehicle check | 16, 21, 23 |
| §4.8 utility tagging | 15, 21 |
| §4.9 snow & weather, plows | 17, 21, 22 |
| §4.10 ntfy push | 18, 19, 23 |
| §5 API | 9, 10, 14–18 |
| §6 identity & multi-user | 9, 25 |
| §7 UI / PWA / deep links | 20–23 |
| §8 configuration | 1, 25 |
| §9 deployment & security | 9 (headers, logging), 25 |
| §10 error handling | 6, 13, 14, 16, 17, 18 |
| §11 testing | every task; 24 (fixtures, contract); 25 (smoke) |
| §12 acceptance criteria | 25 Step 5 |
