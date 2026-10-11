import type { FixError } from '../device';
import {
  ENTRY_TYPE_LABELS,
  dayNumber,
  dayRoute,
  dayStats,
  groupEntriesByDay,
  localDate,
  tripDays,
  type DayReport,
  type DayStats,
  type EntryType,
  type LatLon,
  type LogEntry,
  type Track,
  type TrackPoint,
  type Trip,
} from '../domain';

export const ENTRY_TYPES = Object.keys(ENTRY_TYPE_LABELS) as EntryType[];

export const FIX_ERROR_LABEL: Record<FixError, string> = {
  denied: 'Zugriff verweigert',
  unavailable: 'nicht verfügbar',
  timeout: 'Zeitüberschreitung',
  unsupported: 'nicht unterstützt',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Aktueller lokaler UTC-Offset in Minuten (positiv östlich von UTC). */
export const currentTzOffsetMin = (): number => -new Date().getTimezoneOffset();

/** Fahrtzeit als h:mm, 0 -> Gedankenstrich. */
export function formatUnderway(min: number): string {
  const total = Math.round(min);
  return total > 0 ? `${Math.floor(total / 60)}:${pad(total % 60)}` : '–';
}

/** Zahl mit Dezimalkomma, eine Nachkommastelle. */
export const num1 = (n: number): string => n.toFixed(1).replace('.', ',');

/** epoch ms + Offset -> Wert für <input type="datetime-local"> (lokale Zeit des Eintrags). */
export function toLocalInput(time: number, tzOffsetMin: number): string {
  return new Date(time + tzOffsetMin * 60000).toISOString().slice(0, 16);
}

/** Gegenstück zu toLocalInput; undefined bei ungültiger Eingabe. */
export function fromLocalInput(value: string, tzOffsetMin: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? undefined : ms - tzOffsetMin * 60000;
}

/** Dezimalzahl mit Punkt oder Komma; undefined, wenn leer/ungültig. */
export function parseDecimal(value: string): number | undefined {
  const s = value.trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- Tage, Tracks, Karte ----------

export interface TrackGrouping {
  /** Punkte mit Zeit je lokalem Datum, chronologisch. */
  byDate: Record<string, TrackPoint[]>;
  /** Tracks ohne Zeitstempel: nur Anzeige, keine Tageszuordnung. */
  untimed: LatLon[][];
}

/** Ordnet Track-Punkte per Punktzeit und Geräte-Offset den Tagen zu. */
export function groupTrackPoints(tracks: readonly Track[], tzOffsetMin: number): TrackGrouping {
  const byDate: Record<string, TrackPoint[]> = {};
  const untimed: LatLon[][] = [];
  for (const t of tracks) {
    const loose: LatLon[] = [];
    for (const p of t.points) {
      if (p.time === undefined) loose.push({ lat: p.lat, lon: p.lon });
      else (byDate[localDate(p.time, tzOffsetMin)] ??= []).push(p);
    }
    if (loose.length >= 2) untimed.push(loose);
  }
  for (const list of Object.values(byDate)) list.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return { byDate, untimed };
}

export interface DayInfo {
  date: string;
  no: number;
  entries: LogEntry[];
  report?: DayReport;
  stats: DayStats;
  route: LatLon[];
}

/** Alle Törntage (inkl. Tage, die nur Track-Punkte haben) mit Statistik und Route. */
export function buildDays(
  trip: Trip,
  entries: readonly LogEntry[],
  reports: readonly DayReport[],
  grouping: TrackGrouping,
): DayInfo[] {
  const dates = [...new Set([...tripDays(trip, entries, reports), ...Object.keys(grouping.byDate)])].sort();
  const groups = new Map(groupEntriesByDay(entries).map((g) => [g.date, g.entries]));
  return dates.map((date) => {
    const es = groups.get(date) ?? [];
    const tp = grouping.byDate[date];
    const report = reports.find((r) => r.date === date);
    return {
      date,
      no: dayNumber(trip, date, dates),
      entries: es,
      ...(report ? { report } : {}),
      stats: dayStats(es, tp),
      route: dayRoute(es, tp),
    };
  });
}
