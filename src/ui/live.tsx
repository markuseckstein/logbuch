import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { keepScreenOn, startLiveTracking } from '../device';
import { db } from '../db/db';
import { addTrack, appendTrackPoints, deleteTrack } from '../db/repo';
import { localDate, type ID, type TrackPoint } from '../domain';
import { FIX_ERROR_LABEL, currentTzOffsetMin } from './lib';
import { useToast } from './toast';

export interface LiveRoute {
  active: boolean;
  /** Startzeit (epoch ms) der laufenden Aufzeichnung. */
  startedAt?: number;
  toggle: () => void;
}

const idle: LiveRoute = { active: false, toggle: () => undefined };
export const LiveRouteContext = createContext<LiveRoute>(idle);
export const useLiveRoute = (): LiveRoute => useContext(LiveRouteContext);

/** „Live 10.08.2026“ aus lokalem Datum. */
const liveName = (time: number): string => {
  const [y, m, d] = localDate(time, currentTzOffsetMin()).split('-');
  return `Live ${d}.${m}.${y}`;
};

interface Session {
  trackId: ID;
  stop: () => void;
  release: (() => void) | null;
  queue: Promise<void>;
}

/** Live-Route nur im Speicher: beim Neuladen aus. Hält den Bildschirm wach (Wake Lock). */
export function useLiveRouteState(tripId: ID): LiveRoute {
  const toast = useToast();
  const [startedAt, setStartedAt] = useState<number>();
  const session = useRef<Session | null>(null);
  const starting = useRef(false);

  const stop = useCallback(async (): Promise<void> => {
    const s = session.current;
    session.current = null;
    setStartedAt(undefined);
    if (!s) return;
    s.stop();
    s.release?.();
    await s.queue;
    const track = await db.tracks.get(s.trackId);
    if (track && track.points.length === 0) await deleteTrack(db, s.trackId);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (starting.current || session.current) return;
    starting.current = true;
    try {
      const release = await keepScreenOn();
      if (!release) toast('Bildschirm kann nicht wachgehalten werden – Display bitte nicht sperren');
      const now = Date.now();
      const track = await addTrack(db, tripId, { name: liveName(now), source: 'live', points: [] });
      const s: Session = { trackId: track.id, release, queue: Promise.resolve(), stop: () => undefined };
      s.stop = startLiveTracking({
        onPoint: (p: TrackPoint) => {
          s.queue = s.queue.then(() => appendTrackPoints(db, track.id, [p])).catch(() => undefined);
        },
        onError: (e) => toast(`Live-Route: GPS ${FIX_ERROR_LABEL[e]}`),
      });
      session.current = s;
      setStartedAt(now);
    } catch {
      toast('Live-Route konnte nicht gestartet werden');
    } finally {
      starting.current = false;
    }
  }, [tripId, toast]);

  // Beim Verlassen (z. B. Törn-Wechsel) sauber beenden.
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  const active = startedAt !== undefined;
  const toggle = useCallback((): void => {
    void (active ? stop() : start());
  }, [active, start, stop]);

  return useMemo(
    () => (startedAt === undefined ? { active, toggle } : { active, startedAt, toggle }),
    [active, startedAt, toggle],
  );
}
