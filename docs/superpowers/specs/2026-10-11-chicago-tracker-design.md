# Chicago Tracker — Design Spec

- **Date:** 2026-10-11
- **Status:** Approved design, ready for the implementation plan
- **Owner:** the requester (single user to start; a brother may be added later)
- **Implementer:** homelab agent (follows homelab defaults; see §9)

## 1. Purpose

A personal web app for getting around Chicago's parking rules:

1. **Street cleaning:** never miss a sweeping day on the two streets the owner lives on. Dates are delivered as an iPhone calendar subscription.
2. **Street parking near a destination:** search an address and see the metered street parking nearby on an interactive map (block, number of spaces, hour limit, approximate rate, pay-area number), plus anything that makes a block a bad bet (permit-only zone, sweeping, closure, event, bagged meters). The goal is to avoid expensive garages.
3. **Watched addresses:** for a few saved addresses, list street work (tagged by utility: ComEd, Peoples Gas, Water, telecom), closures, events and 311 requests nearby.
4. **Vehicle check:** with a saved license plate, find out quickly if the car was towed or relocated by the city, and where it is now.
5. **Snow and weather:** whether a home street is a snow route, National Weather Service (NWS) winter alerts, and live snowplow positions.
6. **Push alerts** through ntfy for urgent things: tow or relocation, sweeping tomorrow, winter storm or possible snow ban, new work near home.

**Success:** the owner checks the app on an iPhone (and sometimes a desktop browser) before driving somewhere, picks a metered block, taps **Navigate** to open Apple Maps (which shows on CarPlay), and sweeping days arrive on their phone calendar automatically.

### What the user said vs. what was assumed

| Said by user | Assumed (correct if wrong) |
|---|---|
| Phone and desktop used equally; iPhone | Mobile-first layout that also works on desktop |
| CarPlay would be nice, not required | CarPlay is reached by opening Apple Maps via a deep link; no native app |
| Calendar subscription for sweeping reminders | Alerts at 7pm the evening before and at 7am the morning of |
| Meter locations are required; rates are nice to have | Rates are shown as approximate (≈) labels |
| Just me for now, maybe a brother later | Each Tailscale user gets their own profile; no other accounts |
| Hosted on the homelab, behind Tailscale, homelab security defaults | Tailnet-only; never exposed to the public internet |
| Add tow check, utility tags, snow and weather, 311 near home | Utility outage maps (ComEd/Kubra) are **not** scraped (no official API); Home links to ComEd's outage page instead |
| Push alerts via ntfy | Use the homelab's existing ntfy (or equivalent notifier) if there is one; otherwise deploy ntfy tailnet-only following homelab defaults |

### Non-goals

- Live space-by-space availability. No public data source exists.
- A native iOS or CarPlay app, SMS or email. (Push goes through ntfy only.)
- Scraping utility outage maps.
- Garage pricing and booking.
- Public internet access of any kind.

## 2. Verified data sources

Everything below was queried live on 2026-10-11. All sources are free and need no API key. Socrata accepts an optional app token for higher rate limits; store it as a homelab secret if used.

### 2.1 City of Chicago ArcGIS MapServer (not listed on the data portal)

Base URL: `https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/operational/MapServer`

**Always pass `outSR=4326`.** The native coordinate system is IL State Plane (EPSG:3435). The max record count is 2000 and pagination (`resultOffset`/`resultRecordCount`) is supported.

| Layer | ID | Geometry | Count | Key fields | Use |
|---|---|---|---|---|---|
| `REV_PARKING_PAYBLOCKS` | 58 | polyline | 4,166 | `BLOCK_ID, STREET_NAME, BLOCK_START, BLOCK_END, PARITY, NUM_SPACES, HOUR_LIMIT, PAY_ZONE, PAY_AREA, SUNDAY_HOURS` | **Primary map layer:** metered block faces |
| `REV_PARKING_PAYBOXES` | 40 | point | 4,674 | `TERMINAL_ID, STREET_NAME, BLOCK_START, BLOCK_END, PAYBOX_ADDR, NUM_SPACES, HOUR_LIMIT, PAY_ZONE, PAY_AREA` | Pay-box pins; fills in `HOUR_LIMIT` when the block's value is `.` |
| Central Business District | 115 | polygon | 1 | `NAME` | Rate tier lookup |
| Main Snow Routes | 50 | polyline | 290 | `SNOW_RTE` | Snow-route overlay; whether a home street is a snow route (2-inch snow ban routes) |
| `CMAT_SNOWPLOWS` | 38 | point | 573 | `ASSET_NAME, ASSET_TYPE, POSTING_TIME` (epoch ms), `ADDRESS` | **Live** plow and salt-spreader positions; fetched on demand, not mirrored |
| Parcel Addresses | 1 | polygon | large | `L_ADDR, H_ADDR, PRE_DIR, ST_NAME, ST_TYPE` | Places permit-zone address ranges on the map (§4.3); fallback geocoder |

