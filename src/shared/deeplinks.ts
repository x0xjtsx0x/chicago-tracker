import type { LngLat, NavApp } from './types.js';

export function navUrl(app: NavApp, dest: LngLat | string): string {
  if (typeof dest === 'string') {
    const q = encodeURIComponent(dest);
    if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
    if (app === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`;
    return `https://maps.apple.com/?daddr=${q}&dirflg=d`;
  }
  const ll = `${dest[1]},${dest[0]}`;
  if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`;
  return `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
}
