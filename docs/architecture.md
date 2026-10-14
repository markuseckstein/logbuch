# Architektur

Entscheidungen (2026-10-11): PWA, UI-Richtung **Prototyp A „Seekarte“** (`prototypes/a-seekarte/index.html`: Tokens, Typo, Komponenten); Mehrboot-Bedienung nach **Prototyp D „Boot-Schalter“** (`prototypes/d-boot-schalter/index.html`, Spezifikation `docs/toern-modell.md`). Technische Grundlagen: `docs/research/pwa-tech.md`.

## Stack
Vite + React 19 + TypeScript (strict), vite-plugin-pwa (registerType `prompt`), Dexie 4 (IndexedDB) + dexie-react-hooks, Leaflet 1.9.4 (eigener useEffect-Wrapper, kein react-leaflet), fflate (ZIP), Vitest + fake-indexeddb + @testing-library/react, Playwright (E2E, Chromium mobile viewport). Kein UI-Framework; eigenes CSS mit den Tokens aus Prototyp A (CSS-Variablen, Light = „Tag“, Dark = „Nachtfahrt“, manueller Umschalter + System).

## Module (`src/`)
| Ordner | Inhalt | Tests |
|---|---|---|
| `domain/` | Typen, reine Funktionen: Distanz (Haversine, sm), Koordinaten-Format nautisch, Tageszuordnung, Tagesstatistik, Beaufort-Tabelle, Windrichtungen (16-teilig ↔ Grad), Eintragstypen | Unit, TDD |
| `db/` | Dexie-Schema + Repository-Funktionen (Trip, Boat, Crew, Entry, Photo, DayReport, Track, Settings), Cloud-Funktionen | Unit mit fake-indexeddb |
| `io/` | ZIP-Export/Import, JSON-Export (Base64), GPX-Parse, GPX-Write | Unit, TDD (Roundtrip!) |
| `device/` | Geolocation (Schnell-Fix + Verbesserung), Bildverkleinerung, Wake Lock, Live-Tracking, Datei teilen/herunterladen | dünne Adapter, Unit mit Mocks |
| `ui/` | Screens + Komponenten (Boot-Schalter, Heute, Eintrag-Sheet, Törn-Tage, Tagesansicht, Karte, Törn, Onboarding) | Komponenten-Tests für Logik, E2E |

Abhängigkeitsrichtung: `ui → db/io/device → domain`. `domain` hat keine Abhängigkeiten.

