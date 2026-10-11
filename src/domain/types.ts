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
  updatedAt?: number; // Merge-Version je Mitglied (fehlt bei Altdaten = 0)
  updatedBy?: string; // deviceId
  deletedAt?: number; // Tombstone: Mitglied bleibt im Trip, UI blendet aus (siehe activeCrew)
}

/** Felder, nach denen Datensaetze gemergt werden (Flottille, siehe docs/flotilla.md). */
export interface Versioned {
  updatedAt: number;
  updatedBy: string; // deviceId des letzten Schreibers
  deletedAt?: number; // Tombstone
}

export interface Flotilla {
  id: ID;
  name: string;
}

export interface Trip {
  id: ID;
  name: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  area?: string;
  boat: Boat;
  crew: CrewMember[]; // enthaelt auch Tombstones -> activeCrew(trip)
  flotilla?: Flotilla;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number; // reserviert (Trips werden nur lokal hart geloescht)
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
  photoIds: ID[]; // max 5
  authorId?: ID; // Crew-Mitglied, das den Eintrag angelegt hat
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number;
}

export interface Photo {
  id: ID;
  tripId: ID;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  hash?: string; // SHA-256 (hex) der Original-Datei, fuer Duplikaterkennung pro Tag
  createdAt: number;
}

export interface DayReport {
  tripId: ID;
  date: string; // YYYY-MM-DD lokal
  title?: string;
  text: string;
  photoIds: ID[]; // max 15 pro Tag ueber alle Abschnitte
  authorId: ID; // Schluessel [tripId+date+authorId]; '' = ohne Autor
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number;
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
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number;
}

export interface Settings {
  activeTripId?: ID;
  theme: 'system' | 'light' | 'dark';
  deviceId: string; // lokal, einmalig erzeugt, nie exportiert
  writableTripIds: ID[]; // eigene Logbuecher; alle anderen Trips sind read-only
  authorByTrip: Record<ID, ID>; // "Ich bin ..." je Trip (Crew-Mitglied-ID)
}

/** Foto-Metadaten ohne Bilddaten (Export "ohne Fotos"). */
export type PhotoMeta = Omit<Photo, 'blob'>;

/** All data of one trip – unit of export/import and bulk persistence. */
export interface TripBundle {
  trip: Trip;
  entries: LogEntry[];
  photos: Photo[];
  dayReports: DayReport[];
  tracks: Track[];
  /** Fotos, die referenziert werden, deren Bilddaten aber nicht mitgeliefert wurden (Export ohne Fotos). */
  missingPhotos: PhotoMeta[];
}
