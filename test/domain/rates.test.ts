import { describe, it, expect } from 'vitest';
import { rateFor } from '../../src/server/domain/rates.js';
import { loadConfig } from '../../src/server/config.js';

const { rates } = loadConfig({ OWNER_LOGIN: 'o', PUBLIC_BASE_URL: 'https://x', NOMINATIM_CONTACT: 'c' }, 'config');

describe('rateFor', () => {
  it('Loop', () => expect(rateFor([-87.6278, 41.8819], rates, null)).toMatchObject({ tier: 'loop', hourly: 7, approximate: true }));
  it('CBD via fallback polygon when the city layer is missing', () => expect(rateFor([-87.6298, 41.8995], rates, null).tier).toBe('cbd'));
  it('CBD via city layer takes precedence', () => {
    const cbd = [[[[-87.70, 41.95], [-87.69, 41.95], [-87.69, 41.96], [-87.70, 41.96], [-87.70, 41.95]]]] as any;
    expect(rateFor([-87.695, 41.955], rates, cbd).tier).toBe('cbd');
    expect(rateFor([-87.6298, 41.8995], rates, cbd).tier).toBe('neighborhood');
  });
  it('West Loop', () => expect(rateFor([-87.6560, 41.8840], rates, null).tier).toBe('westloop'));
  it('Neighborhood', () => expect(rateFor([-87.6870, 41.9220], rates, null)).toMatchObject({ tier: 'neighborhood', hourly: 2.5 }));
});
