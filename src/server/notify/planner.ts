import type { NotifyPrefs, Place, Vehicle, VehicleStatus, WatchItem, WinterStatus } from '../../shared/types.js';
import type { PlannedPush } from './ntfy.js';
import { WINTER_EVENT_RE } from '../domain/winter.js';
import { addDays, datePart, timePart } from '../util/chicagoTime.js';

export interface PlanInput {
  nowLocal: string; baseUrl: string; homes: Place[];
  isSweeping: (wardSection: string, date: string) => boolean;
  vehicles: { vehicle: Vehicle; status: VehicleStatus | null }[];
  winter: { place: Place; status: WinterStatus | null; banKey: string | null }[];
  newWork: WatchItem[];
}

const UTIL_ICON: Record<string, string> = { comed: '⚡ ComEd', peoplesgas: '🔥 Peoples Gas', water: '💧 Water', telecom: '📡 Telecom' };

/**
 * The place label as it may appear in a push. Pushes can travel through public ntfy.sh, so a label
 * that repeats the place's own house number (i.e. is really its address) is replaced with a generic one.
 */
export function pushLabel(place: Place): string {
  const label = place.label.trim();
  const houseNumber = place.address.match(/^\s*(\d+)/)?.[1];
  if (!label || (houseNumber && new RegExp(`(^|\\D)${houseNumber}(\\D|$)`).test(label))) {
    return place.kind === 'home' ? 'your home street' : 'your watched place';
  }
  return label;
}

/**
 * Pushes may be delivered through a public third party. Titles and messages never contain a plate,
 * a vehicle nickname, or a home/watched address; details stay in the app behind the Click URL.
 */
export function planPushes(inp: PlanInput): PlannedPush[] {
  const out: PlannedPush[] = [];
  const today = datePart(inp.nowLocal), time = timePart(inp.nowLocal);
  const click = `${inp.baseUrl}/#/home`;

  for (const { status } of inp.vehicles) {
    for (const m of status?.matches ?? []) {
      out.push(m.kind === 'towed'
        ? {
          key: m.key, category: 'vehicle', priority: 'urgent', tags: ['rotating_light'], click,
          title: '🚨 Your car was towed',
          // The tow lot is a public city facility; its address is safe to send.
          message: `Tow lot: ${m.address}${m.phone ? ` (${m.phone})` : ''}. Open Chicago Tracker for details.`,
        }
        : {
          key: m.key, category: 'vehicle', priority: 'urgent', tags: ['rotating_light'], click,
          title: '🚗 Your car was relocated by the city',
          message: 'Open Chicago Tracker to see where it was moved.',
        });
    }
  }

  if (time >= '19:00') {
    const tomorrow = addDays(today, 1);
    for (const h of inp.homes) for (const ws of h.zones) {
      if (!inp.isSweeping(ws, tomorrow)) continue;
      out.push({
        key: `sweep:${ws}:${tomorrow}`, category: 'sweeping', priority: 'default', tags: ['broom'], click,
        title: `🧹 Street cleaning tomorrow — ${pushLabel(h)}`,
        message: `Ward ${ws.slice(0, 2)} Sec ${ws.slice(2)}, typically 9am–2pm. Move your car tonight.`,
      });
    }
  }

  for (const { place, status, banKey } of inp.winter) {
    for (const a of status?.alerts ?? []) {
      if (!WINTER_EVENT_RE.test(a.event)) continue;
      out.push({ key: `nws:${a.id}`, category: 'winter', priority: 'high', tags: ['snowflake'], click, title: `❄️ ${a.event} — ${pushLabel(place)}`, message: a.headline });
    }
    if (status?.possibleBan && banKey) {
      out.push({
        key: banKey, category: 'snowban', priority: 'high', tags: ['snowflake'], click,
        title: `❄️ Possible 2-inch snow ban — ${pushLabel(place)}`,
        message: `Forecast ~${status.snowNext24hIn} in. in the next 24h and your street is on the city's 2-inch snow ban list. Watch for the city's ban announcement.`,
      });
    }
  }

  if (time >= '18:00' && inp.newWork.length) {
    const lines = inp.newWork.slice(0, 5).map((w) => `${w.utility ? UTIL_ICON[w.utility] : '🚧'} — ${w.title} (${w.start.slice(5, 10)}–${w.end.slice(5, 10)})`);
    if (inp.newWork.length > 5) lines.push(`…and ${inp.newWork.length - 5} more`);
    lines.push('Open Chicago Tracker for locations.');
    out.push({
      key: `digest:${today}`, category: 'work', priority: 'low', tags: ['construction'], click,
      title: '🛠️ New street work near home', message: lines.join('\n'), alsoMark: inp.newWork.map((w) => `work:${w.id}`),
    });
  }
  return out;
}

export function inQuietHours(hhmm: string, start: string, end: string): boolean {
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

/** Enabled categories only, never a key twice, and during quiet hours only urgent pushes. */
export function filterDeliverable(pushes: PlannedPush[], prefs: NotifyPrefs, nowLocal: string, wasNotified: (key: string) => boolean): PlannedPush[] {
  const quiet = inQuietHours(timePart(nowLocal), prefs.quietStart, prefs.quietEnd);
  return pushes.filter((p) => prefs.enabled[p.category] && !wasNotified(p.key) && (!quiet || p.priority === 'urgent'));
}
