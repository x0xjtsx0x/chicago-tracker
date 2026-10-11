import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { normalizePlate, PLATE_RE, STATE_RE } from '../domain/vehicles.js';

export function registerVehicles(app: FastifyInstance, deps: AppDeps): void {
  const list = (userId: number) => deps.store.listVehicles(userId).map((v) => ({ ...v, status: deps.store.getVehicleStatus(v.id) }));
  app.get('/api/vehicles', async (req) => list(req.user.id));
  app.get('/api/vehicles/status', async (req) => list(req.user.id));
  app.post<{ Body: { plate?: string; state?: string; nickname?: string } }>('/api/vehicles', async (req, reply) => {
    const plate = normalizePlate(String(req.body?.plate ?? ''));
    const state = String(req.body?.state ?? '').trim().toUpperCase();
    if (!PLATE_RE.test(plate) || !STATE_RE.test(state)) return reply.code(400).send({ error: 'plate must be 2–8 letters/digits; state a 2-letter code' });
    if (deps.store.listVehicles(req.user.id).length >= 3) return reply.code(409).send({ error: 'At most 3 vehicles' });
    const v = deps.store.createVehicle(req.user.id, { plate, state, nickname: String(req.body?.nickname ?? '').trim().slice(0, 30) });
    deps.services.checkVehicles().catch((e) => req.log.warn({ err: (e as Error).message }, 'vehicle check failed'));
    return reply.code(201).send(v);
  });
  app.delete<{ Params: { id: string } }>('/api/vehicles/:id', async (req, reply) =>
    deps.store.deleteVehicle(req.user.id, Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }));
}
