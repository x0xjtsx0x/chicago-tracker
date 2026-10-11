import { api } from '../api.js';
import { clear, h } from '../dom.js';
import { chicagoToday, daysUntil, fmtDate, fmtDistance, isWinterMonth, UTIL_LABEL } from '../format.js';
import { navUrl } from '../../shared/deeplinks.js';
import type { DatasetMeta, NavApp, Place, SweepInfo, Vehicle, VehicleStatus, WatchResult, WinterStatus } from '../../shared/types.js';

interface Me { navApp: NavApp; comedOutageUrl: string; towSearchUrl: string; isOwner: boolean }
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
  for (const v of vehicles) root.append(vehicleCard(v, me));

  // Winter
  const anyAlerts = winter.some((w) => w.alerts.length || w.possibleBan);
  if (isWinterMonth(today) || anyAlerts) {
    for (const w of winter) {
      root.append(h('div', { class: `card ${w.possibleBan || w.alerts.length ? 'amber' : ''}` },
        h('h2', null, `❄️ Winter — ${w.label}`),
        h('p', null, w.onSnowRoute ? 'Your street is on the city’s 2-inch snow ban list.' : 'Not on the city’s 2-inch snow ban list.'),
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

function vehicleCard(v: VehicleRow, me: Me): HTMLElement {
  const nav = me.navApp;
  const lag = () => h('p', { class: 'muted small' }, 'City records can lag by a few hours. ',
    h('a', { href: me.towSearchUrl, target: '_blank', rel: 'noopener' }, 'Search the city tow records'));
  const name = v.nickname || v.plate;
  const s = v.status;
  if (!s) return h('div', { class: 'card' }, h('h2', null, `🚗 ${name}`), h('p', { class: 'muted' }, 'Not checked yet.'));
  if (s.matches.length) {
    return h('div', { class: 'card red' }, h('h2', null, `🚨 ${name}`),
      ...s.matches.map((m) => h('div', null,
        h('p', null, h('strong', null, m.kind === 'towed' ? `Towed ${fmtDate(m.date)}` : `Relocated ${fmtDate(m.date)}`), ` — ${m.details}`),
        h('p', null, m.kind === 'towed' ? `Tow lot: ${m.address}` : `Now at: ${m.address}`, m.phone ? ` · ${m.phone}` : ''),
        h('a', { class: 'btn primary', href: navUrl(nav, `${m.address}, Chicago, IL`), target: '_blank', rel: 'noopener' }, 'Navigate'))),
      lag());
  }
  if (!s.ok) return h('div', { class: 'card amber' }, h('h2', null, `🚗 ${name}`), h('p', null, `Last checked ${s.checkedAt.slice(11, 16)} — check failed.`), lag());
  return h('div', { class: 'card green' }, h('h2', null, `🚗 ${name}`), h('p', null, `✅ Not in tow or relocation records (checked ${s.checkedAt.slice(11, 16)}).`), lag());
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
