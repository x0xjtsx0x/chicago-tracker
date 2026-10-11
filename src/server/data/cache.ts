import type { Store } from '../db/store.js';
import type { MultiPolygonCoords, PayBlock, PayBox, Permit, PermitZoneRow, SnowRoute, SpecialEvent, SweepRow, SweepZone } from '../../shared/types.js';

export interface DataSnapshot {
  payBlocks: PayBlock[]; payBoxes: PayBox[]; cbd: MultiPolygonCoords | null; snowRoutes: SnowRoute[];
  sweepSchedule: SweepRow[]; sweepZones: SweepZone[]; permitZones: PermitZoneRow[]; permits: Permit[]; events: SpecialEvent[];
}

const PERMIT_SETS = ['permitsClosures', 'permitsCurrent', 'permitsBlockParty', 'permitsFilming'] as const;

export class DataCache {
  snap: DataSnapshot;
  constructor(private store: Store) { this.snap = this.load(); }
  reload(): void { this.snap = this.load(); }
  private load(): DataSnapshot {
    const s = this.store;
    return {
      payBlocks: s.loadDataset<PayBlock[]>('payBlocks') ?? [],
      payBoxes: s.loadDataset<PayBox[]>('payBoxes') ?? [],
      cbd: s.loadDataset<MultiPolygonCoords>('cbd'),
      snowRoutes: s.loadDataset<SnowRoute[]>('snowRoutes') ?? [],
      sweepSchedule: s.loadDataset<SweepRow[]>('sweepSchedule') ?? [],
      sweepZones: s.loadDataset<SweepZone[]>('sweepZones') ?? [],
      permitZones: s.loadDataset<PermitZoneRow[]>('permitZones') ?? [],
      permits: PERMIT_SETS.flatMap((n) => s.loadDataset<Permit[]>(n) ?? []),
      events: s.loadDataset<SpecialEvent[]>('specialEvents') ?? [],
    };
  }
  asOf(): Record<string, string | null> {
    return Object.fromEntries(this.store.listDatasetMeta().map((m) => [m.name, m.fetchedAt]));
  }
}
