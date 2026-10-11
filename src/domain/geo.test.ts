import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceNm, routeDistanceNm } from './geo';

const kiel = { lat: 54.3721, lon: 10.1452 };
const marstal = { lat: 54.8546, lon: 10.5172 };

describe('distanceNm', () => {
  it('Kiel-Holtenau -> Marstal ca. 31,7 sm', () => {
    expect(distanceNm(kiel, marstal)).toBeCloseTo(31.73, 1);
  });
  it('ist symmetrisch und 0 bei gleichem Punkt', () => {
    expect(distanceNm(kiel, kiel)).toBe(0);
    expect(distanceNm(marstal, kiel)).toBeCloseTo(distanceNm(kiel, marstal), 9);
  });
  it('ein Grad am Äquator = 60,04 sm (R = 3440,065)', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.04, 2);
  });
  it('über die Datumsgrenze und mit negativen Koordinaten', () => {
    expect(distanceNm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(60.04, 2);
    expect(distanceNm({ lat: -34, lon: -58 }, { lat: -34, lon: -57 })).toBeGreaterThan(40);
  });
});

describe('routeDistanceNm', () => {
  it('leer und ein Punkt = 0', () => {
    expect(routeDistanceNm([])).toBe(0);
    expect(routeDistanceNm([kiel])).toBe(0);
  });
  it('summiert die Teilstrecken', () => {
    const mid = { lat: 54.6, lon: 10.3 };
    expect(routeDistanceNm([kiel, mid, marstal])).toBeCloseTo(
      distanceNm(kiel, mid) + distanceNm(mid, marstal),
      9,
    );
    expect(routeDistanceNm([kiel, marstal])).toBeCloseTo(31.73, 1);
  });
});

describe('bearingDeg', () => {
  it('Kiel -> Marstal ca. 24°', () => {
    expect(bearingDeg(kiel, marstal)).toBeCloseTo(23.9, 1);
  });
  it('Himmelsrichtungen', () => {
    const o = { lat: 10, lon: 10 };
    expect(bearingDeg(o, { lat: 11, lon: 10 })).toBeCloseTo(0, 5);
    expect(bearingDeg(o, { lat: 10, lon: 11 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 9, lon: 10 })).toBeCloseTo(180, 5);
    expect(bearingDeg(o, { lat: 10, lon: 9 })).toBeCloseTo(270, 0);
  });
  it('liegt immer in 0..359 (Wrap)', () => {
    const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 0.0001, lon: -0.5 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});
