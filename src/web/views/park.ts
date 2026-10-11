import L from 'leaflet';
import { api, ApiError } from '../api.js';
import { clear, h, icon } from '../dom.js';
import { openSheet } from '../components/sheet.js';
import { chicagoNowLocal, chicagoToday, fmtDate, fmtDistance, fmtRate, fmtShortDate, fmtTime, isWinterMonth, NAV_LABEL, plural, STATUS_COLOR, STATUS_WORD } from '../format.js';
import { btn, copyText, emptyState, linkBtn, segmented, select } from '../ui.js';
import { createMap, pinMarker, toLatLng } from '../map.js';
import { navUrl } from '../../shared/deeplinks.js';
import type { BlockStatus, GeoResult, ParkingBlock, ParkingResult, Plow } from '../../shared/types.js';
import type { Me } from '../types.js';

const LS_KEY = 'ct:lastDest';
let map: L.Map | null = null;

const SEV_ICON: Record<string, string> = { red: 'alert', amber: 'alert', info: 'info' };
const STATUS_TONE: Record<BlockStatus, string> = { green: 'ok', info: 'info', amber: 'warn', red: 'bad' };
const statusPill = (s: BlockStatus) => h('span', { class: `pill pill-${STATUS_TONE[s]}` }, h('span', { class: 'dot', style: `background:${STATUS_COLOR[s]}` }), STATUS_WORD[s]);

