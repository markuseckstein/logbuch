# PWA-Technik für das Segel-Logbuch (Android/Chrome) – Recherche

Stand: 2026-10-11. Versionen via npm-Registry geprüft (nur Releases, die am 2026-10-11 mindestens 14 Tage alt sind). Kennzeichnung: **[Quelle]** = in der verlinkten Primärquelle gelesen, **[Wissen]** = Erfahrungs-/Hintergrundwissen, in dieser Recherche nicht an einer Primärquelle verifiziert und vor Festlegung auf einem echten Gerät zu testen.

## 1. Geolocation (Einzel-Fix)

- Secure Context (HTTPS) nötig, Nutzer-Berechtigung per Prompt, abfragbar über Permissions API. [MDN watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)
- Fehlercodes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT. [Geolocation-Spec / MDN]
- **Empfohlene Strategie "schnell grob, dann verbessern"** (Optionswerte sind Empfehlung, **[Wissen]**):
  1. Sofort `getCurrentPosition({enableHighAccuracy:false, maximumAge:60000, timeout:3000})` → grober Fix (Cache/Netz/WLAN, aber ohne Netz kaum verfügbar), Eintrag sofort mit Zeitstempel speichern.
  2. Parallel `watchPosition({enableHighAccuracy:true, maximumAge:0, timeout:15000})` für ca. 10–20 s; jeden Fix behalten, der eine bessere `coords.accuracy` hat; Abbruch bei accuracy ≤ ~20 m oder nach Timeout; dann `clearWatch`. Besten Fix in den bereits gespeicherten Eintrag zurückschreiben (Position "nachverbessern").
  3. Kein Fix: Eintrag ohne Position speichern (Anforderung), später manuell nachtragen.
- Auf See ist `enableHighAccuracy:true` entscheidend, weil ohne Netz nur GNSS bleibt. **[Wissen]**: Der GNSS-Empfänger arbeitet ohne Mobilfunk/WLAN; Kaltstart ohne A-GPS-Daten kann 30–60+ s dauern. Deshalb: den Fix früh "warm halten" (z. B. beim Öffnen der App einen kurzen watch starten) und nie auf den Fix blockieren.
- **Installierte PWA**: **[Wissen]** Eine über Chrome installierte PWA (WebAPK) nutzt dieselbe Origin-Berechtigung wie Chrome; Standort-Berechtigung einmal erteilen, in den Android-Seiteneinstellungen der App änderbar. Android-Systemstandort muss aktiv sein. Im Onboarding Berechtigung gezielt per Nutzeraktion anfordern.

## 2. Foreground-Live-Tracking, Wake Lock, Hintergrund

