# Architektur

Entscheidungen (2026-10-11): PWA, UI-Richtung **Prototyp A „Seekarte“** (`prototypes/a-seekarte/index.html` ist die visuelle Referenz: Tokens, Typo, Komponenten). Technische Grundlagen: `docs/research/pwa-tech.md`.

## Stack
Vite + React 19 + TypeScript (strict), vite-plugin-pwa (registerType `prompt`), Dexie 4 (IndexedDB) + dexie-react-hooks, Leaflet 1.9.4 (eigener useEffect-Wrapper, kein react-leaflet), fflate (ZIP), Vitest + fake-indexeddb + @testing-library/react, Playwright (E2E, Chromium mobile viewport). Kein UI-Framework; eigenes CSS mit den Tokens aus Prototyp A (CSS-Variablen, Light = „Tag“, Dark = „Nachtfahrt“, manueller Umschalter + System).

## Module (`src/`)
| Ordner | Inhalt | Tests |
|---|---|---|
| `domain/` | Typen, reine Funktionen: Distanz (Haversine, sm), Koordinaten-Format nautisch, Tageszuordnung, Tagesstatistik, Beaufort-Tabelle, Windrichtungen (16-teilig ↔ Grad), Eintragstypen | Unit, TDD |
| `db/` | Dexie-Schema + Repository-Funktionen (Trip, Entry, Photo, DayReport, Track, Settings) | Unit mit fake-indexeddb |
| `io/` | ZIP-Export/Import, JSON-Export (Base64), GPX-Parse, GPX-Write | Unit, TDD (Roundtrip!) |
| `device/` | Geolocation (Schnell-Fix + Verbesserung), Bildverkleinerung, Wake Lock, Live-Tracking, Datei teilen/herunterladen | dünne Adapter, Unit mit Mocks |
| `ui/` | Screens + Komponenten (Heute, Eintrag-Sheet, Törn-Tage, Tagesansicht, Karte, Törn, Onboarding) | Komponenten-Tests für Logik, E2E |

Abhängigkeitsrichtung: `ui → db/io/device → domain`. `domain` hat keine Abhängigkeiten.

