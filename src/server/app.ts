import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppDeps } from './services.js';
import { registerAuth } from './auth.js';
import { registerMe } from './routes/me.js';
import { registerPlaces } from './routes/places.js';
import { registerCal } from './routes/cal.js';
import { registerParking } from './routes/parking.js';
import { registerStatus } from './routes/status.js';
import { registerWatch } from './routes/watch.js';
import { registerVehicles } from './routes/vehicles.js';
import { registerWinter } from './routes/winter.js';
import { registerNotifications } from './routes/notifications.js';

export const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // Built-in request logging is disabled because it logs full URLs, and /api/geocode?q= and
  // /api/parking?lat=&lon= carry addresses and locations. Log route patterns only, and strip the
  // query string from the request serializer used by error logs.
  // trustProxy stays off: nothing may derive identity or authorization from X-Forwarded-For.
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      serializers: { req: (req) => ({ method: req.method, url: String(req.url ?? '').split('?')[0] }) },
    },
    disableRequestLogging: true,
    trustProxy: false,
  });
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ method: req.method, route: req.routeOptions.url ?? 'unmatched', status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true, ready: deps.cache.snap.payBlocks.length > 0 }));

  registerAuth(app, deps);
  registerMe(app, deps);
  registerPlaces(app, deps);
  registerCal(app, deps);
  registerParking(app, deps);
  registerStatus(app, deps);
  registerWatch(app, deps);
  registerVehicles(app, deps);
  registerWinter(app, deps);
  registerNotifications(app, deps);

  const root = deps.webRoot === undefined ? resolve('dist/web') : deps.webRoot;
  if (root && existsSync(root)) {
    await app.register(fastifyStatic, { root, wildcard: false });
    // App-shell fallback only for extension-less GET paths. A missing file (e.g. an old hashed
    // /assets/*.js after a deploy) must be a real 404, never HTML served under a script URL.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      const isFile = /\.[A-Za-z0-9]+$/.test(path);
      if (req.method === 'GET' && !isFile && !path.startsWith('/api/') && !path.startsWith('/cal/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
