import L from 'leaflet';
import { api } from '../api.js';
import { clear, h, icon, add } from '../dom.js';
import { fmtDate, fmtDistance } from '../format.js';
import { btn, busy, errorText, field, segmented, toast } from '../ui.js';
import { createMap, pinMarker, toLatLng, ZONE_COLORS, zoneLayer } from '../map.js';
import type { GeoResult, Place, PlaceKind, ZoneCandidate } from '../../shared/types.js';

/** Create a Leaflet map once the element is attached and laid out (flows are built before mounting). */
export function whenMounted(el: HTMLElement, cb: () => void, tries = 120): void {
  if (el.isConnected && el.clientHeight > 0) { cb(); return; }
  if (tries <= 0) return;
  requestAnimationFrame(() => whenMounted(el, cb, tries - 1));
}

const zoneName = (z: { ward: string; section: string }) => `Ward ${Number(z.ward)} · Section ${Number(z.section)}`;

/**
 * Sweeping-zone picker: the address point and every candidate zone drawn on a map, with a card per
 * zone. Tapping a card or a polygon toggles it. Boundary streets become a visual decision.
 */
export function zonePicker(point: { lat: number; lon: number }, initial: string[]): { el: HTMLElement; selected: () => string[]; ready: Promise<ZoneCandidate[]> } {
  const sel = new Set(initial);
  const mapEl = h('div', { class: 'mini-map tall', role: 'img', 'aria-label': 'Map of the sweeping zones near this address' });
  const list = h('div', { class: 'zone-list', role: 'group', 'aria-label': 'Sweeping zones' });
  const note = h('p', { class: 'small muted' }, 'Finding sweeping zones within 40 m…');
  const el = h('div', { class: 'zone-picker' }, note, mapEl, list);
  const ready = api<{ candidates: ZoneCandidate[] }>(`/api/zones?lat=${point.lat}&lon=${point.lon}`).then(({ candidates }) => {
    if (candidates.length === 1 && !initial.length) sel.add(candidates[0].wardSection);
    note.textContent = !candidates.length
      ? 'No sweeping zone within 40 m of this point. It may be a park, a private street or outside the program.'
      : candidates.length === 1
        ? 'One sweeping zone covers this address:'
        : `This address is near a zone boundary — ${candidates.length} zones are within 40 m. The two sides of a street can be swept on different days. Pick the zone(s) for the side(s) you park on:`;
    const layers = new Map<string, L.Polygon>();
    let map: L.Map | null = null;
    const redraw = () => {
      candidates.forEach((c, i) => {
        const on = sel.has(c.wardSection);
        layers.get(c.wardSection)?.setStyle({ weight: on ? 4 : 2, fillOpacity: on ? 0.28 : 0.08, dashArray: on ? '' : '6 6' });
        const b = list.children[i] as HTMLElement | undefined;
        b?.setAttribute('aria-pressed', String(on));
      });
    };
    const toggle = (ws: string) => { if (sel.has(ws)) sel.delete(ws); else sel.add(ws); redraw(); };
    candidates.forEach((c, i) => {
      const color = ZONE_COLORS[i % ZONE_COLORS.length];
      list.append(h('button', { type: 'button', class: 'zone-card', 'aria-pressed': String(sel.has(c.wardSection)), onclick: () => toggle(c.wardSection) },
        h('span', { class: 'zone-swatch', style: `background:${color}` }),
        h('span', { class: 'zone-text' },
          h('strong', null, zoneName(c)),
          h('span', { class: 'small' }, c.next.length ? `Next: ${c.next.map(fmtDate).join(' · ')}` : 'No more sweeps this season'),
          h('span', { class: 'small muted' }, c.containsPoint ? 'The address point is inside this zone' : `${fmtDistance(c.distanceM)} from the address point`)),
        h('span', { class: 'zone-check' }, icon('check', 18))));
    });
    whenMounted(mapEl, () => {
      map = createMap(mapEl);
      const group = L.featureGroup().addTo(map);
      candidates.forEach((c, i) => {
        const layer = zoneLayer(c.polygon, ZONE_COLORS[i % ZONE_COLORS.length], sel.has(c.wardSection))
          .bindTooltip(h('span', null, zoneName(c)), { sticky: true }).on('click', () => toggle(c.wardSection));
        layers.set(c.wardSection, layer); layer.addTo(group);
      });
      pinMarker([point.lon, point.lat], 'Your address').addTo(map);
      // Frame the address with ~120 m around it: the boundary matters, not the whole zone.
      map.fitBounds(L.latLng(point.lat, point.lon).toBounds(240), { padding: [8, 8] });
      redraw();
    });
    return candidates;
  }).catch((e) => { note.textContent = `Couldn't load sweeping zones: ${errorText(e)}`; return [] as ZoneCandidate[]; });
  return { el, selected: () => [...sel], ready };
}

