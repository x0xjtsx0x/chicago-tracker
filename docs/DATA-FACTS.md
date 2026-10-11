# Data facts (decided 2026-10-11)

The spec (§2.1) and the plan (Task 24) left four facts for the deployer to establish against the
live sources. They were checked on 2026-10-11 with the public APIs (no key) and the official
pages. Each entry records the evidence, the decision, and the confidence. Re-check if a dataset
changes ID or a row count moves a long way.

## 1. `SUNDAY_HOURS` on metered blocks (ArcGIS layer 58)

**Decision:** `Y` = meters are enforced on Sundays (pay as posted); `N` = free on Sundays.
`config/datasets.json` has `sundayHoursVerified: true`. The SUNDAY block flag now says
"meters enforced on this block" for `Y` and "free on this block per city data — check the posted
sign" for `N`.

**Evidence**

- Distribution by pay zone (layer 58, `groupByFieldsForStatistics=PAY_ZONE,SUNDAY_HOURS`):

  | PAY_ZONE | extent (rough) | N | Y |
  |---|---|---|---|
  | 5 | the Loop (-87.637…-87.617, 41.876…41.888) | 0 | 141 |
  | 4 | CBD + West Loop (-87.666…-87.615, 41.867…41.911) | 48 | 677 |
  | 2 | Near North / Lincoln Park / Lakeview | 317 | 155 |
  | 1 | North and Northwest side | 1353 | 83 |
  | 3 | West side | 364 | 81 |
  | 7 | Near South / Bridgeport | 199 | 44 |
  | 6 | South side | 690 | 0 |
  | 8 | scattered | 11 | 3 |

- The documented policy (2013 meter-deal amendment, reported by NBC Chicago, CBS Chicago,
  Streetsblog Chicago, DNAinfo): free Sunday parking in the neighbourhoods, **not** in the Central
  Business District, and five areas whose aldermen opted out to keep paid Sundays on their retail
  strips: Lakeview, Lincoln Park, Portage Park, Wicker Park and Bucktown (10 am–8 pm). ParkChicago's
  rates page says the neighbourhood tier has "free in some spaces" on Sundays.
- Street-level sample of `Y` blocks outside downtown (zone 1): N Halsted 3700s and N Broadway
  3500–3900s (Lakeview), N Milwaukee 1600–2300s and N Damen 1700s (Wicker Park / Bucktown),
  N Winthrop 4900s (Uptown). These are exactly the opt-out retail strips.
- Street-level sample of `N` blocks in zone 4: W Madison 800–1300s, S Desplaines, S Jefferson —
  the West Loop, west of Halsted, which is outside the CBD where free Sundays apply.
- The Loop (zone 5) is 100 % `Y`; the South side (zone 6), where no ward opted out, is 100 % `N`.

**Confidence:** high. The field name, the city-wide distribution and the street-level pattern all
match the published rule. Not confirmed by reading a pop-up on https://map.chicagometers.com/: that
site is an Inertia/CARTO single-page app whose `?terminal=<id>` responses carry no meter data for a
non-browser client, so the official map could not be read programmatically. If a deployer wants the
belt-and-braces check, open the map at a `Y` block (e.g. N Milwaukee Ave 1800s, terminal 716114)
and an `N` block (W Madison St 1200s, terminal 258314) and compare the Sunday hours shown.

## 2. `streetclosure` values → `closureRedPattern`

**Values on 2026-10-11** (`jdis-5sry`, `$group=streetclosure`): `Curblane` 253,214, `Full` 100,606,
`Sidewalk` 79,202, `Partial` 42,696, `Intermitte` 525. No nulls.

**Decision:** `closureRedPattern = "^(full|curb|partial|intermit)"`. Curb-lane, full, partial and
intermittent closures all take the parking lane or the street; a sidewalk closure never does, so
`Sidewalk` is the only value that must not match, and the `sidewalk-only closures do not flag red`
test still passes. Previously `Intermitte` was not matched (the old pattern was
`full|curb|lane|partial|street`).

**Confidence:** high (the value set is small and the semantics are plain).

## 3. Snow-route source for the 2-inch ban

**Candidates**

| Source | What it is | Rows | Total length | Verdict |
|---|---|---|---|---|
| ArcGIS layer 50 "Main Snow Routes" (`SNOW_RTE` 101…) | plow-route network | 290 | **1,815 mi** (sum of `SHAPE.LEN` 9,591,290 ft; haversine over the 4326 geometry agrees) | too large: the plowing routes, not the ban |
| Socrata `nnn9-yqby` "Snow Route Parking Restrictions - Map" | a *derived map view* | 144 | n/a | every row comes back with empty properties and null geometry through the API; unusable |
| **Socrata `i6k4-giaj` "Snow Route Parking Restrictions"** | the underlying dataset of that map; description: "No parking is allowed on Snow Routes when there is two or more inches on the ground regardless of date or time" | **144** | **609 mi** | **selected** |

The city describes the 2-inch ban as covering about 500 miles of main streets (versus 107 miles for
the separate Winter Overnight Parking Ban, Dec 1 – Apr 1, 3–7 am). `i6k4-giaj` is 609 miles, every
row has `restrict_t = '2 INCH'`, and it is published as the parking-restriction list; layer 50 at
1,815 miles is clearly the wider plowing network. Last updated 2021-12-06, which is fine for a
street list that changes rarely.

**Decision:** `snowRouteSource = "socrata:i6k4-giaj"` (`socrata.snowRoutes` in
`config/datasets.json`). The job mirrors it with `$where=restrict_t = '2 INCH'`, and the UI now says
"on the city's 2-inch snow ban list" rather than "snow route". ArcGIS layer 50 stays in config as the
fallback if `snowRouteSource` is set to anything else.

**Confidence:** high.

## 4. ComEd outage-map URL

`https://www.comed.com/outages` returns HTTP 200 (followed, no redirect) on 2026-10-11. Unchanged in
`config/utilities.json`.

## Also learned while checking (not decisions, but the code depends on them)

- **The city's CDN (Akamai) returns HTTP 403 for any ArcGIS query string that pairs a quoted
  literal with `AND`/`OR`** (`PRE_DIR = 'W' AND ST_NAME = 'WILSON'` is treated as SQL injection;
  POST bodies are blocked the same way). `ST_NAME IN ('WILSON') AND PRE_DIR IN ('W')` is accepted.
  The parcel-address geocoder fallback uses the `IN` form for that reason. Socrata
  (`data.cityofchicago.org`) is not affected.
- Date-windowed datasets legitimately return 0 rows: block-party permits had 0 rows for
  Jan–Feb 2026 (340 for the current 60-day window), special events have had no future rows since
  2026-01-08. Those jobs skip the "0 rows / <50 %" guard.
- The Current-and-Future permit dataset (`hr8i-6s6s`) is ~50,700 rows in the 60-day window and
  ~45 columns; the job now asks for the ~20 columns it reads (about half the bytes).
- Filming permits (`c2az-nhru`) have no `uniquekey` column; the other three CDOT permit datasets
  share an identical column list.
