import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pickFile, saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { getSettings, loadTripData, updateTrip } from '../../db/repo';
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
    await userEvent.setup().click(screen.getByRole('button', { name: 'ZIP mit Bildern exportieren' }));

    await waitFor(() => expect(saveOrShareFile).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(saveOrShareFile).mock.calls[0] ?? [];
    expect(name).toMatch(/^logbuch-daenische-suedsee-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('exportiert Einzel-JSON mit .json-Namen', async () => {
    vi.mocked(saveOrShareFile).mockResolvedValue('shared');
    const trip = await seedTrip();
    renderUi(<ExportCard trip={trip} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Einzelnes JSON/ }));
    await waitFor(() => expect(saveOrShareFile).toHaveBeenCalled());
    expect(vi.mocked(saveOrShareFile).mock.calls.at(-1)?.[1]).toMatch(/\.json$/);
  });

  /** Exportiert ein fremdes Logbuch als Datei und entfernt es wieder aus der DB (= noch unbekannt). */
  async function foreignFile(opts: { flotilla?: boolean } = {}) {
    const other = await seedTrip('Fremder Törn');
    await updateTrip(db, other.id, {
      boat: { name: 'Möwe' },
      crew: [{ id: 'c1', name: 'Anna', role: 'skipper' }, { id: 'c2', name: 'Ben', role: 'crew' }],
      ...(opts.flotilla ? { flotilla: { id: 'f1', name: 'Sommerflotte' } } : {}),
    });
    await seedEntry(other.id);
    const zip = await exportZip(await loadTripData(db, other.id));
    await Promise.all([db.trips.clear(), db.entries.clear(), db.settings.delete('writableTripIds'), db.settings.delete('activeTripId')]);
    return { other, file: new File([zip], 'moewe.zip', { type: 'application/zip' }) };
  }

  it('fragt bei unbekanntem Logbuch nach dem Besitz und merged als „Anderes Boot“ read-only', async () => {
    const { other, file } = await foreignFile();
    const trip = await seedTrip('Eigener Törn');
    vi.mocked(pickFile).mockResolvedValue(file);
    const user = userEvent.setup();
    renderUi(<ExportCard trip={trip} />);

    await user.click(screen.getByRole('button', { name: 'Logbuch importieren' }));
    expect(await screen.findByRole('dialog', { name: /Neues Logbuch: Möwe/ })).toBeInTheDocument();
    expect(await db.trips.count()).toBe(1); // noch nichts importiert

    await user.click(screen.getByRole('button', { name: 'Anderes Boot – nur lesen' }));
    await waitFor(async () => expect(await db.trips.get(other.id)).toBeDefined());
    const settings = await getSettings(db);
    expect(settings.writableTripIds).not.toContain(other.id);
    expect(settings.activeTripId).toBe(trip.id); // bleibt im eigenen Logbuch
    expect(document.querySelector('.toast')).toHaveTextContent('Logbuch Möwe: 1 neu · 0 geändert · 0 gelöscht · 0 Fotos');
  });

  it('„Mein Boot“ macht das Logbuch beschreibbar, aktiv und fragt „Ich bin …“', async () => {
    const { other, file } = await foreignFile();
    const trip = await seedTrip('Eigener Törn');
    vi.mocked(pickFile).mockResolvedValue(file);
    const user = userEvent.setup();
    renderUi(<ExportCard trip={trip} />);

    await user.click(screen.getByRole('button', { name: 'Logbuch importieren' }));
    await user.click(await screen.findByRole('button', { name: 'Mein Boot – ich schreibe mit' }));

    await waitFor(async () => expect((await getSettings(db)).activeTripId).toBe(other.id));
    const settings = await getSettings(db);
    expect(settings.writableTripIds).toContain(other.id);
    // „Ich bin …“ wird danach im aktiven Logbuch erfragt (AuthorPromptHost)
    render(<AuthorPromptHost trip={(await db.trips.get(other.id))!} />);
    const dialog = await screen.findByRole('dialog', { name: /Wer schreibt/ });
    await user.click(within(dialog).getByRole('button', { name: /Ben/ }));
    await waitFor(async () => expect((await getSettings(db)).authorByTrip[other.id]).toBe('c2'));
  });

  it('merged bekannte Logbücher ohne Rückfrage und zeigt die Zusammenfassung', async () => {
    const trip = await seedTrip('Backup-Törn');
    await seedEntry(trip.id);
    const zip = await exportZip(await loadTripData(db, trip.id));
    await seedEntry(trip.id, Date.UTC(2026, 7, 11, 9, 0)); // nach dem Backup hinzugefügt: bleibt erhalten
    vi.mocked(pickFile).mockResolvedValue(new File([zip], 'backup.zip', { type: 'application/zip' }));
    renderUi(<ExportCard trip={trip} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Logbuch importieren' }));
    await waitFor(() => expect(document.querySelector('.toast')).toHaveTextContent(/Logbuch Seeschwalbe: 0 neu/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.entries.count()).toBe(2);
  });

  it('bietet den Beitritt zur Flottille eines fremden Logbuchs an', async () => {
    const { file } = await foreignFile({ flotilla: true });
    const trip = await seedTrip('Eigener Törn');
    vi.mocked(pickFile).mockResolvedValue(file);
    const user = userEvent.setup();
    renderUi(<ExportCard trip={trip} />);

    await user.click(screen.getByRole('button', { name: 'Logbuch importieren' }));
    await user.click(await screen.findByRole('button', { name: 'Anderes Boot – nur lesen' }));
    const offer = await screen.findByRole('dialog', { name: /Flottille „Sommerflotte“ beitreten/ });
    await user.click(within(offer).getByRole('button', { name: 'Beitreten' }));

    await waitFor(async () => expect((await db.trips.get(trip.id))?.flotilla).toEqual({ id: 'f1', name: 'Sommerflotte' }));
  });

  it('zeigt bei kaputten Dateien eine verständliche Meldung', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File(['{"format":"anders"}'], 'x.json', { type: 'application/json' }));
    const trip = await seedTrip();
    renderUi(<ExportCard trip={trip} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Logbuch importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Import nicht möglich/);
  });
});