Known data quirks:
- `HOURLY_RATE` is `0.0` on every record. Rates are derived instead (§4.4).
- `ATTRIBUTE_DESC` is always `.`. `HOUR_LIMIT` is sometimes `.` on blocks.
- **The meaning of `SUNDAY_HOURS` (`Y`/`N`) is unverified.** The implementer must check its distribution and confirm the meaning against 2–3 blocks on the official map at https://map.chicagometers.com/ before relying on it. Until then, the UI shows "Sunday: check posted sign".
- **Unverified: whether layer 50 "Main Snow Routes" is the same street set as the 2-inch snow *parking ban*.** It may be the plowing routes instead. The data portal also has "Snow Route Parking Restrictions" (`nnn9-yqby`, last updated 2021). The implementer compares both against the city's published 2-inch ban map, uses the one that matches, records the finding in `config/datasets.json`, and labels the UI accordingly.
- The street-closure layers (35–37, 39, 51–54) are **stale** (latest records are from 2020). Do not use them.

### 2.2 Chicago Data Portal (Socrata)

API: `https://data.cityofchicago.org/resource/<id>.json` with SoQL (`$where`, `$limit`, `$offset`).

| Dataset | ID | Freshness | Key fields | Use |
|---|---|---|---|---|
| Street Sweeping Schedule 2026 | `u5ai-3efk` | season-static | `ward_section_concatenated, ward, section, month_number, dates` (e.g. `"1,2"`) | Sweeping dates |
| Street Sweeping Zones 2026 | `2r7q-emq3` | season-static | `the_geom` (multipolygon), `ward_section`, `ward`, `section` | Address → zone |
| CDOT Permits – Street Closures | `jdis-5sry` | daily | `uniquekey, applicationtype, worktypedescription, applicationstartdate, applicationenddate, streetnumberfrom/to, direction, streetname, suffix, streetclosure, detail, comments, parkingmeterpostingorbagging, latitude, longitude` | Closures and bagged meters |
| CDOT Permits – Current and Future | `hr8i-6s6s` | daily | same schema | Street work near watched addresses |
| CDOT Permits – Block Party | `9zhy-9n5f` | daily | same schema | Events |
| CDOT Filming Permits | `c2az-nhru` | daily | same schema (verify) | Events |
| Special Events | `xgse-8eg7` | **last refreshed 2026-01-08** | `date, venue_address, event_type, event_details, start_time, location` | Events; always show "data as of" |
| Parking Permit Zones | `u9xt-hiju` | updated weekly or so | `status, zone, odd_even, address_range_low/high, street_direction, street_name, street_type` | Residential permit-only blocks (address ranges, **no geometry**) |
| Towed Vehicles | `ygr5-vcbg` | several times a day; rolling 90-day window | `tow_date` (date only), `plate, state, make, color, towed_to_address, tow_facility_phone, inventory_number` | Vehicle check |
| Relocated Vehicles | `5k2z-suxx` | several times a day | `relocated_date, plate, state, relocated_reason, relocated_from_*` (address, lat/lon), `relocated_to_address_number/direction/street_name/suffix`, `service_request_number` | Vehicle check (car moved for sweeping, construction, etc.) |
| 311 Service Requests | `v6vf-nfxy` | hourly | `sr_number, sr_type, status, created_date, closed_date, street_address, duplicate, latitude, longitude` | 311 near watched places |

Known data quirks:
- Permit datasets contain stale rows that are still marked `Open` (e.g. from 2018). **Always filter by date:** `applicationstartdate <= windowEnd AND applicationenddate >= windowStart`.
- When the 2027 sweeping datasets are published (new IDs), the dataset IDs must be updatable from config, not hardcoded (§8).

### 2.3 Rates (published by ParkChicago, https://parkchicago.com/rates-hours)

