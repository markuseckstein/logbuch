import { describe, expect, it } from 'vitest';
import { dayRoute, dayStats, tripStats } from './stats';
import type { EntryType, LogEntry, TrackPoint } from './types';

const MIN = 60000;
const T0 = Date.UTC(2026, 7, 10, 6, 0); // 06:00 UTC = 08:00 lokal
const e = (
  minute: number,
  type: EntryType = 'note',
  lat?: number,
  lon?: number,
  tzOffsetMin = 120,
): LogEntry => ({
  id: `e${minute}`,
  tripId: 't',
  boatId: 'b',
  time: T0 + minute * MIN,
  tzOffsetMin,
  type,
  position: lat === undefined || lon === undefined ? undefined : { lat, lon },
  photoIds: [],
  createdAt: 0,
  updatedAt: 0,
  updatedBy: 'd',
});

const kiel = { lat: 54.3721, lon: 10.1452 };
const marstal = { lat: 54.8546, lon: 10.5172 };

describe('dayStats', () => {
  it('leer', () => {
    expect(dayStats([])).toEqual({ distanceNm: 0, underwayMin: 0, entryCount: 0 });
  });

  it('Distanz über Eintragspositionen, Zeit von Ablegen bis Hafen', () => {
    const s = dayStats([
      e(240, 'harbour', marstal.lat, marstal.lon),
      e(0, 'departure', kiel.lat, kiel.lon),
    ]);
    expect(s.distanceNm).toBeCloseTo(31.73, 1);
    expect(s.underwayMin).toBe(240);
    expect(s.entryCount).toBe(2);
  });

  it('Einträge ohne Position zählen, tragen aber nicht zur Distanz bei', () => {
    const s = dayStats([
      e(0, 'departure', kiel.lat, kiel.lon),
      e(60, 'note'),
      e(120, 'harbour', marstal.lat, marstal.lon),
    ]);
    expect(s.entryCount).toBe(3);
    expect(s.distanceNm).toBeCloseTo(31.73, 1);
  });

  it('Track hat Vorrang vor Eintragspositionen', () => {
    const track: TrackPoint[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ];
    const s = dayStats([e(0, 'departure', kiel.lat, kiel.lon), e(60, 'harbour', marstal.lat, marstal.lon)], track);
    expect(s.distanceNm).toBeCloseTo(60.04, 1);
  });

  it('Track mit nur einem Punkt wird ignoriert', () => {
    const s = dayStats(
      [e(0, 'departure', kiel.lat, kiel.lon), e(60, 'harbour', marstal.lat, marstal.lon)],
      [{ lat: 0, lon: 0 }],
    );
    expect(s.distanceNm).toBeCloseTo(31.73, 1);
  });

  it('Fallback der Fahrzeit: erster bis letzter Eintrag mit Position', () => {
    const s = dayStats([
      e(0, 'note'),
      e(30, 'sails-up', 54.4, 10.2),
      e(150, 'sails-down', 54.5, 10.3),
      e(200, 'note'),
    ]);
    expect(s.underwayMin).toBe(120);
  });

  it('Fallback, wenn Ablegen ohne Ankunft', () => {
    const s = dayStats([e(10, 'departure', 54.4, 10.2), e(70, 'note', 54.5, 10.3)]);
    expect(s.underwayMin).toBe(60);
  });

  it('Anker und Boje beenden die Fahrt; letzter Endeintrag zählt', () => {
    const s = dayStats([
      e(0, 'departure', 54.4, 10.2),
      e(90, 'anchorage', 54.5, 10.3),
      e(300, 'mooring', 54.6, 10.4),
    ]);
    expect(s.underwayMin).toBe(300);
  });

  it('nur ein positionierter Eintrag -> 0 min, 0 sm', () => {
    const s = dayStats([e(0, 'note', 54.4, 10.2)]);
    expect(s.underwayMin).toBe(0);
    expect(s.distanceNm).toBe(0);
  });
});

describe('dayRoute', () => {
  it('Track hat Vorrang', () => {
    const track: TrackPoint[] = [
      { lat: 1, lon: 2, time: 5 },
      { lat: 3, lon: 4 },
    ];
    expect(dayRoute([e(0, 'note', 9, 9)], track)).toEqual([
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ]);
  });
  it('sonst Eintragspositionen chronologisch ohne Lücken', () => {
    const r = dayRoute([e(60, 'note', 2, 2), e(30, 'note'), e(0, 'note', 1, 1)]);
    expect(r).toEqual([
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    ]);
  });
  it('leer', () => {
    expect(dayRoute([])).toEqual([]);
  });
});

describe('tripStats', () => {
  it('leer', () => {
    expect(tripStats([])).toEqual({ distanceNm: 0, underwayMin: 0, entryCount: 0, dayCount: 0 });
  });
  it('summiert über Tage; Distanz nicht tagesübergreifend', () => {
    const day2 = 24 * 60;
    const s = tripStats([
      e(0, 'departure', kiel.lat, kiel.lon),
      e(240, 'harbour', marstal.lat, marstal.lon),
      e(day2, 'departure', 0, 0),
      e(day2 + 60, 'harbour', 0, 1),
    ]);
    expect(s.dayCount).toBe(2);
    expect(s.entryCount).toBe(4);
    expect(s.underwayMin).toBe(300);
    expect(s.distanceNm).toBeCloseTo(31.73 + 60.04, 1);
  });
});
