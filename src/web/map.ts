import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { h } from './dom.js';
import { TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, TILE_URL, tileLayerOptions } from './mapConfig.js';
import type { LngLat, MultiPolygonCoords } from '../shared/types.js';

export const toLatLng = (p: LngLat): L.LatLngTuple => [p[1], p[0]];
export const CHICAGO: L.LatLngTuple = [41.8819, -87.6278];

/**
 * A Leaflet map with OSM tiles that send a Referer (see mapConfig.ts) and a visible attribution
 * built from DOM nodes. Leaflet's attribution control takes HTML strings, so it is replaced by a
 * plain control whose content is a real <a> element.
 */
export function createMap(el: HTMLElement, opts: L.MapOptions & { interactive?: boolean } = {}): L.Map {
  const { interactive = true, ...rest } = opts;
  const map = L.map(el, {
    zoomControl: interactive, attributionControl: false,
    dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive, boxZoom: interactive, keyboard: interactive,
    ...rest,
  }).setView(CHICAGO, 13);
  L.tileLayer(TILE_URL, tileLayerOptions()).addTo(map);
  const Attribution = L.Control.extend({
    onAdd: () => {
      const box = h('div', { class: 'map-attrib' }, h('a', { href: TILE_ATTRIBUTION_URL, target: '_blank', rel: 'noopener noreferrer' }, TILE_ATTRIBUTION));
      L.DomEvent.disableClickPropagation(box);
      return box;
    },
  });
  new Attribution({ position: 'bottomright' }).addTo(map);
  // Maps created inside sheets or hidden steps need a size recalculation once visible.
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  map.on('unload', () => ro.disconnect());
  return map;
}

/** A destination/home pin drawn as a vector (no image assets, works in light and dark). */
export function pinMarker(p: LngLat, label: string): L.CircleMarker {
  return L.circleMarker(toLatLng(p), { radius: 9, color: '#ffffff', weight: 3, fillColor: '#e4002b', fillOpacity: 1, className: 'pin-marker' })
    .bindTooltip(h('span', null, label), { direction: 'top', offset: [0, -8] });
}

export const ZONE_COLORS = ['#1f6fd1', '#d9480f', '#2b8a3e', '#9c36b5'];
export function zoneLayer(mp: MultiPolygonCoords, color: string, selected: boolean): L.Polygon {
  return L.polygon(mp.map((poly) => poly.map((ring) => ring.map(toLatLng))), {
    color, weight: selected ? 4 : 2, opacity: 0.95, fillColor: color, fillOpacity: selected ? 0.28 : 0.08, dashArray: selected ? undefined : '6 6',
  });
}
