# Projektstatus und Übergabe

Stand: 2026-10-11 abends. Alles ist auf `main` gepusht und live auf https://markuseckstein.github.io/logbuch/ (GitHub Pages, Deploy per Push).

## Nächster Schritt (2026-10-12)
**UX-Verbesserungen umsetzen** nach `docs/ux-review-2026-10-11.md`.
- Dort stehen die Entscheidung (welche Befundnummern), die Präzisierungen und alle Befunde.
- Ein erster Umsetzungsversuch wurde vor Beginn abgebrochen; der Code ist unverändert.
- Ablauf wie bisher:
  1. Ein Subagent setzt um und committet lokal.
  2. Der Koordinator prüft selbst: `npm test`, `typecheck`, `lint`, `build`, `e2e`, `e2e:cloud`.
  3. Danach pushen, Deploy abwarten und live prüfen (Smoke-Test).

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
- **Foto-Vollbild-Viewer** in der Crew-App und in der Daheim-Ansicht: wischen, zoomen, teilen.
- **Absicherung gegen stille Sync-Ablehnungen:** `syncRescue` mit Banner „Erneut senden/Verwerfen“.

## Dexie Cloud
- **Datenbank:** https://z8c8mdzxf.dexie.cloud (Azure US East), derzeit Free-Plan.
  - Setup und Befehle: `docs/dexie-cloud-setup.md`.
  - Recherche und Spikes: `docs/research/dexie-cloud-integration.md` (§9.9 Rechte, §9.10 Demo-Konten/Daheim).
- **`dexie-cloud.key`** (Admin-Zugang, gitignored, nur lokal): nie lesen, ausgeben oder in Client-Code einbetten. Die CLI darf ihn benutzen.
- **Daten:** Am 2026-10-11 wurden alle alten Realms gelöscht; die Cloud enthält danach nur neue Daten.
- **Demo-Konten alice/bob/carol/dave@demo.local** gibt es nur für die Cloud-E2E. Jeder, der die DB-URL kennt, kann sich damit anmelden.
- **Cloud-E2E:** `npm run e2e:cloud` (workers: 1). Die Tests räumen ihre Törns und Daheim-Konten selbst auf.

## Offen / vor dem echten Törn
- **Dexie Pro-Plan buchen** (ab ca. 3 €/Monat für 25 Plätze). Der Free-Plan erlaubt nur 3 Produktionsnutzer.
- **Eigene Test-DB für die Cloud-E2E anlegen** und die Demo-Konten alice–dave aus der echten DB löschen.
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
