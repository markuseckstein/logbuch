import { cleanup, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useActiveTrip, useBoats, useTripCrew } from '../db/hooks';
import { BoatSelectionContext, useBoatSelectionState } from './boats';
import { useMyCrewId } from './cloudHooks';
import { afterEach, beforeEach, vi } from 'vitest';
import { db } from '../db/db';
import { createEntry, createTrip, getSettings, moveTripToRealm, setActiveTrip } from '../db/repo';
import type { Boat, LogEntry, Trip } from '../domain';
import { AppContext, type AppActions } from './AppContext';
import { ToastProvider } from './toast';

/** Leert die Test-DB vor jedem Test und räumt gerenderte Komponenten danach auf. */
export function useCleanDb(): void {
  beforeEach(async () => {
    // jsdom kennt keine Object-URLs.
    window.scrollTo = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  afterEach(() => {
    cleanup();
  });
}

export function makeActions() {
  return {
    openEntry: vi.fn<AppActions['openEntry']>(),
    goTo: vi.fn<AppActions['goTo']>(),
    startOnboarding: vi.fn<AppActions['startOnboarding']>(),
  };
}

/** Boot-Schalter des aktiven Törns wie in der Shell. */
function BoatSelectionHost({ children }: { children: ReactNode }) {
  const trip = useActiveTrip();
  const boats = useBoats(trip?.id);
  const settings = useLiveQuery(() => getSettings(db), []);
  const crew = useTripCrew(trip?.id);
  const me = useMyCrewId(trip?.id ?? '');
  const sel = useBoatSelectionState(trip?.id ?? '', boats ?? [], settings, crew.find((c) => c.id === me));
  // wie die Shell: erst rendern, wenn Boote und Einstellungen da sind
  if (trip === undefined || (trip && (!boats || !settings))) return null;
  return <BoatSelectionContext.Provider value={sel}>{children}</BoatSelectionContext.Provider>;
}

export function renderUi(ui: ReactElement, actions: AppActions = makeActions()) {
  return render(
    <ToastProvider>
      <AppContext.Provider value={actions}>
        <BoatSelectionHost>{ui}</BoatSelectionHost>
      </AppContext.Provider>
    </ToastProvider>,
  );
}

export async function seedTrip(name = 'Testtörn', boats: readonly string[] = ['Seeschwalbe'], founder = 'Anna'): Promise<Trip> {
  const trip = await createTrip(db, { name, boats: boats.map((b) => ({ name: b })), founder: { name: founder } });
  await setActiveTrip(db, trip.id);
  return trip;
}

/** Boote des Törns in Anlage-Reihenfolge. */
export async function seedBoats(tripId: string): Promise<Boat[]> {
  return db.boats.where('tripId').equals(tripId).sortBy('createdAt');
}

export async function seedEntry(tripId: string, time = Date.UTC(2026, 7, 10, 12, 32), boatId?: string): Promise<LogEntry> {
  const id = boatId ?? (await seedBoats(tripId))[0]!.id;
  return createEntry(db, tripId, { boatId: id, time, tzOffsetMin: 120 });
}

/**
 * Simuliert einen angemeldeten Cloud-Nutzer (`userId`) als Mitglied eines von alice geteilten Törns
 * (Zugriffstabellen wie nach einem Sync). Liefert eine Funktion zum Zurücksetzen.
 */
export async function asCloudMember(tripId: string, userId = 'bob'): Promise<() => void> {
  const realmId = `rlm~${tripId}`;
  await moveTripToRealm(db, tripId, realmId, { name: 'T', represents: 'einen Törn' });
  await db.realms.update(realmId, { owner: 'alice' });
  for (const t of [db.trips, db.boats, db.crewMembers, db.entries, db.dayReports, db.tracks]) {
    await (t as typeof db.entries).where('tripId').equals(tripId).modify({ owner: 'alice' }).catch(() => undefined);
  }
  await db.trips.update(tripId, { owner: 'alice' });
  await db.members.put({
    id: `mmb-${userId}`, realmId, userId, email: `${userId}@demo.local`, roles: ['member'],
    permissions: { add: ['entries', 'photos', 'dayReports', 'tracks', 'trackChunks'] }, accepted: new Date(),
  } as never);
  const before = db.cloudUser;
  db.cloudUser = () => ({ userId, email: `${userId}@demo.local` });
  return () => {
    db.cloudUser = before;
  };
}
