# Logbuch – Segel-Logbuch-PWA

Lies vor der Arbeit zuerst `docs/STATUS.md` (aktueller Stand, nächster Schritt), dann `docs/requirements.md`, `docs/architecture.md` (Module, Datenmodell, Exportformat), `docs/research/pwa-tech.md`. Visuelle Referenz: `prototypes/a-seekarte/index.html`.

## Konventionen
- UI-Texte Deutsch, Code/Bezeichner Englisch. TypeScript strict, keine `any`.
- **TDD**: Für `domain/`, `io/`, `db/` zuerst failing Test, dann Implementierung, dann Refactor. Tests neben dem Code (`*.test.ts`).
- Reine Funktionen in `domain/` – keine Browser-APIs, keine Imports aus anderen `src/`-Ordnern.
- Kein `alert/confirm/prompt`; Bestätigungen in der UI.
- Befehle: `npm test` (Vitest, einmalig), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e` (Playwright).
- Vor „fertig“: `npm test && npm run typecheck && npm run build` müssen grün sein.
- Keine neuen Dependencies ohne Grund; Versionen fix (kein `^`).
