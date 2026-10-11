import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFix } from './geolocation';

type Ok = PositionCallback;
type Err = PositionErrorCallback;

const pos = (lat: number, lon: number, accuracy: number) =>
  ({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp: 0 }) as GeolocationPosition;
const err = (code: number) =>
  ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

function setup() {
  const s = {
    getOk: undefined as Ok | undefined,
    getErr: undefined as Err | undefined,
    getOpts: undefined as PositionOptions | undefined,
    watchOk: undefined as Ok | undefined,
    watchErr: undefined as Err | undefined,
    watchOpts: undefined as PositionOptions | undefined,
    clearWatch: vi.fn(),
    watchPosition: vi.fn(),
  };
  s.watchPosition.mockImplementation((ok: Ok, e: Err, o: PositionOptions) => {
    s.watchOk = ok;
    s.watchErr = e;
    s.watchOpts = o;
    return 42;
  });
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: Ok, e: Err, o: PositionOptions) => {
        s.getOk = ok;
        s.getErr = e;
        s.getOpts = o;
      },
      watchPosition: s.watchPosition,
      clearWatch: s.clearWatch,
    },
  });
  return s;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('captureFix', () => {
  it('reports unsupported without geolocation', async () => {
    vi.stubGlobal('navigator', {});
    const { first } = captureFix();
    expect(await first).toEqual({ error: 'unsupported' });
  });

  it('uses a fast coarse request first', () => {
    const s = setup();
    captureFix();
    expect(s.getOpts).toEqual({ enableHighAccuracy: false, maximumAge: 60000, timeout: 3000 });
  });

  it('resolves with the quick fix and starts a high-accuracy watch for improvements', async () => {
    const s = setup();
    const onImproved = vi.fn();
    const { first } = captureFix({ onImproved });
    s.getOk?.(pos(54, 10, 500));
    expect(await first).toEqual({ position: { lat: 54, lon: 10, accuracyM: 500 } });
    expect(s.watchOpts).toEqual({ enableHighAccuracy: true, maximumAge: 0 });
    s.watchOk?.(pos(54.1, 10.1, 20));
    expect(onImproved).toHaveBeenCalledWith({ lat: 54.1, lon: 10.1, accuracyM: 20 });
    s.watchOk?.(pos(54.2, 10.2, 30)); // worse -> ignored
    expect(onImproved).toHaveBeenCalledTimes(1);
  });

  it('resolves with watch result if the quick fix fails', async () => {
    const s = setup();
    const { first } = captureFix();
    s.getErr?.(err(3));
    s.watchOk?.(pos(1, 2, 15));
    expect(await first).toEqual({ position: { lat: 1, lon: 2, accuracyM: 15 } });
  });

  it('denied resolves immediately and starts no watch', async () => {
    const s = setup();
    const { first } = captureFix();
    s.getErr?.(err(1));
    expect(await first).toEqual({ error: 'denied' });
    expect(s.watchPosition).not.toHaveBeenCalled();
  });

  it('resolves with timeout after 10 s without any fix', async () => {
    setup();
    const { first } = captureFix();
    vi.advanceTimersByTime(10_000);
    expect(await first).toEqual({ error: 'timeout' });
  });

  it('reports unavailable when both fail with POSITION_UNAVAILABLE', async () => {
    const s = setup();
    const { first } = captureFix();
    s.getErr?.(err(2));
    s.watchErr?.(err(2));
    expect(await first).toEqual({ error: 'unavailable' });
  });

  it('stops the watch after improveForMs', () => {
    const s = setup();
    captureFix({ improveForMs: 5000 });
    s.getOk?.(pos(1, 1, 100));
    vi.advanceTimersByTime(5000);
    expect(s.clearWatch).toHaveBeenCalledWith(42);
  });

  it('stop() clears watch and timers', () => {
    const s = setup();
    const onImproved = vi.fn();
    const { stop } = captureFix({ onImproved });
    s.getOk?.(pos(1, 1, 100));
    stop();
    expect(s.clearWatch).toHaveBeenCalledWith(42);
    s.watchOk?.(pos(1, 1, 5));
    expect(onImproved).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
