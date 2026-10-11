import { describe, expect, it } from 'vitest';
import { BEAUFORT, COMPASS_16, compass16ToDeg, degToCompass16, formatWind } from './wind';

describe('COMPASS_16', () => {
  it('deutsche Bezeichnungen', () => {
    expect(COMPASS_16).toEqual([
      'N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
    ]);
  });
});

describe('degToCompass16', () => {
  it('Hauptrichtungen', () => {
    expect(degToCompass16(0)).toBe('N');
    expect(degToCompass16(90)).toBe('O');
    expect(degToCompass16(180)).toBe('S');
    expect(degToCompass16(225)).toBe('SW');
    expect(degToCompass16(270)).toBe('W');
  });
  it('Sektorgrenzen', () => {
    expect(degToCompass16(11.24)).toBe('N');
    expect(degToCompass16(11.25)).toBe('NNO');
    expect(degToCompass16(348.74)).toBe('NNW');
    expect(degToCompass16(348.75)).toBe('N');
  });
  it('Wrap und Negativwerte', () => {
    expect(degToCompass16(360)).toBe('N');
    expect(degToCompass16(-90)).toBe('W');
    expect(degToCompass16(450)).toBe('O');
  });
});

describe('compass16ToDeg', () => {
  it('Index -> Grad', () => {
    expect(compass16ToDeg(0)).toBe(0);
    expect(compass16ToDeg(1)).toBe(22.5);
    expect(compass16ToDeg(10)).toBe(225);
    expect(compass16ToDeg(15)).toBe(337.5);
  });
  it('Wrap', () => {
    expect(compass16ToDeg(16)).toBe(0);
    expect(compass16ToDeg(-1)).toBe(337.5);
  });
});

describe('BEAUFORT', () => {
  it('13 Stufen mit deutschen Namen', () => {
    expect(BEAUFORT).toHaveLength(13);
    expect(BEAUFORT.map((b) => b.bft)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(BEAUFORT[0]?.name).toBe('Windstille');
    expect(BEAUFORT[4]?.name).toBe('mäßige Brise');
    expect(BEAUFORT[12]?.name).toBe('Orkan');
  });
  it('Knotenspannen', () => {
    expect(BEAUFORT[0]).toMatchObject({ minKn: 0, maxKn: 0 });
    expect(BEAUFORT[4]).toMatchObject({ minKn: 11, maxKn: 16 });
    expect(BEAUFORT[7]).toMatchObject({ minKn: 28, maxKn: 33 });
    expect(BEAUFORT[12]).toMatchObject({ minKn: 64, maxKn: null });
  });
  it('Spannen schließen lückenlos an', () => {
    for (let i = 1; i < 13; i++) {
      expect(BEAUFORT[i]?.minKn).toBe((BEAUFORT[i - 1]?.maxKn ?? 0) + 1);
    }
  });
});

describe('formatWind', () => {
  it('Kombinationen', () => {
    expect(formatWind(225, 4)).toBe('SW 4 Bft');
    expect(formatWind(undefined, 4)).toBe('4 Bft');
    expect(formatWind(225, undefined)).toBe('SW');
    expect(formatWind()).toBe('');
  });
  it('Bft 0 und Richtung 0 sind gültige Werte', () => {
    expect(formatWind(0, 0)).toBe('N 0 Bft');
  });
});
