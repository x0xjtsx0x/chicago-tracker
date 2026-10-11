import type { RatesConfig } from '../config.js';
import type { LngLat, MultiPolygonCoords, RateInfo, RateTier } from '../../shared/types.js';
import { inMultiPolygon } from './geo.js';

/** Loop → CBD (city layer, else config fallback) → West Loop → Neighborhood. Always approximate. */
export function rateFor(p: LngLat, rates: RatesConfig, cbd: MultiPolygonCoords | null): RateInfo {
  const info = (tier: RateTier): RateInfo => ({ tier, hourly: rates[tier].hourly, hoursText: rates[tier].hoursText, approximate: true });
  if (inMultiPolygon(p, [rates.loop.polygon])) return info('loop');
  if (inMultiPolygon(p, cbd ?? [rates.cbd.fallbackPolygon])) return info('cbd');
  if (inMultiPolygon(p, [rates.westloop.polygon])) return info('westloop');
  return info('neighborhood');
}
