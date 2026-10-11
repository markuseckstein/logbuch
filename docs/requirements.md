# Logbuch-App – Anforderungen

Private „Urlaubs-Logbuch“-App für einen Segeltörn. Keine gesetzlichen Anforderungen (keine Streichungs-Nachvollziehbarkeit, Einträge dürfen frei bearbeitet/gelöscht werden).

## Plattform & Rahmen
- **Installierbare PWA**, offline-first (auf See kein Netz). Zielgerät: modernes Android-Smartphone (Chrome). Native Android-App evtl. später (Entscheidung nach PWA).
- UI-Sprache: **Deutsch**. Mobile-first, einhändig bedienbar, gut lesbar bei Sonne (hoher Kontrast), Dark-Mode für Nachtwachen.
- Daten lokal auf dem Gerät (IndexedDB), `navigator.storage.persist()` anfordern. Ein Gerät, keine Sync. Backup = Export.

## Domänenbegriffe
- **Törn**: Reise mit Name, Zeitraum (von/bis), Revier (optional), Boot, Crew. Mehrere Törns möglich, einer ist aktiv.
- **Boot**: Name, Typ/Modell, Länge, Heimathafen, Rufzeichen/MMSI (optional), Foto (optional).
- **Crew**: Liste von Namen, optional Rolle (Skipper, Co-Skipper, Crew).
- **Logeintrag**: Zeitstempel + Position (lat/lon, Genauigkeit), automatisch erfasst. Optional: Typ, Text, Wetter, Wind, 0–3 Fotos.
  - **Eintragstyp**: Eintrag (Standard), Ablegen, Anlegen/Hafen, Ankern/Ankerplatz, Boje, Segel setzen, Segel bergen, Motor an, Motor aus, Ereignis/Sichtung, Sonstiges.
  - **Wind**: Richtung (16-teilige Rose), Stärke in Beaufort (0–12), optional Knoten.
  - **Wetter**: Bewölkung/Wetterlage (Sonne, leicht bewölkt, bewölkt, Regen, Gewitter, Nebel), Seegang (glatt…sehr grob), Luftdruck hPa, Temperatur °C – alles optional.
  - Optional (zusätzlich zu GPS): Log/Distanz und Kurs/Fahrt werden aus Positionen berechnet, nicht manuell erfasst.
- **Tagesbericht**: pro Kalendertag des Törns ein Freitext („Reisebericht“), optional ein Titel.
- **Track**: importierte GPX-Tracks, Tagen zugeordnet (über Zeitstempel). Optional Live-Aufzeichnung nur im Vordergrund (Wake Lock), standardmäßig aus.

## Kernabläufe
1. **Schnell-Eintrag**: Ein großer Button → GPS + Uhrzeit wird gespeichert (Ziel: 1 Tap). Danach optional Details ergänzen (Typ-Chips, Wind-/Wetter-Picker, Text, Foto). Kein GPS-Fix → Eintrag trotzdem speichern, Position nachtragen/manuell.
2. **Törn anlegen** (Onboarding beim ersten Start): Törndaten, Boot (+Foto), Crew.
3. **Tagesansicht/Timeline**: Einträge pro Tag, Tagesbericht, Tagesstatistik (Distanz sm, Fahrtzeit), kleine Karte.
4. **Karte**: Einträge + Route (Leaflet/OSM, Tiles werden gecacht; offline ohne Kacheln trotzdem Punkte/Linie zeigen).
5. **Export**: ZIP mit `logbook.json` + `images/…` (relative Pfade) + GPX der Route. Import des ZIPs (Backup-Restore). Optional einzelnes JSON mit eingebetteten Base64-Bildern.
6. **GPX-Import**: Track-Datei importieren, an Törn hängen.

## Nicht-funktional
- Fotos clientseitig verkleinern (max. ~2000px lange Kante, JPEG ~0,85), EXIF-Orientierung beachten.
- Koordinaten-Anzeige nautisch (54°19,123′N 010°08,456′E), Distanzen in Seemeilen.
- Tests: TDD für Domänenlogik (Distanzen, Export/Import, GPX-Parsing, Tageszuordnung), E2E-Smoke-Tests mit Playwright.
