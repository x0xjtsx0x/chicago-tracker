import { describe, it, expect } from 'vitest';
import { chicagoNow, datePart, timePart, addDays, weekday, normalizeSocrataTs, toChicagoLocal } from '../../src/server/util/chicagoTime.js';

describe('chicagoTime', () => {
  it('uses Chicago local date even when UTC has rolled over (CDT)', () => {
    // 2026-10-12T04:30Z == 2026-10-11 23:30 CDT
    expect(chicagoNow(new Date('2026-10-12T04:30:00Z'))).toBe('2026-10-11T23:30:00');
  });
  it('handles CST in winter', () => {
    expect(toChicagoLocal(new Date('2026-01-15T05:59:00Z'))).toBe('2026-01-14T23:59:00');
  });
  it('splits date and time', () => {
    expect(datePart('2026-10-11T23:30:00')).toBe('2026-10-11');
    expect(timePart('2026-10-11T07:05:00')).toBe('07:05');
  });
  it('adds days across month/year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weekday: 2026-10-11 is a Sunday', () => {
    expect(weekday('2026-10-11')).toBe(0);
  });
  it('normalizes socrata timestamps', () => {
    expect(normalizeSocrataTs('2018-08-01T00:00:00.000')).toBe('2018-08-01T00:00:00');
    expect(normalizeSocrataTs('2018-08-30T23:59:59.000')).toBe('2018-08-30T23:59:59');
    expect(normalizeSocrataTs(undefined)).toBe('');
  });
});
