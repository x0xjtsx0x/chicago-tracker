import { describe, it, expect } from 'vitest';
import { fmtRate, fmtDistance, fmtDate, daysUntil, chicagoToday, isWinterMonth } from '../../src/web/format.js';

describe('format', () => {
  it('rate is approximate', () => expect(fmtRate({ tier: 'neighborhood', hourly: 2.5, hoursText: '', approximate: true })).toBe('≈ $2.50/hr'));
  it('distance in feet then miles', () => {
    expect(fmtDistance(30)).toBe('100 ft');
    expect(fmtDistance(400)).toBe('0.25 mi');
  });
  it('dates', () => {
    expect(fmtDate('2026-10-14')).toBe('Wed Oct 14');
    expect(daysUntil('2026-10-11', '2026-10-14')).toBe(3);
    expect(chicagoToday(new Date('2026-10-12T04:30:00Z'))).toBe('2026-10-11');
    expect(isWinterMonth('2026-12-01')).toBe(true);
    expect(isWinterMonth('2026-10-01')).toBe(false);
  });
});
