import { api } from '../api.js';
import { clear, h, icon } from '../dom.js';
import { DATASET_LABEL, fmtAgo, fmtDate, fmtDistance, NAV_LABEL } from '../format.js';
import { btn, busy, card, confirmDialog, copyText, field, linkBtn, pill, select, toast } from '../ui.js';
import { closeSheet, openSheet } from '../components/sheet.js';
import { plateBadge, carDescription } from '../components/vehicle.js';
import { placeFlow, radiusEditor, zoneEditor } from '../flows/placeFlow.js';
import { vehicleFlow } from '../flows/vehicleFlow.js';
import { restartOnboarding } from './onboarding.js';
import { stateName } from '../../shared/plates.js';
import type { NavApp, NotifyCategory, Place, PlaceKind, SweepInfo } from '../../shared/types.js';
import type { Me, Notif, Status, VehicleRow } from '../types.js';

const CAT_LABEL: Record<NotifyCategory, [string, string]> = {
  vehicle: ['Car towed or relocated', 'Urgent — comes through quiet hours'],
  sweeping: ['Sweeping tomorrow', '7 pm the evening before'],
  winter: ['Winter weather alerts', 'National Weather Service warnings'],
  snowban: ['Possible 2-inch snow ban', 'Forecast ≥ 2 in. on a ban street'],
  work: ['New work near home', 'Daily digest at 6 pm'],
};

