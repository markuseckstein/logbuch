# Flottille – Stufe 1 (ohne Server)

Ziel: Mehrere Handys pro Boot führen dasselbe Logbuch, Boote sehen sich gegenseitig read-only. Austausch in Stufe 1 per Export-ZIP + Merge-Import (teilen via WhatsApp/Quick Share). Stufe 2 (Dexie Cloud) baut auf demselben Datenmodell auf. Recherche: `docs/research/flotilla-sync.md`.

## Begriffe
- **Logbuch eines Boots** = ein `Trip` (wie bisher: Törn + Boot + Crew). Alle Handys desselben Boots haben denselben Trip (gleiche `id`).
- **Flottille** = Gruppe von Trips verschiedener Boote: `Trip.flotilla?: { id: ID; name: string }`.
- **Gerät** = ein Handy: `deviceId` (lokal, zufällig, einmalig erzeugt).
- **Ich** = Crew-Mitglied, das auf diesem Gerät schreibt: lokal je Trip `authorByTrip[tripId] = crewMemberId`.
- **Eigenes vs. fremdes Logbuch** (lokal, nicht exportiert): `Settings.writableTripIds: ID[]`. Fremde Trips sind read-only (rudimentärer Schutz gegen Schreiben ins falsche Boot; keine echte Sicherheit).

## Datenmodell-Änderungen (Exportformat v2)
- `LogEntry`, `DayReport`, `Track`, `Trip`: `updatedAt: number` + `updatedBy: string` (deviceId) → Merge-Reihenfolge `(updatedAt, updatedBy)` lexikografisch; `deletedAt?: number` (Tombstone, Datensatz bleibt erhalten, UI blendet aus).
- `LogEntry.authorId?: ID` (Crew-Mitglied), `DayReport.authorId?: ID`.
- **Tagesbericht pro Autor**: Schlüssel `[tripId+date+authorId]` (Bericht ohne Autor: `authorId = ''`). Mehrere Crew-Mitglieder schreiben konfliktfrei je ihren Abschnitt; Anzeige: alle Abschnitte eines Tages, eigener editierbar. Tagesfoto-Limit 15 gilt pro Tag über alle Abschnitte. Dedup pro Tag wie bisher (über alle Abschnitte + Einträge).
- `Photo`: unveränderlich, kein Tombstone (Entfernen = `photoIds` des Eintrags/Berichts ändern). Verwaiste Fotos dürfen bleiben.
- Crew: `CrewMember` bekommt `updatedAt`/`deletedAt`; Trip-Merge: Trip-Felder LWW, Crew per Mitglied-ID gemerged (LWW je Mitglied).
- Schreiboperationen im Repo patchen nur geänderte Felder (`update()`), nie ganze Objekte überschreiben (Vorbereitung Dexie Cloud).

## Merge-Import
`mergeBundle(db, bundle, { ownership })`:
- Trip unbekannt → anlegen; `ownership` `'own'` → in `writableTripIds`, `'foreign'` → read-only.
- Trip bekannt → Datensätze per ID mergen: unbekannt → einfügen; bekannt → neuere Version `(updatedAt, updatedBy)` gewinnt (auch Tombstones); gleich → nichts.
- Fotos: fehlende IDs einfügen; Foto mit gleicher `hash` aber anderer ID am selben Tag → ID in `photoIds` auf vorhandenes Foto umschreiben (Dedup).
- Fehlende Foto-Blobs (Export „ohne Fotos“) → Referenz behalten, UI zeigt Platzhalter „Foto nicht übertragen“.
- Ergebnis: Zusammenfassung `{ added, updated, deleted, photosAdded }` für Toast.
- Es gibt nur Exportformat Version 2; ältere Dateien werden abgelehnt (keine Abwärtskompatibilität, es gab keine echten Altdaten).