| Tier | Rate | Hours | Area |
|---|---|---|---|
| Loop | $7.00 (9pm–8am: $3.50) | 8am–9pm | Lake → Wacker (N, W) → Congress (S) |
| CBD (outside Loop) | $4.75 | 8am–midnight | Lake → North Ave → Halsted → Roosevelt |
| West Loop | $4.75 | — | Grand → I-290 → Ashland → Halsted |
| Neighborhoods | $2.50 | 8am–10pm | everywhere else; some spaces free on Sundays |

### 2.4 Third-party services

- **Geocoding:** OpenStreetMap Nominatim (`nominatim.openstreetmap.org`). Must send a descriptive `User-Agent` with the operator contact taken from config, make at most 1 request per second, use a Chicago `viewbox` with `bounded=1`, and cache results. Fallback: the Parcel Addresses layer (exact Chicago street addresses only).
- **Map tiles:** OSM raster tiles with the required attribution. These are acceptable at personal usage levels. The implementer may swap in a homelab tile proxy or cache.
- **Weather:** NWS API (`api.weather.gov`). Free, no key, requires a descriptive `User-Agent`. Uses `/alerts/active?point=<lat>,<lon>` and `/points/<lat>,<lon>`, which points to the gridpoint forecast containing `snowfallAmount`.
- **Push:** ntfy (`POST <NTFY_URL>/<topic>` with `Title`, `Priority`, `Tags`, `Click` headers). Prefer the homelab's existing ntfy instance, reached over the tailnet. The iPhone ntfy app subscribes to a per-user topic.

## 3. Architecture

```
iPhone / desktop browser ──(tailnet HTTPS, *.ts.net)──▶ tailscale serve ──▶ app container (127.0.0.1:PORT)
iPhone Calendar (webcal) ─┘                                                    │
                                                                               ├─ Fastify API + static web app
                                                                               ├─ SQLite (data volume)
                                                                               └─ nightly refresh job ─▶ City ArcGIS / Socrata / Nominatim
```

- **One container**: a Node.js (LTS) + TypeScript server that serves the API and the built web app.
- **Web app:** TypeScript + Vite + Leaflet. It is a PWA (manifest plus a service worker that caches the app shell only) and is mobile-first.
- **Storage:** SQLite (`better-sqlite3`) on a persistent volume. City data is mirrored into SQLite and loaded into memory at startup and after each refresh. The datasets are small (thousands of features), so spatial queries are done in memory with `@turf/turf`, using a bounding-box prefilter. No PostGIS or SpatiaLite.
- **Refresh job (in-process scheduler):**
  - **Nightly** (03:30 America/Chicago, and on startup if older than 24h): pay blocks, pay boxes, sweeping, permit zones, CDOT permits, special events, snow routes, CBD.
  - **Every 30 min:** vehicle check (towed and relocated, queried only for saved plates; not mirrored) and 311 within the watched-place radii (last 30 days).
  - **Every 15 min:** NWS alerts for home places. **Every 3h:** NWS snowfall forecast for home places.
  - **On demand:** snowplow positions (cached 2 min).
- The implementer may substitute an equivalent stack if homelab defaults prescribe one. The behavior in this spec is what matters.

### Units (each independently testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `sources/*` | One fetcher per source: paging, `outSR=4326`, date filters; returns normalized records | HTTP only |
| `store` | SQLite schema, migrations, read/write of mirrored data and user data | SQLite |
| `refresh` | Orchestrates fetchers; if a source fails, keeps the last good copy; records `dataset_status` | sources, store |
| `geo` | Distance, buffer, point-in-polygon, bbox index | turf |
| `sweeping` | Address → candidate zones; zone → dates; `isSweepingOn(zone, date)` | geo, store |
| `rates` | Point → rate tier → `{tier, hourly, hours}` from config polygons | geo, config |
| `permitZones` | Nearby parcels + permit address ranges → permit-only block faces | sources (parcels), store |
| `parking` | Builds the destination result: blocks, boxes and flags | geo, rates, sweeping, permitZones, store |
| `watch` | Items near a watched place within a time window | geo, store |
| `ics` | Generates the RFC 5545 calendar feed | sweeping |
| `vehicles` | Plate normalization; tow and relocation lookup; dedupe | sources, store |
| `utilityTag` | Classifies a permit as ComEd / Peoples Gas / Water / Telecom / Other | config |
| `winter` | Snow-route membership, NWS alerts, snowfall forecast, possible-snow-ban rule, plow positions | geo, sources |
| `notify` | Decides what to send, dedupes, quiet hours, posts to ntfy | store, ntfy |
| `auth` | Resolves the request user from Tailscale identity headers | store |
| `api` | Fastify routes | all of the above |
| `web` | UI | api |

