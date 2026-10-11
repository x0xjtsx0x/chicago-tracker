import { describe, it, expect } from 'vitest';
import { checkPlate, crossCheck, decodeColor, decodeMake, isKnownState, STATES, stateMatches } from '../../src/shared/plates.js';

describe('plates', () => {
  it('normalizes and validates', () => {
    expect(checkPlate('abc-1234', 'IL')).toMatchObject({ normalized: 'ABC1234', error: null });
    expect(checkPlate(' ab 12345 ', 'IL')).toEqual({ normalized: 'AB12345', error: null, warnings: [] });
    expect(checkPlate('A', 'IL').error).toMatch(/too short/);
    expect(checkPlate('ABCDEFGHJ', 'IL').error).toMatch(/at most 8/);
    expect(checkPlate('AB_12', 'IL').error).toMatch(/remove “_”/);
    expect(checkPlate('', 'IL').error).toMatch(/Enter/);
  });
  it('IL format hints are soft warnings, not errors', () => {
    expect(checkPlate('A123456', 'IL').warnings).toEqual([]);
    const vanity = checkPlate('GOBEARS', 'IL');
    expect(vanity.error).toBeNull();
    expect(vanity.warnings.join(' ')).toMatch(/AB 12345/);
    expect(checkPlate('ABCD1234', 'IL').warnings.join(' ')).toMatch(/at most 7/);
    expect(checkPlate('GBEARS', 'WI').warnings).toEqual([]);
    expect(checkPlate('AB1O234', 'IL').warnings).toEqual([expect.stringMatching(/^Did you mean AB10234\?/)]);
    expect(checkPlate('GOBEARS', 'WI').warnings.join(' ')).toMatch(/letter O or I/);
    expect(checkPlate('AB10234', 'IL').warnings).toEqual([]);
  });
  it('covers 50 states + DC + territories + provinces, IL first-class', () => {
    expect(STATES.filter((s) => s.region === 'us')).toHaveLength(51);
    expect(isKnownState('IL')).toBe(true);
    expect(isKnownState('ZZ')).toBe(false);
    expect(stateMatches('IL', 'il')).toBe(true);
    expect(stateMatches('NE', 'NB')).toBe(true);
  });
  it('decodes city make/colour codes and names', () => {
    expect(decodeMake('TOYT')?.key).toBe('toyota');
    expect(decodeMake('Toyota')?.key).toBe('toyota');
    expect(decodeMake('Kia Motors Corp')?.key).toBe('kia');
    expect(decodeMake('MERZ')?.key).toBe('mercedes');
    expect(decodeMake('Mercedes')?.key).toBe('mercedes');
    expect(decodeMake('MERC')?.key).toBe('mercury');
    expect(decodeMake('TRLR')).toBeUndefined();
    expect(decodeColor('WHI')?.key).toBe('white');
    expect(decodeColor('Gray')?.key).toBe('gray');
    expect(decodeColor('DBL')?.family).toBe('blue');
  });
  it('cross-check flags a disagreeing record and tolerates near shades', () => {
    expect(crossCheck({ make: 'honda', color: 'black' }, { make: 'TOYT', color: 'WHI' }))
      .toEqual({ verdict: 'mismatch', recordText: 'WHITE TOYOTA', problems: ['make is Toyota, yours is Honda', 'colour is White, yours is Black'] });
    expect(crossCheck({ make: 'honda', color: 'gray' }, { make: 'Honda', color: 'Silver' }).verdict).toBe('consistent');
    expect(crossCheck({ make: '', color: '' }, { make: 'TOYT', color: 'WHI' }).verdict).toBe('unknown');
    expect(crossCheck({ make: 'honda', color: '' }, { make: null, color: null })).toMatchObject({ verdict: 'unknown', recordText: 'NO MAKE OR COLOUR' });
  });
});
