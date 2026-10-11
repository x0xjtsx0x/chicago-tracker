import type { UtilitiesConfig } from '../config.js';
import type { DataSnapshot } from '../data/cache.js';
import type { LngLat, Permit, Place, Request311, Request311Group, WatchItem, WatchResult } from '../../shared/types.js';
import { distM } from './geo.js';
import { utilityTag } from './utilityTag.js';
import { addDays } from '../util/chicagoTime.js';

function permitItem(p: Permit, center: LngLat, utilities: UtilitiesConfig): WatchItem {
  const closure = p.streetClosure ? ` (${p.streetClosure} closure)` : '';
  return {
    id: p.id, kind: 'permit', dataset: p.dataset, title: `${p.workType || p.appType}${closure}`,
    start: p.start, end: p.end, location: p.location,
    description: [p.detail, p.comments].filter(Boolean).join(' — ') || p.appType,
    distanceM: Math.round(distM(center, p.point!)), utility: utilityTag(p, utilities), point: p.point,
  };
}

/** Permits within the place radius overlapping [today, today + days], deduplicated by uniquekey. */
function permitsInWindow(snap: DataSnapshot, place: Place, today: string, days: number): Permit[] {
  const center: LngLat = [place.lon, place.lat];
  const from = `${today}T00:00:00`, to = `${addDays(today, days)}T23:59:59`;
  const seen = new Set<string>();
  return snap.permits.filter((p) => {
    if (!p.point || p.end < from || p.start > to || distM(center, p.point) > place.radiusM || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export function group311(reqs: Request311[], center: LngLat, radiusM: number, excluded: string[]): Request311Group[] {
  const ex = new Set(excluded.map((s) => s.toUpperCase()));
  const groups = new Map<string, Request311Group>();
  for (const r of reqs) {
    if (r.duplicate || !r.point || ex.has(r.type.toUpperCase())) continue;
    const d = distM(center, r.point);
    if (d > radiusM) continue;
    const g = groups.get(r.type) ?? { type: r.type, count: 0, items: [] };
    g.count++; g.items.push({ ...r, distanceM: Math.round(d) });
    groups.set(r.type, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.created.localeCompare(a.created)) }));
}

export function buildWatch(inp: {
  snap: DataSnapshot; place: Place; today: string; days: number; utilities: UtilitiesConfig;
  requests: Request311[]; excluded311: string[]; sweeping: string[]; dataAsOf: Record<string, string | null>;
}): WatchResult {
  const center: LngLat = [inp.place.lon, inp.place.lat];
  const end = addDays(inp.today, inp.days);
  const permits = permitsInWindow(inp.snap, inp.place, inp.today, inp.days).map((p) => permitItem(p, center, inp.utilities));
  const events: WatchItem[] = inp.snap.events
    .filter((e) => e.point && e.date >= inp.today && e.date <= end && distM(center, e.point) <= inp.place.radiusM)
    .map((e) => ({
      id: e.id, kind: 'event', dataset: 'event', title: `${e.type}: ${e.details}`, start: `${e.date}T00:00:00`, end: `${e.date}T23:59:59`,
      location: e.venueAddress, description: e.startTime && e.startTime !== 'N/A' ? `Starts ${e.startTime}` : '',
      distanceM: Math.round(distM(center, e.point!)), utility: null, point: e.point,
    }));
  const items = [...permits, ...events].sort((a, b) => a.start.localeCompare(b.start) || a.distanceM - b.distanceM);
  return {
    placeId: inp.place.id, items, requests311: group311(inp.requests, center, inp.place.radiusM, inp.excluded311),
    sweeping: inp.sweeping, dataAsOf: inp.dataAsOf,
  };
}

export function newWorkCandidates(snap: DataSnapshot, place: Place, today: string, utilities: UtilitiesConfig): WatchItem[] {
  const center: LngLat = [place.lon, place.lat];
  return permitsInWindow(snap, place, today, 14)
    .filter((p) => utilityTag(p, utilities) !== null || /full/i.test(p.streetClosure ?? ''))
    .map((p) => permitItem(p, center, utilities));
}