## 4. Core logic

### 4.1 Sweeping-zone resolution (home streets)

Chicago sweeping-zone boundaries often run down the middle of a street, so the two sides of one street can be in different zones. Therefore:

1. Geocode the home address to a point.
2. Find every zone polygon within **40 m** of the point (point-in-polygon plus a buffered intersect).
3. If there is one zone, assign it automatically. If there are several, show them to the user (`Ward 32 Sec 4 — next sweep Oct 14`, …) and let them pick one or more. Store the confirmed list of `ward_section` values on the place.
4. Dates come from `u5ai-3efk`: each row `(ward_section, month_number, dates)` expands to a list of dates in the current year.

The season runs April through November. Outside the season, show "Sweeping season over — resumes April". If the next year's datasets aren't loaded, say so.

### 4.2 Calendar feed

- `GET /cal/<token>.ics`, where the token is a per-user random value of at least 128 bits. The feed contains every sweeping date for all of the user's home places.
- Each event: `SUMMARY: "Street cleaning — <place label> (Ward W Sec S)"`, 09:00–14:00 America/Chicago (the typical posted window; the description says "check posted orange signs"), with a stable `UID` (`<ward_section>-<date>@chicago-tracker`) and two `VALARM`s: 19:00 the day before and 07:00 the same day.
- Include a `VTIMEZONE` for America/Chicago. Set `REFRESH-INTERVAL;VALUE=DURATION:PT12H` and `X-PUBLISHED-TTL:PT12H`.
- The settings page shows the `webcal://` link with a copy button and a "Regenerate link" action, which rotates the token.
- iPhone Calendar only refreshes the feed while Tailscale is connected. This is acceptable, because the whole season is delivered in one fetch.

### 4.3 Permit-only zones near a destination

`u9xt-hiju` holds address ranges, not shapes. For a destination with radius R:

1. Query Parcel Addresses (layer 1) for parcels intersecting a circle of radius R (spatial query, `outSR=4326`, paged).
2. For each parcel, match `ACTIVE` permit rows where the direction, street name and type match, `address_range_low ≤ address ≤ address_range_high`, and the parity matches `odd_even` (`O`/`E`/`B`).
3. Group the matched parcels by `(zone, street, side)` and return each group as a LineString through the parcel centroids sorted by address number, labeled `Permit zone <zone> — residents only`.
4. Cache results per destination for 24 hours.

### 4.4 Rate tier

Point-in-polygon in order: **Loop** (config polygon) → **CBD** (layer 115) → **West Loop** (config polygon) → **Neighborhood**. Return `{tier, hourly, hoursText, approximate: true}`. Rates and polygons live in `config/rates.json`, not in code. The UI always shows rates as `≈ $2.50/hr`.

Optional: if `PAY_ZONE` turns out to map cleanly to tiers (check by sampling), the implementer may use it instead and document the finding.

### 4.5 Parking result for a destination

`GET /api/parking?lat&lon&radius=400&at=<ISO, default now>` (radius 100–1500 m) returns:

- `blocks[]`: metered block faces within the radius, each with: geometry, street and range, `side`, `numSpaces`, `hourLimit` (falls back to the matching pay box via the same `PAY_AREA` and an overlapping street range, else the nearest box within 60 m), `payArea`, `rate`, `distanceM` (from the destination to the nearest point on the block), and `flags[]`.
- `boxes[]`: pay-box points within the radius.
- `permitZones[]`: from §4.3.
- `closures[]`: closure, block-party and filming permits active at `at` within the radius.
- `events[]`: special events on the date of `at` within the radius.
- `dataAsOf`: `{source: timestamp}`.

Block `flags` (each with a human-readable reason):

| Flag | Rule | Severity |
|---|---|---|
| `SWEEPING` | The block's midpoint is in a zone sweeping on `at`'s date, and `at` is before 14:00 | red |
| `CLOSED` | A street-closure permit active at `at` is within 30 m of the block | red |
| `METERS_BAGGED` | A permit with `parkingmeterpostingorbagging = 'Y'` active at `at` is within 30 m | red |
| `EVENT_NEARBY` | A special event or block party on that date is within 150 m | amber |
| `SNOW_ROUTE` | The block is on a main snow route (informational, Dec–Mar) | amber |
| `SUNDAY` | `at` is a Sunday: "possibly free / check sign" until `SUNDAY_HOURS` is verified | info |

