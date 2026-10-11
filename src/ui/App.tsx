import { useState } from 'react';
import { UpdatePrompt } from './UpdatePrompt';

const TABS = [
  { id: 'today', label: 'Heute', hint: 'Position festhalten und Eintrag schreiben.' },
  { id: 'days', label: 'Törn-Tage', hint: 'Alle Tage des Törns mit Distanz und Einträgen.' },
  { id: 'map', label: 'Karte', hint: 'Route und Einträge auf der Seekarte.' },
  { id: 'trip', label: 'Törn', hint: 'Boot, Crew, Export und Import.' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('today');
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <b>Logbuch</b>
          <span>Segel-Logbuch</span>
        </div>
      </header>
      <main className="screen" aria-labelledby="screen-title">
        <div className="legend">{current.label}</div>
        <h2 id="screen-title">{current.label}</h2>
        <div className="card">
          <p className="muted">{current.hint} (Platzhalter)</p>
        </div>
      </main>
      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tab"
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <UpdatePrompt />
    </div>
  );
}
