import type { CrewMember, EntryType, LogEntry } from './types';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
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
};

export const SKY_LABELS: Record<NonNullable<LogEntry['sky']>, string> = {
  sunny: 'Sonne',
  'partly-cloudy': 'leicht bewölkt',
  cloudy: 'bewölkt',
  rain: 'Regen',
  thunderstorm: 'Gewitter',
  fog: 'Nebel',
};

export const SEA_STATE_LABELS: Record<NonNullable<LogEntry['seaState']>, string> = {
  calm: 'glatt',
  slight: 'leicht',
  moderate: 'mäßig',
  rough: 'grob',
  'very-rough': 'sehr grob',
};

export const ROLE_LABELS: Record<NonNullable<CrewMember['role']>, string> = {
  skipper: 'Skipper',
  'co-skipper': 'Co-Skipper',
  crew: 'Crew',
};