Blocks are sorted by severity, then by distance.

### 4.6 Watched addresses

`GET /api/watch/:placeId?days=14` returns every permit (all four CDOT datasets, deduplicated by `uniquekey`) and special event within the place's radius (default 300 m, adjustable 100–1000 m) whose date range overlaps `[today, today + days]`. Each item includes its type, dates, location text, description (`detail`/`comments`/`event_details`), distance, and source with its data-as-of time. Each permit also carries a `utility` tag (§4.8). Home places also show their next sweeping dates.

The same response includes `requests311[]`: 311 requests within the radius created in the last 30 days, with `duplicate != true`, excluding the types listed in `config/311.json` (default: `311 INFORMATION ONLY CALL`). Each request shows its type, status, created and closed dates, address and distance, grouped by type with counts.

### 4.7 Vehicle check (towed / relocated)

- A user may save up to 3 plates (`plate`, `state`, optional nickname). Plates are normalized to uppercase with spaces and dashes removed.
- Every 30 min, query `ygr5-vcbg` and `5k2z-suxx` with `$where=plate='<P>' AND state='<S>'` over the last 14 days. Never mirror the whole datasets.
- A **towed** match shows tow date, tow lot address and phone, inventory number, and a Navigate button to the lot. A **relocated** match shows the date, reason, from address and to address, with Navigate to the "to" address (geocoded).
- Home shows a vehicle card: "✅ Not in tow or relocation records (checked 10:30)" or a red card with the details. The card notes that city records lag reality by hours, and links to the city's tow-search page as a backup.
- Each new match (keyed by `inventory_number` or `service_request_number`) produces one push (§4.10).
- Plates are personal data: never log them, and delete them with the user.

### 4.8 Utility tagging

Classify each permit by `primarycontactlast`/`applicationname`, using case-insensitive patterns from `config/utilities.json`:

| Tag | Patterns (initial) |
|---|---|
| ⚡ ComEd | `COMED`, `COMMONWEALTH EDISON` |
| 🔥 Peoples Gas | `PEOPLES GAS` |
| 💧 Water | `DWM`, `WATER MANAGEMENT` |
| 📡 Telecom | `AT&T`, `SBC`, `VERIZON`, `COMCAST`, `CROWN CASTLE`, `T-MOBILE` |
| (none) | anything else (contractor, private) |

`worktypedescription` and `comments` are shown alongside. Watched lists can be filtered by tag. Home has a static "ComEd outage map" link to ComEd's public outage page (the implementer confirms the current URL and puts it in config) with no scraping.

### 4.9 Snow and weather

- **Snow-route membership:** a home place is on a snow route if any Main Snow Route line is within 25 m of the point. This is shown on the Home card (Dec–Mar).
- **NWS alerts:** active alerts for each home point. Show any alert on Home. Push (§4.10) for events matching `Winter Storm Warning|Winter Storm Watch|Blizzard Warning|Winter Weather Advisory|Ice Storm Warning|Extreme Cold Warning|Wind Chill Warning`.
- **Possible 2-inch snow ban:** the city has no API for declared bans. Rule: if the home is on a snow route and the NWS gridpoint `snowfallAmount` summed over the next 24h is **≥ 2 in (5.08 cm)**, flag "Possible 2-inch snow ban — your street is a snow route" and push once per storm (a day with no new alert resets it). This is labeled as a forecast, not an official ban.
- **Snowplows:** on the Park map from Dec through Mar, a toggle shows layer 38 positions with `POSTING_TIME` in the last 2 hours, labeled with asset type and minutes since the last update.
- `SNOW_ROUTE` block flag (§4.5) is unchanged.

### 4.10 Push notifications (ntfy)

- Per user: `ntfyTopic` (random by default; the user may set one) and an enable toggle for each category. The settings page shows the topic and how to subscribe in the ntfy iPhone app.
- Server credentials (`NTFY_URL`, `NTFY_TOKEN`) are homelab secrets. Topics are only reachable on the tailnet or protected by an ntfy access token, following homelab defaults.

