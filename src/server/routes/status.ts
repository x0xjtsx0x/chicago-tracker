import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import { isOwner } from '../auth.js';

const hoursBetween = (a: string, b: string) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 3_600_000;

export function registerStatus(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/status', async () => {
    const now = deps.nowLocal();
    const datasets = deps.store.listDatasetMeta();
    const stale = datasets.filter((d) => !d.fetchedAt || hoursBetween(d.fetchedAt, now) > 48).map((d) => d.name);
    const push = deps.store.kvGet<string>('ntfy:lastError');
    return { datasets, stale, pushFailing: push?.value ?? null };
  });
  app.post('/api/admin/refresh', async (req, reply) => {
    if (!isOwner(req.user, deps.cfg)) return reply.code(403).send({ error: 'Owner only' });
    const report = await deps.services.refreshNow();
    deps.cache.reload();
    return report;
  });
}
