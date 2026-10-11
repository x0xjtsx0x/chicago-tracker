import { api } from '../api.js';
import { clear, h, icon } from '../dom.js';
import { chicagoToday, countdownText, DATASET_LABEL, daysUntil, fmtAgo, fmtDate, fmtDistance, fmtShortDate, isWinterMonth, plural, UTIL_LABEL } from '../format.js';
import { banner, btn, card, emptyState, linkBtn, pill, sectionTitle, skeleton } from '../ui.js';
import { vehicleCard } from '../components/vehicle.js';
import { onboardingDismissed } from './onboarding.js';
import type { Place, SweepInfo, WatchResult, WinterStatus } from '../../shared/types.js';
import type { Me, Status, VehicleRow } from '../types.js';

export async function renderHome(root: HTMLElement): Promise<void> {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Today')), skeleton(2), skeleton(3), skeleton(2));
  const [me, places, vehicles, winter, status] = await Promise.all([
    api<Me>('/api/me'), api<Place[]>('/api/places'), api<VehicleRow[]>('/api/vehicles/status'),
    api<WinterStatus[]>('/api/winter'), api<Status>('/api/status'),
  ]);
  if (!places.length && !vehicles.length && !onboardingDismissed()) { location.hash = '#/welcome'; return; }

  const homes = places.filter((p) => p.kind === 'home'), watches = places.filter((p) => p.kind === 'watch');
  const [sweeps, watchRes] = await Promise.all([
    Promise.all(homes.map((p) => api<SweepInfo>(`/api/places/${p.id}/sweeping`).catch(() => null))),
    Promise.all(watches.map((p) => api<WatchResult>(`/api/watch/${p.id}`).catch(() => null))),
  ]);
  const today = chicagoToday();
  clear(root);
  root.append(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Today'), h('p', { class: 'muted' }, fmtDate(today)))));

  // Problems first: anything that means the rest of the page may be wrong.
  const errored = status.datasets.filter((d) => d.status === 'error');
  if (status.pushFailing) root.append(banner(`Push notifications are failing: ${status.pushFailing}`, 'bad'));
  if (status.stale.length) root.append(banner(`City data is more than 2 days old for ${status.stale.map((n) => DATASET_LABEL[n] ?? n).join(', ')}. Showing the last good copy.`, 'warn'));
  if (errored.length) root.append(banner(`The last refresh failed for ${errored.map((d) => DATASET_LABEL[d.name] ?? d.name).join(', ')}.`, 'warn'));

  // 1. The car — the thing that hurts most if missed.
  root.append(sectionTitle('Your car', vehicles.length ? null : h('a', { class: 'small', href: '#/settings?add=vehicle' }, 'Add a car')));
  if (!vehicles.length) {
    root.append(card(null, emptyState('No car saved', 'Save your plate to get a push if the city tows or relocates it.', h('a', { class: 'btn btn-primary', href: '#/settings?add=vehicle' }, icon('plus', 18), h('span', null, 'Add a car')), 'car')));
  }
  for (const v of vehicles) root.append(vehicleCard(v, me, { compact: true }));

  // 2. Winter, when it matters.
  const anyWinter = winter.some((w) => w.alerts.length || w.possibleBan);
  if (isWinterMonth(today) || anyWinter) {
    root.append(sectionTitle('Winter'));
    for (const w of winter) {
      const tone = w.possibleBan || w.alerts.length ? 'warn' : 'ok';
      root.append(card({ class: `tone-${tone}` },
        h('div', { class: 'card-head' }, icon('snow', 20), h('h3', null, w.label),
          w.onSnowRoute ? pill('2-inch ban street', 'warn') : pill('Not a ban street', 'ok')),
        w.possibleBan ? h('p', null, h('strong', null, `Possible 2-inch snow ban: about ${w.snowNext24hIn} in. forecast in the next 24 h.`), ' This is a forecast, not an official ban.') : null,
        ...w.alerts.map((a) => h('p', null, h('strong', null, a.event), ` — ${a.headline}`)),
        !w.possibleBan && !w.alerts.length ? h('p', { class: 'muted' }, 'No winter alerts.') : null,
        h('p', { class: 'small muted' }, w.error ? `Last weather check failed (${fmtAgo(w.checkedAt)})` : `Weather checked ${fmtAgo(w.checkedAt)}`)));
    }
  }

  // 3. Street cleaning.
  root.append(sectionTitle('Street cleaning', homes.length ? null : h('a', { class: 'small', href: '#/settings?add=home' }, 'Add home street')));
  if (!homes.length) root.append(card(null, emptyState('No home street', 'Add where you park overnight to get sweeping dates, a calendar and reminders.', h('a', { class: 'btn btn-primary', href: '#/settings?add=home' }, icon('plus', 18), h('span', null, 'Add home street')), 'broom')));
  homes.forEach((p, i) => root.append(sweepCard(p, sweeps[i], today)));

  // 4. Watched places.
  if (watches.length) {
    root.append(sectionTitle('Watched places'));
    watches.forEach((p, i) => root.append(watchCard(p, watchRes[i])));
  }

  root.append(h('footer', { class: 'page-foot' },
    h('a', { href: me.comedOutageUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('bolt', 16), ' ComEd outage map'),
    h('span', { class: 'muted' }, `City data refreshed ${fmtShortDate(status.datasets.map((d) => d.fetchedAt ?? '').sort().pop())}`)));
}

function sweepCard(p: Place, s: SweepInfo | null, today: string): HTMLElement {
  const head = (extra?: Node | null) => h('div', { class: 'card-head' }, icon('broom', 20), h('h3', null, p.label), extra ?? null);
  if (!s) return card({ class: 'tone-warn' }, head(), h('p', null, 'Couldn’t load the schedule.'));
  if (!p.zones.length) {
    return card({ class: 'tone-warn' }, head(pill('Zone not set', 'warn')),
      h('p', null, 'Pick the sweeping zone for your side of the street so the dates are right.'),
      h('a', { class: 'btn btn-secondary', href: `#/settings?zones=${p.id}` }, icon('pin', 18), h('span', null, 'Choose zone on map')));
  }
  const zones = h('span', { class: 'small muted' }, p.zones.map((z) => `Ward ${Number(z.slice(0, 2))} · Sec ${Number(z.slice(2))}`).join(', '));
  if (s.status === 'nodata') return card(null, head(), h('p', null, 'No sweeping schedule is loaded for this year yet.'), zones);
  if (s.status === 'over') return card(null, head(), h('p', null, 'Sweeping season is over — it resumes in April.'), zones);
  const next = s.upcoming[0];
  const d = daysUntil(today, next.date);
  const tone = d <= 1 ? 'bad' : d <= 3 ? 'warn' : 'ok';
  return card({ class: `tone-${tone}` }, head(),
    h('div', { class: 'countdown' }, h('span', { class: 'countdown-big' }, countdownText(d)), h('span', null, `${fmtDate(next.date)} · 9 am – 2 pm`)),
    d <= 1 ? h('p', null, h('strong', null, d === 0 ? 'Move your car off this side today.' : 'Move your car tonight.'), ' Check the orange signs on your block.') : null,
    s.upcoming.length > 1 ? h('div', { class: 'chips' }, h('span', { class: 'small muted' }, 'Then'), ...s.upcoming.slice(1, 4).map((u) => h('span', { class: 'chip chip-static' }, fmtDate(u.date)))) : null,
    zones);
}

function watchCard(p: Place, r: WatchResult | null): HTMLElement {
  if (!r) return card({ class: 'tone-warn' }, h('div', { class: 'card-head' }, icon('pin', 20), h('h3', null, p.label)), h('p', null, 'Couldn’t load activity.'));
  const tags = [...new Set(r.items.map((i) => i.utility).filter((u): u is NonNullable<typeof u> => !!u))];
  const total311 = r.requests311.reduce((n, g) => n + g.count, 0);
  const detail = h('div', { class: 'watch-detail', hidden: true });
  let filter: string | null = null;
  const draw = () => {
    clear(detail);
    if (tags.length) {
      detail.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by utility' },
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === null), onclick: () => { filter = null; draw(); } }, 'All'),
        ...tags.map((t) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === t), onclick: () => { filter = t; draw(); } }, UTIL_LABEL[t]))));
    }
    const items = r.items.filter((i) => !filter || i.utility === filter);
    if (!items.length) detail.append(h('p', { class: 'muted' }, 'Nothing scheduled in the next 14 days.'));
    detail.append(h('ul', { class: 'list' }, ...items.map((i) => h('li', null,
      h('div', { class: 'li-title' }, i.utility ? h('span', { class: 'chip chip-static' }, UTIL_LABEL[i.utility]) : null, h('strong', null, i.title)),
      h('div', { class: 'small' }, `${i.location} · ${fmtDate(i.start.slice(0, 10))}${i.end.slice(0, 10) !== i.start.slice(0, 10) ? ` – ${fmtDate(i.end.slice(0, 10))}` : ''} · ${fmtDistance(i.distanceM)}`),
      i.description ? h('div', { class: 'small muted clamp' }, i.description) : null))));
    if (r.requests311.length) {
      detail.append(h('details', { class: 'r311' }, h('summary', null, `311 requests, last 30 days (${total311})`),
        h('ul', { class: 'list' }, ...r.requests311.map((g) => h('li', null, h('strong', null, `${g.type} · ${g.count}`),
          ...g.items.slice(0, 5).map((x) => h('div', { class: 'small' }, `${x.address} · ${x.status} · ${fmtDate(x.created.slice(0, 10))}`)))))));
    }
    detail.append(h('p', { class: 'small muted' }, `Permits as of ${fmtShortDate(r.dataAsOf.permitsCurrent)} · events as of ${fmtShortDate(r.dataAsOf.specialEvents)}`));
  };
  draw();
  const toggle = btn('Details', { variant: 'ghost', small: true, iconName: 'chevron', 'aria-expanded': 'false' });
  toggle.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    toggle.setAttribute('aria-expanded', String(!detail.hidden));
    toggle.classList.toggle('open', !detail.hidden);
  });
  return card(null,
    h('div', { class: 'card-head' }, icon('pin', 20), h('h3', null, p.label), toggle),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, String(r.items.length)), h('span', { class: 'stat-l' }, r.items.length === 1 ? 'active item' : 'active items')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-n' }, String(total311)), h('span', { class: 'stat-l' }, '311 (30 days)'))),
    tags.length ? h('div', { class: 'chips' }, ...tags.map((t) => h('span', { class: 'chip chip-static' }, `${UTIL_LABEL[t]} · ${r.items.filter((i) => i.utility === t).length}`))) : null,
    h('p', { class: 'small muted' }, `Within ${fmtDistance(p.radiusM)} · next 14 days · ${plural(r.items.filter((i) => i.kind === 'event').length, 'event')}`),
    detail);
}

