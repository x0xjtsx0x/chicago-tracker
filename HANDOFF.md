# Chicago Tracker: handoff for the homelab agent

This is a personal, tailnet-only web app for Chicago parking: street-sweeping calendar, a metered street-parking map, street work and 311 near watched addresses, a tow/relocation check, winter alerts, and ntfy push.

## Read in this order

1. **Spec:** `docs/superpowers/specs/2026-10-11-chicago-tracker-design.md`. What to build and why. Every data source in it was verified live on 2026-10-11.
2. **Plan:** `docs/superpowers/plans/2026-10-11-chicago-tracker.md`. 25 test-driven tasks with code, commands and expected output. Execute them in order. Each task ends with a commit.

## Non-negotiables

- **Follow the homelab's default security baseline.** Where it conflicts with the plan, the homelab default wins. Note the deviation in `deploy/HOMELAB.md`.
- **Tailnet only.** Reachable exclusively through Tailscale (`tailscale serve` or the homelab's tailnet-only proxy). No LAN/WAN port. **Never enable Tailscale Funnel.**
- Run as non-root, with a read-only root filesystem (only `/data` writable), all capabilities dropped and `no-new-privileges`. Secrets live outside git. `/data` is backed up and `/healthz` is monitored.
- Never log license plates or full addresses.

## Things only you can confirm (the plan has a step for each)

| Item | Where |
|---|---|
| Meaning of `SUNDAY_HOURS` on metered blocks | Plan Task 24, Step 2 |
| Which snow-route source matches the city's 2-inch ban streets | Plan Task 24, Step 2 |
| `streetclosure` values → final `closureRedPattern` | Plan Task 24, Step 2 |
| ComEd outage-map URL still valid | Plan Task 24, Step 2 |
| Whether node-shared users get `Tailscale-User-*` headers | Plan Task 25, Step 5 |
| ntfy instance, and whether `upstream-base-url` (iOS background delivery) is acceptable | Plan Task 25, Step 6 |
| Base-image digest pin | Plan Task 25, Step 1 |

## Done means

All of `npx vitest run` passes. `scripts/smoke.ts` is all ✓ from a tailnet device. The app is unreachable off-tailnet. The iPhone acceptance pass in Plan Task 25 Step 5 succeeds. `deploy/HOMELAB.md` is written with real values.
