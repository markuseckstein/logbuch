import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { addPhotosToDayReport } from '../../db/repo';
import { renderUi, seedEntry, seedTrip, useCleanDb } from '../test-utils';
import { EntrySheet } from './EntrySheet';

vi.mock('../../device', async (importActual) => ({
  ...(await importActual<typeof import('../../device')>()),
  captureFix: vi.fn(() => ({ first: Promise.resolve({ error: 'denied' }), stop: vi.fn() })),
  resizeImage: vi.fn(async () => ({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
    mime: 'image/jpeg',
  })),
}));

const toastEl = (): Element => document.querySelector('.toast')!;
const hashOf = async (content: string): Promise<string> => (await import('../../device')).hashBlob(new Blob([content]));

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
    expect((await db.entries.get(entry.id))!.deletedAt).toBeDefined(); // Tombstone
  });

  it('Escape schließt das Sheet', async () => {
    const { onClose, user } = await setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  describe('Fotos', () => {
    const img = (name: string, content = name) => new File([content], `${name}.jpg`, { type: 'image/jpeg' });

    it('bietet Galerie (Mehrfachauswahl) und Kamera als getrennte Eingaben', async () => {
      await setup();
      const gallery = screen.getByLabelText('Galerie');
      expect(gallery).toHaveAttribute('multiple');
      expect(gallery).not.toHaveAttribute('capture');
      expect(screen.getByLabelText('Kamera')).toHaveAttribute('capture', 'environment');
      expect(screen.getByText('0 / 5')).toBeInTheDocument();
    });

    it('speichert eine Mehrfachauswahl, überspringt Duplikate und meldet es per Toast', async () => {
      const { entry, user } = await setup();
      await user.upload(screen.getByLabelText('Galerie'), [img('a'), img('b'), img('c'), img('a2', 'a')]);
      await waitFor(() =>
        expect(toastEl()).toHaveTextContent(
          '3 Fotos hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)',
        ),
      );
      const stored = await db.entries.get(entry.id);
      expect(stored?.photoIds).toHaveLength(3);
      expect(await db.photos.count()).toBe(3);
      expect(await screen.findByText('3 / 5')).toBeInTheDocument();
    });

    it('begrenzt auf 5 Fotos pro Eintrag', async () => {
      const { entry, user } = await setup();
      await user.upload(screen.getByLabelText('Galerie'), [img('a'), img('b'), img('c'), img('d')]);
      await waitFor(async () => expect((await db.entries.get(entry.id))?.photoIds).toHaveLength(4));
      await user.upload(screen.getByLabelText('Galerie'), [img('e'), img('f'), img('g')]);
      await waitFor(() =>
        expect(toastEl()).toHaveTextContent('1 Foto hinzugefügt · 2 übersprungen (max. 5 pro Eintrag)'),
      );
      expect((await db.entries.get(entry.id))?.photoIds).toHaveLength(5);
      expect(screen.getByLabelText('Galerie')).toBeDisabled();
    });

    it('überspringt ein Foto, das am selben Tag schon im Tagesbericht hängt', async () => {
      const { entry, user } = await setup();
      await addPhotosToDayReport(db, entry.tripId, '2026-08-10', [
        { blob: new Blob(['a']), mime: 'image/jpeg', width: 1, height: 1, hash: await hashOf('a') },
      ]);
      await user.upload(screen.getByLabelText('Galerie'), [img('a'), img('b')]);
      await waitFor(() =>
        expect(toastEl()).toHaveTextContent(
          '1 Foto hinzugefügt · 1 übersprungen (schon an diesem Tag vorhanden)',
        ),
      );
    });

    it('entfernt ein Foto sofort', async () => {
      const { entry, user } = await setup();
      await user.upload(screen.getByLabelText('Galerie'), [img('a')]);
      await user.click(await screen.findByRole('button', { name: 'Foto 1 entfernen' }));
      await waitFor(async () => expect((await db.entries.get(entry.id))?.photoIds).toEqual([]));
    });
  });
});