## Datenmodell (`src/domain/types.ts`, Törn-Modell v2 – Spezifikation `docs/toern-modell.md`)
Ein **Törn** (`Trip`) ist ein Dexie-Cloud-Realm (`rlm~<tripId>`) mit 1..n **Booten**. Merge-Felder (Datei-Import):
jeder synchronisierbare Datensatz hat `updatedAt`, `updatedBy` (deviceId) und optional `deletedAt` (Tombstone);
Reihenfolge `(updatedAt, updatedBy)` lexikografisch (`isNewer`).
```ts
type ID = string;                 // crypto.randomUUID()
interface CloudFields { realmId?; owner? }   // Dexie Cloud, nutzerspezifisch, nie exportiert
interface Trip extends CloudFields { id; name; startDate?; endDate?; area?; coverPhotoId?; coverFocus?: {x,y} /* 0..100 % */; createdAt; updatedAt; updatedBy; deletedAt? }
interface Boat extends CloudFields { id; tripId; name; model?; lengthM?; homePort?; callSign?; mmsi?; photoId?; colorIndex /* 1..4: Farbe + Symbolform */; createdAt; updatedAt; updatedBy; deletedAt? }   // Tabelle boats
interface CrewMember extends CloudFields { id; tripId; name; role?; email?; suggestedBoatId? /* nur Vorschlag */; createdAt; updatedAt; updatedBy; deletedAt? }  // Tabelle crewMembers
interface LogEntry extends CloudFields { id; tripId; boatId /* Pflicht */; time; tzOffsetMin; position?; type; text?; windDirDeg?; windBft?; sky?; seaState?; pressureHpa?; tempC?;
  photoIds: ID[] /* max 5, Dexie add()/remove() */; authorId?; createdAt; updatedAt; updatedBy; deletedAt? }
interface Photo extends CloudFields { id /* timeOrderedId */; tripId; blob; mime; width; height; hash?; createdAt }   // unveränderlich
interface DayReport extends CloudFields { id /* dayReportId(tripId,date,authorId) */; tripId; date; authorId; title?; text; photoIds; updatedAt; updatedBy; deletedAt? }  // ein Abschnitt je Person, ohne Boot
interface TrackRecord extends CloudFields { id; tripId; boatId; name; source: 'gpx'|'live'; createdAt; updatedAt; updatedBy; deletedAt? }   // Tabelle tracks
interface TrackChunk extends CloudFields { id; tripId; trackId; seq; points /* max 200 */; updatedAt; updatedBy; deletedAt? }  // Boot über trackId
interface Settings { activeTripId?; theme; deviceId; authorByTrip; boatSelectionByTrip: Record<ID, ID|'all'>; lastBoatByTrip: Record<ID, ID> }   // lokal, nie exportiert/synchronisiert
interface TripBundle { trip; boats; crew; entries; photos; dayReports; tracks; trackChunks; missingPhotos }
```
- **Boote** (`domain/boats.ts`): `activeBoats`, `nextColorIndex` (am wenigsten genutzte Farbe/Form 1..4), `resolveBoatSelection` (gespeicherte Wahl → Vorschlag der eigenen Person → erstes Boot; bei einem Boot immer dieses), `shownBoatIds`, `defaultEntryBoat` (Vorauswahl „Für welches Boot?“: gewähltes Boot, sonst `lastBoatByTrip`, sonst Vorschlag), `boatInUse` (Boote mit Einträgen/Tracks sind nicht entfernbar), `nameFromEmail`, `clampFocus`/`coverPosition` (Cover).
- **Rechte** (`domain/access.ts`, rein): `realmPermissions` (spiegelt das Addon; Mitgliedsrechte erst, wenn der Server den Realm bestätigt hat), `MEMBER_PERMISSIONS` (nur `add` auf entries, photos, dayReports, tracks, trackChunks), `canEditRecord(record, me)` = lokal alles, Admin alles, sonst nur `record.owner === me` (noch nicht synchronisierte Datensätze ohne Owner gehören dem Gerät).
- **Tag** eines Eintrags = lokales Datum aus `time + tzOffsetMin`. Tagnummern gelten für den ganzen Törn (alle Boote), Listen/Statistik folgen dem Boot-Schalter; bei mehreren Booten wird die Strecke je Boot berechnet und summiert.
- **Merge** (`domain/merge.ts`, rein): `isNewer`, `mergeRecords`, `mergeTrip` (LWW inkl. Cover), `remapPhotoIds` (Foto-Dedup pro Tag per Hash, kanonisch = kleinste ID). Idempotent und kommutativ (getestet).
- **Foto-Limits und Deduplizierung**: max. 5 Fotos je Eintrag, max. 15 je Tag (alle Abschnitte zusammen), pro Kalendertag ein Foto nur einmal (`planPhotoAdds`, `device/hashBlob`, `ui/photoImport.ts`).
- **DB-Schema**: Datenbankname `logbook-v5`, Version 1 (Neustart; `logbook`, `logbook-v3`, `logbook-v4` werden beim Start gelöscht, `db/legacy.ts`). Tabellen `trips`, `boats`, `crewMembers`, `entries`, `photos` (Index `hash`), `dayReports`, `tracks`, `trackChunks`, `settings` (lokal). Ohne Cloud-URL zusätzlich leere lokale `realms`/`members`/`roles`.
- **Zugriff im Repo** (`db/repo.ts`): `tripAccess(db, tripId)` → `{ userId?, admin, canWrite }`. Nicht angemeldet bzw. Törn nicht geteilt: Admin. Geteilt: Admin = Realm-Owner (`manage: *`), Mitglieder schreiben, sobald die Mitgliedschaft bestätigt ist. Schreibfunktionen prüfen: anlegen (`createEntry`, `addTrack`, Fotos, eigener Tagesbericht-Abschnitt) braucht `canWrite`; ändern/löschen braucht `canEditRecord`; Boote, Personen, Törndaten, Cover, „für alle löschen“ und Datei-Import in geteilte Törns nur Admin (`NotPermittedError`).
- **Cloud** (`db/cloudConfig.ts`, `db/cloud.ts`, Anleitung `docs/dexie-cloud-setup.md`): `VITE_DEXIE_CLOUD_URL` gesetzt ⇒ Addon mit `requireAuth: false`, `customLoginGui`, `unsyncedTables: ['settings']`, `nameSuffix: false`, ohne Service Worker. Angemeldet angelegte Törns liegen sofort in `rlm~<tripId>`; lokal angelegte bringt `adoptOwnTrips` nach der Anmeldung dorthin (`CloudAdopter`), verknüpft die eigene Person mit der Konto-E-Mail und trägt vorgemerkte Personen ein. `inviteToTrip` legt in **einer** Transaktion `CrewMember` (Name aus E-Mail, Boot-Vorschlag) und Realm-Mitglied (`roles: ['member']` + explizit `MEMBER_PERMISSIONS`, Spike 9.9, `invite: false` = keine Dexie-Mail) an; nicht angemeldet nur die Person („vorgemerkt“). `listPeople` (Status vorgemerkt/eingeladen/dabei, abgelehnt nur falls gesetzt; Admin), `removePerson` (Person-Tombstone + Mitglied löschen in einer Transaktion), `leaveTrip`.
  **Beitritt über Link/QR:** `domain/join.ts` (`buildJoinUrl` mit optionaler `email`, `parseJoinParam`, `parseJoinEmailParam`, `pickJoinTarget`, `decideJoinState`); `ui/cloud/joinState.ts` merkt `?join=<tripId>` und `&email=` (persönlicher QR) in sessionStorage und entfernt ihn aus der URL (`main.tsx`); `ui/cloud/Join.tsx`: `JoinScreen` (nicht angemeldet, auch statt Onboarding), `JoinWatcher` nimmt offene `db.cloud.invites` automatisch an, wartet auf Upload/Rechte und aktiviert per `decideJoinState` den Törn aus dem Link bzw. einen bestehenden (Wieder-Anmelden ohne Einladung), `JoiningScreen` („Törn wird geladen …“ bzw. „Keine Einladung gefunden“). Admin-Seite: `components/JoinSheet.tsx` + `QrCode.tsx` (SVG, Bibliothek `qrcode-generator`).
