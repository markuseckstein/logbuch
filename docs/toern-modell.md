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

## Einladen
- Admin gibt E-Mail + optional Boot-Vorschlag ein ⇒ in **einer** Transaktion: `CrewMember {name (aus E-Mail, editierbar), email, suggestedBoatId}` + Realm-Mitglied `{email, roles: ['member']}`.
- Mitgliederliste: Name, E-Mail, Status (eingeladen/angenommen/abgelehnt), Admin-Badge, Boot-Vorschlag ändern (Select), Erneut senden, Entfernen (mit Bestätigung in der UI).
- Eingeladene: Anmelden ⇒ Einladung annehmen ⇒ Törn erscheint, Boot-Schalter steht auf ihrem vorgeschlagenen Boot. Schreiben erst, wenn die Mitgliedschaft wirksam ist (siehe Fix zum Rechtefehler).

## UI (nach Prototyp D)
- **Header**: Boot-Schalter (Segmente je Boot + „Alle“), Auswahl lokal gespeichert. Bei nur einem Boot ausgeblendet.
- **Heute**: großer Button „Eintrag jetzt · ‹Boot›“ speichert mit einem Tipp für das gewählte Boot (dann Sheet zum Ergänzen). Bei „Alle“: Sheet mit Pflichtauswahl „Für welches Boot?“ (vorausgewählt `lastBoatByTrip`). Timeline/Karte/Statistik für die Auswahl; bei „Alle“ mit Boot-Badge je Eintrag.
- **Eintrag-Sheet**: Boot-Chips oben (änderbar bei eigenen Einträgen); fremde Einträge: Banner „Nur ansehen · Eintrag von X · Boot“, kein Speichern/Löschen; Admin: Banner „Admin-Bearbeitung“.
- **Tage/Tag**: folgt dem Boot-Schalter; bei „Alle“ Tabelle sm/Einträge je Boot. Tagesbericht-Abschnitte untereinander.
- **Karte**: immer alle Boote, Farbe + Symbolform je Boot, Legende mit Ein-/Ausblenden, Tagesfilter.
- **Törn-Tab**: Konto (Anmelden/Abmelden, Admin-Badge), Boote als Karten (Foto, Typ, Anzahl Einträge, vorgeschlagene Crew; Admin: bearbeiten/entfernen nur ohne Einträge), Boot anlegen, Person einladen (E-Mail + Boot-Chips „Kein Vorschlag“/Boote), Mitgliederliste, „Neuen Törn anlegen …“, Export/Import, Törn-Wechsler.
- **Onboarding**: 1 Törn (Name, Von/Bis, Revier; Hinweis „du wirst Admin“) → 2 Boote (mind. eins, mit Foto) → 3 Crew einladen (nur angemeldet; sonst Hinweis + „Später einladen“; vorgemerkte Einladungen werden nach Anmeldung gesendet). Zusätzlich auf dem Startbildschirm: „Ich wurde eingeladen – anmelden“ und „Logbuch importieren“.
- **Live-Track**: gehört zum gewählten Boot; bei „Alle“ vorher Boot wählen.

## Entfällt im Code
`domain/merge.ts`-Ownership-Teile, `setTripOwnership`, `writableTripIds`, `ReadOnlyTripError` für fremde Boote, `setFlotilla`, `listFlotillaTrips`, Flottillen-UI (Törn-Tab, Import-Dialog, Karten-Schalter), Rolle `readonly`, `e2e/flotilla.spec.ts` (ersetzt durch neues Mehrboot-E2E).
