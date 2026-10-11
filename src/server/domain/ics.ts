import type { Place } from '../../shared/types.js';
import type { SweepIndex } from './sweeping.js';

export interface IcsEvent { uid: string; date: string; summary: string; description: string }

// RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped in TEXT values.
// (In a JS literal '\;' is just ';', so the semicolon must be written '\\;'.)
export const icsEscape = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 §3.1: lines ≤ 75 octets; continuation lines start with one space. Never split a UTF-8 sequence. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > limit) { out.push(cur); cur = ''; limit = 74; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:America/Chicago',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildIcs(calName: string, events: IcsEvent[], dtstampUtc: string): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//chicago-tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`, 'X-WR-TIMEZONE:America/Chicago',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...VTIMEZONE,
  ];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${dtstampUtc}`,
      `DTSTART;TZID=America/Chicago:${d}T090000`, `DTEND;TZID=America/Chicago:${d}T140000`,
      `SUMMARY:${icsEscape(e.summary)}`, `DESCRIPTION:${icsEscape(e.description)}`, 'TRANSP:TRANSPARENT',
      // Relative to the 09:00 start: -14h = 19:00 the day before, -2h = 07:00 the same day.
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Move your car — street cleaning tomorrow', 'TRIGGER:-PT14H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Street cleaning today 9am–2pm', 'TRIGGER:-PT2H', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function sweepingEvents(homes: Place[], idx: SweepIndex): IcsEvent[] {
  const byZone = new Map<string, string[]>();
  for (const h of homes) for (const ws of h.zones) byZone.set(ws, [...(byZone.get(ws) ?? []), h.label]);
  const events: IcsEvent[] = [];
  for (const [ws, labels] of byZone) {
    for (const date of idx.get(ws) ?? []) {
      events.push({
        uid: `${ws}-${date}@chicago-tracker`, date,
        summary: `Street cleaning — ${[...new Set(labels)].join(', ')} (Ward ${ws.slice(0, 2)} Sec ${ws.slice(2)})`,
        description: 'Typical posted window 9am–2pm. Check the temporary orange signs on your block.',
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}
