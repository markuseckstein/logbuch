# Dexie Cloud einrichten (Stufe 2: automatischer Sync)

Ohne Cloud-URL läuft die App rein lokal (wie bisher, inkl. Datei-Teilen). Mit URL kann man sich per E-Mail-Code
anmelden; Logbücher, die „in die Cloud gebracht“ wurden, synchronisieren automatisch. Hintergrund:
`docs/research/dexie-cloud-integration.md`, Datenmodell: `docs/architecture.md`.

## Einmalig (im Repo-Root)

```sh
npx dexie-cloud create                 # legt dexie-cloud.json (URL) und dexie-cloud.key (GEHEIM) an – beide gitignored
npx dexie-cloud whitelist https://markuseckstein.github.io
npx dexie-cloud whitelist http://localhost:5173   # vite dev
npx dexie-cloud whitelist http://localhost:4173   # vite preview / Playwright (Cloud-E2E)
npx dexie-cloud whitelist                         # ohne Argument: Liste prüfen
npx dexie-cloud import roles.json                 # Rollen skipper / crew / readonly
```

Optional für Cloud-E2E-Tests (Demo-Nutzer belegen keine Plätze, Login ohne Mail):

```sh
npx dexie-cloud import e2e/demoUsers.json         # alice@demo.local, bob@demo.local, carol@demo.local
```

`dexie-cloud.key` nie committen, nie in Client-Code. Die App braucht nur die (öffentliche) Datenbank-URL.

## URL setzen

- Lokal: `.env.local` (gitignored) mit `VITE_DEXIE_CLOUD_URL=https://<id>.dexie.cloud` (Wert `dbUrl` aus `dexie-cloud.json`).
- GitHub Pages: Repository → Settings → Secrets and variables → Actions → **Variables** →
  `DEXIE_CLOUD_URL` = gleiche URL. Der Workflow reicht sie als `VITE_DEXIE_CLOUD_URL` an den Build weiter.
  Ohne Variable baut der Workflow die lokale App.

## Rollen (roles.json)

| Rolle | Wer | Rechte |
|---|---|---|
| `skipper` | Ersteller des Logbuchs (zusätzlich Realm-Owner) | `manage: *` – alles, Mitglieder einladen/entfernen, Logbuch für alle löschen |
| `crew` | Mitsegler desselben Boots („Crew – schreibt mit“) | anlegen in crewMembers, entries, photos, dayReports, tracks, trackChunks; ändern in trips, crewMembers, entries, dayReports, tracks, trackChunks. Kein hartes Löschen fremder Datensätze (Löschen = `deletedAt`) |
| `readonly` | Crew anderer Boote der Flottille („Anderes Boot – nur lesen“) | keine (nur lesen) |

## Plan und Datenschutz

- **Pro-Plan** vor dem Törn buchen: Free hat 3 Produktions-Nutzer und nur 75 MB Blob-Speicher / 1.000 Blob-Schreibvorgänge
  im Monat – zu wenig für Fotos (siehe Recherche, Abschnitt 8).
- **Datenregion: Azure US East** (gehostete Dexie Cloud). Mitsegler darüber informieren (Verarbeitung in den USA,
  DPF/SCC). Abmelden entfernt die lokalen Daten vom Gerät, in der Cloud bleiben sie.

## Bedienung (Kurzfassung)

1. Skipper: Törn-Tab → „Synchronisation“ → Anmelden (E-Mail → Code) → „Logbuch in die Cloud bringen“.
2. Skipper lädt ein: E-Mail + „Als Crew einladen (schreibt mit)“ bzw. „Anderes Boot einladen (nur lesen)“.
3. Eingeladene: App öffnen → Anmelden mit genau dieser E-Mail → Banner „… lädt dich in das Logbuch der … ein“ → Annehmen.
   Crew wählt danach „Ich bin …“ (wird mit dem Konto verknüpft und gilt auf allen eigenen Geräten).
4. Flottille: jedes Boot lädt die Skipper der anderen Boote als „Anderes Boot (nur lesen)“ ein; `trip.flotilla` wie in Stufe 1.
