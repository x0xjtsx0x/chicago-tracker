import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { buildIcs, sweepingEvents } from '../domain/ics.js';
import { sweepIndexFor } from '../domain/sweeping.js';

const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function registerCal(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { token: string } }>('/cal/:token', async (req, reply) => {
    const m = req.params.token.match(/^([A-Za-z0-9_-]{20,})\.ics$/);
    const user = m ? deps.store.getUserByCalToken(m[1]) : null;
    if (!user) return reply.code(404).send('Not found');
    const homes = deps.store.listPlaces(user.id).filter((p) => p.kind === 'home');
    const ics = buildIcs('Chicago street cleaning', sweepingEvents(homes, sweepIndexFor(deps.cache.snap, deps.cfg.datasets.sweepingYear)), utcStamp());
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').header('Cache-Control', 'no-store').send(ics);
  });
}
