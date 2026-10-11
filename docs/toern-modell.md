# Törn-Modell v2: ein Törn, mehrere Boote (ersetzt Flottille Stufe 1/2)

Entscheidung 2026-10-11: UI nach Prototyp **D „Boot-Schalter“** (`prototypes/d-boot-schalter/index.html`). Keine Abwärtskompatibilität (keine Altdaten): neue DB, neues Exportformat.

## Begriffe
- **Törn** = ein `Trip` = **ein Dexie-Cloud-Realm** (`getTiedRealmId(trip.id)`). Enthält immer die Flottille: 1..n Boote.
- **Boot** = eigener Datensatz `Boat` (Tabelle `boats`) im Törn: Name, Modell, Länge, Heimathafen, Rufzeichen, MMSI, Foto, `colorIndex` (1..4, Farbe + Symbolform auf Karte/Timeline).
- **Person** = `CrewMember` (Tabelle `crewMembers`): Name, `email?`, `suggestedBoatId?` (nur Vorschlag, keine Berechtigung), `role?` (Skipper usw., Freitext/Label).
- **Admin** = wer den Törn anlegt (Realm-Owner). Admin-Funktionen (Boote anlegen/ändern/entfernen, einladen, Personen entfernen, Boot-Vorschlag ändern) erst nach Cloud-Anmeldung. Ohne Anmeldung ist der Törn rein lokal voll nutzbar (inkl. Boote anlegen lokal).

## Rechte (Dexie Cloud, `roles.json`)
- `admin`: `manage: "*"`.
- `member`: `add` auf `entries`, `photos`, `dayReports`, `tracks`, `trackChunks`; **kein** `update`. Dexie Cloud erlaubt dem Owner eines Objekts immer, es zu ändern/löschen ⇒ Mitglieder ändern nur **eigene** Einträge/Abschnitte/Tracks, fremde nur ansehen.
- Rolle `readonly`, `writableTripIds`, Ownership-Frage beim Import, `trip.flotilla`, Flottille beitreten, Schalter „Flottille anzeigen“: **entfallen**.
- **Vor dem Umbau per Spike gegen die echte DB verifizieren**: (a) Mitglied ohne `update` kann eigenes Objekt ändern/löschen (Tombstone-Update) und `photoIds` eigener Einträge ändern; (b) fremdes Objekt wird abgelehnt; (c) Admin kann alles. Falls (a) nicht gilt: `update` für Mitglieder erlauben und Eigentum nur in der UI prüfen.
- UI-Regel (`domain/access.ts`, rein): `canEditRecord(record, me)` = Admin oder `record.owner === me` (lokaler Modus: alles erlaubt).

## Datenmodell-Änderungen
- `LogEntry.boatId: ID` (Pflicht), `TrackRecord.boatId: ID` (Pflicht), Track-Chunks erben über `trackId`.
- `Trip.boat` entfällt → Tabelle `boats`. `Trip.flotilla` entfällt.
- `DayReport` bleibt pro Person (`id = dayReportId(tripId,date,authorId)`), ohne Boot. Anzeige: alle Abschnitte des Tages untereinander mit Name und Uhrzeit (`updatedAt`), eigener editierbar, Admin darf alle.
- Autor: im Cloud-Modus = `CrewMember` mit `email === currentUser.email` (vom Admin beim Einladen angelegt, keine „Ich bin“-Auswahl nötig). Lokal: „Ich bin …“ wie bisher (`authorByTrip`).
- Lokal (`settings`, nie exportiert, nie synchronisiert): `boatSelectionByTrip[tripId] = boatId | 'all'` (Boot-Schalter) und `lastBoatByTrip[tripId]` (Vorschlag im Eintrag). Erstwahl = `suggestedBoatId` der eigenen Person, sonst erstes Boot.
- Exportformat **v4**: `boats[]` statt `trip.boat`, `boatId` an Einträgen/Tracks, keine Flottille. Import = Wiederherstellen bzw. Mergen in denselben Törn (gleiche `trip.id`), keine Ownership-Frage. ZIP/GPX: ein `<trk>` je Boot, Waypoints mit Bootsname.

## Einladen (Link/QR statt Dexie-Mail)
- Admin gibt E-Mail + optional Boot-Vorschlag ein ⇒ in **einer** Transaktion: `CrewMember {name (aus E-Mail, editierbar), email, suggestedBoatId}` + Realm-Mitglied `{email, roles: ['member'], invite: false}` – Dexie verschickt keine Mail, „Erneut senden“ gibt es nicht.
- Törn-Tab (Admin, angemeldet): „QR-Code zum Beitreten“ ⇒ Sheet mit QR-Code und Link `<App-URL>?join=<tripId>`, „Link teilen“ (Web Share, Fallback Zwischenablage), Hinweis, wenn noch niemand eingetragen ist.
- Persönlicher QR-Code: in der Mitgliederliste (Admin, angemeldet) je Person mit E-Mail der Button „QR-Code“ ⇒ gleiches Sheet („QR-Code für <Name>“), Link `<App-URL>?join=<tripId>&email=<E-Mail>`; `email` wird wie `join` in sessionStorage gemerkt, aus der URL entfernt und füllt den Anmelde-Dialog vor (editierbar).
- Mitgliederliste: Name, E-Mail, Status (eingeladen / dabei; abgelehnt nur falls gesetzt), Admin-Badge, Boot-Vorschlag ändern (Select), Entfernen (mit Bestätigung in der UI).
- Eingeladene öffnen den Link ⇒ Beitreten-Bildschirm (auch statt Onboarding) ⇒ Anmelden mit der eingetragenen E-Mail ⇒ offene Einladungen werden automatisch angenommen ⇒ Törn erscheint, Boot-Schalter steht auf ihrem vorgeschlagenen Boot (nur ohne lokale Auswahl). Schreiben erst, wenn die Mitgliedschaft wirksam ist („Törn wird geladen …“).
- **Wieder-Anmelden** (Websitedaten gelöscht, neues Gerät) mit derselben E-Mail funktioniert immer – über Link/QR, „Ich bin eingeladen / wieder anmelden“ oder normales Anmelden: nach Annahme gibt es keine offene Einladung mehr, der Törn kommt per Sync. Eine bestehende Mitgliedschaft gilt als Erfolg (`domain/join.ts` `decideJoinState`): offene Einladung ⇒ annehmen; sonst gewünschter Törn (aus Link) bzw. irgendein geteilter Törn da ⇒ aktivieren; gewünschter Törn fehlt, anderer vorhanden ⇒ dorthin wechseln + Toast „Für diesen Törn bist du nicht eingetragen“. „Keine Einladung gefunden“ („Für <E-Mail> liegt keine Einladung vor. Bitte den Admin, genau diese Adresse einzutragen.“ + „Abmelden / andere E-Mail“) erst nach abgeschlossenem Sync + Wartezeit ohne Einladung und ohne Törn.

