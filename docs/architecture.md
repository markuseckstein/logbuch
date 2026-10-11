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
```ts
type ID = string;                 // crypto.randomUUID()
interface Trip { id: ID; name: string; startDate?: string /*YYYY-MM-DD*/; endDate?: string; area?: string;
  boat: Boat; crew: CrewMember[]; createdAt: number; updatedAt: number }
interface Boat { name: string; model?: string; lengthM?: number; homePort?: string; callSign?: string; mmsi?: string; photoId?: ID }
interface CrewMember { id: ID; name: string; role?: 'skipper' | 'co-skipper' | 'crew' }
type EntryType = 'note'|'departure'|'harbour'|'anchorage'|'mooring'|'sails-up'|'sails-down'|'engine-on'|'engine-off'|'sighting'|'other';
interface Position { lat: number; lon: number; accuracyM?: number }
interface LogEntry { id: ID; tripId: ID;
  time: number;            // epoch ms
  tzOffsetMin: number;     // lokaler UTC-Offset zum Erfassungszeitpunkt (z. B. 120) → Tageszuordnung
  position?: Position;     // fehlt, wenn kein Fix
  type: EntryType; text?: string;
  windDirDeg?: number;     // Wind AUS dieser Richtung, 0–359 (UI: 16er-Rose, 22.5°-Schritte)
  windBft?: number;        // 0–12
  sky?: 'sunny'|'partly-cloudy'|'cloudy'|'rain'|'thunderstorm'|'fog';
  seaState?: 'calm'|'slight'|'moderate'|'rough'|'very-rough';
  pressureHpa?: number; tempC?: number;
  photoIds: ID[];          // max 5 (MAX_PHOTOS_PER_ENTRY)
  createdAt: number; updatedAt: number }
interface Photo { id: ID; tripId: ID; blob: Blob; mime: string; width: number; height: number;
  hash?: string /* SHA-256 (hex) der ORIGINAL-Datei, vor dem Verkleinern; Duplikaterkennung */; createdAt: number }
interface DayReport { tripId: ID; date: string /*YYYY-MM-DD lokal*/; title?: string; text: string;
  photoIds: ID[] /* max 15 (MAX_PHOTOS_PER_DAY_REPORT); Altdaten ohne Feld = [] */; updatedAt: number }
interface TrackPoint { lat: number; lon: number; time?: number; ele?: number }
interface Track { id: ID; tripId: ID; name: string; source: 'gpx'|'live'; points: TrackPoint[]; createdAt: number }
interface Settings { activeTripId?: ID; theme: 'system'|'light'|'dark' }
```
- **Tag** eines Eintrags = lokales Datum aus `time + tzOffsetMin`. Ein Törntag existiert, sobald es einen Eintrag oder Tagesbericht an diesem Datum gibt (plus Zeitraum des Törns, falls gesetzt).
- **Foto-Limits und Deduplizierung**: max. 5 Fotos je Eintrag, max. 15 je Tagesbericht. Pro Kalendertag (Eintragstag wie oben bzw. Berichtsdatum) wird ein Foto nur einmal gespeichert – egal ob an einem Eintrag oder im Tagesbericht, auch innerhalb einer Mehrfachauswahl. Erkennung über `Photo.hash`; Planung in der reinen Funktion `planPhotoAdds` (`domain/photos.ts`), Hash über `device/hashBlob`, Orchestrierung in `ui/photoImport.ts` (Hash → Plan → Verkleinern nur der akzeptierten, nacheinander → atomar speichern → Toast). Repo: `addPhotosToEntry`, `addPhotosToDayReport`, `removePhotoFromDayReport`, `dayPhotoHashes`.
- **DB-Schema**: Dexie Version 2 (Index `photos.hash`; Upgrade setzt `dayReports.photoIds = []`).
- **Route eines Tages** = Track-Punkte dieses Tages, falls vorhanden, sonst Positionen der Einträge in Zeitreihenfolge. Distanz in sm (Haversine, R = 3440.065 sm).

## Exportformat (v1)
ZIP `logbuch-<trip-slug>-<YYYY-MM-DD>.zip`:
```
logbook.json      { format: "segel-logbuch", version: 1, exportedAt: ISO, trip, entries[], dayReports[], tracks[], photos: [{id, file: "images/<id>.jpg", mime, width, height, hash?}] }, dayReports[]: {tripId, date, title?, text, photoIds[], updatedAt}
images/<id>.jpg   (level 0, keine Rekompression)
route.gpx         Track(s) + Einträge als Waypoints
```
Alle Zeitstempel im JSON zusätzlich als ISO-String mit Offset (`timeIso`) für Menschen/Booklet-Tools. Die Felder `photos[].hash` und `dayReports[].photoIds` sind additiv (Version bleibt 1); beim Import fehlende Felder werden toleriert (`photoIds` → `[]`, kein `hash`). Import akzeptiert genau dieses Format (Version prüfen) und ersetzt/legt den Törn an (IDs bleiben). Variante „Einzel-JSON“: gleiches Schema, Fotos mit `dataUrl` statt `file`.
