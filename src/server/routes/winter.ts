import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { BBox, WinterStatus } from '../../shared/types.js';

export function registerWinter(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/winter', async (req) =>
    deps.store.listPlaces(req.user.id).filter((p) => p.kind === 'home').map((p) =>
      deps.store.kvGet<WinterStatus>(`winter:${p.id}`)?.value ??
      { placeId: p.id, label: p.label, onSnowRoute: false, alerts: [], possibleBan: false, snowNext24hIn: null, checkedAt: null, error: null }));
  app.get<{ Querystring: { bbox?: string } }>('/api/plows', async (req, reply) => {
    const b = String(req.query.bbox ?? '').split(',').map(Number);
    if (b.length !== 4 || b.some((n) => !Number.isFinite(n)) || b[0] >= b[2] || b[1] >= b[3] || b[2] - b[0] > 0.5 || b[3] - b[1] > 0.5) {
      return reply.code(400).send({ error: 'bbox=minLon,minLat,maxLon,maxLat (max 0.5° span)' });
    }
    return deps.services.plows(b as BBox);
  });
}
