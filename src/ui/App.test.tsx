import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { addBoat } from '../db/repo';
import { App } from './App';
import { asCloudMember, seedEntry, seedTrip, useCleanDb } from './test-utils';

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
    await user.type(screen.getByLabelText('Dein Name'), 'Anna');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    await user.type(screen.getByLabelText('Bootsname'), 'Seeschwalbe');
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
    await db.trips.add({ id: 'synced', name: 'Aus der Cloud', createdAt: 1, updatedAt: 1, updatedBy: 'x' });
    await db.boats.add({ id: 'b', tripId: 'synced', name: 'Möwe', colorIndex: 1, createdAt: 1, updatedAt: 1, updatedBy: 'x' });
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

  it('Boot-Schalter: ausgeblendet bei einem Boot, mit zwei Booten im Header und gespeichert', async () => {
    const trip = await seedTrip('Flotte');
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByRole('navigation', { name: 'Hauptnavigation' });
    expect(screen.queryByRole('radiogroup', { name: 'Boot wählen' })).not.toBeInTheDocument();
    unmount();
    await addBoat(db, trip.id, { name: 'Möwe' });
    render(<App />);
    const seg = await screen.findByRole('radiogroup', { name: 'Boot wählen' });
    expect(screen.getByRole('radio', { name: 'Seeschwalbe' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Eintrag jetzt · Seeschwalbe/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Alle' }));
    expect(screen.getByRole('radio', { name: 'Alle' })).toHaveAttribute('aria-checked', 'true');
    expect(seg).toBeInTheDocument();
    await vi.waitFor(async () => expect((await db.settings.get('boatSelectionByTrip'))?.value).toEqual({ [trip.id]: 'all' }));
  });

  it('Mitglied: fremder Eintrag nur ansehen (Banner), Törn-Tab ohne Admin-Funktionen', async () => {
    const trip = await seedTrip('Gemeinsam');
    await seedEntry(trip.id, Date.now());
    const restore = await asCloudMember(trip.id);
    try {
      const user = userEvent.setup();
      render(<App />);
      expect(await screen.findByRole('button', { name: /Eintrag jetzt/ })).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: /Eintrag \d\d:\d\d Eintrag.*öffnen/ }));
      expect(await screen.findByText('Nur ansehen')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Fertig' }));
      await user.click(screen.getByRole('button', { name: 'Törn' }));
      expect(await screen.findByText('Nur der Admin lädt Personen ein und legt Boote an.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Einladung senden' })).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Törn verlassen' })).toBeEnabled();
    } finally {
      restore();
    }
  });
});
