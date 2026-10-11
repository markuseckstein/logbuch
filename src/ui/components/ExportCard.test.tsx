import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pickFile, saveOrShareFile } from '../../device';
import { db } from '../../db/db';
import { getSettings, loadTripData } from '../../db/repo';
import { exportJson, exportZip } from '../../io';
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

  it('fragt vor dem Ersetzen eines vorhandenen Törns nach', async () => {
    const trip = await seedTrip('Backup-Törn');
    await seedEntry(trip.id);
    const zip = await exportZip(await loadTripData(db, trip.id));
    await seedEntry(trip.id, Date.UTC(2026, 7, 11, 9, 0)); // nach dem Backup hinzugefügt
    vi.mocked(pickFile).mockResolvedValue(new File([zip], 'backup.zip', { type: 'application/zip' }));
    const user = userEvent.setup();
    renderUi(<ExportCard trip={trip} />);

    await user.click(screen.getByRole('button', { name: 'Backup importieren' }));
    expect(await screen.findByRole('alertdialog', { name: 'Import bestätigen' })).toHaveTextContent(
      'Vorhandenen Törn „Backup-Törn“ ersetzen?',
    );
    expect(await db.entries.count()).toBe(2); // noch nichts geändert

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await db.entries.count()).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Backup importieren' }));
    await user.click(await screen.findByRole('button', { name: 'Ersetzen' }));
    await waitFor(async () => expect(await db.entries.count()).toBe(1));
  });

  it('legt unbekannte Törns ohne Rückfrage an und aktiviert sie', async () => {
    const other = await seedTrip('Fremder Törn');
    await seedEntry(other.id);
    const json = await exportJson(await loadTripData(db, other.id));
    await db.trips.clear();
    await db.entries.clear();
    const trip = await seedTrip('Aktueller Törn');
    vi.mocked(pickFile).mockResolvedValue(new File([await json.text()], 'x.json', { type: 'application/json' }));
    renderUi(<ExportCard trip={trip} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Backup importieren' }));
    await waitFor(async () => expect(await db.trips.count()).toBe(2));
    expect((await getSettings(db)).activeTripId).toBe(other.id);
  });

  it('zeigt bei kaputten Dateien eine verständliche Meldung', async () => {
    vi.mocked(pickFile).mockResolvedValue(new File(['{"format":"anders"}'], 'x.json', { type: 'application/json' }));
    const trip = await seedTrip();
    renderUi(<ExportCard trip={trip} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Backup importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Import nicht möglich/);
  });
});
