# Projektstatus und Übergabe

Stand: 2026-10-12 (UX-Umsetzung lokal committet, noch nicht gepusht). Alles ist auf `main` gepusht und live auf https://markuseckstein.github.io/logbuch/ (GitHub Pages, Deploy per Push).

## Nächster Schritt
**UX-Review umgesetzt (2026-10-12)**, siehe `docs/ux-review-2026-10-11.md` (bewusst offen: 6, 7, 15).
- Offen bleiben die Punkte unter „Offen / vor dem echten Törn“.
- Vor dem Törn: echte Teilnehmer im Dexie-Manager auf Produktion hochstufen, eigene Test-DB für die Cloud-E2E, Daheim-Link erstellen und freischalten.
- Danach pushen, Deploy abwarten und live prüfen (Smoke-Test).

## Was fertig ist
- **PWA-Grundlagen:**
  - GPX-Import, Seekarten-UI (Prototyp A), Fotos (bis 2000 px, EXIF entfernt).
  - Export und Import als ZIP (Format v4) und GPX.
- **Törn-Modell v2** (`docs/toern-modell.md`):
  - Ein Törn ist ein Dexie-Cloud-Realm mit 1..n Booten.
  - Rollen admin (Ersteller), member (nur Neues anlegen und Eigenes ändern) und viewer.
  - Boot-Schalter (Prototyp D), Tagesberichte pro Person, Cover-Bild pro Törn.
- **Einladen ohne Dexie-Mail:**
  - Der Admin trägt E-Mail-Adressen ein (`invite: false`).
  - Er teilt einen Törn-QR-Code oder einen persönlichen QR-Code je Person (E-Mail vorausgefüllt).
  - Die Einladung wird nach dem Login automatisch angenommen; Wieder-Anmelden mit derselben E-Mail funktioniert.
- **Daheim-Link** (Zuschauer ohne Anmeldung, live, mit Fotos):
  - Läuft über ein Dexie-Demo-Konto `daheim-<token>@demo.local` mit Rolle viewer.
  - **Jeder neue oder erneuerte Link muss einmal freigeschaltet werden:** `npm run viewer:create -- <Link|E-Mail|Token>` im Repo-Root. Das geht nur dort, wo `dexie-cloud.key` liegt, also auf dem Laptop des Nutzers.
  - Wer als Crew den Link aus Versehen öffnet, kommt über „Zur Crew-Anmeldung“ (unten in der Daheim-Ansicht) zurück.
- **Foto-Vollbild-Viewer** in der Crew-App und in der Daheim-Ansicht: wischen, zoomen, teilen.
- **Absicherung gegen stille Sync-Ablehnungen:** `syncRescue` mit Banner „Erneut senden/Verwerfen“.

## Dexie Cloud
- **Datenbank:** https://z8c8mdzxf.dexie.cloud (Azure US East), Pro-Plan seit 2026-10-13 (25 Plätze).
  - Setup und Befehle: `docs/dexie-cloud-setup.md`.
  - Recherche und Spikes: `docs/research/dexie-cloud-integration.md` (§9.9 Rechte, §9.10 Demo-Konten/Daheim).
- **`dexie-cloud.key`** (Admin-Zugang, gitignored, nur lokal): nie lesen, ausgeben oder in Client-Code einbetten. Die CLI darf ihn benutzen.
- **Daten:** Am 2026-10-13 auf Wunsch komplett geleert (alle Törns, privater Rest bei test1, altes Daheim-Konto). Übrig: Schema, Rollen, `rlm-public` und die E2E-Demo-Konten alice–dave.
- **Demo-Konten alice/bob/carol/dave@demo.local** gibt es nur für die Cloud-E2E. Jeder, der die DB-URL kennt, kann sich damit anmelden.
- **Cloud-E2E:** `npm run e2e:cloud` (workers: 1). Die Tests räumen ihre Törns und Daheim-Konten selbst auf.

## Offen / vor dem echten Törn
- **Teilnehmer auf Produktion hochstufen** (Pro ist gebucht, 2026-10-13). Neue Nutzer starten auch mit Pro als *Evaluation*-Nutzer: nach 30 aktiven Sync-Tagen synchronisieren sie nicht mehr (App nur noch offline). Ablauf:
  1. Törn anlegen, Crew einladen.
  2. Jede Person meldet sich einmal an (erst dann existiert ihr Dexie-Konto).
  3. In https://manager.dexie.cloud (mit der Admin-E-Mail anmelden) den Admin und alle Crew-Mitglieder auf *Production* setzen.
  - Daheim-Konten (`daheim-…@demo.local`) sind Demo-Konten: kein Hochstufen nötig, belegen keinen Platz.
  - Optional später: Skript, das per REST-API alle Mitglieder eines Törns hochstuft. Quelle: https://dexie.org/cloud/pricing (FAQ).
- **Eigene Test-DB für die Cloud-E2E anlegen** und die Demo-Konten alice–dave aus der echten DB löschen. Stand 2026-10-14: alice ist schon gelöscht, deshalb scheitert `npm run e2e:cloud` beim Demo-Login, bis die Test-DB steht.
- **Daheim-Link vor Abfahrt erstellen und freischalten**, weil an Bord kein Laptop zur Hand ist.
- **Ungeklärte Kleinigkeiten:**
  - Die Rolle `member` allein wurde vom Server zeitweise nicht ausgewertet. Die App setzt deshalb die Rechte zusätzlich direkt am Mitglied.
  - Eine Anfrage an Dexie zum Rechte-Cache ist offen (Recherche-Doku §9.8).
- **Mögliche spätere Punkte:**
  - Android-Zurück-Geste schließt Sheets nicht überall.
  - Bundle ca. 840 KB.
  - Kein Hintergrund-Sync bzw. GPS im Hintergrund (eventuell später eine native Android-App).
  - Ideen aus dem UX-Review, Abschnitt „Später / größer“: Offline-Kartenkacheln, Rückgängig-Toast, Sonnen-Theme, Daheim ohne CLI-Freischaltung.

## Arbeitsweise
- Der Nutzer arbeitet als Auftraggeber. Claude koordiniert und lässt Subagenten (kosteneffiziente Modelle, TDD) umsetzen, prüft selbst und stellt nur nötige Rückfragen.
- Pushes auf `main` und Pages-Deploys sind freigegeben. Andere nach außen wirkende Aktionen (z. B. Löschen in der Cloud) vorher abstimmen.
- Keine Bilder echter Personen ins öffentliche Repo.
- Keine Abwärtskompatibilität nötig; es gibt keine Altdaten.
