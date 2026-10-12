import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useActiveTrip, useBoats, useDayReports, useEntries, useTripCrew } from '../db/hooks';
import { getSettings, listTrips, setActiveTrip } from '../db/repo';
import { requestPersistentStorage } from '../db/storage';
import { dayNumber, isViewerEmail, tripDays, type Trip } from '../domain';
import { AppContext, useApp, type AppActions, type TabId } from './AppContext';
import { Icon, type IconName } from './icons';
import { SettingsContext, useReadOnly, useSettings, useTheme, useToday } from './hooks';
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
import { CloudLoginHost } from './cloud/LoginHost';
import { JoinScreen, JoinWatcher, JoiningBanner, JoiningScreen, useJoinGate } from './cloud/Join';
import { RejectedChangesBanner, RejectionWatcher } from './cloud/RejectedChangesBanner';
import { SyncIndicator } from './cloud/SyncIndicator';
import { WritableTripsContext, useCloudUser, useMyCrewId, useWritableTripIds } from './cloudHooks';
import { BoatSelectionContext, BoatSwitch, useBoatSelectionState } from './boats';
import { CloudAdopter } from './cloud/CloudAdopter';
import { HomeViewApp } from './homeView/HomeViewApp';
import { useHomeViewToken } from './homeView/state';

const TABS: readonly { id: TabId; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Heute', icon: 'tab-heute' },
  { id: 'days', label: 'Törn-Tage', icon: 'tab-tage' },
  { id: 'map', label: 'Karte', icon: 'tab-karte' },
  { id: 'trip', label: 'Törn', icon: 'tab-toern' },
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** „REC 0:00:02“ in der Kopfzeile: antippbar, führt zum Live-Route-Schalter im Karte-Tab. */
export function RecIndicator() {
  const { active, startedAt } = useLiveRoute();
  const { focusLiveToggle } = useApp();
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
    <button
      className="rec"
      type="button"
      aria-label={`Live-Route wird aufgezeichnet, ${text}. Antippen zum Beenden`}
      onClick={focusLiveToggle}
    >
      <i aria-hidden="true" />
      REC {text}
    </button>
  );
}

function Topbar({ trip, dark, onToggleTheme }: { trip: Trip; dark: boolean; onToggleTheme: () => void }) {
  const entries = useEntries(trip.id);
  const reports = useDayReports(trip.id);
  const today = useToday();
  const days = tripDays(trip, entries ?? [], reports ?? []);
  const n = dayNumber(trip, today, days);
  return (
    <header className="topbar with-seg">
      <div className="brand">
        <b>Logbuch</b>
        <span>{n >= 1 ? `${trip.name} · Tag ${n}` : trip.name}</span>
      </div>
      <RecIndicator />
      <SyncIndicator />
      <button
        className="icon-btn"
        type="button"
        aria-label="Darstellung wechseln (Tag / Nachtfahrt)"
        onClick={onToggleTheme}
      >
        <Icon name={dark ? 'sonne' : 'moon'} />
      </button>
      <BoatSwitch />
    </header>
  );
}

function Shell({ trip, dark, onToggleTheme }: { trip: Trip; dark: boolean; onToggleTheme: () => void }) {
  const reports = useDayReports(trip.id);
  const [tab, setTab] = useState<TabId>('today');
  const [sheet, setSheet] = useState<{ id: string; isNew: boolean } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [liveFocus, setLiveFocus] = useState(false);

  const actions = useMemo<AppActions>(
    () => ({
      openEntry: (id, isNew = false) => setSheet({ id, isNew }),
      goTo: setTab,
      startOnboarding: () => setOnboarding(true),
      focusLiveToggle: () => {
        setTab('map');
        setLiveFocus(true);
        window.scrollTo(0, 0);
      },
    }),
    [],
  );
  const closeSheet = useCallback(() => setSheet(null), []);
  const live = useLiveRouteState(trip.id);
  const readOnly = useReadOnly(trip.id);
  const settings = useSettings();
  const boats = useBoats(trip.id);
  const crew = useTripCrew(trip.id);
  const myId = useMyCrewId(trip.id);
  const selection = useBoatSelectionState(trip.id, boats ?? [], settings, crew.find((c) => c.id === myId));
  if (!boats) return null;

  return (
    <AppContext.Provider value={actions}>
      <BoatSelectionContext.Provider value={selection}>
      <LiveRouteContext.Provider value={live}>
        <div id="app">
          <Topbar trip={trip} dark={dark} onToggleTheme={onToggleTheme} />
          <JoiningBanner />
          <RejectedChangesBanner />
          {readOnly ? (
            <div className="banner" role="status">
              <Icon name="sichtung" size={20} />
              Mitgliedschaft wird bestätigt – Schreiben ist gleich möglich
            </div>
          ) : null}
          {tab === 'today' ? <TodayScreen trip={trip} reports={reports ?? []} /> : null}
          {tab === 'days' ? <DaysScreen trip={trip} /> : null}
          {tab === 'map' ? <MapScreen trip={trip} focusLive={liveFocus} onFocusLiveDone={() => setLiveFocus(false)} /> : null}
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
      </BoatSelectionContext.Provider>
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

  const trips = useLiveQuery(() => db.trips.count(), []);

  // Kein aktiver Törn, aber Törns vorhanden (nach Löschen oder per Cloud-Sync angekommen): ersten aktivieren.
  useEffect(() => {
    if (trip !== null || !trips) return;
    void (async () => {
      const [first] = await listTrips(db);
      if (first && !(await db.trips.get((await getSettings(db)).activeTripId ?? ''))) await setActiveTrip(db, first.id);
    })();
  }, [trip, trips]);
  const writable = useWritableTripIds();
  const gate = useJoinGate(trips ?? 0);

  if (trip === undefined || trips === undefined || settings === undefined || writable === undefined) return null;
  if (gate === 'sign-in') return <JoinScreen />;
  if (gate === 'joining') return <JoiningScreen />;
  if (trip === null) {
    // trips > 0 -> Aktivierung läuft gerade; sonst Onboarding (nicht abbrechbar).
    return trips > 0 ? null : <Onboarding onDone={() => undefined} />;
  }
  return (
    <SettingsContext.Provider value={settings}>
      <WritableTripsContext.Provider value={writable}>
        <Shell key={trip.id} trip={trip} dark={dark} onToggleTheme={toggle} />
      </WritableTripsContext.Provider>
    </SettingsContext.Provider>
  );
}

/** Daheim-Link: Link geöffnet (Token gemerkt) oder als Zuschauer-Konto angemeldet. */
function useHomeViewMode(): { on: boolean; token: string | undefined } {
  const token = useHomeViewToken();
  const email = useCloudUser()?.email;
  return { on: token !== undefined || isViewerEmail(email), token };
}

export function App() {
  const homeView = useHomeViewMode();
  return (
    <ToastProvider>
      {homeView.on ? (
        <HomeViewApp key={homeView.token ?? ''} />
      ) : (
        <>
          <Root />
          <JoinWatcher />
          <RejectionWatcher />
          <CloudAdopter />
          <CloudLoginHost />
        </>
      )}
      <UpdatePrompt />
    </ToastProvider>
  );
}
