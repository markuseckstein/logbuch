import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useActiveTrip, useDayReports, useEntries } from '../db/hooks';
import { getSettings, listTrips, setActiveTrip, setTheme } from '../db/repo';
import { requestPersistentStorage } from '../db/storage';
import { dayNumber, tripDays, type Settings, type Trip } from '../domain';
import { AppContext, type AppActions, type TabId } from './AppContext';
import { Icon, type IconName } from './icons';
import { SettingsContext, useReadOnly, useSettings, useToday } from './hooks';
import { ToastProvider } from './toast';
import { UpdatePrompt } from './UpdatePrompt';
import { AuthorPromptHost } from './authorPrompt';
import { EntrySheet } from './components/EntrySheet';
import { Onboarding } from './screens/Onboarding';
import { DaysScreen } from './screens/DaysScreen';
import { MapScreen } from './screens/MapScreen';
import { LiveRouteContext, useLiveRoute, useLiveRouteState } from './live';
import { TodayScreen } from './screens/TodayScreen';
import { TripScreen } from './screens/TripScreen';

const TABS: readonly { id: TabId; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Heute', icon: 'tab-heute' },
  { id: 'days', label: 'Törn-Tage', icon: 'tab-tage' },
  { id: 'map', label: 'Karte', icon: 'tab-karte' },
  { id: 'trip', label: 'Törn', icon: 'tab-toern' },
];

const prefersDark = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function useTheme(theme: Settings['theme'] | undefined): { dark: boolean; toggle: () => void } {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset['theme'] = theme;
    else delete root.dataset['theme'];
  }, [theme]);
  const dark = theme === 'dark' || (theme !== 'light' && prefersDark());
  return { dark, toggle: () => void setTheme(db, dark ? 'light' : 'dark') };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function RecIndicator() {
  const { active, startedAt } = useLiveRoute();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active || startedAt === undefined) return null;
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const text = `${Math.floor(sec / 3600)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
  return (
    <div className="rec" role="status" aria-label={`Live-Route wird aufgezeichnet, ${text}`}>
      <i aria-hidden="true" />
      REC {text}
    </div>
  );
}

function Topbar({ trip, dark, onToggleTheme }: { trip: Trip; dark: boolean; onToggleTheme: () => void }) {
  const entries = useEntries(trip.id);
  const reports = useDayReports(trip.id);
  const today = useToday();
  const days = tripDays(trip, entries ?? [], reports ?? []);
  const n = dayNumber(trip, today, days);
  return (
    <header className="topbar">
      <div className="brand">
        <b>Logbuch</b>
        <span>{n >= 1 ? `${trip.name} · Tag ${n}` : trip.name}</span>
      </div>
      <RecIndicator />
      <button
        className="icon-btn"
        type="button"
        aria-label="Darstellung wechseln (Tag / Nachtfahrt)"
        onClick={onToggleTheme}
      >
        <Icon name={dark ? 'sonne' : 'moon'} />
      </button>
    </header>
  );
}

function Shell({ trip, dark, onToggleTheme }: { trip: Trip; dark: boolean; onToggleTheme: () => void }) {
  const reports = useDayReports(trip.id);
  const [tab, setTab] = useState<TabId>('today');
  const [sheet, setSheet] = useState<{ id: string; isNew: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  const actions = useMemo<AppActions>(
    () => ({
      openEntry: (id, isNew = false) => setSheet({ id, isNew }),
      goTo: setTab,
      startOnboarding: () => setOnboarding(true),
    }),
    [],
  );
  const closeSheet = useCallback(() => setSheet(null), []);
  const live = useLiveRouteState(trip.id);
  const readOnly = useReadOnly(trip.id);

  return (
    <AppContext.Provider value={actions}>
      <LiveRouteContext.Provider value={live}>
        <div id="app">
          <Topbar trip={trip} dark={dark} onToggleTheme={onToggleTheme} />
          {readOnly ? (
            <div className="banner">
              <Icon name="sichtung" size={20} />
              Logbuch der {trip.boat.name.trim() || trip.name} · nur lesen
            </div>
          ) : null}
          {tab === 'today' ? <TodayScreen trip={trip} reports={reports ?? []} /> : null}
          {tab === 'days' ? <DaysScreen trip={trip} /> : null}
          {tab === 'map' ? <MapScreen trip={trip} /> : null}
          {tab === 'trip' ? <TripScreen trip={trip} /> : null}
          <nav className="tabbar" aria-label="Hauptnavigation">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tab"
                aria-current={t.id === tab ? 'page' : undefined}
                onClick={() => {
                  setTab(t.id);
                  window.scrollTo(0, 0);
                }}
              >
                <Icon name={t.icon} size={24} />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <AuthorPromptHost trip={trip} />
        {sheet ? <EntrySheet key={sheet.id} entryId={sheet.id} isNew={sheet.isNew} onClose={closeSheet} /> : null}
        {onboarding ? (
          <Onboarding
            onCancel={() => setOnboarding(false)}
            onDone={() => {
              setOnboarding(false);
              setTab('today');
            }}
          />
        ) : null}
      </LiveRouteContext.Provider>
    </AppContext.Provider>
  );
}

function Root() {
  const trip = useActiveTrip();
  const settings = useSettings();
  const { dark, toggle } = useTheme(settings?.theme);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // Kein aktiver Törn, aber Törns vorhanden (z. B. nach Löschen): ersten aktivieren.
  useEffect(() => {
    if (trip !== null) return;
    void (async () => {
      const [first] = await listTrips(db);
      if (first && !(await getSettings(db)).activeTripId) await setActiveTrip(db, first.id);
    })();
  }, [trip]);

  const trips = useLiveQuery(() => db.trips.count(), []);

  if (trip === undefined || trips === undefined || settings === undefined) return null;
  if (trip === null) {
    // trips > 0 -> Aktivierung läuft gerade; sonst Onboarding (nicht abbrechbar).
    return trips > 0 ? null : <Onboarding onDone={() => undefined} />;
  }
  return (
    <SettingsContext.Provider value={settings}>
      <Shell key={trip.id} trip={trip} dark={dark} onToggleTheme={toggle} />
    </SettingsContext.Provider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Root />
      <UpdatePrompt />
    </ToastProvider>
  );
}
