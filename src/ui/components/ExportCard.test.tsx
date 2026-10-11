import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pickFile, saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { addCrewMember, getSettings, loadTripData, setAuthor } from '../../db/repo';
import { exportZip } from '../../io';
import { AuthorPromptHost } from '../authorPrompt';
import { renderUi, seedEntry, seedTrip, useCleanDb } from '../test-utils';
import { ExportCard } from './ExportCard';

vi.mock('../../device', () => ({ pickFile: vi.fn(), saveOrShareFile: vi.fn() }));

describe('ExportCard', () => {
  useCleanDb();

  it('exportiert ZIP über saveOrShareFile mit .zip-Dateinamen', async () => {
    vi.mocked(saveOrShareFile).mockResolvedValue('downloaded');
    const trip = await seedTrip('Dänische Südsee');
    await seedEntry(trip.id);
    renderUi(<ExportCard trip={trip} />);

    expect(await screen.findByText(/1 Einträge · 0 Bilder/)).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'ZIP mit Bildern exportieren' }));

    await waitFor(() => expect(saveOrShareFile).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(saveOrShareFile).mock.calls[0] ?? [];
    expect(name).toMatch(/^logbuch-daenische-suedsee-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('exportiert Einzel-JSON mit .json-Namen', async () => {
    vi.mocked(saveOrShareFile).mockResolvedValue('shared');
    const trip = await seedTrip();
    renderUi(<ExportCard trip={trip} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Einzelnes JSON/ }));
    await waitFor(() => expect(saveOrShareFile).toHaveBeenCalled());
    expect(vi.mocked(saveOrShareFile).mock.calls.at(-1)?.[1]).toMatch(/\.json$/);
  });

  /** Exportiert einen Törn mit zwei Personen und entfernt ihn wieder aus der DB (= auf diesem Gerät unbekannt). */
  async function otherFile() {
    const other = await seedTrip('Fremder Törn', ['Möwe']);
    await addCrewMember(db, other.id, { name: 'Ben', email: 'ben@x.de' });
    await seedEntry(other.id);
    const zip = await exportZip(await loadTripData(db, other.id));
    await Promise.all([
      db.trips.clear(), db.boats.clear(), db.entries.clear(), db.crewMembers.clear(), db.settings.delete('activeTripId'),
    ]);
    await setAuthor(db, other.id, undefined);
    return { other, file: new File([zip], 'moewe.zip', { type: 'application/zip' }) };
  }

  it('importiert einen unbekannten Törn ohne Rückfrage, macht ihn aktiv und fragt „Ich bin …“', async () => {
    const { other, file } = await otherFile();
    const trip = await seedTrip('Eigener Törn');
    vi.mocked(pickFile).mockResolvedValue(file);
    const user = userEvent.setup();
    renderUi(<ExportCard trip={trip} />);

    await user.click(await screen.findByRole('button', { name: 'Logbuch importieren' }));
    await waitFor(async () => expect((await getSettings(db)).activeTripId).toBe(other.id));
    expect(document.querySelector('.toast')).toHaveTextContent('Törn Fremder Törn: 1 neu · 0 geändert · 0 gelöscht · 0 Fotos');
    expect((await db.boats.where('tripId').equals(other.id).toArray()).map((b) => b.name)).toEqual(['Möwe']);
    render(<AuthorPromptHost trip={(await db.trips.get(other.id))!} />);
    const dialog = await screen.findByRole('dialog', { name: /Wer schreibt/ });
    await user.click(within(dialog).getByRole('button', { name: /Ben/ }));
    await waitFor(async () => expect((await getSettings(db)).authorByTrip[other.id]).toBeDefined());
  });

  it('merged bekannte Logbücher ohne Rückfrage und zeigt die Zusammenfassung', async () => {
    const trip = await seedTrip('Backup-Törn');
    await seedEntry(trip.id);
    const zip = await exportZip(await loadTripData(db, trip.id));
    await seedEntry(trip.id, Date.UTC(2026, 7, 11, 9, 0)); // nach dem Backup hinzugefügt: bleibt erhalten
    vi.mocked(pickFile).mockResolvedValue(new File([zip], 'backup.zip', { type: 'application/zip' }));
    renderUi(<ExportCard trip={trip} />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Logbuch importieren' }));
    await waitFor(() => expect(document.querySelector('.toast')).toHaveTextContent(/Törn Backup-Törn: 0 neu/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.entries.count()).toBe(2);
  });

  it('zeigt bei kaputten Dateien eine verständliche Meldung', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File(['{"format":"anders"}'], 'x.json', { type: 'application/json' }));
    const trip = await seedTrip();
    renderUi(<ExportCard trip={trip} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Logbuch importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Import nicht möglich/);
  });
});
