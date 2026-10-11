# Logbuch-App – Anforderungen

Private „Urlaubs-Logbuch“-App für einen Segeltörn. Keine gesetzlichen Anforderungen (keine Streichungs-Nachvollziehbarkeit, Einträge dürfen frei bearbeitet/gelöscht werden).

## Plattform & Rahmen
- **Installierbare PWA**, offline-first (auf See kein Netz). Zielgerät: modernes Android-Smartphone (Chrome). Native Android-App evtl. später (Entscheidung nach PWA).
- UI-Sprache: **Deutsch**. Mobile-first, einhändig bedienbar, gut lesbar bei Sonne (hoher Kontrast), Dark-Mode für Nachtwachen.
- Daten lokal auf dem Gerät (IndexedDB), `navigator.storage.persist()` anfordern. Ohne Anmeldung ein Gerät ohne Sync; mit Cloud-Konto (Dexie Cloud) Sync zwischen allen Personen eines Törns. Backup = Export.

## Domänenbegriffe
- **Törn**: Reise mit Name, Zeitraum (von/bis), Revier (optional), optional Cover-Bild, **einem oder mehreren Booten** (Flottille) und Personen. Mehrere Törns möglich, einer ist aktiv. Wer den Törn anlegt, ist **Admin**.
- **Boot**: Name, Typ/Modell, Länge, Heimathafen, Rufzeichen/MMSI (optional), Foto (optional); eigene Farbe + Symbolform auf Karte und Timeline.
- **Personen**: Name, E-Mail (Einladung), optional Boot-Vorschlag (nur Vorschlag fürs erste Eintragen, keine Berechtigung). Mitglieder schreiben auf jedes Boot, ändern aber nur eigene Einträge/Abschnitte/Tracks; der Admin darf alles.
- **Logeintrag**: Zeitstempel + Position (lat/lon, Genauigkeit), automatisch erfasst. Optional: Typ, Text, Wetter, Wind, 0–5 Fotos (Galerie mit Mehrfachauswahl oder Kamera).
  - **Eintragstyp**: Eintrag (Standard), Ablegen, Anlegen/Hafen, Ankern/Ankerplatz, Boje, Segel setzen, Segel bergen, Motor an, Motor aus, Ereignis/Sichtung, Sonstiges.
  - **Wind**: Richtung (16-teilige Rose), Stärke in Beaufort (0–12), optional Knoten.
  - **Wetter**: Bewölkung/Wetterlage (Sonne, leicht bewölkt, bewölkt, Regen, Gewitter, Nebel), Seegang (glatt…sehr grob), Luftdruck hPa, Temperatur °C – alles optional.
  - Optional (zusätzlich zu GPS): Log/Distanz und Kurs/Fahrt werden aus Positionen berechnet, nicht manuell erfasst.
- **Logeintrag** gehört immer zu genau einem Boot (Wahl über den Boot-Schalter bzw. Pflichtauswahl bei „Alle“).
- **Tagesbericht**: pro Kalendertag ein Abschnitt je Person (Freitext, optional Titel, Fotos); alle Abschnitte stehen untereinander mit Name und Uhrzeit.
- **Track**: importierte GPX-Tracks, Tagen zugeordnet (über Zeitstempel). Optional Live-Aufzeichnung nur im Vordergrund (Wake Lock), standardmäßig aus.

## Kernabläufe
1. **Schnell-Eintrag**: Ein großer Button → GPS + Uhrzeit wird für das im Boot-Schalter gewählte Boot gespeichert (Ziel: 1 Tap); steht der Schalter auf „Alle“, fragt die App zuerst „Für welches Boot?“. Danach optional Details ergänzen (Typ-Chips, Wind-/Wetter-Picker, Text, Foto). Kein GPS-Fix → Eintrag trotzdem speichern, Position nachtragen/manuell.
2. **Törn anlegen** (Onboarding beim ersten Start, drei Schritte): Törndaten + eigener Name (+ optional Cover) → Boote (mind. eins, +Foto) → Personen per E-Mail einladen (mit Boot-Vorschlag; ohne Anmeldung vormerken oder später einladen).
3. **Tagesansicht/Timeline**: folgt dem Boot-Schalter (ein Boot oder alle, dann mit Boot-Badge und Tabelle sm/Einträge je Boot); Tagesbericht-Abschnitte, Tagesstatistik (Distanz sm, Fahrtzeit), kleine Karte.
4. **Karte**: immer alle Boote (Farbe + Symbolform, Legende mit Ein-/Ausblenden, Tagesfilter); Einträge + Route je Boot (Leaflet/OSM, Tiles werden gecacht; offline ohne Kacheln trotzdem Punkte/Linie zeigen).
5. **Export**: ZIP mit `logbook.json` + `images/…` (relative Pfade) + GPX der Route. Import des ZIPs (Backup-Restore). Optional einzelnes JSON mit eingebetteten Base64-Bildern.
6. **GPX-Import**: Track-Datei importieren, an ein Boot des Törns hängen. Live-Aufzeichnung gehört ebenfalls zu einem Boot.
7. **Törn-Tab**: Konto (Anmelden/Abmelden, Admin-Badge), Cover, Boote als Karten (Admin: anlegen, bearbeiten, entfernen nur ohne Einträge), Person einladen, Mitgliederliste (Status, Boot-Vorschlag ändern, erneut senden, entfernen), Törn-Wechsler, Export/Import.

## Nicht-funktional
- Tagesbericht: bis zu 15 Fotos (gleiche Galerie/Kamera-Auswahl). Ein Foto wird pro Kalendertag nur einmal gespeichert (Eintrag oder Tagesbericht, Erkennung per SHA-256 der Originaldatei); Nutzer-Feedback per Toast.
- Fotos clientseitig verkleinern (max. ~2000px lange Kante, JPEG ~0,85), EXIF-Orientierung beachten.
- Koordinaten-Anzeige nautisch (54°19,123′N 010°08,456′E), Distanzen in Seemeilen.
- Tests: TDD für Domänenlogik (Distanzen, Export/Import, GPX-Parsing, Tageszuordnung), E2E-Smoke-Tests mit Playwright.
