import type { BBox, GeoResult, LngLat, Parcel, Plow, User } from '../shared/types.js';
import type { AppConfig } from './config.js';
import type { Store } from './db/store.js';
import type { DataCache } from './data/cache.js';

export interface Services {
  geocode(q: string): Promise<GeoResult[]>;
  parcelsNear(center: LngLat, radiusM: number): Promise<Parcel[]>;
  plows(bbox: BBox): Promise<Plow[]>;
  refreshNow(): Promise<{ ok: string[]; failed: { name: string; error: string }[] }>;
  sendTestPush(user: User): Promise<void>;
  checkVehicles(): Promise<void>;
}

export interface AppDeps {
  cfg: AppConfig; store: Store; cache: DataCache; services: Services;
  nowLocal: () => string; webRoot?: string | null;
}
