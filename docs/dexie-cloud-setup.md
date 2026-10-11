# Dexie Cloud einrichten (Stufe 2: automatischer Sync)

Ohne Cloud-URL läuft die App rein lokal (wie bisher, inkl. Datei-Export/-Import). Mit URL kann man sich per
E-Mail-Code anmelden; jeder Törn ist dann ein eigener Realm (`rlm~<tripId>`) und synchronisiert automatisch mit allen
eingeladenen Personen (Törn-Modell v2, `docs/toern-modell.md`). Hintergrund:
`docs/research/dexie-cloud-integration.md`, Datenmodell: `docs/architecture.md`.

## Einmalig (im Repo-Root)

```sh
npx dexie-cloud create                 # legt dexie-cloud.json (URL) und dexie-cloud.key (GEHEIM) an – beide gitignored
npx dexie-cloud whitelist https://markuseckstein.github.io
npx dexie-cloud whitelist http://localhost:5173   # vite dev
npx dexie-cloud whitelist http://localhost:4173   # vite preview / Playwright (Cloud-E2E)
npx dexie-cloud whitelist                         # ohne Argument: Liste prüfen
npx dexie-cloud import roles.json                 # Rollen admin / member / viewer (ergänzt, löscht keine alten Rollen)
```

Optional für Cloud-E2E-Tests (Demo-Nutzer belegen keine Plätze, Login ohne Mail):

```sh
npx dexie-cloud import e2e/demoUsers.json         # alice@, bob@, carol@, dave@demo.local
```

## Tests

- `npm test`, `npm run e2e`: immer lokaler Modus (Vitest setzt `VITE_DEXIE_CLOUD_URL` leer; die lokale E2E baut
  mit leerer URL nach `dist-local` und läuft auf Port 4175).
- `npm run e2e:cloud`: baut mit der URL aus `.env.local` (Port 4173, muss in der Whitelist stehen) und führt
  `e2e/cloud.spec.ts` aus (Alice legt als Admin einen Törn mit zwei Booten an, lädt Bob und Carol mit Boot-Vorschlag
  ein, beide schreiben, fremde Einträge nur ansehen, Foto-Sync). Ohne URL wird übersprungen.
  Immer seriell (`workers: 1`, die Läufe teilen sich die Demo-Konten), auch mit `--repeat-each`.
  Eindeutiges Lauf-Kürzel in Törn- und Bootsnamen. Der Test löscht seinen Törn am Ende „für alle“. Hängen gebliebene Test-Realms: `npx dexie-cloud clear-realm <realmId> --yes`
  (`E2E_KEEP=1` lässt den Realm eines fehlgeschlagenen Laufs zur Analyse stehen).
- `e2e/homeview.cloud.spec.ts` (läuft mit `npm run e2e:cloud`): Daheim-Link erstellen, Konto per
  `scripts/create-viewer.mjs` freischalten, frischer Browser sieht den Törn live inkl. Foto, Hinweis bei anderem
  Login, „Link erneuern“ macht den alten Link ungültig. Löscht am Ende seinen Törn und **nur** die selbst angelegten
  `daheim-…`-Konten (`--delete`).
- Entwicklungsserver (`npm run dev`): `window.__logbook` = `{ db, repo, cloud }` für manuelle Versuche (nur DEV-Build).

`dexie-cloud.key` nie committen, nie in Client-Code. Die App braucht nur die (öffentliche) Datenbank-URL.

## URL setzen

- Lokal: `.env.local` (gitignored) mit `VITE_DEXIE_CLOUD_URL=https://<id>.dexie.cloud` (Wert `dbUrl` aus `dexie-cloud.json`).
- GitHub Pages: Repository → Settings → Secrets and variables → Actions → **Variables** →
  `DEXIE_CLOUD_URL` = gleiche URL. Der Workflow reicht sie als `VITE_DEXIE_CLOUD_URL` an den Build weiter.
  Ohne Variable baut der Workflow die lokale App.

## Rollen (roles.json)

