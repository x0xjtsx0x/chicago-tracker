import type { RatesConfig } from '../config.js';
import type { DataSnapshot } from '../data/cache.js';
import type { BlockFlag, BlockStatus, LngLat, ParkingBlock, ParkingResult, PayBlock, PayBox, PermitZoneFeature } from '../../shared/types.js';
import { bboxNear, distM, distToPathsM, inMultiPolygon, midpointOfPaths, nearestOnPaths } from './geo.js';
import { rateFor } from './rates.js';
import { type SweepIndex, zonesSweepingOn } from './sweeping.js';
import { datePart, timePart, weekday } from '../util/chicagoTime.js';

export interface ParkingInput {
  snap: DataSnapshot; center: LngLat; radiusM: number; at: string;
  rates: RatesConfig; closureRedPattern: string; sweepIdx: SweepIndex;
  permitZones: PermitZoneFeature[]; warnings: string[]; dataAsOf: Record<string, string | null>;
}

export const STATUS_ORDER: Record<BlockStatus, number> = { green: 0, info: 1, amber: 2, red: 3 };
const SEV_ORDER = { info: 1, amber: 2, red: 3 } as const;

function hourLimitFor(b: PayBlock, boxes: PayBox[], mid: LngLat): string | null {
  if (b.hourLimit) return b.hourLimit;
  const same = boxes.find((x) => x.payArea === b.payArea && x.street === b.street && x.from <= b.to && x.to >= b.from && x.hourLimit);
  if (same) return same.hourLimit;
  const near = boxes.filter((x) => x.hourLimit).map((x) => ({ x, d: distM(mid, x.point) })).filter((o) => o.d <= 60).sort((a, c) => a.d - c.d)[0];
  return near?.x.hourLimit ?? null;
}

/** `at` is a Chicago-local naive timestamp; every date/time comparison below is Chicago-local. */
export function buildParking(inp: ParkingInput): ParkingResult {
  const { snap, center, radiusM, at } = inp;
  const date = datePart(at), time = timePart(at), month = Number(date.slice(5, 7));
  const reach = radiusM + 150;
  const closureRe = new RegExp(inp.closureRedPattern, 'i');

  const active = snap.permits.filter((p) => p.point && p.start <= at && p.end >= at && distM(center, p.point) <= reach);
  const events = snap.events.filter((e) => e.date === date && e.point && distM(center, e.point) <= reach);
  const sweepingZones = time < '14:00' ? zonesSweepingOn(inp.sweepIdx, snap.sweepZones.filter((z) => bboxNear(z.bbox, center, reach)), date) : [];
  const boxes = snap.payBoxes.filter((x) => distM(center, x.point) <= radiusM);
  const winter = month === 12 || month <= 3;

  const blocks: ParkingBlock[] = [];
  for (const b of snap.payBlocks) {
    if (!bboxNear(b.bbox, center, radiusM)) continue;
    const distanceM = distToPathsM(center, b.paths);
    if (distanceM > radiusM) continue;
    const mid = midpointOfPaths(b.paths);
    const flags: BlockFlag[] = [];

    const z = sweepingZones.find((zz) => inMultiPolygon(mid, zz.polygon));
    if (z) flags.push({ code: 'SWEEPING', severity: 'red', reason: `Street cleaning today (Ward ${z.ward} Sec ${z.section}), typically 9am–2pm` });

    const closure = active.find((p) => p.dataset === 'closures' && p.streetClosure && closureRe.test(p.streetClosure) && distToPathsM(p.point!, b.paths) <= 30);
    if (closure) flags.push({ code: 'CLOSED', severity: 'red', reason: `${closure.streetClosure} closure — ${closure.workType || closure.appType} until ${closure.end.slice(0, 10)}` });

    const bag = active.find((p) => p.meterBagging && distToPathsM(p.point!, b.paths) <= 30);
    if (bag) flags.push({ code: 'METERS_BAGGED', severity: 'red', reason: `Meters may be bagged (permit ${bag.id}, until ${bag.end.slice(0, 10)})` });

    const ev = events.find((e) => distM(mid, e.point!) <= 150);
    const party = active.find((p) => p.dataset === 'blockparty' && distM(mid, p.point!) <= 150);
    if (ev) flags.push({ code: 'EVENT_NEARBY', severity: 'amber', reason: `${ev.type}: ${ev.details} (${ev.venueAddress})` });
    else if (party) flags.push({ code: 'EVENT_NEARBY', severity: 'amber', reason: `Block party nearby (${party.location})` });

    if (winter && snap.snowRoutes.some((r) => bboxNear(r.bbox, mid, 15) && distToPathsM(mid, r.paths) <= 15)) {
      flags.push({ code: 'SNOW_ROUTE', severity: 'amber', reason: 'Snow route — 2-inch snow parking ban may apply' });
    }
    if (weekday(date) === 0) flags.push({ code: 'SUNDAY', severity: 'info', reason: 'Sunday: possibly free — check the posted sign' });

    const status: BlockStatus = flags.reduce<BlockStatus>((s, f) => (SEV_ORDER[f.severity] > STATUS_ORDER[s] ? f.severity : s), 'green');
    blocks.push({
      blockId: b.blockId, street: b.street, from: b.from, to: b.to, parity: b.parity, spaces: b.spaces,
      hourLimit: hourLimitFor(b, snap.payBoxes, mid), payArea: b.payArea, rate: rateFor(mid, inp.rates, snap.cbd),
      distanceM: Math.round(distanceM), navPoint: nearestOnPaths(center, b.paths), paths: b.paths, flags, status,
    });
  }
  blocks.sort((a, c) => STATUS_ORDER[a.status] - STATUS_ORDER[c.status] || a.distanceM - c.distanceM);

  return {
    center, radiusM, at, blocks, boxes, permitZones: inp.permitZones,
    closures: active.filter((p) => p.dataset !== 'current'), events, warnings: inp.warnings, dataAsOf: inp.dataAsOf,
  };
}
