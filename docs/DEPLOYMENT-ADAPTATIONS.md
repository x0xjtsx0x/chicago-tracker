# Deployment adaptations (decided 2026-10-11 — read before Task 1)

The owner settled three choices that the spec left to "homelab defaults".
Where this file and the plan disagree, **this file wins**. This repository is
**public**: never commit secrets, real home addresses, license plates, or
personal email addresses (use `example.com`).

## 1. Ingress: a reverse proxy on another host, single-user mode

The app does **not** use `tailscale serve`. The homelab's tailnet-only reverse
proxy runs on a different machine and reaches the app's container over the LAN.
That proxy cannot inject `Tailscale-User-*` headers, so the deployment runs in
**single-user mode**.

Code requirements:
- When `SINGLE_USER_LOGIN` is set, `auth` **ignores every `Tailscale-User-*`
  header completely**, whatever its value. Every request maps to that user. A
  test must prove that a forged `Tailscale-User-Login: attacker@example.com`
  still resolves to the single user and never creates a second user row.
- Keep the header-based multi-user mode exactly as the plan specifies, because
  a second user may be added later. It is just not the deployed mode.
- The listen address comes from `HOST` (default `127.0.0.1`). Inside the
  container it is `0.0.0.0`.
- `deploy/compose.yaml` publishes the port as `"${BIND_IP:-127.0.0.1}:8787:8787"`.
  The deployer sets `BIND_IP` to the container host's LAN address, and a host
  firewall admits only the proxy.
- Fastify's `trustProxy` stays **off**. Nothing in the app may derive identity or
  authorization from `X-Forwarded-For`.
- Security headers stay as in spec §9 (CSP `frame-ancestors 'none'`). The proxy
  adds its own headers too, which is harmless.

## 2. Push: public ntfy.sh, where the topic is the credential

- `NTFY_URL` defaults to `https://ntfy.sh`. `NTFY_TOKEN` is optional. When it is
  empty, send **no** `Authorization` header.
- Default topics are random with **≥ 128 bits** of entropy (e.g. 26+ base32
  characters, prefixed `ct-`). A user-chosen topic must be at least 24
  characters long. Reject shorter ones with a clear error.
- **Message bodies and titles must never contain a license plate, a vehicle
  nickname, or a home/watched address.** They are delivered through a public
  third party. Say "Your car was towed" plus the **tow lot** address (a public
  facility), "Street cleaning tomorrow — <place label>", and so on. Write a test
  that runs every category through the planner with a plate and a home address
  in the inputs, and asserts that neither appears in the serialized ntfy
  payload.
- `Click` URLs point at `PUBLIC_BASE_URL`. That URL is tailnet-only, so leaking
  it is harmless.
- Map priorities explicitly to ntfy's vocabulary (`min|low|default|high|urgent`).
  Never pass an internal value through.

## 3. Build split

A cloud session builds the code. The homelab agent does everything that touches
real infrastructure.

| Who | What |
|---|---|
| Cloud session | Tasks 1–23 in full. Task 24 Steps 1, 3 and 4 (write the scripts and the fixture test). Run Task 24 Steps 2 and 3 **only if** the city APIs are reachable from the sandbox; if they are, commit the captured fixtures (public city data). Task 25 Steps 1, 2 and 4: write `Dockerfile`, `deploy/compose.yaml`, `deploy/chicago-tracker.env.example` and `scripts/smoke.ts`, with `<DIGEST>` left as a literal placeholder. |
| Homelab agent | Task 24 live steps if the cloud could not run them, plus the "facts to record" (`SUNDAY_HOURS`, snow-route source, `closureRedPattern`, ComEd URL). Task 25 Steps 1 (digest), 3, 5 and 6: the container host, proxy, firewall, backups, monitoring and `deploy/HOMELAB.md`. |

- If fixtures have not been captured yet, `test/fixtures.test.ts` must
  **skip** (e.g. `describe.skipIf(!existsSync('test/fixtures/payBlocks.westloop.json'))`)
  instead of failing, so `npx vitest run` is green in both states.
- Use whatever Node LTS the sandbox has (22 or 24). Set `engines.node` to
  `>=22`. The container pins Node 24.
- Done for the cloud session: `npm ci && npx vitest run && npm run build` all
  pass on a clean checkout, with one commit per plan task, pushed to a branch
  with a PR opened against `main`.