## UI
- Törn-Tab: „Ich bin …“ (Crew-Auswahl pro Gerät/Trip, Pflicht vor dem ersten Eintrag in einem geteilten Logbuch; bei Einzelnutzung automatisch Skipper bzw. erstes Crew-Mitglied).
- Törn-Tab Abschnitt „Flottille“: Flottille gründen (Name) / Name anzeigen; Liste der Boote (Trips derselben Flottille) mit „eigenes Boot“ / „nur lesen“; Button „Logbuch teilen“ (ZIP mit oder ohne Fotos → Teilen).
- Import: fragt bei unbekanntem Trip „Mein Boot – ich schreibe mit“ / „Anderes Boot – nur lesen“; bei bekanntem Trip still mergen + Toast mit Zusammenfassung. Hat ein fremder Trip eine Flottille und der eigene aktive Trip keine → Angebot „Flottille ‚X‘ beitreten“.
- Törn-Wechsler zeigt Boot-Name + Badge „nur lesen“. In fremden Logbüchern: Banner „Logbuch der ‹Boot› – nur lesen“, kein „Eintrag jetzt“, Sheet/Tagesbericht read-only.
- Karte: Schalter „Flottille anzeigen“ → Routen der anderen Boote derselben Flottille in zweiter Farbe mit Bootsname.
- Einträge/Tagesbericht zeigen Autor (Initialen/Name).

## Umsetzungsnotizen (Daten-/Logikschicht)
- **Keine Migration**: neues Schema unter DB-Name `logbook-v3` (Version 1); die alte DB `logbook` wird nicht angefasst/gelöscht. `deviceId` entsteht beim Anlegen der DB (`populate`), `getSettings` ist rein lesend (liveQuery-tauglich).
- **API fuer die UI**: `getDeviceId`, `setAuthor/getAuthor(db, tripId)`, `setTripOwnership(db, tripId, 'own'|'foreign')`, `setFlotilla(db, tripId, {id,name}|undefined)`, `listFlotillaTrips`, `mergeBundle` -> `{tripId, tripCreated, added, updated, deleted, photosAdded}`, `deleteDayReport`, `activeCrew(trip)` (domain). `getSettings` liefert `writableTripIds`, `authorByTrip`, `deviceId`. `exportZip/exportJson(bundle, {includePhotos})`.
- **Autor-Standard**: `createEntry`/`upsertDayReport`/`addPhotosToDayReport`/`getDayReport` nehmen den Autor aus `authorByTrip` (sonst `''`); `upsertDayReport`, `getDayReport`, `addPhotosToDayReport`, `removePhotoFromDayReport` haben optionalen letzten Parameter `authorId`. `listDayReports` liefert alle Abschnitte (Datum, dann Autor).
- **Crew**: `Trip.crew` enthält Tombstones; UI nutzt `activeCrew(trip)`. `updateTrip(…, {crew})` vergibt Versionen nur für geänderte Mitglieder, entfernte werden Tombstones, wieder hinzugefügte aufgeweckt. `CrewMember.updatedAt/updatedBy` bleiben optional (Eingabe ohne Version erlaubt; fehlend = älteste Version).
- **Fotos**: Entfernen/Löschen löscht die Foto-Zeilen lokal (Eintrag/Abschnitt als Tombstone behält `photoIds`). Dedup (`remapPhotoIds`): kanonische ID = kleinste ID je (Tag, Hash); Umschreiben ohne Versionssprung, damit beide Geräte identisch konvergieren. Fehlende Bilddaten (Export ohne Fotos): kein Photo-Datensatz, nur Referenz in `photoIds` -> UI zeigt Platzhalter, wenn `getPhoto` nichts liefert; `TripBundle.missingPhotos` trägt Metadaten für Dedup.
- **Tracks** werden als ganzer Datensatz per LWW gemergt (parallele Live-Aufzeichnung auf zwei Geräten desselben Tracks würde Punkte verlieren; Live-Tracks haben je Gerät eigene IDs).
- **Trip-Gleichstand** (gleiche Version): deterministisch per JSON-Vergleich, damit der Merge kommutativ bleibt.
- Testumgebung: fake-indexeddb behält in jsdom keine Blob-Inhalte; Szenario-Tests (`io/merge.scenario.test.ts`) ersetzen sie vor dem Export.
