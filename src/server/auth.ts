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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery guard. Identity here is ambient (the tailnet position of the browser,
 * or the single-user mapping), so any web page open on a tailnet device could otherwise fire a
 * body-less POST at /api/me/cal-token, /api/admin/refresh or /api/me/notifications/test, or a
 * text/plain POST at any route. Browsers can only send a JSON content type or a custom header
 * cross-origin after a CORS preflight, and this app never answers one, so requiring either
 * proves the request came from same-origin script (or a non-browser client).
 */
export function isCsrfSafe(method: string, headers: Record<string, string | string[] | undefined>): boolean {
  if (SAFE_METHODS.has(method)) return true;
  const ct = String(first(headers['content-type']) ?? '').split(';')[0].trim().toLowerCase();
  return ct === 'application/json' || !!first(headers['x-requested-with']);
}

export function registerAuth(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('user', null as unknown as User);
  app.addHook('preHandler', async (req, reply) => {
    // Guard on the matched route pattern, not the raw URL: the router decodes percent-escapes,
    // so '/%61pi/me' reaches the '/api/me' handler while req.url does not start with '/api/'.
    if (!(req.routeOptions.url ?? '').startsWith('/api/')) return;
    if (!isCsrfSafe(req.method, req.headers)) {
      return reply.code(403).send({ error: 'Cross-site request blocked: send Content-Type: application/json or an X-Requested-With header' });
    }
    const who = resolveLogin(req.headers, deps.cfg);
    if (!who) return reply.code(401).send({ error: 'No Tailscale identity on request' });
    if (!deps.cfg.allowedLogins.includes(who.login)) return reply.code(403).send({ error: 'Not allowed' });
    req.user = deps.store.upsertUser(who.login, who.name);
  });
}