| Category | When | Priority | Default |
|---|---|---|---|
| Vehicle towed / relocated | New match found | urgent (5) | on |
| Sweeping tomorrow | 19:00 the day before a home zone's date | default (3) | on |
| Winter alert | New NWS alert matching §4.9 | high (4) | on |
| Possible snow ban | §4.9 rule triggers | high (4) | on |
| New work near home | A new permit with a `utility` tag or a full closure within a home radius (daily digest at 18:00) | low (2) | on |

- **Dedupe:** table `notifications_sent(user_id, key, sent_at)`. The key is the category plus a stable source id. Never send the same key twice.
- **Quiet hours:** 22:00–07:00 by default. Anything below urgent is held until 07:00.
- **ntfy failure:** retry 3 times with backoff, then log it and show "Push delivery failing" on Home. Push failure never blocks anything else.
- Each push sets a `Click` URL that opens the relevant screen in the app (tailnet URL).

## 5. API

All `/api/*` routes require a resolved user (§6). JSON in and out.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Current user, cal link, settings |
| PATCH | `/api/me` | Settings (preferred nav app: `apple` (default), `google`, `waze`) |
| GET | `/api/places` | List places |
| POST | `/api/places` | Create `{kind: 'home' \| 'watch', label, address}` → geocodes; for a home, returns candidate zones |
| PATCH | `/api/places/:id` | Update label, radius, confirmed zones |
| DELETE | `/api/places/:id` | Remove a place |
| GET | `/api/places/:id/sweeping` | Upcoming sweep dates |
| GET | `/api/geocode?q=` | Address search (Chicago-bounded, cached) |
| GET | `/api/parking` | §4.5 |
| GET | `/api/watch/:placeId` | §4.6 |
| POST | `/api/me/cal-token` | Rotate the calendar token |
| GET/POST/DELETE | `/api/vehicles[/:id]` | Saved plates (max 3) |
| GET | `/api/vehicles/status` | Latest tow and relocation result per plate and when it was checked |
| GET | `/api/winter` | Snow-route membership, active NWS alerts, possible-ban flag for each home place |
| GET | `/api/plows?bbox=` | Live plow positions (posted in the last 2h) |
| GET/PATCH | `/api/me/notifications` | ntfy topic, per-category toggles, quiet hours |
| POST | `/api/me/notifications/test` | Send a test push |
| GET | `/api/status` | Dataset freshness, last refresh errors |
| POST | `/api/admin/refresh` | Trigger a refresh (owner only) |
| GET | `/cal/:token.ics` | §4.2 (token auth, no identity header needed) |
| GET | `/healthz` | Liveness and readiness, for homelab monitoring |

Users may only read and modify their own places (enforced in `store` queries by `user_id`).

## 6. Identity and multi-user

