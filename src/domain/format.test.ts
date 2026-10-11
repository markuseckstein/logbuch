import { describe, expect, it } from 'vitest';
import {
  formatDateLong,
  formatDuration,
  formatLat,
  formatLon,
  formatNm,
  formatPosition,
  formatTime,
  toIsoWithOffset,
} from './format';

describe('formatLat / formatLon', () => {
  it('Standardfall', () => {
    expect(formatLat(54.3183)).toBe('54°19,1′N');
    expect(formatLon(10.1400)).toBe('010°08,4′E');
  });
  it('Süd und West', () => {
    expect(formatLat(-33.5)).toBe('33°30,0′S');
    expect(formatLon(-70.25)).toBe('070°15,0′W');
  });
  it('Dezimalstellen', () => {
    expect(formatLat(54.3183, 2)).toBe('54°19,10′N');
    expect(formatLat(54.3183, 0)).toBe('54°19′N');
  });
  it('Rundung auf 60,0 ergibt Grad+1', () => {
    expect(formatLat(54.99993)).toBe('55°00,0′N');
    expect(formatLon(-9.99999)).toBe('010°00,0′W');
  });
  it('Null und 180', () => {
    expect(formatLat(0)).toBe('00°00,0′N');
    expect(formatLon(180)).toBe('180°00,0′E');
  });
});

describe('formatPosition', () => {
  it('kombiniert Breite und Länge', () => {
    expect(formatPosition({ lat: 54.3183, lon: 10.14 })).toBe('54°19,1′N 010°08,4′E');
    expect(formatPosition({ lat: 54.3183, lon: 10.14 }, 2)).toBe('54°19,10′N 010°08,40′E');
  });
});

describe('formatNm', () => {
  it('Dezimalkomma', () => {
    expect(formatNm(12.34)).toBe('12,3 sm');
    expect(formatNm(0)).toBe('0,0 sm');
  });
});

describe('formatDuration', () => {
  it('Stunden und Minuten', () => {
    expect(formatDuration(245)).toBe('4 h 05 min');
    expect(formatDuration(0)).toBe('0 h 00 min');
    expect(formatDuration(59.6)).toBe('1 h 00 min');
  });
});

describe('formatTime', () => {
  const t = Date.UTC(2026, 7, 10, 12, 32); // 12:32 UTC
  it('lokale Zeit anhand des Offsets', () => {
    expect(formatTime(t, 120)).toBe('14:32');
    expect(formatTime(t, 0)).toBe('12:32');
    expect(formatTime(t, -330)).toBe('07:02');
  });
  it('Tagesüberlauf', () => {
    expect(formatTime(Date.UTC(2026, 7, 10, 23, 30), 120)).toBe('01:30');
  });
});

describe('formatDateLong', () => {
  it('Wochentag und Datum', () => {
    expect(formatDateLong('2026-08-10')).toBe('Mo 10.08.2026');
    expect(formatDateLong('2026-08-16')).toBe('So 16.08.2026');
    expect(formatDateLong('2026-01-01')).toBe('Do 01.01.2026');
  });
});

describe('toIsoWithOffset', () => {
  const t = Date.UTC(2026, 7, 10, 12, 32);
  it('positiver, negativer und Null-Offset', () => {
    expect(toIsoWithOffset(t, 120)).toBe('2026-08-10T14:32:00+02:00');
    expect(toIsoWithOffset(t, -210)).toBe('2026-08-10T09:02:00-03:30');
    expect(toIsoWithOffset(t, 0)).toBe('2026-08-10T12:32:00+00:00');
  });
  it('Datumswechsel durch Offset', () => {
    expect(toIsoWithOffset(Date.UTC(2026, 7, 10, 23, 30, 5), 120)).toBe('2026-08-11T01:30:05+02:00');
  });
});
