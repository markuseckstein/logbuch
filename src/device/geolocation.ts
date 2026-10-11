import type { Position } from '../domain';

export type FixError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export interface FixResult {
  position?: Position;
  error?: FixError;
}

const FIRST_DEADLINE_MS = 10_000;

const toPosition = (p: GeolocationPosition): Position => ({
  lat: p.coords.latitude,
  lon: p.coords.longitude,
  accuracyM: p.coords.accuracy,
});

const toError = (e: GeolocationPositionError): FixError =>
  e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';

/** Schneller Fix (gecachte/grobe Position erlaubt, ~3 s), danach Verbesserung per watchPosition
 *  für max. `improveForMs` (Default 20 s). `onImproved` wird bei jeder genaueren Position gerufen. */
export function captureFix(
  opts: { onImproved?: (p: Position) => void; improveForMs?: number } = {},
): { first: Promise<FixResult>; stop: () => void } {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { first: Promise.resolve({ error: 'unsupported' }), stop: () => {} };
  }
  const geo = navigator.geolocation;
  const improveForMs = opts.improveForMs ?? 20_000;

  let settled = false;
  let stopped = false;
  let best: Position | undefined;
  let watchId: number | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let firstTimer: ReturnType<typeof setTimeout> | undefined;
  let lastError: FixError | undefined;
  let resolveFirst: (r: FixResult) => void = () => {};
  const first = new Promise<FixResult>((r) => (resolveFirst = r));

  const settle = (r: FixResult): void => {
    if (settled) return;
    settled = true;
    if (firstTimer !== undefined) clearTimeout(firstTimer);
    resolveFirst(r);
  };

  const stop = (): void => {
    stopped = true;
    if (watchId !== undefined) geo.clearWatch(watchId);
    watchId = undefined;
    if (watchTimer !== undefined) clearTimeout(watchTimer);
    if (firstTimer !== undefined) clearTimeout(firstTimer);
    watchTimer = firstTimer = undefined;
  };

  const consider = (p: Position, notify: boolean): void => {
    if (stopped) return;
    const better = !best || (p.accuracyM ?? Infinity) < (best.accuracyM ?? Infinity);
    if (!better) return;
    best = p;
    if (settled && notify) opts.onImproved?.(p);
    else settle({ position: p });
  };

  const startWatch = (): void => {
    if (stopped || watchId !== undefined) return;
    watchId = geo.watchPosition(
      (p) => consider(toPosition(p), true),
      (e) => {
        lastError = toError(e);
        if (lastError === 'denied') settle({ error: 'denied' });
        else if (!best) settle({ error: lastError });
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    watchTimer = setTimeout(stop, improveForMs);
  };

  firstTimer = setTimeout(() => {
    settle(best ? { position: best } : { error: lastError ?? 'timeout' });
  }, FIRST_DEADLINE_MS);

  geo.getCurrentPosition(
    (p) => {
      consider(toPosition(p), false);
      startWatch();
    },
    (e) => {
      const err = toError(e);
      lastError = err;
      if (err === 'denied') {
        settle({ error: 'denied' });
        stop();
        return;
      }
      startWatch();
    },
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 3000 },
  );

  return { first, stop };
}