- The app binds to **127.0.0.1 only** and is published to the tailnet with `tailscale serve` (HTTPS on the node's `*.ts.net` name). `tailscale serve` adds `Tailscale-User-Login` and `Tailscale-User-Name` headers to requests from tailnet users.
- Because only the local serve proxy can reach the app, those headers can be trusted. **If the homelab uses a different proxy, it must strip any client-supplied `Tailscale-User-*` headers and set them itself.** Otherwise, run in single-user mode (below).
- On the first request from a new login, create a user row. `OWNER_LOGIN` (config) marks the owner, who has admin rights.
- `ALLOWED_LOGINS` (config, comma-separated) restricts who may use the app. Anyone else gets 403. Adding the brother means: share the node or add him to the tailnet, then add his login here.
- **Single-user fallback:** if identity headers are unavailable (e.g. requests from tagged devices), `SINGLE_USER_LOGIN` maps every request to that user.
- The implementer must confirm whether shared-in users (node sharing) receive the identity headers, and document the result.

## 7. UI (mobile-first, also works on desktop)

Three tabs (a bottom bar on phone, a sidebar on desktop):

1. **Home:** cards, top to bottom:
   - **Vehicle status:** red if towed or relocated.
   - **Winter card** (Dec–Mar, or whenever an alert is active): NWS alerts, snow-route status for home streets, possible-ban flag.
   - **One card per home street:** zone, next sweep date with a countdown, the next 3 dates.
   - **One card per watched place:** count of active items with utility-tag chips and a 311 count, tapping through to the list.
   - **Footer:** a "ComEd outage map" link.
   - **Banners:** shown if a dataset is stale (more than 48h), a refresh failed, or push delivery is failing.
2. **Park:** a search box with geocode suggestions, plus a "Use my location" button. The map shows the destination pin and radius circle.
   - **Metered blocks** are drawn as thick lines: green when there are no flags, amber for warnings, red for blocks to avoid. **Permit zones** are purple dashed lines. **Closures** are red hatched. Pay boxes appear as small dots at zoom 17 and closer.
   - A "When?" control (Now / pick date & time) re-queries with `at`. A radius control is included.
   - Tapping a block opens a bottom sheet: street and range, side, spaces, hour limit, ≈ rate and hours, **Pay area #NNN** with a copy button, flags with reasons, the distance from the destination, a **Navigate** button, and a **ParkChicago** button (opens https://parkchicago.com or the app; the pay area is copied to the clipboard first).
   - A list view below or beside the map shows the same blocks sorted by severity, then distance.
   - A legend, and "Data as of …" in the footer.
3. **Places & Settings:** add, edit and delete home and watched places. For homes, a zone picker when there are several candidates. Also:
   - Saved plates.
   - Notifications: ntfy topic, subscribe instructions, a toggle per category, quiet hours, and a "Send test" button.
   - The calendar link (copy and regenerate) and the preferred navigation app.
   - Dataset status.

The **Park** map also has a "Snowplows" toggle (Dec–Mar). A watched-place list can be filtered by utility tag, with 311 requests in a collapsible section.

**Navigate deep links** (lat/lon taken from the nearest point on the block to the destination):
- Apple: `https://maps.apple.com/?daddr=<lat>,<lon>&dirflg=d`
- Google: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=driving`
- Waze: `https://waze.com/ul?ll=<lat>,<lon>&navigate=yes`

**PWA:** includes `manifest.webmanifest`, icons, `display: standalone` and a theme color, so it can be added to the iPhone home screen. Legible in both light and dark mode. Tap targets are at least 44 px.

## 8. Configuration

Use environment variables plus `config/*.json`, and follow the homelab's secrets convention.

| Key | Meaning |
|---|---|
| `PORT` | Listen port (bound to 127.0.0.1) |
| `DATA_DIR` | SQLite and cache location (persistent volume) |
| `OWNER_LOGIN`, `ALLOWED_LOGINS`, `SINGLE_USER_LOGIN` | §6 |
| `PUBLIC_BASE_URL` | e.g. `https://chicago.<tailnet>.ts.net`, used to build the webcal link |
| `NOMINATIM_CONTACT` | Contact for the Nominatim User-Agent (secret or config; not in the repo) |
| `SOCRATA_APP_TOKEN` | Optional secret |
| `REFRESH_CRON` | Default `30 3 * * *` America/Chicago |
| `config/datasets.json` | All dataset IDs and layer IDs (so 2027 sweeping IDs are a config change) |
| `config/rates.json` | Tier polygons, rates and hours |
| `config/utilities.json` | Utility tag patterns (§4.8) and the ComEd outage URL |
| `config/311.json` | Excluded 311 types |
| `NTFY_URL`, `NTFY_TOKEN` | ntfy server and access token (secret) |
| `NWS_USER_AGENT` | e.g. `chicago-tracker (<contact>)` (contact from config, not the repo) |

## 9. Deployment and security (homelab)

**Follow the homelab's default security baseline wherever it applies.** It takes precedence over anything below that conflicts with it. Minimum requirements:

- **Tailnet only.** Do not publish a host port on the LAN or WAN. **Never enable Tailscale Funnel.** Expose the app only through `tailscale serve` (or the homelab's tailnet-only proxy, following §6's header rules).
- The container runs as non-root with a read-only root filesystem. Only `DATA_DIR` is writable. Drop all capabilities and set `no-new-privileges`.
- Pin dependency versions with a lockfile and use a pinned base image digest. Follow the homelab's image update and vulnerability-scanning defaults.
- Secrets come from the homelab secret store or env file, never from the repo.
- Outbound network access, if the homelab can restrict egress: `gisapps.cityofchicago.org`, `data.cityofchicago.org`, `nominatim.openstreetmap.org`, `api.weather.gov`, plus the ntfy server. Tiles are fetched by the browser, not the server.
- If ntfy has to be deployed: tailnet-only, auth required (deny-all default, one access token per topic), following homelab defaults. If the homelab already runs ntfy, reuse it. Note: for the iPhone ntfy app to deliver while the app is backgrounded, a self-hosted ntfy needs `upstream-base-url: https://ntfy.sh`. This relays only a message-ID poll request to ntfy.sh, not the message content. The implementer must confirm this is acceptable under homelab defaults and document the choice.
- Include `DATA_DIR` in the homelab backup schedule. The user data is small and the city data can be re-fetched.
- Logs go to stdout in the homelab's format. Do not log full addresses at info level.
- Include `/healthz` in the homelab's monitoring.
- Security headers: a CSP that allows only self and the tile host; `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, and `frame-ancestors 'none'`.

## 10. Error handling

- **A source fetch fails:** keep the previous data, record the error in `dataset_status`, show a stale banner, and retry on the next schedule. A failure in one source never blocks the others.
- **A source returns 0 rows or less than 50% of the previous count:** treat it as a failure (guards against partial or broken responses) and keep the previous copy.
- **Geocoding finds nothing or Nominatim is rate-limited:** try the Parcel Addresses fallback, then show "Couldn't find that address".
- **Parcel query fails (permit zones):** return the parking result without permit zones and add a warning to the response. The map shows "Permit-zone info unavailable".
- **Vehicle check or NWS query fails:** the card shows "Last checked <time> — check failed". Never show a green "not towed" result from a failed check.
- **No sweeping data for the current year:** the Home card and the calendar say so explicitly. Never show stale dates from a previous year as current.

## 11. Testing

- **Unit tests (Vitest):** sweeping-date expansion and zone resolution, including a boundary-street fixture with two zones; rate tier lookup; permit address-range and parity matching; block flag rules (each flag); permit date-window filter (stale `Open` rows are excluded); ICS output (validate structure, UIDs, alarms and timezone); auth header resolution, allow-list and single-user mode; deep-link builders; plate normalization and tow/relocation result mapping; utility tag classification; snow-route membership and the possible-ban rule (thresholds at 1.9, 2.0 and 2.1 in); notification dedupe, quiet hours (urgent bypasses them) and the ntfy request shape (mock server); 311 type exclusion and duplicate filtering.
- **Fixtures:** small real snapshots captured from each source (a West Loop area with meters, a residential area with permit zones, and one ward section) stored under `test/fixtures/`. Tests never call the live city APIs.
- **API integration tests:** Fastify `inject` with fixtures loaded into a temporary SQLite database. Includes cross-user isolation (user A cannot read user B's places).
- **Contract check (manual or CI-optional):** a script that hits each live source and asserts the expected fields still exist, so schema drift is caught early.
- **Post-deploy smoke test:** run from a tailnet device. `/healthz` returns OK; `/api/status` shows every dataset loaded; `/api/parking` near `41.8845,-87.6470` (West Loop) returns more than 0 blocks; the `.ics` feed parses; and a request from a non-tailnet path is not reachable.

## 12. Acceptance criteria

1. The owner adds two home addresses, confirms their zones, subscribes to the webcal link on an iPhone, and sees the 2026 sweeping dates with alerts at 7pm the day before and 7am the day of.
2. Searching a West Loop address shows metered blocks within 400 m with spaces, hour limit, ≈ rate and pay area, and Navigate opens Apple Maps with directions to that block.
3. Blocks with active closures, bagged meters or sweeping that day are flagged red with a reason. Residential permit zones nearby are shown.
4. A watched address lists the CDOT permits and events within its radius for the next 14 days.
5. The app is unreachable from outside the tailnet; the container follows the homelab security baseline; a second Tailscale user gets a separate, empty profile.
6. If a city source is down during refresh, the app keeps working on the last data and shows its age.
7. With a saved plate, a towed or relocated record appearing in the city data produces exactly one urgent ntfy push on the owner's iPhone, and the Home card shows where the car is.
8. A watched address shows CDOT permits tagged ComEd / Peoples Gas / Water / Telecom where they apply, plus 311 requests from the last 30 days.
9. In winter, Home shows NWS winter alerts and snow-route status for home streets. The possible-snow-ban push fires when the forecast reaches 2 inches or more for a snow-route home. The Park map can show live plows.
10. "Send test" on the settings page delivers a push to the iPhone ntfy app.

## 13. Future ideas (not in scope)

- Adding watched-address items to the calendar feed.
- Winter Overnight Parking Ban streets (Dec 1 – Apr 1, 3–7am) once a geometry source is confirmed.
- Garbage and recycling pickup day (city layers 127 and 76).
- Official snow-ban declarations, if the city ever publishes them as data.
- Garage price comparison.
