import type { FixError } from '../device';
import { NotPermittedError } from '../db/repo';
import {
  ENTRY_TYPE_LABELS,
  dayNumber,
  dayRoute,
  dayStats,
  type ID,
  groupEntriesByDay,
  localDate,
  tripDays,
  type Boat,
  type CrewMember,
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
  /** Alle Abschnitte des Tages (je Autor einer). */
  sections: DayReport[];
  /** Auszug für Listen: erster Abschnitt mit Text (sonst erster Abschnitt). */
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
  /** Feste Tagesliste (alle Boote), damit Tagnummern beim Boot-Schalter gleich bleiben. */
  fixedDates?: readonly string[],
): DayInfo[] {
  const dates = fixedDates
    ? [...fixedDates]
    : [...new Set([...tripDays(trip, entries, reports), ...Object.keys(grouping.byDate)])].sort();
  const groups = new Map(groupEntriesByDay(entries).map((g) => [g.date, g.entries]));
  return dates.map((date) => {
    const es = groups.get(date) ?? [];
    const tp = grouping.byDate[date];
    const sections = reports.filter((r) => r.date === date);
    const report = sections.find((r) => r.text.trim() !== '') ?? sections[0];
    return {
      date,
      no: dayNumber(trip, date, dates),
      entries: es,
      sections,
      ...(report ? { report } : {}),
      stats: dayStats(es, tp),
      route: dayRoute(es, tp),
    };
  });
}

// ---------- Autoren ----------

/** Name des Crew-Mitglieds (auch entfernte); undefined ohne Autor oder unbekannte ID. */
export function authorName(crew: readonly CrewMember[], authorId: string | undefined): string | undefined {
  if (!authorId) return undefined;
  return crew.find((c) => c.id === authorId)?.name;
}

/** Initialen (max. 2 Buchstaben) für das Autoren-Badge. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return letters.map((p) => (p ? Array.from(p)[0] ?? '' : '')).join('').toUpperCase();
}

/** Meldung für fehlgeschlagene Schreibzugriffe (keine Berechtigung vs. sonstiger Fehler). */
export function writeErrorMessage(e: unknown, fallback: string): string {
  return e instanceof NotPermittedError ? 'Dafür fehlt dir die Berechtigung in diesem Törn.' : fallback;
}

/** Fotos eines Tages über alle Abschnitte. */
export function sectionPhotoIds(sections: readonly DayReport[]): string[] {
  return sections.flatMap((s) => s.photoIds);
}

// ---------- Boote auf der Karte ----------

export interface BoatMapLayer {
  id: string;
  colorIndex: number;
  label?: string;
  routes: { id: string; points: LatLon[] }[];
  entries: LogEntry[];
  /** Strecke (sm) der gezeigten Tage. */
  distanceNm: number;
}

/**
 * Kartenebenen je Boot: Route je Tag (Track, sonst Eintragspositionen) und Einträge der gewählten Tage
 * (`dates` undefined = alle Tage, dann auch Tracks ohne Zeit).
 */
export function boatLayers(
  trip: Trip,
  boats: readonly Boat[],
  entries: readonly LogEntry[],
  tracks: readonly Track[],
  opts: { dates?: readonly string[] | undefined; labels?: boolean } = {},
): BoatMapLayer[] {
  const tz = currentTzOffsetMin();
  return boats.map((b) => {
    const es = entries.filter((e) => e.boatId === b.id);
    const grouping = groupTrackPoints(tracks.filter((t) => t.boatId === b.id), tz);
    const days = buildDays(trip, es, [], grouping).filter((d) => !opts.dates || opts.dates.includes(d.date));
    const routes = days.map((d) => ({ id: `${b.id}:${d.date}`, points: d.route }));
    if (!opts.dates) grouping.untimed.forEach((points, i) => routes.push({ id: `${b.id}:untimed-${i}`, points }));
    return {
      id: b.id, colorIndex: b.colorIndex, ...(opts.labels ? { label: b.name } : {}), routes,
      entries: days.flatMap((d) => d.entries), distanceNm: days.reduce((a, d) => a + d.stats.distanceNm, 0),
    };
  });
}

/**
 * Statistik eines Tages für die gezeigten Boote: ein Boot → Tageswerte; mehrere → Summe der Strecken je Boot
 * (keine Route quer über Boote), Einträge und Zahl der Schreibenden.
 */
export function selectionDayStats(
  entries: readonly LogEntry[],
  trackByBoat: (boatId: ID) => readonly TrackPoint[] | undefined,
  boatIds: readonly ID[],
): { stats: DayStats; writers?: number } {
  if (boatIds.length === 1) {
    const id = boatIds[0]!;
    return { stats: dayStats(entries.filter((e) => e.boatId === id), trackByBoat(id)) };
  }
  let distanceNm = 0;
  for (const id of boatIds) distanceNm += dayStats(entries.filter((e) => e.boatId === id), trackByBoat(id)).distanceNm;
  const writers = new Set(entries.flatMap((e) => (e.authorId ? [e.authorId] : []))).size;
  return { stats: { distanceNm, underwayMin: 0, entryCount: entries.length }, writers };
}