## UI (nach Prototyp D)
- **Header**: Boot-Schalter (Segmente je Boot + „Alle“), Auswahl lokal gespeichert. Bei nur einem Boot ausgeblendet.
- **Heute**: großer Button „Eintrag jetzt · ‹Boot›“ speichert mit einem Tipp für das gewählte Boot (dann Sheet zum Ergänzen). Bei „Alle“: Sheet mit Pflichtauswahl „Für welches Boot?“ (vorausgewählt `lastBoatByTrip`). Timeline/Karte/Statistik für die Auswahl; bei „Alle“ mit Boot-Badge je Eintrag.
- **Eintrag-Sheet**: Boot-Chips oben (änderbar bei eigenen Einträgen); fremde Einträge: Banner „Nur ansehen · Eintrag von X · Boot“, kein Speichern/Löschen; Admin: Banner „Admin-Bearbeitung“.
- **Tage/Tag**: folgt dem Boot-Schalter; bei „Alle“ Tabelle sm/Einträge je Boot. Tagesbericht-Abschnitte untereinander.
- **Karte**: immer alle Boote, Farbe + Symbolform je Boot, Legende mit Ein-/Ausblenden, Tagesfilter.
- **Törn-Tab**: Konto (Anmelden/Abmelden, Admin-Badge), Boote als Karten (Foto, Typ, Anzahl Einträge, vorgeschlagene Crew; Admin: bearbeiten/entfernen nur ohne Einträge), Boot anlegen, Person einladen (E-Mail + Boot-Chips „Kein Vorschlag“/Boote), Mitgliederliste, „Neuen Törn anlegen …“, Export/Import, Törn-Wechsler.
- **Onboarding**: 1 Törn (Name, Von/Bis, Revier; Hinweis „du wirst Admin“) → 2 Boote (mind. eins, mit Foto) → 3 Crew einladen (nur angemeldet; sonst Hinweis + „Später einladen“; vorgemerkte Einladungen werden nach Anmeldung gesendet). Zusätzlich auf dem Startbildschirm: „Ich bin eingeladen / wieder anmelden“ und „Logbuch importieren“.
- **Live-Track**: gehört zum gewählten Boot; bei „Alle“ vorher Boot wählen.

## Entfällt im Code
`domain/merge.ts`-Ownership-Teile, `setTripOwnership`, `writableTripIds`, `ReadOnlyTripError` für fremde Boote, `setFlotilla`, `listFlotillaTrips`, Flottillen-UI (Törn-Tab, Import-Dialog, Karten-Schalter), Rolle `readonly`, `e2e/flotilla.spec.ts` (ersetzt durch neues Mehrboot-E2E).

## Cover-Bild pro Törn (Nachtrag 2026-10-11)
Kein Splash. Referenz-Prototyp nur lokal (zeigt echte Personen, nicht ins Repo).
- `Trip.coverPhotoId?: ID` (Foto in `photos`, synchronisiert im Törn-Realm) + `Trip.coverFocus?: { x: number; y: number }` (0..100, `object-position`).
- Törn-Tab oben: Hero 16:9 mit Cover, Törnname, Zeitraum, Revier (Verlauf für Lesbarkeit). Admin (bzw. lokal jeder): „Cover ändern“ (Galerie/Kamera, Verkleinern wie andere Fotos), „Ausschnitt anpassen“ (ganzes Bild mit 16:9-Rahmen, Tipp setzt Fokuspunkt), „Entfernen“ (Bestätigung in der UI). Hinweis „Das Cover wird mit allen Mitgliedern des Törns geteilt“. Ohne Cover: Platzhalter-Karte „Cover-Bild hinzufügen“ (für Nicht-Admins nur Titel).
- Törn-Übersicht/-Wechsler: Liste der Törns mit Cover-Thumbnail (Platzhalter-Icon ohne Cover), Zeitraum, aktiver Törn markiert, „Neuen Törn anlegen …“.
- Onboarding Schritt 1: optionales Feld „Cover-Bild (optional)“ mit Vorschau/Ändern/Entfernen.
- Export: Cover und Fokus im Export v4 (`trip.coverPhotoId`, Foto in `images/`); GPX unverändert.
