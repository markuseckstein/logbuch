import { describe, expect, it } from 'vitest';
import { ENTRY_TYPE_LABELS, ROLE_LABELS, SEA_STATE_LABELS, SKY_LABELS } from './labels';

describe('labels', () => {
  it('Eintragstypen', () => {
    expect(ENTRY_TYPE_LABELS).toEqual({
      note: 'Eintrag',
      departure: 'Ablegen',
      harbour: 'Hafen',
      anchorage: 'Ankerplatz',
      mooring: 'Boje',
      'sails-up': 'Segel setzen',
      'sails-down': 'Segel bergen',
      'engine-on': 'Motor an',
      'engine-off': 'Motor aus',
      sighting: 'Sichtung',
      other: 'Sonstiges',
    });
  });
  it('Himmel', () => {
    expect(SKY_LABELS).toEqual({
      sunny: 'Sonne',
      'partly-cloudy': 'leicht bewölkt',
      cloudy: 'bewölkt',
      rain: 'Regen',
      thunderstorm: 'Gewitter',
      fog: 'Nebel',
    });
  });
  it('Seegang', () => {
    expect(SEA_STATE_LABELS).toEqual({
      calm: 'glatt',
      slight: 'leicht',
      moderate: 'mäßig',
      rough: 'grob',
      'very-rough': 'sehr grob',
    });
  });
  it('Rollen', () => {
    expect(ROLE_LABELS).toEqual({ skipper: 'Skipper', 'co-skipper': 'Co-Skipper', crew: 'Crew' });
  });
});
