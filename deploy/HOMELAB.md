# Homelab deployment (generic procedure)

This repository is public, so this file describes the **shape** of the deployment and the
procedures only. The real host names, addresses, IDs and logins live in the operator's private
homelab documentation, never here.

## Shape

- A dedicated, unprivileged LXC container on a Proxmox host runs Docker; the app runs from
  `deploy/compose.yaml` exactly as committed: read-only root filesystem, only `/data` writable,
  `/tmp` as tmpfs, `cap_drop: ALL`, `no-new-privileges`, uid 1000.
- The port is published on the container host's **LAN address only** (`BIND_IP` in
  `deploy/.env`), never `0.0.0.0`.
- Ingress is the homelab's existing tailnet-only reverse proxy on a different host, on a port that
  only the owner's tailnet identity may reach. `:80`/`:443` for the app's hostname return an
  explicit 404 there. No `tailscale serve`, no Tailscale Funnel; the container itself is not on
  the tailnet.
- Single-user mode (`SINGLE_USER_LOGIN` = `OWNER_LOGIN`): the proxy cannot inject
  `Tailscale-User-*` headers, so the app ignores them; the proxy also strips them.
- Defence in depth for the LAN hop: a hypervisor-enforced guest firewall (inbound: the proxy host
  to tcp/8787 only; outbound: house DNS, log shipping and the internet, other private ranges
  dropped), plus a `DOCKER-USER` rule inside the container host with the same inbound allowlist
  (Docker-published ports bypass INPUT). IPv6 is disabled on the container's LAN interface so it
  never acquires a SLAAC address.

## Runtime config (not in git)

`deploy/chicago-tracker.env` (mode 600) and `deploy/.env` (`BIND_IP=...`). Contacts for
Nominatim/NWS use this repository's URL, not a personal address. `NTFY_URL=https://ntfy.sh`, no
token: each user's random topic is the credential.
To rotate `SOCRATA_APP_TOKEN` or `NTFY_TOKEN`: edit the env file, then
`docker compose up -d` (recreates the container with the new environment).

## Update procedure

1. Re-resolve the base image digest and substitute it in **both** `FROM` lines:
   `docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'`
2. `npm ci && npx vitest run && npm run build` on a clean checkout; merge.
3. On the container host: `git pull --ff-only`, then
   `cd deploy && docker compose build && docker compose up -d`.
4. `npx tsx scripts/smoke.ts https://<public-base-url>` from a tailnet device: all ✓.

Note (2026-10): Node 24.19–24.21 abort `node::ObjectWrap` addons during GC
(nodejs/node#65446). better-sqlite3 13 uses N-API and is unaffected; do not downgrade it below 13
while on Node 24.

## Backups and monitoring

- `/data/chicago-tracker.db` (+ `-wal`/`-shm`) is inside the container's root filesystem, so the
  host's nightly guest backup covers it. A portable backup component also takes an online
  `sqlite3 .backup` snapshot plus the env/compose files.
  Restore: stop the container, put the `.db` back (owned by uid 1000), start it.
- `/healthz` is always HTTP 200; readiness is the JSON field `ready`. The monitor is a push
  heartbeat from the proxy host that probes `/healthz` through the proxy and reports up only when
  `ok` and `ready` are both true.
- The first start fills the datasets (1–3 minutes). If a start is interrupted mid-refresh, the
  remaining datasets only refill at the next nightly run or via Settings → Refresh.

## Data facts

See `docs/DATA-FACTS.md` (`SUNDAY_HOURS`, the 2-inch snow-ban source `i6k4-giaj`,
`closureRedPattern = ^(full|curb|partial|intermit)`, the ComEd outage URL).

## Yearly chore

When the city publishes next year's street-sweeping datasets (usually March–April), update the
`sweepSchedule`/`sweepZones` dataset IDs and `sweepingYear` in `config/datasets.json`, rebuild,
deploy, and press Refresh.
