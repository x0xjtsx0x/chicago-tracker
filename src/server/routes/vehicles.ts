import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../services.js';
import type { Vehicle, VehicleMatch, VehicleStatus } from '../../shared/types.js';
import { checkPlate, colorByKey, crossCheck, isKnownState, makeByKey } from '../../shared/plates.js';

const MAX_VEHICLES = 3;
/** On-demand checks hit the city API; one per plate per 15 s is plenty for a person tapping a button. */
const CHECK_COOLDOWN_MS = 15_000;

type Body = { plate?: unknown; state?: unknown; nickname?: unknown; make?: unknown; color?: unknown };
type Fields = { plate?: string; state?: string; nickname?: string; make?: string; color?: string };

/** Validate whichever fields are present. Returns an error string or the cleaned fields. */
function parse(body: Body | undefined, requirePlate: boolean): Fields | string {
  const out: Fields = {};
  const b = body ?? {};
  if (b.state !== undefined || requirePlate) {
    const state = String(b.state ?? '').trim().toUpperCase();
    if (!isKnownState(state)) return 'state must be a US state, DC, a US territory or a Canadian province code (e.g. IL)';
    out.state = state;
  }
  if (b.plate !== undefined || requirePlate) {
    const c = checkPlate(String(b.plate ?? ''), out.state ?? 'IL');
    if (c.error) return `plate: ${c.error}`;
    out.plate = c.normalized;
  }
  if (b.nickname !== undefined) out.nickname = String(b.nickname ?? '').trim().slice(0, 30);
  if (b.make !== undefined) {
    const m = String(b.make ?? '');
    if (m && !makeByKey(m)) return 'make must be one of the listed makes (or empty)';
    out.make = m;
  }
  if (b.color !== undefined) {
    const c = String(b.color ?? '');
    if (c && !colorByKey(c)) return 'color must be one of the listed colours (or empty)';
    out.color = c;
  }
  return out;
}

/** Attach the make/colour cross-check against the owner's CURRENT description of the car. */
export function annotate(v: Vehicle, s: VehicleStatus | null): VehicleStatus | null {
  if (!s) return null;
  const add = (m: VehicleMatch): VehicleMatch => ({ ...m, crossCheck: crossCheck(v, { make: m.make ?? null, color: m.color ?? null }) });
  return { ...s, matches: s.matches.map(add), older: (s.older ?? []).map(add), otherState: (s.otherState ?? []).map(add) };
}

export function registerVehicles(app: FastifyInstance, deps: AppDeps): void {
  const view = (v: Vehicle) => ({ ...v, status: annotate(v, deps.store.getVehicleStatus(v.id)) });
  const list = (userId: number) => deps.store.listVehicles(userId).map(view);
  const lastCheck = new Map<number, number>();
  const duplicate = (userId: number, plate: string, state: string, exceptId?: number) =>
    deps.store.listVehicles(userId).find((x) => x.plate === plate && x.state === state && x.id !== exceptId);
  const dupError = (reply: FastifyReply, plate: string, state: string) =>
    reply.code(409).send({ error: `You already saved ${state} · ${plate}.` });
  // One live lookup per vehicle at a time: "Check now" right after saving joins the save's lookup.
  const inflight = new Map<number, Promise<unknown>>();
  const checkOnce = (v: Vehicle): Promise<unknown> => {
    const running = inflight.get(v.id);
    if (running) return running;
    lastCheck.set(v.id, Date.now());
    const p = deps.services.checkVehicle(v).finally(() => inflight.delete(v.id));
    inflight.set(v.id, p);
    return p;
  };
  const backgroundCheck = (v: Vehicle, log: { warn: (o: object, m: string) => void }) => {
    checkOnce(v).catch((e) => log.warn({ err: (e as Error).message }, 'vehicle check failed'));
  };

  app.get('/api/vehicles', async (req) => list(req.user.id));
  app.get('/api/vehicles/status', async (req) => list(req.user.id));

  app.post<{ Body: Body }>('/api/vehicles', async (req, reply) => {
    const f = parse(req.body, true);
    if (typeof f === 'string') return reply.code(400).send({ error: f });
    if (deps.store.listVehicles(req.user.id).length >= MAX_VEHICLES) return reply.code(409).send({ error: `At most ${MAX_VEHICLES} vehicles` });
    if (duplicate(req.user.id, f.plate!, f.state!)) return dupError(reply, f.plate!, f.state!);
    const v = deps.store.createVehicle(req.user.id, { plate: f.plate!, state: f.state!, nickname: f.nickname ?? '', make: f.make ?? '', color: f.color ?? '' });
    backgroundCheck(v, req.log);
    return reply.code(201).send(v);
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/vehicles/:id', async (req, reply) => {
    const cur = deps.store.getVehicle(req.user.id, Number(req.params.id));
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    // A plate edit is validated against the (possibly also edited) state.
    const f = parse({ ...req.body, state: req.body?.state ?? (req.body?.plate !== undefined ? cur.state : undefined) }, false);
    if (typeof f === 'string') return reply.code(400).send({ error: f });
    const plate = f.plate ?? cur.plate, state = f.state ?? cur.state;
    if (duplicate(req.user.id, plate, state, cur.id)) return dupError(reply, plate, state);
    const v = deps.store.updateVehicle(req.user.id, cur.id, f)!;
    if (v.plate !== cur.plate || v.state !== cur.state) backgroundCheck(v, req.log);
    return view(v);
  });

  app.post<{ Params: { id: string } }>('/api/vehicles/:id/check', async (req, reply) => {
    const v = deps.store.getVehicle(req.user.id, Number(req.params.id));
    if (!v) return reply.code(404).send({ error: 'Not found' });
    const running = inflight.get(v.id);
    if (!running && Date.now() - (lastCheck.get(v.id) ?? 0) < CHECK_COOLDOWN_MS && deps.store.getVehicleStatus(v.id)) {
      return { ...view(v), cooldown: true };
    }
    try { await (running ?? checkOnce(v)); } catch (e) { req.log.warn({ err: (e as Error).message }, 'vehicle check failed'); }
    return view(v);
  });

  app.delete<{ Params: { id: string } }>('/api/vehicles/:id', async (req, reply) =>
    deps.store.deleteVehicle(req.user.id, Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'Not found' }));
}
