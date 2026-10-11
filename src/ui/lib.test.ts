import { describe, expect, it } from 'vitest';
import type { DayReport, LogEntry, Track, Trip } from '../domain';
import { buildDays, groupTrackPoints } from './lib';

const trip: Trip = { id: 't', name: 'T', boat: { name: 'B' }, crew: [], createdAt: 0, updatedAt: 0 };
const track = (points: Track['points']): Track => ({
  id: 'k',
  tripId: 't',
  name: 'x',
  source: 'gpx',
  points,
  createdAt: 0,
});

describe('groupTrackPoints', () => {
  it('ordnet Punkte per Zeit und Offset dem lokalen Tag zu, Punkte ohne Zeit nur zur Anzeige', () => {
    const g = groupTrackPoints(
      [
        track([
          { lat: 54, lon: 10, time: Date.UTC(2026, 7, 10, 23, 30) }, // +120 -> 11.08.
          { lat: 54.1, lon: 10.1, time: Date.UTC(2026, 7, 10, 10, 0) },
        ]),
        track([
          { lat: 1, lon: 1 },
          { lat: 2, lon: 2 },
        ]),
      ],
      120,
    );
    expect(Object.keys(g.byDate).sort()).toEqual(['2026-08-10', '2026-08-11']);
    expect(g.untimed).toHaveLength(1);
  });
});

describe('buildDays', () => {
  it('nutzt Track-Punkte für Distanz und erzeugt Tage nur aus Tracks', () => {
    const entries: LogEntry[] = [];
    const reports: DayReport[] = [];
    const grouping = groupTrackPoints(
      [
        track([
          { lat: 54, lon: 10, time: Date.UTC(2026, 7, 10, 8) },
          { lat: 54.1, lon: 10, time: Date.UTC(2026, 7, 10, 9) },
        ]),
      ],
      0,
    );
    const days = buildDays(trip, entries, reports, grouping);
    expect(days).toHaveLength(1);
    expect(days[0]?.no).toBe(1);
    expect(days[0]?.stats.distanceNm).toBeCloseTo(6, 0);
  });
});
