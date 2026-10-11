import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { db } from '../db/db';
import { createEntry, createTrip, setActiveTrip } from '../db/repo';
import type { LogEntry, Trip } from '../domain';
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

export function renderUi(ui: ReactElement, actions: AppActions = makeActions()) {
  return render(
    <ToastProvider>
      <AppContext.Provider value={actions}>{ui}</AppContext.Provider>
    </ToastProvider>,
  );
}

export async function seedTrip(name = 'Testtörn'): Promise<Trip> {
  const trip = await createTrip(db, { name, boat: { name: 'Seeschwalbe' }, crew: [] });
  await setActiveTrip(db, trip.id);
  return trip;
}

export async function seedEntry(tripId: string, time = Date.UTC(2026, 7, 10, 12, 32)): Promise<LogEntry> {
  return createEntry(db, tripId, { time, tzOffsetMin: 120 });
}
