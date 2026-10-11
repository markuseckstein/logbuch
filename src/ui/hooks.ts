import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useDayReports, useEntries, useTracks } from '../db/hooks';
import { getSettings, listTrips } from '../db/repo';
import { localDate, type LatLon, type LogEntry, type Settings, type Track, type Trip } from '../domain';
import { buildDays, currentTzOffsetMin, groupTrackPoints, type DayInfo } from './lib';

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(db), []);
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
