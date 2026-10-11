/**
 * Map tile settings, kept free of Leaflet so tests can import them in Node.
 *
 * The server sends `Referrer-Policy: no-referrer` on every response (spec §9), so by default tile
 * requests carried no Referer at all — and the OSM tile servers reject those ("Access blocked — App
 * is not following the tile usage policy", https://operations.osmfoundation.org/policies/tiles/).
 * The tile <img> elements alone opt back in with `strict-origin-when-cross-origin`: a cross-origin
 * tile request then carries just the app's origin (scheme + host + port, never the path or hash),
 * while every other request keeps the global no-referrer policy.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_REFERRER_POLICY = 'strict-origin-when-cross-origin' as const;
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';
export const TILE_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

export const tileLayerOptions = () => ({
  maxZoom: 19,
  // Leaflet ≥1.9 sets this on every tile <img> (HTMLImageElement.referrerPolicy).
  referrerPolicy: TILE_REFERRER_POLICY,
  // The attribution control is built from DOM nodes in map.ts (OSM requires visible attribution).
  attribution: '',
});
