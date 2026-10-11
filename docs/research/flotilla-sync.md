# Flottillen-Sync: 2 Boote x 3 Handys, ein Logbuch pro Boot

Stand: 2026-10-11. Recherche, kein Code geändert. Jede Aussage ist mit [Quelle: URL] oder [unverifiziert] markiert. Seiten wurden per Abruf zusammengefasst; Preise vor Entscheidung auf der Live-Seite gegenprüfen.

## 1. Szenario und Randbedingungen

- Offline-first PWA (React, Dexie 4, statisch auf GitHub Pages, kein Backend). Datenmodell mit UUID-IDs, `createdAt`/`updatedAt`, Fotos als Blobs (ca. 300-800 KB), Foto-Hash (SHA-256 des Originals), Export-ZIP [Quelle: docs/architecture.md].
- 6 Personen, 2 Boote, je 3 Android-Handys schreiben in EIN Boots-Logbuch. Das andere Boot darf nur lesen, Schutz nur rudimentär. 1-2 Wochen, privat, billig, kaum Betrieb.
- Fotomenge (Annahme): ca. 50-150 Fotos pro Boot und Törn, also etwa 25-120 MB je Boot und bis ca. 250 MB gesamt [unverifiziert, eigene Schätzung].

## 2. Vergleich der Optionen

