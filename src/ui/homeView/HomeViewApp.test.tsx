import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserLogin } from 'dexie-cloud-addon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { login, logout } from '../../db/cloud';
import { moveTripToRealm } from '../../db/repo';
import { ToastProvider } from '../toast';
import { seedTrip, useCleanDb } from '../test-utils';
import { HomeViewApp } from './HomeViewApp';
import { clearHomeViewToken, captureHomeViewFromUrl } from './state';

const TOKEN = 'abcdefghijklmnopqrstuvwx23';
const VIEWER = `daheim-${TOKEN}@demo.local`;

const cloud = vi.hoisted(() => ({
  user: undefined as Partial<UserLogin> | undefined,
  phase: 'in-sync',
}));
vi.mock('../cloudHooks', () => ({
  useCloudUser: () => cloud.user,
  useInvites: () => [],
  useSyncState: () => ({ phase: cloud.phase, status: 'connected' }),
  useUserInteraction: () => undefined,
}));
vi.mock('../../db/cloud', () => ({ login: vi.fn(async () => undefined), logout: vi.fn(async () => undefined) }));
vi.mock('./HomeViewScreen', () => ({ HomeViewScreen: ({ trip }: { trip: { name: string } }) => <h1>Daheim: {trip.name}</h1> }));

function open(token = TOKEN): void {
  history.replaceState(null, '', `/#daheim=${token}`);
  captureHomeViewFromUrl();
}
const renderApp = () => render(<ToastProvider><HomeViewApp /></ToastProvider>);

describe('HomeViewApp (Daheim-Link)', () => {
  useCleanDb();
  beforeAll(() => Object.defineProperty(db, 'cloudEnabled', { value: true, configurable: true }));
  afterAll(() => Object.defineProperty(db, 'cloudEnabled', { value: false, configurable: true }));
  beforeEach(() => {
    vi.mocked(login).mockClear();
    vi.mocked(logout).mockClear();
    cloud.user = { isLoggedIn: false, userId: 'unauthorized' };
    cloud.phase = 'in-sync';
    clearHomeViewToken();
  });

  it('nicht angemeldet: meldet ohne Eingabe mit dem Zuschauer-Konto an', async () => {
    open();
    renderApp();
    expect(screen.getByRole('heading', { name: 'Törn wird geladen …' })).toBeInTheDocument();
    await waitFor(() => expect(login).toHaveBeenCalledWith(db, VIEWER));
    expect(logout).not.toHaveBeenCalled();
  });

  it('Anmeldung scheitert (nicht freigeschaltet): „nicht mehr gültig“ mit „Erneut versuchen“', async () => {
    vi.mocked(login).mockRejectedValueOnce(new Error('Demo user not found'));
    open();
    renderApp();
    expect(await screen.findByText('Dieser Link funktioniert gerade nicht. Vielleicht ist er noch nicht freigeschaltet oder wurde erneuert – frag die Crew.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
  });

  it('als anderes, echtes Konto angemeldet: erst fragen, nicht still abmelden', async () => {
    cloud.user = { isLoggedIn: true, userId: 'anna@example.de', email: 'anna@example.de' };
    open();
    const user = userEvent.setup();
    const { rerender } = renderApp();
    expect(
      screen.getByText('Du bist angemeldet als anna@example.de. Die Daheim-Ansicht in diesem Browser öffnen meldet dich ab.'),
    ).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Trotzdem öffnen' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith(db, VIEWER));
    expect(vi.mocked(logout).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(login).mock.invocationCallOrder[0]!);
    rerender(<ToastProvider><HomeViewApp /></ToastProvider>);
  });

  it('„Abbrechen“ verlässt die Daheim-Ansicht ohne Abmelden', async () => {
    cloud.user = { isLoggedIn: true, userId: 'anna@example.de', email: 'anna@example.de' };
    open();
    renderApp();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(localStorage.getItem('logbook.daheim')).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it('als Zuschauer eines alten Links angemeldet: wechselt ohne Rückfrage zum neuen Konto', async () => {
    cloud.user = { isLoggedIn: true, userId: 'daheim-old', email: `daheim-${'b'.repeat(26)}@demo.local` };
    open();
    renderApp();
    await waitFor(() => expect(login).toHaveBeenCalledWith(db, VIEWER));
    expect(logout).toHaveBeenCalled();
    expect(screen.queryByText(/Du bist angemeldet als/)).toBeNull();
  });

  it('angemeldet als Zuschauer: zeigt den Törn; ohne Törn nach dem Abgleich „nicht mehr gültig“', async () => {
    cloud.user = { isLoggedIn: true, userId: VIEWER, email: VIEWER };
    open();
    renderApp();
    expect(screen.getByRole('heading', { name: 'Törn wird geladen …' })).toBeInTheDocument();
    expect(await screen.findByText(/Dieser Link funktioniert gerade nicht/, undefined, { timeout: 8000 })).toBeInTheDocument();
    // Törn kommt per Sync an (geteilter Realm)
    const trip = await seedTrip('Ostsee');
    await moveTripToRealm(db, trip.id, `rlm~${trip.id}`, { name: 'Ostsee', represents: 'einen Törn' });
    expect(await screen.findByRole('heading', { name: 'Daheim: Ostsee' })).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  }, 15_000);

  it('kaputter Link: „nicht mehr gültig“ ohne Anmeldeversuch', async () => {
    open('abc');
    renderApp();
    expect(screen.getByText(/Dieser Link funktioniert gerade nicht/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(login).not.toHaveBeenCalled();
  });
});
