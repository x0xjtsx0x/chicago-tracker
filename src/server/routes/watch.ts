import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { Request311 } from '../../shared/types.js';
import { buildWatch } from '../domain/watch.js';
import { sweepIndexFor, sweepInfo } from '../domain/sweeping.js';
import { datePart } from '../util/chicagoTime.js';

export function registerWatch(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { placeId: string }; Querystring: { days?: string } }>('/api/watch/:placeId', async (req, reply) => {
    const place = deps.store.getPlace(req.user.id, Number(req.params.placeId));
    if (!place) return reply.code(404).send({ error: 'Not found' });
    const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14) || 14));
    const today = datePart(deps.nowLocal());
    const year = deps.cfg.datasets.sweepingYear;
    const r311 = deps.store.kvGet<Request311[]>(`311:${place.id}`);
    const sweeping = place.kind === 'home' ? sweepInfo(sweepIndexFor(deps.cache.snap, year), place.zones, today, year, 3).upcoming.map((u) => u.date) : [];
    return buildWatch({
      snap: deps.cache.snap, place, today, days, utilities: deps.cfg.utilities,
      requests: r311?.value ?? [], excluded311: deps.cfg.excluded311, sweeping,
      dataAsOf: { ...deps.cache.asOf(), requests311: r311?.updatedAt ?? null },
    });
  });
}
