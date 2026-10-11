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
interface CloudFields { realmId?; owner? }   // Dexie Cloud, nutzerspezifisch, nie exportiert
interface Trip extends CloudFields { id; name; startDate?; endDate?; area?; boat: Boat; flotilla?: { id: ID; name: string }; createdAt; updatedAt; updatedBy; deletedAt? }
interface Boat { name; model?; lengthM?; homePort?; callSign?; mmsi?; photoId? }
interface CrewMember extends CloudFields { id; tripId; name; role?; email? /* Konto-Verknuepfung */; createdAt; updatedAt; updatedBy; deletedAt? }  // Tabelle crewMembers
type EntryType = 'note'|'departure'|'harbour'|'anchorage'|'mooring'|'sails-up'|'sails-down'|'engine-on'|'engine-off'|'sighting'|'other';
interface LogEntry extends CloudFields { id; tripId; time /*epoch ms*/; tzOffsetMin; position?; type; text?; windDirDeg?; windBft?; sky?; seaState?; pressureHpa?; tempC?;
  photoIds: ID[] /* max 5, Dexie add()/remove() */; authorId?: ID; createdAt; updatedAt; updatedBy; deletedAt? }
interface Photo extends CloudFields { id /* timeOrderedId */; tripId; blob; mime; width; height; hash?; createdAt }   // unveraenderlich, kein Tombstone
interface DayReport extends CloudFields { id /* dayReportId(tripId,date,authorId) */; tripId; date; authorId /* '' = ohne Autor */; title?; text; photoIds: ID[]; updatedAt; updatedBy; deletedAt? }
interface TrackRecord extends CloudFields { id; tripId; name; source: 'gpx'|'live'; createdAt; updatedAt; updatedBy; deletedAt? }   // Tabelle tracks
interface TrackChunk extends CloudFields { id; tripId; trackId; seq; points: TrackPoint[] /* max 200 */; updatedAt; updatedBy; deletedAt? }  // Tabelle trackChunks
type Track = TrackRecord & { points }   // Lesemodell (assembleTracks)
interface Settings { activeTripId?; theme; deviceId; writableTripIds: ID[]; authorByTrip: Record<ID, ID> }   // lokal (unsyncedTables), nie exportiert
interface TripBundle { trip; crew; entries; photos; dayReports; tracks: TrackRecord[]; trackChunks; missingPhotos: PhotoMeta[] }
```
- **Tag** eines Eintrags = lokales Datum aus `time + tzOffsetMin`. Ein Törntag existiert, sobald es einen Eintrag oder Tagesbericht an diesem Datum gibt (plus Zeitraum des Törns, falls gesetzt).
- **Merge** (`domain/merge.ts`, rein): `isNewer`, `mergeRecords(local, incoming, keyOf?)` -> `{toPut, stats}`, `mergeTrip` (Trip-Felder LWW, Crew je Mitglied), `remapPhotoIds` (Foto-Dedup pro Tag per Hash, kanonisch = kleinste ID, deterministisch auf jedem Gerät), `activeCrew`, `dayReportKey`. Idempotent und kommutativ (getestet).
- **Foto-Limits und Deduplizierung**: max. 5 Fotos je Eintrag, max. 15 je Tag (alle Berichtsabschnitte zusammen). Pro Kalendertag wird ein Foto nur einmal gespeichert (Eintrag, Abschnitte, Mehrfachauswahl); Erkennung über `Photo.hash`; Planung in `planPhotoAdds` (`domain/photos.ts`), Hash über `device/hashBlob`, Orchestrierung in `ui/photoImport.ts`. Repo: `addPhotosToEntry`, `addPhotosToDayReport`, `removePhotoFromDayReport`, `dayPhotoHashes`.
- **DB-Schema** (Stufe 2, Dexie Cloud tauglich): Datenbankname `logbook-v4`, Version 1 (Neustart, `logbook`/`logbook-v3` werden geloescht). Tabellen `trips`, `crewMembers`, `entries`, `photos` (Index `hash`), `dayReports` (String-`id`), `tracks`, `trackChunks`, `settings` (lokal). Ohne Cloud-URL zusaetzlich leere lokale `realms`/`members`/`roles` (gleiche Schluessel wie das Addon). `deviceId` entsteht beim Anlegen der DB und liegt zusaetzlich in localStorage (Cloud-Logout leert alle Tabellen).
- **Cloud** (`db/cloudConfig.ts`, `db/cloud.ts`, Anleitung `docs/dexie-cloud-setup.md`): `VITE_DEXIE_CLOUD_URL` gesetzt ⇒ Addon `dexie-cloud-addon` mit `requireAuth: false`, `customLoginGui`, `unsyncedTables: ['settings']`, `nameSuffix: false`, ohne Service Worker. Ein Realm je Boot-Logbuch (`rlm~<tripId>`); `shareTripToCloud` verschiebt Trip + alle Kinder per `moveTripToRealm`. Rollen `skipper`/`crew`/`readonly` (`roles.json`). Schreibrecht: `canWriteTrip` (Repo) – geteilte Trips nach Server-Rechten (`domain/access.ts`, spiegelt die Addon-Logik), sonst `writableTripIds`. Mitgliedsrechte gelten erst, wenn der Server den Realm bestätigt hat (`db.serverRealms()`). Vom Server abgelehnte Sync-Mutationen sichert `db/syncRejections.ts` (fetch-Hook) und sendet sie erneut; Banner „Abgelehnte Änderungen“ (Recherche 9.8).
- **Entscheidungen Ownership/Autor**: `writableTripIds` und `authorByTrip` bleiben lokal (`settings`). In Cloud-Logbuechern wird „Ich bin …“ zusaetzlich als `CrewMember.email` gespeichert (synchronisiert); `getAuthor` faellt darauf zurueck – so gilt die Zuordnung auf allen Geraeten des Nutzers und nach erneutem Login. Kein eigener `userSettings`-Store.
- **Repo-Regeln**: Schreibfunktionen setzen `updatedAt/updatedBy`, patchen per `update()` und fuehren den `realmId` des Trips mit (nie `put` ohne realmId); `photoIds` per Dexie `add()`/`remove()` (sortieren – daher zeitlich sortierbare Foto-IDs); Track-Punkte haengt jedes Geraet nur an eigene Chunks an; Foto-Zeilen loescht im Cloud-Modus nur ihr Owner; Löschen von Einträgen/Tracks/Tagesberichtsabschnitten/Crew = Tombstone, Listen-Queries filtern sie; `deleteTrip` löscht hart und nur lokal. Schreiben in Trips außerhalb von `writableTripIds` wirft `ReadOnlyTripError`. Import per `mergeBundle(db, bundle, {ownership})` (eine Transaktion, Zusammenfassung): bekannte Datensaetze per `update()`-Patch, neue in den Realm des lokalen Trips; eingehende `realmId`/`owner` werden ignoriert; in fremde Cloud-Logbuecher ohne Schreibrecht wird nicht gemergt.
- **Route eines Tages** = Track-Punkte dieses Tages, falls vorhanden, sonst Positionen der Einträge in Zeitreihenfolge. Distanz in sm (Haversine, R = 3440.065 sm).

## Exportformat (Version 3)
ZIP `logbuch-<trip-slug>-<YYYY-MM-DD>.zip`:
```
logbook.json      { format: "segel-logbuch", version: 3, exportedAt: ISO, trip, crew[], entries[], dayReports[], tracks[], trackChunks[], photos: [{id, file: "images/<id>.jpg", mime, width, height, hash?, createdAt, photoOmitted?: true}] }
images/<id>.jpg   (level 0, keine Rekompression; entfaellt bei „ohne Fotos“)
route.gpx         Track(s) + Einträge als Waypoints (ohne Tombstones)
```
Alle Merge-Felder (`updatedBy`, `deletedAt`, `authorId`, `trip.flotilla`, Crew) werden exportiert, **inklusive Tombstones**; `realmId`/`owner` nie. Option `includePhotos: false`: Foto-Metadaten bleiben in `photos[]` mit `photoOmitted: true` (ohne `file`/`dataUrl`), keine Bilddateien. Alle Zeitstempel der Einträge zusätzlich als `timeIso`. Import akzeptiert ausschließlich Version 3 (sonst `ImportFormatError`); omittierte Fotos landen in `TripBundle.missingPhotos` (nur Metadaten, dienen dem Dedup), die Referenzen in `photoIds` bleiben; ein späterer Import mit den Bilddaten füllt sie auf. Variante „Einzel-JSON“: gleiches Schema, Fotos mit `dataUrl` statt `file`.
