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

export interface VehicleMatch { kind: 'towed' | 'relocated'; key: string; date: string; details: string; address: string; phone: string | null; }
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
export interface Vehicle { id: number; userId: number; plate: string; state: string; nickname: string; }
export interface VehicleStatus { vehicleId: number; checkedAt: string; ok: boolean; matches: VehicleMatch[]; error: string | null; }
export interface DatasetMeta { name: string; fetchedAt: string | null; rowCount: number; status: 'ok' | 'error'; error: string | null; }
export interface Plow { name: string; type: string; postedLocal: string; minutesAgo: number; point: LngLat; }
export interface WinterStatus {
  placeId: number; label: string; onSnowRoute: boolean; alerts: NwsAlert[];
  possibleBan: boolean; snowNext24hIn: number | null; checkedAt: string | null; error: string | null;
}
export type SweepSeason = 'active' | 'over' | 'nodata';
export interface SweepInfo { status: SweepSeason; zones: string[]; upcoming: { date: string; wardSection: string }[]; }