- **Daheim-Link** (Spezifikation `docs/toern-modell.md`, Spike Recherche 9.10): `domain/homeView.ts` (rein:
  `createHomeViewToken` 128 Bit Base32, `viewerEmail`/`viewerToken`/`isViewerEmail`, `buildHomeViewUrl`/
  `parseHomeViewHash` `#daheim=<token>`, `lastUpdatedAt`, `formatAgo`, `latestPosition`). `db/cloud.ts`:
  `getHomeView` (Token aus dem Zuschauer-Mitglied, `opened` = angenommen), `createHomeView`/`renewHomeView`/
  `disableHomeView` (nur Admin; Realm-Mitglied `roles: ['viewer']`, `permissions: {}`, `invite: false`, keine Person).
  `tripAccess` → `viewer: true` ohne Rechte. `scripts/create-viewer.mjs` (`npm run viewer:create`) legt das Demo-Konto
  per CLI an bzw. löscht es (`--delete`). UI: `ui/homeView/state.ts` (Token aus dem Hash in localStorage),
  `HomeViewApp` (statt der Crew-App, sobald ein Token gemerkt oder ein Zuschauer-Konto angemeldet ist: Auto-Login,
  Hinweis bei echtem Konto, Annehmen, „nicht mehr gültig“; Ausgang „Zur Crew-Anmeldung“: erst Token vergessen, dann
  abmelden), `HomeViewScreen` (Nur-Lese-Ansicht), Admin-Karte
  `ui/cloud/HomeViewCard.tsx`. Karte: `MapLayer.last` hebt die letzte Position hervor.
