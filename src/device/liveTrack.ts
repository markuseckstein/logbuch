import { distanceNm } from '../domain';
import type { TrackPoint } from '../domain';
import type { FixError } from './geolocation';

export interface FilterOpts {
  minIntervalMs: number;
  minDistanceM: number;
  maxAccuracyM: number;
}

export interface Candidate extends TrackPoint {
  accuracyM?: number;
}

/** Reine Filterlogik: Punkt behalten? */
export function shouldKeepPoint(
  prev: TrackPoint | undefined,
  next: Candidate,
  opts: FilterOpts,
): boolean {
  if (next.accuracyM !== undefined && next.accuracyM > opts.maxAccuracyM) return false;
  if (!prev) return true;
  if (prev.time !== undefined && next.time !== undefined && next.time - prev.time < opts.minIntervalMs) {
    return false;
  }
  return distanceNm(prev, next) * 1852 >= opts.minDistanceM;
}

/** watchPosition-basiertes Live-Tracking (nur Vordergrund). Rückgabe: stop(). */
export function startLiveTracking(opts: {
  onPoint: (p: TrackPoint) => void;
  onError?: (e: FixError) => void;
  minIntervalMs?: number;
  minDistanceM?: number;
}): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    opts.onError?.('unsupported');
    return () => {};
  }
  const filter: FilterOpts = {
    minIntervalMs: opts.minIntervalMs ?? 30_000,
    minDistanceM: opts.minDistanceM ?? 25,
    maxAccuracyM: 50,
  };
  let last: TrackPoint | undefined;
  const id = navigator.geolocation.watchPosition(
    (p) => {
      const point: TrackPoint = { lat: p.coords.latitude, lon: p.coords.longitude, time: p.timestamp };
      if (!shouldKeepPoint(last, { ...point, accuracyM: p.coords.accuracy }, filter)) return;
      last = point;
      opts.onPoint(point);
    },
    (e) => opts.onError?.(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 0 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
