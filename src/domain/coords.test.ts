import { describe, expect, it } from 'vitest';
import { parseCoordinate } from './coords';

const lat = (s: string) => parseCoordinate(s, 'lat');
const lon = (s: string) => parseCoordinate(s, 'lon');
const val = (r: ReturnType<typeof parseCoordinate>): number => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parseCoordinate – Dezimalgrad', () => {
  it('Punkt und Komma', () => {
    expect(val(lat('54.318'))).toBeCloseTo(54.318, 6);
    expect(val(lat('54,318'))).toBeCloseTo(54.318, 6);
    expect(val(lon('10.141'))).toBeCloseTo(10.141, 6);
  });
  it('Vorzeichen', () => {
    expect(val(lat('-33.5'))).toBe(-33.5);
    expect(val(lon('−70,25'))).toBe(-70.25);
    expect(val(lat('+12'))).toBe(12);
  });
  it('mit Gradzeichen und Leerraum', () => {
    expect(val(lat(' 54.318° '))).toBeCloseTo(54.318, 6);
  });
});

describe('parseCoordinate – Grad und Minuten', () => {
  it('„54 19,1“', () => {
    expect(val(lat('54 19,1'))).toBeCloseTo(54 + 19.1 / 60, 6);
  });
  it('„54°19,1′“', () => {
    expect(val(lat('54°19,1′'))).toBeCloseTo(54 + 19.1 / 60, 6);
  });
  it('„54°19.1\'N“', () => {
    expect(val(lat("54°19.1'N"))).toBeCloseTo(54 + 19.1 / 60, 6);
  });
  it('mit Leerzeichen und typografischem Apostroph', () => {
    expect(val(lon("010° 08,4’ E"))).toBeCloseTo(10 + 8.4 / 60, 6);
  });
  it('Grad, Minuten, Sekunden', () => {
    expect(val(lat('54°19\'6"'))).toBeCloseTo(54 + 19 / 60 + 6 / 3600, 6);
  });
});

describe('parseCoordinate – Halbkugel', () => {
  it('Buchstabe hinten und vorn', () => {
    expect(val(lat('54 19,1 N'))).toBeCloseTo(54 + 19.1 / 60, 6);
    expect(val(lat('N 54 19,1'))).toBeCloseTo(54 + 19.1 / 60, 6);
    expect(val(lat('33 30 S'))).toBe(-33.5);
    expect(val(lat('s33.5'))).toBe(-33.5);
  });
  it('Ost, West und O (deutsch)', () => {
    expect(val(lon('10 8,4 E'))).toBeCloseTo(10 + 8.4 / 60, 6);
    expect(val(lon('10 8,4 O'))).toBeCloseTo(10 + 8.4 / 60, 6);
    expect(val(lon('070°15,0′W'))).toBe(-70.25);
    expect(val(lon('w70.25'))).toBe(-70.25);
  });
  it('falsche Achse wird abgelehnt', () => {
    expect(lat('10 E').ok).toBe(false);
    expect(lon('54 N').ok).toBe(false);
    expect(lon('10 S').ok).toBe(false);
  });
  it('Vorzeichen und Buchstabe zugleich ist mehrdeutig', () => {
    expect(lat('-54 S').ok).toBe(false);
  });
  it('Buchstabe auf beiden Seiten wird abgelehnt', () => {
    expect(lat('N 54 N').ok).toBe(false);
  });
});

describe('parseCoordinate – Grenzen und Fehler', () => {
  it('Breite > 90 und Länge > 180', () => {
    expect(lat('91').ok).toBe(false);
    expect(lat('-90.5').ok).toBe(false);
    expect(lon('180.1').ok).toBe(false);
    expect(val(lat('90'))).toBe(90);
    expect(val(lon('-180'))).toBe(-180);
  });
  it('Grenze gilt auch nach Umrechnung', () => {
    expect(lat('90 30').ok).toBe(false);
  });
  it('Minuten >= 60 oder Grad nicht ganzzahlig bei Minuten', () => {
    expect(lat('54 60').ok).toBe(false);
    expect(lat('54 75,2').ok).toBe(false);
    expect(lat('54,5 19').ok).toBe(false);
    expect(lat('54 19 60').ok).toBe(false);
  });
  it('leer', () => {
    const r = lat('   ');
    expect(r.ok).toBe(false);
  });
  it('Unsinn', () => {
    expect(lat('abc').ok).toBe(false);
    expect(lat('54..3').ok).toBe(false);
    expect(lat('54 19 06 12').ok).toBe(false);
    expect(lat('Infinity').ok).toBe(false);
    expect(lat('1e3').ok).toBe(false);
  });
  it('Fehlermeldung enthält ein Beispiel (Breite/Länge)', () => {
    const a = lat('xx');
    const b = lon('xx');
    expect(!a.ok && a.error).toContain('54°19,1');
    expect(!b.ok && b.error).toContain('010°08,4');
  });
});
