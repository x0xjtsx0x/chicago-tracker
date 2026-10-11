// Post-deploy smoke test. Run from a tailnet device: npx tsx scripts/smoke.ts https://chicago.<tailnet>.ts.net
const base = process.argv[2]?.replace(/\/$/, '');
if (!base) { console.error('usage: npx tsx scripts/smoke.ts https://chicago.<tailnet>.ts.net'); process.exit(2); }
const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers });
const j = async (p: string, headers: Record<string, string> = {}) => { const r = await get(p, headers); if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`); return r.json(); };
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) process.exitCode = 1; };

const health = await j('/healthz');
check('healthz ok + ready', health.ok === true && health.ready === true);
const me = await j('/api/me');
check(`identity resolved (${me.login})`, typeof me.login === 'string' && me.login.length > 0);
const forged = await j('/api/me', { 'Tailscale-User-Login': 'attacker@example.com', 'Tailscale-User-Name': 'Attacker' });
check('forged Tailscale-User-* headers do not change identity (single-user mode)', forged.login === me.login);
const status = await j('/api/status');
check(`datasets loaded (${status.datasets.length})`, status.datasets.length >= 11);
check(`no stale datasets (${status.stale.join(',') || 'none'})`, status.stale.filter((n: string) => n !== 'specialEvents').length === 0);
const park = await j('/api/parking?lat=41.8845&lon=-87.6470');
check(`West Loop parking blocks: ${park.blocks.length}`, park.blocks.length > 0);
const calPath = new URL(String(me.calUrl).replace(/^webcal:/, 'https:')).pathname;
const ics = await (await get(calPath)).text();
check('calendar parses', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
const csp = (await get('/')).headers.get('content-security-policy') ?? '';
check('security headers present', csp.includes("frame-ancestors 'none'"));
console.log('\nAlso confirm by hand that the app is NOT reachable off-tailnet (another LAN host, phone with Tailscale off).');
