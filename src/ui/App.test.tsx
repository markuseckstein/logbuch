import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { setTripOwnership, updateTrip, createEntry } from '../db/repo';
import { App } from './App';
import { seedTrip, useCleanDb } from './test-utils';

vi.mock('./components/ChartMap', () => ({ ChartMap: () => null }));
vi.mock('./UpdatePrompt', () => ({ UpdatePrompt: () => null }));
vi.mock('../device', () => ({ captureFix: vi.fn(), resizeImage: vi.fn() }));

describe('App', () => {
  useCleanDb();

  it('zeigt ohne Törn automatisch das Onboarding und danach die Shell', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('dialog', { name: 'Neuer Törn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Name des Törns'), 'Sommertörn');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.click(screen.getByRole('button', { name: 'Törn anlegen' }));

    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    expect(nav).toBeInTheDocument();
    expect(await screen.findByText('Sommertörn · Tag 1', { exact: false })).toBeInTheDocument();
    expect(await db.trips.count()).toBe(1);
  });

  it('aktiviert ein Logbuch, das ohne aktiven Törn per Sync ankommt (Onboarding → Shell)', async () => {
    render(<App />);
    expect(await screen.findByRole('dialog', { name: 'Neuer Törn' })).toBeInTheDocument();
    // wie ein Cloud-Sync nach Login/Einladung: Trip erscheint direkt in der DB, ohne activeTripId
    await db.trips.add({ id: 'synced', name: 'Aus der Cloud', boat: { name: 'Möwe' }, createdAt: 1, updatedAt: 1, updatedBy: 'x' });
    expect(await screen.findByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(await screen.findByText('Aus der Cloud', { exact: false })).toBeInTheDocument();
  });

  it('wechselt Tabs und schaltet das Theme um', async () => {
    await seedTrip('Testtörn');
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    await user.click(screen.getByRole('button', { name: 'Karte' }));
    expect(screen.getByRole('button', { name: 'Karte' })).toHaveAttribute('aria-current', 'page');
    expect(nav).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Darstellung wechseln/ }));
    await vi.waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'));
  });

  it('zeigt fremde Logbücher mit Banner „nur lesen“, ohne Eintrag-Button und mit gesperrtem Törn-Tab', async () => {
    const trip = await seedTrip('Fremdtörn');
    await updateTrip(db, trip.id, { boat: { name: 'Möwe' } });
    const entry = await createEntry(db, trip.id, { time: Date.now(), tzOffsetMin: 0 });
    await setTripOwnership(db, trip.id, 'foreign');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Logbuch der Möwe · nur lesen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eintrag jetzt/ })).not.toBeInTheDocument();

    // Eintrag-Sheet: nur Ansicht, keine Bearbeiten-/Löschen-Buttons
    await user.click(await screen.findByRole('button', { name: /Eintrag \d\d:\d\d Eintrag öffnen/ }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(entry.id).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Törn' }));
    expect(screen.getByLabelText('Name des Törns')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Törndaten speichern' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logbuch auf diesem Gerät löschen/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Logbuch teilen' })).toBeEnabled();
  });
});
