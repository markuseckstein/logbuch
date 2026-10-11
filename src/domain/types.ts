export type ID = string; // crypto.randomUUID()

/** Felder, nach denen Datensaetze gemergt werden (Datei-Import, siehe docs/toern-modell.md). */
export interface Versioned {
  updatedAt: number;
  updatedBy: string; // deviceId des letzten Schreibers
  deletedAt?: number; // Tombstone
}

/**
 * Von Dexie Cloud verwaltete Felder (siehe docs/research/dexie-cloud-integration.md).
 * `realmId` = Realm des Törns (`rlm~<tripId>`) bzw. privater Realm; `owner` = Nutzer-ID des Erstellers.
 * Lokal ohne Cloud fehlen sie. Nie exportiert (nutzerspezifisch).
 */
export interface CloudFields {
  realmId?: string;
  owner?: string;
}

export type CrewRole = 'skipper' | 'co-skipper' | 'crew';

/** Farbe + Symbolform eines Boots auf Karte/Timeline (1 Kreis, 2 Quadrat, 3 Dreieck, 4 Raute). */
export type BoatColorIndex = 1 | 2 | 3 | 4;

/** Boot eines Törns (Tabelle boats). Ein Törn hat 1..n Boote. */
export interface Boat extends Versioned, CloudFields {
  id: ID;
  tripId: ID;
  name: string;
  model?: string;
  lengthM?: number;
  homePort?: string;
  callSign?: string;
  mmsi?: string;
  photoId?: ID;
  colorIndex: number; // 1..4 (BoatColorIndex), bei mehr als vier Booten wiederholt
  createdAt: number;
}

/**
 * Person des Törns (Tabelle crewMembers). Im Cloud-Modus legt der Admin sie beim Einladen an (`email`); die
 * Person mit der E-Mail des angemeldeten Nutzers ist der Autor. `suggestedBoatId` ist nur ein Vorschlag.
 */
export interface CrewMember extends Versioned, CloudFields {
  id: ID;
  tripId: ID;
  name: string;
  role?: CrewRole;
  email?: string; // Konto der Person (Einladung, Autor im Cloud-Modus)
  suggestedBoatId?: ID; // Boot-Vorschlag fuer den ersten Eintrag, keine Berechtigung
  createdAt: number;
}

/** Fokuspunkt des Cover-Bilds in Prozent (CSS object-position), je 0..100. */
export interface CoverFocus {
  x: number;
  y: number;
}

/** Ein Törn = ein Dexie-Cloud-Realm (`rlm~<id>`), enthält die Boote (Tabelle boats). */
export interface Trip extends CloudFields {
  id: ID;
  name: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;
  area?: string;
  coverPhotoId?: ID; // Cover-Bild (Foto in photos, im Törn-Realm geteilt)
  coverFocus?: CoverFocus; // Bildausschnitt des Covers
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
  boatId: ID;
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
  boatId: ID;
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
  authorByTrip: Record<ID, ID>; // "Ich bin ..." je Trip (Crew-Mitglied-ID), lokaler Modus
  boatSelectionByTrip: Record<ID, BoatSelection>; // Boot-Schalter je Trip
  lastBoatByTrip: Record<ID, ID>; // zuletzt fuer einen Eintrag gewaehltes Boot (Vorschlag bei „Alle“)
}

/** Stellung des Boot-Schalters: ein Boot oder alle. */
export type BoatSelection = ID | 'all';

/** Foto-Metadaten ohne Bilddaten (Export "ohne Fotos"). */
export type PhotoMeta = Omit<Photo, 'blob'>;

/** All data of one trip – unit of export/import and bulk persistence. */
export interface TripBundle {
  trip: Trip;
  boats: Boat[];
  crew: CrewMember[];
  entries: LogEntry[];
  photos: Photo[];
  dayReports: DayReport[];
  tracks: TrackRecord[];
  trackChunks: TrackChunk[];
  /** Fotos, die referenziert werden, deren Bilddaten aber nicht mitgeliefert wurden (Export ohne Fotos). */
  missingPhotos: PhotoMeta[];
}
