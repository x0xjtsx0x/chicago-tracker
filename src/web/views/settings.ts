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
  const labelIn = h('input', { placeholder: 'Label (e.g. Home, Mom’s)', maxlength: 60, 'aria-label': 'Label' }) as HTMLInputElement;
  const addrIn = h('input', { placeholder: 'Address (e.g. 1400 W Wilson Ave)', 'aria-label': 'Address' }) as HTMLInputElement;
  const placeList = h('div');
  for (const p of places) placeList.append(await placeRow(p, rerender, fail));
  root.append(h('section', { class: 'card' }, h('h2', null, 'Places'), placeList,
    h('label', null, 'Add a place'), kindSel, labelIn,
    h('p', { class: 'muted small' }, 'The label appears in push notifications, so use a name rather than the street address.'),
    addrIn,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => {
      try { await api('/api/places', { method: 'POST', body: { kind: kindSel.value, label: labelIn.value, address: addrIn.value } }); await rerender(); } catch (e) { fail(e); }
    } }, 'Add'))));

  // Vehicles
  const plateIn = h('input', { placeholder: 'Plate', maxlength: 10, 'aria-label': 'Plate' }) as HTMLInputElement;
  const stateIn = h('input', { placeholder: 'State', value: 'IL', maxlength: 2, 'aria-label': 'State' }) as HTMLInputElement;
  const nickIn = h('input', { placeholder: 'Nickname (optional)', maxlength: 30, 'aria-label': 'Nickname' }) as HTMLInputElement;
  root.append(h('section', { class: 'card' }, h('h2', null, 'Vehicles (tow & relocation check)'),
    h('ul', { class: 'list' }, ...vehicles.map((v) => h('li', { class: 'row' }, h('span', null, `${v.nickname ? `${v.nickname} · ` : ''}${v.plate} (${v.state})`),
      h('button', { onclick: async () => { try { await api(`/api/vehicles/${v.id}`, { method: 'DELETE' }); await rerender(); } catch (e) { fail(e); } } }, 'Remove')))),
    vehicles.length < 3 ? h('div', null, h('div', { class: 'row' }, plateIn, stateIn), nickIn,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => {
        try { await api('/api/vehicles', { method: 'POST', body: { plate: plateIn.value, state: stateIn.value, nickname: nickIn.value } }); await rerender(); } catch (e) { fail(e); }
      } }, 'Add vehicle'))) : h('p', { class: 'muted small' }, 'Maximum of 3 vehicles.')));

  // Notifications
  const prefs = structuredClone(notif.prefs);
  const topicIn = h('input', { value: notif.topic, minlength: 24, maxlength: 64, 'aria-label': 'ntfy topic', autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
  const qs = h('input', { type: 'time', value: prefs.quietStart, 'aria-label': 'Quiet hours start' }) as HTMLInputElement;
  const qe = h('input', { type: 'time', value: prefs.quietEnd, 'aria-label': 'Quiet hours end' }) as HTMLInputElement;
  root.append(h('section', { class: 'card' }, h('h2', null, 'Push notifications (ntfy)'),
    notif.configured ? null : h('div', { class: 'banner' }, 'Push is turned off on the server (NTFY_URL is empty).'),
    h('p', { class: 'small' }, `In the ntfy iPhone app, subscribe to this topic on ${notif.ntfyUrl ?? '(not set)'}:`),
    topicIn,
    h('p', { class: 'muted small' }, 'The topic name works like a password: anyone who knows it can read your alerts. Keep it secret. A topic you choose must be at least 24 characters. Alerts never include your plate or addresses.'),
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