- **Installieren**: `ui/InstallButton.tsx` fängt `beforeinstallprompt` früh ab (`captureInstallPrompt` in `main.tsx`,
  unterdrückt die Mini-Infobar). Button „App installieren“ (Konto-Karte im Törn-Tab, unten in der Daheim-Ansicht)
  öffnet damit den Browser-Dialog; ohne Angebot (iOS, schon benutzt) eine Anleitung. Als App gestartet: kein Button.
- **Foto-Vollbild**: `ui/components/PhotoViewer.tsx` (`PhotoViewer`, `usePhotoViewer`, `classifySwipe`), genutzt von
  `PhotoGrid`, `PhotoPicker`, Timeline-Vorschau, Cover/Bootsfoto und der Daheim-Ansicht; Bildunterschrift `photoCaption`
  (`ui/lib.ts`).
- **Autor**: angemeldet die Person mit `email === currentUser.email`, sonst lokal „Ich bin …“ (`authorByTrip`).
- **Abgelehnte Sync-Änderungen**: `db/syncRejections.ts` (fetch-Hook) sichert vom Server abgelehnte Datensätze und sendet sie erneut, sobald der Törn beschreibbar ist; Banner „Abgelehnte Änderungen“ (Recherche 9.8).
- **Repo-Regeln**: Schreibfunktionen setzen `updatedAt/updatedBy`, patchen per `update()` und führen den `realmId` des Trips mit; `photoIds` per Dexie `add()`/`remove()` in eigener Transaktion; Track-Punkte hängt jedes Gerät nur an eigene Chunks an; Foto-Zeilen löscht im Cloud-Modus nur ihr Owner; Löschen = Tombstone; `deleteTrip` löscht hart (geteilt: Realm für alle). Import per `mergeBundle(db, bundle)` (eine Transaktion, LWW je Datensatz, eingehende `realmId`/`owner` ignoriert).
- **UI** (`ui/boats.tsx`): `BoatSelectionContext` (Boot-Schalter, lokal gespeichert), `BoatSwitch` (Header, ab zwei Booten), `BoatChips`, `BoatChooser` (Pflichtauswahl bei „Alle“), `BoatShape`/`BoatBadge`. Karte (`ChartMap`): Ebenen je Boot, Farbe `--b1..--b4` und Symbolform (Kreis, Quadrat, Dreieck, Raute), Legende mit Ein-/Ausblenden.
- **Route eines Tages** je Boot = Track-Punkte des Boots an diesem Tag, sonst Positionen seiner Einträge. Distanz in sm (Haversine, R = 3440.065 sm).

## Exportformat (Version 4)
ZIP `logbuch-<trip-slug>-<YYYY-MM-DD>.zip`:
```
logbook.json      { format: "segel-logbuch", version: 4, exportedAt: ISO, trip, boats[], crew[], entries[], dayReports[], tracks[], trackChunks[], photos: [{id, file: "images/<id>.jpg", mime, width, height, hash?, createdAt, photoOmitted?: true}] }
images/<id>.jpg   (level 0, keine Rekompression; entfällt bei „ohne Fotos“; Cover und Bootsfotos sind normale Fotos)
route.gpx         ein <trk> je Boot (Name = Boot, Tracks als <trkseg>, ohne Tracks Route aus Eintragspositionen) + Einträge als Waypoints „‹Boot› · ‹Typ› HH:MM“ (ohne Tombstones)
```
Alle Merge-Felder werden exportiert, **inklusive Tombstones**; `realmId`/`owner` nie. Import akzeptiert ausschließlich Version 4 (sonst `ImportFormatError`) und stellt denselben Törn (gleiche `trip.id`) wieder her bzw. mergt hinein – keine Besitz-Rückfrage. Omittierte Fotos landen in `TripBundle.missingPhotos`. Variante „Einzel-JSON“: gleiches Schema, Fotos mit `dataUrl`.
