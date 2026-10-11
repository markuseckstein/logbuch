import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { addPhotosToDayReport, addPhotosToEntry, setAuthor, setTripOwnership, updateTrip, upsertDayReport } from '../../db/repo';
import { hashBlob } from '../../device';
import { seedEntry, seedTrip, renderUi, makeActions, useCleanDb } from '../test-utils';
import { DaysScreen } from './DaysScreen';

vi.mock('../components/ChartMap', () => ({ ChartMap: () => null }));
vi.mock('../../device', async (importActual) => ({
  ...(await importActual<typeof import('../../device')>()),
  resizeImage: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 10, height: 10, mime: 'image/jpeg' })),
}));

const img = (name: string, content = name) => new File([content], `${name}.jpg`, { type: 'image/jpeg' });

describe('DaysScreen', () => {
  useCleanDb();

  it('listet Tage und speichert den Tagesbericht mit Toast', async () => {
    const trip = await seedTrip();
    await seedEntry(trip.id);
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />);

    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
    await user.type(screen.getByLabelText('Titel (optional)'), 'Kiel nach Eckernförde');
    await user.type(screen.getByLabelText('Reisebericht'), 'Schöner Segeltag.');
    await user.click(screen.getByRole('button', { name: 'Tagesbericht speichern' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Tagesbericht Tag 1 gespeichert'));
    const reports = await db.dayReports.toArray();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      tripId: trip.id,
      date: '2026-08-10',
      title: 'Kiel nach Eckernförde',
      text: 'Schöner Segeltag.',
    });
  });

  it('öffnet Einträge aus der Tages-Timeline', async () => {
    const trip = await seedTrip();
    const entry = await seedEntry(trip.id);
    const actions = makeActions();
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />, actions);
    await user.click(await screen.findByRole('button', { name: /Tag 1/ }));
    await user.click(screen.getByRole('button', { name: /Eintrag \d\d:\d\d Eintrag öffnen/ }));
    expect(actions.openEntry).toHaveBeenCalledWith(entry.id);
  });

  it('lädt Tagesbericht-Fotos hoch, überspringt Duplikate zu Eintragsfotos und entfernt Fotos', async () => {
    const trip = await seedTrip();
    const entry = await seedEntry(trip.id);
    await addPhotosToEntry(db, entry.id, [
      { blob: new Blob(['a']), mime: 'image/jpeg', width: 1, height: 1, hash: await hashBlob(new Blob(['a'])) },
    ]);
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
    expect(await screen.findByText('0 / 15 heute')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Galerie'), [img('a'), img('b'), img('c'), img('b2', 'b')]);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '2 Fotos hinzugefügt · 2 übersprungen (schon an diesem Tag vorhanden)',
      ),
    );
    expect(await screen.findByText('2 / 15 heute')).toBeInTheDocument();
    expect((await db.dayReports.toArray())[0]?.photoIds).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Foto 1 entfernen' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Foto entfernt'));
    expect(await screen.findByText('1 / 15 heute')).toBeInTheDocument();
  });

  async function twoAuthors() {
    const trip = await seedTrip();
    await updateTrip(db, trip.id, {
      crew: [{ id: 'c1', name: 'Anna', role: 'skipper' }, { id: 'c2', name: 'Ben', role: 'crew' }],
    });
    await seedEntry(trip.id);
    const png = { blob: new Blob(['p']), mime: 'image/jpeg', width: 1, height: 1 };
    await setAuthor(db, trip.id, 'c2');
    await upsertDayReport(db, trip.id, '2026-08-10', { title: 'Bens Sicht', text: 'Flaute am Nachmittag.' });
    await addPhotosToDayReport(db, trip.id, '2026-08-10', [png, { ...png, hash: 'h2' }]);
    await setAuthor(db, trip.id, 'c1');
    await upsertDayReport(db, trip.id, '2026-08-10', { text: 'Annas Bericht.' });
    return (await db.trips.get(trip.id))!;
  }

  it('zeigt Tagesberichte mehrerer Autoren: fremder Abschnitt gelesen, eigener editierbar, Foto-Zähler über alle', async () => {
    const trip = await twoAuthors();
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));

    const bens = await screen.findByRole('region', { name: 'Tagesbericht von Ben' });
    expect(within(bens).getByRole('heading', { name: 'Ben' })).toBeInTheDocument();
    expect(bens).toHaveTextContent('Bens Sicht');
    expect(bens).toHaveTextContent('Flaute am Nachmittag.');
    expect(await within(bens).findAllByRole('img')).toHaveLength(2);
    expect(screen.getByLabelText('Reisebericht')).toHaveValue('Annas Bericht.');
    expect(await screen.findByText('2 / 15 heute')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Reisebericht'));
    await user.type(screen.getByLabelText('Reisebericht'), 'Neu.');
    await user.click(screen.getByRole('button', { name: 'Tagesbericht speichern' }));
    await waitFor(async () => expect((await db.dayReports.get([trip.id, '2026-08-10', 'c1']))?.text).toBe('Neu.'));
    expect((await db.dayReports.get([trip.id, '2026-08-10', 'c2']))?.text).toBe('Flaute am Nachmittag.');
  });

  it('zeigt die Tageslisten-Vorschau des ersten Abschnitts mit Text', async () => {
    const trip = await twoAuthors();
    renderUi(<DaysScreen trip={trip} />);
    expect(await screen.findByText('Annas Bericht.')).toBeInTheDocument();
  });

  it('zeigt im fremden Logbuch alle Abschnitte read-only ohne Editor und Foto-Buttons', async () => {
    const trip = await twoAuthors();
    await setTripOwnership(db, trip.id, 'foreign');
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
    expect(await screen.findByRole('region', { name: 'Tagesbericht von Ben' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tagesbericht von Anna' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Reisebericht')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Galerie')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /entfernen/ })).not.toBeInTheDocument();
  });
});
