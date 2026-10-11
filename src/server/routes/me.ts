import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../services.js';
import type { AppConfig } from '../config.js';
import type { NavApp, User } from '../../shared/types.js';
import { isOwner } from '../auth.js';

export const calUrl = (cfg: AppConfig, token: string): string =>
  `${cfg.publicBaseUrl.replace(/^https?:/, 'webcal:')}/cal/${token}.ics`;

const NAV: NavApp[] = ['apple', 'google', 'waze'];

export function meView(deps: AppDeps, u: User) {
  return {
    login: u.login, name: u.name, isOwner: isOwner(u, deps.cfg), navApp: u.navApp,
    calUrl: calUrl(deps.cfg, u.calToken), ntfyTopic: u.ntfyTopic, notifyPrefs: u.notifyPrefs,
    ntfyConfigured: !!deps.cfg.ntfyUrl, ntfyUrl: deps.cfg.ntfyUrl, comedOutageUrl: deps.cfg.utilities.comedOutageUrl,
    // Backup for the vehicle card: the city's own Towed Vehicles dataset page, searchable by plate.
    towSearchUrl: `https://data.cityofchicago.org/d/${deps.cfg.datasets.socrata.towed}`,
  };
}

export function registerMe(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/me', async (req) => meView(deps, req.user));
  app.patch<{ Body: { navApp?: string } }>('/api/me', async (req, reply) => {
    const nav = req.body?.navApp;
    if (nav !== undefined && !NAV.includes(nav as NavApp)) return reply.code(400).send({ error: 'navApp must be apple, google or waze' });
    return meView(deps, deps.store.updateUser(req.user.id, { navApp: nav as NavApp | undefined }));
  });
  app.post('/api/me/cal-token', async (req) => {
    deps.store.rotateCalToken(req.user.id);
    return meView(deps, deps.store.getUser(req.user.id)!);
  });
}
