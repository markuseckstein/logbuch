import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { renderUi, seedEntry, seedTrip, useCleanDb } from '../test-utils';
import { EntrySheet } from './EntrySheet';

vi.mock('../../device', () => ({
  captureFix: vi.fn(() => ({ first: Promise.resolve({ error: 'denied' }), stop: vi.fn() })),
  resizeImage: vi.fn(async () => ({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    mime: 'image/jpeg',
  })),
}));

async function setup() {
  const trip = await seedTrip();
  const entry = await seedEntry(trip.id);
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderUi(<EntrySheet entryId={entry.id} onClose={onClose} />);
  await screen.findByRole('dialog');
  return { entry, onClose, user };
}

describe('EntrySheet', () => {
  useCleanDb();

  it('speichert Typ, Wind, Beaufort und Text erst beim Speichern', async () => {
    const { entry, onClose, user } = await setup();

    await user.click(screen.getByRole('radio', { name: 'Ablegen' }));
    await user.click(screen.getByRole('radio', { name: 'Wind aus NW' }));
    await user.click(screen.getByRole('button', { name: '5 Beaufort, frische Brise' }));
    await user.click(screen.getByRole('button', { name: /Sonne/ }));
    await user.type(screen.getByLabelText('Text'), 'Leinen los');

    expect((await db.entries.get(entry.id))?.type).toBe('note');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db.entries.get(entry.id)).toMatchObject({
      type: 'departure',
      windDirDeg: 315,
      windBft: 5,
      sky: 'sunny',
      text: 'Leinen los',
    });
  });

  it('erfasst die Position nach, wenn keine vorhanden ist (Fehler wird gemeldet)', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Position jetzt erfassen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GPS: Zugriff verweigert');
  });

  it('übernimmt eine manuell eingegebene Position sofort', async () => {
    const { entry, user } = await setup();
    await user.click(screen.getByText('Position manuell eingeben'));
    await user.type(screen.getByLabelText(/Breite/), '54,3');
    await user.type(screen.getByLabelText(/Länge/), '10.1');
    await user.click(screen.getByRole('button', { name: 'Position übernehmen' }));
    await waitFor(async () => expect((await db.entries.get(entry.id))?.position).toEqual({ lat: 54.3, lon: 10.1 }));
  });

  it('löscht erst nach Bestätigung', async () => {
    const { entry, onClose, user } = await setup();

    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByText('Diesen Eintrag wirklich löschen?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByText('Diesen Eintrag wirklich löschen?')).not.toBeInTheDocument();
    expect(await db.entries.get(entry.id)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db.entries.get(entry.id)).toBeUndefined();
  });

  it('Escape schließt das Sheet', async () => {
    const { onClose, user } = await setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
