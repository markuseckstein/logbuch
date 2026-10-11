# Dexie Cloud als Sync (Stufe 2): Integrationsrecherche

Stand: 2026-10-11. Nur Recherche, kein App-Code geändert. Nur Primärquellen: dexie.org-Docs, GitHub `dexie/Dexie.js` (Master-Stand 2026-09-28, lokal geklont und gelesen), npm-Registry. Jede Aussage trägt [Quelle: URL] oder [unverifiziert]. "[Quelle: Code]" = eigene Lektüre des Quelltexts `addons/dexie-cloud/src/…` im GitHub-Repo (Basis `https://github.com/dexie/Dexie.js/blob/master/`).

Kontext: `docs/flotilla.md`, `docs/architecture.md`, `src/db/db.ts` (DB `logbook-v3`, Version 1, Tabellen trips/entries/photos/dayReports/tracks/settings), `docs/research/flotilla-sync.md` (Empfehlung: Dexie Cloud Pro).

Docs-Basis-URL: `https://dexie.org/docs/cloud/<seite>` (identisch erreichbar unter `/cloud/docs/<seite>`).

## 0. Wichtigste Befunde in Kürze

1. Versionen passen: `dexie@4.4.6` ist aktuell `latest`; `dexie-cloud-addon@4.4.15` (latest) hat Peer `dexie ^4.4.5`, also kompatibel. Das Blob-Offloading steckt bereits in `latest`; ein npm-Tag `canary` existiert nicht mehr (nur `latest`, `dev`), die Doku-Seite nennt es aber weiter "canary" (siehe 1.2).
2. Eigene UUID-Strings als Primärschlüssel und der Compound-Key `[tripId+date+authorId]` sind erlaubt. Pflicht: kein `++id`, Schlüssel nie ändern.
3. Das Addon legt Tabellen und DB-Namen um: Lokale DB heißt mit Addon standardmäßig `logbook-v3-<dbid>` (Option `nameSuffix`), und es braucht eine Versionserhöhung (`version(2)`), sonst sieht die App ihre alten Daten nicht.
4. **Logout löscht die gesamte lokale DB** (alle Tabellen, auch `unsyncedTables`; nur `$jobs`/`$syncState` bleiben) [Quelle: Code `authentication/logout.ts`]. Das ist für "lokaler Modus bleibt voll nutzbar" zentral (Abschnitt 4.4).
5. Vor Login erstellte Daten bekommen beim ersten Login `realmId = userId` (privater Realm). Sie sind also nicht automatisch im Boots-Realm; die App muss sie explizit verschieben (3.5).
6. **`put()` ohne `realmId` setzt `realmId` auf den privaten Realm zurück** (Middleware setzt fehlende `realmId`/`owner`) [Quelle: Code `middlewares/createImplicitPropSetterMiddleware.ts`]. `mergeBundle`/`bulkPut` müssen `realmId` mitführen (Abschnitt 6).
7. Rechte: Wer ein Objekt erzeugt (`owner`), darf es immer ändern und löschen. Fremde Objekte dürfen nur per Permission `update`/`manage` geändert werden. Weiches Löschen (`deletedAt`) braucht daher nur `update`, nicht `manage`; das spricht dafür, `deletedAt` zu behalten.
8. Datenstandort der gehosteten Version: **Azure US East** (Datenschutz-Doku), abgesichert über DPF/SCC; EU-Residenz nur mit On-Prem [Quelle: https://dexie.org/docs/cloud/gdpr-compliance].
9. Kosten: Free = 3 Produktions-Seats, unbegrenzt Evaluation-User (30 aktive Tage, danach kein Sync), Objekt 25 MB + Blob 75 MB, 1.000 Blob-Writes/Monat. Pro = 3 EUR/Monat je 25 Seats mit 1 GB Objekt + 20 GB Blob [Quelle: https://dexie.org/cloud/pricing]. Für Fotos praktisch Pro nötig.
10. CLI-Korrektur: Rollen importiert man mit `npx dexie-cloud import roles.json`; ein Unterbefehl `roles import` existiert in der CLI-Doku nicht [Quelle: https://dexie.org/docs/cloud/cli].

## 1. Versionen, Installation, Konfiguration, Service Worker

### 1.1 Kompatibilität (npm-Registry, 2026-10-11)

| Paket | Version | Datum | Peer/Hinweis |
|---|---|---|---|
| `dexie` | 4.4.6 (`latest`, `dev`) | 2026-09-10 | in `package.json` gepinnt |
| `dexie-cloud-addon` | 4.4.15 (`latest`, `dev`) | 2026-09-09 | Peer `dexie ^4.4.5` |
| `dexie-cloud-addon` | 4.4.6 | 2026-03-26 | Peer `dexie ^4.4.1` |
| `dexie-cloud-addon` | 4.4.0 | 2026-03-18 | Peer `dexie ^4.4.0` |
| `dexie-react-hooks` | 4.4.0 (installiert) | | exportiert `useLiveQuery`, `useObservable`, `usePermissions`, `useDocument` |

[Quelle: `npm view dexie-cloud-addon dist-tags versions peerDependencies`, `npm view dexie dist-tags`]. Empfehlung: `dexie-cloud-addon@4.4.15` exakt pinnen (Projekt pinnt alle Versionen). Der Addon-Quelltext in 4.4.15 enthält Optionen, die 4.4.6 nicht hat (`largeStringThreshold`; `blobMode` gibt es schon in 4.4.6) [Quelle: Vergleich der `DexieCloudOptions.d.ts` beider npm-Tarballs]. Abhängigkeiten des Addons: `rxjs`, `yjs`, `y-dexie`, `y-protocols`, `dexie-cloud-common` (Bundle-Größe vor Einbau messen, [unverifiziert]).

Installation [Quelle: https://dexie.org/docs/cloud/dexie-cloud-addon]:
```
npm install dexie@latest
npm install dexie-cloud-addon@latest
npx dexie-cloud create
```

### 1.2 Blob-Offloading: Status und Stabilität

- Doku: "Requires: dexie-cloud-addon 4.4.0 or later and Dexie Cloud Server 3.0.0 or later. These versions are currently published under the canary tag on npm (`npm install dexie-cloud-addon@canary`)." [Quelle: https://dexie.org/docs/cloud/blob-offloading].
- Realität in npm: Es gibt **keinen** Dist-Tag `canary` (`npm view dexie-cloud-addon@canary` liefert E404; Tags: `latest`, `dev` beide 4.4.15). Der Blob-Code (`BlobRef`, `_hasBlobRefs`, `blobProgress`, `blobMode`) ist in 4.4.6 und 4.4.15 enthalten [Quelle: Grep in den npm-Tarballs]. Die Doku-Seite ist also veraltet oder bezieht sich nur auf den Server. Welche Server-Version der gehostete Dienst fährt, ist nicht belegt [unverifiziert]; im Spike prüfen, ob ein Foto-Roundtrip funktioniert.
- Verhalten: `Blob`/`File` werden beim Sync immer ausgelagert (egal wie klein), `ArrayBuffer`/typed arrays ab 4 KB, Strings über `largeStringThreshold` (Default 32768 Zeichen). Lokal bleibt das Original in IndexedDB; der Server hält eine `BlobRef` `{ _bt: "Blob", ref: "1:abc…", size, ct: "image/jpeg" }` plus Marker `_hasBlobRefs: 1`. Zugriffsschutz wie bei Objekten (Realm-basiert, 1 h Gnadenfrist nach Entzug) [Quelle: Blob-Offloading-Seite].
- `blobMode`: `'eager'` (Default, lädt Blobs nach dem Sync im Hintergrund, bis zu 10 parallel) oder `'lazy'` (Download bei Zugriff) [Quelle: Code `DexieCloudOptions.ts`, Blob-Seite]. Passt zum Nutzerwunsch "Fotos sofort syncen": Default `eager`.
- Fortschritt: `db.cloud.blobProgress` (`Observable<{ isDownloading, blobsRemaining, bytesRemaining }>`) [Quelle: Code `DexieCloudAPI.ts`].
- Bekannte Grenze: "No resumable uploads yet — very large uploads may fail on unreliable connections" [Quelle: Blob-Seite]. Bei 300-800 KB-Fotos auf See mit Funklöchern vertretbar, aber zu testen. Offene GitHub-Issues zu Blob-Optimierung: #1860 "Optimize Blobs and Files in Dexie Cloud", #1925 "Optimized Blob Storage in Dexie Cloud" (beide offen) [Quelle: `gh search issues --repo dexie/Dexie.js`].
- Export (`dexie-cloud export`) expandiert BlobRefs zu Inline-Base64 [Quelle: Blob-Seite].

### 1.3 Einbindung

Minimal [Quelle: https://dexie.org/docs/cloud/dexie-cloud-addon]:
```ts
import { Dexie } from 'dexie'
import dexieCloud from 'dexie-cloud-addon'

const db = new Dexie('mydb', { addons: [dexieCloud] })
db.version(1).stores({ myTable: '@myId, myIndex1' })
db.cloud.configure({ databaseUrl: 'https://xxxxxxx.dexie.cloud' })
```
`configure()` muss vor der ersten Abfrage auf `db` laufen [Quelle: https://dexie.org/docs/cloud/db.cloud.configure()].

Für unsere Klasse: `super(name, { addons: [dexieCloud] })` im Konstruktor von `LogbookDB`; `db.cloud.configure(...)` direkt nach den `version().stores()`-Aufrufen (so macht es das offizielle Todo-Sample [Quelle: https://github.com/dexie/Dexie.js/blob/master/samples/dexie-cloud-todo-app/src/db/TodoDB.ts]).

### 1.4 `DexieCloudOptions` (Original-TypeScript aus dem Repo)

[Quelle: Code `addons/dexie-cloud/src/DexieCloudOptions.ts`; Tabelle in https://dexie.org/docs/cloud/db.cloud.configure()]

| Option | Typ | Bedeutung |
|---|---|---|
| `databaseUrl` | `string` | URL aus `npx dexie-cloud create`. Pflicht. |
| `requireAuth` | `boolean \| LoginHints` | `true`: Login beim ersten Start erzwingen. `false`: anonym nutzbar, Login per `db.cloud.login()` optional. **Für uns `false`.** |
| `tryUseServiceWorker` | `boolean` | Sync an Service Worker delegieren (Background/Periodic Sync). Wirkt nur, wenn der eigene SW das Dexie-Cloud-SW-Modul importiert. |
| `periodicSync` | `{ minInterval?: number }` | Minimalintervall in ms für Periodic Background Sync (Chrome/Edge, nur installierte PWA). |
| `customLoginGui` | `boolean` | Standard-Login-Dialog abschalten; `db.cloud.userInteraction` selbst rendern. |
| `unsyncedTables` | `string[]` | Rein lokale Tabellen. |
| `unsyncedProperties` | `{ [table]: string[] }` | Rein lokale Properties pro Tabelle. |
| `nameSuffix` | `boolean` | Default true: hängt Teil der DB-ID an den lokalen IndexedDB-Namen (`FriendsDatabase` wird `FriendsDatabase-z0lesejpr`). `false` = Namen unverändert. |
| `disableWebSocket` | `boolean` | Kein Live-Empfang; dann bei Bedarf `db.cloud.sync({ purpose: 'pull' })`. |
| `disableEagerSync` | `boolean` | Lokale Änderungen lösen keinen Sync aus. |
| `fetchTokens` | `(p: { public_key: string; hints?: { userId?: string; email?: string } }) => Promise<TokenFinalResponse>` | Eigene Token-Beschaffung (Custom Auth, E2E). |
| `socialAuth` | `boolean` | Default true: OAuth-Provider (Google, GitHub, Microsoft, Apple …) vom Server laden und anzeigen. `false` = nur OTP; nötig, wenn eigene Login-UI den `DXCSelect`-Typ nicht kann. |
| `oauthRedirectUri` | `string` | Redirect für OAuth, Default `window.location.href`. |
| `blobMode` | `'eager' \| 'lazy'` | Default `'eager'`. |
| `largeStringThreshold` | `number` | Default 32768, min 100, `Infinity` = aus (erst 4.4.15). |
| `awarenessProtocol` | `typeof import('y-protocols/awareness')` | Nur Y.js. |

Vorschlag für uns:
```ts
db.cloud.configure({
  databaseUrl: import.meta.env.VITE_DEXIE_CLOUD_URL,
  requireAuth: false,                 // lokaler Modus ohne Login
  unsyncedTables: ['settings'],       // deviceId, writableTripIds usw. bleiben lokal
  customLoginGui: true,               // eigenes Login-Sheet im App-Design
  socialAuth: false,                  // erst nur E-Mail-OTP (einfachste UI)
  nameSuffix: false,                  // lokale DB 'logbook-v3' behalten (siehe 2.6)
  tryUseServiceWorker: false,         // Phase 1; siehe 1.5
})
```
Hinweis: `socialAuth`, `nameSuffix` usw. sind im Quelltext dokumentiert; die Doku-Tabelle auf der Webseite führt `socialAuth`/`blobMode` nicht auf.

### 1.5 Service Worker: Zusammenspiel mit vite-plugin-pwa/Workbox

- Ohne Service Worker funktioniert Dexie Cloud "very well": Solange die App offen und der Nutzer aktiv ist, besteht eine bidirektionale Eager-Sync-Verbindung (WebSocket); nur Sync bei geschlossener App entfällt [Quelle: https://dexie.org/docs/cloud/db.cloud.configure()]. **Empfehlung: Phase 1 ohne `tryUseServiceWorker`.** Unser bestehender generateSW-Service-Worker bleibt unberührt.
- Mit SW: `tryUseServiceWorker: true` plus eigener SW, der das Modul importiert. Doku (alt): `importScripts('<path>/dexie-cloud-addon/dist/umd/service-worker.js')` [Quelle: db.cloud.configure()-Seite]. Aktuelles Paket exportiert `dexie-cloud-addon/service-worker` (ESM und UMD) [Quelle: `package.json` `exports["./service-worker"]` in 4.4.15].
- Offizielles Sample mit vite-plugin-pwa: `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, `injectRegister: false`; `src/sw.ts` beginnt mit `import 'dexie-cloud-addon/service-worker'`, dann `precacheAndRoute(self.__WB_MANIFEST)` und `cleanupOutdatedCaches()` [Quelle: https://github.com/dexie/Dexie.js/blob/master/samples/dexie-cloud-todo-app/src/sw.ts und `vite.config.ts`].
- Für uns hieße das: Wechsel von `generateSW` (heutiger `workbox: { runtimeCaching … }`-Block) auf `injectManifest` mit eigenem `src/sw.ts`. Die OSM-Kachel-Regel (`CacheFirst`, 2000 Einträge, 30 Tage) muss dann in `sw.ts` per `workbox-routing`/`workbox-strategies`/`workbox-expiration` nachgebaut werden (zusätzliche devDependencies). `registerType: 'prompt'` bleibt möglich; der SW braucht dann einen `message`-Handler für `SKIP_WAITING` (Standardmuster von vite-plugin-pwa, hier [unverifiziert], nicht in Dexie-Doku). Das Sample ruft stattdessen `self.skipWaiting()` im `install`-Event auf.
- Alternative mit `generateSW`: Workbox-Option `importScripts` auf eine kopierte Datei `dexie-cloud-addon/dist/umd/service-worker.min.js` im `public/` [unverifiziert; Workbox-Option, nicht in Dexie-Docs belegt].
- Der SW öffnet die DB unter ihrem Namen (Tag `dexie-cloud:<dbName>`), auch mit Suffix [Quelle: Code `service-worker.ts`]. Er braucht daher denselben Namen wie die Hauptseite.
- Browser: Periodic Sync nur Chrome/Edge/Opera und installierte PWA; Safari entfällt [Quelle: db.cloud.configure()-Seite, Stand Okt. 2023]. Zielplattform sind Android-Handys, also nutzbar; Nutzen aber gering gegenüber WebSocket-Sync bei offener App. Spike-Frage: GitHub-Pages-Scope `/logbuch/` mit dem SW (`start_url '.'`, `scope '.'`) [unverifiziert].

## 2. Schema-Anforderungen

### 2.1 Primärschlüssel [Quelle: https://dexie.org/docs/cloud/best-practices]

- Kein `++id`. Erlaubt: `@id` (generiert, Präfix aus 3 Buchstaben des Tabellennamens, z. B. `itm0Oro…`) oder `id` mit eigenen Strings "with entropy enough for global uniqueness, such as GUIDs". Beispiel in der Doku: `items: 'id'` mit `id: "ed3a25c3-9f08-4b5e-879d-d6ca8cc371ea"`.
- Präfix-Regel gilt **nur** für `@`-Tabellen (auto-generierte Keys). Unsere `crypto.randomUUID()`-Strings in `id`-Tabellen sind also erlaubt (kein Präfix).
- "Primary key column must be string unless the primary key is a compound primary key, in which case it will be an array of strings or numbers." Compound-Keys: "composed from string columns only, or a combination of string and number columns" mit ausreichender Entropie. Doku-Beispiel: `friendRelations: '[friend1Id+friend2Id+label]'`. **`dayReports: '[tripId+date+authorId]'` ist damit zulässig** (tripId ist eine UUID, date ein String, authorId ein String).
- Randfall: Unser `authorId = ''` (Bericht ohne Autor). Leerer String im Compound-Key ist in den Docs nicht ausgeschlossen, aber auch nicht belegt [unverifiziert]. Im Sync-Modus ist `authorId` immer gesetzt; für lokal erzeugte Altberichte nach dem ersten Login vor dem Sync einen Platzhalter wie `'_'` setzen, oder Spike-Test.
- Optional (nur weil es keine Altdaten gibt und der Key nach dem ersten Sync nie mehr geändert werden darf): DayReport einen Surrogat-`id` geben (`${tripId}_${date}_${authorId}`). Nutzen: einfachere `update()`/`delete()`-Aufrufe. Doku-Hinweis: "Never change the primary keys of a table" [Quelle: Best-Practices].
- Synchronisierte Tabellen müssen inbound-Keys haben (kein Auto-Increment, kein outbound `''`-Schema); sonst `SchemaError` [Quelle: Code `verifySchema.ts`]. `settings: 'key'` ist inbound, aber wir markieren es als `unsyncedTables`.
- Private Singleton-IDs mit `#`-Präfix (`'#theme'`) liegen pro Nutzer im privaten Realm und kollidieren nie; "must never be shared" [Quelle: https://dexie.org/docs/cloud/consistency].

### 2.2 Pflichtfelder `realmId` / `owner`

- Reservierte Properties in allen Anwendungstabellen. `realmId` ordnet das Objekt einem Realm zu; fehlt es, wird die `userId` des Erstellers eingesetzt (privater Realm). `owner` = Nutzer mit vollen Rechten am Objekt (ändern, löschen, `realmId`/`owner` wechseln), Default aktueller Nutzer, explizit `null` = kein Owner [Quelle: https://dexie.org/docs/cloud/access-control].
- Die Middleware setzt beide bei `add`/`put` automatisch, auch ohne Login (dann `'unauthorized'`) [Quelle: Code `createImplicitPropSetterMiddleware.ts`]. Wir müssen sie also **nicht** in den Domain-Typen erzwingen, sollten aber `realmId?: string; owner?: string` als optionale Felder in `Trip`, `LogEntry`, `Photo`, `DayReport`, `Track` deklarieren (Typisierung, `where({realmId})`).
- Indizes: Dexie Cloud interessiert sich serverseitig nur für den Primärschlüsselnamen und ob er `@` hat, nicht für Sekundärindizes [Quelle: https://dexie.org/docs/cloud/cli, Abschnitt Schema]. Für Clientabfragen nach `realmId` ggf. Index ergänzen; unser bestehendes `tripId`-Indexing reicht, weil wir Objekte per `where({ tripId })` in den Realm schieben.

### 2.3 Tabellen für Zugriffsrechte

Die Zugriffstabellen werden vom Addon in jedes Schema gemerged (`storesClone = { ...DEXIE_CLOUD_SCHEMA, ...stores }`), müssen also nicht deklariert werden; deklarieren lohnt für zusätzliche Indizes und Typen. Namen und Primärschlüssel müssen exakt stimmen; Primärschlüssel dürfen nicht abweichen [Quelle: Code `overrideParseStoresSpec.ts`]:
```ts
realms: '@realmId',
members: '@id,[email+realmId],realmId',
roles: '[realmId+name]',
```
[Quelle: https://dexie.org/docs/cloud/access-control; Index `realmId` am members ist Zusatz].

### 2.4 Lokale, nicht synchronisierte Tabellen

- `unsyncedTables: ['settings']` (siehe 1.4). `unsyncedProperties` für einzelne Felder.
- Lokale Tabellen dürfen `Version.upgrade()` nutzen; für synchronisierte Tabellen nicht: "Don't use Version.upgrade() except for non-synced tables" [Quelle: Best-Practices].
- Befüllen in `on('populate')`: "Don't populate data in Dexie.on.populate"; stattdessen im `populate` ein `db.on.ready.subscribe(...)` registrieren und dort schreiben [Quelle: Best-Practices]. Unser `populate`-Hook schreibt `deviceId` in `settings` (unsynchronisiert). Das ist vermutlich harmlos, aber nach der Doku-Regel auf `ready` umzustellen [unverifiziert, ob nötig].
- **Wichtig (Logout-Wipe):** `settings` wird beim Logout mitgelöscht (4.4). `deviceId` darf dann nicht nur im `populate` entstehen; `getSettings` ist heute rein lesend (liveQuery-tauglich). Lösung: `deviceId` lazy beim ersten Schreiben erzeugen oder nach Logout im `ready` neu setzen.
- Pro-Nutzer-Einstellungen, die geräteübergreifend gelten sollen (z. B. `authorByTrip`, `theme`): eigene synchronisierte Tabelle `userSettings: 'id'` mit `#`-Schlüsseln (`#author:<tripId>`) im privaten Realm [Quelle: Consistency-Seite, "Private Singleton IDs"]. Sie überleben Logout/Login, weil sie aus der Cloud zurückkommen.

### 2.5 Namens-Restriktionen

- Tabellen mit Präfix `$` sind intern (Addon legt `$jobs`, `$logins`, `$syncState`, `*_mutations` an) [Quelle: Code `overrideParseStoresSpec.ts`, `logout.ts`]. Eigene Tabellen dürfen nicht mit `$` beginnen. Reservierte Namen: `realms`, `members`, `roles`. Feldnamen `realmId`, `owner` reserviert. Interne Marker `_hasBlobRefs`, `_bt`, `$ts` (nur bei `#`-IDs) nicht selbst verwenden. Weitere Restriktionen sind in der Doku nicht beschrieben [unverifiziert].

### 2.6 Lokaler DB-Name und Versionssprung

- `nameSuffix` (Default true) benennt die lokale DB um (`logbook-v3-<dbid>`). Mit Suffix ist die bisherige lokale DB `logbook-v3` für die App unsichtbar; ihre Daten wären weg, bis sie manuell migriert werden. Da der Start von `logbook-v3` bisher "Neustart ohne Altdaten" war, ist beides vertretbar. Empfehlung: `nameSuffix: false` (Datenkontinuität zwischen lokalem Modus und Cloud-Modus; ein Wechsel der `databaseUrl` verbindet aber dieselbe lokale DB mit einer anderen Cloud-DB, was Doku ausdrücklich als Grund für den Suffix nennt) [Quelle: db.cloud.configure()-Seite, Abschnitt nameSuffix]. Für Test-DB vs. Produktiv-DB daher getrennte Local-DB-Namen verwenden (z. B. Name aus Env).
- Weil das Addon der lokalen DB zusätzliche Stores hinzufügt, braucht das Schema `this.version(2).stores({...})` (alle Doku-Samples erhöhen die Version beim Hinzufügen der Access-Control-Tabellen: `db.version(2).stores({ …, realms: '@realmId', … })`) [Quelle: access-control-Seite]. Ein Verhalten von Dexie bei geändertem Schema ohne Versionserhöhung ist nicht geprüft [unverifiziert]; Version erhöhen ist die sichere Lösung.

### 2.7 Blob-Felder

`Photo.blob` (Blob) wird immer ausgelagert (1.2). Beachten:
- Jede erzeugte oder ersetzte Blob zählt als **Blob-Write-Operation** (Free: 1.000/Monat; Pro: 50.000/Monat je 25 Seats; 0,50 EUR je weitere 10.000) [Quelle: https://dexie.org/cloud/pricing]. Unsere Fotos sind unveränderlich (nur `add`); keine Rewrites.
- Blobs gehören zur Foto-Zeile: Fotos müssen denselben `realmId` wie ihr Trip tragen, sonst sehen Mitsegler sie nicht.
- Base64-Strings > 32 KB Zeichen werden ebenfalls ausgelagert; unser Export-Format (Base64 im JSON) betrifft das nicht, weil es nicht in der DB liegt.
- Objekt-Storage ist 40-mal teurer als Blob-Storage (2 EUR/GB vs. 0,05 EUR/GB): große Strukturen wie `Track.points` zählen als Objektdaten (siehe 6.2) [Quelle: Preisseite].

## 3. Realms, Members, Roles

### 3.1 Realm anlegen

- Tabelle `realms`, Primärschlüssel `realmId` ist ein global eindeutiger String mit Präfix `rlm` (`@realmId` erzeugt ihn) [Quelle: https://dexie.org/docs/cloud/db.realms].
- Für Objekte, die zuerst privat sind und später geteilt werden (genau unser Fall "lokales Logbuch, später mit Crew teilen"), gibt es `getTiedRealmId(objectId)` = `'rlm~' + objectId` (Code), damit mehrere Offline-Geräte denselben Realm erzeugen statt zwei. Doku: `db.realms.upsert(realmId, { name, represents: 'a to-do list' })`; `upsert` statt `add`/`put` [Quelle: https://dexie.org/docs/cloud/consistency, Code `getTiedRealmId.ts`; Dexie 4.4.6 hat `Table.upsert(key, changes)`, geprüft in `node_modules/dexie/dist/dexie.d.ts`].
- Mapping: `realmId = getTiedRealmId(trip.id)`. Das entspricht Ihrer Konvention `rlm-…` nicht exakt (`rlm~<uuid>`); eigene Präfixformen wie `rlm-<uuid>` sind für `@`-Tabellen zulässig, solange sie mit `rlm` beginnen [Quelle: Best-Practices: "@-tables ... never accept keys that do not start with this 3-letter shortening"]. Vorteil `getTiedRealmId`: derselbe Realm auf allen Geräten; wir empfehlen es.
- Realm-Felder: `realmId`, `name?`, `represents?` (Text in Einladungsmails), `owner?` [Quelle: access-control-Seite].
- Besitzer: Die Access-Control-Seite sagt, Realm-Owner müssten sich selbst als Member hinzufügen, um den Realm zu syncen. Das offizielle Sample (`shareWith`) fügt nur die Eingeladenen hinzu, nicht den Owner [Quelle: Code TodoList.ts]; Kommentar dort: Server lehnt das Löschen des Members ab, der den Owner repräsentiert. Widerspruch, Spike-Test: Wird der Owner automatisch Member? [unverifiziert]
- Auch lokal vor Login nutzbar: Das Realm-Objekt entsteht lokal, Syncification beim Login setzt `owner` (`modifyLocalObjectsWithNewUserId`) [Quelle: Code `sync/modifyLocalObjectsWithNewUserId.ts`].

### 3.2 Objekte einem Realm zuordnen

- Beim Erstellen: `realmId` setzen, z. B. `db.entries.add({ ..., tripId, realmId: trip.realmId })`.
- Verschieben: `update(id, { realmId })` bzw. für viele Objekte konsistent `where(...).modify({ realmId })`; Doku-Beispiel [Quelle: Consistency-Seite]:
```ts
await db.transaction('rw', [db.todoLists, db.todoItems, db.realms], async () => {
  const newRealmId = getTiedRealmId(todoList.id)
  await db.realms.upsert(newRealmId, { name: 'A todo list', represents: 'a todo list' })
  await db.todoLists.update(todoList.id, { realmId: newRealmId })
  await db.todoItems.where({ todoListId: todoList.id }).modify({ realmId: newRealmId })
})
```
- Recht zum Verschieben: Permission `add` in der Zielrealm **und** Owner- oder `manage`-Recht in der Quelle [Quelle: access-control-Seite].
- Löschen eines geteilten Objekts samt Realm: `where({ id }).delete()` ohne Realm-Bedingung plus `db.realms.delete(tiedRealmId)`; Members werden mit dem Realm kaskadierend gelöscht ("do not delete db.members explicitly") [Quelle: Consistency-Seite].

### 3.3 Members einladen, Einladung annehmen

Member-Interface [Quelle: access-control-Seite]:
```ts
interface Member {
  id?: string            // Präfix 'mmb'
  realmId: string
  userId?: string        // setzt das System bei Annahme
  email?: string         // Pflicht für Einladung
  name?: string
  invite?: boolean       // true => Server verschickt E-Mail
  invitedDate?: Date; invitedBy?: { name: string; email: string; userId: string }
  accepted?: Date; rejected?: Date
  roles?: string[]
  permissions?: { add?: string[] | '*'; update?: { [table: string]: string[] | '*' }; manage?: string[] | '*' }
}
```
- Einladen: `db.members.add({ realmId, email, name, roles: ['crew'], invite: true })`. Das Addon normalisiert die E-Mail (trim, lowercase) [Quelle: Code Middleware]. Mitglieder können vor ihrem Konto eingeladen werden.
- Mit `invite: false` entsteht kein Mail-Versand, der Eingeladene sieht die Einladung dennoch in `db.cloud.invites` nach Login mit derselben E-Mail (die Observable sucht `members` mit der eigenen E-Mail) [Quelle: Code `getInvitesObservable.ts`]. Das ermöglicht Einladen ohne Mailversand (z. B. Link per WhatsApp: "Öffne die App, melde dich mit dieser E-Mail an").
- Annehmen: `db.cloud.invites` ist `Observable<Invite[]>`; `invite.accept()` und `invite.reject()` setzen `accepted`/`rejected` auf dem Member [Quelle: https://dexie.org/docs/cloud/db.cloud.invites; Code `getInvitesObservable.ts`]:
```tsx
const invites = useObservable(db.cloud.invites, []);
invites.map(inv => (
  <li key={inv.id}>… {inv.realm?.name} … <button onClick={() => inv.accept()}>Annehmen</button></li>
))
```
- Nach Annahme lädt der nächste Sync den Realm samt Objekten auf alle Geräte des Nutzers.
- Einladungsmail ist anpassbar nur mit Pro-Abo plus eigener SMTP-Konfiguration [Quelle: https://dexie.org/docs/cloud/custom-emails]. Standardmail genügt.
- Entfernen: `db.members.delete(id)`; Austreten: `db.members.where({ realmId, userId: db.cloud.currentUserId }).delete()` (Sample `leaveList`); der Owner kann nicht austreten [Quelle: Code TodoList.ts].

### 3.4 Permissions pro Member vs. globale Roles

- Direkt am Member (`permissions`) oder über Rollen (`roles: [...]`). Rollen sind pro Datenbank global (Realm `rlm-public`) und werden per CLI importiert; es sind auch realm-lokale Rollen möglich [Quelle: https://dexie.org/docs/cloud/db.roles, access-control-Seite].
- Syntax [Quelle: DBPermissionSet-Seite]:
```ts
interface DBPermissionSet {
  add?: '*' | string[]                    // Objekte in Tabellen anlegen
  update?: '*' | { [table: string]: string[] | '*' }   // Properties ändern; '*' = alle außer realmId/owner
  manage?: '*' | string[]                 // alles, auch fremde Objekte löschen
}
```
- Kein Recht (leeres `permissions`/Rolle mit `{}`) = **nur lesen** (Mitglied syncen, nichts ändern) [Quelle: access-control-Seite: "Zero permissions means readonly access"]. Beispiel `readonly` in der CLI-Doku: `"permissions": {}`.
- `update: '*'` an Property-Ebene schließt `realmId` und `owner` aus; wer sie ändern darf, braucht explizit `['*', 'realmId', 'owner']` [Quelle: access-control-Seite].
- Owner-Regel: Wer ein Objekt erzeugt hat (`owner`), darf es ändern und löschen, auch mit nur `add`-Recht ("you can add new comments but also update or delete your own comments") [Quelle: access-control-Seite].

Rollen-Datei (Vorschlag, Format aus der CLI-Doku):
```json
{
  "roles": {
    "skipper": { "displayName": "Skipper", "description": "Voller Zugriff im Logbuch des Boots", "sortOrder": 1,
                 "permissions": { "manage": "*" } },
    "crew":    { "displayName": "Crew", "description": "Schreibt Einträge, Berichte, Fotos, Tracks",
                 "sortOrder": 2,
                 "permissions": { "add": ["entries","photos","dayReports","tracks"],
                                  "update": { "trips": "*", "entries": "*", "dayReports": "*", "tracks": "*" } } },
    "readonly":{ "displayName": "Nur lesen", "description": "Andere Boote der Flottille",
                 "sortOrder": 3, "permissions": {} }
  }
}
```
Import: `npx dexie-cloud import roles.json` [Quelle: https://dexie.org/docs/cloud/cli, "Import file example for importing roles"]. Das Format entspricht `ImportFileFormat.roles` (`displayName`, `description`, `sortOrder?`, `permissions`).

Hinweis zur Crew-Rolle ohne `manage`: Mitsegler dürfen dann **keine fremden Objekte hart löschen**, aber per `update` `deletedAt` setzen. Das passt zum bestehenden Soft-Delete.

### 3.5 Schreibrecht in der UI abfragen

- React: `usePermissions` aus `dexie-react-hooks` (in der installierten Version 4.4.0 vorhanden). Signaturen [Quelle: GitHub `libs/dexie-react-hooks/src/usePermissions.ts`]:
```ts
usePermissions<T extends DexieCloudEntity>(entity: T): PermissionChecker<T, …>
usePermissions<TDB extends Dexie, T>(db: TDB, table: TableProp<TDB>, obj: T): PermissionChecker<T, TableProp<TDB>>
// PermissionChecker: add(...tableNames): boolean; update(...props): boolean; delete(): boolean
```
Beispiel aus der Doku: `const can = usePermissions(db, 'members', member)`; `can.add('entries')`, `can.update('text')`, `can.delete()`.
- Ohne React: `db.cloud.permissions(obj, tableName)` liefert `Observable<PermissionChecker>`. Doku-Seite zeigt die Argumente als `("friends", databaseObject)`, die TypeScript-Definition im Repo aber `permissions(obj, table)`; Quelle ist maßgeblich [Quelle: https://dexie.org/docs/cloud/db.cloud.permissions() vs. Code `DexieCloudAPI.ts`].
- Für "darf ich in diesem Trip schreiben?" (rein realmbasiert, unabhängig von der Objekt-Ownership): `usePermissions(db, 'entries', { realmId: trip.realmId, owner: undefined })`, dann `can.add('entries')`. Laut Quelltext gilt: unbekannter Realm ⇒ Prüfer ohne Rechte; `realmId` undefined oder gleich eigener `userId` ⇒ Owner-Rechte [Quelle: Code `permissions.ts`]. Die Doku beschreibt diese Verwendung nicht [unverifiziert]. Das ersetzt `Settings.writableTripIds` im Cloud-Modus; im rein lokalen Modus bleibt `writableTripIds` Fallback.
- Ein für Cloud-Trips neuer Zustand "Zugriff nicht mehr da" (Rolle entzogen): Server rollt Offline-Änderungen zurück ("roll-back") [Quelle: Consistency-Seite]; UI sollte das ertragen.

### 3.6 Vor dem Login erstellte Daten

[Quelle: Code `sync/modifyLocalObjectsWithNewUserId.ts`, `middlewares/createImplicitPropSetterMiddleware.ts`; Consistency-Seite, Absatz "Like all data in Dexie Cloud, it is allowed to add objects even when not yet authenticated"]
- Ohne Login haben Objekte `realmId = 'unauthorized'`, `owner = 'unauthorized'` (lokal). Beim ersten Sync nach Login wird jedes Objekt mit leerem/`unauthorized`-Wert auf `realmId = <userId>` und `owner = <userId>` gesetzt und dann hochgeladen (in den **privaten** Realm). Nicht-authentifizierte Nutzer dürfen nur im privaten Realm erzeugen.
- Folge: Ein lokal angelegtes Logbuch ist nach Login privat und synchronisiert auf die eigenen Geräte. Um es mit der Crew zu teilen: Realm anlegen, Trip und alle Kinder (entries, photos, dayReports, tracks mit `tripId`) in den Realm verschieben (3.2).
- Ohne Login ist `tablesToSync` leer; es gibt keinen Netzverkehr [Quelle: Code `sync/sync.ts`]. "App funktioniert ohne Cloud" ist damit gegeben.
- **Kollisionsrisiko** (ungeklärt): Ein Crewmitglied, das denselben Trip (gleiche IDs) schon lokal importiert hat (Stufe-1-Datei), würde dieselben Primärschlüssel in den privaten Realm hochladen, während der Boots-Realm sie schon enthält. Serververhalten bei gleichen Schlüsseln in unterschiedlichen Realms ist nicht dokumentiert [unverifiziert]; Spike-Test. Praktische Vorsichtsmaßnahme: Vor Beitritt lokale Kopie des Trips löschen oder Beitritt nur auf leerer DB.

## 4. Authentifizierung

### 4.1 Standard: E-Mail-OTP

Zero-Config: E-Mail eingeben, OTP per Mail, einloggen. Kein Server, keine Registrierung, kein Passwort; funktioniert auf statischem Hosting wie GitHub Pages. Danach bleibt die Sitzung "für Monate", bis aktiv ausgeloggt wird [Quelle: https://dexie.org/docs/cloud/authentication]. Zusätzlich Social Login (Google, GitHub, Microsoft, Apple, Facebook, LinkedIn, Discord, eigene OAuth2) über den Dexie-Cloud-Manager konfigurierbar; `db.cloud.login({ provider: 'google' })` [Quelle: dieselbe Seite]. Eigene Identitätsstrategie `Email` (Default) | `Opaque` | `Provider`: vor dem Onboarding festlegen, später ändern macht Realms/Einladungen unzugänglich [Quelle: dieselbe Seite].

API [Quelle: https://dexie.org/docs/cloud/db.cloud.login(), `.../db.cloud.logout()`]:
```ts
await db.cloud.login()                                   // Dialog, fertig wenn eingeloggt
await db.cloud.login({ email: 'a@b.de' })                // E-Mail vorbelegen
await db.cloud.login({ grant_type: 'otp' })              // OTP erzwingen
await db.cloud.login({ grant_type: 'demo', email: 'alice@demo.local' })  // Demo-User
await db.cloud.logout()                                  // fragt bei ungesyncten Änderungen nach
```
`db.cloud.currentUser` (Observable von `UserLogin`, mit `name`, `email`, `isLoggedIn`, `license`) und `db.cloud.currentUserId` (`'unauthorized'` wenn nicht eingeloggt) [Quelle: currentUser-Seite, Code `DexieCloudAPI.ts`].

### 4.2 Eigene Login-UI

`customLoginGui: true` und `db.cloud.userInteraction` (`BehaviorSubject<DXCUserInteraction | undefined>`) im Root beobachten. Ist der Wert nicht `undefined`, einen Dialog rendern: `ui.type` ('email', 'otp', 'message-alert', 'logout-confirmation'), `ui.title`, `ui.alerts[]`, `ui.fields` (Name → `{type,label,placeholder}`), `ui.options` (OAuth-Optionen), `ui.submitLabel`, `ui.cancelLabel`, `ui.onSubmit(params)`, `ui.onCancel`. Offizielles React-Beispiel: Komponente `MyLoginGUI` mit `useObservable(db.cloud.userInteraction)` und `ui.onSubmit(params)` [Quelle: https://dexie.org/docs/cloud/authentication, Abschnitt "Customizing login GUI"; Typen `DXCUserInteraction`, `DXCInputField`, `DXCOption`, `resolveText` aus `dexie-cloud-addon`]. Bei `socialAuth: false` entfällt der `options`-Zweig. Beachte: Auch `logout-confirmation` läuft über diese UI (Warnung vor Datenverlust).

### 4.3 Offline-Verhalten, Token-Laufzeit

- Access-Token gilt 1 Stunde [Quelle: https://dexie.org/docs/cloud/rest-api, Abschnitt /token]. Refresh-Token ist langlebig, hängt an einem nicht exportierbaren RSA-Schlüssel (CryptoKey in IndexedDB); Erneuern ohne Interaktion [Quelle: authentication-Seite]. Der Client erneuert den Access-Token, wenn er in <5 min abläuft (`loadAccessToken`) [Quelle: Code `authentication/authenticate.ts`]; ist das Refresh-Token abgelaufen ("Refresh token has expired"), ist neues Login nötig (Dauer in Doku "Monate", genauer Wert [unverifiziert]).
- Offline arbeitet die App ohne Einschränkung auf lokalen Daten; Sync setzt nach Wiederverbindung fort. `requireAuth` bedeutet: Login "once per device", danach wie nativ [Quelle: db.cloud.configure()-Seite].
- Evaluation-User verlieren nach 30 aktiven Tagen den Sync (App bleibt offline nutzbar) [Quelle: https://dexie.org/cloud/pricing, FAQ]; `UserLogin.license` und `SyncState.license` (`'ok' | 'expired' | 'deactivated'`) zeigen das an und sollten in der UI sichtbar sein.

### 4.4 Logout und lokaler Modus

[Quelle: Code `authentication/logout.ts`, GitHub-Issue #2019]
- `db.cloud.logout()` zählt ungesyncte Mutationen; gibt es welche, bestätigt der Nutzer, dann werden sie verworfen. Anschließend **werden alle Tabellen geleert** (`table.clear()` für alle `db.dx.tables` außer `$jobs` und `$syncState`) und der Zustand "unauthorized" wiederhergestellt. Auch `unsyncedTables` (z. B. `settings`) sind betroffen, soweit sie in `db.dx.tables` stehen (alle Tabellen der Instanz).
- Konsequenz für uns: "Ausloggen" = "Lokale Kopie entfernen; Daten bleiben in der Cloud". Wer offline (kein Netz) ausloggt, kann ungesyncte Änderungen verlieren (Issue #2019, offen: Logout synchronisiert nicht verlässlich vorher).
- UI-Pflicht: Vor Logout ZIP-Export anbieten (bestehende Funktion), klar texten "Lokale Daten dieses Geräts werden entfernt", `deviceId` neu erzeugen. Reiner lokaler Modus (nie eingeloggt) ist davon nicht berührt.

### 4.5 Test-Login für automatisierte E2E-Tests

Drei Wege, geordnet nach Aufwand:

**A. Demo-User (empfohlen, kein Geheimnis, keine Seats).** Demo-User haben kein Login, belegen keine Seats, laufen nie ab [Quelle: https://dexie.org/cloud/pricing, "Demo Accounts"; https://dexie.org/docs/cloud/add-demo-users]:
```json
{ "demoUsers": { "skipper-a@demo.local": {}, "crew-a@demo.local": {}, "skipper-b@demo.local": {} } }
```
`npx dexie-cloud import demoUsers.json`. Im Test: `await db.cloud.login({ grant_type: 'demo', email: 'skipper-a@demo.local' })` (zum Beispiel über `page.evaluate` auf einem im E2E-Build exponierten `window.__db`). Das Todo-Sample benutzt dasselbe (`demoUsers.json`: alice/bob/foo/bar@demo.local) [Quelle: GitHub `samples/dexie-cloud-todo-app/src/data/demoUsers.json`, `configure-app.sh`]. Einladungen an `@demo.local`-Adressen mit `invite: false` anlegen (keine echten Mails); der Demo-User sieht sie über `db.cloud.invites`.

**B. Client Credentials + `fetchTokens` (ein echter Nutzer ohne OTP).** Token-Endpoint [Quelle: https://dexie.org/docs/cloud/rest-api, Abschnitt `/token`]:
```
POST {databaseUrl}/token   Content-Type: application/json
{ "grant_type": "client_credentials", "scopes": ["ACCESS_DB"],
  "public_key": "<vom Client>", "client_id": "<aus dexie-cloud.key>", "client_secret": "<aus dexie-cloud.key>",
  "claims": { "sub": "tester1@example.test", "email": "tester1@example.test", "name": "Tester 1" } }
```
`claims` verlangt Scope `IMPERSONATE` (Default-Client der DB hat alle Scopes). Antwort `TokenFinalResponse { type:'tokens', claims, accessToken, accessTokenExpiration, refreshToken?, refreshTokenExpiration?, userType: 'demo'|'eval'|'prod'|'client', … }`. Konfiguration im Test-Build:
```ts
db.cloud.configure({ databaseUrl, requireAuth: false, fetchTokens: window.__e2eFetchTokens })
```
`fetchTokens` ersetzt die Zero-Config-Authentifizierung komplett [Quelle: db.cloud.configure()-Seite], darf also nur im E2E-Build gesetzt werden. Das Secret darf nie im Browser stehen: Playwright (Node) hält `dexie-cloud.key` aus dem CI-Secret und stellt `fetchTokens` über `page.exposeFunction('__e2eFetchTokens', async ({ public_key }) => (await fetch(`${url}/token`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ grant_type:'client_credentials', scopes:['ACCESS_DB'], public_key, client_id, client_secret, claims }) })).json())` bereit [Muster nach Doku, exposeFunction-Teil ist [unverifiziert] gegen Dexie, Playwright-Standard]. Danach `await db.cloud.login()` (löst `fetchTokens` aus, `hints` enthält E-Mail/userId).
Seats: Unbekannte Nutzer belegen laut Preisseite keinen Seat, sondern erhalten eine Evaluation-Lizenz (30 aktive Tage) [Quelle: Preisseite "Evaluation Users"]. Wie ein per `client_credentials` impersonierter Nutzer verbucht wird (`userType 'client'`?), ist nicht beschrieben [unverifiziert]. Rate-Limit: `token` 100/h je Zielnutzer [Quelle: https://dexie.org/docs/cloud/limits].

**C. Echte Mail-OTP (nicht automatisierbar ohne Postfach-Zugriff).** Nur für manuellen Spike mit zwei Geräten.

Weitere Hinweise für E2E: eigene Test-Cloud-DB (`npx dexie-cloud create`, max. 10 Datenbanken-Erstellungen je 12 h [Quelle: limits-Seite]), eigene `whitelist` für `http://localhost:4173`; Aufräumen mit `npx dexie-cloud clear-realm <realmId> --yes` (benötigt `GLOBAL_WRITE`; für private Realms ist die `userId` die Realm-ID) und `clear-table <table> --yes` [Quelle: CLI-Seite].

### 4.6 Seats

- Free: 3 Produktions-Seats (manuell/REST/Manager), Evaluation-User unbegrenzt (30 aktive Tage, dann Sync aus), Demo-Konten unbegrenzt ohne Seat [Quelle: https://dexie.org/cloud/pricing].
- Tabellenwiderspruch auf der Preisseite: Kopf "Free: 3 production users, 50,000 evaluation users", Tabelle "Unlimited, free" [Quelle: dieselbe Seite]; irrelevant für uns.
- 6 Segler + Tester: 3 Seats + Evaluation für den Törn kann technisch reichen (Evaluation zählt nur aktive Tage), ist aber für Fotos wegen Storage (4.7) knapp. Pro: 3 EUR/Monat je 25 Seats.

## 5. CLI

[Quelle: https://dexie.org/docs/cloud/cli]
- `npx dexie-cloud create [--service <URL>]` — fragt E-Mail, dann OTP; legt `dexie-cloud.json` (Datenbank-URL) und `dexie-cloud.key` (Client-ID und Secret) im aktuellen Ordner an. **Beide nicht ins Git**; `.gitignore`: `dexie-cloud.json` und `*.key`. `.key` hat Rechte 0600. Die Dateien sind für die laufende Web-App nicht nötig, nur für CLI/REST.
- `npx dexie-cloud whitelist` (Liste) / `whitelist <origin> [--delete]` — Origin = `location.origin`, also **ohne Pfad**; HTTPS Pflicht außer `localhost`. Für uns:
```
npx dexie-cloud whitelist https://markuseckstein.github.io
npx dexie-cloud whitelist http://localhost:5173     # vite dev
npx dexie-cloud whitelist http://localhost:4173     # vite preview (Playwright)
```
- `npx dexie-cloud import <datei>` — Rollen (`roles.json`), Demo-User (`demoUsers.json`), Schema, Daten; additiv.
- `npx dexie-cloud export [--roles|--schema|--demoUsers|--realmId <id>|--table <t>|--legacy] [datei]` — ohne Flags: ZIP-Vollbackup (`data.ndjson`, `blobs.dcbl`, `yjs.dcyj`). Blobs werden mit exportiert.
- Weitere: `databases`, `connect <URL>`, `reconnect`, `authorize <email> [--scopes …] [--service-account]`, `unauthorize`, `revoke <clientId>`, `clients`, `rotate`, `delete <URL>` (1 Monat Gnadenfrist) / `undelete`, `clear-table`, `clear-realm` (CLI ≥ 3.0.4), `templates pull|test-send|push|reset`.
- Schema "versiegeln": `{ "sealed": true }` verbietet neue Tabellen aus Clients; dann Schema vorher per `import` mitgeben. Standard: offen (Clients dürfen Tabellen per Sync anlegen) [Quelle: CLI-Seite].
- REST-API (`/all`, `/my`, `/public`, `/token`, `/blob`) für Skripte, Seats-Verwaltung, GDPR-Löschung (`DELETE /users/<userId>`) [Quelle: https://dexie.org/docs/cloud/rest-api, gdpr-compliance].

## 6. Konflikte, Löschen, Soft-Delete, mergeBundle

### 6.1 Konsistenzmodell

[Quelle: https://dexie.org/docs/cloud/consistency]
- **Server-autoritativ.** Clients arbeiten lokal, der Server führt die Operationen samt `where`-Bedingungen erneut gegen den Serverstand aus und schickt Korrekturen (Rollback) zurück. Jede Dexie-Transaktion ist atomar (alles oder nichts) auch auf dem Server. Alternativ CRDT über Y.js für Textfelder (nicht nötig).
- **update() vs. put():** `Table.update()` (und `modify()` mit Objekt statt Callback) synct **einzelne Properties**. Zwei Clients, die verschiedene Properties desselben Objekts ändern, kollidieren nicht. Bei gleicher Property gewinnt die zuletzt ausgeführte Operation (Zeitstempel der Operation, korrigiert um den Zeit-Offset des Clients zum Server). `put()` ersetzt das ganze Objekt und überschreibt fremde Änderungen. Folge: Repository-Funktionen müssen weiter per `update()` patchen (unser Repo-Standard "patchen per update()" passt); `put`/`bulkPut` nur für neue Objekte.
- Callback-`modify()` ist nicht sync-konsistent, nur lokal [Quelle: Consistency-Seite, Abschnitt "Consistent Tree Structures"].
- **Arrays:** "avoid storing objects in array properties if the array needs to be manipulated frequently by multiple clients"; besser eine Tabelle mit Fremdschlüssel. Für Mengen von Strings/Zahlen gibt es konsistente Operationen `add()`/`remove()` aus `dexie` (in `node_modules/dexie/dist/dexie.d.ts` vorhanden: `add(num | bigint | any[])`, `remove(...)`, `replacePrefix`). Beispiel: `db.entries.update(id, { photoIds: add([photoId]) })`. [Quelle: Consistency-Seite; Signaturen aus Dexie-Typen]
- **Löschen:** `delete()`/`bulkDelete()` werden als Löschoperationen synchronisiert. `Collection.delete()` mit `where` wird samt Bedingung auf dem Server erneut ausgeführt, daher löscht man abhängige Objekte mit `where({ parentId }).delete()` statt erst IDs zu lesen. Wie ein offline durchgeführtes `update` auf ein von anderer Seite gelöschtes Objekt aufgelöst wird, steht nicht explizit in der Doku (Rollback vermutet) [unverifiziert]. Tombstones erwähnt die Doku nicht; der Server hält Löschungen intern bis alle Clients sie gesehen haben ("persist on the server until all clients have synced") [Quelle: Consistency-Seite, für where-basierte Operationen].
- Zeit: Ordnung per Operationszeitstempel mit Clock-Offset-Korrektur; unsere `updatedAt`/`updatedBy` werden dafür nicht gebraucht.

### 6.2 Auswirkungen auf unser Datenmodell

| Thema | Befund | Empfehlung |
|---|---|---|
| `Trip.crew: CrewMember[]` | Array wird als Ganzes ersetzt; zwei gleichzeitige Crew-Änderungen auf zwei Geräten: letzte Operation gewinnt komplett. | Selten parallel; akzeptabel in Phase 1. Sauber: Tabelle `crew` (`id`, `tripId`, `name`, `role`, `email?`, `deletedAt?`). Entscheidung vor dem ersten Sync, weil Primärschlüssel/Tabellen nach Livegang schwer zu ändern sind. |
| `photoIds: ID[]` an Eintrag/Bericht | Ganzes Array ersetzt. | `update(id, { photoIds: add([x]) })` / `remove([x])` nutzen. |
| `Track.points[]` | Ein Track = ein großes Objekt; Live-Tracking schreibt oft; Objekt-Storage ist 40x teurer als Blob; jeder `update` der `points` lädt ggf. das Array neu hoch (Größe pro Property-Update unklar). | Tracks in Segmente/Chunks (`trackPoints` mit `[trackId+seq]`, 50-100 Punkte) oder Punkte nur beim Beenden/periodisch schreiben. [unverifiziert, Größenlimit pro Objekt nicht dokumentiert] |
| `dayReports` je Autor | Verschiedene Schlüssel, damit konfliktfrei. | Beibehalten. `text` ist ein einzelner String; gleiche Autoren-Sektion auf zwei Geräten: Last-Writer-wins. |
| `updatedAt`/`updatedBy` | Für Cloud-Sync redundant (Server vergibt Operationszeiten). Für Datei-Merge und LWW-Reihenfolge weiter nötig. | Behalten (Fallback `mergeBundle`). |
| `deletedAt` (Soft-Delete) | Funktioniert als normale Property; Cloud braucht es nicht, aber (a) Crew-Rolle ohne `manage` darf fremde Objekte nur per `update` "löschen", (b) Datei-Merge braucht Tombstones, (c) Wiederherstellen möglich. | **Behalten.** Zusätzlich: echte Löschung nur beim Entfernen eines Trips (Owner) per `where({tripId}).delete()` plus `realms.delete(tiedRealmId)`. |
| Fotos | Unveränderlich, kein Tombstone. | Beibehalten; Foto-Zeilen dürfen hart gelöscht werden, wenn Owner (oder `manage`). Aufräumen verwaister Fotos erst am Törnende. |
| `Settings` | lokal. | `unsyncedTables: ['settings']`; `authorByTrip` in synchronisierte `userSettings` mit `#`-Schlüsseln. |
| `deleteTrip` (heute hart, lokal) | Im Cloud-Modus würde es für alle löschen (falls erlaubt). | Zwei Aktionen: "Von diesem Gerät entfernen" (Austreten per `members.delete`) und "Logbuch für alle löschen" (nur Skipper/Owner, doppelte Bestätigung). |

### 6.3 `mergeBundle` bleibt Fallback, mit neuen Regeln

1. **`realmId`/`owner` nie überschreiben.** `bulkPut` eines Datensatzes ohne `realmId` setzt ihn auf den privaten Realm (Middleware). Beim Mergen: `realmId` aus vorhandener Zeile bzw. aus `trip.realmId` des Ziel-Trips übernehmen; beim Export `realmId`/`owner` weglassen (benutzerspezifisch) oder ignorieren.
2. Merge-Entscheidung weiter nach `(updatedAt, updatedBy)`; geänderte Datensätze mit `put` (oder besser `update` der geänderten Felder) schreiben. Mit Cloud wirkt ein `put` aus einer Datei wie eine echte Operation "jetzt", die gleichzeitige Cloud-Änderungen anderer überschreibt, selbst wenn die Datei älter ist. Daher beim Merge im eingeloggten Modus nur Datensätze schreiben, die nach `isNewer` gewinnen (tut `mergeRecords` bereits) und `update()` mit Patch bevorzugen.
3. Import eines Trips, der in der Cloud existiert, im Cloud-Modus: besser Warnung ("Dieses Logbuch ist bereits synchronisiert") oder Merge nur in den bestehenden Realm.
4. Foto-Dedup (`remapPhotoIds`) mit "kleinster ID" verändert `photoIds` ohne Versionssprung; im Cloud-Modus erzeugt das Schreibvorgänge. Kanonische ID-Wahl bleibt deterministisch, doppelte Fotos im Cloud-Modus nur per Anzeigefilter ausblenden statt umzuschreiben [Vorschlag, [unverifiziert] praktisch].
5. Exportformat v2 braucht kein Cloud-Feld. Der Datei-Austausch bleibt unverändert nutzbar, auch für Boote ohne Cloud-Konto.

## 7. Sync-Status für die UI

Alle als Observables an `db.cloud`; in React mit `useObservable` aus `dexie-react-hooks` (`useObservable(observable, initialValue?)`) [Quelle: https://dexie.org/docs/cloud/db.cloud.currentUser, `…/db.cloud.invites`; Sample `SyncStatusIcon.tsx`, das `react-use` nutzt, die Dexie-Doku selbst `useObservable` aus `dexie-react-hooks`]:

| Eigenschaft | Typ | Zweck |
|---|---|---|
| `db.cloud.syncState` | `SyncState { status: SyncStatus; phase: SyncStatePhase; progress?: number /*0..100*/; error?: Error; license?: 'ok'\|'expired'\|'deactivated' }` mit `status` `'not-started'\|'connecting'\|'connected'\|'disconnected'\|'error'\|'offline'` und `phase` `'initial'\|'not-in-sync'\|'pushing'\|'pulling'\|'in-sync'\|'error'\|'offline'` | Symbol "Cloud synchron/offline/Fehler" im Törn-Tab |
| `db.cloud.webSocketStatus` | `'not-started'\|'connecting'\|'connected'\|'disconnected'\|'error'` | Detailanzeige/Diagnose |
| `db.cloud.currentUser` | `UserLogin` (`name`, `email`, `userId`, `isLoggedIn`, `license`) | Kontoanzeige, Login-Button |
| `db.cloud.invites` | `Invite[]` mit `accept()`/`reject()` | Einladungs-Sheet |
| `db.cloud.blobProgress` | `{ isDownloading, blobsRemaining, bytesRemaining }` | "Fotos werden geladen (n)" |
| `db.cloud.roles` | `{ [roleName]: DBRealmRole }` | Rollenauswahl beim Einladen |
| `db.cloud.userInteraction` | `DXCUserInteraction \| undefined` | eigener Login-Dialog |
| `db.cloud.usingServiceWorker` | `boolean` | Debug |
| `db.cloud.events.syncComplete` | `Observable<void>` | Toast "Synchronisiert" |
| `db.cloud.sync({ wait?, purpose? })` | Promise | Manuelles Sync; `await db.cloud.sync({ purpose: 'pull' })` direkt nach Login wartet auf den Erstabgleich |

[Quelle: SyncState-Seite, webSocketStatus-Seite, sync()-Seite; Code `DexieCloudAPI.ts`]. Für ungesyncte Änderungen gibt es kein dokumentiertes öffentliches Zählerfeld; `persistedSyncState`/Mutationstabellen sind intern [unverifiziert].

## 8. Grenzen und Risiken

| Thema | Befund |
|---|---|
| Rate-Limits Sync | Eval-User 50 Syncs/5 min, Prod-User 200/5 min; Client drosselt ab 50 % [Quelle: limits-Seite]. Live-Tracking mit Schreibvorgängen je Sekunde nicht dafür geeignet: puffern. |
| Free-Plan | 3 Produktions-Seats, unbegrenzt Evaluation (30 aktive Tage), 10 gleichzeitige Verbindungen, Objekt 25 MB + Blob 75 MB (Kopfzeile "100 MB"), 1.000 Blob-Writes/Monat [Quelle: https://dexie.org/cloud/pricing]. Bei 2 Booten x 50-150 Fotos à 0,3-0,8 MB (Annahme aus `flotilla-sync.md`) werden 75 MB Blob-Speicher überschritten. |
| Pro | 3 EUR/Monat je 25 Seats (Kopfzeile "0,12 EUR/User"), 1 GB Objekt, 20 GB Blob, 50.000 Blob-Writes, 200 gleichzeitige Verbindungen je 100 User, Rate-Limit 200/5 min; Zusatz 0,05 EUR/GB Blob, 2 EUR/GB Objekt [Quelle: Preisseite]. Doku nennt 14 Tage Trial ohne Karte (FAQ). Kündigung: Daten 30 Tage zugänglich, dann gelöscht. |
| Datenregion | Gehostet: Azure PostgreSQL **US East**; DPF + SCC; Datenschutzerklärung und Hinweis "Verarbeitung in den USA" nötig; EU-Residenz nur On-Prem (3.495 EUR Business) [Quelle: gdpr-compliance, Preisseite]. Das widerspricht der Annahme "Region unklar" in `flotilla-sync.md`; Datenschutz-Entscheidung (privat, kleiner Kreis, 6 Personen) bewusst treffen. |
| Blob-Uploads | Nicht fortsetzbar; große Uploads können bei schlechter Verbindung scheitern [Quelle: Blob-Seite]. Fotos sind klein (nach Skalierung); Neuversuch beim nächsten Sync nicht belegt [unverifiziert]. |
| Blob/Offline | Eager-Download lädt alle Fotos aller Mitglieder des Realms auf jedes Gerät: bei Flottille mit mehreren Realms deutlich mehr Speicher auf dem Handy. `blobMode: 'lazy'` für fremde Boote nicht pro Realm einstellbar [unverifiziert]. |
| Logout-Wipe | siehe 4.4. |
| Schlüsseländerung | Primärschlüssel nie ändern; Migration nur über neue DB und Export/Import [Quelle: Best-Practices]. Schema vor Livegang festzurren (Crew-Tabelle? Track-Chunks? DayReport-Surrogat-ID?). |
| Migration | Keine `upgrade()`-Funktionen auf synchronisierten Tabellen [Quelle: Best-Practices]. Schemaerweiterungen (neue Felder) sind unproblematisch, Umbenennungen nicht. |
| Realm-Verschieben | Nur mit Owner-/manage-Recht an der Quelle und add-Recht am Ziel. Objekte anderer Autoren im Trip, die in einen Realm verschoben werden sollen, gehen nur, wenn man selbst manage hat (Skipper/Owner). |
| Vendor Lock-in | Hosted-Version Closed Source; Datenexport per `npx dexie-cloud export` (ZIP) möglich. Zusätzlich bleibt unser eigener ZIP-Export. |
| Bundle | Addon bringt `rxjs`, `yjs` u. a. mit (Größe unbekannt) [unverifiziert]; per `vite build`-Analyse prüfen; PWA-Precache-Größe beachten. |
| Safari/iOS | Periodic/Background Sync nicht verfügbar; OTP-Login funktioniert. [Quelle: db.cloud.configure()-Seite]. Ziel: Android. |
| Tests | Unit-Tests (Vitest + `fake-indexeddb`) laden das Addon nicht; es gibt in der Doku keine Anleitung für fake-indexeddb [unverifiziert]. Repo-Schicht mit Fabrik `createDb(name, { cloud?: boolean })` bauen. |

## 9. Konkreter Integrationsplan für diese App

### 9.1 Schemaänderungen (`src/db/db.ts`, `src/domain/types.ts`)

1. Abhängigkeit `dexie-cloud-addon@4.4.15` pinnen. Neue Env-Variable `VITE_DEXIE_CLOUD_URL` (nicht im Repo; Wert aus `dexie-cloud.json`). Ist sie leer ⇒ `configure()` wird nicht aufgerufen ⇒ reiner lokaler Modus wie bisher (Build und Tests unverändert).
2. DB-Klasse:
```ts
super(name, { addons: cloud ? [dexieCloud] : [] })
this.version(2).stores({
  trips: 'id',
  entries: 'id, tripId, [tripId+time]',
  photos: 'id, tripId, hash',
  dayReports: '[tripId+date+authorId], tripId',
  tracks: 'id, tripId',
  settings: 'key',
  userSettings: 'id',                       // '#author:<tripId>', '#theme' (privat, geräteübergreifend)
  // nur im Cloud-Build (Typen/Indizes; Addon ergänzt sie sonst selbst):
  realms: '@realmId', members: '@id,[email+realmId],realmId', roles: '[realmId+name]',
})
this.cloud.configure({ databaseUrl, requireAuth: false, unsyncedTables: ['settings'],
  customLoginGui: true, socialAuth: false, nameSuffix: false })
```
   Ob `this.version(1)` in `version(2)` übergeht oder wir bei unveröffentlichtem Stand einfach `version(1)` neu definieren dürfen (keine Altdaten, DB `logbook-v3` evtl. nur auf Entwicklungsgeräten), entscheidet der Datenstand [unverifiziert].
3. Typen: `realmId?: string; owner?: string` auf `Trip`, `LogEntry`, `Photo`, `DayReport`, `Track`; `CrewMember.email?: string` (verknüpft Einladung und "Ich bin …"); `Trip.realmId` = Realm des Boots (`getTiedRealmId(trip.id)`), sobald geteilt.
4. Entscheidungen, die vor dem ersten produktiven Sync fallen müssen: (a) `Trip.crew` als Array behalten oder Tabelle `crew`; (b) `Track.points` in Chunks; (c) `authorId = ''` durch Platzhalter ersetzen oder Surrogat-`id` für `dayReports`; (d) `photoIds`-Änderungen über `add()/remove()`.
5. Repo-Schicht: Jede Schreibfunktion, die `put/bulkPut` nutzt, setzt `realmId` (Trip-Realm) mit; neue Kinder-Objekte erben `realmId` vom Trip. `getSettings` bleibt rein lesend; `deviceId` entsteht beim ersten Schreiben (wegen Logout-Wipe).
6. `writableTripIds`: im Cloud-Modus abgeleitet aus `usePermissions`/`db.cloud.permissions` (Trip hat `realmId` ⇒ `can.add('entries')`), sonst `writableTripIds` (lokal, Stufe 1). `ReadOnlyTripError` bleibt die zentrale Sperre; die Cloud-Rechte sind die echte Durchsetzung.

### 9.2 Realm- und Rollenmodell

- **Ein Realm pro Boot-Logbuch:** `realmId = getTiedRealmId(trip.id)` (`rlm~<tripId>`); `name = trip.boat.name`, `represents = 'ein Bordbuch'`. Trip und alle Kinder tragen diesen `realmId`.
- **Flottille** = Menge von Trip-Realms mit gleicher `trip.flotilla.id`. Kein eigener Flottillen-Realm: Jedes Boot lädt die Skipper/Crew der anderen Boote als **`readonly`**-Mitglieder in seinen Realm ein (gegenseitig). Dadurch sieht jedes Boot Routen der anderen (bestehende Kartenfunktion "Flottille anzeigen" unverändert).
- **Rollen** (global, `roles.json`, siehe 3.4): `skipper` (manage `*`), `crew` (add + update ohne manage), `readonly` (leer). Der Ersteller des Realms ist Owner; zusätzlich Mitglied `skipper`.
- Ownership: Crew sieht und bearbeitet auch Einträge anderer über `update: '*'`; das Anzeigen nach Autor bleibt über `authorId`.
- Kein Hartes Löschen für Crew: Löschen = `deletedAt`. Hartes Löschen nur Skipper/Owner.
- Private Daten pro Nutzer: `userSettings` mit `#`-IDs (nicht teilen).

### 9.3 Einladungsablauf in UI-Schritten

Annahme: Alle Geräte haben die App; Skipper A hat bereits ein lokales Logbuch.
1. Törn-Tab, Abschnitt "Cloud": Button "Mit Cloud-Konto anmelden". Eigenes Login-Sheet (`customLoginGui`): E-Mail eingeben, OTP-Mail abwarten, Code eingeben. Danach `await db.cloud.sync({ purpose: 'pull' })`. Anzeige: Konto, Status-Icon (`syncState`).
2. Skipper A: "Logbuch teilen (Cloud)". App führt aus: Realm anlegen (`upsert`), Trip + Kinder per `where({ tripId }).modify({ realmId })` verschieben, Trip-Member `skipper` für sich selbst prüfen (Spike 3.1). Rückmeldung: "Logbuch ist synchronisiert".
3. Skipper A: "Crew einladen": Name, E-Mail, Rolle (Crew / Skipper), optional "E-Mail senden" (`invite: true`) oder nur anlegen (`invite: false`); Verknüpfung mit `CrewMember` (E-Mail speichern). Wenn Crewmitglied noch nicht in der Crew-Liste steht, wird es angelegt.
4. Crewmitglied C (anderes Handy): App öffnen, "Mit Cloud-Konto anmelden" mit **derselben E-Mail-Adresse**; im Törn-Tab erscheint "Einladung: Bordbuch ‹Boot› – von ‹Skipper A›" mit "Annehmen"/"Ablehnen" (`db.cloud.invites`, `accept()`). Nach Annahme lädt der Sync Trip, Einträge, Fotos (Fortschritt `blobProgress`). Danach "Ich bin …" vorbelegt (Crewmitglied mit passender E-Mail) und Banner "Du schreibst mit".
5. Flottille: Skipper A wählt "Flottille: anderes Boot einladen" und gibt die E-Mail des Skippers B ein, Rolle "Nur lesen". Skipper B tut dasselbe für A. Nach Annahme erscheinen beide Trips in der Boot-Liste; fremde Trips mit Badge "nur lesen" (aus `usePermissions`: `!can.add('entries')`).
6. Wechselfall: Crew-Rolle entziehen = `members.update(id, { roles: ['readonly'] })`; Entfernen = `members.delete(id)`; Austreten = eigenes Member löschen.
7. Abmelden: Warndialog (lokale Daten werden entfernt), ZIP-Export-Angebot, dann `db.cloud.logout()`.
8. Stufe-1-Fallback bleibt: "Logbuch teilen (Datei)" und Import mit `mergeBundle`.

### 9.4 Testkonzept

- **Unit (Vitest + fake-indexeddb, ohne Addon):** Repo-Regeln (`realmId` wird mitgeführt, `update()` statt `put()`, `mergeBundle` überschreibt `realmId` nie). Fabrik `createDb(name, { cloud: false })`; bestehende Tests unverändert.
- **Komponententests:** Login-Sheet gegen gemocktes `userInteraction`; Einladungsliste gegen gemocktes `db.cloud.invites`; Status-Anzeige gegen gemocktes `syncState`. Keine Netzzugriffe.
- **Cloud-Integrationstests (Playwright, eigene Test-DB):**
  1. Einmalig: `npx dexie-cloud create` (separate Test-DB), `whitelist http://localhost:4173`, `import demoUsers.json` (z. B. `skipper-a@demo.local`, `crew-a@demo.local`, `skipper-b@demo.local`), `import roles.json`.
  2. Zwei Browser-Contexts (Boot A: Skipper, Crew; Boot B: Skipper). Login per `db.cloud.login({ grant_type: 'demo', email })`.
  3. Szenarien: Skipper erstellt Trip, teilt, lädt Crew ein, Crew nimmt an, schreibt Eintrag, Skipper sieht ihn; Skipper B (readonly) sieht Trip A, `can.add('entries')` ist false, Schreiben schlägt fehl; Offline-Eintrag (Context offline) wird nach Reconnect synchronisiert; Foto-Blob-Roundtrip (`blobProgress`); Soft-Delete durch Crew; Rollen-Entzug; Logout-Wipe + Wiederanmeldung stellt Daten wieder her.
  4. Alternativ B (echte Nutzer ohne OTP): `fetchTokens` über `page.exposeFunction`, Secret nur im CI (Node), nie im Bundle.
  5. Aufräumen nach dem Lauf: `npx dexie-cloud clear-realm <realmId> --yes` je Test-Realm oder je Lauf frische DB.
  - Im CI: Secrets `DEXIE_CLOUD_URL`, `dexie-cloud.key` als Secret-Datei; Cloud-Tests als separater Job (nicht bei jedem PR).
- **Manuell vor Törn (Spike):** 2 echte Android-Geräte, schlechtes Netz: Foto-Upload mit Abbruch, Flugmodus-Eintrag, Zeitdrift, gleichzeitiges Editieren desselben Tagesbericht-Abschnitts.

### 9.5 Spike-Fragen (vor Umsetzung klären)

1. Wird der Realm-Owner automatisch Member (3.1)?
2. Verhalten bei gleichen Primärschlüsseln lokal (privat) vs. Boots-Realm (3.6).
3. Leerer String in Compound-Key (2.1).
4. Läuft Blob-Offloading ohne `canary`-Tag auf dem gehosteten Server (1.2)?
5. Verhalten von Offline-`update` auf serverseitig gelöschtes Objekt (6.1).
6. Wie wird ein per `client_credentials` impersonierter Nutzer lizenziert (4.5)?
7. SW-Variante: `injectManifest` mit `registerType: 'prompt'` und Dexie-Cloud-Modul (1.5).
8. `getSettings`/`deviceId` nach Logout (2.4).

### 9.6 Reihenfolge der Umsetzung (Vorschlag)

1. Phase 0 (ein Tag): Test-DB anlegen, Spike mit zwei Browsern (Fragen 1-3, 5).
2. Phase 1: Schema `version(2)`, `realmId` in Repos, `usePermissions`-basierte Schreibsperre, Login-Sheet, Status-Icon, Invites-Sheet; ohne Service Worker.
3. Phase 2: Realm-Teilen, Einladungsflow, Flottillen-Einladung, E2E-Tests.
4. Phase 3 (optional): SW-Hintergrundsync via `injectManifest`; Crew-Tabelle; Track-Chunks; Pro-Plan buchen vor dem Törn.

### 9.7 Spike-Ergebnisse (2026-10-11, echte DB `z8c8mdzxf`, dexie-cloud-addon 4.4.15, Demo-Nutzer)

Durchgeführt mit 2–4 Browser-Kontexten (Playwright gegen `vite dev`, Demo-Login `grant_type: 'demo'`), Skripte nicht im Repo; reproduzierbarer Teil steht in `e2e/cloud.spec.ts`.

| Frage (9.5) | Ergebnis |
|---|---|
| 1. Wird der Realm-Owner automatisch Member? | **Ja.** Der Server legt beim ersten Sync des Realms `mmb-owner-<realmId>` an (`userId` = Owner, `accepted` gesetzt, **ohne** `roles`, ohne E-Mail). Rechte kommen über `realm.owner` (`manage: *`). Die App legt daher keinen eigenen Skipper-Eintrag an (wäre ein Duplikat); `listMembers` zeigt den Owner als „Skipper“. Ein zweites Gerät des Owners bekommt den Realm ohne weiteres Zutun. |
| 2. Gleiche Primärschlüssel privat vs. Boots-Realm | **Primärschlüssel sind serverweit eindeutig je Tabelle.** Lädt ein Nutzer eine per Datei importierte Kopie eines bereits geteilten Logbuchs (gleiche IDs) in seinen privaten Realm hoch, lehnt der Server ab (`duplicate key value violates unique constraint "objects_pkey"`) und rollt lokal zurück: **die importierte Kopie verschwindet vom Gerät**. Das Original im Boots-Realm bleibt unberührt. Konsequenz: Datei-Import nur für Logbücher, die nicht in der Cloud sind; wer per Datei importiert hat, sollte sich vor dem Beitritt einladen lassen statt zu importieren. |
| 3. Leerer String im Compound-Key | Entfällt: `dayReports` hat jetzt eine String-`id` (`dayReportId(tripId, date, authorId)`, ohne leere Teile). |
| 4. Blob-Offloading auf dem gehosteten Server | **Funktioniert** mit 4.4.15 ohne `canary`: Foto-Blob (PNG) kommt auf zweitem Gerät/anderem Nutzer als `Blob` mit korrekter Größe und MIME an (eager). |
| 5. Offline-`update` auf serverseitig gelöschtes Objekt | **Löschen gewinnt.** Bob ändert offline einen Eintrag, Alice (Owner) löscht ihn hart; nach Reconnect ist er auf beiden Geräten weg, Bobs Änderung verworfen. Unser Soft-Delete (`deletedAt`) bleibt der Normalfall; hartes Löschen nur „Logbuch für alle löschen“. |
| 6. Lizenz `client_credentials`-Nutzer | Nicht geprüft (nicht benötigt): E2E nutzt Demo-Nutzer (`e2e/demoUsers.json`, Lizenz `demo`, keine Seats). |
| 7. SW `injectManifest` | Nicht geprüft; Phase 1 läuft ohne Service Worker (`tryUseServiceWorker: false`). |
| 8. `deviceId` nach Logout | Logout leert alle Tabellen inkl. `settings`; `getDeviceId` stellt die ID aus localStorage wieder her (im Browser geprüft: gleiche ID, 0 Trips nach Logout). |

Weitere Befunde (wichtig für die Umsetzung):

- **Array-Operation + andere Tabelle in einer Transaktion verliert Daten.** `db.photos.add(...)` und `db.entries.update(id, { photoIds: add([...]) })` in **derselben** Transaktion: das Foto ist nach dem Sync lokal und auf dem Server weg (keine Ablehnung, kein Fehler). Mit ganzem Array (`photoIds: [...]`) oder in **getrennten** Transaktionen bleibt es erhalten. Umsetzung: Foto-Zeilen und `photoIds`-Änderungen laufen in zwei Transaktionen (Repo-Kommentar in `addPhotosToEntry`). Ursache serverseitig vermutet [unverifiziert].
- **Login während des Addon-Starts schließt die DB.** `db.cloud.login()` direkt nach dem Laden (DB noch in `on.ready`) führt zu „Need to reopen db“ und einer dauerhaft geschlossenen Verbindung (`DatabaseClosedError`). `login()` wartet jetzt zuerst auf `db.open()`.
- **Rechte nur mit angenommener Einladung.** Der Server wertet Rollen erst nach `accepted`; die lokale Prüfung (`domain/access.ts`) zählt daher – strenger als das Addon – nur angenommene Mitgliedschaften. Nach „Annehmen“ lädt die App die Annahme hoch (push + pull), bevor das Logbuch aktiviert wird.
- **Seltene Ablehnung direkt nach dem Beitritt [offen].** In etwa 1 von 20 E2E-Läufen lehnte der Server die ersten Schreibvorgänge eines frisch beigetretenen Crew-Mitglieds mit `PermissionsDeniedError … not authorized to add entries` ab, obwohl die Annahme bereits hochgeladen war; abgelehnte Änderungen werden lokal **zurückgerollt** (Eintrag verschwindet). In 36 gezielten Schreibversuchen (0,4–8 s nach Annahme) trat es nicht auf. Ursache unklar (Server-Cache?). Bis zur Klärung: nach dem Beitritt kurz warten bzw. prüfen, ob der erste Eintrag beim Skipper ankommt; bei Dexie nachfragen.
- Abgelehnte Änderungen erscheinen **nicht** in `syncState` (bleibt `connected/in-sync`); sichtbar nur in der Sync-Antwort (`rejections`). Die Cloud-E2E loggt sie („Sync-Ablehnung“).
- Readonly-Mitglied: Schreibversuch am Repo vorbei (`db.entries.add` direkt) wird vom Server abgelehnt und lokal zurückgerollt; das Repo blockiert vorher schon (`ReadOnlyTripError`).
- Einladung per `invite: false` an `@demo.local`: erscheint beim Demo-Nutzer in `db.cloud.invites`; Annehmen per `accept()` funktioniert.

## 10. Quellenverzeichnis

- Doku (abgerufen 2026-10-11): `https://dexie.org/docs/cloud/` Unterseiten `dexie-cloud-addon`, `db.cloud.configure()`, `DexieCloudOptions`, `best-practices`, `consistency`, `access-control`, `Realm`, `Role`, `Member`, `DBPermissionSet`, `db.members`, `db.realms`, `db.roles`, `db.cloud.permissions()`, `db.cloud.invites`, `db.cloud.login()`, `db.cloud.logout()`, `db.cloud.currentUser`, `db.cloud.syncState`, `SyncState`, `db.cloud.webSocketStatus`, `db.cloud.sync()`, `authentication`, `add-demo-users`, `cli`, `limits`, `rest-api`, `blob-offloading`, `gdpr-compliance`, `custom-emails`, `quickstart`; Preise: `https://dexie.org/cloud/pricing`.
- GitHub `dexie/Dexie.js` (Master 2026-09-28): `addons/dexie-cloud/src/*` (`DexieCloudOptions.ts`, `DexieCloudAPI.ts`, `verifySchema.ts`, `overrideParseStoresSpec.ts`, `getTiedRealmId.ts`, `permissions.ts`, `PermissionChecker.ts`, `Invite.ts`, `getInvitesObservable.ts`, `service-worker.ts`, `authentication/logout.ts`, `authentication/authenticate.ts`, `sync/modifyLocalObjectsWithNewUserId.ts`, `sync/sync.ts`, `middlewares/createImplicitPropSetterMiddleware.ts`), `libs/dexie-react-hooks/src/usePermissions.ts`, `samples/dexie-cloud-todo-app/*` (`sw.ts`, `vite.config.ts`, `db/TodoDB.ts`, `db/TodoList.ts`, `data/roles.json`, `data/demoUsers.json`, `configure-app.sh`), Issues #2019, #1860, #1925.
- npm: `dexie-cloud-addon` (Versionen, Tags, Peer-Dependencies, Tarballs 4.4.6 und 4.4.15), `dexie` (Tags).