export async function renderSettings(root: HTMLElement): Promise<void> {
  const [me, places, vehicles, notif, status] = await Promise.all([
    api<Me>('/api/me'), api<Place[]>('/api/places'), api<VehicleRow[]>('/api/vehicles'),
    api<Notif>('/api/me/notifications'), api<Status>('/api/status'),
  ]);
  const rerender = async () => { clear(root); await renderSettings(root); };
  const sweeps = new Map<number, SweepInfo>();
  await Promise.all(places.filter((p) => p.kind === 'home').map(async (p) => { sweeps.set(p.id, await api<SweepInfo>(`/api/places/${p.id}/sweeping`)); }));

  const toc = h('nav', { class: 'toc', 'aria-label': 'Settings sections' },
    ...[['places', 'Places'], ['vehicles', 'Cars'], ['notifications', 'Notifications'], ['calendar', 'Calendar'], ['navigation', 'Navigation'], ['data', 'Data']]
      .map(([id, t]) => h('a', { href: `#/settings?s=${id}`, onclick: (e: Event) => { e.preventDefault(); document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t)));
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Settings')), toc);

  // ---------- Places ----------
  const addPlace = (kind: PlaceKind) => openSheet(placeFlow({ kind, onDone: async (p) => { closeSheet(); if (p) await rerender(); } }), { title: kind === 'home' ? 'Add a home street' : 'Add a watched place', wide: true });
  const placeRow = (p: Place) => {
    const sw = sweeps.get(p.id);
    const editZones = () => openSheet(zoneEditor(p, async (np) => { closeSheet(); if (np) await rerender(); }), { title: `Sweeping zone — ${p.label}`, wide: true });
    const editRadius = () => openSheet(radiusEditor(p, async (np) => { closeSheet(); if (np) await rerender(); }), { title: `Watch radius — ${p.label}`, wide: true });
    const rename = async () => {
      const input = h('input', { value: p.label, maxlength: 60 }) as HTMLInputElement;
      const f = field('Name', input, { hint: 'Shown in push notifications — use a name, not the address.' });
      const save = btn('Save', { variant: 'primary' });
      save.addEventListener('click', () => busy(save, 'Saving…', async () => { await api(`/api/places/${p.id}`, { method: 'PATCH', body: { label: input.value } }); closeSheet(); toast('Renamed', 'ok'); await rerender(); }));
      openSheet(h('div', { class: 'flow' }, f.el, h('div', { class: 'row end flow-actions' }, btn('Cancel', { variant: 'ghost', onclick: closeSheet }), save)), { title: 'Rename place' });
      input.focus();
    };
    const del = btn('Delete', { variant: 'ghost', small: true, iconName: 'trash', 'aria-label': `Delete ${p.label}` });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete “${p.label}”?`, p.kind === 'home' ? 'Its sweeping dates leave your calendar and reminders stop.' : 'Its activity list and alerts stop.', 'Delete'))) return;
      await busy(del, 'Deleting…', async () => { await api(`/api/places/${p.id}`, { method: 'DELETE' }); toast('Place deleted', 'ok'); await rerender(); });
    });
    const zoneText = p.kind === 'home'
      ? (p.zones.length ? p.zones.map((z) => `Ward ${Number(z.slice(0, 2))} · Sec ${Number(z.slice(2))}`).join(', ') : null)
      : `Watching ${fmtDistance(p.radiusM)} around it`;
    return h('li', { class: 'item' },
      h('div', { class: 'item-icon' }, icon(p.kind === 'home' ? 'home' : 'pin', 20)),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, h('strong', null, p.label), p.kind === 'home' && !p.zones.length ? pill('Zone not set', 'warn') : null),
        h('div', { class: 'small muted' }, p.address),
        zoneText ? h('div', { class: 'small' }, zoneText) : null,
        p.kind === 'home' && sw?.upcoming[0] ? h('div', { class: 'small muted' }, `Next sweep ${fmtDate(sw.upcoming[0].date)}`) : null,
        h('div', { class: 'item-actions' },
          p.kind === 'home' ? btn('Zone on map', { variant: 'secondary', small: true, iconName: 'pin', onclick: editZones }) : btn('Radius on map', { variant: 'secondary', small: true, iconName: 'pin', onclick: editRadius }),
          btn('Rename', { variant: 'ghost', small: true, iconName: 'edit', onclick: rename }), del)));
  };
  const homes = places.filter((p) => p.kind === 'home'), watches = places.filter((p) => p.kind === 'watch');
  root.append(card({ id: 's-places' },
    h('div', { class: 'card-head' }, icon('home', 20), h('h2', null, 'Places')),
    h('h3', { class: 'sub' }, 'Home streets'),
    homes.length ? h('ul', { class: 'items' }, ...homes.map(placeRow)) : h('p', { class: 'muted small' }, 'None yet. Add where you park overnight.'),
    homes.length < 5 ? btn('Add home street', { iconName: 'plus', onclick: () => addPlace('home') }) : h('p', { class: 'small muted' }, 'Maximum of 5 home streets.'),
    h('h3', { class: 'sub' }, 'Watched places'),
    watches.length ? h('ul', { class: 'items' }, ...watches.map(placeRow)) : h('p', { class: 'muted small' }, 'None yet. Watch work, closures and 311 near any address.'),
    watches.length < 10 ? btn('Add watched place', { iconName: 'plus', onclick: () => addPlace('watch') }) : h('p', { class: 'small muted' }, 'Maximum of 10 watched places.')));

  // ---------- Vehicles ----------
  const editVehicle = (v?: VehicleRow) => openSheet(vehicleFlow({ me, existing: v, others: vehicles, onDone: async () => { closeSheet(); await rerender(); } }), { title: v ? 'Edit car' : 'Add a car', wide: true });
  const vehicleRow = (v: VehicleRow) => {
    const del = btn('Delete', { variant: 'ghost', small: true, iconName: 'trash', 'aria-label': `Delete ${v.state} ${v.plate}` });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(`Stop checking ${v.state} · ${v.plate}?`, 'The plate and its check history are deleted. You won’t get tow alerts for it.', 'Delete'))) return;
      await busy(del, 'Deleting…', async () => { await api(`/api/vehicles/${v.id}`, { method: 'DELETE' }); toast('Car deleted', 'ok'); await rerender(); });
    });
    const s = v.status;
    const st = !s ? pill('Not checked yet', 'neutral') : s.matches.length ? pill('Record found', 'bad', 'alert') : !s.ok ? pill('Check failed', 'warn', 'alert') : pill(`Clear · ${fmtAgo(s.checkedAt)}`, 'ok', 'check');
    return h('li', { class: 'item' },
      plateBadge(v.state, v.plate),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, h('strong', null, v.nickname || carDescription(v) || 'Car'), st),
        h('div', { class: 'small muted' }, [stateName(v.state), carDescription(v)].filter(Boolean).join(' · ')),
        h('div', { class: 'item-actions' }, btn('Edit', { variant: 'secondary', small: true, iconName: 'edit', onclick: () => editVehicle(v) }), del)));
  };
  root.append(card({ id: 's-vehicles' },
    h('div', { class: 'card-head' }, icon('car', 20), h('h2', null, 'Cars')),
    h('p', { class: 'small muted' }, 'Checked against the city’s Towed and Relocated Vehicles records every 30 minutes. Status details and “Check now” are on Home.'),
    vehicles.length ? h('ul', { class: 'items' }, ...vehicles.map(vehicleRow)) : null,
    vehicles.length < 3 ? btn('Add a car', { iconName: 'plus', onclick: () => editVehicle() }) : h('p', { class: 'small muted' }, 'Maximum of 3 cars.')));

  // ---------- Notifications ----------
  const prefs = structuredClone(notif.prefs);
  const topicIn = h('input', { value: notif.topic, minlength: 24, maxlength: 64, autocomplete: 'off', spellcheck: false, class: 'mono' }) as HTMLInputElement;
  const topicF = field('ntfy topic', h('div', { class: 'copy-field' }, topicIn, btn('Copy', { iconName: 'copy', onclick: () => copyText(topicIn.value, 'Topic copied') })), { hint: `Subscribe to it in the ntfy iPhone app${notif.ntfyUrl && notif.ntfyUrl !== 'https://ntfy.sh' ? ` on ${notif.ntfyUrl}` : ''}. It works like a password — anyone with it can read your alerts. At least 24 characters. Alerts never include your plate or addresses.` });
  topicF.el.querySelector('label')!.setAttribute('for', topicIn.id = 'ntfy-topic');
  const qs = h('input', { type: 'time', value: prefs.quietStart }) as HTMLInputElement;
  const qe = h('input', { type: 'time', value: prefs.quietEnd }) as HTMLInputElement;
  const saveN = btn('Save', { variant: 'primary' });
  saveN.addEventListener('click', () => busy(saveN, 'Saving…', async () => {
    topicF.setError(topicIn.value.length >= 24 ? null : 'At least 24 characters.');
    if (topicIn.value.length < 24) return;
    await api('/api/me/notifications', { method: 'PATCH', body: { topic: topicIn.value, prefs: { ...prefs, quietStart: qs.value, quietEnd: qe.value } } });
    toast('Notification settings saved', 'ok');
  }));
  const test = btn('Send test', { iconName: 'bell', disabled: !notif.configured });
  test.addEventListener('click', () => busy(test, 'Sending…', async () => { await api('/api/me/notifications/test', { method: 'POST' }); toast('Test sent — check your phone', 'ok'); }));
  root.append(card({ id: 's-notifications' },
    h('div', { class: 'card-head' }, icon('bell', 20), h('h2', null, 'Notifications')),
    notif.configured ? null : h('div', { class: 'banner banner-warn' }, icon('alert', 18), h('div', null, 'Push is turned off on the server (NTFY_URL is empty).')),
    topicF.el,
    h('fieldset', { class: 'toggles' }, h('legend', null, 'Send me'),
      ...(Object.keys(CAT_LABEL) as NotifyCategory[]).map((c) => h('label', { class: 'toggle' },
        h('span', null, h('span', { class: 'toggle-title' }, CAT_LABEL[c][0]), h('span', { class: 'small muted' }, CAT_LABEL[c][1])),
        h('input', { type: 'checkbox', role: 'switch', checked: prefs.enabled[c], onchange: (e: Event) => { prefs.enabled[c] = (e.target as HTMLInputElement).checked; } })))),
    h('div', { class: 'grid-2' }, field('Quiet from', qs, { hint: 'Non-urgent alerts wait until morning.' }).el, field('Quiet until', qe).el),
    h('div', { class: 'row end flow-actions' }, test, saveN)));

  // ---------- Calendar ----------
  root.append(card({ id: 's-calendar' },
    h('div', { class: 'card-head' }, icon('calendar', 20), h('h2', null, 'Street-cleaning calendar')),
    h('p', { class: 'small' }, 'On iPhone, tap Subscribe — or copy the link and add it under Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Tailscale must be connected for it to refresh.'),
    h('div', { class: 'copy-field' }, h('input', { value: me.calUrl, readonly: true, 'aria-label': 'Calendar link', onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
      btn('Copy', { iconName: 'copy', onclick: () => copyText(me.calUrl, 'Calendar link copied') })),
    h('div', { class: 'row' }, linkBtn('Subscribe', me.calUrl, { variant: 'primary', iconName: 'calendar' }),
      (() => {
        const regen = btn('Regenerate link', { variant: 'ghost', iconName: 'refresh' });
        regen.addEventListener('click', async () => {
          if (!(await confirmDialog('Regenerate the calendar link?', 'The old link stops working. You will need to re-subscribe on every device.', 'Regenerate'))) return;
          await busy(regen, 'Regenerating…', async () => { await api('/api/me/cal-token', { method: 'POST' }); toast('New link created — re-subscribe', 'ok'); await rerender(); });
        });
        return regen;
      })())));

  // ---------- Navigation ----------
  const navSel = select((['apple', 'google', 'waze'] as NavApp[]).map((n) => ({ value: n, label: NAV_LABEL[n] })), me.navApp);
  navSel.addEventListener('change', async () => {
    try { await api('/api/me', { method: 'PATCH', body: { navApp: navSel.value } }); toast(`Navigate opens ${NAV_LABEL[navSel.value as NavApp]}`, 'ok'); } catch (e) { toast((e as Error).message, 'bad'); }
  });
  root.append(card({ id: 's-navigation' },
    h('div', { class: 'card-head' }, icon('nav', 20), h('h2', null, 'Navigation app')),
    field('Navigate buttons open', navSel, { hint: 'Apple Maps also shows on CarPlay.' }).el));

  // ---------- Data ----------
  const refresh = me.isOwner ? btn('Refresh city data now', { iconName: 'refresh' }) : null;
  refresh?.addEventListener('click', () => busy(refresh, 'Refreshing… (a few minutes)', async () => { await api('/api/admin/refresh', { method: 'POST' }); toast('City data refreshed', 'ok'); await rerender(); }));
  root.append(card({ id: 's-data' },
    h('div', { class: 'card-head' }, icon('info', 20), h('h2', null, 'City data')),
    h('ul', { class: 'data-list' }, ...status.datasets.map((d) => h('li', null,
      h('span', null, DATASET_LABEL[d.name] ?? d.name),
      h('span', { class: 'small muted' }, `${d.rowCount.toLocaleString()} rows · ${fmtAgo(d.fetchedAt)}`),
      d.status === 'error' ? pill('refresh failed', 'bad') : status.stale.includes(d.name) ? pill('stale', 'warn') : pill('ok', 'ok')))),
    refresh));

  root.append(card(null, h('div', { class: 'card-head' }, icon('star', 20), h('h2', null, 'Setup guide')),
    h('p', { class: 'small muted' }, 'Walk through home street, calendar, push alerts and your car again.'),
    btn('Run the setup guide', { onclick: restartOnboarding })));

  // Deep links from Home: #/settings?add=vehicle|home|watch, #/settings?zones=<placeId>
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const add = q.get('add'), zonesFor = Number(q.get('zones'));
  history.replaceState(null, '', '#/settings');
  if (add === 'vehicle' && vehicles.length < 3) editVehicle();
  else if (add === 'home' || add === 'watch') addPlace(add);
  else if (zonesFor) { const p = places.find((x) => x.id === zonesFor); if (p) openSheet(zoneEditor(p, async (np) => { closeSheet(); if (np) await rerender(); }), { title: `Sweeping zone — ${p.label}`, wide: true }); }
  const sec = q.get('s'); if (sec) document.getElementById(`s-${sec}`)?.scrollIntoView({ block: 'start' });
}
