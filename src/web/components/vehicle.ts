import { api } from '../api.js';
import { h, icon } from '../dom.js';
import { fmtAgo, fmtDate, fmtTime, plural } from '../format.js';
import { btn, busy, linkBtn, pill } from '../ui.js';
import { navUrl } from '../../shared/deeplinks.js';
import { colorByKey, decodeColor, decodeMake, makeByKey, stateName } from '../../shared/plates.js';
import type { Vehicle, VehicleMatch, VehicleStatus } from '../../shared/types.js';
import type { Me, VehicleRow } from '../types.js';

/** A licence-plate-shaped preview: state name on top, the plate in a wide monospace face. */
export function plateBadge(state: string, plate: string, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  return h('span', { class: `plate plate-${size}`, 'aria-label': `${stateName(state)} plate ${plate.split('').join(' ')}` },
    h('span', { class: 'plate-state', 'aria-hidden': 'true' }, stateName(state).toUpperCase()),
    h('span', { class: 'plate-num', 'aria-hidden': 'true' }, plate || '—'));
}

/** One tile per character, captioned letter/digit, so O-vs-0 and I-vs-1 are visible at a glance. */
export function plateChars(plate: string): HTMLElement {
  return h('div', { class: 'plate-chars', 'aria-label': `Characters: ${plate.split('').map((c) => (/\d/.test(c) ? `digit ${c}` : `letter ${c}`)).join(', ')}` },
    ...plate.split('').map((c) => h('span', { class: `pc ${/\d/.test(c) ? 'pc-digit' : 'pc-letter'}`, 'aria-hidden': 'true' },
      h('span', { class: 'pc-char' }, c), h('span', { class: 'pc-kind' }, /\d/.test(c) ? 'digit' : 'letter'))));
}

export function carDescription(v: Pick<Vehicle, 'make' | 'color'>): string {
  return [colorByKey(v.color)?.label, makeByKey(v.make)?.label].filter(Boolean).join(' ');
}
const vehicleTitle = (v: Vehicle) => v.nickname || carDescription(v) || 'Your car';

function recordCar(m: VehicleMatch): string {
  const c = decodeColor(m.color)?.label ?? m.color ?? '', mk = decodeMake(m.make)?.label ?? m.make ?? '';
  return [c, mk].filter(Boolean).join(' ').toUpperCase();
}

/** The red "where is my car" block for one record, with the cross-check warning above everything. */
function matchBlock(v: Vehicle, m: VehicleMatch, me: Me, history = false): HTMLElement {
  const cc = m.crossCheck;
  const what = m.kind === 'towed' ? 'Towed' : 'Relocated';
  const car = recordCar(m);
  return h('div', { class: `match ${history ? 'match-history' : ''}` },
    cc?.verdict === 'mismatch' ? h('div', { class: 'crosscheck', role: 'alert' }, icon('alert', 18),
      h('div', null, h('strong', null, `This record shows a ${cc.recordText} — is that your car?`),
        h('div', { class: 'small' }, `You saved a ${carDescription(v) || 'car with no make/colour'}: ${cc.problems.join('; ')}. If it isn't yours, the plate or state may be wrong.`))) : null,
    m.confidence === 'possible' ? h('div', { class: 'crosscheck crosscheck-soft' }, icon('info', 18),
      h('div', null, h('strong', null, 'Possible match: '), 'this record has your plate but lists no state.')) : null,
    h('div', { class: 'match-head' }, h('strong', null, `${what} ${fmtDate(m.date)}`),
      car ? h('span', { class: 'muted small' }, ` · record says ${car}`) : null,
      cc?.verdict === 'consistent' ? pill('make/colour agree', 'ok', 'check') : null),
    h('div', { class: 'small' }, m.details),
    h('div', null, m.kind === 'towed' ? 'Tow lot: ' : 'Moved to: ', h('strong', null, m.address || 'address not listed'),
      m.phone ? h('span', null, ' · ', h('a', { class: 'nowrap', href: `tel:${m.phone.replace(/[^\d+]/g, '')}` }, m.phone)) : null),
    !history && m.address ? h('div', { class: 'row' }, linkBtn('Navigate', navUrl(me.navApp, `${m.address}, Chicago, IL`), { variant: 'primary', iconName: 'nav', external: true })) : null);
}

/** "What we searched" — the exact query, so a wrong state or typo is visible. */
export function searchDetails(s: VehicleStatus, open = false): HTMLElement {
  const q = s.search;
  const d = h('details', { class: 'searched', ...(open ? { open: true } : {}) }, h('summary', null, 'What we searched'));
  if (!q) { d.append(h('p', { class: 'small muted' }, 'Details are recorded from the next check on.')); return d; }
  d.append(h('dl', { class: 'kv small' },
    h('dt', null, 'Plate'), h('dd', null, h('code', null, q.plate), ' — exact characters, in any state'),
    h('dt', null, 'Alerts for'), h('dd', null, `${stateName(q.state)} (${q.stateCodes.join(' or ')}) or records with no state, dated ${fmtDate(q.alertSince)} or later`),
    h('dt', null, 'Datasets'), h('dd', null, ...q.datasets.flatMap((x, i) => [i ? ', ' : '', h('a', { href: `https://data.cityofchicago.org/d/${x.id}`, target: '_blank', rel: 'noopener noreferrer' }, `${x.name} (${x.id})`)])),
    h('dt', null, 'History'), h('dd', null, `The city keeps about ${q.datasetWindowDays} days; older records are shown but never alert.`),
    h('dt', null, 'Checked'), h('dd', null, `${fmtDate(s.checkedAt.slice(0, 10))}, ${fmtTime(s.checkedAt)}${s.ok ? '' : ' — failed'}`)));
  return d;
}