- **Screen Wake Lock API**: Baseline 2025 "newly available" (seit März 2025 in allen aktuellen Browsern), HTTPS, `navigator.wakeLock.request("screen")`. Lock wird bei hidden/inaktivem Dokument automatisch freigegeben; bei `visibilitychange` → neu anfordern; System kann ihn bei niedrigem Akku verweigern/freigeben. Feature-Detect `"wakeLock" in navigator`. [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- **Bildschirm aus / App im Hintergrund**: MDN macht dazu keine Aussage zu `watchPosition`. Praxisberichte ([Progressier](https://progressier.com/pwa-capabilities/geolocation)) nennen, dass Position-Updates bei ausgeschaltetem Bildschirm ausbleiben. Das W3C diskutiert Page-Visibility-Bindung ([W3C-Thread](https://lists.w3.org/Archives/Public/public-device-apis-log/2023Jan/0017.html)). Als Annahme planen: **kein Tracking bei Screen-off/Hintergrund**; nach Rückkehr entstehen Lücken im Track.
- **Hintergrund-Geolocation 2026 in PWAs**: In dieser Recherche **keine Primärquelle für eine solche API gefunden**; es gibt keine Background-Geolocation-Web-API (Periodic Background Sync liefert keinen Standort und ist für Dauer-Tracking ungeeignet). **Fazit: Nein.** Zuverlässiges Hintergrund-Tracking nur mit nativer App (Foreground Service) oder externem Tracker (z. B. separate GPS-Logger-App → GPX-Import, das ist in den Anforderungen bereits vorgesehen). Live-Tracking daher: Wake Lock an + Display an + Hinweis in der UI + Lückenerkennung.

## 3. Speicher (IndexedDB, Blobs, Quoten, persist)

- IndexedDB speichert Blobs direkt (Bilder nach Verkleinerung ~300–800 kB je Foto).
- **Quoten Chrome**: pro Origin bis 60 % der Gesamtplatte (nicht des freien Platzes), insgesamt max. 80 %. [MDN Quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) Für ein Logbuch irrelevant; `navigator.storage.estimate()` für Anzeige nutzen.
- **Eviction**: Standard "best-effort" → bei Speicherdruck LRU-Eviction ganzer Origins (alles auf einmal). Mit `persist()` nur durch Nutzer löschbar. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- **`persist()`-Gewährung**: Chromium entscheidet ohne Prompt heuristisch: Site-Engagement, installiert/gebookmarkt, Notification-Berechtigung. Bei Ablehnung später erneut versuchbar. [web.dev Persistent Storage](https://web.dev/articles/persistent-storage) → App installieren, dann `persist()` aufrufen (z. B. nach Törn-Anlage und erneut bei jedem Start, bis `persisted()` true). Android-spezifische Aussagen stehen nicht in der Quelle.
- Konsequenz: Backup-Export bleibt Pflicht; UI-Hinweis, wenn `persisted()` false. Last-Export-Datum anzeigen.

## 4. Bilder

- `createImageBitmap(file, {imageOrientation:'from-image', resizeWidth, resizeHeight, resizeQuality:'high'})`: Default `from-image` wendet EXIF-Orientierung an; Baseline widely available seit 09/2021. [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) Hinweis: Mit Resize-Optionen Seitenverhältnis selbst berechnen (nach EXIF-Rotation, d. h. Maße des Bitmaps ohne Resize erst auslesen).
- Pipeline: `createImageBitmap(file, {imageOrientation:'from-image'})` → Zielmaße (max. Kante 2000 px) → `OffscreenCanvas`/Canvas `drawImage` → `convertToBlob`/`toBlob('image/jpeg', 0.85)` → in IndexedDB. EXIF (inkl. GPS) fällt beim Canvas-Re-Encode weg (gut für Datenschutz). Bitmap mit `.close()` freigeben (Speicher auf Mobilgeräten). Optional in Worker (OffscreenCanvas), **[Wissen]** für 12–50-MP-Fotos sinnvoll, um UI-Ruckeln zu vermeiden.
- Kamera: `<input type="file" accept="image/*" capture="environment">`. `capture` ist laut MDN "limited availability"; das OS zeigt eine Auswahl/Kamera-UI, Android-Details nicht dokumentiert. [MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) Empfehlung: **zwei Buttons** ("Foto aufnehmen" mit `capture`, "Aus Galerie" ohne) und auf dem Gerät testen. Alternative `getUserMedia` nur bei Bedarf (mehr Aufwand).

## 5. Offline-Karte (Leaflet + OSM-Tiles)

- **OSM Tile Usage Policy** ([Policy](https://operations.osmfoundation.org/policies/tiles/)): "Offline use is not permitted on tile.openstreetmap.org"; Bulk-Download = jedes Vorab-Laden von Kacheln, die der Nutzer nicht gerade ansieht (§4) → **verboten**; Caches nicht umgehen, `Cache-Control`/`Expires`/`ETag` beachten bzw. mindestens 7 Tage halten (§3.2); eigener User-Agent bzw. Referer, Attribution sichtbar (unten rechts, nicht versteckt); Sperrung ohne Vorwarnung möglich. Service Worker werden nicht erwähnt; ein SW, der Kacheln für späteren Offline-Gebrauch speichert, fällt strikt gelesen unter das Verbot. Normales HTTP-Caching ist erlaubt.
- Bewertung: Reines "angesehene Kacheln im Cache lassen" (kein Prefetch) ist ein Graubereich; für eine private App mit einem Nutzer ist die Last vernachlässigbar, aber **nicht policy-konform garantiert**. "Region vorab cachen" ist eindeutig verboten.
- **Empfehlung**:
  1. Zuerst: Karte funktioniert ohne Kacheln (Punkte/Linie als Vektor-Layer auf leerem/hellem Hintergrund) – ist in den Anforderungen bereits gefordert.
  2. Kacheln online anzeigen mit Workbox `CacheFirst`/`StaleWhileRevalidate` nur für bereits betrachtete Kacheln (`maxEntries` ~500, `maxAgeSeconds` ≥ 7 Tage), keine Prefetch-Funktion, Attribution. Das ist ein bewusst akzeptiertes Restrisiko, oder:
  3. Policy-sauber: Offline-Region über einen Anbieter/Format, das Offline erlaubt, z. B. selbst erzeugte **PMTiles**-Region (Protomaps, OSM-Daten ODbL) plus `protomaps-leaflet`, Datei in Cache/IndexedDB/OPFS. **[Wissen, nicht verifiziert]**; Tile-Anbieter-AGB (MapTiler, Stadia etc.) vor Nutzung prüfen. Das ist ein Spätausbau (v2), nicht für MVP.
- Workbox-Detail: Cross-Origin-Kacheln ohne CORS sind "opaque" (Status 0); `CacheFirst` cached nur 200 → `CacheableResponsePlugin({statuses:[0,200]})` nötig, aber opake Fehler-Antworten werden mitgecached → `StaleWhileRevalidate` ist robuster. Mit `crossOrigin: true` am Leaflet-TileLayer bekommt man echte CORS-Antworten (OSM sendet CORS-Header **[Wissen]**). [Workbox cacheable-response](https://developer.chrome.com/docs/workbox/modules/workbox-cacheable-response)
- **Leaflet**: stabil 1.9.4 (Mai 2023, seither kein Release); 2.0.0 existiert nur als Alpha (2.0.0-alpha.1, 08/2025) → 1.9.4 nehmen. `react-leaflet` 5.0.0 (12/2024) ist für React 19; Alternative: Leaflet direkt in einem `useEffect`-Wrapper einbinden (kleine Karte, wenige Layer) – weniger Abhängigkeiten.

## 6. Export/Import (ZIP)

| | fflate 0.8.3 | JSZip 3.10.2 |
|---|---|---|
| Größe | ZIP-Kompression ~7 kB min., Gesamtbibliothek ≤ ~33 kB min. (12,5 kB gzip) | deutlich größer (**[Wissen]** ~90 kB min.) |
| API | `zipSync`/`unzipSync`, async mit Workern, Streaming (`Zip`, `Unzip`), `level:0` für bereits komprimierte JPEGs | Promise-basiert, `generateAsync({type:'blob'})` |
| Pflege | aktiv (0.8.3, 05/2026) | 3.10.2 (09/2026) |

Quelle fflate: [GitHub](https://github.com/101arrowz/fflate). **Empfehlung fflate**: JPEGs mit `level:0` (store) ablegen, JSON komprimieren; für sehr große Backups Streaming-`Zip`-API, damit nicht alles im RAM liegt (bei Hunderten Fotos à 0,5 MB trotzdem unkritisch). Hinweis: `zipSync` blockiert den Main Thread → async `zip()` (Worker) für große Exporte.

- **Teilen/Speichern auf Android**: `navigator.share({files:[zipFile]})` mit vorheriger Prüfung `navigator.canShare({files})`; erfordert Nutzergeste, HTTPS; `AbortError` bei Abbruch. [MDN share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) **ZIP ist nicht in der MDN-Liste "üblicherweise teilbarer" Typen** (dort PDF, Bilder, Audio, Video, Text/CSV/HTML) → `canShare` ausdrücklich testen, ggf. `application/zip` bzw. anderer Typ; sonst Fallback. Chrome-Android-Support der Tabelle nicht in der Quelle gelesen.
- **File System Access `showSaveFilePicker`**: laut MDN "limited availability", Nutzergeste nötig; **[Wissen]** auf Chrome Android nicht verfügbar → nicht darauf bauen. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
- **Fallback (Hauptweg für Download)**: `URL.createObjectURL(blob)` + `<a download="logbuch-YYYY-MM-DD.zip">`, danach `revokeObjectURL`. Chrome Android speichert in Downloads. Reihenfolge: share (wenn `canShare`) → Download-Link.
- Import: `<input type=file accept=".zip,application/zip">` → `unzipSync` (mit `filter` bei Bedarf) → JSON validieren (Schema-Version, z. B. zod/valibot) → in Transaktion schreiben (Merge vs. Ersetzen als bewusste Wahl).

## 7. GPX

- **Parsen**: `@tmcw/togeojson` (BSD-2-Clause, dependency-free, ESM, Generatoren für große Dateien) + nativer `DOMParser` im Browser. [GitHub](https://github.com/placemark/togeojson) Die Doku-Beispiele zeigen KML; GPX-Funktion `gpx(doc)` und `coordinateProperties.times` für Zeitstempel sind **in der gelesenen README nicht ausdrücklich belegt** → mit einer Test-GPX verifizieren. Der native DOMParser verlangt valides XML (laut README ist vieles invalid).
- **Alternative**: Eigener Parser mit `DOMParser` + `querySelectorAll('trkpt')` (`lat`, `lon`, `ele`, `time`): ~30 Zeilen, keine Abhängigkeit, volle Kontrolle über Zeit-Zuordnung zu Tagen, leicht per Vitest zu testen (jsdom/happy-dom hat DOMParser; in Node-Tests ggf. `@xmldom/xmldom`). **Empfehlung**: Eigener Mini-Parser für `trk/trkseg/trkpt` (+ `wpt`, `rte` optional); `togeojson` nur, falls KML/TCX später dazukommt.
- **Export**: GPX 1.1 als String bauen (Template, XML-Escape für Namen, ISO-8601-UTC-Zeiten `toISOString()`), `<trk><trkseg><trkpt lat lon><time/>`; Logeinträge als `<wpt>` mit `<name>`/`<desc>`. Kein Library nötig.

## 8. vite-plugin-pwa

- npm-latest: 2.0.0 (2026-10-03) ist **erst 8 Tage alt** → nicht verwenden; **1.3.0 (2026-05-05)** ist die jüngste ≥ 2 Wochen alte Version, Peer-Deps: Vite bis ^8, `workbox-build`/`workbox-window` ^7.4.1 (aktuell workbox-window 7.4.1). Node ≥ 20.19 (laut 2.0.0-Metadaten, für Vite 8 ohnehin).
- Minimal: `VitePWA({ registerType: 'autoUpdate' })` erzeugt Manifest-Injection, SW und Registrierungsskript; `devOptions:{enabled:true}` zum Testen im Dev-Server. [Guide](https://vite-pwa-org.netlify.app/guide/)
- Manifest: `name`, `short_name`, `theme_color` (= `<meta name="theme-color">`), Icons 192×192 und 512×512 PNG; `any` und `maskable` als getrennte Einträge. [Minimal Requirements](https://vite-pwa-org.netlify.app/guide/pwa-minimal-requirements.html) Zusätzlich `display:'standalone'`, `start_url:'/'`, `lang:'de'`, `background_color`. Icons ggf. mit `@vite-pwa/assets-generator` erzeugen.
- **Update-Flow**: Default `registerType: 'prompt'`: `registerSW({onNeedRefresh(){…}, onOfflineReady(){…}})` aus `virtual:pwa-register`, bei Klick `updateSW()`. `workbox.cleanupOutdatedCaches` an lassen. [Prompt for update](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html) **Empfehlung für ein Logbuch: `prompt`** (kein Reload mitten in der Eingabe; Update beim nächsten Start/auf Nachfrage). React-Hook `useRegisterSW` (`virtual:pwa-register/react`) ist auf der gelesenen Seite nicht belegt, existiert laut Plugin-Doku **[Wissen]**.
- Navigation: `workbox.navigateFallback: '/index.html'`, `globPatterns` inkl. Fonts/Icons; Kachel-Route per `runtimeCaching` (s. 5).

## 9. Optional: Wetter (Open-Meteo)

- Endpoint ohne Key für nicht-kommerzielle Nutzung: `https://api.open-meteo.com/v1/forecast?latitude=54.32&longitude=10.14&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,pressure_msl&wind_speed_unit=kn` (Variablen gemäß Doku; `wind_speed_unit=kn` für Knoten **[Wissen]**; Seegang über die separate Marine-API `/v1/marine` **[Doku-Link nur referenziert]**). [Docs](https://open-meteo.com/en/docs)
- Lizenz: Daten CC BY 4.0 (Attribution "Weather data by Open-Meteo.com" empfohlen), kostenlos nur nicht-kommerziell (private App ohne Werbung/Abo: ok); Limits < 10 000 Calls/Tag, < 5 000/h, < 600/min. [Terms](https://open-meteo.com/en/terms)
- Nutzung nur als **Vorschlag** (vorbefüllt, überschreibbar), nur bei Netz, Fehler still ignorieren; Beaufort aus m/s oder kn selbst umrechnen. Niedrige Priorität.

---

## Stack-Empfehlung und Versionen (nur ≥ 14 Tage alt, Stand 2026-10-11)

| Baustein | Version | Anmerkung |
|---|---|---|
| Node | ≥ 20.19 (22 LTS empfohlen) | Vite 8 / Plugin |
| Vite | **8.3.1** (2026-09-24) | 8.3.4 ist erst 3 Tage alt |
| TypeScript | 7.0.2 (2026-07-08) | Kompatibilität mit Toolchain vorab prüfen; Fallback: letzte 5.x/6.x |
| React | 19.3.0 (2026-09-09) | + `@vitejs/plugin-react` **6.1.1** (2026-08-28); 6.1.2 zu neu |
| Preact (Alternative) | 10.29.8 (2026-08-01) + `@preact/preset-vite` 2.10.6 | 11.0.1 ist 3 Tage alt → nicht verwenden |
| vite-plugin-pwa | **1.3.0** (2026-05-05) | 2.0.0 (2026-10-03) zu neu; + `workbox-window` 7.4.1 |
| Dexie | 4.4.6 (2026-09-10), + `dexie-react-hooks` 4.4.0 | ~31 kB gzip |
| Leaflet | **1.9.4** (+ `@types/leaflet` 1.9.22) | 2.0 nur Alpha; react-leaflet 5.0.0 optional |
| fflate | 0.8.3 (2026-05-16) | statt JSZip 3.10.2 |
| GPX | eigener Parser (DOMParser); optional `@tmcw/togeojson` **7.1.2** (2025-05-31) | 7.1.3 zu neu |
| Vitest | 5.0.2 (2026-09-25), Fallback 4.1.11 | Kompatibilität mit Vite 8 beim Setup prüfen |
| fake-indexeddb | 6.2.5 (2025-11-07) | |
| Playwright | **1.63.0** (2026-09-04) | 1.64.0 (10-07) zu neu |

## Abweichungen / Kritikpunkte am geplanten Stack

1. **Neueste Releases bewusst nicht nehmen**: vite-plugin-pwa 2.0.0, Vite 8.3.4, Preact 11, Playwright 1.64, plugin-react 6.1.2 sind < 14 Tage alt.
2. **Preact vs. React**: Preact (~4 kB vs. ~45 kB gzip **[Wissen]**) bringt bei einer vorab gecachten PWA wenig; React 19 + dexie-react-hooks + Ökosystem-Kompatibilität überwiegt. Empfehlung: React, außer Bundlegröße wird ein reales Problem. (Preact 11 ist noch zu neu.)
3. **fflate statt JSZip**: deutlich kleiner, Streaming, aber Promise-Wrapper selbst schreiben; Export als `level:0` für JPEGs.
4. **GPX-Library verzichtbar**: eigener ~30-Zeilen-Parser reicht; `togeojson` nur bei Mehrformat-Bedarf.
5. **OSM-Kacheln und Offline**: OSM-Policy verbietet Offline-Nutzung und Prefetch auf `tile.openstreetmap.org`. "Tiles gecacht" aus den Anforderungen daher nur als Cache angesehener Kacheln (Graubereich) oder mit alternativer Quelle/PMTiles; Karte muss ohne Kacheln funktionieren (Vektor-Layer).
6. **Kein Hintergrund-Tracking im Web**: Live-Tracking nur im Vordergrund mit Wake Lock; für lückenloses Tracking externer GPS-Logger + GPX-Import (oder später native App).
7. **File System Access unbrauchbar auf Android**: Share (nach `canShare`-Test, ZIP evtl. nicht erlaubt) + `<a download>` als Hauptpfad.
8. **TypeScript 7 und Vitest 5 sind neue Hauptversionen**: beim Projekt-Setup Kompatibilität zu Vite 8/Plugins prüfen; Fallback auf vorherige Majors.
9. **`persist()` nicht garantiert**: erst nach Installation realistisch; Backup-Erinnerung in der UI.
10. Nicht auf realem Gerät verifiziert (Folgetest): `capture`-Verhalten, GNSS-Kaltstartzeit ohne Netz, `canShare` für ZIP, Verhalten von `watchPosition` bei Screen-off.