| Rolle | Wer | Rechte |
|---|---|---|
| (Realm-Owner) | Wer den Törn anlegt = **Admin** | `manage: *` über `realm.owner` – Boote, Einladungen, Törndaten, Cover, alle Einträge, Törn für alle löschen |
| `admin` | (reserviert, z. B. weitere Admins) | `manage: *` |
| `viewer` | Daheim-Link (Zuschauer-Konto `daheim-<token>@demo.local`) | keine – nur lesen; zusätzlich `permissions: {}` am Mitglied |
| `member` | Eingeladene Personen | `add` auf entries, photos, dayReports, tracks, trackChunks. Eigene Datensätze ändern/löschen über die Owner-Regel von Dexie Cloud; fremde nur lesen (Spike, Recherche 9.9) |

Beim Einladen setzt die App am Mitglied `roles: ['member']` **und** dieselben Rechte explizit als `permissions`
(neu importierte globale Rollen wirkten auf dem gehosteten Server zunächst nicht, Recherche 9.9). Die älteren Rollen
`skipper`/`crew`/`readonly` stehen noch in der Datenbank (der Import löscht keine Rollen), werden aber nicht mehr
benutzt.

## Daheim-Link freischalten

Jeder Daheim-Link (Törn-Tab → „Daheim-Link“) braucht **einmalig** ein Demo-Konto in der Cloud – Dexie Cloud lässt den
Demo-Login nur für vorher importierte Adressen zu (Recherche 9.10). Im Repo-Root (wo `dexie-cloud.json` und
`dexie-cloud.key` liegen):

```sh
npm run viewer:create -- daheim-<token>@demo.local        # Befehl steht in der Admin-Karte („Befehl kopieren“)
npm run viewer:create -- --delete daheim-<token>@demo.local   # altes Konto löschen (optional, z. B. nach „Link erneuern“)
```

Das Skript akzeptiert auch den ganzen Link oder nur den Token. Bis der Link einmal geöffnet wurde, zeigt die
Admin-Karte den Hinweis „Einmalig freischalten lassen“. Ein erneuerter/abgeschalteter Link zeigt nichts mehr (das
Mitglied ist entfernt); das alte Demo-Konto bleibt bestehen, bis es gelöscht wird (es sieht nichts).
Demo-Konten belegen keine Plätze. Wer den Link hat, kann zusehen – Weiterleiten ist ausdrücklich erlaubt.

## Plan und Datenschutz

- **Pro-Plan** vor dem Törn buchen: Free hat 3 Produktions-Nutzer und nur 75 MB Blob-Speicher / 1.000 Blob-Schreibvorgänge
  im Monat – zu wenig für Fotos (siehe Recherche, Abschnitt 8).
- **Datenregion: Azure US East** (gehostete Dexie Cloud). Mitsegler darüber informieren (Verarbeitung in den USA,
  DPF/SCC). Abmelden entfernt die lokalen Daten vom Gerät, in der Cloud bleiben sie.

## Bedienung (Kurzfassung)

1. Admin: Törn anlegen (Onboarding: Törn → Boote → Crew). Anmelden im Onboarding oder später im Törn-Tab („Konto“ →
   Anmelden, E-Mail → Code). Lokal angelegte Törns kommen nach der Anmeldung automatisch in ihren Realm.
2. Admin trägt ein: Törn-Tab → „Person einladen“: E-Mail + optional Boot-Vorschlag. Das Realm-Mitglied wird mit
   `invite: false` angelegt – Dexie verschickt **keine** Mail. Ohne Anmeldung wird die Person vorgemerkt und nach der
   Anmeldung eingetragen. Danach „QR-Code zum Beitreten“ → Sheet mit QR-Code und Link `<App-URL>?join=<tripId>`,
   „Link teilen“ (Web Share, sonst Zwischenablage). Mitgliederliste: Status eingeladen/dabei, Vorschlag ändern, entfernen.
3. Crew scannt den Code bzw. öffnet den Link → Beitreten-Bildschirm → Anmelden mit genau der eingetragenen E-Mail
   (Code kommt von Dexie Cloud per Mail, ggf. Spam). Offene Einladungen (`db.cloud.invites`) werden automatisch
   angenommen, die App wechselt in den Törn, der Boot-Schalter steht auf dem vorgeschlagenen Boot; Schreiben geht,
   sobald der Server die Mitgliedschaft bestätigt hat. Liegt für die Adresse keine Einladung vor, erscheint ein Hinweis
   mit „Abmelden / andere E-Mail“.
