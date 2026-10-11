import type { LngLat, Parcel, PermitZoneFeature, PermitZoneRow } from '../../shared/types.js';

/** Uppercase, drop periods, collapse whitespace: "St." / "ST" / " st " all compare equal. */
export const normStreetPart = (s: string): string => (s ?? '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

export function matchPermitZones(parcels: Parcel[], rows: PermitZoneRow[]): PermitZoneFeature[] {
  const byStreet = new Map<string, PermitZoneRow[]>();
  for (const r of rows) {
    const k = `${normStreetPart(r.dir)}|${normStreetPart(r.name)}`;
    byStreet.set(k, [...(byStreet.get(k) ?? []), r]);
  }
  const groups = new Map<string, { zone: string; street: string; parity: 'O' | 'E'; pts: { n: number; c: LngLat }[] }>();
  for (const p of parcels) {
    const n = p.low;
    if (!n) continue;
    const parity: 'O' | 'E' = n % 2 ? 'O' : 'E';
    const pType = normStreetPart(p.type);
    for (const r of byStreet.get(`${normStreetPart(p.dir)}|${normStreetPart(p.name)}`) ?? []) {
      const rType = normStreetPart(r.type);
      if (rType && pType && rType !== pType) continue;
      if (n < r.low || n > r.high) continue;
      if (r.oddEven !== 'B' && r.oddEven !== parity) continue;
      const street = [normStreetPart(p.dir), normStreetPart(p.name), pType || rType].filter(Boolean).join(' ');
      const key = `${r.zone}|${street}|${parity}`;
      const g = groups.get(key) ?? { zone: r.zone, street, parity, pts: [] };
      g.pts.push({ n, c: p.centroid });
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => ({
    zone: g.zone, street: g.street, parity: g.parity,
    line: g.pts.sort((a, b) => a.n - b.n).map((x) => x.c),
    label: `Permit zone ${g.zone} — residents only`,
  }));
}
