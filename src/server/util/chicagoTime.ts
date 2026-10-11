const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Chicago wall-clock time as naive 'YYYY-MM-DDTHH:mm:ss'. */
export function toChicagoLocal(d: Date): string {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const chicagoNow = (d: Date = new Date()): string => toChicagoLocal(d);
export const datePart = (local: string): string => local.slice(0, 10);
export const timePart = (local: string): string => local.slice(11, 16);
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday */
export const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
/** Socrata floating timestamp → naive 'YYYY-MM-DDTHH:mm:ss' ('' when missing). */
export function normalizeSocrataTs(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/\.\d+$/, '').replace(/Z$/, '').slice(0, 19);
}
