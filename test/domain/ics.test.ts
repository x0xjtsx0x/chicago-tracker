import { describe, it, expect } from 'vitest';
import { buildIcs, sweepingEvents, icsEscape } from '../../src/server/domain/ics.js';
import { buildSweepIndex } from '../../src/server/domain/sweeping.js';
import type { Place } from '../../src/shared/types.js';

const home = (id: number, label: string, zones: string[]): Place => ({ id, userId: 1, kind: 'home', label, address: 'x', lat: 0, lon: 0, radiusM: 300, zones });

describe('ics', () => {
  const idx = buildSweepIndex([{ wardSection: '3204', month: 10, days: [14] }], 2026);
  it('builds a valid calendar with timezone, alarms and stable UIDs', () => {
    const ev = sweepingEvents([home(1, 'Home A', ['3204']), home(2, 'Home B', ['3204'])], idx);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Street cleaning — Home A, Home B (Ward 32 Sec 04)');
    const ics = buildIcs('Chicago street cleaning', ev, '20261011T120000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Chicago');
    expect(ics).toContain('UID:3204-2026-10-14@chicago-tracker');
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20261014T090000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20261014T140000');
    expect(ics).toContain('TRIGGER:-PT14H');
    expect(ics).toContain('TRIGGER:-PT2H');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });
  it('is still valid with zero events (off-season)', () => {
    const ics = buildIcs('x', [], '20261211T120000Z');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });
  it('escapes text', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
  });
  it('folds long lines on UTF-8 boundaries', () => {
    const ics = buildIcs('x', [{ uid: 'u', date: '2026-10-14', summary: '—'.repeat(60), description: 'd' }], '20261011T120000Z');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${'—'.repeat(60)}`);
  });
});