export async function renderPark(root: HTMLElement): Promise<void> {
  const me = await api<Me>('/api/me');
  if (map) { map.remove(); map = null; }

  let dest: GeoResult | null = null;
  try { dest = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null'); } catch { dest = null; }
  let radius = 400;
  let at: string | null = null;

  // ---- search ----
  const input = h('input', { type: 'search', placeholder: 'Where are you going?', autocomplete: 'off', 'aria-label': 'Destination address', enterkeyhint: 'search' }) as HTMLInputElement;
  const searchBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('search', 18), h('span', null, 'Search')) as HTMLButtonElement;
  const locBtn = h('button', { type: 'button', class: 'btn btn-secondary icon-only', 'aria-label': 'Use my location', title: 'Use my location', onclick: locate }, icon('locate', 20));
  // Search runs only on Enter or the Search button, never per keystroke: Nominatim's usage policy
  // forbids autocomplete, and every uncached query is a live request to it.
  const form = h('form', { class: 'searchbar', role: 'search', onsubmit: (e: Event) => { e.preventDefault(); void search(); } }, input, searchBtn, locBtn);
  const results = h('div', { class: 'search-results', role: 'listbox', 'aria-label': 'Address matches', hidden: true });

  // ---- controls ----
  const whenInput = h('input', { type: 'datetime-local', hidden: true, 'aria-label': 'Arrival time (Chicago)' }) as HTMLInputElement;
  const whenSeg = segmented('When', [{ value: 'now', label: 'Now' }, { value: 'later', label: 'Later…' }], 'now', (v) => {
    whenInput.hidden = v !== 'later';
    if (v === 'now') { at = null; void load(); } else { whenInput.value = whenInput.value || chicagoNowLocal(); whenInput.focus(); }
  });
  const radiusSel = select([200, 400, 800, 1200].map((r) => ({ value: String(r), label: `Within ${fmtDistance(r)}` })), String(radius), { 'aria-label': 'Search radius' });
  const plowToggle = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', hidden: !isWinterMonth(chicagoToday()) }, icon('snow', 14), ' Snowplows');
  const controls = h('div', { class: 'park-controls' }, h('div', { class: 'when' }, whenSeg, whenInput), radiusSel, plowToggle);

  const statusLine = h('p', { class: 'park-status small', 'aria-live': 'polite' });
  const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': 'Parking map' });
  const legendBody = h('div', { class: 'legend-body' },
    ...(['green', 'info', 'amber', 'red'] as const).map((k) => h('span', null, h('span', { class: 'swatch', style: `background:${STATUS_COLOR[k]}` }), STATUS_WORD[k])),
    h('span', null, h('span', { class: 'swatch dashed' }), 'Permit only'),
    h('span', null, h('span', { class: 'swatch dot-red' }), 'Closure'));
  const legend = h('details', { class: 'legend', open: window.matchMedia('(min-width: 900px)').matches }, h('summary', null, 'Legend'), legendBody);
  const list = h('ol', { class: 'blocks', 'aria-label': 'Metered blocks, best first' });
  const foot = h('p', { class: 'small muted park-foot' });

  root.append(h('div', { class: 'park' },
    h('div', { class: 'park-side' },
      h('header', { class: 'page-head' }, h('h1', null, 'Park')),
      form, results, controls, statusLine,
      h('div', { class: 'park-map-wrap mobile-only-map' }),
      list, foot),
    h('div', { class: 'park-map-wrap' }, mapEl, legend)));

  // On phones the map sits between the controls and the list; on desktop it fills the right column.
  const phone = window.matchMedia('(max-width: 899px)');
  const placeMap = () => {
    const wrap = phone.matches ? root.querySelector('.mobile-only-map') : root.querySelector('.park > .park-map-wrap');
    // The view was left (the router cleared root): stop listening.
    if (!wrap) { phone.removeEventListener('change', placeMap); return; }
    if (mapEl.parentElement !== wrap) { wrap.append(mapEl, legend); map?.invalidateSize(); }
  };
  placeMap();
  phone.addEventListener('change', placeMap);

  map = createMap(mapEl);
  const main = L.layerGroup().addTo(map), boxes = L.layerGroup(), plows = L.layerGroup();
  map.on('zoomend', () => { if (map!.getZoom() >= 17) boxes.addTo(map!); else boxes.remove(); });
  const rows = new Map<string, { line: L.Polyline; li: HTMLElement; b: ParkingBlock }>();
  let active: string | null = null;

  function highlight(id: string | null, from: 'map' | 'list') {
    if (active) { const r = rows.get(active); r?.line.setStyle({ weight: 7, opacity: 0.85 }); r?.li.classList.remove('active'); }
    active = id;
    if (!id) return;
    const r = rows.get(id)!;
    r.line.setStyle({ weight: 13, opacity: 1 }); r.line.bringToFront();
    r.li.classList.add('active');
    if (from === 'map') { r.li.hidden = false; r.li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else map!.panInside(r.line.getBounds().getCenter(), { padding: [40, 40] });
  }

  async function search() {
    const q = input.value.trim();
    clear(results); results.hidden = true;
    if (q.length < 3) { statusLine.textContent = 'Type at least 3 characters, then Search.'; return; }
    searchBtn.disabled = true; statusLine.textContent = 'Searching…';
    const hits = await api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => [] as GeoResult[]);
    searchBtn.disabled = false;
    if (!hits.length) { statusLine.textContent = "Couldn't find that address in Chicago."; return; }
    if (hits.length === 1) { choose(hits[0]); return; }
    statusLine.textContent = `${hits.length} matches — pick one:`;
    results.hidden = false;
    for (const g of hits) results.append(h('button', { type: 'button', role: 'option', class: 'result', onclick: () => choose(g) }, icon('pin', 16), h('span', null, g.label)));
    (results.firstElementChild as HTMLElement | null)?.focus();
  }
  input.addEventListener('input', () => { if (!input.value.trim()) { clear(results); results.hidden = true; } });
  radiusSel.addEventListener('change', () => { radius = Number(radiusSel.value); void load(); });
  whenInput.addEventListener('change', () => { at = whenInput.value || null; void load(); });
  plowToggle.addEventListener('click', async () => {
    const on = plowToggle.getAttribute('aria-pressed') !== 'true';
    plowToggle.setAttribute('aria-pressed', String(on));
    plows.clearLayers();
    if (!on) { plows.remove(); return; }
    const b = map!.getBounds();
    const found = await api<Plow[]>(`/api/plows?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(',')}`).catch(() => [] as Plow[]);
    // Tooltip/popup content is always a DOM node: Leaflet assigns string content to innerHTML, and
    // asset types, place labels and geocoder labels are untrusted city/OSM text.
    for (const p of found) L.circleMarker(toLatLng(p.point), { radius: 6, color: '#333', fillColor: '#ffd400', fillOpacity: 1 }).bindTooltip(h('span', null, `${p.type} · ${p.minutesAgo} min ago`)).addTo(plows);
    plows.addTo(map!);
    statusLine.textContent = `${plural(found.length, 'plow')} reporting in view (last 2 h).`;
  });

  function choose(g: GeoResult) {
    dest = g; input.value = g.label; clear(results); results.hidden = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(g)); } catch { /* storage unavailable */ }
    void load();
  }
  function locate() {
    if (!navigator.geolocation) { statusLine.textContent = 'Location isn’t available in this browser.'; return; }
    statusLine.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ label: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { statusLine.textContent = 'Location permission denied. Search for an address instead.'; }, { enableHighAccuracy: true, timeout: 10_000 });
  }

  async function load() {
    if (!dest) { empty(); return; }
    statusLine.textContent = 'Loading metered blocks…';
    list.setAttribute('aria-busy', 'true');
    const q = new URLSearchParams({ lat: String(dest.lat), lon: String(dest.lon), radius: String(radius) });
    if (at) q.set('at', at);
    let r: ParkingResult;
    try { r = await api<ParkingResult>(`/api/parking?${q}`); } catch (e) {
      statusLine.textContent = e instanceof ApiError ? e.message : 'Could not load parking.'; list.removeAttribute('aria-busy'); return;
    }
    list.removeAttribute('aria-busy');
    draw(r);
  }

  function empty() {
    clear(list);
    statusLine.textContent = '';
    list.append(h('li', { class: 'blocks-empty' }, emptyState('Find street parking', 'Search where you’re going (or use your location) to see metered blocks nearby, best first.', null, 'park')));
  }

  function draw(r: ParkingResult) {
    main.clearLayers(); boxes.clearLayers(); clear(list); rows.clear(); active = null;
    const center = toLatLng(r.center);
    const circle = L.circle(center, { radius: r.radiusM, color: '#6b7785', weight: 1.5, fill: false, dashArray: '4 6', interactive: false }).addTo(main);
    for (const z of r.permitZones) {
      const layer = z.line.length > 1
        ? L.polyline(z.line.map(toLatLng), { color: '#7b3fa0', weight: 5, dashArray: '6 6' })
        : L.circleMarker(toLatLng(z.line[0]), { radius: 6, color: '#7b3fa0' });
      layer.bindTooltip(h('span', null, z.label)).addTo(main);
    }
    for (const c of r.closures) if (c.point) {
      L.circleMarker(toLatLng(c.point), { radius: 7, color: '#d73027', fillColor: '#d73027', fillOpacity: 0.5 })
        .bindPopup(h('div', null, h('strong', null, c.streetClosure ? `${c.streetClosure} closure` : c.appType), h('div', null, c.location), h('div', null, `${fmtShortDate(c.start)} → ${fmtShortDate(c.end)}`))).addTo(main);
    }
    r.blocks.forEach((b, i) => {
      const line = L.polyline(b.paths.map((p) => p.map(toLatLng)), { color: STATUS_COLOR[b.status], weight: 7, opacity: 0.85 })
        .bindTooltip(h('span', null, `${b.from}–${b.to} ${b.street} · ${STATUS_WORD[b.status]}`), { sticky: true })
        .on('click', () => { highlight(b.blockId, 'map'); openBlock(b); })
        .addTo(main);
      const li = h('li', { class: 'block' },
        h('button', { type: 'button', class: 'block-btn', onclick: () => { highlight(b.blockId, 'list'); openBlock(b); }, onmouseenter: () => highlight(b.blockId, 'list') },
          h('span', { class: 'block-rank', style: `--c:${STATUS_COLOR[b.status]}` }, String(i + 1)),
          h('span', { class: 'block-main' },
            h('span', { class: 'block-title' }, `${b.from}–${b.to} ${b.street}`),
            h('span', { class: 'block-meta' }, `${fmtDistance(b.distanceM)} · ${b.spaces} spaces · ${b.hourLimit ? `${b.hourLimit} hr max` : 'limit: see sign'} · ${fmtRate(b.rate)}`),
            b.flags.length ? h('span', { class: 'block-flags' }, ...b.flags.map((f) => h('span', { class: `flag flag-${f.severity}` }, f.code === 'SUNDAY' ? 'Sunday' : f.code.replace('_', ' ').toLowerCase()))) : null),
          statusPill(b.status)));
      rows.set(b.blockId, { line, li, b });
      list.append(li);
    });
    for (const x of r.boxes) L.circleMarker(toLatLng(x.point), { radius: 4, color: '#444', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(h('span', null, `Pay box · area ${x.payArea}`)).addTo(boxes);
    pinMarker(r.center, dest?.label ?? 'Destination').addTo(main);
    map!.fitBounds(circle.getBounds(), { padding: [10, 10] });

    const when = at ? `${fmtDate(r.at.slice(0, 10))}, ${fmtTime(r.at)}` : 'now';
    const good = r.blocks.filter((b) => b.status === 'green' || b.status === 'info').length;
    statusLine.textContent = `${plural(r.blocks.length, 'metered block')} within ${fmtDistance(r.radiusM)} for ${when} · ${good} without warnings`;
    // Long lists: show the best 20 first (they are sorted best-first, then by distance).
    const LIMIT = 20;
    if (r.blocks.length > LIMIT) {
      const rest = [...list.children].slice(LIMIT) as HTMLElement[];
      for (const li of rest) li.hidden = true;
      const more = h('li', { class: 'blocks-more' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { for (const li of rest) li.hidden = false; more.remove(); } }, h('span', null, `Show all ${r.blocks.length} blocks`)));
      list.append(more);
    }
    if (r.warnings.length) statusLine.append(h('span', { class: 'warn-text' }, ` · ${r.warnings.join('; ')}`));
    if (!r.blocks.length) list.append(h('li', { class: 'blocks-empty' }, emptyState('No metered blocks here', 'Try a bigger radius — or this may be a residential area without meters.', null, 'park')));
    foot.textContent = `Rates are approximate (≈) — always check the meter and posted signs. Meter data as of ${fmtShortDate(r.dataAsOf.payBlocks)} · permits as of ${fmtShortDate(r.dataAsOf.permitsCurrent)}.`;
  }

  function openBlock(b: ParkingBlock) {
    const area = String(b.payArea);
    const side = b.parity === 'E' ? 'Even side' : b.parity === 'O' ? 'Odd side' : 'Both sides';
    const fact = (label: string, value: string | Node) => h('div', { class: 'fact' }, h('dt', null, label), h('dd', null, value));
    openSheet(h('div', { class: 'block-sheet' },
      h('div', { class: 'row between' }, statusPill(b.status), h('span', { class: 'small muted' }, `${fmtDistance(b.distanceM)} from destination`)),
      h('dl', { class: 'facts' },
        fact('Spaces', String(b.spaces)), fact('Time limit', b.hourLimit ? `${b.hourLimit} hr` : 'See sign'),
        fact('Rate', fmtRate(b.rate)), fact('Paid hours', b.rate.hoursText || 'See meter'), fact('Side', side)),
      h('div', { class: 'payarea' },
        h('div', null, h('div', { class: 'small muted' }, 'ParkChicago pay area'), h('div', { class: 'payarea-num' }, `#${area}`)),
        btn('Copy', { iconName: 'copy', onclick: () => copyText(area, `Pay area ${area} copied`) })),
      b.flags.length
        ? h('ul', { class: 'flags' }, ...b.flags.map((f) => h('li', { class: `flagrow flag-${f.severity}` }, icon(SEV_ICON[f.severity] ?? 'info', 18), h('span', null, f.reason))))
        : h('p', { class: 'muted' }, 'No issues in city data for this time. Always read the posted signs.'),
      h('div', { class: 'sheet-actions' },
        linkBtn(`Navigate · ${NAV_LABEL[me.navApp]}`, navUrl(me.navApp, b.navPoint), { variant: 'primary', iconName: 'nav', external: true }),
        linkBtn('Open ParkChicago', 'https://parkchicago.com', { iconName: 'external', external: true, onclick: () => { void copyText(area, `Pay area ${area} copied — paste it in ParkChicago`); } })),
      h('p', { class: 'small muted' }, 'Rates and hours are approximate (≈). The meter and signs on the block are the rule.')),
      { title: `${b.from}–${b.to} ${b.street}` });
  }

  if (dest) { input.value = dest.label; await load(); } else empty();
}
