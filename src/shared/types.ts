import type { CrossCheck } from './plates.js';

export type LngLat = [number, number]; // [lon, lat]
export type BBox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat
export type MultiPolygonCoords = LngLat[][][]; // polygons → rings → points

export interface PayBlock {
  blockId: string; street: string; from: number; to: number; parity: string;
  spaces: number; hourLimit: string | null; payZone: number; payArea: number;
  sundayHours: string | null; paths: LngLat[][]; bbox: BBox;
}
export interface PayBox {
  terminalId: number; street: string; from: number; to: number; addr: number;
  spaces: number; hourLimit: string | null; payZone: number; payArea: number; point: LngLat;
}
export interface SweepZone { wardSection: string; ward: string; section: string; polygon: MultiPolygonCoords; bbox: BBox; }
export interface SweepRow { wardSection: string; month: number; days: number[]; }
export interface PermitZoneRow { zone: string; oddEven: 'O' | 'E' | 'B'; low: number; high: number; dir: string; name: string; type: string; }
export type PermitDataset = 'closures' | 'current' | 'blockparty' | 'filming';
export interface Permit {
  id: string; dataset: PermitDataset; appType: string; workType: string;
  start: string; end: string; // Chicago-local naive 'YYYY-MM-DDTHH:mm:ss'
  location: string; streetClosure: string | null; detail: string | null; comments: string | null;
  meterBagging: boolean; applicant: string; point: LngLat | null;
}
export interface SpecialEvent { id: string; date: string; venueAddress: string; type: string; details: string; startTime: string; point: LngLat | null; }
export interface SnowRoute { id: string; paths: LngLat[][]; bbox: BBox; }
export interface Parcel { low: number; high: number; dir: string; name: string; type: string; centroid: LngLat; }

export type RateTier = 'loop' | 'cbd' | 'westloop' | 'neighborhood';
export interface RateInfo { tier: RateTier; hourly: number; hoursText: string; approximate: true; }

export type FlagCode = 'SWEEPING' | 'CLOSED' | 'METERS_BAGGED' | 'EVENT_NEARBY' | 'SNOW_ROUTE' | 'SUNDAY';
export type Severity = 'red' | 'amber' | 'info';
export interface BlockFlag { code: FlagCode; severity: Severity; reason: string; }
export type BlockStatus = 'green' | Severity;
export interface ParkingBlock {
  blockId: string; street: string; from: number; to: number; parity: string;
  spaces: number; hourLimit: string | null; payArea: number; rate: RateInfo;
  distanceM: number; navPoint: LngLat; paths: LngLat[][]; flags: BlockFlag[]; status: BlockStatus;
}
export interface PermitZoneFeature { zone: string; street: string; parity: 'O' | 'E'; line: LngLat[]; label: string; }
export interface ParkingResult {
  center: LngLat; radiusM: number; at: string;
  blocks: ParkingBlock[]; boxes: PayBox[]; permitZones: PermitZoneFeature[];
  closures: Permit[]; events: SpecialEvent[]; warnings: string[];
  dataAsOf: Record<string, string | null>;
}

export type UtilityTag = 'comed' | 'peoplesgas' | 'water' | 'telecom' | null;
export interface WatchItem {
  id: string; kind: 'permit' | 'event'; dataset: PermitDataset | 'event'; title: string;
  start: string; end: string; location: string; description: string;
  distanceM: number; utility: UtilityTag; point: LngLat | null;
}
export interface Request311 { id: string; type: string; status: string; created: string; closed: string | null; address: string; point: LngLat | null; duplicate: boolean; }
export interface Request311Group { type: string; count: number; items: (Request311 & { distanceM: number })[]; }
export interface WatchResult { placeId: number; items: WatchItem[]; requests311: Request311Group[]; sweeping: string[]; dataAsOf: Record<string, string | null>; }

export interface VehicleMatch {
  kind: 'towed' | 'relocated'; key: string; date: string; details: string; address: string; phone: string | null;
  /** Raw city values (tows use NCIC codes like TOYT/WHI, relocations use names). */
  make?: string | null; color?: string | null; recordState?: string | null;
  /** exact = plate and state match; possible = plate matches and the record has no state. */
  confidence?: 'exact' | 'possible';
  /** Added by the API on read: does the record's make/colour agree with what the owner saved? */
  crossCheck?: CrossCheck;
}
export interface NwsAlert { id: string; event: string; headline: string; severity: string; ends: string | null; }

export type NotifyCategory = 'vehicle' | 'sweeping' | 'winter' | 'snowban' | 'work';
export interface NotifyPrefs { enabled: Record<NotifyCategory, boolean>; quietStart: string; quietEnd: string; }
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: { vehicle: true, sweeping: true, winter: true, snowban: true, work: true },
  quietStart: '22:00', quietEnd: '07:00',
};
export type NavApp = 'apple' | 'google' | 'waze';
export interface GeoResult { label: string; lat: number; lon: number; }

export type PlaceKind = 'home' | 'watch';
export interface Place { id: number; userId: number; kind: PlaceKind; label: string; address: string; lat: number; lon: number; radiusM: number; zones: string[]; }
export interface User { id: number; login: string; name: string; calToken: string; navApp: NavApp; ntfyTopic: string; notifyPrefs: NotifyPrefs; }
export interface Vehicle { id: number; userId: number; plate: string; state: string; nickname: string; make: string; color: string; }
/** Exactly what a check searched, so the UI can show it ("plate ABC1234 in IL, last 14 days"). */
export interface VehicleSearch {
  plate: string; state: string; stateCodes: string[];
  datasets: { id: string; name: string }[];
  /** Matches on or after this date alert (and turn the card red). */
  alertSince: string;
  /** The datasets themselves only keep about this many days; older history is shown, never alerted. */
  datasetWindowDays: number;
}
export interface VehicleStatus {
  vehicleId: number; checkedAt: string; ok: boolean; matches: VehicleMatch[]; error: string | null;
  search?: VehicleSearch | null;
  /** Same plate and state, but older than alertSince: shown as history, never pushed. */
  older?: VehicleMatch[];
  /** Same plate under a DIFFERENT state: a strong hint the saved state is wrong. Never pushed. */
  otherState?: VehicleMatch[];
}
export interface DatasetMeta { name: string; fetchedAt: string | null; rowCount: number; status: 'ok' | 'error'; error: string | null; }
export interface Plow { name: string; type: string; postedLocal: string; minutesAgo: number; point: LngLat; }
export interface WinterStatus {
  placeId: number; label: string; onSnowRoute: boolean; alerts: NwsAlert[];
  possibleBan: boolean; snowNext24hIn: number | null; checkedAt: string | null; error: string | null;
}
export type SweepSeason = 'active' | 'over' | 'nodata';
/** A sweeping zone near a point, with its shape so the user can pick the right side of a boundary street on a map. */
export interface ZoneCandidate {
  wardSection: string; ward: string; section: string; next: string[];
  /** Simplified outline (≈3 m tolerance) for display only. */
  polygon: MultiPolygonCoords; distanceM: number; containsPoint: boolean;
}
export interface SweepInfo { status: SweepSeason; zones: string[]; upcoming: { date: string; wardSection: string }[]; }
