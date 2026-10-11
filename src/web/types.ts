import type { DatasetMeta, NavApp, NotifyPrefs, Vehicle, VehicleStatus } from '../shared/types.js';

/** GET /api/me */
export interface Me {
  login: string; name: string; isOwner: boolean; navApp: NavApp; calUrl: string;
  ntfyTopic: string; ntfyConfigured: boolean; ntfyUrl: string | null;
  comedOutageUrl: string; towSearchUrl: string;
}
/** GET /api/status */
export interface Status { datasets: DatasetMeta[]; stale: string[]; pushFailing: string | null }
/** GET /api/me/notifications */
export interface Notif { topic: string; prefs: NotifyPrefs; configured: boolean; ntfyUrl: string | null }
/** GET /api/vehicles, POST /api/vehicles/:id/check */
export type VehicleRow = Vehicle & { status: VehicleStatus | null; cooldown?: boolean };
