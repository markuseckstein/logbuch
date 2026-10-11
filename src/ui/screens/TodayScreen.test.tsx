import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FixResult } from '../../device';
import { captureFix } from '../../device';
import { db } from '../../db/db';
import { makeActions, renderUi, seedTrip, useCleanDb } from '../test-utils';
import { TodayScreen } from './TodayScreen';

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
    expect(screen.getByRole('status')).toHaveTextContent(/Eintrag \d\d:\d\d gespeichert · ohne Position \(GPS: Zugriff verweigert\)/);
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
});
