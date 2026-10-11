import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { NotifyCategory, NotifyPrefs, User } from '../../shared/types.js';

const CATS: NotifyCategory[] = ['vehicle', 'sweeping', 'winter', 'snowban', 'work'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// On public ntfy.sh anyone who knows a topic name can read it, so a user-chosen topic must be long.
const TOPIC_RE = /^[A-Za-z0-9_-]{24,64}$/;
const TOPIC_ERROR = 'topic must be at least 24 characters (up to 64) of letters, digits, _ or -. The topic name is the password for your alerts, so make it long and random.';
const view = (deps: AppDeps, u: User) => ({ topic: u.ntfyTopic, prefs: u.notifyPrefs, configured: !!deps.cfg.ntfyUrl, ntfyUrl: deps.cfg.ntfyUrl });

export function registerNotifications(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/me/notifications', async (req) => view(deps, req.user));
  app.patch<{ Body: { topic?: unknown; prefs?: any } }>('/api/me/notifications', async (req, reply) => {
    const patch: { ntfyTopic?: string; notifyPrefs?: NotifyPrefs } = {};
    if (req.body?.topic !== undefined) {
      if (typeof req.body.topic !== 'string' || !TOPIC_RE.test(req.body.topic)) return reply.code(400).send({ error: TOPIC_ERROR });
      patch.ntfyTopic = req.body.topic;
    }
    if (req.body?.prefs !== undefined) {
      const cur = req.user.notifyPrefs, inp = req.body.prefs ?? {};
      const next: NotifyPrefs = { enabled: { ...cur.enabled }, quietStart: inp.quietStart ?? cur.quietStart, quietEnd: inp.quietEnd ?? cur.quietEnd };
      for (const c of CATS) if (inp.enabled?.[c] !== undefined) next.enabled[c] = !!inp.enabled[c];
      if (!HHMM.test(next.quietStart) || !HHMM.test(next.quietEnd)) return reply.code(400).send({ error: 'quiet hours must be HH:mm' });
      patch.notifyPrefs = next;
    }
    return view(deps, deps.store.updateUser(req.user.id, patch));
  });
  app.post('/api/me/notifications/test', async (req, reply) => {
    try { await deps.services.sendTestPush(req.user); return { ok: true }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
}
