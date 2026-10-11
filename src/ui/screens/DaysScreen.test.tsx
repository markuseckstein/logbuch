import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { dayReportId } from '../../domain';
import { addCrewMember, addPhotosToDayReport, addPhotosToEntry, getAuthor, setAuthor, setBoatSelection, upsertDayReport } from '../../db/repo';
import { hashBlob } from '../../device';
import { asCloudMember, seedBoats, seedEntry, seedTrip, renderUi, makeActions, useCleanDb } from '../test-utils';
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
    await user.click(screen.getByRole('button', { name: 'Meinen Abschnitt schreiben' }));
    await user.type(screen.getByLabelText('Titel (optional)'), 'Kiel nach Eckernförde');
    await user.type(screen.getByLabelText('Dein Abschnitt'), 'Schöner Segeltag.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Dein Abschnitt ist gespeichert'));
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
    await user.click(screen.getByRole('button', { name: /Eintrag \d\d:\d\d Eintrag.* öffnen/ }));
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
    expect(await screen.findByText('0 / 15 an diesem Tag')).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Galerie'), [img('a'), img('b'), img('c'), img('b2', 'b')]);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '2 Fotos hinzugefügt · 2 übersprungen (schon an diesem Tag vorhanden)',
      ),
    );
    expect(await screen.findByText('2 / 15 an diesem Tag')).toBeInTheDocument();
    expect((await db.dayReports.toArray())[0]?.photoIds).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Foto 1 entfernen' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Foto entfernt'));
    expect(await screen.findByText('1 / 15 an diesem Tag')).toBeInTheDocument();
  });

  async function twoAuthors() {
    const trip = await seedTrip();
    const anna = (await getAuthor(db, trip.id))!;
    const ben = await addCrewMember(db, trip.id, { name: 'Ben', email: 'bob@demo.local' });
    await seedEntry(trip.id);
    const png = { blob: new Blob(['p']), mime: 'image/jpeg', width: 1, height: 1 };
    await setAuthor(db, trip.id, ben.id);
    await upsertDayReport(db, trip.id, '2026-08-10', { title: 'Bens Sicht', text: 'Flaute am Nachmittag.' });
    await addPhotosToDayReport(db, trip.id, '2026-08-10', [png, { ...png, hash: 'h2' }]);
    await setAuthor(db, trip.id, anna);
    await new Promise((r) => setTimeout(r, 5));
    await upsertDayReport(db, trip.id, '2026-08-10', { text: 'Annas Bericht.' });
    return { trip: (await db.trips.get(trip.id))!, anna, ben: ben.id };
  }

  it('zeigt alle Abschnitte untereinander mit Name und Uhrzeit; eigener bearbeitbar, Admin darf alle', async () => {
    const { trip, anna, ben } = await twoAuthors();
    const user = userEvent.setup();
    renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));

    const bens = await screen.findByRole('article', { name: 'Tagesbericht von Ben' });
    expect(bens).toHaveTextContent('Bens Sicht');
    expect(bens).toHaveTextContent('Flaute am Nachmittag.');
    expect(bens).toHaveTextContent(/\d\d:\d\d Uhr/);
    await waitFor(() => expect(within(bens).getAllByRole('img')).toHaveLength(2));
    const annas = screen.getByRole('article', { name: 'Tagesbericht von Anna' });
    expect(annas).toHaveTextContent('(du)');
    expect(await screen.findByText('2 / 15 an diesem Tag')).toBeInTheDocument();
    // lokal ist man Admin: fremder Abschnitt mit „(Admin)“
    expect(within(bens).getByRole('button', { name: 'Bearbeiten (Admin)' })).toBeInTheDocument();

    await user.click(within(annas).getByRole('button', { name: 'Bearbeiten' }));
    await user.clear(within(annas).getByLabelText('Dein Abschnitt'));
    await user.type(within(annas).getByLabelText('Dein Abschnitt'), 'Neu.');
    await user.click(within(annas).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect((await db.dayReports.get(dayReportId(trip.id, '2026-08-10', anna)))?.text).toBe('Neu.'));
    expect((await db.dayReports.get(dayReportId(trip.id, '2026-08-10', ben)))?.text).toBe('Flaute am Nachmittag.');
  });

  it('zeigt die Tageslisten-Vorschau des ersten Abschnitts mit Text', async () => {
    const { trip } = await twoAuthors();
    renderUi(<DaysScreen trip={trip} />);
    expect(await screen.findByText('Flaute am Nachmittag.')).toBeInTheDocument();
  });

  it('Mitglied: fremde Abschnitte nur lesen, eigener bearbeitbar', async () => {
    const { trip } = await twoAuthors();
    const restore = await asCloudMember(trip.id);
    try {
      const user = userEvent.setup();
      renderUi(<DaysScreen trip={trip} />);
      await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
      const annas = await screen.findByRole('article', { name: 'Tagesbericht von Anna' });
      await waitFor(() => expect(within(annas).queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument());
      // Bens Abschnitt gehört (simuliert) alice → auch nicht bearbeitbar; eigener noch nicht geschrieben
      expect(screen.getByRole('article', { name: 'Tagesbericht von Ben' })).toHaveTextContent('(du)');
    } finally {
      restore();
    }
  });

  it('folgt dem Boot-Schalter: bei „Alle“ Tabelle je Boot', async () => {
    const trip = await seedTrip('F', ['Seeschwalbe', 'Möwe']);
    const [a, b] = await seedBoats(trip.id);
    await seedEntry(trip.id, Date.UTC(2026, 7, 10, 10), a!.id);
    await seedEntry(trip.id, Date.UTC(2026, 7, 10, 11), b!.id);
    await setBoatSelection(db, trip.id, b!.id);
    const user = userEvent.setup();
    const { unmount } = renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
    expect(await screen.findAllByRole('button', { name: /Eintrag \d\d:\d\d Eintrag, Möwe/ })).toHaveLength(1);
    expect(screen.queryByRole('table', { name: 'Boote an diesem Tag' })).not.toBeInTheDocument();
    unmount();
    await setBoatSelection(db, trip.id, 'all');
    renderUi(<DaysScreen trip={trip} />);
    await user.click(await screen.findByRole('button', { name: /Tag 1, .* öffnen/ }));
    const table = await screen.findByRole('table', { name: 'Boote an diesem Tag' });
    expect(table).toHaveTextContent('Seeschwalbe');
    expect(table).toHaveTextContent('Möwe');
    expect(screen.getAllByRole('button', { name: /Eintrag \d\d:\d\d Eintrag, / })).toHaveLength(2);
  });
});