## Datenmodell (`src/domain/types.ts`)
Merge-Felder (Flottille, siehe `docs/flotilla.md`): jeder synchronisierbare Datensatz (`Trip`, `LogEntry`, `DayReport`, `Track`) hat `updatedAt: number`, `updatedBy: string` (deviceId) und optional `deletedAt` (Tombstone). Reihenfolge: `(updatedAt, updatedBy)` lexikografisch (`isNewer`).
```ts
type ID = string;                 // crypto.randomUUID()
interface Trip { id; name; startDate?; endDate?; area?; boat: Boat; crew: CrewMember[] /* inkl. Tombstones -> activeCrew(trip) */;
  flotilla?: { id: ID; name: string }; createdAt; updatedAt; updatedBy; deletedAt? }
interface Boat { name; model?; lengthM?; homePort?; callSign?; mmsi?; photoId? }
interface CrewMember { id; name; role?; updatedAt?; updatedBy?; deletedAt? }   // Merge je Mitglied
type EntryType = 'note'|'departure'|'harbour'|'anchorage'|'mooring'|'sails-up'|'sails-down'|'engine-on'|'engine-off'|'sighting'|'other';
interface LogEntry { id; tripId; time /*epoch ms*/; tzOffsetMin; position?; type; text?; windDirDeg?; windBft?; sky?; seaState?; pressureHpa?; tempC?;
  photoIds: ID[] /* max 5 */; authorId?: ID; createdAt; updatedAt; updatedBy; deletedAt? }
interface Photo { id; tripId; blob; mime; width; height; hash? /* SHA-256 der Original-Datei */; createdAt }   // unveraenderlich, kein Tombstone
interface DayReport { tripId; date /*YYYY-MM-DD lokal*/; authorId: ID /* '' = ohne Autor */; title?; text; photoIds: ID[] /* max 15 pro Tag ueber alle Abschnitte */;
  updatedAt; updatedBy; deletedAt? }                   // Schluessel [tripId+date+authorId]
interface Track { id; tripId; name; source: 'gpx'|'live'; points: TrackPoint[]; createdAt; updatedAt; updatedBy; deletedAt? }
interface Settings { activeTripId?; theme; deviceId; writableTripIds: ID[]; authorByTrip: Record<ID, ID> }   // lokal, nie exportiert
interface TripBundle { trip; entries; photos; dayReports; tracks; missingPhotos: PhotoMeta[] }   // Einheit von Export/Import/Merge
```
- **Tag** eines Eintrags = lokales Datum aus `time + tzOffsetMin`. Ein Törntag existiert, sobald es einen Eintrag oder Tagesbericht an diesem Datum gibt (plus Zeitraum des Törns, falls gesetzt).
- **Merge** (`domain/merge.ts`, rein): `isNewer`, `mergeRecords(local, incoming, keyOf?)` -> `{toPut, stats}`, `mergeTrip` (Trip-Felder LWW, Crew je Mitglied), `remapPhotoIds` (Foto-Dedup pro Tag per Hash, kanonisch = kleinste ID, deterministisch auf jedem Gerät), `activeCrew`, `dayReportKey`. Idempotent und kommutativ (getestet).
- **Foto-Limits und Deduplizierung**: max. 5 Fotos je Eintrag, max. 15 je Tag (alle Berichtsabschnitte zusammen). Pro Kalendertag wird ein Foto nur einmal gespeichert (Eintrag, Abschnitte, Mehrfachauswahl); Erkennung über `Photo.hash`; Planung in `planPhotoAdds` (`domain/photos.ts`), Hash über `device/hashBlob`, Orchestrierung in `ui/photoImport.ts`. Repo: `addPhotosToEntry`, `addPhotosToDayReport`, `removePhotoFromDayReport`, `dayPhotoHashes`.
- **DB-Schema**: Dexie, Datenbankname `logbook-v3`, Version 1 (Neustart des Schemas, keine Migration der Vorgaenger-DB `logbook`). `dayReports` mit Primärschlüssel `[tripId+date+authorId]`, Index `photos.hash`; `deviceId` wird beim Anlegen der DB erzeugt (populate).
- **Repo-Regeln**: Schreibfunktionen setzen `updatedAt/updatedBy`, patchen per `update()`; Löschen von Einträgen/Tracks/Tagesberichtsabschnitten/Crew = Tombstone, Listen-Queries filtern sie; `deleteTrip` löscht hart und nur lokal. Schreiben in Trips außerhalb von `writableTripIds` wirft `ReadOnlyTripError`. Import per `mergeBundle(db, bundle, {ownership})` (eine Transaktion, Zusammenfassung), `replaceTripData` ersetzt komplett.
- **Route eines Tages** = Track-Punkte dieses Tages, falls vorhanden, sonst Positionen der Einträge in Zeitreihenfolge. Distanz in sm (Haversine, R = 3440.065 sm).

## Exportformat (Version 2)
ZIP `logbuch-<trip-slug>-<YYYY-MM-DD>.zip`:
```
logbook.json      { format: "segel-logbuch", version: 2, exportedAt: ISO, trip, entries[], dayReports[], tracks[], photos: [{id, file: "images/<id>.jpg", mime, width, height, hash?, createdAt, photoOmitted?: true}] }
images/<id>.jpg   (level 0, keine Rekompression; entfaellt bei „ohne Fotos“)
route.gpx         Track(s) + Einträge als Waypoints (ohne Tombstones)
```
Alle neuen Felder (`updatedBy`, `deletedAt`, `authorId`, `trip.flotilla`, Crew-Versionen) werden exportiert, **inklusive Tombstones**. Option `includePhotos: false`: Foto-Metadaten bleiben in `photos[]` mit `photoOmitted: true` (ohne `file`/`dataUrl`), keine Bilddateien. Alle Zeitstempel der Einträge zusätzlich als `timeIso`. Import akzeptiert ausschließlich Version 2 (sonst `ImportFormatError`); omittierte Fotos landen in `TripBundle.missingPhotos` (nur Metadaten, dienen dem Dedup), die Referenzen in `photoIds` bleiben; ein späterer Import mit den Bilddaten füllt sie auf. Variante „Einzel-JSON“: gleiches Schema, Fotos mit `dataUrl` statt `file`.
