import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import * as turf from '@turf/turf';
import type { MultiPolygonCoords, PlaceKind, ZoneCandidate } from '../../shared/types.js';
import { datePart } from '../util/chicagoTime.js';
import { sweepIndexFor, sweepInfo, zoneCandidates } from '../domain/sweeping.js';
import { distToMultiPolygonM } from '../domain/geo.js';
import { CHI } from './parking.js';

const inChicago = (lat: number, lon: number) => lat >= CHI.minLat && lat <= CHI.maxLat && lon >= CHI.minLon && lon <= CHI.maxLon;
const simplify = (mp: MultiPolygonCoords): MultiPolygonCoords => {
  try {
    return turf.simplify(turf.multiPolygon(mp), { tolerance: 0.00003, highQuality: false }).geometry.coordinates as MultiPolygonCoords;
  } catch { return mp; }
};

const LIMITS: Record<PlaceKind, number> = { home: 5, watch: 10 };
const clampRadius = (r: unknown, def = 300) => Math.min(1000, Math.max(100, Number.isFinite(Number(r)) ? Number(r) : def));
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function registerPlaces(app: FastifyInstance, deps: AppDeps): void {
  const year = () => deps.cfg.datasets.sweepingYear;
  const idx = () => sweepIndexFor(deps.cache.snap, year());
  const candidatesFor = (lon: number, lat: number) => {
    const today = datePart(deps.nowLocal());
    return zoneCandidates(deps.cache.snap.sweepZones, [lon, lat]).map((z) => ({
      wardSection: z.wardSection,
      next: sweepInfo(idx(), [z.wardSection], today, year(), 3).upcoming.map((u) => u.date),
    }));
  };

  // Zone candidates with outlines, for the "is this your side of the street?" map before saving.
  const zonesNear = (lon: number, lat: number): ZoneCandidate[] => {
    const today = datePart(deps.nowLocal());
    return zoneCandidates(deps.cache.snap.sweepZones, [lon, lat]).map((z) => {
      const d = distToMultiPolygonM([lon, lat], z.polygon);
      return {
        wardSection: z.wardSection, ward: z.ward, section: z.section,
        next: sweepInfo(idx(), [z.wardSection], today, year(), 3).upcoming.map((u) => u.date),
        polygon: simplify(z.polygon), distanceM: Math.round(d), containsPoint: d === 0,
      };
    });
  };
  app.get<{ Querystring: { lat?: string; lon?: string } }>('/api/zones', async (req, reply) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!inChicago(lat, lon)) return reply.code(400).send({ error: 'lat/lon must be inside Chicago' });
    return { candidates: zonesNear(lon, lat) };
  });

  app.get<{ Querystring: { q?: string } }>('/api/geocode', async (req, reply) => {
    const q = str(req.query.q);
    if (q.length < 3) return reply.code(400).send({ error: 'q must be at least 3 characters' });
    return deps.services.geocode(q);
  });

  app.get('/api/places', async (req) => deps.store.listPlaces(req.user.id));

  app.post<{ Body: { kind?: string; label?: string; address?: string; radiusM?: number; lat?: unknown; lon?: unknown; zones?: unknown } }>('/api/places', async (req, reply) => {
    const kind = req.body?.kind as PlaceKind;
    if (kind !== 'home' && kind !== 'watch') return reply.code(400).send({ error: 'kind must be home or watch' });
    const label = str(req.body.label, 60), address = str(req.body.address);
    if (!label || !address) return reply.code(400).send({ error: 'label and address are required' });
    if (deps.store.listPlaces(req.user.id).filter((p) => p.kind === kind).length >= LIMITS[kind]) {
      return reply.code(409).send({ error: `At most ${LIMITS[kind]} ${kind} places` });
    }
    // The UI geocodes first and shows the result on a map; when the user confirms, it sends that
    // exact point so what is saved is what they saw (re-geocoding could pick a different match).
    let hit: { label: string; lat: number; lon: number } | undefined;
    if (req.body.lat !== undefined || req.body.lon !== undefined) {
      const lat = Number(req.body.lat), lon = Number(req.body.lon);
      if (!inChicago(lat, lon)) return reply.code(400).send({ error: 'lat/lon must be inside Chicago' });
      hit = { label: address, lat, lon };
    } else {
      [hit] = await deps.services.geocode(address);
    }
    if (!hit) return reply.code(422).send({ error: "Couldn't find that address" });
    const candidates = kind === 'home' ? candidatesFor(hit.lon, hit.lat) : [];
    let zones = candidates.length === 1 ? [candidates[0].wardSection] : [];
    if (kind === 'home' && req.body.zones !== undefined) {
      const z = req.body.zones;
      const allowed = new Set(candidates.map((c) => c.wardSection));
      if (!Array.isArray(z) || z.length > 4 || !z.every((x) => typeof x === 'string' && allowed.has(x))) {
        return reply.code(400).send({ error: 'zones must be chosen from the candidate zones for this address' });
      }
      zones = [...new Set(z as string[])];
    }
    const place = deps.store.createPlace(req.user.id, {
      kind, label, address: hit.label, lat: hit.lat, lon: hit.lon, radiusM: clampRadius(req.body.radiusM), zones,
    });
    return reply.code(201).send({ place, candidates });
  });

  app.patch<{ Params: { id: string }; Body: { label?: string; radiusM?: number; zones?: unknown } }>('/api/places/:id', async (req, reply) => {
    const patch: { label?: string; radiusM?: number; zones?: string[] } = {};
    if (req.body?.label !== undefined) patch.label = str(req.body.label, 60);
    if (req.body?.radiusM !== undefined) patch.radiusM = clampRadius(req.body.radiusM);
    if (req.body?.zones !== undefined) {
      const z = req.body.zones;
      if (!Array.isArray(z) || z.length > 4 || !z.every((x) => typeof x === 'string' && /^\d{4}$/.test(x))) {
        return reply.code(400).send({ error: 'zones must be up to 4 ward-section codes like "3204"' });
      }
      patch.zones = [...new Set(z as string[])];
    }
    const p = deps.store.updatePlace(req.user.id, Number(req.params.id), patch);
    return p ?? reply.code(404).send({ error: 'Not found' });
  });

  app.delete<{ Params: { id: string } }>('/api/places/:id', async (req, reply) =>
    deps.store.deletePlace(req.user.id, Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }));

  app.get<{ Params: { id: string } }>('/api/places/:id/sweeping', async (req, reply) => {
    const p = deps.store.getPlace(req.user.id, Number(req.params.id));
    if (!p) return reply.code(404).send({ error: 'Not found' });
    const info = sweepInfo(idx(), p.zones, datePart(deps.nowLocal()), year());
    return { ...info, candidates: candidatesFor(p.lon, p.lat) };
  });
}
