import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useDayReports, useEntries, useTracks } from '../db/hooks';
import { getSettings, listEntries, listFlotillaTrips, listTracks, listTrips } from '../db/repo';
import { localDate, type LatLon, type LogEntry, type Settings, type Track, type Trip } from '../domain';
import { buildDays, currentTzOffsetMin, groupTrackPoints, type DayInfo } from './lib';
import { useWritableTripIds } from './cloudHooks';

/** Von `Root` bereitgestellte Einstellungen: innerhalb der App sofort verfügbar, ohne Flackern. */
export const SettingsContext = createContext<Settings | undefined>(undefined);

export function useSettings(): Settings | undefined {
  const provided = useContext(SettingsContext);
  const own = useLiveQuery(() => (provided ? undefined : getSettings(db)), [provided]);
  return provided ?? own;
}

export function useTrips(): Trip[] | undefined {
  return useLiveQuery(() => listTrips(db), []);
}

const computeToday = (): string => localDate(Date.now(), currentTzOffsetMin());

/** Heutiges lokales Datum (YYYY-MM-DD); aktualisiert sich über Mitternacht. */
export function useToday(): string {
  const [today, setToday] = useState(computeToday);
  useEffect(() => {
    const id = setInterval(() => setToday(computeToday()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

export interface TripDaysData {
  days: DayInfo[];
  untimed: LatLon[][];
  tracks: Track[];
  entries: LogEntry[];
}

/** Alle Tage des Törns inkl. Track-Zuordnung; undefined, solange Daten laden. */
export function useTripDays(trip: Trip): TripDaysData | undefined {
  const entries = useEntries(trip.id);
  const reports = useDayReports(trip.id);
  const tracks = useTracks(trip.id);
  return useMemo(() => {
    if (!entries || !reports || !tracks) return undefined;
    const grouping = groupTrackPoints(tracks, currentTzOffsetMin());
    return { days: buildDays(trip, entries, reports, grouping), untimed: grouping.untimed, tracks, entries };
  }, [trip, entries, reports, tracks]);
}

/**
 * Fremdes (nicht beschreibbares) Logbuch? Lokal: nicht in `writableTripIds`; in der Cloud geteilt:
 * Server-Rechte (Crew schreibt, andere Boote lesen). Solange geladen wird: false.
 */
export function useReadOnly(tripId: string | undefined): boolean {
  const writable = useWritableTripIds();
  if (!writable || !tripId) return false;
  return !writable.includes(tripId);
}

/** „Ich bin …“ dieses Geräts im Logbuch. */
export function useAuthorId(tripId: string | undefined): string | undefined {
  const settings = useSettings();
  return tripId ? settings?.authorByTrip[tripId] : undefined;
}

/** Die anderen Boote (Trips) der Flottille des Trips; leer ohne Flottille. */
export function useFleetTrips(trip: Trip): Trip[] {
  const flotillaId = trip.flotilla?.id;
  const trips = useLiveQuery(() => (flotillaId ? listFlotillaTrips(db, flotillaId) : []), [flotillaId]);
  return useMemo(() => (trips ?? []).filter((t) => t.id !== trip.id), [trips, trip.id]);
}

export interface FleetBoat {
  trip: Trip;
  entries: LogEntry[];
  tracks: Track[];
}

/** Einträge und Tracks der anderen Boote; nur geladen, solange `enabled`. */
export function useFleetBoats(others: readonly Trip[], enabled: boolean): FleetBoat[] {
  const ids = others.map((t) => t.id).join(',');
  return (
    useLiveQuery(
      async () => {
        if (!enabled) return [];
        const out: FleetBoat[] = [];
        for (const t of others) out.push({ trip: t, entries: await listEntries(db, t.id), tracks: await listTracks(db, t.id) });
        return out;
      },
      [enabled, ids, others],
    ) ?? []
  );
}
