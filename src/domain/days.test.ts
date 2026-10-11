import { describe, expect, it } from 'vitest';
import { dayNumber, groupEntriesByDay, localDate, tripDays } from './days';
import type { DayReport, LogEntry, Trip } from './types';

const entry = (time: number, tzOffsetMin = 120, id = String(time)): LogEntry => ({
  id,
  tripId: 't',
  time,
  tzOffsetMin,
  type: 'note',
  photoIds: [],
  createdAt: time,
  updatedAt: time,
});
const report = (date: string): DayReport => ({ tripId: 't', date, text: 'x', updatedAt: 0 });
const trip = (extra: Partial<Trip> = {}): Trip => ({
  id: 't',
  name: 'T',
  boat: { name: 'B' },
  crew: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('localDate', () => {
  it('nutzt den gespeicherten Offset', () => {
    const t = Date.UTC(2026, 7, 10, 22, 30);
    expect(localDate(t, 0)).toBe('2026-08-10');
    expect(localDate(t, 120)).toBe('2026-08-11');
  });
  it('negativer Offset über Mitternacht zurück', () => {
    expect(localDate(Date.UTC(2026, 0, 1, 1, 0), -300)).toBe('2025-12-31');
  });
});

describe('groupEntriesByDay', () => {
  it('leer', () => {
    expect(groupEntriesByDay([])).toEqual([]);
  });
  it('sortiert Tage und Einträge chronologisch', () => {
    const a = entry(Date.UTC(2026, 7, 11, 9, 0), 120, 'a');
    const b = entry(Date.UTC(2026, 7, 10, 12, 0), 120, 'b');
    const c = entry(Date.UTC(2026, 7, 10, 8, 0), 120, 'c');
    const groups = groupEntriesByDay([a, b, c]);
    expect(groups.map((g) => g.date)).toEqual(['2026-08-10', '2026-08-11']);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['c', 'b']);
  });
  it('Datumsgrenze: 23:30 UTC mit +02:00 gehört zum Folgetag', () => {
    const e = entry(Date.UTC(2026, 7, 10, 23, 30), 120);
    expect(groupEntriesByDay([e])[0]?.date).toBe('2026-08-11');
  });
  it('mutiert die Eingabe nicht', () => {
    const list = [entry(2000), entry(1000)];
    groupEntriesByDay(list);
    expect(list[0]?.time).toBe(2000);
  });
});

describe('tripDays', () => {
  it('leer ohne Daten', () => {
    expect(tripDays(trip(), [], [])).toEqual([]);
  });
  it('Vereinigung aus Einträgen und Berichten, sortiert, ohne Duplikate', () => {
    const e = [entry(Date.UTC(2026, 7, 12, 10, 0))];
    const r = [report('2026-08-10'), report('2026-08-12')];
    expect(tripDays(trip(), e, r)).toEqual(['2026-08-10', '2026-08-12']);
  });
  it('Zeitraum nur, wenn Start und Ende gesetzt sind', () => {
    const e = [entry(Date.UTC(2026, 7, 11, 10, 0))];
    expect(tripDays(trip({ startDate: '2026-08-10' }), e, [])).toEqual(['2026-08-11']);
    expect(tripDays(trip({ startDate: '2026-08-10', endDate: '2026-08-12' }), e, [])).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
  });
  it('Zeitraum über Monatsgrenze', () => {
    expect(tripDays(trip({ startDate: '2026-08-30', endDate: '2026-09-01' }), [], [])).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });
  it('Endedatum vor Start liefert keinen Zeitraum', () => {
    expect(tripDays(trip({ startDate: '2026-08-12', endDate: '2026-08-10' }), [], [])).toEqual([]);
  });
});

describe('dayNumber', () => {
  const days = ['2026-08-10', '2026-08-11', '2026-08-14'];
  it('erster Tag ist 1', () => {
    expect(dayNumber(trip(), '2026-08-10', days)).toBe(1);
  });
  it('zählt Kalendertage ab dem ersten Tag', () => {
    expect(dayNumber(trip(), '2026-08-11', days)).toBe(2);
    expect(dayNumber(trip(), '2026-08-14', days)).toBe(5);
  });
  it('Fallback auf startDate bei leerer Liste', () => {
    expect(dayNumber(trip({ startDate: '2026-08-10' }), '2026-08-12', [])).toBe(3);
    expect(dayNumber(trip(), '2026-08-12', [])).toBe(1);
  });
});
