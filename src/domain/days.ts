import type { DayReport, LogEntry, Trip } from './types';

const DAY_MS = 86_400_000;

/** Lokales Datum (YYYY-MM-DD) aus Zeitstempel und gespeichertem UTC-Offset. */
export function localDate(time: number, tzOffsetMin: number): string {
  return new Date(time + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

export interface DayGroup {
  date: string;
  entries: LogEntry[];
}

export function groupEntriesByDay(entries: readonly LogEntry[]): DayGroup[] {
  const byDate = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const date = localDate(e.time, e.tzOffsetMin);
    const list = byDate.get(date);
    if (list) list.push(e);
    else byDate.set(date, [e]);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => ({
      date,
      entries: (byDate.get(date) ?? []).sort((a, b) => a.time - b.time),
    }));
}

const dateToDays = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const daysToDate = (days: number): string => new Date(days * DAY_MS).toISOString().slice(0, 10);

/** Sortierte Liste aller Törntage (Einträge, Berichte, ggf. Zeitraum Start..Ende). */
export function tripDays(
  trip: Trip,
  entries: readonly LogEntry[],
  reports: readonly DayReport[],
): string[] {
  const set = new Set<string>();
  for (const e of entries) set.add(localDate(e.time, e.tzOffsetMin));
  for (const r of reports) set.add(r.date);
  if (trip.startDate && trip.endDate) {
    for (let d = dateToDays(trip.startDate); d <= dateToDays(trip.endDate); d++) {
      set.add(daysToDate(d));
    }
  }
  return [...set].sort();
}

/** Tagnummer (Kalendertage seit dem ersten Törntag, erster Tag = 1). */
export function dayNumber(trip: Trip, date: string, allDays: readonly string[]): number {
  const first = allDays[0] ?? trip.startDate ?? date;
  return dateToDays(date) - dateToDays(first) + 1;
}