export const RADII = [100, 300, 500, 1000] as const;
/** Radius picker with the circle drawn live on the map. */
export function radiusPicker(point: { lat: number; lon: number }, initial: number): { el: HTMLElement; value: () => number } {
  let r = (RADII as readonly number[]).includes(initial) ? initial : 300;
  const mapEl = h('div', { class: 'mini-map', role: 'img', 'aria-label': 'Map showing the watch radius' });
  let circle: L.Circle | null = null, map: L.Map | null = null;
  const seg = segmented('Watch radius', RADII.map((m) => ({ value: String(m), label: fmtDistance(m) })), String(r), (v) => {
    r = Number(v);
    circle?.setRadius(r);
    if (map && circle) map.fitBounds(circle.getBounds(), { padding: [12, 12] });
  });
  whenMounted(mapEl, () => {
    map = createMap(mapEl);
    circle = L.circle([point.lat, point.lon], { radius: r, color: '#1f6fd1', weight: 2, fillOpacity: 0.12 }).addTo(map);
    pinMarker([point.lon, point.lat], 'Watched place').addTo(map);
    map.fitBounds(circle.getBounds(), { padding: [12, 12] });
  });
  return { el: h('div', null, h('div', { class: 'label' }, 'Watch radius'), seg, h('p', { class: 'small muted' }, 'Street work, closures, events and 311 requests inside this circle are listed.'), mapEl), value: () => r };
}

/**
 * Add a place: search → see the resolved address on a map → "Is this the right place?" → (home) pick
 * the sweeping zone(s) on a map / (watch) pick the radius → save the exact point that was shown.
 */
