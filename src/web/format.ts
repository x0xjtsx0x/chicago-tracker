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
export const STATUS_COLOR: Record<BlockStatus, string> = { green: '#1a9850', info: '#4575b4', amber: '#f39c12', red: '#d73027' };
export const UTIL_LABEL = { comed: '⚡ ComEd', peoplesgas: '🔥 Peoples Gas', water: '💧 Water', telecom: '📡 Telecom' } as const;
