import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { listCrew } from '../../db/repo';
import { renderUi, seedTrip, useCleanDb } from '../test-utils';
import { HomeViewCard } from './HomeViewCard';

const viewerRows = () => db.members.filter((m) => !!m.email?.startsWith('daheim-')).toArray();

describe('HomeViewCard (Admin)', () => {
  useCleanDb();
  const before = db.cloudUser;
  afterEach(() => {
    db.cloudUser = before;
  });

  it('erstellt den Link mit QR-Code und Freischalt-Hinweis; erneuern und abschalten nur nach Bestätigung', async () => {
    db.cloudUser = () => ({ userId: 'alice@demo.local', email: 'alice@demo.local' });
    const trip = await seedTrip('Ostsee');
    const user = userEvent.setup();
    renderUi(<HomeViewCard trip={trip} />);
    const card = await screen.findByRole('region', { name: 'Daheim-Link' });
    await user.click(within(card).getByRole('button', { name: 'Daheim-Link erstellen' }));

    const link = await within(card).findByTestId('home-link');
    expect(link.textContent).toMatch(/^http:\/\/localhost(:\d+)?\/#daheim=[a-z2-7]{26}$/);
    const token = /daheim=([a-z2-7]{26})/.exec(link.textContent ?? '')![1]!;
    expect(within(card).getByRole('img', { name: 'QR-Code Daheim-Link: Ostsee' })).toBeInTheDocument();
    expect(within(card).getByText('Noch nicht freigeschaltet')).toBeInTheDocument();
    // Befehl eingeklappt im Bereich für die Person mit Admin-Zugang; Teilen nur als sekundärer Button mit Zusatz
    const unlock = within(card).getByTestId('home-unlock');
    expect(unlock.closest('details')).not.toHaveAttribute('open');
    expect(within(card).getByText('Für die Person mit Admin-Zugang am Laptop')).toBeInTheDocument();
    const share = within(card).getByRole('button', { name: 'Link teilen (funktioniert erst nach Freischaltung)' });
    expect(share).not.toHaveClass('primary');
    expect(within(card).getByTestId('home-unlock')).toHaveTextContent(`npm run viewer:create -- daheim-${token}@demo.local`);
    expect((await viewerRows()).map((m) => m.email)).toEqual([`daheim-${token}@demo.local`]);
    expect((await listCrew(db, trip.id)).map((c) => c.name)).toEqual(['Anna']); // keine Person

    // erneuern: erst bestätigen
    await user.click(within(card).getByRole('button', { name: 'Link erneuern' }));
    expect(await viewerRows()).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: 'Neuen Link erstellen' }));
    await waitFor(async () => expect((await viewerRows())[0]?.email).not.toBe(`daheim-${token}@demo.local`));
    await waitFor(() => expect(within(card).getByTestId('home-link').textContent).not.toContain(token));

    // geöffnet: Hinweis verschwindet
    await db.members.filter((m) => !!m.email?.startsWith('daheim-')).modify({ accepted: new Date() });
    expect(await within(card).findByText('geöffnet')).toBeInTheDocument();
    expect(within(card).queryByText('Noch nicht freigeschaltet')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Link teilen' })).toHaveClass('primary');

    // abschalten: Abbrechen lässt alles stehen, Bestätigen entfernt das Mitglied
    await user.click(within(card).getByRole('button', { name: 'Daheim-Link abschalten' }));
    await user.click(within(card).getByRole('button', { name: 'Abbrechen' }));
    expect(await viewerRows()).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: 'Daheim-Link abschalten' }));
    await user.click(within(card).getByRole('button', { name: 'Abschalten' }));
    expect(await within(card).findByRole('button', { name: 'Daheim-Link erstellen' })).toBeInTheDocument();
    expect(await viewerRows()).toEqual([]);
  });

  it('teilt den Link (Web Share)', async () => {
    db.cloudUser = () => ({ userId: 'alice@demo.local', email: 'alice@demo.local' });
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const trip = await seedTrip('Ostsee');
    const user = userEvent.setup();
    renderUi(<HomeViewCard trip={trip} />);
    await user.click(await screen.findByRole('button', { name: 'Daheim-Link erstellen' }));
    await user.click(await screen.findByRole('button', { name: /^Link teilen/  }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/#daheim=/) }));
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
});
