export type ID = string; // crypto.randomUUID()

export interface Boat {
  name: string;
  model?: string;
  lengthM?: number;
  homePort?: string;
  callSign?: string;
  mmsi?: string;
  photoId?: ID;
}

export interface CrewMember {
  id: ID;
  name: string;
  role?: 'skipper' | 'co-skipper' | 'crew';
}

export interface Trip {
  id: ID;
  name: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  area?: string;
  boat: Boat;
  crew: CrewMember[];
  createdAt: number;
  updatedAt: number;
}

export type EntryType =
  | 'note'
  | 'departure'
  | 'harbour'
  | 'anchorage'
  | 'mooring'
  | 'sails-up'
  | 'sails-down'
  | 'engine-on'
  | 'engine-off'
  | 'sighting'
  | 'other';

export interface Position {
  lat: number;
  lon: number;
  accuracyM?: number;
}

export interface LogEntry {
  id: ID;
  tripId: ID;
  time: number; // epoch ms
  tzOffsetMin: number; // lokaler UTC-Offset zum Erfassungszeitpunkt (z. B. 120) -> Tageszuordnung
  position?: Position; // fehlt, wenn kein Fix
  type: EntryType;
  text?: string;
  windDirDeg?: number; // Wind AUS dieser Richtung, 0-359 (UI: 16er-Rose, 22.5°-Schritte)
  windBft?: number; // 0-12
  sky?: 'sunny' | 'partly-cloudy' | 'cloudy' | 'rain' | 'thunderstorm' | 'fog';
  seaState?: 'calm' | 'slight' | 'moderate' | 'rough' | 'very-rough';
  pressureHpa?: number;
  tempC?: number;
  photoIds: ID[]; // max 3
  createdAt: number;
  updatedAt: number;
}

export interface Photo {
  id: ID;
  tripId: ID;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface DayReport {
  tripId: ID;
  date: string; // YYYY-MM-DD lokal
  title?: string;
  text: string;
  updatedAt: number;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  time?: number;
  ele?: number;
}

export interface Track {
  id: ID;
  tripId: ID;
  name: string;
  source: 'gpx' | 'live';
  points: TrackPoint[];
  createdAt: number;
}

export interface Settings {
  activeTripId?: ID;
  theme: 'system' | 'light' | 'dark';
}
