import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { activeBoats } from '../domain/boats';
import type { Boat, CrewMember, DayReport, ID, LogEntry, Track, Trip } from '../domain/types';
import { db } from './db';
import { getSettings, listBoats, listCrew, listDayReports, listEntries, listTracks } from './repo';

/** The active trip; `undefined` while loading, `null` if none is selected. */
export function useActiveTrip(): Trip | null | undefined {
  return useLiveQuery(async () => {
    const { activeTripId } = await getSettings(db);
    if (!activeTripId) return null;
    return (await db.trips.get(activeTripId)) ?? null;
  }, []);
}

export function useEntries(tripId: ID | undefined): LogEntry[] | undefined {
  return useLiveQuery(() => (tripId ? listEntries(db, tripId) : []), [tripId]);
}

export function useDayReports(tripId: ID | undefined): DayReport[] | undefined {
  return useLiveQuery(() => (tripId ? listDayReports(db, tripId) : []), [tripId]);
}

export function useTracks(tripId: ID | undefined): Track[] | undefined {
  return useLiveQuery(() => (tripId ? listTracks(db, tripId) : []), [tripId]);
}

/** Boats of the trip without removed ones, in creation order; undefined while loading. */
export function useBoats(tripId: ID | undefined): Boat[] | undefined {
  // keyed by trip: useLiveQuery keeps the previous result while the query for a new trip runs
  const r = useLiveQuery(async () => ({ tripId, boats: tripId ? activeBoats(await listBoats(db, tripId)) : [] }), [tripId]);
  return r && r.tripId === tripId ? r.boats : undefined;
}

/** All boats incl. removed ones (names of old entries stay resolvable). */
export function useAllBoats(tripId: ID | undefined): Boat[] {
  return useLiveQuery(() => (tripId ? listBoats(db, tripId) : []), [tripId]) ?? [];
}

/** All crew members of the trip incl. removed ones (tombstones keep their names for author labels). */
export function useTripCrew(tripId: ID | undefined): CrewMember[] {
  return useLiveQuery(() => (tripId ? listCrew(db, tripId) : []), [tripId]) ?? [];
}

export interface PhotoImage {
  /** Object URL of the stored image. */
  url?: string;
  /** The photo row does not exist on this device (e.g. export without photos). */
  missing: boolean;
}

/** Object URL for a stored photo; `missing` when the row is absent. Reacts when the photo arrives later (import). */
export function usePhotoImage(photoId: ID | undefined): PhotoImage {
  const row = useLiveQuery(async () => (photoId ? ((await db.photos.get(photoId)) ?? null) : undefined), [photoId]);
  const [state, setState] = useState<{ blob: Blob; url: string }>();
  const blob = row?.blob;
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setState({ blob, url });
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return { ...(blob && state?.blob === blob ? { url: state.url } : {}), missing: row === null };
}

export function usePhotoUrl(photoId: ID | undefined): string | undefined {
  return usePhotoImage(photoId).url;
}
