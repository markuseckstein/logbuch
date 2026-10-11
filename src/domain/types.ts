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

/** Felder, nach denen Datensaetze gemergt werden (Flottille, siehe docs/flotilla.md). */
export interface Versioned {
  updatedAt: number;
  updatedBy: string; // deviceId des letzten Schreibers
  deletedAt?: number; // Tombstone
}

/**
 * Von Dexie Cloud verwaltete Felder (siehe docs/research/dexie-cloud-integration.md).
 * `realmId` = Realm des Boot-Logbuchs (`rlm~<tripId>`) bzw. privater Realm; `owner` = Nutzer-ID des Erstellers.
 * Lokal ohne Cloud fehlen sie. Nie exportiert (nutzerspezifisch).
 */
export interface CloudFields {
  realmId?: string;
  owner?: string;
}

export type CrewRole = 'skipper' | 'co-skipper' | 'crew';

/** Crew-Mitglied als eigener Datensatz (Tabelle crewMembers), damit parallele Aenderungen nicht kollidieren. */
export interface CrewMember extends Versioned, CloudFields {
  id: ID;
  tripId: ID;
  name: string;
  role?: CrewRole;
  email?: string; // verknuepft Cloud-Konto und „Ich bin …“
  createdAt: number;
}

/** Eingabe fuer Crew-Listen (Onboarding, Crew-Editor). */
export interface CrewDraft {
  id: ID;
  name: string;
  role?: CrewRole;
}

export interface Flotilla {
  id: ID;
  name: string;
}

export interface Trip extends CloudFields {
  id: ID;
  name: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  area?: string;
  boat: Boat;
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

export interface LogEntry extends CloudFields {
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

export interface Photo extends CloudFields {
  id: ID;
  tripId: ID;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  hash?: string; // SHA-256 (hex) der Original-Datei, fuer Duplikaterkennung pro Tag
  createdAt: number;
}

export interface DayReport extends CloudFields {
  id: ID; // = dayReportId(tripId, date, authorId): deterministisch, gleiche Sektion auf allen Geraeten
  tripId: ID;
  date: string; // YYYY-MM-DD lokal
  title?: string;
  text: string;
  photoIds: ID[]; // max 15 pro Tag ueber alle Abschnitte
  authorId: ID; // '' = ohne Autor
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

/** Gespeicherter Track (Tabelle tracks) ohne Punkte; die Punkte liegen in TrackChunks. */
export interface TrackRecord extends CloudFields {
  id: ID;
  tripId: ID;
  name: string;
  source: 'gpx' | 'live';
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number;
}

/**
 * Abschnitt von Track-Punkten (Tabelle trackChunks). Jedes Geraet haengt nur an eigene Chunks an,
 * dadurch kollidiert paralleles Anhaengen nie. Reihenfolge: seq, dann erster Zeitstempel, dann id.
 */
export interface TrackChunk extends Versioned, CloudFields {
  id: ID;
  tripId: ID;
  trackId: ID;
  seq: number;
  points: TrackPoint[];
}

/** Lesemodell: Track mit allen Punkten (aus den Chunks zusammengesetzt). */
export interface Track extends TrackRecord {
  points: TrackPoint[];
}

export interface Settings {
  activeTripId?: ID;
  theme: 'system' | 'light' | 'dark';
  deviceId: string; // lokal, einmalig erzeugt, nie exportiert (Kopie in localStorage, ueberlebt Logout)
  writableTripIds: ID[]; // lokal eigene Logbuecher; in der Cloud geteilte Trips: Server-Rechte massgeblich
  authorByTrip: Record<ID, ID>; // "Ich bin ..." je Trip (Crew-Mitglied-ID)
}

/** Foto-Metadaten ohne Bilddaten (Export "ohne Fotos"). */
export type PhotoMeta = Omit<Photo, 'blob'>;

/** All data of one trip – unit of export/import and bulk persistence. */
export interface TripBundle {
  trip: Trip;
  crew: CrewMember[];
  entries: LogEntry[];
  photos: Photo[];
  dayReports: DayReport[];
  tracks: TrackRecord[];
  trackChunks: TrackChunk[];
  /** Fotos, die referenziert werden, deren Bilddaten aber nicht mitgeliefert wurden (Export ohne Fotos). */
  missingPhotos: PhotoMeta[];
}
