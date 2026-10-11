import { describe, it, expect } from 'vitest';
import { navUrl } from '../../src/shared/deeplinks.js';

describe('navUrl', () => {
  it('coordinates', () => {
    expect(navUrl('apple', [-87.647, 41.8845])).toBe('https://maps.apple.com/?daddr=41.8845,-87.647&dirflg=d');
    expect(navUrl('google', [-87.647, 41.8845])).toBe('https://www.google.com/maps/dir/?api=1&destination=41.8845,-87.647&travelmode=driving');
    expect(navUrl('waze', [-87.647, 41.8845])).toBe('https://waze.com/ul?ll=41.8845,-87.647&navigate=yes');
  });
  it('address strings are encoded', () => {
    expect(navUrl('apple', '701 N. Sacramento, Chicago, IL')).toBe('https://maps.apple.com/?daddr=701%20N.%20Sacramento%2C%20Chicago%2C%20IL&dirflg=d');
    expect(navUrl('waze', '1 N State St, Chicago, IL')).toBe('https://waze.com/ul?q=1%20N%20State%20St%2C%20Chicago%2C%20IL&navigate=yes');
  });
});
