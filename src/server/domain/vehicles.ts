import type { VehicleMatch } from '../../shared/types.js';
import { normalizeSocrataTs } from '../util/chicagoTime.js';

export const normalizePlate = (s: string): string => (s ?? '').toUpperCase().replace(/[\s-]/g, '');
export const PLATE_RE = /^[A-Z0-9]{2,8}$/;
export const STATE_RE = /^[A-Z]{2}$/;
const join = (...xs: unknown[]) => xs.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join(' ');

export function mapTowed(r: any): VehicleMatch {
  return {
    kind: 'towed', key: `tow:${r.inventory_number}`, date: normalizeSocrataTs(r.tow_date).slice(0, 10),
    details: `${join(r.make, r.color)} — inventory #${r.inventory_number}`,
    address: String(r.towed_to_address ?? ''), phone: r.tow_facility_phone ?? null,
  };
}

export function mapRelocated(r: any): VehicleMatch {
  return {
    kind: 'relocated', key: `reloc:${r.service_request_number}`, date: normalizeSocrataTs(r.relocated_date).slice(0, 10),
    details: `${r.relocated_reason ?? 'Relocated'} — moved from ${join(r.relocated_from_address_number, r.relocated_from_street_direction, r.relocated_from_street_name, r.relocated_from_suffix)}`,
    address: join(r.relocated_to_address_number, r.relocated_to_direction, r.relocated_to_street_name, r.relocated_to_suffix),
    phone: null,
  };
}