export type VehicleCardOpts = { onEdit?: (v: VehicleRow) => void; compact?: boolean; openSearch?: boolean };

/**
 * Status card for one saved car. Never shows green unless the last check succeeded.
 * "Check now" runs the live lookup and redraws in place.
 */
export function vehicleCard(initial: VehicleRow, me: Me, opts: VehicleCardOpts = {}): HTMLElement {
  const el = h('article', { class: 'card vehicle' });
  let v = initial;
  const draw = () => {
    while (el.firstChild) el.removeChild(el.firstChild);
    const s = v.status;
    const tone = !s ? 'neutral' : s.matches.length ? 'bad' : !s.ok ? 'warn' : 'ok';
    el.className = `card vehicle tone-${tone}`;
    const check = btn('Check now', { iconName: 'refresh', small: true, onclick: () => busy(check, 'Checking…', async () => {
      v = await api<VehicleRow>(`/api/vehicles/${v.id}/check`, { method: 'POST' });
      draw();
    }) });
    el.append(h('div', { class: 'vehicle-head' },
      plateBadge(v.state, v.plate),
      h('div', { class: 'vehicle-name' }, h('strong', null, vehicleTitle(v)), h('div', { class: 'small muted' }, v.nickname && carDescription(v) ? carDescription(v) : `${stateName(v.state)} plate`)),
      opts.onEdit ? btn('Edit', { variant: 'ghost', small: true, iconName: 'edit', onclick: () => opts.onEdit!(v), 'aria-label': `Edit ${vehicleTitle(v)}` }) : null));

    const headline = (iconName: string, text: string, sub: string | Node) =>
      h('div', { class: 'status-line' }, h('span', { class: 'status-icon' }, icon(iconName, 22)), h('div', null, h('div', { class: 'status-text' }, text), h('div', { class: 'small muted' }, sub)));

    if (!s) el.append(headline('clock', 'Not checked yet', 'Tap Check now to search the city records.'));
    else if (s.matches.length) {
      el.append(headline('alert', s.matches.some((m) => m.confidence === 'exact') ? (s.matches[0].kind === 'towed' ? 'Your car may have been towed' : 'Your car may have been relocated') : 'Possible record for your plate',
        `${plural(s.matches.length, 'record')} in the last 14 days · checked ${fmtAgo(s.checkedAt)}`));
      if (!s.ok) el.append(h('p', { class: 'small warn-text' }, `The latest check failed (${fmtTime(s.checkedAt)}); showing the last successful result.`));
      for (const m of s.matches) el.append(matchBlock(v, m, me));
    } else if (!s.ok) {
      el.append(headline('alert', 'Check failed — status unknown', `Tried ${fmtAgo(s.checkedAt)}. We can't say whether it was towed.`));
      if (s.error) el.append(h('p', { class: 'small muted' }, s.error));
    } else {
      const anyHistory = (s.older?.length ?? 0) + (s.otherState?.length ?? 0) > 0;
      el.append(headline('checkCircle', 'Not towed or relocated',
        anyHistory || !s.search
          ? `No ${stateName(v.state)} record for ${v.plate} since ${fmtDate(s.search?.alertSince ?? s.checkedAt.slice(0, 10))} · checked ${fmtAgo(s.checkedAt)}`
          : `No record for ${v.plate} in any state in the city’s last ~${s.search.datasetWindowDays} days · checked ${fmtAgo(s.checkedAt)}`));
    }
    for (const m of s?.otherState ?? []) {
      el.append(h('div', { class: 'crosscheck crosscheck-soft' }, icon('info', 18), h('div', null,
        h('strong', null, `Same plate under ${stateName(m.recordState)}: `), `${m.kind} ${fmtDate(m.date)}${recordCar(m) ? ` (${recordCar(m)})` : ''}. `,
        `If your car has ${stateName(m.recordState)} plates, edit the state — otherwise it's another car.`)));
    }
    if (s?.older?.length && !opts.compact) {
      el.append(h('details', { class: 'older' }, h('summary', null, `${plural(s.older.length, 'older record')} (15–90 days ago, not alerting)`),
        ...s.older.map((m) => matchBlock(v, m, me, true))));
    }
    if (s && !opts.compact) el.append(searchDetails(s, opts.openSearch));
    el.append(h('div', { class: 'row vehicle-foot' }, check,
      h('a', { class: 'small', href: me.towSearchUrl, target: '_blank', rel: 'noopener noreferrer' }, 'City tow records ', icon('external', 14))));
    if (!opts.compact) el.append(h('p', { class: 'small muted' }, 'City records can lag reality by a few hours.'));
  };
  draw();
  return el;
}
