import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { addPhotosToDayReport } from '../../db/repo';
import { asCloudMember, renderUi, seedBoats, seedEntry, seedTrip, useCleanDb } from '../test-utils';
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
    expect(screen.getByText(/Standort ist gesperrt.*Schloss.*Berechtigungen.*Standort.*Zulassen/)).toBeInTheDocument();
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

  describe('Autosave beim Schließen', () => {
    const changeText = async (user: ReturnType<typeof userEvent.setup>) => user.type(screen.getByLabelText('Text'), 'Segel gesetzt');

    it('X speichert Änderungen und meldet es per Toast', async () => {
      const { entry, onClose, user } = await setup();
      await changeText(user);
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await db.entries.get(entry.id))?.text).toBe('Segel gesetzt');
      expect(toastEl()).toHaveTextContent(/^Eintrag \d\d:\d\d gespeichert$/);
    });

    it('Tipp auf den Hintergrund speichert ebenfalls', async () => {
      const { entry, onClose, user } = await setup();
      await user.click(screen.getByRole('radio', { name: 'Ablegen' }));
      await user.click(document.querySelector('.scrim')!);
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await db.entries.get(entry.id))?.type).toBe('departure');
    });

    it('Escape speichert ebenfalls', async () => {
      const { entry, onClose, user } = await setup();
      await changeText(user);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await db.entries.get(entry.id))?.text).toBe('Segel gesetzt');
    });

    it('Zurück-Geste (popstate) speichert und schließt', async () => {
      const { entry, onClose, user } = await setup();
      await changeText(user);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect((await db.entries.get(entry.id))?.text).toBe('Segel gesetzt');
    });

    it('ohne Änderungen: schließt ohne Speichern und ohne Toast', async () => {
      const { entry, onClose, user } = await setup();
      const before = (await db.entries.get(entry.id))!;
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(await db.entries.get(entry.id)).toEqual(before);
      expect(toastEl()).not.toHaveClass('show');
    });

    it('unlesbare Position: Sheet bleibt offen, Fehler steht am Feld', async () => {
      const { entry, onClose, user } = await setup();
      await changeText(user);
      await user.click(screen.getByText('Position manuell eingeben'));
      await user.type(screen.getByLabelText(/Breite/), 'abc');
      await user.type(screen.getByLabelText(/Länge/), '10');
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Breite');
      expect(alert).toHaveTextContent('54°19,1');
      expect(screen.getByLabelText(/Breite/)).toHaveAttribute('aria-invalid', 'true');
      expect(onClose).not.toHaveBeenCalled();
      expect((await db.entries.get(entry.id))?.text).toBeUndefined();
    });

    it('lesbare, noch nicht übernommene Position wird beim Schließen mitgespeichert', async () => {
      const { entry, onClose, user } = await setup();
      await user.click(screen.getByText('Position manuell eingeben'));
      await user.type(screen.getByLabelText(/Breite/), "54°19,1'N");
      await user.type(screen.getByLabelText(/Länge/), '010 08,4 O');
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      const pos = (await db.entries.get(entry.id))?.position;
      expect(pos?.lat).toBeCloseTo(54 + 19.1 / 60, 6);
      expect(pos?.lon).toBeCloseTo(10 + 8.4 / 60, 6);
    });

    it('fremder Eintrag (nur ansehen): Schließen speichert nichts', async () => {
      const trip = await seedTrip('F', ['Seeschwalbe']);
      const entry = await seedEntry(trip.id);
      const restore = await asCloudMember(trip.id);
      const onClose = vi.fn();
      try {
        const user = userEvent.setup();
        renderUi(<EntrySheet entryId={entry.id} onClose={onClose} />);
        await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Nur ansehen'), { timeout: 3000 });
        const before = (await db.entries.get(entry.id))!;
        await user.click(screen.getByRole('button', { name: 'Schließen' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(await db.entries.get(entry.id)).toEqual(before);
        expect(toastEl()).not.toHaveClass('show');
      } finally {
        restore();
      }
    });
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

  it('Boot-Chips: eigener Eintrag wechselt das Boot', async () => {
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [, moewe] = await seedBoats(trip.id);
    const entry = await seedEntry(trip.id);
    const user = userEvent.setup();
    renderUi(<EntrySheet entryId={entry.id} onClose={vi.fn()} />);
    const group = await screen.findByRole('radiogroup', { name: 'Boot' });
    expect(group).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Möwe' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect((await db.entries.get(entry.id))?.boatId).toBe(moewe!.id));
  });

  it('fremder Eintrag (Mitglied): Banner „Nur ansehen“ mit Autor und Boot, kein Speichern/Löschen', async () => {
    const trip = await seedTrip('F', ['Seeschwalbe']);
    const entry = await seedEntry(trip.id);
    const restore = await asCloudMember(trip.id);
    try {
      renderUi(<EntrySheet entryId={entry.id} onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Nur ansehen'), { timeout: 3000 });
      const note = screen.getByRole('note');
      expect(note).toHaveTextContent('Eintrag von Anna · Seeschwalbe');
      expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('Admin bearbeitet fremden Eintrag: Banner „Admin-Bearbeitung“', async () => {
    const trip = await seedTrip('F', ['Seeschwalbe']);
    const entry = await seedEntry(trip.id);
    const restore = await asCloudMember(trip.id, 'alice');
    await db.entries.update(entry.id, { owner: 'bob', authorId: 'someone-else' });
    try {
      renderUi(<EntrySheet entryId={entry.id} onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('Admin-Bearbeitung'), { timeout: 3000 });
      expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
