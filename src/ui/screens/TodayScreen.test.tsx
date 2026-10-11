import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FixResult } from '../../device';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { getAuthor, saveCrew, setAuthor, setTripOwnership } from '../../db/repo';
import { makeActions, renderUi, seedTrip, useCleanDb } from '../test-utils';
import { TodayScreen } from './TodayScreen';

vi.mock('../components/ChartMap', () => ({ ChartMap: () => null }));
vi.mock('../../device', () => ({ captureFix: vi.fn() }));

const mockFix = (result: FixResult): void => {
  vi.mocked(captureFix).mockReturnValue({ first: Promise.resolve(result), stop: vi.fn() });
};

describe('TodayScreen – Eintrag jetzt', () => {
  useCleanDb();

  it('legt auch bei verweigertem GPS einen Eintrag ohne Position an', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);

    await userEvent.setup().click(screen.getByRole('button', { name: /Eintrag jetzt/ }));

    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled());
    const entries = await db.entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.position).toBeUndefined();
    expect(entries[0]?.tripId).toBe(trip.id);
    expect(entries[0]?.tzOffsetMin).toBe(-new Date().getTimezoneOffset());
    expect(screen.getByRole('status')).toHaveTextContent(
      /Eintrag \d\d:\d\d gespeichert · ohne Position \(GPS: Zugriff verweigert\)/,
    );
    expect(actions.openEntry).toHaveBeenCalledWith(entries[0]?.id, true);
  });

  it('übernimmt die Position und zeigt sie im Toast; Verbesserung aktualisiert sie', async () => {
    let improve: ((p: { lat: number; lon: number }) => void) | undefined;
    vi.mocked(captureFix).mockImplementation((opts) => {
      improve = opts?.onImproved;
      return { first: Promise.resolve({ position: { lat: 54.3185, lon: 10.1407, accuracyM: 40 } }), stop: vi.fn() };
    });
    const trip = await seedTrip();
    const actions = makeActions();
    renderUi(<TodayScreen trip={trip} reports={[]} />, actions);

    await userEvent.setup().click(screen.getByRole('button', { name: /Eintrag jetzt/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled());

    expect(screen.getByRole('status')).toHaveTextContent('· 54°19,1′N 010°08,4′E');
    expect((await db.entries.toArray())[0]?.position).toMatchObject({ lat: 54.3185, lon: 10.1407 });

    improve?.({ lat: 54.32, lon: 10.15 });
    await waitFor(async () => expect((await db.entries.toArray())[0]?.position?.lat).toBe(54.32));
    // Der Eintrag erscheint in der Timeline des Tages.
    expect(await screen.findByRole('button', { name: /Eintrag \d\d:\d\d Eintrag öffnen/ })).toBeInTheDocument();
  });

  const crew = [
    { id: 'c1', name: 'Anna', role: 'skipper' as const },
    { id: 'c2', name: 'Ben', role: 'crew' as const },
  ];

  it('fragt „Ich bin …“ vor dem ersten Eintrag, wenn mehrere Crew-Mitglieder und kein Autor gesetzt sind', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    await saveCrew(db, trip.id, crew);
    const actions = makeActions();
    renderUi(<TodayScreen trip={(await db.trips.get(trip.id))!} reports={[]} />, actions);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Eintrag jetzt/ }));
    const dialog = await screen.findByRole('dialog', { name: /Wer schreibt/ });
    expect(await db.entries.count()).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: /Ben/ }));

    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled());
    expect(await getAuthor(db, trip.id)).toBe('c2');
    expect((await db.entries.toArray())[0]?.authorId).toBe('c2');
  });

  it('übernimmt bei nur einem Crew-Mitglied automatisch den Autor, ohne Rückfrage', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    await saveCrew(db, trip.id, [crew[0]!]);
    const actions = makeActions();
    renderUi(<TodayScreen trip={(await db.trips.get(trip.id))!} reports={[]} />, actions);

    await userEvent.setup().click(screen.getByRole('button', { name: /Eintrag jetzt/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await db.entries.toArray())[0]?.authorId).toBe('c1');
  });

  it('fragt nicht erneut, wenn der Autor bereits gesetzt ist', async () => {
    mockFix({ error: 'denied' });
    const trip = await seedTrip();
    await saveCrew(db, trip.id, crew);
    await setAuthor(db, trip.id, 'c1');
    const actions = makeActions();
    renderUi(<TodayScreen trip={(await db.trips.get(trip.id))!} reports={[]} />, actions);
    await userEvent.setup().click(screen.getByRole('button', { name: /Eintrag jetzt/ }));
    await waitFor(() => expect(actions.openEntry).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('zeigt in einem fremden Logbuch keinen „Eintrag jetzt“-Button', async () => {
    const trip = await seedTrip();
    await setTripOwnership(db, trip.id, 'foreign');
    renderUi(<TodayScreen trip={trip} reports={[]} />);
    expect(await screen.findByText(/Heute noch kein Eintrag in diesem Logbuch/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eintrag jetzt/ })).not.toBeInTheDocument();
  });
});