### 2.1 Dexie Cloud
- Passt zu Dexie: Ja, es ist ein Addon (`dexie-cloud-addon`) für genau diese DB. Lokale Operationen laufen offline, Sync erfolgt später [Quelle: https://dexie.org/cloud/docs/consistency].
- Konflikte: Verschiedene Properties desselben Objekts mergen, bei derselben Property gewinnt die zuletzt ausgeführte Operation (faktisch Last-Writer-Wins pro Property, Zeit mit Clock-Offset-Korrektur). `put()` ersetzt das ganze Objekt und überschreibt fremde Änderungen, daher `update()` verwenden. Globale UUIDs vermeiden Kollisionen [Quelle: https://dexie.org/cloud/docs/consistency]. Tombstones werden dort nicht beschrieben [unverifiziert].
- Berechtigungen: Realms (Partitionen über `realmId`), Members mit Permissions (add/update/manage) oder globalen Roles (per `npx dexie-cloud import`). Mitglied ohne Permissions = nur lesen. Einladung per E-Mail mit Annahme. Es gibt private Realms und einen `rlm-public` [Quelle: https://dexie.org/docs/cloud/access-control]. Mapping hier: ein Realm pro Boot; eigene Crew = Schreib-Rolle, andere Crew = Mitglied ohne Rechte (lesen). Genau das Szenario.
- Blobs: Blob/File werden beim Sync automatisch in Server-Blob-Storage ausgelagert (BlobRef), lazy oder eager nachladen, `db.cloud.blobProgress`. ABER: Status "canary" (`dexie-cloud-addon@canary`, Addon >= 4.4.0, Server >= 3.0.0), keine fortsetzbaren Uploads ("very large uploads may fail on unreliable connections") [Quelle: https://dexie.org/cloud/docs/blob-offloading]. Bei 300-800 KB-Fotos und schwachem Netz vertretbar, aber Risiko durch Canary.
- Kosten: Free = 3 Production-Seats, 100 MB Storage, 1.000 Blob-Writes/Monat. Pro = 3 EUR/Monat pro 25 Seats (0,12 EUR/User), enthält je 25 Seats 1 GB Objekt- und 20 GB Blob-Storage, 50.000 Blob-Writes, 14 Tage Trial ohne Karte. Extra: 0,05 EUR/GB Blob [Quelle: https://dexie.org/pricing, https://dexie.org/cloud/pricing]. Die Seite widerspricht sich teils ("3 Seats" vs. "unlimited production users"). 6 Nutzer > 3 Free-Seats, also Pro (ca. 3 EUR/Monat, nur einen Monat nötig) oder Trial/Evaluation-User (50.000 "evaluation users", max. 30 aktive Tage, laut Preisseite) [Quelle: https://dexie.org/cloud/pricing]. Der Evaluation-Modus passt formal fast exakt auf 1-2 Wochen, ist aber ein Randfall [unverifiziert, ob zulässig für echte Nutzung].
- Self-Hosting: On-Prem als Docker-Image, einmalig 3.495 EUR (Business) bzw. 7.995 EUR (Enterprise) [Quelle: https://dexie.org/cloud/pricing]. Für 6 Personen unverhältnismäßig.
- Datenschutz/EU: Die Preisseite nennt weder Region noch EU-Residenz, Firma sitzt in Schweden [Quelle: https://dexie.org/pricing]. Region/AVV vor Nutzung beim Anbieter klären [unverifiziert].
- Integrationsaufwand: Gering. Addon einbinden, Schema um `realmId`/`owner` ergänzen, Auth (E-Mail-OTP), Rollen-JSON, Invite-UI, Blob-Konfiguration. Bestehende Dexie-Repos bleiben weitgehend erhalten. Beachten: Dexie Cloud verlangt prefix-lose ID-Strategie (`@id` oder UUID-Strings) und `update()` statt `put()`; Migration bestehender Daten in einen Realm erfordert Aufwand [unverifiziert].

### 2.2 Firebase Firestore
- Offline im Web: `persistentLocalCache()` (IndexedDB), standardmäßig AUS, Multi-Tab mit `persistentMultipleTabManager()`, nur Chrome/Safari/Firefox [Quelle: https://firebase.google.com/docs/firestore/manage-data/enable-offline]. Passt aber nur als zweite Datenhaltung neben Dexie, das heißt Datenmodell-Doppelung oder Komplettumbau auf Firestore.
- Konflikte: Last-Write-Wins pro Dokument [Quelle: ebenda]. Gut genug bei Append-artigen Logeinträgen.
- Berechtigungen: Security Rules (pro Boot schreiben, alle lesen: einfach formulierbar) [unverifiziert, aus Produktwissen].
- Fotos: Cloud Storage for Firebase nicht auf Spark, erst auf Blaze (Pay-as-you-go, Zahlungsmittel nötig). Gratis-Kontingent (5 GB, 100 GB Download/Monat) nur für Buckets in us-central1/us-west1/us-east1, EU-Buckets nicht kostenlos [Quelle: https://firebase.google.com/pricing]. Kosten für ~250 MB in EU wären Cent-Beträge [unverifiziert]. Alternative: Fotos komprimiert (< ~700 KB) als Base64 im Firestore ist durch 1 MiB Dokumentlimit knapp machbar [unverifiziert].
- Kosten Firestore Spark: 1 GiB, 20K Writes/Tag, 50K Reads/Tag, 10 GiB Egress/Monat [Quelle: https://firebase.google.com/pricing]; für diesen Nutzerkreis ausreichend.
- Self-Hosting: Nein (Emulator nur für Entwicklung). Datenschutz: Google; EU-Region für Firestore wählbar [unverifiziert].
- Integrationsaufwand: Hoch (Repository-Schicht neu oder Dual-Write, Auth, Rules).

### 2.3 Supabase (+ Offline-Layer)
- Supabase selbst hat keinen Offline-Support im Web; Postgres + Realtime + RLS + Storage. Offline braucht eine Zusatzschicht (PowerSync, ElectricSQL, RxDB) [unverifiziert, aus Produktwissen; PowerSync-Web-SDK ist belegt: https://www.powersync.com/pricing].
- Kosten: Free = 500 MB DB, 1 GB Storage, 50.000 MAU, 5 GB Egress; Projekte pausieren nach 1 Woche Inaktivität; Pro ab 25 USD/Monat [Quelle: https://supabase.com/pricing]. Frankfurt (eu-central-1) verfügbar [Quelle: https://supabase.com/docs/guides/platform/regions].
- PowerSync Free: 2 GB Sync/Monat, 500 MB gehostet, 50 Clients; Projekte nach 1 (Seite widersprüchlich: 1 oder 2) Woche Inaktivität deaktiviert; Open Edition self-hostbar (source-available) [Quelle: https://www.powersync.com/pricing]. PowerSync nutzt SQLite (WASM) im Browser, also Ersatz von Dexie [unverifiziert].
- Blobs: Supabase Storage separat, Upload-Queue muss selbst gebaut werden [unverifiziert].
- Konflikte: App-definiert (Upload-Queue über Backend-Connector). Berechtigungen: RLS gut für Boot-Rollen.
- Aufwand: Hoch (neues Backend, SQL-Schema, Sync-Rules, Umbau von Dexie), Free-Projekt-Pause ist für Testwochen ein Risiko.

### 2.4 PocketBase
- Eingebettetes SQLite, Realtime-Subscriptions, Auth, Dateiverwaltung, API-Rules, Single-Binary (ca. 11-12 MB) für Self-Hosting. Aktuell v0.40.5, pre-1.0: "NOT recommended for production critical applications yet", keine Rückwärtskompatibilität garantiert [Quelle: https://pocketbase.io/docs/].
- Kein eingebauter Offline-Sync: Man müsste eine Outbox in Dexie selbst bauen (Push neuer/geänderter Einträge, Pull seit `updatedAt`), Fotos per Multipart-Upload [unverifiziert].
- Self-Host braucht VPS (ca. 3-5 EUR/Monat, [unverifiziert]) mit HTTPS (PWA verlangt Secure Context, Mixed Content blockiert HTTP von GitHub Pages). Hosting in EU frei wählbar.
- Aufwand: Mittel bis hoch (Sync-Logik selbst), Betriebsaufwand mittel (Updates, Backup, TLS).

### 2.5 CouchDB / PouchDB
- Klassische Multi-Master-Replikation, Revisionsbäume, deterministischer Konflikt-Winner (Merge manuell möglich), Attachments für Fotos. PouchDB nutzt IndexedDB, ersetzt aber Dexie [unverifiziert, Produktwissen].
- IBM Cloudant Lite: Lite-Plans laufen nicht ab/ohne Kosten, Quota monatlich, bei Überschreitung Suspendierung, Löschung inaktiver Lite-Instanzen nach 30 Tagen, Zahlungsmittel bei Registrierung nötig [Quelle: https://www.ibm.com/cloud/free/databases (Suchergebnis, nicht direkt abgerufen)]. Cloudant-Lite-Limits (1 GB, 20 Reads/s, 10 Writes/s) stammen aus einem undatierten Blog, die offizielle IBM-Seite nannte Lite nicht [unverifiziert]. Verfügbarkeit 2026 daher unsicher.
- Self-Host: CouchDB auf VPS oder Docker, einfach, aber CORS/TLS/Auth selbst. Berechtigungen: pro DB (z. B. eine DB je Boot, Leser-Rolle für das andere Boot); Dokument-Level nur über Validate-Funktionen [unverifiziert].
- Aufwand: Hoch, weil Dexie-Repositories durch PouchDB ersetzt werden müssten.

### 2.6 CRDT-Ansätze (Yjs / Automerge / Jazz)
- Yjs: netzwerk-agnostisch, Provider y-websocket, y-webrtc, Persistenz y-indexeddb [Quelle: https://yjs.dev]. Eigenes Datenmodell (Y.Map/Y.Array), also kein Dexie-Ersatz 1:1. Fotos sind nicht für große Binärdaten gedacht [unverifiziert]. Sync-Server (y-websocket) selbst betreiben.
- Automerge: Sync über automerge-repo, WebSocket-Server möglich, zentraler Server funktioniert [Quelle: https://automerge.org/docs/hello/]. Binärdaten/Storage-Adapter nicht belegt.
- Jazz (Jazz Cloud): relationale DB mit Local-First-Sync, Blobs als Spalten mit CDN, Permissions per Row-Policies aus JWT-Claims, Server Open Source und self-hostbar. Preis: 0,039 USD/h für 2 GB-Instanz, 0,45 USD/GB/Monat, 0,09 USD/GB Egress; im Basis-Kontingent 1 GB RAM-Instanz, 1 GB Storage, 5 GB Egress; Version 2, kein formaler Reifegrad genannt [Quelle: https://jazz.tools]. Die Pricing-Unterseite lieferte 404.
- Bewertung: Technisch elegant, aber Umbau des Datenmodells und junge Ökosysteme; für eine reife Dexie-App unverhältnismäßig.

### 2.7 Serverlos
- **Datei-Austausch (ZIP/JSON-Delta via Teilen):** `navigator.share()` kann Dateien teilen, braucht HTTPS und User-Aktivierung; `canShare({files})` prüfen [Quelle: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API]. Empfangen: Web Share Target per Manifest (Chromium/Android) [Quelle: ebenda, im Beispiel; Support unverifiziert]. Alternativ Dateiauswahl-Import. Das passt zum bestehenden Export/Import (IDs bleiben) und braucht null Betrieb. Nachteil: manuelle Handarbeit pro Sync, 3 Handys pro Boot müssen sich gegenseitig synchronisieren (Hub-Prinzip: ein "Skipper-Handy" konsolidiert), Konflikt-Risiko ohne Merge-Logik.
- **Web Bluetooth:** Nur GATT-Client, nicht Peripheral, nicht Baseline (Chromium-only) [Quelle: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API; Peripheral-Einschränkung dort nicht belegt, aus Produktwissen]. Für Handy-zu-Handy-Sync ungeeignet.
- **WebRTC P2P:** Browser-seitig möglich (DataChannel), benötigt aber Signaling. Ohne Server geht es per manuellem SDP-Austausch (QR-Code/Text) für lokale Verbindungen im selben WLAN oder Hotspot [unverifiziert]. Realistisch nur im Hafen, fragiler Aufwand (STUN/NAT, Hotspot-Isolation). Nicht empfehlenswert als Hauptweg; als Spielerei denkbar.

## 3. Vergleichstabelle

| Kriterium | Dexie Cloud | Firestore | Supabase + PowerSync | PocketBase | CouchDB/PouchDB | Yjs/Automerge/Jazz | Datei-Austausch |
|---|---|---|---|---|---|---|---|
| Passt zu Dexie/IDB | Sehr gut (Addon) | Zweite Datenhaltung | Ersetzt Dexie (SQLite) | Eigene Outbox auf Dexie | Ersetzt Dexie | Datenmodell-Umbau | Ja, vorhanden |
| Konflikte | LWW pro Property | LWW pro Dokument | App-definiert | App-definiert | Revisionen, Winner | CRDT-Merge | Eigene Merge-Logik |
| Rechte pro Boot | Realms + Roles, nativ | Security Rules | RLS | API Rules | DB pro Boot | Jazz: Policies, sonst DIY | Keine |
| Fotos | Blob-Offloading (canary) | Storage nur Blaze | Storage + eigene Queue | Files + eigene Queue | Attachments | Jazz ja, Yjs/Automerge schwach | Im ZIP |
| Kosten (6 User) | ca. 3 EUR/Monat | 0 (Spark) / Cent (Blaze) | 0 (Free) bis 25 USD | VPS ca. 3-5 EUR | 0 / VPS | Jazz nutzungsbasiert | 0 |
| Self-Hosting | Nur On-Prem ab 3.495 EUR | Nein | PowerSync Open Edition | Ja, trivial | Ja | Ja (Jazz, y-websocket) | n/a |
| EU/Datenschutz | Region unklar | EU-Region wählbar, Google | Frankfurt | Frei wählbar | Frei wählbar | Frei wählbar | Keine Cloud |
| Integrationsaufwand | Niedrig | Hoch | Hoch | Mittel-hoch | Hoch | Hoch | Niedrig |
| Betrieb | Keiner | Keiner | Gering (Pause-Risiko) | Mittel | Mittel | Mittel | Manuell |

## 4. Was das Datenmodell für Merge braucht

Gilt für jede Variante außer reinem Dexie Cloud (dort teils eingebaut), und für den Datei-Austausch zwingend:
1. **Eigentümer-/Boot-Feld:** `boatId` auf Trip/Entry/Photo/DayReport/Track, plus `authorId` (Crew-Mitglied) pro Eintrag. Dient Filterung, Schreibschutz-UI und Rechtemapping (Realm = Boot).
2. **Tombstones:** Löschen als `deletedAt` (Soft Delete) statt physisch löschen, sonst taucht Gelöschtes beim Merge wieder auf. Periodisches Aufräumen erst nach Törnende. Gilt auch für `photoIds`-Entfernung.
3. **Änderungszeit:** `updatedAt` ist wegen Handy-Uhrabweichungen riskant. Besser Hybrid Logical Clock (HLC: Zeit + Zähler + Geräte-ID) oder zumindest `updatedAt` plus `deviceId` als Tie-Breaker. Merge: pro Eintrag größte HLC gewinnt; Feld-Level-Merge nur wenn nötig (Einträge meist append-only, selten parallel editiert).
4. **Aggregat-Dokumente:** `DayReport` (Schlüssel tripId+date, ein Text pro Tag) ist der Konfliktherd, wenn 3 Personen am selben Tag schreiben. Optionen: ID = UUID je Autor und Tag, oder nur einer ("Tagesschreiber") bearbeitet. `Settings.activeTripId` bleibt lokal und wird nicht gesynct.
5. **Foto-Dedup:** `Photo.hash` (SHA-256 des Originals) existiert schon. Beim Merge Foto per Hash zusammenführen, ID-Mapping in Einträgen/Berichten umschreiben. Hash zusätzlich als Sync-Schlüssel nutzen, damit Fotos nur einmal hochgeladen werden. Dedup-Regel pro Kalendertag aus architecture.md beachten, sie kann zwischen Geräten verletzt werden.
6. **Track/Positionen:** Live-Tracks pro Gerät (`deviceId`) getrennt halten, nicht mergen.
7. **Exportformat:** Version erhöhen (v2) um `boatId`, `deletedAt`, `hlc`/`deviceId`; Import als Merge (nicht Ersetzen), da v1-Import den Törn ersetzt [Quelle: docs/architecture.md].

## 5. Empfehlung

**Primär: Dexie Cloud (Pro, ein Monat, ca. 3 EUR).** Einziger Weg, der Dexie behält, Offline-First, Realms/Roles (Boot A schreibt, Boot B liest) und Foto-Sync nativ liefert und ohne eigenen Server auskommt. Aufwand: wenige Tage. Vorbehalte, vor Zusage prüfen:
- Blob-Offloading ist "canary", Uploads nicht fortsetzbar. Mit Fotos <= 800 KB und Wiederholung beim nächsten Sync akzeptabel; Fallback eingeplant.
- Datenregion/Auftragsverarbeitung nicht aus der Preisseite ersichtlich: beim Anbieter erfragen.
- Free reicht nicht (3 Seats, 100 MB) für 6 Personen.
- `boatId`, Tombstones und `update()` statt `put()` trotzdem einbauen; DayReport-Konflikt lösen.
- Die Bedingung "rudimentärer Schutz" lässt sich leicht über die Schreibrolle ersetzen; echte Rechte kosten nichts extra.

**Alternative A (null Kosten, null Betrieb): Datei-Austausch.** Merge-Import (v2-Format) + Teilen per Web Share/WhatsApp im Hafen, ein Handy pro Boot als Hub. Bringt die Merge-Logik aus Abschnitt 4 ohnehin mit und ist die Rückfallebene für Option 1. Gut, wenn Datenschutz oder Cloud-Konto stören.

**Alternative B (Kontrolle, EU-Hosting): PocketBase auf kleinem EU-VPS** mit eigener Outbox/Pull-Sync. Mehr Code und Betrieb, dafür volle Kontrolle; Pre-1.0-Warnung beachten.

**Nicht empfohlen:** Firestore (Dexie-Doppelung, Storage nur mit Blaze und EU nicht gratis), Supabase/PowerSync und CouchDB (Dexie-Ersatz, hoher Umbau), reine CRDTs/Jazz (Overkill), Web Bluetooth (ungeeignet), WebRTC (Signaling, fragil).

## 6. Offene Punkte
- Dexie Cloud: Datenstandort, AVV, Verhalten von Blob-Offloading auf Android-Chrome im Feld testen (Spike mit zwei Geräten).
- Seat-Zählung: Preisseite widersprüchlich; Pro-Preis bei Buchung verifizieren.
- Cloudant-Lite-Verfügbarkeit 2026 nicht bestätigt.

## Nachtrag 2026-10-11 (Nutzer)
LTE-Datenvolumen auf See ist unkritisch. Fotos werden daher sofort mit synchronisiert; die Regel "nur WLAN / auf Knopfdruck" entfällt. Konnektivität unterwegs ist also eher "meist online mit Lücken" als "meist offline" – Offline-first bleibt trotzdem nötig (Funklöcher, Ausland).
