import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useDayReports, useEntries, useTracks } from '../db/hooks';
import { getSettings, listTrips } from '../db/repo';
import { localDate, type ID, type LatLon, type LogEntry, type Settings, type Track, type Trip } from '../domain';
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

/**
 * Alle Tage des Törns inkl. Track-Zuordnung, beschränkt auf die Boote `boatIds` (Boot-Schalter); die Tagesliste
 * selbst gilt für den ganzen Törn. undefined, solange Daten laden.
 */
export function useTripDays(trip: Trip, boatIds?: readonly ID[]): TripDaysData | undefined {
  const entries = useEntries(trip.id);
  const reports = useDayReports(trip.id);
  const tracks = useTracks(trip.id);
  const key = boatIds?.join(',');
  return useMemo(() => {
    if (!entries || !reports || !tracks) return undefined;
    const ids = key === undefined ? undefined : new Set(key.split(','));
    const es = ids ? entries.filter((e) => ids.has(e.boatId)) : entries;
    const ts = ids ? tracks.filter((t) => ids.has(t.boatId)) : tracks;
    const grouping = groupTrackPoints(ts, currentTzOffsetMin());
    const allDates = buildDays(trip, entries, reports, groupTrackPoints(tracks, currentTzOffsetMin())).map((d) => d.date);
    const days = buildDays(trip, es, reports, grouping, allDates);
    const boatIds = [...new Set([...es.map((e) => e.boatId), ...ts.map((t) => t.boatId)])];
    if (boatIds.length > 1) {
      // Strecke je Boot summieren (keine Route quer über mehrere Boote)
      const perBoat = boatIds.map((id) => buildDays(
        trip, es.filter((e) => e.boatId === id), [], groupTrackPoints(ts.filter((t) => t.boatId === id), currentTzOffsetMin()), allDates,
      ));
      days.forEach((d, i) => {
        d.stats = { ...d.stats, distanceNm: perBoat.reduce((a, b) => a + (b[i]?.stats.distanceNm ?? 0), 0), underwayMin: 0 };
      });
    }
    return { days, untimed: grouping.untimed, tracks: ts, entries: es };
  }, [trip, entries, reports, tracks, key]);
}

/**
 * Noch nicht beschreibbar? Nur in geteilten Törns, solange die Mitgliedschaft nicht vom Server bestätigt ist.
 * Solange geladen wird: false.
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
