import type { Vehicle, VehicleMatch, VehicleSearch, VehicleStatus } from '../../shared/types.js';
import { isMissingState, normalizePlate, PLATE_RE, stateByCode, stateMatches } from '../../shared/plates.js';
import { normalizeSocrataTs } from '../util/chicagoTime.js';

export { normalizePlate, PLATE_RE };
/** Retained for callers that only need the shape; the API validates against the full state list. */
export const STATE_RE = /^[A-Z]{2}$/;
const join = (...xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join(' ');
const clean = (x: unknown): string | null => (x === undefined || x === null || String(x).trim() === '' ? null : String(x).trim());

export function mapTowed(r: any): VehicleMatch {
  return {
    kind: 'towed', key: `tow:${r.inventory_number}`, date: normalizeSocrataTs(r.tow_date).slice(0, 10),
    details: `${join(r.make, r.color)} — inventory #${r.inventory_number}`,
    address: String(r.towed_to_address ?? ''), phone: r.tow_facility_phone ?? null,
    make: clean(r.make), color: clean(r.color), recordState: clean(r.state),
  };
}

export function mapRelocated(r: any): VehicleMatch {
  return {
    kind: 'relocated', key: `reloc:${r.service_request_number}`, date: normalizeSocrataTs(r.relocated_date).slice(0, 10),
    details: `${r.relocated_reason ?? 'Relocated'} — moved from ${join(r.relocated_from_address_number, r.relocated_from_street_direction, r.relocated_from_street_name, r.relocated_from_suffix)}`,
    address: join(r.relocated_to_address_number, r.relocated_to_direction, r.relocated_to_street_name, r.relocated_to_suffix),
    phone: null,
    make: clean(r.make), color: clean(r.color), recordState: clean(r.state),
  };
}

export const DATASET_WINDOW_DAYS = 90;

export function describeSearch(v: Pick<Vehicle, 'plate' | 'state'>, ds: { towed: string; relocated: string }, alertSince: string): VehicleSearch {
  return {
    plate: v.plate, state: v.state, stateCodes: stateByCode(v.state)?.cityCodes ?? [v.state],
    datasets: [{ id: ds.towed, name: 'Towed Vehicles' }, { id: ds.relocated, name: 'Relocated Vehicles' }],
    alertSince, datasetWindowDays: DATASET_WINDOW_DAYS,
  };
}

/**
 * Sort every record for this plate (any state) into what the owner must see:
 * - matches: same plate, same state (or no state recorded → "possible"), on/after alertSince → red card + push
 * - older:   same as above but before alertSince → history, never pushed
 * - otherState: same plate under a different state → "did you pick the wrong state?", never pushed
 */
export function classifyMatches(v: Pick<Vehicle, 'state'>, rows: VehicleMatch[], alertSince: string): Pick<VehicleStatus, 'matches' | 'older' | 'otherState'> {
  const matches: VehicleMatch[] = [], older: VehicleMatch[] = [], otherState: VehicleMatch[] = [];
  const byDateDesc = (a: VehicleMatch, b: VehicleMatch) => b.date.localeCompare(a.date);
  for (const m of [...rows].sort(byDateDesc)) {
    if (stateMatches(v.state, m.recordState)) (m.date >= alertSince ? matches : older).push({ ...m, confidence: 'exact' });
    else if (isMissingState(m.recordState)) (m.date >= alertSince ? matches : older).push({ ...m, confidence: 'possible' });
    else otherState.push(m);
  }
  return { matches, older, otherState };
}
