import type { BlockStatus, RateInfo } from '../shared/types.js';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function chicagoNowLocal(d: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const chicagoToday = (d: Date = new Date()): string => chicagoNowLocal(d).slice(0, 10);
export const fmtRate = (r: RateInfo): string => `≈ $${r.hourly.toFixed(2)}/hr`;
export function fmtDistance(m: number): string {
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.round(ft / 50) * 50 || 50} ft` : `${(m / 1609.344).toFixed(2)} mi`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const daysUntil = (today: string, date: string): number =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
export const isWinterMonth = (date: string): boolean => { const m = Number(date.slice(5, 7)); return m === 12 || m <= 3; };
// Map line colours: chosen to stay distinguishable on OSM tiles in both themes and for common colour-vision deficiencies (paired with words/icons everywhere).
export const STATUS_COLOR: Record<BlockStatus, string> = { green: '#1a9850', info: '#2f6db5', amber: '#e08a00', red: '#d73027' };
export const UTIL_LABEL = { comed: '⚡ ComEd', peoplesgas: '🔥 Peoples Gas', water: '💧 Water', telecom: '📡 Telecom' } as const;

/** 'YYYY-MM-DDTHH:mm[:ss]' Chicago-local → '5:42 PM'. */
export function fmtTime(local: string | null | undefined): string {
  if (!local || local.length < 16) return '—';
  const hh = Number(local.slice(11, 13)), mm = local.slice(14, 16);
  return `${hh % 12 || 12}:${mm} ${hh < 12 ? 'AM' : 'PM'}`;
}
/** Minutes between two Chicago-local timestamps (b − a). */
export const minutesBetween = (a: string, b: string): number => Math.round((Date.parse(`${b.slice(0, 16)}:00Z`) - Date.parse(`${a.slice(0, 16)}:00Z`)) / 60_000);
/** 'just now', '12 min ago', '3 h ago', 'Mon Oct 12, 5:42 PM'. */
export function fmtAgo(local: string | null | undefined, now: string = chicagoNowLocal()): string {
  if (!local) return 'never';
  const m = minutesBetween(local, now);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`;
  return `${fmtDate(local.slice(0, 10))}, ${fmtTime(local)}`;
}
/** '2026-10-11T03:31:00' or ISO → 'Oct 11'. */
export const fmtShortDate = (s: string | null | undefined): string => (s ? fmtDate(s.slice(0, 10)).slice(4) : '—');
export function countdownText(days: number): string {
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const NAV_LABEL = { apple: 'Apple Maps', google: 'Google Maps', waze: 'Waze' } as const;
export const STATUS_WORD = { green: 'Looks good', info: 'Note', amber: 'Caution', red: 'Avoid' } as const;
export const DATASET_LABEL: Record<string, string> = {
  payBlocks: 'Metered blocks', payBoxes: 'Pay boxes', cbd: 'Downtown boundary', snowRoutes: '2-inch snow ban streets',
  sweepSchedule: 'Sweeping schedule', sweepZones: 'Sweeping zones', permitZones: 'Residential permit zones',
  permitsClosures: 'Street closures', permitsCurrent: 'Street work permits', permitsBlockParty: 'Block parties',
  permitsFilming: 'Filming permits', specialEvents: 'Special events',
};