export function placeFlow(opts: { kind?: PlaceKind; lockKind?: boolean; onDone: (p: Place | null) => void }): HTMLElement {
  const root = h('div', { class: 'flow' });
  const draft: { kind: PlaceKind; label: string; query: string } = { kind: opts.kind ?? 'home', label: opts.kind === 'watch' ? '' : 'Home', query: '' };

  const search = () => {
    clear(root);
    const labelIn = h('input', { value: draft.label, maxlength: 60, placeholder: draft.kind === 'home' ? 'Home' : 'e.g. Work, Mom’s', autocomplete: 'off' }) as HTMLInputElement;
    const addrIn = h('input', { type: 'search', value: draft.query, placeholder: 'e.g. 730 W Randolph St', autocomplete: 'street-address', enterkeyhint: 'search' }) as HTMLInputElement;
    const labelF = field('Name', labelIn, { hint: 'Appears in push notifications, so use a name, not the street address.' });
    const addrF = field('Address', addrIn, { hint: 'A Chicago street address. Search runs when you press Search (no autocomplete).' });
    const results = h('div', { class: 'results', 'aria-live': 'polite' });
    const go = btn('Search', { variant: 'primary', iconName: 'search' });
    const run = () => busy(go, 'Searching…', async () => {
      draft.label = labelIn.value.trim(); draft.query = addrIn.value.trim();
      labelF.setError(draft.label ? null : 'Give it a name.');
      addrF.setError(draft.query.length >= 3 ? null : 'Enter an address.');
      if (!draft.label || draft.query.length < 3) return;
      clear(results);
      const hits = await api<GeoResult[]>(`/api/geocode?q=${encodeURIComponent(draft.query)}`);
      if (!hits.length) { addrF.setError("Couldn't find that address in Chicago. Try the house number and street, e.g. 730 W Randolph St."); return; }
      confirm(hits);
    });
    go.addEventListener('click', run);
    addrIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void run(); } });
    const kindSeg = segmented('Place type', [{ value: 'home', label: 'Home street' }, { value: 'watch', label: 'Watched place' }], draft.kind, (v) => {
      draft.kind = v as PlaceKind;
      if (v === 'home' && !labelIn.value) labelIn.value = 'Home';
      kindHint.textContent = kindText();
    });
    const kindText = () => draft.kind === 'home'
      ? 'Where you park overnight: street-cleaning dates, calendar and winter alerts.'
      : 'A place you care about: street work, closures, events and 311 nearby.';
    const kindHint = h('p', { class: 'small muted' }, kindText());
    add(root, opts.lockKind ? null : h('div', { class: 'field' }, h('div', { class: 'label' }, 'Type'), kindSeg, kindHint), labelF.el, addrF.el, results,
      h('div', { class: 'row end flow-actions' }, btn('Cancel', { variant: 'ghost', onclick: () => opts.onDone(null) }), go));
    requestAnimationFrame(() => (draft.label ? addrIn : labelIn).focus({ preventScroll: true }));
  };

  const confirm = (hits: GeoResult[]) => {
    clear(root);
    let chosen = hits[0];
    const mapEl = h('div', { class: 'mini-map', role: 'img', 'aria-label': 'Map of the found address' });
    const addr = h('p', { class: 'resolved' }, icon('pin', 18), h('span', null, chosen.label));
    let map: L.Map | null = null, marker: L.CircleMarker | null = null;
    const show = (g: GeoResult) => {
      chosen = g; addr.lastChild!.textContent = g.label;
      if (map) { marker?.remove(); marker = pinMarker([g.lon, g.lat], 'Found address').addTo(map); map.setView([g.lat, g.lon], 17); }
    };
    const others = hits.length > 1 ? h('div', { class: 'alt-results', role: 'radiogroup', 'aria-label': 'Other matches' },
      h('div', { class: 'small muted' }, `${hits.length} matches — tap the right one:`),
      ...hits.map((g, i) => h('button', { type: 'button', role: 'radio', class: 'alt', 'aria-checked': String(i === 0), onclick: (e: Event) => {
        for (const b of (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.alt')) b.setAttribute('aria-checked', String(b === e.currentTarget));
        show(g);
      } }, g.label))) : null;
    add(root, h('h3', { class: 'flow-q' }, 'Is this the right place?'), addr, mapEl, others,
      h('p', { class: 'small muted' }, 'The pin is what gets saved. If it’s on the wrong block, search again with the house number.'),
      h('div', { class: 'row end flow-actions' }, btn('Search again', { iconName: 'search', onclick: search }),
        btn('Yes, that’s it', { variant: 'primary', iconName: 'check', onclick: () => (draft.kind === 'home' ? zones(chosen) : radius(chosen)) })));
    whenMounted(mapEl, () => { map = createMap(mapEl); show(chosen); });
  };

  const save = async (g: GeoResult, extra: { zones?: string[]; radiusM?: number }) => {
    const r = await api<{ place: Place }>('/api/places', { method: 'POST', body: { kind: draft.kind, label: draft.label, address: g.label, lat: g.lat, lon: g.lon, ...extra } });
    toast(`${draft.label} saved`, 'ok');
    opts.onDone(r.place);
  };

  const zones = (g: GeoResult) => {
    clear(root);
    const picker = zonePicker(g, []);
    const saveBtn = btn('Save home street', { variant: 'primary', iconName: 'check' });
    saveBtn.addEventListener('click', () => busy(saveBtn, 'Saving…', () => save(g, { zones: picker.selected() })));
    root.append(h('h3', { class: 'flow-q' }, 'Which sweeping zone is your side of the street?'), picker.el,
      h('div', { class: 'row end flow-actions' }, btn('Back', { variant: 'ghost', onclick: () => confirm([g]) }), saveBtn));
    void picker.ready.then((c) => { if (c.length > 1) saveBtn.querySelector('span')!.textContent = 'Save with selected zones'; });
  };

  const radius = (g: GeoResult) => {
    clear(root);
    const picker = radiusPicker(g, 300);
    const saveBtn = btn('Save watched place', { variant: 'primary', iconName: 'check' });
    saveBtn.addEventListener('click', () => busy(saveBtn, 'Saving…', () => save(g, { radiusM: picker.value() })));
    root.append(h('h3', { class: 'flow-q' }, 'How far around it should we watch?'), picker.el,
      h('div', { class: 'row end flow-actions' }, btn('Back', { variant: 'ghost', onclick: () => confirm([g]) }), saveBtn));
  };

  search();
  return root;
}

/** Edit an existing home's zones on the map. */
export function zoneEditor(p: Place, onDone: (p: Place | null) => void): HTMLElement {
  const picker = zonePicker(p, p.zones);
  const saveBtn = btn('Save zones', { variant: 'primary', iconName: 'check' });
  saveBtn.addEventListener('click', () => busy(saveBtn, 'Saving…', async () => {
    const r = await api<Place>(`/api/places/${p.id}`, { method: 'PATCH', body: { zones: picker.selected() } });
    toast('Zones saved', 'ok'); onDone(r);
  }));
  return h('div', { class: 'flow' }, h('p', { class: 'resolved' }, icon('pin', 18), h('span', null, p.address)), picker.el,
    h('div', { class: 'row end flow-actions' }, btn('Cancel', { variant: 'ghost', onclick: () => onDone(null) }), saveBtn));
}

/** Edit a watched place's radius with the circle on the map. */
export function radiusEditor(p: Place, onDone: (p: Place | null) => void): HTMLElement {
  const picker = radiusPicker(p, p.radiusM);
  const saveBtn = btn('Save radius', { variant: 'primary', iconName: 'check' });
  saveBtn.addEventListener('click', () => busy(saveBtn, 'Saving…', async () => {
    const r = await api<Place>(`/api/places/${p.id}`, { method: 'PATCH', body: { radiusM: picker.value() } });
    toast('Radius saved', 'ok'); onDone(r);
  }));
  return h('div', { class: 'flow' }, h('p', { class: 'resolved' }, icon('pin', 18), h('span', null, p.address)), picker.el,
    h('div', { class: 'row end flow-actions' }, btn('Cancel', { variant: 'ghost', onclick: () => onDone(null) }), saveBtn));
}

