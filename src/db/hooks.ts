import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayReport, ID, LogEntry, Track, Trip } from '../domain/types';
import { db } from './db';
import { getSettings, listDayReports, listEntries, listTracks } from './repo';

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

/** Object URL for a stored photo (photos are immutable); revoked on change/unmount. */
export function usePhotoUrl(photoId: ID | undefined): string | undefined {
  const [state, setState] = useState<{ photoId: ID; url: string }>();
  useEffect(() => {
    if (!photoId) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    void db.photos.get(photoId).then((photo) => {
      if (cancelled || !photo) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setState({ photoId, url: objectUrl });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);
  return state && state.photoId === photoId ? state.url : undefined;
}
