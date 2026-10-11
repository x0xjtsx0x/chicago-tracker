import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, ApiError } from '../api.js';
import { clear, h } from '../dom.js';
import { openSheet } from '../components/sheet.js';
import { chicagoNowLocal, chicagoToday, fmtDistance, fmtRate, isWinterMonth, STATUS_COLOR } from '../format.js';
import { navUrl } from '../../shared/deeplinks.js';
import type { GeoResult, LngLat, NavApp, ParkingBlock, ParkingResult, Plow } from '../../shared/types.js';

const LS_KEY = 'ct:lastDest';
const toLatLng = (p: LngLat): L.LatLngTuple => [p[1], p[0]];
let map: L.Map | null = null;

export async function renderPark(root: HTMLElement): Promise<void> {
  const me = await api<{ navApp: NavApp }>('/api/me');
  if (map) { map.remove(); map = null; }

  let dest: GeoResult | null = null;
  try { dest = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); } catch { dest = null; }
  let radius = 400;
  let at: string | null = null;

  const input = h('input', { type: 'search', placeholder: 'Where are you going?', autocomplete: 'off', 'aria-label': 'Destination' }) as HTMLInputElement;
  const results = h('div', { class: 'search-results' });
  const radiusSel = h('select', { 'aria-label': 'Radius' }, ...[200, 400, 800, 1200].map((r) => h('option', { value: String(r), selected: r === radius }, `${fmtDistance(r)} radius`))) as HTMLSelectElement;
  const whenSel = h('select', { 'aria-label': 'When' }, h('option', { value: 'now' }, 'Now'), h('option', { value: 'custom' }, 'Pick a time…')) as HTMLSelectElement;
  const whenInput = h('input', { type: 'datetime-local', hidden: true, 'aria-label': 'Arrival time' }) as HTMLInputElement;
  const plowToggle = h('button', { class: 'chip', 'aria-pressed': 'false', hidden: !isWinterMonth(chicagoToday()) }, '🚜 Snowplows');
  const status = h('p', { class: 'muted small' });
  const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': 'Parking map' });
  const list = h('ul', { class: 'list' });
  const legend = h('div', { class: 'legend' },
    ...([['green', 'No issues found'], ['info', 'Info'], ['amber', 'Caution'], ['red', 'Avoid']] as const).map(([k, t]) => h('span', null, h('span', { class: 'dot', style: `background:${STATUS_COLOR[k]}` }), t)),
    h('span', null, h('span', { class: 'dot', style: 'background:#7b3fa0' }), 'Permit zone'));

  root.append(h('h1', null, 'Street parking'),
    h('div', { class: 'row' }, input, h('button', { onclick: locate }, '📍 Near me')), results,
    h('div', { class: 'row' }, whenSel, whenInput, radiusSel, plowToggle), status, mapEl, legend, list);

  map = L.map(mapEl, { zoomControl: true }).setView([41.8819, -87.6278], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const main = L.layerGroup().addTo(map), boxes = L.layerGroup(), plows = L.layerGroup();
  map.on('zoomend', () => { if (map!.getZoom() >= 17) boxes.addTo(map!); else boxes.remove(); });

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { clear(results); return; }
    timer = window.setTimeout(async () => {
      const hits = await api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => []);
      clear(results);
      if (!hits.length) results.append(h('p', { class: 'muted small' }, "Couldn't find that address."));
      for (const g of hits) results.append(h('button', { onclick: () => choose(g) }, g.label));
    }, 400);
  });
  radiusSel.addEventListener('change', () => { radius = Number(radiusSel.value); void load(); });
  whenSel.addEventListener('change', () => {
    whenInput.hidden = whenSel.value !== 'custom';
    if (whenSel.value === 'now') { at = null; void load(); } else { whenInput.value = chicagoNowLocal(); }
  });
  whenInput.addEventListener('change', () => { at = whenInput.value || null; void load(); });
  plowToggle.addEventListener('click', async () => {
    const on = plowToggle.getAttribute('aria-pressed') !== 'true';
    plowToggle.setAttribute('aria-pressed', String(on));
    plows.clearLayers();
    if (!on) { plows.remove(); return; }
    const b = map!.getBounds();
    const list_ = await api<Plow[]>(`/api/plows?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(',')}`).catch(() => []);
    for (const p of list_) L.circleMarker(toLatLng(p.point), { radius: 6, color: '#333', fillColor: '#ffd400', fillOpacity: 1 }).bindTooltip(`${p.type} · ${p.minutesAgo} min ago`).addTo(plows);
    plows.addTo(map!);
    status.textContent = `${list_.length} plows reporting in view (last 2h).`;
  });

  function choose(g: GeoResult) {
    dest = g; input.value = g.label; clear(results);
    try { localStorage.setItem(LS_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
    void load();
  }
  function locate() {
    if (!navigator.geolocation) { status.textContent = 'Location not available.'; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { status.textContent = 'Location permission denied.'; }, { enableHighAccuracy: true, timeout: 10_000 });
  }

  async function load() {
    if (!dest) { status.textContent = 'Search for a destination to see nearby metered blocks.'; return; }
    status.textContent = 'Loading…';
    const q = new URLSearchParams({ lat: String(dest.lat), lon: String(dest.lon), radius: String(radius) });
    if (at) q.set('at', at);
    let r: ParkingResult;
    try { r = await api<ParkingResult>(`/api/parking?${q}`); } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : 'Could not load parking.'; return;
    }
    draw(r);
  }

  function draw(r: ParkingResult) {
    main.clearLayers(); boxes.clearLayers(); clear(list);
    const center = toLatLng(r.center);
    const circle = L.circle(center, { radius: r.radiusM, color: '#888', weight: 1, fill: false, dashArray: '4 4' }).addTo(main);
    L.circleMarker(center, { radius: 8, color: '#000', weight: 2, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(dest?.label ?? 'Destination').addTo(main);
    for (const z of r.permitZones) {
      const layer = z.line.length > 1
        ? L.polyline(z.line.map(toLatLng), { color: '#7b3fa0', weight: 5, dashArray: '6 6' })
        : L.circleMarker(toLatLng(z.line[0]), { radius: 6, color: '#7b3fa0' });
      layer.bindTooltip(z.label).addTo(main);
    }
    for (const c of r.closures) if (c.point) {
      L.circleMarker(toLatLng(c.point), { radius: 7, color: '#d73027', fillColor: '#d73027', fillOpacity: .5 })
        .bindPopup(h('div', null, h('strong', null, c.streetClosure ? `${c.streetClosure} closure` : c.appType), h('div', null, c.location), h('div', null, `${c.start.slice(0, 10)} → ${c.end.slice(0, 10)}`))).addTo(main);
    }
    for (const b of r.blocks) {
      L.polyline(b.paths.map((p) => p.map(toLatLng)), { color: STATUS_COLOR[b.status], weight: 8, opacity: .9 }).on('click', () => openBlock(b)).addTo(main);
    }
    for (const x of r.boxes) L.circleMarker(toLatLng(x.point), { radius: 4, color: '#444', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`Pay box · area ${x.payArea}`).addTo(boxes);
    map!.fitBounds(circle.getBounds(), { padding: [10, 10] });

    const when = r.at.slice(0, 16).replace('T', ' ');
    status.textContent = `${r.blocks.length} metered blocks within ${fmtDistance(r.radiusM)} · ${when}${r.warnings.length ? ` · ⚠️ ${r.warnings.join('; ')}` : ''} · data as of ${r.dataAsOf.payBlocks?.slice(0, 10) ?? '—'}`;
    if (!r.blocks.length) list.append(h('li', { class: 'muted' }, 'No metered blocks in range. Try a bigger radius.'));
    for (const b of r.blocks) {
      list.append(h('li', { onclick: () => openBlock(b), style: 'cursor:pointer' },
        h('span', { class: 'dot', style: `background:${STATUS_COLOR[b.status]}` }),
        h('strong', null, `${b.from}–${b.to} ${b.street}`),
        h('div', { class: 'small' }, `${fmtDistance(b.distanceM)} · ${b.spaces} spaces · ${b.hourLimit ? `${b.hourLimit} hr limit` : 'limit: see sign'} · ${fmtRate(b.rate)}`),
        b.flags.length ? h('div', { class: 'small muted' }, b.flags.map((f) => f.reason).join(' · ')) : null));
    }
  }

  function openBlock(b: ParkingBlock) {
    const copyArea = async () => { try { await navigator.clipboard.writeText(String(b.payArea)); } catch { /* clipboard unavailable */ } };
    openSheet(h('div', null,
      h('h2', null, `${b.from}–${b.to} ${b.street}`),
      h('p', null, `${b.spaces} spaces · ${b.hourLimit ? `${b.hourLimit} hr limit` : 'hour limit: see sign'} · ${fmtDistance(b.distanceM)} from destination`),
      h('p', null, `${fmtRate(b.rate)} · ${b.rate.hoursText} (approximate — check the meter)`),
      h('p', null, h('span', { class: 'big' }, `Pay area #${b.payArea}`), ' ', h('button', { onclick: copyArea }, 'Copy')),
      b.flags.length ? h('ul', { class: 'list' }, ...b.flags.map((f) => h('li', null, h('span', { class: 'dot', style: `background:${STATUS_COLOR[f.severity]}` }), f.reason))) : h('p', { class: 'muted' }, 'No issues found in city data. Always read the posted signs.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: navUrl(me.navApp, b.navPoint), target: '_blank', rel: 'noopener' }, '🧭 Navigate'),
        h('a', { class: 'btn', href: 'https://parkchicago.com', target: '_blank', rel: 'noopener', onclick: copyArea }, 'ParkChicago (area copied)'))));
  }

  if (dest) { input.value = dest.label; await load(); } else { status.textContent = 'Search for a destination to see nearby metered blocks.'; }
}
