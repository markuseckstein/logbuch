import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldKeepPoint, startLiveTracking } from './liveTrack';

const opts = { minIntervalMs: 30_000, minDistanceM: 25, maxAccuracyM: 50 };
// 0.001 deg lat ~ 111 m
const A = { lat: 54, lon: 10, time: 0, accuracyM: 5 };

describe('shouldKeepPoint', () => {
  it('keeps the first point if accurate enough', () => {
    expect(shouldKeepPoint(undefined, A, opts)).toBe(true);
  });
  it('drops inaccurate points', () => {
    expect(shouldKeepPoint(undefined, { ...A, accuracyM: 80 }, opts)).toBe(false);
    expect(shouldKeepPoint(A, { lat: 54.01, lon: 10, time: 60_000, accuracyM: 51 }, opts)).toBe(false);
  });
  it('drops points that are too soon', () => {
    expect(shouldKeepPoint(A, { lat: 54.01, lon: 10, time: 10_000, accuracyM: 5 }, opts)).toBe(false);
  });
  it('drops points that are too close', () => {
    // ~11 m
    expect(shouldKeepPoint(A, { lat: 54.0001, lon: 10, time: 60_000, accuracyM: 5 }, opts)).toBe(false);
  });
  it('keeps points far and late enough', () => {
    expect(shouldKeepPoint(A, { lat: 54.001, lon: 10, time: 30_000, accuracyM: 5 }, opts)).toBe(true);
  });
  it('treats missing accuracy as acceptable', () => {
    expect(shouldKeepPoint(undefined, { lat: 54, lon: 10, time: 0 }, opts)).toBe(true);
  });
});

describe('startLiveTracking', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    let success: PositionCallback = () => {};
    let failure: PositionErrorCallback = () => {};
    const clearWatch = vi.fn();
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: (s: PositionCallback, f: PositionErrorCallback) => {
          success = s;
          failure = f;
          return 7;
        },
        clearWatch,
      },
    });
    const emit = (lat: number, lon: number, accuracy: number, timestamp: number) =>
      success({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp } as GeolocationPosition);
    return { emit, clearWatch, fail: (code: number) => failure({ code, PERMISSION_DENIED: 1 } as GeolocationPositionError) };
  }

  it('emits filtered points and stops the watch', () => {
    const { emit, clearWatch } = setup();
    const onPoint = vi.fn();
    const stop = startLiveTracking({ onPoint });
    emit(54, 10, 5, 1000);
    emit(54.0001, 10, 5, 100_000); // too close
    emit(54.01, 10, 100, 100_000); // inaccurate
    emit(54.01, 10, 5, 100_000);
    expect(onPoint.mock.calls.map((c) => c[0])).toEqual([
      { lat: 54, lon: 10, time: 1000 },
      { lat: 54.01, lon: 10, time: 100_000 },
    ]);
    stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('reports errors', () => {
    const { fail } = setup();
    const onError = vi.fn();
    startLiveTracking({ onPoint: vi.fn(), onError });
    fail(1);
    expect(onError).toHaveBeenCalledWith('denied');
  });

  it('reports unsupported', () => {
    vi.stubGlobal('navigator', {});
    const onError = vi.fn();
    startLiveTracking({ onPoint: vi.fn(), onError })();
    expect(onError).toHaveBeenCalledWith('unsupported');
  });
});
