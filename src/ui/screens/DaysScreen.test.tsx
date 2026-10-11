import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../../db/db';
import { seedEntry, seedTrip, renderUi, makeActions, useCleanDb } from '../test-utils';
import { DaysScreen } from './DaysScreen';

vi.mock('../components/ChartMap', () => ({ ChartMap: () => null }));

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
});
