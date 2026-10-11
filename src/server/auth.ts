import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { AppDeps } from './services.js';
import type { User } from '../shared/types.js';

declare module 'fastify' { interface FastifyRequest { user: User } }

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Who is making this request?
 * - Single-user mode (SINGLE_USER_LOGIN set): every request is that user. Tailscale-User-* headers are
 *   ignored completely, because the deployed reverse proxy cannot strip or set them, so a client could forge them.
 * - Header mode: trust the Tailscale-User-* headers that `tailscale serve` injects.
 */
export function resolveLogin(headers: Record<string, string | string[] | undefined>, cfg: AppConfig): { login: string; name: string } | null {
  if (cfg.singleUserLogin) return { login: cfg.singleUserLogin, name: cfg.singleUserLogin };
  const login = first(headers['tailscale-user-login']);
  if (login) return { login, name: first(headers['tailscale-user-name']) ?? login };
  return null;
}

export const isOwner = (user: User, cfg: AppConfig): boolean => user.login === cfg.ownerLogin;

export function registerAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('user', null as unknown as User);
  app.addHook('preHandler', async (req, reply) => {
    // Guard on the matched route pattern, not the raw URL: the router decodes percent-escapes,
    // so '/%61pi/me' reaches the '/api/me' handler while req.url does not start with '/api/'.
    if (!(req.routeOptions.url ?? '').startsWith('/api/')) return;
    const who = resolveLogin(req.headers, deps.cfg);
    if (!who) return reply.code(401).send({ error: 'No Tailscale identity on request' });
    if (!deps.cfg.allowedLogins.includes(who.login)) return reply.code(403).send({ error: 'Not allowed' });
    req.user = deps.store.upsertUser(who.login, who.name);
  });
}
