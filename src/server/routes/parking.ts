import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { PermitZoneFeature } from '../../shared/types.js';
import { buildParking } from '../domain/parking.js';
import { matchPermitZones } from '../domain/permitZones.js';
import { sweepIndexFor } from '../domain/sweeping.js';

export const CHI = { minLat: 41.62, maxLat: 42.03, minLon: -87.95, maxLon: -87.52 };
export const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function registerParking(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { lat?: string; lon?: string; radius?: string; at?: string } }>('/api/parking', async (req, reply) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!(lat >= CHI.minLat && lat <= CHI.maxLat && lon >= CHI.minLon && lon <= CHI.maxLon)) {
      return reply.code(400).send({ error: 'lat/lon must be inside Chicago' });
    }
    const radiusM = Math.min(1500, Math.max(100, Number(req.query.radius ?? 400) || 400));
    let at = req.query.at ?? deps.nowLocal();
    if (!AT_RE.test(at) || Number.isNaN(Date.parse(`${at}Z`))) return reply.code(400).send({ error: 'at must be YYYY-MM-DDTHH:mm (Chicago local)' });
    if (at.length === 16) at += ':00';

    const warnings: string[] = [];
    let permitZones: PermitZoneFeature[] = [];
    try {
      permitZones = matchPermitZones(await deps.services.parcelsNear([lon, lat], radiusM), deps.cache.snap.permitZones);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'parcel lookup failed');
      warnings.push('Permit-zone info unavailable');
    }
    return buildParking({
      snap: deps.cache.snap, center: [lon, lat], radiusM, at, rates: deps.cfg.rates,
      closureRedPattern: deps.cfg.datasets.closureRedPattern, sundayHoursVerified: deps.cfg.datasets.sundayHoursVerified,
      sweepIdx: sweepIndexFor(deps.cache.snap, deps.cfg.datasets.sweepingYear),
      permitZones, warnings, dataAsOf: deps.cache.asOf(),
    });
  });
}
