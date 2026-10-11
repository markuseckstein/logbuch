import { groupEntriesByDay } from './days';
import { routeDistanceNm, type LatLon } from './geo';
import type { LogEntry, TrackPoint } from './types';

export interface DayStats {
  distanceNm: number;
  underwayMin: number;
  entryCount: number;
}

export interface TripStats extends DayStats {
  dayCount: number;
}

const ARRIVAL_TYPES = new Set(['harbour', 'anchorage', 'mooring']);

const byTime = (entries: readonly LogEntry[]): LogEntry[] =>
  [...entries].sort((a, b) => a.time - b.time);

/** Route eines Tages: Track (>= 2 Punkte), sonst Eintragspositionen chronologisch. */
export function dayRoute(entries: readonly LogEntry[], trackPoints?: readonly TrackPoint[]): LatLon[] {
  if (trackPoints && trackPoints.length >= 2) {
    return trackPoints.map((p) => ({ lat: p.lat, lon: p.lon }));
  }
  const route: LatLon[] = [];
  for (const e of byTime(entries)) {
    if (e.position) route.push({ lat: e.position.lat, lon: e.position.lon });
  }
  return route;
}

function underwayMinutes(sorted: readonly LogEntry[]): number {
  const departure = sorted.find((e) => e.type === 'departure');
  if (departure) {
    const arrival = [...sorted]
      .reverse()
      .find((e) => ARRIVAL_TYPES.has(e.type) && e.time > departure.time);
    if (arrival) return (arrival.time - departure.time) / 60000;
  }
  const positioned = sorted.filter((e) => e.position);
  if (positioned.length < 2) return 0;
  const first = positioned[0];
  const last = positioned[positioned.length - 1];
  if (!first || !last) return 0;
  return (last.time - first.time) / 60000;
}

export function dayStats(entries: readonly LogEntry[], trackPoints?: readonly TrackPoint[]): DayStats {
  return {
    distanceNm: routeDistanceNm(dayRoute(entries, trackPoints)),
    underwayMin: underwayMinutes(byTime(entries)),
    entryCount: entries.length,
  };
}

/** Summe der Tagesstatistiken; optional Track-Punkte je Datum (YYYY-MM-DD). */
export function tripStats(
  entries: readonly LogEntry[],
  trackPointsByDate: Readonly<Record<string, readonly TrackPoint[]>> = {},
): TripStats {
  const groups = groupEntriesByDay(entries);
  const total: TripStats = { distanceNm: 0, underwayMin: 0, entryCount: 0, dayCount: groups.length };
  for (const g of groups) {
    const s = dayStats(g.entries, trackPointsByDate[g.date]);
    total.distanceNm += s.distanceNm;
    total.underwayMin += s.underwayMin;
    total.entryCount += s.entryCount;
  }
  return total;
}
